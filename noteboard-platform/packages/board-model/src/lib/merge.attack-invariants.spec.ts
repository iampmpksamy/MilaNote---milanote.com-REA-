import { describe, expect, it } from 'vitest';
import { checkStore } from './check';
import { allIds, canonical, mergeStores, repairStore } from './merge';
import {
  attachColumn,
  attachUnsorted,
  copyCardsInto,
  deepCopyBoard,
  deleteCards,
  detach,
  emptyStore,
  findCard,
  getBoard,
  newArrow,
  newBoard,
  newId,
  purge,
  restore,
  sampleStore,
} from './ops';
import { type Card, type Content, isColumnContainer, type Store } from './types';

// ---------- helpers ----------

const clone = <T>(x: T): T => structuredClone(x);
const NOW = 1_700_000_000;

function addCard(s: Store, boardId: number, content: Content, pos: [number, number] = [0, 0]): number {
  const id = newId(s);
  const b = getBoard(s, boardId);
  b.cards.push({ id, pos, width: 240, color: 0, z: b.cards.length + 1, container: 'Canvas', locked: false, align: 0, content });
  return id;
}
const note = (text: string): Content => ({ Note: { text } });
function card(s: Store, id: number): Card | undefined {
  for (const b of Object.values(s.boards)) {
    const c = findCard(b, id);
    if (c) return c;
  }
  for (const t of s.trash) {
    const c = t.cards.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}
/** Adds a board the way the app does: a board record plus a board card on the parent. */
function addBoard(s: Store, parent: number, name = 'New Board'): { board: number; card: number } {
  const board = newBoard(s, name, parent, 0);
  const c = addCard(s, parent, { Board: { board } });
  return { board, card: c };
}
const boardCardOf = (s: Store, board: number) => {
  for (const b of Object.values(s.boards)) for (const c of b.cards) if ('Board' in c.content && c.content.Board.board === board) return { on: b.id, card: c };
  return undefined;
};

/**
 * The invariant checker from merge.spec.ts, plus: column children unique, trash items' board cards
 * point at boards that exist, every non-Home board reachable from Home through board cards (or held
 * by a board card in the trash), at most one board card per board.
 *
 * A trashed column child keeps its old column in `container` (deleteCards does this so restore can
 * put it back), so a column container in the trash may point outside the trash item.
 */
function problems(s: Store): string[] {
  const out: string[] = [];
  if (!s.boards[String(s.root)]) out.push('no home');
  const cardIds = new Set<number>();
  const arrowIds = new Set<number>();
  const checkCards = (cards: Card[], where: string, inTrash: boolean) => {
    const ids = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      if (cardIds.has(c.id)) out.push(`${where}: card ${c.id} twice`);
      cardIds.add(c.id);
      if (isColumnContainer(c.container)) {
        const col = cards.find((x) => x.id === (c.container as { Column: number }).Column);
        if (!(inTrash && !col) && (!col || !('Column' in col.content) || !col.content.Column.children.includes(c.id))) out.push(`${where}: card ${c.id} column link broken`);
      }
      if ('Column' in c.content) {
        if (new Set(c.content.Column.children).size !== c.content.Column.children.length) out.push(`${where}: column ${c.id} lists a child twice`);
        for (const k of c.content.Column.children) {
          const kc = cards.find((x) => x.id === k);
          if (!kc || !isColumnContainer(kc.container) || kc.container.Column !== c.id) out.push(`${where}: column ${c.id} lists ${k} wrongly`);
        }
      }
      if ('Board' in c.content && !s.boards[String(c.content.Board.board)]) out.push(`${where}: board card ${c.id} points nowhere`);
    }
    return ids;
  };
  for (const b of Object.values(s.boards)) {
    if (b.id !== s.root && !s.boards[String(b.parent)]) out.push(`board ${b.id} parent missing`);
    const ids = checkCards(b.cards, `board ${b.id}`, false);
    for (const u of b.unsorted) if (!ids.has(u) || b.cards.find((c) => c.id === u)?.container !== 'Unsorted') out.push(`board ${b.id}: unsorted ${u} wrong`);
    for (const c of b.cards) if (c.container === 'Unsorted' && !b.unsorted.includes(c.id)) out.push(`board ${b.id}: ${c.id} missing from unsorted`);
    if (new Set(b.unsorted).size !== b.unsorted.length) out.push(`board ${b.id}: unsorted repeats`);
    for (const a of b.arrows) {
      if (arrowIds.has(a.id)) out.push(`line ${a.id} twice`);
      arrowIds.add(a.id);
      if ((a.from && !ids.has(a.from)) || (a.to && !ids.has(a.to))) out.push(`board ${b.id}: line ${a.id} dangling`);
    }
  }
  for (const t of s.trash) checkCards(t.cards, `trash ${t.id}`, true);
  const max = Math.max(0, ...allIds(s));
  if (s.next_id < max) out.push(`next_id ${s.next_id} < ${max}`);
  // Reachability: Home, then boards reached through board cards (on boards or in the trash).
  const held = new Map<number, number>();
  const hold = (c: Card) => 'Board' in c.content && held.set(c.content.Board.board, (held.get(c.content.Board.board) ?? 0) + 1);
  const seen = new Set<number>([s.root]);
  const queue = [s.root];
  for (const t of s.trash) for (const c of t.cards) if ('Board' in c.content) queue.push(c.content.Board.board);
  for (const t of s.trash) t.cards.forEach(hold);
  while (queue.length) {
    const id = queue.pop()!;
    seen.add(id);
    const b = s.boards[String(id)];
    if (!b) continue;
    for (const c of b.cards) {
      if (!('Board' in c.content)) continue;
      if (!seen.has(c.content.Board.board)) queue.push(c.content.Board.board);
    }
  }
  for (const b of Object.values(s.boards)) b.cards.forEach(hold);
  for (const b of Object.values(s.boards)) {
    if (!seen.has(b.id)) out.push(`board ${b.id} unreachable (no board card leads to it)`);
    if ((held.get(b.id) ?? 0) > 1) out.push(`board ${b.id} has ${held.get(b.id)} board cards`);
  }
  return out;
}

function serverProblems(s: Store): string[] {
  const res = checkStore(clone(s));
  return res.errors;
}

function allProblems(s: Store): string[] {
  return [...problems(s), ...serverProblems(s).map((e) => `server: ${e}`)];
}

// ---------- 1. repairStore on valid stores the app produces ----------

describe('repairStore on real, valid stores', () => {
  it('the sample store is left unchanged', () => {
    const s = sampleStore();
    const before = canonical(s);
    repairStore(s);
    expect(canonical(s)).toBe(before);
  });

  it('a trashed column child keeps the column it came from (restore needs it)', () => {
    const s = sampleStore();
    const home = getBoard(s, s.root);
    const col = home.cards.find((c) => 'Column' in c.content)!;
    const child = (col.content as { Column: { children: number[] } }).Column.children[0];
    deleteCards(s, s.root, [child]);
    expect(problems(s)).toEqual([]);
    const before = canonical(s);
    repairStore(s);
    expect(canonical(s)).toBe(before);
  });

  it('a trashed card keeps the lines that went to the trash with it', () => {
    const s = sampleStore();
    const home = getBoard(s, s.root);
    const todo = home.cards.find((c) => 'Todo' in c.content)!.id;
    deleteCards(s, s.root, [todo]);
    expect(s.trash[0].arrows.length).toBe(3);
    const before = canonical(s);
    repairStore(s);
    expect(canonical(s)).toBe(before);
  });
});

// ---------- 2. merges whose output must be the untouched side ----------

describe('one side unchanged: the merge is the other side', () => {
  it('only the server trashed a column child: the result is the server version, nothing to save', () => {
    const b = sampleStore();
    const rm = clone(b);
    const col = getBoard(rm, rm.root).cards.find((c) => 'Column' in c.content)!;
    deleteCards(rm, rm.root, [(col.content as { Column: { children: number[] } }).Column.children[0]]);
    const r = mergeStores(b, clone(b), rm, { now: NOW });
    expect(r.changed).toBe(false);
    expect(canonical(r.store)).toBe(canonical(rm));
  });

  it('only this device trashed a card with lines: restoring after the merge brings the lines back', () => {
    const b = sampleStore();
    const l = clone(b);
    const todo = getBoard(l, l.root).cards.find((c) => 'Todo' in c.content)!.id;
    deleteCards(l, l.root, [todo]);
    const r = mergeStores(b, l, clone(b), { now: NOW });
    const lineCountWithoutMerge = (() => {
      const x = clone(l);
      restore(x, x.trash[0].id);
      return getBoard(x, x.root).arrows.length;
    })();
    restore(r.store, r.store.trash[0].id);
    expect(getBoard(r.store, r.store.root).arrows.length).toBe(lineCountWithoutMerge);
  });

  it('only this device trashed a column child: restoring after the merge puts it back in the column', () => {
    const b = sampleStore();
    const l = clone(b);
    const col = getBoard(l, l.root).cards.find((c) => 'Column' in c.content)!;
    const child = (col.content as { Column: { children: number[] } }).Column.children[1];
    deleteCards(l, l.root, [child]);
    const r = mergeStores(b, l, clone(b), { now: NOW });
    restore(r.store, r.store.trash[0].id);
    expect(card(r.store, child)!.container).toEqual({ Column: col.id });
  });

  it('only this device trashed a column whose child was created before it: trash item keeps the column first', () => {
    const b = emptyStore();
    const n = addCard(b, b.root, note('made first'));
    const col = addCard(b, b.root, { Column: { title: '', children: [] } });
    attachColumn(getBoard(b, b.root), n, col, 0);
    expect(problems(b)).toEqual([]);
    const l = clone(b);
    deleteCards(l, l.root, [col]);
    expect(l.trash[0].cards.map((c) => c.id)).toEqual([col, n]);
    const r = mergeStores(b, l, clone(b), { now: NOW });
    expect(r.store.trash[0].cards.map((c) => c.id)).toEqual([col, n]);
    // Restoring the merged trash item must give a consistent board.
    restore(r.store, r.store.trash[0].id);
    expect(problems(r.store)).toEqual([]);
  });
});

// ---------- 3. deletions on both sides ----------

describe('deleted on both sides', () => {
  it('board card trashed here, trashed and emptied elsewhere: no board card in the trash points at a removed board', () => {
    const b = emptyStore();
    const { card: bc } = addBoard(b, b.root);
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [bc]);
    deleteCards(rm, rm.root, [bc]);
    purge(rm, rm.trash[0].id);
    const r = mergeStores(b, l, rm, { now: NOW });
    expect(problems(r.store)).toEqual([]);
  });

  it('board deleted for good here, laptop scrolled it and added a note in it: the note can still be reached from Home', () => {
    const b = emptyStore();
    const { board, card: bc } = addBoard(b, b.root, 'Trip');
    addCard(b, board, note('packing list'));
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [bc]);
    purge(l, l.trash[0].id);
    getBoard(rm, board).pan = [100, 50]; // setView: opening and scrolling a board writes pan/zoom
    const added = addCard(rm, board, note('passport!'));
    const r = mergeStores(b, l, rm, { now: NOW });
    // The laptop's new note survives the merge...
    expect(card(r.store, added)).toBeTruthy();
    // ...but it must be somewhere the user can get to.
    expect(problems(r.store)).toEqual([]);
  });

  it('sub-board emptied from the trash here, only scrolled (pan/zoom) elsewhere: no unreachable board is left', () => {
    const b = emptyStore();
    const { board, card: bc } = addBoard(b, b.root, 'Trip');
    addCard(b, board, note('packing list'));
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [bc]);
    purge(l, l.trash[0].id);
    getBoard(rm, board).zoom = 1.5; // the laptop scrolled/zoomed inside the board
    const r = mergeStores(b, l, rm, { now: NOW });
    expect(problems(r.store)).toEqual([]);
  });
});

// ---------- 4. picture: file and shape go together ----------

describe('content merge', () => {
  it('picture replaced on both sides: the kept picture keeps its own aspect', () => {
    const b = emptyStore();
    const id = addCard(b, b.root, { Image: { file: 'a.png', caption: '', aspect: 1 } });
    const l = clone(b);
    const rm = clone(b);
    (card(l, id)!.content as { Image: { file: string; aspect: number } }).Image.file = 'wide.png';
    (card(l, id)!.content as { Image: { file: string; aspect: number } }).Image.aspect = 16 / 9;
    (card(rm, id)!.content as { Image: { file: string; aspect: number } }).Image.file = 'square.png'; // also 1:1
    const r = mergeStores(b, l, rm, { now: NOW });
    const img = (card(r.store, id)!.content as { Image: { file: string; aspect: number } }).Image;
    expect(img.file).toBe('square.png');
    expect(img.aspect).toBe(1);
  });
});

// ---------- 5. randomised, with more of the app's operations ----------

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** One random edit through the app's operations (no purge of boards, no trash of column children). */
const opLog: string[] = [];
function randomEdit(s: Store, rand: () => number, tag: string): void {
  const boards = Object.values(s.boards);
  const b = boards[Math.floor(rand() * boards.length)];
  const pick = () => b.cards[Math.floor(rand() * b.cards.length)];
  const k = Math.floor(rand() * 15);
  opLog.push(`${tag} op${k} board ${b.id} trash=[${s.trash.map((t) => t.id + ':' + t.cards.map((c) => c.id + ('Board' in c.content ? '->B' + c.content.Board.board : '')).join(','))}]`);
  if (k === 0 || !b.cards.length) {
    addCard(s, b.id, note(`${tag} new ${s.next_id}`), [Math.round(rand() * 800), Math.round(rand() * 600)]);
    return;
  }
  const c = pick();
  switch (k) {
    case 1:
      if ('Note' in c.content) c.content.Note.text = `${tag} edit ${c.id} ${Math.floor(rand() * 1e6)}`;
      return;
    case 2:
      c.pos = [Math.round(rand() * 900), Math.round(rand() * 700)];
      return;
    case 3:
      if (!isColumnContainer(c.container)) deleteCards(s, b.id, [c.id]);
      return;
    case 4:
      if (s.trash.length) restore(s, s.trash[Math.floor(rand() * s.trash.length)].id);
      return;
    case 5:
      addBoard(s, b.id, `${tag} board ${s.next_id}`);
      return;
    case 6: {
      const cols = b.cards.filter((x) => 'Column' in x.content && !isColumnContainer(x.container));
      if (!cols.length) addCard(s, b.id, { Column: { title: `${tag} col ${s.next_id}`, children: [] } });
      else if (!('Column' in c.content)) attachColumn(b, c.id, cols[0].id, Math.floor(rand() * 3));
      return;
    }
    case 7:
      if (!('Column' in c.content)) attachUnsorted(b, c.id);
      return;
    case 8: {
      const d = pick();
      if (d.id !== c.id) b.arrows.push(newArrow(newId(s), c.id, d.id));
      return;
    }
    case 9: {
      // Copy and paste on the same board (copyCardsInto, with column contents and lines).
      const group = [c, ...('Column' in c.content ? c.content.Column.children.map((id) => findCard(b, id)!).filter(Boolean) : [])];
      const ids = new Set(group.map((x) => x.id));
      copyCardsInto(s, b.id, clone(group), clone(b.arrows.filter((a) => ids.has(a.from) && ids.has(a.to))), [24, 24], 0, false);
      return;
    }
    case 10:
      detach(b, c.id);
      return;
    case 11:
      b.pan = [Math.round(rand() * 100), Math.round(rand() * 100)];
      b.zoom = Math.round(rand() * 20) / 10 + 0.5;
      return;
    case 12:
      if (s.trash.length && rand() < 0.5) purge(s, s.trash[0].id);
      return;
    case 13:
      b.name = `${tag} renamed ${Math.floor(rand() * 100)}`;
      return;
    default:
      c.color = Math.floor(rand() * 8);
  }
}

describe('randomised two-device editing (more operations)', () => {
  it('400 sessions: merged store passes every invariant and the server check', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400 && failures.length < 5; seed++) {
      const rand = rng(seed * 104729);
      opLog.length = 0;
      const b = sampleStore();
      for (let i = 0; i < 10; i++) randomEdit(b, rand, 'base');
      if (problems(b).length) continue; // only start from valid stores
      const l = clone(b);
      const rm = clone(b);
      for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) randomEdit(l, rand, 'L');
      for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) randomEdit(rm, rand, 'R');
      if (problems(l).length || problems(rm).length) continue;
      const r = mergeStores(b, l, rm, { now: NOW });
      const p = allProblems(r.store);
      if (p.length) failures.push(`seed ${seed}: ${p.join('; ')}\n${opLog.join('\n')}`);
    }
    expect(failures).toEqual([]);
  });

  it('deepCopyBoard on one side, new cards on the other with clashing ids: valid and both kept', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const src = Object.values(l.boards).find((x) => x.name === 'Project ideas')!.id;
    const copy = deepCopyBoard(l, src, l.root, 0);
    addCard(l, l.root, { Board: { board: copy } });
    for (let i = 0; i < 5; i++) addCard(rm, rm.root, note(`laptop ${i}`));
    const r = mergeStores(b, l, rm, { now: NOW });
    expect(allProblems(r.store)).toEqual([]);
    const names = Object.values(r.store.boards).filter((x) => x.name === 'Project ideas');
    expect(names.length).toBe(2);
  });
});

// ---------- 6. size ----------

describe('large stores the server accepts', () => {
  it('a store with 150 000 cards (within checkStore limits) merges without throwing', () => {
    const b = emptyStore();
    for (let i = 0; i < 10; i++) {
      const { board } = addBoard(b, b.root, `big ${i}`);
      const bb = getBoard(b, board);
      for (let k = 0; k < 15000; k++) {
        const id = newId(b);
        bb.cards.push({ id, pos: [k, 0], width: 240, color: 0, z: k, container: 'Canvas', locked: false, align: 0, content: { Note: { text: '' } } });
      }
    }
    expect(checkStore(b).ok).toBe(true);
    const l = clone(b);
    addCard(l, l.root, note('one more'));
    expect(() => mergeStores(b, l, clone(b), { now: NOW })).not.toThrow();
  }, 120_000);
});
