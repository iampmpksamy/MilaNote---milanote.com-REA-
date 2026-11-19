import { expect, Locator, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Audio and video cards in the browser-only edition (boards and files in IndexedDB, no server).
// Real mouse, keyboard and touch input. YouTube is never contacted: its player address is answered
// by a stub page.

const shots = join(__dirname, '..', '..', '..', '..', 'shots', 'cards-alpha6');
mkdirSync(shots, { recursive: true });

// A fake microphone that is always allowed (for "Record").
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

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

/** Clicks empty board space (no card, line or control there): ends editing and clears the selection. */
async function deselect(page: Page) {
  const at = await page.evaluate(() => {
    const r = document.querySelector('.nb-canvas')!.getBoundingClientRect();
    for (let y = r.top + 30; y < r.bottom - 60; y += 23)
      for (let x = r.left + 30; x < r.right - 60; x += 29) {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        if (el && el.closest('.nb-canvas') && !el.closest('nb-card-view, .nb-float, .nb-zoom, .nb-pill, button, a, svg, [data-handle]')) return { x, y };
      }
    return null;
  });
  if (!at) throw new Error('no empty board space');
  await page.mouse.click(at.x, at.y);
}

const cardsOf = (store: any, kind: string) => Object.values(store.boards).flatMap((b: any) => b.cards.filter((c: any) => kind in c.content));

/** Adds a card from the "More" tools; it starts in editing. */
async function add(page: Page, kind: 'Audio' | 'Video'): Promise<Locator> {
  const before = await page.locator(`nb-card-view.nb-${kind.toLowerCase()}`).count();
  await page.locator('.nb-tool[data-tool="More"]').click();
  await page.locator(`.nb-more-tool[data-tool="${kind}"]`).click();
  const card = page.locator(`nb-card-view.nb-${kind.toLowerCase()}`).nth(before);
  await expect(card).toHaveClass(/editing/);
  return card;
}

/** A WAV file of `seconds` of quiet (8 kHz, 8-bit mono), built here. */
function wav(seconds: number): Buffer {
  const n = Math.round(8000 * seconds);
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(n, 40);
  return b;
}

/** A short WebM video (drawn on a canvas and recorded by the browser itself: no fixture files). */
async function webm(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d')!;
      const stream = canvas.captureStream(25);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start(100);
      for (let i = 0; i < 20; i++) {
        g.fillStyle = `hsl(${i * 18}, 60%, 50%)`;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        g.fillRect(10 + i * 5, h / 2 - 10, 20, 20);
        await new Promise((r) => setTimeout(r, 40));
      }
      rec.stop();
      await done;
      const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = '';
      for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    },
    [w, h],
  );
  return Buffer.from(b64, 'base64');
}

/** Answers YouTube's player address with a stub page and remembers what was asked. */
async function stubYouTube(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/youtube|ytimg|googlevideo|vimeo/, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><body style="background:#000;color:#fff">stub player</body>' });
  });
  return asked;
}

test('audio: upload a WAV, play, seek, edit the title; one card plays at a time', async ({ page }) => {
  await open(page);
  const card = await add(page, 'Audio');
  await expect(card.locator('.nb-audio-title-edit')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/editing/);
  await expect(card.locator('[data-action="upload"]')).toBeVisible();
  await expect(card.locator('[data-action="record"]')).toBeVisible();
  await card.screenshot({ path: join(shots, 'media-audio-empty.png') });

  await card.locator('input[type=file]').setInputFiles({ name: 'Birdsong at dawn.wav', mimeType: 'audio/wav', buffer: wav(4) });
  const time = card.locator('[data-testid="audio-time"]');
  await expect(time).toHaveText('0:00 / 0:04');
  await expect(card.locator('.nb-audio-label')).toHaveText('Birdsong at dawn');
  const store = await saved(page);
  const audio = cardsOf(store, 'Audio')[0].content.Audio;
  expect(audio.file).toMatch(/^\d+-[0-9a-f]{8}\.wav$/);
  expect(audio.title).toBe('Birdsong at dawn');
  expect(audio.duration).toBeCloseTo(4, 0);
  await deselect(page);
  await card.screenshot({ path: join(shots, 'media-audio-light.png') });

  // Play, then a second card starting pauses the first.
  const play = card.locator('.nb-audio-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(time).not.toHaveText('0:00 / 0:04');
  const second = await add(page, 'Audio');
  await page.keyboard.press('Escape');
  await second.locator('input[type=file]').setInputFiles({ name: 'second.wav', mimeType: 'audio/wav', buffer: wav(8) });
  await expect(second.locator('[data-testid="audio-time"]')).toHaveText('0:00 / 0:08');
  if ((await play.getAttribute('aria-label')) !== 'Pause') await play.click(); // it may have ended meanwhile
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  const play2 = second.locator('.nb-audio-play');
  await play2.click();
  await expect(play2).toHaveAttribute('aria-label', 'Pause');
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await play2.click();
  await expect(play2).toHaveAttribute('aria-label', 'Play');

  // Seek by clicking along the bar (does not drag the card).
  const pos = await second.boundingBox();
  const sb = (await second.locator('.nb-audio-seek').boundingBox())!;
  await page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
  await expect(second.locator('[data-testid="audio-time"]')).toHaveText(/^0:0[56] \/ 0:08$/);
  expect(await second.boundingBox()).toEqual(pos);

  // Editing: title field and Replace….
  await card.locator('.nb-audio-label').dblclick();
  await expect(card).toHaveClass(/editing/);
  const title = card.locator('.nb-audio-title-edit');
  await expect(title).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Dawn chorus');
  await card.locator('[data-action="replace"]').click();
  await expect(card.locator('[data-action="record"]')).toBeVisible();
  await card.screenshot({ path: join(shots, 'media-audio-editing.png') });
  await page.keyboard.press('Escape');
  await deselect(page);
  await expect(card.locator('.nb-audio-label')).toHaveText('Dawn chorus');
  await expect.poll(async () => cardsOf(await saved(page), 'Audio').map((c: any) => c.content.Audio.title)).toContain('Dawn chorus');

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await card.screenshot({ path: join(shots, 'media-audio-dark.png') });
});

test('audio: record a voice note with the microphone', async ({ page }) => {
  await open(page);
  const card = await add(page, 'Audio');
  await page.keyboard.press('Escape');
  await card.locator('[data-action="record"]').click();
  const rec = card.locator('[data-testid="recording"]');
  await expect(rec).toBeVisible();
  await expect(rec.locator('.nb-audio-time')).toHaveText('0:01', { timeout: 4000 });
  await card.screenshot({ path: join(shots, 'media-audio-recording.png') });
  await page.waitForTimeout(800);
  await rec.getByText('Stop').click();
  await expect(rec).toBeHidden();
  await expect(card.locator('.nb-audio-label')).toHaveText(/^Voice note /);
  await expect(card.locator('[data-testid="audio-time"]')).toHaveText(/^0:00 \/ 0:0[1-5]$/);
  const store = await saved(page);
  const a = cardsOf(store, 'Audio')[0].content.Audio;
  expect(a.file).toMatch(/\.(webm|ogg|m4a)$/);
  expect(a.duration).toBeGreaterThan(1);
  expect(a.duration).toBeLessThan(6);
  // The recording is stored with the boards.
  const kept = await page.evaluate(
    (name) =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open('noteboard-local');
        r.onsuccess = () => {
          const g = r.result.transaction('images').objectStore('images').get(name);
          g.onsuccess = () => resolve((g.result as Blob | undefined)?.size ?? 0);
        };
      }),
    a.file,
  );
  expect(kept).toBeGreaterThan(100);
});

test('audio: a refused microphone says so', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await open(page);
  const card = await add(page, 'Audio');
  await page.keyboard.press('Escape');
  await card.locator('[data-action="record"]').click();
  await expect(page.locator('.nb-toast')).toContainText('microphone');
  await expect(card.locator('[data-testid="recording"]')).toHaveCount(0);
  await expect(card.locator('[data-action="record"]')).toBeVisible();
});

test('video: a YouTube link becomes a poster, and the player loads only when clicked', async ({ page }) => {
  const asked = await stubYouTube(page);
  await open(page);
  const card = await add(page, 'Video');
  const url = card.locator('input[data-field="url"]');
  await expect(url).toBeFocused();
  await page.keyboard.type('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
  await expect(card.locator('.nb-video-hint')).toHaveText('YouTube video ✓');
  await card.locator('input[data-field="title"]').click();
  await page.keyboard.type('Launch talk');
  await card.screenshot({ path: join(shots, 'media-video-editing.png') });
  await page.keyboard.press('Escape');
  await deselect(page);
  const poster = card.locator('.nb-video-poster');
  await expect(poster).toBeVisible();
  await expect(poster).toContainText('Launch talk');
  await expect(poster).toContainText('youtube.com');
  await expect(card.locator('iframe')).toHaveCount(0);
  await card.screenshot({ path: join(shots, 'media-video-poster-light.png') });
  expect(asked, 'nothing is loaded from YouTube before the click').toEqual([]);

  // Dragging the card by its poster moves it (no player is loaded).
  const before = (await card.boundingBox())!;
  await page.mouse.move(before.x + 30, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 130, before.y + 70, { steps: 8 });
  await page.mouse.up();
  const after = (await card.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(100);
  await expect(card.locator('iframe')).toHaveCount(0);

  await card.locator('[data-action="load"]').click();
  const frame = card.locator('iframe');
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=42');
  await expect(frame).toHaveAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked.every((u) => u.startsWith('https://www.youtube-nocookie.com/embed/'))).toBe(true);
  await expect(page.frameLocator('nb-card-view.nb-video iframe').locator('body')).toHaveText('stub player');

  const store = await saved(page);
  const v = cardsOf(store, 'Video')[0].content.Video;
  expect(v).toEqual({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', file: '', title: 'Launch talk', aspect: 0.5625 });

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await card.screenshot({ path: join(shots, 'media-video-player-dark.png') });
});

test('video: empty card, a plain link, and an uploaded file', async ({ page }) => {
  await stubYouTube(page);
  await open(page);
  const card = await add(page, 'Video');
  await page.keyboard.press('Escape');
  await deselect(page);
  const empty = card.locator('.nb-video-empty');
  await expect(empty.locator('input[placeholder="Paste a YouTube or Vimeo link"]')).toBeVisible();
  await expect(empty.locator('[data-action="upload"]')).toHaveText(/Upload video/);
  await card.screenshot({ path: join(shots, 'media-video-empty.png') });

  // A link that isn't YouTube or Vimeo is shown like a link card.
  await empty.locator('input').click();
  await page.keyboard.type('https://example.com/clips/intro');
  await page.keyboard.press('Enter');
  await expect(card.locator('.nb-video-link')).toContainText('example.com');
  await expect(card.locator('.nb-video-open')).toHaveAttribute('href', 'https://example.com/clips/intro');
  await expect(card.locator('iframe')).toHaveCount(0);

  // Upload a video file (square): it plays here and the card takes its shape.
  const clip = await webm(page, 160, 160);
  expect(clip.readUInt32BE(0)).toBe(0x1a45dfa3);
  await card.dblclick();
  await expect(card).toHaveClass(/editing/);
  await card.locator('input[type=file]').setInputFiles({ name: 'Square clip.webm', mimeType: 'video/webm', buffer: clip });
  const video = card.locator('video');
  await expect(video).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(160);
  await page.keyboard.press('Escape');
  await deselect(page);
  const store = await saved(page);
  const v = cardsOf(store, 'Video')[0].content.Video;
  expect(v.url).toBe('');
  expect(v.file).toMatch(/\.webm$/);
  expect(v.title).toBe('Square clip');
  expect(v.aspect).toBe(1);
  const box = (await video.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);

  // Pressing on the video (its controls) does not drag the card.
  const before = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height - 12, { steps: 6 });
  await page.mouse.up();
  expect(await card.boundingBox()).toEqual(before);
  await card.screenshot({ path: join(shots, 'media-video-file.png') });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: false });

  test('touch: tap the poster to load the player; the card is not dragged', async ({ page }) => {
    const asked = await stubYouTube(page);
    await open(page);
    const card = await add(page, 'Video');
    await page.keyboard.type('https://youtu.be/dQw4w9WgXcQ');
    await page.keyboard.press('Escape');
    const audio = await add(page, 'Audio');
    await page.keyboard.press('Escape');
    await audio.locator('input[type=file]').setInputFiles({ name: 'Memo.wav', mimeType: 'audio/wav', buffer: wav(3) });
    await expect(audio.locator('[data-testid="audio-time"]')).toHaveText('0:00 / 0:03');
    await card.scrollIntoViewIfNeeded();
    const button = card.locator('[data-action="load"]');
    await expect(button).toBeVisible();
    await page.screenshot({ path: join(shots, 'media-phone-412.png') });
    expect(asked).toEqual([]);
    const before = (await card.boundingBox())!;
    const b = (await button.boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(card.locator('iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(await card.boundingBox()).toEqual(before);
    // Tapping play on the audio card plays it.
    const play = audio.locator('.nb-audio-play');
    const p = (await play.boundingBox())!;
    await page.touchscreen.tap(p.x + p.width / 2, p.y + p.height / 2);
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await page.screenshot({ path: join(shots, 'media-phone-412-playing.png') });
  });
});
