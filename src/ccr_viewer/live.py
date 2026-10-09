"""Colector compartido de seguimiento y avisos de cambio.

Un único colector por proceso y raíz. Los avisos describen una versión coherente
nueva del archivo, nunca eventos inventados del productor. Las colas y el búfer de
replay están acotados: una cola llena se limpia y recibe un ``resync`` en lugar de
bloquear la lectura del archivo.
"""

from __future__ import annotations

import queue
import threading
import time
from typing import Callable

from .adapters import Catalog

__all__ = [
    "LiveCollector",
    "derive_display_state",
    "LIVE_POLL_SECONDS",
    "LIVE_RESCAN_SECONDS",
    "ACTIVE_CHANGE_WINDOW_SECONDS",
    "HEARTBEAT_SECONDS",
    "REPLAY_BUFFER_NOTICES",
    "MAX_CLIENT_QUEUE",
]

LIVE_POLL_SECONDS = 2.0
LIVE_RESCAN_SECONDS = 10.0
ACTIVE_CHANGE_WINDOW_SECONDS = 120.0
HEARTBEAT_SECONDS = 15.0
REPLAY_BUFFER_NOTICES = 256
MAX_CLIENT_QUEUE = 128

_RESYNC = "resync"
_CATALOG_CHANGED = "catalog_changed"
_RUN_CHANGED = "run_changed"


def derive_display_state(view: dict, recently_observed_change: bool) -> tuple[str, str | None]:
    """Deriva el estado mostrado y la fase, a partir de hitos y no de nombres de carpeta.

    El estado de la fuente se conserva aparte: ``processing`` significa trabajo
    iniciado, no que haya un proceso vivo ni que se pueda observar actividad.
    """

    summary = view.get("summary", {})
    archive_state = summary.get("archive_state")
    if archive_state == "complete":
        return "closed", None
    if archive_state == "closing":
        return "result_available_closure_pending", None
    if bool(summary.get("recently_observed_change")) or recently_observed_change:
        return "open_recent_activity", None
    return "open_activity_unknown", None


class LiveCollector:
    """Vigila el catálogo y reparte avisos acotados entre los clientes suscritos."""

    def __init__(self, catalog: Catalog, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.catalog = catalog
        self._clock = clock
        self._lock = threading.RLock()
        self._clients: list[queue.Queue] = []
        self._replay: list[dict] = []
        self._cursor = 0
        self._fingerprints: dict[str, str] = {}
        self._last_rescan = 0.0
        self._last_change: dict[str, float] = {}
        self._thread: threading.Thread | None = None
        self._stopping = threading.Event()

    # -- suscripciones ---------------------------------------------------

    def subscribe(self, last_cursor: int | None = None) -> queue.Queue:
        """Registra un cliente y le entrega los avisos posteriores a ``last_cursor``."""

        client: queue.Queue = queue.Queue(maxsize=MAX_CLIENT_QUEUE)
        with self._lock:
            self._clients.append(client)
            if last_cursor is None:
                self._enqueue(client, self._make_notice(_CATALOG_CHANGED, None, None))
            elif last_cursor >= self._cursor or last_cursor < 0:
                # El búfer ya no cubre ese cursor: el cliente debe recargar.
                self._enqueue(client, self._make_notice(_RESYNC, None, None))
            else:
                for notice in self._replay:
                    if notice["cursor"] > last_cursor:
                        self._enqueue(client, notice)
        self._ensure_thread()
        return client

    def unsubscribe(self, client: queue.Queue) -> None:
        with self._lock:
            if client in self._clients:
                self._clients.remove(client)
            empty = not self._clients
        if empty:
            # Sin suscriptores no hay nada que seguir: el hilo termina pronto.
            self._stopping.set()

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    # -- ciclo de vida --------------------------------------------------

    def stop(self) -> None:
        """Detiene el hilo propio y cierra los clientes."""
        self._stopping.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=5)
        with self._lock:
            clients = list(self._clients)
            self._clients.clear()
        for client in clients:
            self._enqueue(client, self._make_notice(_RESYNC, None, None))

    def _ensure_thread(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while not self._stopping.is_set():
            try:
                self.poll_once()
            except Exception:  # noqa: BLE001 - un fallo de sondeo no mata el hilo
                pass
            interval = (
                LIVE_POLL_SECONDS
                if self.client_count() > 0
                else LIVE_RESCAN_SECONDS
            )
            self._stopping.wait(interval)
            if self.client_count() == 0:
                with self._lock:
                    if self.client_count() == 0:
                        return

    # -- sondeo ---------------------------------------------------------

    def poll_once(self) -> list[dict]:
        """Relee lo que cambió y devuelve los avisos publicados en esta pasada."""

        now = self._clock()
        with self._lock:
            rescan = (now - self._last_rescan) >= LIVE_RESCAN_SECONDS
            self._last_rescan = now

        before = dict(self._fingerprints)
        try:
            self.catalog.refresh()
        except Exception:  # noqa: BLE001 - un catálogo ilegible no publica cambios
            return []

        published: list[dict] = []
        for location in self.catalog.locations():
            snapshot = self.catalog.snapshot(location.key)
            fingerprint = snapshot["fingerprint"]
            previous = before.get(location.key)
            changed = previous is None or previous != fingerprint
            if changed:
                self._fingerprints[location.key] = fingerprint
                if snapshot.get("updating"):
                    # Una instantánea en transición no es una versión coherente nueva.
                    continue
                self._last_change[location.key] = now
                kind = _CATALOG_CHANGED if (rescan or previous is None) else _RUN_CHANGED
                published.append(self._make_notice(kind, location.key, fingerprint))
                self._broadcast(published[-1])
                self._expire(location.key, now)

        if not published and rescan:
            notice = self._make_notice(_CATALOG_CHANGED, None, None)
            self._broadcast(notice)
            published.append(notice)
        return published

    def recently_observed(self, run_key: str) -> bool:
        """Indica si se detectó un cambio de esa corrida dentro de la ventana activa."""

        seen = self._last_change.get(run_key)
        if seen is None:
            return False
        return (self._clock() - seen) <= ACTIVE_CHANGE_WINDOW_SECONDS

    def _expire(self, run_key: str, now: float) -> None:
        for key, moment in list(self._last_change.items()):
            if (now - moment) > ACTIVE_CHANGE_WINDOW_SECONDS:
                del self._last_change[key]

    # -- avisos ---------------------------------------------------------

    def _make_notice(self, kind: str, run_key: str | None, fingerprint: str | None) -> dict:
        with self._lock:
            self._cursor += 1
            notice = {
                "cursor": self._cursor,
                "kind": kind,
                "run_key": run_key,
                "fingerprint": fingerprint,
            }
            self._replay.append(notice)
            if len(self._replay) > REPLAY_BUFFER_NOTICES:
                del self._replay[: -REPLAY_BUFFER_NOTICES]
            return notice

    def _broadcast(self, notice: dict) -> None:
        with self._lock:
            clients = list(self._clients)
        for client in clients:
            self._enqueue(client, notice)

    @staticmethod
    def _enqueue(client: queue.Queue, notice: dict) -> None:
        """Publica sin bloquear: una cola llena se limpia y pide resincronización."""

        try:
            client.put_nowait(notice)
            return
        except queue.Full:
            pass
        while True:
            try:
                client.get_nowait()
            except queue.Empty:
                break
        try:
            client.put_nowait(
                {
                    "cursor": notice["cursor"],
                    "kind": _RESYNC,
                    "run_key": None,
                    "fingerprint": None,
                }
            )
        except queue.Full:
            pass