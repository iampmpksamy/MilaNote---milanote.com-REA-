# Visual comparison matrix

Measuring conditions: reference frames 1910 × 888 (browser content, 100 % OS scaling, Milanote
interface "Large"); app pictures 1360 × 860 window, 100 % OS scaling, interface "Medium", board zoom
100 %. Reference sizes were divided by ~1.12 (Large vs Medium) before comparing. Side-by-side sheets
are in `docs/comparison/` (reference with promotions and account details greyed out | before | after).
No similarity percentage is claimed: comparison was by eye against sampled colours and measured sizes.

| Component | Ref. time | Reference | Before (v1) | After (v2) | Priority | Files | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canvas | 0:00 / 2:00 | flat #EAEBEE, fine dots; dark #1D1D1D | #FAFAF9 near-white | sampled colours, both themes | P0 | theme.rs, canvas.rs | Done, visually checked |
| Header | 0:00 | 44 px white, logo + Home, icon buttons right | 52 px, wordmark, big search field, text Undo/Redo, Unsorted button | 44 px, logo + breadcrumb, icon undo/redo, help, search, settings, "Saved" | P0 | panels.rs, icons.rs | Done, checked |
| Toolbar | 0:00 | canvas-coloured, mini-card icons, 13 tools, trash bottom | white, 7 line icons | canvas-coloured, mini-card icons, same order; Comment/Table/Draw shown disabled | P0 | panels.rs, icons.rs | Done; 3 tools deferred |
| Contextual toolbar | 0:20, 0:55 | ← + Color/Icon/Rename/••• for boards; Color/Start/End/Label/Dashed/Weight for lines | floating colour bar above card | toolbar swaps per selection (board, note, to-do, link, image, column, line, many) with ← back | P0 | panels.rs | Done, tested |
| Board | 0:00–0:40 | bare 72 px rounded square, symbol, bold title, "0 cards"; dark outline + white dot when selected | white card with blue square and 4-square glyph | bare square, optional symbol, title, live count, dark outline + connector dot | P0 | cards.rs | Done, tested |
| Board colour / icon | 0:30 | clay square + flame | 7 fixed colours, no icon | 14-colour picker + 48 symbols with search, reset | P1 | menus.rs, icons.rs | Done; picker look not in video |
| Rename | 0:25 | inline, all text selected | inline, cursor at end | inline, all text selected | P0 | cards.rs | Done, tested |
| Lines | 0:45–1:10 | thin dark lines ending near icon edge, endpoint handles, drag end onto board | card-to-card only | free lines, draggable ends attach/detach, start/end heads, dashed, 3 weights, label, colours | P0 | canvas.rs, model.rs | Done, tested |
| Settings modal | 1:30 | dimmed page, nav list, Appearance page | none | same structure; Account/E-mail pages left out (no accounts); Language, Toolbar options, Privacy & data adapted | P0 | settings.rs | Done, checked |
| Light/dark | 1:36 | full dark theme | light only | Light, Dark, Match system; Ctrl+Shift+D | P0 | theme.rs, input.rs | Done, tested |
| Interface size | 1:33 | Small/Medium/Large | none | Small/Medium/Large; Ctrl+Shift+< / > | P0 | input.rs, settings.rs | Done, tested |
| Note | 2:05, 2:25 | flat card, "Start typing...", no border | bordered card, "Empty note" | flat card, "Start typing...", hover outline only | P1 | cards.rs | Done, checked |
| To-do | — | not shown | progress bar, "Something to do" | "Add a task..." placeholder, optional title | P1 | cards.rs | Done, tested (look not in video) |
| Link | — | not shown | big coloured banner | compact: letter tile, title, domain, Open ↗ | P1 | cards.rs | Done (look not in video) |
| Unsorted | 0:00 | small "0 Unsorted" pill top-right | wide open panel | pill; drawer opens on click, remembered | P1 | panels.rs | Done, tested |
| Promotions | 0:00, 2:25 | desktop-app ad, refer-a-friend, upgrade | — | intentionally not reproduced | — | — | Excluded |
