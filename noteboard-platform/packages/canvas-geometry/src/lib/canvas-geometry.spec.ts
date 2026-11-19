import { align, distToSegment, edgePoint, fitView, freeSpot, intersects, lineEnds, pt, rect, toScreen, toWorld, zoomAt } from './canvas-geometry';

describe('canvas geometry', () => {
  it('screen and world coordinates round-trip', () => {
    const v = { pan: [60, 40] as [number, number], zoom: 1.5 };
    const w = pt(123, -45);
    const back = toWorld(v, toScreen(v, w));
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(-45);
  });

  it('zooming keeps the point under the pointer still and stays in range', () => {
    const v = { pan: [10, 20] as [number, number], zoom: 1 };
    const p = pt(400, 300);
    const before = toWorld(v, p);
    const z = zoomAt(v, p, 1.7);
    const after = toWorld(z, p);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(v, p, 100).zoom).toBe(2.5);
    expect(zoomAt(v, p, 0.001).zoom).toBe(0.25);
  });

  it('lines leave a card at its edge, aiming at the other end', () => {
    const r = rect(0, 0, 100, 50);
    const e = edgePoint(r, pt(500, 25));
    expect(e).toEqual(pt(100, 25));
    const ends = lineEnds({ rect: r, at: pt(50, 25) }, { rect: rect(300, 0, 100, 50), at: pt(350, 25) })!;
    expect(ends[0].x).toBeCloseTo(107);
    expect(ends[1].x).toBeCloseTo(293);
  });

  it('a line between overlapping cards is not drawn', () => {
    expect(lineEnds({ rect: rect(0, 0, 100, 100), at: pt(50, 50) }, { rect: rect(20, 20, 10, 10), at: pt(25, 25) })).toBeNull();
  });

  it('hit testing a line', () => {
    expect(distToSegment(pt(50, 5), pt(0, 0), pt(100, 0))).toBeCloseTo(5);
    expect(distToSegment(pt(-10, 0), pt(0, 0), pt(100, 0))).toBeCloseTo(10);
  });

  it('alignment guides snap to a neighbour, otherwise to the grid', () => {
    const r = rect(103, 200, 100, 50);
    const a = align(r, [rect(100, 0, 80, 40)], 6, true, null);
    expect(a.dx).toBe(-3);
    expect(a.guides.length).toBe(1);
    const g = align(rect(13, 13, 10, 10), [], 6, true, 8);
    expect(g.dx).toBe(3);
    expect(g.dy).toBe(3);
  });

  it('click-to-create finds a free spot that covers nothing', () => {
    const taken = [rect(-150, -100, 300, 200)];
    const p = freeSpot(pt(0, 0), pt(300, 60), taken);
    expect(intersects(rect(p.x - 150, p.y - 30, 300, 60), taken[0])).toBe(false);
  });

  it('fit shows everything', () => {
    const v = fitView(rect(0, 0, 1000, 500), pt(1200, 800));
    const tl = toScreen(v, pt(0, 0));
    const br = toScreen(v, pt(1000, 500));
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(1200);
  });
});
