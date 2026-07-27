# Changelog

All notable ReefTone changes are recorded here. The project follows
[Semantic Versioning](https://semver.org/): major versions may break compatibility,
minor versions add functionality, and patch versions contain compatible fixes or
small refinements.

## [Unreleased]

### Added

- Separate browser-local PWA alpha in `web/`
- WebGPU photo preview with a Canvas 2D fallback
- On-device JPEG/PNG opening, adjustments, comparison, and full-resolution export
- Browser capability reporting for GPU, Display P3, HDR display, OffscreenCanvas,
  and WebAssembly support
- Automated web color-math tests and production build validation

### Planned

- Native HDR gain-map editing and reconstruction
- Transfer-function-aware HLG and PQ processing
- Temporally stable HEVC video correction
- Shared color-managed WebAssembly core for Python/web algorithm parity

## [0.4.1] - 2026-07-26

### Added

- Point-centered magnifier zoom in 10% increments
- Right-click reverse zoom and drag-to-pan for enlarged images
- Collapsible color-space information below the look presets

### Changed

- Magnifier and neutral-point eyedropper modes are now mutually exclusive
- Color-space details no longer consume adjustment-panel space

## [0.4.0] - 2026-07-26

### Added

- ICC, Display P3, HDR gain-map, transfer-function, bit-depth, and HEIF auxiliary
  image detection
- Profile-aware previews and 10-bit HEIC export
- 16-bit TIFF export with embedded ICC metadata
- Fit, 1:2, 1:1, Fill, and 2:1 preview modes
- Temporary copied-settings cards
- Separate swipe and whole-image before/after modes

### Safety

- ISO HLG/PQ sources are converted to a safe SDR working copy before the current
  display-referred corrections
- Edited exports are never falsely tagged as HDR
- Apple HDR gain maps are detected and reported but not copied unchanged onto
  modified pixels

## [0.3.0] - 2026-07-26

### Added

- Research-backed multiscale fusion
- Stronger underwater white balance and contrast controls
- Black and white point controls
- Neutral-point eyedropper
- Per-setting reset and temporary bypass controls
- Distinct Natural, Vivid, Deep water, Gentle, and Dramatic looks

### Removed

- Unreliable depth and focus controls

## [0.2.0] - 2026-07-26

### Added

- Reference-guided Dramatic correction based on the supplied before/after pair
- Warmer subject rendering, deeper blue water, stronger local contrast, and
  controlled detail enhancement

## [0.1.0] - 2026-07-26

### Added

- Initial Python underwater color-restoration pipeline
- HEIC/JPEG decode and full-resolution export
- Local FastAPI service and responsive editor
- Non-destructive sessions, presets, undo/redo, and before/after comparison

[Unreleased]: https://github.com/TomerSY/ReefTone/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/TomerSY/ReefTone/releases/tag/v0.4.1
[0.4.0]: https://github.com/TomerSY/ReefTone/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TomerSY/ReefTone/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TomerSY/ReefTone/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TomerSY/ReefTone/releases/tag/v0.1.0
