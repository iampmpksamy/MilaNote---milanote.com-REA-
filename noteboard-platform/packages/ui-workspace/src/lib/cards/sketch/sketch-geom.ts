/**
 * Geometry shared by the sketch card, its editor and the board's draw mode: pen settings, point
 * thinning, smooth SVG paths, the eraser's hit test and turning board strokes into a sketch card.
 *
 * A sketch's own space is x 0–1000 across its width and y 0–1000·aspect down.
 */
import type { Stroke } from '@noteboard/board-model';

/** Pen colours (name, #rrggbb). The first one is the default ink. */
export const SKETCH_COLORS: readonly [string, string][] = [
  ['Black', '#202124'],
  ['White', '#ffffff'],
  ['Red', '#e0443a'],
  ['Orange', '#f08a1c'],
  ['Yellow', '#f4cc2c'],
  ['Green', '#2f9d5c'],
  ['Blue', '#3a6fe0'],
  ['Purple', '#8a55d6'],
];
export const DEFAULT_INK = SKETCH_COLORS[0][1];
export const WIDTH_NAMES = ['Thin', 'Medium', 'Thick'] as const;
export type WidthIndex = 0 | 1 | 2;
/** Pen widths in the sketch's 0–1000 space (sketch editor). */
export const SKETCH_WIDTHS = [5, 12, 26];
/** Pen widths in screen pixels (drawing on the board; divided by the zoom). */
export const DRAW_WIDTHS = [2, 4, 8];
/** Marker (highlighter) strokes are this much wider than the pen and drawn see-through. */
export const MARKER_SCALE = 3;
export const MARKER_OPACITY = 0.4;
/** The server's limits for one sketch. */
export const MAX_STROKES = 5000;
export const MAX_NUMBERS = 400_000;
/** Points closer than this (in the sketch's space) to the previous one are dropped. */
export const MIN_STEP = 1.5;

export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Adds a point (rounded to 0.1) unless it is closer than `min` to the last one. True when added. */
export function pushPoint(points: number[], x: number, y: number, min = MIN_STEP): boolean {
  const rx = round1(x);
  const ry = round1(y);
  const n = points.length;
  if (n >= 2 && Math.hypot(rx - points[n - 2], ry - points[n - 1]) < Math.max(min, 0.05)) return false;
  points.push(rx, ry);
  return true;
}

/** The same line with fewer points: rounded to 0.1, near neighbours dropped, the last point kept. */
export function thin(points: number[], min = MIN_STEP): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pushPoint(out, points[i], points[i + 1], min);
  const n = points.length;
  if (n >= 4 && out.length >= 2) {
    const lx = round1(points[n - 2]);
    const ly = round1(points[n - 1]);
    if (out[out.length - 2] !== lx || out[out.length - 1] !== ly) {
      // the true end replaces a kept point very close to it (never the first point)
      if (out.length >= 4 && Math.hypot(lx - out[out.length - 2], ly - out[out.length - 1]) < min) out.splice(out.length - 2, 2);
      out.push(lx, ly);
    }
  }
  return out;
}

export function countNumbers(strokes: readonly Stroke[]): number {
  let n = 0;
  for (const s of strokes) n += s.points.length;
  return n;
}

const fmt = (v: number) => String(round1(v));

/** A smooth SVG path through the points: quadratic curves between the midpoints. */
export function smoothPath(p: readonly number[]): string {
  const n = p.length >> 1;
  if (n === 0) return '';
  if (n === 1) return `M${fmt(p[0])} ${fmt(p[1])}l0.01 0`;
  if (n === 2) return `M${fmt(p[0])} ${fmt(p[1])}L${fmt(p[2])} ${fmt(p[3])}`;
  let d = `M${fmt(p[0])} ${fmt(p[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i];
    const y = p[2 * i + 1];
    d += `Q${fmt(x)} ${fmt(y)} ${fmt((x + p[2 * i + 2]) / 2)} ${fmt((y + p[2 * i + 3]) / 2)}`;
  }
  return d + `L${fmt(p[2 * n - 2])} ${fmt(p[2 * n - 1])}`;
}

/** Finished strokes never change, so their paths are worked out once. */
const pathCache = new WeakMap<Stroke, string>();
export function strokePath(s: Stroke, cache = true): string {
  if (!cache) return smoothPath(s.points);
  let d = pathCache.get(s);
  if (d === undefined) {
    d = smoothPath(s.points);
    pathCache.set(s, d);
  }
  return d;
}

/** Black ink on a see-through sketch would vanish on the dark board, so it is drawn light there. */
export function inkColor(color: string, dark: boolean, paper: boolean): string {
  return dark && !paper && color.toLowerCase() === DEFAULT_INK ? '#e6e6e6' : color;
}

/** What the template draws for one stroke. */
export interface InkPath {
  d: string;
  color: string;
  width: number;
  opacity: number | null;
}
export function inkPath(s: Stroke, dark: boolean, paper: boolean, cache = true): InkPath {
  return { d: strokePath(s, cache), color: inkColor(s.color, dark, paper), width: s.width, opacity: s.marker ? MARKER_OPACITY : null };
}

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a circle of radius `r` at (x, y) touch the stroke? */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const p = s.points;
  const reach = r + s.width / 2;
  if (p.length < 2) return false;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) if (distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  return false;
}

/** The strokes the eraser misses when it moves from (x0, y0) to (x1, y1); the same array when none was hit. */
export function eraseAlong(strokes: Stroke[], x0: number, y0: number, x1: number, y1: number, r: number): Stroke[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 2)));
  const kept = strokes.filter((s) => {
    for (let i = 0; i <= steps; i++) if (strokeHit(s, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r)) return false;
    return true;
  });
  return kept.length === strokes.length ? strokes : kept;
}

/** A sketch card made from strokes drawn on the board (board coordinates). */
export interface PlacedSketch {
  pos: [number, number];
  width: number;
  aspect: number;
  strokes: Stroke[];
}

/**
 * Groups strokes drawn on the board into one sketch placed at their bounding box (plus `pad` on
 * every side), with the points moved into the card's own 0–1000 space.
 */
export function strokesToCard(world: readonly Stroke[], pad = 8, minSize = 24): PlacedSketch | null {
  const drawn = world.filter((s) => s.points.length >= 2);
  if (!drawn.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of drawn) {
    const h = s.width / 2;
    for (let i = 0; i + 1 < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i] - h);
      maxX = Math.max(maxX, s.points[i] + h);
      minY = Math.min(minY, s.points[i + 1] - h);
      maxY = Math.max(maxY, s.points[i + 1] + h);
    }
  }
  const w = Math.max(minSize, Math.round(maxX - minX + 2 * pad));
  const hgt = Math.max(minSize, Math.round(maxY - minY + 2 * pad));
  const left = Math.round((minX + maxX) / 2 - w / 2);
  const top = Math.round((minY + maxY) / 2 - hgt / 2);
  const k = 1000 / w;
  const strokes = drawn.map((s) => {
    const pts = s.points.map((v, i) => (i % 2 ? (v - top) * k : (v - left) * k));
    const out: Stroke = { color: s.color, width: Math.max(0.5, round1(s.width * k)), points: pts.length === 2 ? [round1(pts[0]), round1(pts[1])] : thin(pts) };
    if (s.marker) out.marker = true;
    return out;
  });
  return { pos: [left, top], width: w, aspect: Math.round((hgt / w) * 10000) / 10000, strokes };
}
