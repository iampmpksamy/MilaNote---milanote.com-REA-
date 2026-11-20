/**
 * Colour card: a swatch with a name and its hex code, for palettes and mood boards.
 * Data: `{ hex: '#rrggbb', name }`.
 *
 * View: a big swatch, the name ("Untitled colour" when empty), the hex code and a Copy button.
 * Editing: the system colour picker, a hex field (3 or 6 digits, # optional), a name field and a
 * row of quick colours. The swatches have a thin grey ring so white and black show on any theme.
 */
import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject } from '@angular/core';
import { guardFocus } from './heading.card';
import { CardPart } from './card-part';

/** '#ABC', 'abc', ' #a1B2c3 ' → '#aabbcc' / '#a1b2c3'; anything else → null. */
export function normalizeHex(v: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

/** Quick colours offered while editing. */
export const COLOR_PRESETS: readonly { hex: string; name: string }[] = [
  { hex: '#141414', name: 'Black' },
  { hex: '#ffffff', name: 'White' },
  { hex: '#8f949c', name: 'Grey' },
  { hex: '#e5484d', name: 'Red' },
  { hex: '#f2873b', name: 'Orange' },
  { hex: '#f5c84c', name: 'Yellow' },
  { hex: '#4caf6e', name: 'Green' },
  { hex: '#1fa39a', name: 'Teal' },
  { hex: '#3a8ee6', name: 'Blue' },
  { hex: '#5c6bd6', name: 'Indigo' },
  { hex: '#9b59c9', name: 'Purple' },
  { hex: '#e0679f', name: 'Pink' },
];

export const COLOR_NAME_MAX = 200;

type Clip = { writeText(text: string): unknown };

/** Puts text on the clipboard: the app's native clipboard, the browser's, or the old copy command. */
export async function copyText(text: string): Promise<void> {
  const native = (globalThis as { nbClipboard?: Clip }).nbClipboard;
  if (native?.writeText) {
    await native.writeText(text);
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Plain http on a home network has no clipboard API.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy refused');
}

@Component({
  selector: 'nb-color-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nb-color-body' },
  template: `
    <div class="nb-color-swatch" [style.background-color]="hex()" role="img" [attr.aria-label]="'Colour ' + hex()"></div>
    @if (editing()) {
      <div class="nb-color-form">
        <div class="nb-color-row">
          <input class="nb-color-hex" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="7" aria-label="Hex code"
            [value]="hex()" (input)="typeHex($event)" (change)="commitHex($event)" (keydown)="hexKey($event)" />
          <input class="nb-color-pick" type="color" title="Pick a colour" aria-label="Pick a colour" [value]="hex()" (input)="pick($event)" (keydown)="fieldKey($event)" />
        </div>
        <input class="nb-color-name" type="text" placeholder="Name (optional)" aria-label="Name" [attr.maxlength]="nameMax" [value]="name()"
          (input)="setName($event)" (keydown)="nameKey($event)" />
        <div class="nb-color-presets" (pointerdown)="hold($event)" (mousedown)="$event.preventDefault()" (dblclick)="$event.stopPropagation()">
          @for (p of presets; track p.hex) {
            <button type="button" class="nb-color-preset" [class.on]="p.hex === hex()" [style.background-color]="p.hex" [attr.data-hex]="p.hex"
              [title]="p.name" [attr.aria-label]="p.name" (click)="choose(p.hex)"></button>
          }
        </div>
      </div>
    } @else {
      <div class="nb-color-meta">
        <div class="nb-color-title" [class.empty]="!name().trim()">{{ name().trim() || 'Untitled colour' }}</div>
        <div class="nb-color-line">
          <span class="nb-color-code">{{ hex() }}</span>
          <button type="button" class="nb-color-copy" title="Copy the hex code"
            (pointerdown)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()" (click)="copy(); $event.stopPropagation()">Copy</button>
        </div>
      </div>
    }
  `,
  styleUrl: './color.card.css',
})
export class ColorCard extends CardPart<'Color'> {
  protected readonly kindName = 'Color' as const;
  readonly presets = COLOR_PRESETS;
  readonly nameMax = COLOR_NAME_MAX;

  /** The colour as it is now (cards are edited in place, so this re-reads on every change). */
  private readonly now = computed(() => {
    this.ws.rev();
    const c = (this.card().content as { Color?: { hex?: unknown; name?: unknown } }).Color;
    return {
      hex: (typeof c?.hex === 'string' && normalizeHex(c.hex)) || '#000000',
      name: typeof c?.name === 'string' ? c.name : '',
    };
  });
  readonly hex = computed(() => this.now().hex);
  readonly name = computed(() => this.now().name);

  constructor() {
    super();
    // The hex field gets the keyboard from CardView when editing starts; keep it there after a tap.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let started = false;
    afterRenderEffect(() => {
      if (!this.editing()) {
        started = false;
        return;
      }
      if (started) return;
      started = true;
      guardFocus(host, () => this.ws.editing() === this.card().id);
    });
  }

  /** Stores a colour; `checkpoint` makes it its own undo step. */
  private setHex(hex: string, checkpoint = false): void {
    if (hex !== this.hex()) this.edit((d) => (d.hex = hex), checkpoint);
  }

  /** While typing, a full six-digit code applies straight away; three digits wait for Enter. */
  typeHex(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim();
    const hex = normalizeHex(v);
    if (hex && v.replace('#', '').length === 6) this.setHex(hex);
  }

  /** Enter or leaving the field: apply a valid code, put back the stored one otherwise. */
  commitHex(e: Event): void {
    const field = e.target as HTMLInputElement;
    const hex = normalizeHex(field.value);
    if (hex) this.setHex(hex);
    field.value = hex ?? this.hex();
  }

  hexKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.commitHex(e);
      const name = (e.target as HTMLElement).closest('.nb-color-form')?.querySelector<HTMLInputElement>('.nb-color-name');
      name?.focus({ preventScroll: true });
      return;
    }
    this.fieldKey(e);
  }

  pick(e: Event): void {
    const hex = normalizeHex((e.target as HTMLInputElement).value);
    if (hex) this.setHex(hex);
  }

  choose(hex: string): void {
    this.setHex(hex, true);
  }

  setName(e: Event): void {
    const v = (e.target as HTMLInputElement).value.slice(0, COLOR_NAME_MAX);
    this.edit((d) => (d.name = v));
  }

  nameKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      this.ws.stopEditing();
      (e.target as HTMLElement).blur();
      return;
    }
    this.fieldKey(e);
  }

  /** Quick colours: no drag, no long-press menu, and the field being typed in keeps the keyboard. */
  hold(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  async copy(): Promise<void> {
    const hex = this.hex();
    try {
      await copyText(hex);
      this.ws.showToast(`Copied ${hex}`);
    } catch {
      this.ws.showToast(`Couldn't copy ${hex}`);
    }
  }
}
