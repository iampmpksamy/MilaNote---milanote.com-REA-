/**
 * The boards: the shared workspace, saving to the server account (server mode) or to this
 * browser (local mode, when the page is served without a Noteboard server).
 */
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IndexedDbStorage, MemoryStorage, STORAGE, type StorageAdapter, WorkspaceView } from '@noteboard/ui-workspace';
import { ServerApi, ServerStorage } from './server/api';

function storageFor(server: ServerApi): StorageAdapter {
  if (server.mode() === 'server') return new ServerStorage(server.discovery()?.appName ?? 'Noteboard');
  return typeof indexedDB !== 'undefined' ? new IndexedDbStorage('local') : new MemoryStorage();
}

@Component({
  selector: 'nb-boards-page',
  imports: [WorkspaceView, RouterLink],
  providers: [{ provide: STORAGE, useFactory: () => storageFor(inject(ServerApi)) }],
  template: `
    @if (banner(); as b) {
      <div class="nb-banner" role="alert" data-testid="banner">
        {{ b }}
        @if (conflict()) {
          <button class="nb-btn small" (click)="reload()">Reload</button>
        }
      </div>
    }
    <nb-workspace>
      @if (server.me(); as me) {
        <div nbHeaderEnd class="nb-account">
          <button class="nb-avatar" data-testid="account-menu" [attr.aria-expanded]="menu()" title="{{ me.name }} ({{ me.email }})" (click)="menu.set(!menu())">{{ initials() }}</button>
          @if (menu()) {
            <div class="nb-account-menu" role="menu">
              <p><b>{{ me.name }}</b><br /><small>{{ me.email }}</small></p>
              <a role="menuitem" routerLink="/account" data-testid="menu-account">Your account</a>
              @if (server.isAdmin) {
                <a role="menuitem" [routerLink]="server.discovery()?.adminPath ?? '/admin'" data-testid="menu-admin">Admin panel</a>
              }
              <button role="menuitem" data-testid="menu-signout" (click)="signOut()">Sign out</button>
            </div>
          }
        </div>
      }
    </nb-workspace>
  `,
})
export class BoardsPage {
  readonly server = inject(ServerApi);
  private readonly router = inject(Router);
  private readonly storage = inject(STORAGE);
  readonly menu = signal(false);
  readonly conflict = computed(() => (this.storage instanceof ServerStorage ? this.storage.conflict() : false));
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
    if (this.conflict()) return 'Your boards were changed in another window or on another device. Reload to get the latest version before changing more.';
    const m = this.server.discovery()?.maintenance;
    if (m && this.server.me()?.role === 'user') return m.message || 'The server is in maintenance; saving is paused for a moment.';
    return '';
  });

  reload() {
    location.reload();
  }

  async signOut() {
    await this.server.logout();
    await this.router.navigateByUrl('/login');
  }
}
