/** Sketch card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-sketch-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-muted">Sketch ({{ data().strokes.length }} strokes)</div>`,
})
export class SketchCard extends CardPart<'Sketch'> {
  protected readonly kindName = 'Sketch' as const;
}
