/**
 * The drawing editor of a sketch card: a large dialog on desktops, the whole screen on phones.
 * Mouse, finger and pen all draw (pointer events); a second finger never draws, so pinching on a
 * tablet doesn't leave marks. Every finished stroke is saved to the card at once; the whole editing
 * session is one undo step on the board (taken when editing began), and the editor has its own
 * undo/redo for strokes while it is open.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, ViewEncapsulation, computed, inject, input, signal, viewChild } from '@angular/core';
import type { Card, Stroke } from '@noteboard/board-model';
import { Icon } from '../../icon';
import { Workspace } from '../../workspace.service';
import {
  DEFAULT_INK,
  InkPath,
  MARKER_SCALE,
  MAX_NUMBERS,
  MAX_STROKES,
  SKETCH_COLORS,
  SKETCH_WIDTHS,
  WIDTH_NAMES,
  WidthIndex,
  countNumbers,
  eraseAlong,
  inkPath,
  pushPoint,
} from './sketch-geom';

export type SketchTool = 'pen' | 'marker' | 'eraser';
type SketchData = { strokes: Stroke[]; aspect: number; background: boolean };

/** Eraser radius in the sketch's 0–1000 space. */
const ERASER = 14;
/** A touch stroke this young is dropped when a second finger lands (it was the start of a pinch). */
const PINCH_GRACE_MS = 250;

@Component({
  selector: 'nb-sketch-editor',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'nb-sk' },
  template: `
    <div class="nb-sk-dim" (pointerdown)="done()"></div>
    <div class="nb-sk-dialog" role="dialog" aria-label="Sketch">
      <div class="nb-sk-bar">
        <div class="nb-sk-group nb-sk-colors">
          @for (c of colors; track c[1]) {
            <button class="nb-sk-color" [attr.data-color]="c[1]" [class.on]="color() === c[1] && tool() !== 'eraser'" [style.background]="c[1]" [title]="c[0]" (click)="pick(c[1])"></button>
          }
        </div>
        <div class="nb-sk-group">
          @for (w of widthNames; track $index) {
            <button class="nb-sk-btn" [attr.data-width]="$index" [class.on]="width() === $index" [title]="w" (click)="width.set($any($index))"><i class="nb-sk-dot" [style.width.px]="4 + $index * 4" [style.height.px]="4 + $index * 4"></i></button>
          }
        </div>
        <div class="nb-sk-group">
          <button class="nb-sk-btn" data-sk="pen" [class.on]="tool() === 'pen'" title="Pen" (click)="tool.set('pen')">
            <svg viewBox="0 0 20 20"><path d="M4 16.5l.8-3.6 8.6-8.6 2.8 2.8-8.6 8.6zM11.8 5.9l2.8 2.8" /></svg>
          </button>
          <button class="nb-sk-btn" data-sk="marker" [class.on]="tool() === 'marker'" title="Marker (see-through)" (click)="tool.set('marker')">
            <svg viewBox="0 0 20 20"><path d="M6.5 13.5l-1-3 6.8-6.8 4 4-6.8 6.8zM5.5 10.5l-2 4 3 0" /><path class="thick" d="M10 17h6.5" /></svg>
          </button>
          <button class="nb-sk-btn" data-sk="eraser" [class.on]="tool() === 'eraser'" title="Eraser (removes whole strokes)" (click)="tool.set('eraser')">
            <svg viewBox="0 0 20 20"><path d="M8 16.5l-4.2-4.2 7.4-7.4 5 5-6.6 6.6zM6.6 8.4l5 5M8 16.5h8.5" /></svg>
          </button>
        </div>
        <div class="nb-sk-group">
          <button class="nb-sk-btn" data-sk="undo" title="Undo (Ctrl+Z)" [disabled]="!past().length" (click)="undo()"><nb-icon name="Undo" /></button>
          <button class="nb-sk-btn" data-sk="redo" title="Redo (Ctrl+Shift+Z)" [disabled]="!future().length" (click)="redo()"><nb-icon name="Redo" /></button>
          <button class="nb-sk-btn nb-sk-text" data-sk="clear" title="Remove every stroke" [disabled]="!strokes().length" (click)="askClear.set(true)">Clear</button>
        </div>
        <span class="nb-spacer"></span>
        <span class="nb-sk-break"></span>
        <button class="nb-sk-done" data-sk="done" (click)="done()">Done</button>
      </div>
      @if (askClear()) {
        <div class="nb-sk-ask" role="alertdialog">
          <span>Clear the whole sketch?</span>
          <button class="nb-button danger" data-sk="clear-yes" (click)="clear()">Clear</button>
          <button class="nb-button" data-sk="clear-no" (click)="askClear.set(false)">Cancel</button>
        </div>
      }
      <div class="nb-sk-stage">
        <svg #svg class="nb-sk-svg" [class.eraser]="tool() === 'eraser'" [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
          (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)">
          <rect class="nb-sk-paper" [class.clear]="!paper()" x="0" y="0" width="1000" [attr.height]="height()" />
          <g class="nb-sk-ink">
            @for (p of paths(); track $index) {
              <path [attr.d]="p.d" [attr.stroke]="p.color" [attr.stroke-width]="p.width" [attr.stroke-opacity]="p.opacity" />
            }
            @if (live(); as p) {
              <path class="live" [attr.d]="p.d" [attr.stroke]="p.color" [attr.stroke-width]="p.width" [attr.stroke-opacity]="p.opacity" />
            }
          </g>
        </svg>
      </div>
    </div>
  `,
  styleUrl: './sketch-editor.css',
})
export class SketchEditor implements OnInit {
  readonly ws = inject(Workspace);
  readonly card = input.required<Card>();
  readonly colors = SKETCH_COLORS;
  readonly widthNames = WIDTH_NAMES;
  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  readonly tool = signal<SketchTool>('pen');
  readonly color = signal(DEFAULT_INK);
  readonly width = signal<WidthIndex>(1);
  readonly strokes = signal<Stroke[]>([]);
  readonly past = signal<Stroke[][]>([]);
  readonly future = signal<Stroke[][]>([]);
  readonly askClear = signal(false);
  readonly live = signal<InkPath | null>(null);

  private readonly sketch = computed(() => (this.card().content as { Sketch?: SketchData }).Sketch ?? { strokes: [], aspect: 0.75, background: true });
  readonly paper = computed(() => this.sketch().background);
  readonly height = computed(() => 1000 * (this.sketch().aspect > 0 ? this.sketch().aspect : 0.75));
  readonly viewBox = computed(() => `0 0 1000 ${this.height()}`);
  readonly paths = computed(() => {
    const dark = this.ws.dark();
    return this.strokes().map((s) => inkPath(s, dark, this.paper()));
  });

  /** The stroke (or eraser move) under way. */
  private active: { id: number; stroke: Stroke | null; before: Stroke[]; at: number; last: [number, number]; touch: boolean } | null = null;
  /** Fingers on the drawing. */
  private readonly touches = new Set<number>();

  constructor() {
    // Keys go to the editor while it is open: board shortcuts (Delete, N, Ctrl+Z…) must not fire.
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.shiftKey && ['KeyD', 'Comma', 'Period'].includes(e.code)) return; // theme and size stay app-wide
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.askClear()) this.askClear.set(false);
        else this.done();
      } else if (cmd && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      } else if (cmd && e.code === 'KeyZ') {
        e.preventDefault();
        this.undo();
      }
    };
    addEventListener('keydown', onKey, true);
    inject(DestroyRef).onDestroy(() => removeEventListener('keydown', onKey, true));
  }

  ngOnInit(): void {
    this.strokes.set([...this.sketch().strokes]);
  }

  pick(color: string): void {
    this.color.set(color);
    if (this.tool() === 'eraser') this.tool.set('pen');
  }

  done(): void {
    this.ws.stopEditing();
  }

  // ---------- pointer ----------

  /** Pointer position in the sketch's space (kept on the paper). */
  private at(e: { clientX: number; clientY: number }): [number, number] {
    const m = this.svgRef().nativeElement.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.min(1000, Math.max(0, p.x)), Math.min(this.height(), Math.max(0, p.y))];
  }

  down(e: PointerEvent): void {
    const touch = e.pointerType === 'touch';
    if (touch) {
      const others = this.touches.size;
      this.touches.add(e.pointerId);
      if (others > 0) {
        // A second finger: never draws, and a stroke that has only just begun was a pinch starting.
        const a = this.active;
        if (a?.touch && a.stroke && Date.now() - a.at < PINCH_GRACE_MS) {
          this.active = null;
          this.live.set(null);
        }
        return;
      }
    }
    if (this.active) return;
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.button !== 0 && !penEraser) return;
    e.preventDefault();
    this.askClear.set(false);
    try {
      (e.currentTarget as Element | null)?.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic events) */
    }
    const [x, y] = this.at(e);
    this.active = { id: e.pointerId, stroke: null, before: this.strokes(), at: Date.now(), last: [x, y], touch };
    if (penEraser || this.tool() === 'eraser') {
      this.erase(x, y);
      return;
    }
    if (this.strokes().length >= MAX_STROKES || countNumbers(this.strokes()) >= MAX_NUMBERS - 2) {
      this.active = null;
      this.ws.showToast('This sketch is full: erase something or start another sketch');
      return;
    }
    const marker = this.tool() === 'marker';
    const stroke: Stroke = { color: this.color(), width: SKETCH_WIDTHS[this.width()] * (marker ? MARKER_SCALE : 1), points: [] };
    if (marker) stroke.marker = true;
    pushPoint(stroke.points, x, y, 0);
    this.active.stroke = stroke;
    this.showLive();
  }

  move(e: PointerEvent): void {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = this.at(ev);
      if (a.stroke) {
        if (countNumbers(this.strokes()) + a.stroke.points.length + 2 > MAX_NUMBERS) break;
        pushPoint(a.stroke.points, x, y);
      } else this.erase(x, y);
    }
    if (a.stroke) this.showLive();
  }

  up(e: PointerEvent): void {
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.active = null;
    this.live.set(null);
    if (a.stroke) {
      if (e.type === 'pointerup') {
        const [x, y] = this.at(e);
        pushPoint(a.stroke.points, x, y, 0.3);
      }
      this.commit([...this.strokes(), a.stroke], a.before);
    } else if (this.strokes() !== a.before) {
      this.commit(this.strokes(), a.before);
    }
  }

  private erase(x: number, y: number): void {
    const a = this.active;
    if (!a) return;
    const kept = eraseAlong(this.strokes(), a.last[0], a.last[1], x, y, ERASER);
    a.last = [x, y];
    if (kept !== this.strokes()) this.strokes.set(kept);
  }

  private showLive(): void {
    const s = this.active?.stroke;
    this.live.set(s ? inkPath(s, this.ws.dark(), this.paper(), false) : null);
  }

  // ---------- history ----------

  private commit(next: Stroke[], before: Stroke[]): void {
    this.past.update((p) => [...p, before].slice(-200));
    this.future.set([]);
    this.strokes.set(next);
    this.save(next);
  }

  private save(next: Stroke[]): void {
    this.ws.updateCard(this.card().id, (c) => {
      if ('Sketch' in c.content) c.content.Sketch.strokes = next;
    });
  }

  undo(): void {
    const p = this.past();
    if (!p.length) return;
    this.future.update((f) => [...f, this.strokes()]);
    this.past.set(p.slice(0, -1));
    this.strokes.set(p[p.length - 1]);
    this.save(this.strokes());
  }

  redo(): void {
    const f = this.future();
    if (!f.length) return;
    this.past.update((p) => [...p, this.strokes()]);
    this.future.set(f.slice(0, -1));
    this.strokes.set(f[f.length - 1]);
    this.save(this.strokes());
  }

  clear(): void {
    this.askClear.set(false);
    if (this.strokes().length) this.commit([], this.strokes());
  }
}
