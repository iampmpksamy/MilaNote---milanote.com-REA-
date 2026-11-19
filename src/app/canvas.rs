//! The infinite canvas: layout, cards, lines, panning, zooming, guides and the selection box.

use super::*;
use eframe::egui::{Align2, Color32, CursorIcon, Key, LayerId, Order, PointerButton, Sense, Shape, Stroke, StrokeKind, UiBuilder};

/// How far a line stops short of the card it points at.
const LINE_GAP: f32 = 7.0;

pub(super) fn dist_to_segment(p: Pos2, a: Pos2, b: Pos2) -> f32 {
    let ab = b - a;
    let len2 = ab.length_sq();
    if len2 < 1e-6 {
        return (p - a).length();
    }
    let t = ((p - a).dot(ab) / len2).clamp(0.0, 1.0);
    (p - (a + ab * t)).length()
}

/// Where a line from the middle of `r` toward `toward` leaves the rectangle.
pub(super) fn edge_point(r: Rect, toward: Pos2) -> Pos2 {
    let c = r.center();
    let d = toward - c;
    if d.length_sq() < 1e-6 {
        return c;
    }
    let tx = if d.x.abs() > 1e-6 { (r.width() / 2.0) / d.x.abs() } else { f32::INFINITY };
    let ty = if d.y.abs() > 1e-6 { (r.height() / 2.0) / d.y.abs() } else { f32::INFINITY };
    c + d * tx.min(ty)
}

pub(super) fn line_width(weight: u8) -> f32 {
    match weight {
        0 | 1 => 1.6,
        2 => 2.6,
        _ => 4.0,
    }
}

impl App {
    fn h(&self, id: CardId, w: f32) -> f32 {
        self.heights.get(&(id, w.round() as u32)).copied().unwrap_or(90.0)
    }

    pub(super) fn compute_layout(&mut self) {
        let mut rects = HashMap::new();
        let mut anchors = HashMap::new();
        let mut order = vec![];
        let b = self.board();
        let mut canvas: Vec<&Card> = b.cards.iter().filter(|c| c.container == Container::Canvas).collect();
        canvas.sort_by_key(|c| c.z);
        for c in canvas {
            let min = pos2(c.pos[0], c.pos[1]);
            order.push(c.id);
            match &c.content {
                Content::Column { children, .. } => {
                    let cw = c.width - 2.0 * COL_PAD;
                    let mut y = min.y + COL_HEADER;
                    for ch in children {
                        let h = self.h(*ch, cw);
                        let r = Rect::from_min_size(pos2(min.x + COL_PAD, y), vec2(cw, h));
                        rects.insert(*ch, r);
                        anchors.insert(*ch, r);
                        order.push(*ch);
                        y += h + COL_GAP;
                    }
                    let height = if children.is_empty() { COL_HEADER + 70.0 + COL_PAD } else { y - COL_GAP + COL_PAD - min.y };
                    let r = Rect::from_min_size(min, vec2(c.width, height));
                    rects.insert(c.id, r);
                    anchors.insert(c.id, r);
                }
                Content::Board { .. } => {
                    let r = Rect::from_min_size(min, vec2(c.width, self.h(c.id, c.width)));
                    rects.insert(c.id, r);
                    let sq = Rect::from_min_size(pos2(min.x + (c.width - BOARD_ICON) / 2.0, min.y), vec2(BOARD_ICON, BOARD_ICON));
                    anchors.insert(c.id, sq);
                }
                _ => {
                    let r = Rect::from_min_size(min, vec2(c.width, self.h(c.id, c.width)));
                    rects.insert(c.id, r);
                    anchors.insert(c.id, r);
                }
            }
        }
        self.rects = rects;
        self.anchors = anchors;
        self.order = order;
    }

    pub(super) fn card_at(&self, w: Pos2, exclude: &[CardId]) -> Option<CardId> {
        self.order.iter().rev().copied().find(|id| !exclude.contains(id) && self.rects.get(id).map(|r| r.contains(w)).unwrap_or(false))
    }

    pub(super) fn column_drop_at(&self, w: Pos2, exclude: &[CardId]) -> Option<(CardId, usize)> {
        let b = self.board();
        for id in self.order.iter().rev() {
            if exclude.contains(id) {
                continue;
            }
            let Some(c) = b.card(*id) else { continue };
            if let Content::Column { children, .. } = &c.content {
                if self.rects.get(id).map(|r| r.contains(w)).unwrap_or(false) {
                    let idx = children
                        .iter()
                        .filter(|ch| !exclude.contains(ch))
                        .filter(|ch| self.rects.get(ch).map(|r| r.center().y < w.y).unwrap_or(false))
                        .count();
                    return Some((*id, idx));
                }
            }
        }
        None
    }

    /// One end of a line: the card shape it's attached to (if any) and the point it aims from.
    fn end_info(&self, a: &Arrow, which: u8) -> Option<(Option<Rect>, Pos2)> {
        let (card, pt, other) = if which == 0 { (a.from, a.from_pt, a.to) } else { (a.to, a.to_pt, a.from) };
        if let (Some(d), Some(p)) = (self.arrow_drag, self.pointer_world) {
            if d.arrow == a.id && d.end == which {
                return Some(match self.card_at(p, &[other]).and_then(|t| self.anchors.get(&t).copied()) {
                    Some(r) => (Some(r), r.center()),
                    None => (None, p),
                });
            }
        }
        if card != 0 {
            let r = self.anchors.get(&card).copied()?;
            Some((Some(r), r.center()))
        } else {
            pt.map(|p| (None, pos2(p[0], p[1])))
        }
    }

    /// The two visible ends of a line, or None when it can't be drawn (a card is hidden or they overlap).
    pub(super) fn arrow_geom(&self, a: &Arrow) -> Option<(Pos2, Pos2)> {
        let (ra, ca) = self.end_info(a, 0)?;
        let (rb, cb) = self.end_info(a, 1)?;
        let p1 = match ra {
            Some(r) => {
                if r.expand(2.0).contains(cb) {
                    return None;
                }
                edge_point(r.expand(LINE_GAP), cb)
            }
            None => ca,
        };
        let p2 = match rb {
            Some(r) => {
                if r.expand(2.0).contains(ca) {
                    return None;
                }
                edge_point(r.expand(LINE_GAP), ca)
            }
            None => cb,
        };
        Some((p1, p2))
    }

    pub(super) fn arrow_at(&self, w: Pos2) -> Option<u64> {
        let tol = 7.0 / self.zoom();
        self.board()
            .arrows
            .iter()
            .rev()
            .find(|a| self.arrow_geom(a).map(|(p1, p2)| dist_to_segment(w, p1, p2) < tol + line_width(a.weight)).unwrap_or(false))
            .map(|a| a.id)
    }

    fn paint_arrow(&self, p: &egui::Painter, a: &Arrow, p1: Pos2, p2: Pos2) {
        let col = line_color(a.color);
        let w = line_width(a.weight);
        let len = (p2 - p1).length();
        if len < 1.0 {
            return;
        }
        let dir = (p2 - p1) / len;
        let head = 8.0 + 2.0 * w;
        let s = if a.head_start { p1 + dir * (head - 2.0) } else { p1 };
        let e = if a.head { p2 - dir * (head - 2.0) } else { p2 };
        if self.selected_arrow == Some(a.id) {
            p.line_segment([p1, p2], Stroke::new(w + 7.0, SELECT.gamma_multiply(0.22)));
        }
        let st = Stroke::new(w, col);
        if a.dashed {
            p.extend(Shape::dashed_line(&[s, e], st, 6.0 + 2.0 * w, 4.0 + w));
        } else {
            p.line_segment([s, e], st);
        }
        let perp = vec2(-dir.y, dir.x);
        let tip = |at: Pos2, d: Vec2| {
            let pts = vec![at, at - d * head + perp * head * 0.45, at - d * head - perp * head * 0.45];
            p.add(Shape::convex_polygon(pts, col, Stroke::NONE));
        };
        if a.head {
            tip(p2, dir);
        }
        if a.head_start {
            tip(p1, -dir);
        }
        if !a.label.is_empty() {
            let mid = p1 + (p2 - p1) * 0.5;
            let galley = p.layout_no_wrap(a.label.clone(), font(13.0), ink());
            let r = Rect::from_center_size(mid, galley.size() + vec2(12.0, 6.0));
            p.rect_filled(r, 4.0, canvas_c());
            p.rect_stroke(r, 4.0, Stroke::new(1.0_f32, border_c()), StrokeKind::Inside);
            p.galley(r.center() - galley.size() / 2.0, galley, ink());
        }
    }

    /// Draw one card (on the board or in the Unsorted drawer) and queue what the person did to it.
    pub(super) fn render_card(
        &mut self,
        ui: &mut egui::Ui,
        cid: CardId,
        min: Pos2,
        width: f32,
        fixed_h: Option<f32>,
        in_drawer: bool,
    ) -> f32 {
        let Some(mut card) = self.board().card(cid).cloned() else { return 0.0 };
        let key = (cid, width.round() as u32);
        let cached = self.heights.get(&key).copied().unwrap_or(90.0);
        let board_info = if let Content::Board { board } = &card.content {
            self.store.boards.get(board).map(|b| (b.name.clone(), b.color, b.cards.len(), b.icon.clone()))
        } else {
            None
        };
        let texture = if let Content::Image { file, .. } = &card.content {
            let f = file.clone();
            self.texture_for(ui.ctx(), &f)
        } else {
            None
        };
        let editing = self.editing == Some(cid);
        let cx = CardCtx {
            selected: self.selected.contains(&cid),
            editing,
            focus: self.focus_pending && editing,
            focus_item: self.focus_item.filter(|(c, _)| *c == cid).map(|(_, i)| i),
            texture,
            board: board_info.as_ref().map(|(n, c, k, i)| (n.as_str(), *c, *k, i.as_deref())),
            drop_target: self.drop_column.map(|(c, _)| c) == Some(cid),
        };
        let out = draw_card(ui, &mut card, min, width, fixed_h, cached, &cx);
        if fixed_h.is_none() && (out.height - cached).abs() > 0.5 {
            self.heights.insert(key, out.height);
            ui.ctx().request_repaint();
        }
        let resp = &out.resp;
        let busy = self.drag.is_some() || self.connect.is_some() || self.panning || self.tool_drag.is_some() || self.arrow_drag.is_some();
        let (shift, space) = ui.input(|i| (i.modifiers.shift || i.modifiers.command, i.key_down(Key::Space)));
        if resp.drag_started_by(PointerButton::Primary) && !space {
            if !card.locked {
                self.acts.push(Act::Drag(cid));
            }
        } else if resp.double_clicked() {
            if let Content::Board { board } = &card.content {
                self.acts.push(Act::OpenBoard(*board));
            } else {
                self.acts.push(Act::Edit(cid));
            }
        } else if resp.clicked() {
            self.acts.push(Act::Select(cid, shift));
        }
        if resp.secondary_clicked() {
            let p = ui.ctx().pointer_interact_pos().unwrap_or_default();
            self.acts.push(Act::Menu(cid, p));
        }
        if resp.hovered() && !busy && !editing {
            ui.ctx().set_cursor_icon(CursorIcon::Grab);
        }
        if out.checkpoint {
            self.checkpoint();
        }
        if out.changed {
            if let Some(c) = self.board_mut().card_mut(cid) {
                c.content = card.content.clone();
            }
            self.touch();
        }
        if let Some(name) = out.board_name {
            if let Content::Board { board } = &card.content {
                if let Some(b) = self.store.boards.get_mut(board) {
                    b.name = name;
                }
            }
            self.touch();
        }
        if let Some(u) = out.open_url {
            self.acts.push(Act::OpenUrl(u));
        }
        if let Some(i) = out.focus_item {
            self.next_focus = Some((cid, i));
        }

        // Handles for a single selected card on the board: resize corner and connection dot.
        let single = self.selected.len() == 1 && self.selected.contains(&cid);
        if single && !in_drawer && !busy {
            let rect = Rect::from_min_size(min, vec2(width, out.height));
            let z = self.zoom();
            let is_board = matches!(card.content, Content::Board { .. });
            if card.container == Container::Canvas && !card.locked && !is_board {
                let hs = 14.0 / z.max(0.5);
                let hr = Rect::from_min_size(rect.right_bottom() - vec2(hs, hs), vec2(hs, hs));
                let h = ui.interact(hr, Id::new(("resize", cid)), Sense::drag());
                let p = ui.painter();
                for k in 1..3 {
                    let d = k as f32 * 4.0 / z.max(0.5);
                    p.line_segment(
                        [rect.right_bottom() - vec2(d + 2.0, 2.0), rect.right_bottom() - vec2(2.0, d + 2.0)],
                        Stroke::new(1.2 / z.max(0.5), muted()),
                    );
                }
                if h.hovered() || h.dragged() {
                    ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal);
                }
                if h.drag_started() {
                    self.checkpoint();
                }
                if h.dragged() {
                    let dx = ui.input(|i| i.pointer.delta().x) / z;
                    if let Some(c) = self.board_mut().card_mut(cid) {
                        c.width = (c.width + dx).clamp(140.0, 900.0);
                    }
                    self.touch();
                }
                if h.drag_stopped() {
                    if let Some(c) = self.board_mut().card_mut(cid) {
                        c.width = c.width.round();
                    }
                }
            }
            if !editing {
                let anchor = self.anchors.get(&cid).copied().unwrap_or(rect);
                let r = 5.5 / z.max(0.6);
                let c = if is_board { anchor.right_top() + vec2(-3.0, 3.0) } else { pos2(anchor.right(), anchor.center().y) };
                let cr = Rect::from_center_size(c, vec2(r * 3.4, r * 3.4));
                let h = ui.interact(cr, Id::new(("connector", cid)), Sense::drag());
                let p = ui.painter();
                p.circle_filled(c, r, if h.hovered() { SELECT } else { Color32::WHITE });
                p.circle_stroke(c, r, Stroke::new(1.5 / z.max(0.6), if h.hovered() { SELECT } else { ink() }));
                let h = h.on_hover_text("Drag to connect to another card");
                if h.hovered() {
                    ui.ctx().set_cursor_icon(CursorIcon::Crosshair);
                }
                if h.drag_started() {
                    self.acts.push(Act::Connect(cid));
                }
            }
        }
        out.height
    }

    fn handle_view_input(&mut self, ctx: &egui::Context, rect: Rect) {
        let typing = ctx.wants_keyboard_input();
        let (ptr, scroll, zoom_d, middle, primary, delta, space) = ctx.input(|i| {
            (
                i.pointer.latest_pos(),
                i.smooth_scroll_delta,
                i.zoom_delta(),
                i.pointer.button_down(PointerButton::Middle),
                i.pointer.primary_down(),
                i.pointer.delta(),
                i.key_down(Key::Space) && !typing,
            )
        });
        let over =
            ptr.map(|p| rect.contains(p) && ctx.layer_id_at(p).map(|l| l.order == Order::Background).unwrap_or(true)).unwrap_or(false);
        let popup = self.ctx_menu.is_some() || self.settings_open;
        if over && !popup {
            if (zoom_d - 1.0).abs() > 1e-4 {
                if let Some(p) = ptr {
                    self.zoom_at(p, zoom_d);
                }
            } else if scroll != Vec2::ZERO {
                let b = self.board_mut();
                b.pan[0] += scroll.x;
                b.pan[1] += scroll.y;
                self.touch();
            }
        }
        let want_pan = (middle || (space && primary)) && (over || self.panning);
        if want_pan && self.drag.is_none() && self.connect.is_none() && self.arrow_drag.is_none() {
            self.panning = true;
            let b = self.board_mut();
            b.pan[0] += delta.x;
            b.pan[1] += delta.y;
            ctx.set_cursor_icon(CursorIcon::Grabbing);
            self.touch();
        } else if !middle && !primary {
            self.panning = false;
        }
        if space && over && !self.panning {
            ctx.set_cursor_icon(CursorIcon::Grab);
        }
    }

    /// Line the dragged cards up with their neighbours (and, if chosen, with an 8-point grid).
    fn align_drag(&mut self, ids: &[CardId]) {
        self.guides.clear();
        let Some(first) = ids.first() else { return };
        let Some(size) = self.rects.get(first).map(|r| r.size()) else { return };
        let Some(pos) = self.board().card(*first).map(|c| pos2(c.pos[0], c.pos[1])) else { return };
        let r = Rect::from_min_size(pos, size);
        let tol = 6.0 / self.zoom();
        let mut best_x: Option<(f32, f32, Rect)> = None;
        let mut best_y: Option<(f32, f32, Rect)> = None;
        if self.prefs.guides {
            let b = self.board();
            for (id, o) in &self.rects {
                if ids.contains(id) || b.card(*id).map(|c| c.container != Container::Canvas).unwrap_or(true) {
                    continue;
                }
                for xs in [r.left(), r.center().x, r.right()] {
                    for xo in [o.left(), o.center().x, o.right()] {
                        let d = xo - xs;
                        if d.abs() < tol && best_x.map(|b| d.abs() < b.0.abs()).unwrap_or(true) {
                            best_x = Some((d, xo, *o));
                        }
                    }
                }
                for ys in [r.top(), r.center().y, r.bottom()] {
                    for yo in [o.top(), o.center().y, o.bottom()] {
                        let d = yo - ys;
                        if d.abs() < tol && best_y.map(|b| d.abs() < b.0.abs()).unwrap_or(true) {
                            best_y = Some((d, yo, *o));
                        }
                    }
                }
            }
        }
        let grid = |v: f32| (v / 8.0).round() * 8.0 - v;
        let dx = match best_x {
            Some((d, x, o)) => {
                let r2 = r.translate(vec2(d, 0.0));
                self.guides.push([pos2(x, r2.top().min(o.top()) - 8.0), pos2(x, r2.bottom().max(o.bottom()) + 8.0)]);
                d
            }
            None if self.prefs.snap_grid => grid(r.left()),
            None => 0.0,
        };
        let dy = match best_y {
            Some((d, y, o)) => {
                let r2 = r.translate(vec2(dx, d));
                self.guides.push([pos2(r2.left().min(o.left()) - 8.0, y), pos2(r2.right().max(o.right()) + 8.0, y)]);
                d
            }
            None if self.prefs.snap_grid => grid(r.top()),
            None => 0.0,
        };
        if dx != 0.0 || dy != 0.0 {
            let b = self.board_mut();
            for id in ids {
                if let Some(c) = b.card_mut(*id) {
                    c.pos = [c.pos[0] + dx, c.pos[1] + dy];
                }
            }
        }
    }

    fn update_drag(&mut self, ctx: &egui::Context) {
        let Some(p) = ctx.pointer_latest_pos() else { return };
        let w = self.to_world(p);
        self.pointer_world = Some(w);
        if let Some(d) = &self.drag {
            let moves: Vec<(CardId, Vec2)> = d.ids.iter().copied().zip(d.offsets.iter().copied()).collect();
            let ids = d.ids.clone();
            let b = self.board_mut();
            for (id, off) in moves {
                if let Some(c) = b.card_mut(id) {
                    c.pos = [w.x + off.x, w.y + off.y];
                }
            }
            self.drop_unsorted = self.prefs.drawer_open && self.drawer_rect.map(|r| r.contains(p)).unwrap_or(false);
            let all_columns = ids.iter().all(|id| matches!(self.board().card(*id).map(|c| &c.content), Some(Content::Column { .. })));
            self.drop_column = if self.drop_unsorted || all_columns { None } else { self.column_drop_at(w, &ids) };
            if self.drop_column.is_none() && !self.drop_unsorted {
                self.align_drag(&ids);
            } else {
                self.guides.clear();
            }
            ctx.set_cursor_icon(CursorIcon::Grabbing);
        } else if self.tool_drag.is_some() {
            self.drop_unsorted = self.prefs.drawer_open && self.drawer_rect.map(|r| r.contains(p)).unwrap_or(false);
            self.drop_column = if self.canvas_rect.contains(p) && !matches!(self.tool_drag, Some(Tool::Column | Tool::Line)) {
                self.column_drop_at(w, &[])
            } else {
                None
            };
        } else {
            self.drop_column = None;
            self.drop_unsorted = false;
            self.guides.clear();
        }
        if let Some(d) = self.arrow_drag {
            if d.end == 2 {
                let delta = w - d.last;
                if let Some(a) = self.board_mut().arrows.iter_mut().find(|x| x.id == d.arrow) {
                    let mv = |q: &mut Option<[f32; 2]>| {
                        if let Some(v) = q {
                            *v = [v[0] + delta.x, v[1] + delta.y];
                        }
                    };
                    mv(&mut a.from_pt);
                    mv(&mut a.to_pt);
                }
                self.arrow_drag = Some(ArrowDrag { last: w, ..d });
            }
            ctx.set_cursor_icon(CursorIcon::Grabbing);
        }
    }

    pub(super) fn canvas(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let rect = ui.max_rect();
        self.canvas_rect = rect;
        let bg = ui.interact(rect, Id::new("canvas-bg"), Sense::click_and_drag());
        self.handle_view_input(&ctx, rect);
        self.update_drag(&ctx);
        self.compute_layout();
        if let Some(c) = self.pending_center.take() {
            if let Some(r) = self.rects.get(&c).copied() {
                self.center_on(r);
            }
        }
        let xf = self.xf();
        let zoom = self.zoom();

        // dot grid, fixed to the board so it moves with it
        if self.prefs.show_grid {
            let p = ui.painter_at(rect);
            let mut step = 20.0;
            while step * zoom < 12.0 {
                step *= 2.0;
            }
            let tl = self.to_world(rect.min);
            let br = self.to_world(rect.max);
            let r = (1.0 * zoom.sqrt()).clamp(0.7, 1.4);
            let mut x = (tl.x / step).floor() * step;
            let mut n = 0;
            while x <= br.x && n < 500 {
                let mut y = (tl.y / step).floor() * step;
                let mut m = 0;
                while y <= br.y && m < 500 {
                    p.circle_filled(self.to_screen(pos2(x, y)), r, dot_c());
                    y += step;
                    m += 1;
                }
                x += step;
                n += 1;
            }
        }

        // the board itself, drawn in its own layer moved and scaled by the view
        let layer = LayerId::new(ui.layer_id().order, Id::new("world-layer"));
        ctx.set_sublayer(ui.layer_id(), layer);
        let mut wui = ui.new_child(UiBuilder::new().layer_id(layer).max_rect(Rect::from_min_max(pos2(-1.0e6, -1.0e6), pos2(1.0e6, 1.0e6))));
        wui.set_clip_rect(xf.inverse() * rect);

        // lines under the cards
        let arrows = self.board().arrows.clone();
        for a in &arrows {
            if let Some((p1, p2)) = self.arrow_geom(a) {
                self.paint_arrow(wui.painter(), a, p1, p2);
            }
        }

        // cards
        let order = self.order.clone();
        for cid in order {
            let Some(r) = self.rects.get(&cid).copied() else { continue };
            let is_col = matches!(self.board().card(cid).map(|c| &c.content), Some(Content::Column { .. }));
            let fixed = if is_col { Some(r.height()) } else { None };
            self.render_card(&mut wui, cid, r.min, r.width(), fixed, false);
        }

        // ends of the selected line, which can be dragged onto cards
        if let Some(sel) = self.selected_arrow {
            if let Some(a) = arrows.iter().find(|a| a.id == sel) {
                if let Some((p1, p2)) = self.arrow_geom(a) {
                    for (k, at) in [(0u8, p1), (1u8, p2)] {
                        let r = 5.5 / zoom.max(0.6);
                        let h =
                            wui.interact(Rect::from_center_size(at, vec2(r * 3.4, r * 3.4)), Id::new(("line-end", sel, k)), Sense::drag());
                        let p = wui.painter();
                        p.circle_filled(at, r, if h.hovered() { SELECT } else { Color32::WHITE });
                        p.circle_stroke(at, r, Stroke::new(1.5 / zoom.max(0.6), if h.hovered() { SELECT } else { ink() }));
                        if h.hovered() {
                            ctx.set_cursor_icon(CursorIcon::Move);
                        }
                        if h.drag_started() {
                            self.checkpoint();
                            let w = self.pointer_world.unwrap_or(at);
                            self.arrow_drag = Some(ArrowDrag { arrow: sel, end: k, last: w });
                        }
                    }
                }
            }
        }

        // where a dragged card will land in a column
        if let Some((col, idx)) = self.drop_column {
            let children: Vec<CardId> = self
                .board()
                .column_children(col)
                .into_iter()
                .filter(|c| !self.drag.as_ref().map(|d| d.ids.contains(c)).unwrap_or(false))
                .collect();
            if let Some(cr) = self.rects.get(&col).copied() {
                let y = if idx < children.len() {
                    self.rects.get(&children[idx]).map(|r| r.top() - COL_GAP / 2.0).unwrap_or(cr.top() + COL_HEADER)
                } else if let Some(last) = children.last() {
                    self.rects.get(last).map(|r| r.bottom() + COL_GAP / 2.0).unwrap_or(cr.top() + COL_HEADER)
                } else {
                    cr.top() + COL_HEADER - 2.0
                };
                wui.painter().line_segment([pos2(cr.left() + COL_PAD, y), pos2(cr.right() - COL_PAD, y)], Stroke::new(3.0_f32, SELECT));
            }
        }

        // alignment guides while dragging
        for g in &self.guides {
            wui.painter().line_segment(*g, Stroke::new(1.0 / zoom, Color32::from_rgb(0xE2, 0x4C, 0x8A)));
        }

        let wptr = self.pointer_world;

        // a card the dragged line end will attach to
        if let (Some(d), Some(w)) = (self.arrow_drag, wptr) {
            if d.end < 2 {
                if let Some(t) = self.card_at(w, &[]).and_then(|t| self.anchors.get(&t).copied()) {
                    wui.painter().rect_stroke(t, 6.0, Stroke::new(2.0_f32, SELECT.gamma_multiply(0.6)), StrokeKind::Outside);
                }
            }
        }

        // drawing a new connection from a card
        if let (Some(src), Some(w)) = (self.connect, wptr) {
            if let Some(r) = self.anchors.get(&src).copied() {
                let target = self.card_at(w, &[src]).and_then(|t| self.anchors.get(&t).copied());
                let end = target.map(|t| edge_point(t.expand(LINE_GAP), r.center())).unwrap_or(w);
                let start = edge_point(r.expand(LINE_GAP), end);
                wui.painter().line_segment([start, end], Stroke::new(1.6_f32, pal().line));
                wui.painter().circle_filled(end, 3.5, pal().line);
                if let Some(t) = target {
                    wui.painter().rect_stroke(t, 6.0, Stroke::new(2.0_f32, SELECT.gamma_multiply(0.6)), StrokeKind::Outside);
                }
            }
            ctx.set_cursor_icon(CursorIcon::Crosshair);
        }

        // background clicks and the selection box
        let space = ctx.input(|i| i.key_down(Key::Space)) && !ctx.wants_keyboard_input();
        let shift = ctx.input(|i| i.modifiers.shift || i.modifiers.command);
        if let Some(w) = bg.interact_pointer_pos().map(|p| self.to_world(p)) {
            if bg.clicked() {
                self.stop_editing(&ctx);
                self.ctx_menu = None;
                self.popup = None;
                if let Some(a) = self.arrow_at(w) {
                    self.selected_arrow = Some(a);
                    self.selected.clear();
                } else {
                    self.selected_arrow = None;
                    if !shift {
                        self.selected.clear();
                    }
                }
            }
            if bg.double_clicked() && self.arrow_at(w).is_none() {
                self.create(&ctx, Tool::Note, Place::At(w + vec2(0.0, 20.0)));
            }
            if bg.secondary_clicked() {
                let pos = bg.interact_pointer_pos().unwrap_or_default();
                let target = match self.arrow_at(w) {
                    Some(a) => {
                        self.selected_arrow = Some(a);
                        self.selected.clear();
                        MenuTarget::Arrow(a)
                    }
                    None => MenuTarget::Canvas(w),
                };
                self.ctx_menu = Some(CtxMenu { pos, target, frame: self.frame_no });
            }
            if bg.drag_started_by(PointerButton::Primary) && !space && !self.panning {
                self.stop_editing(&ctx);
                self.popup = None;
                if let Some(a) = self.arrow_at(w) {
                    // grab a line: an unattached one moves, an attached one just gets selected
                    self.selected.clear();
                    self.selected_arrow = Some(a);
                    let free = self.board().arrows.iter().find(|x| x.id == a).map(|x| x.from == 0 && x.to == 0).unwrap_or(false);
                    if free {
                        self.checkpoint();
                        self.arrow_drag = Some(ArrowDrag { arrow: a, end: 2, last: w });
                    }
                } else {
                    self.band = Some(w);
                    if !shift {
                        self.selected.clear();
                    }
                    self.selected_arrow = None;
                }
            }
        }
        if let Some(start) = self.band {
            let down = ctx.input(|i| i.pointer.primary_down());
            if let (true, Some(w)) = (down, wptr) {
                let r = Rect::from_two_pos(start, w);
                wui.painter().rect(r, 2.0, SELECT.gamma_multiply(0.08), Stroke::new(1.0 / zoom, SELECT), StrokeKind::Inside);
                let hits: Vec<CardId> = self
                    .rects
                    .iter()
                    .filter(|(id, cr)| {
                        cr.intersects(r) && self.board().card(**id).map(|c| c.container == Container::Canvas).unwrap_or(false)
                    })
                    .map(|(id, _)| *id)
                    .collect();
                if !shift {
                    self.selected = hits.into_iter().collect();
                } else {
                    self.selected.extend(hits);
                }
            } else {
                self.band = None;
            }
        }

        ctx.set_transform_layer(layer, xf);

        // a quiet hint on an empty board
        if self.board().cards.iter().all(|c| c.container != Container::Canvas) && self.board().arrows.is_empty() {
            ui.painter().text(
                rect.center(),
                Align2::CENTER_CENTER,
                "Drag a card from the toolbar, or double-click anywhere to start a note",
                font(15.0),
                muted(),
            );
        }
    }
}
