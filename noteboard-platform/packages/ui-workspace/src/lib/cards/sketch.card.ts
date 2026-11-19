/**
 * Sketch card: pen strokes drawn on white paper, or straight on the board when `background` is off
 * (what the board's Draw mode makes). Editing opens the drawing editor (`SketchEditor`), which the
 * workspace shows above everything, so it can fill the screen on phones.
 */
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed } from '@angular/core';
import { CardPart } from './card-part';
import { inkPath } from './sketch/sketch-geom';

export { SketchEditor } from './sketch/sketch-editor';

@Component({
  selector: 'nb-sketch-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.nb-sketch-clear]': '!sketch().background', '[class.nb-sketch-blank]': '!sketch().strokes.length' },
  template: `
    <svg class="nb-sketch-svg" [class.nb-sketch-paper]="sketch().background" [attr.viewBox]="viewBox()" [style.aspect-ratio]="ratio()" aria-hidden="true">
      @for (p of paths(); track $index) {
        <path [attr.d]="p.d" [attr.stroke]="p.color" [attr.stroke-width]="p.width" [attr.stroke-opacity]="p.opacity" />
      }
    </svg>
    @if (!sketch().strokes.length) { <div class="nb-sketch-hint">{{ editing() ? 'Sketching…' : 'Double-click to sketch' }}</div> }
  `,
  styles: `
    nb-sketch-card { display: block; position: relative; }
    .nb-sketch-svg { display: block; width: 100%; height: auto; fill: none; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
    .nb-sketch-paper { background: #fff; border-radius: 3px; overflow: hidden; }
    .nb-shell.dark .nb-sketch-paper { background: #f1f1ee; }
    .nb-sketch-hint { position: absolute; inset: 0; display: grid; place-items: center; color: var(--nb-muted); font-size: 13.5px; pointer-events: none; }
    .nb-sketch-paper + .nb-sketch-hint { color: #8a8d93; }
    nb-card-view:has(> nb-sketch-card.nb-sketch-clear) { background: transparent !important; box-shadow: none; }
    nb-card-view:has(> nb-sketch-card.nb-sketch-clear.nb-sketch-blank):not(.selected) { outline: 1px dashed var(--nb-faint); }
  `,
})
export class SketchCard extends CardPart<'Sketch'> {
  protected readonly kindName = 'Sketch' as const;
  /** The sketch, read again on every board change (cards are changed in place, so the input stays the same object). */
  readonly sketch = computed(
    () => {
      this.ws.rev();
      const d = this.data();
      return { strokes: d.strokes, aspect: d.aspect, background: d.background };
    },
    { equal: (a, b) => a.strokes === b.strokes && a.aspect === b.aspect && a.background === b.background },
  );
  readonly height = computed(() => 1000 * (this.sketch().aspect > 0 ? this.sketch().aspect : 0.75));
  readonly viewBox = computed(() => `0 0 1000 ${this.height()}`);
  readonly ratio = computed(() => `1000 / ${this.height()}`);
  readonly paths = computed(() => {
    const d = this.sketch();
    const dark = this.ws.dark();
    return d.strokes.map((s) => inkPath(s, dark, d.background));
  });
}
