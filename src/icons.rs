//! Original vector icons for the toolbar and header, drawn with shapes (no icon fonts, no emoji).

use crate::theme::*;
use eframe::egui::{pos2, vec2, Color32, Painter, Pos2, Rect, Shape, Stroke, StrokeKind};
use std::f32::consts::TAU;

fn card(p: &Painter, r: Rect, dim: bool) {
    let pal = pal();
    let fill = if dim { pal.icon_card.gamma_multiply(0.6) } else { pal.icon_card };
    p.rect_filled(r.translate(vec2(0.0, 1.0)), 2.5, Color32::from_black_alpha(if is_dark() { 50 } else { 14 }));
    p.rect_filled(r, 2.5, fill);
    if !is_dark() {
        p.rect_stroke(r, 2.5, Stroke::new(1.0_f32, Color32::from_black_alpha(18)), StrokeKind::Inside);
    }
}

fn arc(c: Pos2, r: f32, a0: f32, a1: f32, n: usize) -> Vec<Pos2> {
    (0..=n)
        .map(|i| {
            let a = a0 + (a1 - a0) * i as f32 / n as f32;
            c + vec2(a.cos(), a.sin()) * r
        })
        .collect()
}

/// Draw the icon called `name` centred on `c`, in a box about 30 points wide.
pub fn paint(p: &Painter, name: &str, c: Pos2, col: Color32, dim: bool) {
    let s = Stroke::new(1.6_f32, col);
    let line_col = if dim { col.gamma_multiply(0.5) } else { muted() };
    let thin = Stroke::new(1.5_f32, line_col);
    let r = |x: f32, y: f32, w: f32, h: f32| Rect::from_min_size(c + vec2(x, y), vec2(w, h));
    match name {
        "Note" => {
            let b = r(-12.0, -11.0, 24.0, 22.0);
            card(p, b, dim);
            for i in 0..4 {
                let y = b.top() + 5.0 + i as f32 * 4.0;
                let w = if i == 3 { 9.0 } else { 15.0 };
                p.line_segment([pos2(b.left() + 4.5, y), pos2(b.left() + 4.5 + w, y)], thin);
            }
        }
        "Link" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            card(p, b, dim);
            let st = Stroke::new(1.6_f32, col);
            p.add(Shape::line(arc(c + vec2(-2.5, 2.5), 3.4, 0.25 * TAU, 0.95 * TAU, 12), st));
            p.add(Shape::line(arc(c + vec2(2.5, -2.5), 3.4, 0.75 * TAU, 1.45 * TAU, 12), st));
            p.line_segment([c + vec2(-1.5, 1.5), c + vec2(1.5, -1.5)], st);
        }
        "To-do" => {
            let b = r(-12.0, -11.0, 24.0, 22.0);
            card(p, b, dim);
            for (i, y) in [-4.0, 3.0].iter().enumerate() {
                let o = c + vec2(-7.0, *y);
                p.line_segment([o, o + vec2(1.6, 1.6)], Stroke::new(1.4_f32, col));
                p.line_segment([o + vec2(1.6, 1.6), o + vec2(4.4, -1.8)], Stroke::new(1.4_f32, col));
                let w = if i == 0 { 9.0 } else { 7.0 };
                p.line_segment([c + vec2(0.0, *y), c + vec2(w, *y)], thin);
            }
        }
        "Line" => {
            p.line_segment([c + vec2(-11.0, 11.0), c + vec2(11.0, -11.0)], Stroke::new(2.0_f32, col));
        }
        "Board" => {
            let fill = if dim { TOOL_BLUE.gamma_multiply(0.5) } else { TOOL_BLUE };
            p.rect_filled(r(-13.0, -13.0, 26.0, 26.0), 6.0, fill);
            for (dx, dy, a) in [(-1.0, -1.0, 255), (1.0, -1.0, 150), (-1.0, 1.0, 150), (1.0, 1.0, 150)] {
                p.rect_filled(Rect::from_center_size(c + vec2(dx * 3.8, dy * 3.8), vec2(5.5, 5.5)), 1.2, Color32::from_white_alpha(a));
            }
        }
        "Column" => {
            let b = r(-11.0, -13.0, 22.0, 26.0);
            card(p, b, dim);
            p.rect_filled(Rect::from_min_size(b.min, vec2(b.width(), 3.0)), 1.0, col);
        }
        "Comment" => {
            let b = r(-12.0, -10.0, 24.0, 18.0);
            let fill = if is_dark() { Color32::from_rgb(0x3A, 0x45, 0x70) } else { Color32::from_rgb(0xDF, 0xE6, 0xFB) };
            p.rect_filled(b, 2.5, if dim { fill.gamma_multiply(0.6) } else { fill });
            for i in 0..3 {
                let y = b.top() + 5.0 + i as f32 * 4.0;
                p.line_segment(
                    [pos2(b.left() + 4.0, y), pos2(b.right() - 4.0, y)],
                    Stroke::new(1.4_f32, TOOL_BLUE.gamma_multiply(if dim { 0.4 } else { 0.8 })),
                );
            }
            p.add(Shape::convex_polygon(
                vec![pos2(b.left() + 5.0, b.bottom()), pos2(b.left() + 10.0, b.bottom()), pos2(b.left() + 5.0, b.bottom() + 4.0)],
                if dim { fill.gamma_multiply(0.6) } else { fill },
                Stroke::NONE,
            ));
        }
        "Table" => {
            let b = r(-12.0, -10.0, 24.0, 20.0);
            card(p, b, dim);
            p.line_segment([pos2(b.left(), b.top() + 6.5), pos2(b.right(), b.top() + 6.5)], thin);
            p.line_segment([pos2(b.left(), b.top() + 13.0), pos2(b.right(), b.top() + 13.0)], thin);
            p.line_segment([pos2(c.x, b.top()), pos2(c.x, b.bottom())], thin);
        }
        "More" => {
            for dx in [-6.0, 0.0, 6.0] {
                p.circle_filled(c + vec2(dx, 0.0), 2.1, col);
            }
        }
        "Add image" | "Image" | "Replace" => {
            let b = r(-11.0, -10.0, 22.0, 20.0);
            p.rect_stroke(b, 3.0, s, StrokeKind::Middle);
            p.circle_filled(c + vec2(4.5, -3.5), 2.2, col);
            p.add(Shape::line(
                vec![c + vec2(-9.0, 7.0), c + vec2(-3.0, 0.5), c + vec2(1.5, 5.0), c + vec2(4.5, 2.5), c + vec2(9.0, 7.0)],
                s,
            ));
            if name == "Replace" {
                p.circle_filled(b.right_bottom(), 5.5, pal().toolbar);
                p.add(Shape::line(arc(b.right_bottom(), 3.5, 0.0, 0.75 * TAU, 10), Stroke::new(1.4_f32, col)));
            }
        }
        "Upload" => {
            let pts = vec![
                c + vec2(-8.0, -11.0),
                c + vec2(3.0, -11.0),
                c + vec2(8.0, -6.0),
                c + vec2(8.0, 11.0),
                c + vec2(-8.0, 11.0),
                c + vec2(-8.0, -11.0),
            ];
            p.add(Shape::line(pts, s));
            p.add(Shape::line(vec![c + vec2(3.0, -11.0), c + vec2(3.0, -6.0), c + vec2(8.0, -6.0)], s));
        }
        "Draw" | "Edit" => {
            let a = c + vec2(-8.0, 9.0);
            let d = vec2(1.0, -1.0).normalized();
            let n = vec2(d.y, -d.x) * 2.6;
            let tip = a;
            let b0 = a + d * 4.0;
            let e = a + d * 19.0;
            p.add(Shape::line(vec![tip, b0 + n, e + n, e - n, b0 - n, tip], s));
            p.line_segment([b0 + n, b0 - n], s);
        }
        "Trash" => {
            let fill = if dim { pal().faint.gamma_multiply(0.6) } else { pal().faint };
            p.rect_filled(r(-10.0, -9.0, 20.0, 3.0), 1.0, fill);
            p.add(Shape::convex_polygon(
                vec![c + vec2(-8.5, -4.5), c + vec2(8.5, -4.5), c + vec2(7.0, 12.0), c + vec2(-7.0, 12.0)],
                fill,
                Stroke::NONE,
            ));
        }
        "Delete" => {
            p.line_segment([c + vec2(-9.0, -6.0), c + vec2(9.0, -6.0)], s);
            p.line_segment([c + vec2(-3.0, -9.0), c + vec2(3.0, -9.0)], s);
            p.add(Shape::line(vec![c + vec2(-7.0, -6.0), c + vec2(-6.0, 9.0), c + vec2(6.0, 9.0), c + vec2(7.0, -6.0)], s));
        }
        "Back" => {
            p.line_segment([c + vec2(-7.0, 0.0), c + vec2(7.0, 0.0)], s);
            p.line_segment([c + vec2(-7.0, 0.0), c + vec2(-3.0, -4.0)], s);
            p.line_segment([c + vec2(-7.0, 0.0), c + vec2(-3.0, 4.0)], s);
        }
        "Icon" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            p.rect_filled(b, 5.0, pal().board_default);
            p.circle_stroke(c, 5.5, Stroke::new(1.4_f32, col));
            p.circle_filled(c + vec2(-2.0, -1.5), 0.9, col);
            p.circle_filled(c + vec2(2.0, -1.5), 0.9, col);
            p.add(Shape::line(arc(c + vec2(0.0, 0.5), 2.6, 0.1 * TAU, 0.4 * TAU, 8), Stroke::new(1.2_f32, col)));
        }
        "Rename" => {
            let b = r(-11.0, -10.0, 22.0, 20.0);
            p.rect_stroke(b, 2.0, s, StrokeKind::Middle);
            p.add(Shape::line(vec![c + vec2(-6.0, 5.0), c + vec2(-2.0, -5.0), c + vec2(2.0, 5.0)], Stroke::new(1.4_f32, col)));
            p.line_segment([c + vec2(-4.5, 1.5), c + vec2(0.5, 1.5)], Stroke::new(1.4_f32, col));
            p.line_segment([c + vec2(6.0, -6.0), c + vec2(6.0, 6.0)], Stroke::new(1.4_f32, col));
        }
        "Open" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            p.rect_stroke(b, 5.0, s, StrokeKind::Middle);
            p.line_segment([c + vec2(-4.0, 4.0), c + vec2(4.0, -4.0)], s);
            p.line_segment([c + vec2(4.0, -4.0), c + vec2(-1.0, -4.0)], s);
            p.line_segment([c + vec2(4.0, -4.0), c + vec2(4.0, 1.0)], s);
        }
        "Duplicate" => {
            p.rect_stroke(r(-10.0, -10.0, 14.0, 14.0), 2.0, s, StrokeKind::Middle);
            p.rect_filled(r(-4.0, -4.0, 14.0, 14.0), 2.0, pal().toolbar);
            p.rect_stroke(r(-4.0, -4.0, 14.0, 14.0), 2.0, s, StrokeKind::Middle);
        }
        "Start" | "End" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            p.rect_stroke(b, 2.0, s, StrokeKind::Middle);
            let (from, to) =
                if name == "End" { (c + vec2(-6.0, 0.0), c + vec2(6.0, 0.0)) } else { (c + vec2(6.0, 0.0), c + vec2(-6.0, 0.0)) };
            p.line_segment([from, to], s);
            let d = (to - from).normalized();
            let n = vec2(-d.y, d.x);
            p.add(Shape::convex_polygon(vec![to + d * 1.5, to - d * 4.0 + n * 3.5, to - d * 4.0 - n * 3.5], col, Stroke::NONE));
        }
        "Label" => {
            p.line_segment([c + vec2(-12.0, 0.0), c + vec2(12.0, 0.0)], s);
            p.rect_filled(r(-7.0, -4.5, 14.0, 9.0), 3.0, col);
        }
        "Dashed" => {
            for i in 0..4 {
                let a = c + vec2(-11.0, 11.0) + vec2(1.0, -1.0) * (i as f32 * 6.0);
                p.line_segment([a, a + vec2(3.5, -3.5)], Stroke::new(2.0_f32, col));
            }
        }
        "Weight" => {
            for (i, w) in [1.0_f32, 2.0, 3.2].iter().enumerate() {
                let y = -7.0 + i as f32 * 7.0;
                p.line_segment([c + vec2(-10.0, y), c + vec2(10.0, y)], Stroke::new(*w, col));
            }
        }
        "Caption" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            p.rect_stroke(b, 2.0, s, StrokeKind::Middle);
            p.rect_filled(r(-11.0, -11.0, 22.0, 12.0), 2.0, col.gamma_multiply(0.35));
            p.line_segment([c + vec2(-7.0, 5.0), c + vec2(7.0, 5.0)], thin);
        }
        "Add task" | "Add note" => {
            let b = r(-11.0, -11.0, 22.0, 22.0);
            card(p, b, dim);
            p.line_segment([c + vec2(-5.0, 0.0), c + vec2(5.0, 0.0)], s);
            p.line_segment([c + vec2(0.0, -5.0), c + vec2(0.0, 5.0)], s);
        }
        "Align" => {
            for (i, w) in [18.0_f32, 12.0, 18.0, 9.0].iter().enumerate() {
                let y = -7.5 + i as f32 * 5.0;
                p.line_segment([c + vec2(-9.0, y), c + vec2(-9.0 + w, y)], s);
            }
        }
        "Undo" | "Redo" => {
            let flip = if name == "Redo" { -1.0 } else { 1.0 };
            let pts: Vec<Pos2> =
                arc(c + vec2(0.0, 1.5), 6.5, -0.5 * TAU, 0.25 * TAU, 14).into_iter().map(|q| pos2(c.x + (q.x - c.x) * flip, q.y)).collect();
            p.add(Shape::line(pts.clone(), s));
            let start = pts[0];
            p.line_segment([start, start + vec2(-3.2, -3.4)], s);
            p.line_segment([start, start + vec2(3.2, -3.4)], s);
        }
        "Help" => {
            p.circle_stroke(c, 9.0, s);
            p.add(Shape::line(arc(c + vec2(0.0, -2.5), 3.0, 0.5 * TAU, 1.15 * TAU, 10), s));
            p.line_segment([c + vec2(1.2, -0.3), c + vec2(0.0, 2.0)], s);
            p.circle_filled(c + vec2(0.0, 5.0), 1.1, col);
        }
        "Search" => {
            p.circle_stroke(c + vec2(-1.5, -1.5), 6.5, s);
            p.line_segment([c + vec2(3.3, 3.3), c + vec2(8.5, 8.5)], Stroke::new(1.8_f32, col));
        }
        "Settings" => {
            for i in 0..8 {
                let a = i as f32 / 8.0 * TAU;
                let d = vec2(a.cos(), a.sin());
                p.line_segment([c + d * 6.5, c + d * 9.5], Stroke::new(2.4_f32, col));
            }
            p.circle_stroke(c, 6.5, s);
            p.circle_stroke(c, 2.6, s);
        }
        "Unsorted" => {
            p.rect_stroke(r(-10.0, -9.0, 20.0, 18.0), 2.5, s, StrokeKind::Middle);
            p.line_segment([c + vec2(3.0, -9.0), c + vec2(3.0, 9.0)], s);
        }
        "Close" => {
            p.line_segment([c + vec2(-5.0, -5.0), c + vec2(5.0, 5.0)], s);
            p.line_segment([c + vec2(5.0, -5.0), c + vec2(-5.0, 5.0)], s);
        }
        "Check" => {
            p.circle_filled(c, 9.0, SUCCESS);
            p.line_segment([c + vec2(-4.0, 0.5), c + vec2(-1.0, 3.5)], Stroke::new(2.0_f32, Color32::WHITE));
            p.line_segment([c + vec2(-1.0, 3.5), c + vec2(4.5, -3.0)], Stroke::new(2.0_f32, Color32::WHITE));
        }
        _ => {}
    }
}

/// The app's own mark: a dark rounded square with a folded corner.
pub fn logo(p: &Painter, c: Pos2) {
    let b = Rect::from_center_size(c, vec2(18.0, 18.0));
    let ink = ink();
    p.circle_filled(c, 9.5, ink);
    let bg = pal().header;
    p.rect_filled(Rect::from_center_size(c + vec2(-1.0, 0.5), vec2(7.0, 8.0)), 1.0, bg);
    p.add(Shape::convex_polygon(
        vec![pos2(c.x + 2.5, b.top() + 5.0), pos2(c.x + 5.0, b.top() + 7.5), pos2(c.x + 2.5, b.top() + 7.5)],
        bg,
        Stroke::NONE,
    ));
}

/// Board symbols offered in the icon picker, with words to find them by. Only those the bundled
/// emoji font can draw are shown.
pub const BOARD_ICONS: [(&str, &str); 48] = [
    ("😀", "smile happy face"),
    ("😎", "cool sunglasses face"),
    ("🙂", "calm face"),
    ("😍", "love face"),
    ("🤔", "thinking idea face"),
    ("😴", "sleep tired face"),
    ("🔥", "fire hot"),
    ("⭐", "star favourite"),
    ("💡", "idea light bulb"),
    ("📌", "pin important"),
    ("📁", "folder files"),
    ("📚", "books reading study"),
    ("🎨", "art design paint"),
    ("🎵", "music song"),
    ("🏠", "home house"),
    ("✈", "travel plane trip"),
    ("🚀", "launch rocket project"),
    ("🌱", "grow plant garden"),
    ("🌍", "world earth global"),
    ("💼", "work business"),
    ("📝", "notes writing"),
    ("📷", "photo camera"),
    ("🎬", "film video movie"),
    ("🍀", "luck clover"),
    ("❤", "heart love"),
    ("⚡", "energy fast"),
    ("🛠", "tools build"),
    ("🎯", "goal target"),
    ("📊", "chart data report"),
    ("📅", "calendar plan date"),
    ("💬", "chat talk message"),
    ("🔒", "lock private"),
    ("🎁", "gift present"),
    ("🐱", "cat pet"),
    ("🐶", "dog pet"),
    ("🌙", "moon night"),
    ("☀", "sun day"),
    ("🍕", "food pizza"),
    ("☕", "coffee break"),
    ("🏆", "trophy win"),
    ("🎮", "game play"),
    ("🧩", "puzzle piece"),
    ("📦", "box package"),
    ("🔔", "bell reminder"),
    ("🌊", "wave sea ocean"),
    ("🏔", "mountain"),
    ("🎓", "school learn"),
    ("💰", "money budget"),
];
