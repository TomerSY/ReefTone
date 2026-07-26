# Correction algorithm

## Design goals

Underwater restoration is an ill-posed problem: wavelength absorption depends on
depth, distance, turbidity, lighting, and camera response. ReefTone therefore avoids
a fixed “add red” filter. It estimates the scene, gates automatic correction by
confidence, and exposes every high-level artistic control.

The same deterministic function is used for preview and export.

## Pipeline

```text
Decode + orient
      ↓
RGB float32 [0, 1]
      ↓
Robust scene analysis
      ↓
Wavelength compensation
      ↓
Confidence-gated white balance
      ↓
Edge-aware local contrast
      ↓
Tone → color → detail
      ↓
Non-destructive master mix
```

### 1. Robust analysis

The image is sampled to at most 512 px on its long edge. Near-black and clipped
pixels are excluded, then 5th/95th percentile trimming reduces the influence of
lamps, bubbles, and specular highlights.

From the remaining channel distribution, ReefTone estimates:

- red attenuation relative to green;
- cyan cast;
- low dynamic range (a practical haze proxy);
- low-light severity;
- confidence that the scene needs underwater-specific correction.

### 2. Wavelength compensation

Red is restored in proportion to the robust green-red gap and attenuated as a pixel
approaches clipping:

```text
R' = R + strength × attenuation × (Ḡ - R̄) × (1 - R)
```

This gives darker, red-depleted regions more recovery while protecting bright red
subjects. Blue compensation is independently controllable.

### 3. Adaptive white balance

The channel distribution is measured again after wavelength compensation, which
prevents red recovery and white balance from stacking the same correction twice.
The red target stays intentionally below green to preserve a believable blue water
column. Gain power is gated by both Auto Restore and underwater confidence, so a
weak or ambiguous scene is not forced to neutral gray.

### 4. Local contrast

CLAHE operates on CIE Lab luminance, but its result is blended through a soft
Laplacian edge weight. Textured reef structure receives useful separation while
smooth water gradients receive less amplification and are less likely to band.

### 5. Tone, color, and detail

- exposure is applied in stops;
- shadows and highlights use luminance masks;
- contrast pivots around middle gray;
- vibrance preferentially affects low-saturation colors;
- clarity is a mid-frequency unsharp mask;
- denoise is an edge-preserving bilateral blend.

### 6. Master mix

The final corrected result is blended with the untouched float source. This makes
the full pipeline non-destructive and gives the user a perceptually simple overall
strength control.

## Precision

All arithmetic is float32. Export quantizes only at the final encoder:

- JPEG: 8-bit RGB, quality control, 4:4:4 chroma
- PNG: 8-bit lossless RGB
- TIFF: 16-bit lossless RGB

## Known limitations

- The automatic model is statistical, not depth-map or learned restoration.
- Severely clipped red-channel information cannot be recreated as measured truth.
- Artificial colored lights may require manual temperature and tint changes.
- Display-referred HEIC correction is not a replacement for RAW development.
- Spatially varying water columns are handled conservatively; a future local-depth
  model can improve foreground/background separation.

## Video extension

`correct_image()` is frame-compatible, but video requires temporal engineering.
Analysis values and gains must be smoothed over time, with smoothing reset at scene
cuts. PQ/HLG input must be linearized before correction and returned to the desired
output transfer function. These requirements are tracked in
[the roadmap](roadmap.md).
