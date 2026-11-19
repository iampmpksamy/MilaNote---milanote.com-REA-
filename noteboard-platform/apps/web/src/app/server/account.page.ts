/** The account page: name, password, two-step sign-in, devices, export and moving local boards in. */
import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { emptyStore, importDesktopStore, type ImportReport, type Store, type StoreWithImports, validateDesktopFile } from '@noteboard/board-model';
import { IndexedDbStorage } from '@noteboard/ui-workspace';
import { api, ServerApi } from './api';
import { message, MfaSetup } from './auth.pages';

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
}

@Component({
  selector: 'nb-account-page',
  imports: [FormsModule, RouterLink, MfaSetup, DatePipe],
  template: `
    <main class="nb-page">
      <header class="nb-page-head">
        <a routerLink="/" class="nb-btn" data-testid="back-to-boards">← Boards</a>
        <h1>Your account</h1>
        <span class="nb-spacer"></span>
        @if (api.isAdmin) {
          <a class="nb-btn" [routerLink]="adminPath">Admin panel</a>
        }
        <button class="nb-btn" data-testid="sign-out" (click)="signOut()">Sign out</button>
      </header>
      @if (notice()) {
        <p class="nb-notice" role="status">{{ notice() }}</p>
      }

      <section class="nb-panel">
        <h2>Profile</h2>
        <p class="nb-muted">{{ api.me()?.email }} · {{ roleName() }}</p>
        <form class="nb-inline" (ngSubmit)="saveName()">
          <label>Name<input name="name" [(ngModel)]="name" required /></label>
          <button class="nb-btn" type="submit">Save</button>
        </form>
      </section>

      <section class="nb-panel">
        <h2>Password</h2>
        <form (ngSubmit)="changePassword()">
          <label>Current password<input name="current" type="password" autocomplete="current-password" [(ngModel)]="current" /></label>
          <label>New password (10 characters or more)<input name="pw" type="password" autocomplete="new-password" [(ngModel)]="pw" required /></label>
          <label>New password again<input name="pw2" type="password" autocomplete="new-password" [(ngModel)]="pw2" required /></label>
          @if (pwError()) {
            <p class="nb-error" role="alert">{{ pwError() }}</p>
          }
          <button class="nb-btn" type="submit">Change password</button>
        </form>
      </section>

      <section class="nb-panel" id="security">
        <h2>Two-step sign-in</h2>
        @if (api.me()?.mfaEnabled) {
          <p>On. You're asked for a code from your authenticator app when you sign in.</p>
          <form class="nb-inline" (ngSubmit)="disableMfa()">
            <label>Password<input name="dpw" type="password" [(ngModel)]="dpw" /></label>
            <label>Code<input name="dcode" inputmode="numeric" [(ngModel)]="dcode" /></label>
            <button class="nb-btn danger" type="submit">Turn off</button>
          </form>
          @if (mfaError()) {
            <p class="nb-error">{{ mfaError() }}</p>
          }
        } @else {
          @if (api.isAdmin) {
            <p class="nb-warn">Administrators must turn this on before the admin panel opens.</p>
          }
          <nb-mfa-setup (done)="mfaDone()" />
        }
      </section>

      <section class="nb-panel">
        <h2>Signed-in devices</h2>
        <table class="nb-table">
          <thead><tr><th>Device</th><th>Address</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            @for (s of sessions(); track s.id) {
              <tr>
                <td>{{ shortAgent(s.userAgent) }} @if (s.current) { <b>(this one)</b> }</td>
                <td>{{ s.ip }}</td>
                <td>{{ s.lastSeenAt | date: 'medium' }}</td>
                <td>@if (!s.current) { <button class="nb-btn small" (click)="revoke(s.id)">Sign out</button> }</td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      <section class="nb-panel">
        <h2>Your data</h2>
        <p>Download everything in your account: <code>boards.json</code> (the desktop app's format), your preferences and every picture.</p>
        <a class="nb-btn" href="/api/v1/export" data-testid="export">Download export</a>
        @if (local(); as l) {
          <h3>Boards saved in this browser</h3>
          <p>This browser also has boards from before you had an account ({{ l.report.boards }} boards, {{ l.report.cards }} cards, {{ l.images.length }} pictures). Copy them into your account as one board under Home. Nothing in your account is replaced, and the browser copy stays.</p>
          @for (i of l.report.issues; track $index) {
            <p [class.nb-error]="i.level === 'error'">{{ i.message }}</p>
          }
          @if (l.report.ok && !l.report.alreadyImported) {
            <button class="nb-btn primary" data-testid="import-local" [disabled]="busy()" (click)="importLocal()">Copy into my account</button>
          }
        }
      </section>
    </main>
  `,
})
export class AccountPage implements OnInit {
  readonly api = inject(ServerApi);
  private readonly router = inject(Router);
  readonly sessions = signal<SessionRow[]>([]);
  readonly notice = signal('');
  readonly pwError = signal('');
  readonly mfaError = signal('');
  readonly busy = signal(false);
  readonly local = signal<{ report: ImportReport; text: string; images: string[]; storage: IndexedDbStorage } | null>(null);
  name = this.api.me()?.name ?? '';
  current = '';
  pw = '';
  pw2 = '';
  dpw = '';
  dcode = '';

  get adminPath() {
    return this.api.discovery()?.adminPath ?? '/admin';
  }

  roleName() {
    return { super_admin: 'Super administrator', admin: 'Administrator', user: 'Member' }[this.api.me()?.role ?? 'user'];
  }

  async ngOnInit() {
    await this.loadSessions();
    await this.checkLocal();
  }

  private async loadSessions() {
    this.sessions.set((await api<{ sessions: SessionRow[] }>('GET', '/me/sessions')).sessions);
  }

  private async checkLocal() {
    if (typeof indexedDB === 'undefined' || !(await indexedDB.databases?.())?.some((d) => d.name === 'noteboard-local')) return;
    const storage = new IndexedDbStorage('local');
    const { store } = await storage.load();
    if (!store || !Object.values(store.boards).some((b) => b.cards.length)) return;
    const text = JSON.stringify(store);
    const server = await api<{ store: StoreWithImports | null }>('GET', '/workspace');
    const images = await storage.listImages();
    const report = validateDesktopFile(text, server.store ?? undefined, new Set(images));
    this.local.set({ report, text, images, storage });
  }

  async importLocal() {
    const l = this.local();
    if (!l?.report.store) return;
    this.busy.set(true);
    try {
      const ws = await api<{ rev: number; store: StoreWithImports | null }>('GET', '/workspace');
      const target: StoreWithImports = ws.store ?? (emptyStore() as StoreWithImports);
      // Picture names get a prefix so they can't collide with pictures already in the account.
      const prefix = `local-${Date.now().toString(36)}-`;
      const rename = (s: Store) => {
        for (const b of Object.values(s.boards)) for (const c of b.cards) if ('Image' in c.content) c.content.Image.file = prefix + c.content.Image.file;
        for (const t of s.trash) for (const c of t.cards) if ('Image' in c.content) c.content.Image.file = prefix + c.content.Image.file;
      };
      rename(l.report.store);
      for (const name of l.images) {
        const url = await l.storage.imageUrl(name);
        if (!url) continue;
        const blob = await (await fetch(url)).blob();
        await api('PUT', `/assets/${encodeURIComponent(prefix + name)}`, undefined, { type: blob.type, data: blob });
      }
      importDesktopStore(target, l.report, 'From this browser');
      await api('PUT', '/workspace', { rev: ws.rev, store: target });
      await api('POST', '/workspace/imports', { source: 'browser-local', report: { fingerprint: l.report.fingerprint, boards: l.report.boards, cards: l.report.cards, images: l.images } });
      this.local.set(null);
      this.notice.set('Copied. Your browser boards are now in a board called "From this browser" on Home.');
    } catch (e) {
      this.notice.set(`The copy didn't finish: ${message(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  async saveName() {
    try {
      await api('PATCH', '/me', { name: this.name });
      await this.api.refreshMe();
      this.notice.set('Name saved.');
    } catch (e) {
      this.notice.set(message(e));
    }
  }

  async changePassword() {
    this.pwError.set('');
    if (this.pw !== this.pw2) {
      this.pwError.set('The two new passwords are different');
      return;
    }
    try {
      const r = await api<{ otherSessionsSignedOut: number }>('POST', '/me/password', { current: this.current, password: this.pw });
      this.current = this.pw = this.pw2 = '';
      this.notice.set(`Password changed. ${r.otherSessionsSignedOut} other device(s) were signed out.`);
      await this.loadSessions();
    } catch (e) {
      this.pwError.set(message(e));
    }
  }

  async disableMfa() {
    this.mfaError.set('');
    try {
      await api('POST', '/me/mfa/disable', { password: this.dpw, code: this.dcode });
      this.dpw = this.dcode = '';
      await this.api.refreshMe();
      this.notice.set('Two-step sign-in is off.');
    } catch (e) {
      this.mfaError.set(message(e));
    }
  }

  async mfaDone() {
    await this.api.refreshMe();
    this.notice.set('Two-step sign-in is on.');
  }

  async revoke(id: string) {
    await api('DELETE', `/me/sessions/${id}`);
    await this.loadSessions();
  }

  async signOut() {
    await this.api.logout();
    await this.router.navigateByUrl('/login');
  }

  shortAgent(ua: string) {
    const b = /(Edg|Chrome|Firefox|Safari)\/[\d.]+/.exec(ua)?.[1] ?? 'Browser';
    const os = /Windows|Android|iPhone|iPad|Mac OS X|Linux/.exec(ua)?.[0] ?? '';
    return `${b === 'Edg' ? 'Edge' : b}${os ? ` on ${os.replace('Mac OS X', 'macOS')}` : ''}`;
  }
}
