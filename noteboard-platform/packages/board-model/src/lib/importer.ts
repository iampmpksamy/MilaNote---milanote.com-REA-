/**
 * Importer for the Rust desktop app's boards.json (format 1 or 2).
 *
 * `validateDesktopFile` never changes anything: it reads the file, fills in fields older versions
 * didn't have, checks every reference, and reports what would be imported (a dry run).
 * `importDesktopStore` then adds the whole desktop "Home" as a new board inside the target, keeping
 * the board hierarchy, positions, sizes, formatting, task states, columns, lines, colours, symbols
 * and the trash. Ids are mapped deterministically (old id + offset), and the same file can't be
 * imported twice (its fingerprint is remembered).
 */
import { migrate, newId } from './ops';
import { Arrow, Board, Card, CardId, Content, STORE_VERSION, Store, TodoItem, isColumnContainer } from './types';

export interface ImportIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface ImportReport {
  ok: boolean;
  fingerprint: string;
  sourceVersion: number;
  boards: number;
  cards: number;
  byKind: Record<string, number>;
  arrows: number;
  trash: number;
  images: string[];
  missingImages: string[];
  issues: ImportIssue[];
  alreadyImported: boolean;
  /** The normalised store, ready to import (absent when there are errors). */
  store?: Store;
}

export interface ImportRecord {
  fingerprint: string;
  at: number;
  board: number;
  idOffset: number;
}

/** Stores keep a note of what was imported, so the same file isn't imported twice. */
export type StoreWithImports = Store & { imports?: ImportRecord[] };

/** FNV-1a over the text: stable, fast, good enough to spot the same file again. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 ? [num(v[0]), num(v[1])] : null);

function normContent(raw: unknown, issues: ImportIssue[], where: string): Content | null {
  if (!isObj(raw)) {
    issues.push({ level: 'error', message: `${where}: card has no content` });
    return null;
  }
  const [kind] = Object.keys(raw);
  const v = raw[kind];
  const o = isObj(v) ? v : {};
  switch (kind) {
    case 'Note':
      return { Note: { text: str(o['text']) } };
    case 'Todo': {
      const items: TodoItem[] = Array.isArray(o['items']) ? o['items'].map((i) => ({ text: str(isObj(i) ? i['text'] : ''), done: isObj(i) && i['done'] === true })) : [];
      return { Todo: { title: str(o['title']), items } };
    }
    case 'Link':
      return { Link: { url: str(o['url']), title: str(o['title']) } };
    case 'Image':
      return { Image: { file: str(o['file']), caption: str(o['caption']), aspect: num(o['aspect'], 0.75) } };
    case 'Board':
      return { Board: { board: num(o['board']) } };
    case 'Column':
      return { Column: { title: str(o['title']), children: Array.isArray(o['children']) ? o['children'].map((c) => num(c)) : [] } };
    default:
      issues.push({ level: 'error', message: `${where}: unknown card type "${kind}"` });
      return null;
  }
}

function normCard(raw: unknown, issues: ImportIssue[], where: string): Card | null {
  if (!isObj(raw)) return null;
  const content = normContent(raw['content'], issues, where);
  if (!content) return null;
  const c = raw['container'];
  const container = c === 'Unsorted' ? 'Unsorted' : isObj(c) && 'Column' in c ? { Column: num(c['Column']) } : 'Canvas';
  return {
    id: num(raw['id']),
    pos: pair(raw['pos']) ?? [0, 0],
    width: num(raw['width'], 240),
    color: num(raw['color']),
    z: num(raw['z']),
    container,
    locked: raw['locked'] === true,
    align: num(raw['align']),
    content,
  };
}

function normArrow(raw: unknown): Arrow | null {
  if (!isObj(raw)) return null;
  return {
    id: num(raw['id']),
    from: num(raw['from']),
    to: num(raw['to']),
    color: num(raw['color']),
    dashed: raw['dashed'] === true,
    head: raw['head'] !== false,
    head_start: raw['head_start'] === true,
    weight: num(raw['weight'], 1) || 1,
    label: str(raw['label']),
    from_pt: pair(raw['from_pt']),
    to_pt: pair(raw['to_pt']),
  };
}

/** Read and check a desktop boards.json without changing anything. */
export function validateDesktopFile(text: string, target?: StoreWithImports, availableImages?: Set<string>): ImportReport {
  const issues: ImportIssue[] = [];
  const fp = fingerprint(text);
  const report: ImportReport = {
    ok: false,
    fingerprint: fp,
    sourceVersion: 0,
    boards: 0,
    cards: 0,
    byKind: {},
    arrows: 0,
    trash: 0,
    images: [],
    missingImages: [],
    issues,
    alreadyImported: !!target?.imports?.some((r) => r.fingerprint === fp),
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    issues.push({ level: 'error', message: `Not a readable boards file: ${(e as Error).message}` });
    return report;
  }
  if (!isObj(raw) || !isObj(raw['boards'])) {
    issues.push({ level: 'error', message: 'This file has no boards in it.' });
    return report;
  }
  report.sourceVersion = num(raw['version']);
  if (report.sourceVersion > STORE_VERSION) issues.push({ level: 'error', message: `Made by a newer version (format ${report.sourceVersion}).` });
  const boards: Record<string, Board> = {};
  for (const [key, b] of Object.entries(raw['boards'])) {
    if (!isObj(b)) continue;
    const id = num(b['id'], Number(key));
    const cards = (Array.isArray(b['cards']) ? b['cards'] : []).map((c, i) => normCard(c, issues, `board ${id} card ${i}`)).filter((c): c is Card => !!c);
    boards[String(id)] = {
      id,
      name: str(b['name'], 'Board'),
      parent: b['parent'] === null || b['parent'] === undefined ? null : num(b['parent']),
      color: num(b['color']),
      icon: typeof b['icon'] === 'string' ? b['icon'] : null,
      cards,
      arrows: (Array.isArray(b['arrows']) ? b['arrows'] : []).map(normArrow).filter((a): a is Arrow => !!a),
      unsorted: Array.isArray(b['unsorted']) ? b['unsorted'].map((x) => num(x)) : [],
      pan: pair(b['pan']) ?? [60, 40],
      zoom: num(b['zoom'], 1) || 1,
    };
  }
  const store: Store = {
    boards,
    root: num(raw['root'], 1),
    next_id: num(raw['next_id']),
    trash: (Array.isArray(raw['trash']) ? raw['trash'] : []).filter(isObj).map((t) => ({
      id: num(t['id']),
      board: num(t['board']),
      cards: (Array.isArray(t['cards']) ? t['cards'] : []).map((c, i) => normCard(c, issues, `trash card ${i}`)).filter((c): c is Card => !!c),
      arrows: (Array.isArray(t['arrows']) ? t['arrows'] : []).map(normArrow).filter((a): a is Arrow => !!a),
      deleted_at: num(t['deleted_at']),
    })),
    version: report.sourceVersion,
  };
  if (!boards[String(store.root)]) issues.push({ level: 'error', message: 'The Home board is missing.' });

  // References
  let maxId = store.root;
  for (const b of Object.values(boards)) {
    maxId = Math.max(maxId, b.id);
    if (b.parent !== null && !boards[String(b.parent)]) issues.push({ level: 'warning', message: `Board "${b.name}" points to a missing parent; it will sit under the imported Home.` });
    const ids = new Set(b.cards.map((c) => c.id));
    for (const c of b.cards) {
      maxId = Math.max(maxId, c.id);
      report.byKind[Object.keys(c.content)[0]] = (report.byKind[Object.keys(c.content)[0]] ?? 0) + 1;
      if ('Board' in c.content && !boards[String(c.content.Board.board)]) issues.push({ level: 'warning', message: `A board card in "${b.name}" points to a missing board; it will open an empty one.` });
      if ('Image' in c.content) report.images.push(c.content.Image.file);
      if ('Column' in c.content) {
        const missing = c.content.Column.children.filter((k) => !ids.has(k));
        if (missing.length) issues.push({ level: 'warning', message: `A column in "${b.name}" lists ${missing.length} card(s) that aren't there; they're skipped.` });
        c.content.Column.children = c.content.Column.children.filter((k) => ids.has(k));
      }
      if (isColumnContainer(c.container) && !ids.has(c.container.Column)) {
        issues.push({ level: 'warning', message: `A card in "${b.name}" belonged to a missing column; it goes on the board.` });
        c.container = 'Canvas';
      }
    }
    for (const a of b.arrows) {
      maxId = Math.max(maxId, a.id);
      if ((a.from !== 0 && !ids.has(a.from)) || (a.to !== 0 && !ids.has(a.to))) issues.push({ level: 'warning', message: `A line in "${b.name}" points to a missing card; it's dropped.` });
    }
    b.arrows = b.arrows.filter((a) => (a.from === 0 || ids.has(a.from)) && (a.to === 0 || ids.has(a.to)));
    b.unsorted = b.unsorted.filter((k) => ids.has(k));
  }
  for (const t of store.trash) {
    maxId = Math.max(maxId, t.id, ...t.cards.map((c) => c.id));
    for (const c of t.cards) if ('Image' in c.content) report.images.push(c.content.Image.file);
  }
  store.next_id = Math.max(store.next_id, maxId);
  migrate(store);

  report.boards = Object.keys(boards).length;
  report.cards = Object.values(boards).reduce((n, b) => n + b.cards.length, 0);
  report.arrows = Object.values(boards).reduce((n, b) => n + b.arrows.length, 0);
  report.trash = store.trash.length;
  if (availableImages) report.missingImages = report.images.filter((f) => !availableImages.has(f));
  if (report.missingImages.length) issues.push({ level: 'warning', message: `${report.missingImages.length} picture file(s) weren't supplied; those cards will say "Picture not found".` });
  if (report.alreadyImported) issues.push({ level: 'error', message: 'This exact file was already imported.' });
  report.ok = !issues.some((i) => i.level === 'error');
  if (report.ok) report.store = store;
  return report;
}

/**
 * Add a validated desktop store to `target` as a new board under the target's Home.
 * Returns the new board's id. The source store isn't changed.
 */
export function importDesktopStore(target: StoreWithImports, report: ImportReport, title: string): number {
  if (!report.ok || !report.store) throw new Error('The import report has errors.');
  if (target.imports?.some((r) => r.fingerprint === report.fingerprint)) throw new Error('This file was already imported.');
  const src = structuredClone(report.store);
  const offset = target.next_id;
  const map = (id: number) => (id === 0 ? 0 : id + offset);
  const remapCard = (c: Card): Card => {
    const n = structuredClone(c);
    n.id = map(c.id);
    if (isColumnContainer(n.container)) n.container = { Column: map(n.container.Column) };
    if ('Board' in n.content) n.content = { Board: { board: map(n.content.Board.board) } };
    if ('Column' in n.content) n.content.Column.children = n.content.Column.children.map(map);
    return n;
  };
  const remapArrow = (a: Arrow): Arrow => ({ ...structuredClone(a), id: map(a.id), from: map(a.from), to: map(a.to) });
  const homeId = map(src.root);
  for (const b of Object.values(src.boards)) {
    const id = map(b.id);
    const parent = b.id === src.root ? target.root : b.parent !== null && src.boards[String(b.parent)] ? map(b.parent) : homeId;
    target.boards[String(id)] = {
      ...b,
      id,
      parent,
      name: b.id === src.root ? title : b.name,
      cards: b.cards.map(remapCard),
      arrows: b.arrows.map(remapArrow),
      unsorted: b.unsorted.map(map),
    };
  }
  for (const t of src.trash) {
    target.trash.push({ ...t, id: map(t.id), board: src.boards[String(t.board)] ? map(t.board) : homeId, cards: t.cards.map(remapCard), arrows: t.arrows.map(remapArrow) });
  }
  target.next_id = Math.max(target.next_id, src.next_id + offset);
  // A board card for the import on the target's Home, placed below what's there.
  const home = target.boards[String(target.root)];
  const bottom = home.cards.filter((c) => c.container === 'Canvas').reduce((m, c) => Math.max(m, c.pos[1] + 160), 0);
  const cardId = newId(target);
  const z = home.cards.reduce((m, c) => Math.max(m, c.z), 0) + 1;
  home.cards.push({ id: cardId, pos: [0, bottom + 40], width: 124, color: 0, z, container: 'Canvas', locked: false, align: 0, content: { Board: { board: homeId } } });
  target.imports = [...(target.imports ?? []), { fingerprint: report.fingerprint, at: Math.floor(Date.now() / 1000), board: homeId, idOffset: offset }];
  return homeId;
}

/** Card ids that the import will create, for a report: old id -> new id. */
export function idMapping(report: ImportReport, offset: number): Map<CardId, CardId> {
  const m = new Map<CardId, CardId>();
  for (const b of Object.values(report.store?.boards ?? {})) for (const c of b.cards) m.set(c.id, c.id + offset);
  return m;
}
