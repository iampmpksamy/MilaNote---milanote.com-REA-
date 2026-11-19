/**
 * Operations on a Store. They change the store in place (callers keep their own undo copies),
 * and behave exactly like the Rust desktop app's model.rs so both clients agree.
 */
import {
  Arrow,
  Board,
  BoardId,
  Card,
  CardId,
  Content,
  STORE_VERSION,
  Store,
  TrashItem,
  containerEquals,
  isColumnContainer,
} from './types';

export const nowSecs = (): number => Math.floor(Date.now() / 1000);

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(secs: number, now = nowSecs()): string {
  const d = Math.max(0, now - secs);
  if (d < 60) return 'just now';
  if (d < 3600) return ` min ago`;
  if (d < 86400) return ` h ago`;
  return ` days ago`;
}

export function newId(s: Store): number {
  s.next_id += 1;
  return s.next_id;
}

export function getBoard(s: Store, id: BoardId): Board {
  return s.boards[String(id)] ?? s.boards[String(s.root)];
}

export function findCard(b: Board, id: CardId): Card | undefined {
  return b.cards.find((c) => c.id === id);
}

export function maxZ(b: Board): number {
  return b.cards.reduce((m, c) => Math.max(m, c.z), 0);
}

export function minZ(b: Board): number {
  return b.cards.reduce((m, c) => Math.min(m, c.z), 0);
}

export function columnChildren(b: Board, col: CardId): CardId[] {
  const c = findCard(b, col);
  return c && 'Column' in c.content ? [...c.content.Column.children] : [];
}

export function newBoardRecord(id: BoardId, name: string, parent: BoardId | null, color: number): Board {
  return { id, name, parent, color, icon: null, cards: [], arrows: [], unsorted: [], pan: [60, 40], zoom: 1 };
}

export function newArrow(id: number, from: CardId, to: CardId): Arrow {
  return { id, from, to, color: 0, dashed: false, head: true, head_start: false, weight: 1, label: '', from_pt: null, to_pt: null };
}

export function freeArrow(id: number, a: [number, number], b: [number, number]): Arrow {
  return { ...newArrow(id, 0, 0), from_pt: a, to_pt: b };
}

/** Take a card out of its column or the unsorted list and put it on the canvas. */
export function detach(b: Board, id: CardId): void {
  const card = findCard(b, id);
  if (!card) return;
  const cont = card.container;
  if (isColumnContainer(cont)) {
    const col = findCard(b, cont.Column);
    if (col && 'Column' in col.content) col.content.Column.children = col.content.Column.children.filter((c) => c !== id);
  } else if (cont === 'Unsorted') {
    b.unsorted = b.unsorted.filter((c) => c !== id);
  }
  card.container = 'Canvas';
}

export function attachColumn(b: Board, id: CardId, col: CardId, index: number): void {
  detach(b, id);
  const c = findCard(b, col);
  if (!c || !('Column' in c.content)) return;
  const kids = c.content.Column.children;
  kids.splice(Math.min(index, kids.length), 0, id);
  const card = findCard(b, id);
  if (card) card.container = { Column: col };
}

export function attachUnsorted(b: Board, id: CardId): void {
  detach(b, id);
  b.unsorted.push(id);
  const card = findCard(b, id);
  if (card) card.container = 'Unsorted';
}

/** Board ids from Home down to `board`. */
export function boardPath(s: Store, board: BoardId): BoardId[] {
  const out: BoardId[] = [];
  let cur: BoardId | null = board;
  let guard = 0;
  while (cur !== null && guard++ < 64) {
    out.push(cur);
    cur = s.boards[String(cur)]?.parent ?? null;
  }
  return out.reverse();
}

export function newBoard(s: Store, name: string, parent: BoardId, color: number): BoardId {
  const id = newId(s);
  s.boards[String(id)] = newBoardRecord(id, name, parent, color);
  return id;
}

/** Move cards (and, for columns, their contents) to the trash. Returns how many trash items were made. */
export function deleteCards(s: Store, boardId: BoardId, ids: CardId[]): number {
  let made = 0;
  const ts = nowSecs();
  const b0 = getBoard(s, boardId);
  const top = ids.filter((id) => {
    const c = findCard(b0, id);
    if (!c) return false;
    return isColumnContainer(c.container) ? !ids.includes(c.container.Column) : true;
  });
  for (const id of top) {
    const trashId = newId(s);
    const b = getBoard(s, boardId);
    const group = [id, ...columnChildren(b, id)];
    const wasIn = findCard(b, id)?.container ?? 'Canvas';
    detach(b, id);
    const cards: Card[] = [];
    for (const gid of group) {
      const i = b.cards.findIndex((c) => c.id === gid);
      if (i >= 0) cards.push(b.cards.splice(i, 1)[0]);
    }
    if (cards.length) cards[0].container = wasIn;
    const arrows: Arrow[] = [];
    b.arrows = b.arrows.filter((a) => {
      const hit = group.includes(a.from) || group.includes(a.to);
      if (hit) arrows.push(a);
      return !hit;
    });
    if (cards.length) {
      s.trash.push({ id: trashId, board: boardId, cards, arrows, deleted_at: ts });
      made++;
    }
  }
  return made;
}

/** Put a trashed item back where it was. Returns the board it went to. */
export function restore(s: Store, trashId: number): BoardId | null {
  const i = s.trash.findIndex((t) => t.id === trashId);
  if (i < 0) return null;
  const item = s.trash.splice(i, 1)[0];
  const boardId = s.boards[String(item.board)] ? item.board : s.root;
  const b = getBoard(s, boardId);
  const z = maxZ(b) + 1;
  const first = item.cards[0]?.id;
  for (const card of item.cards) {
    if (card.id === first) card.z = z;
    b.cards.push(card);
  }
  if (first !== undefined) {
    const fc = findCard(b, first);
    const cont = fc?.container ?? 'Canvas';
    if (fc) fc.container = 'Canvas';
    if (isColumnContainer(cont)) {
      const col = findCard(b, cont.Column);
      if (col && 'Column' in col.content) attachColumn(b, first, cont.Column, Number.MAX_SAFE_INTEGER);
    } else if (cont === 'Unsorted') {
      attachUnsorted(b, first);
    }
  }
  for (const a of item.arrows) {
    if ((a.from === 0 || findCard(b, a.from)) && (a.to === 0 || findCard(b, a.to))) b.arrows.push(a);
  }
  return boardId;
}

export function removeBoardTree(s: Store, board: BoardId): void {
  if (board === s.root) return;
  const b = s.boards[String(board)];
  if (!b) return;
  delete s.boards[String(board)];
  for (const c of b.cards) if ('Board' in c.content) removeBoardTree(s, c.content.Board.board);
}

/** Delete a trashed item for good (boards inside it go too). */
export function purge(s: Store, trashId: number): void {
  const i = s.trash.findIndex((t) => t.id === trashId);
  if (i < 0) return;
  const item = s.trash.splice(i, 1)[0];
  for (const c of item.cards) if ('Board' in c.content) removeBoardTree(s, c.content.Board.board);
}

export function deepCopyBoard(s: Store, src: BoardId, parent: BoardId, depth: number): BoardId {
  const orig = s.boards[String(src)];
  if (!orig) return newBoard(s, 'Board', parent, 0);
  const copy = structuredClone(orig);
  const nb = newId(s);
  const b = newBoardRecord(nb, copy.name, parent, copy.color);
  b.icon = copy.icon;
  b.pan = copy.pan;
  b.zoom = copy.zoom;
  s.boards[String(nb)] = b;
  if (depth < 16) copyCardsInto(s, nb, copy.cards, copy.arrows, [0, 0], depth + 1, true);
  return nb;
}

/** Insert copies of `cards` (top-level cards plus any column contents). Returns new top-level ids. */
export function copyCardsInto(
  s: Store,
  boardId: BoardId,
  cards: Card[],
  arrows: Arrow[],
  offset: [number, number],
  depth: number,
  keepZ: boolean,
): CardId[] {
  const map = new Map<CardId, CardId>();
  for (const c of cards) map.set(c.id, newId(s));
  const fresh: Card[] = [];
  for (const c of cards) {
    const n = structuredClone(c);
    n.id = map.get(c.id)!;
    if ('Board' in n.content) n.content = { Board: { board: deepCopyBoard(s, n.content.Board.board, boardId, depth) } };
    fresh.push(n);
  }
  let z = maxZ(getBoard(s, boardId));
  const top: CardId[] = [];
  const unsorted: CardId[] = [];
  for (const n of fresh) {
    if ('Column' in n.content) n.content.Column.children = n.content.Column.children.filter((c) => map.has(c)).map((c) => map.get(c)!);
    if (isColumnContainer(n.container)) {
      const nc = map.get(n.container.Column);
      n.container = nc !== undefined ? { Column: nc } : 'Canvas';
    }
    if (n.container === 'Unsorted') unsorted.push(n.id);
    if (!isColumnContainer(n.container)) {
      top.push(n.id);
      if (n.container === 'Canvas') n.pos = [n.pos[0] + offset[0], n.pos[1] + offset[1]];
    }
    if (!keepZ) n.z = ++z;
  }
  const newArrows: Arrow[] = [];
  for (const a of arrows) {
    const from = a.from === 0 ? 0 : map.get(a.from);
    const to = a.to === 0 ? 0 : map.get(a.to);
    if (from === undefined || to === undefined || (from === 0 && to === 0)) continue;
    newArrows.push({ ...structuredClone(a), id: newId(s), from, to });
  }
  const b = getBoard(s, boardId);
  b.cards.push(...fresh);
  b.arrows.push(...newArrows);
  b.unsorted.push(...unsorted);
  return top;
}

/** Plain text of a card, for search and previews. */
export function cardText(s: Store, card: Card): string {
  const c = card.content;
  if ('Note' in c) return c.Note.text;
  if ('Todo' in c) return [c.Todo.title, ...c.Todo.items.map((i) => i.text)].join('\n');
  if ('Link' in c) return `${c.Link.title}\n${c.Link.url}`;
  if ('Image' in c) return c.Image.caption;
  if ('Board' in c) return s.boards[String(c.Board.board)]?.name ?? '';
  if ('Column' in c) return c.Column.title;
  if ('Heading' in c) return c.Heading.text;
  if ('Color' in c) return `${c.Color.name}\n${c.Color.hex}`;
  if ('Document' in c) return `${c.Document.title}\n${c.Document.text}`;
  if ('Audio' in c) return c.Audio.title;
  if ('Video' in c) return `${c.Video.title}\n${c.Video.url}`;
  if ('Map' in c) return `${c.Map.label}\n${c.Map.query}`;
  if ('Comment' in c) return c.Comment.entries.map((e) => e.text).join('\n');
  if ('Table' in c) return [c.Table.title, ...c.Table.cells.map((r) => r.join(' '))].join('\n');
  return '';
}

/** First line of text without markdown marks. */
export function plainTitle(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').trim().replace(/^#+\s*/, '').replace(/^- /, '');
  return line.replace(/\*\*|~~|__/g, '').replace(/[*`]/g, '');
}

/** Bring a store from an older version (or with missing fields) up to date. Returns true if anything changed. */
export function migrate(s: Store): boolean {
  let changed = false;
  const version = s.version ?? 0;
  if (version < 2) {
    // Version 1 had 7 board colours; version 2 put them after a neutral default and soft tones.
    for (const b of Object.values(s.boards)) b.color = b.color >= 0 && b.color < 7 ? b.color + 7 : 0;
    changed = true;
  }
  if (version < STORE_VERSION) changed = true;
  s.version = STORE_VERSION;
  return changed;
}

export function emptyStore(): Store {
  return { boards: { '1': newBoardRecord(1, 'Home', null, 0) }, root: 1, next_id: 1, trash: [], version: STORE_VERSION };
}

function card(s: Store, cards: Card[], pos: [number, number], width: number, color: number, content: Content): CardId {
  const id = newId(s);
  cards.push({ id, pos, width, color, z: cards.length + 1, container: 'Canvas', locked: false, align: 0, content });
  return id;
}

/** A first-run board that shows what the app can do (same content as the desktop app). */
export function sampleStore(): Store {
  const s = emptyStore();
  const root = s.root;
  const ideas = newBoard(s, 'Project ideas', root, 4);
  const mood = newBoard(s, 'Mood & inspiration', root, 2);
  const reading = newBoard(s, 'Reading list', root, 0);
  s.boards[String(ideas)].icon = '💡';
  s.boards[String(mood)].icon = '🎨';
  const cards: Card[] = [];
  const welcome = card(s, cards, [0, 0], 280, 1, {
    Note: {
      text: '# Welcome to your board\nDrag anything from the toolbar on the left onto the canvas.\n\n- **Double-click** a card to edit it\n- Drag the blue dot on a selected card to draw an arrow\n- Scroll to move around, **Ctrl + scroll** to zoom',
    },
  });
  card(s, cards, [320, 0], 124, 0, { Board: { board: ideas } });
  card(s, cards, [460, 0], 124, 0, { Board: { board: mood } });
  card(s, cards, [600, 0], 124, 0, { Board: { board: reading } });
  const todo = card(s, cards, [320, 190], 260, 0, {
    Todo: {
      title: 'This week',
      items: [
        { text: 'Sketch the layout', done: true },
        { text: 'Collect references', done: true },
        { text: 'Write the outline', done: false },
        { text: 'Share it with the team', done: false },
      ],
    },
  });
  const column = card(s, cards, [640, 190], 270, 0, { Column: { title: 'Research', children: [] } });
  const c1 = card(s, cards, [0, 0], 250, 0, { Note: { text: '**Interview notes**\nPeople want a calm, uncluttered space to collect ideas.' } });
  const c2 = card(s, cards, [0, 0], 250, 0, { Link: { url: 'https://example.com/visual-thinking', title: 'A short guide to visual thinking' } });
  const c3 = card(s, cards, [0, 0], 250, 2, { Note: { text: 'Idea: a weekly review board' } });
  const next = card(s, cards, [0, 330], 260, 0, { Note: { text: '## Next steps\nTurn the outline into a plan and *share it* by Friday.' } });
  const quick = card(s, cards, [0, 0], 240, 0, { Note: { text: 'Call Sam about the photos' } });
  for (const c of cards) {
    if ([c1, c2, c3].includes(c.id)) c.container = { Column: column };
    if (c.id === quick) c.container = 'Unsorted';
    if (c.id === column) c.content = { Column: { title: 'Research', children: [c1, c2, c3] } };
  }
  const b = getBoard(s, root);
  b.cards = cards;
  b.unsorted = [quick];
  b.arrows = [
    newArrow(newId(s), welcome, todo),
    { ...newArrow(newId(s), next, todo), dashed: true },
    { ...newArrow(newId(s), todo, column), color: 1 },
  ];
  const ib = getBoard(s, ideas);
  ib.cards.push(
    { id: newId(s), pos: [0, 0], width: 240, color: 3, z: 1, container: 'Canvas', locked: false, align: 0, content: { Note: { text: '# Ideas\nEvery board can hold more boards.' } } },
    { id: newId(s), pos: [280, 0], width: 240, color: 0, z: 2, container: 'Canvas', locked: false, align: 0, content: { Note: { text: 'Use the path at the top to go back Home.' } } },
  );
  return s;
}

export { containerEquals };
export type { TrashItem };
