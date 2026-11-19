//! The header, the toolbar (which changes with what's selected), the Unsorted drawer and pill,
//! and the zoom controls.

use super::*;
use crate::icons;
use eframe::egui::{
    Align, Align2, Button, Color32, CursorIcon, Frame, Label, LayerId, Layout, Margin, Order, RichText, Sense, Stroke, StrokeKind,
};

/// What the left toolbar shows.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Mode {
    Default,
    Card(CardId),
    Line(u64),
    Multi,
}

impl App {
    pub(super) fn toolbar_mode(&self) -> Mode {
        if let Some(a) = self.selected_arrow {
            if self.board().arrows.iter().any(|x| x.id == a) {
                return Mode::Line(a);
            }
        }
        match self.selected.len() {
            0 => Mode::Default,
            1 => {
                let id = *self.selected.iter().next().unwrap();
                if self.board().card(id).is_some() {
                    Mode::Card(id)
                } else {
                    Mode::Default
                }
            }
            _ => Mode::Multi,
        }
    }

    fn icon_button(ui: &mut egui::Ui, name: &str, tip: &str, enabled: bool) -> egui::Response {
        let (r, resp) = ui.allocate_exact_size(vec2(34.0, 34.0), if enabled { Sense::click() } else { Sense::hover() });
        let t = ui.ctx().animate_bool_with_time(resp.id.with("hover"), resp.hovered() && enabled, 0.1);
        if t > 0.0 {
            ui.painter().rect_filled(r.shrink(2.0), 6.0, hover_c().gamma_multiply(t));
        }
        let col = if enabled { pal().icon } else { pal().faint };
        icons::paint(ui.painter(), name, r.center(), col, !enabled);
        if resp.hovered() && enabled {
            ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
        }
        resp.on_hover_text(tip)
    }

    pub(super) fn top_bar(&mut self, ctx: &egui::Context) {
        let resp = egui::TopBottomPanel::top("top-bar")
            .exact_height(HEADER_H)
            .show_separator_line(false)
            .frame(Frame::NONE.fill(pal().header).inner_margin(Margin::symmetric(12, 0)))
            .show(ctx, |ui| {
                ui.horizontal_centered(|ui| {
                    let (r, _) = ui.allocate_exact_size(vec2(22.0, 22.0), Sense::hover());
                    icons::logo(ui.painter(), r.center());
                    ui.add_space(4.0);
                    // where we are: Home / board / board
                    let path = self.store.path(self.current);
                    let n = path.len();
                    for (i, b) in path.iter().enumerate() {
                        let name = self.store.board(*b).name.clone();
                        if i + 1 == n {
                            ui.add(Label::new(RichText::new(name).font(semibold_font(14.0))).truncate());
                        } else {
                            let r = ui.add(Button::new(RichText::new(name).color(muted()).size(14.0)).frame(false));
                            if r.on_hover_text("Go to this board").clicked() {
                                let b = *b;
                                self.open_board(ctx, b);
                            }
                            ui.label(RichText::new("/").color(pal().faint));
                        }
                    }

                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        ui.spacing_mut().item_spacing.x = 2.0;
                        if Self::icon_button(ui, "Settings", "Settings", true).clicked() {
                            self.settings_open = true;
                            self.popup = None;
                        }
                        let s = Self::icon_button(ui, "Search", "Search  (Ctrl+F)", true);
                        if s.clicked() {
                            self.popup = if self.popup == Some(Popup::Search) { None } else { Some(Popup::Search) };
                            self.focus_search = true;
                        }
                        if Self::icon_button(ui, "Help", "Help and shortcuts", true).clicked() {
                            self.popup = if self.popup == Some(Popup::Help) { None } else { Some(Popup::Help) };
                        }
                        ui.add_space(6.0);
                        let (sep, _) = ui.allocate_exact_size(vec2(1.0, 20.0), Sense::hover());
                        ui.painter().rect_filled(sep, 0.0, pal().divider);
                        ui.add_space(6.0);
                        if Self::icon_button(ui, "Redo", "Redo  (Ctrl+Shift+Z)", !self.redo.is_empty()).clicked() {
                            self.redo(ctx);
                        }
                        if Self::icon_button(ui, "Undo", "Undo  (Ctrl+Z)", !self.undo.is_empty()).clicked() {
                            self.undo(ctx);
                        }
                        ui.add_space(10.0);
                        let (txt, col) = if self.shot.is_some() {
                            ("", muted())
                        } else if self.save_error {
                            ("Couldn't save", DANGER)
                        } else if self.dirty {
                            ("Saving…", muted())
                        } else {
                            ("Saved", muted())
                        };
                        ui.label(RichText::new(txt).size(12.0).color(col));
                    });
                });
            });
        let r = resp.response.rect;
        ctx.layer_painter(LayerId::new(Order::Middle, Id::new("header-line"))).hline(
            r.x_range(),
            r.bottom() - 0.5,
            Stroke::new(1.0_f32, pal().divider),
        );
    }

    /// One toolbar entry: an icon over a short label.
    fn tool_item(
        ui: &mut egui::Ui,
        icon: &str,
        label: &str,
        active: bool,
        enabled: bool,
        tip: &str,
        swatch: Option<Color32>,
    ) -> egui::Response {
        let (r, _) = ui.allocate_exact_size(vec2(TOOLBAR_W, 58.0), Sense::hover());
        let resp = ui.interact(r, Id::new(("tool", label)), if enabled { Sense::click_and_drag() } else { Sense::hover() });
        let t = ui.ctx().animate_bool_with_time(resp.id.with("hover"), resp.hovered() && enabled, 0.1);
        let bgr = r.shrink2(vec2(6.0, 1.0));
        if active {
            ui.painter().rect_filled(bgr, 6.0, SELECT.gamma_multiply(0.16));
        } else if t > 0.0 {
            ui.painter().rect_filled(bgr, 6.0, hover_c().gamma_multiply(t));
        }
        let c = r.center_top() + vec2(0.0, 22.0);
        let col = if !enabled {
            pal().faint
        } else if active {
            SELECT
        } else {
            pal().icon
        };
        if let Some(sw) = swatch {
            let b = Rect::from_center_size(c, vec2(22.0, 22.0));
            ui.painter().rect_filled(b, 4.0, sw);
            ui.painter().rect_stroke(b, 4.0, Stroke::new(1.0_f32, Color32::from_black_alpha(40)), StrokeKind::Inside);
        } else {
            icons::paint(ui.painter(), icon, c, col, !enabled);
        }
        let lc = if !enabled {
            pal().faint
        } else if active {
            SELECT
        } else {
            muted()
        };
        ui.painter().text(r.center_bottom() - vec2(0.0, 11.0), Align2::CENTER_CENTER, label, font(11.5), lc);
        if resp.hovered() && enabled {
            ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
        }
        resp.on_hover_text(tip)
    }

    fn separator(ui: &mut egui::Ui) {
        let (r, _) = ui.allocate_exact_size(vec2(TOOLBAR_W, 12.0), Sense::hover());
        ui.painter().hline((r.left() + 18.0)..=(r.right() - 18.0), r.center().y, Stroke::new(1.0_f32, pal().divider));
    }

    pub(super) fn toolbar(&mut self, ctx: &egui::Context) {
        let mode = self.toolbar_mode();
        let resp = egui::SidePanel::left("toolbar")
            .exact_width(TOOLBAR_W)
            .resizable(false)
            .show_separator_line(false)
            .frame(Frame::NONE.fill(pal().toolbar).inner_margin(Margin { left: 0, right: 0, top: 6, bottom: 6 }))
            .show(ctx, |ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                match mode {
                    Mode::Default => self.default_tools(ctx, ui),
                    other => self.context_tools(ctx, ui, other),
                }
                ui.with_layout(Layout::bottom_up(Align::Center), |ui| {
                    let n = self.store.trash.len();
                    let r = Self::tool_item(ui, "Trash", "Trash", self.show_trash, true, "Deleted cards, ready to restore", None);
                    if n > 0 {
                        let c = r.rect.right_top() + vec2(-18.0, 10.0);
                        ui.painter().circle_filled(c, 7.5, DANGER);
                        ui.painter().text(c, Align2::CENTER_CENTER, n.min(99).to_string(), font(10.0), Color32::WHITE);
                    }
                    if r.clicked() {
                        self.show_trash = !self.show_trash;
                    }
                });
            });
        let r = resp.response.rect;
        ctx.layer_painter(LayerId::new(Order::Middle, Id::new("toolbar-line"))).vline(
            r.right() - 0.5,
            r.y_range(),
            Stroke::new(1.0_f32, pal().divider),
        );
    }

    fn default_tools(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        for entry in TOOLS {
            let Some(tool) = entry else {
                Self::separator(ui);
                continue;
            };
            if !self.prefs.tool_visible(tool.name()) {
                continue;
            }
            let tip = if !tool.available() {
                "Not available in this version yet"
            } else if tool == Tool::Line {
                "Click or drag to add a line, then drag its ends onto cards"
            } else if matches!(tool, Tool::AddImage | Tool::Upload) {
                "Click to choose a file"
            } else {
                "Click to add, or drag onto the board"
            };
            let r = Self::tool_item(ui, tool.name(), tool.name(), false, tool.available(), tip, None);
            if r.clicked() {
                let at = self.free_spot(Self::default_size(tool));
                self.create(ctx, tool, Place::At(at));
            }
            if r.drag_started() && tool.available() && !matches!(tool, Tool::AddImage | Tool::Upload) {
                self.tool_drag = Some(tool);
            }
        }
    }

    fn back_item(&mut self, ui: &mut egui::Ui) {
        let (r, _) = ui.allocate_exact_size(vec2(TOOLBAR_W, 30.0), Sense::hover());
        let resp = ui.interact(r, Id::new("tool-back"), Sense::click());
        if resp.hovered() {
            ui.painter().rect_filled(r.shrink2(vec2(6.0, 1.0)), 6.0, hover_c());
        }
        icons::paint(ui.painter(), "Back", r.center(), pal().icon, false);
        ui.painter().hline((r.left() + 8.0)..=(r.right() - 8.0), r.bottom() + 3.0, Stroke::new(1.0_f32, pal().divider));
        ui.add_space(8.0);
        if resp.on_hover_text("Back to all tools").clicked() {
            self.selected.clear();
            self.selected_arrow = None;
            self.popup = None;
            self.editing = None;
        }
    }

    fn toggle_popup(&mut self, p: Popup) {
        self.popup = if self.popup == Some(p) { None } else { Some(p) };
    }

    fn context_tools(&mut self, ctx: &egui::Context, ui: &mut egui::Ui, mode: Mode) {
        self.back_item(ui);
        match mode {
            Mode::Card(id) => {
                let Some(card) = self.board().card(id).cloned() else { return };
                match &card.content {
                    Content::Board { board } => {
                        let (color, _) = self.store.boards.get(board).map(|b| (b.color, b.icon.clone())).unwrap_or((0, None));
                        let r = Self::tool_item(
                            ui,
                            "Color",
                            "Color",
                            matches!(self.popup, Some(Popup::BoardColor(..))),
                            true,
                            "Board color",
                            Some(board_color(color)),
                        );
                        if r.clicked() {
                            self.toggle_popup(Popup::BoardColor(id, r.rect.top()));
                        }
                        let r =
                            Self::tool_item(ui, "Icon", "Icon", matches!(self.popup, Some(Popup::BoardIcon(..))), true, "Board icon", None);
                        if r.clicked() {
                            self.toggle_popup(Popup::BoardIcon(id, r.rect.top()));
                        }
                        if Self::tool_item(ui, "Rename", "Rename", self.editing == Some(id), true, "Rename the board", None).clicked() {
                            self.acts.push(Act::Edit(id));
                        }
                        if Self::tool_item(ui, "Open", "Open", false, true, "Open the board (or double-click it)", None).clicked() {
                            let b = *board;
                            self.open_board(ctx, b);
                        }
                    }
                    Content::Note { .. } | Content::Todo { .. } | Content::Link { .. } => {
                        let r = Self::tool_item(
                            ui,
                            "Color",
                            "Color",
                            matches!(self.popup, Some(Popup::CardColor(..))),
                            true,
                            "Card color",
                            Some(card_color(card.color)),
                        );
                        if r.clicked() {
                            self.toggle_popup(Popup::CardColor(id, r.rect.top()));
                        }
                        if let Content::Todo { items, .. } = &card.content {
                            if Self::tool_item(ui, "Add task", "Add task", false, true, "Add a task at the end", None).clicked() {
                                let n = items.len();
                                self.checkpoint();
                                if let Some(Card { content: Content::Todo { items, .. }, .. }) = self.board_mut().card_mut(id) {
                                    items.push(TodoItem { text: String::new(), done: false });
                                }
                                self.editing = Some(id);
                                self.next_focus = Some((id, n));
                                self.touch();
                            }
                        }
                        if let Content::Link { url, .. } = &card.content {
                            if Self::tool_item(ui, "Open", "Open", false, !url.is_empty(), "Open in your browser", None).clicked() {
                                self.acts.push(Act::OpenUrl(url.clone()));
                            }
                        }
                        if Self::tool_item(ui, "Edit", "Edit", self.editing == Some(id), true, "Edit  (Enter or double-click)", None)
                            .clicked()
                        {
                            self.acts.push(Act::Edit(id));
                        }
                        if matches!(card.content, Content::Note { .. }) {
                            let label = ["Left", "Centre", "Right"][card.align.min(2) as usize];
                            if Self::tool_item(ui, "Align", label, false, true, "Text alignment", None).clicked() {
                                self.cycle_align(id);
                            }
                        }
                    }
                    Content::Image { .. } => {
                        if Self::tool_item(ui, "Caption", "Caption", self.editing == Some(id), true, "Write a caption", None).clicked() {
                            self.acts.push(Act::Edit(id));
                        }
                        if Self::tool_item(ui, "Replace", "Replace", false, true, "Choose another picture", None).clicked() {
                            self.replace_picture(id);
                        }
                    }
                    Content::Column { children, .. } => {
                        if Self::tool_item(ui, "Rename", "Rename", self.editing == Some(id), true, "Rename the column", None).clicked() {
                            self.acts.push(Act::Edit(id));
                        }
                        if Self::tool_item(ui, "Add note", "Add note", false, true, "Add a note to the bottom of the column", None)
                            .clicked()
                        {
                            let n = children.len();
                            self.create(ctx, Tool::Note, Place::Column(id, n));
                        }
                    }
                }
                if Self::tool_item(ui, "Duplicate", "Duplicate", false, true, "Duplicate  (Ctrl+D)", None).clicked() {
                    self.duplicate();
                }
                let r = Self::tool_item(ui, "More", "More", self.ctx_menu.is_some(), true, "More actions", None);
                if r.clicked() {
                    self.ctx_menu =
                        Some(CtxMenu { pos: r.rect.right_top() + vec2(4.0, 0.0), target: MenuTarget::Card(id), frame: self.frame_no });
                }
            }
            Mode::Line(a) => {
                let Some(ar) = self.board().arrows.iter().find(|x| x.id == a).cloned() else { return };
                let r = Self::tool_item(
                    ui,
                    "Color",
                    "Color",
                    matches!(self.popup, Some(Popup::LineColor(..))),
                    true,
                    "Line color",
                    Some(line_color(ar.color)),
                );
                if r.clicked() {
                    self.toggle_popup(Popup::LineColor(a, r.rect.top()));
                }
                if Self::tool_item(ui, "Start", "Start", ar.head_start, true, "Arrowhead at the start", None).clicked() {
                    self.edit_arrow(a, |x| x.head_start = !x.head_start);
                }
                if Self::tool_item(ui, "End", "End", ar.head, true, "Arrowhead at the end", None).clicked() {
                    self.edit_arrow(a, |x| x.head = !x.head);
                }
                let r = Self::tool_item(
                    ui,
                    "Label",
                    "Label",
                    matches!(self.popup, Some(Popup::LineLabel(..))),
                    true,
                    "Write a label on the line",
                    None,
                );
                if r.clicked() {
                    self.label_text = ar.label.clone();
                    self.toggle_popup(Popup::LineLabel(a, r.rect.top()));
                }
                if Self::tool_item(ui, "Dashed", "Dashed", ar.dashed, true, "Dashed or solid", None).clicked() {
                    self.edit_arrow(a, |x| x.dashed = !x.dashed);
                }
                let r = Self::tool_item(
                    ui,
                    "Weight",
                    "Weight",
                    matches!(self.popup, Some(Popup::LineWeight(..))),
                    true,
                    "Line thickness",
                    None,
                );
                if r.clicked() {
                    self.toggle_popup(Popup::LineWeight(a, r.rect.top()));
                }
                if Self::tool_item(ui, "Delete", "Delete", false, true, "Delete the line  (Delete)", None).clicked() {
                    self.delete_selection(ctx);
                }
            }
            Mode::Multi => {
                if Self::tool_item(ui, "Duplicate", "Duplicate", false, true, "Duplicate  (Ctrl+D)", None).clicked() {
                    self.duplicate();
                }
                if Self::tool_item(ui, "Delete", "Delete", false, true, "Move to the trash  (Delete)", None).clicked() {
                    self.delete_selection(ctx);
                }
            }
            Mode::Default => {}
        }
    }

    pub(super) fn drawer(&mut self, ctx: &egui::Context) {
        let open = self.prefs.drawer_open;
        let resp = egui::SidePanel::right("unsorted")
            .exact_width(DRAWER_CARD_W + 32.0)
            .resizable(false)
            .show_separator_line(false)
            .frame(Frame::NONE.fill(pal().toolbar).inner_margin(Margin::symmetric(16, 12)))
            .show_animated(ctx, open, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Unsorted").font(semibold_font(15.0)));
                    ui.label(RichText::new(self.board().unsorted.len().to_string()).size(12.5).color(muted()));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let (r, resp) = ui.allocate_exact_size(vec2(26.0, 26.0), Sense::click());
                        if resp.hovered() {
                            ui.painter().rect_filled(r, 5.0, hover_c());
                        }
                        icons::paint(ui.painter(), "Close", r.center(), pal().icon, false);
                        if resp.on_hover_text("Close the drawer").clicked() {
                            self.set_drawer(false);
                        }
                    });
                });
                ui.label(RichText::new("Cards waiting for a place. Drag them onto the board.").size(12.5).color(muted()));
                ui.add_space(6.0);
                if ui.add(Button::new(RichText::new("+  Quick note").size(13.5)).min_size(vec2(DRAWER_CARD_W, 32.0))).clicked() {
                    self.create(ctx, Tool::Note, Place::Unsorted);
                }
                ui.add_space(10.0);
                self.drawer_rects.clear();
                egui::ScrollArea::vertical().auto_shrink([false, false]).drag_to_scroll(false).show(ui, |ui| {
                    let ids = self.board().unsorted.clone();
                    for id in ids {
                        let min = ui.cursor().min;
                        let h = self.render_card(ui, id, min, DRAWER_CARD_W, None, true);
                        self.drawer_rects.insert(id, Rect::from_min_size(min, vec2(DRAWER_CARD_W, h)));
                        ui.allocate_space(vec2(DRAWER_CARD_W, h));
                        ui.add_space(10.0);
                    }
                    if self.board().unsorted.is_empty() {
                        ui.add_space(20.0);
                        ui.vertical_centered(|ui| {
                            ui.label(RichText::new("Nothing here yet").color(muted()).size(13.0));
                        });
                    }
                });
            });
        match resp {
            Some(r) => {
                let r = r.response.rect;
                self.drawer_rect = Some(r);
                ctx.layer_painter(LayerId::new(Order::Middle, Id::new("drawer-line"))).vline(
                    r.left() + 0.5,
                    r.y_range(),
                    Stroke::new(1.0_f32, pal().divider),
                );
                if self.drop_unsorted {
                    ctx.layer_painter(LayerId::new(Order::Foreground, Id::new("drawer-drop"))).rect_stroke(
                        r.shrink(2.0),
                        6.0,
                        Stroke::new(2.0_f32, SELECT),
                        StrokeKind::Inside,
                    );
                }
            }
            None => {
                self.drawer_rect = None;
                self.drawer_rects.clear();
            }
        }
    }

    /// The small "N Unsorted" control at the top right of the board, shown while the drawer is closed.
    pub(super) fn unsorted_pill(&mut self, ctx: &egui::Context) {
        if self.prefs.drawer_open {
            return;
        }
        let n = self.board().unsorted.len();
        let dropping = self.drag.is_some() || self.tool_drag.is_some();
        egui::Area::new(Id::new("unsorted-pill"))
            .order(Order::Middle)
            .pivot(Align2::RIGHT_TOP)
            .fixed_pos(self.canvas_rect.right_top() + vec2(-12.0, 12.0))
            .show(ctx, |ui| {
                let galley_n = ui.painter().layout_no_wrap(n.to_string(), semibold_font(12.5), ink());
                let galley_t = ui.painter().layout_no_wrap("Unsorted".into(), font(12.5), muted());
                let size = vec2(galley_n.size().x + galley_t.size().x + 24.0, 26.0);
                let (r, _) = ui.allocate_exact_size(size, Sense::hover());
                let resp = ui.interact(r, Id::new("unsorted-pill-btn"), Sense::click());
                let fill = if resp.hovered() || dropping { hover_c() } else { canvas_c() };
                ui.painter().rect_filled(r, 4.0, fill);
                ui.painter().rect_stroke(r, 4.0, Stroke::new(1.0_f32, pal().divider), StrokeKind::Inside);
                let y = r.center().y - galley_n.size().y / 2.0;
                let x0 = r.left() + 10.0;
                let wn = galley_n.size().x;
                ui.painter().galley(pos2(x0, y), galley_n, ink());
                ui.painter().galley(pos2(x0 + wn + 4.0, y), galley_t, muted());
                if resp.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                }
                if resp.on_hover_text("Open the Unsorted drawer").clicked() {
                    self.set_drawer(true);
                }
            });
    }

    pub(super) fn zoom_controls(&mut self, ctx: &egui::Context) {
        let pos = self.canvas_rect.right_bottom() - vec2(14.0, 14.0);
        egui::Area::new(Id::new("zoom")).order(Order::Middle).pivot(Align2::RIGHT_BOTTOM).fixed_pos(pos).show(ctx, |ui| {
            Frame::popup(ui.style()).inner_margin(Margin::same(3)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 2.0;
                    let z = self.zoom();
                    let small = |t: &str, s: f32| Button::new(RichText::new(t).size(s)).frame(false);
                    if ui.add(small("−", 15.0).min_size(vec2(26.0, 24.0))).on_hover_text("Zoom out  (Ctrl+−)").clicked() {
                        self.set_zoom_centered((z / 1.2).max(MIN_ZOOM));
                    }
                    let pct = format!("{:.0}%", z * 100.0);
                    if ui.add(small(&pct, 12.0).min_size(vec2(44.0, 24.0))).on_hover_text("Back to 100%  (Ctrl+0)").clicked() {
                        self.set_zoom_centered(1.0);
                    }
                    if ui.add(small("+", 15.0).min_size(vec2(26.0, 24.0))).on_hover_text("Zoom in  (Ctrl+=)").clicked() {
                        self.set_zoom_centered((z * 1.2).min(MAX_ZOOM));
                    }
                    let (sep, _) = ui.allocate_exact_size(vec2(1.0, 16.0), Sense::hover());
                    ui.painter().rect_filled(sep, 0.0, border_c());
                    if ui.add(small("Fit", 12.0).min_size(vec2(32.0, 24.0))).on_hover_text("Show everything on this board").clicked() {
                        self.fit();
                    }
                });
            });
        });
    }
}
