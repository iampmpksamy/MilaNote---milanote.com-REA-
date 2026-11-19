//! Changing cards: copy, paste, duplicate, delete, colours, text formatting and search.

use super::*;

impl App {
    fn selection_with_children(&self) -> Vec<Card> {
        let b = self.board();
        let mut out = vec![];
        let mut seen = BTreeSet::new();
        for id in &self.selected {
            if let Some(c) = b.card(*id) {
                if seen.insert(c.id) {
                    out.push(c.clone());
                }
                for ch in b.column_children(c.id) {
                    if seen.insert(ch) {
                        if let Some(cc) = b.card(ch) {
                            out.push(cc.clone());
                        }
                    }
                }
            }
        }
        // Anything selected inside a column that isn't copied with it goes on the canvas.
        for c in out.iter_mut() {
            if let Container::Column(col) = c.container {
                if !seen.contains(&col) {
                    c.container = Container::Canvas;
                    if let Some(r) = self.rects.get(&c.id) {
                        c.pos = [r.min.x, r.min.y];
                    }
                }
            }
        }
        out
    }

    pub(super) fn copy_selection(&mut self, ctx: &egui::Context) -> bool {
        let cards = self.selection_with_children();
        if cards.is_empty() {
            return false;
        }
        let ids: BTreeSet<CardId> = cards.iter().map(|c| c.id).collect();
        self.clip_arrows = self.board().arrows.iter().filter(|a| ids.contains(&a.from) && ids.contains(&a.to)).cloned().collect();
        let mut text: Vec<String> = cards.iter().map(|c| card_text(&self.store, c)).filter(|t| !t.is_empty()).collect();
        if text.is_empty() {
            text.push("(Noteboard cards)".into());
        }
        self.clip_text = text.join("\n\n");
        self.clipboard = cards;
        ctx.copy_text(self.clip_text.clone());
        true
    }

    /// Put copies of the copied cards on this board, their top-left corner at `target`.
    pub(super) fn paste_cards_at(&mut self, target: Pos2) {
        let mut cards = self.clipboard.clone();
        if cards.is_empty() {
            return;
        }
        for c in cards.iter_mut() {
            if c.container == Container::Unsorted {
                c.container = Container::Canvas;
            }
        }
        let mut min = Pos2::new(f32::INFINITY, f32::INFINITY);
        for c in &cards {
            if c.container == Container::Canvas {
                min = min.min(pos2(c.pos[0], c.pos[1]));
            }
        }
        let off = if min.x.is_finite() { target - min } else { Vec2::ZERO };
        self.checkpoint();
        let arrows = self.clip_arrows.clone();
        let ids = self.store.copy_cards_into(self.current, &cards, &arrows, [off.x, off.y], 0, false);
        self.selected = ids.into_iter().collect();
        self.selected_arrow = None;
        self.touch();
    }

    pub(super) fn paste(&mut self, ctx: &egui::Context, s: &str) {
        let pointer = ctx.pointer_latest_pos().filter(|p| self.canvas_rect.contains(*p));
        let target = pointer.map(|p| self.to_world(p)).unwrap_or_else(|| self.free_spot(vec2(300.0, 80.0)));
        if !self.clipboard.is_empty() && s.replace("\r\n", "\n").trim() == self.clip_text.replace("\r\n", "\n").trim() {
            self.paste_cards_at(target);
        } else if !s.trim().is_empty() {
            self.create_text_card(s, target);
        }
    }

    pub(super) fn duplicate(&mut self) {
        if let Some(a) = self.selected_arrow {
            let Some(mut ar) = self.board().arrows.iter().find(|x| x.id == a).cloned() else { return };
            self.checkpoint();
            ar.id = self.store.new_id();
            let shift = |p: Option<[f32; 2]>| p.map(|q| [q[0] + 24.0, q[1] + 24.0]);
            ar.from_pt = shift(ar.from_pt);
            ar.to_pt = shift(ar.to_pt);
            if ar.from == 0 || ar.to == 0 {
                self.selected_arrow = Some(ar.id);
                self.board_mut().arrows.push(ar);
                self.touch();
            }
            return;
        }
        let cards = self.selection_with_children();
        if cards.is_empty() {
            return;
        }
        let ids: BTreeSet<CardId> = cards.iter().map(|c| c.id).collect();
        let arrows: Vec<Arrow> = self.board().arrows.iter().filter(|a| ids.contains(&a.from) && ids.contains(&a.to)).cloned().collect();
        self.checkpoint();
        let new = self.store.copy_cards_into(self.current, &cards, &arrows, [24.0, 24.0], 0, false);
        self.selected = new.into_iter().collect();
        self.touch();
    }

    pub(super) fn delete_selection(&mut self, ctx: &egui::Context) {
        if let Some(a) = self.selected_arrow.take() {
            self.checkpoint();
            self.board_mut().arrows.retain(|x| x.id != a);
            self.popup = None;
            self.touch();
            return;
        }
        let ids: Vec<CardId> = self.selected.iter().copied().collect();
        if ids.is_empty() {
            return;
        }
        self.stop_editing(ctx);
        self.checkpoint();
        let n = self.store.delete_cards(self.current, &ids);
        self.selected.clear();
        self.popup = None;
        self.touch();
        if n > 0 {
            let msg = if n == 1 { "Moved 1 card to the trash".to_string() } else { format!("Moved {n} cards to the trash") };
            self.toast(msg, true);
        }
    }

    pub(super) fn set_card_color(&mut self, id: CardId, color: usize) {
        self.checkpoint();
        let board_target = match self.board().card(id).map(|c| &c.content) {
            Some(Content::Board { board }) => Some(*board),
            _ => None,
        };
        if let Some(b) = board_target {
            if let Some(bb) = self.store.boards.get_mut(&b) {
                bb.color = color;
            }
        } else if let Some(c) = self.board_mut().card_mut(id) {
            c.color = color;
        }
        self.touch();
    }

    pub(super) fn set_board_icon(&mut self, id: CardId, icon: Option<String>) {
        let Some(Content::Board { board }) = self.board().card(id).map(|c| c.content.clone()) else { return };
        self.checkpoint();
        if let Some(b) = self.store.boards.get_mut(&board) {
            b.icon = icon;
        }
        self.touch();
    }

    pub(super) fn edit_arrow(&mut self, id: u64, f: impl FnOnce(&mut Arrow)) {
        self.checkpoint();
        if let Some(a) = self.board_mut().arrows.iter_mut().find(|x| x.id == id) {
            f(a);
        }
        self.touch();
    }

    pub(super) fn cycle_align(&mut self, id: CardId) {
        self.checkpoint();
        if let Some(c) = self.board_mut().card_mut(id) {
            c.align = (c.align + 1) % 3;
        }
        self.touch();
    }

    pub(super) fn apply_format(&mut self, ctx: &egui::Context, cid: CardId, f: Fmt) {
        let eid = edit_id(cid);
        let state = egui::TextEdit::load_state(ctx, eid);
        let text_len = match self.board().card(cid).map(|c| &c.content) {
            Some(Content::Note { text }) => text.chars().count(),
            _ => return,
        };
        let (a, b) = state
            .as_ref()
            .and_then(|s| s.cursor.char_range())
            .map(|r| {
                let x = r.primary.index.min(text_len);
                let y = r.secondary.index.min(text_len);
                (x.min(y), x.max(y))
            })
            .unwrap_or((text_len, text_len));
        self.checkpoint();
        let mut range = (a, b);
        if let Some(Card { content: Content::Note { text }, .. }) = self.board_mut().card_mut(cid) {
            let mut chars: Vec<char> = text.chars().collect();
            match f {
                Fmt::Wrap(m) => {
                    let mc: Vec<char> = m.chars().collect();
                    let n = mc.len();
                    for (k, ch) in mc.iter().enumerate() {
                        chars.insert(b + k, *ch);
                    }
                    for (k, ch) in mc.iter().enumerate() {
                        chars.insert(a + k, *ch);
                    }
                    range = (a + n, b + n);
                }
                Fmt::Prefix(p) => {
                    let start = chars[..a].iter().rposition(|c| *c == '\n').map(|i| i + 1).unwrap_or(0);
                    let line: String = chars[start..].iter().take_while(|c| **c != '\n').collect();
                    let mut removed = 0usize;
                    let mut had_same = false;
                    for existing in ["### ", "## ", "# ", "- ", "> "] {
                        if line.starts_with(existing) {
                            had_same = existing == p;
                            let n = existing.chars().count();
                            chars.drain(start..start + n);
                            removed = n;
                            break;
                        }
                    }
                    let mut added = 0usize;
                    if !had_same {
                        for (k, ch) in p.chars().enumerate() {
                            chars.insert(start + k, ch);
                        }
                        added = p.chars().count();
                    }
                    let shift = |x: usize| (x + added).saturating_sub(removed).max(start);
                    range = (shift(a), shift(b));
                }
            }
            *text = chars.into_iter().collect();
        }
        let mut st = state.unwrap_or_default();
        st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(range.0), egui::text::CCursor::new(range.1))));
        st.store(ctx, eid);
        ctx.memory_mut(|m| m.request_focus(eid));
        self.touch();
    }

    pub(super) fn search_hits(&self) -> Vec<Hit> {
        let q = self.search.trim().to_lowercase();
        let mut out = vec![];
        if q.is_empty() {
            return out;
        }
        for b in self.store.boards.values() {
            if b.name.to_lowercase().contains(&q) && b.id != self.store.root {
                let path: Vec<String> = self.store.path(b.id).iter().map(|id| self.store.board(*id).name.clone()).collect();
                out.push(Hit { board: b.id, card: None, kind: "Board", title: b.name.clone(), snippet: path.join(" / ") });
            }
            for c in &b.cards {
                if matches!(c.content, Content::Board { .. }) {
                    continue;
                }
                let t = card_text(&self.store, c);
                if t.to_lowercase().contains(&q) {
                    let title = plain_title(&t);
                    out.push(Hit {
                        board: b.id,
                        card: Some(c.id),
                        kind: c.content.kind_name(),
                        title: if title.is_empty() { c.content.kind_name().to_string() } else { title },
                        snippet: format!("in {}", b.name),
                    });
                }
            }
            if out.len() > 60 {
                break;
            }
        }
        out
    }

    pub(super) fn goto_hit(&mut self, ctx: &egui::Context, board: BoardId, card: Option<CardId>) {
        self.open_board(ctx, board);
        if let Some(c) = card {
            self.select_only(c);
            if self.board().card(c).map(|x| x.container == Container::Unsorted).unwrap_or(false) {
                self.set_drawer(true);
            } else {
                self.pending_center = Some(c);
            }
        }
        self.search.clear();
        self.popup = None;
        ctx.memory_mut(|m| m.surrender_focus(Id::new("search")));
    }
}
