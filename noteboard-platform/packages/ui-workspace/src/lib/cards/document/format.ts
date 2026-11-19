/**
 * Text helpers for the Document card: the formatting toolbar (adds or removes the light markdown
 * the notes use around the selection), the word count, the plain excerpt shown on the board and
 * the preview. All pure functions, so they are easy to test.
 */
import { renderNote } from '@noteboard/board-model';

/** One replacement in the text, and where the selection goes afterwards (positions in the new text). */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

export type BlockKind = 'h1' | 'h2' | 'bullet' | 'number' | 'quote';

/** Applies a change to a text (what the textarea does when the change is inserted). */
export function applyChange(text: string, c: TextChange): string {
  return text.slice(0, c.from) + c.insert + text.slice(c.to);
}

/** Any block marker at the start of a line. */
const BLOCK = /^(#{1,3} |[-*] |\d+\. |> )/;
const BLOCK_OF: Record<BlockKind, RegExp> = {
  h1: /^# /,
  h2: /^## /,
  bullet: /^[-*] /,
  number: /^\d+\. /,
  quote: /^> /,
};

/** How many times `ch` repeats at the start (or end) of `s`. */
function runAt(s: string, ch: string, fromEnd: boolean): number {
  let n = 0;
  for (let i = fromEnd ? s.length - 1 : 0; fromEnd ? i >= 0 : i < s.length; fromEnd ? i-- : i++) {
    if (s[i] !== ch) break;
    n++;
  }
  return n;
}

/** True when a run of the mark's character has the mark in it (`*` is italic only alone or in `***`). */
function runHasMark(run: number, mark: string): boolean {
  return mark === '*' ? run === 1 || run >= 3 : run >= mark.length;
}

function isWrapped(core: string, mark: string): boolean {
  const ch = mark[0];
  if (core.length < mark.length * 2 + 1) return false;
  return runHasMark(runAt(core, ch, false), mark) && runHasMark(runAt(core, ch, true), mark);
}

/**
 * Bold (`**`), italic (`*`), strike (`~~`) …: wraps the selection in the mark, or removes it when the
 * selection already has it (inside or just around the selection). Spaces at the edges stay outside
 * the marks, and a selection over several lines is marked line by line (marks don't cross lines).
 */
export function toggleWrap(text: string, start: number, end: number, mark: string): TextChange {
  const m = mark.length;
  const sel = text.slice(start, end);
  if (start === end) return { from: start, to: end, insert: mark + mark, selStart: start + m, selEnd: start + m };
  if (!sel.includes('\n')) {
    // The marks are just outside the selection: take them away.
    const before = runAt(text.slice(0, start), mark[0], true);
    const after = runAt(text.slice(end), mark[0], false);
    if (sel.trim() === sel && runHasMark(before, mark) && runHasMark(after, mark)) {
      return { from: start - m, to: end + m, insert: sel, selStart: start - m, selEnd: end - m };
    }
  }
  const parts = sel.split('\n').map((p) => {
    const lead = p.length - p.trimStart().length;
    const core = p.trim();
    return { head: p.slice(0, lead), core, tail: p.slice(lead + core.length) };
  });
  const filled = parts.filter((p) => p.core);
  const unwrap = filled.length > 0 && filled.every((p) => isWrapped(p.core, mark));
  const insert = parts
    .map((p) => {
      if (!p.core) return p.head + p.tail;
      const core = unwrap ? p.core.slice(m, -m) : isWrapped(p.core, mark) ? p.core : mark + p.core + mark;
      return p.head + core + p.tail;
    })
    .join('\n');
  return { from: start, to: end, insert, selStart: start, selEnd: start + insert.length };
}

/**
 * Headings, lists and quotes: puts the marker at the start of every line the selection touches,
 * replacing any other marker there, or removes it when all of those lines already have it.
 * Numbered lists are numbered 1, 2, 3 ….
 */
export function toggleBlock(text: string, start: number, end: number, kind: BlockKind): TextChange {
  const lastEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', lastEnd);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split('\n');
  const single = lines.length === 1;
  const used = lines.filter((l) => single || l.trim());
  const remove = used.length > 0 && used.every((l) => BLOCK_OF[kind].test(l));
  let n = 0;
  const out = lines.map((l) => {
    if (!single && !l.trim()) return l;
    const bare = l.replace(remove ? BLOCK_OF[kind] : BLOCK, '');
    if (remove) return bare;
    n++;
    const prefix = kind === 'h1' ? '# ' : kind === 'h2' ? '## ' : kind === 'bullet' ? '- ' : kind === 'quote' ? '> ' : `${n}. `;
    return prefix + bare;
  });
  const insert = out.join('\n');
  if (!single) return { from, to, insert, selStart: from, selEnd: from + insert.length };
  // One line: keep the cursor (or selection) on the same words.
  const oldPrefix = lines[0].length - (lines[0].replace(remove ? BLOCK_OF[kind] : BLOCK, '')).length;
  const newPrefix = insert.length - (lines[0].length - oldPrefix);
  const map = (p: number) => (p - from < oldPrefix ? from + newPrefix : p + newPrefix - oldPrefix);
  return { from, to, insert, selStart: map(start), selEnd: map(Math.max(start, lastEnd)) };
}

/**
 * Link: notes turn web addresses into links, so this makes sure the selection is one: a bare
 * domain gets `https://`, other text gets an address after it to type, and with nothing
 * selected `https://` is inserted. Returns null when the selection is already an address.
 */
export function insertLink(text: string, start: number, end: number): TextChange | null {
  const sel = text.slice(start, end);
  const core = sel.trim();
  if (/^https?:\/\/\S+$/i.test(core)) return null;
  if (core && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(core)) {
    const at = start + (sel.length - sel.trimStart().length);
    return { from: at, to: at, insert: 'https://', selStart: at, selEnd: at + 8 + core.length };
  }
  const space = start > 0 && !/\s/.test(text[start - 1]) ? ' ' : '';
  if (!core) {
    const insert = `${space}https://`;
    return { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length };
  }
  const insert = `${sel.trimEnd()} https://`;
  return { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/** Words in the text, not counting the formatting marks. */
export function wordCount(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    for (const w of line.replace(BLOCK, '').split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  }
  return n;
}

export function wordLabel(n: number): string {
  return n === 1 ? '1 word' : `${n.toLocaleString()} words`;
}

/** The start of the text as plain words (no marks, lines joined), for the card on the board. */
export function excerpt(text: string, max = 320): string {
  const out: string[] = [];
  let len = 0;
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(BLOCK, '')
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|[^\w*])\*(\S(?:[^*]*\S)?)\*/g, '$1$2')
      .trim();
    if (!line) continue;
    out.push(line);
    len += line.length + 1;
    if (len >= max) break;
  }
  const s = out.join(' ');
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/**
 * The preview: the notes' safe renderer, plus numbered lists (`1. `) gathered into a list.
 * renderNote escapes all text, so only its own tags are in the output that is changed here.
 */
export function renderDocument(text: string): string {
  return renderNote(text).replace(/(?:<p>\d+\. .*?<\/p>)+/g, (run) => {
    const items = [...run.matchAll(/<p>(\d+)\. (.*?)<\/p>/g)];
    const first = Number(items[0][1]);
    const start = first > 1 ? ` start="${first}"` : '';
    return `<ol${start}>${items.map((i) => `<li>${i[2]}</li>`).join('')}</ol>`;
  });
}
