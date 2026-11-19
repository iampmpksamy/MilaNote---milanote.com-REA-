/** Audio card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-audio-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-muted">{{ data().title || 'Audio' }}</div>`,
})
export class AudioCard extends CardPart<'Audio'> {
  protected readonly kindName = 'Audio' as const;
}
