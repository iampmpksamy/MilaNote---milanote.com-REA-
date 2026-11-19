/**
 * Audio card: a compact player (play/pause, seek bar, time, title) for an uploaded or recorded
 * file. Empty cards offer "Upload audio" and "Record" (the microphone, through MediaRecorder).
 * Only one card plays at a time.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CardPart } from './card-part';
import { claimPlayback, extensionFor, formatTime, pickRecordingType, probeMedia, releasePlayback, titleFromFileName, voiceNoteTitle } from './media/media';

/** Recordings stop by themselves after this long. */
const MAX_RECORDING_S = 60 * 60;

@Component({
  selector: 'nb-audio-card',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = live();
    <div class="nb-audio" [class.nb-audio-editing]="editing()">
      @if (editing()) {
        <input class="nb-audio-title-edit" [value]="d.title" placeholder="Title" maxlength="500" (input)="setTitle($event)" (keydown)="fieldKey($event)" />
      }
      @if (recording()) {
        <div class="nb-audio-rec" data-testid="recording">
          <span class="nb-audio-dot" aria-hidden="true"></span>
          <span class="nb-audio-time">{{ time(recSeconds()) }}</span>
          <span class="nb-audio-grow">Recording…</span>
          <button class="nb-audio-btn nb-audio-stop" (pointerdown)="$event.stopPropagation()" (click)="stopRecording()">Stop</button>
        </div>
      } @else if (!d.file || replacing()) {
        <div class="nb-audio-empty">
          @if (!editing() && !d.file) { <div class="nb-audio-label">{{ d.title || 'Audio' }}</div> }
          <div class="nb-audio-actions">
            <button class="nb-audio-btn" data-action="upload" (pointerdown)="$event.stopPropagation()" (click)="picker.click()">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" /></svg>Upload audio
            </button>
            <button class="nb-audio-btn" data-action="record" (pointerdown)="$event.stopPropagation()" (click)="record()">
              <span class="nb-audio-dot" aria-hidden="true"></span>Record
            </button>
            @if (replacing()) { <button class="nb-audio-btn nb-audio-quiet" (pointerdown)="$event.stopPropagation()" (click)="replacing.set(false)">Cancel</button> }
          </div>
        </div>
      } @else {
        <div class="nb-audio-player">
          <button class="nb-audio-play" [class.on]="playing()" [disabled]="!url()" [attr.aria-label]="playing() ? 'Pause' : 'Play'"
            (pointerdown)="$event.stopPropagation()" (click)="toggle()" (keydown)="$event.stopPropagation()">
            @if (playing()) {
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="0.5" /><rect x="9" y="3" width="3" height="10" rx="0.5" /></svg>
            } @else {
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.8v10.4a.5.5 0 0 0 .76.43l8.4-5.2a.5.5 0 0 0 0-.86l-8.4-5.2A.5.5 0 0 0 5 2.8z" /></svg>
            }
          </button>
          <div class="nb-audio-main">
            @if (!editing()) { <div class="nb-audio-label" [title]="label()">{{ label() }}</div> }
            @if (status() === 'missing') {
              <div class="nb-audio-missing">Audio file not available here yet</div>
            } @else {
              <div class="nb-audio-seekrow">
                <input class="nb-audio-seek" type="range" min="0" step="0.01" aria-label="Position" [max]="total() || 1" [value]="pos()" [disabled]="!url()"
                  (pointerdown)="$event.stopPropagation(); seeking = true" (pointerup)="seeking = false" (input)="seek($event)" (change)="seeking = false"
                  (keydown)="$event.stopPropagation()" />
                <span class="nb-audio-time" data-testid="audio-time">{{ time(pos()) }} / {{ time(total()) }}</span>
              </div>
            }
          </div>
        </div>
        @if (editing()) {
          <button class="nb-audio-btn nb-audio-quiet" data-action="replace" (pointerdown)="$event.stopPropagation()" (click)="replacing.set(true)">Replace…</button>
        }
        @if (url(); as src) {
          <audio #player [src]="src" preload="metadata" (loadedmetadata)="loaded()" (durationchange)="loaded()" (timeupdate)="tick()" (play)="started()"
            (pause)="playing.set(false)" (ended)="ended()" (error)="failed()"></audio>
        }
      }
      <input #picker type="file" accept="audio/*" hidden (change)="picked($event)" />
    </div>
  `,
  styles: `
    .nb-audio { padding: 10px 12px; font-size: 14px; }
    .nb-audio-editing { display: flex; flex-direction: column; gap: 8px; }
    .nb-audio-title-edit { font-weight: 600 !important; font-size: 14.5px !important; padding: 2px 0 !important; }
    .nb-audio-player { display: flex; align-items: center; gap: 10px; }
    .nb-audio-main { flex: 1; min-width: 0; }
    .nb-audio-label { font-weight: 600; font-size: 14px; line-height: 1.3; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nb-audio-empty .nb-audio-label { margin-bottom: 8px; color: var(--nb-muted); font-weight: 500; }
    .nb-audio-play {
      flex: none; width: 36px; height: 36px; border-radius: 50% !important; display: grid; place-items: center;
      background: var(--nb-text) !important; color: var(--nb-card) !important;
      svg { width: 15px; height: 15px; fill: currentColor; }
      &:not(.on) svg { margin-left: 2px; }
      &:disabled { opacity: 0.35; cursor: default; }
      &:focus-visible { outline: 2px solid var(--nb-select); outline-offset: 2px; }
    }
    .nb-audio-seekrow { display: flex; align-items: center; gap: 8px; height: 20px; }
    nb-card-view .nb-audio-seek { flex: 1; min-width: 40px; height: 16px; margin: 0; padding: 0; accent-color: var(--nb-text); cursor: pointer; touch-action: none; }
    .nb-audio-time { flex: none; font-size: 11.5px; color: var(--nb-muted); font-variant-numeric: tabular-nums; }
    .nb-audio-missing { font-size: 12.5px; color: var(--nb-muted); }
    .nb-audio-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .nb-audio-btn {
      display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px !important; border-radius: 4px !important;
      border: 1px solid var(--nb-border) !important; font-size: 13px !important; white-space: nowrap;
      svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      &:hover { background: var(--nb-hover) !important; }
    }
    .nb-audio-quiet { border-color: transparent !important; color: var(--nb-muted) !important; align-self: flex-start; padding: 0 4px !important; }
    .nb-audio-dot { width: 9px; height: 9px; border-radius: 50%; background: #e0443a; flex: none; }
    .nb-audio-rec {
      display: flex; align-items: center; gap: 8px; min-height: 36px;
      .nb-audio-dot { animation: nb-audio-blink 1.2s ease-in-out infinite; }
      .nb-audio-time { font-size: 13px; color: var(--nb-text); }
    }
    .nb-audio-grow { flex: 1; color: var(--nb-muted); font-size: 12.5px; }
    .nb-audio-stop { border-color: #e0443a !important; color: #e0443a !important; }
    @keyframes nb-audio-blink { 50% { opacity: 0.25; } }
    @media (pointer: coarse) {
      .nb-audio-btn { height: 34px; }
      .nb-audio-play { width: 40px; height: 40px; }
      nb-card-view .nb-audio-seek { height: 24px; }
    }
  `,
})
export class AudioCard extends CardPart<'Audio'> {
  protected readonly kindName = 'Audio' as const;
  /**
   * The card's data, read again on every change: cards are edited in place, so the same object
   * comes back and `data()` alone would not notice a new title or file.
   */
  readonly live = computed(() => {
    this.ws.rev();
    return this.data();
  }, { equal: () => false });
  private readonly destroyRef = inject(DestroyRef);
  readonly player = viewChild<ElementRef<HTMLAudioElement>>('player');

  /** The stored file's name (its own signal, so typing a title doesn't reload the player). */
  readonly file = computed(() => this.live().file);
  /** Where the file can be played from (null while looking it up or when it isn't here). */
  readonly url = signal<string | null>(null);
  readonly status = signal<'none' | 'loading' | 'ready' | 'missing'>('none');
  readonly playing = signal(false);
  readonly pos = signal(0);
  private readonly mediaDuration = signal(0);
  readonly total = computed(() => this.mediaDuration() || this.live().duration || 0);
  readonly label = computed(() => this.live().title || 'Audio');
  readonly replacing = signal(false);
  readonly recording = signal(false);
  readonly recSeconds = signal(0);
  seeking = false;

  private recorder: MediaRecorder | null = null;
  private recStream: MediaStream | null = null;
  private recTimer: ReturnType<typeof setInterval> | null = null;
  private recStarted = 0;

  readonly time = formatTime;

  constructor() {
    super();
    // Look the file up whenever it changes (a stored blob here, or the server's address).
    effect((onCleanup) => {
      const file = this.file();
      let live = true;
      onCleanup(() => (live = false));
      this.playing.set(false);
      this.pos.set(0);
      this.mediaDuration.set(0);
      if (!file) {
        this.url.set(null);
        this.status.set('none');
        return;
      }
      this.status.set('loading');
      this.ws.mediaUrl(file).then(
        (u) => {
          if (!live) return;
          this.url.set(u);
          this.status.set(u ? 'ready' : 'missing');
        },
        () => live && this.status.set('missing'),
      );
    });
    // Leaving the editor closes "Replace…".
    effect(() => {
      if (!this.editing()) this.replacing.set(false);
    });
    this.destroyRef.onDestroy(() => {
      const el = this.player()?.nativeElement;
      if (el) {
        el.pause();
        releasePlayback(el);
      }
      this.discardRecording();
    });
  }

  // ---------- playing ----------

  toggle(): void {
    const el = this.player()?.nativeElement;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => this.failed());
    } else el.pause();
  }

  started(): void {
    const el = this.player()?.nativeElement;
    if (el) claimPlayback(el);
    this.playing.set(true);
  }

  loaded(): void {
    const el = this.player()?.nativeElement;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    this.mediaDuration.set(el.duration);
    // Remember the length for devices that haven't got the file yet (part of the last change).
    const d = this.live();
    if (Math.abs(d.duration - el.duration) > 0.5) this.edit((x) => (x.duration = Math.round(el.duration * 10) / 10));
  }

  tick(): void {
    const el = this.player()?.nativeElement;
    if (el && !this.seeking) this.pos.set(el.currentTime);
  }

  seek(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    const el = this.player()?.nativeElement;
    this.pos.set(v);
    if (el && Number.isFinite(v)) el.currentTime = v;
  }

  ended(): void {
    this.playing.set(false);
    this.pos.set(0);
    const el = this.player()?.nativeElement;
    if (el) el.currentTime = 0;
  }

  failed(): void {
    this.playing.set(false);
    if (this.player()?.nativeElement.error) this.status.set('missing');
  }

  // ---------- editing ----------

  setTitle(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.edit((d) => (d.title = v));
  }

  async picked(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type && !file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      this.ws.showToast("That file isn't audio");
      return;
    }
    const info = await probeMedia(file, 'audio');
    await this.store(file, extensionFor(file.name, file.type), info.duration, titleFromFileName(file.name));
  }

  private async store(blob: Blob, ext: string, duration: number, title: string): Promise<void> {
    let name: string;
    try {
      name = await this.ws.addMedia(blob, ext);
    } catch (err) {
      this.ws.showToast(`The audio couldn't be saved: ${(err as Error).message || 'unknown error'}`);
      return;
    }
    this.replacing.set(false);
    this.edit((d) => {
      d.file = name;
      d.duration = Math.round(duration * 10) / 10;
      // Keep a title someone typed; replace an automatic one.
      if (!d.title || d.title.startsWith('Voice note ')) d.title = title;
    }, true);
  }

  // ---------- recording ----------

  async record(): Promise<void> {
    if (this.recording()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.ws.showToast("This browser can't record audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException).name;
      this.ws.showToast(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Noteboard may not use the microphone. Allow it in the browser (or system) settings to record.'
          : name === 'NotFoundError'
            ? 'No microphone was found'
            : `The microphone couldn't be used: ${(err as Error).message || name}`,
      );
      return;
    }
    const type = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.ws.showToast("This browser can't record audio");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      const seconds = (Date.now() - this.recStarted) / 1000;
      const keep = this.recorder === rec;
      this.endRecording();
      if (!keep || !chunks.length) return;
      const mime = rec.mimeType || type || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      void this.store(blob, extensionFor('', mime), seconds, voiceNoteTitle());
    };
    this.recorder = rec;
    this.recStream = stream;
    this.recStarted = Date.now();
    this.recSeconds.set(0);
    this.recording.set(true);
    this.recTimer = setInterval(() => {
      const s = (Date.now() - this.recStarted) / 1000;
      this.recSeconds.set(s);
      if (s >= MAX_RECORDING_S) this.stopRecording();
    }, 250);
    rec.start(500);
  }

  stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else this.endRecording();
  }

  private endRecording(): void {
    if (this.recTimer) clearInterval(this.recTimer);
    this.recTimer = null;
    this.recStream?.getTracks().forEach((t) => t.stop());
    this.recStream = null;
    this.recorder = null;
    this.recording.set(false);
  }

  /** The card went away while recording: stop without keeping anything. */
  private discardRecording(): void {
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    this.endRecording();
  }
}
