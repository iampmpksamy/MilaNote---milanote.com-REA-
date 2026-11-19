/**
 * Attack tests for mergeStores: id renumbering, references and the "identical new item" rule.
 * Every state is built with the same ops the app uses (see ui-workspace workspace.service.ts for
 * the defaults it creates: empty notes, untitled columns, "New Board" colour 0, free lines).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allIds, mergeStores } from './merge';
import {
  attachColumn,
  attachUnsorted,
  copyCardsInto,
  deepCopyBoard,
  deleteCards,
  findCard,
  freeArrow,
  getBoard,
  newArrow,
  newBoard,
  newId,
  purge,
  restore,
  sampleStore,
} from './ops';
import { type Card, type Content, isColumnContainer, type Store } from './types';

// ---------- helpers (copied from merge.spec.ts) ----------

const clone = <T>(x: T): T => structuredClone(x);

function addCard(s: Store, boardId: number, content: Content, pos: [number, number] = [0, 0]): number {
  const id = newId(s);
  getBoard(s, boardId).cards.push({ id, pos, width: 240, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content });
  return id;
}
const note = (text: string): Content => ({ Note: { text } });
function setText(s: Store, id: number, text: string) {
  const c = card(s, id);
  if (c && 'Note' in c.content) c.content.Note.text = text;
}
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
const liveTexts = (s: Store) => Object.values(s.boards).flatMap((b) => b.cards.flatMap((c) => ('Note' in c.content ? [c.content.Note.text] : [])));

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

/** What the app's toolbar "Board" does: a "New Board" (colour 0) plus its card on the current board. */
function appNewBoard(s: Store, parent: number): { board: number; card: number } {
  const board = newBoard(s, 'New Board', parent, 0);
  const c = addCard(s, parent, { Board: { board } });
  return { board, card: c };
}
/** What the app's "Line" tool does: a free line. */
function appFreeLine(s: Store, boardId: number, at: [number, number]): number {
  const id = newId(s);
  getBoard(s, boardId).arrows.push(freeArrow(id, [at[0] - 70, at[1] + 40], [at[0] + 70, at[1] - 40]));
  return id;
}
/** What addPicture does: the picture file is named after a fresh id. */
function appPicture(s: Store, boardId: number, aspect: number): { file: string; card: number } {
  // As the app names pictures since 3.0.0-alpha.5: the id plus a random part (unique across devices).
  const file = `${newId(s)}-${Math.random().toString(16).slice(2, 10)}.png`;
  const c = addCard(s, boardId, { Image: { file, caption: '', aspect } });
  return { file, card: c };
}
const allArrows = (s: Store) => [...Object.values(s.boards).flatMap((b) => b.arrows), ...s.trash.flatMap((t) => t.arrows)];

const ROOT = 1;
const IDEAS = 2;
const MOOD = 3;

afterEach(() => {
  vi.useRealTimers();
});

// ---------- the "identical new item" fingerprint wrongly merging different items ----------

describe('identical-new-item rule: different items wrongly merged', () => {
  it('free lines drawn on both sides with the same id: both lines survive', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lid = appFreeLine(l, ROOT, [100, 100]);
    const rid = appFreeLine(rm, ROOT, [900, 700]);
    expect(lid).toBe(rid);
    const r = mergeStores(b, l, rm);
    const free = getBoard(r.store, ROOT).arrows.filter((a) => a.from === 0 && a.to === 0);
    expect(free.length).toBe(2);
    expect(problems(r.store)).toEqual([]);
  });

  it('free line drawn here on one board and elsewhere on another board: the line drawn here is not lost', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    appFreeLine(l, IDEAS, [100, 100]);
    appFreeLine(rm, ROOT, [900, 700]);
    const r = mergeStores(b, l, rm);
    expect(getBoard(r.store, IDEAS).arrows.length).toBe(1);
    expect(getBoard(r.store, ROOT).arrows.filter((a) => a.from === 0).length).toBe(1);
  });

  it('new line between the same two cards on both sides: the label typed here is not lost', () => {
    const b = sampleStore();
    const [x, y] = getBoard(b, ROOT).cards.filter((c) => 'Note' in c.content).map((c) => c.id);
    const l = clone(b);
    const rm = clone(b);
    const lid = newId(l);
    getBoard(l, ROOT).arrows.push({ ...newArrow(lid, x, y), label: 'blocks release' });
    const rid = newId(rm);
    getBoard(rm, ROOT).arrows.push({ ...newArrow(rid, x, y), dashed: true });
    expect(lid).toBe(rid);
    const r = mergeStores(b, l, rm);
    expect(allArrows(r.store).some((a) => a.label === 'blocks release')).toBe(true);
  });

  it('two different "New Board"s created on both sides stay two boards', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lb = appNewBoard(l, ROOT);
    addCard(l, lb.board, note('phone plan'));
    const rb = appNewBoard(rm, ROOT);
    addCard(rm, rb.board, note('laptop plan'));
    expect(lb).toEqual(rb);
    const r = mergeStores(b, l, rm);
    const newBoards = Object.values(r.store.boards).filter((x) => x.name === 'New Board');
    expect(newBoards.length).toBe(2);
    expect(problems(r.store)).toEqual([]);
  });

  it('board created elsewhere is not pulled into the trash because this device trashed its own "New Board"', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lb = appNewBoard(l, ROOT);
    deleteCards(l, ROOT, [lb.card]); // phone: made a board, changed its mind, binned it
    const rb = appNewBoard(rm, ROOT);
    addCard(rm, rb.board, note('laptop plan')); // laptop: made a board and wrote in it
    const r = mergeStores(b, l, rm);
    // The laptop's board must still be reachable from Home (not only via the phone's trash).
    const laptopBoard = Object.values(r.store.boards).find((x) => x.cards.some((c) => 'Note' in c.content && c.content.Note.text === 'laptop plan'))!;
    expect(laptopBoard).toBeTruthy();
    const liveCard = Object.values(r.store.boards).some((x) => x.cards.some((c) => 'Board' in c.content && c.content.Board.board === laptopBoard.id));
    expect(liveCard).toBe(true);
    // Emptying the trash on the phone would otherwise destroy the laptop's writing.
    const after = clone(r.store);
    for (const t of [...after.trash]) purge(after, t.id);
    expect(texts(after)).toContain('laptop plan');
  });

  it('an empty note added on another board elsewhere stays on that board with its line', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lid = addCard(l, IDEAS, note(''), [10, 10]); // phone: new note on "Project ideas"
    const rid = addCard(rm, MOOD, note(''), [50, 50]); // laptop: new note on "Mood & inspiration"
    expect(lid).toBe(rid);
    const anchor = addCard(rm, MOOD, note('moodboard anchor'));
    getBoard(rm, MOOD).arrows.push(newArrow(newId(rm), anchor, rid)); // and a line to it
    const r = mergeStores(b, l, rm);
    expect(getBoard(r.store, MOOD).cards.length).toBe(2);
    expect(getBoard(r.store, MOOD).arrows.length).toBe(1);
    expect(getBoard(r.store, IDEAS).cards.length).toBe(3);
  });

  it('pictures added on both sides keep distinct picture files', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const lp = appPicture(l, ROOT, 0.75);
    const rp = appPicture(rm, ROOT, 1.5);
    expect(lp.card).toBe(rp.card);
    const r = mergeStores(b, l, rm);
    const files = Object.values(r.store.boards).flatMap((x) => x.cards.flatMap((c) => ('Image' in c.content ? [c.content.Image.file] : [])));
    expect(files.length).toBe(2);
    expect(new Set(files).size).toBe(2); // otherwise both cards show whichever upload of "N.png" won
  });

  it('two different items trashed in the same second on both sides do not share one trash item', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const b = sampleStore();
    const quick = getBoard(b, ROOT).unsorted[0];
    const other = getBoard(b, ROOT).cards.find((c) => 'Note' in c.content && c.container === 'Canvas')!.id;
    const l = clone(b);
    const rm = clone(b);
    deleteCards(l, ROOT, [other]); // phone bins a canvas note
    deleteCards(rm, ROOT, [quick]); // laptop bins the Unsorted note, same second
    expect(l.trash[0].id).toBe(rm.trash[0].id);
    const r = mergeStores(b, l, rm);
    expect(r.store.trash.length).toBe(2);
    // Restoring what is in the trash must give a consistent board.
    const after = clone(r.store);
    for (const t of [...after.trash]) restore(after, t.id);
    expect(problems(after)).toEqual([]);
  });
});

// ---------- the same item wrongly split (an earlier save that reached the server) ----------

describe('identical-new-item rule: the same item wrongly split', () => {
  it('note saved (answer lost) then typed into: one note, no stale duplicate', () => {
    const b = sampleStore();
    const l = clone(b);
    const id = addCard(l, ROOT, note('')); // new empty note, autosaved...
    const rm = clone(l); // ...the save reached the server but its answer was lost
    setText(l, id, 'Call the printer about Friday'); // the user keeps typing
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base.
    const r = mergeStores(clone(rm), l, rm);
    const empties = getBoard(r.store, ROOT).cards.filter((c) => 'Note' in c.content && c.content.Note.text === '');
    expect(empties.length).toBe(0);
    expect(texts(r.store).filter((t) => t === 'Call the printer about Friday').length).toBe(1);
  });

  it('board saved (answer lost) then renamed: one board, not an extra empty "New Board"', () => {
    const b = sampleStore();
    const l = clone(b);
    const nb = appNewBoard(l, ROOT);
    const rm = clone(l);
    l.boards[String(nb.board)].name = 'Trip to Lisbon';
    addCard(l, nb.board, note('flights'));
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base.
    const r = mergeStores(clone(rm), l, rm);
    const names = Object.values(r.store.boards).map((x) => x.name);
    expect(names.filter((n) => n === 'New Board' || n === 'Trip to Lisbon').length).toBe(1);
  });

  it('line saved (answer lost), then its card moved to the trash here: the line stays with the card in the trash', () => {
    const b = sampleStore();
    const l = clone(b);
    const n1 = addCard(l, ROOT, note('step 1'));
    const n2 = addCard(l, ROOT, note('step 2'));
    const line = newId(l);
    getBoard(l, ROOT).arrows.push(newArrow(line, n1, n2));
    const rm = clone(l); // earlier save reached the server
    deleteCards(l, ROOT, [n1]); // then the phone binned step 1 (the line goes into the trash with it)
    const trashId = l.trash[l.trash.length - 1].id;
    expect(l.trash[l.trash.length - 1].arrows.map((a) => a.id)).toEqual([line]);
    const r = mergeStores(b, l, rm);
    expect(allArrows(r.store).some((a) => a.id === line)).toBe(true);
    // Restore gives back the line, as it would have without the lost answer.
    const after = clone(r.store);
    restore(after, trashId);
    expect(getBoard(after, ROOT).arrows.some((a) => a.from === n1 && a.to === n2)).toBe(true);
  });
});

// ---------- references to ids that no longer exist locally ----------

describe('dangling local references re-pointed at the other side’s new ids', () => {
  it('trashed note from a board deleted for good offline does not restore into a different board created elsewhere', () => {
    const b = sampleStore();
    const l = clone(b);
    // Phone, offline: makes "Scratch", writes a note in it, bins the note, then bins and empties the board.
    const scratch = newBoard(l, 'Scratch', ROOT, 5);
    const scratchCard = addCard(l, ROOT, { Board: { board: scratch } });
    const n = addCard(l, scratch, note('phone scratch note'));
    deleteCards(l, scratch, [n]);
    const noteTrash = l.trash[l.trash.length - 1].id;
    deleteCards(l, ROOT, [scratchCard]);
    purge(l, l.trash[l.trash.length - 1].id);
    expect(l.boards[String(scratch)]).toBeUndefined();
    // Laptop: makes a board that took the same id.
    const rm = clone(b);
    const laptop = newBoard(rm, 'Laptop private board', ROOT, 2);
    addCard(rm, ROOT, { Board: { board: laptop } });
    expect(laptop).toBe(scratch);
    const r = mergeStores(b, l, rm);
    const t = r.store.trash.find((x) => x.cards.some((c) => 'Note' in c.content && c.content.Note.text === 'phone scratch note'))!;
    expect(t).toBeTruthy();
    expect(t.board).not.toBe(laptop);
    expect(noteTrash).toBeGreaterThan(0);
  });
});

// ---------- renumbering cascades that should work (coverage) ----------

describe('renumbering cascades (controls)', () => {
  it('nested boards created offline vs. nested boards elsewhere with the same ids', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const a = newBoard(l, 'Phone A', ROOT, 1);
    addCard(l, ROOT, { Board: { board: a } });
    const a2 = newBoard(l, 'Phone A2', a, 1);
    addCard(l, a, { Board: { board: a2 } });
    addCard(l, a2, note('deep phone'));
    const c = newBoard(rm, 'Laptop C', ROOT, 1);
    addCard(rm, ROOT, { Board: { board: c } });
    const c2 = newBoard(rm, 'Laptop C2', c, 1);
    addCard(rm, c, { Board: { board: c2 } });
    addCard(rm, c2, note('deep laptop'));
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    const pa2 = Object.values(r.store.boards).find((x) => x.name === 'Phone A2')!;
    const pa = Object.values(r.store.boards).find((x) => x.name === 'Phone A')!;
    expect(pa2.parent).toBe(pa.id);
    expect(pa2.cards.some((k) => 'Note' in k.content && k.content.Note.text === 'deep phone')).toBe(true);
    expect(liveTexts(r.store)).toEqual(expect.arrayContaining(['deep phone', 'deep laptop']));
  });

  it('deepCopyBoard / copyCardsInto offline vs. new cards and lines elsewhere', () => {
    const b = sampleStore();
    const l = clone(b);
    const rm = clone(b);
    const ideasCard = getBoard(l, ROOT).cards.find((k) => 'Board' in k.content && k.content.Board.board === IDEAS)!;
    copyCardsInto(l, ROOT, [clone(ideasCard)], [], [24, 24], 0, false);
    const col = getBoard(l, ROOT).cards.find((k) => 'Column' in k.content)!;
    const kids = getBoard(l, ROOT).cards.filter((k) => isColumnContainer(k.container) && k.container.Column === col.id);
    copyCardsInto(l, MOOD, [clone(col), ...clone(kids)], [], [0, 0], 0, false);
    deepCopyBoard(l, MOOD, ROOT, 0);
    for (let i = 0; i < 12; i++) addCard(rm, ROOT, note(`laptop ${i}`));
    const x = addCard(rm, ROOT, note('lx'));
    const y = addCard(rm, ROOT, note('ly'));
    getBoard(rm, ROOT).arrows.push(newArrow(newId(rm), x, y));
    attachUnsorted(getBoard(rm, ROOT), x);
    const r = mergeStores(b, l, rm);
    expect(problems(r.store)).toEqual([]);
    const copies = Object.values(r.store.boards).filter((k) => k.name === 'Project ideas');
    expect(copies.length).toBe(2);
    for (const k of copies) expect(k.cards.length).toBe(2);
    const moodCopies = Object.values(r.store.boards).filter((k) => k.name === 'Mood & inspiration');
    expect(moodCopies.length).toBe(2);
    for (const k of moodCopies) {
      const c2 = k.cards.find((q) => 'Column' in q.content)!;
      expect(c2 && 'Column' in c2.content && c2.content.Column.children.length).toBe(3);
    }
  });

  it('every kind vs every kind with the same id: nothing lost, all references valid', () => {
    const kinds = ['board', 'card', 'line', 'trash'] as const;
    for (const lk of kinds)
      for (const rk of kinds) {
        const b = sampleStore();
        const pre = addCard(b, ROOT, note('victim'));
        const pre2 = addCard(b, ROOT, note('victim2'));
        const make = (s: Store, k: (typeof kinds)[number], tag: string) => {
          if (k === 'board') {
            const nb = newBoard(s, `${tag} board`, ROOT, 0);
            addCard(s, ROOT, { Board: { board: nb } });
            addCard(s, nb, note(`${tag} inside`));
          } else if (k === 'card') {
            const col = addCard(s, ROOT, { Column: { title: `${tag} col`, children: [] } });
            const n = addCard(s, ROOT, note(`${tag} kid`));
            attachColumn(getBoard(s, ROOT), n, col, 0);
          } else if (k === 'line') {
            getBoard(s, ROOT).arrows.push({ ...newArrow(newId(s), pre, pre2), label: tag });
          } else {
            deleteCards(s, ROOT, [tag === 'L' ? pre : pre2]);
          }
        };
        const l = clone(b);
        const rm = clone(b);
        make(l, lk, 'L');
        make(rm, rk, 'R');
        const r = mergeStores(b, l, rm);
        expect(problems(r.store), `${lk} vs ${rk}`).toEqual([]);
        for (const t of [...texts(l), ...texts(rm)]) expect(texts(r.store), `${lk} vs ${rk}`).toContain(t);
        expect(r.store.next_id).toBeGreaterThanOrEqual(Math.max(...allIds(r.store)));
        const back = mergeStores(r.store, clone(r.store), clone(r.store));
        expect(back.changed).toBe(false);
      }
  });
});
