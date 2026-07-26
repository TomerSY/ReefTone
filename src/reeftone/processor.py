"""Adaptive, single-image underwater restoration on RGB float arrays.

The pipeline follows the color-compensation and multiscale-fusion family of
Ancuti et al. It deliberately avoids pretending to perform physical range-based
restoration: those methods need scene depth or calibrated range data.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from .config import CorrectionSettings

FloatImage = NDArray[np.float32]


@dataclass(frozen=True, slots=True)
class ImageAnalysis:
    red_loss: float
    cyan_cast: float
    haze: float
    low_light: float
    confidence: float
    label: str

    def to_dict(self) -> dict[str, float | str]:
        return {
            "red_loss": round(self.red_loss, 3),
            "cyan_cast": round(self.cyan_cast, 3),
            "haze": round(self.haze, 3),
            "low_light": round(self.low_light, 3),
            "confidence": round(self.confidence, 3),
            "label": self.label,
        }


def _rgb_luma(image: FloatImage) -> NDArray[np.float32]:
    return (
        image[..., 0] * np.float32(0.2126)
        + image[..., 1] * np.float32(0.7152)
        + image[..., 2] * np.float32(0.0722)
    )


def _sample_pixels(image: FloatImage, max_side: int = 512) -> FloatImage:
    height, width = image.shape[:2]
    scale = min(1.0, max_side / max(height, width))
    if scale < 1.0:
        image = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return image.reshape(-1, 3)


def _robust_channel_stats(image: FloatImage) -> tuple[NDArray[np.float32], float, float]:
    pixels = _sample_pixels(image)
    luma = pixels @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    valid = pixels[(luma > 0.025) & (luma < 0.975)]
    if len(valid) < 128:
        valid = pixels
    lower = np.percentile(valid, 5, axis=0)
    upper = np.percentile(valid, 95, axis=0)
    trimmed = np.clip(valid, lower, upper)
    means = trimmed.mean(axis=0, dtype=np.float64).astype(np.float32)
    p05, p95 = np.percentile(luma, [5, 95])
    return means, float(p05), float(p95)


def _as_float_rgb(image: NDArray[np.generic]) -> FloatImage:
    if image.ndim != 3 or image.shape[2] < 3:
        raise ValueError("Expected an RGB image with three channels")
    image = image[..., :3]
    if image.dtype == np.uint8:
        result = image.astype(np.float32) / np.float32(255.0)
    elif image.dtype == np.uint16:
        peak = 65535.0 if int(image.max(initial=0)) > 1023 else 1023.0
        result = image.astype(np.float32) / np.float32(peak)
    else:
        result = image.astype(np.float32)
    return np.ascontiguousarray(np.clip(result, 0.0, 1.0))


def analyze_image(image: FloatImage) -> ImageAnalysis:
    """Estimate degradation without assuming that every blue image is underwater."""

    image = _as_float_rgb(image)
    means, p05, p95 = _robust_channel_stats(image)
    red, green, blue = (float(value) for value in means)
    red_loss = float(np.clip((green - red) / max(green, 0.08), 0.0, 1.0))
    cyan_cast = float(np.clip(((green + blue) * 0.5 - red) / max(green + blue, 0.12), 0, 1))
    dynamic_range = p95 - p05
    haze = float(np.clip((0.58 - dynamic_range) / 0.48, 0.0, 1.0))
    low_light = float(np.clip((0.40 - (red + green + blue) / 3.0) / 0.34, 0.0, 1.0))
    confidence = float(np.clip(0.15 + red_loss * 0.62 + cyan_cast * 0.34, 0.0, 1.0))

    if confidence > 0.72:
        label = "Strong underwater cast"
    elif confidence > 0.42:
        label = "Moderate underwater cast"
    elif haze > 0.55:
        label = "Low-contrast water"
    else:
        label = "Light correction suggested"
    return ImageAnalysis(red_loss, cyan_cast, haze, low_light, confidence, label)


def _apply_sample_balance(image: FloatImage, settings: CorrectionSettings) -> FloatImage:
    """Neutralize a user-selected point, with restrained chromatic gains."""

    if settings.sample_strength <= 0.001:
        return image
    sample = np.array(
        [settings.sample_red, settings.sample_green, settings.sample_blue],
        dtype=np.float32,
    )
    if float(sample.max()) <= 0.001:
        return image
    neutral = float(np.exp(np.log(np.clip(sample, 1e-4, 1.0)).mean()))
    raw_gains = np.clip(neutral / np.maximum(sample, 1e-4), 0.32, 4.0)
    gains = np.power(raw_gains, settings.sample_strength * 0.92, dtype=np.float32)
    return np.clip(image * gains.reshape(1, 1, 3), 0.0, 1.0)


def _adaptive_white_balance(
    image: FloatImage,
    settings: CorrectionSettings,
    analysis: ImageAnalysis,
) -> FloatImage:
    """Underwater red compensation followed by a confidence-weighted gray world."""

    means, _, _ = _robust_channel_stats(image)
    red_mean, green_mean, blue_mean = (float(value) for value in means)
    recovered = image.copy()

    # Underwater-specific red compensation. The green term prevents the recovered
    # red from flooding dark water, while (1-R) protects existing warm highlights.
    red_gap = max(0.0, green_mean - red_mean)
    blue_water = np.clip((image[..., 2] - image[..., 1]) * 4.0, 0.0, 1.0)
    red_protection = 1.0 - blue_water * 0.72
    red_amount = settings.red_recovery * (0.42 + analysis.red_loss * 0.80)
    recovered[..., 0] += (
        red_gap
        * red_amount
        * (1.0 - recovered[..., 0])
        * recovered[..., 1]
        * red_protection
    )

    blue_gap = green_mean - blue_mean
    recovered[..., 2] += (
        blue_gap
        * settings.blue_balance
        * (1.0 - recovered[..., 2])
        * (0.35 + recovered[..., 1])
    )

    # Re-measure before the gray-world stage. The target remains slightly cool by
    # design, but is much closer to neutral than the previous pale-cyan result.
    balanced_means, _, _ = _robust_channel_stats(np.clip(recovered, 0.0, 1.0))
    balanced_red, balanced_green, balanced_blue = balanced_means
    red_target = balanced_green * (0.84 + 0.04 * analysis.confidence)
    raw_gains = np.array(
        [
            np.clip(red_target / max(float(balanced_red), 1e-4), 0.65, 2.8),
            1.0,
            np.clip(float(balanced_green) / max(float(balanced_blue), 1e-4), 0.66, 1.45),
        ],
        dtype=np.float32,
    )
    auto_power = settings.auto_restore * (0.30 + 0.50 * analysis.confidence)
    gains = np.power(raw_gains, auto_power, dtype=np.float32)
    recovered[..., 0] *= 1.0 + (gains[0] - 1.0) * red_protection
    recovered[..., 1] *= gains[1]
    recovered[..., 2] *= gains[2]

    # Direct artist controls remain neutral at zero and are intentionally visible.
    warm = settings.temperature * 0.28
    tint = settings.tint * 0.22
    recovered[..., 0] *= 1.0 + warm + tint * 0.48
    recovered[..., 1] *= 1.0 - tint
    recovered[..., 2] *= 1.0 - warm + tint * 0.34
    recovered = np.clip(recovered, 0.0, 1.0)
    return _apply_sample_balance(recovered, settings)


def _clahe_variant(image: FloatImage, amount: float) -> FloatImage:
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    luminance = np.clip(lab[..., 0] * 2.55, 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=1.35 + amount * 2.8, tileGridSize=(8, 8))
    lab[..., 0] = clahe.apply(luminance).astype(np.float32) / 2.55
    return np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0.0, 1.0)


def _fusion_weight(image: FloatImage) -> NDArray[np.float32]:
    luma = _rgb_luma(image)
    local_contrast = np.abs(cv2.Laplacian(luma, cv2.CV_32F, ksize=3))
    local_contrast = cv2.GaussianBlur(local_contrast, (0, 0), 0.8)
    saturation = np.std(image, axis=2, dtype=np.float32)
    exposedness = np.exp(-np.square(luma - 0.52) / (2 * 0.24**2)).astype(np.float32)
    return 0.08 + local_contrast * 1.7 + saturation * 0.9 + exposedness * 0.18


def _pyramid_fuse(
    first: FloatImage,
    second: FloatImage,
    first_weight: NDArray[np.float32],
    second_weight: NDArray[np.float32],
) -> FloatImage:
    """Blend two inputs with Gaussian weight and Laplacian image pyramids."""

    denominator = first_weight + second_weight + 1e-6
    weights = [first_weight / denominator, second_weight / denominator]
    images = [first, second]
    levels = max(1, min(5, int(np.log2(max(2, min(first.shape[:2])))) - 4))
    result_levels: list[FloatImage] = []
    image_pyramids: list[list[FloatImage]] = []
    weight_pyramids: list[list[NDArray[np.float32]]] = []

    for image, weight in zip(images, weights, strict=True):
        gaussian_images = [image]
        gaussian_weights = [weight]
        for _ in range(levels):
            gaussian_images.append(cv2.pyrDown(gaussian_images[-1]))
            gaussian_weights.append(cv2.pyrDown(gaussian_weights[-1]))
        laplacian = []
        for level in range(levels):
            size = (gaussian_images[level].shape[1], gaussian_images[level].shape[0])
            expanded = cv2.pyrUp(gaussian_images[level + 1], dstsize=size)
            laplacian.append(gaussian_images[level] - expanded)
        laplacian.append(gaussian_images[-1])
        image_pyramids.append(laplacian)
        weight_pyramids.append(gaussian_weights)

    for level in range(levels + 1):
        fused_level = np.zeros_like(image_pyramids[0][level])
        for image_index in range(2):
            weight = weight_pyramids[image_index][level][..., None]
            fused_level += image_pyramids[image_index][level] * weight
        result_levels.append(fused_level)

    result = result_levels[-1]
    for level in range(levels - 1, -1, -1):
        size = (result_levels[level].shape[1], result_levels[level].shape[0])
        result = cv2.pyrUp(result, dstsize=size) + result_levels[level]
    return np.clip(result, 0.0, 1.0)


def _multiscale_fusion(image: FloatImage, amount: float) -> FloatImage:
    """Fuse color-balanced and contrast-enhanced branches without halo seams."""

    if amount <= 0.001:
        return image
    contrast_variant = _clahe_variant(image, amount)
    luma = _rgb_luma(image)[..., None]
    color_variant = np.clip(luma + (image - luma) * (1.06 + amount * 0.16), 0.0, 1.0)
    fused = _pyramid_fuse(
        color_variant,
        contrast_variant,
        _fusion_weight(color_variant),
        _fusion_weight(contrast_variant),
    )
    strength = np.float32(np.clip(amount * 1.15, 0.0, 1.0))
    return np.clip(image * (1.0 - strength) + fused * strength, 0.0, 1.0)


def _apply_tone(image: FloatImage, settings: CorrectionSettings) -> FloatImage:
    result = np.clip(image * np.float32(2.0**settings.exposure), 0.0, 1.0)
    luma = _rgb_luma(result)[..., None]
    if settings.shadows:
        result += np.square(1.0 - luma) * settings.shadows * 0.42
    if settings.highlights:
        result += np.square(luma) * settings.highlights * 0.34

    low = settings.black_point * 0.28
    high = 1.0 - settings.white_point * 0.28
    if high - low < 0.18:
        high = low + 0.18
    result = (result - low) / (high - low)

    # Exponential scaling is perceptually clearer than a weak linear contrast.
    contrast_factor = np.float32(2.0 ** (settings.contrast * 1.65))
    result = (result - 0.5) * contrast_factor + 0.5
    return np.clip(result, 0.0, 1.0)


def _apply_color(image: FloatImage, settings: CorrectionSettings) -> FloatImage:
    luma = _rgb_luma(image)[..., None]
    chroma = image - luma
    saturation = np.max(image, axis=2, keepdims=True) - np.min(image, axis=2, keepdims=True)
    vibrance_mask = np.clip(1.0 - saturation * 1.8, 0.0, 1.0)
    factor = 1.0 + settings.saturation + settings.vibrance * vibrance_mask
    return np.clip(luma + chroma * factor, 0.0, 1.0)


def _apply_detail(image: FloatImage, clarity: float, denoise: float) -> FloatImage:
    result = image
    if denoise > 0.01:
        sigma = 0.45 + denoise * 1.8
        smooth = cv2.bilateralFilter(result, 5, sigmaColor=sigma * 0.08, sigmaSpace=sigma)
        result = result * (1.0 - denoise * 0.65) + smooth * (denoise * 0.65)
    if abs(clarity) > 0.005:
        blurred = cv2.GaussianBlur(result, (0, 0), 2.2)
        result += (result - blurred) * clarity * 1.45
    return np.clip(result, 0.0, 1.0)


def correct_image(
    image: NDArray[np.generic],
    settings: CorrectionSettings | None = None,
) -> FloatImage:
    """Apply adaptive correction and return an RGB float32 image in [0, 1]."""

    settings = settings or CorrectionSettings()
    original = _as_float_rgb(image)
    analysis = analyze_image(original)

    corrected = _adaptive_white_balance(original, settings, analysis)
    fusion_amount = settings.dehaze * (0.62 + analysis.haze * 0.38)
    corrected = _multiscale_fusion(corrected, fusion_amount)
    corrected = _apply_tone(corrected, settings)
    corrected = _apply_color(corrected, settings)
    corrected = _apply_detail(corrected, settings.clarity, settings.denoise)

    master = np.float32(settings.master)
    return np.clip(original * (1.0 - master) + corrected * master, 0.0, 1.0).astype(np.float32)
