"""Pruebas del servidor de bucle local: sesión, rutas, seguridad y solo lectura."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

from ccr_viewer.adapters import Catalog
from ccr_viewer.paths import RootConfig
from ccr_viewer.server import ViewerServer

from fixtures import archive_inventory, build_archive


class ServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")
        self.config = RootConfig(
            root=self.root.resolve(), selected_by="explicit", port=0, open_browser=False
        )
        self.catalog = Catalog(self.config.root)
        self.catalog.refresh()
        self.server = ViewerServer(self.config, self.catalog)
        self.url = self.server.start()
        self.addCleanup(self.server.stop)
        self.opener = self._build_opener()
        # La dirección de arranque lleva el token en el fragmento; para las
        # peticiones se usa la base sin fragmento, que es la ruta real.
        self.base = f"http://{self.server.authority}"
        self.origin = self.base

    def _build_opener(self):
        jar = CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    # -- utilidades de red ------------------------------------------------

    def request(self, path: str, method: str = "GET", *, body: bytes | None = None,
                headers: dict | None = None, opener=None) -> tuple[int, dict, bytes]:
        request = urllib.request.Request(self.base + path, data=body, method=method)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with (opener or self.opener).open(request, timeout=10) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def api(self, path: str, method: str = "GET", *, body: object | None = None,
            headers: dict | None = None) -> tuple[int, dict, bytes]:
        payload = None
        merged = {"Origin": self.origin, **(headers or {})}
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            merged["Content-Type"] = "application/json"
        return self.request(path, method, body=payload, headers=merged)

    def bootstrap(self, **kwargs) -> tuple[int, dict, bytes]:
        status, headers, body = self.api(
            "/api/session", "POST", body={"token": self.server.token}
        )
        self.assertEqual(status, 200, body)
        self.session_cookie = headers.get("Set-Cookie", "").split(";")[0]
        return status, headers, body

    def json_api(self, path: str, method: str = "GET", **kwargs):
        status, headers, body = self.api(path, method, **kwargs)
        try:
            payload = json.loads(body.decode("utf-8"))
        except ValueError:
            payload = None
        return status, headers, payload

    def run_key(self) -> str:
        return self.catalog.locations()[0].key


class SessionTests(ServerTestCase):
    def test_private_routes_require_a_session(self) -> None:
        fresh = self._build_opener()
        status, _, body = self.request("/api/config", opener=fresh)
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"]["code"], "session_required")

    def test_bootstrap_sets_an_http_only_strict_cookie(self) -> None:
        _, headers, _ = self.bootstrap()
        cookie = headers.get("Set-Cookie", "")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("Path=/", cookie)

    def test_bootstrap_rejects_a_wrong_token(self) -> None:
        fresh = self._build_opener()
        status, _, body = self.api("/api/session", "POST", body={"token": "incorrecto"})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_token")

    def test_bootstrap_rejects_a_foreign_origin(self) -> None:
        status, _, _ = self.api(
            "/api/session", "POST", body={"token": self.server.token},
            headers={"Origin": "http://otro.invalido"},
        )
        self.assertEqual(status, 403)

    def test_bootstrap_rejects_a_hostile_host(self) -> None:
        status, _, _ = self.request(
            "/api/session", "POST", body=json.dumps({"token": self.server.token}).encode(),
            headers={"Host": "atacante.invalido", "Origin": self.origin,
                     "Content-Type": "application/json"},
        )
        self.assertEqual(status, 403)

    def test_api_rejects_a_foreign_origin_after_bootstrap(self) -> None:
        self.bootstrap()
        status, _, _ = self.api("/api/config", headers={"Origin": "http://otro.invalido"})
        self.assertEqual(status, 403)

    def test_api_rejects_cross_site_fetch_metadata(self) -> None:
        self.bootstrap()
        status, _, _ = self.api("/api/config", headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 403)

    def test_launch_url_carries_the_token_only_in_the_fragment(self) -> None:
        self.assertTrue(self.url.startswith("http://127.0.0.1:"))
        self.assertIn("#token=" + self.server.token, self.url)
        self.assertNotIn("token=", self.url.split("#", 1)[0])


class ApiRouteTests(ServerTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.bootstrap()

    def test_config_reports_the_resolved_root(self) -> None:
        status, _, payload = self.json_api("/api/config")
        self.assertEqual(status, 200)
        self.assertEqual(payload["api_version"], 1)
        self.assertEqual(payload["data"]["root"], str(self.config.root))

    def test_runs_route_lists_the_library(self) -> None:
        status, _, payload = self.json_api("/api/runs")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["total"], 1)

    def test_runs_route_rejects_an_out_of_range_limit(self) -> None:
        status, _, _ = self.json_api("/api/runs?limit=51")
        self.assertEqual(status, 400)

    def test_runs_route_rejects_a_negative_offset(self) -> None:
        status, _, _ = self.json_api("/api/runs?offset=-1")
        self.assertEqual(status, 400)

    def test_unknown_run_key_is_not_found(self) -> None:
        status, _, payload = self.json_api("/api/runs/" + "0" * 32)
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "unknown_id")

    def test_run_detail_returns_a_review_view(self) -> None:
        status, _, payload = self.json_api("/api/runs/" + self.run_key())
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["api_version"], 1)

    def test_trace_route_returns_a_trace_view(self) -> None:
        status, _, payload = self.json_api("/api/runs/" + self.run_key() + "/trace")
        self.assertEqual(status, 200)
        self.assertIn("chain_status", payload["data"])

    def test_files_route_lists_an_inventory(self) -> None:
        status, _, payload = self.json_api("/api/runs/" + self.run_key() + "/files")
        self.assertEqual(status, 200)
        self.assertTrue(payload["data"])

    def test_file_preview_returns_a_bounded_text_envelope(self) -> None:
        _, _, files = self.json_api("/api/runs/" + self.run_key() + "/files")
        key = next(item["key"] for item in files["data"] if item["name"] == "cierre.json")
        status, _, payload = self.json_api(
            "/api/runs/" + self.run_key() + "/files/" + key
        )
        self.assertEqual(status, 200)
        self.assertIn("text", payload["data"])
        self.assertEqual(payload["data"]["media_kind"], "json")

    def test_script_content_stays_a_text_envelope(self) -> None:
        (self.run / "evidence" / "repro.py").write_bytes(b"print('hola')\n")
        _, _, files = self.json_api("/api/runs/" + self.run_key() + "/files")
        key = next(item["key"] for item in files["data"] if item["name"] == "repro.py")
        status, headers, payload = self.json_api(
            "/api/runs/" + self.run_key() + "/files/" + key
        )
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertEqual(payload["data"]["media_kind"], "code")

    def test_unknown_file_key_is_not_found(self) -> None:
        status, _, _ = self.json_api("/api/runs/" + self.run_key() + "/files/" + "0" * 32)
        self.assertEqual(status, 404)

    def test_validate_is_a_post_and_leaves_the_archive_untouched(self) -> None:
        before = archive_inventory(self.root)
        status, _, payload = self.json_api("/api/runs/" + self.run_key() + "/validate", "POST")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["status"], "verified")
        self.assertEqual(archive_inventory(self.root), before)

    def test_validate_rejects_a_get(self) -> None:
        status, _, _ = self.json_api("/api/runs/" + self.run_key() + "/validate")
        self.assertEqual(status, 405)

    def test_root_cannot_change_through_the_api(self) -> None:
        status, _, _ = self.api(
            "/api/config", "POST", body={"root": str(self.root.parent)}
        )
        self.assertIn(status, (400, 403, 405))
        _, _, payload = self.json_api("/api/config")
        self.assertEqual(payload["data"]["root"], str(self.config.root))

    def test_traversal_in_a_file_id_is_denied(self) -> None:
        status, _, _ = self.json_api("/api/runs/" + self.run_key() + "/files/..%2F..%2Fetc")
        self.assertIn(status, (400, 403, 404))

    def test_error_envelope_shape(self) -> None:
        status, _, payload = self.json_api("/api/runs/" + "0" * 32)
        self.assertEqual(payload["api_version"], 1)
        self.assertIn("code", payload["error"])
        self.assertIn("message", payload["error"])

    def test_events_route_requires_a_session(self) -> None:
        fresh = self._build_opener()
        status, _, _ = self.request("/api/events", opener=fresh)
        self.assertEqual(status, 403)


class EventStreamTests(ServerTestCase):
    def test_sessionless_events_route_is_denied(self) -> None:
        fresh = self._build_opener()
        status, _, _ = self.request("/api/events", opener=fresh)
        self.assertEqual(status, 403)

    def test_events_route_requires_get(self) -> None:
        self.bootstrap()
        status, _, _ = self.api("/api/events", "POST", body={})
        self.assertEqual(status, 405)

    def test_stream_sends_a_first_notice_and_uses_event_ids(self) -> None:
        self.bootstrap()
        status, headers, chunk = self._read_stream()
        self.assertEqual(status, 200)
        self.assertIn("text/event-stream", headers["Content-Type"])
        self.assertIn(b"event: notice", chunk)
        self.assertIn(b"data: {", chunk)
        self.assertRegex(chunk.decode("utf-8"), "id: [0-9]+")

    def test_two_subscribers_share_one_collector(self) -> None:
        self.bootstrap()
        first = self._read_stream()
        second = self._read_stream()
        self.assertEqual(self.server.collector.client_count(), 2)

    def _read_stream(self, headers: dict | None = None) -> tuple[int, dict, bytes]:
        """Abre el flujo SSE, lee el primer aviso y cierra la conexión."""

        request = urllib.request.Request(
            self.base + "/api/events",
            headers={
                "Origin": self.origin,
                "Accept": "text/event-stream",
                "Cookie": getattr(self, "session_cookie", ""),
                **(headers or {}),
            },
        )
        response = self._build_opener().open(request, timeout=15)
        try:
            collected = b""
            terminator = b"\n\n"
            while terminator not in collected:
                chunk = response.read(1)
                if not chunk:
                    break
                collected += chunk
            return response.status, dict(response.headers), collected
        finally:
            response.close()


class StaticAssetTests(ServerTestCase):
    def test_index_is_served_with_a_strict_policy(self) -> None:
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertIn("nosniff", headers.get("X-Content-Type-Options", ""))
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("<main", body.decode("utf-8"))
        self.assertIn("/assets/app.js", body.decode("utf-8"))

    def test_packaged_modules_are_served(self) -> None:
        for name in ("app.js", "api.js", "styles.css"):
            with self.subTest(name=name):
                status, _, _ = self.request("/assets/" + name)
                self.assertEqual(status, 200)

    def test_unknown_asset_is_not_found(self) -> None:
        status, _, _ = self.request("/assets/inexistente.js")
        self.assertEqual(status, 404)

    def test_archive_directories_are_never_listed(self) -> None:
        status, _, _ = self.request("/evidence/")
        self.assertEqual(status, 404)


class ConcurrencyTests(ServerTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.bootstrap()

    def test_replacement_outside_the_root_returns_no_secret_bytes(self) -> None:
        # Simula que el archivo se reemplazó por otro fuera de la raíz justo
        # entre resolver la referencia y leer: la verificación del descriptor
        # debe fallar en cerrado y no devolver ni un byte.
        import ccr_viewer.paths as paths_module

        _, _, files = self.json_api("/api/runs/" + self.run_key() + "/files")
        key = next(item["key"] for item in files["data"] if item["name"] == "notes.json")

        with mock.patch.object(paths_module, "_handle_is_within", return_value=False):
            status, _, body = self.json_api(
                "/api/runs/" + self.run_key() + "/files/" + key
            )
        self.assertEqual(status, 422)
        self.assertNotIn(b"sintetico", body)
        self.assertEqual(body["error"]["code"], "policy_violation")

    def test_parallel_requests_are_served(self) -> None:
        self.bootstrap()
        results: list[int] = []
        lock = threading.Lock()

        def worker() -> None:
            status, _, _ = self.api("/api/config")
            with lock:
                results.append(status)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        self.assertEqual(results, [200] * 6)

    def test_logs_contain_neither_token_nor_artifact_content(self) -> None:
        self.json_api("/api/runs")
        self.assertNotIn(self.server.token, self.server.log_text())
        self.assertNotIn("approvable_with_reservations", self.server.log_text())


if __name__ == "__main__":
    unittest.main()