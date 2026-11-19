//! Keys, clipboard, dropped files, dragging, the theme and size, the screenshot option and the frame loop.

use super::*;
use eframe::egui::{Frame, Key};

impl App {
    fn close_popups_on_outside_click(&mut self, ctx: &egui::Context) {
        let (pressed, pos) = ctx.input(|i| (i.pointer.any_pressed(), i.pointer.interact_pos()));
        if !pressed {
            return;
        }
        let Some(p) = pos else { return };
        if let Some(m) = &self.ctx_menu {
            if m.frame < self.frame_no && !self.menu_rect.map(|r| r.contains(p)).unwrap_or(false) {
                self.ctx_menu = None;
            }
        }
        if self.popup.is_some() {
            let inside = self.popup_rect.map(|r| r.contains(p)).unwrap_or(false);
            // the toolbar and header buttons open and close popups themselves
            let on_chrome = p.x < TOOLBAR_W || p.y < HEADER_H;
            if !inside && !on_chrome {
                self.popup = None;
            }
        }
    }

    pub(super) fn toggle_theme(&mut self) {
        let dark = !self.applied_dark.unwrap_or(false);
        self.prefs.theme = if dark { ThemePref::Dark } else { ThemePref::Light };
        self.prefs.manual_dark = dark;
        self.prefs_dirty = true;
    }

    pub(super) fn set_scale(&mut self, s: usize) {
        self.prefs.scale = s.min(2);
        self.prefs_dirty = true;
    }

    /// Follow the chosen theme and interface size.
    fn apply_appearance(&mut self, ctx: &egui::Context) {
        let dark = match self.prefs.theme {
            ThemePref::Light => false,
            ThemePref::Dark => true,
            ThemePref::System => ctx.input(|i| i.raw.system_theme) == Some(egui::Theme::Dark),
        };
        if self.applied_dark != Some(dark) {
            set_dark(dark);
            setup_style(ctx);
            self.applied_dark = Some(dark);
        }
        set_bold_headings(self.prefs.bold_headings);
        if self.applied_scale != Some(self.prefs.scale) {
            ctx.set_zoom_factor(SCALES[self.prefs.scale.min(2)].1);
            self.applied_scale = Some(self.prefs.scale);
        }
    }

    fn handle_keys(&mut self, ctx: &egui::Context) {
        let typing = ctx.wants_keyboard_input();
        let events = ctx.input(|i| i.events.clone());
        for e in events {
            match e {
                egui::Event::Key { key, pressed: true, modifiers, .. } => {
                    let cmd = modifiers.command;
                    if key == Key::Escape {
                        if self.settings_open {
                            self.settings_open = false;
                        } else if self.editing.is_some() {
                            self.stop_editing(ctx);
                        } else if self.ctx_menu.is_some() {
                            self.ctx_menu = None;
                        } else if self.popup.is_some() {
                            self.popup = None;
                        } else {
                            self.selected.clear();
                            self.selected_arrow = None;
                            self.connect = None;
                        }
                        continue;
                    }
                    if cmd && modifiers.shift && key == Key::D {
                        self.toggle_theme();
                        continue;
                    }
                    if cmd && modifiers.shift && matches!(key, Key::Comma | Key::Period) {
                        let s = self.prefs.scale;
                        self.set_scale(if key == Key::Comma { s.saturating_sub(1) } else { s + 1 });
                        continue;
                    }
                    if cmd && key == Key::F {
                        self.popup = Some(Popup::Search);
                        self.focus_search = true;
                        continue;
                    }
                    if typing || self.settings_open {
                        continue;
                    }
                    match key {
                        Key::Delete | Key::Backspace => self.delete_selection(ctx),
                        Key::Z if cmd && modifiers.shift => self.redo(ctx),
                        Key::Z if cmd => self.undo(ctx),
                        Key::Y if cmd => self.redo(ctx),
                        Key::D if cmd => self.duplicate(),
                        Key::A if cmd => {
                            self.selected = self.board().cards.iter().filter(|c| c.container == Container::Canvas).map(|c| c.id).collect();
                            self.selected_arrow = None;
                        }
                        Key::Enter if self.selected.len() == 1 => {
                            let id = *self.selected.iter().next().unwrap();
                            self.acts.push(Act::Edit(id));
                        }
                        Key::Num0 if cmd => self.set_zoom_centered(1.0),
                        Key::Plus | Key::Equals if cmd => {
                            let z = self.zoom();
                            self.set_zoom_centered((z * 1.2).min(MAX_ZOOM));
                        }
                        Key::Minus if cmd => {
                            let z = self.zoom();
                            self.set_zoom_centered((z / 1.2).max(MIN_ZOOM));
                        }
                        Key::N if !cmd => {
                            let w = self.free_spot(vec2(300.0, 60.0));
                            self.create(ctx, Tool::Note, Place::At(w));
                        }
                        _ => {}
                    }
                }
                egui::Event::Copy if !typing => {
                    self.copy_selection(ctx);
                }
                egui::Event::Cut if !typing => {
                    if self.copy_selection(ctx) {
                        self.delete_selection(ctx);
                    }
                }
                egui::Event::Paste(s) if !typing => self.paste(ctx, &s),
                _ => {}
            }
        }
    }

    fn handle_dropped_files(&mut self, ctx: &egui::Context) {
        let files = ctx.input(|i| i.raw.dropped_files.clone());
        if files.is_empty() {
            return;
        }
        let at = ctx
            .pointer_latest_pos()
            .filter(|p| self.canvas_rect.contains(*p))
            .map(|p| self.to_world(p))
            .unwrap_or_else(|| self.free_spot(vec2(280.0, 200.0)));
        self.checkpoint();
        let mut k = 0.0;
        for f in files {
            let Some(path) = f.path else { continue };
            let place = Place::At(at + vec2(k, k));
            k += 24.0;
            if is_image_path(&path) {
                self.add_image_file(&path, place);
            } else {
                self.add_file_link(&path, place);
            }
        }
    }

    fn process_acts(&mut self, ctx: &egui::Context) {
        self.focus_pending = std::mem::take(&mut self.focus_next);
        self.focus_item = self.next_focus.take();
        let acts = std::mem::take(&mut self.acts);
        for a in acts {
            match a {
                Act::Select(id, additive) => {
                    if self.editing.is_some() && self.editing != Some(id) {
                        self.stop_editing(ctx);
                    }
                    self.selected_arrow = None;
                    self.popup = None;
                    if additive {
                        if !self.selected.remove(&id) {
                            self.selected.insert(id);
                        }
                    } else {
                        self.selected = [id].into_iter().collect();
                    }
                }
                Act::Drag(id) => self.start_drag(ctx, id),
                Act::Edit(id) => {
                    if self.editing != Some(id) {
                        self.checkpoint();
                    }
                    self.editing = Some(id);
                    self.focus_next = true;
                    self.select_only(id);
                }
                Act::OpenBoard(b) => self.open_board(ctx, b),
                Act::Menu(id, p) => {
                    if !self.selected.contains(&id) {
                        self.select_only(id);
                    }
                    self.ctx_menu = Some(CtxMenu { pos: p, target: MenuTarget::Card(id), frame: self.frame_no });
                }
                Act::Connect(id) => {
                    self.stop_editing(ctx);
                    self.connect = Some(id);
                }
                Act::OpenUrl(u) => {
                    let u = if u.contains("://") { u } else { format!("https://{u}") };
                    ctx.open_url(egui::OpenUrl::new_tab(u));
                }
            }
        }
    }

    fn start_drag(&mut self, ctx: &egui::Context, id: CardId) {
        let Some(ptr) = ctx.input(|i| i.pointer.press_origin()).or_else(|| ctx.pointer_interact_pos()) else { return };
        if self.editing.is_some() && self.editing != Some(id) {
            self.stop_editing(ctx);
        }
        if !self.selected.contains(&id) {
            self.select_only(id);
        }
        self.selected_arrow = None;
        self.popup = None;
        let wptr = self.to_world(ptr);
        self.checkpoint();
        let mut ids = vec![];
        let mut offsets = vec![];
        let zoom = self.zoom();
        let sel: Vec<CardId> = self.selected.iter().copied().collect();
        let mut z = self.board().max_z();
        for sid in sel {
            let Some(card) = self.board().card(sid).cloned() else { continue };
            if card.locked {
                continue;
            }
            let rect_w = if card.container == Container::Unsorted {
                match self.drawer_rects.get(&sid) {
                    Some(r) => {
                        // keep the grab point under the pointer, at the board's scale
                        let grab = (ptr - r.min) / zoom;
                        Rect::from_min_size(wptr - grab, r.size() / zoom)
                    }
                    None => continue,
                }
            } else {
                match self.rects.get(&sid) {
                    Some(r) => *r,
                    None => continue,
                }
            };
            let b = self.board_mut();
            b.detach(sid);
            z += 1;
            if let Some(c) = b.card_mut(sid) {
                c.pos = [rect_w.min.x, rect_w.min.y];
                c.z = z;
                if matches!(card.container, Container::Column(_)) {
                    c.width = rect_w.width().round();
                }
            }
            ids.push(sid);
            offsets.push(rect_w.min - wptr);
        }
        if !ids.is_empty() {
            self.drag = Some(DragState { ids, offsets });
        }
    }

    fn finish_drags(&mut self, ctx: &egui::Context) {
        let (down, ptr) = ctx.input(|i| (i.pointer.primary_down(), i.pointer.latest_pos()));
        if down {
            return;
        }
        if let Some(d) = self.drag.take() {
            let movable: Vec<CardId> = d
                .ids
                .iter()
                .copied()
                .filter(|id| !matches!(self.board().card(*id).map(|c| &c.content), Some(Content::Column { .. })))
                .collect();
            if self.drop_unsorted {
                for id in &movable {
                    self.board_mut().attach_unsorted(*id);
                }
                self.selected.clear();
            } else if let Some((col, idx)) = self.drop_column {
                for (k, id) in movable.iter().enumerate() {
                    self.board_mut().attach_column(*id, col, idx + k);
                }
            }
            let b = self.board_mut();
            for id in &d.ids {
                if let Some(c) = b.card_mut(*id) {
                    c.pos = [c.pos[0].round(), c.pos[1].round()];
                }
            }
            self.drop_column = None;
            self.drop_unsorted = false;
            self.guides.clear();
            self.touch();
        }
        if let Some(d) = self.arrow_drag.take() {
            if d.end < 2 {
                if let Some(w) = ptr.map(|p| self.to_world(p)) {
                    let other =
                        self.board().arrows.iter().find(|a| a.id == d.arrow).map(|a| if d.end == 0 { a.to } else { a.from }).unwrap_or(0);
                    let target = self.card_at(w, &[other]);
                    if let Some(a) = self.board_mut().arrows.iter_mut().find(|a| a.id == d.arrow) {
                        let (card, pt) = if d.end == 0 { (&mut a.from, &mut a.from_pt) } else { (&mut a.to, &mut a.to_pt) };
                        match target {
                            Some(t) => {
                                *card = t;
                                *pt = None;
                            }
                            None => {
                                *card = 0;
                                *pt = Some([w.x.round(), w.y.round()]);
                            }
                        }
                    }
                }
            }
            self.touch();
        }
        if let Some(src) = self.connect.take() {
            if let Some(p) = ptr.filter(|p| self.canvas_rect.contains(*p)) {
                let w = self.to_world(p);
                if let Some(t) = self.card_at(w, &[src]) {
                    let exists = self.board().arrows.iter().any(|a| (a.from == src && a.to == t) || (a.from == t && a.to == src));
                    if !exists {
                        self.checkpoint();
                        let id = self.store.new_id();
                        self.board_mut().arrows.push(Arrow::new(id, src, t));
                        self.touch();
                    }
                } else if self.anchors.get(&src).map(|r| !r.expand(14.0).contains(w)).unwrap_or(false) {
                    // let go on empty space: a line to that spot, ready to be attached later
                    self.checkpoint();
                    let id = self.store.new_id();
                    let mut a = Arrow::new(id, src, 0);
                    a.to_pt = Some([w.x.round(), w.y.round()]);
                    self.board_mut().arrows.push(a);
                    self.selected.clear();
                    self.selected_arrow = Some(id);
                    self.touch();
                }
            }
        }
        if let Some(tool) = self.tool_drag.take() {
            if let Some(p) = ptr {
                if self.drop_unsorted {
                    self.create(ctx, tool, Place::Unsorted);
                } else if self.canvas_rect.contains(p) {
                    let w = self.to_world(p);
                    match self.drop_column {
                        Some((col, idx)) if !matches!(tool, Tool::Column | Tool::Line) => self.create(ctx, tool, Place::Column(col, idx)),
                        _ => self.create(ctx, tool, Place::At(w + vec2(0.0, 10.0))),
                    }
                }
            }
            self.drop_column = None;
            self.drop_unsorted = false;
        }
    }

    fn handle_screenshot(&mut self, ctx: &egui::Context) {
        let Some(shot) = &mut self.shot else { return };
        ctx.request_repaint();
        shot.frames += 1;
        if shot.frames >= 120 && !shot.requested {
            shot.requested = true;
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::default()));
        }
        let image = ctx.input(|i| {
            i.raw.events.iter().find_map(|e| match e {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let Some(img) = image {
            if let Some(parent) = shot.path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let [w, h] = img.size;
            let res = image::save_buffer(&shot.path, img.as_raw(), w as u32, h as u32, image::ExtendedColorType::Rgba8);
            if let Err(e) = res {
                eprintln!("could not save the screenshot: {e}");
            }
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else if shot.frames > 900 {
            eprintln!("no screenshot arrived");
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }

    /// One frame of the whole app (also driven directly by the interaction tests).
    pub fn ui(&mut self, ctx: &egui::Context) {
        self.frame_no += 1;
        self.now = ctx.input(|i| i.time);
        self.apply_appearance(ctx);
        self.handle_screenshot(ctx);
        self.handle_dropped_files(ctx);
        self.close_popups_on_outside_click(ctx);
        self.handle_keys(ctx);

        self.top_bar(ctx);
        self.toolbar(ctx);
        self.drawer(ctx);
        egui::CentralPanel::default().frame(Frame::NONE.fill(canvas_c())).show(ctx, |ui| self.canvas(ui));

        self.unsorted_pill(ctx);
        self.zoom_controls(ctx);
        self.format_bar(ctx);
        self.tool_popup(ctx);
        self.header_popup(ctx);
        self.context_menu(ctx);
        self.trash_window(ctx);
        self.settings_modal(ctx);
        self.ghosts(ctx);
        self.toast_ui(ctx);

        self.process_acts(ctx);
        self.finish_drags(ctx);

        if self.prefs_dirty {
            self.save_prefs();
        }
        if self.shot.is_none() {
            let closing = ctx.input(|i| i.viewport().close_requested());
            if self.dirty && (closing || (self.now - self.last_change > 0.7 && self.drag.is_none())) {
                self.save();
            }
            if self.dirty {
                ctx.request_repaint_after(std::time::Duration::from_millis(300));
            }
        }
    }
}

impl eframe::App for App {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        canvas_c().to_normalized_gamma_f32()
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.ui(ctx);
    }
}
