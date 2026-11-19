import { CDPSession, expect, Locator, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Sketch cards and the board's Draw mode. Local mode (boards in IndexedDB), a fresh profile per
// test, real mouse, keyboard and (CDP) touch input.

const shots = join(__dirname, '..', '..', '..', '..', 'shots', 'cards-alpha6');
mkdirSync(shots, { recursive: true });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible();
}

/** The saved boards, read back from the browser's database once the autosave has run. */
async function saved(page: Page): Promise<any> {
  await expect(page.locator('.nb-status')).toHaveText('Saved', { timeout: 5000 });
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('noteboard-local');
        r.onsuccess = () => {
          const g = r.result.transaction('kv').objectStore('kv').get('store');
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

type P = { x: number; y: number };
const tool = (page: Page, name: string) => page.locator(`.nb-tool[data-tool="${name}"]`);
const box = async (l: Locator) => (await l.boundingBox())!;
const center = async (l: Locator) => {
  const r = await box(l);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const home = (s: any) => s.boards[String(s.root)];
const sketches = (s: any) => home(s).cards.filter((c: any) => c.content.Sketch);

/** A mouse stroke through the points. */
async function stroke(page: Page, pts: P[], steps = 8) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
}

/** Every point inside the sketch's space and rounded to one decimal; widths positive. */
function checkShape(sk: { strokes: any[]; aspect: number }) {
  for (const s of sk.strokes) {
    expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.width).toBeGreaterThan(0);
    expect(s.points.length % 2).toBe(0);
    s.points.forEach((v: number, i: number) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(i % 2 ? 1000 * sk.aspect + 0.05 : 1000.05);
      expect(Math.round(v * 10) / 10).toBe(v);
    });
  }
}

test('sketch card: pen and marker, eraser, undo/redo, clear asks, done; keys stay in the editor', async ({ page }) => {
  await open(page);
  await tool(page, 'More').click();
  await page.locator('.nb-more-tool[data-tool="Sketch"]').click();
  const dialog = page.locator('.nb-sk-dialog');
  await expect(dialog).toBeVisible();
  const paper = await box(dialog.locator('.nb-sk-paper'));
  expect(paper.width).toBeGreaterThan(600); // scaled to fit the large dialog
  const at = (fx: number, fy: number) => ({ x: paper.x + paper.width * fx, y: paper.y + paper.height * fy });
  const ink = dialog.locator('.nb-sk-ink path');

  // A black zig-zag with the pen.
  await stroke(page, [at(0.1, 0.2), at(0.3, 0.5), at(0.5, 0.2), at(0.7, 0.5)]);
  await expect(ink).toHaveCount(1);
  // A thick red marker line: see-through.
  await dialog.locator('.nb-sk-color[data-color="#e0443a"]').click();
  await dialog.locator('[data-width="2"]').click();
  await dialog.locator('[data-sk="marker"]').click();
  await stroke(page, [at(0.1, 0.8), at(0.9, 0.8)]);
  await expect(ink).toHaveCount(2);
  await expect(ink.nth(1)).toHaveAttribute('stroke-opacity', '0.4');
  // A blue curve with the thin pen.
  await dialog.locator('.nb-sk-color[data-color="#3a6fe0"]').click();
  await dialog.locator('[data-width="0"]').click();
  await dialog.locator('[data-sk="pen"]').click();
  await stroke(page, [at(0.75, 0.15), at(0.85, 0.3), at(0.8, 0.45), at(0.9, 0.6)]);
  await expect(ink).toHaveCount(3);
  await expect(ink.first()).toHaveAttribute('d', /Q/); // smoothed
  await page.screenshot({ path: join(shots, 'sketch-editing.png') });

  // The eraser removes the whole zig-zag it touches.
  await dialog.locator('[data-sk="eraser"]').click();
  await stroke(page, [at(0.3, 0.3), at(0.3, 0.6)]);
  await expect(ink).toHaveCount(2);
  await dialog.locator('[data-sk="undo"]').click();
  await expect(ink).toHaveCount(3);
  await page.keyboard.press('Control+Shift+Z');
  await expect(ink).toHaveCount(2);
  await page.keyboard.press('Control+Z');
  await expect(ink).toHaveCount(3);

  // Clear asks first.
  await dialog.locator('[data-sk="clear"]').click();
  await expect(dialog.locator('.nb-sk-ask')).toBeVisible();
  await dialog.locator('[data-sk="clear-no"]').click();
  await expect(dialog.locator('.nb-sk-ask')).toHaveCount(0);
  await expect(ink).toHaveCount(3);

  // Board shortcuts don't fire while drawing: Delete and N do nothing.
  const cards = await page.locator('.nb-world nb-card-view').count();
  await page.keyboard.press('Delete');
  await page.keyboard.press('n');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.nb-world nb-card-view')).toHaveCount(cards);

  await dialog.locator('[data-sk="done"]').click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator('nb-card-view.nb-sketch');
  await expect(card).toHaveCount(1);
  await expect(card.locator('path')).toHaveCount(3);
  await expect(card.locator('svg.nb-sketch-paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  const s = await saved(page);
  const [sk] = sketches(s);
  const d = sk.content.Sketch;
  expect(d.background).toBe(true);
  expect(d.aspect).toBe(0.75);
  expect(d.strokes).toHaveLength(3);
  expect(d.strokes[0]).toMatchObject({ color: '#202124', width: 12 });
  expect(d.strokes[0].marker).toBeUndefined();
  expect(d.strokes[1]).toMatchObject({ color: '#e0443a', width: 78, marker: true });
  expect(d.strokes[2]).toMatchObject({ color: '#3a6fe0', width: 5 });
  checkShape(d);
  // points thinned: a mouse move every few pixels, never two within 1.5 units
  const p = d.strokes[0].points;
  for (let i = 2; i < p.length - 2; i += 2) expect(Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])).toBeGreaterThanOrEqual(1.5);

  // Double-click opens it again with its strokes; Esc closes; Clear → Clear empties it.
  await card.click();
  await page.screenshot({ path: join(shots, 'sketch-light.png') });
  await card.dblclick();
  await expect(dialog).toBeVisible();
  await expect(ink).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Control+Shift+D'); // dark theme
  await expect(page.locator('.nb-shell')).toHaveClass(/dark/);
  await page.screenshot({ path: join(shots, 'sketch-dark.png') });
  await card.dblclick();
  await page.screenshot({ path: join(shots, 'sketch-editing-dark.png') });
  await dialog.locator('[data-sk="clear"]').click();
  await dialog.locator('[data-sk="clear-yes"]').click();
  await expect(ink).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card.locator('.nb-sketch-hint')).toHaveText('Double-click to sketch');
  // The whole editing session is one undo step on the board.
  await page.keyboard.press('Control+Z');
  await expect(card.locator('path')).toHaveCount(3);
});

test('draw mode: strokes on the board become one see-through sketch card; one undo removes it', async ({ page }) => {
  await open(page);
  const draw = tool(page, 'Draw');
  await draw.click();
  await expect(draw).toHaveClass(/active/);
  const palette = page.getByTestId('draw-palette');
  await expect(palette).toBeVisible();
  await expect(page.locator('.nb-canvas')).toHaveCSS('cursor', 'crosshair');

  // A stroke across a card doesn't select or move it.
  const target = page.locator('.nb-world nb-card-view').first();
  const t0 = await box(target);
  const tc = await center(target);
  await stroke(page, [{ x: tc.x - 40, y: tc.y - 10 }, { x: tc.x + 40, y: tc.y + 10 }]);
  await expect(page.locator('nb-card-view.selected')).toHaveCount(0);
  expect(await box(target)).toEqual(t0);
  await expect(page.locator('textarea')).toHaveCount(0);

  // Two more strokes in empty space, the second as a red marker.
  const canvas = await box(page.locator('.nb-canvas'));
  const o = { x: canvas.x + 260, y: canvas.y + canvas.height - 200 };
  await stroke(page, [o, { x: o.x + 60, y: o.y + 40 }, { x: o.x + 120, y: o.y }]);
  await palette.locator('.nb-draw-color[data-color="#e0443a"]').click();
  await palette.locator('[data-pen="marker"]').click();
  await stroke(page, [{ x: o.x, y: o.y + 80 }, { x: o.x + 140, y: o.y + 80 }]);
  const layer = page.locator('.nb-draw-layer path');
  await expect(layer).toHaveCount(3);
  await expect(layer.nth(2)).toHaveAttribute('stroke-opacity', '0.4');
  // Ctrl+Z takes back the last stroke of this session (not a board undo); draw it again.
  await page.keyboard.press('Control+Z');
  await expect(layer).toHaveCount(2);
  await stroke(page, [{ x: o.x, y: o.y + 80 }, { x: o.x + 140, y: o.y + 80 }]);
  await expect(layer).toHaveCount(3);
  await page.screenshot({ path: join(shots, 'sketch-draw-mode.png') });

  // The wheel still moves the board, and the drawing moves with it.
  const l0 = await box(layer.nth(1));
  await page.mouse.move(o.x, o.y - 60);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Math.round((await box(layer.nth(1))).y)).toBe(Math.round(l0.y - 100));
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Math.round((await box(layer.nth(1))).y)).toBe(Math.round(l0.y));

  // Done: one sketch card where the strokes were, selected, draw mode over.
  const inkBox = await page.locator('.nb-draw-layer').evaluate((el) => {
    const r = [...el.querySelectorAll('path')].map((p) => p.getBoundingClientRect());
    return { x: Math.min(...r.map((b) => b.left)), y: Math.min(...r.map((b) => b.top)), r: Math.max(...r.map((b) => b.right)), b: Math.max(...r.map((b) => b.bottom)) };
  });
  await page.getByTestId('draw-done').click();
  await expect(palette).toHaveCount(0);
  await expect(draw).toHaveCount(0); // the new card is selected: the toolbar shows its tools
  const card = page.locator('nb-card-view.nb-sketch');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/selected/);
  await expect(card.locator('path')).toHaveCount(3);
  const cb = await box(card);
  // the card is the strokes' bounding box (paths measured without their width) plus a small margin
  expect(cb.x).toBeGreaterThan(inkBox.x - 20);
  expect(cb.x).toBeLessThan(inkBox.x);
  expect(cb.y).toBeGreaterThan(inkBox.y - 20);
  expect(cb.y).toBeLessThan(inkBox.y);
  expect(cb.x + cb.width).toBeGreaterThan(inkBox.r);
  expect(cb.x + cb.width).toBeLessThan(inkBox.r + 20);
  expect(cb.y + cb.height).toBeGreaterThan(inkBox.b);
  expect(cb.y + cb.height).toBeLessThan(inkBox.b + 20);
  await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  const s = await saved(page);
  const nCards = home(s).cards.length;
  expect(sketches(s)).toHaveLength(1);
  const [sk] = sketches(s);
  const d = sk.content.Sketch;
  expect(d.background).toBe(false);
  expect(d.strokes).toHaveLength(3);
  expect(d.strokes[2]).toMatchObject({ color: '#e0443a', marker: true });
  expect(d.aspect).toBeCloseTo(cb.height / cb.width, 2);
  expect(sk.width).toBe(Math.round(cb.width));
  checkShape(d);

  // One undo removes the drawing, redo brings it back.
  await page.mouse.click(canvas.x + canvas.width - 40, canvas.y + 60);
  await page.keyboard.press('Control+Z');
  await expect(card).toHaveCount(0);
  const undone = await saved(page);
  expect(home(undone).cards).toHaveLength(nCards - 1);
  expect(sketches(undone)).toHaveLength(0);
  await page.keyboard.press('Control+Shift+Z');
  await expect(card).toHaveCount(1);

  // Esc and the Draw button both end draw mode; nothing drawn → no card.
  await page.keyboard.press('Escape');
  await draw.click();
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await draw.click();
  await draw.click();
  await expect(palette).toHaveCount(0);
  await expect(card).toHaveCount(1);
  // Normal board behaviour is back: double-click makes a note.
  await page.mouse.dblclick(canvas.x + 1000, canvas.y + 700);
  await expect(page.locator('textarea.nb-note-edit')).toBeFocused();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true });

  const tapAt = async (cdp: CDPSession, at: P) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tap = async (cdp: CDPSession, l: Locator) => {
    await l.scrollIntoViewIfNeeded();
    await tapAt(cdp, await center(l));
  };
  const touchDrag = async (cdp: CDPSession, pts: P[], steps = 6) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] });
    for (let k = 1; k < pts.length; k++)
      for (let i = 1; i <= steps; i++) {
        const a = pts[k - 1];
        const b = pts[k];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }] });
      }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const pinch = async (cdp: CDPSession, c: P, from: number, to: number) => {
    const pts = (d: number) => [
      { x: c.x - d / 2, y: c.y, id: 1 },
      { x: c.x + d / 2, y: c.y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const zoomOf = (page: Page) => page.locator('.nb-world').evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 1));

  test('touch: one finger draws on the board, two fingers pinch without drawing; the editor fills the screen', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    await tap(cdp, tool(page, 'Draw'));
    const palette = page.getByTestId('draw-palette');
    await expect(palette).toBeVisible();
    const canvas = await box(page.locator('.nb-canvas'));
    const pal = await box(palette);
    expect(pal.x).toBeGreaterThanOrEqual(0);
    expect(pal.x + pal.width).toBeLessThanOrEqual(412);
    const o = { x: canvas.x + 80, y: canvas.y + 140 };
    await touchDrag(cdp, [o, { x: o.x + 80, y: o.y + 60 }, { x: o.x + 180, y: o.y }]);
    const layer = page.locator('.nb-draw-layer path');
    await expect(layer).toHaveCount(1);
    // Pinch zooms the board and leaves no mark.
    const z0 = await zoomOf(page);
    await pinch(cdp, { x: canvas.x + canvas.width / 2, y: canvas.y + 320 }, 80, 160);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(z0 * 1.5);
    await expect(layer).toHaveCount(1);
    await pinch(cdp, { x: canvas.x + canvas.width / 2, y: canvas.y + 320 }, 160, 80);
    await page.screenshot({ path: join(shots, 'sketch-phone-draw.png') });
    await tap(cdp, page.getByTestId('draw-done'));
    await expect(palette).toHaveCount(0);
    const card = page.locator('nb-card-view.nb-sketch');
    await expect(card).toHaveCount(1);
    const s = await saved(page);
    const d = sketches(s)[0].content.Sketch;
    expect(d.background).toBe(false);
    expect(d.strokes).toHaveLength(1);
    checkShape(d);

    // The card is selected: tapping it again opens the editor, full screen on a phone.
    await tap(cdp, card);
    const dialog = page.locator('.nb-sk-dialog');
    await expect(dialog).toBeVisible();
    const db = await box(dialog);
    expect(db.x).toBe(0);
    expect(Math.round(db.width)).toBe(412);
    expect(db.height).toBeGreaterThan(800);
    const paper = await box(dialog.locator('.nb-sk-paper'));
    await touchDrag(cdp, [
      { x: paper.x + paper.width * 0.2, y: paper.y + paper.height * 0.8 },
      { x: paper.x + paper.width * 0.8, y: paper.y + paper.height * 0.2 },
    ]);
    const ink = dialog.locator('.nb-sk-ink path');
    await expect(ink).toHaveCount(2);
    // Two fingers on the drawing don't draw.
    await pinch(cdp, { x: paper.x + paper.width / 2, y: paper.y + paper.height / 2 }, 60, 140);
    await expect(ink).toHaveCount(2);
    await page.screenshot({ path: join(shots, 'sketch-phone.png') });
    await tap(cdp, dialog.locator('[data-sk="done"]'));
    await expect(dialog).toHaveCount(0);
    await expect(card.locator('path')).toHaveCount(2);
    expect(sketches(await saved(page))[0].content.Sketch.strokes).toHaveLength(2);
  });
});
