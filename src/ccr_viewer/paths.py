"""Selección de la raíz del archivo y acceso protegido de solo lectura.

Este módulo nunca escribe, repara ni renombra nada del archivo de revisiones.
Toda lectura pasa por :func:`open_archive_file`, que verifica el descriptor
abierto antes de devolver un solo byte.
"""

from __future__ import annotations

import contextlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import BinaryIO, Iterator, Mapping

__all__ = [
    "CcrViewerError",
    "RootSelectionError",
    "UnsafePathError",
    "RootConfig",
    "ENV_ROOT",
    "DEFAULT_ROOT_PARTS",
    "RUN_SENTINELS",
    "is_reparse",
    "resolve_root",
    "resolve_root_source",
    "safe_regular_file",
    "open_archive_file",
]

#: Variable de entorno que permite seleccionar el archivo sin argumentos.
ENV_ROOT = "CCR_ARTIFACTS_DIR"

#: Ubicación predeterminada relativa al hogar del usuario.
DEFAULT_ROOT_PARTS = (".comprehensive-code-review", "reviews")

#: Cualquiera de estos archivos convierte su directorio en una corrida detectable.
RUN_SENTINELS = ("cierre.json", "review.json", "informe.md", "trazabilidad.jsonl")

_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class CcrViewerError(Exception):
    """Error esperado del visor, apto para mostrarse sin traza técnica."""


class RootSelectionError(CcrViewerError):
    """La raíz seleccionada no existe o no puede usarse como archivo de revisiones."""


class UnsafePathError(CcrViewerError):
    """Una ruta infringe la política de contención o de solo lectura."""


@dataclass(frozen=True)
class RootConfig:
    """Configuración efectiva derivada de la línea de comandos."""

    root: Path
    selected_by: str
    port: int
    open_browser: bool


@dataclass(frozen=True)
class _FrozenRoot:
    """Raíz resuelta y congelada contra la que se valida cada descriptor abierto."""

    root: Path
    key: tuple[int, int]


def is_reparse(path: Path) -> bool:
    """Indica si la ruta es un enlace simbólico o un punto de reparse de Windows."""

    status = os.lstat(path)
    if stat.S_ISLNK(status.st_mode):
        return True
    attributes = getattr(status, "st_file_attributes", 0)
    return bool(attributes & _REPARSE_POINT)


#: Alias interno: ``safe_regular_file`` lo resuelve por nombre en cada llamada.
_is_reparse = is_reparse


def _is_within(base: Path, target: Path) -> bool:
    """Compara contención usando la semántica de ruta del sistema operativo."""

    try:
        target.relative_to(base)
    except ValueError:
        return False
    return True


def _has_run_sentinel(directory: Path) -> bool:
    return any(
        os.path.lexists(directory / name) and os.path.isfile(directory / name)
        for name in RUN_SENTINELS
    )


def _missing_root_message(base: Path, selected_by: str) -> str:
    if selected_by == "default":
        return (
            f"No existe el archivo predeterminado: {base}. "
            "Indica la ubicación con --root PATH o con la variable "
            f"{ENV_ROOT}; el visor no crea directorios ni cae a otra ruta."
        )
    return f"No existe la raíz seleccionada: {base}."


def _select_root(base: Path, selected_by: str) -> tuple[Path, str]:
    if not base.exists():
        raise RootSelectionError(_missing_root_message(base, selected_by))
    if not base.is_dir():
        raise RootSelectionError(
            f"La raíz seleccionada no es un directorio: {base}. "
            "Indica el directorio que contiene las revisiones."
        )
    if _has_run_sentinel(base):
        return base.resolve(), selected_by
    child = base / "reviews"
    if child.exists() and not _is_reparse(child) and child.is_dir():
        return child.resolve(), selected_by
    return base.resolve(), selected_by


def resolve_root_source(
    explicit: str | None, env: Mapping[str, str], home: Path
) -> tuple[Path, str]:
    """Resuelve la raíz del archivo y devuelve su ruta junto al origen de la selección."""

    if explicit:
        return _select_root(Path(explicit).expanduser(), "explicit")
    from_env = env.get(ENV_ROOT) if env is not None else None
    if from_env:
        return _select_root(Path(from_env).expanduser(), "env")
    return _select_root(Path(home).joinpath(*DEFAULT_ROOT_PARTS), "default")


def resolve_root(explicit: str | None, env: Mapping[str, str], home: Path) -> Path:
    """Resuelve la raíz del archivo sin crear ni modificar nada."""

    return resolve_root_source(explicit, env, home)[0]


def _relative_parts(relative: str) -> tuple[str, ...]:
    """Valida y divide una ruta relativa de archivo, rechazando escapes y absolutos."""

    if not isinstance(relative, str) or not relative.strip():
        raise UnsafePathError("La ruta del archivo es obligatoria.")
    if "\x00" in relative:
        raise UnsafePathError("La ruta del archivo contiene un carácter nulo.")
    if os.name == "nt":
        candidate = PureWindowsPath(relative)
        if candidate.drive or candidate.root:
            raise UnsafePathError(f"La ruta debe ser relativa a la raíz: {relative}")
        raw_parts = candidate.parts
    else:
        if relative.startswith("/"):
            raise UnsafePathError(f"La ruta debe ser relativa a la raíz: {relative}")
        raw_parts = tuple(part for part in relative.split("/") if part)

    parts: list[str] = []
    for part in raw_parts:
        if part == "..":
            raise UnsafePathError(f"No se permite '..' en una ruta de archivo: {relative}")
        if part == ".":
            continue
        parts.append(part)
    if not parts:
        raise UnsafePathError(f"La ruta relativa no apunta a ningún archivo: {relative}")
    return tuple(parts)


def _freeze_root(root: Path) -> _FrozenRoot:
    resolved = Path(root).resolve()
    status = os.stat(resolved)
    return _FrozenRoot(resolved, (status.st_dev, status.st_ino))


def safe_regular_file(root: Path, relative: str) -> Path:
    """Valida la política de acceso y devuelve la ruta absoluta de un archivo regular.

    Rechaza rutas absolutas, escapes con ``..``, componentes enlace o reparse,
    directorios y cualquier ruta que quede fuera de la raíz resuelta.
    """

    base = Path(root).resolve()
    candidate = base
    for part in _relative_parts(relative):
        candidate = candidate / part
        if os.path.lexists(candidate) and _is_reparse(candidate):
            raise UnsafePathError(
                f"El componente {part!r} es un enlace o un punto de reparse: {candidate}"
            )
    if not candidate.exists():
        raise UnsafePathError(f"No existe el archivo dentro de la raíz: {relative}")
    resolved = candidate.resolve()
    if not _is_within(base, resolved):
        raise UnsafePathError(f"La ruta sale de la raíz seleccionada: {relative}")
    status = os.lstat(resolved)
    if stat.S_ISLNK(status.st_mode) or getattr(status, "st_file_attributes", 0) & _REPARSE_POINT:
        raise UnsafePathError(f"No se puede abrir un enlace o punto de reparse: {relative}")
    if not stat.S_ISREG(status.st_mode):
        raise UnsafePathError(f"No es un archivo regular: {relative}")
    return resolved


def _windows_final_path(handle: BinaryIO) -> Path:
    """Resuelve la ruta final real de un handle abierto mediante la API de Windows."""

    if os.name != "nt":
        raise UnsafePathError("La verificación de handle final solo aplica a Windows.")
    import ctypes
    import msvcrt
    from ctypes import wintypes

    raw = msvcrt.get_osfhandle(handle.fileno())
    if raw == -1:
        raise UnsafePathError("No se pudo obtener el handle nativo del archivo abierto.")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    get_final = kernel32.GetFinalPathNameByHandleW
    get_final.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    get_final.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_final(wintypes.HANDLE(raw), buffer, len(buffer), 0)
    if length == 0 or length >= len(buffer):
        raise UnsafePathError("No se pudo verificar la ruta final del archivo abierto.")
    text = buffer.value
    if text.startswith("\\\\?\\UNC\\"):
        text = "\\\\" + text[8:]
    elif text.startswith("\\\\?\\"):
        text = text[4:]
    return Path(text)


def _handle_is_within(frozen: _FrozenRoot, handle: BinaryIO, expected: Path) -> bool:
    """Confirma que el handle abierto sigue bajo la raíz congelada."""

    if os.name == "nt":
        try:
            final = _windows_final_path(handle)
        except UnsafePathError:
            return False
        return _is_within(frozen.root, final)
    try:
        opened = os.fstat(handle.fileno())
        target = os.lstat(expected)
    except OSError:
        return False
    if (opened.st_dev, opened.st_ino) != frozen.key:
        return False
    return (opened.st_dev, opened.st_ino) == (target.st_dev, target.st_ino)


def _open_relative_nofollow(directory_fd: int, relative: str) -> int:
    """Abre un archivo recorriendo componentes sin seguir enlaces desde la raíz."""

    parts = _relative_parts(relative)
    current = directory_fd
    try:
        for part in parts[:-1]:
            following = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=current,
            )
            os.close(current)
            current = following
        return os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current)
    finally:
        if current != directory_fd:
            with contextlib.suppress(OSError):
                os.close(current)


@contextlib.contextmanager
def open_archive_file(root: Path, relative: str) -> Iterator[BinaryIO]:
    """Abre un archivo del archivo para lectura, verificando el descriptor antes de leer.

    El descriptor abierto se contrasta contra la raíz congelada: si no puede
    verificarse se falla en cerrado, sin devolver contenido alguno.
    """

    frozen = _freeze_root(root)
    expected = safe_regular_file(frozen.root, relative)

    if os.name == "nt":
        handle = open(expected, "rb")
        try:
            if not _handle_is_within(frozen, handle, expected):
                raise UnsafePathError(
                    "El archivo abierto no pertenece a la raíz seleccionada; no se lee contenido."
                )
            yield handle
        finally:
            handle.close()
        return

    directory_fd = os.open(frozen.root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        current = os.fstat(directory_fd)
        if (current.st_dev, current.st_ino) != frozen.key:
            raise UnsafePathError("La raíz seleccionada cambió durante la lectura.")
        file_fd = _open_relative_nofollow(directory_fd, relative)
    finally:
        os.close(directory_fd)

    handle = os.fdopen(file_fd, "rb")
    try:
        if not _handle_is_within(frozen, handle, expected):
            raise UnsafePathError(
                "El archivo abierto no pertenece a la raíz seleccionada; no se lee contenido."
            )
        yield handle
    finally:
        handle.close()