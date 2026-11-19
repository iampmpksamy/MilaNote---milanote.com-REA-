import { TestBed } from '@angular/core/testing';
import { MemoryStorage, STORAGE } from '../storage';
import { Workspace } from '../workspace.service';
import { COLOR_PRESETS, ColorCard, normalizeHex } from './color.card';

async function setup() {
  TestBed.configureTestingModule({ providers: [Workspace, { provide: STORAGE, useValue: new MemoryStorage() }] });
  const ws = TestBed.inject(Workspace);
  await ws.init();
  const id = ws.create('Color', { at: { x: 0, y: 900 } })!;
  ws.stopEditing();
  const fixture = TestBed.createComponent(ColorCard);
  fixture.componentRef.setInput('card', ws.card(id)!);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const data = () => (ws.card(id)!.content as { Color: { hex: string; name: string } }).Color;
  const editing = (on: boolean) => {
    fixture.componentRef.setInput('editing', on);
    fixture.detectChanges();
  };
  return { ws, id, fixture, el, data, editing };
}

const type = (f: HTMLInputElement, v: string, event = 'input') => {
  f.value = v;
  f.dispatchEvent(new Event(event));
};

describe('normalizeHex', () => {
  it('accepts 3 or 6 digits with or without # and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex(' #A1b2C3 ')).toBe('#a1b2c3');
    expect(normalizeHex('a1b2c3')).toBe('#a1b2c3');
  });
  it('rejects everything else', () => {
    for (const v of ['', '#', '#12', '#1234', '#12345', '#1234567', 'red', '#ggg', '##abc', 'rgb(0,0,0)']) expect(normalizeHex(v)).toBeNull();
  });
  it('presets are valid, distinct and about a dozen', () => {
    expect(COLOR_PRESETS.length).toBe(12);
    expect(new Set(COLOR_PRESETS.map((p) => p.hex)).size).toBe(12);
    for (const p of COLOR_PRESETS) expect(normalizeHex(p.hex)).toBe(p.hex);
  });
});

describe('Colour card', () => {
  it('shows the swatch, "Untitled colour" and the hex', async () => {
    const { el } = await setup();
    expect(el.querySelector<HTMLElement>('.nb-color-swatch')!.style.backgroundColor).toBe('rgb(92, 127, 245)');
    expect(el.querySelector('.nb-color-title')!.textContent!.trim()).toBe('Untitled colour');
    expect(el.querySelector('.nb-color-code')!.textContent).toBe('#5c7ff5');
  });

  it('hex field: six digits apply while typing, three on Enter, invalid is put back', async () => {
    const { ws, id, el, data, editing } = await setup();
    ws.edit(id);
    editing(true);
    const hex = el.querySelector<HTMLInputElement>('.nb-color-hex')!;
    type(hex, '#12');
    expect(data().hex).toBe('#5c7ff5');
    type(hex, 'A0B1C2');
    expect(data().hex).toBe('#a0b1c2');
    type(hex, 'F0A');
    expect(data().hex).toBe('#a0b1c2');
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(data().hex).toBe('#ff00aa');
    expect(hex.value).toBe('#ff00aa');
    type(hex, 'nope', 'change');
    expect(data().hex).toBe('#ff00aa');
    expect(hex.value).toBe('#ff00aa');
  });

  it('name, native picker and quick colours', async () => {
    const { ws, id, fixture, el, data, editing } = await setup();
    ws.edit(id);
    editing(true);
    type(el.querySelector<HTMLInputElement>('.nb-color-name')!, 'Brand blue');
    expect(data().name).toBe('Brand blue');
    type(el.querySelector<HTMLInputElement>('input[type="color"]')!, '#123456');
    expect(data().hex).toBe('#123456');
    const white = el.querySelector<HTMLButtonElement>('.nb-color-preset[data-hex="#ffffff"]')!;
    const down = new Event('pointerdown', { cancelable: true, bubbles: true });
    white.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    white.click();
    fixture.detectChanges();
    expect(data().hex).toBe('#ffffff');
    expect(el.querySelector('.nb-color-preset.on')!.getAttribute('data-hex')).toBe('#ffffff');
    expect(el.querySelector<HTMLInputElement>('.nb-color-hex')!.value).toBe('#ffffff');
    ws.undo();
    expect((ws.card(id)!.content as { Color: { hex: string } }).Color.hex).toBe('#123456');
  });

  it('Copy uses the app clipboard when there is one and says so', async () => {
    const { ws, el } = await setup();
    const writeText = vi.fn(async () => undefined);
    (globalThis as { nbClipboard?: unknown }).nbClipboard = { writeText };
    try {
      el.querySelector<HTMLButtonElement>('.nb-color-copy')!.click();
      await vi.waitFor(() => expect(ws.toast()?.text).toBe('Copied #5c7ff5'));
      expect(writeText).toHaveBeenCalledWith('#5c7ff5');
    } finally {
      delete (globalThis as { nbClipboard?: unknown }).nbClipboard;
    }
  });
});
