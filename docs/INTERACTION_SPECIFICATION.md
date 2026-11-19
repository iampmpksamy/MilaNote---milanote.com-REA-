# Interaction, components and motion

## Components (inventory)

Header · breadcrumb · icon button · toolbar item (default/hover/active/disabled/dragging) · contextual
toolbar with Back · board (normal/hover/selected/dragging/renaming) · note · to-do · link · picture ·
column · line with endpoint handles and label · connector dot · resize corner · Unsorted pill and
drawer · zoom controls · formatting bar · tool popups (card colour, board colour, board icon, line
colour, thickness, label) · search and help popups · right-click menus · trash window · settings modal
(nav, preview tiles, shortcut chips, toggles) · toasts · drag ghost.

## Pointer

| Gesture | Result |
| --- | --- |
| Click a tool | Adds the card in a free spot near the middle of the view (never on top of another card) |
| Drag a tool onto the board / a column / the drawer | Adds it where it's dropped |
| Click a card | Selects it; the toolbar switches to its tools |
| Shift/Ctrl+click | Adds to / removes from the selection |
| Drag a card | Moves it (and the rest of the selection); guides show when edges or centres line up |
| Drag onto a column / the drawer | Inserts at the blue line / sends to Unsorted |
| Double-click a card / board / empty board | Edits it / opens it / starts a note there |
| Drag the white dot on a selected card | Draws a line; drop on a card to attach, on empty space to leave the end free |
| Click a line | Selects it; ends show handles; toolbar shows line tools |
| Drag a line end | Moves it; dropping on a card attaches it, elsewhere detaches |
| Drag an unattached line's body | Moves the whole line |
| Drag the corner of a selected card | Changes its width |
| Right-click | Card, line or board menu |
| Scroll / Space+drag / middle-drag | Pan · Ctrl+scroll or pinch zooms around the pointer |

## Keyboard

N new note · Enter edit · Esc finish / close / clear · Delete trash · Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y ·
Ctrl+C/X/V/D/A · Ctrl+F search · Ctrl+0 / Ctrl+= / Ctrl+− board zoom · Ctrl+Shift+D theme ·
Ctrl+Shift+< / > interface size. While typing in a card, only Esc and the app-wide shortcuts act.

## Motion (ANIMATION_SPECIFICATION)

| Element | Motion |
| --- | --- |
| Toolbar items and header buttons | background fades in over 0.10 s on hover |
| Settings modal | page dims and panel fades over 0.14 s, in and out |
| Toggles | knob slides and colour blends over 0.12 s |
| Unsorted drawer | slides in/out (egui panel animation) |
| Popups, menus | egui's short fade-in |
| Drag, pan, zoom, typing | immediate, never eased |

The reference video shows menus and the modal appearing quickly with no bounce; exact curves could
not be measured from 30 fps frames, so these values are estimates.
