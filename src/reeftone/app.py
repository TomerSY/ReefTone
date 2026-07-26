"""FastAPI application for the local ReefTone studio."""

from __future__ import annotations

import mimetypes
import shutil
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import PRESETS, CorrectionSettings
from .image_io import (
    SUPPORTED_EXTENSIONS,
    encode_preview,
    export_image,
    pixels_to_float,
    read_image,
)
from .processor import analyze_image, correct_image
from .session import ImageSession, SessionStore

PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
PROJECT_DIR = Path.cwd().resolve()
CACHE_DIR = PROJECT_DIR / ".reeftone_cache"
MAX_UPLOAD_BYTES = 250 * 1024 * 1024

app = FastAPI(
    title="ReefTone",
    version="0.1.0",
    description="Adaptive underwater color restoration",
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
sessions = SessionStore(limit=6)


def _library_files() -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for path in PROJECT_DIR.iterdir():
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            stat = path.stat()
            files.append(
                {
                    "name": path.name,
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                    "kind": path.suffix.lstrip(".").upper(),
                }
            )
    return sorted(files, key=lambda item: int(item["modified"]), reverse=True)


def _safe_library_path(name: str) -> Path:
    path = (PROJECT_DIR / Path(name).name).resolve()
    if path.parent != PROJECT_DIR or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, "Invalid library image")
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return path


def _create_session(path: Path, original_name: str, is_temporary: bool) -> ImageSession:
    try:
        decoded = read_image(path, max_side=1800)
    except Exception as error:
        if is_temporary:
            path.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not decode this image: {error}") from error
    float_preview = pixels_to_float(decoded.pixels, decoded.source_bits)
    analysis = analyze_image(float_preview)
    session = ImageSession(
        id=sessions.new_id(),
        path=path,
        original_name=original_name,
        preview=decoded.pixels,
        preview_jpeg=encode_preview(float_preview, quality=90),
        width=decoded.width,
        height=decoded.height,
        source_bits=decoded.source_bits,
        color_profile=decoded.color_profile,
        analysis=analysis,
        is_temporary=is_temporary,
        created_at=time.time(),
    )
    return sessions.add(session)


def _session_or_404(session_id: str) -> ImageSession:
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(404, "This editing session expired. Reopen the image.")
    return session


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.get("/api/library")
def library() -> dict[str, object]:
    return {"images": _library_files()}


@app.get("/api/presets")
def presets() -> dict[str, object]:
    return {"presets": {name: settings.to_dict() for name, settings in PRESETS.items()}}


@app.post("/api/library/open")
def open_library_image(payload: dict[str, str]) -> JSONResponse:
    path = _safe_library_path(payload.get("name", ""))
    session = _create_session(path, path.name, is_temporary=False)
    return JSONResponse(_session_payload(session))


@app.post("/api/upload")
async def upload_image(file: Annotated[UploadFile, File()]) -> JSONResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(415, "Choose a HEIC, HEIF, JPEG, PNG, or TIFF image.")
    CACHE_DIR.mkdir(exist_ok=True)
    destination = CACHE_DIR / f"{sessions.new_id()}{suffix}"
    size = 0
    with destination.open("wb") as target:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                target.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(413, "Image is larger than the 250 MB local limit.")
            target.write(chunk)
    session = _create_session(destination, Path(file.filename or "image").name, is_temporary=True)
    return JSONResponse(_session_payload(session))


def _session_payload(session: ImageSession) -> dict[str, object]:
    return {
        "id": session.id,
        "name": session.original_name,
        "width": session.width,
        "height": session.height,
        "source_bits": session.source_bits,
        "working_bits": 32,
        "profile": session.color_profile,
        "analysis": session.analysis.to_dict(),
    }


@app.get("/api/session/{session_id}/original")
def original_preview(session_id: str) -> Response:
    session = _session_or_404(session_id)
    return Response(
        session.preview_jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.post("/api/session/{session_id}/preview")
def processed_preview(session_id: str, payload: dict[str, object]) -> Response:
    session = _session_or_404(session_id)
    settings = CorrectionSettings.from_mapping(payload)
    corrected = correct_image(session.preview, settings)
    return Response(
        encode_preview(corrected, quality=91),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/session/{session_id}/export")
def export(
    session_id: str,
    payload: dict[str, object],
    background_tasks: BackgroundTasks,
) -> FileResponse:
    session = _session_or_404(session_id)
    output_format = str(payload.pop("format", "jpeg")).lower()
    quality = int(payload.pop("quality", 95))
    if output_format not in {"jpeg", "png", "tiff"}:
        raise HTTPException(400, "Export format must be JPEG, PNG, or TIFF.")
    settings = CorrectionSettings.from_mapping(payload)

    try:
        decoded = read_image(session.path)
        corrected = correct_image(decoded.pixels, settings)
    except Exception as error:
        raise HTTPException(422, f"Could not process the full-resolution image: {error}") from error

    suffix = {"jpeg": ".jpg", "png": ".png", "tiff": ".tif"}[output_format]
    stem = Path(session.original_name).stem
    output_dir = Path(tempfile.mkdtemp(prefix="reeftone_export_"))
    output_path = output_dir / f"{stem}_reeftone{suffix}"
    export_image(
        corrected,
        output_path,
        output_format,
        quality,
        decoded.icc_profile,
        decoded.exif,
    )
    background_tasks.add_task(shutil.rmtree, output_dir, ignore_errors=True)
    media_type = mimetypes.guess_type(output_path.name)[0] or "application/octet-stream"
    return FileResponse(output_path, media_type=media_type, filename=output_path.name)
