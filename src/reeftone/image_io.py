"""Color-aware image decoding, preview generation, and high-quality export."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pillow_heif
import tifffile
from numpy.typing import NDArray
from PIL import Image, ImageCms, ImageOps

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
    xmp: bytes | None = None
    format_name: str = "Unknown"
    color_primaries: str = "Unknown"
    transfer_function: str = "Unknown"
    dynamic_range: str = "SDR"
    has_hdr_gain_map: bool = False
    auxiliary_images: tuple[str, ...] = ()
    nclx_profile: dict[str, Any] | None = None
    working_profile: str = "Source profile"
    embedded_icc: bool = False

    def color_info(self) -> dict[str, object]:
        return {
            "format": self.format_name,
            "profile": self.color_profile,
            "primaries": self.color_primaries,
            "transfer": self.transfer_function,
            "working_profile": self.working_profile,
            "dynamic_range": self.dynamic_range,
            "bit_depth": self.source_bits,
            "hdr_gain_map": self.has_hdr_gain_map,
            "auxiliary_images": list(self.auxiliary_images),
            "preservation": {
                "icc_profile": self.embedded_icc,
                "exif": bool(self.exif),
                "xmp": bool(self.xmp),
                "hdr_gain_map": False,
            },
        }


def _icc_profile_name(profile: bytes | None, fallback: str) -> str:
    if not profile:
        return fallback
    try:
        parsed = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        return ImageCms.getProfileName(parsed).strip() or fallback
    except (OSError, TypeError, ValueError):
        return fallback


def _nclx_labels(profile: dict[str, Any] | None) -> tuple[str, str]:
    if not profile:
        return "Unknown", "Unknown"
    primaries = {
        1: "BT.709 / sRGB",
        9: "BT.2020",
        12: "Display P3 (D65)",
    }.get(int(profile.get("color_primaries", -1)), "Custom")
    transfer = {
        1: "BT.709",
        13: "sRGB",
        16: "PQ (ST 2084)",
        18: "HLG (BT.2100)",
    }.get(int(profile.get("transfer_characteristics", -1)), "Custom")
    return primaries, transfer


def _srgb_profile_bytes() -> bytes:
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    return profile.tobytes()


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
    source_frame = heif[0]
    info = {**heif.info, **source_frame.info}
    source_bits = int(source_frame.info.get("bit_depth", heif.info.get("bit_depth", 8)))
    source_icc_profile = info.get("icc_profile")
    nclx_profile = info.get("nclx_profile")
    nclx_primaries, nclx_transfer = _nclx_labels(nclx_profile)
    profile_name = _icc_profile_name(source_icc_profile, nclx_primaries)
    is_iso_hdr = nclx_transfer.startswith(("PQ", "HLG")) and source_bits >= 10

    # The current correction engine is display-referred. Decode ISO HDR through
    # libheif's SDR conversion instead of applying SDR operators directly to HLG/PQ
    # code values and then incorrectly retaining HDR tags.
    decoded_heif = (
        pillow_heif.open_heif(path, convert_hdr_to_8bit=True) if is_iso_hdr else heif
    )
    frame = decoded_heif[0]
    pixels = np.asarray(frame)
    if pixels.ndim != 3 or pixels.shape[2] < 3:
        raise ValueError("The HEIC primary image is not RGB")
    pixels = np.ascontiguousarray(pixels[..., :3])
    source_height, source_width = pixels.shape[:2]
    if max_side and max(source_width, source_height) > max_side:
        scale = max_side / max(source_width, source_height)
        pixels = cv2.resize(
            pixels,
            (max(1, round(source_width * scale)), max(1, round(source_height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    icc_profile = _srgb_profile_bytes() if is_iso_hdr else source_icc_profile
    aux = info.get("aux") or {}
    auxiliary_images = tuple(sorted(str(name) for name in aux))
    has_hdr_gain_map = any("gainmap" in name.lower() for name in auxiliary_images)
    dynamic_range = (
        "HDR gain map"
        if has_hdr_gain_map
        else "ISO HDR"
        if is_iso_hdr
        else "SDR"
    )
    if "display p3" in profile_name.lower():
        color_primaries = "Display P3 (D65)"
        transfer_function = "sRGB transfer curve"
    else:
        color_primaries = nclx_primaries
        transfer_function = nclx_transfer
    return DecodedImage(
        pixels=pixels,
        width=source_width,
        height=source_height,
        source_bits=source_bits,
        working_bits=32,
        color_profile=profile_name,
        icc_profile=icc_profile,
        exif=info.get("exif"),
        xmp=info.get("xmp"),
        format_name="HEIC" if path.suffix.lower() == ".heic" else "HEIF",
        color_primaries=color_primaries,
        transfer_function=transfer_function,
        dynamic_range=dynamic_range,
        has_hdr_gain_map=has_hdr_gain_map,
        auxiliary_images=auxiliary_images,
        nclx_profile=nclx_profile,
        working_profile="sRGB tone-mapped fallback" if is_iso_hdr else profile_name,
        embedded_icc=bool(source_icc_profile),
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
        xmp = info.get("xmp")
        color_profile = _icc_profile_name(icc_profile, "sRGB")
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
        xmp=xmp,
        format_name=path.suffix.lstrip(".").upper().replace("JPG", "JPEG"),
        color_primaries="Display P3 (D65)" if "display p3" in color_profile.lower() else "sRGB",
        transfer_function="sRGB transfer curve",
        working_profile=color_profile,
        embedded_icc=bool(icc_profile),
    )


def encode_preview(
    image: NDArray[np.float32],
    quality: int = 91,
    icc_profile: bytes | None = None,
) -> bytes:
    array = np.clip(image * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pil_image = Image.fromarray(array, mode="RGB")
    output = io.BytesIO()
    options: dict[str, object] = {}
    if icc_profile:
        options["icc_profile"] = icc_profile
    pil_image.save(
        output,
        format="JPEG",
        quality=quality,
        optimize=True,
        subsampling=1,
        **options,
    )
    return output.getvalue()


def export_image(
    image: NDArray[np.float32],
    destination: Path,
    output_format: str,
    quality: int = 95,
    icc_profile: bytes | None = None,
    exif: bytes | None = None,
    xmp: bytes | None = None,
    nclx_profile: dict[str, Any] | None = None,
) -> None:
    output_format = output_format.lower()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "tiff":
        array16 = np.clip(image * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
        extra_tags = []
        if icc_profile:
            extra_tags.append((34675, "B", len(icc_profile), icc_profile, False))
        tifffile.imwrite(
            destination,
            array16,
            photometric="rgb",
            compression="deflate",
            metadata={"axes": "YXS", "software": "ReefTone"},
            extratags=extra_tags,
        )
        return

    if output_format == "heic":
        array16 = np.ascontiguousarray(
            np.clip(image * 65535.0 + 0.5, 0, 65535).astype("<u2")
        )
        heif = pillow_heif.from_bytes(
            "RGB;16",
            (array16.shape[1], array16.shape[0]),
            array16.tobytes(),
        )
        if icc_profile:
            heif.info["icc_profile"] = icc_profile
        elif nclx_profile:
            heif.info["nclx_profile"] = nclx_profile
        if exif:
            heif.info["exif"] = exif
        if xmp:
            heif.info["xmp"] = xmp
        heif.save(
            destination,
            quality=max(70, min(100, quality)),
            chroma="444",
        )
        return

    array8 = np.clip(image * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pil_image = Image.fromarray(array8, mode="RGB")
    save_options: dict[str, object] = {}
    if icc_profile:
        save_options["icc_profile"] = icc_profile
    if exif:
        save_options["exif"] = exif
    if xmp:
        save_options["xmp"] = xmp
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
