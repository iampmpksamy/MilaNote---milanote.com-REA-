/**
 * Comment card: a short discussion thread shaped like a speech bubble.
 *
 * - Viewing: every entry (avatar, name, how long ago, text), newest at the bottom; a resolved thread
 *   folds to its first entry with "Resolved · N replies" and a Reopen button.
 * - Editing: a "Write a comment…" field at the bottom (Enter posts, Shift+Enter is a new line), a ×
 *   on your own entries, and a Resolve toggle. Posting, deleting and resolving are each one undo step.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CommentEntry, ago, nowSecs } from '@noteboard/board-model';
import { CardPart } from './card-part';

/** Server limits (board-model check.ts). */
const MAX_ENTRIES = 2000;
const MAX_TEXT = 20_000;
const MAX_AUTHOR = 200;

/** "Ada Lovelace" → "AL", "sam" → "S", "jo.doe@mail" → "JD", "" → "?". */
export function initials(name: string): string {
  const words = name.split('@')[0].split(/[\s._-]+/).filter(Boolean);
  const first = (w: string) => (Array.from(w)[0] ?? '').toUpperCase();
  if (!words.length) return '?';
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}

/** A steady colour for a name (the same name always gets the same colour). */
export function avatarColor(name: string): string {
  let h = 2166136261;
  for (const ch of name.trim().toLowerCase()) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return `hsl(${(h >>> 0) % 360} 42% 46%)`;
}

export function repliesLabel(entries: number): string {
  const n = Math.max(0, entries - 1);
  return n === 1 ? '1 reply' : `${n} replies`;
}

// One clock for every comment card, so "5 min ago" moves on without a timer per card.
const clock = signal(nowSecs());
let clockUsers = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
function useClock(destroy: DestroyRef): void {
  if (clockUsers++ === 0) {
    clockTimer = setInterval(() => clock.set(nowSecs()), 30_000);
    setTimeout(() => clock.set(nowSecs()));
  }
  destroy.onDestroy(() => {
    if (--clockUsers === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  });
}

@Component({
  selector: 'nb-comment-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = thread();
    @let me = ws.authorName();
    @let folded = d.resolved && !editing();
    <div class="nb-comment-body" [class.resolved]="folded">
      @if (folded) {
        @if (d.entries[0]; as e) {
          <ng-container *ngTemplateOutlet="entry; context: { $implicit: e, i: 0, own: false }" />
        }
        <div class="nb-comment-status">
          <span>Resolved · {{ replies(d.entries.length) }}</span>
          <button class="nb-comment-reopen" (pointerdown)="$event.stopPropagation()" (click)="setResolved(false); $event.stopPropagation()">Reopen</button>
        </div>
      } @else {
        @if (d.entries.length) {
          <div #list class="nb-comment-list" (wheel)="listWheel($event)" (pointerdown)="listDown($event)">
            @for (e of d.entries; track $index; let i = $index) {
              <ng-container *ngTemplateOutlet="entry; context: { $implicit: e, i: i, own: editing() && e.author === me }" />
            }
          </div>
        } @else if (!editing()) {
          <div class="nb-comment-prompt">Write a comment…</div>
        }
        @if (editing()) {
          <textarea #field class="nb-comment-input" rows="1" placeholder="Write a comment…" [attr.maxlength]="maxText" [value]="draft()"
            (input)="typed($event)" (keydown)="key($event)"></textarea>
          <div class="nb-comment-bar">
            <button class="nb-comment-resolve" [class.on]="d.resolved" [attr.aria-pressed]="d.resolved" (pointerdown)="$event.stopPropagation()"
              (click)="setResolved(!d.resolved)">✓ {{ d.resolved ? 'Resolved' : 'Resolve' }}</button>
            <span class="nb-comment-hint" title="Shift+Enter for a new line">Enter to post</span>
            <button class="nb-comment-post" [disabled]="!draft().trim()" (pointerdown)="$event.stopPropagation(); $event.preventDefault()" (click)="post()">Post</button>
          </div>
        }
      }
    </div>
    <span class="nb-comment-tail" aria-hidden="true"></span>

    <ng-template #entry let-e let-i="i" let-own="own">
      <div class="nb-comment-entry" [attr.data-entry]="i">
        <span class="nb-comment-avatar" [style.background]="color(e.author)" [title]="e.author">{{ initialsOf(e.author) }}</span>
        <div class="nb-comment-main">
          <div class="nb-comment-meta">
            <b>{{ e.author }}</b>
            <time [title]="fullDate(e.at)">{{ when(e.at) }}</time>
            @if (own) {
              <button class="nb-comment-del" title="Delete this comment" aria-label="Delete this comment" (pointerdown)="$event.stopPropagation()" (click)="remove(i, e)">×</button>
            }
          </div>
          <div class="nb-comment-text">{{ e.text }}</div>
        </div>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: [
    `
      nb-comment-card { display: block; position: relative; padding: 12px 14px; font-size: 14px; background: inherit; border-radius: inherit; }
      .nb-comment-tail { position: absolute; left: 18px; bottom: -9px; width: 15px; height: 10px; background: inherit; clip-path: polygon(0 0, 100% 0, 0 100%); }
      .nb-comment-body.resolved { opacity: 0.68; }
      .nb-comment-list { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; touch-action: none; }
      .nb-comment-entry { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; }
      .nb-comment-avatar { width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 600; line-height: 26px; text-align: center; letter-spacing: 0.02em; overflow: hidden; }
      .nb-comment-meta { display: flex; align-items: baseline; gap: 6px; min-height: 18px; }
      .nb-comment-meta b { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .nb-comment-meta time { flex: none; color: var(--nb-muted); font-size: 12px; }
      .nb-comment-text { margin-top: 1px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
      .nb-comment-prompt { color: var(--nb-muted); }
      .nb-comment-status { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--nb-muted); font-size: 12.5px; }
      nb-comment-card button.nb-comment-del { flex: none; margin-left: auto; width: 20px; height: 20px; border-radius: 4px; color: var(--nb-muted); font-size: 16px; line-height: 1; }
      nb-comment-card button.nb-comment-del:hover { color: var(--nb-danger); background: var(--nb-hover); }
      nb-comment-card button.nb-comment-reopen { margin-left: auto; padding: 2px 8px; border-radius: 4px; color: var(--nb-select); font-size: 12.5px; }
      nb-comment-card button.nb-comment-reopen:hover { background: var(--nb-hover); }
      nb-comment-card textarea.nb-comment-input { display: block; box-sizing: border-box; margin-top: 10px; min-height: 34px; max-height: 160px; overflow-y: auto; padding: 6px 8px; border-radius: 4px; box-shadow: inset 0 0 0 1px var(--nb-border); background: var(--nb-card); font-size: 14px; line-height: 1.4; }
      nb-comment-card textarea.nb-comment-input:focus { box-shadow: inset 0 0 0 1px var(--nb-select); }
      .nb-comment-list + textarea.nb-comment-input { margin-top: 12px; }
      nb-comment-card > .nb-comment-body > textarea.nb-comment-input:first-child { margin-top: 0; }
      .nb-comment-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; }
      .nb-comment-hint { flex: 1; min-width: 0; color: var(--nb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      nb-comment-card button.nb-comment-resolve { flex: none; padding: 1px 8px; border: 1px solid var(--nb-border); border-radius: 4px; color: var(--nb-muted); font-size: 12px; }
      nb-comment-card button.nb-comment-resolve:hover { background: var(--nb-hover); }
      nb-comment-card button.nb-comment-resolve.on { color: #2f8a62; border-color: #3d9970; }
      nb-comment-card button.nb-comment-post { flex: none; margin-left: auto; padding: 1px 10px; border-radius: 4px; background: var(--nb-select); color: #fff; font-size: 12px; }
      nb-comment-card button.nb-comment-post:disabled { opacity: 0.4; cursor: default; }
      .dark nb-comment-card button.nb-comment-resolve.on { color: #6cc59a; }
      @media (max-width: 640px), (pointer: coarse) {
        .nb-comment-hint { visibility: hidden; }
        nb-comment-card button.nb-comment-del { width: 28px; height: 28px; margin: -5px -6px -5px auto; }
        nb-comment-card button.nb-comment-resolve, nb-comment-card button.nb-comment-post, nb-comment-card button.nb-comment-reopen { min-height: 30px; padding: 0 12px; }
      }
    `,
  ],
})
export class CommentCard extends CardPart<'Comment'> {
  protected readonly kindName = 'Comment' as const;
  protected readonly maxText = MAX_TEXT;
  /**
   * The thread, re-read on every board change: edits change the card in place, so the card input
   * alone doesn't tell this view that an entry was added.
   */
  readonly thread = computed(
    () => {
      this.ws.rev();
      return this.data();
    },
    { equal: () => false },
  );
  /** What is being typed (not part of the card until it is posted). */
  readonly draft = signal('');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private seen = -1;
  private wasEditing = false;

  constructor() {
    super();
    useClock(inject(DestroyRef));
    afterRenderEffect(() => {
      const n = this.thread().entries.length;
      const editing = this.editing();
      const list = this.list()?.nativeElement;
      const field = this.field()?.nativeElement;
      if (list) {
        // Keep the newest entry in view when one arrives or the list (re)appears.
        if (n > this.seen || editing !== this.wasEditing) list.scrollTop = list.scrollHeight;
        // While editing, a finger scrolls a long thread instead of moving the card.
        list.style.touchAction = editing && list.scrollHeight > list.clientHeight + 1 ? 'pan-y' : '';
      }
      if (field) grow(field);
      if (editing && !this.wasEditing && field && !this.host.nativeElement.contains(document.activeElement)) field.focus();
      this.seen = n;
      this.wasEditing = editing;
    });
  }

  protected initialsOf = initials;
  protected color = avatarColor;
  protected replies = repliesLabel;

  protected when(at: number): string {
    return ago(at, Math.max(clock(), at));
  }

  protected fullDate(at: number): string {
    return new Date(at * 1000).toLocaleString();
  }

  protected typed(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    this.draft.set(t.value);
    grow(t);
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      e.stopPropagation();
      this.post();
      return;
    }
    this.fieldKey(e);
  }

  /** Adds what was typed as a new entry by the current person (blank text is ignored). */
  post(): void {
    const text = this.draft().replace(/^\s*\n|\s+$/g, '').slice(0, MAX_TEXT);
    if (!text.trim()) return;
    if (this.thread().entries.length >= MAX_ENTRIES) {
      this.ws.showToast('This thread is full: start a new comment card');
      return;
    }
    const entry: CommentEntry = { text, author: this.ws.authorName().slice(0, MAX_AUTHOR) || 'You', at: nowSecs() };
    clock.set(entry.at);
    this.edit((d) => {
      d.entries.push(entry);
      // A reply reopens a resolved thread.
      d.resolved = false;
    }, true);
    this.draft.set('');
    const f = this.field()?.nativeElement;
    if (f) {
      f.value = '';
      grow(f);
      f.focus();
    }
  }

  /** Deletes entry `i` (looked up again by content, in case the thread changed meanwhile). */
  remove(i: number, e: CommentEntry): void {
    if (e.author !== this.ws.authorName()) return;
    this.edit((d) => {
      const same = (x: CommentEntry | undefined) => !!x && x.at === e.at && x.author === e.author && x.text === e.text;
      const k = same(d.entries[i]) ? i : d.entries.findIndex(same);
      if (k >= 0) d.entries.splice(k, 1);
    }, true);
  }

  setResolved(on: boolean): void {
    if (this.thread().resolved !== on) this.edit((d) => (d.resolved = on), true);
  }

  /** The wheel scrolls a long thread (until its end), and the board otherwise. */
  protected listWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey || !e.deltaY) return;
    const el = e.currentTarget as HTMLElement;
    const room = e.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    if (room) e.stopPropagation();
  }

  protected listDown(e: PointerEvent): void {
    if (e.pointerType === 'touch' && (e.currentTarget as HTMLElement).style.touchAction === 'pan-y') e.stopPropagation();
  }
}

function grow(t: HTMLTextAreaElement): void {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}
