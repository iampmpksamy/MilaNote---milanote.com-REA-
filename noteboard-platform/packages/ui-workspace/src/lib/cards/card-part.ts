/**
 * Base for the card kinds added in 3.0.0-alpha.6. Each kind lives in its own file in this folder
 * (`<kind>.card.ts`, selector `nb-<kind>-card`) and is shown by CardView for cards of that kind.
 *
 * - `card()` is the card (refreshed on every data change), `editing()` whether it is being edited
 *   (double-click / tap again; Esc or a click elsewhere ends it).
 * - Change the card with `this.edit(c => …)` while typing (one undo step for the whole edit) or
 *   `this.edit(c => …, true)` for single actions (own undo step). Saving and syncing are automatic.
 * - Files (audio, video) go through `this.ws.addMedia(file)` → name, and `this.ws.mediaUrl(name)`.
 * - Keys typed into fields must call `this.fieldKey($event)` so board shortcuts don't fire.
 */
import { Directive, ElementRef, afterNextRender, computed, inject, input } from '@angular/core';
import type { Card, Content } from '@noteboard/board-model';
import { Workspace } from '../workspace.service';

@Directive()
export abstract class CardPart<K extends keyof UnionToMap<Content>> {
  readonly ws = inject(Workspace);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Kinds load on demand: when one appears already in editing (just created, or double-clicked
    // before its code arrived), put the cursor in its first field as the built-in kinds do.
    afterNextRender(() => {
      const el = this.hostEl.nativeElement;
      if (!this.editing() || el.contains(document.activeElement)) return;
      el.querySelector<HTMLElement>('textarea, input:not([type=file]):not([type=range]):not([type=color]), [contenteditable=true]')?.focus();
    });
  }
  readonly card = input.required<Card>();
  readonly editing = input(false);
  /** The kind this part shows. */
  protected abstract readonly kindName: K;
  /** The kind's own data, e.g. `{ text, size }` for a heading. */
  // Cards are edited in place (the same object comes back), so this also follows the board's revision.
  readonly data = computed(
    () => {
      this.ws.rev();
      return (this.card().content as unknown as Record<string, UnionToMap<Content>[K]>)[this.kindName as string];
    },
    { equal: () => false },
  );

  protected edit(f: (d: UnionToMap<Content>[K], c: Card) => void, checkpoint = false): void {
    const kind = this.kindName as string;
    this.ws.updateCard(
      this.card().id,
      (c) => {
        const d = (c.content as unknown as Record<string, UnionToMap<Content>[K]>)[kind];
        if (d) f(d, c);
      },
      checkpoint,
    );
  }

  /** Keys typed in a field stay in it, except Esc (finish editing) and the app-wide shortcuts. */
  fieldKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.ws.stopEditing();
      (e.target as HTMLElement).blur();
      return;
    }
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && (e.code === 'KeyF' || (e.shiftKey && ['KeyD', 'Comma', 'Period'].includes(e.code)))) return;
    e.stopPropagation();
  }
}

/** { Note: {text} } | { Todo: … } → { Note: {text}; Todo: … } */
export type UnionToMap<U> = { [K in U extends unknown ? keyof U : never]: U extends Record<K, infer V> ? V : never };
