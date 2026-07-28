# Changelog

All notable ReefTone changes are recorded here. The project follows
[Semantic Versioning](https://semver.org/): major versions may break compatibility,
minor versions add functionality, and patch versions contain compatible fixes or
small refinements.

## [Unreleased]

### Added

- Separate browser-local PWA alpha in `web/`
- Reliable device-local Canvas photo preview
- On-device JPEG/PNG opening, adjustments, comparison, and full-resolution export
- Browser capability reporting for GPU, Display P3, HDR display, OffscreenCanvas,
  and WebAssembly support
- Automated web color-math tests and production build validation
- Web versions of the five curated looks and the full Light, Auto Restore,
  White Balance, and Presence control groups
- Per-setting reset and bypass, undo/redo, copied edits, neutral eyedropper,
  swipe/full-image comparison, magnifier zoom, and drag-to-pan
- Browser-side underwater scene analysis and the shared Python settings contract
- Web parity with the canonical desktop typography, spacing, toolbar, inspector,
  Levels graph, disabled states, and responsive breakpoints
- Browser Green balance and five-point RGB/Red/Green/Blue Levels in preview
  and full-resolution worker export
- Browser thresholded unsharp-mask Sharpening with Amount, Radius, Threshold,
  reset/bypass, undo/redo, copied edits, and worker-export parity

### Fixed

- Hosted assets now use the deployment platform's expected client bundle
- The corrected preview no longer uses the silent-failing WebGPU shader path;
  a reliable local Canvas renderer prevents black after-images
- Navigation now checks the network before an offline cache to prevent stale
  alpha releases from remaining visible after deployment
- Web magnifier focal zoom now follows the desktop 25-percentage-point step
- Unsupported web formats and color workflows remain visible in their desktop
  locations but are explicitly disabled instead of appearing functional
- Web balance labels now consistently read Red balance, Green balance, and Blue
  balance while preserving their serialized keys
- Web typography, icons, control geometry, stacking, and responsive breakpoints
  now consume the canonical desktop 1.5× stylesheet directly
- Whole-image Before/After is now the default web comparison mode; Swipe is an
  explicit accessible opt-in
- Loaded photos now remain sticky beneath the web app header at mobile widths,
  keeping the preview visible while adjustment controls scroll
- Mobile web editing now removes the floating Color information card and
  low-priority preview metadata, keeps Before/After visible beside the looks,
  reduces header space, and gives the photo a substantially larger sticky area
- Mobile adjustment labels, values, reset, and bypass actions now share one row
  above each slider; section/control spacing and top look boxes are moderately
  tighter while desktop geometry remains unchanged

### Planned

- Native HDR gain-map editing and reconstruction
- Transfer-function-aware HLG and PQ processing
- Temporally stable HEVC video correction
- Shared color-managed WebAssembly core for Python/web algorithm parity

## [0.6.0] - 2026-07-28

### Added

- Output-neutral, float32 unsharp-mask Sharpening in Presence with Amount,
  Radius, and Threshold controls
- Per-control and group reset/bypass, undo/redo, copied-settings, preview, API,
  session, and full-resolution export support for Sharpening
- Sharpening coverage for neutral output, radius behavior, threshold noise
  suppression, finite edge enhancement, clipping safety, and legacy settings

### Changed

- Visible underwater white-balance controls are now consistently named
  Red balance, Green balance, and Blue balance while their serialized keys and
  established adaptive processing remain backward compatible
- All desktop text and icon sizes, related control geometry, panel sizing, and
  responsive breakpoints now resolve at exactly 1.5× the previous canonical scale
- Whole-image Before/After is now the default comparison mode when a photo opens
  or adjustments reset; Swipe is an explicit opt-in and remains hidden until used
- The desktop UI/settings contract now records the exact 0.6.0 reference required
  for the subsequent web parity pass

## [0.5.0] - 2026-07-28

### Added

- Neutral-by-default Green correction beside Red recovery and Blue balance
- Five-point monotonic Levels for RGB, Red, Green, and Blue, with a histogram,
  channel reset/bypass, keyboard control, undo/redo, copied edits, and export parity
- A checked-in desktop UI/settings contract as the reference for web parity
- Representative identity, monotonicity, channel-isolation, and non-black
  image-math coverage

### Changed

- Point-centered magnifier steps now move in 25% increments

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

[Unreleased]: https://github.com/TomerSY/ReefTone/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/TomerSY/ReefTone/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/TomerSY/ReefTone/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/TomerSY/ReefTone/releases/tag/v0.4.1
[0.4.0]: https://github.com/TomerSY/ReefTone/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TomerSY/ReefTone/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TomerSY/ReefTone/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TomerSY/ReefTone/releases/tag/v0.1.0
