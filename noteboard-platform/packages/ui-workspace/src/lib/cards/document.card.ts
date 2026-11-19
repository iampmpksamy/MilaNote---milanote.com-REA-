/** Document card (stub from the scaffolding; the full version replaces this file). */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardPart } from './card-part';

@Component({
  selector: 'nb-document-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="nb-doc-title">{{ data().title || 'Untitled document' }}</div><div class="nb-muted">{{ data().text.slice(0, 120) }}</div>`,
})
export class DocumentCard extends CardPart<'Document'> {
  protected readonly kindName = 'Document' as const;
}
