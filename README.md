# ReefTone

ReefTone is a non-destructive underwater color-restoration studio. It combines an
adaptive Python image pipeline with a responsive local web interface, so it feels
like a focused desktop editor today and can grow into a hosted product later.

[![Release](https://img.shields.io/github/v/release/TomerSY/ReefTone?display_name=tag&color=6ce0c4)](https://github.com/TomerSY/ReefTone/releases/latest)
![Python](https://img.shields.io/badge/python-3.11%2B-3776ab)
[![License](https://img.shields.io/badge/license-MIT-8fa8a0)](LICENSE)

## What is included

- HEIC/HEIF, JPEG, PNG, and TIFF input
- base bit-depth, ICC/P3, transfer-function, HDR gain-map, and auxiliary-image detection
- float32 processing from decode through correction
- scene analysis for red attenuation, cyan cast, haze, and low light
- underwater red compensation, Green correction, and confidence-gated white balance
- research-backed multiscale fusion of color-balanced and contrast-enhanced inputs
- exposure, contrast, five-point RGB/channel Levels, tone, vibrance, clarity, and denoise
- a neutral-point eyedropper plus per-slider reset and non-destructive bypass
- a real-time before/after editor with distinct presets, undo/redo, drag-and-drop,
  and keyboard-accessible controls
- point-centered 25% magnifier zoom, fixed pixel-ratio views, and drag-to-pan
- collapsible source color-space and dynamic-range information
- full-resolution JPEG, PNG, and 16-bit TIFF export
- 10-bit HEIC export with source ICC, EXIF, and available XMP preservation
- format-specific color-fidelity guidance before export
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

Stop the local service with `Ctrl+C` or by closing its Terminal window. ReefTone
does not terminate on a browser `unload` event: browsers do not reliably distinguish
a deliberate close from a reload, crash, sleeping tab, or another still-open tab,
so automatic shutdown could interrupt an export.

The photos already in this folder appear as a private local library on the welcome
screen. You can also drag a file anywhere over the app.

## Recommended workflow

1. Open a photo and start with **Natural**. Use **Dramatic** for a warmer,
   darker, high-contrast treatment.
2. Use the comparison divider to check skin, coral, and open-water gradients.
3. Adjust **Red recovery** before adding saturation. This restores missing balance
   more naturally than globally boosting color.
4. Use **Green correction** when green dominates after red recovery, then refine
   tonal placement with the five Levels markers.
5. Use **Fusion clarity** to blend in the multiscale contrast branch.
6. Export a JPEG for sharing or a 16-bit TIFF as a high-quality editing master.

Use the eyedropper only on something that should be gray, white, or neutral.
ReefTone averages a small patch and balances it without changing any other slider.
The arrow beside a slider resets only that setting; the eye button temporarily
bypasses it while preserving the chosen value.

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
web/                 Browser-local PWA alpha
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

ReefTone follows Semantic Versioning. See the [changelog](CHANGELOG.md) for the
history and [release process](docs/releasing.md) for the version checklist and
commit conventions.

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
The exact desktop labels, layout tokens, and serialized setting behavior are the
reference for web parity in [the desktop UI contract](docs/desktop-ui-contract.md).

Apple gain-map HDR is now detected and reported separately from the SDR base.
ReefTone does not copy an unchanged gain map onto edited pixels or falsely tag an
SDR result as HDR. The exact preservation matrix and native HDR roadmap are in
[the color-management notes](docs/color-management.md).

## Browser-local web alpha

The new [`web/`](web/) workspace is the beginning of a free public edition that
does its image work on the user's device. The first alpha opens JPEG/PNG files,
renders a reliable local Canvas preview, and exports locally. It has no photo upload
endpoint and does not change the Python editor.

This alpha is a product and performance foundation, not yet a color-management
replacement for the Python app. HEIC, embedded metadata preservation, Display P3,
HDR output, algorithm parity, and video remain disabled until they can be
validated end to end. See the [web alpha notes](web/README.md) for its exact scope.

```bash
cd web
pnpm install
pnpm test
pnpm dev
```

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
