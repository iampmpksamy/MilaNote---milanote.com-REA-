//! The window: state, loading and saving, history, the view and creating cards.

mod canvas;
mod edit;
mod input;
mod menus;
mod panels;
mod settings;
#[cfg(test)]
mod tests;

use crate::cards::*;
use crate::model::*;
use crate::prefs::*;
use crate::theme::*;
use eframe::egui::{self, emath::TSTransform, pos2, vec2, Id, Pos2, Rect, Vec2};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

const COL_HEADER: f32 = 44.0;
const COL_PAD: f32 = 10.0;
const COL_GAP: f32 = 8.0;
const MIN_ZOOM: f32 = 0.25;
const MAX_ZOOM: f32 = 2.5;
const DRAWER_CARD_W: f32 = 260.0;
const HEADER_H: f32 = 44.0;
const TOOLBAR_W: f32 = 70.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Tool {
    Note,
    Link,
    Todo,
    Line,
    Board,
    Column,
    Comment,
    Table,
    AddImage,
    Upload,
    Draw,
}

impl Tool {
    fn name(self) -> &'static str {
        match self {
            Tool::Note => "Note",
            Tool::Link => "Link",
            Tool::Todo => "To-do",
            Tool::Line => "Line",
            Tool::Board => "Board",
            Tool::Column => "Column",
            Tool::Comment => "Comment",
            Tool::Table => "Table",
            Tool::AddImage => "Add image",
            Tool::Upload => "Upload",
            Tool::Draw => "Draw",
        }
    }

    /// Tools that aren't built yet are shown, but can't be used.
    fn available(self) -> bool {
        !matches!(self, Tool::Comment | Tool::Table | Tool::Draw)
    }
}

/// The toolbar, top to bottom; `None` is a separator.
const TOOLS: [Option<Tool>; 12] = [
    Some(Tool::Note),
    Some(Tool::Link),
    Some(Tool::Todo),
    Some(Tool::Line),
    Some(Tool::Board),
    Some(Tool::Column),
    Some(Tool::Comment),
    Some(Tool::Table),
    None,
    Some(Tool::AddImage),
    Some(Tool::Upload),
    Some(Tool::Draw),
];

struct DragState {
    ids: Vec<CardId>,
    offsets: Vec<Vec2>,
}

/// Dragging one end of a line, or a whole unattached line.
#[derive(Clone, Copy)]
struct ArrowDrag {
    arrow: u64,
    /// 0 = start, 1 = end, 2 = the whole line.
    end: u8,
    last: Pos2,
}

#[derive(Clone, Copy)]
enum MenuTarget {
    Card(CardId),
    Canvas(Pos2),
    Arrow(u64),
}

struct CtxMenu {
    pos: Pos2,
    target: MenuTarget,
    frame: u64,
}

/// Small panels that open beside the toolbar or under the header.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Popup {
    CardColor(CardId, f32),
    BoardColor(CardId, f32),
    BoardIcon(CardId, f32),
    LineColor(u64, f32),
    LineWeight(u64, f32),
    LineLabel(u64, f32),
    Search,
    Help,
}

enum Act {
    Select(CardId, bool),
    Drag(CardId),
    Edit(CardId),
    OpenBoard(BoardId),
    Menu(CardId, Pos2),
    Connect(CardId),
    OpenUrl(String),
}

#[derive(Clone, Copy)]
enum Place {
    At(Pos2),
    Column(CardId, usize),
    Unsorted,
}

enum Fmt {
    Wrap(&'static str),
    Prefix(&'static str),
}

struct Shot {
    path: PathBuf,
    frames: u32,
    requested: bool,
}

struct Toast {
    text: String,
    until: f64,
    undo: bool,
}

struct Hit {
    board: BoardId,
    card: Option<CardId>,
    kind: &'static str,
    title: String,
    snippet: String,
}

pub struct App {
    store: Store,
    current: BoardId,
    data_dir: PathBuf,
    prefs: Prefs,
    prefs_dirty: bool,
    undo: Vec<Store>,
    redo: Vec<Store>,
    dirty: bool,
    save_error: bool,
    last_change: f64,
    now: f64,
    frame_no: u64,
    applied_dark: Option<bool>,
    applied_scale: Option<usize>,

    selected: BTreeSet<CardId>,
    selected_arrow: Option<u64>,
    editing: Option<CardId>,
    focus_pending: bool,
    /// Ask for the keyboard on the next frame (after the new card has been drawn once).
    focus_next: bool,
    focus_search: bool,
    focus_item: Option<(CardId, usize)>,
    next_focus: Option<(CardId, usize)>,

    heights: HashMap<(CardId, u32), f32>,
    rects: HashMap<CardId, Rect>,
    anchors: HashMap<CardId, Rect>,
    order: Vec<CardId>,
    drawer_rects: HashMap<CardId, Rect>,
    canvas_rect: Rect,
    drawer_rect: Option<Rect>,
    menu_rect: Option<Rect>,
    popup_rect: Option<Rect>,
    guides: Vec<[Pos2; 2]>,
    pointer_world: Option<Pos2>,

    drag: Option<DragState>,
    arrow_drag: Option<ArrowDrag>,
    drop_column: Option<(CardId, usize)>,
    drop_unsorted: bool,
    band: Option<Pos2>,
    connect: Option<CardId>,
    panning: bool,
    tool_drag: Option<Tool>,
    ctx_menu: Option<CtxMenu>,
    popup: Option<Popup>,
    pending_center: Option<CardId>,

    search: String,
    label_text: String,
    icon_query: String,
    show_trash: bool,
    settings_open: bool,
    settings_page: usize,
    textures: HashMap<String, Option<egui::TextureHandle>>,
    clipboard: Vec<Card>,
    clip_arrows: Vec<Arrow>,
    clip_text: String,
    toast: Option<Toast>,
    acts: Vec<Act>,
    shot: Option<Shot>,
}

pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("NOTEBOARD_DATA") {
        return PathBuf::from(d);
    }
    if let Some(d) = std::env::var_os("APPDATA") {
        return PathBuf::from(d).join("Noteboard");
    }
    if let Some(h) = std::env::var_os("HOME") {
        return PathBuf::from(h).join(".local").join("share").join("noteboard");
    }
    PathBuf::from("noteboard-data")
}

fn ago(secs: u64) -> String {
    let d = now_secs().saturating_sub(secs);
    if d < 60 {
        "just now".into()
    } else if d < 3600 {
        format!("{} min ago", d / 60)
    } else if d < 86400 {
        format!("{} h ago", d / 3600)
    } else {
        format!("{} days ago", d / 86400)
    }
}

fn is_image_path(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp")
    )
}

/// Read the saved boards. A file from an older version is copied aside first, then upgraded.
pub fn load_store(dir: &Path) -> (Store, bool) {
    let file = dir.join("boards.json");
    match std::fs::read_to_string(&file) {
        Ok(s) => match serde_json::from_str::<Store>(&s) {
            Ok(mut st) if st.boards.contains_key(&st.root) => {
                let old = st.version;
                if st.migrate() {
                    let backup = dir.join(format!("boards.backup-v{}.json", old.max(1)));
                    if !backup.exists() {
                        let _ = std::fs::copy(&file, &backup);
                    }
                    return (st, true);
                }
                (st, false)
            }
            _ => {
                let _ = std::fs::copy(&file, dir.join("boards.unreadable.json"));
                (Store::sample(), false)
            }
        },
        Err(_) => (Store::sample(), false),
    }
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, shot: Option<PathBuf>) -> Self {
        App::open(&cc.egui_ctx, data_dir(), shot)
    }

    pub fn open(ctx: &egui::Context, dir: PathBuf, shot: Option<PathBuf>) -> Self {
        setup_fonts(ctx);
        ctx.options_mut(|o| o.zoom_with_keyboard = false);
        let (store, migrated) = load_store(&dir);
        let prefs = Prefs::load(&dir);
        let current = store.root;
        let mut app = App {
            store,
            current,
            data_dir: dir,
            prefs,
            prefs_dirty: false,
            undo: vec![],
            redo: vec![],
            dirty: migrated,
            save_error: false,
            last_change: 0.0,
            now: 0.0,
            frame_no: 0,
            applied_dark: None,
            applied_scale: None,
            selected: BTreeSet::new(),
            selected_arrow: None,
            editing: None,
            focus_pending: false,
            focus_next: false,
            focus_search: false,
            focus_item: None,
            next_focus: None,
            heights: HashMap::new(),
            rects: HashMap::new(),
            anchors: HashMap::new(),
            order: vec![],
            drawer_rects: HashMap::new(),
            canvas_rect: Rect::from_min_size(pos2(TOOLBAR_W, HEADER_H), vec2(1290.0, 816.0)),
            drawer_rect: None,
            menu_rect: None,
            popup_rect: None,
            guides: vec![],
            pointer_world: None,
            drag: None,
            arrow_drag: None,
            drop_column: None,
            drop_unsorted: false,
            band: None,
            connect: None,
            panning: false,
            tool_drag: None,
            ctx_menu: None,
            popup: None,
            pending_center: None,
            search: String::new(),
            label_text: String::new(),
            icon_query: String::new(),
            show_trash: false,
            settings_open: false,
            settings_page: 0,
            textures: HashMap::new(),
            clipboard: vec![],
            clip_arrows: vec![],
            clip_text: String::new(),
            toast: None,
            acts: vec![],
            shot: shot.map(|path| Shot { path, frames: 0, requested: false }),
        };
        if app.shot.is_some() {
            app.preview_state();
        }
        app
    }

    /// For pictures of other states (used only with --screenshot): NOTEBOARD_SHOT_STATE=...
    fn preview_state(&mut self) {
        let Ok(state) = std::env::var("NOTEBOARD_SHOT_STATE") else { return };
        let find = |b: &Board, f: &dyn Fn(&Content) -> bool| {
            b.cards.iter().find(|c| c.container == Container::Canvas && f(&c.content)).map(|c| c.id)
        };
        let first_note = find(self.board(), &|c| matches!(c, Content::Note { .. }));
        let first_board = find(self.board(), &|c| matches!(c, Content::Board { .. }));
        let first_todo = find(self.board(), &|c| matches!(c, Content::Todo { .. }));
        for part in state.split(',') {
            match part {
                "dark" => {
                    self.prefs.theme = ThemePref::Dark;
                    self.prefs.manual_dark = true;
                }
                "small" => self.prefs.scale = 0,
                "large" => self.prefs.scale = 2,
                "edit" => {
                    if let Some(id) = first_note {
                        self.editing = Some(id);
                        self.selected = [id].into_iter().collect();
                    }
                }
                "todo" => {
                    if let Some(id) = first_todo {
                        self.editing = Some(id);
                        self.selected = [id].into_iter().collect();
                    }
                }
                "select" => {
                    if let Some(id) = first_board {
                        self.selected = [id].into_iter().collect();
                    }
                }
                "rename" => {
                    if let Some(id) = first_board {
                        self.selected = [id].into_iter().collect();
                        self.editing = Some(id);
                        self.focus_next = true;
                    }
                }
                "icons" => {
                    if let Some(id) = first_board {
                        self.selected = [id].into_iter().collect();
                        self.popup = Some(Popup::BoardIcon(id, 150.0));
                    }
                }
                "colors" => {
                    if let Some(id) = first_board {
                        self.selected = [id].into_iter().collect();
                        self.popup = Some(Popup::BoardColor(id, 100.0));
                    }
                }
                "line" => {
                    self.selected_arrow = self.board().arrows.first().map(|a| a.id);
                }
                "trash" => {
                    let ids: Vec<CardId> = first_note.into_iter().collect();
                    self.store.delete_cards(self.current, &ids);
                    self.show_trash = true;
                }
                "search" => {
                    self.search = "idea".into();
                    self.popup = Some(Popup::Search);
                }
                "help" => self.popup = Some(Popup::Help),
                "menu" => {
                    if let Some(id) = first_note {
                        self.selected = [id].into_iter().collect();
                        self.ctx_menu = Some(CtxMenu { pos: pos2(420.0, 160.0), target: MenuTarget::Card(id), frame: u64::MAX });
                    }
                }
                "drawer" => self.prefs.drawer_open = true,
                "settings" => {
                    self.settings_open = true;
                    self.settings_page = 0;
                }
                "settings-prefs" => {
                    self.settings_open = true;
                    self.settings_page = 1;
                }
                "settings-toolbar" => {
                    self.settings_open = true;
                    self.settings_page = 3;
                }
                "empty" => {
                    let b = self.store.new_board("Empty board", self.current, 0);
                    self.current = b;
                }
                "board" => {
                    let b = self.board().cards.iter().find_map(|c| match c.content {
                        Content::Board { board } => Some(board),
                        _ => None,
                    });
                    if let Some(b) = b {
                        self.current = b;
                    }
                }
                _ => {}
            }
        }
    }

    // ---------- history, saving ----------

    fn checkpoint(&mut self) {
        self.undo.push(self.store.clone());
        if self.undo.len() > 200 {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    fn touch(&mut self) {
        self.dirty = true;
        self.last_change = self.now;
    }

    fn keep_views(from: &Store, to: &mut Store) {
        for (id, b) in &from.boards {
            if let Some(t) = to.boards.get_mut(id) {
                t.pan = b.pan;
                t.zoom = b.zoom;
            }
        }
    }

    fn undo(&mut self, ctx: &egui::Context) {
        if let Some(mut prev) = self.undo.pop() {
            Self::keep_views(&self.store, &mut prev);
            let cur = std::mem::replace(&mut self.store, prev);
            self.redo.push(cur);
            self.after_history(ctx);
        }
    }

    fn redo(&mut self, ctx: &egui::Context) {
        if let Some(mut next) = self.redo.pop() {
            Self::keep_views(&self.store, &mut next);
            let cur = std::mem::replace(&mut self.store, next);
            self.undo.push(cur);
            self.after_history(ctx);
        }
    }

    fn after_history(&mut self, ctx: &egui::Context) {
        if !self.store.boards.contains_key(&self.current) {
            self.current = self.store.root;
        }
        let b = self.store.board(self.current);
        let keep: BTreeSet<CardId> = self.selected.iter().copied().filter(|id| b.card(*id).is_some()).collect();
        if self.selected_arrow.map(|a| !b.arrows.iter().any(|x| x.id == a)).unwrap_or(false) {
            self.selected_arrow = None;
        }
        self.selected = keep;
        self.stop_editing(ctx);
        self.drag = None;
        self.arrow_drag = None;
        self.connect = None;
        self.popup = None;
        self.touch();
    }

    fn save(&mut self) {
        let res = (|| -> std::io::Result<()> {
            std::fs::create_dir_all(&self.data_dir)?;
            let json = serde_json::to_string_pretty(&self.store).map_err(std::io::Error::other)?;
            let tmp = self.data_dir.join("boards.json.tmp");
            std::fs::write(&tmp, json)?;
            std::fs::rename(&tmp, self.data_dir.join("boards.json"))?;
            Ok(())
        })();
        self.save_error = res.is_err();
        self.dirty = false;
    }

    fn save_prefs(&mut self) {
        if self.shot.is_none() {
            let _ = self.prefs.save(&self.data_dir);
        }
        self.prefs_dirty = false;
    }

    // ---------- view ----------

    fn board(&self) -> &Board {
        self.store.board(self.current)
    }

    fn board_mut(&mut self) -> &mut Board {
        self.store.board_mut(self.current)
    }

    fn zoom(&self) -> f32 {
        self.board().zoom
    }

    fn xf(&self) -> TSTransform {
        let b = self.board();
        TSTransform::new(self.canvas_rect.min.to_vec2() + vec2(b.pan[0], b.pan[1]), b.zoom)
    }

    fn to_world(&self, p: Pos2) -> Pos2 {
        self.xf().inverse() * p
    }

    fn to_screen(&self, p: Pos2) -> Pos2 {
        self.xf() * p
    }

    fn zoom_at(&mut self, p: Pos2, factor: f32) {
        let origin = self.canvas_rect.min.to_vec2();
        let b = self.board_mut();
        let old = b.zoom;
        let new = (old * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        let t = origin + vec2(b.pan[0], b.pan[1]);
        let w = (p.to_vec2() - t) / old;
        let nt = p.to_vec2() - w * new;
        b.pan = [nt.x - origin.x, nt.y - origin.y];
        b.zoom = new;
        self.touch();
    }

    fn set_zoom_centered(&mut self, z: f32) {
        let c = self.canvas_rect.center();
        let f = z / self.zoom();
        self.zoom_at(c, f);
    }

    fn fit(&mut self) {
        let mut bb = Rect::NOTHING;
        for (id, r) in &self.rects {
            if self.board().card(*id).map(|c| c.container == Container::Canvas).unwrap_or(false) {
                bb = bb.union(*r);
            }
        }
        if !bb.is_positive() {
            return;
        }
        let cr = self.canvas_rect;
        let z = ((cr.width() - 120.0) / bb.width()).min((cr.height() - 120.0) / bb.height()).clamp(MIN_ZOOM, 1.25);
        let pan = cr.size() / 2.0 - bb.center().to_vec2() * z;
        let b = self.board_mut();
        b.zoom = z;
        b.pan = [pan.x, pan.y];
        self.touch();
    }

    fn center_on(&mut self, r: Rect) {
        let z = self.zoom();
        let pan = self.canvas_rect.size() / 2.0 - r.center().to_vec2() * z;
        self.board_mut().pan = [pan.x, pan.y];
    }

    fn open_board(&mut self, ctx: &egui::Context, b: BoardId) {
        if !self.store.boards.contains_key(&b) {
            return;
        }
        self.stop_editing(ctx);
        self.current = b;
        self.selected.clear();
        self.selected_arrow = None;
        self.drag = None;
        self.arrow_drag = None;
        self.band = None;
        self.connect = None;
        self.ctx_menu = None;
        self.popup = None;
        self.rects.clear();
        self.anchors.clear();
        self.order.clear();
    }

    fn stop_editing(&mut self, ctx: &egui::Context) {
        if self.editing.take().is_some() {
            ctx.memory_mut(|m| {
                if let Some(f) = m.focused() {
                    m.surrender_focus(f);
                }
            });
        }
    }

    fn toast(&mut self, text: impl Into<String>, undo: bool) {
        self.toast = Some(Toast { text: text.into(), until: self.now + 4.0, undo });
    }

    fn select_only(&mut self, id: CardId) {
        self.selected = [id].into_iter().collect();
        self.selected_arrow = None;
    }

    // ---------- images and files ----------

    fn texture_for(&mut self, ctx: &egui::Context, file: &str) -> Option<(egui::TextureId, Vec2)> {
        if !self.textures.contains_key(file) {
            let path = self.data_dir.join("images").join(file);
            let tex = image::open(&path).ok().map(|img| {
                let img = if img.width() > 2000 || img.height() > 2000 { img.thumbnail(2000, 2000) } else { img };
                let rgba = img.to_rgba8();
                let size = [rgba.width() as usize, rgba.height() as usize];
                let ci = egui::ColorImage::from_rgba_unmultiplied(size, rgba.as_raw());
                ctx.load_texture(file.to_string(), ci, egui::TextureOptions::LINEAR)
            });
            self.textures.insert(file.to_string(), tex);
        }
        self.textures.get(file).and_then(|t| t.as_ref()).map(|t| (t.id(), t.size_vec2()))
    }

    /// Copy a picture into the boards folder; returns its stored name and height/width ratio.
    fn store_picture(&mut self, src: &Path) -> Option<(String, f32, u32)> {
        let Ok((w, h)) = image::image_dimensions(src) else {
            self.toast("That file couldn't be opened as a picture", false);
            return None;
        };
        let id = self.store.new_id();
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
        let name = format!("{id}.{ext}");
        let dir = self.data_dir.join("images");
        if std::fs::create_dir_all(&dir).and_then(|_| std::fs::copy(src, dir.join(&name))).is_err() {
            self.toast("The picture couldn't be copied into your boards folder", false);
            return None;
        }
        Some((name, h as f32 / w.max(1) as f32, w))
    }

    fn add_image_file(&mut self, src: &Path, place: Place) -> Option<CardId> {
        let (name, aspect, w) = self.store_picture(src)?;
        let width = (w as f32).clamp(120.0, 320.0);
        let id = self.store.new_id();
        let content = Content::Image { file: name, caption: String::new(), aspect };
        Some(self.insert_card(id, content, width, 0, place))
    }

    /// Put a picture from the system clipboard on the board.
    fn paste_picture(&mut self, at: Pos2) -> bool {
        let Ok(mut cb) = arboard::Clipboard::new() else { return false };
        let Ok(img) = cb.get_image() else {
            self.toast("There's no picture on the clipboard", false);
            return false;
        };
        let (w, h) = (img.width as u32, img.height as u32);
        let Some(buf) = image::RgbaImage::from_raw(w, h, img.bytes.into_owned()) else { return false };
        let id = self.store.new_id();
        let dir = self.data_dir.join("images");
        let name = format!("{id}.png");
        if std::fs::create_dir_all(&dir).is_err() || buf.save(dir.join(&name)).is_err() {
            self.toast("The picture couldn't be saved into your boards folder", false);
            return false;
        }
        self.checkpoint();
        let width = (w as f32).clamp(120.0, 320.0);
        let content = Content::Image { file: name, caption: String::new(), aspect: h as f32 / w.max(1) as f32 };
        let cid = self.store.new_id();
        self.insert_card(cid, content, width, 0, Place::At(at - vec2(width / 2.0, 40.0)));
        true
    }

    fn replace_picture(&mut self, id: CardId) {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Pictures", &["png", "jpg", "jpeg", "gif", "bmp", "webp"])
            .set_title("Replace picture")
            .pick_file()
        else {
            return;
        };
        let Some((name, aspect, _)) = self.store_picture(&path) else { return };
        self.checkpoint();
        if let Some(Card { content: Content::Image { file, aspect: a, .. }, .. }) = self.board_mut().card_mut(id) {
            *file = name;
            *a = aspect;
        }
        self.touch();
    }

    // ---------- creating cards ----------

    /// A spot near the middle of the view that doesn't cover another card.
    fn free_spot(&self, size: Vec2) -> Pos2 {
        let c = self.to_world(self.canvas_rect.center());
        let taken = |p: Pos2| {
            let r = Rect::from_center_size(p, size).expand(12.0);
            self.rects.values().any(|o| o.intersects(r))
        };
        if !taken(c) {
            return c;
        }
        for ring in 1..14 {
            let d = ring as f32 * 40.0;
            for k in 0..(ring * 8) {
                let a = k as f32 / (ring * 8) as f32 * std::f32::consts::TAU;
                let p = c + vec2(a.cos() * d * 1.6, a.sin() * d);
                if !taken(p) {
                    return p;
                }
            }
        }
        c
    }

    fn insert_card(&mut self, id: CardId, content: Content, width: f32, color: usize, place: Place) -> CardId {
        let z = self.board().max_z() + 1;
        let pos = match place {
            Place::At(p) => [p.x.round(), p.y.round()],
            _ => [0.0, 0.0],
        };
        let b = self.board_mut();
        b.cards.push(Card { id, pos, width, color, z, container: Container::Canvas, locked: false, align: 0, content });
        match place {
            Place::Column(col, i) => b.attach_column(id, col, i),
            Place::Unsorted => b.attach_unsorted(id),
            Place::At(_) => {}
        }
        self.select_only(id);
        self.touch();
        id
    }

    fn default_size(tool: Tool) -> Vec2 {
        match tool {
            Tool::Note => vec2(300.0, 60.0),
            Tool::Todo => vec2(280.0, 80.0),
            Tool::Link => vec2(280.0, 80.0),
            Tool::Column => vec2(290.0, 130.0),
            Tool::Board => vec2(124.0, 120.0),
            _ => vec2(160.0, 80.0),
        }
    }

    /// `place` is where the middle-top of the new card goes (for Place::At).
    fn create(&mut self, ctx: &egui::Context, tool: Tool, place: Place) {
        let mut place = place;
        if let Place::Column(..) = place {
            if matches!(tool, Tool::Column | Tool::Line) {
                place = Place::At(self.free_spot(Self::default_size(tool)));
            }
        }
        if !tool.available() {
            self.toast(format!("{} isn't available in this version yet", tool.name()), false);
            return;
        }
        match tool {
            Tool::Line => {
                let c = match place {
                    Place::At(p) => p,
                    _ => self.free_spot(vec2(160.0, 80.0)),
                };
                self.checkpoint();
                let id = self.store.new_id();
                self.board_mut().arrows.push(Arrow::free(id, [c.x - 70.0, c.y + 40.0], [c.x + 70.0, c.y - 40.0]));
                self.selected.clear();
                self.selected_arrow = Some(id);
                self.touch();
                return;
            }
            Tool::AddImage | Tool::Upload => {
                let mut dialog = rfd::FileDialog::new().set_title(if tool == Tool::Upload { "Upload a file" } else { "Add a picture" });
                if tool == Tool::AddImage {
                    dialog = dialog.add_filter("Pictures", &["png", "jpg", "jpeg", "gif", "bmp", "webp"]);
                }
                if let Some(path) = dialog.pick_file() {
                    let place = match place {
                        Place::At(p) => Place::At(p - vec2(140.0, 80.0)),
                        other => other,
                    };
                    self.checkpoint();
                    if is_image_path(&path) {
                        self.add_image_file(&path, place);
                    } else {
                        self.add_file_link(&path, place);
                    }
                }
                return;
            }
            _ => {}
        }
        self.checkpoint();
        self.stop_editing(ctx);
        let id = self.store.new_id();
        let width = Self::default_size(tool).x;
        let content = match tool {
            Tool::Note => Content::Note { text: String::new() },
            Tool::Todo => Content::Todo { title: String::new(), items: vec![TodoItem { text: String::new(), done: false }] },
            Tool::Link => Content::Link { url: String::new(), title: String::new() },
            Tool::Column => Content::Column { title: String::new(), children: vec![] },
            Tool::Board => Content::Board { board: self.store.new_board("New Board", self.current, 0) },
            _ => return,
        };
        let place = match place {
            Place::At(p) => Place::At(p - vec2(width / 2.0, 24.0)),
            other => other,
        };
        let id = self.insert_card(id, content, width, 0, place);
        self.editing = Some(id);
        self.focus_next = true;
        self.next_focus = if tool == Tool::Todo { Some((id, 0)) } else { None };
        if matches!(place, Place::Unsorted) {
            self.set_drawer(true);
        }
    }

    fn add_file_link(&mut self, path: &Path, place: Place) {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let url = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
        let id = self.store.new_id();
        self.insert_card(id, Content::Link { url, title: name }, 280.0, 0, place);
    }

    fn create_text_card(&mut self, text: &str, at: Pos2) {
        self.checkpoint();
        let t = text.trim();
        let id = self.store.new_id();
        let is_url = (t.starts_with("http://") || t.starts_with("https://")) && !t.contains(char::is_whitespace);
        if is_url {
            self.insert_card(id, Content::Link { url: t.to_string(), title: String::new() }, 280.0, 0, Place::At(at));
        } else {
            self.insert_card(id, Content::Note { text: t.to_string() }, 300.0, 0, Place::At(at));
        }
    }

    fn set_drawer(&mut self, open: bool) {
        if self.prefs.drawer_open != open {
            self.prefs.drawer_open = open;
            self.prefs_dirty = true;
        }
    }
}
