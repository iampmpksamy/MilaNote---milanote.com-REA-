//! Colours, fonts, sizes and timings: the design tokens of the app, for light and dark.
//!
//! Colours were sampled from the reference recording (see docs/DESIGN_TOKENS.md).
//! Everything else reads them through the small functions below, so switching
//! between light and dark changes the whole app at once.

use eframe::egui::{self, Color32, FontData, FontDefinitions, FontFamily, FontId, TextStyle};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// One complete set of interface colours.
pub struct Palette {
    pub canvas: Color32,
    pub header: Color32,
    pub toolbar: Color32,
    pub card: Color32,
    pub text: Color32,
    pub muted: Color32,
    pub faint: Color32,
    pub border: Color32,
    pub divider: Color32,
    pub dot: Color32,
    pub column_bg: Color32,
    pub hover: Color32,
    pub pressed: Color32,
    pub popup: Color32,
    pub line: Color32,
    pub board_default: Color32,
    pub icon: Color32,
    pub icon_card: Color32,
    pub shadow_alpha: u8,
}

pub const LIGHT: Palette = Palette {
    canvas: Color32::from_rgb(0xEA, 0xEB, 0xEE),
    header: Color32::from_rgb(0xFF, 0xFF, 0xFF),
    toolbar: Color32::from_rgb(0xEA, 0xEB, 0xEE),
    card: Color32::from_rgb(0xFF, 0xFF, 0xFF),
    text: Color32::from_rgb(0x2F, 0x32, 0x37),
    muted: Color32::from_rgb(0x86, 0x8A, 0x92),
    faint: Color32::from_rgb(0xB4, 0xB7, 0xBD),
    border: Color32::from_rgb(0xDC, 0xDD, 0xE0),
    divider: Color32::from_rgb(0xD7, 0xD8, 0xDB),
    dot: Color32::from_rgb(0xCF, 0xD1, 0xD6),
    column_bg: Color32::from_rgb(0xF5, 0xF5, 0xF6),
    hover: Color32::from_rgb(0xDF, 0xE0, 0xE4),
    pressed: Color32::from_rgb(0xD4, 0xD6, 0xDA),
    popup: Color32::from_rgb(0xFF, 0xFF, 0xFF),
    line: Color32::from_rgb(0x2F, 0x32, 0x37),
    board_default: Color32::from_rgb(0xB9, 0xBD, 0xC1),
    icon: Color32::from_rgb(0x4A, 0x4F, 0x59),
    icon_card: Color32::from_rgb(0xFF, 0xFF, 0xFF),
    shadow_alpha: 18,
};

pub const DARK: Palette = Palette {
    canvas: Color32::from_rgb(0x1D, 0x1D, 0x1D),
    header: Color32::from_rgb(0x27, 0x27, 0x27),
    toolbar: Color32::from_rgb(0x1D, 0x1D, 0x1D),
    card: Color32::from_rgb(0x27, 0x27, 0x27),
    text: Color32::from_rgb(0xE6, 0xE6, 0xE6),
    muted: Color32::from_rgb(0x92, 0x92, 0x92),
    faint: Color32::from_rgb(0x5C, 0x5C, 0x5C),
    border: Color32::from_rgb(0x35, 0x35, 0x35),
    divider: Color32::from_rgb(0x30, 0x30, 0x30),
    dot: Color32::from_rgb(0x30, 0x30, 0x30),
    column_bg: Color32::from_rgb(0x22, 0x22, 0x22),
    hover: Color32::from_rgb(0x2E, 0x2E, 0x2E),
    pressed: Color32::from_rgb(0x38, 0x38, 0x38),
    popup: Color32::from_rgb(0x2A, 0x2A, 0x2A),
    line: Color32::from_rgb(0xCB, 0xCB, 0xCB),
    board_default: Color32::from_rgb(0x80, 0x80, 0x80),
    icon: Color32::from_rgb(0xE0, 0xE0, 0xE0),
    icon_card: Color32::from_rgb(0x3A, 0x3A, 0x3A),
    shadow_alpha: 60,
};

static IS_DARK: AtomicBool = AtomicBool::new(false);

pub fn set_dark(dark: bool) {
    IS_DARK.store(dark, Ordering::Relaxed);
}

pub fn is_dark() -> bool {
    IS_DARK.load(Ordering::Relaxed)
}

pub fn pal() -> &'static Palette {
    if is_dark() {
        &DARK
    } else {
        &LIGHT
    }
}

pub fn canvas_c() -> Color32 {
    pal().canvas
}
pub fn card_c() -> Color32 {
    pal().card
}
pub fn ink() -> Color32 {
    pal().text
}
pub fn muted() -> Color32 {
    pal().muted
}
pub fn border_c() -> Color32 {
    pal().border
}
pub fn dot_c() -> Color32 {
    pal().dot
}
pub fn column_c() -> Color32 {
    pal().column_bg
}
pub fn hover_c() -> Color32 {
    pal().hover
}

/// Accent colours that stay the same in both themes.
pub const SELECT: Color32 = Color32::from_rgb(0x43, 0x78, 0xD6);
pub const ACCENT: Color32 = Color32::from_rgb(0xE9, 0xD7, 0x8C);
pub const DANGER: Color32 = Color32::from_rgb(0xD9, 0x4A, 0x38);
pub const SUCCESS: Color32 = Color32::from_rgb(0x55, 0xC8, 0x5B);
pub const TOOL_BLUE: Color32 = Color32::from_rgb(0x5C, 0x7F, 0xF5);

/// Card background colours (index 0 follows the theme).
pub const CARD_COLORS: [(&str, Color32); 7] = [
    ("Default", Color32::WHITE),
    ("Yellow", Color32::from_rgb(0xF7, 0xEE, 0xC4)),
    ("Green", Color32::from_rgb(0xDF, 0xEF, 0xDA)),
    ("Blue", Color32::from_rgb(0xDD, 0xE8, 0xF8)),
    ("Pink", Color32::from_rgb(0xF8, 0xDF, 0xE4)),
    ("Purple", Color32::from_rgb(0xE9, 0xE1, 0xF6)),
    ("Grey", Color32::from_rgb(0xEC, 0xED, 0xEC)),
];

/// Board icon colours: a neutral default, soft tones, then stronger ones.
pub const BOARD_COLORS: [(&str, Color32); 14] = [
    ("Default", Color32::from_rgb(0xB9, 0xBD, 0xC1)),
    ("Lemon", Color32::from_rgb(0xEE, 0xEC, 0xB4)),
    ("Clay", Color32::from_rgb(0xD5, 0x9A, 0x84)),
    ("Sage", Color32::from_rgb(0xB8, 0xD4, 0xB0)),
    ("Sky", Color32::from_rgb(0xAE, 0xC9, 0xEA)),
    ("Lilac", Color32::from_rgb(0xCB, 0xBC, 0xE8)),
    ("Blush", Color32::from_rgb(0xF0, 0xBE, 0xC8)),
    ("Blue", Color32::from_rgb(0x43, 0x78, 0xD6)),
    ("Coral", Color32::from_rgb(0xE0, 0x7A, 0x5F)),
    ("Green", Color32::from_rgb(0x3D, 0x99, 0x70)),
    ("Amber", Color32::from_rgb(0xE1, 0xAE, 0x3C)),
    ("Purple", Color32::from_rgb(0x8E, 0x6C, 0xC8)),
    ("Teal", Color32::from_rgb(0x3E, 0x9C, 0xA6)),
    ("Charcoal", Color32::from_rgb(0x4A, 0x50, 0x4D)),
];

/// Line colours (index 0 follows the theme).
pub const LINE_COLORS: [(&str, Color32); 6] = [
    ("Default", Color32::from_rgb(0x2F, 0x32, 0x37)),
    ("Blue", Color32::from_rgb(0x43, 0x78, 0xD6)),
    ("Red", Color32::from_rgb(0xD1, 0x55, 0x4F)),
    ("Green", Color32::from_rgb(0x3D, 0x99, 0x70)),
    ("Amber", Color32::from_rgb(0xE1, 0xAE, 0x3C)),
    ("Grey", Color32::from_rgb(0x8A, 0x90, 0x8D)),
];

pub fn card_color(i: usize) -> Color32 {
    let i = i % CARD_COLORS.len();
    if i == 0 {
        return card_c();
    }
    let c = CARD_COLORS[i].1;
    if is_dark() {
        c.lerp_to_gamma(DARK.card, 0.78)
    } else {
        c
    }
}

pub fn board_color(i: usize) -> Color32 {
    let i = i % BOARD_COLORS.len();
    if i == 0 {
        return pal().board_default;
    }
    BOARD_COLORS[i].1
}

/// Whether text and icons drawn on a board colour should be light.
pub fn on_board_is_light(i: usize) -> bool {
    let c = board_color(i);
    let lum = 0.299 * c.r() as f32 + 0.587 * c.g() as f32 + 0.114 * c.b() as f32;
    lum < 140.0
}

pub fn line_color(i: usize) -> Color32 {
    let i = i % LINE_COLORS.len();
    if i == 0 {
        return pal().line;
    }
    LINE_COLORS[i].1
}

/// Interface sizes, kept apart from the board's own zoom.
pub const SCALES: [(&str, f32); 3] = [("Small", 0.9), ("Medium", 1.0), ("Large", 1.12)];

/// Motion: short and quiet, never in the way of dragging or typing.
pub const FADE_SECS: f32 = 0.14;

pub fn bold() -> FontFamily {
    FontFamily::Name("bold".into())
}

pub fn semibold() -> FontFamily {
    FontFamily::Name("semibold".into())
}

pub fn font(size: f32) -> FontId {
    FontId::proportional(size)
}

pub fn bold_font(size: f32) -> FontId {
    FontId::new(size, bold())
}

pub fn semibold_font(size: f32) -> FontId {
    FontId::new(size, semibold())
}

static BOLD_HEADINGS: AtomicBool = AtomicBool::new(true);

pub fn set_bold_headings(on: bool) {
    BOLD_HEADINGS.store(on, Ordering::Relaxed);
}

/// The font for note headings: bold when the preference is on, otherwise semibold.
pub fn heading_font(size: f32) -> FontId {
    if BOLD_HEADINGS.load(Ordering::Relaxed) {
        bold_font(size)
    } else {
        semibold_font(size)
    }
}

fn read_first(paths: &[String]) -> Option<Vec<u8>> {
    paths.iter().find_map(|p| std::fs::read(p).ok())
}

/// Use the system's clean sans-serif when it can be found (Segoe UI on Windows), otherwise egui's own.
pub fn setup_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let wf = |f: &str| format!("{win}\\Fonts\\{f}");
    let regular = read_first(&[
        wf("segoeui.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf".into(),
        "/Library/Fonts/Arial.ttf".into(),
        "/System/Library/Fonts/Supplemental/Arial.ttf".into(),
    ]);
    let semi = read_first(&[
        wf("seguisb.ttf"),
        wf("segoeuib.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf".into(),
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf".into(),
    ]);
    let boldf = read_first(&[
        wf("segoeuib.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf".into(),
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf".into(),
    ]);
    // Tamil and other scripts: Nirmala UI ships with Windows.
    let extra = read_first(&[wf("Nirmala.ttc"), wf("Nirmala.ttf"), wf("NirmalaUI.ttf")]);
    let symbols = read_first(&[wf("seguisym.ttf")]);
    let base: Vec<String> = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let mut tail = base.clone();
    if let Some(bytes) = extra {
        fonts.font_data.insert("ui-scripts".into(), Arc::new(FontData::from_owned(bytes)));
        tail.push("ui-scripts".into());
    }
    if let Some(bytes) = symbols {
        fonts.font_data.insert("ui-symbols".into(), Arc::new(FontData::from_owned(bytes)));
        tail.push("ui-symbols".into());
    }
    let mut prop = tail.clone();
    if let Some(bytes) = regular {
        fonts.font_data.insert("ui-regular".into(), Arc::new(FontData::from_owned(bytes)));
        prop.insert(0, "ui-regular".into());
    }
    fonts.families.insert(FontFamily::Proportional, prop.clone());
    let mut b = tail.clone();
    if let Some(bytes) = boldf {
        fonts.font_data.insert("ui-bold".into(), Arc::new(FontData::from_owned(bytes)));
        b.insert(0, "ui-bold".into());
    } else {
        b = prop.clone();
    }
    fonts.families.insert(bold(), b.clone());
    let mut sb = tail;
    if let Some(bytes) = semi {
        fonts.font_data.insert("ui-semibold".into(), Arc::new(FontData::from_owned(bytes)));
        sb.insert(0, "ui-semibold".into());
    } else {
        sb = b;
    }
    fonts.families.insert(semibold(), sb);
    ctx.set_fonts(fonts);
}

/// Apply the current theme to egui's own widgets (buttons, text fields, windows, scroll bars...).
pub fn setup_style(ctx: &egui::Context) {
    let p = pal();
    let dark = is_dark();
    ctx.style_mut(|style| {
        style.visuals = if dark { egui::Visuals::dark() } else { egui::Visuals::light() };
        let v = &mut style.visuals;
        v.panel_fill = p.header;
        v.window_fill = p.popup;
        v.extreme_bg_color = if dark { Color32::from_rgb(0x22, 0x22, 0x22) } else { Color32::from_rgb(0xF3, 0xF4, 0xF5) };
        v.faint_bg_color = p.hover;
        v.override_text_color = Some(p.text);
        v.hyperlink_color = SELECT;
        v.selection.bg_fill = SELECT.gamma_multiply(if dark { 0.45 } else { 0.25 });
        v.selection.stroke = egui::Stroke::new(1.0_f32, SELECT);
        v.window_stroke = egui::Stroke::new(1.0_f32, p.border);
        v.window_shadow =
            egui::Shadow { offset: [0, 8], blur: 24, spread: 0, color: Color32::from_black_alpha(if dark { 110 } else { 34 }) };
        v.popup_shadow =
            egui::Shadow { offset: [0, 4], blur: 14, spread: 0, color: Color32::from_black_alpha(if dark { 100 } else { 30 }) };
        v.window_corner_radius = egui::CornerRadius::same(6);
        v.menu_corner_radius = egui::CornerRadius::same(6);
        v.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0_f32, p.border);
        v.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0_f32, p.text);
        v.widgets.noninteractive.bg_fill = p.popup;
        v.widgets.inactive.bg_fill = p.hover;
        v.widgets.inactive.weak_bg_fill = p.hover;
        v.widgets.inactive.fg_stroke = egui::Stroke::new(1.0_f32, p.text);
        v.widgets.hovered.bg_fill = p.pressed;
        v.widgets.hovered.weak_bg_fill = p.pressed;
        v.widgets.hovered.bg_stroke = egui::Stroke::NONE;
        v.widgets.hovered.fg_stroke = egui::Stroke::new(1.0_f32, p.text);
        v.widgets.active.bg_fill = p.pressed;
        v.widgets.active.weak_bg_fill = p.pressed;
        v.widgets.active.fg_stroke = egui::Stroke::new(1.0_f32, p.text);
        for w in
            [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open]
        {
            w.corner_radius = egui::CornerRadius::same(4);
        }
        style.interaction.selectable_labels = false;
        style.spacing.item_spacing = egui::vec2(6.0, 5.0);
        style.spacing.button_padding = egui::vec2(8.0, 4.0);
        style.spacing.menu_margin = egui::Margin::same(6);
        style.text_styles.insert(TextStyle::Body, font(14.0));
        style.text_styles.insert(TextStyle::Button, font(14.0));
        style.text_styles.insert(TextStyle::Small, font(12.0));
        style.text_styles.insert(TextStyle::Heading, semibold_font(18.0));
        style.text_styles.insert(TextStyle::Monospace, FontId::monospace(13.0));
    });
}
