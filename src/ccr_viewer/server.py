"""Servidor HTTP de bucle local con sesión de capacidad.

Sólo se escucha en 127.0.0.1 y sólo se sirven recursos empaquetados de una lista
finita: el archivo nunca se publica como listado de directorios. Todas las rutas
privadas exigen una sesión obtenida canjeando el token de la URL. Ninguna ruta
escribe en el archivo.
"""

from __future__ import annotations

import json
import queue
import secrets
import threading
import time
import webbrowser
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__
from .adapters import Catalog
from .integrity import validate_archive
from .live import HEARTBEAT_SECONDS, LiveCollector, derive_display_state
from .paths import CcrViewerError, RootConfig
from .references import list_files, read_preview
from .trace import parse_trace, resolve_relations

__all__ = ["ViewerServer", "serve", "API_VERSION", "SESSION_COOKIE", "STATIC_RESOURCES"]

API_VERSION = 1
SESSION_COOKIE = "ccr_session"
LOOPBACK = "127.0.0.1"
MAX_REQUEST_BODY_BYTES = 64 * 1024

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)

#: Lista finita de recursos empaquetados que el servidor puede publicar.
STATIC_RESOURCES = {
    "index.html": "text/html; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "api.js": "text/javascript; charset=utf-8",
    "store.js": "text/javascript; charset=utf-8",
    "dom.js": "text/javascript; charset=utf-8",
    "views.js": "text/javascript; charset=utf-8",
    "library.js": "text/javascript; charset=utf-8",
    "profile.js": "text/javascript; charset=utf-8",
    "findings.js": "text/javascript; charset=utf-8",
    "validation.js": "text/javascript; charset=utf-8",
    "documents.js": "text/javascript; charset=utf-8",
    "markdown.js": "text/javascript; charset=utf-8",
    "lifecycle.js": "text/javascript; charset=utf-8",
    "playback.js": "text/javascript; charset=utf-8",
    "vendor/marked.esm.js": "text/javascript; charset=utf-8",
    "vendor/purify.es.mjs": "text/javascript; charset=utf-8",
    "vendor/manifest.json": "application/json; charset=utf-8",
    "vendor/LICENSE.marked.txt": "text/plain; charset=utf-8",
    "vendor/LICENSE.dompurify.txt": "text/plain; charset=utf-8",
}

_OPAQUE_ID_LENGTH = 32


class _Streaming(Exception):
    """Marca una respuesta que se escribe de forma incremental (SSE)."""

    def __init__(self, stream) -> None:
        super().__init__("streaming")
        self.stream = stream


class _Events:
    """Suscripción acotada de un cliente al flujo de avisos."""

    def __init__(self, request: dict) -> None:
        self.collector = request["collector"]
        self.client = self.collector.subscribe(request["cursor"])

    def next_notice(self, timeout: float) -> dict | None:
        try:
            return self.client.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self) -> None:
        self.collector.unsubscribe(self.client)


class _RequestError(Exception):
    """Fallo de transporte o de política con su código HTTP y su código estable."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def web_root() -> Path:
    """Devuelve el directorio de recursos estáticos empaquetados."""

    return Path(__file__).resolve().parent / "web"


class ViewerServer:
    """Servidor de solo lectura para una raíz de archivo ya resuelta."""

    def __init__(self, config: RootConfig, catalog: Catalog) -> None:
        self.config = config
        self.catalog = catalog
        self.token = secrets.token_urlsafe(32)
        self._sessions: set[str] = set()
        self._sessions_lock = threading.Lock()
        self._logs: list[str] = []
        self.collector = LiveCollector(catalog)
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.authority = ""

    # -- ciclo de vida ---------------------------------------------------

    def start(self) -> str:
        """Arranca el servidor y devuelve la dirección real con el token en el fragmento."""

        handler = _make_handler(self)
        self._httpd = ThreadingHTTPServer((LOOPBACK, self.config.port), handler)
        self._httpd.daemon_threads = True
        host, port = self._httpd.server_address[:2]
        self.authority = f"{LOOPBACK}:{port}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return f"http://{self.authority}/#token={self.token}"

    def stop(self) -> None:
        if self._httpd is None:
            return
        self._httpd.shutdown()
        self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=10)
        self._httpd = None
        self._thread = None
        self.collector.stop()

    def _events_request(self, headers) -> dict:
        """Prepara la suscripción SSE del cliente a la que se delivers en _Events."""

        raw = headers.get("Last-Event-ID")
        cursor: int | None = None
        if raw is not None:
            try:
                cursor = int(raw)
            except ValueError:
                cursor = None
        return {"collector": self.collector, "cursor": cursor}

    # -- sesión ----------------------------------------------------------

    def open_session(self) -> str:
        identifier = secrets.token_urlsafe(32)
        with self._sessions_lock:
            self._sessions.add(identifier)
        return identifier

    def has_session(self, identifier: str | None) -> bool:
        if not identifier:
            return False
        with self._sessions_lock:
            return identifier in self._sessions

    # -- registro --------------------------------------------------------

    def log(self, message: str) -> None:
        """Registra una línea operativa. Nunca tokens, cuerpos ni contenido del archivo."""

        self._logs.append(message)
        if len(self._logs) > 500:
            del self._logs[:-500]

    def log_text(self) -> str:
        return "\n".join(self._logs)

    # -- despacho de rutas -----------------------------------------------

    def dispatch(self, method: str, path: str, query: dict, headers, body: bytes) -> tuple:
        """Devuelve ``(status, content_type, payload, extra_headers)`` para una ruta."""

        if path == "/api/session":
            return self._route_session(method, headers, body)
        self._require_session(headers)
        if path == "/api/config":
            self._require_method(method, ("GET",))
            return _json_response(
                200, {"api_version": API_VERSION, "data": self._config_payload(),
                      "diagnostics": []}
            )
        if path == "/api/runs":
            self._require_method(method, ("GET",))
            return _json_response(200, self._route_runs(query))
        if path == "/api/events":
            self._require_method(method, ("GET",))
            raise _Streaming(_Events(self._events_request(headers)))
        if path.startswith("/api/runs/"):
            return self._route_run(method, path[len("/api/runs/") :], query)
        raise _RequestError(404, "unknown_route", "Recurso no reconocido.")

    def _config_payload(self) -> dict:
        from .snapshots import (
            MAX_METADATA_BYTES,
            MAX_STABLE_READ_ATTEMPTS,
            MAX_TRACE_EVENTS,
            MAX_TRACE_BYTES,
        )

        return {
            "api_version": API_VERSION,
            "root": str(self.config.root),
            "selected_by": self.config.selected_by,
            "package_version": __version__,
            "limits": {
                "page_size": 50,
                "max_runs": 5000,
                "metadata_bytes": MAX_METADATA_BYTES,
                "trace_bytes": MAX_TRACE_BYTES,
                "trace_events": MAX_TRACE_EVENTS,
                "stable_read_attempts": MAX_STABLE_READ_ATTEMPTS,
                "text_preview_bytes": 2 * 1024 * 1024,
            },
            "capabilities": {
                "api_version": API_VERSION,
                "live_updates": False,
                "markdown": True,
            },
        }

    def _route_session(self, method: str, headers, body: bytes) -> tuple:
        self._require_method(method, ("POST",))
        if len(body) > MAX_REQUEST_BODY_BYTES:
            raise _RequestError(413, "body_too_large", "El cuerpo de la petición es demasiado grande.")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise _RequestError(400, "invalid_request", "El cuerpo no es JSON válido.") from None
        supplied = payload.get("token") if isinstance(payload, dict) else None
        if not isinstance(supplied, str) or not secrets.compare_digest(supplied, self.token):
            raise _RequestError(403, "invalid_token", "El token de capacidad no es válido.")
        identifier = self.open_session()
        cookie = (
            f"{SESSION_COOKIE}={identifier}; Path=/; HttpOnly; SameSite=Strict"
        )
        return (
            200,
            "application/json; charset=utf-8",
            json.dumps({"api_version": API_VERSION, "data": {"ok": True}}).encode("utf-8"),
            {"Set-Cookie": cookie},
        )

    def _route_runs(self, query: dict) -> dict:
        filters = {
            name: values[0]
            for name, values in query.items()
            if name in {"q", "repository", "mode", "reference", "kind", "profile", "verdict", "open", "date_from", "date_to"}
        }
        try:
            offset = _positive_int(query, "offset", 0)
            limit = _bounded_int(query, "limit", 50, 1, 50)
        except ValueError as error:
            raise _RequestError(400, "invalid_options", str(error)) from None
        try:
            self.catalog.refresh()
            page = self.catalog.list_runs(filters, offset=offset, limit=limit)
        except ValueError as error:
            raise _RequestError(400, "invalid_options", str(error)) from None
        page = {**page, "items": [self._present_summary(item) for item in page["items"]]}
        return {"api_version": API_VERSION, "data": page, "diagnostics": []}

    def _present_summary(self, summary):
        recent = self.collector.recently_observed(summary["key"])
        state, _ = derive_display_state({"summary": summary}, recent)
        return {**summary, "recently_observed_change": recent, "last_observed_change_at": self.collector.last_observed_at(summary["key"]), "display_state": state}

    def _route_run(self, method: str, tail: str, query: dict) -> tuple:
        parts = tail.split("/")
        run_key = parts[0]
        if not run_key or not _is_opaque_id(run_key):
            raise _RequestError(404, "unknown_id", "Identificador de corrida desconocido.")
        try:
            view = self.catalog.get_run(run_key)
            view = {**view, "summary": self._present_summary(view["summary"])}
            location = self._location_for(run_key)
        except KeyError:
            raise _RequestError(404, "unknown_id", "Identificador de corrida desconocido.") from None

        if len(parts) == 1:
            self._require_method(method, ("GET",))
            return _envelope(view)

        section = parts[1]
        if section == "trace" and len(parts) == 2:
            self._require_method(method, ("GET",))
            return _envelope(self._trace_for(location, view)["data"])
        if section == "files" and len(parts) == 2:
            self._require_method(method, ("GET",))
            # El inventario se lista en fresco: la evidencia puede cambiar sin
            # que cambien los archivos de metadata que usa la caché del catálogo.
            return _envelope(list_files(location))
        if section == "files" and len(parts) == 3:
            self._require_method(method, ("GET",))
            if not _is_opaque_id(unquote(parts[2])):
                raise _RequestError(404, "unknown_id", "Identificador de archivo desconocido.")
            try:
                preview = read_preview(location, unquote(parts[2]))
            except KeyError:
                raise _RequestError(404, "unknown_id",
                                    "Identificador de archivo desconocido.") from None
            return _envelope(preview)
        if section == "validate" and len(parts) == 2:
            self._require_method(method, ("POST",))
            report = validate_archive(location, self.catalog.snapshot(run_key))
            return _envelope(report)
        raise _RequestError(404, "unknown_route", "Recurso no reconocido.")

    def _location_for(self, run_key: str):
        for location in self.catalog.locations():
            if location.key == run_key:
                return location
        raise KeyError(run_key)

    def _trace_for(self, location, view: dict) -> dict:
        snapshot = self.catalog.snapshot(location.key)
        closure = snapshot["files"].get("cierre.json", {}).get("data")
        closure = closure if isinstance(closure, dict) else {}
        descriptor = closure.get("trace")
        run_id = closure.get("run_id")
        trace = parse_trace(
                snapshot["files"].get("trazabilidad.jsonl", {}).get("raw") or b"",
                descriptor if isinstance(descriptor, dict) else None,
                run_id if isinstance(run_id, str) else None,
                open_run=closure.get("state") not in (None, "complete"),
            )
        relations, diagnostics = resolve_relations(trace["events"], snapshot["files"].get("review.json", {}).get("data"), location, self.catalog)
        trace["relations"] = relations
        trace["diagnostics"].extend(diagnostics)
        if snapshot.get("updating"):
            trace["chain_status"] = "updating"
        return {"api_version": API_VERSION, "data": trace}

    def _require_method(self, method: str, allowed: tuple[str, ...]) -> None:
        if method not in allowed:
            raise _RequestError(405, "method_not_allowed",
                                "Método no permitido para esta ruta.")

    def _require_session(self, headers) -> None:
        if not self.has_session(_cookie_value(headers.get("Cookie"), SESSION_COOKIE)):
            raise _RequestError(403, "session_required",
                                "La petición necesita una sesión vigente.")


def _cookie_value(header: str | None, name: str) -> str | None:
    if not header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(header)
    except Exception:  # noqa: BLE001 - una cookie malformada simply no autentica
        return None
    morsel = cookie.get(name)
    return morsel.value if morsel else None


def _is_opaque_id(value: str) -> bool:
    return len(value) == _OPAQUE_ID_LENGTH and all(
        char in "0123456789abcdef" for char in value
    )


def _positive_int(query: dict, name: str, default: int) -> int:
    values = query.get(name)
    if not values:
        return default
    try:
        number = int(values[0], 10)
    except ValueError:
        raise ValueError(f"{name} debe ser un entero.") from None
    if number < 0:
        raise ValueError(f"{name} no puede ser negativo.")
    return number


def _bounded_int(query: dict, name: str, default: int, low: int, high: int) -> int:
    number = _positive_int(query, name, default)
    if not low <= number <= high:
        raise ValueError(f"{name} debe estar entre {low} y {high}.")
    return number


def _envelope(data: Any) -> tuple:
    """Envuelve los datos en el sobre común de la API local."""

    diagnostics = data.get("diagnostics", []) if isinstance(data, dict) else []
    return _json_response(
        200, {"api_version": API_VERSION, "data": data, "diagnostics": diagnostics}
    )


def _json_response(status: int, payload: dict) -> tuple:
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    return status, "application/json; charset=utf-8", body, {}


def _make_handler(owner: ViewerServer):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ccr-viewer/" + __version__
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args) -> None:  # sin registro en la salida estándar
            return

        # -- comprobaciones de política ---------------------------------

        def _host_ok(self) -> bool:
            return self.headers.get("Host") == owner.authority

        def _origin_ok(self) -> bool:
            supplied = self.headers.get("Origin")
            if supplied is None:
                return True
            return supplied == f"http://{owner.authority}"

        def _fetch_site_ok(self) -> bool:
            return self.headers.get("Sec-Fetch-Site") not in {"cross-site", "same-site"}

        def _guard(self) -> None:
            if not self._host_ok():
                raise _RequestError(403, "invalid_host", "El encabezado Host no es el esperado.")
            if not self._origin_ok():
                raise _RequestError(403, "invalid_origin", "El origen de la petición no es local.")
            if not self._fetch_site_ok():
                raise _RequestError(403, "invalid_fetch_metadata",
                                    "Se rechaza una petición desde otro sitio.")

        # -- métodos ----------------------------------------------------

        def do_GET(self) -> None:  # noqa: N802 - firma de BaseHTTPRequestHandler
            self._handle("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._handle("POST")

        def do_PUT(self) -> None:  # noqa: N802
            self._handle("PUT")

        def do_DELETE(self) -> None:  # noqa: N802
            self._handle("DELETE")

        def do_HEAD(self) -> None:  # noqa: N802
            self._handle("HEAD")

        def _handle(self, method: str) -> None:
            try:
                self._guard()
                parts = urlsplit(self.path)
                path = unquote(parts.path)
                query = parse_qs(parts.query)
                body = self._read_body()
                if path.startswith("/api/"):
                    status, content_type, payload, extra = owner.dispatch(
                        method, path, query, self.headers, body
                    )
                else:
                    status, content_type, payload, extra = self._serve_static(method, path)
                owner.log(f"{method} {path} -> {status}")
                self._send(status, content_type, payload, extra)
            except _Streaming as stream:
                self._serve_events(stream.stream)
            except _RequestError as error:
                owner.log(f"{method} {self.path.split('?', 1)[0]} -> {error.status}")
                payload = json.dumps(
                    {
                        "api_version": API_VERSION,
                        "error": {"code": error.code, "message": error.message},
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(error.status, "application/json; charset=utf-8", payload, {})
            except CcrViewerError:
                payload = json.dumps(
                    {
                        "api_version": API_VERSION,
                        "error": {
                            "code": "policy_violation",
                            "message": "La operación infringe la política de acceso.",
                        },
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(422, "application/json; charset=utf-8", payload, {})
            except Exception:  # noqa: BLE001 - nunca se expone una traza técnica
                owner.log(f"{method} {self.path.split('?', 1)[0]} -> 500")
                payload = json.dumps(
                    {
                        "api_version": API_VERSION,
                        "error": {
                            "code": "internal_error",
                            "message": "Se produjo un fallo interno inesperado.",
                        },
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(500, "application/json; charset=utf-8", payload, {})

        def _read_body(self) -> bytes:
            length = self.headers.get("Content-Length")
            if not length:
                return b""
            try:
                size = int(length, 10)
            except ValueError:
                raise _RequestError(400, "invalid_request", "Longitud de cuerpo inválida.") from None
            if size > MAX_REQUEST_BODY_BYTES:
                raise _RequestError(413, "body_too_large",
                                    "El cuerpo de la petición es demasiado grande.")
            return self.rfile.read(size) if size else b""

        def _serve_static(self, method: str, path: str) -> tuple:
            if method not in ("GET", "HEAD"):
                raise _RequestError(405, "method_not_allowed",
                                    "Método no permitido para esta ruta.")
            name = "index.html" if path == "/" else None
            if path.startswith("/assets/"):
                candidate = path[len("/assets/") :]
                if candidate in STATIC_RESOURCES:
                    name = candidate
            if name is None or name not in STATIC_RESOURCES:
                raise _RequestError(404, "unknown_route", "Recurso no reconocido.")
            target = web_root() / name
            try:
                target.resolve().relative_to(web_root().resolve())
                payload = target.read_bytes()
            except (OSError, ValueError):
                raise _RequestError(404, "unknown_route", "Recurso no reconocido.") from None
            return 200, STATIC_RESOURCES[name], payload, {}

        def _serve_events(self, stream) -> None:
            """Escribe el flujo SSE. Los comentarios de latencia no son actividad."""

            self.close_connection = True
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
            self.end_headers()
            last_beat = time.monotonic()
            try:
                while True:
                    notice = stream.next_notice(timeout=1.0)
                    if notice is None:
                        if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                            self.wfile.write(b": latencia\n\n")
                            self.wfile.flush()
                            last_beat = time.monotonic()
                        continue
                    payload = json.dumps(notice, ensure_ascii=False).encode("utf-8")
                    self.wfile.write(
                        b"id: "
                        + str(notice["cursor"]).encode("ascii")
                        + b"\nevent: notice\ndata: "
                        + payload
                        + b"\n\n"
                    )
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                stream.close()

        def _send(self, status: int, content_type: str, payload: bytes,
                  extra: dict) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            for name, value in extra.items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

    return Handler


def serve(config: RootConfig) -> int:
    """Arranca el servidor, abre el navegador si corresponde y espera hasta Ctrl+C."""

    catalog = Catalog(config.root)
    catalog.refresh()
    server = ViewerServer(config, catalog)
    url = server.start()
    # La dirección va sola en su línea: con --no-browser es lo que el usuario copia.
    print(url, flush=True)
    print(f"Visor disponible. Raíz del archivo ({config.selected_by}): {config.root}", flush=True)
    print("Presiona Ctrl+C para detener.", flush=True)
    if config.open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - un navegador ausente no debe detener el visor
            pass
    try:
        while True:
            if server._thread is None:
                break
            server._thread.join(timeout=1.0)
    except KeyboardInterrupt:
        print("\nDeteniendo el visor.")
    finally:
        server.stop()
    return 0
