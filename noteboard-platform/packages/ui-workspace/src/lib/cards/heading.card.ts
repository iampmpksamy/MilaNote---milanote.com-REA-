/**
 * Heading card: big bold text with no card behind it, for titles on the board.
 * Data: `{ text, size }` with size 1 (large) … 3 (small). Follows the card's text alignment.
 *
 * While editing: an auto-growing text area (Enter finishes, Shift+Enter starts a new line, Esc
 * finishes) and a small floating bar above the card to pick the size and the alignment. The bar
 * keeps the keyboard in the text area and never starts a card drag.
 */
import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { CardPart } from './card-part';

export type HeadingSize = 1 | 2 | 3;
/** Font size in px for each heading size. */
export const HEADING_PX: Record<HeadingSize, number> = { 1: 34, 2: 26, 3: 20 };
const SIZE_NAMES: Record<HeadingSize, string> = { 1: 'Large heading', 2: 'Medium heading', 3: 'Small heading' };
const ALIGNS = ['left', 'center', 'right'] as const;
const ALIGN_NAMES = ['Left', 'Centre', 'Right'];
export const HEADING_MAX = 2000;

/** A size from stored data, falling back to large for anything unexpected. */
export function headingSize(v: unknown): HeadingSize {
  return v === 2 || v === 3 ? v : 1;
}

@Component({
  selector: 'nb-heading-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nb-heading-body',
    '[attr.data-size]': 'size()',
    '[style.font-size.px]': 'px()',
    '[style.text-align]': 'align()',
  },
  template: `
    @if (editing()) {
      <div class="nb-heading-tools" [class.end]="align() === 'right'" role="toolbar" aria-label="Heading"
        (pointerdown)="hold($event)" (mousedown)="$event.preventDefault()" (dblclick)="$event.stopPropagation()">
        @for (s of sizes; track s) {
          <button type="button" class="nb-heading-size" [class.on]="size() === s" [attr.data-size]="s" [attr.aria-pressed]="size() === s"
            [title]="sizeNames[s]" (click)="setSize(s)">H{{ s }}</button>
        }
        <span class="nb-heading-sep"></span>
        <button type="button" class="nb-heading-align" [attr.data-align]="align()" [title]="'Alignment: ' + alignName()" (click)="cycleAlign()">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            @for (l of alignLines(); track $index) { <rect [attr.x]="l.x" [attr.y]="l.y" [attr.width]="l.w" height="1.6" rx="0.8" /> }
          </svg>
        </button>
      </div>
      <textarea #ta class="nb-heading-edit" rows="1" placeholder="Heading" spellcheck="true" [attr.maxlength]="max" [value]="text()"
        (input)="setText($event)" (keydown)="key($event)"></textarea>
    } @else {
      <div class="nb-heading-text" [class.empty]="!text().trim()">{{ text().trim() ? text() : 'Heading' }}</div>
    }
  `,
  styleUrl: './heading.card.css',
})
export class HeadingCard extends CardPart<'Heading'> {
  protected readonly kindName = 'Heading' as const;
  readonly sizes: HeadingSize[] = [1, 2, 3];
  readonly sizeNames = SIZE_NAMES;
  readonly max = HEADING_MAX;
  private readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private started = false;

  /** The heading as it is now (cards are edited in place, so this re-reads on every change). */
  private readonly now = computed(() => {
    this.ws.rev();
    const h = (this.card().content as { Heading?: { text?: unknown; size?: unknown } }).Heading;
    return { text: typeof h?.text === 'string' ? h.text : '', size: headingSize(h?.size) };
  });
  readonly text = computed(() => this.now().text);
  readonly size = computed(() => this.now().size);
  readonly px = computed(() => HEADING_PX[this.size()]);
  readonly align = computed(() => {
    this.ws.rev();
    return ALIGNS[this.card().align] ?? 'left';
  });
  readonly alignName = computed(() => ALIGN_NAMES[ALIGNS.indexOf(this.align())]);
  /** Three lines for the alignment icon, lined up like the text. */
  readonly alignLines = computed(() =>
    [14, 9, 12].map((w, i) => {
      const a = this.align();
      return { x: a === 'left' ? 1 : a === 'right' ? 15 - w : (16 - w) / 2, y: 3.2 + i * 4, w };
    }),
  );

  constructor() {
    super();
    afterRenderEffect(() => {
      this.now();
      const t = this.ta()?.nativeElement;
      if (!t) {
        this.started = false;
        return;
      }
      grow(t);
      // Put the keyboard in the heading once when editing starts, with the cursor at the end.
      if (!this.started) {
        this.started = true;
        guardFocus(this.host.nativeElement, () => this.ws.editing() === this.card().id);
        if (document.activeElement !== t) {
          t.focus({ preventScroll: true });
          t.setSelectionRange(t.value.length, t.value.length);
        }
      }
    });
  }

  setText(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    const v = t.value.slice(0, HEADING_MAX);
    grow(t);
    this.edit((d) => (d.text = v));
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      this.ws.stopEditing();
      (e.target as HTMLElement).blur();
      return;
    }
    this.fieldKey(e);
  }

  setSize(s: HeadingSize): void {
    if (s !== this.size()) this.edit((d) => (d.size = s), true);
    this.refocus();
  }

  cycleAlign(): void {
    this.ws.cycleAlign(this.card().id);
    this.refocus();
  }

  /** Buttons on the bar: no drag, no long-press menu, and the text area keeps the keyboard. */
  hold(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private refocus(): void {
    const t = this.ta()?.nativeElement;
    if (t && document.activeElement !== t) t.focus({ preventScroll: true });
  }
}

/**
 * Right after editing starts from a tap, the browser's follow-up mouse events can land on a part of
 * the board that takes no focus and so blur the field just focused (the keyboard flashes away).
 * For a short while, a field in `host` that loses focus to nothing gets it back while still editing.
 */
export function guardFocus(host: HTMLElement, stillEditing: () => boolean, ms = 700): void {
  const until = Date.now() + ms;
  const lost = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (e.relatedTarget instanceof Element || Date.now() > until) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (stillEditing() && t.isConnected && (!a || a === document.body)) t.focus({ preventScroll: true });
    });
  };
  host.addEventListener('blur', lost, true);
  setTimeout(() => host.removeEventListener('blur', lost, true), ms);
}

function grow(t: HTMLTextAreaElement): void {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}
