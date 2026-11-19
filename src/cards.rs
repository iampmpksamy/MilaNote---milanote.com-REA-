//! Drawing one card (note, to-do list, link, image, board or column) and its small pieces.

use crate::model::*;
use crate::theme::*;
use eframe::egui::{
    self, pos2, text::LayoutJob, vec2, Align, Align2, Button, Color32, CornerRadius, Frame, Id, Key, Label, Layout, Margin, Pos2, Rect,
    Response, RichText, Sense, Shape, Stroke, StrokeKind, TextEdit, TextFormat, Ui, UiBuilder,
};

/// Size of a board's square icon, in board units.
pub const BOARD_ICON: f32 = 72.0;

pub struct CardCtx<'a> {
    pub selected: bool,
    pub editing: bool,
    /// Put the keyboard in this card's first text field this frame.
    pub focus: bool,
    /// Put the keyboard in this to-do item this frame.
    pub focus_item: Option<usize>,
    pub texture: Option<(egui::TextureId, egui::Vec2)>,
    /// For board cards: name, colour, how many cards it holds and its symbol.
    pub board: Option<(&'a str, usize, usize, Option<&'a str>)>,
    pub drop_target: bool,
}

pub struct CardOut {
    pub resp: Response,
    pub height: f32,
    pub changed: bool,
    /// The change needs an undo step taken before it is written back.
    pub checkpoint: bool,
    pub board_name: Option<String>,
    pub open_url: Option<String>,
    pub focus_item: Option<usize>,
}

pub fn edit_id(card: CardId) -> Id {
    Id::new(("edit", card))
}

pub fn edit_id2(card: CardId) -> Id {
    Id::new(("edit2", card))
}

pub fn domain_of(url: &str) -> String {
    let s = url.trim();
    let s = s.split("://").nth(1).unwrap_or(s);
    let s = s.split(['/', '?', '#']).next().unwrap_or(s);
    s.trim_start_matches("www.").to_string()
}

pub fn hash_color(s: &str) -> Color32 {
    let mut h: u32 = 2166136261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    board_color(7 + (h % 6) as usize)
}

/// Turn the light markdown used in notes (# headings, - bullets, **bold**, *italic*, __underline__,
/// ~~strike~~, `code`) into styled text. Web addresses are shown as links.
pub fn markdown_job(text: &str, base: f32, color: Color32, wrap: f32, align: u8) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap;
    job.halign = match align {
        1 => Align::Center,
        2 => Align::RIGHT,
        _ => Align::LEFT,
    };
    let lines: Vec<&str> = text.split('\n').collect();
    for (i, raw) in lines.iter().enumerate() {
        let mut size = base;
        let mut heading = false;
        let mut line_color = color;
        let mut italic = false;
        let mut rest: &str = raw;
        let mut prefix = "";
        if let Some(r) = raw.strip_prefix("# ") {
            size = base + 7.0;
            heading = true;
            rest = r;
        } else if let Some(r) = raw.strip_prefix("## ") {
            size = base + 3.0;
            heading = true;
            rest = r;
        } else if let Some(r) = raw.strip_prefix("### ") {
            size = base + 1.0;
            heading = true;
            rest = r;
        } else if let Some(r) = raw.strip_prefix("- ").or_else(|| raw.strip_prefix("* ")) {
            prefix = "•  ";
            rest = r;
        } else if let Some(r) = raw.strip_prefix("> ") {
            line_color = muted();
            italic = true;
            rest = r;
        }
        let lh = Some(size * 1.45);
        if !prefix.is_empty() {
            job.append(prefix, 2.0, TextFormat { font_id: font(size), color: muted(), line_height: lh, ..Default::default() });
        }
        inline(&mut job, rest, size, heading, line_color, italic, lh);
        if i + 1 < lines.len() {
            job.append("\n", 0.0, TextFormat { font_id: font(base), color, line_height: Some(base * 1.45), ..Default::default() });
        }
    }
    job
}

#[derive(Clone, Copy, Default)]
struct Marks {
    bold: bool,
    italic: bool,
    strike: bool,
    under: bool,
    code: bool,
}

fn inline(job: &mut LayoutJob, text: &str, size: f32, heading: bool, color: Color32, italic0: bool, lh: Option<f32>) {
    let mut m = Marks::default();
    let mut buf = String::new();
    let chars: Vec<char> = text.chars().collect();
    let flush = |job: &mut LayoutJob, buf: &mut String, m: Marks| {
        if buf.is_empty() {
            return;
        }
        // split out web addresses so they read as links
        let words: Vec<&str> = buf.split_inclusive(' ').collect();
        for w in words {
            let is_link = w.trim_start().starts_with("http://") || w.trim_start().starts_with("https://");
            let font_id = if m.code {
                egui::FontId::monospace(size - 1.0)
            } else if heading {
                heading_font(size)
            } else if m.bold {
                bold_font(size)
            } else {
                font(size)
            };
            let c = if is_link { SELECT } else { color };
            job.append(
                w,
                0.0,
                TextFormat {
                    font_id,
                    color: c,
                    italics: m.italic || italic0,
                    strikethrough: if m.strike { Stroke::new(1.0_f32, c) } else { Stroke::NONE },
                    underline: if m.under || is_link { Stroke::new(1.0_f32, c) } else { Stroke::NONE },
                    background: if m.code { Color32::from_gray(128).gamma_multiply(0.15) } else { Color32::TRANSPARENT },
                    line_height: lh,
                    ..Default::default()
                },
            );
        }
        buf.clear();
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let pair = |a: char| c == a && next == Some(a);
        if !m.code && pair('*') {
            flush(job, &mut buf, m);
            m.bold = !m.bold;
            i += 2;
            continue;
        }
        if !m.code && pair('~') {
            flush(job, &mut buf, m);
            m.strike = !m.strike;
            i += 2;
            continue;
        }
        if !m.code && pair('_') {
            flush(job, &mut buf, m);
            m.under = !m.under;
            i += 2;
            continue;
        }
        if !m.code && c == '*' {
            flush(job, &mut buf, m);
            m.italic = !m.italic;
            i += 1;
            continue;
        }
        if c == '`' {
            flush(job, &mut buf, m);
            m.code = !m.code;
            i += 1;
            continue;
        }
        buf.push(c);
        i += 1;
    }
    flush(job, &mut buf, m);
}

/// The first line of some text without markdown marks, for titles and lists.
pub fn plain_title(text: &str) -> String {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let line = line.trim_start_matches('#').trim_start_matches("- ").trim();
    line.replace("**", "").replace("~~", "").replace("__", "").replace(['*', '`'], "")
}

pub fn swatch(ui: &mut Ui, color: Color32, selected: bool, tip: &str) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(24.0, 24.0), Sense::click());
    let p = ui.painter();
    if selected {
        p.circle_stroke(rect.center(), 11.0, Stroke::new(2.0_f32, SELECT));
    }
    p.circle_filled(rect.center(), 8.5, color);
    p.circle_stroke(rect.center(), 8.5, Stroke::new(1.0_f32, Color32::from_black_alpha(40)));
    if resp.hovered() {
        p.circle_stroke(rect.center(), 10.5, Stroke::new(1.0_f32, muted()));
    }
    resp.on_hover_text(tip)
}

fn checkbox(ui: &mut Ui, done: bool, id: Id) -> Response {
    let (rect, _) = ui.allocate_exact_size(vec2(18.0, 21.0), Sense::hover());
    let resp = ui.interact(rect, id, Sense::click());
    let b = Rect::from_center_size(rect.center() + vec2(0.0, 1.0), vec2(14.0, 14.0));
    let p = ui.painter();
    if done {
        p.rect_filled(b, 3.0, Color32::from_rgb(0x3D, 0x99, 0x70));
        let pts = [b.left_center() + vec2(3.2, 0.5), b.center_bottom() + vec2(-1.0, -3.6), b.right_top() + vec2(-3.2, 3.8)];
        p.line_segment([pts[0], pts[1]], Stroke::new(1.8_f32, Color32::WHITE));
        p.line_segment([pts[1], pts[2]], Stroke::new(1.8_f32, Color32::WHITE));
    } else {
        let c = if resp.hovered() { SELECT } else { pal().faint };
        p.rect_stroke(b, 3.0, Stroke::new(1.5_f32, c), StrokeKind::Inside);
    }
    resp
}

fn small_button(ui: &mut Ui, text: &str, tip: &str) -> Response {
    ui.add(Button::new(RichText::new(text).size(13.0).color(muted())).frame(false).min_size(vec2(18.0, 18.0))).on_hover_text(tip)
}

/// Select all text of a field the moment it gets the keyboard (used for renaming).
fn select_all_on_focus(ui: &Ui, id: Id, len: usize) {
    if let Some(mut st) = egui::TextEdit::load_state(ui.ctx(), id) {
        st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(len))));
        st.store(ui.ctx(), id);
    }
}

/// Draw one card at `min` (in the coordinates of `ui`) and report what happened to it.
pub fn draw_card(ui: &mut Ui, card: &mut Card, min: Pos2, width: f32, fixed_h: Option<f32>, cached_h: f32, cx: &CardCtx) -> CardOut {
    let id = Id::new(("card", card.id));
    let h0 = fixed_h.unwrap_or(cached_h).max(20.0);
    let resp = ui.interact(Rect::from_min_size(min, vec2(width, h0)), id, Sense::click_and_drag());
    let bg = ui.painter().add(Shape::Noop);
    let mut child = ui.new_child(
        UiBuilder::new()
            .max_rect(Rect::from_min_size(min, vec2(width, fixed_h.unwrap_or(6000.0))))
            .layout(Layout::top_down(Align::Min))
            .id_salt(("cardui", card.id)),
    );
    child.set_width(width);
    child.spacing_mut().item_spacing.y = 0.0;
    let mut out =
        CardOut { resp: resp.clone(), height: h0, changed: false, checkpoint: false, board_name: None, open_url: None, focus_item: None };
    let is_column = matches!(card.content, Content::Column { .. });
    let is_board = matches!(card.content, Content::Board { .. });
    let fill = match card.content {
        Content::Column { .. } => column_c(),
        Content::Image { .. } => card_c(),
        _ => card_color(card.color),
    };
    let card_id = card.id;
    let align = card.align;
    let spacing = vec2(6.0, 5.0);
    let mut board_icon_rect: Option<Rect> = None;

    match &mut card.content {
        Content::Note { text } => {
            Frame::NONE.inner_margin(Margin::symmetric(20, 16)).show(&mut child, |ui| {
                ui.spacing_mut().item_spacing = spacing;
                ui.set_width(ui.available_width());
                if cx.editing {
                    let halign = match align {
                        1 => Align::Center,
                        2 => Align::RIGHT,
                        _ => Align::LEFT,
                    };
                    let r = ui.add(
                        TextEdit::multiline(text)
                            .id(edit_id(card_id))
                            .frame(false)
                            .desired_width(f32::INFINITY)
                            .desired_rows(1)
                            .font(font(15.0))
                            .text_color(ink())
                            .horizontal_align(halign)
                            .lock_focus(true)
                            .hint_text(RichText::new("Start typing...").color(muted())),
                    );
                    if cx.focus {
                        r.request_focus();
                    }
                    if r.changed() {
                        out.changed = true;
                    }
                } else if text.trim().is_empty() {
                    ui.label(RichText::new("Start typing...").color(muted()).size(15.0));
                } else {
                    let job = markdown_job(text, 15.0, ink(), ui.available_width(), align);
                    ui.add(Label::new(job).wrap());
                }
            });
        }
        Content::Todo { title, items } => {
            Frame::NONE.inner_margin(Margin::symmetric(18, 14)).show(&mut child, |ui| {
                ui.spacing_mut().item_spacing = spacing;
                ui.set_width(ui.available_width());
                let done = items.iter().filter(|i| i.done).count();
                if cx.editing || !title.trim().is_empty() {
                    ui.horizontal(|ui| {
                        if cx.editing {
                            let r = ui.add(
                                TextEdit::singleline(title)
                                    .id(edit_id(card_id))
                                    .frame(false)
                                    .font(semibold_font(15.0))
                                    .desired_width(ui.available_width() - 40.0)
                                    .hint_text(RichText::new("Title (optional)").color(muted())),
                            );
                            if cx.focus && cx.focus_item.is_none() {
                                r.request_focus();
                            }
                            if r.changed() {
                                out.changed = true;
                            }
                        } else {
                            ui.add(Label::new(RichText::new(title.as_str()).font(semibold_font(15.0))).truncate());
                        }
                        if !items.is_empty() {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                ui.label(RichText::new(format!("{done}/{}", items.len())).size(12.0).color(muted()));
                            });
                        }
                    });
                    ui.add_space(2.0);
                }
                let mut remove = None;
                let mut swap = None;
                let mut insert_after = None;
                let n = items.len();
                for (i, item) in items.iter_mut().enumerate() {
                    ui.horizontal_top(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        if checkbox(ui, item.done, Id::new(("check", card_id, i))).clicked() {
                            item.done = !item.done;
                            out.changed = true;
                            out.checkpoint = true;
                        }
                        if cx.editing {
                            let r = ui.add(
                                TextEdit::singleline(&mut item.text)
                                    .id(Id::new(("todo", card_id, i)))
                                    .frame(false)
                                    .font(font(14.5))
                                    .desired_width((ui.available_width() - 66.0).max(40.0))
                                    .hint_text(RichText::new("Add a task...").color(muted())),
                            );
                            if cx.focus_item == Some(i) {
                                r.request_focus();
                            }
                            if r.changed() {
                                out.changed = true;
                            }
                            if r.lost_focus() && ui.input(|inp| inp.key_pressed(Key::Enter)) {
                                insert_after = Some(i);
                            }
                            if i > 0 && small_button(ui, "↑", "Move up").clicked() {
                                swap = Some((i, i - 1));
                            }
                            if i + 1 < n && small_button(ui, "↓", "Move down").clicked() {
                                swap = Some((i, i + 1));
                            }
                            if small_button(ui, "×", "Remove").clicked() {
                                remove = Some(i);
                            }
                        } else if item.text.is_empty() {
                            ui.label(RichText::new("Add a task...").size(14.5).color(muted()));
                        } else {
                            let mut rt = RichText::new(&item.text).size(14.5);
                            if item.done {
                                rt = rt.strikethrough().color(muted());
                            }
                            ui.add(Label::new(rt).wrap());
                        }
                    });
                }
                if let Some((a, b)) = swap {
                    items.swap(a, b);
                    out.changed = true;
                    out.checkpoint = true;
                    out.focus_item = Some(b);
                }
                if let Some(i) = remove {
                    items.remove(i);
                    out.changed = true;
                    out.checkpoint = true;
                }
                if let Some(i) = insert_after {
                    items.insert(i + 1, TodoItem { text: String::new(), done: false });
                    out.changed = true;
                    out.focus_item = Some(i + 1);
                }
                if cx.editing {
                    ui.add_space(2.0);
                    if ui.add(Button::new(RichText::new("+  Add a task").color(muted()).size(13.0)).frame(false)).clicked() {
                        items.push(TodoItem { text: String::new(), done: false });
                        out.changed = true;
                        out.focus_item = Some(items.len() - 1);
                    }
                } else if items.is_empty() {
                    ui.label(RichText::new("Add a task...").color(muted()).size(14.5));
                }
            });
        }
        Content::Link { url, title } => {
            let domain = domain_of(url);
            Frame::NONE.inner_margin(Margin::symmetric(14, 12)).show(&mut child, |ui| {
                ui.spacing_mut().item_spacing = spacing;
                ui.set_width(ui.available_width());
                if cx.editing {
                    ui.label(RichText::new("Web address").size(12.0).color(muted()));
                    let r = ui.add(TextEdit::singleline(url).id(edit_id(card_id)).desired_width(f32::INFINITY).hint_text("https://"));
                    if cx.focus {
                        r.request_focus();
                    }
                    ui.label(RichText::new("Title").size(12.0).color(muted()));
                    let r2 = ui.add(TextEdit::singleline(title).id(edit_id2(card_id)).desired_width(f32::INFINITY).hint_text("Optional"));
                    if r.changed() || r2.changed() {
                        out.changed = true;
                    }
                    return;
                }
                ui.horizontal_top(|ui| {
                    ui.spacing_mut().item_spacing.x = 10.0;
                    let (tile, _) = ui.allocate_exact_size(vec2(36.0, 36.0), Sense::hover());
                    ui.painter().rect_filled(tile, 6.0, hash_color(&domain));
                    let letter = domain.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_else(|| "↗".into());
                    ui.painter().text(tile.center(), Align2::CENTER_CENTER, letter, bold_font(17.0), Color32::WHITE);
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        let t = if !title.trim().is_empty() {
                            title.clone()
                        } else if !domain.is_empty() {
                            domain.clone()
                        } else {
                            "Untitled link".into()
                        };
                        ui.add(Label::new(RichText::new(t).font(semibold_font(14.5))).wrap());
                        if url.is_empty() {
                            ui.label(RichText::new("Double-click to add a web address").size(12.5).color(muted()));
                        } else {
                            ui.add(Label::new(RichText::new(domain.as_str()).size(12.5).color(muted())).truncate());
                        }
                    });
                });
                if !url.is_empty() {
                    ui.add_space(2.0);
                    if ui
                        .add(Button::new(RichText::new("Open ↗").size(12.5).color(SELECT)).frame(false))
                        .on_hover_text(url.as_str())
                        .clicked()
                    {
                        out.open_url = Some(url.clone());
                    }
                }
            });
        }
        Content::Image { caption, aspect, .. } => {
            let h = width * aspect.clamp(0.05, 8.0);
            let size = vec2(width, h);
            if let Some((tex, _)) = cx.texture {
                child.add(egui::Image::new((tex, size)).corner_radius(CornerRadius { nw: 3, ne: 3, sw: 0, se: 0 }));
            } else {
                let (r, _) = child.allocate_exact_size(size, Sense::hover());
                child.painter().rect_filled(r, 3.0, pal().hover);
                child.painter().text(r.center(), Align2::CENTER_CENTER, "Picture not found", font(13.0), muted());
            }
            if cx.editing || !caption.is_empty() {
                Frame::NONE.inner_margin(Margin::symmetric(14, 10)).show(&mut child, |ui| {
                    ui.spacing_mut().item_spacing = spacing;
                    ui.set_width(ui.available_width());
                    if cx.editing {
                        let r = ui.add(
                            TextEdit::multiline(caption)
                                .id(edit_id(card_id))
                                .frame(false)
                                .desired_rows(1)
                                .desired_width(f32::INFINITY)
                                .font(font(13.5))
                                .hint_text(RichText::new("Add a caption...").color(muted())),
                        );
                        if cx.focus {
                            r.request_focus();
                        }
                        if r.changed() {
                            out.changed = true;
                        }
                    } else {
                        ui.add(Label::new(RichText::new(caption.as_str()).size(13.5).color(muted())).wrap());
                    }
                });
            }
        }
        Content::Board { .. } => {
            let (name, color, count, icon) = cx.board.unwrap_or(("Missing board", 0, 0, None));
            child.spacing_mut().item_spacing = vec2(6.0, 2.0);
            let (row, _) = child.allocate_exact_size(vec2(width, BOARD_ICON), Sense::hover());
            let sq = Rect::from_center_size(row.center(), vec2(BOARD_ICON, BOARD_ICON));
            board_icon_rect = Some(sq);
            let p = child.painter();
            p.rect_filled(sq.translate(vec2(0.0, 1.0)), 14.0, Color32::from_black_alpha(pal().shadow_alpha / 2));
            p.rect_filled(sq, 14.0, board_color(color));
            if let Some(sym) = icon {
                let glyph = if on_board_is_light(color) { Color32::from_white_alpha(225) } else { Color32::from_black_alpha(165) };
                p.text(sq.center(), Align2::CENTER_CENTER, sym, font(34.0), glyph);
            }
            if resp.hovered() && !cx.selected {
                p.rect_stroke(sq, 14.0, Stroke::new(1.5_f32, pal().faint), StrokeKind::Outside);
            }
            child.add_space(8.0);
            if cx.editing {
                let mut n = name.to_string();
                let eid = edit_id(card_id);
                let r = child.add(
                    TextEdit::singleline(&mut n)
                        .id(eid)
                        .font(semibold_font(15.0))
                        .horizontal_align(Align::Center)
                        .desired_width(f32::INFINITY),
                );
                if cx.focus {
                    r.request_focus();
                }
                if r.gained_focus() {
                    select_all_on_focus(&child, eid, name.chars().count());
                }
                if r.changed() {
                    out.board_name = Some(n);
                }
            } else {
                child.vertical_centered(|ui| {
                    ui.add(Label::new(RichText::new(name).font(semibold_font(15.0))).wrap());
                });
            }
            child.vertical_centered(|ui| {
                let label = if count == 1 { "1 card".to_string() } else { format!("{count} cards") };
                ui.label(RichText::new(label).size(12.5).color(muted()));
            });
        }
        Content::Column { title, children } => {
            let count = children.len();
            Frame::NONE.inner_margin(Margin { left: 14, right: 12, top: 12, bottom: 8 }).show(&mut child, |ui| {
                ui.spacing_mut().item_spacing = spacing;
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    if cx.editing {
                        let r = ui.add(
                            TextEdit::singleline(title)
                                .id(edit_id(card_id))
                                .font(semibold_font(14.5))
                                .frame(false)
                                .desired_width(ui.available_width() - 30.0)
                                .hint_text(RichText::new("Column title").color(muted())),
                        );
                        if cx.focus {
                            r.request_focus();
                        }
                        if r.changed() {
                            out.changed = true;
                        }
                    } else {
                        let t = if title.trim().is_empty() { "Untitled column" } else { title.as_str() };
                        ui.add(Label::new(RichText::new(t).font(semibold_font(14.5))).truncate());
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        ui.label(RichText::new(count.to_string()).size(12.0).color(muted()));
                    });
                });
            });
            if count == 0 {
                if let Some(h) = fixed_h {
                    let area = Rect::from_min_max(pos2(min.x + 10.0, min.y + 44.0), pos2(min.x + width - 10.0, min.y + h - 10.0));
                    child.painter().rect_stroke(area, 4.0, Stroke::new(1.0_f32, border_c()), StrokeKind::Inside);
                    child.painter().text(area.center(), Align2::CENTER_CENTER, "Drop cards here", font(13.0), muted());
                }
            }
        }
    }

    let used = child.min_rect();
    let height = fixed_h.unwrap_or(used.height().max(24.0)).round();
    let rect = Rect::from_min_size(min, vec2(width, height));
    if is_board {
        // A board has no card behind it: only its square, title and count.
        if cx.selected {
            if let Some(sq) = board_icon_rect {
                ui.painter().rect_stroke(sq, 14.0, Stroke::new(2.0_f32, ink()), StrokeKind::Outside);
            }
        }
        if cx.drop_target {
            ui.painter().rect_stroke(rect, 6.0, Stroke::new(2.0_f32, SELECT.gamma_multiply(0.7)), StrokeKind::Outside);
        }
        out.height = height;
        return out;
    }
    let radius: u8 = if is_column { 4 } else { 3 };
    let mut shapes: Vec<Shape> = vec![];
    if !is_column {
        let shadow = egui::Shadow { offset: [0, 1], blur: 4, spread: 0, color: Color32::from_black_alpha(pal().shadow_alpha) };
        shapes.push(shadow.as_shape(rect, CornerRadius::same(radius)).into());
    }
    shapes.push(Shape::rect_filled(rect, radius, fill));
    if is_column {
        shapes.push(Shape::rect_stroke(rect, radius, Stroke::new(1.0_f32, border_c()), StrokeKind::Inside));
    } else if resp.hovered() && !cx.selected {
        shapes.push(Shape::rect_stroke(rect, radius, Stroke::new(1.0_f32, pal().faint), StrokeKind::Inside));
    }
    ui.painter().set(bg, Shape::Vec(shapes));
    if cx.selected {
        ui.painter().rect_stroke(rect, radius, Stroke::new(2.0_f32, SELECT), StrokeKind::Outside);
    }
    if cx.drop_target {
        ui.painter().rect_stroke(rect, radius, Stroke::new(2.0_f32, SELECT.gamma_multiply(0.7)), StrokeKind::Outside);
    }
    if card.locked {
        paint_lock(ui.painter(), rect.right_top() + vec2(-12.0, 12.0));
    }
    out.height = height;
    out
}

/// A tiny padlock drawn on locked cards.
fn paint_lock(p: &egui::Painter, c: Pos2) {
    let body = Rect::from_center_size(c + vec2(0.0, 2.0), vec2(9.0, 7.0));
    p.rect_filled(body, 1.5, muted());
    p.circle_stroke(c + vec2(0.0, -1.5), 2.8, Stroke::new(1.4_f32, muted()));
}
