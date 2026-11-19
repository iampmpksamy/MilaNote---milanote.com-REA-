/** Map card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-map-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-muted">{{ data().label || data().query || 'Map' }}</div>`,
})
export class MapCard extends CardPart<'Map'> {
  protected readonly kindName = 'Map' as const;
}
