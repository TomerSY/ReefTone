"""Color-aware image decoding, preview generation, and high-quality export."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import pillow_heif
import tifffile
from numpy.typing import NDArray
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

SUPPORTED_EXTENSIONS = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}


@dataclass(slots=True)
class DecodedImage:
    pixels: NDArray[np.generic]
    width: int
    height: int
    source_bits: int
    working_bits: int
    color_profile: str
    icc_profile: bytes | None = None
    exif: bytes | None = None


def _infer_source_bits(image: Image.Image) -> int:
    if image.mode in {"I;16", "I;16B", "I;16L"}:
        return 16
    return 8


def pixels_to_float(pixels: NDArray[np.generic], source_bits: int = 8) -> NDArray[np.float32]:
    """Normalize decoded integer pixels without discarding high-bit-depth values."""

    if pixels.dtype == np.uint8:
        peak = 255.0
    elif pixels.dtype == np.uint16:
        # libheif commonly returns 10/12-bit values expanded across a 16-bit word.
        # Full-word normalization handles that representation and native 16-bit TIFF.
        peak = (
            65535.0
            if int(pixels.max(initial=0)) > (2**source_bits - 1)
            else float(2**source_bits - 1)
        )
    else:
        return np.clip(pixels.astype(np.float32), 0, 1)
    return np.clip(pixels.astype(np.float32) / np.float32(peak), 0, 1)


def _read_heif(path: Path, max_side: int | None) -> DecodedImage:
    heif = pillow_heif.open_heif(path, convert_hdr_to_8bit=False)
    frame = heif[0]
    pixels = np.asarray(frame)
    if pixels.ndim != 3 or pixels.shape[2] < 3:
        raise ValueError("The HEIC primary image is not RGB")
    pixels = np.ascontiguousarray(pixels[..., :3])
    source_height, source_width = pixels.shape[:2]
    source_bits = int(frame.info.get("bit_depth", heif.info.get("bit_depth", 8)))
    if max_side and max(source_width, source_height) > max_side:
        scale = max_side / max(source_width, source_height)
        pixels = cv2.resize(
            pixels,
            (max(1, round(source_width * scale)), max(1, round(source_height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    info = {**heif.info, **frame.info}
    icc_profile = info.get("icc_profile")
    return DecodedImage(
        pixels=pixels,
        width=source_width,
        height=source_height,
        source_bits=source_bits,
        working_bits=32,
        color_profile="Embedded ICC" if icc_profile else "Display P3",
        icc_profile=icc_profile,
        exif=info.get("exif"),
    )


def read_image(path: str | Path, max_side: int | None = None) -> DecodedImage:
    path = Path(path)
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported image format: {path.suffix or 'unknown'}")
    if path.suffix.lower() in {".heic", ".heif"}:
        return _read_heif(path, max_side)

    with Image.open(path) as source:
        source.load()
        source_bits = _infer_source_bits(source)
        source = ImageOps.exif_transpose(source)
        info = dict(source.info)
        icc_profile = info.get("icc_profile")
        exif = info.get("exif")
        color_profile = "Embedded ICC" if icc_profile else "sRGB"
        source_width, source_height = source.size
        if max_side:
            source.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        rgb = source.convert("RGB")
        pixels = np.asarray(rgb).copy()

    return DecodedImage(
        pixels=pixels,
        width=source_width,
        height=source_height,
        source_bits=source_bits,
        working_bits=32,
        color_profile=color_profile,
        icc_profile=icc_profile,
        exif=exif,
    )


def encode_preview(image: NDArray[np.float32], quality: int = 91) -> bytes:
    array = np.clip(image * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pil_image = Image.fromarray(array, mode="RGB")
    output = io.BytesIO()
    pil_image.save(output, format="JPEG", quality=quality, optimize=True, subsampling=1)
    return output.getvalue()


def export_image(
    image: NDArray[np.float32],
    destination: Path,
    output_format: str,
    quality: int = 95,
    icc_profile: bytes | None = None,
    exif: bytes | None = None,
) -> None:
    output_format = output_format.lower()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "tiff":
        array16 = np.clip(image * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
        tifffile.imwrite(
            destination,
            array16,
            photometric="rgb",
            compression="deflate",
            metadata={"axes": "YXS", "software": "ReefTone"},
        )
        return

    array8 = np.clip(image * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pil_image = Image.fromarray(array8, mode="RGB")
    save_options: dict[str, object] = {}
    if icc_profile:
        save_options["icc_profile"] = icc_profile
    if exif:
        save_options["exif"] = exif
    if output_format == "png":
        pil_image.save(destination, format="PNG", optimize=True, **save_options)
    elif output_format == "jpeg":
        pil_image.save(
            destination,
            format="JPEG",
            quality=max(70, min(100, quality)),
            optimize=True,
            subsampling=0,
            **save_options,
        )
    else:
        raise ValueError(f"Unsupported export format: {output_format}")


def resize_for_preview(image: NDArray[np.generic], max_side: int = 1800) -> NDArray[np.generic]:
    height, width = image.shape[:2]
    scale = min(1.0, max_side / max(width, height))
    if scale >= 1.0:
        return image
    return cv2.resize(
        image,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
