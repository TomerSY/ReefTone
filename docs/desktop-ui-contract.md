# Desktop UI and settings contract

ReefTone Desktop 0.5.0 is the visual and behavioral reference for the next web
parity pass. The web implementation may use a different renderer, but it should not
rename, reorder, rescale, or silently reinterpret these controls.

## Visible order and labels

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
2. **Levels** — channel dropdown `RGB`, `Red`, `Green`, `Blue`; reset; bypass; one
   graph with markers `Black`, `Shadows`, `Midtone`, `Highlights`, `White`.
3. **Auto Restore** — on/off switch, `Strength`, `Overall mix`.
4. **White balance** — `Sample neutral`, `Red recovery`, `Green correction`,
   `Blue balance`, `Fusion clarity`, `Temperature`, `Tint`.
5. **Presence** — `Saturation`, `Vibrance`, `Clarity`, `Denoise`.

Every ordinary slider has reset then bypass actions. Reset writes zero. Bypass
preserves the stored value, visually dims the control, and sends zero to processing;
editing a bypassed slider enables it again. Levels reset and bypass operate on the
currently selected channel as one five-point group. Copied settings include Green
correction and all Levels channels, but exclude the sampled neutral color.

The magnifier is point-centered. Left-click increases zoom by 25 percentage points;
right-click decreases it by 25 percentage points. Zoom is clamped to 10–1600%.

## Settings schema

Names below are the Python/API names. All values are JSON numbers.

| Visible label | Key | Range | Default |
| --- | --- | ---: | ---: |
| Overall mix | `master` | 0–1 | 1 |
| Strength | `auto_restore` | 0–1 | 0.90 |
| Red recovery | `red_recovery` | 0–1.5 | 0.95 |
| Green correction | `green_correction` | −1–1 | 0 |
| Blue balance | `blue_balance` | −1–1 | 0.24 |
| Fusion clarity | `dehaze` | 0–1 | 0.38 |
| Temperature | `temperature` | −1–1 | 0.04 |
| Tint | `tint` | −1–1 | 0.01 |
| Exposure | `exposure` | −2–2 | 0 |
| Contrast | `contrast` | −0.5–0.8 | 0.22 |
| Black point | `black_point` | −0.5–0.5 | 0.08 |
| White point | `white_point` | −0.5–0.5 | 0.04 |
| Highlights | `highlights` | −1–1 | −0.14 |
| Shadows | `shadows` | −1–1 | 0.10 |
| Saturation | `saturation` | −1–1 | 0.05 |
| Vibrance | `vibrance` | −1–1 | 0.22 |
| Clarity | `clarity` | −1–1 | 0.16 |
| Denoise | `denoise` | 0–1 | 0.03 |

Levels use
`levels_{rgb|red|green|blue}_{black|shadows|midtone|highlights|white}`. Every
Levels value ranges from 0 to 1. For every channel, the defaults in visible order
are `0, 0.25, 0.5, 0.75, 1`.

The neutral-point fields are `sample_red`, `sample_green`, `sample_blue`, and
`sample_strength`; each ranges from 0 to 1 and defaults to zero.

Green correction and all Levels values remain neutral in every 0.5.0 curated
preset. This is intentional: existing looks retain their established rendering
until each new adjustment is tuned against the reference set.

## Five-point Levels behavior

The five names represent fixed input anchors at `0, 0.25, 0.5, 0.75, 1`; dragging
a marker changes that anchor's output value. Fixed anchors are used because they
give exactly five visible, serializable points and an exact identity default without
an additional hidden endpoint.

Output values are non-decreasing. A marker is clamped between its immediate
neighbors and cannot cross them. Keyboard arrows move a focused marker by 0.01;
Shift plus an arrow moves it by 0.05. Pointer dragging is recorded as one undo step.

Processing uses float32 monotone cubic Hermite interpolation. It does not overshoot
the control points. The RGB curve is applied to all channels first, followed in
order by Red, Green, and Blue. Bypass substitutes the identity values while
retaining the edited curve. Preview and full-resolution export use the same code.

## Visual tokens and responsive behavior

- Font stack: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
  sans-serif`.
- Top bar: 64 px high. Desktop inspector: 344 px wide. Inspector horizontal
  padding: 16 px; sections: 17 px vertical padding; slider list gap: 16 px.
- Major type: brand 15 px, inspector title 17 px, section title 12 px, slider label
  10 px, section description 9 px, Levels marker labels 7 px.
- Levels graph: full inspector width, 9:4 aspect ratio, 8 px radius, 288 × 128 SVG
  coordinate space, 12-unit internal padding, 6-unit marker radius.
- Primary colors: background `#07100f`, surface `#0d1816`, text `#edf7f2`, muted
  `#8fa8a0`, accent `#6ce0c4`, strong accent `#9af4de`.
- Shared radius token: 14 px. Standard buttons use 9 px; inspector cards use
  10–11 px.
- At 900 px the inspector becomes 300 px. At 690 px the workspace stacks, the top
  bar becomes 58 px, document/undo/redo and right preview tools are hidden, and the
  inspector occupies its own scrolling region.

Before an image is open, the preview toolbar is hidden and Export, Copy settings,
Reset, Undo, and Redo are disabled with 0.35 opacity and a not-allowed cursor.
Adjustment controls remain visible; opening an image always reapplies Natural.
Undo and Redo enable only when their respective stacks contain an edit.
