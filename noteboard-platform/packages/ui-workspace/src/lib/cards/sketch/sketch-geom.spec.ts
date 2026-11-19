import type { Stroke } from '@noteboard/board-model';
import { countNumbers, eraseAlong, inkColor, pushPoint, smoothPath, strokeHit, strokesToCard, thin } from './sketch-geom';

describe('sketch geometry', () => {
  it('drops points closer than the step and rounds to one decimal', () => {
    const p: number[] = [];
    expect(pushPoint(p, 10.04, 20.06)).toBe(true);
    expect(pushPoint(p, 10.5, 20.5)).toBe(false); // 0.6 away
    expect(pushPoint(p, 12.26, 20.01)).toBe(true);
    expect(p).toEqual([10, 20.1, 12.3, 20]);
  });

  it('thins a dense line but keeps both ends', () => {
    const dense: number[] = [];
    for (let i = 0; i <= 100; i++) dense.push(i * 0.25, 5);
    const t = thin(dense);
    expect(t.slice(0, 2)).toEqual([0, 5]);
    expect(t.slice(-2)).toEqual([25, 5]);
    expect(t.length).toBeLessThan(dense.length / 4);
    for (let i = 2; i + 1 < t.length - 2; i += 2) expect(Math.hypot(t[i] - t[i - 2], t[i + 1] - t[i - 1])).toBeGreaterThanOrEqual(1.5);
  });

  it('makes smooth paths with quadratic curves, a dot for a single point', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([5, 6])).toBe('M5 6l0.01 0');
    expect(smoothPath([0, 0, 10, 0])).toBe('M0 0L10 0');
    expect(smoothPath([0, 0, 10, 0, 20, 10, 30, 10])).toBe('M0 0Q10 0 15 5Q20 10 25 10L30 10');
  });

  it('the eraser hits strokes within its radius plus half the pen width', () => {
    const s: Stroke = { color: '#000000', width: 10, points: [0, 0, 100, 0] };
    expect(strokeHit(s, 50, 18, 14)).toBe(true); // 18 <= 14 + 5
    expect(strokeHit(s, 50, 20, 14)).toBe(false);
    const dot: Stroke = { color: '#000000', width: 4, points: [200, 200] };
    expect(strokeHit(dot, 210, 200, 10)).toBe(true);
    const all = [s, dot];
    expect(eraseAlong(all, 300, 300, 310, 310, 10)).toBe(all); // nothing hit: same array
    // a fast sweep across the line still hits it
    expect(eraseAlong(all, 50, -200, 50, 200, 10)).toEqual([dot]);
  });

  it('draws black ink light on the dark board, but not on white paper', () => {
    expect(inkColor('#202124', true, false)).toBe('#e6e6e6');
    expect(inkColor('#202124', true, true)).toBe('#202124');
    expect(inkColor('#e0443a', true, false)).toBe('#e0443a');
  });

  it('groups board strokes into one card at their bounding box, in the 0–1000 space', () => {
    const world: Stroke[] = [
      { color: '#202124', width: 4, points: [100, 200, 300, 200] },
      { color: '#e0443a', width: 12, points: [150, 250, 250, 300], marker: true },
    ];
    const c = strokesToCard(world, 8)!;
    // bbox: x 98..302, y 198..306 → plus 8 padding
    expect(c.width).toBe(220);
    expect(c.pos).toEqual([90, 190]);
    expect(c.aspect).toBeCloseTo(124 / 220, 3);
    const k = 1000 / 220;
    expect(c.strokes[0].points[0]).toBeCloseTo((100 - 90) * k, 1);
    expect(c.strokes[0].points[1]).toBeCloseTo((200 - 190) * k, 1);
    expect(c.strokes[0].width).toBeCloseTo(4 * k, 1);
    expect(c.strokes[1].marker).toBe(true);
    expect(c.strokes[0].marker).toBeUndefined();
    for (const s of c.strokes)
      for (let i = 0; i < s.points.length; i++) {
        expect(s.points[i]).toBeGreaterThanOrEqual(0);
        expect(s.points[i]).toBeLessThanOrEqual(i % 2 ? 1000 * c.aspect : 1000);
        expect(Math.round(s.points[i] * 10) / 10).toBe(s.points[i]);
      }
    expect(countNumbers(c.strokes)).toBe(8);
    expect(strokesToCard([])).toBeNull();
  });
});
