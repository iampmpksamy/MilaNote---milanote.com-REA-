/**
 * Plain helpers for the Table card's grid (`cells[row][column]`). They change the array they are
 * given, so they can run inside a card edit. Limits match the server check (board-model check.ts).
 */
export const TABLE_MAX_ROWS = 500;
export const TABLE_MAX_COLS = 100;
export const TABLE_MAX_CELL = 10_000;
export const TABLE_MAX_TITLE = 500;

/** Number of columns shown: the longest row (at least 1). */
export function tableCols(cells: readonly (readonly string[])[]): number {
  let n = 1;
  for (const r of cells) if (r.length > n) n = r.length;
  return Math.min(n, TABLE_MAX_COLS);
}

/** Makes the grid rectangular and at least 1×1 (rows from older or merged data may be short). */
export function normalizeTable(cells: string[][]): string[][] {
  if (!cells.length) cells.push(['']);
  const cols = tableCols(cells);
  for (let r = 0; r < cells.length; r++) {
    if (!Array.isArray(cells[r])) cells[r] = [];
    const row = cells[r];
    while (row.length < cols) row.push('');
  }
  return cells;
}

export function setTableCell(cells: string[][], r: number, c: number, v: string): void {
  normalizeTable(cells);
  if (r < 0 || c < 0 || r >= TABLE_MAX_ROWS || c >= TABLE_MAX_COLS) return;
  while (cells.length <= r) cells.push(new Array(tableCols(cells)).fill(''));
  const row = cells[r];
  while (row.length <= c) row.push('');
  row[c] = v.slice(0, TABLE_MAX_CELL);
  normalizeTable(cells);
}

/** Adds an empty row at `at` (default: the end). False when the table is full. */
export function addTableRow(cells: string[][], at = cells.length): boolean {
  normalizeTable(cells);
  if (cells.length >= TABLE_MAX_ROWS) return false;
  cells.splice(Math.max(0, Math.min(at, cells.length)), 0, new Array(tableCols(cells)).fill(''));
  return true;
}

/** Adds an empty column at `at` (default: the end). False when the table is full. */
export function addTableColumn(cells: string[][], at?: number): boolean {
  normalizeTable(cells);
  const cols = tableCols(cells);
  if (cols >= TABLE_MAX_COLS) return false;
  const i = Math.max(0, Math.min(at ?? cols, cols));
  for (const row of cells) row.splice(i, 0, '');
  return true;
}

/** Removes a row; the last remaining row is kept (cleared instead). */
export function removeTableRow(cells: string[][], r: number): void {
  normalizeTable(cells);
  if (r < 0 || r >= cells.length) return;
  if (cells.length === 1) cells[0] = cells[0].map(() => '');
  else cells.splice(r, 1);
}

/** Removes a column; the last remaining column is kept (cleared instead). */
export function removeTableColumn(cells: string[][], c: number): void {
  normalizeTable(cells);
  const cols = tableCols(cells);
  if (c < 0 || c >= cols) return;
  for (const row of cells) {
    if (cols === 1) row[0] = '';
    else row.splice(c, 1);
  }
}

export type CellPos = { r: number; c: number };

/**
 * The cell Tab (forward) or Shift+Tab (back) goes to, row by row. `null` going forward from the
 * last cell means "add a row"; `null` going back from the first cell means "the title".
 */
export function tabTarget(rows: number, cols: number, at: CellPos, back: boolean): CellPos | null {
  const i = at.r * cols + at.c + (back ? -1 : 1);
  if (i < 0 || i >= rows * cols) return null;
  return { r: Math.floor(i / cols), c: i % cols };
}
