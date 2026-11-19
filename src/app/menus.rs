//! Popups: the formatting bar, colour and icon pickers, line options, search, help,
//! right-click menus, the trash window, drag ghosts and toasts.

use super::*;
use crate::icons;
use eframe::egui::{
    Align, Align2, Button, Color32, CursorIcon, Frame, Key, Layout, Margin, Order, RichText, Sense, Stroke, StrokeKind, TextEdit,
};

#[derive(Clone, Copy)]
enum M {
    Edit(CardId),
    Open(BoardId),
    OpenLink,
    Duplicate,
    Copy,
    Front,
    Back,
    Lock(CardId, bool),
    ToUnsorted,
    ToCanvas(CardId),
    Delete,
    New(Tool, Pos2),
    Paste(Pos2),
    PastePicture(Pos2),
    SelectAll,
    Fit,
    ArrowDelete(u64),
    ArrowDetach(u64),
}

fn menu_item(ui: &mut egui::Ui, text: &str, short: &str) -> bool {
    ui.add(
        Button::new(RichText::new(text).size(13.5))
            .shortcut_text(RichText::new(short).size(12.0).color(muted()))
            .frame(false)
            .min_size(vec2(ui.available_width(), 26.0)),
    )
    .clicked()
}

fn danger_item(ui: &mut egui::Ui, text: &str, short: &str) -> bool {
    ui.add(
        Button::new(RichText::new(text).size(13.5).color(DANGER))
            .shortcut_text(RichText::new(short).size(12.0).color(muted()))
            .frame(false)
            .min_size(vec2(ui.available_width(), 26.0)),
    )
    .clicked()
}

fn popup_title(ui: &mut egui::Ui, t: &str) {
    ui.label(RichText::new(t).font(semibold_font(13.0)).color(muted()));
    ui.add_space(2.0);
}

impl App {
    fn card_screen_rect(&self, id: CardId) -> Option<Rect> {
        if self.board().card(id).map(|c| c.container == Container::Unsorted).unwrap_or(false) {
            return self.drawer_rects.get(&id).copied();
        }
        self.rects.get(&id).map(|r| self.xf() * *r)
    }

    /// Formatting for the note being written: above it, or below it when there's no room, kept on screen.
    pub(super) fn format_bar(&mut self, ctx: &egui::Context) {
        let Some(id) = self.editing else { return };
        if self.drag.is_some() || self.ctx_menu.is_some() || self.settings_open {
            return;
        }
        let Some(card) = self.board().card(id).cloned() else { return };
        if !matches!(card.content, Content::Note { .. }) {
            return;
        }
        let Some(sr) = self.card_screen_rect(id) else { return };
        let above = sr.top() - 8.0 >= self.canvas_rect.top() + 44.0;
        let (pos, pivot) = if above {
            (pos2(sr.left(), sr.top() - 8.0), Align2::LEFT_BOTTOM)
        } else {
            (pos2(sr.left(), sr.bottom() + 8.0), Align2::LEFT_TOP)
        };
        let pos =
            pos2(pos.x.clamp(self.canvas_rect.left() + 6.0, (self.canvas_rect.right() - 330.0).max(self.canvas_rect.left() + 6.0)), pos.y);
        let mut fmt: Option<Fmt> = None;
        let mut align = false;
        let mut done = false;
        egui::Area::new(Id::new("format-bar")).order(Order::Foreground).pivot(pivot).fixed_pos(pos).constrain(true).show(ctx, |ui| {
            Frame::popup(ui.style()).inner_margin(Margin::symmetric(6, 3)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 1.0;
                    let b = |ui: &mut egui::Ui, t: RichText, tip: &str| {
                        ui.add(Button::new(t).frame(false).min_size(vec2(28.0, 26.0))).on_hover_text(tip).clicked()
                    };
                    if b(ui, RichText::new("B").font(bold_font(14.0)), "Bold") {
                        fmt = Some(Fmt::Wrap("**"));
                    }
                    if b(ui, RichText::new("I").italics().size(14.0), "Italic") {
                        fmt = Some(Fmt::Wrap("*"));
                    }
                    if b(ui, RichText::new("U").underline().size(14.0), "Underline") {
                        fmt = Some(Fmt::Wrap("__"));
                    }
                    if b(ui, RichText::new("S").strikethrough().size(14.0), "Strikethrough") {
                        fmt = Some(Fmt::Wrap("~~"));
                    }
                    if b(ui, RichText::new("H1").font(semibold_font(13.0)), "Large heading") {
                        fmt = Some(Fmt::Prefix("# "));
                    }
                    if b(ui, RichText::new("H2").font(semibold_font(12.0)), "Small heading") {
                        fmt = Some(Fmt::Prefix("## "));
                    }
                    if b(ui, RichText::new("•").size(16.0), "Bullet list") {
                        fmt = Some(Fmt::Prefix("- "));
                    }
                    if b(ui, RichText::new("“").size(16.0), "Quote") {
                        fmt = Some(Fmt::Prefix("> "));
                    }
                    let al = ["≡ Left", "≡ Centre", "≡ Right"][card.align.min(2) as usize];
                    if b(ui, RichText::new(al).size(12.5), "Text alignment") {
                        align = true;
                    }
                    let (sep, _) = ui.allocate_exact_size(vec2(9.0, 18.0), Sense::hover());
                    ui.painter().vline(sep.center().x, sep.y_range(), Stroke::new(1.0_f32, border_c()));
                    if ui.add(Button::new(RichText::new("Done").size(13.0).color(SELECT)).frame(false)).clicked() {
                        done = true;
                    }
                });
            });
        });
        if let Some(f) = fmt {
            self.apply_format(ctx, id, f);
        }
        if align {
            self.cycle_align(id);
            ctx.memory_mut(|m| m.request_focus(edit_id(id)));
        }
        if done {
            self.stop_editing(ctx);
        }
    }

    /// Pickers that open beside the toolbar: colours, board icons, line thickness and label.
    pub(super) fn tool_popup(&mut self, ctx: &egui::Context) {
        let Some(popup) = self.popup else {
            self.popup_rect = None;
            return;
        };
        let y = match popup {
            Popup::CardColor(_, y)
            | Popup::BoardColor(_, y)
            | Popup::BoardIcon(_, y)
            | Popup::LineColor(_, y)
            | Popup::LineWeight(_, y)
            | Popup::LineLabel(_, y) => y,
            _ => return,
        };
        let pos = pos2(TOOLBAR_W + 8.0, y);
        let mut close = false;
        let resp = egui::Area::new(Id::new("tool-popup")).order(Order::Foreground).fixed_pos(pos).constrain(true).show(ctx, |ui| {
            Frame::popup(ui.style()).inner_margin(Margin::same(12)).show(ui, |ui| match popup {
                Popup::CardColor(id, _) => {
                    popup_title(ui, "Color");
                    let cur = self.board().card(id).map(|c| c.color).unwrap_or(0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        for (i, (name, _)) in CARD_COLORS.iter().enumerate() {
                            if swatch(ui, card_color(i), cur == i, name).clicked() {
                                self.set_card_color(id, i);
                            }
                        }
                    });
                }
                Popup::BoardColor(id, _) => {
                    popup_title(ui, "Board color");
                    let board = match self.board().card(id).map(|c| &c.content) {
                        Some(Content::Board { board }) => *board,
                        _ => return,
                    };
                    let cur = self.store.boards.get(&board).map(|b| b.color).unwrap_or(0);
                    for row in [0..7, 7..14] {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.0;
                            for i in row {
                                let (r, _) = ui.allocate_exact_size(vec2(30.0, 30.0), Sense::hover());
                                let resp = ui.interact(r, Id::new(("board-color", i)), Sense::click());
                                ui.painter().rect_filled(r.shrink(2.0), 7.0, board_color(i));
                                if cur == i {
                                    ui.painter().rect_stroke(r, 8.0, Stroke::new(2.0_f32, ink()), StrokeKind::Inside);
                                } else if resp.hovered() {
                                    ui.painter().rect_stroke(r, 8.0, Stroke::new(1.0_f32, muted()), StrokeKind::Inside);
                                }
                                if resp.on_hover_text(BOARD_COLORS[i].0).clicked() {
                                    self.set_card_color(id, i);
                                }
                            }
                        });
                    }
                    ui.add_space(4.0);
                    if ui.add(Button::new(RichText::new("Reset to default").size(12.5)).frame(false)).clicked() {
                        self.set_card_color(id, 0);
                    }
                }
                Popup::BoardIcon(id, _) => {
                    popup_title(ui, "Board icon");
                    ui.add(
                        TextEdit::singleline(&mut self.icon_query)
                            .id(Id::new("icon-search"))
                            .hint_text("Find an icon...")
                            .desired_width(8.0 * 34.0),
                    );
                    ui.add_space(4.0);
                    let q = self.icon_query.trim().to_lowercase();
                    let fid = font(22.0);
                    let icons: Vec<&(&str, &str)> = icons::BOARD_ICONS
                        .iter()
                        .filter(|(g, words)| (q.is_empty() || words.contains(&q)) && ui.fonts(|f| f.has_glyphs(&fid, g)))
                        .collect();
                    let mut pick: Option<Option<String>> = None;
                    for chunk in icons.chunks(8) {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 2.0;
                            for (g, words) in chunk {
                                let (r, _) = ui.allocate_exact_size(vec2(32.0, 32.0), Sense::hover());
                                let resp = ui.interact(r, Id::new(("board-icon", *g)), Sense::click());
                                if resp.hovered() {
                                    ui.painter().rect_filled(r, 6.0, hover_c());
                                }
                                ui.painter().text(r.center(), Align2::CENTER_CENTER, *g, fid.clone(), ink());
                                if resp.on_hover_text(*words).clicked() {
                                    pick = Some(Some(g.to_string()));
                                }
                            }
                        });
                    }
                    if icons.is_empty() {
                        ui.label(RichText::new("No icon matches").color(muted()).size(12.5));
                    }
                    ui.add_space(4.0);
                    if ui.add(Button::new(RichText::new("No icon").size(12.5)).frame(false)).clicked() {
                        pick = Some(None);
                    }
                    if let Some(p) = pick {
                        self.set_board_icon(id, p);
                    }
                }
                Popup::LineColor(a, _) => {
                    popup_title(ui, "Line color");
                    let cur = self.board().arrows.iter().find(|x| x.id == a).map(|x| x.color).unwrap_or(0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        for (i, (name, _)) in LINE_COLORS.iter().enumerate() {
                            if swatch(ui, line_color(i), cur == i, name).clicked() {
                                self.edit_arrow(a, |x| x.color = i);
                            }
                        }
                    });
                }
                Popup::LineWeight(a, _) => {
                    popup_title(ui, "Thickness");
                    let cur = self.board().arrows.iter().find(|x| x.id == a).map(|x| x.weight).unwrap_or(1);
                    for (w, name) in [(1u8, "Thin"), (2, "Medium"), (3, "Thick")] {
                        let (r, resp) = ui.allocate_exact_size(vec2(150.0, 28.0), Sense::click());
                        if cur == w {
                            ui.painter().rect_filled(r, 5.0, SELECT.gamma_multiply(0.16));
                        } else if resp.hovered() {
                            ui.painter().rect_filled(r, 5.0, hover_c());
                        }
                        ui.painter().line_segment(
                            [r.left_center() + vec2(10.0, 0.0), r.left_center() + vec2(60.0, 0.0)],
                            Stroke::new(canvas::line_width(w), ink()),
                        );
                        ui.painter().text(r.left_center() + vec2(74.0, 0.0), Align2::LEFT_CENTER, name, font(13.0), ink());
                        if resp.clicked() {
                            self.edit_arrow(a, |x| x.weight = w);
                        }
                    }
                }
                Popup::LineLabel(a, _) => {
                    popup_title(ui, "Label");
                    let r = ui.add(
                        TextEdit::singleline(&mut self.label_text)
                            .id(Id::new("line-label"))
                            .hint_text("Write a label...")
                            .desired_width(200.0),
                    );
                    if !r.has_focus() && !r.lost_focus() {
                        r.request_focus();
                    }
                    let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                    ui.horizontal(|ui| {
                        if ui.button("Done").clicked() || enter {
                            let t = self.label_text.trim().to_string();
                            self.edit_arrow(a, |x| x.label = t);
                            close = true;
                        }
                        if ui.add(Button::new("Clear").frame(false)).clicked() {
                            self.edit_arrow(a, |x| x.label.clear());
                            close = true;
                        }
                    });
                }
                _ => {}
            })
        });
        self.popup_rect = Some(resp.response.rect);
        if close {
            self.popup = None;
        }
    }

    /// Search and help, opened from the header.
    pub(super) fn header_popup(&mut self, ctx: &egui::Context) {
        let Some(p) = self.popup else { return };
        if !matches!(p, Popup::Search | Popup::Help) {
            return;
        }
        let pos = pos2(ctx.screen_rect().right() - 12.0, HEADER_H + 6.0);
        let mut go: Option<(BoardId, Option<CardId>)> = None;
        let resp =
            egui::Area::new(Id::new("header-popup")).order(Order::Foreground).pivot(Align2::RIGHT_TOP).fixed_pos(pos).show(ctx, |ui| {
                Frame::popup(ui.style()).inner_margin(Margin::same(10)).show(ui, |ui| {
                    ui.set_width(360.0);
                    if p == Popup::Help {
                        ui.label(RichText::new("Keyboard shortcuts").font(semibold_font(14.5)));
                        ui.add_space(4.0);
                        for (k, what) in [
                            ("Double-click", "Write a note / open a board"),
                            ("N", "New note"),
                            ("Enter", "Edit the selected card"),
                            ("Delete", "Move to the trash"),
                            ("Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"),
                            ("Ctrl+C, X, V", "Copy, cut, paste"),
                            ("Ctrl+D", "Duplicate"),
                            ("Ctrl+A", "Select everything"),
                            ("Ctrl+F", "Search"),
                            ("Scroll / Space+drag", "Move around"),
                            ("Ctrl+scroll, Ctrl+0", "Zoom, back to 100%"),
                            ("Ctrl+Shift+D", "Light or dark"),
                            ("Ctrl+Shift+< or >", "Interface size"),
                            ("Esc", "Finish / clear selection"),
                        ] {
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(what).size(13.0));
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    ui.label(RichText::new(k).size(12.0).color(muted()));
                                });
                            });
                        }
                        return;
                    }
                    let r = ui.add(
                        TextEdit::singleline(&mut self.search)
                            .id(Id::new("search"))
                            .hint_text("Search boards and cards")
                            .desired_width(f32::INFINITY)
                            .margin(vec2(8.0, 6.0)),
                    );
                    if std::mem::take(&mut self.focus_search) {
                        r.request_focus();
                    }
                    if r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
                        if let Some(h) = self.search_hits().into_iter().next() {
                            go = Some((h.board, h.card));
                        }
                    }
                    let hits = self.search_hits();
                    if self.search.trim().is_empty() {
                        ui.add_space(4.0);
                        ui.label(RichText::new("Type to find boards, notes, tasks and links on every board.").size(12.5).color(muted()));
                        return;
                    }
                    if hits.is_empty() {
                        ui.add_space(4.0);
                        ui.label(RichText::new("No matching boards or cards").color(muted()).size(13.0));
                        return;
                    }
                    egui::ScrollArea::vertical().max_height(380.0).show(ui, |ui| {
                        for h in &hits {
                            let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 44.0), Sense::click());
                            if resp.hovered() {
                                ui.painter().rect_filled(r, 5.0, hover_c());
                                ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                            }
                            let p = ui.painter();
                            let tag = Rect::from_min_size(r.min + vec2(6.0, 8.0), vec2(28.0, 28.0));
                            p.rect_filled(tag, 5.0, if h.kind == "Board" { pal().board_default } else { card_c() });
                            p.rect_stroke(tag, 5.0, Stroke::new(1.0_f32, border_c()), StrokeKind::Inside);
                            p.text(tag.center(), Align2::CENTER_CENTER, &h.kind[..1], semibold_font(12.5), ink());
                            let mut title = h.title.clone();
                            if title.chars().count() > 42 {
                                title = title.chars().take(42).collect::<String>() + "…";
                            }
                            p.text(r.min + vec2(44.0, 6.0), Align2::LEFT_TOP, title, semibold_font(13.5), ink());
                            p.text(r.min + vec2(44.0, 25.0), Align2::LEFT_TOP, format!("{} · {}", h.kind, h.snippet), font(12.0), muted());
                            if resp.clicked() {
                                go = Some((h.board, h.card));
                            }
                        }
                    });
                });
            });
        self.popup_rect = Some(resp.response.rect);
        if let Some((b, c)) = go {
            self.goto_hit(ctx, b, c);
        }
    }

    pub(super) fn context_menu(&mut self, ctx: &egui::Context) {
        let Some(menu) = &self.ctx_menu else {
            self.menu_rect = None;
            return;
        };
        let pos = menu.pos;
        let target = menu.target;
        let mut pick: Option<M> = None;
        let card = match target {
            MenuTarget::Card(id) => self.board().card(id).cloned(),
            _ => None,
        };
        let link_url = match card.as_ref().map(|c| &c.content) {
            Some(Content::Link { url, .. }) if !url.is_empty() => Some(url.clone()),
            _ => None,
        };
        let arrow = match target {
            MenuTarget::Arrow(a) => self.board().arrows.iter().find(|x| x.id == a).cloned(),
            _ => None,
        };
        let has_clip = !self.clipboard.is_empty();
        let resp = egui::Area::new(Id::new("ctx-menu")).order(Order::Foreground).fixed_pos(pos).constrain(true).show(ctx, |ui| {
            Frame::menu(ui.style()).show(ui, |ui| {
                ui.set_width(210.0);
                ui.spacing_mut().item_spacing.y = 1.0;
                match target {
                    MenuTarget::Card(id) => {
                        let Some(card) = &card else { return };
                        if let Content::Board { board } = &card.content {
                            if menu_item(ui, "Open board", "Double-click") {
                                pick = Some(M::Open(*board));
                            }
                            if menu_item(ui, "Rename", "") {
                                pick = Some(M::Edit(id));
                            }
                        } else if menu_item(ui, "Edit", "Enter") {
                            pick = Some(M::Edit(id));
                        }
                        if link_url.is_some() && menu_item(ui, "Open link", "") {
                            pick = Some(M::OpenLink);
                        }
                        ui.separator();
                        if menu_item(ui, "Duplicate", "Ctrl+D") {
                            pick = Some(M::Duplicate);
                        }
                        if menu_item(ui, "Copy", "Ctrl+C") {
                            pick = Some(M::Copy);
                        }
                        if card.container == Container::Canvas {
                            if menu_item(ui, "Bring to front", "") {
                                pick = Some(M::Front);
                            }
                            if menu_item(ui, "Send to back", "") {
                                pick = Some(M::Back);
                            }
                        }
                        if menu_item(ui, if card.locked { "Unlock" } else { "Lock in place" }, "") {
                            pick = Some(M::Lock(id, !card.locked));
                        }
                        if card.container == Container::Canvas {
                            if !matches!(card.content, Content::Column { .. }) && menu_item(ui, "Move to Unsorted", "") {
                                pick = Some(M::ToUnsorted);
                            }
                        } else if menu_item(ui, "Move onto the board", "") {
                            pick = Some(M::ToCanvas(id));
                        }
                        ui.separator();
                        if danger_item(ui, "Move to trash", "Delete") {
                            pick = Some(M::Delete);
                        }
                    }
                    MenuTarget::Canvas(w) => {
                        if menu_item(ui, "New note here", "Double-click") {
                            pick = Some(M::New(Tool::Note, w));
                        }
                        if menu_item(ui, "New to-do list here", "") {
                            pick = Some(M::New(Tool::Todo, w));
                        }
                        if menu_item(ui, "New board here", "") {
                            pick = Some(M::New(Tool::Board, w));
                        }
                        if menu_item(ui, "New column here", "") {
                            pick = Some(M::New(Tool::Column, w));
                        }
                        if menu_item(ui, "New line here", "") {
                            pick = Some(M::New(Tool::Line, w));
                        }
                        ui.separator();
                        if has_clip && menu_item(ui, "Paste", "Ctrl+V") {
                            pick = Some(M::Paste(w));
                        }
                        if menu_item(ui, "Paste picture", "") {
                            pick = Some(M::PastePicture(w));
                        }
                        if menu_item(ui, "Select all", "Ctrl+A") {
                            pick = Some(M::SelectAll);
                        }
                        if menu_item(ui, "Zoom to fit", "") {
                            pick = Some(M::Fit);
                        }
                    }
                    MenuTarget::Arrow(a) => {
                        let Some(ar) = &arrow else { return };
                        if (ar.from != 0 || ar.to != 0) && menu_item(ui, "Detach from cards", "") {
                            pick = Some(M::ArrowDetach(a));
                        }
                        if menu_item(ui, "Duplicate", "Ctrl+D") {
                            pick = Some(M::Duplicate);
                        }
                        ui.separator();
                        if danger_item(ui, "Delete line", "Delete") {
                            pick = Some(M::ArrowDelete(a));
                        }
                    }
                }
            });
        });
        self.menu_rect = Some(resp.response.rect);
        let Some(m) = pick else { return };
        self.ctx_menu = None;
        self.run_menu(ctx, m, link_url);
    }

    fn run_menu(&mut self, ctx: &egui::Context, m: M, link_url: Option<String>) {
        match m {
            M::Edit(id) => self.acts.push(Act::Edit(id)),
            M::Open(b) => self.open_board(ctx, b),
            M::OpenLink => {
                if let Some(u) = link_url {
                    self.acts.push(Act::OpenUrl(u));
                }
            }
            M::Duplicate => self.duplicate(),
            M::Copy => {
                self.copy_selection(ctx);
            }
            M::Front | M::Back => {
                self.checkpoint();
                let z = if matches!(m, M::Front) { self.board().max_z() + 1 } else { self.board().min_z() - 1 };
                let ids: Vec<CardId> = self.selected.iter().copied().collect();
                for id in ids {
                    if let Some(c) = self.board_mut().card_mut(id) {
                        c.z = z;
                    }
                }
                self.touch();
            }
            M::Lock(id, v) => {
                self.checkpoint();
                if let Some(c) = self.board_mut().card_mut(id) {
                    c.locked = v;
                }
                self.touch();
            }
            M::ToUnsorted => {
                self.checkpoint();
                let ids: Vec<CardId> = self.selected.iter().copied().collect();
                for id in ids {
                    if !matches!(self.board().card(id).map(|c| &c.content), Some(Content::Column { .. })) {
                        self.board_mut().attach_unsorted(id);
                    }
                }
                self.selected.clear();
                self.set_drawer(true);
                self.touch();
            }
            M::ToCanvas(id) => {
                self.checkpoint();
                let w = self.free_spot(vec2(300.0, 100.0));
                self.board_mut().detach(id);
                let z = self.board().max_z() + 1;
                if let Some(c) = self.board_mut().card_mut(id) {
                    c.pos = [(w.x - c.width / 2.0).round(), (w.y - 40.0).round()];
                    c.z = z;
                }
                self.touch();
            }
            M::Delete => self.delete_selection(ctx),
            M::New(t, w) => self.create(ctx, t, Place::At(w)),
            M::Paste(w) => self.paste_cards_at(w),
            M::PastePicture(w) => {
                self.paste_picture(w);
            }
            M::SelectAll => {
                self.selected = self.board().cards.iter().filter(|c| c.container == Container::Canvas).map(|c| c.id).collect();
            }
            M::Fit => self.fit(),
            M::ArrowDetach(a) => {
                let geom = self.board().arrows.iter().find(|x| x.id == a).and_then(|x| self.arrow_geom(x));
                if let Some((p1, p2)) = geom {
                    self.edit_arrow(a, |x| {
                        x.from = 0;
                        x.to = 0;
                        x.from_pt = Some([p1.x, p1.y]);
                        x.to_pt = Some([p2.x, p2.y]);
                    });
                }
            }
            M::ArrowDelete(a) => {
                self.checkpoint();
                self.board_mut().arrows.retain(|x| x.id != a);
                self.selected_arrow = None;
                self.touch();
            }
        }
    }

    pub(super) fn trash_window(&mut self, ctx: &egui::Context) {
        if !self.show_trash {
            return;
        }
        let mut open = true;
        let mut restore: Option<u64> = None;
        let mut purge: Option<u64> = None;
        let mut empty = false;
        egui::Window::new(RichText::new("Trash").font(semibold_font(16.0)))
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .default_width(440.0)
            .anchor(Align2::CENTER_CENTER, vec2(0.0, 0.0))
            .frame(Frame::window(&ctx.style()).inner_margin(Margin::same(16)))
            .show(ctx, |ui| {
                ui.set_width(440.0);
                ui.label(RichText::new("Deleted cards stay here until you delete them for good.").size(12.5).color(muted()));
                ui.add_space(8.0);
                if self.store.trash.is_empty() {
                    ui.add_space(20.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("The trash is empty").color(muted())));
                    ui.add_space(20.0);
                    return;
                }
                egui::ScrollArea::vertical().max_height(380.0).show(ui, |ui| {
                    for item in self.store.trash.iter().rev() {
                        let Some(first) = item.cards.first() else { continue };
                        let kind = first.content.kind_name();
                        let mut title = plain_title(&card_text(&self.store, first));
                        if title.is_empty() {
                            title = format!("Empty {}", kind.to_lowercase());
                        }
                        if title.chars().count() > 46 {
                            title = title.chars().take(46).collect::<String>() + "…";
                        }
                        let board = self.store.boards.get(&item.board).map(|b| b.name.clone()).unwrap_or_else(|| "a deleted board".into());
                        Frame::NONE.stroke(Stroke::new(1.0_f32, border_c())).corner_radius(6).inner_margin(Margin::symmetric(12, 8)).show(
                            ui,
                            |ui| {
                                ui.set_width(ui.available_width());
                                ui.horizontal(|ui| {
                                    ui.vertical(|ui| {
                                        ui.spacing_mut().item_spacing.y = 2.0;
                                        ui.label(RichText::new(title).font(semibold_font(13.5)));
                                        let extra = if item.cards.len() > 1 {
                                            format!(" · with {} cards", item.cards.len() - 1)
                                        } else {
                                            String::new()
                                        };
                                        ui.label(
                                            RichText::new(format!("{kind} from {board} · {}{extra}", ago(item.deleted_at)))
                                                .size(12.0)
                                                .color(muted()),
                                        );
                                    });
                                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                        if ui
                                            .add(Button::new(RichText::new("Delete forever").size(12.5).color(DANGER)).frame(false))
                                            .clicked()
                                        {
                                            purge = Some(item.id);
                                        }
                                        if ui.add(Button::new(RichText::new("Restore").size(12.5))).clicked() {
                                            restore = Some(item.id);
                                        }
                                    });
                                });
                            },
                        );
                        ui.add_space(6.0);
                    }
                });
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    ui.add_space(ui.available_width() - 100.0);
                    if ui.add(Button::new(RichText::new("Empty trash").size(13.0).color(DANGER))).clicked() {
                        empty = true;
                    }
                });
            });
        if !open {
            self.show_trash = false;
        }
        if let Some(id) = restore {
            self.checkpoint();
            if let Some(b) = self.store.restore(id) {
                let name = self.store.board(b).name.clone();
                self.toast(format!("Restored to {name}"), false);
            }
            self.touch();
        }
        if let Some(id) = purge {
            self.checkpoint();
            self.store.purge(id);
            self.touch();
        }
        if empty {
            self.empty_trash();
        }
    }

    pub(super) fn empty_trash(&mut self) {
        self.checkpoint();
        let ids: Vec<u64> = self.store.trash.iter().map(|t| t.id).collect();
        for id in ids {
            self.store.purge(id);
        }
        self.touch();
        self.toast("The trash was emptied", true);
    }

    pub(super) fn ghosts(&mut self, ctx: &egui::Context) {
        let Some(p) = ctx.pointer_latest_pos() else { return };
        let label = if let Some(t) = self.tool_drag {
            Some(t.name().to_string())
        } else if let Some(d) = &self.drag {
            if !self.canvas_rect.contains(p) {
                Some(if d.ids.len() == 1 { "1 card".to_string() } else { format!("{} cards", d.ids.len()) })
            } else {
                None
            }
        } else {
            None
        };
        let Some(label) = label else { return };
        ctx.set_cursor_icon(CursorIcon::Grabbing);
        egui::Area::new(Id::new("ghost")).order(Order::Tooltip).fixed_pos(p + vec2(-20.0, -14.0)).interactable(false).show(ctx, |ui| {
            Frame::NONE
                .fill(card_c().gamma_multiply(0.94))
                .stroke(Stroke::new(1.5_f32, SELECT))
                .corner_radius(3)
                .shadow(egui::Shadow { offset: [0, 3], blur: 10, spread: 0, color: Color32::from_black_alpha(30) })
                .inner_margin(Margin::symmetric(14, 10))
                .show(ui, |ui| {
                    ui.set_min_width(120.0);
                    ui.label(RichText::new(label).font(semibold_font(13.5)));
                });
        });
    }

    pub(super) fn toast_ui(&mut self, ctx: &egui::Context) {
        let Some(t) = &self.toast else { return };
        if self.now > t.until {
            self.toast = None;
            return;
        }
        let text = t.text.clone();
        let with_undo = t.undo && !self.undo.is_empty();
        let mut undo = false;
        ctx.request_repaint_after(std::time::Duration::from_millis(250));
        egui::Area::new(Id::new("toast"))
            .order(Order::Foreground)
            .pivot(Align2::CENTER_BOTTOM)
            .fixed_pos(self.canvas_rect.center_bottom() - vec2(0.0, 22.0))
            .show(ctx, |ui| {
                Frame::NONE
                    .fill(Color32::from_rgb(0x2F, 0x32, 0x37))
                    .corner_radius(6)
                    .inner_margin(Margin::symmetric(16, 9))
                    .shadow(egui::Shadow { offset: [0, 4], blur: 14, spread: 0, color: Color32::from_black_alpha(40) })
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(text).color(Color32::WHITE).size(13.5));
                            if with_undo {
                                ui.add_space(8.0);
                                if ui.add(Button::new(RichText::new("Undo").color(ACCENT).font(semibold_font(13.5))).frame(false)).clicked()
                                {
                                    undo = true;
                                }
                            }
                        });
                    });
            });
        if undo {
            self.undo(ctx);
            self.toast = None;
        }
    }
}
