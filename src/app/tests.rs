//! Interaction tests: they drive the real interface frame by frame with simulated mouse and
//! keyboard input (clicks, drags, double-clicks, typing, shortcuts), then check the result.

use super::*;
use eframe::egui::{Event, Key, Modifiers, PointerButton, RawInput};

struct H {
    ctx: egui::Context,
    app: App,
    t: f64,
    dir: PathBuf,
    mods: Modifiers,
}

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("noteboard-test-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

impl H {
    fn new(name: &str) -> H {
        H::open(temp_dir(name))
    }

    fn open(dir: PathBuf) -> H {
        let ctx = egui::Context::default();
        let app = App::open(&ctx, dir.clone(), None);
        let mut h = H { ctx, app, t: 0.0, dir, mods: Modifiers::NONE };
        h.frames(4);
        h
    }

    fn frame(&mut self, events: Vec<Event>) {
        self.t += 1.0 / 60.0;
        let raw = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1360.0, 860.0))),
            time: Some(self.t),
            modifiers: self.mods,
            events,
            ..Default::default()
        };
        let app = &mut self.app;
        let _ = self.ctx.run(raw, |ctx| app.ui(ctx));
    }

    fn frames(&mut self, n: usize) {
        for _ in 0..n {
            self.frame(vec![]);
        }
    }

    fn button(&mut self, p: Pos2, pressed: bool) {
        self.frame(vec![Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: self.mods }]);
    }

    fn move_to(&mut self, p: Pos2) {
        self.frame(vec![Event::PointerMoved(p)]);
    }

    fn click(&mut self, p: Pos2) {
        self.move_to(p);
        self.button(p, true);
        self.button(p, false);
        self.frames(2);
    }

    fn double_click(&mut self, p: Pos2) {
        self.move_to(p);
        self.button(p, true);
        self.button(p, false);
        self.button(p, true);
        self.button(p, false);
        self.frames(3);
    }

    fn drag(&mut self, from: Pos2, to: Pos2) {
        self.move_to(from);
        self.button(from, true);
        for k in 1..=12 {
            let p = from + (to - from) * (k as f32 / 12.0);
            self.move_to(p);
        }
        self.button(to, false);
        self.frames(3);
    }

    fn key(&mut self, key: Key, mods: Modifiers) {
        self.mods = mods;
        self.frame(vec![
            Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: mods },
            Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: mods },
        ]);
        self.mods = Modifiers::NONE;
        self.frames(2);
    }

    fn type_text(&mut self, s: &str) {
        self.frame(vec![Event::Text(s.into())]);
        self.frames(1);
    }

    fn widget(&self, id: Id) -> Pos2 {
        self.ctx.read_response(id).unwrap_or_else(|| panic!("no widget {id:?}")).rect.center()
    }

    fn tool(&self, name: &str) -> Pos2 {
        self.widget(Id::new(("tool", name)))
    }

    fn card_screen(&self, id: CardId) -> Rect {
        self.app.xf() * self.app.rects[&id]
    }

    fn anchor_screen(&self, id: CardId) -> Rect {
        self.app.xf() * self.app.anchors[&id]
    }

    fn find(&self, f: impl Fn(&Card) -> bool) -> CardId {
        self.app.board().cards.iter().find(|c| f(c)).map(|c| c.id).expect("card")
    }

    fn board_card(&self, name: &str) -> CardId {
        let store = &self.app.store;
        self.find(|c| matches!(&c.content, Content::Board { board } if store.boards[board].name == name))
    }

    /// Somewhere on the canvas with nothing on it.
    fn empty_spot(&self) -> Pos2 {
        let r = self.app.canvas_rect;
        pos2(r.left() + 200.0, r.bottom() - 120.0)
    }
}

const CTRL: Modifiers = Modifiers { alt: false, ctrl: true, shift: false, mac_cmd: false, command: true };
const CTRL_SHIFT: Modifiers = Modifiers { alt: false, ctrl: true, shift: true, mac_cmd: false, command: true };

#[test]
fn board_create_rename_color_icon_and_move() {
    let mut h = H::new("board");
    let before = h.app.board().cards.len();
    let p = h.tool("Board");
    h.click(p);
    assert_eq!(h.app.board().cards.len(), before + 1, "a board card was added");
    let id = h.board_card("New Board");
    assert_eq!(h.app.editing, Some(id), "its name is ready to type");
    h.frames(2);
    h.type_text("Plans");
    h.key(Key::Enter, Modifiers::NONE);
    let p = h.empty_spot();
    h.click(p);
    let id2 = h.board_card("Plans");
    assert_eq!(id, id2, "typing replaced the selected name");

    // select it: the toolbar changes to the board's own tools
    let c = h.anchor_screen(id).center();
    h.click(c);
    assert!(h.ctx.read_response(Id::new(("tool", "Icon"))).is_some(), "board tools are shown");
    let p = h.tool("Color");
    h.click(p);
    assert!(matches!(h.app.popup, Some(Popup::BoardColor(..))));
    let p = h.widget(Id::new(("board-color", 8usize)));
    h.click(p);
    let b = match h.app.board().card(id).unwrap().content {
        Content::Board { board } => board,
        _ => unreachable!(),
    };
    assert_eq!(h.app.store.boards[&b].color, 8, "color changed");
    let p = h.tool("Icon");
    h.click(p);
    assert!(matches!(h.app.popup, Some(Popup::BoardIcon(..))));
    let p = h.widget(Id::new(("board-icon", "🚀")));
    h.click(p);
    assert_eq!(h.app.store.boards[&b].icon.as_deref(), Some("🚀"), "icon changed");

    // move it
    let start = h.app.board().card(id).unwrap().pos;
    let c = h.anchor_screen(id).center();
    h.drag(c, c + vec2(180.0, 90.0));
    let end = h.app.board().card(id).unwrap().pos;
    assert!(
        (end[0] - start[0] - 180.0).abs() < 9.0 && (end[1] - start[1] - 90.0).abs() < 9.0,
        "moved by about the drag: {start:?} -> {end:?}"
    );

    // the Back control returns to the main tools
    let p = h.widget(Id::new("tool-back"));
    h.click(p);
    assert!(h.app.selected.is_empty());
}

#[test]
fn connect_two_boards_and_lines_follow_when_they_move() {
    let mut h = H::new("connect");
    let a = h.board_card("Project ideas");
    let b = h.board_card("Mood & inspiration");
    let c = h.anchor_screen(a).center();
    h.click(c);
    let dot = h.app.xf() * (h.app.anchors[&a].right_top() + vec2(-3.0, 3.0));
    let target = h.anchor_screen(b).center();
    h.drag(dot, target);
    let arrow = h.app.board().arrows.iter().find(|x| x.from == a && x.to == b).cloned().expect("a line from one board to the other");
    // move both boards
    for id in [a, b] {
        let p = h.empty_spot();
        h.click(p);
        let c = h.anchor_screen(id).center();
        h.drag(c, c + vec2(0.0, 260.0));
    }
    let still = h.app.board().arrows.iter().find(|x| x.id == arrow.id).unwrap();
    assert_eq!((still.from, still.to), (a, b), "still attached");
    let (p1, p2) = h.app.arrow_geom(still).expect("drawn");
    assert!(h.app.anchors[&a].expand(10.0).contains(p1) && h.app.anchors[&b].expand(10.0).contains(p2), "ends sit at the board icons");
}

#[test]
fn free_line_end_attaches_to_a_card() {
    let mut h = H::new("line");
    let p = h.tool("Line");
    h.click(p);
    let id = h.app.selected_arrow.expect("the new line is selected");
    let a = h.app.board().arrows.iter().find(|x| x.id == id).unwrap().clone();
    assert_eq!((a.from, a.to), (0, 0), "a free line");
    let (_, p2) = h.app.arrow_geom(&a).unwrap();
    let board = h.board_card("Reading list");
    let target = h.anchor_screen(board).center();
    let from = h.app.xf() * p2;
    h.drag(from, target);
    let a = h.app.board().arrows.iter().find(|x| x.id == id).unwrap();
    assert_eq!(a.to, board, "its end attached to the board");
    assert!(a.to_pt.is_none());
    // line options from the toolbar
    let p = h.tool("Dashed");
    h.click(p);
    assert!(h.app.board().arrows.iter().find(|x| x.id == id).unwrap().dashed);
    let p = h.tool("Start");
    h.click(p);
    assert!(h.app.board().arrows.iter().find(|x| x.id == id).unwrap().head_start);
}

#[test]
fn note_create_type_resize_and_undo() {
    let mut h = H::new("note");
    let n = h.app.board().cards.len();
    let p = h.empty_spot();
    h.double_click(p);
    assert_eq!(h.app.board().cards.len(), n + 1, "double-click made a note");
    let id = h.app.editing.expect("writing straight away");
    h.frames(2);
    h.type_text("Hello **world** – வணக்கம்");
    h.key(Key::Escape, Modifiers::NONE);
    assert_eq!(h.app.editing, None);
    match &h.app.board().card(id).unwrap().content {
        Content::Note { text } => assert_eq!(text, "Hello **world** – வணக்கம்"),
        _ => panic!(),
    }
    // resize with the corner handle
    let c = h.card_screen(id).center();
    h.click(c);
    let w0 = h.app.board().card(id).unwrap().width;
    let corner = h.card_screen(id).right_bottom() - vec2(4.0, 4.0);
    h.drag(corner, corner + vec2(120.0, 0.0));
    let w1 = h.app.board().card(id).unwrap().width;
    assert!(w1 > w0 + 100.0, "wider: {w0} -> {w1}");
    // undo the resize, then redo it
    h.key(Key::Z, CTRL);
    assert!((h.app.board().card(id).unwrap().width - w0).abs() < 1.0, "undo restored the width");
    h.key(Key::Z, CTRL_SHIFT);
    assert!((h.app.board().card(id).unwrap().width - w1).abs() < 1.0, "redo applied it again");
}

#[test]
fn todo_tasks_are_added_and_completed() {
    let mut h = H::new("todo");
    let p = h.tool("To-do");
    h.click(p);
    let id = h.app.editing.expect("editing the new list");
    h.frames(2);
    h.type_text("Buy paper");
    h.key(Key::Enter, Modifiers::NONE);
    h.frames(2);
    h.type_text("Call the printer");
    h.key(Key::Escape, Modifiers::NONE);
    let items = match &h.app.board().card(id).unwrap().content {
        Content::Todo { items, .. } => items.clone(),
        _ => panic!(),
    };
    assert_eq!(items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(), vec!["Buy paper", "Call the printer"]);
    let p = h.app.xf() * h.widget(Id::new(("check", id, 0usize)));
    h.click(p);
    match &h.app.board().card(id).unwrap().content {
        Content::Todo { items, .. } => assert!(items[0].done && !items[1].done),
        _ => panic!(),
    }
}

#[test]
fn cards_move_into_and_out_of_columns() {
    let mut h = H::new("column");
    let col = h.find(|c| matches!(c.content, Content::Column { .. }));
    let note = h.find(|c| c.container == Container::Canvas && matches!(&c.content, Content::Note { text } if text.starts_with("## Next")));
    let from = h.card_screen(note).center();
    let to = h.card_screen(col).center_bottom() - vec2(0.0, 30.0);
    h.drag(from, to);
    assert_eq!(h.app.board().card(note).unwrap().container, Container::Column(col), "dropped into the column");
    assert!(h.app.board().column_children(col).contains(&note));
    // and back out
    let from = h.card_screen(note).center();
    let to = h.empty_spot();
    h.drag(from, to);
    assert_eq!(h.app.board().card(note).unwrap().container, Container::Canvas);
    assert!(!h.app.board().column_children(col).contains(&note));
}

#[test]
fn unsorted_drawer_opens_and_cards_move_out() {
    let mut h = H::new("drawer");
    assert!(!h.app.prefs.drawer_open, "closed by default");
    let n = h.app.board().unsorted.len();
    let p = h.widget(Id::new("unsorted-pill-btn"));
    h.click(p);
    h.frames(20);
    assert!(h.app.prefs.drawer_open);
    let id = h.app.board().unsorted[0];
    let from = h.app.drawer_rects[&id].center();
    let to = h.empty_spot();
    h.drag(from, to);
    assert_eq!(h.app.board().unsorted.len(), n - 1, "count went down");
    assert_eq!(h.app.board().card(id).unwrap().container, Container::Canvas);
}

#[test]
fn double_click_opens_a_nested_board_and_search_finds_cards() {
    let mut h = H::new("nav");
    let id = h.board_card("Project ideas");
    let target = match h.app.board().card(id).unwrap().content {
        Content::Board { board } => board,
        _ => unreachable!(),
    };
    let c = h.anchor_screen(id).center();
    h.double_click(c);
    assert_eq!(h.app.current, target, "opened the board");
    // search from inside it for a card on Home
    h.key(Key::F, CTRL);
    assert_eq!(h.app.popup, Some(Popup::Search));
    h.frames(2);
    h.type_text("weekly");
    assert_eq!(h.app.search, "weekly", "typed into the search box");
    assert!(!h.app.search_hits().is_empty());
    h.key(Key::Enter, Modifiers::NONE);
    assert_eq!(h.app.current, h.app.store.root, "went to the board holding the result");
    let found = *h.app.selected.iter().next().expect("the result is selected");
    assert!(card_text(&h.app.store, h.app.board().card(found).unwrap()).contains("weekly"));
}

#[test]
fn delete_undo_redo_and_restore() {
    let mut h = H::new("trash");
    let note = h.find(|c| c.container == Container::Canvas && matches!(&c.content, Content::Note { text } if text.starts_with("## Next")));
    let c = h.card_screen(note).center();
    h.click(c);
    h.key(Key::Delete, Modifiers::NONE);
    assert!(h.app.board().card(note).is_none());
    assert_eq!(h.app.store.trash.len(), 1);
    h.key(Key::Z, CTRL);
    assert!(h.app.board().card(note).is_some(), "undo brought it back");
    h.key(Key::Y, CTRL);
    assert!(h.app.board().card(note).is_none(), "redo removed it again");
    let tid = h.app.store.trash[0].id;
    h.app.store.restore(tid);
    h.frames(2);
    assert!(h.app.board().card(note).is_some(), "restored from the trash");
}

#[test]
fn theme_and_interface_size_shortcuts_and_settings_window() {
    let mut h = H::new("theme");
    assert_eq!(h.app.prefs.theme, ThemePref::Light);
    h.key(Key::D, CTRL_SHIFT);
    assert_eq!(h.app.prefs.theme, ThemePref::Dark);
    assert_eq!(h.app.applied_dark, Some(true));
    h.key(Key::Period, CTRL_SHIFT);
    assert_eq!(h.app.prefs.scale, 2);
    h.key(Key::Comma, CTRL_SHIFT);
    h.key(Key::Comma, CTRL_SHIFT);
    assert_eq!(h.app.prefs.scale, 0);
    h.key(Key::D, CTRL_SHIFT);
    assert_eq!(h.app.prefs.theme, ThemePref::Light);
    // the settings window opens from the header and closes with Esc
    h.app.settings_open = true;
    h.frames(12);
    h.key(Key::Escape, Modifiers::NONE);
    assert!(!h.app.settings_open);
}

#[test]
fn everything_comes_back_after_a_restart() {
    let mut h = H::new("restart");
    let p = h.tool("Board");
    h.click(p);
    h.frames(2);
    h.type_text("Kept");
    h.key(Key::Enter, Modifiers::NONE);
    h.key(Key::D, CTRL_SHIFT);
    h.key(Key::Period, CTRL_SHIFT);
    let cards = h.app.board().cards.len();
    h.frames(60);
    assert!(!h.app.dirty, "saved automatically");
    let dir = h.dir.clone();
    drop(h);
    let h2 = H::open(dir);
    assert_eq!(h2.app.board().cards.len(), cards);
    h2.board_card("Kept");
    assert_eq!(h2.app.prefs.theme, ThemePref::Dark);
    assert_eq!(h2.app.prefs.scale, 2);
}

#[test]
fn files_from_the_first_version_are_upgraded_and_backed_up() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("backups").join("user-boards-v1.json");
    let Ok(text) = std::fs::read_to_string(&src) else {
        eprintln!("no saved copy of version-1 boards to test with");
        return;
    };
    let dir = temp_dir("migrate");
    std::fs::write(dir.join("boards.json"), &text).unwrap();
    let old: serde_json::Value = serde_json::from_str(&text).unwrap();
    let old_cards: usize = old["boards"].as_object().unwrap().values().map(|b| b["cards"].as_array().unwrap().len()).sum();
    let (store, migrated) = load_store(&dir);
    assert!(migrated);
    assert_eq!(store.version, STORE_VERSION);
    let cards: usize = store.boards.values().map(|b| b.cards.len()).sum();
    assert_eq!(cards, old_cards, "no card lost");
    assert!(dir.join("boards.backup-v1.json").exists(), "the old file was kept");
    for (id, b) in &store.boards {
        let was = old["boards"][id.to_string()]["color"].as_u64().unwrap() as usize;
        assert_eq!(b.color, 7 + was, "colour kept for {}", b.name);
    }
}
