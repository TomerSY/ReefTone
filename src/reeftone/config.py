"""Typed settings and curated starting points for the correction engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Any

LEVEL_CHANNELS = ("rgb", "red", "green", "blue")
LEVEL_POINTS = ("black", "shadows", "midtone", "highlights", "white")
LEVEL_DEFAULTS = (0.0, 0.25, 0.5, 0.75, 1.0)


@dataclass(slots=True)
class CorrectionSettings:
    """All controls use stable, UI-friendly ranges and are safe to serialize."""

    master: float = 1.0
    auto_restore: float = 0.90
    red_recovery: float = 0.95
    green_correction: float = 0.0
    blue_balance: float = 0.24
    dehaze: float = 0.38
    temperature: float = 0.04
    tint: float = 0.01
    exposure: float = 0.0
    contrast: float = 0.22
    black_point: float = 0.08
    white_point: float = 0.04
    highlights: float = -0.14
    shadows: float = 0.10
    saturation: float = 0.05
    vibrance: float = 0.22
    clarity: float = 0.16
    denoise: float = 0.03
    sharpen_amount: float = 0.0
    sharpen_radius: float = 1.0
    sharpen_threshold: float = 0.02
    sample_red: float = 0.0
    sample_green: float = 0.0
    sample_blue: float = 0.0
    sample_strength: float = 0.0
    levels_rgb_black: float = 0.0
    levels_rgb_shadows: float = 0.25
    levels_rgb_midtone: float = 0.5
    levels_rgb_highlights: float = 0.75
    levels_rgb_white: float = 1.0
    levels_red_black: float = 0.0
    levels_red_shadows: float = 0.25
    levels_red_midtone: float = 0.5
    levels_red_highlights: float = 0.75
    levels_red_white: float = 1.0
    levels_green_black: float = 0.0
    levels_green_shadows: float = 0.25
    levels_green_midtone: float = 0.5
    levels_green_highlights: float = 0.75
    levels_green_white: float = 1.0
    levels_blue_black: float = 0.0
    levels_blue_shadows: float = 0.25
    levels_blue_midtone: float = 0.5
    levels_blue_highlights: float = 0.75
    levels_blue_white: float = 1.0

    RANGES = {
        "master": (0.0, 1.0),
        "auto_restore": (0.0, 1.0),
        "red_recovery": (0.0, 1.5),
        "green_correction": (-1.0, 1.0),
        "blue_balance": (-1.0, 1.0),
        "dehaze": (0.0, 1.0),
        "temperature": (-1.0, 1.0),
        "tint": (-1.0, 1.0),
        "exposure": (-2.0, 2.0),
        "contrast": (-0.5, 0.8),
        "black_point": (-0.5, 0.5),
        "white_point": (-0.5, 0.5),
        "highlights": (-1.0, 1.0),
        "shadows": (-1.0, 1.0),
        "saturation": (-1.0, 1.0),
        "vibrance": (-1.0, 1.0),
        "clarity": (-1.0, 1.0),
        "denoise": (0.0, 1.0),
        "sharpen_amount": (0.0, 2.0),
        "sharpen_radius": (0.3, 5.0),
        "sharpen_threshold": (0.0, 0.2),
        "sample_red": (0.0, 1.0),
        "sample_green": (0.0, 1.0),
        "sample_blue": (0.0, 1.0),
        "sample_strength": (0.0, 1.0),
        **{
            f"levels_{channel}_{point}": (0.0, 1.0)
            for channel in LEVEL_CHANNELS
            for point in LEVEL_POINTS
        },
    }

    @classmethod
    def from_mapping(cls, values: dict[str, Any] | None) -> CorrectionSettings:
        values = values or {}
        allowed = {field.name for field in fields(cls)}
        clean: dict[str, float] = {}
        for key, value in values.items():
            if key not in allowed:
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            low, high = cls.RANGES[key]
            clean[key] = min(high, max(low, number))
        settings = cls(**clean)
        for channel in LEVEL_CHANNELS:
            for point, value in zip(LEVEL_POINTS, settings.level_points(channel), strict=True):
                setattr(settings, f"levels_{channel}_{point}", value)
        return settings

    def to_dict(self) -> dict[str, float]:
        return asdict(self)

    def level_points(self, channel: str) -> tuple[float, float, float, float, float]:
        """Return a safe non-decreasing five-point curve for a supported channel."""

        if channel not in LEVEL_CHANNELS:
            raise ValueError(f"Unsupported levels channel: {channel}")
        values: list[float] = []
        previous = 0.0
        for point in LEVEL_POINTS:
            value = min(1.0, max(0.0, float(getattr(self, f"levels_{channel}_{point}"))))
            value = max(previous, value)
            values.append(value)
            previous = value
        return values[0], values[1], values[2], values[3], values[4]


PRESETS: dict[str, CorrectionSettings] = {
    "natural": CorrectionSettings(),
    "vivid": CorrectionSettings(
        auto_restore=0.96,
        red_recovery=1.05,
        blue_balance=0.05,
        dehaze=0.58,
        temperature=0.06,
        exposure=0.08,
        contrast=0.30,
        black_point=0.13,
        white_point=0.06,
        highlights=-0.18,
        shadows=0.14,
        saturation=0.28,
        vibrance=0.55,
        clarity=0.25,
    ),
    "deep": CorrectionSettings(
        auto_restore=1.0,
        red_recovery=1.30,
        blue_balance=0.58,
        dehaze=0.68,
        temperature=0.12,
        tint=0.05,
        exposure=0.10,
        contrast=0.34,
        black_point=0.14,
        white_point=0.08,
        highlights=-0.24,
        shadows=0.22,
        saturation=0.08,
        vibrance=0.30,
        clarity=0.30,
        denoise=0.08,
    ),
    "gentle": CorrectionSettings(
        master=0.62,
        auto_restore=0.58,
        red_recovery=0.48,
        blue_balance=0.08,
        dehaze=0.10,
        temperature=0.02,
        contrast=0.06,
        black_point=0.01,
        white_point=0.0,
        highlights=-0.05,
        shadows=0.06,
        saturation=0.0,
        vibrance=0.07,
        clarity=0.03,
        denoise=0.06,
    ),
    "dramatic": CorrectionSettings(
        auto_restore=1.0,
        red_recovery=1.15,
        blue_balance=0.05,
        dehaze=0.82,
        temperature=0.16,
        tint=0.07,
        exposure=-0.12,
        contrast=0.48,
        black_point=0.18,
        white_point=0.10,
        highlights=-0.42,
        shadows=0.02,
        saturation=-0.02,
        vibrance=0.34,
        clarity=0.42,
        denoise=0.03,
    ),
}
