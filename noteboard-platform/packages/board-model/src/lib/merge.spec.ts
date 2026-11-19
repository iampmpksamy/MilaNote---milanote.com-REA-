import { describe, expect, it } from 'vitest';
import { allIds, mergeList, mergeStores, repairStore } from './merge';
import { attachColumn, attachUnsorted, deleteCards, findCard, getBoard, newArrow, newBoard, newId, purge, restore, sampleStore } from './ops';
import { type Card, type Content, isColumnContainer, type Store } from './types';

// ---------- helpers ----------

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
const texts = (s: Store) => {
  const out: string[] = [];
  const add = (c: Card) => 'Note' in c.content && out.push(c.content.Note.text);
  for (const b of Object.values(s.boards)) b.cards.forEach(add);
  for (const t of s.trash) t.cards.forEach(add);
  return out;
};
function setText(s: Store, id: number, text: string) {
  const c = card(s, id);
  if (c && 'Note' in c.content) c.content.Note.text = text;
}

/** Every invariant the app and the server rely on. Returns the problems found. */
function problems(s: Store): string[] {
  const out: string[] = [];
  if (!s.boards[String(s.root)]) out.push('no home');
  const cardIds = new Set<number>();
  const arrowIds = new Set<number>();
  // Trash items keep cards as deleting left them (their column, for restore), so only boards get the column checks.
  const checkCards = (cards: Card[], where: string, onBoard = true) => {
    const ids = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      if (cardIds.has(c.id)) out.push(`${where}: card ${c.id} twice`);
      cardIds.add(c.id);
      if (onBoard && isColumnContainer(c.container)) {
        const col = cards.find((x) => x.id === (c.container as { Column: number }).Column);
        if (!col || !('Column' in col.content) || !col.content.Column.children.includes(c.id)) out.push(`${where}: card ${c.id} column link broken`);
      }
      if (onBoard && 'Column' in c.content)
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
  for (const t of s.trash) checkCards(t.cards, `trash ${t.id}`, false);
  const max = Math.max(0, ...allIds(s));
  if (s.next_id < max) out.push(`next_id ${s.next_id} < ${max}`);
  return out;
}

function base(): Store {
  return sampleStore();
}

// ---------- named scenarios ----------

describe('mergeStores', () => {
  it('no changes anywhere: the server version, nothing to save', () => {
    const b = base();
    const r = mergeStores(b, clone(b), clone(b));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
    expect(problems(r.store)).toEqual([]);
  });

  it('only this device changed: its version', () => {
    const b = base();
    const l = clone(b);
    const id = addCard(l, l.root, note('offline note'));
    const r = mergeStores(b, l, clone(b));
    expect(r.changed).toBe(true);
    expect(card(r.store, id)).toBeTruthy();
    expect(problems(r.store)).toEqual([]);
  });

  it('only the server changed: the server version, nothing to save', () => {
    const b = base();
    const rm = clone(b);
    addCard(rm, rm.root, note('from the laptop'));
    const r = mergeStores(b, clone(b), rm);
    expect(r.changed).toBe(false);
    expect(texts(r.store)).toContain('from the laptop');
  });

  it('different cards changed on each side: both changes', () => {
    const b = base();
    const ids = getBoard(b, b.root).cards.filter((c) => 'Note' in c.content).map((c) => c.id);
    const l = clone(b);
    const rm = clone(b);
    setText(l, ids[0], 'phone edit');
    setText(rm, ids[1], 'laptop edit');
    const r = mergeStores(b, l, rm);
    expect(texts(r.store)).toEqual(expect.arrayContaining(['phone edit', 'laptop edit']));
    expect(r.conflicts).toEqual([]);
  });

  it('same note changed on both sides: server text kept, this device text as a copy in Unsorted', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    const rm = clone(b);
    setText(l, id, 'phone version');
    setText(rm, id, 'laptop version');
    const r = mergeStores(b, l, rm, { label: 'phone' });
    const c = card(r.store, id)!;
    expect('Note' in c.content && c.content.Note.text).toBe('laptop version');
    const copy = getBoard(r.store, r.store.root).cards.find((x) => 'Note' in x.content && x.content.Note.text.includes('phone version'))!;
    expect(copy).toBeTruthy();
    expect(copy.container).toBe('Unsorted');
    expect('Note' in copy.content && copy.content.Note.text).toContain('Conflicting copy (phone)');
    expect(r.conflicts.map((x) => x.kind)).toEqual(['content']);
    expect(problems(r.store)).toEqual([]);
  });

  it('same edit on both sides is not a conflict', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    const rm = clone(b);
    setText(l, id, 'same');
    setText(rm, id, 'same');
    const r = mergeStores(b, l, rm);
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toBe(false);
  });

  it('position changed on both sides: this device wins; text changed on the other side is kept', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    const rm = clone(b);
    card(l, id)!.pos = [10, 10];
    card(rm, id)!.pos = [500, 500];
    setText(rm, id, 'laptop text');
    const r = mergeStores(b, l, rm);
    expect(card(r.store, id)!.pos).toEqual([10, 10]);
    expect(texts(r.store)).toContain('laptop text');
    expect(r.conflicts).toEqual([]);
  });

  it('both sides created new cards with the same ids: this device’s are renumbered with all references', () => {
    const b = base();
    const l = clone(b);
    const rm = clone(b);
    // Phone: a column with a note inside, and a line from an existing card to the note.
    const col = addCard(l, l.root, { Column: { title: 'Offline column', children: [] } });
    const n1 = addCard(l, l.root, note('in the column'));
    attachColumn(getBoard(l, l.root), n1, col, 0);
    const existing = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const lineId = newId(l);
    getBoard(l, l.root).arrows.push(newArrow(lineId, existing, n1));
    // Laptop: two notes that took the same ids.
    const r1 = addCard(rm, rm.root, note('laptop A'));
    const r2 = addCard(rm, rm.root, note('laptop B'));
    expect([r1, r2]).toEqual([col, n1]);
    const r = mergeStores(b, l, rm);
    expect(r.renumbered.size).toBe(2); // the column and the note; the line's id was not taken on the laptop
    expect(texts(r.store)).toEqual(expect.arrayContaining(['laptop A', 'laptop B', 'in the column']));
    const newCol = getBoard(r.store, r.store.root).cards.find((c) => 'Column' in c.content && c.content.Column.title === 'Offline column')!;
    const inCol = getBoard(r.store, r.store.root).cards.find((c) => 'Note' in c.content && c.content.Note.text === 'in the column')!;
    expect('Column' in newCol.content && newCol.content.Column.children).toEqual([inCol.id]);
    expect(inCol.container).toEqual({ Column: newCol.id });
    const line = getBoard(r.store, r.store.root).arrows.find((a) => a.to === inCol.id)!;
    expect(line.from).toBe(existing);
    expect(problems(r.store)).toEqual([]);
    expect(r.store.next_id).toBeGreaterThanOrEqual(Math.max(...allIds(r.store)));
  });

  it('a board created offline (with cards) and a board created elsewhere with the same id both survive', () => {
    const b = base();
    const l = clone(b);
    const rm = clone(b);
    const lb = newBoard(l, 'Phone board', l.root, 3);
    addCard(l, l.root, { Board: { board: lb } });
    addCard(l, lb, note('inside phone board'));
    const rb = newBoard(rm, 'Laptop board', rm.root, 4);
    addCard(rm, rm.root, { Board: { board: rb } });
    expect(rb).toBe(lb);
    const r = mergeStores(b, l, rm);
    const names = Object.values(r.store.boards).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Phone board', 'Laptop board']));
    const phone = Object.values(r.store.boards).find((x) => x.name === 'Phone board')!;
    expect(phone.cards.map((c) => 'Note' in c.content && c.content.Note.text)).toContain('inside phone board');
    expect(getBoard(r.store, r.store.root).cards.some((c) => 'Board' in c.content && c.content.Board.board === phone.id)).toBe(true);
    expect(problems(r.store)).toEqual([]);
  });

  it('moved to the trash here, edited elsewhere: stays in the trash with the edit', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, l.root, [id]);
    setText(rm, id, 'edited on laptop');
    const r = mergeStores(b, l, rm);
    expect(findCard(getBoard(r.store, r.store.root), id)).toBeUndefined();
    const inTrash = r.store.trash.flatMap((t) => t.cards).find((c) => c.id === id)!;
    expect('Note' in inTrash.content && inTrash.content.Note.text).toBe('edited on laptop');
    expect(problems(r.store)).toEqual([]);
  });

  it('deleted for good elsewhere, edited here: the edited card comes back', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(rm, rm.root, [id]);
    purge(rm, rm.trash[rm.trash.length - 1].id);
    setText(l, id, 'kept from the phone');
    const r = mergeStores(b, l, rm);
    expect(texts(r.store)).toContain('kept from the phone');
    expect(r.conflicts.some((c) => c.kind === 'edited-deleted')).toBe(true);
    expect(problems(r.store)).toEqual([]);
  });

  it('deleted here and untouched elsewhere: deleted', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    const l = clone(b);
    deleteCards(l, l.root, [id]);
    purge(l, l.trash[l.trash.length - 1].id);
    const r = mergeStores(b, l, clone(b));
    expect(card(r.store, id)).toBeUndefined();
    expect(problems(r.store)).toEqual([]);
  });

  it('restored from the trash here while the other side did nothing: restored', () => {
    const b = base();
    const id = getBoard(b, b.root).cards.find((c) => 'Note' in c.content)!.id;
    deleteCards(b, b.root, [id]);
    const l = clone(b);
    restore(l, l.trash[l.trash.length - 1].id);
    const r = mergeStores(b, l, clone(b));
    expect(findCard(getBoard(r.store, r.store.root), id)).toBeTruthy();
    expect(r.store.trash.flatMap((t) => t.cards).find((c) => c.id === id)).toBeUndefined();
    expect(problems(r.store)).toEqual([]);
  });

  it('cards added to the same column on both sides: both in the column', () => {
    const b = base();
    const col = addCard(b, b.root, { Column: { title: 'Todo', children: [] } });
    const l = clone(b);
    const rm = clone(b);
    const a = addCard(l, l.root, note('phone item'));
    attachColumn(getBoard(l, l.root), a, col, 0);
    const c = addCard(rm, rm.root, note('laptop item'));
    attachColumn(getBoard(rm, rm.root), c, col, 0);
    const r = mergeStores(b, l, rm);
    const kids = (findCard(getBoard(r.store, r.store.root), col)!.content as { Column: { children: number[] } }).Column.children;
    expect(kids.length).toBe(2);
    expect(problems(r.store)).toEqual([]);
  });

  it('Unsorted: both sides add, one removes', () => {
    const b = base();
    const x = addCard(b, b.root, note('x'));
    attachUnsorted(getBoard(b, b.root), x);
    const l = clone(b);
    const rm = clone(b);
    const a = addCard(l, l.root, note('phone u'));
    attachUnsorted(getBoard(l, l.root), a);
    const c = addCard(rm, rm.root, note('laptop u'));
    attachUnsorted(getBoard(rm, rm.root), c);
    getBoard(rm, rm.root).cards.find((k) => k.id === x)!.container = 'Canvas';
    getBoard(rm, rm.root).unsorted = getBoard(rm, rm.root).unsorted.filter((k) => k !== x);
    const before = getBoard(b, b.root).unsorted.filter((k) => k !== x).map((id) => (card(b, id)!.content as { Note: { text: string } }).Note.text);
    const r = mergeStores(b, l, rm);
    const uns = getBoard(r.store, r.store.root).unsorted.map((id) => (card(r.store, id)!.content as { Note: { text: string } }).Note.text);
    expect(uns.sort()).toEqual([...before, 'laptop u', 'phone u'].sort());
    expect(problems(r.store)).toEqual([]);
  });

  it('a board deleted for good elsewhere while cards were added to it here: cards land in Unsorted on Home', () => {
    const b = base();
    const sub = newBoard(b, 'Sub', b.root, 1);
    addCard(b, b.root, { Board: { board: sub } });
    const l = clone(b);
    const rm = clone(b);
    addCard(l, sub, note('added offline to Sub'));
    const bc = getBoard(rm, rm.root).cards.find((c) => 'Board' in c.content && c.content.Board.board === sub)!.id;
    deleteCards(rm, rm.root, [bc]);
    purge(rm, rm.trash[rm.trash.length - 1].id);
    const r = mergeStores(b, l, rm);
    expect(texts(r.store)).toContain('added offline to Sub');
    expect(problems(r.store)).toEqual([]);
  });

  it('merging a store with itself changes nothing', () => {
    const b = base();
    const x = clone(b);
    addCard(x, x.root, note('both'));
    const r = mergeStores(b, x, clone(x));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });
});

describe('sample data', () => {
  it('the sample boards satisfy every invariant', () => {
    expect(problems(sampleStore())).toEqual([]);
  });
});

describe('placement', () => {
  it('cards made on both devices at the same free spot do not hide each other', () => {
    const b = base();
    const l = clone(b);
    const rm = clone(b);
    addCard(l, l.root, note('phone'), [400, 300]);
    addCard(rm, rm.root, note('laptop'), [400, 300]);
    const r = mergeStores(b, l, rm);
    const at = (t: string) => getBoard(r.store, r.store.root).cards.find((c) => 'Note' in c.content && c.content.Note.text === t)!.pos;
    expect(at('laptop')).toEqual([400, 300]);
    expect(at('phone')).not.toEqual([400, 300]);
  });
});

describe('mergeList', () => {
  it('keeps the server order and inserts local additions after their neighbour', () => {
    expect(mergeList([1, 2, 3], [1, 9, 2, 3], [3, 2, 1])).toEqual([3, 2, 1, 9]);
    expect(mergeList([1, 2, 3], [1, 3], [1, 2, 3, 4])).toEqual([1, 3, 4]);
    expect(mergeList([], [5], [6])).toEqual([5, 6]);
  });
});

describe('repairStore', () => {
  it('fixes dangling references without losing cards', () => {
    const s = base();
    const b = getBoard(s, s.root);
    const id = addCard(s, s.root, note('orphan'));
    findCard(b, id)!.container = { Column: 99999 };
    b.unsorted.push(424242);
    b.arrows.push(newArrow(777777, id, 31337));
    s.next_id = 1;
    repairStore(s);
    expect(problems(s)).toEqual([]);
    expect(findCard(b, id)!.container).toBe('Canvas');
  });
});

// ---------- randomised: two devices doing random things ----------

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** One random edit, as the app would make it. Returns any text it typed. */
function randomEdit(s: Store, rand: () => number, tag: string): string | null {
  const boards = Object.values(s.boards);
  const b = boards[Math.floor(rand() * boards.length)];
  const pick = () => b.cards[Math.floor(rand() * b.cards.length)];
  const k = Math.floor(rand() * 11);
  if (k === 0 || !b.cards.length) {
    const t = `${tag} new ${s.next_id}`;
    addCard(s, b.id, note(t), [rand() * 800, rand() * 600]);
    return t;
  }
  const c = pick();
  switch (k) {
    case 1:
      if ('Note' in c.content) {
        const t = `${tag} edit ${c.id} ${Math.floor(rand() * 1e6)}`;
        c.content.Note.text = t;
        return t;
      }
      return null;
    case 2:
      c.pos = [rand() * 900, rand() * 700];
      return null;
    case 3:
      deleteCards(s, b.id, [c.id]);
      return null;
    case 4:
      if (s.trash.length) restore(s, s.trash[Math.floor(rand() * s.trash.length)].id);
      return null;
    case 5: {
      const nb = newBoard(s, `${tag} board`, b.id, 2);
      addCard(s, b.id, { Board: { board: nb } });
      return null;
    }
    case 6: {
      const cols = b.cards.filter((x) => 'Column' in x.content);
      if (!cols.length) addCard(s, b.id, { Column: { title: `${tag} col`, children: [] } });
      else if (!('Column' in c.content) && !('Board' in c.content)) attachColumn(b, c.id, cols[0].id, Math.floor(rand() * 3));
      return null;
    }
    case 7:
      if (!('Column' in c.content)) attachUnsorted(b, c.id);
      return null;
    case 8: {
      const d = pick();
      if (d.id !== c.id) b.arrows.push(newArrow(newId(s), c.id, d.id));
      return null;
    }
    case 9:
      if (s.trash.length && rand() < 0.3) purge(s, s.trash[0].id);
      return null;
    default:
      c.color = Math.floor(rand() * 8);
      return null;
  }
}

describe('randomised two-device editing', () => {
  it('300 random sessions: always consistent, nothing typed is lost (except what was deleted)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed * 7919);
      const b = base();
      for (let i = 0; i < 8; i++) randomEdit(b, rand, 'base');
      repairStore(b);
      const l = clone(b);
      const rm = clone(b);
      const typedL: string[] = [];
      const typedR: string[] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) {
        const t = randomEdit(l, rand, 'L');
        if (t) typedL.push(t);
      }
      for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) {
        const t = randomEdit(rm, rand, 'R');
        if (t) typedR.push(t);
      }
      const r = mergeStores(b, l, rm);
      const p = problems(r.store);
      if (p.length) throw new Error(`seed ${seed}: ${p.join('; ')}`);
      // Text that still exists on its own side (not deleted/overwritten there) must exist after the merge.
      const all = texts(r.store).join('\n');
      for (const t of typedL) if (texts(l).includes(t) && !all.includes(t)) throw new Error(`seed ${seed}: lost phone text "${t}"`);
      for (const t of typedR) if (texts(rm).includes(t) && !all.includes(t)) throw new Error(`seed ${seed}: lost laptop text "${t}"`);
      // Merging the result again with either side as base changes nothing.
      expect(mergeStores(r.store, clone(r.store), clone(r.store)).changed).toBe(false);
    }
  });
});
