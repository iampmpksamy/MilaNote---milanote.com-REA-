import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Original line icons (32×32), the same drawings as the desktop app. They use `currentColor`
 * for strokes, so they follow the theme and the active/disabled states.
 */
@Component({
  selector: 'nb-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nb-icon', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      @switch (name()) {
        @case ('Note') {
          <rect class="card" x="4" y="5" width="24" height="22" rx="2.5" />
          <path class="faint" d="M8.5 10h15M8.5 14h15M8.5 18h15M8.5 22h9" />
        }
        @case ('Link') {
          <rect class="card" x="5" y="5" width="22" height="22" rx="2.5" />
          <path d="M14.5 17.5l3-3M13 15.5l-1.6 1.6a2.4 2.4 0 003.4 3.4l1.6-1.6M19 16.5l1.6-1.6a2.4 2.4 0 00-3.4-3.4L15.6 13" />
        }
        @case ('To-do') {
          <rect class="card" x="4" y="5" width="24" height="22" rx="2.5" />
          <path d="M9 12l1.6 1.6L13.4 10M9 19l1.6 1.6 2.8-3.4" stroke-width="1.4" />
          <path class="faint" d="M16 12h9M16 19h7" />
        }
        @case ('Line') {
          <path d="M5 27L27 5" stroke-width="2" />
        }
        @case ('Board') {
          <rect x="3" y="3" width="26" height="26" rx="6" fill="#5C7FF5" stroke="none" />
          <rect x="10" y="10" width="5.5" height="5.5" rx="1.2" fill="#fff" stroke="none" />
          <rect x="17" y="10" width="5.5" height="5.5" rx="1.2" fill="#fff" fill-opacity=".6" stroke="none" />
          <rect x="10" y="17" width="5.5" height="5.5" rx="1.2" fill="#fff" fill-opacity=".6" stroke="none" />
          <rect x="17" y="17" width="5.5" height="5.5" rx="1.2" fill="#fff" fill-opacity=".6" stroke="none" />
        }
        @case ('Column') {
          <rect class="card" x="5" y="3" width="22" height="26" rx="2.5" />
          <rect x="5" y="3" width="22" height="3" rx="1" fill="currentColor" stroke="none" />
        }
        @case ('Comment') {
          <rect x="4" y="6" width="24" height="18" rx="2.5" fill="var(--nb-comment)" stroke="none" />
          <path d="M8 11h16M8 15h16M8 19h16" stroke="#5C7FF5" stroke-opacity=".8" stroke-width="1.4" />
          <path d="M9 24h5l-5 4z" fill="var(--nb-comment)" stroke="none" />
        }
        @case ('Table') {
          <rect class="card" x="4" y="6" width="24" height="20" rx="2.5" />
          <path class="faint" d="M4 12.5h24M4 19h24M16 6v20" />
        }
        @case ('More') {
          <circle cx="10" cy="16" r="2.1" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="2.1" fill="currentColor" stroke="none" />
          <circle cx="22" cy="16" r="2.1" fill="currentColor" stroke="none" />
        }
        @case ('Sketch') {
          <rect class="card" x="4" y="5" width="24" height="22" rx="2.5" />
          <path d="M9 21c2-5 4-8 6-6s-1 5 1 5 3-6 7-9" />
        }
        @case ('Color') {
          <rect x="5" y="5" width="13" height="13" rx="2" fill="#4fb3a9" stroke="none" />
          <rect x="13" y="12" width="14" height="14" rx="2" fill="#e65c7b" stroke="none" />
        }
        @case ('Document') {
          <path class="card" d="M8 4h11l6 6v18H8z" />
          <path d="M19 4v6h6" />
          <path class="faint" d="M12 16h9M12 20h9M12 24h6" />
        }
        @case ('Audio') {
          <rect x="4" y="5" width="24" height="22" rx="2.5" fill="#3d9970" stroke="none" />
          <path d="M9 16v0M12 13v6M15 10v12M18 13v6M21 11v10M24 15v2" stroke="#fff" stroke-width="1.8" />
        }
        @case ('Map') {
          <path class="card" d="M4 8l7-3 10 3 7-3v19l-7 3-10-3-7 3z" />
          <path d="M11 5v19M21 8v19" class="faint" />
          <circle cx="16" cy="14" r="2.6" fill="#e5533d" stroke="none" />
        }
        @case ('Video') {
          <rect class="card" x="4" y="7" width="24" height="18" rx="2.5" />
          <path d="M14 12.5v7l6-3.5z" fill="currentColor" />
        }
        @case ('Heading') {
          <rect class="card" x="5" y="5" width="22" height="22" rx="2" />
          <path d="M11 10h10M16 10v13" stroke-width="2.2" />
        }
        @case ('Add image') {
          <rect x="5" y="6" width="22" height="20" rx="3" />
          <circle cx="20.5" cy="12.5" r="2.2" fill="currentColor" stroke="none" />
          <path d="M7 23l6-6.5 4.5 4.5 3-2.5 4.5 4.5" />
        }
        @case ('Caption') {
          <rect x="5" y="5" width="22" height="22" rx="2" />
          <rect x="5" y="5" width="22" height="12" rx="2" fill="currentColor" fill-opacity=".35" stroke="none" />
          <path class="faint" d="M9 21h14" />
        }
        @case ('Replace') {
          <rect x="5" y="6" width="22" height="20" rx="3" />
          <path d="M7 23l6-6.5 4.5 4.5 3-2.5 4.5 4.5" />
          <path d="M24.5 24.5a3.5 3.5 0 11-3.5-3.5" />
        }
        @case ('Upload') {
          <path d="M8 5h11l5 5v17H8z" />
          <path d="M19 5v5h5" />
        }
        @case ('Draw') {
          <path d="M8 25l2.5-1 12-12-1.5-1.5-12 12zM19 9.5l3.5 3.5" />
        }
        @case ('Edit') {
          <path d="M8 25l2.5-1 12-12-1.5-1.5-12 12zM19 9.5l3.5 3.5" />
        }
        @case ('Trash') {
          <rect x="6" y="7" width="20" height="3" rx="1" fill="var(--nb-faint)" stroke="none" />
          <path d="M7.5 11.5h17L23 28H9z" fill="var(--nb-faint)" stroke="none" />
        }
        @case ('Delete') {
          <path d="M7 10h18M13 7h6M9 10l1 15h12l1-15M14 14v7M18 14v7" />
        }
        @case ('Back') {
          <path d="M9 16h14M9 16l4-4M9 16l4 4" />
        }
        @case ('Icon') {
          <rect x="5" y="5" width="22" height="22" rx="5" fill="var(--nb-board-default)" stroke="none" />
          <circle cx="16" cy="16" r="5.5" stroke-width="1.4" />
          <circle cx="14" cy="14.5" r=".9" fill="currentColor" stroke="none" />
          <circle cx="18" cy="14.5" r=".9" fill="currentColor" stroke="none" />
          <path d="M13.8 17.6a2.6 2.6 0 004.4 0" stroke-width="1.2" />
        }
        @case ('Rename') {
          <rect x="5" y="6" width="22" height="20" rx="2" />
          <path d="M10 21l4-10 4 10M11.5 17.5h5M22 10v12" stroke-width="1.4" />
        }
        @case ('Open') {
          <rect x="5" y="5" width="22" height="22" rx="5" />
          <path d="M12 20l8-8M20 12h-5M20 12v5" />
        }
        @case ('Duplicate') {
          <rect x="6" y="6" width="14" height="14" rx="2" />
          <rect x="12" y="12" width="14" height="14" rx="2" fill="var(--nb-toolbar)" />
        }
        @case ('Align') {
          <path d="M7 8.5h18M7 13.5h12M7 18.5h18M7 23.5h9" />
        }
        @case ('Start') {
          <rect x="5" y="5" width="22" height="22" rx="2" />
          <path d="M22 16H10" />
          <path d="M8.5 16l5-3.5v7z" fill="currentColor" stroke="none" />
        }
        @case ('End') {
          <rect x="5" y="5" width="22" height="22" rx="2" />
          <path d="M10 16h12" />
          <path d="M23.5 16l-5-3.5v7z" fill="currentColor" stroke="none" />
        }
        @case ('Label') {
          <path d="M4 16h24" />
          <rect x="9" y="11.5" width="14" height="9" rx="3" fill="currentColor" stroke="none" />
        }
        @case ('Dashed') {
          <path d="M5 27l3.5-3.5M11 21l3.5-3.5M17 15l3.5-3.5M23 9l3.5-3.5" stroke-width="2" />
        }
        @case ('Weight') {
          <path d="M6 9h20" stroke-width="1" /><path d="M6 16h20" stroke-width="2" /><path d="M6 23h20" stroke-width="3.2" />
        }
        @case ('Add task') {
          <rect class="card" x="5" y="5" width="22" height="22" rx="2.5" />
          <path d="M11 16h10M16 11v10" />
        }
        @case ('Add note') {
          <rect class="card" x="5" y="5" width="22" height="22" rx="2.5" />
          <path d="M11 16h10M16 11v10" />
        }
        @case ('Undo') {
          <path d="M10 13.5a7 7 0 11-.5 6" /><path d="M10 13.5l-3.2-3.4M10 13.5l3.6-2.8" />
        }
        @case ('Redo') {
          <path d="M22 13.5a7 7 0 10.5 6" /><path d="M22 13.5l3.2-3.4M22 13.5l-3.6-2.8" />
        }
        @case ('Help') {
          <circle cx="16" cy="16" r="9" />
          <path d="M13 13.5a3 3 0 115.2 2c-.9.8-2.2 1.3-2.2 2.8" />
          <circle cx="16" cy="21.5" r="1.1" fill="currentColor" stroke="none" />
        }
        @case ('Search') {
          <circle cx="14.5" cy="14.5" r="6.5" /><path d="M19.3 19.3l5.2 5.2" stroke-width="1.8" />
        }
        @case ('Settings') {
          <circle cx="16" cy="16" r="6.5" /><circle cx="16" cy="16" r="2.6" />
          <path d="M16 6.5v-3M16 28.5v-3M25.5 16h3M3.5 16h3M22.7 9.3l2.1-2.1M7.2 24.8l2.1-2.1M22.7 22.7l2.1 2.1M7.2 7.2l2.1 2.1" stroke-width="2.4" />
        }
        @case ('Close') {
          <path d="M11 11l10 10M21 11L11 21" />
        }
        @case ('Check') {
          <circle cx="16" cy="16" r="9" fill="#55C85B" stroke="none" />
          <path d="M12 16.5l3 3 5.5-6.5" stroke="#fff" stroke-width="2" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<string>();
}
