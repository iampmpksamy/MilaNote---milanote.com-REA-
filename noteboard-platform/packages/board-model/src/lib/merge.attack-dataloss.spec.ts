/**
 * Attack tests for mergeStores, lens: data loss (anything the person typed or created disappearing
 * from the result without a conflicting copy). Failing tests here are findings.
 */
import { describe, expect, it } from 'vitest';
import { allIds, mergeStores } from './merge';
import { deleteCards, findCard, freeArrow, getBoard, newArrow, newId, purge, restore, sampleStore } from './ops';
import { type Card, isColumnContainer, type Store } from './types';

const clone = <T>(x: T): T => structuredClone(x);

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

/** Every string the person typed, anywhere in the store (boards, cards, lines, trash). */
function typed(s: Store): string[] {
  const out: string[] = [];
  const addCard = (c: Card) => {
    const ct = c.content;
    if ('Note' in ct) out.push(ct.Note.text);
    if ('Todo' in ct) out.push(ct.Todo.title, ...ct.Todo.items.map((i) => i.text));
    if ('Link' in ct) out.push(ct.Link.url, ct.Link.title);
    if ('Image' in ct) out.push(ct.Image.caption);
    if ('Column' in ct) out.push(ct.Column.title);
  };
  for (const b of Object.values(s.boards)) {
    out.push(b.name);
    b.cards.forEach(addCard);
    for (const a of b.arrows) out.push(a.label);
  }
  for (const t of s.trash) {
    t.cards.forEach(addCard);
    for (const a of t.arrows) out.push(a.label);
  }
  return out;
}
const mentions = (s: Store, text: string) => typed(s).some((t) => t.includes(text));

function problems(s: Store): string[] {
  const out: string[] = [];
  if (!s.boards[String(s.root)]) out.push('no home');
  const cardIds = new Set<number>();
  const checkCards = (cards: Card[], where: string) => {
    const ids = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      if (cardIds.has(c.id)) out.push(`${where}: card ${c.id} twice`);
      cardIds.add(c.id);
      if (isColumnContainer(c.container)) {
        const col = cards.find((x) => x.id === (c.container as { Column: number }).Column);
        if (!col || !('Column' in col.content) || !col.content.Column.children.includes(c.id)) out.push(`${where}: card ${c.id} column link broken`);
      }
      if ('Board' in c.content && !s.boards[String(c.content.Board.board)]) out.push(`${where}: board card ${c.id} points nowhere`);
    }
    return ids;
  };
  for (const b of Object.values(s.boards)) {
    if (b.id !== s.root && !s.boards[String(b.parent)]) out.push(`board ${b.id} parent missing`);
    const ids = checkCards(b.cards, `board ${b.id}`);
    for (const a of b.arrows) if ((a.from && !ids.has(a.from)) || (a.to && !ids.has(a.to))) out.push(`board ${b.id}: line ${a.id} dangling`);
  }
  for (const t of s.trash) checkCards(t.cards, `trash ${t.id}`);
  if (s.next_id < Math.max(0, ...allIds(s))) out.push('next_id too low');
  return out;
}

// sampleStore ids: Home 1, boards 2 (Project ideas) 3 4; cards welcome 5, board cards 6 7 8, todo 9,
// column 10 (children 11 12 13), next 14, quick 15 (Unsorted); lines 16 (5->9) 17 (14->9) 18 (9->10).
const COLUMN = 10;
const LINE = 16;
const IDEAS_BOARD = 2;
const IDEAS_CARD = 6;

describe('merge data loss: concurrent edits of typed fields', () => {
  it('control: same to-do list ticked differently on both sides keeps both versions', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const tl = card(l, 9)!;
    const tr = card(rm, 9)!;
    if ('Todo' in tl.content) tl.content.Todo.items.push({ text: 'phone item', done: false });
    if ('Todo' in tr.content) tr.content.Todo.items[2].done = true;
    const r = mergeStores(b, l, rm);
    expect(mentions(r.store, 'phone item')).toBe(true);
    expect(problems(r.store)).toEqual([]);
  });

  it('column title renamed on both sides: this device’s title is not lost', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const cl = card(l, COLUMN)!;
    const cr = card(rm, COLUMN)!;
    if ('Column' in cl.content) cl.content.Column.title = 'Phone research title';
    if ('Column' in cr.content) cr.content.Column.title = 'Laptop research title';
    const r = mergeStores(b, l, rm, { label: 'phone' });
    expect(mentions(r.store, 'Laptop research title')).toBe(true);
    expect(mentions(r.store, 'Phone research title')).toBe(true);
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it('board renamed on both sides: the other device’s name is not lost', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    getBoard(l, IDEAS_BOARD).name = 'Phone ideas name';
    getBoard(rm, IDEAS_BOARD).name = 'Laptop ideas name';
    const r = mergeStores(b, l, rm, { label: 'phone' });
    expect(mentions(r.store, 'Phone ideas name')).toBe(true);
    expect(mentions(r.store, 'Laptop ideas name')).toBe(true);
  });

  it('line label edited on both sides: the other device’s label is not lost', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    getBoard(l, l.root).arrows.find((a) => a.id === LINE)!.label = 'phone label';
    getBoard(rm, rm.root).arrows.find((a) => a.id === LINE)!.label = 'laptop label';
    const r = mergeStores(b, l, rm, { label: 'phone' });
    expect(mentions(r.store, 'phone label')).toBe(true);
    expect(mentions(r.store, 'laptop label')).toBe(true);
  });
});

describe('merge data loss: items new on both sides judged "the same" too eagerly', () => {
  it('line saved (answer lost) then labelled here: the label survives the next merge', () => {
    const b = sampleStore();
    const l = clone(b);
    // Phone draws a line and saves; the server stores it but the reply is lost, so base stays `b`.
    const id = newId(l);
    getBoard(l, l.root).arrows.push(newArrow(id, 5, 14));
    const rm = clone(l);
    // Phone then labels the line and merges again against the stale base.
    getBoard(l, l.root).arrows.find((a) => a.id === id)!.label = 'typed after the lost save';
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base.
    const r = mergeStores(clone(rm), l, rm);
    expect(getBoard(r.store, r.store.root).arrows.find((a) => a.id === id)?.label).toBe('typed after the lost save');
  });

  it('two different free lines drawn on each device with the same new id: both survive', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lid = newId(l);
    getBoard(l, l.root).arrows.push({ ...freeArrow(lid, [0, 0], [100, 0]), label: 'phone free line' });
    const rid = newId(rm);
    getBoard(rm, rm.root).arrows.push({ ...freeArrow(rid, [900, 900], [950, 990]), label: 'laptop free line' });
    expect(lid).toBe(rid);
    const r = mergeStores(b, l, rm);
    const lines = getBoard(r.store, r.store.root).arrows.filter((a) => a.from === 0 && a.to === 0);
    expect(lines.length).toBe(2);
    expect(mentions(r.store, 'phone free line')).toBe(true);
    expect(mentions(r.store, 'laptop free line')).toBe(true);
  });

  it('a line between the same two cards drawn and labelled on each device: neither label is lost', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lid = newId(l);
    getBoard(l, l.root).arrows.push({ ...newArrow(lid, 5, 14), label: 'phone says depends' });
    const rid = newId(rm);
    getBoard(rm, rm.root).arrows.push({ ...newArrow(rid, 5, 14), label: 'laptop says blocks' });
    const r = mergeStores(b, l, rm);
    expect(mentions(r.store, 'phone says depends')).toBe(true);
    expect(mentions(r.store, 'laptop says blocks')).toBe(true);
  });
});

describe('merge data loss: edited here, deleted for good elsewhere', () => {
  it('line labelled here while a card it joins was deleted for good elsewhere: the label is kept or reported', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    getBoard(l, l.root).arrows.find((a) => a.id === LINE)!.label = 'label typed offline';
    deleteCards(rm, rm.root, [5]); // the welcome note, with line 16 into the trash
    purge(rm, rm.trash[rm.trash.length - 1].id);
    const r = mergeStores(b, l, rm);
    const kept = mentions(r.store, 'label typed offline');
    const reported = r.conflicts.some((c) => c.what === 'line' || c.id === LINE);
    expect(kept || reported).toBe(true);
  });

  it('board renamed here while its board card was deleted for good elsewhere: the kept board can still be opened', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    getBoard(l, IDEAS_BOARD).name = 'Renamed offline';
    deleteCards(rm, rm.root, [IDEAS_CARD]);
    purge(rm, rm.trash[rm.trash.length - 1].id);
    expect(rm.boards[String(IDEAS_BOARD)]).toBeUndefined();
    const r = mergeStores(b, l, rm);
    expect(r.store.boards[String(IDEAS_BOARD)]?.name).toBe('Renamed offline');
    // The merge says the board "was kept" — so something must lead to it.
    const pointers: Card[] = [];
    for (const bd of Object.values(r.store.boards)) for (const c of bd.cards) if ('Board' in c.content && c.content.Board.board === IDEAS_BOARD) pointers.push(c);
    expect(pointers.length).toBeGreaterThan(0);
  });
});

describe('merge data loss: restore vs delete for good', () => {
  it('board card restored here while its trash item was emptied elsewhere: the merge keeps what it says it kept', () => {
    const b = sampleStore();
    deleteCards(b, b.root, [IDEAS_CARD]);
    const tid = b.trash[b.trash.length - 1].id;
    const l = clone(b);
    const rm = clone(b);
    restore(l, tid);
    purge(rm, tid);
    const r = mergeStores(b, l, rm);
    const said = r.conflicts.find((c) => c.what === 'card' && c.id === IDEAS_CARD && c.kind === 'edited-deleted');
    expect(said).toBeTruthy(); // the merge reports the restored board card "was kept"
    expect(card(r.store, IDEAS_CARD)).toBeTruthy();
    expect(r.store.boards[String(IDEAS_BOARD)]).toBeTruthy();
  });
});

describe('merge duplicates: lost save answer then an edit', () => {
  it('to-do saved (answer lost) then ticked here: one list, not two', () => {
    const b = sampleStore();
    const l = clone(b);
    const id = newId(l);
    getBoard(l, l.root).cards.push({ id, pos: [0, 0], width: 240, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content: { Todo: { title: 'Groceries', items: [{ text: 'milk', done: false }] } } });
    const rm = clone(l);
    const c = card(l, id)!;
    if ('Todo' in c.content) c.content.Todo.items[0].done = true;
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base.
    const r = mergeStores(clone(rm), l, rm);
    const lists = Object.values(r.store.boards).flatMap((bd) => bd.cards).filter((x) => 'Todo' in x.content && x.content.Todo.title.includes('Groceries'));
    expect(lists.length).toBe(1);
    expect(lists[0] && 'Todo' in lists[0].content && lists[0].content.Todo.items[0].done).toBe(true);
  });
});
