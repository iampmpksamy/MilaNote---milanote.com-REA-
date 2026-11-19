/** Heading card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-heading-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-heading-text" [attr.data-size]="data().size">{{ data().text || 'Heading' }}</div>`,
})
export class HeadingCard extends CardPart<'Heading'> {
  protected readonly kindName = 'Heading' as const;
}
