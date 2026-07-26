"""Adaptive underwater restoration operating on RGB float arrays.

The engine intentionally has no web or file-I/O dependencies. The same function
can process a still image, a video frame, or a future GPU-backed frame buffer.
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


def _adaptive_white_balance(
    image: FloatImage,
    settings: CorrectionSettings,
    analysis: ImageAnalysis,
) -> FloatImage:
    means, _, _ = _robust_channel_stats(image)
    red_mean, green_mean, blue_mean = means

    # Physically motivated compensation: restore the channel absorbed first while
    # protecting already-bright reds from clipping.
    recovered = image.copy()
    red_gap = max(0.0, float(green_mean - red_mean))
    blue_gap = float(green_mean - blue_mean)
    red_amount = settings.red_recovery * (0.15 + analysis.red_loss * 0.45)
    recovered[..., 0] += red_gap * red_amount * (1.0 - recovered[..., 0]) * 1.05
    recovered[..., 2] += blue_gap * settings.blue_balance * (1.0 - recovered[..., 2]) * 0.65

    # Re-measure after wavelength compensation so the gray-world step does not
    # stack a second full red correction. Underwater water columns are expected to
    # remain somewhat blue; the red target is intentionally below green.
    recovered_means, _, _ = _robust_channel_stats(recovered)
    recovered_red, recovered_green, recovered_blue = recovered_means
    red_target = recovered_green * (0.70 + 0.10 * (1.0 - analysis.confidence))
    raw_gains = np.array(
        [
            np.clip(red_target / max(recovered_red, 1e-4), 0.72, 2.0),
            1.0,
            np.clip(recovered_green / max(recovered_blue, 1e-4), 0.75, 1.35),
        ],
        dtype=np.float32,
    )
    auto_power = settings.auto_restore * (0.12 + 0.42 * analysis.confidence)
    gains = np.power(raw_gains, auto_power, dtype=np.float32)
    recovered *= gains.reshape(1, 1, 3)

    # Artist controls use opposing channel curves and remain neutral at zero.
    warm = settings.temperature * 0.22
    tint = settings.tint * 0.16
    recovered[..., 0] *= 1.0 + warm + tint * 0.45
    recovered[..., 1] *= 1.0 - tint
    recovered[..., 2] *= 1.0 - warm + tint * 0.45
    return np.clip(recovered, 0.0, 1.0)


def _restore_local_contrast(image: FloatImage, amount: float) -> FloatImage:
    if amount <= 0.001:
        return image
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    luminance = np.clip(lab[..., 0] * (255.0 / 100.0), 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=1.1 + amount * 2.4, tileGridSize=(8, 8))
    enhanced = clahe.apply(luminance).astype(np.float32) * (100.0 / 255.0)
    lab[..., 0] = enhanced
    contrast_variant = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    # Edge-aware weight keeps CLAHE away from smooth open-water gradients.
    base_luma = _rgb_luma(image)
    edge = np.abs(cv2.Laplacian(base_luma, cv2.CV_32F, ksize=3))
    edge = cv2.GaussianBlur(edge, (0, 0), 2.0)
    edge /= float(np.percentile(edge, 95) + 1e-5)
    weight = np.clip(0.22 + edge * 0.78, 0.0, 1.0)[..., None] * amount
    return np.clip(image * (1.0 - weight) + contrast_variant * weight, 0.0, 1.0)


def _apply_tone(image: FloatImage, settings: CorrectionSettings) -> FloatImage:
    result = image * np.float32(2.0**settings.exposure)
    result = np.clip(result, 0.0, 1.0)

    luma = _rgb_luma(result)[..., None]
    if settings.shadows:
        shadow_mask = np.square(1.0 - luma)
        result += shadow_mask * settings.shadows * 0.42
    if settings.highlights:
        highlight_mask = np.square(luma)
        result += highlight_mask * settings.highlights * 0.30

    contrast_factor = 1.0 + settings.contrast
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
        high_pass = result - blurred
        result = result + high_pass * clarity * 1.35
    return np.clip(result, 0.0, 1.0)


def _spectral_attention_mask(image: FloatImage) -> NDArray[np.float32]:
    """Return a soft, center-aware visual-attention mask without a model download.

    Spectral residual saliency supplies image-specific structure, while the broad
    center prior fills subject interiors. This is intentionally a soft photographic
    mask rather than a claimed semantic segmentation.
    """

    height, width = image.shape[:2]
    scale = min(1.0, 512 / max(height, width))
    if scale < 1:
        sample = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        sample = image

    gray = _rgb_luma(sample)
    spectrum = np.fft.fft2(gray)
    log_amplitude = np.log(np.abs(spectrum) + 1e-6)
    residual = log_amplitude - cv2.blur(log_amplitude.astype(np.float32), (5, 5))
    reconstructed = np.fft.ifft2(np.exp(residual + 1j * np.angle(spectrum)))
    saliency = np.square(np.abs(reconstructed)).astype(np.float32)
    saliency = cv2.GaussianBlur(saliency, (0, 0), 4.5)
    low, high = np.percentile(saliency, [20, 99])
    saliency = np.clip((saliency - low) / max(high - low, 1e-6), 0, 1)
    saliency = cv2.dilate(saliency, np.ones((17, 17), np.uint8))
    saliency = cv2.GaussianBlur(saliency, (0, 0), 11)

    sample_height, sample_width = sample.shape[:2]
    yy, xx = np.mgrid[:sample_height, :sample_width].astype(np.float32)
    center = np.exp(
        -0.5
        * (
            np.square((xx / sample_width - 0.5) / 0.34)
            + np.square((yy / sample_height - 0.53) / 0.31)
        )
    ).astype(np.float32)

    lab = cv2.cvtColor(sample, cv2.COLOR_RGB2LAB)
    median = np.median(lab.reshape(-1, 3), axis=0)
    color_distance = np.linalg.norm((lab - median) / np.array([100, 128, 128]), axis=2)
    color_distance = np.clip(color_distance / (np.percentile(color_distance, 95) + 1e-6), 0, 1)

    attention = (0.50 * saliency + 0.28 * center + 0.22 * color_distance) * (0.58 + 0.42 * center)
    attention = cv2.GaussianBlur(attention.astype(np.float32), (0, 0), 7)
    low, high = np.percentile(attention, [35, 94])
    attention = np.clip((attention - low) / max(high - low, 1e-6), 0, 1)
    attention = np.power(attention, 0.72, dtype=np.float32)
    if attention.shape != (height, width):
        attention = cv2.resize(attention, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.clip(attention, 0, 1).astype(np.float32)


def _open_water_likelihood(image: FloatImage) -> NDArray[np.float32]:
    """Estimate smooth, blue-dominant open water at preview resolution."""

    height, width = image.shape[:2]
    scale = min(1.0, 512 / max(height, width))
    if scale < 1:
        sample = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        sample = image

    red, green, blue = (sample[..., channel] for channel in range(3))
    chroma = np.maximum(sample.max(axis=2) - sample.min(axis=2), 0)
    blue_score = np.clip((blue - red + 0.04) * 2.6, 0, 1) * np.clip(chroma * 2.2, 0, 1)
    local_detail = np.abs(cv2.Laplacian(_rgb_luma(sample), cv2.CV_32F, ksize=3))
    local_detail = cv2.GaussianBlur(local_detail, (0, 0), 2.4)
    detail_scale = np.percentile(local_detail, 88) + 1e-6
    smooth_water = np.square(1.0 - np.clip(local_detail / detail_scale, 0, 1))
    normalized_y = np.linspace(0, 1, sample.shape[0], dtype=np.float32)[:, None]
    upper_prior = np.clip(1.0 - normalized_y / 0.82, 0.08, 1.0)
    likelihood = blue_score * smooth_water * upper_prior
    if likelihood.shape != (height, width):
        likelihood = cv2.resize(likelihood, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.clip(likelihood, 0, 1).astype(np.float32)


def _apply_composition(
    image: FloatImage,
    source: FloatImage,
    settings: CorrectionSettings,
) -> FloatImage:
    if (
        max(
            settings.water_depth,
            settings.subject_focus,
            settings.background_depth,
            settings.top_gradient,
            settings.vignette,
        )
        <= 0.001
    ):
        return image

    height, width = image.shape[:2]
    attention = _spectral_attention_mask(source)
    open_water = _open_water_likelihood(source)
    result = image.copy()

    # Lift and warm the visual subject while darkening the surroundings. The soft
    # mask avoids cut-out edges. Blue water is protected from the background burn:
    # the reference style darkens reef surroundings much more than open water.
    focus = settings.subject_focus
    background = settings.background_depth
    background_mask = (1.0 - attention) * (1.0 - open_water * 0.82)
    exposure_map = attention * (0.36 * focus) - background_mask * (0.58 * background)
    result *= np.exp2(exposure_map)[..., None].astype(np.float32)
    result[..., 0] *= 1.0 + attention * focus * 0.60
    result[..., 1] *= 1.0 + attention * focus * 0.015
    result[..., 2] *= 1.0 - attention * focus * 0.05
    result[..., 0] *= 1.0 + (1.0 - attention) * background * 0.14

    # Lightroom-style aqua/blue mixing is more faithful than darkening all three
    # channels. Build a water variant from the source, then blend it only into
    # blue-dominant, low-attention areas. This retains natural water luminosity
    # while moving pale cyan toward a deeper blue.
    water_mask = open_water * (1.0 - attention * 0.62) * settings.water_depth
    water_blend = np.clip(water_mask * 4.0, 0, 1)
    inverse_water = 1.0 - water_blend
    red_variant = np.clip(
        source[..., 0] * 1.10 + np.maximum(source[..., 2] - source[..., 0], 0) * 0.018,
        0,
        1,
    )
    result[..., 0] = result[..., 0] * inverse_water + red_variant * water_blend
    result[..., 1] = result[..., 1] * inverse_water + source[..., 1] * 0.91 * water_blend
    result[..., 2] = result[..., 2] * inverse_water + source[..., 2] * 0.98 * water_blend

    normalized_y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    top_mask = np.square(np.clip(1.0 - normalized_y / 0.58, 0, 1)) * settings.top_gradient
    result *= np.exp2(-0.38 * top_mask)[..., None].astype(np.float32)
    result[..., 2] *= 1.0 + top_mask * 0.025

    # Feathered optical vignette with a higher midpoint than a simple corner burn.
    nx = (np.linspace(0, 1, width, dtype=np.float32)[None, :] - 0.5) / 0.72
    ny = (normalized_y - 0.5) / 0.72
    radius = np.sqrt(np.square(nx) + np.square(ny))
    edge = np.square(np.clip((radius - 0.34) / 0.66, 0, 1)) * settings.vignette
    result *= np.exp2(-0.52 * edge)[..., None].astype(np.float32)

    if focus > 0.01:
        blurred = cv2.GaussianBlur(result, (0, 0), 1.15)
        texture = (result - blurred) * (attention * focus * 0.34)[..., None]
        result += texture
    return np.clip(result, 0, 1)


def correct_image(
    image: NDArray[np.generic],
    settings: CorrectionSettings | None = None,
) -> FloatImage:
    """Apply adaptive correction and return an RGB float32 image in [0, 1]."""

    settings = settings or CorrectionSettings()
    original = _as_float_rgb(image)
    analysis = analyze_image(original)

    corrected = _adaptive_white_balance(original, settings, analysis)
    adaptive_dehaze = settings.dehaze * (0.45 + analysis.haze * 0.55)
    corrected = _restore_local_contrast(corrected, adaptive_dehaze)
    corrected = _apply_tone(corrected, settings)
    corrected = _apply_color(corrected, settings)
    corrected = _apply_composition(corrected, original, settings)
    corrected = _apply_detail(corrected, settings.clarity, settings.denoise)

    master = np.float32(settings.master)
    return np.clip(original * (1.0 - master) + corrected * master, 0.0, 1.0).astype(np.float32)
