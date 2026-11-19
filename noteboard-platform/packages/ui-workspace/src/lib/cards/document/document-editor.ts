/**
 * The full-screen editor of a Document card: a large title, a formatting toolbar that adds the
 * notes' light markdown around the selection, a growing text area, a Write / Preview switch and a
 * live word count. It is shown while the card is being edited (CardView decides that).
 *
 * The board is drawn inside a transformed layer, where `position: fixed` would not cover the
 * screen, so the editor moves its own element up into the workspace shell (where the theme tokens
 * are) when it opens. Angular still removes it when editing ends. While it is open no key or
 * pointer event reaches the board.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { CardPart } from '../card-part';
import { BlockKind, TextChange, applyChange, insertLink, renderDocument, toggleBlock, toggleWrap, wordCount, wordLabel } from './format';

export type DocFormat = BlockKind | 'bold' | 'italic' | 'strike' | 'link';

interface Tool {
  kind: DocFormat;
  label: string;
  title: string;
  /** Text shown on the button, or an SVG path (24×24) when `path` is set. */
  text?: string;
  path?: string;
  style?: string;
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** The toolbar, in groups. */
export const DOC_TOOLS: Tool[][] = [
  [
    { kind: 'h1', label: 'Heading 1', title: 'Large heading', text: 'H1' },
    { kind: 'h2', label: 'Heading 2', title: 'Small heading', text: 'H2' },
  ],
  [
    { kind: 'bold', label: 'Bold', title: `Bold (${MOD}B)`, text: 'B', style: 'b' },
    { kind: 'italic', label: 'Italic', title: `Italic (${MOD}I)`, text: 'I', style: 'i' },
    { kind: 'strike', label: 'Strikethrough', title: 'Strikethrough', text: 'S', style: 's' },
  ],
  [
    { kind: 'bullet', label: 'Bullet list', title: 'Bullet list', path: 'M10 7h9M10 12h9M10 17h9M5.5 7h.01M5.5 12h.01M5.5 17h.01' },
    { kind: 'number', label: 'Numbered list', title: 'Numbered list', path: 'M10 7h9M10 12h9M10 17h9M4.5 5.5l1-.5v4M4.3 11.2c.4-.6 1.9-.6 1.9.4 0 .8-1.9 1.6-1.9 2.4h2M4.3 15.4h1.8l-1 1.3c.8 0 1.2.4 1.2 1s-.6 1-1.2 1-.9-.2-1-.5' },
    { kind: 'quote', label: 'Quote', title: 'Quote', path: 'M6 7v10M10 9h9M10 13h9M10 17h6' },
    { kind: 'link', label: 'Link', title: `Link (${MOD}K)`, path: 'M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1' },
  ],
];

const KEYS: Record<string, DocFormat> = { KeyB: 'bold', KeyI: 'italic', KeyK: 'link' };
/** Shortcuts that work everywhere in the app (theme, interface size). */
const appWide = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.shiftKey && ['KeyD', 'Comma', 'Period'].includes(e.code);
const stop = '$event.stopPropagation()';

@Component({
  selector: 'nb-document-editor',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nb-doced',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Document',
    tabindex: '-1',
    '[class.previewing]': 'preview()',
    '(keydown)': 'key($event)',
    '(keyup)': 'keyUp($event)',
    '(pointerdown)': stop,
    '(pointermove)': stop,
    '(pointerup)': stop,
    '(pointercancel)': stop,
    '(wheel)': stop,
    '(dblclick)': stop,
    '(contextmenu)': stop,
    '(copy)': stop,
    '(cut)': stop,
    '(paste)': stop,
  },
  template: `
    <header class="nb-doced-bar">
      <button class="nb-doced-done" title="Back to the board (Esc)" (click)="close()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>Done
      </button>
      <div class="nb-doced-tools" role="toolbar" aria-label="Formatting">
        @for (g of tools; track $index; let last = $last) {
          @for (t of g; track t.kind) {
            <button class="nb-doced-btn" [attr.data-fmt]="t.kind" [title]="t.title" [attr.aria-label]="t.label" [disabled]="preview()"
              (pointerdown)="$event.preventDefault()" (mousedown)="$event.preventDefault()" (click)="format(t.kind)">
              @if (t.path) {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="t.path" /></svg>
              } @else {
                <span [class]="'nb-doced-' + (t.style ?? 'h')">{{ t.text }}</span>
              }
            </button>
          }
          @if (!last) { <span class="nb-doced-sep"></span> }
        }
      </div>
      <span class="nb-doced-count" aria-live="polite">{{ words() }}</span>
      <div class="nb-doced-mode" role="group" aria-label="View">
        <button data-mode="write" [attr.aria-pressed]="!preview()" (click)="setPreview(false)">Write</button>
        <button data-mode="preview" [attr.aria-pressed]="preview()" (click)="setPreview(true)">Preview</button>
      </div>
    </header>
    <div #scroller class="nb-doced-scroll">
      <div class="nb-doced-page">
        <input #titleInput class="nb-doced-title" [value]="title()" placeholder="Untitled document" maxlength="500" aria-label="Title"
          [readOnly]="preview()" (input)="setTitle($event)" (keydown)="titleKey($event)" />
        @if (preview()) {
          @if (text().trim()) {
            <div class="nb-doced-preview" [innerHTML]="html()"></div>
          } @else {
            <p class="nb-doced-empty">Nothing written yet.</p>
          }
        } @else {
          <textarea #textArea class="nb-doced-text" [value]="text()" placeholder="Start writing…" maxlength="1000000" aria-label="Text"
            (input)="setText($event)"></textarea>
        }
      </div>
    </div>
  `,
  styles: `
    .nb-doced { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; background: var(--nb-card); color: var(--nb-text);
      user-select: text; -webkit-user-select: text; touch-action: auto; cursor: auto; outline: none; font-size: 15px; animation: nb-fadein 0.14s; }
    .nb-doced svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .nb-doced-bar { flex: none; display: flex; align-items: center; gap: 8px; min-height: 52px; box-sizing: border-box; background: var(--nb-header);
      border-bottom: 1px solid var(--nb-divider); user-select: none; -webkit-user-select: none;
      padding: calc(6px + env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 6px max(12px, env(safe-area-inset-left, 0px)); }
    .nb-doced button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
    .nb-doced .nb-doced-done { display: flex; align-items: center; gap: 2px; height: 34px; padding: 0 12px 0 4px; border-radius: 4px; font-weight: 600; }
    .nb-doced .nb-doced-done:hover, .nb-doced .nb-doced-btn:hover:not(:disabled), .nb-doced .nb-doced-mode button:hover { background: var(--nb-hover); }
    .nb-doced-tools { flex: 1; display: flex; align-items: center; justify-content: center; gap: 2px; min-width: 0; }
    .nb-doced .nb-doced-btn { flex: none; min-width: 34px; height: 34px; padding: 0 6px; border-radius: 4px; display: grid; place-items: center; color: var(--nb-icon); font-size: 14px; }
    .nb-doced .nb-doced-btn:disabled { color: var(--nb-faint); cursor: default; }
    .nb-doced-h { font-weight: 700; font-size: 13px; }
    .nb-doced-b { font-weight: 800; }
    .nb-doced-i { font-style: italic; font-family: Georgia, 'Times New Roman', serif; font-size: 16px; }
    .nb-doced-s { text-decoration: line-through; }
    .nb-doced-sep { flex: none; width: 1px; height: 20px; margin: 0 5px; background: var(--nb-divider); }
    .nb-doced-count { color: var(--nb-muted); font-size: 13px; white-space: nowrap; }
    .nb-doced-mode { flex: none; display: flex; padding: 2px; border: 1px solid var(--nb-border); border-radius: 6px; }
    .nb-doced .nb-doced-mode button { height: 28px; padding: 0 12px; border-radius: 4px; font-size: 13px; color: var(--nb-muted); }
    .nb-doced .nb-doced-mode button[aria-pressed='true'] { background: var(--nb-hover); color: var(--nb-text); font-weight: 600; }
    .nb-doced-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box;
      padding: 44px max(24px, env(safe-area-inset-right, 0px)) calc(96px + env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px)); }
    .nb-doced-page { max-width: 720px; margin: 0 auto; }
    .nb-doced-title, .nb-doced-text { display: block; width: 100%; box-sizing: border-box; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
    .nb-doced-title { margin-bottom: 20px; font-size: 30px; font-weight: 600; line-height: 1.25; }
    .nb-doced-title::placeholder, .nb-doced-text::placeholder { color: var(--nb-faint); }
    .nb-doced-text { min-height: 55vh; resize: none; overflow: hidden; field-sizing: content; font-size: 16px; line-height: 1.7; }
    .nb-doced-preview, .nb-doced-empty { font-size: 16px; line-height: 1.7; overflow-wrap: anywhere; }
    .nb-doced-empty { margin: 0; color: var(--nb-muted); }
    .nb-doced-preview h1, .nb-doced-preview h2, .nb-doced-preview h3 { margin: 0.9em 0 0.25em; font-weight: 600; line-height: 1.3; }
    .nb-doced-preview h1 { font-size: 26px; }
    .nb-doced-preview h2 { font-size: 21px; }
    .nb-doced-preview h3 { font-size: 18px; }
    .nb-doced-preview > :first-child { margin-top: 0; }
    .bold-headings .nb-doced-preview h1, .bold-headings .nb-doced-preview h2 { font-weight: 700; }
    .nb-doced-preview p { margin: 0; }
    .nb-doced-preview p.gap { height: 0.8em; }
    .nb-doced-preview ul, .nb-doced-preview ol { margin: 0.15em 0; padding-left: 1.5em; list-style: disc; }
    .nb-doced-preview ol { list-style: decimal; }
    .nb-doced-preview li::marker { color: var(--nb-muted); }
    .nb-doced-preview blockquote { margin: 0.3em 0; padding-left: 14px; border-left: 3px solid var(--nb-border); color: var(--nb-muted); font-style: italic; }
    .nb-doced-preview code { font: 0.9em Consolas, monospace; background: rgba(128, 128, 128, 0.15); border-radius: 3px; padding: 0 3px; }
    .nb-doced-preview a { color: var(--nb-select); }
    @media (max-width: 640px) {
      .nb-doced-bar { flex-wrap: wrap; row-gap: 2px; padding-bottom: 2px; }
      .nb-doced-count { margin-left: auto; }
      .nb-doced-tools { order: 5; flex: 1 0 100%; justify-content: flex-start; overflow-x: auto; scrollbar-width: none; touch-action: pan-x; }
      .nb-doced-tools { gap: 0; }
      .nb-doced .nb-doced-btn { min-width: 38px; height: 40px; padding: 0 4px; }
      .nb-doced-scroll { padding-top: 22px; padding-left: max(18px, env(safe-area-inset-left, 0px)); padding-right: max(18px, env(safe-area-inset-right, 0px)); }
      .nb-doced-title { font-size: 24px; margin-bottom: 14px; }
    }
  `,
})
export class DocumentEditor extends CardPart<'Document'> {
  protected readonly kindName = 'Document' as const;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly titleEl = viewChild.required<ElementRef<HTMLInputElement>>('titleInput');
  private readonly textEl = viewChild<ElementRef<HTMLTextAreaElement>>('textArea');

  readonly tools = DOC_TOOLS;
  readonly preview = signal(false);
  /** Cards are changed in place, so the board's revision is what says the text changed. */
  private readonly fresh = computed(
    () => {
      this.ws.rev();
      return this.data();
    },
    { equal: () => false },
  );
  readonly title = computed(() => this.fresh().title);
  readonly text = computed(() => this.fresh().text);
  readonly words = computed(() => wordLabel(wordCount(this.text())));
  readonly html = computed(() => renderDocument(this.text()));

  constructor() {
    super();
    const el = this.host.nativeElement;
    // Keys pressed while the focus is outside the editor (e.g. on the page) must not reach the board.
    const guard = (e: KeyboardEvent) => {
      if (el.contains(e.target as Node) || appWide(e)) return;
      e.stopPropagation();
      if (e.type === 'keydown' && e.key === 'Escape') this.close();
      else el.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', guard, true);
    document.addEventListener('keyup', guard, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', guard, true);
      document.removeEventListener('keyup', guard, true);
      el.remove();
    });
    afterNextRender(() => {
      const shell = el.parentElement?.closest('.nb-shell') ?? document.body;
      if (el.parentElement !== shell) shell.appendChild(el);
      const ta = this.textEl()?.nativeElement;
      if (!this.title() && !this.text()) this.titleEl().nativeElement.focus({ preventScroll: true });
      else if (ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(0, 0);
      }
    });
    afterRenderEffect(() => {
      this.text();
      this.preview();
      this.grow();
    });
  }

  close(): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.ws.stopEditing();
  }

  setPreview(on: boolean): void {
    this.preview.set(on);
    if (!on) setTimeout(() => this.textEl()?.nativeElement.focus({ preventScroll: true }));
    else this.host.nativeElement.focus({ preventScroll: true });
  }

  setTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((d) => (d.title = v));
  }

  setText(e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value;
    this.edit((d) => (d.text = v));
    this.grow();
  }

  titleKey(e: KeyboardEvent): void {
    const ta = this.textEl()?.nativeElement;
    if (ta && (e.key === 'Enter' || e.key === 'ArrowDown') && !e.isComposing) {
      e.preventDefault();
      ta.focus();
      ta.setSelectionRange(0, 0);
    }
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (appWide(e)) return;
    e.stopPropagation();
    const f = KEYS[e.code];
    if (f && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.target === this.textEl()?.nativeElement) {
      e.preventDefault();
      this.format(f);
    }
  }

  keyUp(e: KeyboardEvent): void {
    if (!appWide(e)) e.stopPropagation();
  }

  /** Applies a toolbar action to the text area's selection. */
  format(kind: DocFormat): void {
    const ta = this.textEl()?.nativeElement;
    if (!ta || this.preview()) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const mark = ({ bold: '**', italic: '*', strike: '~~' } as Partial<Record<DocFormat, string>>)[kind];
    const c: TextChange | null = kind === 'link' ? insertLink(value, s, e) : mark ? toggleWrap(value, s, e, mark) : toggleBlock(value, s, e, kind as BlockKind);
    ta.focus({ preventScroll: true });
    if (!c) return;
    const want = applyChange(value, c);
    // Typed in through the browser, so its own undo (Ctrl+Z) can take it back.
    ta.setSelectionRange(c.from, c.to);
    let ok = false;
    try {
      ok = document.execCommand(c.insert ? 'insertText' : 'delete', false, c.insert);
    } catch {
      ok = false;
    }
    if (!ok || ta.value !== want) {
      ta.value = want;
      this.edit((d) => (d.text = want));
    }
    ta.setSelectionRange(c.selStart, c.selEnd);
    this.grow();
  }

  /** Grows the text area with its text where the browser can't (no `field-sizing`). */
  private grow(): void {
    const ta = this.textEl()?.nativeElement;
    if (!ta || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    const sc = this.scroller().nativeElement;
    const top = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    sc.scrollTop = top;
  }
}
