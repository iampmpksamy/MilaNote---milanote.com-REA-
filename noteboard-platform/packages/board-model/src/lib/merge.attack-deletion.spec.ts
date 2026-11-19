import { afterEach, describe, expect, it, vi } from 'vitest';
import { allIds, mergeStores } from './merge';
import { deleteCards, findCard, getBoard, newArrow, newBoard, newId, purge, restore, sampleStore } from './ops';
import { type Card, type Content, isColumnContainer, type Store } from './types';

// ---------- helpers (copied from merge.spec.ts) ----------

const clone = <T>(x: T): T => structuredClone(x);

function addCard(s: Store, boardId: number, content: Content, pos: [number, number] = [0, 0]): number {
  const id = newId(s);
  getBoard(s, boardId).cards.push({ id, pos, width: 240, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content });
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
function setText(s: Store, id: number, text: string) {
  const c = card(s, id);
  if (c && 'Note' in c.content) c.content.Note.text = text;
}

function problems(s: Store): string[] {
  const out: string[] = [];
  if (!s.boards[String(s.root)]) out.push('no home');
  const cardIds = new Set<number>();
  const arrowIds = new Set<number>();
  const checkCards = (cards: Card[], where: string) => {
    const ids = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      if (cardIds.has(c.id)) out.push(`${where}: card ${c.id} twice`);
      cardIds.add(c.id);
      if (isColumnContainer(c.container)) {
        const col = cards.find((x) => x.id === (c.container as { Column: number }).Column);
        if (!col || !('Column' in col.content) || !col.content.Column.children.includes(c.id)) out.push(`${where}: card ${c.id} column link broken`);
      }
      if ('Column' in c.content)
        for (const k of c.content.Column.children) {
          const kc = cards.find((x) => x.id === k);
          if (!kc || !isColumnContainer(kc.container) || kc.container.Column !== c.id) out.push(`${where}: column ${c.id} lists ${k} wrongly`);
        }
      if ('Board' in c.content && !s.boards[String(c.content.Board.board)]) out.push(`${where}: board card ${c.id} points nowhere`);
    }
    return ids;
  };
  for (const b of Object.values(s.boards)) {
    if (b.id !== s.root && !s.boards[String(b.parent)]) out.push(`board ${b.id} parent missing`);
    const ids = checkCards(b.cards, `board ${b.id}`);
    for (const u of b.unsorted) if (!ids.has(u) || b.cards.find((c) => c.id === u)?.container !== 'Unsorted') out.push(`board ${b.id}: unsorted ${u} wrong`);
    for (const c of b.cards) if (c.container === 'Unsorted' && !b.unsorted.includes(c.id)) out.push(`board ${b.id}: ${c.id} missing from unsorted`);
    if (new Set(b.unsorted).size !== b.unsorted.length) out.push(`board ${b.id}: unsorted repeats`);
    for (const a of b.arrows) {
      if (arrowIds.has(a.id)) out.push(`line ${a.id} twice`);
      arrowIds.add(a.id);
      if ((a.from && !ids.has(a.from)) || (a.to && !ids.has(a.to))) out.push(`board ${b.id}: line ${a.id} dangling`);
    }
  }
  for (const t of s.trash) checkCards(t.cards, `trash ${t.id}`);
  const max = Math.max(0, ...allIds(s));
  if (s.next_id < max) out.push(`next_id ${s.next_id} < ${max}`);
  return out;
}

/** Boards a user can reach from Home through board cards (on boards or in the trash). */
function reachable(s: Store): Set<number> {
  const seen = new Set<number>([s.root]);
  const todo = [s.root];
  const viaCards = (cards: Card[]) => {
    for (const c of cards)
      if ('Board' in c.content && s.boards[String(c.content.Board.board)] && !seen.has(c.content.Board.board)) {
        seen.add(c.content.Board.board);
        todo.push(c.content.Board.board);
      }
  };
  for (const t of s.trash) viaCards(t.cards);
  while (todo.length) {
    const b = s.boards[String(todo.pop()!)];
    if (b) viaCards(b.cards);
  }
  // trash items may point at boards found later
  for (const t of s.trash) viaCards(t.cards);
  return seen;
}

const boardCardFor = (s: Store, board: number, on: number) => getBoard(s, on).cards.find((c) => 'Board' in c.content && c.content.Board.board === board)!.id;
const lastTrash = (s: Store) => s.trash[s.trash.length - 1].id;

/** Sample data plus a board "Sub" (board card on Home) holding a note and a nested board "Deep" with a note. */
function withSub() {
  const s = sampleStore();
  const sub = newBoard(s, 'Sub', s.root, 1);
  const subCard = addCard(s, s.root, { Board: { board: sub } });
  const inSub = addCard(s, sub, note('in sub'));
  const deep = newBoard(s, 'Deep', sub, 2);
  const deepCard = addCard(s, sub, { Board: { board: deep } });
  const inDeep = addCard(s, deep, note('in deep'));
  return { s, sub, subCard, inSub, deep, deepCard, inDeep };
}

afterEach(() => vi.restoreAllMocks());

// ---------- deletion attacks ----------

describe('deletion: lines that go to the trash with a card', () => {
  it('a line moved to the trash with its card survives a merge, so restore brings it back', () => {
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const welcome = home.cards.find((c) => 'Note' in c.content && c.content.Note.text.startsWith('# Welcome'))!.id;
    const line = home.arrows.find((a) => a.from === welcome)!;
    const l = clone(b);
    deleteCards(l, l.root, [welcome]);
    // Without any merge the app keeps the line in the trash item and restore puts it back.
    expect(l.trash[0].arrows.map((a) => a.id)).toContain(line.id);
    const r = mergeStores(b, l, clone(b));
    expect(problems(r.store)).toEqual([]);
    expect(r.store.trash[0].arrows.map((a) => a.id)).toContain(line.id);
    const after = clone(r.store);
    restore(after, after.trash[0].id);
    expect(getBoard(after, after.root).arrows.map((a) => a.id)).toContain(line.id);
  });

  it('merging three identical stores holding a trashed card with a line changes nothing', () => {
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const welcome = home.cards.find((c) => 'Note' in c.content && c.content.Note.text.startsWith('# Welcome'))!.id;
    deleteCards(b, b.root, [welcome]);
    const r = mergeStores(b, clone(b), clone(b));
    expect(r.changed).toBe(false);
  });

  it('a line drawn elsewhere to a card trashed here goes to the trash with the card, not lost', () => {
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const notes = home.cards.filter((c) => 'Note' in c.content && c.container === 'Canvas');
    const [x, y] = [notes[0].id, notes[1].id];
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [x]);
    const lineId = newId(rm);
    getBoard(rm, rm.root).arrows.push({ ...newArrow(lineId, y, x), label: 'typed on laptop' });
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    const everywhere = [...Object.values(r.store.boards).flatMap((bb) => bb.arrows), ...r.store.trash.flatMap((t) => t.arrows)];
    expect(everywhere.find((a) => a.id === lineId)?.label).toBe('typed on laptop');
  });
});

describe('deletion: cards from inside a column', () => {
  it('a card trashed from inside a column still goes back into its column on restore after a merge', () => {
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const col = home.cards.find((c) => 'Column' in c.content)!;
    const child = (col.content as { Column: { children: number[] } }).Column.children[1];
    const l = clone(b);
    deleteCards(l, l.root, [child]);
    // App alone: restore puts it back in the column.
    const solo = clone(l);
    restore(solo, lastTrash(solo));
    expect(findCard(getBoard(solo, solo.root), child)!.container).toEqual({ Column: col.id });
    // After syncing (merge with an unchanged server), the same restore should do the same.
    const r = mergeStores(b, l, clone(b));
    const after = clone(r.store);
    restore(after, lastTrash(after));
    expect(findCard(getBoard(after, after.root), child)!.container).toEqual({ Column: col.id });
  });
});

describe('deletion: restore on one side, purge on the other', () => {
  it('a board card restored here while the trash item was deleted for good elsewhere comes back as reported', () => {
    const { s: b, sub, subCard, inSub } = withSub();
    deleteCards(b, b.root, [subCard]);
    const t = lastTrash(b);
    const l = clone(b);
    const rm = clone(b);
    restore(l, t); // this device: "Restore"
    purge(rm, t); // laptop: "Delete for good" (removes Sub and Deep)
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    // The merge says the board card was kept...
    expect(r.conflicts.some((c) => c.id === subCard && c.kind === 'edited-deleted')).toBe(true);
    // ...so it (and the board it opens) must be in the result.
    expect(card(r.store, subCard)).toBeTruthy();
    expect(r.store.boards[String(sub)]).toBeTruthy();
    expect(card(r.store, inSub)).toBeTruthy();
  });

  it('the same, with the sides swapped (purged here, restored elsewhere)', () => {
    const { s: b, sub, subCard } = withSub();
    deleteCards(b, b.root, [subCard]);
    const t = lastTrash(b);
    const l = clone(b);
    const rm = clone(b);
    purge(l, t);
    restore(rm, t);
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    expect(r.conflicts.some((c) => c.id === subCard && c.kind === 'deleted-edited')).toBe(true);
    expect(card(r.store, subCard)).toBeTruthy();
    expect(r.store.boards[String(sub)]).toBeTruthy();
  });
});

describe('deletion: boards deleted for good on one side', () => {
  it('a board card trashed inside a board that was deleted for good elsewhere does not dangle', () => {
    const { s: b, sub, subCard, deepCard } = withSub();
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, sub, [deepCard]); // this device tidies up inside Sub
    deleteCards(rm, rm.root, [subCard]);
    purge(rm, lastTrash(rm));
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
  });

  it('trashed here, trashed and deleted for good elsewhere: stays deleted (no board card pointing nowhere)', () => {
    const { s: b, subCard } = withSub();
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [subCard]);
    deleteCards(rm, rm.root, [subCard]);
    purge(rm, lastTrash(rm));
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
  });

  it('trashed here, trashed and deleted for good elsewhere: a plain note is not brought back', () => {
    const b = sampleStore();
    const x = getBoard(b, b.root).cards.find((c) => 'Note' in c.content && c.container === 'Canvas')!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [x]);
    deleteCards(rm, rm.root, [x]);
    purge(rm, lastTrash(rm));
    const r = mergeStores(b, l, rm);
    expect(card(r.store, x)).toBeUndefined();
    expect(r.conflicts).toEqual([]);
  });

  it('a board deleted for good elsewhere but kept because it was edited here can still be opened', () => {
    const { s: b, sub, subCard, inSub } = withSub();
    const l = clone(b);
    const rm = clone(b);
    // This device opened Sub, scrolled (pan is saved) and edited its note.
    getBoard(l, sub).pan = [200, 100];
    setText(l, inSub, 'edited offline in sub');
    deleteCards(rm, rm.root, [subCard]);
    purge(rm, lastTrash(rm));
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    expect(card(r.store, inSub)).toBeTruthy();
    // Wherever the edited note ended up, the user must be able to get to it.
    const holder = Object.values(r.store.boards).find((x) => findCard(x, inSub))!;
    expect(reachable(r.store).has(holder.id)).toBe(true);
  });
});

describe('deletion: separate deletions on each side', () => {
  it('two different cards trashed on each side in the same second stay two separate trash items', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const quick = home.unsorted[0];
    const other = home.cards.find((c) => 'Note' in c.content && c.container === 'Canvas')!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [quick]);
    deleteCards(rm, rm.root, [other]);
    expect(l.trash[0].id).toBe(rm.trash[0].id); // shared counter: same new id on both sides
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    expect(r.store.trash.length).toBe(2);
    // Restoring the laptop's item must not drag this device's card along (or break Unsorted).
    const after = clone(r.store);
    const tid = after.trash.find((t) => t.cards.some((c) => c.id === other))!.id;
    restore(after, tid);
    expect(findCard(getBoard(after, after.root), quick)).toBeUndefined();
    expect(problems(after)).toEqual([]);
  });

  it('unsorted card trashed here survives a purge of a different item elsewhere', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const b = sampleStore();
    const home = getBoard(b, b.root);
    const quick = home.unsorted[0];
    const other = home.cards.find((c) => 'Note' in c.content && c.container === 'Canvas')!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [quick]);
    deleteCards(rm, rm.root, [other]);
    const r = mergeStores(b, l, rm);
    // The laptop later deletes ITS trash item for good: this device's card must not go with it.
    const later = clone(r.store);
    purge(later, later.trash.find((t) => t.cards.some((c) => c.id === other))!.id);
    expect(card(later, quick)).toBeTruthy();
  });
});
