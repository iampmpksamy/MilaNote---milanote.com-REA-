/** Color card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-color-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-color-swatch" [style.background]="data().hex"></div><div class="nb-color-meta"><b>{{ data().name || 'Colour' }}</b><span class="nb-muted">{{ data().hex }}</span></div>`,
})
export class ColorCard extends CardPart<'Color'> {
  protected readonly kindName = 'Color' as const;
}
