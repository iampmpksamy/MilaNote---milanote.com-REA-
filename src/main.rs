#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Noteboard: a visual board for notes, to-dos, links, images, nested boards, columns and arrows.

mod app;
mod cards;
mod icons;
mod model;
mod prefs;
mod theme;

use eframe::egui;
use std::path::PathBuf;

fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let shot = args.iter().position(|a| a == "--screenshot").and_then(|i| args.get(i + 1)).map(PathBuf::from);

    let mut viewport =
        egui::ViewportBuilder::default().with_title("Noteboard").with_inner_size([1360.0, 860.0]).with_min_inner_size([820.0, 520.0]);
    if shot.is_some() {
        viewport = viewport.with_active(false);
        #[cfg(windows)]
        {
            viewport = viewport.with_window_level(egui::WindowLevel::AlwaysOnBottom);
        }
    }
    #[allow(unused_mut)]
    let mut options = eframe::NativeOptions { viewport, ..Default::default() };
    #[cfg(target_os = "macos")]
    if shot.is_some() {
        options.event_loop_builder = Some(Box::new(|builder| {
            use winit::platform::macos::EventLoopBuilderExtMacOS;
            builder.with_activate_ignoring_other_apps(false);
        }));
    }
    eframe::run_native("Noteboard", options, Box::new(move |cc| Ok(Box::new(app::App::new(cc, shot)))))
}
