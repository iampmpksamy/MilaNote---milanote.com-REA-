import { TestBed } from '@angular/core/testing';
import { Card, CommentEntry, nowSecs } from '@noteboard/board-model';
import { MemoryStorage, STORAGE } from '../storage';
import { Workspace } from '../workspace.service';
import { CommentCard, avatarColor, initials, repliesLabel } from './comment.card';

async function setup(entries: CommentEntry[] = [], resolved = false) {
  TestBed.configureTestingModule({ providers: [Workspace, { provide: STORAGE, useValue: new MemoryStorage() }] });
  const ws = TestBed.inject(Workspace);
  await ws.init();
  ws.authorName.set('Ada Lovelace');
  const id = ws.create('Comment', { at: { x: 0, y: 2000 } })!;
  ws.updateCard(id, (c) => 'Comment' in c.content && Object.assign(c.content.Comment, { entries, resolved }));
  const fixture = TestBed.createComponent(CommentCard);
  fixture.componentRef.setInput('card', ws.card(id)!);
  fixture.componentRef.setInput('editing', true);
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const thread = () => (ws.card(id)! as Card & { content: { Comment: { entries: CommentEntry[]; resolved: boolean } } }).content.Comment;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { ws, id, fixture, el, thread, render };
}

function type(el: HTMLElement, text: string, key: Partial<KeyboardEventInit> = { key: 'Enter' }) {
  const ta = el.querySelector<HTMLTextAreaElement>('textarea.nb-comment-input')!;
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...key });
  ta.dispatchEvent(e);
  return e;
}

describe('comment card helpers', () => {
  it('initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('sam')).toBe('S');
    expect(initials('jo.doe@mail.example')).toBe('JD');
    expect(initials('  ')).toBe('?');
    expect(initials('élodie van der berg')).toBe('ÉB');
  });
  it('avatar colours are stable per name', () => {
    expect(avatarColor('Ada')).toBe(avatarColor(' ada '));
    expect(avatarColor('Ada')).not.toBe(avatarColor('Grace'));
    expect(avatarColor('Ada')).toMatch(/^hsl\(\d+ 42% 46%\)$/);
  });
  it('replies label', () => {
    expect(repliesLabel(0)).toBe('0 replies');
    expect(repliesLabel(2)).toBe('1 reply');
    expect(repliesLabel(4)).toBe('3 replies');
  });
});

describe('CommentCard', () => {
  it('Enter posts as the current person; Shift+Enter and blank text do not', async () => {
    const { el, thread, render, ws } = await setup();
    const shift = type(el, 'line one', { key: 'Enter', shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    expect(thread().entries).toHaveLength(0);
    type(el, '   \n  ');
    expect(thread().entries).toHaveLength(0);
    type(el, 'line one\nline two');
    expect(thread().entries).toHaveLength(1);
    const e = thread().entries[0];
    expect(e.text).toBe('line one\nline two');
    expect(e.author).toBe('Ada Lovelace');
    expect(Math.abs(e.at - nowSecs())).toBeLessThan(3);
    await render();
    expect(el.querySelector<HTMLTextAreaElement>('textarea.nb-comment-input')!.value).toBe('');
    expect(el.querySelector('.nb-comment-text')!.textContent).toBe('line one\nline two');
    expect(el.querySelector('.nb-comment-avatar')!.textContent!.trim()).toBe('AL');
    expect(el.querySelector('time')!.textContent).toBe('just now');
    // Posting is its own undo step.
    ws.undo();
    expect(thread().entries).toHaveLength(0);
  });

  it('only your own entries can be deleted', async () => {
    const t = nowSecs() - 7200;
    const { el, thread, render } = await setup([
      { text: 'mine', author: 'Ada Lovelace', at: t },
      { text: 'theirs', author: 'Grace Hopper', at: t + 60 },
    ]);
    expect(el.querySelectorAll('.nb-comment-del')).toHaveLength(1);
    expect(el.querySelectorAll('time')[0].textContent).toBe('2 h ago');
    el.querySelector<HTMLButtonElement>('[data-entry="0"] .nb-comment-del')!.click();
    expect(thread().entries.map((x) => x.text)).toEqual(['theirs']);
    await render();
    expect(el.querySelectorAll('.nb-comment-del')).toHaveLength(0);
  });

  it('resolving folds the thread to its first entry; a reply reopens it', async () => {
    const t = nowSecs() - 100;
    const { el, thread, render, fixture } = await setup([
      { text: 'first', author: 'Grace Hopper', at: t },
      { text: 'second', author: 'Ada Lovelace', at: t },
      { text: 'third', author: 'Ada Lovelace', at: t },
    ]);
    el.querySelector<HTMLButtonElement>('.nb-comment-resolve')!.click();
    expect(thread().resolved).toBe(true);
    fixture.componentRef.setInput('editing', false);
    await render();
    expect(el.querySelectorAll('.nb-comment-entry')).toHaveLength(1);
    expect(el.querySelector('.nb-comment-status')!.textContent).toContain('Resolved · 2 replies');
    el.querySelector<HTMLButtonElement>('.nb-comment-reopen')!.click();
    expect(thread().resolved).toBe(false);
    await render();
    expect(el.querySelectorAll('.nb-comment-entry')).toHaveLength(3);
    // Resolve again, then reply while editing.
    fixture.componentRef.setInput('editing', true);
    await render();
    el.querySelector<HTMLButtonElement>('.nb-comment-resolve')!.click();
    expect(thread().resolved).toBe(true);
    await render();
    type(el, 'one more thing');
    expect(thread().resolved).toBe(false);
    expect(thread().entries).toHaveLength(4);
  });

  it('shows a prompt when there is nothing yet', async () => {
    const { el, render, fixture } = await setup();
    fixture.componentRef.setInput('editing', false);
    await render();
    expect(el.querySelector('.nb-comment-prompt')!.textContent).toBe('Write a comment…');
  });
});
