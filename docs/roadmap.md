# Roadmap

## Phase 1 — still-image foundation (complete)

- adaptive correction core
- HEIC/JPEG/PNG/TIFF input
- ICC/P3, transfer-function, HDR gain-map, and auxiliary-image detection
- profile-tagged previews and 10-bit HEIC / 16-bit TIFF export
- responsive local editor
- full-resolution export
- automated tests and sample validation

## Phase 2 — browser-local public alpha (current)

- static PWA with no image upload endpoint
- local JPEG/PNG decode, reliable Canvas preview, and worker-based export
- desktop-matched web interface plus Green balance and five-point Levels
- responsive desktop and mobile editing workspace
- browser capability detection and explicit format limitations
- shared settings contract and cross-runtime reference fixtures
- color-managed WebAssembly processing core
- HEIC/HEIF decode with verified ICC and metadata behavior
- safe Display P3 preview and export

## Phase 3 — quality and HDR validation

- visual reference set across depths, water colors, cameras, and artificial lights
- perceptual and no-reference quality metrics
- selectable subject masks for divers, reef, and open water
- native gain-map/ISO-HDR expansion into an unclamped linear working space
- HDR-safe correction operators and new 10-bit HDR HEIF generation
- true deep-color decode-path validation across HEIC producers

## Phase 4 — 10-bit video

- FFmpeg/PyAV ingestion for HEVC, H.264, ProRes, HDR10, and HLG
- temporal gain stabilization and scene-cut handling
- proxy generation for responsive preview
- range, primaries, matrix, and transfer metadata preservation
- hardware encode where available
- frame queue with cancellation and progress reporting

## Phase 5 — optional cloud services

The core public editor remains browser-local and free. Cloud features are optional
and only added where they provide value that cannot be delivered safely on-device.

- isolated object storage with short retention
- queued GPU/CPU jobs and resumable uploads
- authenticated project history
- signed download links
- privacy policy, deletion controls, and resource limits
- WebGL comparison preview and mobile touch refinements
