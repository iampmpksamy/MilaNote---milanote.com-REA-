import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Card } from '@noteboard/board-model';
import { MemoryStorage, STORAGE } from '../storage';
import { Workspace } from '../workspace.service';
import { TableCard } from './table.card';
import { addTableColumn, addTableRow, normalizeTable, removeTableColumn, removeTableRow, setTableCell, tabTarget, tableCols, TABLE_MAX_CELL, TABLE_MAX_ROWS } from './table-grid';

describe('table grid helpers', () => {
  it('normalizes ragged and empty grids to a rectangle of at least 1×1', () => {
    expect(normalizeTable([])).toEqual([['']]);
    expect(normalizeTable([['a'], ['b', 'c', 'd'], []])).toEqual([
      ['a', '', ''],
      ['b', 'c', 'd'],
      ['', '', ''],
    ]);
    expect(tableCols([])).toBe(1);
  });

  it('sets cells, growing the grid when needed and capping the length', () => {
    const g = [['a', 'b']];
    setTableCell(g, 2, 2, 'x');
    expect(g).toEqual([
      ['a', 'b', ''],
      ['', '', ''],
      ['', '', 'x'],
    ]);
    setTableCell(g, 0, 0, 'y'.repeat(TABLE_MAX_CELL + 5));
    expect(g[0][0].length).toBe(TABLE_MAX_CELL);
  });

  it('adds and removes rows and columns, always keeping 1×1', () => {
    const g = [
      ['h1', 'h2'],
      ['a', 'b'],
    ];
    expect(addTableRow(g)).toBe(true);
    expect(addTableColumn(g)).toBe(true);
    expect(g).toEqual([
      ['h1', 'h2', ''],
      ['a', 'b', ''],
      ['', '', ''],
    ]);
    removeTableColumn(g, 0);
    removeTableRow(g, 1);
    expect(g).toEqual([
      ['h2', ''],
      ['', ''],
    ]);
    removeTableColumn(g, 1);
    removeTableColumn(g, 0);
    removeTableRow(g, 0);
    removeTableRow(g, 0);
    expect(g).toEqual([['']]);
    const full = Array.from({ length: TABLE_MAX_ROWS }, () => ['']);
    expect(addTableRow(full)).toBe(false);
    expect(full.length).toBe(TABLE_MAX_ROWS);
  });

  it('Tab order goes row by row; null past either end', () => {
    expect(tabTarget(2, 3, { r: 0, c: 2 }, false)).toEqual({ r: 1, c: 0 });
    expect(tabTarget(2, 3, { r: 1, c: 0 }, true)).toEqual({ r: 0, c: 2 });
    expect(tabTarget(2, 3, { r: 1, c: 2 }, false)).toBeNull();
    expect(tabTarget(2, 3, { r: 0, c: 0 }, true)).toBeNull();
  });
});

@Component({
  selector: 'nb-test-host',
  imports: [TableCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (card(); as c) { <nb-table-card [card]="c" [editing]="ws.editing() === c.id" /> }`,
})
class Host {
  readonly ws = inject(Workspace);
  readonly id = signal(0);
  readonly card = computed<Card | undefined>(
    () => {
      this.ws.rev();
      return this.ws.card(this.id());
    },
    { equal: () => false },
  );
}

async function setup() {
  TestBed.configureTestingModule({ providers: [Workspace, { provide: STORAGE, useValue: new MemoryStorage() }] });
  const ws = TestBed.inject(Workspace);
  await ws.init();
  const id = ws.create('Table', { at: { x: 0, y: 2000 } })!;
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.id.set(id);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const cells = () => ('Table' in ws.card(id)!.content ? (ws.card(id)!.content as { Table: { title: string; cells: string[][] } }).Table : null)!;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    await render();
    return e;
  };
  const type = async (target: HTMLTextAreaElement | HTMLInputElement, v: string) => {
    target.value = v;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await render();
  };
  return { ws, id, fixture, el, cells, render, key, type };
}

describe('TableCard', () => {
  it('a new table starts in editing with the keyboard in the first cell', async () => {
    const { el } = await setup();
    expect(el.querySelectorAll('textarea.nb-tbl-in').length).toBe(9);
    expect(document.activeElement).toBe(el.querySelector('[data-cell="0:0"]'));
  });

  it('typing, Tab, Enter and arrows move through the cells and add rows at the end', async () => {
    const { el, cells, key, type } = await setup();
    const cell = (r: number, c: number) => el.querySelector<HTMLTextAreaElement>(`[data-cell="${r}:${c}"]`)!;
    await type(cell(0, 0), 'Name');
    expect(cells().cells[0][0]).toBe('Name');
    const tab = await key(cell(0, 0), 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cell(0, 1));
    await key(cell(0, 1), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(cell(0, 0));
    await key(cell(0, 0), 'Enter');
    expect(document.activeElement).toBe(cell(1, 0));
    await key(cell(1, 0), 'ArrowUp');
    expect(document.activeElement).toBe(cell(0, 0));
    cell(0, 0).setSelectionRange(4, 4);
    await key(cell(0, 0), 'ArrowDown');
    expect(document.activeElement).toBe(cell(1, 0));
    // Tab in the last cell adds a row.
    cell(2, 2).focus();
    await key(cell(2, 2), 'Tab');
    expect(cells().cells.length).toBe(4);
    expect(document.activeElement).toBe(cell(3, 0));
    // Enter in the last row adds a row too.
    await key(cell(3, 0), 'Enter');
    expect(cells().cells.length).toBe(5);
    expect(document.activeElement).toBe(cell(4, 0));
  });

  it('keys typed in cells do not reach the board shortcuts', async () => {
    const { el, key } = await setup();
    let reached = 0;
    const spy = () => reached++;
    window.addEventListener('keydown', spy);
    await key(el.querySelector('[data-cell="0:0"]')!, 'Delete');
    await key(el.querySelector('[data-tbl-title]')!, 'a');
    window.removeEventListener('keydown', spy);
    expect(reached).toBe(0);
  });

  it('buttons add and remove rows and columns, keeping at least 1×1, each as one undo step', async () => {
    const { ws, id, el, cells, render } = await setup();
    const click = async (sel: string) => {
      el.querySelector<HTMLButtonElement>(sel)!.click();
      await render();
    };
    await click('[data-add-col]');
    expect(cells().cells.map((r) => r.length)).toEqual([4, 4, 4]);
    await click('[data-add-row]');
    expect(cells().cells.length).toBe(4);
    ws.undo();
    await render();
    expect(cells().cells.length).toBe(3);
    expect(el.querySelectorAll('tr').length).toBe(3);
    ws.edit(id);
    await render();
    for (let i = 0; i < 6; i++) {
      await click('[data-remove-row="0"]');
      await click('[data-remove-col="0"]');
    }
    expect(cells().cells).toEqual([['']]);
    expect(el.querySelector<HTMLButtonElement>('[data-remove-row="0"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-remove-col="0"]')!.disabled).toBe(true);
  });

  it('shows the title and the grid with a header row when not editing', async () => {
    const { ws, el, type, render } = await setup();
    await type(el.querySelector<HTMLInputElement>('[data-tbl-title]')!, 'Prices');
    await type(el.querySelector<HTMLTextAreaElement>('[data-cell="0:1"]')!, 'Cost');
    await type(el.querySelector<HTMLTextAreaElement>('[data-cell="1:1"]')!, '12');
    ws.stopEditing();
    await render();
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('.nb-tbl-title')!.textContent).toBe('Prices');
    expect(el.querySelector('tr.nb-tbl-head')!.textContent).toContain('Cost');
    expect(el.querySelectorAll('tr').length).toBe(3);
  });
});
