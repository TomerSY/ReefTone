# Desktop UI and settings contract

ReefTone Desktop 0.6.0 is the explicit visual and behavioral reference for the
next web parity pass. The web renderer may differ, but it must not rename, reorder,
rescale, or silently reinterpret these controls. Serialized legacy keys remain
stable even where the visible label is clearer.

## Visible order, labels, and help

The top bar is ordered `ReefTone Studio`, document name/status, `Local & private`,
`Undo`, `Redo`, `Export`. The preview toolbar is ordered:

1. Looks: `Natural`, `Vivid`, `Deep water`, `Gentle`, `Dramatic`.
2. `Color information`.
3. Comparison: `Swipe`, `Before`.
4. Zoom: `Fit`, `1:2`, `1:1`, `Fill`, `2:1`, magnifier percentage.

The inspector heading is `Adjustments` / `Color restoration`, with `Copy settings`
then `Reset`. Its sections and controls are:

1. **Light** — `Exposure`, `Contrast`, `Black point`, `White point`, `Highlights`,
   `Shadows`.
2. **Levels** — channel dropdown `RGB`, `Red`, `Green`, `Blue`; group reset; group
   bypass; one graph with markers `Black`, `Shadows`, `Midtone`, `Highlights`,
   `White`.
3. **Auto Restore** — on/off switch, `Strength`, `Overall mix`.
4. **White balance** — `Sample neutral`, `Red balance`, `Green balance`,
   `Blue balance`, `Fusion clarity`, `Temperature`, `Tint`.
5. **Presence** — `Saturation`, `Vibrance`, `Clarity`; compact **Sharpening**
   subgroup with group reset/bypass and `Amount`, `Radius`, `Threshold`; `Denoise`.

The White balance description and accessible help is: “Underwater-aware balance
adapts to wavelength loss; these are not simple RGB multipliers.” Each balance
slider exposes its visible name as its accessible label and a channel-specific
tooltip. This wording is intentional: the engine uses measured scene attenuation
and established adaptive compensation, not independent RGB multiplication.

Sharpening tooltips define Amount as edge-detail strength, Radius as the blur radius
in pixels used to find edges, and Threshold as the minimum luminance difference
sharpened so higher values protect fine noise.

Every ordinary slider has reset then bypass actions. Reset writes the documented
default. Bypass preserves the stored value, visually dims the affected control, and
sends its neutral value to processing; editing a bypassed slider enables it again.
Levels and Sharpening also have group reset/bypass. Copied settings include all
balance, Levels, and Sharpening fields, but exclude sampled neutral RGB values.
Export and preview send the same effective settings.

## Comparison and zoom

Opening a photo, opening another photo, or resetting establishes whole-image
Before/After mode:

- `Swipe` is off (`aria-pressed="false"`).
- The comparison line, handle, and Before/After overlay labels are hidden.
- `Before` is enabled, shows the corrected whole image initially, and toggles the
  whole image to original while active (`aria-pressed="true"`, visible text
  changes to `After`).
- Enabling Swipe turns whole-image Before off, disables its button, reveals the
  divider at 50%, and preserves mutual exclusivity.
- Holding `\` momentarily shows the original in either mode and restores the active
  comparison state on release.

The magnifier is point-centered. Left-click increases zoom by 25 percentage points;
right-click decreases it by 25 percentage points. Zoom is clamped to 10–1600%.

## Settings schema

All values are JSON numbers. Visible naming changed without migrating the three
stable balance keys.

| Visible label | Key | Range | Default | Bypass |
| --- | --- | ---: | ---: | ---: |
| Overall mix | `master` | 0–1 | 1 | 0 |
| Strength | `auto_restore` | 0–1 | 0.90 | 0 |
| Red balance | `red_recovery` | 0–1.5 | 0.95 | 0 |
| Green balance | `green_correction` | −1–1 | 0 | 0 |
| Blue balance | `blue_balance` | −1–1 | 0.24 | 0 |
| Fusion clarity | `dehaze` | 0–1 | 0.38 | 0 |
| Temperature | `temperature` | −1–1 | 0.04 | 0 |
| Tint | `tint` | −1–1 | 0.01 | 0 |
| Exposure | `exposure` | −2–2 | 0 | 0 |
| Contrast | `contrast` | −0.5–0.8 | 0.22 | 0 |
| Black point | `black_point` | −0.5–0.5 | 0.08 | 0 |
| White point | `white_point` | −0.5–0.5 | 0.04 | 0 |
| Highlights | `highlights` | −1–1 | −0.14 | 0 |
| Shadows | `shadows` | −1–1 | 0.10 | 0 |
| Saturation | `saturation` | −1–1 | 0.05 | 0 |
| Vibrance | `vibrance` | −1–1 | 0.22 | 0 |
| Clarity | `clarity` | −1–1 | 0.16 | 0 |
| Sharpening Amount | `sharpen_amount` | 0–2 (0–200%) | 0 | 0 |
| Sharpening Radius | `sharpen_radius` | 0.3–5 px | 1 px | 1 px |
| Sharpening Threshold | `sharpen_threshold` | 0–0.2 (0–20%) | 0.02 | 0 |
| Denoise | `denoise` | 0–1 | 0.03 | 0 |

Levels use
`levels_{rgb|red|green|blue}_{black|shadows|midtone|highlights|white}`. Each value
ranges from 0 to 1; defaults in visible order are `0, 0.25, 0.5, 0.75, 1`.
The neutral-point fields are `sample_red`, `sample_green`, `sample_blue`, and
`sample_strength`; each ranges from 0 to 1 and defaults to zero.

All curated presets intentionally retain neutral Green balance, identity Levels,
and Sharpening Amount 0. Old serialized settings omit Sharpening and therefore
deserialize to Amount 0, Radius 1 px, Threshold 0.02 without changing output.

## Five-point Levels behavior

The five names represent fixed input anchors at `0, 0.25, 0.5, 0.75, 1`; dragging
a marker changes that anchor's output value. Output values are non-decreasing. A
marker is clamped between its immediate neighbors and cannot cross them. Keyboard
arrows move a focused marker by 0.01; Shift plus an arrow moves it by 0.05. Pointer
dragging is one undo step.

Processing uses float32 monotone cubic Hermite interpolation without overshoot.
The RGB curve applies to all channels first, followed by Red, Green, and Blue.
Bypass substitutes identity values while retaining the edited curve. Preview and
full-resolution export use the same code.

## Sharpening behavior

Sharpening runs in float32 after color, clarity, and denoise, and before the master
mix. A Gaussian blur with `sigma = Radius` defines the unsharp detail. Threshold
uses the absolute luma of that detail and a short feathered gate before Amount is
applied. Output is finite and clamped once to the editor’s `[0, 1]` display-referred
working range. Amount 0 returns the input unchanged and does not run the blur.

Per-control edits, reset, bypass, group reset, and group bypass are undoable.
Group reset restores `0 / 1 px / 0.02`; group bypass neutralizes Amount only while
preserving all three stored values. Editing any Sharpening slider re-enables the
group.

## Canonical visual tokens and responsive behavior

The 0.6.0 scale token is `--ui-scale: 1.5`. Every text size and icon/glyph dimension
is exactly 1.5× the prior canonical base value; CSS retains the base value beside
the multiplier so web parity can reproduce it without rounding.

- Font stack: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
  sans-serif`.
- Resolved top bar: 96 px (64 × 1.5). Desktop inspector: 516 px (344 × 1.5).
  Inspector horizontal padding: 24 px; section vertical padding: 25.5 px; slider
  list gap: 24 px.
- Resolved type: brand 22.5 px; inspector title 25.5 px; section title 18 px;
  slider label/value 15 px; section description 13.5 px; Levels marker labels
  10.5 px. Body copy, buttons, tabs, badges, tooltips, status text, and dialog text
  use the same exact 1.5 multiplier over their checked-in base values.
- Resolved common glyphs: top icon 25.5 px; primary-button icon 24 px; section
  chevron 24 px; mini-control glyph 18 px; slider thumb 18 px; comparison handle
  48 px with a 24 px glyph.
- Levels graph: full inspector width, 9:4 aspect ratio, resolved 12 px radius,
  288 × 128 internal coordinate space. Its SVG scales with the 1.5× inspector,
  including its visible five markers.
- Primary colors: background `#07100f`, surface `#0d1816`, text `#edf7f2`, muted
  `#8fa8a0`, accent `#6ce0c4`, strong accent `#9af4de`.
- Shared radius base token remains 14 px. Standard control/card radii and all
  fixed control heights/spacing resolve at the 1.5 multiplier.
- To prevent the 1.5× Looks and comparison toolbars from colliding, the canvas and
  516 px reference-width inspector stack at 1800 px and below. At the exact 1.5×
  mobile breakpoint (1035 px from the former 690 px), the top bar becomes 87 px,
  document/undo/redo and right preview tools hide, and the inspector fills the
  available width.

Before an image is open, the preview toolbar is hidden and Export, Copy settings,
Reset, Undo, and Redo are disabled with 0.35 opacity and a not-allowed cursor.
Adjustment controls remain visible; opening an image always reapplies Natural.
Undo and Redo enable only when their respective stacks contain an edit.
