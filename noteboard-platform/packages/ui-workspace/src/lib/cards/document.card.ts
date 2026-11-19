/**
 * Document card: long-form writing. On the board it looks like a small page (glyph, title, the
 * first lines as plain text and the word count); editing opens the full-screen editor
 * (document/document-editor.ts). The text uses the notes' light markdown.
 */
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed } from '@angular/core';
import { CardPart } from './card-part';
import { DocumentEditor } from './document/document-editor';
import { excerpt, wordCount, wordLabel } from './document/format';

@Component({
  selector: 'nb-document-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DocumentEditor],
  template: `
    <div class="nb-docface">
      <div class="nb-docface-head">
        <svg class="nb-docface-glyph" viewBox="0 0 22 26" aria-hidden="true">
          <path class="sheet" d="M3.5 1.5h10l5.5 5.5v16.5a1 1 0 01-1 1h-14.5a1 1 0 01-1-1v-21a1 1 0 011-1z" />
          <path class="fold" d="M13.5 1.5v5.5h5.5" />
          <path class="lines" d="M6.5 12h9M6.5 15.5h9M6.5 19h6" />
        </svg>
        <div class="nb-docface-title" [class.untitled]="!title()">{{ title() || 'Untitled document' }}</div>
      </div>
      @if (excerpt(); as ex) {
        <div class="nb-docface-text">{{ ex }}</div>
      } @else {
        <div class="nb-docface-text empty">No text yet</div>
      }
      <div class="nb-docface-meta">{{ words() }}</div>
    </div>
    @if (editing()) {
      <nb-document-editor [card]="card()" />
    }
  `,
  styles: `
    .nb-docface { padding: 14px 16px 12px; }
    .nb-docface-head { display: flex; align-items: flex-start; gap: 10px; }
    .nb-docface-glyph { flex: none; width: 20px; height: 24px; margin-top: 1px; fill: none; stroke-linejoin: round; stroke-linecap: round; }
    .nb-docface-glyph .sheet { fill: var(--nb-card); stroke: var(--nb-icon); stroke-width: 1.4; }
    .nb-docface-glyph .fold { stroke: var(--nb-icon); stroke-width: 1.4; }
    .nb-docface-glyph .lines { stroke: var(--nb-muted); stroke-width: 1.3; }
    .nb-docface-title { flex: 1; min-width: 0; font-weight: 600; font-size: 15px; line-height: 1.35; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .nb-docface-title.untitled { color: var(--nb-muted); }
    .nb-docface-text { margin-top: 8px; font-size: 13.5px; line-height: 1.5; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
    .nb-docface-text.empty { color: var(--nb-muted); font-style: italic; }
    .nb-docface-meta { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--nb-border); color: var(--nb-muted); font-size: 12px; }
  `,
})
export class DocumentCard extends CardPart<'Document'> {
  protected readonly kindName = 'Document' as const;
  /** Cards are changed in place, so the board's revision is what says the text changed. */
  private readonly fresh = computed(
    () => {
      this.ws.rev();
      return this.data();
    },
    { equal: () => false },
  );
  private readonly text = computed(() => this.fresh().text);
  readonly title = computed(() => this.fresh().title.trim());
  readonly excerpt = computed(() => excerpt(this.text()));
  readonly words = computed(() => wordLabel(wordCount(this.text())));
}
