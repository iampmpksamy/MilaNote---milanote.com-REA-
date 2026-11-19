/** Video card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-video-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-muted">{{ data().title || data().url || 'Video' }}</div>`,
})
export class VideoCard extends CardPart<'Video'> {
  protected readonly kindName = 'Video' as const;
}
