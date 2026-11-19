/** Comment card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-comment-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-muted">{{ data().entries.length }} comment(s)</div>`,
})
export class CommentCard extends CardPart<'Comment'> {
  protected readonly kindName = 'Comment' as const;
}
