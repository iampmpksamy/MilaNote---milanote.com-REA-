import { describe, expect, it } from 'vitest';
import { checkStore } from './check';
import { mergeStores } from './merge';
import { getBoard, newId, sampleStore } from './ops';
import type { Card, Content, Store } from './types';

// Merging the card kinds added in 3.0.0-alpha.6.
const clone = <T>(x: T): T => structuredClone(x);
function add(s: Store, content: Content): number {
  const id = newId(s);
  getBoard(s, s.root).cards.push({ id, pos: [0, 0], width: 300, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content });
  return id;
}
const card = (s: Store, id: number) => getBoard(s, s.root).cards.find((c) => c.id === id) as Card;
const data = <T>(s: Store, id: number) => Object.values(card(s, id).content)[0] as T;
const copies = (s: Store) => getBoard(s, s.root).cards.filter((c) => JSON.stringify(c.content).includes('Conflicting copy'));

describe('merging the new card kinds', () => {
  it('comments posted on both devices are all kept, without a conflict', () => {
    const b = sampleStore();
    const id = add(b, { Comment: { entries: [{ text: 'first', author: 'Ann', at: 1 }], resolved: false } });
    const l = clone(b);
    const r = clone(b);
    data<{ entries: unknown[] }>(l, id).entries.push({ text: 'from the phone', author: 'Ann', at: 2 });
    data<{ entries: unknown[] }>(r, id).entries.push({ text: 'from the laptop', author: 'Bob', at: 3 });
    const m = mergeStores(b, l, r);
    expect(data<{ entries: { text: string }[] }>(m.store, id).entries.map((e) => e.text).sort()).toEqual(['first', 'from the laptop', 'from the phone']);
    expect(m.conflicts).toEqual([]);
  });

  it('strokes drawn on both devices are all kept; a stroke erased on one goes', () => {
    const b = sampleStore();
    const s0 = { color: '#000000', width: 4, points: [0, 0, 10, 10] };
    const id = add(b, { Sketch: { strokes: [s0], aspect: 0.75, background: true } });
    const l = clone(b);
    const r = clone(b);
    data<{ strokes: unknown[] }>(l, id).strokes.push({ color: '#ff0000', width: 4, points: [1, 1, 2, 2] });
    data<{ strokes: unknown[] }>(r, id).strokes.splice(0, 1, { color: '#0000ff', width: 4, points: [5, 5, 6, 6] });
    const m = mergeStores(b, l, r);
    expect(data<{ strokes: { color: string }[] }>(m.store, id).strokes.map((x) => x.color).sort()).toEqual(['#0000ff', '#ff0000']);
  });

  it('different table cells edited on each device: both edits; the same cell: a conflicting copy', () => {
    const b = sampleStore();
    const id = add(b, { Table: { title: 'Plan', cells: [['a', 'b'], ['c', 'd']] } });
    const l = clone(b);
    const r = clone(b);
    data<{ cells: string[][] }>(l, id).cells[0][0] = 'A phone';
    data<{ cells: string[][] }>(r, id).cells[1][1] = 'D laptop';
    let m = mergeStores(b, l, r);
    expect(data<{ cells: string[][] }>(m.store, id).cells).toEqual([['A phone', 'b'], ['c', 'D laptop']]);
    expect(copies(m.store)).toEqual([]);
    data<{ cells: string[][] }>(r, id).cells[0][0] = 'A laptop';
    m = mergeStores(b, l, r);
    expect(data<{ cells: string[][] }>(m.store, id).cells[0][0]).toBe('A laptop');
    expect(copies(m.store).length).toBe(1);
  });

  it('a conflict in every new kind leaves a conflicting copy (nothing is lost) and the result passes the server check', () => {
    const kinds: [Content, (c: Content) => void, (c: Content) => void][] = [
      [{ Heading: { text: 'H', size: 1 } }, (c) => ('Heading' in c ? (c.Heading.text = 'phone') : 0), (c) => ('Heading' in c ? (c.Heading.text = 'laptop') : 0)],
      [{ Color: { hex: '#111111', name: 'x' } }, (c) => ('Color' in c ? Object.assign(c.Color, { hex: '#222222', name: 'phone' }) : 0), (c) => ('Color' in c ? Object.assign(c.Color, { hex: '#333333', name: 'laptop' }) : 0)],
      [{ Document: { title: 'D', text: 'x' } }, (c) => ('Document' in c ? (c.Document.text = 'phone') : 0), (c) => ('Document' in c ? (c.Document.text = 'laptop') : 0)],
      [{ Audio: { file: '1-aa.webm', title: 'a', duration: 1 } }, (c) => ('Audio' in c ? (c.Audio.title = 'phone') : 0), (c) => ('Audio' in c ? (c.Audio.title = 'laptop') : 0)],
      [{ Video: { url: '', file: '', title: 'v', aspect: 0.5 } }, (c) => ('Video' in c ? Object.assign(c.Video, { url: 'https://youtu.be/a', title: 'phone' }) : 0), (c) => ('Video' in c ? Object.assign(c.Video, { url: 'https://youtu.be/b', title: 'laptop' }) : 0)],
      [{ Map: { query: 'q', label: 'L', lat: 1, lng: 1, zoom: 10 } }, (c) => ('Map' in c ? (c.Map.label = 'phone') : 0), (c) => ('Map' in c ? (c.Map.label = 'laptop') : 0)],
    ];
    for (const [content, onL, onR] of kinds) {
      const b = sampleStore();
      const id = add(b, content);
      const l = clone(b);
      const r = clone(b);
      onL(card(l, id).content);
      onR(card(r, id).content);
      const m = mergeStores(b, l, r, { label: 'phone' });
      const kind = Object.keys(content)[0];
      expect(copies(m.store).length, kind).toBe(1);
      expect(JSON.stringify(m.store), kind).toContain('phone');
      expect(JSON.stringify(m.store), kind).toContain('laptop');
      expect(checkStore(clone(m.store)).ok, kind).toBe(true);
    }
  });
});
