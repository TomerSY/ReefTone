# Color management and HDR

## Bottom line

ReefTone never overwrites the original. Version 0.4 detects the image's base bit
depth, embedded ICC profile or NCLX color tags, transfer function, HDR form, and
HEIF auxiliary images. Preview JPEGs now carry the source ICC profile so a
color-managed browser does not reinterpret Display P3 numbers as untagged sRGB.

For SDR and wide-color SDR images, edits remain in the source display-referred
profile. Compatible exports preserve the ICC profile and camera metadata.

Apple gain-map HDR is detected but is not falsely copied after an edit. Reusing the
old gain map with changed base pixels would describe the wrong relationship between
the SDR and HDR versions. Until the native HDR pipeline described below is built,
ReefTone clearly labels the edit as using the color-managed SDR base and exports a
wide-color SDR copy.

ISO HDR input is similarly detected from its bit depth and HLG/PQ tags. Version 0.4
asks libheif for a tone-mapped SDR decode before running the display-referred
correction engine, tags that working copy as sRGB, and deliberately removes the HDR
transfer tags from the edited output. This is safer than applying SDR math directly
to HLG/PQ values and saving a file that is incorrectly labeled HDR.

## What Apple HEIC may contain

An iPhone HEIC is a container, not just one pixel array. A typical file can contain:

- an 8-bit Display P3 primary image;
- an auxiliary HDR gain map that reconstructs HDR headroom;
- thumbnails, semantic mattes, depth, or other Apple auxiliary images;
- an ICC or NCLX/CICP color description;
- EXIF, XMP, GPS, MakerNote, orientation, and capture metadata.

The sample `IMG_5502.HEIC` in this project contains an 8-bit Display P3 base plus
an Apple HDR gain map and three additional auxiliary image types. Reporting it only
as “8-bit HEIC” would therefore be incomplete.

## Research basis

Apple's [Support HDR images in your app](https://developer.apple.com/videos/play/wwdc2023/10181/)
session describes two different still-image forms:

- ISO HDR: at least 10-bit, HLG or PQ, with HDR color tags;
- Gain Map HDR: an SDR base plus auxiliary data used to reconstruct an HDR image.

Apple recommends expanding gain-map input into an HDR working image, processing in
Core Image's unclamped linear working space, and writing a new 10-bit HDR HEIF.
Traditional JPEG is 8-bit and cannot be an ISO TS 22028-5 HDR file.

Display P3 uses DCI-P3 primaries, a D65 white point, and the sRGB transfer curve.
Apple emphasizes tagging images with the correct profile and converting rather than
assigning a different profile. See [Get Started with Display
P3](https://developer.apple.com/videos/play/wwdc2017/821/).

## Export behavior in 0.4

| Format | Precision | ICC profile | EXIF/XMP | HDR gain map |
| --- | ---: | --- | --- | --- |
| HEIC | 10-bit | Preserved | Preserved when supported | Not reused after edits |
| TIFF | 16-bit | Preserved | Limited by TIFF writer | No |
| PNG | 8-bit | Preserved | Preserved when supported | No |
| JPEG | 8-bit | Preserved | Preserved when supported | No |

HEIC uses 4:4:4 chroma to avoid unnecessary color subsampling in an editing export.
TIFF is the safest lossless master in the current engine. HEIC is the best compact
wide-color SDR output.

## Native HDR phase

True HDR editing requires more than retaining tags:

1. Decode ISO HDR or expand an Apple gain map through ImageIO/Core Image.
2. Convert into a known extended-linear working color space with values above 1.0.
3. Adapt the restoration pipeline so its tone and fusion operations do not clamp
   HDR headroom.
4. Recompute the edited HDR representation.
5. Write a 10-bit HEIF using an HDR color space and validate it on HDR and SDR
   displays.

This phase is intentionally separate from the current NumPy pipeline, whose
algorithms were designed for display-referred values in the range 0–1.

## Video requirements

HDR video needs the same discipline. Apple specifies that HDR HEVC uses Main10 and
that color primaries, transfer function, and YCbCr matrix must be explicitly
preserved. HLG and PQ are distinct transfer functions; Dolby Vision can also carry
dynamic metadata that changes by scene or frame.

The video phase must probe and preserve:

- codec/profile and bit depth;
- color primaries, transfer function, and matrix;
- full/limited range;
- mastering display and content-light metadata;
- Dolby Vision configuration and dynamic metadata where present;
- rotation, timing, frame rate, audio, and container metadata.

See Apple's [HDR video metadata technical
note](https://developer.apple.com/documentation/technotes/tn3145-hdr-video-metadata)
and [Export HDR media with
AVFoundation](https://developer.apple.com/videos/play/wwdc2020/10010/).
