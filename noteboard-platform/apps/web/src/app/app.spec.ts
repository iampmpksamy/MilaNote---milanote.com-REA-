import { TestBed } from '@angular/core/testing';
import { MemoryStorage, STORAGE, Workspace, WorkspaceView } from '@noteboard/ui-workspace';

describe('Workspace (component)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkspaceView],
      providers: [{ provide: STORAGE, useValue: new MemoryStorage() }],
    }).compileComponents();
  });

  it('shows the header, the toolbar and the sample board', async () => {
    const fixture = TestBed.createComponent(WorkspaceView);
    const ws = fixture.debugElement.injector.get(Workspace);
    await ws.init();
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.nb-crumb.current')?.textContent).toContain('Home');
    expect(el.querySelectorAll('.nb-tool').length).toBeGreaterThan(10);
    expect(el.querySelectorAll('nb-card-view').length).toBeGreaterThan(5);
  });

  it('switches the toolbar to board tools when a board is selected', async () => {
    const fixture = TestBed.createComponent(WorkspaceView);
    const ws = fixture.debugElement.injector.get(Workspace);
    await ws.init();
    const board = ws.board().cards.find((c) => 'Board' in c.content)!;
    ws.select(board.id);
    fixture.detectChanges();
    const tools = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.nb-tool')].map((b) => b.getAttribute('data-tool'));
    expect(tools).toEqual(expect.arrayContaining(['Back', 'Color', 'Icon', 'Rename', 'Open', 'Duplicate', 'More', 'Trash']));
  });

  it('undo and redo an edit, and the theme shortcut state', async () => {
    const fixture = TestBed.createComponent(WorkspaceView);
    const ws = fixture.debugElement.injector.get(Workspace);
    await ws.init();
    const n = ws.board().cards.length;
    ws.create('Note', { at: { x: 0, y: 900 } });
    expect(ws.board().cards.length).toBe(n + 1);
    ws.undo();
    expect(ws.board().cards.length).toBe(n);
    ws.redo();
    expect(ws.board().cards.length).toBe(n + 1);
    ws.toggleTheme();
    expect(ws.dark()).toBe(true);
  });
});
