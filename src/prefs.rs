//! App preferences, saved beside the boards in prefs.json (separate from the boards file).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ThemePref {
    #[default]
    Light,
    Dark,
    System,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub theme: ThemePref,
    /// The theme to use when "match system" is turned off again.
    pub manual_dark: bool,
    /// 0 = small, 1 = medium, 2 = large.
    pub scale: usize,
    pub bold_headings: bool,
    pub drawer_open: bool,
    pub guides: bool,
    pub snap_grid: bool,
    pub show_grid: bool,
    /// Tools hidden from the left toolbar.
    pub hidden_tools: Vec<String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            theme: ThemePref::Light,
            manual_dark: false,
            scale: 1,
            bold_headings: true,
            drawer_open: false,
            guides: true,
            snap_grid: false,
            show_grid: true,
            hidden_tools: vec![],
        }
    }
}

impl Prefs {
    pub fn load(dir: &Path) -> Prefs {
        std::fs::read_to_string(dir.join("prefs.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Prefs>(&s).ok())
            .map(|mut p| {
                p.scale = p.scale.min(2);
                p
            })
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        let tmp = dir.join("prefs.json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, dir.join("prefs.json"))
    }

    pub fn tool_visible(&self, name: &str) -> bool {
        !self.hidden_tools.iter().any(|t| t == name)
    }
}
