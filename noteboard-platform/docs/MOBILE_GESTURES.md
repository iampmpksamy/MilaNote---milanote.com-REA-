# Touch and mobile layout

The same workspace runs on phones, tablets and touch laptops. Touch is handled with pointer events
(`pointerType === 'touch'`), so a mouse and a pen behave as before.

## Gestures on the board

| Gesture | What happens |
| --- | --- |
| Tap a card | selects it |
| Tap a selected card again | edits it (a board opens) |
| Double tap | same as double-click: edit a card, open a board, or a new note on empty space |
| One finger on a card, move > 8 px | drags the card (and the other selected cards); drop into columns or Unsorted as with a mouse |
| One finger on empty space | pans the board (and clears the selection) |
| Two fingers | pinch to zoom around the fingers and move the board at the same time |
| Long press (0.5 s, without moving) | the context menu for that card, line or spot, with a short vibration |
| Drag a resize corner / line end / connection dot | as with a mouse; their touch targets are 24–30 px |

The browser's own long-press menu, double-tap zoom and page scrolling are switched off on the board
(`touch-action: none`), so they never fight the gestures.

## Phone layout (narrow screens, ≤ 640 px)

- Tools move to a **bottom bar** that scrolls sideways; the contextual tools (colour, edit, align,
  duplicate, more…) replace them when something is selected, as on the desktop.
- Tool options, the help/search popups, the context menu and **Unsorted** open as **bottom sheets**.
- The header shows only the parent and current board (the parent is the way back) and a short save
  status (`✓ Saved`, `Saving…`, `⚠ Not saved`).
- Settings fill the screen, with the sections as tabs along the top.
- Safe areas (notches, home indicator, rounded corners) are respected (`viewport-fit=cover` +
  `env(safe-area-inset-*)`).
- Phones in landscape keep the narrow tool column on the side to save height. Tablets use the
  desktop layout with larger touch targets.

## Keyboard and system buttons

- When the on-screen keyboard opens, the card being edited is moved into view.
- **Android Back:** closes the open menu, popup, settings, trash, editor, Unsorted sheet or selection
  (in that order), then goes up one board, then back a page, and finally minimises the app.
- iOS: the keyboard's accessory bar is hidden (the note toolbar has the buttons).

## Clipboard, pictures and sharing

- *Copy* and *Paste* in the long-press menu use the system clipboard (text, links, pictures) through
  the native clipboard; pasting text that came from Noteboard pastes the cards.
- *Add image* opens the system picker (photos, files, camera on Android).
- **Share to Noteboard** (Android): text, links and pictures shared from other apps land in
  **Unsorted** on the open board. iOS needs a Share Extension target and signing (later).
- *Save export* and *Save my unsent changes* open the share sheet (phones) or a save dialog (Windows).

## Tested

`apps/web-e2e/native/app.spec.ts` drives real touch input (Chrome DevTools protocol touch events) on
a Pixel 7 profile: tap to create, one-finger drag of a card, two-finger pinch, one-finger pan, long
press → bottom-sheet menu, Back closing the editor and the menu; screenshots for phone portrait and
landscape, Android tablet, iPhone, iPad, dark theme and large interface size, with a check that no
screen scrolls sideways. A physical phone has not been used yet.
