# ReefTone Web Alpha

This is ReefTone's browser-local product track. It is intentionally separate from
the Python editor so the existing, validated image pipeline remains stable while
the public experience is built in small, testable releases.

## Alpha scope

Available now:

- local JPEG and PNG opening by file picker or drag-and-drop
- reliable Canvas 2D preview with local underwater scene analysis
- Natural, Vivid, Deep water, Gentle, and Dramatic looks
- the canonical desktop UI tokens, typography, toolbar, inspector order, labels,
  control shapes, disabled states, exact 1.5× text/icon scale, and responsive
  breakpoints, imported directly from the desktop stylesheet
- the full Python settings contract: Light, four-channel five-point Levels,
  Auto Restore, White Balance including Green correction, Presence, and Overall Mix
- per-setting reset and bypass, undo/redo, copied edits, and a neutral eyedropper
- channel-group Levels reset/bypass, monotonic pointer and keyboard markers, and
  the same RGB → Red → Green → Blue float curve order in preview and export
- output-neutral thresholded unsharp-mask Sharpening with Amount, Radius, and
  Threshold in preview and full-resolution worker export
- whole-image Before/After by default, explicit opt-in Swipe comparison, plus
  25-point focal magnifier zoom and drag-to-pan
- a loaded photo stays visible beneath the header while its controls scroll on
  mobile devices
- desktop browsers use a dedicated two-column editor with the image workspace
  sticky on the left and the full settings panel scrolling on the right
- mobile editing prioritizes the photo with a shorter header, a larger sticky
  preview, no floating color-information card or preview metadata, and a visible
  whole-image Before/After button beside the horizontally scrollable looks
- mobile adjustment rows keep each label and reset/bypass actions at the sides
  while centering the value above the slider, with moderately tighter
  section/control spacing; the look and comparison boxes are slimmer without
  shrinking their text
- Sharpening is presented as a standard unboxed subsection using the same
  heading hierarchy as the rest of Presence
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
- TIFF or 10-bit export
- the desktop local-folder library and other service-dependent actions

The app keeps these controls in their desktop locations but visibly disables them
with concise capability text. An unsupported image is never silently converted or
presented as profile-preserving. JPEG and PNG remain the only enabled inputs and
outputs. Full-resolution export additionally requires worker `OffscreenCanvas`
and is reported as unavailable when the browser does not provide it.

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
presets, balance naming, Green correction, Levels and Sharpening contracts,
scene-analysis concepts, and processing order. The web build imports the checked-in
desktop stylesheet directly, with a small web-only layer for the Canvas renderer
and unavailable capabilities. Expensive OpenCV
operations—especially CLAHE and multiscale pyramid fusion—are represented by a
lighter browser approximation, so this is still not a claim of pixel parity.
The next technical milestone is to move a shared, color-managed image core into
WebAssembly so both products use identical processing and reference tests.

HEIC, ICC/P3, and HDR will only be enabled when decode, working-space conversion,
metadata behavior, and output tagging can be verified end to end.
