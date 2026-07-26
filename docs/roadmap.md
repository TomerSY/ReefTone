# Roadmap

## Phase 1 — still-image foundation (current)

- adaptive correction core
- HEIC/JPEG/PNG/TIFF input
- ICC/P3, transfer-function, HDR gain-map, and auxiliary-image detection
- profile-tagged previews and 10-bit HEIC / 16-bit TIFF export
- responsive local editor
- full-resolution export
- automated tests and sample validation

## Phase 2 — quality validation

- visual reference set across depths, water colors, cameras, and artificial lights
- perceptual and no-reference quality metrics
- selectable subject masks for divers, reef, and open water
- native gain-map/ISO-HDR expansion into an unclamped linear working space
- HDR-safe correction operators and new 10-bit HDR HEIF generation
- true deep-color decode-path validation across HEIC producers

## Phase 3 — 10-bit video

- FFmpeg/PyAV ingestion for HEVC, H.264, ProRes, HDR10, and HLG
- temporal gain stabilization and scene-cut handling
- proxy generation for responsive preview
- range, primaries, matrix, and transfer metadata preservation
- hardware encode where available
- frame queue with cancellation and progress reporting

## Phase 4 — public web product

- isolated object storage with short retention
- queued GPU/CPU jobs and resumable uploads
- authenticated project history
- signed download links
- privacy policy, deletion controls, and resource limits
- WebGL comparison preview and mobile touch refinements
