"""Typed settings and curated starting points for the correction engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Any


@dataclass(slots=True)
class CorrectionSettings:
    """All controls use stable, UI-friendly ranges and are safe to serialize."""

    master: float = 1.0
    auto_restore: float = 0.82
    red_recovery: float = 0.78
    blue_balance: float = 0.35
    dehaze: float = 0.24
    temperature: float = 0.0
    tint: float = 0.0
    exposure: float = 0.0
    contrast: float = 0.08
    highlights: float = -0.08
    shadows: float = 0.12
    saturation: float = 0.04
    vibrance: float = 0.18
    clarity: float = 0.12
    denoise: float = 0.04

    RANGES = {
        "master": (0.0, 1.0),
        "auto_restore": (0.0, 1.0),
        "red_recovery": (0.0, 1.5),
        "blue_balance": (-1.0, 1.0),
        "dehaze": (0.0, 1.0),
        "temperature": (-1.0, 1.0),
        "tint": (-1.0, 1.0),
        "exposure": (-2.0, 2.0),
        "contrast": (-0.5, 0.8),
        "highlights": (-1.0, 1.0),
        "shadows": (-1.0, 1.0),
        "saturation": (-1.0, 1.0),
        "vibrance": (-1.0, 1.0),
        "clarity": (-1.0, 1.0),
        "denoise": (0.0, 1.0),
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
        return cls(**clean)

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


PRESETS: dict[str, CorrectionSettings] = {
    "natural": CorrectionSettings(),
    "vivid": CorrectionSettings(
        auto_restore=0.92,
        red_recovery=0.92,
        dehaze=0.34,
        contrast=0.16,
        shadows=0.16,
        saturation=0.12,
        vibrance=0.30,
        clarity=0.20,
    ),
    "deep": CorrectionSettings(
        auto_restore=1.0,
        red_recovery=1.08,
        blue_balance=0.50,
        dehaze=0.46,
        exposure=0.12,
        contrast=0.18,
        shadows=0.25,
        vibrance=0.24,
        clarity=0.22,
        denoise=0.10,
    ),
    "gentle": CorrectionSettings(
        master=0.72,
        auto_restore=0.70,
        red_recovery=0.62,
        dehaze=0.14,
        contrast=0.04,
        shadows=0.08,
        saturation=0.02,
        vibrance=0.10,
        clarity=0.05,
    ),
}
