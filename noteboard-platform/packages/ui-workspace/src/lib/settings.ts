import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { ImportReport } from '@noteboard/board-model';
import { Icon } from './icon';
import { Prefs, SCALES } from './prefs';
import { TOOLS, Tool, UNAVAILABLE, Workspace } from './workspace.service';

const PAGES = ['Appearance', 'Preferences', 'Language', 'Toolbar options', 'Privacy & data'];

@Component({
  selector: 'nb-settings',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (ws.settingsOpen()) {
      <button class="nb-dim settings" aria-label="Close settings" tabindex="-1" (click)="ws.settingsOpen.set(false)"></button>
      <div class="nb-dialog nb-settings" role="dialog" aria-label="Settings">
        <nav>
          @for (p of pages; track p; let i = $index) {
            <button [class.on]="ws.settingsPage() === i" (click)="ws.settingsPage.set(i)">{{ p }}</button>
          }
        </nav>
        <section>
          <button class="nb-iconbtn small close" title="Close (Esc)" (click)="ws.settingsOpen.set(false)"><nb-icon name="Close" /></button>
          @switch (ws.settingsPage()) {
            @case (0) {
              <h2>Appearance</h2>
              <div class="nb-row"><h3>Interface</h3><span class="nb-spacer"></span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>&lt;</kbd><span class="nb-muted">or</span><kbd>&gt;</kbd></div>
              <div class="nb-tiles">
                @for (s of scales; track s[0]; let i = $index) {
                  <div>
                    <button class="nb-tile scale" [attr.data-scale]="i" [class.on]="ws.prefs().scale === i" [style.--k]="[0.86, 1, 1.16][i]" (click)="ws.setScale(i)">
                      <b>Field notes</b><span>Small ideas grow into big projects when they have room to breathe.</span>
                      @if (ws.prefs().scale === i) { <nb-icon class="check" name="Check" /> }
                    </button>
                    <small class="nb-muted">{{ s[0] }}{{ i === 1 ? ' (Recommended)' : '' }}</small>
                  </div>
                }
              </div>
              <label class="nb-setting"><span><b>Display note headings in bold</b><small>Turn this off for lighter headings, which can read better in some languages.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().bold_headings" (change)="set({ bold_headings: $any($event.target).checked })" /></label>
              <hr />
              <div class="nb-row"><h3>Color scheme</h3><span class="nb-spacer"></span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>D</kbd></div>
              <div class="nb-tiles">
                @for (m of ['Light mode', 'Dark mode']; track m; let i = $index) {
                  <div>
                    <button class="nb-tile theme" [class.dark-tile]="i === 1" [attr.data-theme]="i" [class.on]="ws.dark() === (i === 1)" (click)="set({ theme: i === 1 ? 'Dark' : 'Light', manual_dark: i === 1 })">
                      <i class="h"></i><i class="t"></i><i class="n"></i><i class="b"></i>
                      @if (ws.dark() === (i === 1)) { <nb-icon class="check" name="Check" /> }
                    </button>
                    <small class="nb-muted">{{ m }}</small>
                  </div>
                }
              </div>
              <label class="nb-setting"><span><b>Match system theme</b><small>Use light or dark to match your computer's setting.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().theme === 'System'" (change)="system($any($event.target).checked)" /></label>
            }
            @case (1) {
              <h2>Preferences</h2>
              <label class="nb-setting"><span><b>Show the Unsorted drawer</b><small>Keep the drawer of unplaced cards open on the right. The choice is remembered.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().drawer_open" (change)="set({ drawer_open: $any($event.target).checked })" /></label>
              <label class="nb-setting"><span><b>Alignment guides</b><small>While you drag a card, line it up with the cards around it.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().guides" (change)="set({ guides: $any($event.target).checked })" /></label>
              <label class="nb-setting"><span><b>Snap to grid</b><small>Cards move in 8-point steps when no guide is showing.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().snap_grid" (change)="set({ snap_grid: $any($event.target).checked })" /></label>
              <label class="nb-setting"><span><b>Dot grid</b><small>Show the faint dots on the board.</small></span>
                <input type="checkbox" role="switch" [checked]="ws.prefs().show_grid" (change)="set({ show_grid: $any($event.target).checked })" /></label>
            }
            @case (2) {
              <h2>Language</h2>
              <p><b>Interface language</b><br /><span class="nb-muted">English. It's the only language this version comes in.</span></p>
              <p><b>Writing in other scripts</b><br /><span class="nb-muted">Tamil and other scripts use the fonts your system provides (Nirmala UI on Windows).</span></p>
              <p><b>Times</b><br /><span class="nb-muted">The trash shows how long ago things were deleted, such as "5 min ago".</span></p>
            }
            @case (3) {
              <h2>Toolbar options</h2>
              <p class="nb-muted">Choose which tools appear in the toolbar on the left. Trash always stays.</p>
              @for (t of tools; track t) {
                <label class="nb-setting"><span><b>{{ t }}</b>@if (unavailable.includes(t)) { <small>Not available in this version yet</small> }</span>
                  <input type="checkbox" role="switch" [checked]="!ws.prefs().hidden_tools.includes(t)" (change)="toggleTool(t, $any($event.target).checked)" /></label>
              }
            }
            @case (4) {
              <h2>Privacy &amp; data</h2>
              @if (ws.storageRemote) {
                <p>Your boards are saved to {{ ws.storageLabel }} under your account, and only you can open them. Export everything from your account page.</p>
              } @else {
                <p>Your boards are kept in {{ ws.storageLabel }}. Nothing is sent anywhere, and there's no account in this mode.</p>
              }
              <p class="nb-muted">{{ counts() }}</p>
              <h3>Bring in boards from the desktop app</h3>
              <p class="nb-muted">Choose <code>boards.json</code> from <code>%APPDATA%\\Noteboard</code> (and, if you like, the pictures in its <code>images</code> folder). You'll see what will be imported before anything changes; the desktop file is only read.</p>
              <div class="nb-row">
                <label class="nb-button">Choose boards.json<input type="file" accept=".json,application/json" hidden data-testid="import-file" (change)="pickImport($event)" /></label>
                <label class="nb-button">Add pictures<input type="file" accept="image/*" multiple hidden (change)="pickImages($event)" /></label>
                <span class="nb-muted">{{ images().length }} picture(s) chosen</span>
              </div>
              @if (report(); as r) {
                <div class="nb-report" data-testid="import-report">
                  <b>{{ r.ok ? 'Ready to import' : 'Can\\'t import this file' }}</b>
                  <p>{{ r.boards }} boards · {{ r.cards }} cards · {{ r.arrows }} lines · {{ r.trash }} in the trash · {{ r.images.length }} pictures (format {{ r.sourceVersion || 1 }})</p>
                  @for (i of r.issues; track $index) { <p [class.danger]="i.level === 'error'">{{ i.level === 'error' ? 'Problem' : 'Note' }}: {{ i.message }}</p> }
                  @if (r.ok) { <button class="nb-button primary" data-testid="import-apply" (click)="applyImport(r)">Import</button> }
                </div>
              }
              <h3>Keep a copy</h3>
              <div class="nb-row">
                <button class="nb-button" (click)="exportJson()">Download all boards (JSON)</button>
                <button class="nb-button" [disabled]="!ws.trash().length" (click)="ws.emptyTrash()">Empty trash ({{ ws.trash().length }})</button>
              </div>
            }
          }
        </section>
      </div>
    }
  `,
})
export class Settings {
  readonly ws = inject(Workspace);
  readonly pages = PAGES;
  readonly scales = SCALES;
  readonly tools = TOOLS.filter((t): t is Tool => t !== null);
  readonly unavailable = UNAVAILABLE;
  readonly report = signal<ImportReport | null>(null);
  readonly images = signal<File[]>([]);
  private importText = '';

  set(p: Partial<Prefs>): void {
    this.ws.setPrefs(p);
  }

  system(on: boolean): void {
    const p = this.ws.prefs();
    this.ws.setPrefs({ theme: on ? 'System' : p.manual_dark ? 'Dark' : 'Light' });
  }

  toggleTool(t: string, on: boolean): void {
    const hidden = this.ws.prefs().hidden_tools.filter((x) => x !== t);
    this.ws.setPrefs({ hidden_tools: on ? hidden : [...hidden, t] });
  }

  counts(): string {
    const s = this.ws.store();
    const boards = Object.values(s.boards);
    const cards = boards.reduce((n, b) => n + b.cards.length, 0);
    return `${boards.length} boards, ${cards} cards, ${s.trash.length} items in the trash`;
  }

  async pickImport(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.importText = await f.text();
    this.report.set(await this.ws.checkImport(this.importText, this.images()));
  }

  async pickImages(e: Event): Promise<void> {
    this.images.set([...((e.target as HTMLInputElement).files ?? [])]);
    if (this.importText) this.report.set(await this.ws.checkImport(this.importText, this.images()));
  }

  async applyImport(r: ImportReport): Promise<void> {
    const home = await this.ws.applyImport(r, this.images());
    this.report.set(null);
    this.importText = '';
    this.ws.settingsOpen.set(false);
    this.ws.openBoard(home);
    this.ws.showToast('Your desktop boards were imported');
  }

  exportJson(): void {
    const blob = new Blob([this.ws.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `noteboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
