# Reference video analysis

Source: `reference/20261119-0342-23.2032029.mp4` (read-only, never re-encoded).

| Property | Value |
| --- | --- |
| Duration | 3:02.60 |
| Video | H.264 Main, 1910 × 888, 30 fps, yuv420p, ~772 kb/s |
| Audio | AAC 48 kHz stereo (not used) |
| Created | 2026-11-19 03:42:27 UTC |
| Capture | Browser window of app.milanote.com, desktop, "Large (Recommended)" interface size (seen in the Appearance page at 1:33) |

Frames were extracted with the FFmpeg build bundled in the `imageio_ffmpeg` Python package:
one every 5 s (`checks/video-frames/t001…t037.png`, frame N = (N−1)·5 s) plus single frames at
chosen seconds (`checks/video-frames/dense/sNNN.png`, NNN = second). They live under the project's
`checks/` folder because the builder may only write inside `app/` and `checks/`; the brief asked for
`reference/extracted-frames/`, which this builder isn't allowed to change.

## Timestamped interaction inventory

| Time | What happens (observed) | Frame |
| --- | --- | --- |
| 0:00–0:15 | Home board: two boards ("AsimoV MultiTech" with a face emoji on a pale-yellow square, "New Board" grey) joined by a thin dark arrow. Boards are bare 72 px rounded squares with a bold title and "0 cards" under them; no card behind them. Left toolbar: Note, Link, To-do, Line, Board (blue), Column, Comment, Table, •••, divider, Add image, Upload, Draw, Trash at the bottom. Header: logo + "Home" left; undo, redo, divider, a phone/devices count, help, search, notifications, settings right. "0 Unsorted" pill top-right of the canvas. A promotional "desktop app" panel bottom-right (not reproduced). | t001, t004 |
| 0:20 | A new board is created and selected: the toolbar changes to ← (back), Color, Icon, Rename, •••. The selected board square gets a dark 2 px outline and a small white dot at its top-right corner. | t005 |
| 0:25–0:28 | Rename: the title becomes an inline text field with all text selected (blue highlight). | s028, t006 |
| 0:30–0:40 | A board "Test" with a clay colour and a flame icon is moved around by dragging. The colour/icon pickers themselves are not visible in any extracted frame. | t007, t009, s032 |
| 0:45–1:10 | Lines: a line is selected — toolbar shows ←, Color, Start, End, Label, Dashed, Weight, •••. Endpoint handles appear (small circles); one end is dragged across the canvas and dropped on a board, where it attaches near the icon's edge. | s055 |
| 1:25–1:28 | Gear menu (account card with name, e-mail, plan, upgrade button — personal data, not reproduced). | s088 |
| 1:30 | Settings modal: dimmed page, white panel ~820 × 740, left list (Account settings, Emails & notifications, Appearance, Preferences, Localization, Toolbar options, Privacy), close × top-right. | s090 |
| 1:33 | Appearance page: "Interface" with Small / Medium / Large preview tiles, shortcut chips `Ctrl Shift < or >`, green check on the chosen one; toggle "Display headings in the … font"; "Color scheme" with Light / Dark preview tiles and chips `Ctrl Shift D`; toggle "Match system theme". | s093 |
| 1:36–2:00 | Dark mode: header #272727, canvas and toolbar #1D1D1D, light arrows (#CBCBCB), default board grey #808080. Boards are dragged into a new arrangement; lines follow. | s096, s104, s112 |
| 2:05 | A note is created in dark mode: flat #272727 card, "Start typing..." placeholder, no border. | s125 |
| 2:20–2:30 | Back in light mode: the note "ASIMOV" is a flat white card (~340 × 68 at Large size), padding ~24 px, no border, almost no shadow. | s145, s148 |
| 2:45–3:02 | Dark mode again; the same note and boards; pointer moves over the To-do tool. A to-do card is not clearly created in the extracted frames. | s168, s175, s178 |

## Not verifiable from the video (recorded, not invented)

- The board colour palette and icon picker contents (never on screen in an extracted frame).
- Note-selection and to-do-selection toolbars (not shown); the app uses the same pattern as boards.
- Exact animation curves; only that menus and the modal appear without long transitions.
- Snapping/alignment guide behaviour.
- The "Label" line option's look.
