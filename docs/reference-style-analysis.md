# Reference style analysis

This analysis compares a supplied “before” screenshot with an AI-generated
“after” reference. It informed ReefTone's **Dramatic** preset.

## Important limitation

The after image is a generated reinterpretation, not a pixel-faithful Lightroom
render. It has the same aspect ratio and scene layout, but fine coral and turtle
textures move or change. No deterministic photographic transform can reproduce
those invented details exactly.

ReefTone instead recreates the reproducible photographic intent while preserving
the source geometry and every real detail.

## Measured behavior

Measurements use OpenCV Lab luminance (`L`, encoded 0–255) and normalized scene
regions. Region boundaries are approximate because the generated image is not
perfectly registered.

| Region | Before mean L | After mean L | Change | Edge contrast change |
|---|---:|---:|---:|---:|
| Whole image | 139.9 | 102.3 | −37.6 | +67% |
| Open water | 114.8 | 101.6 | −13.2 | +50% |
| Turtle area | 135.8 | 114.9 | −20.9 | +41% |
| Reef/background | 146.8 | 99.5 | −47.3 | +77% |

The turtle starts about 5 L units darker than its surroundings and ends about
15 L units brighter. That is a roughly 20-unit increase in subject/background
separation—the strongest evidence that the result uses selective masking rather
than one global curve.

Mean RGB values show the color strategy:

| Region | Before RGB | Generated-after RGB | Interpretation |
|---|---|---|---|
| Open water | 7, 109, 184 | 11, 94, 170 | Preserve blue luminance; reduce aqua/green |
| Turtle | 81, 139, 134 | 100, 113, 98 | Strong local warmth and neutralization |
| Reef | 88, 150, 150 | 80, 98, 93 | Darker, warmer, less cyan surroundings |

## Reusable reconstruction

The reference suggests this layered, non-generative reconstruction:

1. Moderate adaptive white balance—avoid pushing red globally.
2. A stronger S-curve with highlight protection.
3. Selective aqua/blue mixing that keeps water luminous.
4. A soft subject-attention mask for lift, warmth, and texture.
5. A darker, slightly warmer background outside that mask.
6. A feathered top gradient and optical vignette.
7. Targeted texture and clarity, with conservative denoise.

The subject mask, top gradient, and vignette describe evidence in the reference;
they are not claims about ReefTone's current implementation. ReefTone intentionally
avoids guessed depth or focus controls. Its production pipeline uses depth-free
white balance and multiscale fusion, so the reference remains a color-and-tone
target rather than a pixel-matching specification.

The implemented global behaviors are exposed as independent controls. The
**Dramatic** preset is a starting point, and **Overall mix** can reduce its intensity
without changing the relative balance of the active processing stages.
