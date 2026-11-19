import { TestBed } from '@angular/core/testing';
import { getBoard } from '@noteboard/board-model';
import { MemoryStorage, STORAGE } from './storage';
import { Workspace } from './workspace.service';

async function setup() {
  const storage = new MemoryStorage();
  TestBed.configureTestingModule({ providers: [Workspace, { provide: STORAGE, useValue: storage }] });
  const ws = TestBed.inject(Workspace);
  await ws.init();
  return { ws, storage };
}

describe('Workspace service', () => {
  it('starts with the sample boards and saves them', async () => {
    const { ws, storage } = await setup();
    expect(ws.path().map((b) => b.name)).toEqual(['Home']);
    ws.create('Note', { at: { x: 0, y: 900 } });
    await ws.saveNow();
    expect(storage.store).not.toBeNull();
    expect(getBoard(storage.store!, storage.store!.root).cards.length).toBe(ws.board().cards.length);
  });

  it('a new board is ready to rename, and renaming keeps its id', async () => {
    const { ws } = await setup();
    const id = ws.create('Board', { at: { x: 0, y: 600 } })!;
    expect(ws.editing()).toBe(id);
    ws.renameBoard(id, 'Plans');
    expect(ws.boardOf(ws.card(id)!)!.name).toBe('Plans');
  });

  it('a free line attaches to a card and detaches again', async () => {
    const { ws } = await setup();
    ws.create('Line', { at: { x: 0, y: 0 } });
    const id = ws.selectedArrow()!;
    const card = ws.board().cards.find((c) => 'Board' in c.content)!.id;
    ws.setArrowEnd(id, 1, card, { x: 0, y: 0 });
    expect(ws.board().arrows.find((a) => a.id === id)!.to).toBe(card);
    ws.setArrowEnd(id, 1, null, { x: 50, y: 60 });
    const a = ws.board().arrows.find((x) => x.id === id)!;
    expect(a.to).toBe(0);
    expect(a.to_pt).toEqual([50, 60]);
  });

  it('dragging into a column and into the drawer', async () => {
    const { ws } = await setup();
    const b = ws.board();
    const col = b.cards.find((c) => 'Column' in c.content)!.id;
    const note = b.cards.find((c) => c.container === 'Canvas' && 'Note' in c.content)!.id;
    ws.beginDrag([note], new Map([[note, { x: 0, y: 0, w: 260, h: 80 }]]));
    ws.endDrag([note], { column: col, index: 0 });
    expect(ws.card(note)!.container).toEqual({ Column: col });
    ws.beginDrag([note], new Map([[note, { x: 0, y: 0, w: 250, h: 80 }]]));
    ws.endDrag([note], 'unsorted');
    expect(ws.board().unsorted).toContain(note);
  });

  it('delete goes to the trash; undo, redo and restore', async () => {
    const { ws } = await setup();
    const note = ws.board().cards.find((c) => c.container === 'Canvas' && 'Note' in c.content)!.id;
    ws.select(note);
    ws.deleteSelection();
    expect(ws.card(note)).toBeUndefined();
    expect(ws.trash().length).toBe(1);
    ws.undo();
    expect(ws.card(note)).toBeDefined();
    ws.redo();
    expect(ws.card(note)).toBeUndefined();
    ws.restoreTrash(ws.trash()[0].id);
    expect(ws.card(note)).toBeDefined();
  });

  it('copy and paste makes new cards; pasting other text makes a note or a link', async () => {
    const { ws } = await setup();
    const n = ws.board().cards.length;
    const note = ws.board().cards.find((c) => c.container === 'Canvas' && 'Note' in c.content)!.id;
    ws.select(note);
    const text = ws.copy();
    ws.paste(text, { x: 500, y: 500 });
    expect(ws.board().cards.length).toBe(n + 1);
    ws.paste('https://example.org/page', { x: 0, y: 0 });
    expect(ws.board().cards.some((c) => 'Link' in c.content && c.content.Link.url === 'https://example.org/page')).toBe(true);
  });

  it('search finds cards on every board and opens the right one', async () => {
    const { ws } = await setup();
    ws.search.set('every board');
    const hit = ws.hits()[0];
    expect(hit.title).toBe('Ideas');
    ws.gotoHit(hit);
    expect(ws.path().map((b) => b.name)).toEqual(['Home', 'Project ideas']);
  });

  it('theme and interface size preferences are stored', async () => {
    const { ws, storage } = await setup();
    ws.toggleTheme();
    ws.setScale(2);
    await Promise.resolve();
    expect(ws.dark()).toBe(true);
    expect(storage.prefs?.theme).toBe('Dark');
    expect(storage.prefs?.scale).toBe(2);
  });
});
