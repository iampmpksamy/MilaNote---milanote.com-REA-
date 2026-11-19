/**
 * The workspace state and every action on it, shared by the web, desktop and mobile shells.
 * Board data changes go through `change()`, which records undo history and schedules a save.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Arrow,
  Board,
  BoardId,
  Card,
  CardId,
  Content,
  KIND_NAMES,
  Store,
  StoreWithImports,
  attachColumn,
  attachUnsorted,
  boardPath,
  cardText,
  copyCardsInto,
  deleteCards,
  detach,
  emptyStore,
  findCard,
  freeArrow,
  getBoard,
  importDesktopStore,
  kindOf,
  maxZ,
  migrate,
  minZ,
  newArrow,
  newBoard,
  newId,
  plainTitle,
  purge,
  restore,
  sampleStore,
  validateDesktopFile,
  ImportReport,
} from '@noteboard/board-model';
import { Pt, Rect, View, fitView, freeSpot, rect as mkRect } from '@noteboard/canvas-geometry';
import { DEFAULT_PREFS, Prefs } from './prefs';
import { STORAGE } from './storage';

export type Tool = 'Note' | 'Link' | 'To-do' | 'Line' | 'Board' | 'Column' | 'Comment' | 'Table' | 'Add image' | 'Upload' | 'Draw';
export const TOOLS: (Tool | null)[] = ['Note', 'Link', 'To-do', 'Line', 'Board', 'Column', 'Comment', 'Table', null, 'Add image', 'Upload', 'Draw'];
export const UNAVAILABLE: Tool[] = ['Comment', 'Table', 'Draw'];

export type Place = { at: Pt } | { column: CardId; index: number } | { unsorted: true };

export type Popup =
  | { kind: 'card-color' | 'board-color' | 'board-icon'; card: CardId; y: number }
  | { kind: 'line-color' | 'line-weight' | 'line-label'; arrow: number; y: number }
  | { kind: 'search' | 'help' };

export type MenuTarget = { card: CardId } | { canvas: Pt } | { arrow: number };

export interface Hit {
  board: BoardId;
  card: CardId | null;
  kind: string;
  title: string;
  snippet: string;
}

const DEFAULT_SIZE: Record<string, Pt> = {
  Note: { x: 300, y: 60 },
  'To-do': { x: 280, y: 80 },
  Link: { x: 280, y: 80 },
  Column: { x: 290, y: 130 },
  Board: { x: 124, y: 120 },
};

@Injectable()
export class Workspace {
  private readonly storage = inject(STORAGE);

  /** Bumped after every change to the board data, so views recompute. */
  readonly rev = signal(0);
  private data: StoreWithImports = emptyStore();
  readonly loaded = signal(false);
  readonly current = signal<BoardId>(1);
  readonly view = signal<View>({ pan: [60, 40], zoom: 1 });
  readonly prefs = signal<Prefs>({ ...DEFAULT_PREFS });
  readonly systemDark = signal(typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  readonly dark = computed(() => (this.prefs().theme === 'System' ? this.systemDark() : this.prefs().theme === 'Dark'));

  readonly selected = signal<ReadonlySet<CardId>>(new Set());
  readonly selectedArrow = signal<number | null>(null);
  readonly editing = signal<CardId | null>(null);
  readonly focusItem = signal<{ card: CardId; index: number } | null>(null);
  readonly popup = signal<Popup | null>(null);
  readonly menu = signal<{ x: number; y: number; target: MenuTarget } | null>(null);
  readonly showTrash = signal(false);
  readonly settingsOpen = signal(false);
  readonly settingsPage = signal(0);
  readonly toast = signal<{ text: string; undo: boolean } | null>(null);
  readonly dirty = signal(false);
  readonly saveError = signal(false);
  /** Boards saved on a server could not be loaded: nothing is shown or saved until a reload works. */
  readonly loadFailed = signal(false);
  readonly search = signal('');
  /** The column (or the drawer) a dragged card would drop into. */
  readonly dropColumn = signal<CardId | null>(null);
  readonly dropUnsorted = signal(false);
  /** Where each visible card is, in board coordinates (measured from the page). */
  readonly rects = signal<ReadonlyMap<CardId, Rect>>(new Map());
  readonly anchors = signal<ReadonlyMap<CardId, Rect>>(new Map());
  readonly images = signal<ReadonlyMap<string, string>>(new Map());

  private undoStack: Store[] = [];
  private redoStack: Store[] = [];
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  private clipboard: { cards: Card[]; arrows: Arrow[]; text: string } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // The data is changed in place, so these always count as new when the revision moves.
  readonly store = computed(
    () => {
      this.rev();
      return this.data;
    },
    { equal: () => false },
  );
  readonly board = computed<Board>(
    () => {
      this.rev();
      return getBoard(this.data, this.current());
    },
    { equal: () => false },
  );
  readonly path = computed(() => {
    this.rev();
    return boardPath(this.data, this.current()).map((id) => getBoard(this.data, id));
  });
  readonly trash = computed(
    () => {
      this.rev();
      return [...this.data.trash];
    },
    { equal: () => false },
  );

  // ---------- loading and saving ----------

  async init(): Promise<void> {
    if (typeof matchMedia !== 'undefined') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
    let loaded: { store: Store | null; prefs: Prefs | null } = { store: null, prefs: null };
    try {
      loaded = await this.storage.load();
    } catch {
      this.saveError.set(true);
      // Never replace someone's server boards with the sample boards.
      if (this.storage.remote) this.loadFailed.set(true);
    }
    this.storage.onExternalChange?.((store) => this.replaceStore(store));
    this.data = loaded.store ?? sampleStore();
    if (migrate(this.data)) this.dirty.set(true);
    this.prefs.set({ ...DEFAULT_PREFS, ...(loaded.prefs ?? {}) });
    this.current.set(this.data.root);
    this.view.set({ pan: [...this.board().pan] as [number, number], zoom: this.board().zoom });
    this.rev.update((r) => r + 1);
    await this.refreshImages();
    this.loaded.set(true);
    if (this.dirty()) this.scheduleSave();
  }

  async refreshImages(): Promise<void> {
    const map = new Map<string, string>();
    for (const b of Object.values(this.data.boards))
      for (const c of b.cards)
        if ('Image' in c.content) {
          const url = await this.storage.imageUrl(c.content.Image.file);
          if (url) map.set(c.content.Image.file, url);
        }
    this.images.set(map);
  }

  private scheduleSave(): void {
    if (this.loadFailed()) return;
    this.dirty.set(true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 600);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.loadFailed()) return;
    try {
      await this.storage.saveStore(this.data);
      this.saveError.set(false);
      this.dirty.set(false);
    } catch {
      this.saveError.set(true);
    }
  }

  /**
   * Takes a newer version of the boards (merged with another device or saved offline elsewhere).
   * Keeps the open board, drops undo history (it would undo the other device's changes) and any
   * selection that no longer exists. Refused while a card is being edited.
   */
  replaceStore(store: Store): boolean {
    if (this.editing() !== null || !this.loaded()) return false;
    const cur = this.current();
    this.data = structuredClone(store) as StoreWithImports;
    migrate(this.data);
    if (!this.data.boards[String(cur)]) this.current.set(this.data.root);
    const b = getBoard(this.data, this.current());
    this.selected.set(new Set([...this.selected()].filter((id) => !!findCard(b, id))));
    if (this.selectedArrow() !== null && !b.arrows.some((a) => a.id === this.selectedArrow())) this.selectedArrow.set(null);
    this.undoStack = [];
    this.redoStack = [];
    this.canUndo.set(false);
    this.canRedo.set(false);
    this.rev.update((r) => r + 1);
    void this.refreshImages();
    return true;
  }

  /** Header status: the storage's own when it syncs, otherwise saved / saving / error. */
  get syncStatus(): 'saved' | 'saving' | 'offline' | 'error' {
    if (this.saveError()) return 'error';
    if (this.dirty()) return 'saving';
    return this.storage.syncStatus?.() ?? 'saved';
  }

  get storageLabel(): string {
    return this.storage.label;
  }

  get storageRemote(): boolean {
    return !!this.storage.remote;
  }

  /** Change the board data: takes an undo step (unless asked not to), then saves soon after. */
  change(f: (s: StoreWithImports, b: Board) => void, checkpoint = true): void {
    if (checkpoint) this.checkpoint();
    f(this.data, getBoard(this.data, this.current()));
    this.rev.update((r) => r + 1);
    this.scheduleSave();
  }

  checkpoint(): void {
    this.undoStack.push(structuredClone(this.data));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.canUndo.set(true);
    this.canRedo.set(false);
  }

  private keepViews(from: Store, to: Store): void {
    for (const [id, b] of Object.entries(from.boards)) {
      const t = to.boards[id];
      if (t) {
        t.pan = b.pan;
        t.zoom = b.zoom;
      }
    }
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.keepViews(this.data, prev);
    this.redoStack.push(this.data);
    this.data = prev;
    this.afterHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.keepViews(this.data, next);
    this.undoStack.push(this.data);
    this.data = next;
    this.afterHistory();
  }

  private afterHistory(): void {
    if (!this.data.boards[String(this.current())]) this.current.set(this.data.root);
    const b = getBoard(this.data, this.current());
    this.selected.set(new Set([...this.selected()].filter((id) => findCard(b, id))));
    if (this.selectedArrow() !== null && !b.arrows.some((a) => a.id === this.selectedArrow())) this.selectedArrow.set(null);
    this.editing.set(null);
    this.popup.set(null);
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
    this.rev.update((r) => r + 1);
    this.scheduleSave();
  }

  // ---------- preferences ----------

  setPrefs(p: Partial<Prefs>): void {
    this.prefs.update((old) => ({ ...old, ...p }));
    if (!this.loadFailed()) void this.storage.savePrefs(this.prefs()).catch(() => this.saveError.set(true));
  }

  toggleTheme(): void {
    const dark = !this.dark();
    this.setPrefs({ theme: dark ? 'Dark' : 'Light', manual_dark: dark });
  }

  setScale(s: number): void {
    this.setPrefs({ scale: Math.max(0, Math.min(2, s)) });
  }

  // ---------- view ----------

  setView(v: View): void {
    this.view.set(v);
    const b = getBoard(this.data, this.current());
    b.pan = [...v.pan] as [number, number];
    b.zoom = v.zoom;
    this.scheduleSave();
  }

  fit(canvas: Pt): void {
    const rs = [...this.rects().entries()].filter(([id]) => findCard(this.board(), id)?.container === 'Canvas').map(([, r]) => r);
    if (!rs.length) return;
    const minX = Math.min(...rs.map((r) => r.x));
    const minY = Math.min(...rs.map((r) => r.y));
    const maxX = Math.max(...rs.map((r) => r.x + r.w));
    const maxY = Math.max(...rs.map((r) => r.y + r.h));
    this.setView(fitView(mkRect(minX, minY, maxX - minX, maxY - minY), canvas));
  }

  openBoard(id: BoardId): void {
    if (!this.data.boards[String(id)]) return;
    this.editing.set(null);
    this.current.set(id);
    this.selected.set(new Set());
    this.selectedArrow.set(null);
    this.popup.set(null);
    this.menu.set(null);
    const b = getBoard(this.data, id);
    this.view.set({ pan: [...b.pan] as [number, number], zoom: b.zoom });
    this.rects.set(new Map());
    this.anchors.set(new Map());
  }

  // ---------- selection and editing ----------

  select(id: CardId, additive = false): void {
    if (this.editing() !== null && this.editing() !== id) this.editing.set(null);
    this.selectedArrow.set(null);
    this.popup.set(null);
    if (additive) {
      const s = new Set(this.selected());
      if (s.has(id)) s.delete(id);
      else s.add(id);
      this.selected.set(s);
    } else this.selected.set(new Set([id]));
  }

  selectArrow(id: number | null): void {
    this.selected.set(new Set());
    this.editing.set(null);
    this.selectedArrow.set(id);
  }

  clearSelection(): void {
    this.selected.set(new Set());
    this.selectedArrow.set(null);
    this.editing.set(null);
    this.popup.set(null);
  }

  edit(id: CardId, item?: number): void {
    if (this.editing() !== id) this.checkpoint();
    this.selected.set(new Set([id]));
    this.selectedArrow.set(null);
    this.editing.set(id);
    if (item !== undefined) this.focusItem.set({ card: id, index: item });
  }

  stopEditing(): void {
    this.editing.set(null);
    this.focusItem.set(null);
  }

  /** Update a card's content while typing (the undo step was taken when editing began). */
  updateCard(id: CardId, f: (c: Card) => void, checkpoint = false): void {
    this.change((_, b) => {
      const c = findCard(b, id);
      if (c) f(c);
    }, checkpoint);
  }

  // ---------- creating ----------

  freeSpot(size: Pt, canvas: Pt): Pt {
    const v = this.view();
    const c = { x: (canvas.x / 2 - v.pan[0]) / v.zoom, y: (canvas.y / 2 - v.pan[1]) / v.zoom };
    return freeSpot(c, size, [...this.rects().values()]);
  }

  defaultSize(tool: Tool): Pt {
    return DEFAULT_SIZE[tool] ?? { x: 160, y: 80 };
  }

  private insert(content: Content, width: number, place: Place): CardId {
    let id = 0;
    this.change((s, b) => {
      id = newId(s);
      const pos: [number, number] = 'at' in place ? [Math.round(place.at.x), Math.round(place.at.y)] : [0, 0];
      b.cards.push({ id, pos, width, color: 0, z: maxZ(b) + 1, container: 'Canvas', locked: false, align: 0, content });
      if ('column' in place) attachColumn(b, id, place.column, place.index);
      if ('unsorted' in place) attachUnsorted(b, id);
    });
    this.selected.set(new Set([id]));
    this.selectedArrow.set(null);
    return id;
  }

  /** `place.at` is where the middle-top of the card goes. */
  create(tool: Tool, place: Place): CardId | null {
    if (UNAVAILABLE.includes(tool)) {
      this.showToast(`${tool} isn't available in this version yet`);
      return null;
    }
    if (tool === 'Line') {
      const c = 'at' in place ? place.at : { x: 0, y: 0 };
      let id = 0;
      this.change((s, b) => {
        id = newId(s);
        b.arrows.push(freeArrow(id, [c.x - 70, c.y + 40], [c.x + 70, c.y - 40]));
      });
      this.selectArrow(id);
      return null;
    }
    if (tool === 'Column' && 'column' in place) return null;
    const width = this.defaultSize(tool).x;
    const at = 'at' in place ? { at: { x: place.at.x - width / 2, y: place.at.y - 24 } } : place;
    let content: Content;
    switch (tool) {
      case 'Note':
        content = { Note: { text: '' } };
        break;
      case 'To-do':
        content = { Todo: { title: '', items: [{ text: '', done: false }] } };
        break;
      case 'Link':
        content = { Link: { url: '', title: '' } };
        break;
      case 'Column':
        content = { Column: { title: '', children: [] } };
        break;
      case 'Board': {
        let b = 0;
        this.checkpoint();
        b = newBoard(this.data, 'New Board', this.current(), 0);
        content = { Board: { board: b } };
        break;
      }
      default:
        return null;
    }
    const id = this.insert(content, width, at);
    this.editing.set(id);
    if (tool === 'To-do') this.focusItem.set({ card: id, index: 0 });
    if ('unsorted' in place) this.setPrefs({ drawer_open: true });
    return id;
  }

  async addPicture(file: File, place: Place): Promise<void> {
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = URL.createObjectURL(file);
    });
    if (!dims.w) {
      this.showToast("That file couldn't be opened as a picture");
      return;
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    // A random part keeps names unique across devices adding pictures offline at the same time
    // (ids alone can repeat until the boards are merged, and the file would overwrite the other).
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
    const name = `${newId(this.data)}-${rnd}.${ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png'}`;
    try {
      await this.storage.putImage(name, file);
    } catch (e) {
      this.showToast(`The picture couldn't be saved: ${(e as Error).message || 'unknown error'}`);
      return;
    }
    const width = Math.min(320, Math.max(120, dims.w));
    const at = 'at' in place ? { at: { x: place.at.x - width / 2, y: place.at.y - 80 } } : place;
    this.insert({ Image: { file: name, caption: '', aspect: dims.h / dims.w } }, width, at);
    await this.refreshImages();
  }

  addFileLink(name: string, place: Place): void {
    this.insert({ Link: { url: '', title: name } }, 280, place);
    this.showToast('Only the file name was kept: browsers can\'t link to files on your computer.');
  }

  createTextCard(text: string, at: Pt | Place): void {
    const t = text.trim();
    const place: Place = 'x' in at ? { at } : at;
    if (/^https?:\/\/\S+$/.test(t)) this.insert({ Link: { url: t, title: '' } }, 280, place);
    else this.insert({ Note: { text: t } }, 300, place);
  }

  // ---------- moving ----------

  /** Start dragging the selection: cards in columns or the drawer come onto the canvas at `worldRects`. */
  beginDrag(ids: CardId[], worldRects: Map<CardId, Rect>): void {
    this.change((_, b) => {
      let z = maxZ(b);
      for (const id of ids) {
        const c = findCard(b, id);
        const r = worldRects.get(id);
        if (!c || !r || c.locked) continue;
        const wasColumn = typeof c.container === 'object';
        detach(b, id);
        c.pos = [r.x, r.y];
        c.z = ++z;
        if (wasColumn) c.width = Math.round(r.w);
      }
    });
  }

  moveTo(positions: Map<CardId, [number, number]>): void {
    this.change((_, b) => {
      for (const [id, p] of positions) {
        const c = findCard(b, id);
        if (c) c.pos = p;
      }
    }, false);
  }

  endDrag(ids: CardId[], drop: { column: CardId; index: number } | 'unsorted' | null): void {
    this.change((_, b) => {
      const movable = ids.filter((id) => !('Column' in (findCard(b, id)?.content ?? { Note: {} })));
      if (drop === 'unsorted') movable.forEach((id) => attachUnsorted(b, id));
      else if (drop) movable.forEach((id, k) => attachColumn(b, id, drop.column, drop.index + k));
      for (const id of ids) {
        const c = findCard(b, id);
        if (c) c.pos = [Math.round(c.pos[0]), Math.round(c.pos[1])];
      }
    }, false);
    if (drop === 'unsorted') this.selected.set(new Set());
  }

  setWidth(id: CardId, w: number, checkpoint: boolean): void {
    this.updateCard(id, (c) => (c.width = Math.round(Math.min(900, Math.max(140, w)))), checkpoint);
  }

  // ---------- lines ----------

  connect(from: CardId, to: CardId | null, at: Pt): void {
    const b = this.board();
    if (to !== null && b.arrows.some((a) => (a.from === from && a.to === to) || (a.from === to && a.to === from))) return;
    let id = 0;
    this.change((s, bb) => {
      id = newId(s);
      const a = newArrow(id, from, to ?? 0);
      if (to === null) a.to_pt = [Math.round(at.x), Math.round(at.y)];
      bb.arrows.push(a);
    });
    if (to === null) this.selectArrow(id);
  }

  editArrow(id: number, f: (a: Arrow) => void, checkpoint = true): void {
    this.change((_, b) => {
      const a = b.arrows.find((x) => x.id === id);
      if (a) f(a);
    }, checkpoint);
  }

  /** Drop a line end on a card (attach) or on empty board (free point). */
  setArrowEnd(id: number, end: 0 | 1, card: CardId | null, at: Pt): void {
    this.editArrow(
      id,
      (a) => {
        if (end === 0) {
          a.from = card ?? 0;
          a.from_pt = card ? null : [Math.round(at.x), Math.round(at.y)];
        } else {
          a.to = card ?? 0;
          a.to_pt = card ? null : [Math.round(at.x), Math.round(at.y)];
        }
      },
      false,
    );
  }

  // ---------- colours, icons, names ----------

  setCardColor(id: CardId, color: number): void {
    const c = findCard(this.board(), id);
    if (c && 'Board' in c.content) {
      const bid = c.content.Board.board;
      this.change((s) => (getBoard(s, bid).color = color));
    } else this.updateCard(id, (x) => (x.color = color), true);
  }

  setBoardIcon(id: CardId, icon: string | null): void {
    const c = findCard(this.board(), id);
    if (c && 'Board' in c.content) {
      const bid = c.content.Board.board;
      this.change((s) => (getBoard(s, bid).icon = icon));
    }
  }

  renameBoard(cardId: CardId, name: string): void {
    const c = findCard(this.board(), cardId);
    if (c && 'Board' in c.content) {
      const bid = c.content.Board.board;
      this.change((s) => (getBoard(s, bid).name = name), false);
    }
  }

  cycleAlign(id: CardId): void {
    this.updateCard(id, (c) => (c.align = (c.align + 1) % 3), true);
  }

  // ---------- delete, copy, paste ----------

  private selectionWithChildren(): Card[] {
    const b = this.board();
    const out: Card[] = [];
    const seen = new Set<CardId>();
    for (const id of this.selected()) {
      const c = findCard(b, id);
      if (!c || seen.has(id)) continue;
      seen.add(id);
      out.push(structuredClone(c));
      if ('Column' in c.content)
        for (const k of c.content.Column.children) {
          const cc = findCard(b, k);
          if (cc && !seen.has(k)) {
            seen.add(k);
            out.push(structuredClone(cc));
          }
        }
    }
    for (const c of out)
      if (typeof c.container === 'object' && !seen.has(c.container.Column)) {
        c.container = 'Canvas';
        const r = this.rects().get(c.id);
        if (r) c.pos = [r.x, r.y];
      }
    return out;
  }

  deleteSelection(): void {
    const a = this.selectedArrow();
    if (a !== null) {
      this.change((_, b) => (b.arrows = b.arrows.filter((x) => x.id !== a)));
      this.selectedArrow.set(null);
      this.popup.set(null);
      return;
    }
    const ids = [...this.selected()];
    if (!ids.length) return;
    this.editing.set(null);
    let n = 0;
    this.change((s) => (n = deleteCards(s, this.current(), ids)));
    this.selected.set(new Set());
    this.popup.set(null);
    if (n) this.showToast(n === 1 ? 'Moved 1 card to the trash' : `Moved ${n} cards to the trash`, true);
  }

  duplicate(): void {
    const a = this.selectedArrow();
    if (a !== null) {
      const ar = this.board().arrows.find((x) => x.id === a);
      if (!ar || (ar.from && ar.to)) return;
      let id = 0;
      this.change((s, b) => {
        id = newId(s);
        const shift = (p: [number, number] | null): [number, number] | null => (p ? [p[0] + 24, p[1] + 24] : null);
        b.arrows.push({ ...structuredClone(ar), id, from_pt: shift(ar.from_pt), to_pt: shift(ar.to_pt) });
      });
      this.selectedArrow.set(id);
      return;
    }
    const cards = this.selectionWithChildren();
    if (!cards.length) return;
    const ids = new Set(cards.map((c) => c.id));
    const arrows = this.board().arrows.filter((x) => ids.has(x.from) && ids.has(x.to));
    let top: CardId[] = [];
    this.change((s) => (top = copyCardsInto(s, this.current(), cards, arrows, [24, 24], 0, false)));
    this.selected.set(new Set(top));
  }

  copy(): string | null {
    const cards = this.selectionWithChildren();
    if (!cards.length) return null;
    const ids = new Set(cards.map((c) => c.id));
    const text = cards.map((c) => cardText(this.data, c)).filter((t) => t).join('\n\n') || '(Noteboard cards)';
    this.clipboard = { cards, arrows: this.board().arrows.filter((x) => ids.has(x.from) && ids.has(x.to)).map((x) => structuredClone(x)), text };
    return text;
  }

  hasClipboard(): boolean {
    return !!this.clipboard;
  }

  /** Paste copied cards at `at` when `text` is what we copied; otherwise make a note or link from the text. */
  paste(text: string | null, at: Pt): void {
    const clip = this.clipboard;
    if (clip && (text === null || text.replace(/\r\n/g, '\n').trim() === clip.text.trim())) {
      const cards = clip.cards.map((c) => ({ ...structuredClone(c), container: c.container === 'Unsorted' ? ('Canvas' as const) : c.container }));
      const tops = cards.filter((c) => c.container === 'Canvas');
      const minX = Math.min(...tops.map((c) => c.pos[0]));
      const minY = Math.min(...tops.map((c) => c.pos[1]));
      const off: [number, number] = Number.isFinite(minX) ? [at.x - minX, at.y - minY] : [0, 0];
      let top: CardId[] = [];
      this.change((s) => (top = copyCardsInto(s, this.current(), cards, clip.arrows, off, 0, false)));
      this.selected.set(new Set(top));
    } else if (text && text.trim()) this.createTextCard(text, at);
  }

  bringTo(front: boolean): void {
    const ids = [...this.selected()];
    this.change((_, b) => {
      const z = front ? maxZ(b) + 1 : minZ(b) - 1;
      ids.forEach((id) => {
        const c = findCard(b, id);
        if (c) c.z = z;
      });
    });
  }

  setLocked(id: CardId, locked: boolean): void {
    this.updateCard(id, (c) => (c.locked = locked), true);
  }

  toUnsorted(): void {
    const ids = [...this.selected()];
    this.change((_, b) => ids.forEach((id) => findCard(b, id) && !('Column' in findCard(b, id)!.content) && attachUnsorted(b, id)));
    this.selected.set(new Set());
    this.setPrefs({ drawer_open: true });
  }

  toCanvas(id: CardId, at: Pt): void {
    this.change((_, b) => {
      detach(b, id);
      const c = findCard(b, id);
      if (c) {
        c.pos = [Math.round(at.x - c.width / 2), Math.round(at.y - 40)];
        c.z = maxZ(b) + 1;
      }
    });
  }

  // ---------- trash ----------

  restoreTrash(id: number): void {
    let to: BoardId | null = null;
    this.change((s) => (to = restore(s, id)));
    if (to !== null) this.showToast(`Restored to ${getBoard(this.data, to).name}`);
  }

  purgeTrash(id: number): void {
    this.change((s) => purge(s, id));
  }

  emptyTrash(): void {
    this.change((s) => [...s.trash].forEach((t) => purge(s, t.id)));
    this.showToast('The trash was emptied', true);
  }

  // ---------- search ----------

  readonly hits = computed<Hit[]>(() => {
    this.rev();
    const q = this.search().trim().toLowerCase();
    const out: Hit[] = [];
    if (!q) return out;
    for (const b of Object.values(this.data.boards)) {
      if (b.id !== this.data.root && b.name.toLowerCase().includes(q))
        out.push({ board: b.id, card: null, kind: 'Board', title: b.name, snippet: boardPath(this.data, b.id).map((x) => getBoard(this.data, x).name).join(' / ') });
      for (const c of b.cards) {
        if ('Board' in c.content) continue;
        const t = cardText(this.data, c);
        if (t.toLowerCase().includes(q)) out.push({ board: b.id, card: c.id, kind: KIND_NAMES[kindOf(c.content)], title: plainTitle(t) || KIND_NAMES[kindOf(c.content)], snippet: `in ${b.name}` });
      }
      if (out.length > 60) break;
    }
    return out;
  });

  readonly centerOn = signal<CardId | null>(null);

  gotoHit(h: Hit): void {
    this.openBoard(h.board);
    if (h.card !== null) {
      this.selected.set(new Set([h.card]));
      if (findCard(this.board(), h.card)?.container === 'Unsorted') this.setPrefs({ drawer_open: true });
      else this.centerOn.set(h.card);
    }
    this.search.set('');
    this.popup.set(null);
  }

  // ---------- import and export ----------

  async checkImport(text: string, files: File[]): Promise<ImportReport> {
    const have = new Set([...(await this.storage.listImages()), ...files.map((f) => f.name)]);
    return validateDesktopFile(text, this.data, have);
  }

  async applyImport(report: ImportReport, files: File[]): Promise<BoardId> {
    for (const f of files) if (report.images.includes(f.name)) await this.storage.putImage(f.name, f);
    let home = 0;
    this.change((s) => (home = importDesktopStore(s, report, `Imported from desktop (${new Date().toLocaleDateString()})`)));
    await this.saveNow();
    await this.refreshImages();
    return home;
  }

  exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  // ---------- small things ----------

  showToast(text: string, undo = false): void {
    this.toast.set({ text, undo });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  card(id: CardId): Card | undefined {
    return findCard(this.board(), id);
  }

  boardOf(c: Card): Board | undefined {
    return 'Board' in c.content ? this.data.boards[String(c.content.Board.board)] : undefined;
  }

  cardCount(c: Card): number {
    return this.boardOf(c)?.cards.length ?? 0;
  }
}
