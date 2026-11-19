import { TestBed } from '@angular/core/testing';
import { MemoryStorage, STORAGE } from '../storage';
import { Workspace } from '../workspace.service';
import { HEADING_PX, HeadingCard, guardFocus, headingSize } from './heading.card';

async function setup() {
  TestBed.configureTestingModule({ providers: [Workspace, { provide: STORAGE, useValue: new MemoryStorage() }] });
  const ws = TestBed.inject(Workspace);
  await ws.init();
  const id = ws.create('Heading', { at: { x: 0, y: 900 } })!;
  ws.stopEditing();
  const fixture = TestBed.createComponent(HeadingCard);
  fixture.componentRef.setInput('card', ws.card(id)!);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  document.body.appendChild(el);
  const data = () => (ws.card(id)!.content as { Heading: { text: string; size: number } }).Heading;
  const editing = (on: boolean) => {
    fixture.componentRef.setInput('editing', on);
    fixture.detectChanges();
  };
  return { ws, id, fixture, el, data, editing };
}

describe('Heading card', () => {
  it('shows a muted placeholder when empty and the text otherwise', async () => {
    const { ws, id, fixture, el } = await setup();
    expect(el.querySelector('.nb-heading-text')!.textContent).toBe('Heading');
    expect(el.querySelector('.nb-heading-text')!.classList).toContain('empty');
    // Cards are edited in place: the view must follow without a new card object.
    ws.updateCard(id, (c) => 'Heading' in c.content && (c.content.Heading.text = 'Plans\nfor May'));
    fixture.detectChanges();
    expect(el.querySelector('.nb-heading-text')!.textContent).toBe('Plans\nfor May');
    expect(el.querySelector('.nb-heading-text')!.classList).not.toContain('empty');
  });

  it('font size follows the size and alignment follows the card', async () => {
    const { ws, id, fixture, el } = await setup();
    expect(el.style.fontSize).toBe('34px');
    ws.updateCard(id, (c) => 'Heading' in c.content && (c.content.Heading.size = 3));
    ws.cycleAlign(id);
    fixture.detectChanges();
    expect(el.style.fontSize).toBe(`${HEADING_PX[3]}px`);
    expect(el.style.textAlign).toBe('center');
  });

  it('typing edits the text; Enter finishes, Shift+Enter does not', async () => {
    const { ws, id, el, data, editing } = await setup();
    ws.edit(id);
    editing(true);
    const ta = el.querySelector<HTMLTextAreaElement>('textarea.nb-heading-edit')!;
    expect(document.activeElement).toBe(ta);
    ta.value = 'Big title';
    ta.dispatchEvent(new Event('input'));
    expect(data().text).toBe('Big title');
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true });
    ta.dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false);
    expect(ws.editing()).toBe(id);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    ta.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(ws.editing()).toBeNull();
  });

  it('the size bar changes the size as one undo step and keeps the cursor in the text', async () => {
    const { ws, id, fixture, el, data, editing } = await setup();
    ws.edit(id);
    editing(true);
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    const down = new Event('pointerdown', { cancelable: true, bubbles: true });
    const b2 = el.querySelector<HTMLButtonElement>('.nb-heading-size[data-size="2"]')!;
    b2.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    b2.click();
    fixture.detectChanges();
    expect(data().size).toBe(2);
    expect(el.querySelector('.nb-heading-size.on')!.getAttribute('data-size')).toBe('2');
    expect(document.activeElement).toBe(ta);
    ws.undo();
    expect((ws.card(id)!.content as { Heading: { size: number } }).Heading.size).toBe(1);
  });

  it('unknown sizes fall back to large', () => {
    expect(headingSize(2)).toBe(2);
    expect(headingSize(7)).toBe(1);
    expect(headingSize('3')).toBe(1);
  });

  it('a field that loses focus to nothing right after editing starts gets it back (taps)', async () => {
    const host = document.createElement('div');
    const field = document.createElement('textarea');
    host.appendChild(field);
    document.body.appendChild(host);
    let editing = true;
    guardFocus(host, () => editing, 300);
    field.focus();
    field.blur();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(field);
    editing = false;
    field.blur();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).not.toBe(field);
    host.remove();
  });
});
