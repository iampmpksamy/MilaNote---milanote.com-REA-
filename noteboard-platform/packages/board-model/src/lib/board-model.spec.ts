import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  Card,
  attachUnsorted,
  columnChildren,
  copyCardsInto,
  deleteCards,
  detach,
  emptyStore,
  findCard,
  getBoard,
  importDesktopStore,
  purge,
  renderNote,
  restore,
  sampleStore,
  validateDesktopFile,
  StoreWithImports,
} from '../index';

// Ported one-to-one from the desktop app's model tests (app/src/model.rs).
function columnAndChildren(s: ReturnType<typeof sampleStore>) {
  const b = getBoard(s, s.root);
  const col = b.cards.find((c) => 'Column' in c.content)!;
  return { col: col.id, kids: columnChildren(b, col.id) };
}

describe('model (ported from the Rust tests)', () => {
  it('deleting a column takes its children, and restore brings them back', () => {
    const s = sampleStore();
    const root = s.root;
    const before = getBoard(s, root).cards.length;
    const { col, kids } = columnAndChildren(s);
    const arrowsBefore = getBoard(s, root).arrows.length;
    expect(deleteCards(s, root, [col])).toBe(1);
    expect(getBoard(s, root).cards.length).toBe(before - 1 - kids.length);
    expect(getBoard(s, root).arrows.length).toBeLessThan(arrowsBefore);
    restore(s, s.trash[0].id);
    expect(getBoard(s, root).cards.length).toBe(before);
    expect(columnChildren(getBoard(s, root), col)).toEqual(kids);
    expect(getBoard(s, root).arrows.length).toBe(arrowsBefore);
  });

  it('a restored child goes back into its column', () => {
    const s = sampleStore();
    const { col, kids } = columnAndChildren(s);
    deleteCards(s, s.root, [kids[1]]);
    expect(columnChildren(getBoard(s, s.root), col).length).toBe(kids.length - 1);
    restore(s, s.trash[0].id);
    expect(columnChildren(getBoard(s, s.root), col)).toContain(kids[1]);
    expect(findCard(getBoard(s, s.root), kids[1])!.container).toEqual({ Column: col });
  });

  it('purging a board card removes its nested boards', () => {
    const s = sampleStore();
    const card = getBoard(s, s.root).cards.find((c) => 'Board' in c.content)!;
    const board = (card.content as { Board: { board: number } }).Board.board;
    deleteCards(s, s.root, [card.id]);
    expect(s.boards[String(board)]).toBeDefined();
    purge(s, s.trash[0].id);
    expect(s.boards[String(board)]).toBeUndefined();
  });

  it('copying a column copies its children, and boards deeply', () => {
    const s = sampleStore();
    const b = getBoard(s, s.root);
    const { col, kids } = columnAndChildren(s);
    const cards: Card[] = [findCard(b, col)!, ...kids.map((k) => findCard(b, k)!)];
    const n = b.cards.length;
    const top = copyCardsInto(s, s.root, cards, [], [30, 30], 0, false);
    expect(top.length).toBe(1);
    expect(getBoard(s, s.root).cards.length).toBe(n + 1 + kids.length);
    const copied = columnChildren(getBoard(s, s.root), top[0]);
    expect(copied.length).toBe(kids.length);
    expect(copied.some((k) => kids.includes(k))).toBe(false);
    const bcard = getBoard(s, s.root).cards.find((c) => 'Board' in c.content)!;
    const boardsBefore = Object.keys(s.boards).length;
    copyCardsInto(s, s.root, [bcard], [], [0, 0], 0, false);
    expect(Object.keys(s.boards).length).toBe(boardsBefore + 1);
  });

  it('unsorted attach and detach', () => {
    const s = sampleStore();
    const b = getBoard(s, s.root);
    const id = b.cards.find((c) => c.container === 'Canvas' && 'Note' in c.content)!.id;
    attachUnsorted(b, id);
    expect(b.unsorted).toContain(id);
    detach(b, id);
    expect(b.unsorted).not.toContain(id);
    expect(findCard(b, id)!.container).toBe('Canvas');
  });

  it('saved boards load back', () => {
    const s = sampleStore();
    const back = JSON.parse(JSON.stringify(s));
    expect(Object.keys(back.boards).length).toBe(Object.keys(s.boards).length);
    expect(getBoard(back, back.root).cards.length).toBe(getBoard(s, s.root).cards.length);
  });
});

describe('desktop importer', () => {
  const sampleText = JSON.stringify(sampleStore());

  it('dry run reports what would be imported without changing anything', () => {
    const target = emptyStore() as StoreWithImports;
    const snapshot = JSON.stringify(target);
    const r = validateDesktopFile(sampleText, target, new Set());
    expect(r.ok).toBe(true);
    expect(r.boards).toBe(4);
    expect(r.cards).toBe(13);
    expect(r.byKind['Board']).toBe(3);
    expect(JSON.stringify(target)).toBe(snapshot);
  });

  it('import keeps hierarchy, columns, lines and task states, and refuses a second import', () => {
    const target = emptyStore() as StoreWithImports;
    const r = validateDesktopFile(sampleText, target);
    const home = importDesktopStore(target, r, 'Imported from desktop');
    const imported = target.boards[String(home)];
    expect(imported.parent).toBe(target.root);
    expect(imported.name).toBe('Imported from desktop');
    const src = sampleStore();
    const srcHome = getBoard(src, src.root);
    expect(imported.cards.length).toBe(srcHome.cards.length);
    expect(imported.arrows.length).toBe(srcHome.arrows.length);
    // a nested board is still nested, under the imported home
    const nested = Object.values(target.boards).find((b) => b.name === 'Project ideas')!;
    expect(nested.parent).toBe(home);
    expect(nested.icon).toBe('💡');
    // column children were remapped consistently
    const col = imported.cards.find((c) => 'Column' in c.content)!;
    for (const k of columnChildren(imported, col.id)) expect(findCard(imported, k)!.container).toEqual({ Column: col.id });
    // tasks kept their state
    const todo = imported.cards.find((c) => 'Todo' in c.content)!.content as { Todo: { items: { done: boolean }[] } };
    expect(todo.Todo.items.map((i) => i.done)).toEqual([true, true, false, false]);
    // duplicate prevention
    expect(validateDesktopFile(sampleText, target).alreadyImported).toBe(true);
    expect(() => importDesktopStore(target, r, 'again')).toThrow();
  });

  it('rejects broken files and repairs dangling references with warnings', () => {
    expect(validateDesktopFile('not json').ok).toBe(false);
    expect(validateDesktopFile('{"boards": 3}').ok).toBe(false);
    const s = JSON.parse(sampleText);
    const home = s.boards[String(s.root)];
    home.arrows.push({ id: 999, from: 12345, to: home.cards[0].id, color: 0, dashed: false, head: true });
    const r = validateDesktopFile(JSON.stringify(s));
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.includes('missing card'))).toBe(true);
    expect(r.arrows).toBe(3);
  });

  // Copies of the person's real desktop data (kept out of Git); skipped when not present.
  const backups = join(__dirname, '..', '..', '..', '..', '..', 'backups');
  const files = existsSync(backups) ? readdirSync(backups).filter((f) => f.startsWith('user-boards') && f.endsWith('.json')) : [];
  it.each(files.length ? files : ['(no copy available)'])('imports the real saved boards copy %s with nothing lost', (f) => {
    if (!files.length) return;
    const text = readFileSync(join(backups, f), 'utf8');
    const raw = JSON.parse(text);
    const cardsIn = Object.values(raw.boards as Record<string, { cards: unknown[] }>).reduce((n, b) => n + b.cards.length, 0);
    const target = emptyStore() as StoreWithImports;
    const r = validateDesktopFile(text, target);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.cards).toBe(cardsIn);
    const home = importDesktopStore(target, r, 'Desktop');
    const after = Object.values(target.boards).reduce((n, b) => n + b.cards.length, 0);
    expect(after).toBe(cardsIn + 1); // plus the board card pointing to the import
    expect(target.boards[String(home)]).toBeDefined();
    // the source text is untouched
    expect(readFileSync(join(backups, f), 'utf8')).toBe(text);
  });
});

describe('note formatting', () => {
  it('renders the same marks as the desktop app', () => {
    const html = renderNote('# Title\n- **bold** and *it* and __u__ and ~~s~~\n> quote\nsee https://example.com');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li><strong>bold</strong> and <em>it</em> and <u>u</u> and <s>s</s></li>');
    expect(html).toContain('<blockquote>quote</blockquote>');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('never lets a note inject markup', () => {
    const html = renderNote('<img src=x onerror=alert(1)> <script>x</script> javascript:alert(1)');
    expect(html).not.toMatch(/<img|<script|href="javascript/);
    expect(html).toContain('&lt;img');
  });
});
