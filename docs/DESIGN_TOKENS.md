# Design tokens

All values live in `src/theme.rs` (`LIGHT` and `DARK` palettes plus shared constants).
Colours marked *sampled* were read from video pixels (1910 × 888 frames, browser at 100 %,
Milanote "Large" interface size); others are estimates chosen to sit with them.

## Colours

| Token | Light | Dark | Source |
| --- | --- | --- | --- |
| canvas | #EAEBEE | #1D1D1D | sampled (s148, s178) |
| toolbar | #EAEBEE | #1D1D1D | sampled — same as canvas |
| header | #FFFFFF | #272727 | sampled |
| card (note surface) | #FFFFFF | #272727 | sampled |
| divider (header/toolbar edge) | #D7D8DB | #303030 | sampled (#DEDEDE / #D7D8DB light) |
| board default | #B9BDC1 | #808080 | sampled |
| line default | #2F3237 | #CBCBCB | sampled (dark); light estimated |
| board tool blue | #5C7FF5 | same | sampled |
| text | #2F3237 | #E6E6E6 | estimated |
| muted text | #868A92 | #929292 | estimated |
| dot grid | #CFD1D6 | #303030 | estimated |
| selection | #4378D6 | same | roadmap |
| toggle on | #55C85B | same | sampled (s093) |
| modal dim | black 47 % | same | sampled overlay ≈ #474747 over white |

Card colours (index 0 follows the theme): Yellow #F7EEC4, Green #DFEFDA, Blue #DDE8F8, Pink #F8DFE4, Purple #E9E1F6, Grey #ECEDEC; in dark mode they're mixed 78 % toward #272727.
Board colours: Default, Lemon, Clay, Sage, Sky, Lilac, Blush (soft) and Blue, Coral, Green, Amber, Purple, Teal, Charcoal (strong) — original palette.

## Sizes (points; the reference was at "Large", our default is Medium = 1.0)

| Token | Value |
| --- | --- |
| header height | 44 |
| toolbar width | 70; item 58 tall, icon ~26, label 11.5 |
| board icon | 72 × 72, radius 14; title 15 semibold, count 12.5 |
| note | default 300 wide, padding 20 × 16, radius 3, text 15 |
| line | 1.6 / 2.6 / 4.0 (thin/medium/thick), gap to card 7 |
| dot grid | every 20 board units, radius ~1 |
| interface sizes | Small 0.9, Medium 1.0, Large 1.12 (egui zoom factor; board zoom is separate) |

## Type

Segoe UI (regular, semibold, bold) from Windows when present, else egui's bundled fonts; Nirmala UI is
added as a fallback for Tamil and other Indic scripts. No licensed font files are bundled.

## Motion

Hover fades 0.10 s; settings modal and toggles 0.12–0.14 s (`FADE_SECS`); drawer uses egui's slide.
Dragging, panning and typing are never animated. The app only repaints on input, while saving, or
while a fade/toast is running.
