/**
 * The server's size limits for card content (see check.ts), applied on the client: text is cut to
 * fit, lists keep their first items. Used after merges, on import and right before saving, so one
 * oversized card can never make the server refuse every later save of the boards.
 */
import type { Card, Content, Store } from './types';

export const LIMITS = {
  headingText: 2000,
  colorName: 200,
  docTitle: 500,
  docText: 1_000_000,
  sketchStrokes: 5000,
  sketchNumbers: 400_000,
  mediaTitle: 500,
  videoUrl: 2000,
  mapText: 500,
  commentEntries: 2000,
  commentText: 20_000,
  author: 200,
  tableTitle: 500,
  tableRows: 500,
  tableCols: 100,
  tableCell: 10_000,
} as const;

/** Cuts a text to `n` characters; records that something changed. */
function fitText(o: Record<string, unknown>, key: string, n: number, changed: { v: boolean }): void {
  const s = o[key];
  if (typeof s !== 'string') {
    o[key] = '';
    changed.v = true;
  } else if (s.length > n) {
    o[key] = s.slice(0, n);
    changed.v = true;
  }
}

/** Fits one card's content to the limits in place. Returns true if anything was cut. Fast for the kinds without limits. */
export function clampContent(content: Content): boolean {
  const ch = { v: false };
  if ('Heading' in content) fitText(content.Heading, 'text', LIMITS.headingText, ch);
  else if ('Color' in content) fitText(content.Color, 'name', LIMITS.colorName, ch);
  else if ('Document' in content) {
    fitText(content.Document, 'title', LIMITS.docTitle, ch);
    fitText(content.Document, 'text', LIMITS.docText, ch);
  } else if ('Sketch' in content) {
    const strokes = content.Sketch.strokes;
    let n = 0;
    let keep = Math.min(strokes.length, LIMITS.sketchStrokes);
    for (let i = 0; i < keep; i++) {
      n += strokes[i].points.length;
      if (n > LIMITS.sketchNumbers) keep = i;
    }
    if (keep < strokes.length) {
      content.Sketch.strokes = strokes.slice(0, keep);
      ch.v = true;
    }
  } else if ('Audio' in content) fitText(content.Audio, 'title', LIMITS.mediaTitle, ch);
  else if ('Video' in content) {
    fitText(content.Video, 'title', LIMITS.mediaTitle, ch);
    if (content.Video.url.length > LIMITS.videoUrl) {
      content.Video.url = '';
      ch.v = true;
    }
  } else if ('Map' in content) {
    fitText(content.Map, 'label', LIMITS.mapText, ch);
    fitText(content.Map, 'query', LIMITS.mapText, ch);
  } else if ('Comment' in content) {
    if (content.Comment.entries.length > LIMITS.commentEntries) {
      content.Comment.entries = content.Comment.entries.slice(-LIMITS.commentEntries);
      ch.v = true;
    }
    for (const e of content.Comment.entries) {
      fitText(e as unknown as Record<string, unknown>, 'text', LIMITS.commentText, ch);
      fitText(e as unknown as Record<string, unknown>, 'author', LIMITS.author, ch);
    }
  } else if ('Table' in content) {
    const t = content.Table;
    fitText(t, 'title', LIMITS.tableTitle, ch);
    if (t.cells.length > LIMITS.tableRows) {
      t.cells = t.cells.slice(0, LIMITS.tableRows);
      ch.v = true;
    }
    for (let r = 0; r < t.cells.length; r++) {
      if (t.cells[r].length > LIMITS.tableCols) {
        t.cells[r] = t.cells[r].slice(0, LIMITS.tableCols);
        ch.v = true;
      }
      for (let c = 0; c < t.cells[r].length; c++)
        if (typeof t.cells[r][c] !== 'string' || t.cells[r][c].length > LIMITS.tableCell) {
          t.cells[r][c] = typeof t.cells[r][c] === 'string' ? t.cells[r][c].slice(0, LIMITS.tableCell) : '';
          ch.v = true;
        }
    }
  }
  return ch.v;
}

/** Fits every card (boards and trash) to the limits in place. Returns how many cards were cut. */
export function clampStore(s: Store): number {
  let n = 0;
  const each = (cards: Card[]) => cards.forEach((c) => clampContent(c.content) && n++);
  for (const b of Object.values(s.boards)) each(b.cards);
  for (const t of s.trash) each(t.cards);
  return n;
}
