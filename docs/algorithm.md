# Correction algorithm

## Design boundary

Underwater restoration is ill-posed: attenuation varies with wavelength, range,
water type, illumination, and camera response. ReefTone 0.3 uses a deterministic
single-image enhancement pipeline. It does not claim to recover physically measured
surface colors without range data.

This boundary matters. Akkaynak and Treibitz's physically revised underwater image
model shows that signal attenuation and backscatter are different, range-dependent
processes. Their Sea-thru method therefore uses RGBD/range data. ReefTone follows
the depth-free color-balance and fusion family instead of inventing a depth map.

## Research basis

The implementation is primarily based on:

- C. O. Ancuti et al., [Color Balance and Fusion for Underwater Image
  Enhancement](https://doi.org/10.1109/TIP.2017.2759252), IEEE TIP 2018:
  underwater red compensation, white balance, two derived inputs, perceptual weight
  maps, and multiscale fusion.
- A. Galdran et al., [Automatic Red-Channel Underwater Image
  Restoration](https://doi.org/10.1016/j.jvcir.2014.11.006), JVCIR 2015:
  the red-channel prior and the physical motivation for treating red loss
  differently from atmospheric haze.
- D. Akkaynak and T. Treibitz, [Sea-thru: A Method for Removing Water From
  Underwater Images](https://openaccess.thecvf.com/content_CVPR_2019/html/Akkaynak_Sea-Thru_A_Method_for_Removing_Water_From_Underwater_Images_CVPR_2019_paper.html),
  CVPR 2019: the correct physical limits of restoration without range.

## Pipeline

```text
Decode + orient → RGB float32
        ↓
Robust scene analysis
        ↓
Red compensation + adaptive gray-world balance
        ↓
Optional user-sampled neutral-point gains
        ↓
Color-balanced branch ─┐
Contrast/CLAHE branch ─┼→ Gaussian/Laplacian pyramid fusion
        ↓              ┘
Exposure → black/white points → tone curve
        ↓
Color → clarity/denoise → non-destructive master mix
```

The same `correct_image()` function is used for preview, full-resolution export,
and future video frames.

### 1. Robust analysis

The image is sampled to at most 512 pixels on its long edge. Near-black and clipped
pixels are excluded, then 5th/95th-percentile trimming limits the influence of
lamps, bubbles, and specular highlights. ReefTone estimates red attenuation, cyan
cast, low dynamic range, low light, and underwater confidence.

### 2. Underwater white balance

Red recovery follows the Ancuti-style compensation shape:

```text
R' = R + α(Ḡ - R̄)(1 - R)G
```

The green term restrains correction in dark water; `(1 - R)` protects existing warm
highlights. A blue-dominance weight protects saturated blue water from turning
magenta. After compensation, robust channel means are measured again and a
confidence-weighted gray-world gain brings red closer to green without forcing the
entire water column to neutral gray.

Temperature and tint are direct creative gains and remain neutral at zero.

### 3. Neutral-point eyedropper

The browser averages a small source-image patch at the chosen point and sends its
RGB values with the edit settings. The engine computes restrained geometric-gray
gains from that sample. This is deterministic, affects preview and export equally,
and can be cleared without changing the other controls.

### 4. Multiscale fusion

Two inputs are derived from the balanced image:

- a color-preserving branch with controlled chroma expansion;
- a CIE Lab luminance branch enhanced with CLAHE.

Each branch receives a weight map combining Laplacian contrast, saturation, and
well-exposedness. Gaussian pyramids soften the weights at every scale; Laplacian
image pyramids preserve useful edge structure. Reconstructing the weighted levels
avoids the seams and low-frequency halos of a direct pixel blend. **Fusion clarity**
controls how strongly the fused result replaces the balanced base.

### 5. Tone, points, color, and detail

- exposure is applied in stops;
- shadows and highlights use luminance masks;
- black point and white point remap the endpoints before contrast;
- contrast uses an exponential mid-gray pivot so small changes are visible;
- vibrance preferentially affects low-saturation colors;
- clarity is a mid-frequency unsharp mask;
- denoise is an edge-preserving bilateral blend.

### 6. Non-destructive controls

Every slider has two local actions:

- reset sets only that setting to its neutral value of zero;
- bypass sends zero for that setting while preserving its chosen value.

Preset values are intentionally separated, and the master mix blends the entire
corrected result with the untouched source.

## Precision and limitations

All processing arithmetic is float32. Export quantizes only in the encoder: JPEG
and PNG are 8-bit delivery formats, while TIFF is a 16-bit RGB master.

- Clipped or absent red-channel information cannot be recreated as measured truth.
- A neutral sample should be gray, white, or known-neutral; sampling colored coral
  intentionally creates the opposite color cast.
- Artificial lights may need manual temperature and tint.
- Display-referred HEIC correction is not RAW development.
- True range-dependent backscatter removal needs depth/range data.

## Video extension

The engine is frame-compatible. Video support still needs scene-cut detection,
temporal smoothing of analysis and gains, PQ/HLG linearization, and appropriate
10-bit output encoding. These requirements are tracked in
[the roadmap](roadmap.md).
