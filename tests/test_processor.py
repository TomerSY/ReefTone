import numpy as np

from reeftone.config import PRESETS, CorrectionSettings
from reeftone.processor import analyze_image, correct_image


def teal_test_image(height: int = 120, width: int = 180) -> np.ndarray:
    y, x = np.mgrid[0:height, 0:width]
    gradient = (x / width * 0.22 + y / height * 0.16).astype(np.float32)
    image = np.empty((height, width, 3), dtype=np.float32)
    image[..., 0] = 0.07 + gradient * 0.35
    image[..., 1] = 0.27 + gradient * 0.72
    image[..., 2] = 0.31 + gradient * 0.65
    return np.clip(image, 0, 1)


def identity_settings(**overrides: float) -> CorrectionSettings:
    values = {
        "master": 1,
        "auto_restore": 0,
        "red_recovery": 0,
        "green_correction": 0,
        "blue_balance": 0,
        "dehaze": 0,
        "temperature": 0,
        "tint": 0,
        "exposure": 0,
        "contrast": 0,
        "black_point": 0,
        "white_point": 0,
        "highlights": 0,
        "shadows": 0,
        "saturation": 0,
        "vibrance": 0,
        "clarity": 0,
        "denoise": 0,
    }
    values.update(overrides)
    return CorrectionSettings(**values)


def test_analysis_detects_underwater_cast() -> None:
    analysis = analyze_image(teal_test_image())
    assert analysis.red_loss > 0.45
    assert analysis.confidence > 0.45
    assert "underwater" in analysis.label.lower()


def test_correction_recovers_red_without_changing_shape() -> None:
    source = teal_test_image()
    corrected = correct_image(source)
    assert corrected.shape == source.shape
    assert corrected.dtype == np.float32
    assert float(corrected.min()) >= 0
    assert float(corrected.max()) <= 1
    before_ratio = float(source[..., 0].mean() / source[..., 1].mean())
    after_ratio = float(corrected[..., 0].mean() / corrected[..., 1].mean())
    assert after_ratio > before_ratio * 1.25


def test_zero_master_is_identity() -> None:
    source = teal_test_image()
    result = correct_image(source, CorrectionSettings(master=0))
    np.testing.assert_allclose(result, source, atol=1e-6)


def test_accepts_uint8_input() -> None:
    source = (teal_test_image() * 255).astype(np.uint8)
    result = correct_image(source)
    assert result.dtype == np.float32
    assert result.shape == source.shape


def test_dramatic_preset_has_stronger_tonal_separation_than_gentle() -> None:
    source = teal_test_image(160, 220)
    source[50:120, 70:155, 0] += 0.26
    source[50:120:2, 70:155:2, 1] += 0.12
    source = np.clip(source, 0, 1)
    dramatic = correct_image(source, PRESETS["dramatic"])
    gentle = correct_image(source, PRESETS["gentle"])
    dramatic_range = np.percentile(dramatic, 95) - np.percentile(dramatic, 5)
    gentle_range = np.percentile(gentle, 95) - np.percentile(gentle, 5)
    assert dramatic_range > gentle_range
    assert np.mean(np.abs(dramatic - gentle)) > 0.05
    assert np.isfinite(dramatic).all()


def test_sampled_neutral_point_changes_channel_balance() -> None:
    source = teal_test_image()
    settings = CorrectionSettings(
        auto_restore=0,
        red_recovery=0,
        dehaze=0,
        contrast=0,
        black_point=0,
        white_point=0,
        highlights=0,
        shadows=0,
        saturation=0,
        vibrance=0,
        clarity=0,
        denoise=0,
        sample_red=0.2,
        sample_green=0.5,
        sample_blue=0.6,
        sample_strength=1,
    )
    corrected = correct_image(source, settings)
    before_ratio = float(source[..., 0].mean() / source[..., 1].mean())
    after_ratio = float(corrected[..., 0].mean() / corrected[..., 1].mean())
    assert after_ratio > before_ratio * 1.8


def test_green_correction_reduces_a_green_heavy_cast() -> None:
    source = np.full((24, 32, 3), [0.2, 0.7, 0.3], dtype=np.float32)
    corrected = correct_image(source, identity_settings(green_correction=1))
    assert float(corrected[..., 1].mean()) < float(source[..., 1].mean()) - 0.05
    np.testing.assert_allclose(corrected[..., 0], source[..., 0], atol=1e-6)
    np.testing.assert_allclose(corrected[..., 2], source[..., 2], atol=1e-6)


def test_neutral_levels_are_identity() -> None:
    source = teal_test_image()
    corrected = correct_image(source, identity_settings())
    np.testing.assert_allclose(corrected, source, atol=2e-6)


def test_levels_curve_is_monotonic_and_does_not_collapse_output() -> None:
    ramp = np.linspace(0.02, 0.98, 1024, dtype=np.float32)
    source = np.repeat(ramp[None, :, None], 3, axis=2)
    settings = identity_settings(
        levels_rgb_black=0.03,
        levels_rgb_shadows=0.18,
        levels_rgb_midtone=0.58,
        levels_rgb_highlights=0.86,
        levels_rgb_white=0.98,
    )
    corrected = correct_image(source, settings)
    assert float(corrected.min()) > 0
    assert np.all(np.diff(corrected[0, :, 0]) >= -1e-6)
    assert np.isfinite(corrected).all()


def test_per_channel_levels_only_change_the_selected_channel() -> None:
    source = teal_test_image()
    settings = identity_settings(
        levels_red_black=0.08,
        levels_red_shadows=0.34,
        levels_red_midtone=0.62,
        levels_red_highlights=0.82,
        levels_red_white=1,
    )
    corrected = correct_image(source, settings)
    assert np.mean(np.abs(corrected[..., 0] - source[..., 0])) > 0.02
    np.testing.assert_allclose(corrected[..., 1], source[..., 1], atol=2e-6)
    np.testing.assert_allclose(corrected[..., 2], source[..., 2], atol=2e-6)
