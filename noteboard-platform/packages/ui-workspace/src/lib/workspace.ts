import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Arrow, Card, CardId, ago, findCard, getBoard, plainTitle, cardText, KIND_NAMES, kindOf } from '@noteboard/board-model';
import { arrowHead, lineWidth, toWorld } from '@noteboard/canvas-geometry';
import { CanvasControl } from './canvas';
import { CardView } from './card';
import { Icon } from './icon';
import { BOARD_COLORS, BOARD_ICONS, CARD_COLORS, LINE_COLORS, SCALES } from './prefs';
import { Settings } from './settings';
import { MORE_TOOLS, Place, TOOLS, Tool, UNAVAILABLE, Workspace } from './workspace.service';

/** Clipboard of the native apps (phones have no Ctrl+V); set by the app shell as `window.nbClipboard`. */
interface NativeClipboard {
  writeText(text: string): Promise<void>;
  read(): Promise<{ text?: string; image?: Blob } | null>;
}
const nativeClipboard = () => (typeof window !== 'undefined' ? (window as { nbClipboard?: NativeClipboard }).nbClipboard : undefined);

type Mode = { kind: 'default' } | { kind: 'card'; card: Card } | { kind: 'line'; arrow: Arrow } | { kind: 'multi' };

@Component({
  selector: 'nb-workspace',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardView, Icon, Settings],
  providers: [Workspace],
  templateUrl: './workspace.html',
  host: {
    class: 'nb-shell',
    '[class.dark]': 'ws.dark()',
    '[class.bold-headings]': 'ws.prefs().bold_headings',
    '[style.--ui]': 'uiScale()',
  },
})
export class WorkspaceView {
  readonly ws = inject(Workspace);
  readonly canvasRef = viewChild.required<ElementRef<HTMLElement>>('canvas');
  readonly worldRef = viewChild<ElementRef<HTMLElement>>('world');
  readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private searchFocused = false;

  readonly tools = TOOLS;
  readonly moreTools = MORE_TOOLS;
  readonly unavailable = UNAVAILABLE;
  readonly cardColors = CARD_COLORS;
  readonly boardColors = BOARD_COLORS;
  readonly lineColors = LINE_COLORS;
  readonly kindNames = KIND_NAMES;
  readonly iconQuery = signal('');
  readonly labelText = signal('');
  /** Bumped on every pointer move so overlays (band, guides, ghost) redraw. */
  readonly tick = signal(0);
  readonly ctl = new CanvasControl(this.ws, () => this.canvasRef().nativeElement, () => this.tick.update((t) => t + 1));
  private pendingPlace: Place | null = null;
  private pendingTool: Tool | null = null;

  readonly uiScale = computed(() => SCALES[this.ws.prefs().scale]?.[1] ?? 1);
  readonly canvasCards = computed(() => CanvasControl.canvasCards(this.ws.board().cards));
  readonly unsortedCards = computed(() => this.ws.board().unsorted.map((id) => findCard(this.ws.board(), id)).filter((c): c is Card => !!c));
  readonly worldTransform = computed(() => {
    const v = this.ws.view();
    return `translate(${v.pan[0]}px, ${v.pan[1]}px) scale(${v.zoom})`;
  });
  readonly gridStyle = computed(() => {
    const v = this.ws.view();
    const step = 20 * v.zoom * (v.zoom < 0.6 ? 2 : 1);
    return { size: `${step}px ${step}px`, pos: `${v.pan[0]}px ${v.pan[1]}px` };
  });
  readonly mode = computed<Mode>(() => {
    const a = this.ws.selectedArrow();
    const b = this.ws.board();
    if (a !== null) {
      const arrow = b.arrows.find((x) => x.id === a);
      if (arrow) return { kind: 'line', arrow };
    }
    const sel = this.ws.selected();
    if (sel.size === 1) {
      const card = findCard(b, [...sel][0]);
      if (card) return { kind: 'card', card };
    }
    return sel.size > 1 ? { kind: 'multi' } : { kind: 'default' };
  });
  readonly lines = computed(() => {
    this.tick();
    this.ws.anchors();
    return this.ws.board().arrows.map((a) => {
      const e = this.ctl.ends(a);
      if (!e) return null;
      const [p1, p2] = e;
      const w = lineWidth(a.weight);
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const ux = (p2.x - p1.x) / len;
      const uy = (p2.y - p1.y) / len;
      const head = 8 + 2 * w - 2;
      const s = a.head_start ? { x: p1.x + ux * head, y: p1.y + uy * head } : p1;
      const t = a.head ? { x: p2.x - ux * head, y: p2.y - uy * head } : p2;
      const pts = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');
      return {
        a,
        p1,
        p2,
        d: `M${s.x},${s.y}L${t.x},${t.y}`,
        width: w,
        color: LINE_COLORS[a.color % LINE_COLORS.length][1],
        dash: a.dashed ? `${6 + 2 * w} ${4 + w}` : null,
        headEnd: a.head ? pts(arrowHead(p1, p2, a.weight)) : null,
        headStart: a.head_start ? pts(arrowHead(p2, p1, a.weight)) : null,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        selected: this.ws.selectedArrow() === a.id,
      };
    });
  });
  /** Resize corner and connection dot for one selected card on the canvas. */
  readonly handles = computed(() => {
    const m = this.mode();
    if (m.kind !== 'card' || this.ws.editing() === m.card.id) return null;
    const r = this.ws.rects().get(m.card.id);
    const an = this.ws.anchors().get(m.card.id);
    if (!r || !an || m.card.container === 'Unsorted') return null;
    const isBoard = 'Board' in m.card.content;
    return {
      id: m.card.id,
      resize: m.card.container === 'Canvas' && !m.card.locked && !isBoard ? { x: r.x + r.w, y: r.y + r.h } : null,
      connect: isBoard ? { x: an.x + an.w - 3, y: an.y + 3 } : { x: an.x + an.w, y: an.y + an.h / 2 },
    };
  });
  readonly icons = computed(() => {
    const q = this.iconQuery().trim().toLowerCase();
    return BOARD_ICONS.filter(([, words]) => !q || words.includes(q));
  });
  readonly menuCard = computed(() => {
    const m = this.ws.menu();
    return m && 'card' in m.target ? findCard(this.ws.board(), m.target.card) ?? null : null;
  });

  constructor() {
    void this.ws.init();
    // On-screen keyboards shrink the visible area: keep the card being edited in view.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    let full = vv?.height ?? 0;
    addEventListener('orientationchange', () => (full = 0));
    vv?.addEventListener('resize', () => {
      full = Math.max(full, vv.height);
      const id = this.ws.editing();
      // (Android shrinks the whole page for the keyboard, iOS only the visual viewport.)
      if (id !== null && vv.height < full * 0.85) this.ws.centerOn.set(id);
    });
    // A short buzz when a long press opens the menu: the apps provide `nbHaptic` (native haptics).
    this.ctl.onLongPress = () => {
      const w = window as { nbHaptic?: () => void };
      if (w.nbHaptic) w.nbHaptic();
      else navigator.vibrate?.(12);
    };
    this.ctl.onPickFile = (tool, place) => {
      this.pendingTool = tool;
      this.pendingPlace = place;
      const input = this.fileInput().nativeElement;
      input.accept = tool === 'Add image' ? 'image/*' : '';
      input.value = '';
      input.click();
    };
    afterRenderEffect(() => {
      this.ws.rev();
      this.ws.view();
      this.ws.editing();
      const w = this.worldRef()?.nativeElement;
      if (w) this.ctl.measure(w);
    });
    effect(() => {
      const id = this.ws.centerOn();
      const r = id !== null ? this.ws.rects().get(id) : undefined;
      if (id === null || !r) return;
      const size = this.ctl.canvasSize();
      const z = this.ws.view().zoom;
      this.ws.setView({ zoom: z, pan: [size.x / 2 - (r.x + r.w / 2) * z, size.y / 2 - (r.y + r.h / 2) * z] });
      this.ws.centerOn.set(null);
    });
    effect(() => document.documentElement.classList.toggle('nb-dark', this.ws.dark()));
    // Put the cursor in the search box when it opens.
    afterRenderEffect(() => {
      const input = this.searchInput()?.nativeElement;
      if (input && !this.searchFocused) {
        input.focus();
        this.searchFocused = true;
      } else if (!input) this.searchFocused = false;
    });
  }

  // ---------- window events ----------

  @HostListener('window:pointermove', ['$event']) onMove(e: PointerEvent) {
    this.ctl.move(e);
  }
  /**
   * The Android Back button (the app sends `nb-back`): closes what is open, then goes up one board.
   * Calls preventDefault() when it did something, so the app knows not to leave the page.
   */
  @HostListener('window:nb-back', ['$event']) onBack(e: Event) {
    const ws = this.ws;
    const done = () => e.preventDefault();
    if (ws.menu()) return void (ws.menu.set(null), done());
    if (ws.popup()) return void (ws.popup.set(null), done());
    if (ws.settingsOpen()) return void (ws.settingsOpen.set(false), done());
    if (ws.showTrash()) return void (ws.showTrash.set(false), done());
    if (ws.editing() !== null) return void (ws.stopEditing(), done());
    if (ws.prefs().drawer_open && matchMedia('(max-width: 640px)').matches) return void (ws.setPrefs({ drawer_open: false }), done());
    if (ws.selected().size || ws.selectedArrow() !== null) return void (ws.clearSelection(), ws.selectedArrow.set(null), done());
    const path = ws.path();
    if (path.length > 1) return void (ws.openBoard(path[path.length - 2].id), done());
  }

  /**
   * Something shared to the app from another app (Android share sheet, iOS share): text and links
   * become notes and link cards, pictures become picture cards, all in Unsorted on the current board.
   */
  @HostListener('window:nb-share-in', ['$event']) async onShareIn(e: Event) {
    const d = (e as CustomEvent<{ text?: string; files?: File[] }>).detail ?? {};
    if (!this.ws.loaded() || this.ws.loadFailed()) return; // not taken: the app tries again shortly
    e.preventDefault(); // taken
    if (d.text?.trim()) this.ws.createTextCard(d.text, { unsorted: true });
    for (const f of d.files ?? []) if (f.type.startsWith('image/')) await this.ws.addPicture(f, { unsorted: true });
    this.ws.setPrefs({ drawer_open: true });
    this.ws.showToast('Added to Unsorted');
  }

  @HostListener('window:pointercancel', ['$event']) onCancel(e: PointerEvent) {
    this.ctl.cancel(e);
  }
  @HostListener('window:pointerup', ['$event']) onUp(e: PointerEvent) {
    this.ctl.up(e);
  }
  @HostListener('window:keydown', ['$event']) @HostListener('window:keyup', ['$event']) onKey(e: KeyboardEvent) {
    this.ctl.key(e);
  }
  @HostListener('window:copy', ['$event']) onCopy(e: ClipboardEvent) {
    if (this.inField(e)) return;
    const text = this.ws.copy();
    if (text !== null) {
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    }
  }
  @HostListener('window:cut', ['$event']) onCut(e: ClipboardEvent) {
    if (this.inField(e)) return;
    this.onCopy(e);
    this.ws.deleteSelection();
  }
  @HostListener('window:paste', ['$event']) onPaste(e: ClipboardEvent) {
    if (this.inField(e)) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) {
      files.forEach((f) => void this.ws.addPicture(f, { at: this.ctl.pasteAt() }));
      return;
    }
    this.ws.paste(e.clipboardData?.getData('text/plain') ?? null, this.ctl.pasteAt());
  }
  @HostListener('window:beforeunload') onLeave() {
    if (this.ws.dirty()) void this.ws.saveNow();
  }

  private inField(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    let k = 0;
    for (const f of files) {
      const at = this.ctl.world(e);
      const place = { at: { x: at.x + k, y: at.y + k } };
      k += 24;
      if (f.type.startsWith('image/')) void this.ws.addPicture(f, place);
      else this.ws.addFileLink(f.name, place);
    }
  }

  onFile(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    const place = this.pendingPlace ?? { at: { x: 0, y: 0 } };
    if (!f) return;
    if (f.type.startsWith('image/')) void this.ws.addPicture(f, place);
    else if (this.pendingTool === 'Upload') this.ws.addFileLink(f.name, place);
    this.pendingPlace = null;
  }

  // ---------- toolbar ----------

  toolVisible(t: Tool): boolean {
    return !this.ws.prefs().hidden_tools.includes(t);
  }

  popupFor(kind: string, el: HTMLElement, extra: { card?: CardId; arrow?: number }): void {
    const cur = this.ws.popup();
    if (cur && cur.kind === kind) {
      this.ws.popup.set(null);
      return;
    }
    const shell = el.closest('.nb-shell')!.getBoundingClientRect();
    const y = el.getBoundingClientRect().top - shell.top;
    if (kind === 'more') this.ws.popup.set({ kind: 'more', y });
    else if (extra.card !== undefined) this.ws.popup.set({ kind: kind as 'card-color', card: extra.card, y });
    else if (extra.arrow !== undefined) {
      if (kind === 'line-label') this.labelText.set(this.ws.board().arrows.find((a) => a.id === extra.arrow)?.label ?? '');
      this.ws.popup.set({ kind: kind as 'line-color', arrow: extra.arrow, y });
    }
  }

  readonly flipStart = (a: Arrow) => (a.head_start = !a.head_start);
  readonly flipEnd = (a: Arrow) => (a.head = !a.head);
  readonly flipDashed = (a: Arrow) => (a.dashed = !a.dashed);
  setColorFn(i: number) {
    return (a: Arrow) => (a.color = i);
  }
  setWeightFn(w: number) {
    return (a: Arrow) => (a.weight = w);
  }

  openLink(c: Card): void {
    if (!('Link' in c.content)) return;
    const u = c.content.Link.url.trim();
    const full = /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
    if (/^https?:\/\//i.test(full)) window.open(full, '_blank', 'noopener,noreferrer');
  }

  back(): void {
    this.ws.clearSelection();
  }

  more(el: HTMLElement, card: Card): void {
    const shell = el.closest('.nb-shell')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.ws.menu.set({ x: r.right - shell.left + 4, y: r.top - shell.top, target: { card: card.id } });
  }

  addTask(c: Card): void {
    if (!('Todo' in c.content)) return;
    const n = c.content.Todo.items.length;
    this.ws.updateCard(c.id, (x) => 'Todo' in x.content && x.content.Todo.items.push({ text: '', done: false }), true);
    this.ws.edit(c.id, n);
  }

  addNoteToColumn(c: Card): void {
    if ('Column' in c.content) this.ws.create('Note', { column: c.id, index: c.content.Column.children.length });
  }

  replacePicture(c: Card): void {
    this.pendingTool = 'Add image';
    this.pendingPlace = null;
    const input = this.fileInput().nativeElement;
    input.accept = 'image/*';
    input.value = '';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.onchange = null;
      if (!f) return;
      await this.ws.addPicture(f, { at: { x: c.pos[0] + c.width / 2, y: c.pos[1] + 80 } });
      // keep the place: copy the new picture into the old card, remove the temporary one
      const added = [...this.ws.selected()][0];
      const nc = this.ws.card(added);
      if (nc && 'Image' in nc.content) {
        const img = nc.content.Image;
        this.ws.updateCard(c.id, (x) => 'Image' in x.content && ((x.content.Image.file = img.file), (x.content.Image.aspect = img.aspect)), true);
        this.ws.selected.set(new Set([added]));
        this.ws.deleteSelection();
        this.ws.select(c.id);
        await this.ws.refreshImages();
      }
    };
    input.click();
  }

  // ---------- formatting (note being written) ----------

  format(kind: 'wrap' | 'prefix', mark: string): void {
    const id = this.ws.editing();
    const ta = document.querySelector<HTMLTextAreaElement>(`nb-card-view[data-card="${id}"] textarea.nb-note-edit`);
    if (id === null || !ta) return;
    const text = ta.value;
    let a = ta.selectionStart;
    let b = ta.selectionEnd;
    let out = text;
    if (kind === 'wrap') {
      out = text.slice(0, a) + mark + text.slice(a, b) + mark + text.slice(b);
      a += mark.length;
      b += mark.length;
    } else {
      const start = text.lastIndexOf('\n', a - 1) + 1;
      const line = text.slice(start);
      const existing = ['### ', '## ', '# ', '- ', '> '].find((p) => line.startsWith(p));
      const removed = existing?.length ?? 0;
      const added = existing === mark ? 0 : mark.length;
      out = text.slice(0, start) + (existing === mark ? '' : mark) + text.slice(start + removed);
      a = Math.max(start, a + added - removed);
      b = Math.max(start, b + added - removed);
    }
    this.ws.updateCard(id, (c) => 'Note' in c.content && (c.content.Note.text = out), true);
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(a, b);
    });
  }

  readonly formatBar = computed(() => {
    const id = this.ws.editing();
    this.tick();
    if (id === null) return null;
    const c = findCard(this.ws.board(), id);
    if (!c || !('Note' in c.content)) return null;
    const el = document.querySelector<HTMLElement>(`nb-card-view[data-card="${id}"]`);
    const shell = el?.closest('.nb-shell')?.getBoundingClientRect();
    if (!el || !shell) return null;
    const r = el.getBoundingClientRect();
    const above = r.top - shell.top > 100;
    return { x: Math.max(80, r.left - shell.left), y: above ? r.top - shell.top - 8 : r.bottom - shell.top + 8, above, align: c.align };
  });

  // ---------- menus ----------

  menuAction(action: string): void {
    const m = this.ws.menu();
    this.ws.menu.set(null);
    if (!m) return;
    const t = m.target;
    const size = this.ctl.canvasSize();
    if ('card' in t) {
      const c = findCard(this.ws.board(), t.card);
      if (!c) return;
      switch (action) {
        case 'edit':
          this.ws.edit(c.id);
          break;
        case 'open':
          if ('Board' in c.content) this.ws.openBoard(c.content.Board.board);
          break;
        case 'duplicate':
          this.ws.duplicate();
          break;
        case 'copy':
          void Promise.resolve(nativeClipboard()?.writeText(this.ws.copy() ?? '') ?? navigator.clipboard?.writeText(this.ws.copy() ?? '')).catch(() => undefined);
          break;
        case 'front':
          this.ws.bringTo(true);
          break;
        case 'back':
          this.ws.bringTo(false);
          break;
        case 'lock':
          this.ws.setLocked(c.id, !c.locked);
          break;
        case 'unsorted':
          this.ws.toUnsorted();
          break;
        case 'canvas':
          this.ws.toCanvas(c.id, this.ws.freeSpot({ x: 300, y: 100 }, size));
          break;
        case 'delete':
          this.ws.deleteSelection();
          break;
      }
    } else if ('canvas' in t) {
      const at = t.canvas;
      if (action.startsWith('new:')) this.ctl.createTool(action.slice(4) as Tool, { at });
      if (action === 'paste') void this.pasteHere(at);
      if (action === 'paste-picture') void this.pastePicture(at);
      if (action === 'all') this.ws.selected.set(new Set(this.ws.board().cards.filter((c) => c.container === 'Canvas').map((c) => c.id)));
      if (action === 'fit') this.ws.fit(size);
    } else if ('arrow' in t) {
      if (action === 'delete') this.ws.deleteSelection();
      if (action === 'duplicate') this.ws.duplicate();
      if (action === 'detach') {
        const a = this.ws.board().arrows.find((x) => x.id === t.arrow);
        const e = a && this.ctl.ends(a);
        if (e) this.ws.editArrow(t.arrow, (x) => Object.assign(x, { from: 0, to: 0, from_pt: [e[0].x, e[0].y], to_pt: [e[1].x, e[1].y] }));
      }
    }
  }

  /** Paste from the menu: cards copied in Noteboard, otherwise the system clipboard's text (apps). */
  private async pasteHere(at: { x: number; y: number }): Promise<void> {
    const clip = nativeClipboard();
    const got = clip ? await clip.read().catch(() => null) : null;
    // paste() recognises text that is our own copy and pastes the cards instead of a note.
    if (got?.image) await this.ws.addPicture(new File([got.image], `pasted.${got.image.type.split('/')[1] || 'png'}`, { type: got.image.type }), { at });
    else if (got?.text) this.ws.paste(got.text, at);
    else if (this.ws.hasClipboard()) this.ws.paste(null, at);
    else this.ws.showToast('The clipboard is empty');
  }

  private async pastePicture(at: { x: number; y: number }): Promise<void> {
    const clip = nativeClipboard();
    if (clip) {
      const got = await clip.read().catch(() => null);
      if (got?.image) await this.ws.addPicture(new File([got.image], `pasted.${got.image.type.split('/')[1] || 'png'}`, { type: got.image.type }), { at });
      else this.ws.showToast("There's no picture on the clipboard");
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          await this.ws.addPicture(new File([blob], `pasted.${type.split('/')[1]}`, { type }), { at });
          return;
        }
      }
      this.ws.showToast("There's no picture on the clipboard");
    } catch {
      this.ws.showToast('The browser didn\'t allow reading the clipboard; press Ctrl+V on the board instead');
    }
  }

  // ---------- small helpers for the template ----------

  zoomBy(f: number): void {
    const s = this.ctl.canvasSize();
    const v = this.ws.view();
    const z = Math.min(2.5, Math.max(0.25, v.zoom * f));
    const c = toWorld(v, { x: s.x / 2, y: s.y / 2 });
    this.ws.setView({ zoom: z, pan: [s.x / 2 - c.x * z, s.y / 2 - c.y * z] });
  }

  pct(): string {
    return `${Math.round(this.ws.view().zoom * 100)}%`;
  }

  cardColor(c: Card): string {
    const col = CARD_COLORS[c.color % CARD_COLORS.length];
    return this.ws.dark() ? col[2] : col[1];
  }

  boardColorOf(c: Card): number {
    return this.ws.boardOf(c)?.color ?? 0;
  }

  isBoard(c: Card): boolean {
    return 'Board' in c.content;
  }

  kindOf(c: Card): string {
    return kindOf(c.content);
  }

  trashTitle(t: { cards: Card[] }): string {
    const first = t.cards[0];
    if (!first) return '';
    const title = plainTitle(cardText(this.ws.store(), first));
    return (title || `Empty ${KIND_NAMES[kindOf(first.content)].toLowerCase()}`).slice(0, 48);
  }

  trashLine(t: { cards: Card[]; board: number; deleted_at: number }): string {
    const kind = t.cards[0] ? KIND_NAMES[kindOf(t.cards[0].content)] : '';
    const board = this.ws.store().boards[String(t.board)]?.name ?? 'a deleted board';
    const extra = t.cards.length > 1 ? ` · with ${t.cards.length - 1} cards` : '';
    return `${kind} from ${board} · ${ago(t.deleted_at)}${extra}`;
  }

  applyLabel(arrow: number): void {
    const t = this.labelText().trim();
    this.ws.editArrow(arrow, (a) => (a.label = t));
    this.ws.popup.set(null);
  }

  boardOfId(id: number) {
    return getBoard(this.ws.store(), id);
  }
}
