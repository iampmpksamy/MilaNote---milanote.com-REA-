/**
 * Three-way merge of board stores, for offline editing and for two devices saving at once.
 *
 *   base   – the server's boards as this device last synced them
 *   local  – this device's boards now (edited offline, or while another device saved)
 *   remote – the server's boards now
 *
 * Every board, card, line and trash item is compared field by field against `base`: a field changed
 * on one side only takes that side's value; a field changed on both sides is a conflict:
 *
 *   - card content (note text, to-do, link, picture caption, heading, colour, document, table cell,
 *     media title, map place): the server's version stays, and this device's version is kept as a
 *     "Conflicting copy" card in Unsorted on the same board;
 *   - comments posted and strokes drawn on both devices are all kept (no conflict);
 *   - names and labels (board name, column title, line label): the server's stays, and this
 *     device's is kept as a "Conflicting copy" note in Unsorted (nothing typed is lost);
 *   - layout and style (position, size, colour, order, lock, container, line style): this device wins;
 *   - edited on one side, deleted for good on the other: the edited item comes back (a board that
 *     comes back also gets a way in: its board card is restored or added to Unsorted);
 *   - moved to the trash on one side, edited on the other: it stays in the trash with the edits;
 *   - moved to the trash on one side, deleted for good on the other: deleted (trashing isn't an edit).
 *
 * Ids: every board, card, line and trash item shares one counter (`next_id`). An id created on this
 * device that the server also uses now is renumbered, with every reference (columns, Unsorted,
 * lines, board cards, parents, trash) rewritten. Equal ids are never taken to mean "the same new
 * item": the app creates many identical default items. A save of this device that reached the
 * server although its answer was lost must therefore be passed as (part of) `base` — the sync
 * layer does that from the server's list of recent save ids.
 *
 * The result always satisfies the model's invariants (repairStore), so the server accepts it.
 */
import { type Arrow, type Board, type BoardId, type Card, type CardId, isColumnContainer, type Store, type TrashItem } from './types';

export interface MergeConflict {
  kind: 'content' | 'name' | 'edited-deleted' | 'deleted-edited' | 'misplaced';
  /** Board, card, line or trash item id (after renumbering). */
  id: number;
  what: 'board' | 'card' | 'line' | 'trash';
  note: string;
}

export interface MergeResult {
  store: Store;
  conflicts: MergeConflict[];
  /** Ids this device had created that were renumbered (old → new). */
  renumbered: Map<number, number>;
  /** True when the result differs from `remote` (something of this device's must be saved). */
  changed: boolean;
}

export interface MergeOptions {
  /** Shown in conflicting copies, e.g. "Android, 19 Nov 2026, 20:15". */
  label?: string;
}

type Home = { b: BoardId } | { t: number };
interface CardRec {
  card: Card;
  home: Home;
}
interface ArrowRec {
  arrow: Arrow;
  home: Home;
}
interface TrashRec {
  board: BoardId;
  deleted_at: number;
}
type BoardAttrs = Omit<Board, 'cards' | 'arrows' | 'unsorted'>;

/** JSON with object keys sorted, so equal values compare equal whatever order their keys were written in. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x,
  );
}
const j = canonical;
const same = (a: unknown, b: unknown) => j(a) === j(b);
const maxOf = (it: Iterable<number>, start = 0) => {
  let m = start;
  for (const x of it) if (x > m) m = x;
  return m;
};

// ---------- ids ----------

/** Every id used anywhere in a store (boards, cards, lines, trash items). */
export function allIds(s: Store): Set<number> {
  const ids = new Set<number>();
  for (const b of Object.values(s.boards)) {
    ids.add(b.id);
    for (const c of b.cards) ids.add(c.id);
    for (const a of b.arrows) ids.add(a.id);
  }
  for (const t of s.trash) {
    ids.add(t.id);
    for (const c of t.cards) ids.add(c.id);
    for (const a of t.arrows) ids.add(a.id);
  }
  return ids;
}

/** Ids referred to (parents, trash boards, columns, board cards, line ends), even if nothing has them now. */
function referencedIds(s: Store): Set<number> {
  const ids = new Set<number>();
  const card = (c: Card) => {
    if (isColumnContainer(c.container)) ids.add(c.container.Column);
    if ('Board' in c.content) ids.add(c.content.Board.board);
  };
  const arrow = (a: Arrow) => {
    if (a.from) ids.add(a.from);
    if (a.to) ids.add(a.to);
  };
  for (const b of Object.values(s.boards)) {
    if (b.parent !== null) ids.add(b.parent);
    b.cards.forEach(card);
    b.arrows.forEach(arrow);
  }
  for (const t of s.trash) {
    ids.add(t.board);
    t.cards.forEach(card);
    t.arrows.forEach(arrow);
  }
  return ids;
}

/** Rewrites ids in place (all references included). */
export function renumber(s: Store, map: Map<number, number>): void {
  if (!map.size) return;
  const m = (id: number) => map.get(id) ?? id;
  const card = (c: Card) => {
    c.id = m(c.id);
    if (isColumnContainer(c.container)) c.container = { Column: m(c.container.Column) };
    if ('Column' in c.content) c.content.Column.children = c.content.Column.children.map(m);
    if ('Board' in c.content) c.content.Board.board = m(c.content.Board.board);
  };
  const arrow = (a: Arrow) => {
    a.id = m(a.id);
    if (a.from) a.from = m(a.from);
    if (a.to) a.to = m(a.to);
  };
  const boards: Record<string, Board> = {};
  for (const b of Object.values(s.boards)) {
    b.id = m(b.id);
    if (b.parent !== null) b.parent = m(b.parent);
    b.cards.forEach(card);
    b.arrows.forEach(arrow);
    b.unsorted = b.unsorted.map(m);
    boards[String(b.id)] = b;
  }
  s.boards = boards;
  s.root = m(s.root);
  for (const t of s.trash) {
    t.id = m(t.id);
    t.board = m(t.board);
    t.cards.forEach(card);
    t.arrows.forEach(arrow);
  }
}

// ---------- indexing ----------

interface Index {
  boards: Map<number, BoardAttrs>;
  cards: Map<number, CardRec>;
  arrows: Map<number, ArrowRec>;
  trash: Map<number, TrashRec>;
  /** Card ids of each trash item, in that item's order (the first is the one restore places). */
  trashCards: Map<number, number[]>;
  unsorted: Map<number, CardId[]>;
  cardOrder: number[];
  arrowOrder: number[];
  trashOrder: number[];
  store: Store;
}

function index(s: Store): Index {
  const ix: Index = {
    boards: new Map(),
    cards: new Map(),
    arrows: new Map(),
    trash: new Map(),
    trashCards: new Map(),
    unsorted: new Map(),
    cardOrder: [],
    arrowOrder: [],
    trashOrder: [],
    store: s,
  };
  for (const b of Object.values(s.boards)) {
    const { cards: _c, arrows: _a, unsorted, ...attrs } = b;
    ix.boards.set(b.id, attrs);
    ix.unsorted.set(b.id, [...unsorted]);
    for (const c of b.cards)
      if (!ix.cards.has(c.id)) {
        ix.cards.set(c.id, { card: c, home: { b: b.id } });
        ix.cardOrder.push(c.id);
      }
    for (const a of b.arrows)
      if (!ix.arrows.has(a.id)) {
        ix.arrows.set(a.id, { arrow: a, home: { b: b.id } });
        ix.arrowOrder.push(a.id);
      }
  }
  for (const t of s.trash) {
    if (ix.trash.has(t.id)) continue;
    ix.trash.set(t.id, { board: t.board, deleted_at: t.deleted_at });
    ix.trashOrder.push(t.id);
    ix.trashCards.set(
      t.id,
      t.cards.map((c) => c.id),
    );
    for (const c of t.cards)
      if (!ix.cards.has(c.id)) {
        ix.cards.set(c.id, { card: c, home: { t: t.id } });
        ix.cardOrder.push(c.id);
      }
    for (const a of t.arrows)
      if (!ix.arrows.has(a.id)) {
        ix.arrows.set(a.id, { arrow: a, home: { t: t.id } });
        ix.arrowOrder.push(a.id);
      }
  }
  return ix;
}

// ---------- generic three-way helpers ----------

/** Field-level merge of two objects against a base. Returns the merged object and fields in conflict. */
function mergeFields<T extends object>(b: T, l: T, r: T, fields: (keyof T)[], prefer: 'local' | 'remote'): { out: T; conflicts: (keyof T)[] } {
  const out = { ...r };
  const conflicts: (keyof T)[] = [];
  for (const f of fields) {
    const lc = !same(l[f], b[f]);
    const rc = !same(r[f], b[f]);
    if (lc && !rc) out[f] = l[f];
    else if (lc && rc && !same(l[f], r[f])) {
      conflicts.push(f);
      if (prefer === 'local') out[f] = l[f];
    }
  }
  return { out, conflicts };
}

/**
 * Three-way merge of an ordered list: starts from the server's order, removes what this device
 * removed, and inserts what this device added after the item it followed here. Linear time.
 */
export function mergeList<T>(b: T[], l: T[], r: T[]): T[] {
  const key = (x: T) => (typeof x === 'number' || typeof x === 'string' ? `${typeof x}:${x}` : j(x));
  const inB = new Set(b.map(key));
  const lKeys = l.map(key);
  const inL = new Set(lKeys);
  // Linked list over the server's order (minus this device's removals).
  const next = new Map<string, string | null>();
  const val = new Map<string, T>();
  let head: string | null = null;
  let tail: string | null = null;
  for (const x of r) {
    const k = key(x);
    if ((inB.has(k) && !inL.has(k)) || val.has(k)) continue;
    val.set(k, x);
    next.set(k, null);
    if (tail === null) head = k;
    else next.set(tail, k);
    tail = k;
  }
  let prev: string | null = null;
  l.forEach((x, i) => {
    const k = lKeys[i];
    if (val.has(k)) {
      prev = k;
      return;
    }
    if (inB.has(k)) return; // removed on the server
    val.set(k, x);
    if (prev === null) {
      next.set(k, head);
      head = k;
    } else {
      next.set(k, next.get(prev) ?? null);
      next.set(prev, k);
    }
    if (tail === prev) tail = k;
    prev = k;
  });
  const out: T[] = [];
  for (let k = head; k !== null; k = next.get(k) ?? null) out.push(val.get(k) as T);
  return out;
}

// ---------- the merge ----------

const CARD_LAYOUT: (keyof Card)[] = ['pos', 'width', 'color', 'z', 'container', 'locked', 'align'];
const ARROW_STYLE: (keyof Arrow)[] = ['from', 'to', 'color', 'dashed', 'head', 'head_start', 'weight', 'from_pt', 'to_pt'];
const BOARD_STYLE: (keyof BoardAttrs)[] = ['parent', 'color', 'icon', 'pan', 'zoom'];

/** A card's own data, without where it lives: moving to the trash is not an edit of the card. */
const cardData = (c: CardRec) => c.card;
/** A board's own data, without the view (scrolling and zooming are not edits). */
const boardData = (a: BoardAttrs) => ({ name: a.name, parent: a.parent, color: a.color, icon: a.icon });
const inBoard = (h: Home): h is { b: BoardId } => 'b' in h;

/** Merges card content; returns the content to keep and whether this device's version lost a conflict. */
function mergeContent(b: Card['content'], l: Card['content'], r: Card['content']): { content: Card['content']; lost: 'card' | 'title' | null } {
  const kind = Object.keys(r)[0];
  if (Object.keys(b)[0] !== kind || Object.keys(l)[0] !== kind) {
    if (same(l, b)) return { content: r, lost: null };
    if (same(r, b)) return { content: l, lost: null };
    return { content: r, lost: same(l, r) ? null : 'card' };
  }
  const bv = (b as Record<string, Record<string, unknown>>)[kind];
  const lv = (l as Record<string, Record<string, unknown>>)[kind];
  const rv = (r as Record<string, Record<string, unknown>>)[kind];
  if (kind === 'Column') {
    const t = mergeFields(bv, lv, rv, ['title'], 'remote');
    const children = mergeList(bv['children'] as number[], lv['children'] as number[], rv['children'] as number[]);
    return { content: { Column: { title: t.out['title'] as string, children } }, lost: t.conflicts.length ? 'title' : null };
  }
  if (kind === 'Comment') {
    // Comments from both devices are all kept (in order); "resolved" follows the last change.
    const entries = mergeList(bv['entries'] as unknown[], lv['entries'] as unknown[], rv['entries'] as unknown[]);
    const res = mergeFields(bv, lv, rv, ['resolved'], 'local');
    return { content: { Comment: { entries, resolved: res.out['resolved'] } } as unknown as Card['content'], lost: null };
  }
  if (kind === 'Sketch') {
    // Strokes drawn on both devices are all kept; strokes erased on one side go.
    const strokes = mergeList(bv['strokes'] as unknown[], lv['strokes'] as unknown[], rv['strokes'] as unknown[]);
    const rest = mergeFields(bv, lv, rv, ['aspect', 'background'], 'local');
    return { content: { Sketch: { strokes, aspect: rest.out['aspect'], background: rest.out['background'] } } as unknown as Card['content'], lost: null };
  }
  if (kind === 'Table') {
    const bc = bv['cells'] as string[][];
    const lc = lv['cells'] as string[][];
    const rc = rv['cells'] as string[][];
    const t = mergeFields(bv, lv, rv, ['title'], 'remote');
    const shape = (c: string[][]) => `${c.length}x${c.map((r) => r.length).join(',')}`;
    if (shape(bc) === shape(lc) && shape(bc) === shape(rc)) {
      // Same rows and columns everywhere: cell by cell.
      let lost = t.conflicts.length > 0;
      const cells = rc.map((row, i) =>
        row.map((rcell, k) => {
          const b0 = bc[i][k];
          const l0 = lc[i][k];
          if (l0 !== b0 && rcell === b0) return l0;
          if (l0 !== b0 && rcell !== b0 && l0 !== rcell) lost = true;
          return rcell;
        }),
      );
      return { content: { Table: { title: t.out['title'], cells } } as unknown as Card['content'], lost: lost ? 'card' : null };
    }
    const c = mergeFields(bv, lv, rv, ['cells'], 'remote');
    return { content: { Table: { title: t.out['title'], cells: c.out['cells'] } } as unknown as Card['content'], lost: t.conflicts.length || c.conflicts.length ? 'card' : null };
  }
  if (kind === 'Audio' || kind === 'Video') {
    // The file (or link) and its length/shape belong together; the title is text.
    const unit = kind === 'Audio' ? ['file', 'duration'] : ['url', 'file', 'aspect'];
    const pick = (v: Record<string, unknown>) => Object.fromEntries(unit.map((k) => [k, v[k]]));
    const p = mergeFields({ p: pick(bv) }, { p: pick(lv) }, { p: pick(rv) }, ['p'], 'remote');
    const tl = mergeFields(bv, lv, rv, ['title'], 'remote');
    return { content: { [kind]: { ...p.out.p, title: tl.out['title'] } } as unknown as Card['content'], lost: p.conflicts.length || tl.conflicts.length ? 'card' : null };
  }
  if (kind === 'Map') {
    const place = (v: Record<string, unknown>) => ({ query: v['query'], lat: v['lat'], lng: v['lng'] });
    const p = mergeFields({ p: place(bv) }, { p: place(lv) }, { p: place(rv) }, ['p'], 'remote');
    const rest = mergeFields(bv, lv, rv, ['label', 'zoom'], 'remote');
    return { content: { Map: { ...p.out.p, label: rest.out['label'], zoom: rest.out['zoom'] } } as unknown as Card['content'], lost: p.conflicts.length || rest.conflicts.includes('label') ? 'card' : null };
  }
  if (kind === 'Image') {
    // The file and its shape belong together; the caption is text.
    const pic = (v: Record<string, unknown>) => ({ file: v['file'], aspect: v['aspect'] });
    const p = mergeFields({ p: pic(bv) }, { p: pic(lv) }, { p: pic(rv) }, ['p'], 'remote');
    const c = mergeFields(bv, lv, rv, ['caption'], 'remote');
    return { content: { Image: { ...p.out.p, caption: c.out['caption'] } } as unknown as Card['content'], lost: p.conflicts.length || c.conflicts.length ? 'card' : null };
  }
  const fields = Object.keys({ ...bv, ...lv, ...rv });
  const m = mergeFields(bv, lv, rv, fields, 'remote');
  return { content: { [kind]: m.out } as unknown as Card['content'], lost: m.conflicts.length && kind !== 'Board' ? 'card' : null };
}

export function mergeStores(base: Store, local: Store, remote: Store, opts: MergeOptions = {}): MergeResult {
  // Both sides already agree (e.g. this device's save arrived although its answer was lost).
  if (j(local) === j(remote)) return { store: structuredClone(remote), conflicts: [], renumbered: new Map(), changed: false };
  const B = structuredClone(base);
  const L = structuredClone(local);
  const R = structuredClone(remote);
  const conflicts: MergeConflict[] = [];
  const label = opts.label ?? 'this device';

  // 1. Ids this device created that the server uses too: renumber this device's.
  const idsB = allIds(B);
  const idsR = allIds(R);
  const idsL = allIds(L);
  for (const id of referencedIds(L)) idsL.add(id);
  let next = maxOf(idsR, maxOf(idsL, Math.max(B.next_id, L.next_id, R.next_id)));
  const renumbered = new Map<number, number>();
  for (const id of [...idsL].sort((a, b) => a - b)) if (!idsB.has(id) && idsR.has(id)) renumbered.set(id, ++next);
  renumber(L, renumbered);

  const ib = index(B);
  const il = index(L);
  const ir = index(R);
  const textCopies: { board: BoardId; text: string }[] = [];
  const cardCopies: { home: Home; card: Card }[] = [];

  // 2. Boards.
  const boards = new Map<number, BoardAttrs>();
  for (const id of new Set([...ib.boards.keys(), ...il.boards.keys(), ...ir.boards.keys()])) {
    const b = ib.boards.get(id);
    const l = il.boards.get(id);
    const r = ir.boards.get(id);
    if (l && r && b) {
      const style = mergeFields(b, l, r, BOARD_STYLE, 'local').out;
      const name = mergeFields(b, l, r, ['name'], 'remote');
      if (name.conflicts.length) {
        textCopies.push({ board: id, text: `board name: ${l.name}` });
        conflicts.push({ kind: 'name', id, what: 'board', note: `Board renamed in both places; kept "${r.name}", this device's name "${l.name}" is in Unsorted.` });
      }
      boards.set(id, { ...style, name: name.out.name });
    } else if (l && r) boards.set(id, r);
    else if (l && !b) boards.set(id, l);
    else if (r && !b) boards.set(id, r);
    else if (l && b && !r) {
      if (!same(boardData(l), boardData(b))) {
        boards.set(id, l);
        conflicts.push({ kind: 'edited-deleted', id, what: 'board', note: `Board "${l.name}" was deleted on another device but changed here; it was kept.` });
      }
    } else if (r && b && !l) {
      if (!same(boardData(r), boardData(b))) {
        boards.set(id, r);
        conflicts.push({ kind: 'deleted-edited', id, what: 'board', note: `Board "${r.name}" was deleted here but changed on another device; it was kept.` });
      }
    }
  }

  // 3. Trash items.
  const trash = new Map<number, TrashRec>();
  for (const id of new Set([...ib.trash.keys(), ...il.trash.keys(), ...ir.trash.keys()])) {
    const b = ib.trash.get(id);
    const l = il.trash.get(id);
    const r = ir.trash.get(id);
    if (l && r) trash.set(id, b ? mergeFields(b, l, r, ['board', 'deleted_at'], 'local').out : r);
    else if (l && !b) trash.set(id, l);
    else if (r && !b) trash.set(id, r);
    // Restored or emptied on one side and untouched on the other: gone.
  }

  // 4. Cards.
  const cards = new Map<number, CardRec>();
  for (const id of new Set([...ib.cards.keys(), ...il.cards.keys(), ...ir.cards.keys()])) {
    const b = ib.cards.get(id);
    const l = il.cards.get(id);
    const r = ir.cards.get(id);
    if (l && r && b) {
      const lay = mergeFields(b.card, l.card, r.card, CARD_LAYOUT, 'local');
      const home = mergeFields({ h: b.home }, { h: l.home }, { h: r.home }, ['h'], 'local').out.h;
      const ct = mergeContent(b.card.content, l.card.content, r.card.content);
      cards.set(id, { card: { ...lay.out, id, content: ct.content }, home });
      if (ct.lost === 'card') {
        cardCopies.push({ home, card: structuredClone(l.card) });
        conflicts.push({ kind: 'content', id, what: 'card', note: 'Changed here and on another device; the other version was kept and this one added as a copy.' });
      } else if (ct.lost === 'title' && 'Column' in l.card.content) {
        const bid = inBoard(home) ? home.b : (trash.get(home.t)?.board ?? R.root);
        textCopies.push({ board: bid, text: `column title: ${l.card.content.Column.title}` });
        conflicts.push({ kind: 'name', id, what: 'card', note: 'Column renamed in both places; this device’s title is in Unsorted.' });
      }
    } else if (l && r) cards.set(id, r); // cannot happen after renumbering
    else if (l && !b) cards.set(id, l);
    else if (r && !b) cards.set(id, r);
    else if (l && b && !r) {
      // Deleted for good elsewhere: kept only if changed here (moving it to the trash doesn't count).
      if (!same(cardData(l), cardData(b)) || (inBoard(l.home) && !same(l.home, b.home))) {
        cards.set(id, l);
        conflicts.push({ kind: 'edited-deleted', id, what: 'card', note: 'Deleted on another device but changed here; it was kept.' });
      }
    } else if (r && b && !l) {
      if (!same(cardData(r), cardData(b)) || (inBoard(r.home) && !same(r.home, b.home))) {
        cards.set(id, r);
        conflicts.push({ kind: 'deleted-edited', id, what: 'card', note: 'Deleted here but changed on another device; it was kept.' });
      }
    }
  }

  // 5. Lines.
  const arrows = new Map<number, ArrowRec>();
  for (const id of new Set([...ib.arrows.keys(), ...il.arrows.keys(), ...ir.arrows.keys()])) {
    const b = ib.arrows.get(id);
    const l = il.arrows.get(id);
    const r = ir.arrows.get(id);
    if (l && r && b) {
      const st = mergeFields(b.arrow, l.arrow, r.arrow, ARROW_STYLE, 'local').out;
      const lb = mergeFields(b.arrow, l.arrow, r.arrow, ['label'], 'remote');
      const home = mergeFields({ h: b.home }, { h: l.home }, { h: r.home }, ['h'], 'local').out.h;
      arrows.set(id, { arrow: { ...st, label: lb.out.label, id }, home });
      if (lb.conflicts.length && inBoard(home)) {
        textCopies.push({ board: home.b, text: `line label: ${l.arrow.label}` });
        conflicts.push({ kind: 'name', id, what: 'line', note: 'Line label changed in both places; this device’s label is in Unsorted.' });
      }
    } else if (l && r) arrows.set(id, r);
    else if (l && !b) arrows.set(id, l);
    else if (r && !b) arrows.set(id, r);
    else if (l && b && !r && !same(l.arrow, b.arrow)) {
      arrows.set(id, l);
      // If it can't be kept (a card it joins is gone), its label still is.
      if (l.arrow.label && l.arrow.label !== b.arrow.label && inBoard(l.home)) textCopies.push({ board: l.home.b, text: `line label: ${l.arrow.label}` });
      conflicts.push({ kind: 'edited-deleted', id, what: 'line', note: 'A line deleted elsewhere was changed here; it was kept if both its cards still exist.' });
    }
    else if (r && b && !l && !same(r.arrow, b.arrow)) arrows.set(id, r);
  }

  // 6. Build the store: server order first, then what is new here.
  const order = (rOrder: number[], lOrder: number[]) => [...new Set([...rOrder, ...lOrder])];
  const root = R.root;
  const out: Store = { boards: {}, root, next_id: Math.max(next, L.next_id, R.next_id), trash: [], version: Math.max(L.version, R.version) };
  for (const [id, a] of boards) {
    const unsorted = mergeList(ib.unsorted.get(id) ?? [], il.unsorted.get(id) ?? [], ir.unsorted.get(id) ?? []);
    out.boards[String(id)] = { ...a, id, cards: [], arrows: [], unsorted } as Board;
  }
  if (!out.boards[String(root)]) out.boards[String(root)] = { ...(ir.boards.get(root) ?? { id: root, name: 'Home', parent: null, color: 0, icon: null, pan: [60, 40], zoom: 1 }), cards: [], arrows: [], unsorted: [] } as Board;
  const trashItems = new Map<number, TrashItem>();
  for (const id of order(ir.trashOrder, il.trashOrder)) {
    const t = trash.get(id);
    if (t) trashItems.set(id, { id, board: t.board, deleted_at: t.deleted_at, cards: [], arrows: [] });
  }
  const placed = new Set<number>();
  const putCard = (rec: CardRec, id: number) => {
    const where = inBoard(rec.home) ? out.boards[String(rec.home.b)] : trashItems.get(rec.home.t);
    if (where) where.cards.push(rec.card);
    else {
      // Its board or trash item is gone: put it in Unsorted on Home.
      out.boards[String(root)].cards.push({ ...rec.card, container: 'Unsorted' });
      conflicts.push({ kind: 'misplaced', id, what: 'card', note: 'Its board or trash item was removed elsewhere; it was put in Unsorted on Home.' });
    }
    placed.add(id);
  };
  // Trash items keep their own card order (restore puts the first card back where it was).
  for (const [tid] of trashItems) {
    const own = il.trashCards.get(tid) ?? ir.trashCards.get(tid) ?? [];
    const other = ir.trashCards.get(tid) ?? [];
    for (const id of [...own, ...other]) {
      const rec = cards.get(id);
      if (rec && !placed.has(id) && !inBoard(rec.home) && rec.home.t === tid) putCard(rec, id);
    }
  }
  for (const id of order(ir.cardOrder, il.cardOrder)) {
    const rec = cards.get(id);
    if (rec && !placed.has(id)) putCard(rec, id);
  }
  // Where each card ended up, to send lines to the trash with their card (as deleting does).
  const cardTrash = new Map<number, TrashItem>();
  for (const t of trashItems.values()) for (const c of t.cards) cardTrash.set(c.id, t);
  for (const id of order(ir.arrowOrder, il.arrowOrder)) {
    const rec = arrows.get(id);
    if (!rec) continue;
    let where: { arrows: Arrow[] } | undefined = inBoard(rec.home) ? out.boards[String(rec.home.b)] : trashItems.get(rec.home.t);
    if (inBoard(rec.home)) {
      const t = cardTrash.get(rec.arrow.from) ?? cardTrash.get(rec.arrow.to);
      if (t) where = t;
    }
    if (where) where.arrows.push(rec.arrow);
  }
  out.trash = [...trashItems.values()];

  // 6b. New cards from both devices placed on the same free spot would hide each other: this
  // device's new card moves down and right until it no longer sits exactly on another card.
  for (const b of Object.values(out.boards)) {
    const taken = new Set(b.cards.filter((c) => c.container === 'Canvas' && ir.cards.has(c.id)).map((c) => `${Math.round(c.pos[0])},${Math.round(c.pos[1])}`));
    for (const c of b.cards) {
      if (c.container !== 'Canvas' || ib.cards.has(c.id) || ir.cards.has(c.id) || !il.cards.has(c.id)) continue;
      let guard = 0;
      while (taken.has(`${Math.round(c.pos[0])},${Math.round(c.pos[1])}`) && guard++ < 50) c.pos = [c.pos[0] + 32, c.pos[1] + 32];
      taken.add(`${Math.round(c.pos[0])},${Math.round(c.pos[1])}`);
    }
  }

  // 7. A board card that was kept brings its board back (with what the board held there).
  const anyCard = () => {
    const all: Card[] = [];
    for (const b of Object.values(out.boards)) all.push(...b.cards);
    for (const t of out.trash) all.push(...t.cards);
    return all;
  };
  for (let guard = 0; guard < 64; guard++) {
    const missing = anyCard()
      .map((c) => ('Board' in c.content ? c.content.Board.board : null))
      .filter((bid): bid is number => bid !== null && !out.boards[String(bid)]);
    if (!missing.length) break;
    let added = 0;
    for (const bid of new Set(missing)) {
      const src = L.boards[String(bid)] ? L : B.boards[String(bid)] ? B : R.boards[String(bid)] ? R : null;
      if (!src) continue;
      const sb = src.boards[String(bid)];
      const nb: Board = { ...structuredClone(sb), cards: [], arrows: [], unsorted: [] };
      for (const c of sb.cards)
        if (!placed.has(c.id)) {
          nb.cards.push(structuredClone(c));
          placed.add(c.id);
        }
      nb.unsorted = sb.unsorted.filter((id) => nb.cards.some((c) => c.id === id));
      const ids = new Set(nb.cards.map((c) => c.id));
      nb.arrows = sb.arrows.filter((a) => (!a.from || ids.has(a.from)) && (!a.to || ids.has(a.to))).map((a) => structuredClone(a));
      out.boards[String(bid)] = nb;
      added++;
      conflicts.push({ kind: 'edited-deleted', id: bid, what: 'board', note: `Board "${sb.name}" was deleted on one device while its card was kept on the other; it was brought back.` });
    }
    if (!added) break;
  }

  // 8. Every board can be reached: a board nothing leads to gets a board card in Unsorted on its parent.
  const linked = new Set(anyCard().flatMap((c) => ('Board' in c.content ? [c.content.Board.board] : [])));
  for (const b of Object.values(out.boards)) {
    if (b.id === root || linked.has(b.id)) continue;
    const parent = out.boards[String(b.parent ?? root)] ?? out.boards[String(root)];
    const id = ++out.next_id;
    parent.cards.push({ id, pos: [0, 0], width: 160, color: 0, z: 0, container: 'Unsorted', locked: false, align: 0, content: { Board: { board: b.id } } });
    parent.unsorted.push(id);
    conflicts.push({ kind: 'misplaced', id: b.id, what: 'board', note: `Board "${b.name}" had no card leading to it; one was added to Unsorted.` });
  }

  // 9. Conflicting copies (new ids) in Unsorted.
  const tag = `Conflicting copy (${label})`;
  for (const c of cardCopies) {
    const boardId = inBoard(c.home) ? c.home.b : (trashItems.get(c.home.t)?.board ?? root);
    const b = out.boards[String(boardId)] ?? out.boards[String(root)];
    const copy: Card = { ...c.card, id: ++out.next_id, container: 'Unsorted', locked: false };
    const ct = copy.content;
    if ('Note' in ct) ct.Note.text = `**${tag}**\n${ct.Note.text}`;
    else if ('Todo' in ct) ct.Todo.title = `${tag}: ${ct.Todo.title}`;
    else if ('Link' in ct) ct.Link.title = `${tag}: ${ct.Link.title}`;
    else if ('Image' in ct) ct.Image.caption = `${tag}: ${ct.Image.caption}`;
    else if ('Column' in ct) copy.content = { Note: { text: `**${tag}**\ncolumn title: ${ct.Column.title}` } };
    else if ('Heading' in ct) ct.Heading.text = `${ct.Heading.text} (${tag})`;
    else if ('Color' in ct) ct.Color.name = `${tag}: ${ct.Color.name}`;
    else if ('Document' in ct) ct.Document.title = `${tag}: ${ct.Document.title}`;
    else if ('Table' in ct) ct.Table.title = `${tag}: ${ct.Table.title}`;
    else if ('Audio' in ct) ct.Audio.title = `${tag}: ${ct.Audio.title}`;
    else if ('Video' in ct) ct.Video.title = `${tag}: ${ct.Video.title}`;
    else if ('Map' in ct) ct.Map.label = `${tag}: ${ct.Map.label}`;
    else if (!('Sketch' in ct) && !('Comment' in ct)) continue; // board cards are never copied
    b.cards.push(copy);
    b.unsorted.push(copy.id);
  }
  for (const t of textCopies) {
    const b = out.boards[String(t.board)] ?? out.boards[String(root)];
    const id = ++out.next_id;
    b.cards.push({ id, pos: [0, 0], width: 280, color: 0, z: 0, container: 'Unsorted', locked: false, align: 0, content: { Note: { text: `**${tag}**\n${t.text}` } } });
    b.unsorted.push(id);
  }

  repairStore(out);
  return { store: out, conflicts, renumbered, changed: j(out) !== j(R) };
}

// ---------- invariants ----------

/**
 * Makes a store consistent: each card listed once, column children and Unsorted match the cards'
 * containers on boards, lines on boards only between cards there, board cards point at existing
 * boards, parents exist without cycles, ids below `next_id`. Trash items are left as deleting made
 * them (their cards keep their column, their lines may reach cards still on the board), except for
 * board cards whose board is gone. Returns the number of repairs made.
 */
export function repairStore(s: Store): number {
  let fixes = 0;
  if (!s.boards[String(s.root)]) {
    s.boards[String(s.root)] = { id: s.root, name: 'Home', parent: null, color: 0, icon: null, cards: [], arrows: [], unsorted: [], pan: [60, 40], zoom: 1 };
    fixes++;
  }
  const seenCards = new Set<number>();
  const seenArrows = new Set<number>();
  const dedupe = <T extends { id: number }>(list: T[], seen: Set<number>) =>
    list.filter((x) => {
      if (seen.has(x.id)) {
        fixes++;
        return false;
      }
      seen.add(x.id);
      return true;
    });
  for (const b of Object.values(s.boards)) {
    if (b.id !== s.root && (b.parent === null || b.parent === b.id || !s.boards[String(b.parent)])) {
      b.parent = s.root;
      fixes++;
    }
  }
  for (const b of Object.values(s.boards)) {
    const path = new Set<number>([b.id]);
    let cur = b.parent;
    while (cur !== null && cur !== s.root) {
      if (path.has(cur)) {
        b.parent = s.root;
        fixes++;
        break;
      }
      path.add(cur);
      cur = s.boards[String(cur)]?.parent ?? null;
    }
  }
  const boardOk = (c: Card) => {
    if ('Board' in c.content && !s.boards[String(c.content.Board.board)]) {
      fixes++;
      return false;
    }
    return true;
  };
  for (const b of Object.values(s.boards)) b.cards = dedupe(b.cards, seenCards).filter(boardOk);
  for (const t of s.trash) t.cards = dedupe(t.cards, seenCards).filter(boardOk);
  const everywhere = new Set<number>(seenCards);

  for (const b of Object.values(s.boards)) {
    const byId = new Map(b.cards.map((c) => [c.id, c]));
    const claimed = new Set<number>();
    for (const c of b.cards) {
      if (isColumnContainer(c.container)) {
        const col = byId.get(c.container.Column);
        if (!col || !('Column' in col.content) || col.id === c.id || isColumnContainer(col.container) || 'Column' in c.content) {
          c.container = 'Canvas';
          fixes++;
        }
      }
    }
    for (const col of b.cards) {
      if (!('Column' in col.content)) continue;
      const kids = col.content.Column.children.filter((id) => {
        const k = byId.get(id);
        const ok = !!k && isColumnContainer(k.container) && k.container.Column === col.id && !claimed.has(id);
        if (ok) claimed.add(id);
        else fixes++;
        return ok;
      });
      for (const k of b.cards)
        if (isColumnContainer(k.container) && k.container.Column === col.id && !claimed.has(k.id)) {
          kids.push(k.id);
          claimed.add(k.id);
          fixes++;
        }
      col.content.Column.children = kids;
    }
    const uns: CardId[] = [];
    const inUns = new Set<number>();
    for (const id of b.unsorted)
      if (byId.get(id)?.container === 'Unsorted' && !inUns.has(id)) {
        uns.push(id);
        inUns.add(id);
      }
    for (const c of b.cards)
      if (c.container === 'Unsorted' && !inUns.has(c.id)) {
        uns.push(c.id);
        inUns.add(c.id);
      }
    if (uns.length !== b.unsorted.length || uns.some((id, i) => b.unsorted[i] !== id)) fixes++;
    b.unsorted = uns;
    b.arrows = dedupe(b.arrows, seenArrows).filter((a) => {
      const ok = (a.from === 0 ? !!a.from_pt : byId.has(a.from)) && (a.to === 0 ? !!a.to_pt : byId.has(a.to)) && !(a.from !== 0 && a.from === a.to);
      if (!ok) fixes++;
      return ok;
    });
  }
  for (const t of s.trash) {
    const own = new Set(t.cards.map((c) => c.id));
    t.arrows = dedupe(t.arrows, seenArrows).filter((a) => {
      const end = (id: number, pt: [number, number] | null) => (id === 0 ? !!pt : everywhere.has(id));
      const ok = end(a.from, a.from_pt) && end(a.to, a.to_pt) && (own.has(a.from) || own.has(a.to));
      if (!ok) fixes++;
      return ok;
    });
  }
  const before = s.trash.length;
  const trashIds = new Set<number>();
  s.trash = s.trash.filter((t) => t.cards.length > 0 && !trashIds.has(t.id) && (trashIds.add(t.id), true));
  fixes += before - s.trash.length;
  const max = maxOf(allIds(s));
  if (s.next_id < max) {
    s.next_id = max;
    fixes++;
  }
  return fixes;
}
