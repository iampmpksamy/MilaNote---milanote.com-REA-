# Implementation status, feature parity and known issues

Legend: **Tested** = automated interaction test passes · **Checked** = looked at in a screenshot ·
**Partial** = works with limits · **Deferred** = not built.

## Feature parity (single-user desktop edition — no full Milanote parity is claimed)

| Feature | Status |
| --- | --- |
| Infinite canvas: pan (scroll, Space+drag, middle-drag), pointer zoom, fit | Tested (pan/zoom code unchanged from v1; zoom keys tested indirectly) |
| Selection box, multi-select, z-order, lock | Checked |
| Alignment guides while dragging, optional 8-pt grid snap | Partial — guides for edges/centres of the nearest card; grid off by default |
| Boards: standalone icon, colour, symbol, rename, nested navigation, live count, duplicate (deep copy) | Tested |
| Lines: free, attached, draggable ends, start/end arrowheads, dashed, 3 weights, label, colours, detach | Tested (label/weight/colour checked) |
| Notes: inline editing, auto height, width resize, bold/italic/underline/strike, headings, lists, quotes, alignment, link highlighting, colours | Tested (formatting buttons checked); links are highlighted, not clickable inside the text |
| To-do: Enter adds a task, tick, reorder, remove, optional title | Tested |
| Link cards: compact, open in browser | Checked |
| Pictures: add, drag-drop, paste from clipboard (menu), caption, replace, proportional resize | Partial — Ctrl+V can't carry pictures (egui only passes text), so use right-click → Paste picture; no cropping |
| Columns: drop in/out with insertion line, auto height | Tested |
| Unsorted: pill, drawer, quick note, drag out, remembered | Tested |
| Trash, restore, delete forever, empty | Tested (model) / Checked (window) |
| Search (Ctrl+F) across all boards | Tested |
| Undo/redo, copy/cut/paste/duplicate | Tested (undo/redo); copy/paste unchanged from v1 |
| Light, Dark, Match system; Ctrl+Shift+D | Tested |
| Interface size Small/Medium/Large; Ctrl+Shift+< / > | Tested |
| Settings: Appearance, Preferences, Language, Toolbar options, Privacy & data | Checked (Appearance tested via shortcuts) |
| Upload any file (link card to the file) | Partial — not automated (file dialog) |
| Comment, Table, Draw tools | Deferred — shown greyed out with "Not available in this version yet" |
| Documents, labels, templates, export, image crop | Deferred (P2) |
| Accounts, sharing, collaboration, mobile | Out of scope for this desktop edition |
| Native title bar restyling | Deferred — the normal Windows title bar is kept so minimise/maximise/snap/resize keep working |

## Data

Saved files: `%APPDATA%\Noteboard\boards.json` (format version 2) and `prefs.json`.
Version-1 files are upgraded on first open; the original is first copied to
`boards.backup-v1.json` beside it. The upgrade keeps every board's colour (v1 colours moved to the
"strong" half of the new palette) and adds empty fields for icons, line options and note alignment.

## Known issues

1. The reference recording shows colour emoji on boards; this app draws symbols in one colour from
   the emoji font bundled with egui (no colour-emoji renderer). Only symbols the font can draw are
   offered, so there are no empty boxes.
2. Board colour and icon pickers, note/to-do toolbars and the to-do card look are not shown in the
   video; they follow the same pattern as what is shown.
3. "Account settings" and "Emails & notifications" pages are left out: there are no accounts.
4. Pasting a picture needs the right-click menu (see above).
5. Only tested at 100 % Windows display scaling.
6. Text inside notes at high board zoom is scaled, so it is slightly soft above ~150 %.

## Changelog

### v2 (this round)
- Theme system with sampled light and dark palettes, Match system, persisted; Ctrl+Shift+D.
- Interface size Small/Medium/Large separate from board zoom; Ctrl+Shift+< / >.
- New 44-pt header with icon buttons; help popup with shortcuts; search popup (Ctrl+F).
- Toolbar redrawn with original mini-card icons; contextual tools for every kind of selection.
- Boards redrawn as standalone squares with symbols; colour (14) and symbol (48, searchable) pickers.
- Line engine: free lines, endpoint handles that attach/detach, start/end heads, weights, labels.
- Flat notes with "Start typing..." placeholder, underline, alignment; compact link cards;
  "Add a task..." to-dos; Tamil font fallback.
- Unsorted pill + animated drawer; Settings modal; alignment guides; picture paste and replace;
  Upload tool; free-spot placement for click-to-create.
- Saved-file version 2 with backed-up migration; preferences file.
- 12 interaction tests; fmt and clippy clean.

### v1
- First desktop board app: canvas, notes, to-dos, links, pictures, boards, columns, arrows, trash, search, undo, autosave.
