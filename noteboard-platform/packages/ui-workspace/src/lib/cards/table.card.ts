/**
 * Table card: an optional title and a grid of text cells; the first row is the header.
 *
 * Editing: every cell is a text field. Tab / Shift+Tab go to the next / previous cell (Tab in the
 * last cell adds a row), Enter goes down (adding a row at the end), Shift+Enter is a new line in the
 * cell, ↑ / ↓ go to the row above / below when the caret is at the start / end of the text.
 * Columns share the card's width; a table too wide for the card scrolls sideways inside it.
 */
import { ApplicationRef, ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject } from '@angular/core';
import { CardPart } from './card-part';
import {
  CellPos,
  TABLE_MAX_CELL,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MAX_TITLE,
  addTableColumn,
  addTableRow,
  normalizeTable,
  removeTableColumn,
  removeTableRow,
  setTableCell,
  tabTarget,
  tableCols,
} from './table-grid';

type Caret = 'start' | 'end';

@Component({
  selector: 'nb-table-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nb-tbl', '[class.editing]': 'editing()' },
  template: `
    @let g = grid();
    @if (editing()) {
      <input class="nb-tbl-title" data-tbl-title [value]="table().title" placeholder="Table title (optional)" [maxLength]="maxTitle"
        (input)="setTitle($event)" (keydown)="titleKey($event)" />
    } @else if (table().title) {
      <div class="nb-tbl-title">{{ table().title }}</div>
    }
    <div class="nb-tbl-scroll" (wheel)="wheel($event)">
      <table class="nb-tbl-grid" [style.min-width.px]="g.cols * (editing() ? 64 : 48)">
        @if (editing()) {
          <tr class="nb-tbl-ctl">
            @for (c of colIdx(); track c) {
              <td>
                <button class="nb-tbl-x" [attr.data-remove-col]="c" title="Remove column" aria-label="Remove column" [disabled]="g.cols < 2"
                  (pointerdown)="$event.stopPropagation()" (click)="removeCol(c)">×</button>
              </td>
            }
            <td class="nb-tbl-side"></td>
          </tr>
        }
        @for (row of g.rows; track $index; let r = $index) {
          <tr [class.nb-tbl-head]="r === 0">
            @for (cell of row; track $index; let c = $index) {
              <td (pointerdown)="pointAt(r, c)">
                @if (editing()) {
                  <textarea class="nb-tbl-in" rows="1" [attr.data-cell]="r + ':' + c" [attr.aria-label]="'Row ' + (r + 1) + ', column ' + (c + 1)"
                    [value]="cell" [maxLength]="maxCell" (input)="setCell(r, c, $event)" (keydown)="cellKey(r, c, $event)"></textarea>
                } @else {
                  <div class="nb-tbl-text">{{ cell }}</div>
                }
              </td>
            }
            @if (editing()) {
              <td class="nb-tbl-side">
                <button class="nb-tbl-x" [attr.data-remove-row]="r" title="Remove row" aria-label="Remove row" [disabled]="g.rows.length < 2"
                  (pointerdown)="$event.stopPropagation()" (click)="removeRow(r)">×</button>
              </td>
            }
          </tr>
        }
      </table>
    </div>
    @if (editing()) {
      <div class="nb-tbl-add">
        <button data-add-row [disabled]="g.rows.length >= maxRows" (pointerdown)="$event.stopPropagation()" (click)="addRow()">+ Row</button>
        <button data-add-col [disabled]="g.cols >= maxCols" (pointerdown)="$event.stopPropagation()" (click)="addCol()">+ Column</button>
      </div>
    }
  `,
  styles: `
    .nb-tbl { --nb-tbl-line: rgba(128, 128, 128, 0.34); display: block; padding: 12px 14px 14px; font-size: 13.5px; line-height: 1.4; }
    .nb-tbl-title { display: block; margin: 0 0 8px; font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
    .nb-tbl-scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
    .nb-tbl.editing .nb-tbl-scroll { touch-action: pan-x; }
    .nb-tbl-grid { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .nb-tbl-grid td { padding: 0; vertical-align: top; border: 1px solid var(--nb-tbl-line); }
    .nb-tbl-head td { background: rgba(128, 128, 128, 0.12); font-weight: 600; }
    .nb-tbl-text { box-sizing: border-box; min-height: 29px; padding: 5px 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
    nb-card-view .nb-tbl-in { display: block; box-sizing: border-box; min-height: 29px; padding: 5px 7px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
    nb-card-view .nb-tbl-in:focus { box-shadow: inset 0 0 0 1.5px var(--nb-select); }
    .nb-tbl-grid .nb-tbl-ctl td, .nb-tbl-grid td.nb-tbl-side { border: 0; background: none; text-align: center; vertical-align: middle; }
    .nb-tbl-side { width: 24px; }
    .nb-tbl-x { width: 22px; height: 18px; padding: 0; border-radius: 3px; color: var(--nb-muted); font-size: 14px; line-height: 1; opacity: 0.55; }
    .nb-tbl-x:hover:not(:disabled) { opacity: 1; color: var(--nb-danger); background: var(--nb-hover); }
    .nb-tbl-x:disabled { opacity: 0.2; cursor: default; }
    .nb-tbl-add { display: flex; gap: 6px; margin-top: 8px; }
    .nb-tbl-add button { padding: 3px 9px; border: 1px dashed var(--nb-tbl-line); border-radius: 4px; color: var(--nb-muted); font-size: 12.5px; }
    .nb-tbl-add button:hover:not(:disabled) { color: var(--nb-text); background: var(--nb-hover); }
    .nb-tbl-add button:disabled { opacity: 0.4; cursor: default; }
    @media (pointer: coarse) {
      .nb-tbl-side { width: 30px; }
      .nb-tbl-x { width: 28px; height: 26px; opacity: 0.7; }
      .nb-tbl-add button { padding: 7px 12px; }
    }
  `,
})
export class TableCard extends CardPart<'Table'> {
  protected readonly kindName = 'Table' as const;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly appRef = inject(ApplicationRef);

  readonly maxTitle = TABLE_MAX_TITLE;
  readonly maxCell = TABLE_MAX_CELL;
  readonly maxRows = TABLE_MAX_ROWS;
  readonly maxCols = TABLE_MAX_COLS;

  /**
   * The table's data, read again after every board change: cards are edited in place, so the
   * `card` input (and `data()`) keep the same object while its fields change.
   */
  readonly table = computed(
    () => {
      this.ws.rev();
      return this.data() ?? { title: '', cells: [] };
    },
    { equal: () => false },
  );
  /** The cells as shown: rectangular and at least 1×1, whatever is stored. */
  readonly grid = computed(() => {
    const t = this.table();
    const cells = Array.isArray(t.cells) ? t.cells : [];
    const cols = tableCols(cells);
    const rows = cells.length ? cells.map((r) => Array.from({ length: cols }, (_, i) => (Array.isArray(r) ? (r[i] ?? '') : ''))) : [new Array<string>(cols).fill('')];
    return { rows, cols };
  });
  readonly colIdx = computed(() => Array.from({ length: this.grid().cols }, (_, i) => i));

  /** The cell last pressed while not editing: editing starts there. */
  private pressed: CellPos | null = null;
  /** A cell to put the keyboard in once it is drawn. */
  private pending: { at: CellPos; caret: Caret } | null = null;

  constructor() {
    super();
    let was = false;
    afterRenderEffect(() => {
      const editing = this.editing();
      this.grid();
      if (editing && !was) {
        this.pending ??= { at: this.pressed ?? { r: 0, c: 0 }, caret: 'end' };
        this.pressed = null;
      }
      was = editing;
      if (!editing) return void (this.pending = null);
      const p = this.pending;
      if (p && this.cellEl(p.at)) {
        this.pending = null;
        this.focusCell(p.at, p.caret);
      }
    });
  }

  // ---------- editing the data ----------

  setTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value.slice(0, TABLE_MAX_TITLE);
    this.edit((d) => (d.title = v));
  }

  setCell(r: number, c: number, e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value;
    this.edit((d) => setTableCell(this.cellsOf(d), r, c, v));
  }

  addRow(focus?: CellPos): void {
    if (this.grid().rows.length >= TABLE_MAX_ROWS) return this.ws.showToast(`A table can have up to ${TABLE_MAX_ROWS} rows`);
    this.edit((d) => addTableRow(this.cellsOf(d)), true);
    this.after(focus ?? null);
  }

  addCol(): void {
    if (this.grid().cols >= TABLE_MAX_COLS) return this.ws.showToast(`A table can have up to ${TABLE_MAX_COLS} columns`);
    this.edit((d) => addTableColumn(this.cellsOf(d)), true);
    this.after(null);
  }

  removeRow(r: number): void {
    if (this.grid().rows.length < 2) return;
    this.edit((d) => removeTableRow(this.cellsOf(d), r), true);
    this.after(null);
  }

  removeCol(c: number): void {
    if (this.grid().cols < 2) return;
    this.edit((d) => removeTableColumn(this.cellsOf(d), c), true);
    this.after(null);
  }

  private cellsOf(d: { cells: string[][] }): string[][] {
    if (!Array.isArray(d.cells)) d.cells = [];
    return normalizeTable(d.cells);
  }

  /** After a change to the rows or columns: draw it now, then focus a cell (or keep the keyboard away). */
  private after(focus: CellPos | null): void {
    this.appRef.tick();
    if (focus) return this.focusCell(focus, 'end');
    // The pressed button may be gone: keep the focus in the card, but don't open a phone keyboard.
    if (!this.host.nativeElement.contains(document.activeElement)) this.host.nativeElement.querySelector<HTMLElement>('[data-add-row]')?.focus();
  }

  // ---------- keyboard and pointer ----------

  pointAt(r: number, c: number): void {
    if (!this.editing()) this.pressed = { r, c };
  }

  titleKey(e: KeyboardEvent): void {
    this.fieldKey(e);
    if (e.isComposing || e.key === 'Escape') return;
    if ((e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.focusCell({ r: 0, c: 0 }, 'end');
    } else if (e.key === 'Tab') e.preventDefault();
  }

  cellKey(r: number, c: number, e: KeyboardEvent): void {
    this.fieldKey(e);
    if (e.isComposing || e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
    const { rows, cols } = this.grid();
    const n = rows.length;
    const t = e.target as HTMLTextAreaElement;
    if (e.key === 'Tab') {
      e.preventDefault();
      const to = tabTarget(n, cols, { r, c }, e.shiftKey);
      if (to) this.focusCell(to, 'end');
      else if (e.shiftKey) this.host.nativeElement.querySelector<HTMLInputElement>('[data-tbl-title]')?.focus();
      else this.addRow({ r: r + 1, c: 0 });
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 < n) this.focusCell({ r: r + 1, c }, 'end');
      else this.addRow({ r: r + 1, c });
    } else if (e.key === 'ArrowUp' && !e.shiftKey && r > 0 && t.selectionStart === 0 && t.selectionEnd === 0) {
      e.preventDefault();
      this.focusCell({ r: r - 1, c }, 'start');
    } else if (e.key === 'ArrowDown' && !e.shiftKey && r + 1 < n && t.selectionStart === t.value.length && t.selectionEnd === t.value.length) {
      e.preventDefault();
      this.focusCell({ r: r + 1, c }, 'end');
    }
  }

  /** Sideways wheel (or Shift+wheel) scrolls a wide table instead of the board. */
  wheel(e: WheelEvent): void {
    const el = e.currentTarget as HTMLElement;
    if (e.ctrlKey || e.metaKey || el.scrollWidth <= el.clientWidth + 1) return;
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    const before = el.scrollLeft;
    el.scrollLeft += dx;
    if (el.scrollLeft !== before) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ---------- focus ----------

  private cellEl(p: CellPos): HTMLTextAreaElement | null {
    return this.host.nativeElement.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${p.r}:${p.c}"]`);
  }

  private focusCell(p: CellPos, caret: Caret): void {
    const el = this.cellEl(p);
    if (!el) {
      this.pending = { at: p, caret };
      return;
    }
    // preventScroll: the browser would scroll the board's frame; the table and board are moved here.
    el.focus({ preventScroll: true });
    const at = caret === 'start' ? 0 : el.value.length;
    el.setSelectionRange(at, at);
    this.reveal(el);
  }

  /** Scrolls the table sideways, and the board up or down, so the cell being typed in is visible. */
  private reveal(el: HTMLElement): void {
    const scroller = el.closest<HTMLElement>('.nb-tbl-scroll');
    const td = el.parentElement;
    if (scroller && td) {
      const s = scroller.getBoundingClientRect();
      const b = td.getBoundingClientRect();
      if (b.left < s.left) scroller.scrollLeft -= s.left - b.left;
      else if (b.right > s.right) scroller.scrollLeft += Math.min(b.right - s.right, b.left - s.left);
    }
    const frame = el.closest<HTMLElement>('.nb-canvas')?.getBoundingClientRect();
    if (!frame) return;
    const b = el.getBoundingClientRect();
    const dy = b.bottom > frame.bottom - 16 ? frame.bottom - 16 - b.bottom : b.top < frame.top + 16 ? frame.top + 16 - b.top : 0;
    if (dy) {
      const v = this.ws.view();
      this.ws.setView({ zoom: v.zoom, pan: [v.pan[0], v.pan[1] + dy] });
    }
  }
}
