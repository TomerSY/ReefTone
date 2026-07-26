from pathlib import Path

import numpy as np
from PIL import Image

from reeftone.image_io import export_image, pixels_to_float, read_image


def test_jpeg_round_trip(tmp_path: Path) -> None:
    source_path = tmp_path / "source.jpg"
    source = np.zeros((32, 48, 3), dtype=np.uint8)
    source[..., 1] = 130
    Image.fromarray(source).save(source_path, quality=95)

    decoded = read_image(source_path)
    assert decoded.pixels.shape == (32, 48, 3)
    assert decoded.source_bits == 8


def test_tiff_export_is_sixteen_bit(tmp_path: Path) -> None:
    destination = tmp_path / "master.tif"
    gradient = np.linspace(0, 1, 24 * 32 * 3, dtype=np.float32).reshape(24, 32, 3)
    export_image(gradient, destination, "tiff")

    with Image.open(destination) as exported:
        assert exported.size == (32, 24)
    assert destination.stat().st_size > 0


def test_ten_bit_pixels_keep_fractional_precision() -> None:
    source = np.array([[[0, 512, 1023]]], dtype=np.uint16)
    normalized = pixels_to_float(source, source_bits=10)
    np.testing.assert_allclose(normalized[0, 0], [0, 512 / 1023, 1], atol=1e-6)
