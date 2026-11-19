/** Pointer, wheel, keyboard and clipboard handling for the board canvas. */
import { Arrow, Card, CardId, findCard } from '@noteboard/board-model';
import { BOARD_ICON, Pt, Rect, align, contains, distToSegment, fromTwo, intersects, lineEnds, lineWidth, rect, toWorld, zoomAt } from '@noteboard/canvas-geometry';
import { Tool, UNAVAILABLE, Workspace } from './workspace.service';

type Gesture =
  | { kind: 'card'; id: CardId; start: Pt; moved: boolean; ids: CardId[]; offsets: Map<CardId, Pt>; touch?: boolean; wasSelected?: boolean }
  | { kind: 'band'; start: Pt; additive: boolean; base: ReadonlySet<CardId> }
  | { kind: 'pan'; last: Pt; start?: Pt; moved?: boolean }
  | { kind: 'resize'; id: CardId; startX: number; width: number }
  | { kind: 'connect'; from: CardId }
  | { kind: 'end'; arrow: number; end: 0 | 1 }
  | { kind: 'line'; arrow: number; last: Pt }
  | { kind: 'tool'; tool: Tool; start: Pt; moved: boolean };

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export class CanvasControl {
  gesture: Gesture | null = null;
  pointer: Pt = { x: 0, y: 0 };
  space = false;
  band: Rect | null = null;
  guides: [Pt, Pt][] = [];
  ghost: { x: number; y: number; label: string } | null = null;
  connectLine: [Pt, Pt] | null = null;
  hoverTarget: CardId | null = null;

  // ---------- touch state ----------
  /** Fingers on the screen (client coordinates). */
  private readonly touches = new Map<number, Pt>();
  private pinch: { dist: number; mid: Pt } | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private longFired = false;
  private touchStart: Pt | null = null;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private lastTouchAt = 0;
  /** Called when a long press opens a menu (the apps vibrate briefly). */
  onLongPress?: () => void;

  constructor(
    private readonly ws: Workspace,
    private readonly canvasEl: () => HTMLElement,
    private readonly redraw: () => void,
  ) {}

  /** Pointer position relative to the canvas' top-left. */
  local(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvasEl().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  world(e: { clientX: number; clientY: number }): Pt {
    return toWorld(this.ws.view(), this.local(e));
  }

  canvasSize(): Pt {
    const r = this.canvasEl().getBoundingClientRect();
    return { x: r.width, y: r.height };
  }

  overCanvas(e: { clientX: number; clientY: number }): boolean {
    const r = this.canvasEl().getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /** The two visible ends of a line on the current board. */
  ends(a: Arrow): [Pt, Pt] | null {
    const anchors = this.ws.anchors();
    const g = this.gesture;
    const end = (which: 0 | 1) => {
      if (g?.kind === 'end' && g.arrow === a.id && g.end === which) {
        const other = which === 0 ? a.to : a.from;
        const t = this.cardAt(this.pointerWorld(), [other]);
        const r = t !== null ? anchors.get(t) : undefined;
        return r ? { rect: r, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 } } : { rect: null, at: this.pointerWorld() };
      }
      const card = which === 0 ? a.from : a.to;
      const pt = which === 0 ? a.from_pt : a.to_pt;
      if (card) {
        const r = anchors.get(card);
        return r ? { rect: r, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 } } : null;
      }
      return pt ? { rect: null, at: { x: pt[0], y: pt[1] } } : null;
    };
    const s = end(0);
    const t = end(1);
    return s && t ? lineEnds(s, t) : null;
  }

  pointerWorld(): Pt {
    return toWorld(this.ws.view(), this.pointer);
  }

  cardAt(w: Pt, exclude: CardId[] = []): CardId | null {
    const b = this.ws.board();
    let best: { id: CardId; z: number; inner: boolean } | null = null;
    for (const [id, r] of this.ws.rects()) {
      if (exclude.includes(id) || !contains(r, w)) continue;
      const c = findCard(b, id);
      if (!c || c.container === 'Unsorted') continue;
      const inner = typeof c.container === 'object';
      if (!best || (inner && !best.inner) || (inner === best.inner && c.z > best.z)) best = { id, z: c.z, inner };
    }
    return best?.id ?? null;
  }

  arrowAt(w: Pt): number | null {
    const tol = 7 / this.ws.view().zoom;
    const arrows = this.ws.board().arrows;
    for (let i = arrows.length - 1; i >= 0; i--) {
      const e = this.ends(arrows[i]);
      if (e && distToSegment(w, e[0], e[1]) < tol + lineWidth(arrows[i].weight)) return arrows[i].id;
    }
    return null;
  }

  /** The column (and position in it) under the pointer, ignoring the cards being dragged. */
  dropAt(clientX: number, clientY: number, dragged: CardId[]): { column: CardId; index: number } | 'unsorted' | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el.closest('.nb-drawer')) return 'unsorted';
      const body = el.closest<HTMLElement>('[data-column]');
      if (body) {
        const col = Number(body.dataset['column']);
        if (dragged.includes(col)) continue;
        const kids = [...body.querySelectorAll<HTMLElement>(':scope > nb-card-view')].filter((k) => !dragged.includes(Number(k.dataset['card'])));
        const index = kids.filter((k) => {
          const r = k.getBoundingClientRect();
          return r.top + r.height / 2 < clientY;
        }).length;
        return { column: col, index };
      }
    }
    return null;
  }


  // ---------- touch ----------
  //
  // One finger: drag a card, or pan the board on empty space. Two fingers: pinch to zoom and move.
  // Long press: the context menu. Tap a selected card again (or double-tap): edit it / open a board.

  private static readonly SLOP = 8;
  private static readonly LONG_MS = 500;

  private cancelLong(): void {
    if (this.longTimer) clearTimeout(this.longTimer);
    this.longTimer = null;
  }

  /** Handles a finger going down; false when the normal pointer code should carry on. */
  private touchDown(e: PointerEvent): boolean {
    this.lastTouchAt = Date.now();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) {
      this.cancelLong();
      const g = this.gesture;
      // A card already being dragged keeps going; anything else turns into a pinch.
      if (g?.kind === 'card' && g.moved) return true;
      if (g?.kind === 'band') this.band = null;
      this.gesture = null;
      const [a, b] = [...this.touches.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
      return true;
    }
    this.pinch = null;
    this.longFired = false;
    this.touchStart = { x: e.clientX, y: e.clientY };
    const target = e.target as HTMLElement;
    this.cancelLong();
    if (!target.closest('[data-handle], .nb-float, .nb-drawer') && !(this.ws.editing() !== null && isField(target))) {
      this.longTimer = setTimeout(() => {
        this.longTimer = null;
        if (this.touches.size !== 1 || (this.gesture?.kind === 'card' && this.gesture.moved)) return;
        this.longFired = true;
        this.gesture = null;
        this.band = null;
        const at = this.touchStart!;
        const el = (document.elementFromPoint(at.x, at.y) as HTMLElement | null) ?? target;
        this.contextmenu({ target: el, clientX: at.x, clientY: at.y, preventDefault: () => undefined } as unknown as MouseEvent);
        this.onLongPress?.();
        this.redraw();
      }, CanvasControl.LONG_MS);
    }
    // Empty board space: one finger pans (a selection box needs a mouse or a long press menu).
    if (target.closest('.nb-canvas') && !target.closest('nb-card-view, [data-handle], .nb-float') && this.arrowAt(this.world(e)) === null) {
      this.ws.menu.set(null);
      if (this.ws.editing() !== null) this.ws.stopEditing();
      this.ws.popup.set(null);
      this.ws.clearSelection();
      this.gesture = { kind: 'pan', last: this.local(e), start: { x: e.clientX, y: e.clientY }, moved: false };
      return true;
    }
    return false;
  }

  /** Two-finger pinch and pan; true when the move was used. */
  private touchMove(e: PointerEvent): boolean {
    if (!this.touches.has(e.pointerId)) return false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touchStart && Math.hypot(e.clientX - this.touchStart.x, e.clientY - this.touchStart.y) > CanvasControl.SLOP) this.cancelLong();
    if (this.longFired) return true;
    if (!this.pinch || this.touches.size < 2) return false;
    const [a, b] = [...this.touches.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    const v = zoomAt(this.ws.view(), mid, dist / this.pinch.dist);
    this.ws.setView({ zoom: v.zoom, pan: [v.pan[0] + mid.x - this.pinch.mid.x, v.pan[1] + mid.y - this.pinch.mid.y] });
    this.pinch = { dist, mid };
    return true;
  }

  /** A finger lifted; true when the touch code finished the gesture. */
  private touchUp(e: PointerEvent): boolean {
    this.lastTouchAt = Date.now();
    this.touches.delete(e.pointerId);
    this.cancelLong();
    if (this.pinch) {
      if (this.touches.size < 2) this.pinch = null;
      this.gesture = null;
      return true;
    }
    if (this.longFired) {
      this.gesture = null;
      return true;
    }
    const g = this.gesture;
    const tapped = (g?.kind === 'pan' && !g.moved) || (g?.kind === 'card' && !g.moved);
    if (!tapped) return false;
    // Double tap (on the board or a card) works like a double-click.
    const now = Date.now();
    const prev = this.lastTap;
    this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (prev && now - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 24) {
      this.lastTap = null;
      this.gesture = null;
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ?? (e.target as HTMLElement);
      this.dblclick({ target: el, clientX: e.clientX, clientY: e.clientY } as unknown as MouseEvent);
      return true;
    }
    // Tapping a card that was already selected edits it (or opens the board).
    if (g?.kind === 'card' && g.wasSelected && this.ws.selected().size === 1 && this.ws.editing() !== g.id) {
      this.gesture = null;
      const c = this.ws.card(g.id);
      if (c && 'Board' in c.content) this.ws.openBoard(c.content.Board.board);
      else if (c && !c.locked) this.ws.edit(c.id);
      return true;
    }
    return false;
  }

  /** True right after a touch: the browser's own long-press menu and double-tap events are ignored. */
  private recentTouch(e: Event): boolean {
    return e.isTrusted && Date.now() - this.lastTouchAt < 800;
  }

  cancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      this.cancelLong();
      this.pinch = null;
    }
    if (this.gesture) this.up(e);
  }

  // ---------- pointer ----------

  down(e: PointerEvent): void {
    this.pointer = this.local(e);
    if (e.pointerType === 'touch' && this.touchDown(e)) return;
    const target = e.target as HTMLElement;
    this.ws.menu.set(null);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.gesture = { kind: 'pan', last: this.local(e) };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const handle = target.closest<HTMLElement>('[data-handle]');
    if (handle) {
      e.preventDefault();
      const kind = handle.dataset['handle'];
      const id = Number(handle.dataset['id']);
      if (kind === 'resize') {
        const c = this.ws.card(id);
        if (c) {
          this.ws.checkpoint();
          this.gesture = { kind: 'resize', id, startX: e.clientX, width: c.width };
        }
      } else if (kind === 'connect') {
        this.ws.stopEditing();
        this.gesture = { kind: 'connect', from: id };
      } else if (kind === 'end') {
        this.ws.checkpoint();
        this.gesture = { kind: 'end', arrow: id, end: Number(handle.dataset['end']) as 0 | 1 };
      }
      return;
    }
    const cardEl = target.closest<HTMLElement>('nb-card-view');
    if (cardEl) {
      const id = Number(cardEl.dataset['card']);
      if (this.ws.editing() === id && (isField(target) || target.closest('button, a'))) return;
      if (target.closest('button, a') && !isField(target)) return;
      const touch = e.pointerType === 'touch';
      this.gesture = { kind: 'card', id, start: { x: e.clientX, y: e.clientY }, moved: false, ids: [], offsets: new Map(), touch, wasSelected: touch && this.ws.selected().has(id) };
      return;
    }
    if (target.closest('.nb-canvas') && !target.closest('.nb-float')) {
      const w = this.world(e);
      if (this.ws.editing() !== null) this.ws.stopEditing();
      this.ws.popup.set(null);
      const a = this.arrowAt(w);
      if (a !== null) {
        this.ws.selectArrow(a);
        const ar = this.ws.board().arrows.find((x) => x.id === a);
        if (ar && !ar.from && !ar.to) {
          this.ws.checkpoint();
          this.gesture = { kind: 'line', arrow: a, last: w };
        }
        return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) this.ws.clearSelection();
      this.gesture = { kind: 'band', start: w, additive, base: new Set(this.ws.selected()) };
    }
  }

  toolDown(tool: Tool, e: PointerEvent): void {
    if (e.button !== 0) return;
    this.gesture = { kind: 'tool', tool, start: { x: e.clientX, y: e.clientY }, moved: false };
  }

  move(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.touchMove(e)) return;
    const prev = this.pointer;
    this.pointer = this.local(e);
    const g = this.gesture;
    if (!g) return;
    const w = this.world(e);
    switch (g.kind) {
      case 'pan': {
        if (g.start && !g.moved) {
          if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < CanvasControl.SLOP) return;
          g.moved = true;
        }
        const v = this.ws.view();
        this.ws.setView({ zoom: v.zoom, pan: [v.pan[0] + this.pointer.x - prev.x, v.pan[1] + this.pointer.y - prev.y] });
        break;
      }
      case 'card': {
        if (!g.moved) {
          if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < (g.touch ? CanvasControl.SLOP : 4)) return;
          this.startCardDrag(g, e);
        }
        const pos = new Map<CardId, [number, number]>();
        for (const id of g.ids) {
          const o = g.offsets.get(id)!;
          pos.set(id, [w.x + o.x, w.y + o.y]);
        }
        const drop = this.dropAt(e.clientX, e.clientY, g.ids);
        this.ws.dropColumn.set(drop && drop !== 'unsorted' ? drop.column : null);
        this.ws.dropUnsorted.set(drop === 'unsorted');
        this.guides = [];
        const first = g.ids[0];
        const size = this.ws.rects().get(first);
        if (!drop && first !== undefined && size) {
          const p = pos.get(first)!;
          const others = [...this.ws.rects().entries()].filter(([id]) => !g.ids.includes(id) && this.ws.card(id)?.container === 'Canvas').map(([, r]) => r);
          const prefs = this.ws.prefs();
          const a = align(rect(p[0], p[1], size.w, size.h), others, 6 / this.ws.view().zoom, prefs.guides, prefs.snap_grid ? 8 : null);
          for (const [id, q] of pos) pos.set(id, [q[0] + a.dx, q[1] + a.dy]);
          this.guides = a.guides;
        }
        this.ws.moveTo(pos);
        this.ghost = this.overCanvas(e) ? null : { x: e.clientX, y: e.clientY, label: g.ids.length === 1 ? '1 card' : `${g.ids.length} cards` };
        break;
      }
      case 'band': {
        this.band = fromTwo(g.start, w);
        const hits = [...this.ws.rects().entries()].filter(([id, r]) => intersects(r, this.band!) && this.ws.card(id)?.container === 'Canvas').map(([id]) => id);
        this.ws.selected.set(new Set(g.additive ? [...g.base, ...hits] : hits));
        break;
      }
      case 'resize':
        this.ws.setWidth(g.id, g.width + (e.clientX - g.startX) / this.ws.view().zoom, false);
        break;
      case 'connect': {
        const anchors = this.ws.anchors();
        const src = anchors.get(g.from);
        const t = this.cardAt(w, [g.from]);
        this.hoverTarget = t;
        if (src) {
          const tr = t !== null ? anchors.get(t) : undefined;
          const ends = lineEnds({ rect: src, at: { x: src.x + src.w / 2, y: src.y + src.h / 2 } }, tr ? { rect: tr, at: { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 } } : { rect: null, at: w });
          this.connectLine = ends;
        }
        break;
      }
      case 'end':
        this.hoverTarget = this.cardAt(w);
        break;
      case 'line': {
        const dx = w.x - g.last.x;
        const dy = w.y - g.last.y;
        this.ws.editArrow(
          g.arrow,
          (a) => {
            if (a.from_pt) a.from_pt = [a.from_pt[0] + dx, a.from_pt[1] + dy];
            if (a.to_pt) a.to_pt = [a.to_pt[0] + dx, a.to_pt[1] + dy];
          },
          false,
        );
        g.last = w;
        break;
      }
      case 'tool': {
        if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 4) return;
        g.moved = true;
        this.ghost = { x: e.clientX, y: e.clientY, label: g.tool };
        const drop = this.overCanvas(e) || (e.target as HTMLElement).closest?.('.nb-drawer') ? this.dropAt(e.clientX, e.clientY, []) : null;
        this.ws.dropColumn.set(drop && drop !== 'unsorted' && g.tool !== 'Column' && g.tool !== 'Line' ? drop.column : null);
        this.ws.dropUnsorted.set(drop === 'unsorted');
        break;
      }
    }
    this.redraw();
  }

  private startCardDrag(g: Extract<Gesture, { kind: 'card' }>, e: PointerEvent): void {
    g.moved = true;
    const id = g.id;
    if (this.ws.editing() !== null && this.ws.editing() !== id) this.ws.stopEditing();
    if (!this.ws.selected().has(id)) this.ws.select(id);
    this.ws.selectedArrow.set(null);
    this.ws.popup.set(null);
    const v = this.ws.view();
    const startWorld = toWorld(v, this.local({ clientX: g.start.x, clientY: g.start.y }));
    const worldRects = new Map<CardId, Rect>();
    for (const sid of this.ws.selected()) {
      const c = this.ws.card(sid);
      if (!c || c.locked) continue;
      const el = document.querySelector<HTMLElement>(`nb-card-view[data-card="${sid}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const tl = this.world({ clientX: r.left, clientY: r.top });
      worldRects.set(sid, rect(tl.x, tl.y, r.width / v.zoom, r.height / v.zoom));
    }
    g.ids = [...worldRects.keys()];
    for (const [sid, r] of worldRects) g.offsets.set(sid, { x: r.x - startWorld.x, y: r.y - startWorld.y });
    this.ws.beginDrag(g.ids, worldRects);
    void e;
  }

  up(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.touchUp(e)) {
      this.redraw();
      return;
    }
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const w = this.world(e);
    switch (g.kind) {
      case 'card':
        if (!g.moved) {
          this.ws.select(g.id, e.shiftKey || e.ctrlKey || e.metaKey);
        } else {
          const drop = this.dropAt(e.clientX, e.clientY, g.ids);
          this.ws.endDrag(g.ids, drop);
        }
        break;
      case 'band':
        this.band = null;
        break;
      case 'connect':
        if (this.overCanvas(e)) {
          const t = this.cardAt(w, [g.from]);
          const src = this.ws.anchors().get(g.from);
          if (t !== null) this.ws.connect(g.from, t, w);
          else if (src && !contains(rect(src.x - 14, src.y - 14, src.w + 28, src.h + 28), w)) this.ws.connect(g.from, null, w);
        }
        this.connectLine = null;
        break;
      case 'end': {
        const ar = this.ws.board().arrows.find((a) => a.id === g.arrow);
        const other = ar ? (g.end === 0 ? ar.to : ar.from) : 0;
        this.ws.setArrowEnd(g.arrow, g.end, this.cardAt(w, [other]), w);
        break;
      }
      case 'tool':
        if (!g.moved) {
          const size = this.ws.defaultSize(g.tool);
          this.createTool(g.tool, { at: this.ws.freeSpot(size, this.canvasSize()) });
        } else {
          const drop = this.dropAt(e.clientX, e.clientY, []);
          if (drop === 'unsorted') this.createTool(g.tool, { unsorted: true });
          else if (drop && g.tool !== 'Column' && g.tool !== 'Line') this.createTool(g.tool, drop);
          else if (this.overCanvas(e)) this.createTool(g.tool, { at: { x: w.x, y: w.y + 10 } });
        }
        break;
      default:
        break;
    }
    this.guides = [];
    this.ghost = null;
    this.hoverTarget = null;
    this.ws.dropColumn.set(null);
    this.ws.dropUnsorted.set(false);
    this.redraw();
  }

  /** Tools that open a file chooser are handled by the shell; the rest create cards straight away. */
  createTool(tool: Tool, place: Parameters<Workspace['create']>[1]): void {
    if (tool === 'Add image' || tool === 'Upload') {
      this.onPickFile?.(tool, place);
      return;
    }
    if (UNAVAILABLE.includes(tool)) {
      this.ws.showToast(`${tool} isn't available in this version yet`);
      return;
    }
    this.ws.create(tool, place);
  }

  onPickFile?: (tool: Tool, place: Parameters<Workspace['create']>[1]) => void;

  dblclick(e: MouseEvent): void {
    if (this.recentTouch(e)) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-handle], .nb-float')) return;
    const cardEl = target.closest<HTMLElement>('nb-card-view');
    if (cardEl) {
      const c = this.ws.card(Number(cardEl.dataset['card']));
      if (!c) return;
      if (this.ws.editing() === c.id && isField(target)) return;
      if ('Board' in c.content) this.ws.openBoard(c.content.Board.board);
      else this.ws.edit(c.id);
      return;
    }
    if (!target.closest('.nb-canvas')) return;
    const w = this.world(e);
    if (this.arrowAt(w) !== null) return;
    this.ws.create('Note', { at: { x: w.x, y: w.y + 20 } });
  }

  contextmenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (isField(target)) return;
    if (this.recentTouch(e)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const shell = (this.canvasEl().closest('.nb-shell') as HTMLElement).getBoundingClientRect();
    const x = e.clientX - shell.left;
    const y = e.clientY - shell.top;
    const cardEl = target.closest<HTMLElement>('nb-card-view');
    if (cardEl) {
      const id = Number(cardEl.dataset['card']);
      if (!this.ws.selected().has(id)) this.ws.select(id);
      this.ws.menu.set({ x, y, target: { card: id } });
      return;
    }
    const w = this.world(e);
    const a = this.arrowAt(w);
    if (a !== null) {
      this.ws.selectArrow(a);
      this.ws.menu.set({ x, y, target: { arrow: a } });
    } else this.ws.menu.set({ x, y, target: { canvas: w } });
  }

  wheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest('.nb-float, .nb-drawer')) return;
    e.preventDefault();
    const p = this.local(e);
    const v = this.ws.view();
    if (e.ctrlKey || e.metaKey) this.ws.setView(zoomAt(v, p, Math.exp(-e.deltaY * 0.0022)));
    else this.ws.setView({ zoom: v.zoom, pan: [v.pan[0] - e.deltaX, v.pan[1] - e.deltaY] });
  }

  // ---------- keyboard ----------

  key(e: KeyboardEvent): void {
    const ws = this.ws;
    const cmd = e.ctrlKey || e.metaKey;
    const field = isField(e.target);
    if (e.key === ' ' && !field) this.space = e.type === 'keydown';
    if (e.type !== 'keydown') return;
    if (e.key === 'Escape') {
      if (ws.settingsOpen()) ws.settingsOpen.set(false);
      else if (ws.editing() !== null) ws.stopEditing();
      else if (ws.menu()) ws.menu.set(null);
      else if (ws.popup()) ws.popup.set(null);
      else if (ws.showTrash()) ws.showTrash.set(false);
      else ws.clearSelection();
      if (field) (e.target as HTMLElement).blur();
      return;
    }
    if (cmd && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      ws.toggleTheme();
      return;
    }
    if (cmd && e.shiftKey && (e.code === 'Comma' || e.code === 'Period')) {
      e.preventDefault();
      ws.setScale(ws.prefs().scale + (e.code === 'Comma' ? -1 : 1));
      return;
    }
    if (cmd && e.code === 'KeyF') {
      e.preventDefault();
      ws.popup.set({ kind: 'search' });
      return;
    }
    if (field || ws.settingsOpen()) return;
    const size = this.canvasSize();
    const center = { x: size.x / 2, y: size.y / 2 };
    switch (true) {
      case e.key === 'Delete' || e.key === 'Backspace':
        ws.deleteSelection();
        break;
      case cmd && e.code === 'KeyZ' && e.shiftKey:
      case cmd && e.code === 'KeyY':
        ws.redo();
        break;
      case cmd && e.code === 'KeyZ':
        ws.undo();
        break;
      case cmd && e.code === 'KeyD':
        ws.duplicate();
        break;
      case cmd && e.code === 'KeyA':
        ws.selected.set(new Set(ws.board().cards.filter((c) => c.container === 'Canvas').map((c) => c.id)));
        break;
      case e.key === 'Enter' && ws.selected().size === 1:
        ws.edit([...ws.selected()][0]);
        break;
      case cmd && e.code === 'Digit0':
        ws.setView(zoomAt(ws.view(), center, 1 / ws.view().zoom));
        break;
      case cmd && (e.code === 'Equal' || e.code === 'NumpadAdd'):
        ws.setView(zoomAt(ws.view(), center, 1.2));
        break;
      case cmd && (e.code === 'Minus' || e.code === 'NumpadSubtract'):
        ws.setView(zoomAt(ws.view(), center, 1 / 1.2));
        break;
      case !cmd && !e.altKey && e.code === 'KeyN':
        ws.create('Note', { at: ws.freeSpot(ws.defaultSize('Note'), size) });
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  pasteAt(): Pt {
    const s = this.canvasSize();
    const p = this.pointer;
    return p.x > 0 && p.y > 0 && p.x < s.x && p.y < s.y ? this.pointerWorld() : this.ws.freeSpot({ x: 300, y: 80 }, s);
  }

  /** Measure where every card is on the board (in board units) after the page has laid them out. */
  measure(world: HTMLElement): void {
    const v = this.ws.view();
    const wr = world.getBoundingClientRect();
    const rects = new Map<CardId, Rect>();
    const anchors = new Map<CardId, Rect>();
    world.querySelectorAll<HTMLElement>('nb-card-view').forEach((el) => {
      const id = Number(el.dataset['card']);
      const r = el.getBoundingClientRect();
      const box = rect((r.left - wr.left) / v.zoom, (r.top - wr.top) / v.zoom, r.width / v.zoom, r.height / v.zoom);
      rects.set(id, box);
      const sq = el.querySelector(':scope > .nb-board-square');
      if (sq) {
        const s = sq.getBoundingClientRect();
        anchors.set(id, rect((s.left - wr.left) / v.zoom, (s.top - wr.top) / v.zoom, BOARD_ICON, BOARD_ICON));
      } else anchors.set(id, box);
    });
    const same = (a: ReadonlyMap<CardId, Rect>, b: Map<CardId, Rect>) =>
      a.size === b.size && [...b].every(([k, r]) => {
        const o = a.get(k);
        return o && Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.w - r.w) < 0.5 && Math.abs(o.h - r.h) < 0.5;
      });
    if (!same(this.ws.rects(), rects)) this.ws.rects.set(rects);
    if (!same(this.ws.anchors(), anchors)) this.ws.anchors.set(anchors);
  }

  /** Cards on the canvas in drawing order. */
  static canvasCards(cards: Card[]): Card[] {
    return cards.filter((c) => c.container === 'Canvas').sort((a, b) => a.z - b.z);
  }
}
