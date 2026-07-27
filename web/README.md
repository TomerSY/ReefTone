# ReefTone Web Alpha

This is ReefTone's browser-local product track. It is intentionally separate from
the Python editor so the existing, validated image pipeline remains stable while
the public experience is built in small, testable releases.

## Alpha scope

Available now:

- local JPEG and PNG opening by file picker or drag-and-drop
- reliable Canvas 2D preview with local underwater scene analysis
- Natural, Vivid, Deep water, Gentle, and Dramatic looks
- the full Python settings contract: Light, Auto Restore, White Balance,
  Presence, and Overall Mix
- per-setting reset and bypass, undo/redo, copied edits, and a neutral eyedropper
- swipe or whole-image comparison plus magnifier zoom and drag-to-pan
- full-resolution JPEG or PNG export in a Web Worker
- installable PWA metadata and a small offline application shell
- browser capability reporting for WebGPU, Display P3, HDR displays,
  OffscreenCanvas, and WebAssembly

Not available in this alpha:

- HEIC/HEIF decode
- embedded ICC or EXIF preservation
- Display P3 or HDR working/output spaces
- exact parity with the Python correction pipeline
- video processing

The app labels these limitations in the interface. An unsupported image is never
silently converted or presented as profile-preserving.

## Privacy model

There is no photo upload endpoint. The browser decodes the selected file in local
memory, the preview runs on the device, and export creates a local download. The
static application can therefore be hosted at negligible cost without storing
users' photographs.

## Develop

Requires Node.js 22 or newer and pnpm 11.

```bash
cd web
pnpm install
pnpm test
pnpm dev
```

Create the production bundle with:

```bash
pnpm build
```

Vite writes the deployable static application to `web/dist/`.

## Architecture direction

The JavaScript correction now shares the Python editor's defaults, ranges,
presets, scene-analysis concepts, and processing order. Expensive OpenCV
operations—especially CLAHE and multiscale pyramid fusion—are represented by a
lighter browser approximation, so this is still not a claim of pixel parity.
The next technical milestone is to move a shared, color-managed image core into
WebAssembly so both products use identical processing and reference tests.

HEIC, ICC/P3, and HDR will only be enabled when decode, working-space conversion,
metadata behavior, and output tagging can be verified end to end.
