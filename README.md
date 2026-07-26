# ReefTone

ReefTone is a non-destructive underwater color-restoration studio. It combines an
adaptive Python image pipeline with a responsive local web interface, so it feels
like a focused desktop editor today and can grow into a hosted product later.

![Status](https://img.shields.io/badge/status-first%20working%20release-6ce0c4)
![Python](https://img.shields.io/badge/python-3.11%2B-3776ab)

## What is included

- HEIC/HEIF, JPEG, PNG, and TIFF input
- source bit-depth and embedded-profile detection
- float32 processing from decode through correction
- scene analysis for red attenuation, cyan cast, haze, and low light
- adaptive red recovery and confidence-gated white balance
- edge-aware local contrast, exposure, tone, vibrance, clarity, and denoise
- visual-attention focus, open-water color mixing, background depth, graduated
  top light, and optical vignette controls
- a real-time before/after editor with presets, undo/redo, drag-and-drop, and
  keyboard-accessible controls
- full-resolution JPEG, PNG, and 16-bit TIFF export
- a framework-independent processing core designed to be reused on video frames

Source photos remain exactly where they are and are ignored by Git. Uploaded images
are copied to a local, ignored cache. ReefTone never overwrites an original.

## Quick start

Requires Python 3.11 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
reeftone
```

Then open [http://127.0.0.1:8765](http://127.0.0.1:8765). On macOS, you can also
double-click `run.command` after the first setup.

The photos already in this folder appear as a private local library on the welcome
screen. You can also drag a file anywhere over the app.

## Recommended workflow

1. Open a photo and start with **Natural**. Use **Dramatic** for the deeper,
   Lightroom-inspired subject-and-background treatment.
2. Use the comparison divider to check skin, coral, and open-water gradients.
3. Adjust **Red recovery** before adding saturation. This restores missing balance
   more naturally than globally boosting color.
4. Use **Water clarity** sparingly on smooth open water.
5. Export a JPEG for sharing or a 16-bit TIFF as a high-quality editing master.

**Subject focus** uses a soft visual-attention estimate rather than claiming to
identify a turtle or diver semantically. It never replaces pixels or changes scene
geometry. Reduce it when the important subject is near an edge, or set it to zero
for a fully global edit.

Keyboard shortcuts:

- `⌘/Ctrl + Z`: undo
- `⇧ + ⌘/Ctrl + Z`: redo
- hold `\`: momentarily reveal the original
- arrow keys on the comparison divider: move it precisely

## Project structure

```text
src/reeftone/
  processor.py      Adaptive correction engine
  image_io.py       HEIC/JPEG decode and high-quality export
  config.py         Validated controls and presets
  app.py            Local FastAPI application
  session.py        Bounded, private preview sessions
  static/           Responsive editor UI
tests/               Unit and API tests
docs/                Architecture and roadmap
```

## Development

```bash
source .venv/bin/activate
pytest
ruff check .
```

For automatic reload while working on the interface:

```bash
uvicorn reeftone.app:app --reload --port 8765
```

## Color and precision notes

HEIC files are decoded with their orientation and embedded ICC metadata. ReefTone
records the source bit depth and performs every correction in float32. JPEG and PNG
exports are 8-bit delivery files; TIFF export is a 16-bit RGB master. Embedded ICC
and EXIF blocks are retained for JPEG/PNG when the source decoder exposes them.

The current release is display-referred: it is optimized for Apple HEIC and standard
JPEG photographs rather than camera RAW development. See
[the algorithm notes](docs/algorithm.md) for details and limitations. The measurements
behind the Dramatic look are recorded in
[the reference-style analysis](docs/reference-style-analysis.md).

## Video roadmap

The correction function already accepts a single RGB array with no UI or file-system
coupling. The video phase will add:

- FFmpeg-based HEVC/H.265 and HDR10 decode
- transfer-function-aware linearization (PQ, HLG, and SDR)
- temporal smoothing of analysis and gains to prevent flicker
- scene-change detection
- hardware-accelerated preview and encode
- audio, timing, and metadata passthrough

Video is intentionally not exposed in this first release; a still-image pipeline is
much easier to validate for color correctness before adding temporal behavior.

## License

MIT — see [LICENSE](LICENSE).
