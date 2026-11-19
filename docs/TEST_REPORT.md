# Test report (v2)

Machine: Windows 11 Pro, Rust 1.99.1, egui/eframe 0.31.1.

| Command | Result |
| --- | --- |
| `cargo fmt --check` | pass (formatting settings in `rustfmt.toml`, max width 140) |
| `cargo check` | pass |
| `cargo clippy --all-targets -- -D warnings` | pass, no warnings |
| `cargo test` | 18 passed, 0 failed |
| `cargo build` | pass |
| `cargo build --release` | pass |
| `noteboard --screenshot` | saves a 1360 × 860 picture; used for 24 "after" scenarios |

## Interaction tests (`src/app/tests.rs`)

These drive the real interface frame by frame through egui with simulated pointer and keyboard
events (press, move, release, double-click, text, shortcuts) at a 1360 × 860 screen, then read the
saved state. They are not screenshots: each one fails if the interaction doesn't work.

| # | Scenario (from the brief) | Test | Result |
| --- | --- | --- | --- |
| 1 | Launch | every test opens the app on a fresh folder | pass |
| 2–5 | Create, rename, colour, icon, move a board | `board_create_rename_color_icon_and_move` | pass |
| 6–7 | Connect two boards, move both, line stays attached | `connect_two_boards_and_lines_follow_when_they_move` | pass |
| — | Free line, drag its end onto a board, dashed, start arrow | `free_line_end_attaches_to_a_card` | pass |
| 8–9, 16 | Create and type a note (incl. Tamil), resize, undo, redo | `note_create_type_resize_and_undo` | pass |
| 10 | Add tasks with Enter, tick one | `todo_tasks_are_added_and_completed` | pass |
| 11 | Drag a card into a column and out again | `cards_move_into_and_out_of_columns` | pass |
| 12 | Open Unsorted from the pill, drag a card out | `unsorted_drawer_opens_and_cards_move_out` | pass |
| 13–14 | Double-click into a nested board; Ctrl+F search jumps back to the result | `double_click_opens_a_nested_board_and_search_finds_cards` | pass |
| 15–16 | Delete, undo, redo, restore | `delete_undo_redo_and_restore` | pass (restore is called directly, see below) |
| 17–18 | Ctrl+Shift+D theme, Ctrl+Shift+< / > size, settings closes with Esc | `theme_and_interface_size_shortcuts_and_settings_window` | pass |
| 19–20 | Restart: cards, names, theme and size come back | `everything_comes_back_after_a_restart` | pass |
| — | Your saved version-1 boards are upgraded, nothing lost, backup kept | `files_from_the_first_version_are_upgraded_and_backed_up` (uses a copy in `backups/`) | pass |
| — | Six data-model tests from v1 (trash, restore into column, deep copy, unsorted, save/load) | `model::tests::*` | pass |

Bugs the new tests found and that were fixed: a new note or board name didn't always get the
keyboard on the first try; a dragged card lagged ~15 px behind the pointer (drag threshold);
Ctrl+F opened search without putting the cursor in the box.

## Not covered automatically (manual checks still to do)

- Restore and Delete forever buttons inside the Trash window (the restore logic itself is tested).
- File dialogs (Add image, Upload, Replace) and dropping files from Explorer.
- Paste picture from the clipboard (uses the system clipboard).
- Other Windows display scalings (125 %, 150 %) and very small windows: the layout is in logical
  points so it should scale, but it was only run at 100 %.
- Trackpad pinch zoom (handled by egui's zoom gesture; no trackpad here).
