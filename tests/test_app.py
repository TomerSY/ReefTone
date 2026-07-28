import io

from fastapi.testclient import TestClient
from PIL import Image

import reeftone.app as app_module
from reeftone.app import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "0.5.0"


def test_presets() -> None:
    response = client.get("/api/presets")
    assert response.status_code == 200
    natural = response.json()["presets"]["natural"]
    assert natural["green_correction"] == 0
    assert natural["levels_rgb_midtone"] == 0.5


def test_home_loads_editor() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "ReefTone Studio" in response.text
    assert "Green correction" in response.text
    assert "Five-point tonal curve" in response.text
    assert "click the image +25%" in response.text
    assert 'class="icon-button close-dialog" type="button"' in response.text


def test_upload_preview_and_export(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(app_module, "CACHE_DIR", tmp_path / "cache")
    image_data = io.BytesIO()
    Image.new("RGB", (48, 32), (20, 110, 145)).save(image_data, format="JPEG")

    upload = client.post(
        "/api/upload",
        files={"file": ("small.jpg", image_data.getvalue(), "image/jpeg")},
    )
    assert upload.status_code == 200
    assert upload.json()["color"]["dynamic_range"] == "SDR"
    session_id = upload.json()["id"]

    preview = client.post(f"/api/session/{session_id}/preview", json={"red_recovery": 0.5})
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/jpeg"

    processed_settings = []
    original_correct_image = app_module.correct_image

    def record_settings(image, settings):
        processed_settings.append(settings)
        return original_correct_image(image, settings)

    monkeypatch.setattr(app_module, "correct_image", record_settings)
    exported = client.post(
        f"/api/session/{session_id}/export",
        json={
            "format": "jpeg",
            "quality": 90,
            "green_correction": 0.2,
            "levels_rgb_midtone": 0.6,
        },
    )
    assert exported.status_code == 200
    assert exported.content.startswith(b"\xff\xd8")
    assert processed_settings[0].green_correction == 0.2
    assert processed_settings[0].levels_rgb_midtone == 0.6

    heic = client.post(
        f"/api/session/{session_id}/export",
        json={"format": "heic", "quality": 90},
    )
    assert heic.status_code == 200
    assert b"ftyp" in heic.content[:32]
