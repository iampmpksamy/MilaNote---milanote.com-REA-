//! Data model: boards hold cards and arrows; deleted cards go to the trash.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

pub type CardId = u64;
pub type BoardId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Container {
    Canvas,
    Column(CardId),
    Unsorted,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TodoItem {
    pub text: String,
    pub done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Content {
    Note { text: String },
    Todo { title: String, items: Vec<TodoItem> },
    Link { url: String, title: String },
    Image { file: String, caption: String, aspect: f32 },
    Board { board: BoardId },
    Column { title: String, children: Vec<CardId> },
}

impl Content {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Content::Note { .. } => "Note",
            Content::Todo { .. } => "To-do list",
            Content::Link { .. } => "Link",
            Content::Image { .. } => "Image",
            Content::Board { .. } => "Board",
            Content::Column { .. } => "Column",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Card {
    pub id: CardId,
    pub pos: [f32; 2],
    pub width: f32,
    pub color: usize,
    pub z: i64,
    pub container: Container,
    #[serde(default)]
    pub locked: bool,
    /// Text alignment for notes: 0 left, 1 centre, 2 right.
    #[serde(default)]
    pub align: u8,
    pub content: Content,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Arrow {
    pub id: u64,
    pub from: CardId,
    pub to: CardId,
    pub color: usize,
    pub dashed: bool,
    /// Arrowhead at the end.
    pub head: bool,
    /// Arrowhead at the start.
    #[serde(default)]
    pub head_start: bool,
    /// 1 = thin, 2 = medium, 3 = thick.
    #[serde(default = "default_weight")]
    pub weight: u8,
    #[serde(default)]
    pub label: String,
    /// Where the start sits when it isn't attached to a card (`from` is 0).
    #[serde(default)]
    pub from_pt: Option<[f32; 2]>,
    /// Where the end sits when it isn't attached to a card (`to` is 0).
    #[serde(default)]
    pub to_pt: Option<[f32; 2]>,
}

fn default_weight() -> u8 {
    1
}

impl Arrow {
    pub fn new(id: u64, from: CardId, to: CardId) -> Self {
        Arrow {
            id,
            from,
            to,
            color: 0,
            dashed: false,
            head: true,
            head_start: false,
            weight: 1,
            label: String::new(),
            from_pt: None,
            to_pt: None,
        }
    }

    /// A line whose ends aren't attached to anything.
    pub fn free(id: u64, a: [f32; 2], b: [f32; 2]) -> Self {
        Arrow { from_pt: Some(a), to_pt: Some(b), ..Arrow::new(id, 0, 0) }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Board {
    pub id: BoardId,
    pub name: String,
    pub parent: Option<BoardId>,
    pub color: usize,
    /// A symbol shown on the board's square (an emoji from the bundled emoji font).
    #[serde(default)]
    pub icon: Option<String>,
    pub cards: Vec<Card>,
    pub arrows: Vec<Arrow>,
    pub unsorted: Vec<CardId>,
    pub pan: [f32; 2],
    pub zoom: f32,
}

impl Board {
    pub fn new(id: BoardId, name: &str, parent: Option<BoardId>, color: usize) -> Self {
        Board {
            id,
            name: name.to_owned(),
            parent,
            color,
            icon: None,
            cards: vec![],
            arrows: vec![],
            unsorted: vec![],
            pan: [60.0, 40.0],
            zoom: 1.0,
        }
    }

    pub fn card(&self, id: CardId) -> Option<&Card> {
        self.cards.iter().find(|c| c.id == id)
    }

    pub fn card_mut(&mut self, id: CardId) -> Option<&mut Card> {
        self.cards.iter_mut().find(|c| c.id == id)
    }

    pub fn max_z(&self) -> i64 {
        self.cards.iter().map(|c| c.z).max().unwrap_or(0)
    }

    pub fn min_z(&self) -> i64 {
        self.cards.iter().map(|c| c.z).min().unwrap_or(0)
    }

    /// Take a card out of its column or the unsorted list and put it on the canvas.
    pub fn detach(&mut self, id: CardId) {
        let container = match self.card(id) {
            Some(c) => c.container,
            None => return,
        };
        match container {
            Container::Canvas => {}
            Container::Column(col) => {
                if let Some(Card { content: Content::Column { children, .. }, .. }) = self.card_mut(col) {
                    children.retain(|c| *c != id);
                }
            }
            Container::Unsorted => self.unsorted.retain(|c| *c != id),
        }
        if let Some(c) = self.card_mut(id) {
            c.container = Container::Canvas;
        }
    }

    pub fn attach_column(&mut self, id: CardId, col: CardId, index: usize) {
        self.detach(id);
        if let Some(Card { content: Content::Column { children, .. }, .. }) = self.card_mut(col) {
            let i = index.min(children.len());
            children.insert(i, id);
        } else {
            return;
        }
        if let Some(c) = self.card_mut(id) {
            c.container = Container::Column(col);
        }
    }

    pub fn attach_unsorted(&mut self, id: CardId) {
        self.detach(id);
        self.unsorted.push(id);
        if let Some(c) = self.card_mut(id) {
            c.container = Container::Unsorted;
        }
    }

    pub fn column_children(&self, col: CardId) -> Vec<CardId> {
        match self.card(col) {
            Some(Card { content: Content::Column { children, .. }, .. }) => children.clone(),
            _ => vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrashItem {
    pub id: u64,
    pub board: BoardId,
    pub cards: Vec<Card>,
    pub arrows: Vec<Arrow>,
    pub deleted_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Store {
    pub boards: BTreeMap<BoardId, Board>,
    pub root: BoardId,
    pub next_id: u64,
    pub trash: Vec<TrashItem>,
    /// Saved-file format version; files from the first version have none (0).
    #[serde(default)]
    pub version: u32,
}

/// The current saved-file format.
pub const STORE_VERSION: u32 = 2;

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Plain text of a card, for search and previews.
pub fn card_text(store: &Store, card: &Card) -> String {
    match &card.content {
        Content::Note { text } => text.clone(),
        Content::Todo { title, items } => {
            let mut s = title.clone();
            for i in items {
                s.push('\n');
                s.push_str(&i.text);
            }
            s
        }
        Content::Link { url, title } => format!("{title}\n{url}"),
        Content::Image { caption, .. } => caption.clone(),
        Content::Board { board } => store.boards.get(board).map(|b| b.name.clone()).unwrap_or_default(),
        Content::Column { title, .. } => title.clone(),
    }
}

impl Store {
    /// Bring a store saved by an older version up to date. Returns true if anything changed.
    pub fn migrate(&mut self) -> bool {
        if self.version >= STORE_VERSION {
            return false;
        }
        if self.version < 2 {
            // Version 1 had 7 board colours (Blue, Coral, Green, Amber, Purple, Teal, Charcoal);
            // version 2 starts with a neutral default and adds soft tones. Keep each board's colour.
            const OLD_TO_NEW: [usize; 7] = [7, 8, 9, 10, 11, 12, 13];
            for b in self.boards.values_mut() {
                b.color = OLD_TO_NEW.get(b.color).copied().unwrap_or(0);
            }
        }
        self.version = STORE_VERSION;
        true
    }

    pub fn new_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn board(&self, id: BoardId) -> &Board {
        self.boards.get(&id).or_else(|| self.boards.get(&self.root)).expect("root board")
    }

    pub fn board_mut(&mut self, id: BoardId) -> &mut Board {
        let id = if self.boards.contains_key(&id) { id } else { self.root };
        self.boards.get_mut(&id).expect("root board")
    }

    /// Path of board ids from Home down to `board`.
    pub fn path(&self, board: BoardId) -> Vec<BoardId> {
        let mut out = vec![];
        let mut cur = Some(board);
        let mut guard = 0;
        while let Some(b) = cur {
            if guard > 64 {
                break;
            }
            guard += 1;
            out.push(b);
            cur = self.boards.get(&b).and_then(|x| x.parent);
        }
        out.reverse();
        out
    }

    #[allow(dead_code)]
    pub fn card_count(&self, board: BoardId) -> usize {
        self.boards.get(&board).map(|b| b.cards.len()).unwrap_or(0)
    }

    pub fn new_board(&mut self, name: &str, parent: BoardId, color: usize) -> BoardId {
        let id = self.new_id();
        self.boards.insert(id, Board::new(id, name, Some(parent), color));
        id
    }

    /// Move cards (and, for columns, their contents) to the trash. Returns how many trash items were made.
    pub fn delete_cards(&mut self, board_id: BoardId, ids: &[CardId]) -> usize {
        let mut made = 0;
        let ts = now_secs();
        // Skip cards whose column is also being deleted: they go with it.
        let top: Vec<CardId> = {
            let b = self.board(board_id);
            ids.iter()
                .copied()
                .filter(|id| match b.card(*id).map(|c| c.container) {
                    Some(Container::Column(col)) => !ids.contains(&col),
                    Some(_) => true,
                    None => false,
                })
                .collect()
        };
        for id in top {
            let trash_id = self.new_id();
            let b = self.board_mut(board_id);
            let mut group = vec![id];
            group.extend(b.column_children(id));
            // remember where it was, so restoring puts it back there
            let was_in = b.card(id).map(|c| c.container).unwrap_or(Container::Canvas);
            b.detach(id);
            let mut cards = vec![];
            for gid in &group {
                if let Some(i) = b.cards.iter().position(|c| c.id == *gid) {
                    cards.push(b.cards.remove(i));
                }
            }
            if let Some(first) = cards.first_mut() {
                first.container = was_in;
            }
            let mut arrows = vec![];
            b.arrows.retain(|a| {
                if group.contains(&a.from) || group.contains(&a.to) {
                    arrows.push(a.clone());
                    false
                } else {
                    true
                }
            });
            if !cards.is_empty() {
                self.trash.push(TrashItem { id: trash_id, board: board_id, cards, arrows, deleted_at: ts });
                made += 1;
            }
        }
        made
    }

    /// Put a trashed item back where it was. Returns the board it went to.
    pub fn restore(&mut self, trash_id: u64) -> Option<BoardId> {
        let i = self.trash.iter().position(|t| t.id == trash_id)?;
        let item = self.trash.remove(i);
        let board_id = if self.boards.contains_key(&item.board) { item.board } else { self.root };
        let b = self.board_mut(board_id);
        let z = b.max_z() + 1;
        let first = item.cards.first().map(|c| c.id);
        for mut card in item.cards.clone() {
            if Some(card.id) == first {
                card.z = z;
            }
            b.cards.push(card);
        }
        if let Some(first) = first {
            let container = b.card(first).map(|c| c.container).unwrap_or(Container::Canvas);
            match container {
                Container::Column(col) => {
                    let ok = matches!(b.card(col).map(|c| &c.content), Some(Content::Column { .. }));
                    if let Some(c) = b.card_mut(first) {
                        c.container = Container::Canvas;
                    }
                    if ok {
                        b.attach_column(first, col, usize::MAX);
                    }
                }
                Container::Unsorted => {
                    if let Some(c) = b.card_mut(first) {
                        c.container = Container::Canvas;
                    }
                    b.attach_unsorted(first);
                }
                Container::Canvas => {}
            }
        }
        for a in item.arrows {
            if (a.from == 0 || b.card(a.from).is_some()) && (a.to == 0 || b.card(a.to).is_some()) {
                b.arrows.push(a);
            }
        }
        Some(board_id)
    }

    /// Delete a trashed item for good (boards inside it go too).
    pub fn purge(&mut self, trash_id: u64) {
        if let Some(i) = self.trash.iter().position(|t| t.id == trash_id) {
            let item = self.trash.remove(i);
            for c in item.cards {
                if let Content::Board { board } = c.content {
                    self.remove_board_tree(board);
                }
            }
        }
    }

    pub fn remove_board_tree(&mut self, board: BoardId) {
        if board == self.root {
            return;
        }
        if let Some(b) = self.boards.remove(&board) {
            for c in b.cards {
                if let Content::Board { board } = c.content {
                    self.remove_board_tree(board);
                }
            }
        }
    }

    /// Copy a whole board (and the boards inside it) under `parent`.
    pub fn deep_copy_board(&mut self, src: BoardId, parent: BoardId, depth: u32) -> BoardId {
        let Some(orig) = self.boards.get(&src).cloned() else {
            return self.new_board("Board", parent, 0);
        };
        let nb = self.new_id();
        let mut b = Board::new(nb, &orig.name, Some(parent), orig.color);
        b.pan = orig.pan;
        b.zoom = orig.zoom;
        self.boards.insert(nb, b);
        if depth < 16 {
            self.copy_cards_into(nb, &orig.cards, &orig.arrows, [0.0, 0.0], depth + 1, true);
        }
        nb
    }

    /// Insert copies of `cards` (top-level cards plus any column contents) into a board.
    /// Returns the new ids of the top-level cards.
    pub fn copy_cards_into(
        &mut self,
        board_id: BoardId,
        cards: &[Card],
        arrows: &[Arrow],
        offset: [f32; 2],
        depth: u32,
        keep_z: bool,
    ) -> Vec<CardId> {
        let mut map: HashMap<CardId, CardId> = HashMap::new();
        for c in cards {
            let nid = self.new_id();
            map.insert(c.id, nid);
        }
        let mut new_cards = vec![];
        for c in cards {
            let mut n = c.clone();
            n.id = map[&c.id];
            if let Content::Board { board } = &n.content {
                let nb = self.deep_copy_board(*board, board_id, depth);
                n.content = Content::Board { board: nb };
            }
            new_cards.push(n);
        }
        let mut z = self.board(board_id).max_z();
        let mut top = vec![];
        let mut unsorted = vec![];
        for n in new_cards.iter_mut() {
            if let Content::Column { children, .. } = &mut n.content {
                *children = children.iter().filter_map(|c| map.get(c).copied()).collect();
            }
            n.container = match n.container {
                Container::Column(col) => match map.get(&col) {
                    Some(nc) => Container::Column(*nc),
                    None => Container::Canvas,
                },
                other => other,
            };
            if n.container == Container::Unsorted {
                unsorted.push(n.id);
            }
            if !matches!(n.container, Container::Column(_)) {
                top.push(n.id);
                if n.container == Container::Canvas {
                    n.pos[0] += offset[0];
                    n.pos[1] += offset[1];
                }
            }
            if !keep_z {
                z += 1;
                n.z = z;
            }
        }
        let new_arrows: Vec<Arrow> = arrows
            .iter()
            .filter_map(|a| {
                let from = if a.from == 0 { 0 } else { *map.get(&a.from)? };
                let to = if a.to == 0 { 0 } else { *map.get(&a.to)? };
                if from == 0 && to == 0 {
                    return None;
                }
                Some(Arrow { id: 0, from, to, ..a.clone() })
            })
            .collect();
        let mut with_ids = vec![];
        for mut a in new_arrows {
            a.id = self.new_id();
            with_ids.push(a);
        }
        let b = self.board_mut(board_id);
        b.cards.extend(new_cards);
        b.arrows.extend(with_ids);
        b.unsorted.extend(unsorted);
        top
    }

    pub fn empty() -> Store {
        let mut s = Store { boards: BTreeMap::new(), root: 1, next_id: 1, trash: vec![], version: STORE_VERSION };
        s.boards.insert(1, Board::new(1, "Home", None, 0));
        s
    }

    /// A first-run board that shows what the app can do.
    pub fn sample() -> Store {
        let mut s = Store::empty();
        let root = s.root;

        let ideas = s.new_board("Project ideas", root, 4);
        let mood = s.new_board("Mood & inspiration", root, 2);
        let reading = s.new_board("Reading list", root, 0);
        for (b, icon) in [(ideas, "💡"), (mood, "🎨")] {
            s.board_mut(b).icon = Some(icon.to_string());
        }

        let mut cards: Vec<Card> = vec![];
        let add = |s: &mut Store, cards: &mut Vec<Card>, pos: [f32; 2], width: f32, color: usize, content: Content| -> CardId {
            let id = s.new_id();
            let z = cards.len() as i64 + 1;
            cards.push(Card { id, pos, width, color, z, container: Container::Canvas, locked: false, align: 0, content });
            id
        };

        let welcome = add(&mut s, &mut cards, [0.0, 0.0], 280.0, 1, Content::Note {
            text: "# Welcome to your board\nDrag anything from the toolbar on the left onto the canvas.\n\n- **Double-click** a card to edit it\n- Drag the blue dot on a selected card to draw an arrow\n- Scroll to move around, **Ctrl + scroll** to zoom".into(),
        });
        add(&mut s, &mut cards, [320.0, 0.0], 124.0, 0, Content::Board { board: ideas });
        add(&mut s, &mut cards, [460.0, 0.0], 124.0, 0, Content::Board { board: mood });
        add(&mut s, &mut cards, [600.0, 0.0], 124.0, 0, Content::Board { board: reading });
        let todo = add(
            &mut s,
            &mut cards,
            [320.0, 190.0],
            260.0,
            0,
            Content::Todo {
                title: "This week".into(),
                items: vec![
                    TodoItem { text: "Sketch the layout".into(), done: true },
                    TodoItem { text: "Collect references".into(), done: true },
                    TodoItem { text: "Write the outline".into(), done: false },
                    TodoItem { text: "Share it with the team".into(), done: false },
                ],
            },
        );
        let column = add(&mut s, &mut cards, [640.0, 190.0], 270.0, 0, Content::Column { title: "Research".into(), children: vec![] });
        let c1 = add(
            &mut s,
            &mut cards,
            [0.0, 0.0],
            250.0,
            0,
            Content::Note { text: "**Interview notes**\nPeople want a calm, uncluttered space to collect ideas.".into() },
        );
        let c2 = add(
            &mut s,
            &mut cards,
            [0.0, 0.0],
            250.0,
            0,
            Content::Link { url: "https://example.com/visual-thinking".into(), title: "A short guide to visual thinking".into() },
        );
        let c3 = add(&mut s, &mut cards, [0.0, 0.0], 250.0, 2, Content::Note { text: "Idea: a weekly review board".into() });
        let next = add(
            &mut s,
            &mut cards,
            [0.0, 330.0],
            260.0,
            0,
            Content::Note { text: "## Next steps\nTurn the outline into a plan and *share it* by Friday.".into() },
        );
        let quick = add(&mut s, &mut cards, [0.0, 0.0], 240.0, 0, Content::Note { text: "Call Sam about the photos".into() });

        for c in cards.iter_mut() {
            if [c1, c2, c3].contains(&c.id) {
                c.container = Container::Column(column);
            }
            if c.id == quick {
                c.container = Container::Unsorted;
            }
            if c.id == column {
                c.content = Content::Column { title: "Research".into(), children: vec![c1, c2, c3] };
            }
        }
        let a1 = s.new_id();
        let a2 = s.new_id();
        let a3 = s.new_id();
        let b = s.board_mut(root);
        b.cards = cards;
        b.unsorted = vec![quick];
        b.arrows = vec![
            Arrow::new(a1, welcome, todo),
            Arrow { dashed: true, ..Arrow::new(a2, next, todo) },
            Arrow { color: 1, ..Arrow::new(a3, todo, column) },
        ];

        // A little content inside the nested board.
        let n1 = s.new_id();
        let n2 = s.new_id();
        let ib = s.board_mut(ideas);
        ib.cards.push(Card {
            id: n1,
            pos: [0.0, 0.0],
            width: 240.0,
            color: 3,
            z: 1,
            container: Container::Canvas,
            locked: false,
            align: 0,
            content: Content::Note { text: "# Ideas\nEvery board can hold more boards.".into() },
        });
        ib.cards.push(Card {
            id: n2,
            pos: [280.0, 0.0],
            width: 240.0,
            color: 0,
            z: 2,
            container: Container::Canvas,
            locked: false,
            align: 0,
            content: Content::Note { text: "Use the path at the top to go back Home.".into() },
        });
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column_and_children(s: &Store) -> (CardId, Vec<CardId>) {
        let b = s.board(s.root);
        let col = b.cards.iter().find(|c| matches!(c.content, Content::Column { .. })).unwrap();
        (col.id, b.column_children(col.id))
    }

    #[test]
    fn delete_column_takes_children_and_restore_brings_them_back() {
        let mut s = Store::sample();
        let root = s.root;
        let before = s.board(root).cards.len();
        let (col, kids) = column_and_children(&s);
        let arrows_before = s.board(root).arrows.len();
        assert_eq!(s.delete_cards(root, &[col]), 1);
        assert_eq!(s.board(root).cards.len(), before - 1 - kids.len());
        assert!(s.board(root).arrows.len() < arrows_before);
        let tid = s.trash[0].id;
        s.restore(tid);
        assert_eq!(s.board(root).cards.len(), before);
        assert_eq!(s.board(root).column_children(col), kids);
        assert_eq!(s.board(root).arrows.len(), arrows_before);
    }

    #[test]
    fn restore_child_goes_back_into_its_column() {
        let mut s = Store::sample();
        let root = s.root;
        let (col, kids) = column_and_children(&s);
        s.delete_cards(root, &[kids[1]]);
        assert_eq!(s.board(root).column_children(col).len(), kids.len() - 1);
        let tid = s.trash[0].id;
        s.restore(tid);
        assert!(s.board(root).column_children(col).contains(&kids[1]));
        assert_eq!(s.board(root).card(kids[1]).unwrap().container, Container::Column(col));
    }

    #[test]
    fn purge_board_card_removes_nested_boards() {
        let mut s = Store::sample();
        let root = s.root;
        let card = s.board(root).cards.iter().find(|c| matches!(c.content, Content::Board { .. })).unwrap().clone();
        let Content::Board { board } = card.content else { unreachable!() };
        s.delete_cards(root, &[card.id]);
        assert!(s.boards.contains_key(&board));
        let tid = s.trash[0].id;
        s.purge(tid);
        assert!(!s.boards.contains_key(&board));
    }

    #[test]
    fn copying_a_column_copies_its_children_and_boards_deep() {
        let mut s = Store::sample();
        let root = s.root;
        let (col, kids) = column_and_children(&s);
        let b = s.board(root);
        let mut cards: Vec<Card> = vec![b.card(col).unwrap().clone()];
        cards.extend(kids.iter().map(|k| b.card(*k).unwrap().clone()));
        let n = s.board(root).cards.len();
        let new = s.copy_cards_into(root, &cards, &[], [30.0, 30.0], 0, false);
        assert_eq!(new.len(), 1);
        assert_eq!(s.board(root).cards.len(), n + 1 + kids.len());
        let copied = s.board(root).column_children(new[0]);
        assert_eq!(copied.len(), kids.len());
        assert!(copied.iter().all(|k| !kids.contains(k)));

        let bcard = s.board(root).cards.iter().find(|c| matches!(c.content, Content::Board { .. })).unwrap().clone();
        let boards_before = s.boards.len();
        s.copy_cards_into(root, &[bcard], &[], [0.0, 0.0], 0, false);
        assert_eq!(s.boards.len(), boards_before + 1);
    }

    #[test]
    fn unsorted_attach_and_detach() {
        let mut s = Store::sample();
        let root = s.root;
        let id =
            s.board(root).cards.iter().find(|c| c.container == Container::Canvas && matches!(c.content, Content::Note { .. })).unwrap().id;
        s.board_mut(root).attach_unsorted(id);
        assert!(s.board(root).unsorted.contains(&id));
        s.board_mut(root).detach(id);
        assert!(!s.board(root).unsorted.contains(&id));
        assert_eq!(s.board(root).card(id).unwrap().container, Container::Canvas);
    }

    #[test]
    fn saved_boards_load_back() {
        let s = Store::sample();
        let json = serde_json::to_string(&s).unwrap();
        let back: Store = serde_json::from_str(&json).unwrap();
        assert_eq!(back.boards.len(), s.boards.len());
        assert_eq!(back.board(back.root).cards.len(), s.board(s.root).cards.len());
    }
}
