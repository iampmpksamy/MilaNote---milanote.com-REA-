//! The Settings window: Appearance, Preferences, Language, Toolbar and Privacy & data.

use super::*;
use crate::icons;
use eframe::egui::{Align, Align2, Button, Color32, CursorIcon, Frame, Layout, Margin, Order, RichText, Sense, Stroke, StrokeKind};

const PAGES: [&str; 5] = ["Appearance", "Preferences", "Language", "Toolbar options", "Privacy & data"];

fn chips(ui: &mut egui::Ui, keys: &[&str]) {
    for k in keys.iter().rev() {
        if *k == "or" {
            ui.label(RichText::new("or").size(11.5).color(muted()));
            continue;
        }
        let g = ui.painter().layout_no_wrap(k.to_string(), font(11.5), ink());
        let (r, _) = ui.allocate_exact_size(vec2(g.size().x + 14.0, 20.0), Sense::hover());
        ui.painter().rect_stroke(r, 3.0, Stroke::new(1.0_f32, border_c()), StrokeKind::Inside);
        ui.painter().galley(r.center() - g.size() / 2.0, g, ink());
    }
}

/// An on/off switch.
fn toggle(ui: &mut egui::Ui, on: &mut bool, id: &str) -> bool {
    let (r, resp) = ui.allocate_exact_size(vec2(38.0, 22.0), Sense::click());
    if resp.clicked() {
        *on = !*on;
    }
    let t = ui.ctx().animate_bool_with_time(Id::new(("toggle", id)), *on, 0.12);
    let off = if is_dark() { Color32::from_gray(80) } else { Color32::from_gray(200) };
    ui.painter().rect_filled(r, 11.0, off.lerp_to_gamma(SUCCESS, t));
    let x = egui::lerp((r.left() + 11.0)..=(r.right() - 11.0), t);
    ui.painter().circle_filled(pos2(x, r.center().y), 8.5, Color32::WHITE);
    if resp.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    resp.clicked()
}

fn setting_row(ui: &mut egui::Ui, title: &str, desc: &str, on: &mut bool, id: &str) -> bool {
    let mut changed = false;
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.spacing_mut().item_spacing.y = 2.0;
            ui.set_width(ui.available_width() - 60.0);
            ui.label(RichText::new(title).font(semibold_font(14.0)));
            if !desc.is_empty() {
                ui.label(RichText::new(desc).size(12.5).color(muted()));
            }
        });
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            changed = toggle(ui, on, id);
        });
    });
    ui.add_space(10.0);
    changed
}

fn heading(ui: &mut egui::Ui, t: &str) {
    ui.label(RichText::new(t).font(semibold_font(21.0)));
    ui.add_space(12.0);
}

impl App {
    pub(super) fn settings_modal(&mut self, ctx: &egui::Context) {
        let t = ctx.animate_bool_with_time(Id::new("settings-fade"), self.settings_open, FADE_SECS);
        if t <= 0.0 {
            return;
        }
        let screen = ctx.screen_rect();
        let mut close = false;
        egui::Area::new(Id::new("settings-overlay")).order(Order::Foreground).fixed_pos(screen.min).show(ctx, |ui| {
            let (r, resp) = ui.allocate_exact_size(screen.size(), Sense::click());
            ui.painter().rect_filled(r, 0.0, Color32::from_black_alpha((120.0 * t) as u8));
            if resp.clicked() {
                close = true;
            }
        });
        let size = vec2(800.0, 600.0).min(screen.size() - vec2(40.0, 40.0));
        egui::Area::new(Id::new("settings")).order(Order::Tooltip).pivot(Align2::CENTER_CENTER).fixed_pos(screen.center()).show(
            ctx,
            |ui| {
                ui.set_opacity(t);
                Frame::window(ui.style()).inner_margin(Margin::same(22)).show(ui, |ui| {
                    ui.set_width(size.x - 44.0);
                    ui.set_height(size.y - 44.0);
                    ui.horizontal_top(|ui| {
                        ui.vertical(|ui| {
                            ui.set_width(180.0);
                            ui.add_space(4.0);
                            for (i, name) in PAGES.iter().enumerate() {
                                let (r, resp) = ui.allocate_exact_size(vec2(180.0, 38.0), Sense::click());
                                if self.settings_page == i {
                                    ui.painter().rect_filled(r, 4.0, hover_c());
                                } else if resp.hovered() {
                                    ui.painter().rect_filled(r, 4.0, hover_c().gamma_multiply(0.5));
                                }
                                ui.painter().text(r.left_center() + vec2(14.0, 0.0), Align2::LEFT_CENTER, *name, font(14.5), ink());
                                if resp.clicked() {
                                    self.settings_page = i;
                                }
                            }
                        });
                        ui.add_space(24.0);
                        ui.vertical(|ui| {
                            let w = ui.available_width();
                            ui.set_width(w);
                            {
                                let r = Rect::from_min_size(ui.max_rect().right_top() + vec2(-28.0, 0.0), vec2(28.0, 28.0));
                                let resp = ui.interact(r, Id::new("settings-close"), Sense::click());
                                if resp.hovered() {
                                    ui.painter().rect_filled(r, 5.0, hover_c());
                                }
                                icons::paint(ui.painter(), "Close", r.center(), pal().icon, false);
                                if resp.on_hover_text("Close  (Esc)").clicked() {
                                    close = true;
                                }
                            }
                            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                                ui.set_width(w - 12.0);
                                match self.settings_page {
                                    0 => self.appearance_page(ui),
                                    1 => self.preferences_page(ui),
                                    2 => self.language_page(ui),
                                    3 => self.toolbar_page(ui),
                                    _ => self.privacy_page(ui),
                                }
                            });
                        });
                    });
                });
            },
        );
        if close {
            self.settings_open = false;
        }
    }

    fn appearance_page(&mut self, ui: &mut egui::Ui) {
        heading(ui, "Appearance");
        ui.horizontal(|ui| {
            ui.label(RichText::new("Interface").font(semibold_font(15.5)));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| chips(ui, &["Ctrl", "Shift", "<", "or", ">"]));
        });
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 18.0;
            for (i, (name, _)) in SCALES.iter().enumerate() {
                ui.vertical(|ui| {
                    let (r, resp) = ui.allocate_exact_size(vec2(152.0, 104.0), Sense::click());
                    let sel = self.prefs.scale == i;
                    ui.painter().rect_filled(r, 5.0, card_c());
                    let stroke = if sel {
                        Stroke::new(2.0_f32, ink())
                    } else if resp.hovered() {
                        Stroke::new(1.0_f32, muted())
                    } else {
                        Stroke::new(1.0_f32, border_c())
                    };
                    ui.painter().rect_stroke(r, 5.0, stroke, StrokeKind::Inside);
                    let k = [0.86, 1.0, 1.16][i];
                    let clip = ui.painter().with_clip_rect(r.shrink(3.0));
                    clip.text(r.min + vec2(14.0, 14.0), Align2::LEFT_TOP, "Field notes", heading_font(14.0 * k), ink());
                    for (j, line) in ["Small ideas grow into", "big projects when they", "have room to breathe."].iter().enumerate() {
                        clip.text(
                            r.min + vec2(14.0, 38.0 * k.min(1.05) + j as f32 * 17.0 * k),
                            Align2::LEFT_TOP,
                            *line,
                            font(12.0 * k),
                            muted(),
                        );
                    }
                    if sel {
                        icons::paint(ui.painter(), "Check", r.right_top() + vec2(-14.0, 14.0), Color32::WHITE, false);
                    }
                    if resp.hovered() {
                        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                    }
                    if resp.clicked() {
                        self.set_scale(i);
                    }
                    let label = if i == 1 { format!("{name} (Recommended)") } else { name.to_string() };
                    ui.label(RichText::new(label).size(12.5).color(muted()));
                });
            }
        });
        ui.add_space(16.0);
        let mut b = self.prefs.bold_headings;
        if setting_row(
            ui,
            "Display note headings in bold",
            "Turn this off for lighter headings, which can read better in some languages.",
            &mut b,
            "bold",
        ) {
            self.prefs.bold_headings = b;
            self.prefs_dirty = true;
        }
        ui.separator();
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Color scheme").font(semibold_font(15.5)));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| chips(ui, &["Ctrl", "Shift", "D"]));
        });
        ui.add_space(8.0);
        let dark_now = is_dark();
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 18.0;
            for (i, name) in ["Light mode", "Dark mode"].iter().enumerate() {
                ui.vertical(|ui| {
                    let (r, resp) = ui.allocate_exact_size(vec2(152.0, 104.0), Sense::click());
                    let p = if i == 0 { &crate::theme::LIGHT } else { &crate::theme::DARK };
                    let sel = (i == 1) == dark_now;
                    ui.painter().rect_filled(r, 5.0, p.canvas);
                    // a tiny workspace: header, toolbar, a note and a board
                    ui.painter().rect_filled(Rect::from_min_size(r.min, vec2(r.width(), 12.0)), 5.0, p.header);
                    ui.painter().rect_filled(Rect::from_min_size(r.min + vec2(0.0, 12.0), vec2(16.0, r.height() - 12.0)), 0.0, p.toolbar);
                    for k in 0..4 {
                        let c = if k == 1 { TOOL_BLUE } else { p.icon.gamma_multiply(0.5) };
                        ui.painter().rect_filled(Rect::from_center_size(r.min + vec2(8.0, 22.0 + k as f32 * 12.0), vec2(7.0, 7.0)), 1.5, c);
                    }
                    let note = Rect::from_min_size(r.min + vec2(30.0, 30.0), vec2(52.0, 40.0));
                    ui.painter().rect_filled(note, 2.0, p.card);
                    for k in 0..4 {
                        ui.painter().hline(
                            (note.left() + 6.0)..=(note.right() - 8.0 - (k % 2) as f32 * 10.0),
                            note.top() + 8.0 + k as f32 * 7.0,
                            Stroke::new(1.5_f32, p.muted.gamma_multiply(0.6)),
                        );
                    }
                    let sq = Rect::from_min_size(r.min + vec2(96.0, 30.0), vec2(28.0, 28.0));
                    ui.painter().rect_filled(sq, 6.0, board_color(2));
                    ui.painter().hline(
                        (sq.left() + 2.0)..=(sq.right() - 2.0),
                        sq.bottom() + 7.0,
                        Stroke::new(2.0_f32, p.text.gamma_multiply(0.7)),
                    );
                    ui.painter().line_segment(
                        [note.right_center() + vec2(2.0, 0.0), sq.left_center() + vec2(-3.0, 0.0)],
                        Stroke::new(1.0_f32, p.line),
                    );
                    let stroke = if sel {
                        Stroke::new(2.0_f32, ink())
                    } else if resp.hovered() {
                        Stroke::new(1.0_f32, muted())
                    } else {
                        Stroke::new(1.0_f32, border_c())
                    };
                    ui.painter().rect_stroke(r, 5.0, stroke, StrokeKind::Inside);
                    if sel {
                        icons::paint(ui.painter(), "Check", r.right_top() + vec2(-14.0, 14.0), Color32::WHITE, false);
                    }
                    if resp.hovered() {
                        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                    }
                    if resp.clicked() {
                        self.prefs.theme = if i == 1 { ThemePref::Dark } else { ThemePref::Light };
                        self.prefs.manual_dark = i == 1;
                        self.prefs_dirty = true;
                    }
                    ui.label(RichText::new(*name).size(12.5).color(muted()));
                });
            }
        });
        ui.add_space(14.0);
        let mut sys = self.prefs.theme == ThemePref::System;
        if setting_row(ui, "Match system theme", "Use light or dark to match your computer's setting.", &mut sys, "system") {
            self.prefs.theme = if sys {
                ThemePref::System
            } else if self.prefs.manual_dark {
                ThemePref::Dark
            } else {
                ThemePref::Light
            };
            self.prefs_dirty = true;
        }
    }

    fn preferences_page(&mut self, ui: &mut egui::Ui) {
        heading(ui, "Preferences");
        let mut p = self.prefs.clone();
        let mut changed = false;
        changed |= setting_row(
            ui,
            "Show the Unsorted drawer",
            "Keep the drawer of unplaced cards open on the right. The choice is remembered.",
            &mut p.drawer_open,
            "drawer",
        );
        changed |=
            setting_row(ui, "Alignment guides", "While you drag a card, line it up with the cards around it.", &mut p.guides, "guides");
        changed |= setting_row(ui, "Snap to grid", "Cards move in 8-point steps when no guide is showing.", &mut p.snap_grid, "snap");
        changed |= setting_row(ui, "Dot grid", "Show the faint dots on the board.", &mut p.show_grid, "grid");
        if changed {
            self.prefs = p;
            self.prefs_dirty = true;
        }
    }

    fn language_page(&mut self, ui: &mut egui::Ui) {
        heading(ui, "Language");
        ui.label(RichText::new("Interface language").font(semibold_font(14.0)));
        ui.label(RichText::new("English. It's the only language this version comes in.").size(12.5).color(muted()));
        ui.add_space(12.0);
        ui.label(RichText::new("Writing in other scripts").font(semibold_font(14.0)));
        let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        let found = ["Nirmala.ttc", "Nirmala.ttf", "NirmalaUI.ttf"].iter().any(|f| Path::new(&format!("{win}\\Fonts\\{f}")).exists());
        let msg = if found {
            "Tamil and other Indian scripts are drawn with the Nirmala UI font found on this computer."
        } else {
            "No font for Tamil and other Indian scripts was found on this computer, so they may show as boxes."
        };
        ui.label(RichText::new(msg).size(12.5).color(muted()));
        ui.add_space(12.0);
        ui.label(RichText::new("Times").font(semibold_font(14.0)));
        ui.label(RichText::new("The trash shows how long ago things were deleted, such as \"5 min ago\".").size(12.5).color(muted()));
    }

    fn toolbar_page(&mut self, ui: &mut egui::Ui) {
        heading(ui, "Toolbar options");
        ui.label(RichText::new("Choose which tools appear in the toolbar on the left. Trash always stays.").size(12.5).color(muted()));
        ui.add_space(10.0);
        for tool in TOOLS.iter().flatten() {
            let name = tool.name();
            let mut on = self.prefs.tool_visible(name);
            let desc = if tool.available() { "" } else { "Not available in this version yet" };
            if setting_row(ui, name, desc, &mut on, name) {
                if on {
                    self.prefs.hidden_tools.retain(|t| t != name);
                } else {
                    self.prefs.hidden_tools.push(name.to_string());
                }
                self.prefs_dirty = true;
            }
        }
    }

    fn privacy_page(&mut self, ui: &mut egui::Ui) {
        heading(ui, "Privacy & data");
        ui.label(RichText::new("Everything stays on this computer. Nothing is sent anywhere, and there's no account.").size(13.0));
        ui.add_space(12.0);
        ui.label(RichText::new("Where your boards are kept").font(semibold_font(14.0)));
        let dir = self.data_dir.display().to_string();
        ui.label(RichText::new(&dir).size(12.5).color(muted()));
        if ui.button("Open folder").clicked() {
            let url = format!("file:///{}", dir.replace('\\', "/"));
            ui.ctx().open_url(egui::OpenUrl::new_tab(url));
        }
        ui.add_space(12.0);
        let cards: usize = self.store.boards.values().map(|b| b.cards.len()).sum();
        let pictures: usize =
            self.store.boards.values().flat_map(|b| b.cards.iter()).filter(|c| matches!(c.content, Content::Image { .. })).count();
        ui.label(RichText::new("What's saved").font(semibold_font(14.0)));
        ui.label(
            RichText::new(format!(
                "{} boards, {cards} cards, {pictures} pictures, {} items in the trash",
                self.store.boards.len(),
                self.store.trash.len()
            ))
            .size(12.5)
            .color(muted()),
        );
        let backups: Vec<String> = std::fs::read_dir(&self.data_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.starts_with("boards.backup"))
                    .collect()
            })
            .unwrap_or_default();
        if !backups.is_empty() {
            ui.label(RichText::new(format!("Backups kept from earlier versions: {}", backups.join(", "))).size(12.5).color(muted()));
        }
        ui.add_space(12.0);
        let n = self.store.trash.len();
        if ui.add_enabled(n > 0, Button::new(format!("Empty trash ({n})"))).clicked() {
            self.empty_trash();
        }
    }
}
