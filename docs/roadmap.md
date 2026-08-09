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
- desktop-matched 1.5× web interface plus Green balance, five-point Levels, and
  output-neutral thresholded Sharpening
- responsive desktop and mobile editing workspace
- browser capability detection and explicit format limitations
- shared settings contract and cross-runtime reference fixtures
- color-managed WebAssembly processing core
- HEIC/HEIF decode with verified ICC and metadata behavior
- safe Display P3 preview and export

## Phase 3 — quality, native HDR, and still-image HDR expansion

- visual reference set across depths, water colors, cameras, and artificial lights
- perceptual and no-reference quality metrics
- selectable subject masks for divers, reef, and open water
- stream and image inspection that identifies actual bit depth, transfer function,
  primaries, matrix, range, gain maps, and HDR metadata instead of inferring them
  from a filename or container extension
- native gain-map/ISO-HDR expansion into an unclamped linear working space
- HDR-safe correction operators and new 10-bit HDR HEIF generation
- true deep-color decode-path validation across HEIC producers
- optional SDR-to-HDR expansion for 8-bit photographs, using conservative
  highlight-aware inverse tone mapping with clipping, noise, and banding protection
- adaptive gain-map JPEG output with a carefully graded SDR base, plus validated
  ISO 21496-1, HEIF, and AVIF HDR paths where platform support permits
- explicit `SDR source / HDR expanded` labeling so creative expansion is never
  presented as recovered native HDR capture
- HDR and SDR-fallback validation on Instagram, iOS, Android, and common browsers

## Phase 4 — video and SDR-to-HDR expansion

- FFmpeg/PyAV ingestion for HEVC, H.264, ProRes, HDR10, and HLG
- codec-level probing of MP4 and other containers, including pixel format and
  bit depth, rather than treating `.mp4` as evidence of SDR or HDR
- temporal gain stabilization and scene-cut handling
- optional temporally stable expansion of 8-bit Rec.709 SDR footage into an HDR
  working timeline without claiming to restore clipped or unrecorded detail
- highlight-confidence controls, chroma-noise protection, debanding, and dithering
  designed for compressed action-camera and underwater footage
- proxy generation for responsive preview
- range, primaries, matrix, and transfer metadata preservation
- 10-bit HEVC Main10 HLG/PQ output with correct Rec.2020 signaling, an SDR preview,
  and a tone-mapped fallback rendition
- short-form social export validation, including Instagram Reels on HDR and SDR
  playback devices
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
