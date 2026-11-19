/**
 * Video card: an uploaded file (played here), or a YouTube/Vimeo link shown as a click-to-load
 * player. Nothing is fetched from YouTube or Vimeo until the play button is pressed (privacy); other
 * links are shown like a link card.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { CardPart } from './card-part';
import { claimPlayback, domainOf, extensionFor, parseVideoLink, parseWebUrl, pauseAll, probeMedia, releasePlayback, titleFromFileName } from './media/media';

@Component({
  selector: 'nb-video-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = live();
    <div class="nb-video" [class.nb-video-editing]="editing()">
      @switch (mode()) {
        @case ('file') {
          <div class="nb-video-frame" [style.aspect-ratio]="ratio()">
            @if (url(); as src) {
              <video #player [src]="src" controls preload="metadata" playsinline (pointerdown)="$event.stopPropagation()" (keydown)="$event.stopPropagation()"
                (loadedmetadata)="loaded()" (play)="started()" (error)="missing.set(true)"></video>
            }
            @if (missing()) { <div class="nb-video-note">Video file not available here yet</div> }
          </div>
        }
        @case ('embed') {
          @let v = link()!;
          <div class="nb-video-frame nb-video-poster" [style.aspect-ratio]="ratio()">
            @if (embedUrl(); as src) {
              <iframe [src]="src" [title]="d.title || v.provider + ' video'" allow="autoplay; fullscreen; picture-in-picture"
                allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
            } @else {
              <button class="nb-video-big" data-action="load" [attr.aria-label]="'Play on ' + v.provider" (pointerdown)="$event.stopPropagation()" (click)="load()">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.2v9.6a.5.5 0 0 0 .77.42l7.4-4.8a.5.5 0 0 0 0-.84l-7.4-4.8a.5.5 0 0 0-.77.42z" /></svg>
              </button>
              <div class="nb-video-caption">
                <b>{{ d.title || v.provider + ' video' }}</b>
                <span>{{ domain() }} · loads from {{ v.provider }} when played</span>
              </div>
            }
          </div>
        }
        @case ('link') {
          <div class="nb-video-link">
            <div class="nb-video-tile">▶</div>
            <div class="nb-video-grow">
              <div class="nb-video-title">{{ d.title || domain() }}</div>
              <div class="nb-muted">{{ domain() }}</div>
            </div>
          </div>
        }
        @default {
          @if (!editing()) {
            <div class="nb-video-empty">
              <input class="nb-field" data-field="url" placeholder="Paste a YouTube or Vimeo link" [value]="d.url" (pointerdown)="$event.stopPropagation()"
                (keydown)="urlKey($event)" (change)="setUrl($event, true)" (paste)="pasted($event)" />
              <button class="nb-video-btn" data-action="upload" (pointerdown)="$event.stopPropagation()" (click)="picker.click()">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" /></svg>Upload video
              </button>
            </div>
          }
        }
      }
      @if (editing()) {
        <div class="nb-video-form">
          <span class="nb-muted">Video link</span>
          <input class="nb-field" data-field="url" placeholder="Paste a YouTube or Vimeo link" [value]="d.url" (input)="setUrl($event)" (keydown)="fieldKey($event)" />
          @if (d.url.trim()) {
            <div class="nb-video-hint" [class.ok]="link()">{{ link() ? link()!.provider + ' video ✓' : safeUrl() ? 'Not a YouTube or Vimeo video: shown as a link' : 'Not a web address' }}</div>
          }
          <span class="nb-muted">Title</span>
          <input class="nb-field" data-field="title" placeholder="Optional" maxlength="500" [value]="d.title" (input)="setTitle($event)" (keydown)="fieldKey($event)" />
          <button class="nb-video-btn" data-action="upload" (pointerdown)="$event.stopPropagation()" (click)="picker.click()">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" /></svg>{{ d.file ? 'Replace video file…' : 'Upload video' }}
          </button>
        </div>
      } @else if (mode() !== 'empty') {
        <div class="nb-video-foot">
          <span class="nb-video-grow">{{ d.title || (mode() === 'file' ? 'Video' : domain()) }}</span>
          @if (safeUrl(); as href) {
            <a class="nb-video-open" [href]="href" target="_blank" rel="noopener noreferrer" (pointerdown)="$event.stopPropagation()">Open ↗</a>
          }
        </div>
      }
      <input #picker type="file" accept="video/*" hidden (change)="picked($event)" />
    </div>
  `,
  styles: `
    .nb-video { font-size: 14px; }
    .nb-video-frame { position: relative; display: block; width: 100%; background: #111; border-radius: 3px 3px 0 0; overflow: hidden; }
    .nb-video-frame video, .nb-video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #000; }
    .nb-video-note { position: absolute; inset: 0; display: grid; place-items: center; color: #b9bcc2; font-size: 13px; padding: 0 16px; text-align: center; }
    .nb-video-poster { background: linear-gradient(160deg, #2b2e35, #121316); color: #fff; }
    .nb-video-big {
      position: absolute; left: 50%; top: 50%; width: 64px; height: 44px; margin: -30px 0 0 -32px; border-radius: 12px !important;
      display: grid; place-items: center; background: rgba(255, 255, 255, 0.14) !important; color: #fff !important; transition: background 0.12s, transform 0.12s;
      svg { width: 22px; height: 22px; fill: currentColor; }
      &:hover { background: #e0443a !important; transform: scale(1.05); }
      &:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    }
    .nb-video-caption {
      position: absolute; left: 12px; right: 12px; bottom: 10px; line-height: 1.3; pointer-events: none;
      b, span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      b { font-size: 14px; font-weight: 600; }
      span { font-size: 11.5px; color: rgba(255, 255, 255, 0.6); }
    }
    .nb-video-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; min-height: 18px; }
    .nb-video-grow { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nb-video-open { flex: none; color: var(--nb-select); font-size: 12.5px; text-decoration: none; }
    .nb-video-link { display: flex; gap: 10px; padding: 12px 14px 4px; }
    .nb-video-tile { flex: none; width: 36px; height: 36px; border-radius: 6px; display: grid; place-items: center; background: #3a3d44; color: #fff; font-size: 14px; }
    .nb-video-title { font-weight: 600; font-size: 14.5px; overflow-wrap: anywhere; }
    .nb-video-empty { padding: 14px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .nb-video-form { padding: 10px 14px 12px; display: flex; flex-direction: column; align-items: stretch; .nb-field { margin-bottom: 4px; } > .nb-muted { margin-top: 4px; } }
    nb-card-view .nb-video .nb-field { padding: 6px 8px; background: var(--nb-canvas); }
    .nb-video-hint { font-size: 12px; color: var(--nb-muted); margin-bottom: 2px; &.ok { color: #3c9a5f; } }
    .nb-video-btn {
      display: inline-flex; align-items: center; align-self: flex-start; gap: 6px; height: 28px; margin-top: 6px; padding: 0 10px !important;
      border: 1px solid var(--nb-border) !important; border-radius: 4px !important; font-size: 13px !important; white-space: nowrap;
      svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      &:hover { background: var(--nb-hover) !important; }
    }
    @media (pointer: coarse) { .nb-video-btn { height: 34px; } .nb-video-big { width: 72px; height: 50px; margin: -32px 0 0 -36px; } }
  `,
})
export class VideoCard extends CardPart<'Video'> {
  protected readonly kindName = 'Video' as const;
  /**
   * The card's data, read again on every change: cards are edited in place, so the same object
   * comes back and `data()` alone would not notice a new title or file.
   */
  readonly live = computed(() => {
    this.ws.rev();
    return this.data();
  }, { equal: () => false });
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  readonly file = computed(() => this.live().file);
  readonly rawUrl = computed(() => this.live().url);
  readonly link = computed(() => parseVideoLink(this.rawUrl()));
  readonly safeUrl = computed(() => parseWebUrl(this.rawUrl())?.href ?? null);
  readonly domain = computed(() => domainOf(this.rawUrl()));
  /** A link (when there is one) is shown before an uploaded file. */
  readonly mode = computed<'embed' | 'link' | 'file' | 'empty'>(() => (this.link() ? 'embed' : this.safeUrl() ? 'link' : this.file() ? 'file' : 'empty'));
  readonly ratio = computed(() => {
    const a = this.live().aspect;
    return `1 / ${Number.isFinite(a) && a > 0.1 && a < 10 ? a : 0.5625}`;
  });

  readonly url = signal<string | null>(null);
  readonly missing = signal(false);
  /** The YouTube/Vimeo player, once the poster was clicked (only on this device, not saved). */
  readonly loadedEmbed = signal<string | null>(null);
  readonly embedUrl = computed<SafeResourceUrl | null>(() => {
    const l = this.link();
    // Only addresses built by parseVideoLink (fixed hosts, checked ids) ever reach the frame.
    return l && this.loadedEmbed() === l.embed ? this.sanitizer.bypassSecurityTrustResourceUrl(l.embed) : null;
  });
  /** The file whose picture size was already taken into the card. */
  private measured = '';

  constructor() {
    super();
    effect((onCleanup) => {
      const file = this.file();
      let live = true;
      onCleanup(() => (live = false));
      this.missing.set(false);
      this.url.set(null);
      if (!file) return;
      this.ws.mediaUrl(file).then(
        (u) => {
          if (!live) return;
          this.url.set(u);
          this.missing.set(!u);
        },
        () => live && this.missing.set(true),
      );
    });
    this.destroyRef.onDestroy(() => {
      const el = this.player()?.nativeElement;
      if (el) {
        el.pause();
        releasePlayback(el);
      }
    });
  }

  load(): void {
    const l = this.link();
    if (!l) return;
    pauseAll();
    this.loadedEmbed.set(l.embed);
  }

  started(): void {
    const el = this.player()?.nativeElement;
    if (el) claimPlayback(el);
  }

  /** Takes the video's own shape once per file (not an undo step of its own). */
  loaded(): void {
    const el = this.player()?.nativeElement;
    const file = this.file();
    if (!el || !el.videoWidth || !el.videoHeight || this.measured === file) return;
    this.measured = file;
    const aspect = Math.round((el.videoHeight / el.videoWidth) * 10000) / 10000;
    if (Math.abs(aspect - this.live().aspect) > 0.005) this.edit((d) => (d.aspect = aspect));
  }

  setUrl(e: Event, checkpoint = false): void {
    const v = (e.target as HTMLInputElement).value.trim();
    this.edit((d) => (d.url = v), checkpoint);
  }

  /** A link pasted into an empty card is used straight away. */
  pasted(e: ClipboardEvent): void {
    const v = e.clipboardData?.getData('text/plain')?.trim();
    if (!v || !parseWebUrl(v)) return;
    e.preventDefault();
    this.edit((d) => (d.url = v), true);
  }

  urlKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this.setUrl(e, true);
      (e.target as HTMLElement).blur();
    }
    this.fieldKey(e);
  }

  setTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((d) => (d.title = v));
  }

  async picked(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) {
      this.ws.showToast("That file isn't a video");
      return;
    }
    const info = await probeMedia(file, 'video');
    let name: string;
    try {
      name = await this.ws.addMedia(file, extensionFor(file.name, file.type));
    } catch (err) {
      this.ws.showToast(`The video couldn't be saved: ${(err as Error).message || 'unknown error'}`);
      return;
    }
    this.measured = info.width && info.height ? name : '';
    this.edit((d) => {
      d.file = name;
      d.url = '';
      if (info.width && info.height) d.aspect = Math.round((info.height / info.width) * 10000) / 10000;
      if (!d.title) d.title = titleFromFileName(file.name);
    }, true);
  }
}
