/**
 * Map card: a place on a small map, with its label and a link to openstreetmap.org.
 *
 * Search and map pictures come through the person's own Noteboard server (apiGet on the storage,
 * /api/v1/geo/*); the page never talks to a map service. Local mode (no server) says so.
 * Editing: search (500 ms after typing stops, Enter at once), pick a result, zoom −/+, label.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { CardPart } from './card-part';
import { MAX_ZOOM, MIN_ZOOM, type MapProblem, type Place, clampZoom, mapClient, osmLink, problemOf, tileGrid } from './map/geo';

const SEARCH_DELAY_MS = 500;

@Component({
  selector: 'nb-map-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nb-map-host' },
  template: `
    @let d = cur();
    @if (editing() && api.available) {
      <div class="nb-map-search">
        <input class="nb-field nb-map-q" data-testid="map-search" [value]="query()" placeholder="Search for a place or address" enterkeyhint="search"
          (input)="typed($event)" (keydown)="searchKey($event)" />
        @if (status(); as s) { <div class="nb-muted nb-map-status" data-testid="map-status">{{ s }}</div> }
        @if (results()?.length) {
          <div class="nb-map-results" data-testid="map-results">
            @for (p of results(); track $index) {
              <button class="nb-map-result" [attr.data-result]="$index" (pointerdown)="$event.stopPropagation()" (click)="pick(p)" (keydown)="resultKey($index, $event)">
                <span class="nb-map-result-label">{{ p.label }}</span>
                @if (p.detail && p.detail !== p.label) { <span class="nb-map-result-detail">{{ p.detail }}</span> }
              </button>
            }
          </div>
        }
      </div>
    }
    @if (located()) {
      <div class="nb-map-view" [style.height.px]="height()" data-testid="map-view">
        @if (!api.available) {
          <div class="nb-map-blank">Maps need a Noteboard server</div>
        } @else if (unavailable()) {
          <div class="nb-map-blank" data-testid="map-offline">{{ problemText() }}</div>
        } @else {
          <div class="nb-map-tiles">
            @for (t of grid(); track t.id) {
              @if (urls().get(t.z + '/' + t.x + '/' + t.y); as u) {
                <img [src]="u" alt="" draggable="false" [style.left.px]="t.left" [style.top.px]="t.top" />
              }
            }
          </div>
          <svg class="nb-map-pin" viewBox="0 0 24 34" width="24" height="34" aria-hidden="true">
            <path d="M12 33C12 33 2 19.5 2 12a10 10 0 0 1 20 0c0 7.5-10 21-10 21z" />
            <circle cx="12" cy="12" r="3.8" />
          </svg>
          <a class="nb-map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" (pointerdown)="$event.stopPropagation()">© OpenStreetMap contributors</a>
        }
        @if (editing() && api.available) {
          <div class="nb-map-zoom">
            <button title="Zoom out" data-testid="map-zoom-out" [disabled]="d.zoom <= minZoom" (pointerdown)="$event.stopPropagation()" (click)="zoomBy(-1)">−</button>
            <button title="Zoom in" data-testid="map-zoom-in" [disabled]="d.zoom >= maxZoom" (pointerdown)="$event.stopPropagation()" (click)="zoomBy(1)">+</button>
          </div>
        }
      </div>
    }
    @if (editing() && (located() || !api.available)) {
      <div class="nb-map-foot">
        @if (!api.available && !located()) { <div class="nb-map-need" data-testid="map-need-server">Maps need a Noteboard server</div> }
        <input class="nb-map-label-edit" data-testid="map-label" [value]="d.label" placeholder="Label" (input)="setLabel($event)" (keydown)="fieldKey($event)" />
      </div>
    } @else if (located()) {
      <div class="nb-map-foot">
        <div class="nb-map-label" data-testid="map-label">{{ d.label || d.query || 'Place' }}</div>
        <a class="nb-map-open" data-testid="map-open" [href]="link()" target="_blank" rel="noopener noreferrer" (pointerdown)="$event.stopPropagation()">Open in maps ↗</a>
      </div>
    } @else if (!editing()) {
      @if (api.available) {
        <div class="nb-map-empty">
          <input class="nb-field nb-map-q" data-testid="map-start" readonly placeholder="Search for a place or address" (pointerdown)="startSearch($event)" (focus)="startSearch($event)" />
          <div class="nb-muted">Map</div>
        </div>
      } @else {
        <div class="nb-map-empty" data-testid="map-need-server">
          @if (d.label) { <div class="nb-map-label nb-map-local-label">{{ d.label }}</div> }
          <div class="nb-map-need">Maps need a Noteboard server</div>
          <div class="nb-muted">Sign in to a Noteboard server to search places and show maps.</div>
        </div>
      }
    }
  `,
  styleUrl: './map.card.css',
})
export class MapCard extends CardPart<'Map'> {
  protected readonly kindName = 'Map' as const;
  readonly api = mapClient();
  readonly minZoom = MIN_ZOOM;
  readonly maxZoom = MAX_ZOOM;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /**
   * The map data, fresh after every change: cards are edited in place, so the card input keeps
   * the same object; the board revision says when to look again.
   */
  readonly cur = computed(() => {
    this.ws.rev();
    const d = this.data();
    return { query: d?.query ?? '', label: d?.label ?? '', lat: d?.lat ?? null, lng: d?.lng ?? null, zoom: d?.zoom ?? 13 };
  });

  /** The card's inside width (columns make cards narrower than their saved width). */
  private readonly measured = signal(0);
  readonly width = computed(() => this.measured() || this.card().width);
  readonly height = computed(() => Math.round(Math.min(420, Math.max(120, this.width() * 0.62))));
  readonly located = computed(() => {
    const d = this.cur();
    return typeof d.lat === 'number' && typeof d.lng === 'number' && Number.isFinite(d.lat) && Number.isFinite(d.lng);
  });
  readonly grid = computed(() => {
    const d = this.cur();
    return this.located() ? tileGrid(d.lat!, d.lng!, clampZoom(d.zoom), this.width(), this.height()) : [];
  });
  readonly link = computed(() => {
    const d = this.cur();
    return this.located() ? osmLink(d.lat!, d.lng!, d.zoom) : null;
  });

  /** Map pictures by "z/x/y": an object URL, or null when it couldn't be fetched. */
  readonly urls = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly pending = new Set<string>();
  readonly tileProblem = signal<MapProblem | null>(null);
  /** Nothing to show: every picture of the map failed. */
  readonly unavailable = computed(() => {
    const g = this.grid();
    const u = this.urls();
    return g.length > 0 && g.every((t) => u.get(`${t.z}/${t.x}/${t.y}`) === null);
  });
  readonly problemText = computed(() => {
    switch (this.tileProblem()) {
      case 'off':
        return 'Maps are turned off on this server';
      case 'offline':
        return 'Map not available offline';
      default:
        return "The map couldn't be loaded";
    }
  });

  // Search (editing).
  readonly query = signal('');
  readonly results = signal<Place[] | null>(null);
  readonly status = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    super();
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.measured.set(Math.round(el.clientWidth)));
      ro.observe(el);
      destroy.onDestroy(() => ro.disconnect());
    });
    // Fetch the pictures the map needs (once per session; failed ones again when back online).
    effect(() => {
      const g = this.grid();
      if (!this.api.available) return;
      const have = untracked(this.urls);
      for (const t of g) {
        const key = `${t.z}/${t.x}/${t.y}`;
        if (have.has(key) || this.pending.has(key)) continue;
        this.pending.add(key);
        this.api.tile(t.z, t.x, t.y).then(
          (url) => this.gotTile(key, url),
          (e) => {
            this.tileProblem.set(problemOf(e));
            this.gotTile(key, null);
          },
        );
      }
    });
    if (typeof window !== 'undefined') {
      const online = () => this.urls.update((m) => new Map([...m].filter(([, v]) => v !== null)));
      window.addEventListener('online', online);
      destroy.onDestroy(() => window.removeEventListener('online', online));
    }
    // Editing starts with the card's search text; it ends with the results put away.
    effect(() => {
      if (this.editing()) this.query.set(untracked(this.cur).query);
      else {
        this.clearTimer();
        this.seq++;
        this.results.set(null);
        this.status.set('');
      }
    });
    destroy.onDestroy(() => this.clearTimer());
  }

  private gotTile(key: string, url: string | null): void {
    this.pending.delete(key);
    this.urls.update((m) => new Map(m).set(key, url));
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The empty card's search field: one click starts editing with the real field focused. */
  startSearch(e: Event): void {
    e.stopPropagation();
    e.preventDefault();
    this.ws.edit(this.card().id);
  }

  typed(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.query.set(v);
    this.edit((d) => (d.query = v.slice(0, 500)));
    this.clearTimer();
    this.timer = setTimeout(() => this.searchNow(), SEARCH_DELAY_MS);
  }

  searchKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void this.searchNow();
      return;
    }
    if (e.key === 'ArrowDown' && this.results()?.length) {
      e.preventDefault();
      e.stopPropagation();
      this.focusResult(0);
      return;
    }
    this.fieldKey(e);
  }

  resultKey(i: number, e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (n < 0) this.host.nativeElement.querySelector<HTMLInputElement>('.nb-map-q')?.focus({ preventScroll: true });
      else this.focusResult(Math.min(n, (this.results()?.length ?? 1) - 1));
    } else if (e.key === 'Escape') this.fieldKey(e);
    else if (e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
  }

  private focusResult(i: number): void {
    this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-result="${i}"]`)?.focus({ preventScroll: true });
  }

  async searchNow(): Promise<void> {
    this.clearTimer();
    const q = this.query().trim();
    const n = ++this.seq;
    if (!q) {
      this.results.set(null);
      this.status.set('');
      return;
    }
    this.status.set('Searching…');
    try {
      const found = await this.api.search(q);
      if (n !== this.seq) return;
      this.results.set(found);
      this.status.set(found.length ? '' : 'No places found');
    } catch (e) {
      if (n !== this.seq) return;
      this.results.set(null);
      const p = problemOf(e);
      this.status.set(
        p === 'offline' ? 'Searching places needs a connection' : p === 'busy' ? 'Lots of searches right now; try again in a moment' : p === 'off' ? 'Maps are turned off on this server' : "The search didn't work; try again",
      );
    }
  }

  pick(p: Place): void {
    const q = this.query().trim();
    this.edit((d) => {
      d.query = q.slice(0, 500);
      d.label = p.label.slice(0, 500);
      d.lat = Math.round(p.lat * 1e6) / 1e6;
      d.lng = Math.round(p.lng * 1e6) / 1e6;
      if (!Number.isFinite(d.zoom)) d.zoom = 13;
    }, true);
    this.seq++;
    this.results.set(null);
    this.status.set('');
  }

  zoomBy(step: number): void {
    this.edit((d) => (d.zoom = clampZoom(d.zoom + step)), true);
  }

  setLabel(e: Event): void {
    const v = (e.target as HTMLInputElement).value.slice(0, 500);
    this.edit((d) => (d.label = v));
  }
}
