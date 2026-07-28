from reeftone.config import PRESETS, CorrectionSettings


def test_mapping_ignores_unknown_values_and_clamps_ranges() -> None:
    settings = CorrectionSettings.from_mapping(
        {
            "exposure": 100,
            "red_recovery": "-4",
            "contrast": "not-a-number",
            "unknown": 0.5,
        }
    )
    assert settings.exposure == 2.0
    assert settings.red_recovery == 0.0
    assert settings.contrast == CorrectionSettings().contrast
    assert not hasattr(settings, "unknown")


def test_levels_mapping_enforces_monotonic_control_points() -> None:
    settings = CorrectionSettings.from_mapping(
        {
            "levels_red_black": 0.6,
            "levels_red_shadows": 0.2,
            "levels_red_midtone": 0.4,
            "levels_red_highlights": 0.8,
            "levels_red_white": 0.7,
        }
    )
    assert settings.level_points("red") == (0.6, 0.6, 0.6, 0.8, 0.8)
    assert settings.to_dict()["green_correction"] == 0


def test_presets_are_independent_settings() -> None:
    assert set(PRESETS) == {"natural", "vivid", "deep", "gentle", "dramatic"}
    assert PRESETS["deep"].dehaze > PRESETS["gentle"].dehaze
    assert PRESETS["dramatic"].contrast > PRESETS["natural"].contrast
    assert PRESETS["dramatic"].black_point > PRESETS["natural"].black_point
    assert PRESETS["gentle"].master < PRESETS["natural"].master
    for preset in PRESETS.values():
        assert preset.green_correction == 0
        assert preset.level_points("rgb") == (0, 0.25, 0.5, 0.75, 1)
        assert preset.level_points("red") == (0, 0.25, 0.5, 0.75, 1)
        assert preset.level_points("green") == (0, 0.25, 0.5, 0.75, 1)
        assert preset.level_points("blue") == (0, 0.25, 0.5, 0.75, 1)
