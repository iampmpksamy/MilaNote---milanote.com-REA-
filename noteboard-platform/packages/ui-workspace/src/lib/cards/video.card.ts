/**
 * Video card: an uploaded file (played here), or a YouTube/Vimeo link shown as a click-to-load
 * player. Nothing is fetched from YouTube or Vimeo until the play button is pressed (privacy); other
 * links are shown like a link card.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { CardPart } from './card-part';
import { claimPlayback, domainOf, extensionFor, parseVideoLink, parseWebUrl, pauseAll, probeMedia, releasePlayback, titleFromFileName } from './media/media';

/** The server's limit for a video link (longer ones would make every save fail). */
const MAX_URL = 2000;

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
              <input class="nb-field" data-field="url" placeholder="Paste a YouTube or Vimeo link" maxlength="2000" [value]="d.url" (pointerdown)="$event.stopPropagation()"
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
          <input class="nb-field" data-field="url" placeholder="Paste a YouTube or Vimeo link" maxlength="2000" [value]="d.url" (input)="setUrl($event)" (keydown)="fieldKey($event)" />
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
  styleUrl: './video.card.css',
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
    // In the iPhone/iPad app the page has no web address of its own, which YouTube's player
    // refuses: open the video in YouTube/Safari there instead of an embedded player.
    if ((globalThis as { __nbPlatform?: string }).__nbPlatform === 'ios' && l.provider === 'YouTube') {
      const open = (globalThis as { nbOpenExternal?: (u: string) => void }).nbOpenExternal;
      if (open) open(this.rawUrl());
      else window.open(this.rawUrl(), '_blank', 'noopener');
      return;
    }
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
    const v = (e.target as HTMLInputElement).value.trim().slice(0, MAX_URL);
    this.edit((d) => (d.url = v), checkpoint);
  }

  /** A link pasted into an empty card is used straight away. */
  pasted(e: ClipboardEvent): void {
    const v = e.clipboardData?.getData('text/plain')?.trim();
    if (!v || v.length > MAX_URL || !parseWebUrl(v)) return;
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
