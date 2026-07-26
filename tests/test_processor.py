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


def test_dramatic_preset_builds_subject_background_separation() -> None:
    source = teal_test_image(160, 220)
    # Add a warm, textured central subject to exercise the soft attention mask.
    source[50:120, 70:155, 0] += 0.26
    source[50:120:2, 70:155:2, 1] += 0.12
    source = np.clip(source, 0, 1)
    result = correct_image(source, PRESETS["dramatic"])
    center = result[60:110, 85:140].mean()
    edge = np.concatenate(
        [
            result[:35].reshape(-1, 3),
            result[-35:].reshape(-1, 3),
            result[:, :35].reshape(-1, 3),
            result[:, -35:].reshape(-1, 3),
        ]
    ).mean()
    assert center > edge
    assert np.isfinite(result).all()
