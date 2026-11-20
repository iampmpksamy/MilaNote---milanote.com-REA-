import { ApplicationRef, ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, forwardRef, inject, input } from '@angular/core';
import { Card, CardId, TodoItem, findCard, renderNote } from '@noteboard/board-model';
// Each kind is imported from its own file and used only inside @defer, so it loads on demand.
import { AudioCard } from './cards/audio.card';
import { ColorCard } from './cards/color.card';
import { CommentCard } from './cards/comment.card';
import { DocumentCard } from './cards/document.card';
import { HeadingCard } from './cards/heading.card';
import { MapCard } from './cards/map.card';
import { SketchCard } from './cards/sketch.card';
import { TableCard } from './cards/table.card';
import { VideoCard } from './cards/video.card';
import { BOARD_COLORS, CARD_COLORS, boardIsDark } from './prefs';
import { Workspace } from './workspace.service';

const domainOf = (url: string) => url.trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./, '');

/** One card. Moving, selecting and connecting are handled by the canvas; typing happens here. */
@Component({
  selector: 'nb-card-view',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A column shows its cards with this same component.
  imports: [forwardRef(() => CardView), HeadingCard, ColorCard, DocumentCard, SketchCard, AudioCard, VideoCard, MapCard, CommentCard, TableCard],
  host: {
    '[class]': 'hostClass()',
    '[attr.data-card]': 'card().id',
    '[attr.data-kind]': 'kind()',
    '[style.width.px]': 'card().width',
    '[style.background]': 'fill()',
  },
  template: `
    @let c = card();
    @switch (kind()) {
      @case ('Note') {
        @if (editing()) {
          <textarea class="nb-note-edit" [style.text-align]="align()" [value]="noteText()" placeholder="Start typing..."
            (input)="setNote($event)" (keydown)="fieldKey($event)" rows="1"></textarea>
        } @else if (noteText().trim()) {
          <div class="nb-note-text" [style.text-align]="align()" [innerHTML]="noteHtml()"></div>
        } @else {
          <div class="nb-placeholder">Start typing...</div>
        }
      }
      @case ('Todo') {
        @if (editing() || todoTitle()) {
          <div class="nb-todo-head">
            @if (editing()) {
              <input class="nb-todo-title" [value]="todoTitle()" placeholder="Title (optional)" (input)="setTodoTitle($event)" (keydown)="fieldKey($event)" />
            } @else {
              <span class="nb-todo-title">{{ todoTitle() }}</span>
            }
            @if (items().length) { <span class="nb-muted">{{ doneCount() }}/{{ items().length }}</span> }
          </div>
        }
        @for (it of items(); track $index; let i = $index) {
          <div class="nb-task" [class.done]="it.done">
            <button class="nb-check" [attr.data-check]="i" [class.on]="it.done" (click)="toggle(i); $event.stopPropagation()" (pointerdown)="$event.stopPropagation()" aria-label="Done"></button>
            @if (editing()) {
              <input class="nb-task-text" [attr.data-item]="i" [value]="it.text" placeholder="Add a task..." (input)="setItem(i, $event)" (keydown)="itemKey(i, $event)" />
              <button class="nb-mini" title="Remove" (click)="removeItem(i)">×</button>
            } @else {
              <span class="nb-task-text">{{ it.text || 'Add a task...' }}</span>
            }
          </div>
        }
        @if (editing()) { <button class="nb-add-task" (click)="addItem()">+&nbsp; Add a task</button> }
      }
      @case ('Link') {
        @if (editing()) {
          <span class="nb-muted">Web address</span>
          <input class="nb-field" [value]="linkUrl()" placeholder="https://" (input)="setLink('url', $event)" (keydown)="fieldKey($event)" />
          <span class="nb-muted">Title</span>
          <input class="nb-field" [value]="linkTitle()" placeholder="Optional" (input)="setLink('title', $event)" (keydown)="fieldKey($event)" />
        } @else {
          <div class="nb-link-row">
            <div class="nb-link-tile" [style.background]="tileColor()">{{ letter() }}</div>
            <div>
              <div class="nb-link-title">{{ linkTitle() || domain() || 'Untitled link' }}</div>
              <div class="nb-muted">{{ domain() || 'Double-click to add a web address' }}</div>
            </div>
          </div>
          @if (safeUrl()) { <a class="nb-open" [href]="safeUrl()" target="_blank" rel="noopener noreferrer" (pointerdown)="$event.stopPropagation()">Open ↗</a> }
        }
      }
      @case ('Image') {
        @if (imageUrl()) {
          <img class="nb-img" [src]="imageUrl()" alt="" draggable="false" [style.aspect-ratio]="1 / aspect()" />
        } @else {
          <div class="nb-img missing" [style.aspect-ratio]="1 / aspect()">Picture not found</div>
        }
        @if (editing()) {
          <textarea class="nb-caption" [value]="caption()" placeholder="Add a caption..." (input)="setCaption($event)" (keydown)="fieldKey($event)" rows="1"></textarea>
        } @else if (caption()) {
          <div class="nb-caption">{{ caption() }}</div>
        }
      }
      @case ('Board') {
        @let b = ws.boardOf(c);
        <div class="nb-board-square" [style.background]="boardFill()" [class.light-glyph]="boardDark()">{{ b?.icon ?? '' }}</div>
        @if (editing()) {
          <input class="nb-board-name-edit" [value]="b?.name ?? ''" (input)="rename($event)" (keydown)="nameKey($event)" />
        } @else {
          <div class="nb-board-name">{{ b?.name ?? 'Missing board' }}</div>
        }
        <div class="nb-muted nb-count">{{ countLabel() }}</div>
      }
      @case ('Column') {
        <div class="nb-col-head">
          @if (editing()) {
            <input class="nb-col-title" [value]="columnTitle()" placeholder="Column title" (input)="setColumnTitle($event)" (keydown)="fieldKey($event)" />
          } @else {
            <span class="nb-col-title">{{ columnTitle() || 'Untitled column' }}</span>
          }
          <span class="nb-muted">{{ children().length }}</span>
        </div>
        <div class="nb-col-body" [attr.data-column]="c.id">
          @for (k of children(); track k) {
            @if (childCard(k); as cc) { <nb-card-view [card]="cc" /> }
          } @empty {
            <div class="nb-col-empty">Drop cards here</div>
          }
        </div>
      }
      @case ('Heading') {
        @defer (on immediate) { <nb-heading-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Color') {
        @defer (on immediate) { <nb-color-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Document') {
        @defer (on immediate) { <nb-document-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Sketch') {
        @defer (on immediate) { <nb-sketch-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Audio') {
        @defer (on immediate) { <nb-audio-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Video') {
        @defer (on immediate) { <nb-video-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Map') {
        @defer (on immediate) { <nb-map-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Comment') {
        @defer (on immediate) { <nb-comment-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
      @case ('Table') {
        @defer (on immediate) { <nb-table-card [card]="c" [editing]="editing()" /> } @placeholder { <div class="nb-card-loading"></div> }
      }
    }
    @if (c.locked) { <span class="nb-lock" title="Locked">🔒</span> }
  `,
})
export class CardView {
  readonly ws = inject(Workspace);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly appRef = inject(ApplicationRef);
  // The parent passes card; inside, card() is the refreshed version below.
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly cardIn = input.required<Card>({ alias: 'card' });
  /** The card, refreshed whenever the board data changes (cards are edited in place). */
  readonly card = computed(
    () => {
      this.ws.rev();
      return this.cardIn();
    },
    { equal: () => false },
  );

  readonly kind = computed(() => Object.keys(this.card().content)[0]);
  readonly editing = computed(() => this.ws.editing() === this.card().id);
  readonly selected = computed(() => this.ws.selected().has(this.card().id));
  readonly hostClass = computed(() => {
    const k = this.kind();
    return `nb-card nb-${k.toLowerCase()}${this.selected() ? ' selected' : ''}${this.editing() ? ' editing' : ''}${this.ws.dropColumn() === this.card().id ? ' drop-target' : ''}`;
  });
  readonly fill = computed(() => {
    const k = this.kind();
    if (k === 'Board' || k === 'Column' || k === 'Heading') return null;
    if (k === 'Sketch' && !(this.card().content as { Sketch: { background: boolean } }).Sketch.background) return null;
    if (k === 'Image' || k === 'Video' || k === 'Map' || k === 'Color') return 'var(--nb-card)';
    const c = CARD_COLORS[this.card().color % CARD_COLORS.length];
    return this.ws.dark() ? c[2] : c[1];
  });
  readonly align = computed(() => ['left', 'center', 'right'][this.card().align] ?? 'left');


  readonly noteText = computed(() => ('Note' in this.card().content ? (this.card().content as { Note: { text: string } }).Note.text : ''));
  readonly noteHtml = computed(() => renderNote(this.noteText()));
  readonly todoTitle = computed(() => ('Todo' in this.card().content ? (this.card().content as { Todo: { title: string } }).Todo.title : ''));
  readonly items = computed<TodoItem[]>(() => ('Todo' in this.card().content ? (this.card().content as { Todo: { items: TodoItem[] } }).Todo.items : []));
  readonly doneCount = computed(() => this.items().filter((i) => i.done).length);
  readonly linkUrl = computed(() => ('Link' in this.card().content ? (this.card().content as { Link: { url: string } }).Link.url : ''));
  readonly linkTitle = computed(() => ('Link' in this.card().content ? (this.card().content as { Link: { title: string } }).Link.title : ''));
  readonly domain = computed(() => domainOf(this.linkUrl()));
  readonly letter = computed(() => (this.domain()[0] ?? '↗').toUpperCase());
  readonly safeUrl = computed(() => {
    const u = this.linkUrl().trim();
    if (!u) return null;
    const full = /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
    return /^https?:\/\//i.test(full) ? full : null;
  });
  readonly tileColor = computed(() => {
    let h = 2166136261;
    for (const ch of this.domain()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return BOARD_COLORS[7 + ((h >>> 0) % 6)][1];
  });
  readonly caption = computed(() => ('Image' in this.card().content ? (this.card().content as { Image: { caption: string } }).Image.caption : ''));
  readonly aspect = computed(() => ('Image' in this.card().content ? (this.card().content as { Image: { aspect: number } }).Image.aspect : 1));
  readonly imageUrl = computed(() => ('Image' in this.card().content ? this.ws.images().get((this.card().content as { Image: { file: string } }).Image.file) ?? null : null));
  readonly columnTitle = computed(() => ('Column' in this.card().content ? (this.card().content as { Column: { title: string } }).Column.title : ''));
  readonly children = computed<CardId[]>(() => ('Column' in this.card().content ? (this.card().content as { Column: { children: CardId[] } }).Column.children : []));
  readonly boardFill = computed(() => {
    const b = this.ws.boardOf(this.card());
    return BOARD_COLORS[(b?.color ?? 0) % BOARD_COLORS.length][1];
  });
  readonly boardDark = computed(() => boardIsDark(this.ws.boardOf(this.card())?.color ?? 0));
  readonly countLabel = computed(() => {
    this.ws.rev();
    const n = this.ws.cardCount(this.card());
    return n === 1 ? '1 card' : `${n} cards`;
  });

  constructor() {
    // Put the keyboard in the right field when editing starts, and grow text areas with their text.
    afterRenderEffect(() => {
      const editing = this.editing();
      const focus = this.ws.focusItem();
      this.ws.rev();
      const el = this.host.nativeElement;
      el.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((t) => {
        t.style.height = 'auto';
        t.style.height = `${t.scrollHeight}px`;
      });
      if (!editing) return;
      const active = document.activeElement;
      if (focus && focus.card === this.card().id) {
        const f = el.querySelector<HTMLInputElement>(`[data-item="${focus.index}"]`);
        if (f && active !== f) {
          f.focus();
          this.ws.focusItem.set(null);
        }
        return;
      }
      if (active && el.contains(active)) return;
      const first = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(':scope > textarea, :scope input, :scope > .nb-todo-head input');
      if (first) {
        first.focus();
        if (this.kind() === 'Board') (first as HTMLInputElement).select();
      }
    });
  }

  childCard(id: CardId): Card | undefined {
    return findCard(this.ws.board(), id);
  }

  private edit(f: (c: Card) => void): void {
    this.ws.updateCard(this.card().id, f);
  }

  setNote(e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value;
    this.edit((c) => 'Note' in c.content && (c.content.Note.text = v));
  }
  setTodoTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((c) => 'Todo' in c.content && (c.content.Todo.title = v));
  }
  setItem(i: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((c) => 'Todo' in c.content && (c.content.Todo.items[i].text = v));
  }
  toggle(i: number): void {
    this.ws.updateCard(this.card().id, (c) => 'Todo' in c.content && (c.content.Todo.items[i].done = !c.content.Todo.items[i].done), true);
  }
  addItem(): void {
    const n = this.items().length;
    this.edit((c) => 'Todo' in c.content && c.content.Todo.items.push({ text: '', done: false }));
    this.ws.focusItem.set({ card: this.card().id, index: n });
  }
  removeItem(i: number): void {
    this.ws.updateCard(this.card().id, (c) => 'Todo' in c.content && c.content.Todo.items.splice(i, 1), true);
  }
  itemKey(i: number, e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this.edit((c) => 'Todo' in c.content && c.content.Todo.items.splice(i + 1, 0, { text: '', done: false }));
      // Draw the new task now and move the cursor straight into it, so fast typing isn't lost.
      this.appRef.tick();
      const next = this.host.nativeElement.querySelector<HTMLInputElement>(`[data-item="${i + 1}"]`);
      if (next) next.focus();
      else this.ws.focusItem.set({ card: this.card().id, index: i + 1 });
    } else if (e.key === 'Escape') {
      this.ws.stopEditing();
    }
  }
  setLink(field: 'url' | 'title', e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((c) => 'Link' in c.content && (c.content.Link[field] = v));
  }
  setCaption(e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value;
    this.edit((c) => 'Image' in c.content && (c.content.Image.caption = v));
  }
  setColumnTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((c) => 'Column' in c.content && (c.content.Column.title = v));
  }
  rename(e: Event): void {
    this.ws.renameBoard(this.card().id, (e.target as HTMLInputElement).value);
  }
  /** Keys typed in a field stay in it, except Esc (finish) and the app-wide shortcuts. */
  fieldKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.ws.stopEditing();
      (e.target as HTMLElement).blur();
      return;
    }
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && (e.code === 'KeyF' || (e.shiftKey && ['KeyD', 'Comma', 'Period'].includes(e.code)))) return;
    e.stopPropagation();
  }

  nameKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this.ws.stopEditing();
      (e.target as HTMLElement).blur();
      e.stopPropagation();
      return;
    }
    this.fieldKey(e);
  }
}
