/**
 * The boards: the shared workspace, saving to the server account (server mode and the native apps)
 * or to this browser (local mode, when the page is served without a Noteboard server).
 */
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IndexedDbStorage, MemoryStorage, STORAGE, type StorageAdapter, WorkspaceView } from '@noteboard/ui-workspace';
import { openExternal, saveFile } from './native/platform';
import { ServerApi, ServerStorage } from './server/api';

function storageFor(server: ServerApi): StorageAdapter {
  if (server.mode() === 'server') return new ServerStorage(server.discovery()?.appName ?? 'Noteboard', server.draftKey());
  return typeof indexedDB !== 'undefined' ? new IndexedDbStorage('local') : new MemoryStorage();
}

@Component({
  selector: 'nb-boards-page',
  imports: [WorkspaceView, RouterLink],
  providers: [{ provide: STORAGE, useFactory: () => storageFor(inject(ServerApi)) }],
  template: `
    @if (loadError(); as err) {
      <main class="nb-auth">
        <section class="nb-auth-card" role="alert" data-testid="load-failed">
          <h1>Your boards didn't load</h1>
          <p>{{ err }}</p>
          <p class="nb-muted small">Nothing was changed. Your boards are safe on {{ server.server()?.url ?? 'the server' }}.</p>
          <button class="nb-btn primary wide" (click)="reload()">Try again</button>
          @if (server.native) {
            <a class="nb-btn wide" routerLink="/connect">Change server</a>
          }
        </section>
      </main>
    } @else {
      @if (banner(); as b) {
        <div class="nb-banner" role="alert" data-testid="banner">
          {{ b }}
          @if (conflict()) {
            <button class="nb-btn small" (click)="reload()">Reload</button>
          }
          @if (saveState() === 'retrying') {
            <button class="nb-btn small" (click)="retry()">Try now</button>
          }
          @if (stranded()) {
            <button class="nb-btn small" data-testid="draft-save" (click)="exportDraft()">Save my unsent changes as a file</button>
            <button class="nb-btn small" (click)="discardDraft()">Discard them</button>
          }
        </div>
      }
      <nb-workspace>
        @if (server.me(); as me) {
          <div nbHeaderEnd class="nb-account">
            <button class="nb-avatar" data-testid="account-menu" [attr.aria-expanded]="menu()" title="{{ me.name }} ({{ me.email }})" (click)="menu.set(!menu())">{{ initials() }}</button>
            @if (menu()) {
              <div class="nb-account-menu" role="menu">
                <p>
                  <b>{{ me.name }}</b><br /><small>{{ me.email }}</small>
                  @if (server.native) {
                    <br /><small class="nb-muted" data-testid="menu-server">{{ server.server()?.url }}</small>
                  }
                </p>
                <a role="menuitem" routerLink="/account" data-testid="menu-account">Your account</a>
                @if (server.isAdmin) {
                  @if (server.native) {
                    <button role="menuitem" data-testid="menu-admin" (click)="openAdmin()">Admin panel (opens the browser)</button>
                  } @else {
                    <a role="menuitem" [routerLink]="server.discovery()?.adminPath ?? '/admin'" data-testid="menu-admin">Admin panel</a>
                  }
                }
                @if (server.native) {
                  <a role="menuitem" routerLink="/connect" data-testid="menu-switch">Switch account or server</a>
                }
                <button role="menuitem" data-testid="menu-signout" (click)="signOut()">Sign out</button>
              </div>
            }
          </div>
        }
      </nb-workspace>
    }
  `,
})
export class BoardsPage {
  readonly server = inject(ServerApi);
  private readonly router = inject(Router);
  private readonly storage = inject(STORAGE);
  private readonly remote = this.storage instanceof ServerStorage ? this.storage : null;
  readonly menu = signal(false);
  readonly conflict = computed(() => this.remote?.conflict() ?? false);
  readonly saveState = computed(() => this.remote?.state() ?? 'saved');
  readonly stranded = computed(() => this.remote?.strandedDraft() ?? null);
  readonly loadError = computed(() => this.remote?.loadError() ?? '');
  readonly initials = computed(() =>
    (this.server.me()?.name ?? '?')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );
  readonly banner = computed(() => {
    if (this.server.tooOld()) return 'This server needs a newer version of the app. Reload the page; if this stays, update the app.';
    if (this.stranded() && !this.conflict())
      return 'Changes made on this device earlier could not be sent because your boards were changed somewhere else since. They are kept on this device.';
    if (this.conflict()) return 'Your boards were changed in another window or on another device. Reload to get the latest version before changing more. Your last change is kept on this device.';
    if (this.saveState() === 'retrying') return "Can't reach the server. Your changes are kept on this device and will be sent when it answers again.";
    if (this.saveState() === 'failed') return 'The server refused the last change. It is kept on this device; reload to continue.';
    const m = this.server.discovery()?.maintenance;
    if (m && this.server.me()?.role === 'user') return m.message || 'The server is in maintenance; saving is paused for a moment.';
    return '';
  });

  reload() {
    location.reload();
  }

  retry() {
    this.remote?.retryNow();
  }

  async exportDraft() {
    const d = this.stranded();
    if (!d) return;
    const name = `noteboard-unsent-${new Date(d.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    await saveFile(name, new Blob([d.next ?? d.body], { type: 'application/json' }));
  }

  async discardDraft() {
    if (confirm('Throw away the changes kept on this device? This cannot be undone.')) await this.remote?.discardDraft();
  }

  async openAdmin() {
    const base = this.server.server()?.url ?? '';
    await openExternal(`${base}${this.server.discovery()?.adminPath ?? '/admin'}`);
  }

  async signOut() {
    await this.server.logout();
    await this.router.navigateByUrl('/login');
  }
}
