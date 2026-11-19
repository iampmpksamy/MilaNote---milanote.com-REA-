/**
 * Canvas geometry shared by every client: view transform, line ends, hit tests, alignment guides
 * and free-spot placement. Pure functions on plain numbers, ported from the desktop app.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
/** How far a line stops short of the card it points at. */
export const LINE_GAP = 7;
export const BOARD_ICON = 72;
export const COL_HEADER = 44;
export const COL_PAD = 10;
export const COL_GAP = 8;

export const pt = (x: number, y: number): Pt => ({ x, y });
export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const expand = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const contains = (r: Rect, p: Pt): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const intersects = (a: Rect, b: Rect): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const fromTwo = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/** The board view: screen = world * zoom + pan (relative to the canvas' top-left). */
export interface View {
  pan: [number, number];
  zoom: number;
}

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.zoom + v.pan[0], y: p.y * v.zoom + v.pan[1] });
export const toWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.pan[0]) / v.zoom, y: (p.y - v.pan[1]) / v.zoom });

/** Zoom by `factor` keeping the world point under `p` (canvas coordinates) still. */
export function zoomAt(v: View, p: Pt, factor: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const w = toWorld(v, p);
  return { zoom, pan: [p.x - w.x * zoom, p.y - w.y * zoom] };
}

/** A view that shows all of `bounds` inside a canvas of `size`. */
export function fitView(bounds: Rect, size: Pt, maxZoom = 1.25): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((size.x - 120) / Math.max(bounds.w, 1), (size.y - 120) / Math.max(bounds.h, 1), maxZoom)));
  const c = center(bounds);
  return { zoom, pan: [size.x / 2 - c.x * zoom, size.y / 2 - c.y * zoom] };
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Where a line from the middle of `r` toward `toward` leaves the rectangle. */
export function edgePoint(r: Rect, toward: Pt): Pt {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx * dx + dy * dy < 1e-6) return c;
  const tx = Math.abs(dx) > 1e-6 ? r.w / 2 / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? r.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** One end of a line: the card shape it's attached to (or none) and the point it aims from. */
export interface LineEnd {
  rect: Rect | null;
  at: Pt;
}

/** The visible ends of a line, or null when it can't be drawn (the ends overlap). */
export function lineEnds(a: LineEnd, b: LineEnd): [Pt, Pt] | null {
  if (a.rect && contains(expand(a.rect, 2), b.at)) return null;
  if (b.rect && contains(expand(b.rect, 2), a.at)) return null;
  const p1 = a.rect ? edgePoint(expand(a.rect, LINE_GAP), b.at) : a.at;
  const p2 = b.rect ? edgePoint(expand(b.rect, LINE_GAP), a.at) : b.at;
  return [p1, p2];
}

export function lineWidth(weight: number): number {
  return weight <= 1 ? 1.6 : weight === 2 ? 2.6 : 4;
}

/** Arrowhead triangle at `tip` pointing along a→tip. */
export function arrowHead(from: Pt, tip: Pt, weight: number): Pt[] {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const dx = (tip.x - from.x) / len;
  const dy = (tip.y - from.y) / len;
  const size = 8 + 2 * lineWidth(weight);
  const px = -dy;
  const py = dx;
  return [tip, { x: tip.x - dx * size + px * size * 0.45, y: tip.y - dy * size + py * size * 0.45 }, { x: tip.x - dx * size - px * size * 0.45, y: tip.y - dy * size - py * size * 0.45 }];
}

export interface AlignResult {
  dx: number;
  dy: number;
  guides: [Pt, Pt][];
}

/** Line a dragged rectangle up with its neighbours' edges or centres (within `tol`), else snap to a grid. */
export function align(r: Rect, others: Rect[], tol: number, guidesOn: boolean, grid: number | null): AlignResult {
  let bx: { d: number; v: number; o: Rect } | null = null;
  let by: { d: number; v: number; o: Rect } | null = null;
  if (guidesOn) {
    for (const o of others) {
      for (const xs of [r.x, r.x + r.w / 2, r.x + r.w]) {
        for (const xo of [o.x, o.x + o.w / 2, o.x + o.w]) {
          const d = xo - xs;
          if (Math.abs(d) < tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: xo, o };
        }
      }
      for (const ys of [r.y, r.y + r.h / 2, r.y + r.h]) {
        for (const yo of [o.y, o.y + o.h / 2, o.y + o.h]) {
          const d = yo - ys;
          if (Math.abs(d) < tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v: yo, o };
        }
      }
    }
  }
  const snap = (v: number) => (grid ? Math.round(v / grid) * grid - v : 0);
  const guides: [Pt, Pt][] = [];
  const dx = bx ? bx.d : snap(r.x);
  if (bx) guides.push([pt(bx.v, Math.min(r.y, bx.o.y) - 8), pt(bx.v, Math.max(r.y + r.h, bx.o.y + bx.o.h) + 8)]);
  const dy = by ? by.d : snap(r.y);
  if (by) guides.push([pt(Math.min(r.x + dx, by.o.x) - 8, by.v), pt(Math.max(r.x + dx + r.w, by.o.x + by.o.w) + 8, by.v)]);
  return { dx, dy, guides };
}

/** A spot near `c` where a card of `size` doesn't cover any of `taken` (searching outward in rings). */
export function freeSpot(c: Pt, size: Pt, taken: Rect[]): Pt {
  const busy = (p: Pt) => {
    const r = expand(rect(p.x - size.x / 2, p.y - size.y / 2, size.x, size.y), 12);
    return taken.some((o) => intersects(o, r));
  };
  if (!busy(c)) return c;
  for (let ring = 1; ring < 14; ring++) {
    const d = ring * 40;
    for (let k = 0; k < ring * 8; k++) {
      const a = (k / (ring * 8)) * Math.PI * 2;
      const p = pt(c.x + Math.cos(a) * d * 1.6, c.y + Math.sin(a) * d);
      if (!busy(p)) return p;
    }
  }
  return c;
}
