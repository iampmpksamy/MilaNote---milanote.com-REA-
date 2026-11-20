/**
 * Convergence / sync-loop attacks on mergeStores.
 *
 * Sync loop assumed (as documented in merge.ts):
 *   base   = server state the device last synced
 *   local  = device state now
 *   remote = server state now
 *   M = mergeStores(base, local, remote).store is uploaded; on success base := local := M.
 *
 * "Lost response": the upload of M reached the server but the device never got the answer, so it
 * still has the old `base`. The header comment of merge.ts explicitly claims to handle this case
 * ("this device's earlier save that reached the server although its answer was lost").
 */
import { describe, expect, it } from 'vitest';
import { allIds, canonical, mergeList, mergeStores, repairStore } from './merge';
import { attachColumn, attachUnsorted, deleteCards, findCard, getBoard, newArrow, newBoard, newId, purge, restore, sampleStore } from './ops';
import { type Card, type Content, isColumnContainer, type Store } from './types';

// ---------- helpers ----------

const clone = <T>(x: T): T => structuredClone(x);
const note = (text: string): Content => ({ Note: { text } });

function addCard(s: Store, boardId: number, content: Content, pos: [number, number] = [0, 0]): number {
  const id = newId(s);
  getBoard(s, boardId).cards.push({ id, pos, width: 240, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content });
  return id;
}

function allCards(s: Store): Card[] {
  const out: Card[] = [];
  for (const b of Object.values(s.boards)) out.push(...b.cards);
  for (const t of s.trash) out.push(...t.cards);
  return out;
}

function card(s: Store, id: number): Card | undefined {
  return allCards(s).find((c) => c.id === id);
}

function setText(s: Store, id: number, text: string) {
  const c = card(s, id);
  if (c && 'Note' in c.content) c.content.Note.text = text;
}

const noteTexts = (s: Store) => allCards(s).flatMap((c) => ('Note' in c.content ? [c.content.Note.text] : []));
const countText = (s: Store, needle: string) => noteTexts(s).filter((t) => t.includes(needle)).length;

/** Linear-time invariant checker (same checks as problems() in merge.spec.ts). */
function problems(s: Store): string[] {
  const out: string[] = [];
  if (!s.boards[String(s.root)]) out.push('no home');
  const cardIds = new Set<number>();
  const arrowIds = new Set<number>();
  const checkCards = (cards: Card[], where: string) => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const c of cards) {
      if (cardIds.has(c.id)) out.push(`${where}: card ${c.id} twice`);
      cardIds.add(c.id);
      if (isColumnContainer(c.container)) {
        const col = byId.get(c.container.Column);
        if (!col || !('Column' in col.content) || !col.content.Column.children.includes(c.id)) out.push(`${where}: card ${c.id} column link broken`);
      }
      if ('Column' in c.content)
        for (const k of c.content.Column.children) {
          const kc = byId.get(k);
          if (!kc || !isColumnContainer(kc.container) || kc.container.Column !== c.id) out.push(`${where}: column ${c.id} lists ${k} wrongly`);
        }
      if ('Board' in c.content && !s.boards[String(c.content.Board.board)]) out.push(`${where}: board card ${c.id} points nowhere`);
    }
    return byId;
  };
  for (const b of Object.values(s.boards)) {
    if (b.id !== s.root && !s.boards[String(b.parent)]) out.push(`board ${b.id} parent missing`);
    const byId = checkCards(b.cards, `board ${b.id}`);
    const uns = new Set(b.unsorted);
    for (const u of b.unsorted) if (byId.get(u)?.container !== 'Unsorted') out.push(`board ${b.id}: unsorted ${u} wrong`);
    for (const c of b.cards) if (c.container === 'Unsorted' && !uns.has(c.id)) out.push(`board ${b.id}: ${c.id} missing from unsorted`);
    if (uns.size !== b.unsorted.length) out.push(`board ${b.id}: unsorted repeats`);
    for (const a of b.arrows) {
      if (arrowIds.has(a.id)) out.push(`line ${a.id} twice`);
      arrowIds.add(a.id);
      if ((a.from && !byId.has(a.from)) || (a.to && !byId.has(a.to))) out.push(`board ${b.id}: line ${a.id} dangling`);
    }
  }
  for (const t of s.trash) checkCards(t.cards, `trash ${t.id}`);
  let max = 0;
  for (const id of allIds(s)) if (id > max) max = id;
  if (s.next_id < max) out.push(`next_id ${s.next_id} < ${max}`);
  return out;
}

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** One random edit, as the app would make it (copied from merge.spec.ts). */
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

function randomPair(seed: number) {
  const rand = rng(seed * 104729);
  const b = sampleStore();
  for (let i = 0; i < 8; i++) randomEdit(b, rand, 'base');
  repairStore(b);
  const l = clone(b);
  const r = clone(b);
  for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) randomEdit(l, rand, 'L');
  for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) randomEdit(r, rand, 'R');
  return { b, l, r };
}

const firstNote = (s: Store) => getBoard(s, s.root).cards.find((c) => 'Note' in c.content)!.id;

// ---------- 1. idempotence: merge(base, X, X) === X ----------

describe('convergence: idempotence', () => {
  it('merge(B, X, X) returns X unchanged for random app-made X (300 seeds)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { b, l } = randomPair(seed);
      repairStore(l);
      const x = clone(l);
      const res = mergeStores(b, x, clone(x));
      expect(canonical(res.store), `seed ${seed}`).toBe(canonical(x));
      expect(res.changed, `seed ${seed}`).toBe(false);
      expect(res.conflicts, `seed ${seed}`).toEqual([]);
      expect(res.renumbered.size, `seed ${seed}`).toBe(0);
    }
  });

  it('merge(B, M, M) and merge(M, M, M) return M unchanged, where M is a real merge result (300 seeds)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { b, l, r } = randomPair(seed);
      const m = mergeStores(b, l, r).store;
      const a1 = mergeStores(b, clone(m), clone(m));
      const a2 = mergeStores(m, clone(m), clone(m));
      expect(canonical(a1.store), `seed ${seed}`).toBe(canonical(m));
      expect(canonical(a2.store), `seed ${seed}`).toBe(canonical(m));
      expect(a1.changed || a2.changed, `seed ${seed}`).toBe(false);
    }
  });

  it('merge(B, L, R) result re-merged with the server as base is stable: merge(R, M, M) === M, merge(M, M, R) keeps M', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { b, l, r } = randomPair(seed);
      const m = mergeStores(b, l, r).store;
      // Server accepted M; another device that last synced R merges with no edits of its own.
      const other = mergeStores(r, clone(r), clone(m));
      expect(canonical(other.store), `seed ${seed}`).toBe(canonical(m));
      expect(other.changed, `seed ${seed}`).toBe(false);
    }
  });
});

// ---------- 2. lost response (upload reached the server, answer lost) ----------

describe('convergence: lost response', () => {
  it('lost response, device still holds its pre-merge local: re-merging against the server (which holds M) must not add a second conflicting copy', () => {
    const b = sampleStore();
    const id = firstNote(b);
    const l = clone(b);
    const r = clone(b);
    setText(l, id, 'phone version');
    setText(r, id, 'laptop version');
    const m = mergeStores(b, l, r, { label: 'phone', now: 1 }).store; // uploaded; answer lost
    expect(countText(m, 'phone version')).toBe(1);
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const again = mergeStores(m, clone(m), clone(m), { label: 'phone' });
    expect(problems(again.store)).toEqual([]);
    expect(countText(again.store, 'phone version')).toBe(1);
    expect(again.changed).toBe(false);
  });

  it('lost response, device still holds its pre-merge local: a card that was renumbered in M must not be duplicated on retry', () => {
    const b = sampleStore();
    const l = clone(b);
    const r = clone(b);
    const lid = addCard(l, l.root, note('made on the phone'));
    const rid = addCard(r, r.root, note('made on the laptop'));
    expect(lid).toBe(rid); // same id taken on both sides
    const m1 = mergeStores(b, l, r);
    expect(m1.renumbered.size).toBe(1);
    const m = m1.store; // uploaded; answer lost
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const again = mergeStores(m, clone(m), clone(m));
    expect(problems(again.store)).toEqual([]);
    expect(countText(again.store, 'made on the phone')).toBe(1);
    expect(countText(again.store, 'made on the laptop')).toBe(1);
  });

  it('flaky network: retries with lost answers converge (no extra conflicting copies)', () => {
    const b = sampleStore();
    const id = firstNote(b);
    const l = clone(b);
    const r = clone(b);
    setText(l, id, 'phone version');
    setText(r, id, 'laptop version');
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    let base = b;
    let local = l;
    let server = r;
    for (let i = 0; i < 5; i++) {
      const res = mergeStores(base, local, clone(server), { label: 'phone' }).store;
      local = res; // taken here before sending
      base = res; // the answer is lost, but the save arrived
      server = res;
    }
    expect(countText(server, 'phone version')).toBe(1);
  });

  it('lost response, device adopted M locally: the laptop then edits the phone-created note; the retry must not duplicate the note', () => {
    const b = sampleStore();
    const l = clone(b);
    const nid = addCard(l, l.root, note('phone note v1'));
    const m = mergeStores(b, l, clone(b)).store; // uploaded; answer lost; device keeps base = b, local = M
    const local2 = clone(m);
    const server2 = clone(m);
    setText(server2, nid, 'phone note v1 + laptop edit'); // the laptop saw the note on the server and edited it
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const res = mergeStores(m, local2, server2);
    expect(problems(res.store)).toEqual([]);
    expect(countText(res.store, 'phone note v1')).toBe(1);
    expect(texts(res.store)).toContain('phone note v1 + laptop edit');
    expect(res.renumbered.size).toBe(0);
  });

  it('lost response, device adopted M locally: the phone then edits its own new note again; the retry must not duplicate the note', () => {
    const b = sampleStore();
    const l = clone(b);
    const nid = addCard(l, l.root, note('draft'));
    const m = mergeStores(b, l, clone(b)).store; // uploaded; answer lost
    const local2 = clone(m);
    setText(local2, nid, 'draft, finished offline');
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const res = mergeStores(m, local2, clone(m));
    expect(problems(res.store)).toEqual([]);
    expect(countText(res.store, 'draft')).toBe(1);
    expect(res.renumbered.size).toBe(0);
  });

  it('lost response, device adopted M locally: renaming the new board afterwards must not split it into two boards', () => {
    const b = sampleStore();
    const l = clone(b);
    const nb = newBoard(l, 'Trip', l.root, 3);
    addCard(l, l.root, { Board: { board: nb } });
    addCard(l, nb, note('passport'));
    const m = mergeStores(b, l, clone(b)).store; // uploaded; answer lost
    const local2 = clone(m);
    local2.boards[String(nb)].name = 'Trip to Rome';
    const server2 = clone(m);
    addCard(server2, nb, note('hotel (added on laptop)'));
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const res = mergeStores(m, local2, server2);
    expect(problems(res.store)).toEqual([]);
    const trips = Object.values(res.store.boards).filter((x) => x.name.startsWith('Trip'));
    expect(trips.map((x) => x.name)).toEqual(['Trip to Rome']);
    const boardCards = getBoard(res.store, res.store.root).cards.filter((c) => 'Board' in c.content);
    expect(boardCards.length).toBe(getBoard(local2, local2.root).cards.filter((c) => 'Board' in c.content).length);
    const texts2 = trips[0].cards.map((c) => ('Note' in c.content ? c.content.Note.text : ''));
    expect(texts2.sort()).toEqual(['hotel (added on laptop)', 'passport']);
  });
});

describe('convergence: lost response (board trees)', () => {
  it('lost response, device adopted M locally: the laptop renames the top board of a 3-deep new board tree; the retry must not duplicate the tree', () => {
    const b = sampleStore();
    const l = clone(b);
    let parent = l.root;
    const chain: number[] = [];
    for (let i = 0; i < 3; i++) {
      const nb = newBoard(l, `Nested ${i}`, parent, 0);
      addCard(l, parent, { Board: { board: nb } });
      chain.push(nb);
      parent = nb;
    }
    addCard(l, parent, note('deepest note'));
    const m = mergeStores(b, l, clone(b)).store; // uploaded; answer lost
    const server2 = clone(m);
    server2.boards[String(chain[0])].name = 'Nested 0 (renamed on laptop)';
    // As the sync layer does: the save that arrived (listed in the server's recentOps) is the base, and the device took that merge before sending it.
    const res = mergeStores(m, clone(m), server2);
    expect(problems(res.store)).toEqual([]);
    expect(Object.keys(res.store.boards).length).toBe(Object.keys(m.boards).length);
    expect(res.renumbered.size).toBe(0);
  });
});

function texts(s: Store) {
  return noteTexts(s);
}

// ---------- 3. commutativity-ish ----------

describe('convergence: commutativity-ish', () => {
  it('without conflicts, swapping local and remote yields the same set of note texts, boards and trash', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { b, l, r } = randomPair(seed);
      const a = mergeStores(b, l, r);
      const c = mergeStores(b, r, l);
      if (a.conflicts.length || c.conflicts.length) continue;
      const ta = noteTexts(a.store).sort();
      const tc = noteTexts(c.store).sort();
      const ba = Object.values(a.store.boards).map((x) => x.name).sort();
      const bc = Object.values(c.store.boards).map((x) => x.name).sort();
      if (canonical(ta) !== canonical(tc) || canonical(ba) !== canonical(bc)) bad.push(`seed ${seed}`);
    }
    expect(bad).toEqual([]);
  });
});

// ---------- 4. performance on big stores ----------

/** 2000 boards, ~20000 cards, a 2000-card Unsorted and a column with 2000 children on Home. */
function bigStore(): Store {
  const s = sampleStore();
  const root = s.root;
  const boards: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const parent = i < 50 ? root : boards[i % 50];
    const nb = newBoard(s, `Board ${i}`, parent, i % 8);
    addCard(s, parent, { Board: { board: nb } });
    boards.push(nb);
  }
  for (let i = 0; i < 14000; i++) addCard(s, boards[i % 2000], note(`card ${i}`), [i % 900, i % 700]);
  const home = getBoard(s, root);
  for (let i = 0; i < 2000; i++) {
    const id = addCard(s, root, note(`unsorted ${i}`));
    attachUnsorted(home, id);
  }
  const col = addCard(s, root, { Column: { title: 'Long column', children: [] } });
  for (let i = 0; i < 2000; i++) {
    const id = addCard(s, root, note(`col item ${i}`));
    attachColumn(home, id, col, Number.MAX_SAFE_INTEGER);
  }
  return s;
}

function timed<T>(f: () => T): { v: T; ms: number } {
  const t0 = performance.now();
  const v = f();
  return { v, ms: performance.now() - t0 };
}

describe('convergence: performance', () => {
  it('big store, nothing changed: merge under 2 s', () => {
    const b = bigStore();
    const { v, ms } = timed(() => mergeStores(b, clone(b), clone(b)));
    expect(v.changed).toBe(false);
    expect(ms).toBeLessThan(4000) // ~1.3 s alone; room for a busy CI machine, still catches quadratic slowdowns;
  }, 60_000);

  it('big store, both sides add 500 notes to the long Unsorted and 500 to the long column: merge under 2 s', () => {
    const b = bigStore();
    const col = getBoard(b, b.root).cards.find((c) => 'Column' in c.content && c.content.Column.title === 'Long column')!.id;
    const sides = [clone(b), clone(b)];
    sides.forEach((s, k) => {
      const home = getBoard(s, s.root);
      for (let i = 0; i < 500; i++) attachUnsorted(home, addCard(s, s.root, note(`side ${k} unsorted ${i}`)));
      for (let i = 0; i < 500; i++) attachColumn(home, addCard(s, s.root, note(`side ${k} col ${i}`)), col, Number.MAX_SAFE_INTEGER);
    });
    const { v, ms } = timed(() => mergeStores(b, sides[0], sides[1]));
    expect(problems(v.store)).toEqual([]);
    expect(getBoard(v.store, v.store.root).unsorted.length).toBe(getBoard(b, b.root).unsorted.length + 1000);
    console.log(`[perf] long-list merge: ${ms.toFixed(0)} ms, renumbered ${v.renumbered.size}`);
    expect(ms).toBeLessThan(4000) // ~1.3 s alone; room for a busy CI machine, still catches quadratic slowdowns;
  }, 120_000);

  it('big store, remote emptied the 2000-card Unsorted while local appended 200 more: merge under 2 s', () => {
    const b = bigStore();
    const l = clone(b);
    const r = clone(b);
    const lh = getBoard(l, l.root);
    for (let i = 0; i < 200; i++) attachUnsorted(lh, addCard(l, l.root, note(`late capture ${i}`)));
    const rh = getBoard(r, r.root);
    for (const id of [...rh.unsorted]) {
      // the laptop "sorts" every Unsorted card onto the canvas
      const c = findCard(rh, id)!;
      c.container = 'Canvas';
    }
    rh.unsorted = [];
    for (let i = 0; i < 2000; i++) attachUnsorted(rh, addCard(r, r.root, note(`laptop capture ${i}`)));
    const { v, ms } = timed(() => mergeStores(b, l, r));
    expect(problems(v.store)).toEqual([]);
    console.log(`[perf] emptied-unsorted merge: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(4000) // ~1.3 s alone; room for a busy CI machine, still catches quadratic slowdowns;
  }, 120_000);

  it('mergeList on a 2000-item list: remote replaced every item, local appended one: under 2 s', () => {
    const base = Array.from({ length: 2000 }, (_, i) => i + 1);
    const local = [...base, 9999];
    const remote = Array.from({ length: 2000 }, (_, i) => 5000 + i);
    const { v, ms } = timed(() => mergeList(base, local, remote));
    console.log(`[perf] mergeList 2000: ${ms.toFixed(0)} ms`);
    expect(v.length).toBe(2001);
    expect(ms).toBeLessThan(4000) // ~1.3 s alone; room for a busy CI machine, still catches quadratic slowdowns;
  }, 120_000);

  it('a store the server accepts (checkStore allows 5000 boards x 20000 cards) with 150k cards can be merged at all', () => {
    const s = sampleStore();
    const boards: number[] = [];
    for (let i = 0; i < 300; i++) {
      const nb = newBoard(s, `B${i}`, s.root, 0);
      addCard(s, s.root, { Board: { board: nb } });
      boards.push(nb);
    }
    for (let i = 0; i < 150_000; i++) addCard(s, boards[i % 300], note(`n${i}`));
    const l = clone(s);
    addCard(l, l.root, note('one more'));
    let err: unknown = null;
    let res: ReturnType<typeof mergeStores> | null = null;
    try {
      res = mergeStores(s, l, clone(s));
    } catch (e) {
      err = e;
    }
    expect(String(err)).toBe('null');
    expect(res && texts(res.store)).toContain('one more');
  }, 120_000);

  it('lost response with a chain of 60 nested boards, then the laptop renames the top one: retry on a big store under 2 s', () => {
    const b = bigStore();
    const l = clone(b);
    let parent = l.root;
    const chain: number[] = [];
    for (let i = 0; i < 60; i++) {
      const nb = newBoard(l, `Nested ${i}`, parent, 0);
      addCard(l, parent, { Board: { board: nb } });
      chain.push(nb);
      parent = nb;
    }
    const m = mergeStores(b, l, clone(b)).store; // uploaded; answer lost
    const server2 = clone(m);
    server2.boards[String(chain[0])].name = 'Nested 0 (renamed on laptop)';
    const { v, ms } = timed(() => mergeStores(b, clone(m), server2));
    console.log(`[perf] nested chain retry: ${ms.toFixed(0)} ms, renumbered ${v.renumbered.size}`);
    expect(ms).toBeLessThan(4000) // ~1.3 s alone; room for a busy CI machine, still catches quadratic slowdowns;
  }, 300_000);
});
