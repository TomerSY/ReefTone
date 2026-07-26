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


def test_presets_are_independent_settings() -> None:
    assert set(PRESETS) == {"natural", "vivid", "deep", "gentle"}
    assert PRESETS["deep"].dehaze > PRESETS["gentle"].dehaze
