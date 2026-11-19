/** The administrator panel (served at /admin by default). Every number here comes from the server. */
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { api, ApiError, ServerApi } from './api';
import { message } from './auth.pages';

type Tab = 'overview' | 'users' | 'invitations' | 'settings' | 'backups' | 'audit' | 'health';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  quotaBytes: number | null;
  effectiveQuotaBytes: number;
  usage: { boards: number; cards: number; assets: number; assetBytes: number };
  sessions: number;
  source: string;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

@Component({
  selector: 'nb-admin-page',
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe],
  template: `
    <main class="nb-page wide">
      <header class="nb-page-head">
        <a routerLink="/" class="nb-btn">← Boards</a>
        <h1>Admin · {{ api.discovery()?.appName }}</h1>
        <span class="nb-spacer"></span>
        <a routerLink="/account" class="nb-btn">Your account</a>
      </header>
      @if (blocked(); as b) {
        <section class="nb-panel">
          <h2>{{ b.code === 'mfa_enrollment_required' ? 'Turn on two-step sign-in first' : 'Not available' }}</h2>
          <p>{{ b.message }}</p>
          @if (b.code === 'mfa_enrollment_required') {
            <a class="nb-btn primary" routerLink="/account" fragment="security" data-testid="go-mfa">Set it up on your account page</a>
          }
        </section>
      } @else {
        <nav class="nb-tabs" aria-label="Admin sections">
          @for (t of tabs; track t.id) {
            <button [class.on]="tab() === t.id" [attr.data-testid]="'tab-' + t.id" (click)="open(t.id)">{{ t.label }}</button>
          }
        </nav>
        @if (notice()) {
          <p class="nb-notice" role="status" data-testid="admin-notice">{{ notice() }}</p>
        }
        @if (link()) {
          <div class="nb-linkbox" data-testid="admin-link">
            <p>{{ link()!.title }} (works once, until {{ link()!.expiresAt | date: 'medium' }}). Copy it and send it yourself:</p>
            <input readonly [value]="link()!.url" (focus)="$any($event.target).select()" data-testid="admin-link-url" />
            <button class="nb-btn" (click)="copy(link()!.url)">Copy</button>
          </div>
        }
        @switch (tab()) {
          @case ('overview') {
            @if (ov(); as o) {
              <div class="nb-stats" data-testid="overview">
                <div><b>{{ o.users.byStatus.active ?? 0 }}</b><span>active accounts</span></div>
                <div><b>{{ (o.users.byStatus.pending ?? 0) + (o.users.byStatus.suspended ?? 0) }}</b><span>pending or suspended</span></div>
                <div><b>{{ o.users.activeSessions }}</b><span>signed-in sessions</span></div>
                <div><b>{{ o.content.boards | number }}</b><span>boards</span></div>
                <div><b>{{ o.content.cards | number }}</b><span>cards</span></div>
                <div><b>{{ bytes(o.content.assetBytes) }}</b><span>{{ o.content.assets }} pictures</span></div>
                <div><b>{{ bytes(o.database.storageBytes) }}</b><span>database (MongoDB {{ o.database.version }})</span></div>
                <div><b>{{ o.redis.used_memory_human ?? '—' }}</b><span>Redis {{ o.redis.redis_version }} memory</span></div>
                <div><b>{{ o.disk.uploads ? bytes(o.disk.uploads.free) : '—' }}</b><span>free for uploads</span></div>
                <div><b>{{ o.disk.backups ? bytes(o.disk.backups.free) : '—' }}</b><span>free for backups</span></div>
              </div>
              <dl class="nb-facts">
                <dt>Version</dt><dd>{{ o.server.version }} (database schema {{ o.server.schemaVersion }}, Node {{ o.server.node }})</dd>
                <dt>Running since</dt><dd>{{ o.server.startedAt | date: 'medium' }} · {{ o.server.memoryMb }} MB memory</dd>
                <dt>Public address</dt><dd>{{ o.server.publicUrl ?? 'not set' }}</dd>
                <dt>New accounts</dt><dd>{{ regName(o.server.registration) }}</dd>
                <dt>E-mail</dt><dd>{{ o.server.email ? 'on' : 'off — share invitation and reset links yourself' }}</dd>
                <dt>File storage</dt><dd>{{ o.server.storageDriver }}</dd>
                <dt>Last backup</dt><dd>{{ o.backups.last ? (o.backups.last.at | date: 'medium') + ' · ' + bytes(o.backups.last.size) : 'none yet' }}</dd>
                <dt>Next backup</dt><dd>{{ o.backups.nextScheduledAt ? (o.backups.nextScheduledAt | date: 'medium') : 'scheduled backups are off' }}</dd>
                <dt>Background worker</dt><dd>{{ o.worker.lastHeartbeat ? 'last seen ' + (o.worker.lastHeartbeat | date: 'mediumTime') : 'not seen' }}{{ o.worker.queued ? ' · ' + o.worker.queued + ' job(s) waiting' : '' }}</dd>
                <dt>Maintenance</dt><dd>{{ o.server.maintenance ? 'ON — members cannot save' : 'off' }}</dd>
              </dl>
            }
          }
          @case ('users') {
            <section class="nb-panel">
              <h2>Add an account</h2>
              <form class="nb-inline" (ngSubmit)="createUser()">
                <label>Name<input name="nu-name" data-testid="nu-name" [(ngModel)]="nu.name" required /></label>
                <label>E-mail<input name="nu-email" type="email" data-testid="nu-email" [(ngModel)]="nu.email" required /></label>
                <label>Role<select name="nu-role" [(ngModel)]="nu.role"><option value="user">Member</option>@if (isSuper()) {<option value="admin">Administrator</option>}</select></label>
                @if (api.discovery()?.features?.email) {
                  <label class="nb-check"><input type="checkbox" name="nu-send" [(ngModel)]="nu.send" /> E-mail the link</label>
                }
                <button class="nb-btn primary" type="submit" data-testid="nu-submit">Create</button>
              </form>
              <p class="nb-muted small">You'll get a single-use link for them to choose a password (valid 3 days).</p>
            </section>
            <input class="nb-search" placeholder="Search accounts" [(ngModel)]="q" (ngModelChange)="loadUsers()" />
            <table class="nb-table" data-testid="users">
              <thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Two-step</th><th>Boards · cards</th><th>Pictures</th><th>Last sign-in</th><th>Actions</th></tr></thead>
              <tbody>
                @for (u of users(); track u.id) {
                  <tr [attr.data-user]="u.email">
                    <td><b>{{ u.name }}</b><br /><small>{{ u.email }}</small></td>
                    <td>
                      @if (isSuper() && u.id !== api.me()?.id) {
                        <select [ngModel]="u.role" (ngModelChange)="patch(u, { role: $event })">
                          <option value="user">Member</option><option value="admin">Administrator</option><option value="super_admin">Super admin</option>
                        </select>
                      } @else {
                        {{ roleName(u.role) }}
                      }
                    </td>
                    <td [class.bad]="u.status !== 'active'">{{ u.status }}</td>
                    <td>{{ u.mfaEnabled ? 'on' : 'off' }}</td>
                    <td>{{ u.usage.boards }} · {{ u.usage.cards }}</td>
                    <td>{{ bytes(u.usage.assetBytes) }} / {{ u.effectiveQuotaBytes ? bytes(u.effectiveQuotaBytes) : 'no limit' }}</td>
                    <td>{{ u.lastLoginAt ? (u.lastLoginAt | date: 'short') : 'never' }}</td>
                    <td class="nb-actions">
                      @if (u.id !== api.me()?.id) {
                        @if (u.status === 'active') {
                          <button class="nb-btn small" data-testid="suspend" (click)="patch(u, { status: 'suspended' })">Suspend</button>
                        } @else {
                          <button class="nb-btn small" data-testid="activate" (click)="patch(u, { status: 'active' })">{{ u.status === 'pending' ? 'Approve' : 'Re-activate' }}</button>
                        }
                      }
                      <button class="nb-btn small" data-testid="reset-link" (click)="resetLink(u)">Password link</button>
                      <button class="nb-btn small" (click)="signOutUser(u)">Sign out ({{ u.sessions }})</button>
                      <button class="nb-btn small" (click)="quota(u)">Limit</button>
                      @if (isSuper() && u.mfaEnabled && u.id !== api.me()?.id) {
                        <button class="nb-btn small" (click)="mfaReset(u)">Reset two-step</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="nb-muted small">Administrators see usage numbers only. Nobody can open another person's boards from here.</p>
          }
          @case ('invitations') {
            <section class="nb-panel">
              <h2>Invite someone</h2>
              <form class="nb-inline" (ngSubmit)="invite()">
                <label>E-mail (optional)<input name="inv-email" type="email" data-testid="inv-email" [(ngModel)]="inv.email" /></label>
                <label>Role<select name="inv-role" [(ngModel)]="inv.role"><option value="user">Member</option>@if (isSuper()) {<option value="admin">Administrator</option>}</select></label>
                <label>Valid for<select name="inv-hours" [(ngModel)]="inv.hours"><option [ngValue]="24">1 day</option><option [ngValue]="72">3 days</option><option [ngValue]="168">7 days</option><option [ngValue]="336">14 days</option></select></label>
                @if (api.discovery()?.features?.email && inv.email) {
                  <label class="nb-check"><input type="checkbox" name="inv-send" [(ngModel)]="inv.send" /> E-mail it</label>
                }
                <button class="nb-btn primary" type="submit" data-testid="inv-submit">Create link</button>
              </form>
              <p class="nb-muted small">Each link creates one account and then stops working. Without an e-mail address anyone holding the link can use it, so send it privately.</p>
            </section>
            <table class="nb-table" data-testid="invitations">
              <thead><tr><th>For</th><th>Role</th><th>Created</th><th>Expires</th><th>State</th><th></th></tr></thead>
              <tbody>
                @for (i of invitations(); track i.id) {
                  <tr>
                    <td>{{ i.email ?? 'anyone with the link' }}</td><td>{{ roleName(i.role) }}</td><td>{{ i.createdAt | date: 'short' }}</td><td>{{ i.expiresAt | date: 'short' }}</td><td>{{ i.state }}</td>
                    <td>@if (i.state === 'open') { <button class="nb-btn small" (click)="revokeInvite(i.id)">Revoke</button> }</td>
                  </tr>
                }
              </tbody>
            </table>
          }
          @case ('settings') {
            @if (!isSuper()) {
              <p>Only the super administrator can change server settings.</p>
            } @else if (st(); as s) {
              <form class="nb-panel nb-settings" (ngSubmit)="saveSettings()">
                <h2>General</h2>
                <label>App name<input name="appName" data-testid="set-appName" [(ngModel)]="s.appName" /></label>
                <label>Public address<input name="publicUrl" [(ngModel)]="s.publicUrl" placeholder="https://notes.example.com" /></label>
                <label>New accounts
                  <select name="reg" data-testid="set-registration" [(ngModel)]="s.registrationMode">
                    <option value="invite">By invitation only (recommended)</option>
                    <option value="approval">Anyone can ask; an administrator approves</option>
                    <option value="open">Anyone can sign up</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label>Default storage limit per account (MB, 0 = none)<input name="quota" type="number" min="0" [(ngModel)]="quotaMb" /></label>
                <label>Accent colour<input name="accent" type="color" [(ngModel)]="s.branding.accent" /></label>
                <div class="nb-inline">
                  <label class="nb-btn">Upload logo<input type="file" accept="image/png,image/webp,image/jpeg" hidden (change)="upload('logo', $event)" /></label>
                  <label class="nb-btn">Upload favicon<input type="file" accept="image/png,image/x-icon" hidden (change)="upload('favicon', $event)" /></label>
                  @if (s.branding.logo) { <img src="/api/v1/branding/logo" alt="Current logo" height="32" /> }
                </div>
                <h2>Maintenance</h2>
                <label class="nb-check"><input type="checkbox" name="mt" [(ngModel)]="s.maintenance.enabled" /> Pause saving for members</label>
                <label>Message<input name="mtm" [(ngModel)]="s.maintenance.message" placeholder="Back in a few minutes" /></label>
                <h2>E-mail (optional)</h2>
                <label class="nb-check"><input type="checkbox" name="smtp-on" [(ngModel)]="s.smtp.enabled" /> Send e-mail (invitations, password resets, address checks)</label>
                <div class="nb-grid2">
                  <label>Server<input name="smtp-host" [(ngModel)]="s.smtp.host" placeholder="smtp.example.com" /></label>
                  <label>Port<input name="smtp-port" type="number" [(ngModel)]="s.smtp.port" /></label>
                  <label>User<input name="smtp-user" [(ngModel)]="s.smtp.user" autocomplete="off" /></label>
                  <label>Password<input name="smtp-pw" type="password" autocomplete="new-password" [(ngModel)]="smtpPassword" [placeholder]="s.smtp.passwordSet ? '•••••• (saved — leave empty to keep)' : ''" /></label>
                  <label>From<input name="smtp-from" [(ngModel)]="s.smtp.from" placeholder="Noteboard <notes@example.com>" /></label>
                  <label class="nb-check"><input type="checkbox" name="smtp-tls" [(ngModel)]="s.smtp.secure" /> TLS from the start (port 465)</label>
                </div>
                <button class="nb-btn" type="button" (click)="testEmail()">Send a test message to me</button>
                <h2>Backups</h2>
                <label class="nb-check"><input type="checkbox" name="b-on" [(ngModel)]="s.backup.enabled" /> Daily backup</label>
                <label>Time (server time zone)<input name="b-time" type="time" [(ngModel)]="s.backup.time" /></label>
                <div class="nb-grid2">
                  <label>Keep daily<input name="kd" type="number" min="0" [(ngModel)]="s.backup.retention.daily" /></label>
                  <label>Keep weekly<input name="kw" type="number" min="0" [(ngModel)]="s.backup.retention.weekly" /></label>
                  <label>Keep monthly<input name="km" type="number" min="0" [(ngModel)]="s.backup.retention.monthly" /></label>
                  <label>Keep manual<input name="kx" type="number" min="0" [(ngModel)]="s.backup.retention.manual" /></label>
                </div>
                @if (setErrors()) {
                  <p class="nb-error" role="alert">{{ setErrors() }}</p>
                }
                <button class="nb-btn primary" type="submit" data-testid="set-save">Save settings</button>
              </form>
            }
          }
          @case ('backups') {
            @if (!isSuper()) {
              <p>Only the super administrator can see and download backups.</p>
            } @else if (bk(); as b) {
              <section class="nb-panel">
                <p>Backups are kept in <code>{{ b.folder }}</code> on the server.
                  {{ b.schedule.enabled ? 'Daily at ' + b.schedule.time + ' (' + b.schedule.timeZone + '), next ' + (b.schedule.nextAt | date: 'medium') + '.' : 'Scheduled backups are off.' }}
                  Keeping {{ b.schedule.retention.daily }} daily, {{ b.schedule.retention.weekly }} weekly, {{ b.schedule.retention.monthly }} monthly and {{ b.schedule.retention.manual }} manual.</p>
                <p class="nb-warn">A backup on the same disk doesn't protect against that disk failing. Copy backups to another machine or cloud storage too (see the backup guide).</p>
                <button class="nb-btn primary" data-testid="backup-now" [disabled]="b.running" (click)="backupNow()">{{ b.running ? 'Backing up…' : 'Back up now' }}</button>
                <button class="nb-btn" (click)="loadBackups()">Refresh</button>
              </section>
              <table class="nb-table" data-testid="backups">
                <thead><tr><th>Backup</th><th>Kind</th><th>Size</th><th>Made</th><th></th></tr></thead>
                <tbody>
                  @for (f of b.files; track f.name) {
                    <tr><td><code>{{ f.name }}</code></td><td>{{ f.kind }}</td><td>{{ bytes(f.size) }}</td><td>{{ f.createdAt | date: 'medium' }}</td>
                      <td><a class="nb-btn small" [href]="'/api/v1/admin/backups/' + f.name + '/download'">Download</a></td></tr>
                  } @empty {
                    <tr><td colspan="5">No backups yet.</td></tr>
                  }
                </tbody>
              </table>
              @for (f of b.failures; track f._id) {
                <p class="nb-error">Failed {{ f.createdAt | date: 'medium' }}: {{ f.error }}</p>
              }
              <p class="nb-muted small">Restoring is done on the server's console on purpose: see the backup guide (<code>node cli.js restore … --confirm</code>).</p>
            }
          }
          @case ('audit') {
            <div class="nb-inline">
              <input class="nb-search" placeholder="Action starts with… (e.g. auth.)" [(ngModel)]="auditAction" (ngModelChange)="loadAudit()" />
            </div>
            <table class="nb-table" data-testid="audit">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>From</th></tr></thead>
              <tbody>
                @for (e of audit(); track e._id) {
                  <tr><td>{{ e.at | date: 'medium' }}</td><td>{{ e.actorEmail ?? 'system' }}</td><td>{{ e.action }}</td><td>{{ e.target ?? '' }}</td><td>{{ e.ip ?? '' }}</td></tr>
                }
              </tbody>
            </table>
            @if (audit().length === 100) {
              <button class="nb-btn" (click)="loadAudit(true)">Older</button>
            }
          }
          @case ('health') {
            <ul class="nb-checks" data-testid="health">
              @for (c of health(); track c.id) {
                <li [class.bad]="!c.ok"><span>{{ c.ok ? '✓' : '✗' }}</span> <b>{{ c.label }}</b> — {{ c.message }}</li>
              }
            </ul>
            <button class="nb-btn" (click)="loadHealth()">Check again</button>
          }
        }
      }
    </main>
  `,
})
export class AdminPage implements OnInit {
  readonly api = inject(ServerApi);
  readonly bytes = bytes;
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Accounts' },
    { id: 'invitations', label: 'Invitations' },
    { id: 'settings', label: 'Settings' },
    { id: 'backups', label: 'Backups' },
    { id: 'audit', label: 'Audit log' },
    { id: 'health', label: 'Health' },
  ];
  readonly tab = signal<Tab>('overview');
  readonly blocked = signal<{ code: string; message: string } | null>(null);
  readonly notice = signal('');
  readonly link = signal<{ title: string; url: string; expiresAt: string } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly ov = signal<any>(null);
  readonly users = signal<UserRow[]>([]);
  readonly invitations = signal<{ id: string; email: string | null; role: string; createdAt: string; expiresAt: string; state: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly st = signal<any>(null);
  readonly setErrors = signal('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly bk = signal<any>(null);
  readonly audit = signal<{ _id: string; at: string; actorEmail: string | null; action: string; target: string | null; ip: string | null }[]>([]);
  readonly health = signal<{ id: string; label: string; ok: boolean; message: string }[]>([]);
  readonly isSuper = computed(() => this.api.me()?.role === 'super_admin');
  nu = { name: '', email: '', role: 'user', send: false };
  inv = { email: '', role: 'user', hours: 72, send: false };
  q = '';
  quotaMb = 0;
  smtpPassword = '';
  auditAction = '';

  async ngOnInit() {
    await this.open('overview');
  }

  private async guard<T>(f: () => Promise<T>): Promise<T | undefined> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && (e.code === 'mfa_enrollment_required' || e.code === 'forbidden')) this.blocked.set({ code: e.code, message: e.message });
      else this.notice.set(message(e));
      return undefined;
    }
  }

  async open(t: Tab) {
    this.tab.set(t);
    this.link.set(null);
    this.notice.set('');
    if (t === 'overview') await this.guard(async () => this.ov.set(await api('GET', '/admin/overview')));
    if (t === 'users') await this.loadUsers();
    if (t === 'invitations') await this.loadInvites();
    if (t === 'settings' && this.isSuper()) await this.loadSettings();
    if (t === 'backups' && this.isSuper()) await this.loadBackups();
    if (t === 'audit') await this.loadAudit();
    if (t === 'health') await this.loadHealth();
  }

  roleName(r: string) {
    return ({ super_admin: 'Super admin', admin: 'Administrator', user: 'Member' } as Record<string, string>)[r] ?? r;
  }
  regName(r: string) {
    return ({ invite: 'by invitation', approval: 'sign-up with approval', open: 'open sign-up', closed: 'closed' } as Record<string, string>)[r] ?? r;
  }

  async loadUsers() {
    await this.guard(async () => this.users.set((await api<{ users: UserRow[] }>('GET', `/admin/users${this.q ? `?q=${encodeURIComponent(this.q)}` : ''}`)).users));
  }

  async createUser() {
    await this.guard(async () => {
      const r = await api<{ setPasswordLink: string | null; emailed: boolean }>('POST', '/admin/users', this.nu);
      if (r.setPasswordLink && !r.emailed)
        this.link.set({ title: `Password link for ${this.nu.email}`, url: r.setPasswordLink, expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString() });
      this.notice.set(r.emailed ? `Account created; the link was e-mailed to ${this.nu.email}.` : `Account created for ${this.nu.email}.`);
      this.nu = { name: '', email: '', role: 'user', send: false };
      await this.loadUsers();
    });
  }

  async patch(u: UserRow, body: Record<string, unknown>) {
    await this.guard(async () => {
      await api('PATCH', `/admin/users/${u.id}`, body);
      this.notice.set(`Updated ${u.email}.`);
      await this.loadUsers();
    });
  }

  async resetLink(u: UserRow) {
    await this.guard(async () => {
      const r = await api<{ link: string; expiresAt: string }>('POST', `/admin/users/${u.id}/reset-link`, { hours: 24 });
      this.link.set({ title: `Password link for ${u.email}`, url: r.link, expiresAt: r.expiresAt });
    });
  }

  async signOutUser(u: UserRow) {
    await this.guard(async () => {
      const r = await api<{ revoked: number }>('DELETE', `/admin/users/${u.id}/sessions`);
      this.notice.set(`Signed ${u.email} out of ${r.revoked} session(s).`);
      await this.loadUsers();
    });
  }

  async quota(u: UserRow) {
    const v = prompt(`Storage limit for ${u.email} in MB (0 = no limit, empty = server default)`, u.quotaBytes === null ? '' : String(Math.round(u.quotaBytes / 1048576)));
    if (v === null) return;
    await this.patch(u, { quotaBytes: v.trim() === '' ? null : Math.round(Number(v) * 1048576) });
  }

  async mfaReset(u: UserRow) {
    if (!confirm(`Turn off two-step sign-in for ${u.email}? They will be signed out everywhere.`)) return;
    await this.guard(async () => {
      await api('POST', `/admin/users/${u.id}/mfa-reset`);
      await this.loadUsers();
    });
  }

  async loadInvites() {
    await this.guard(async () => this.invitations.set((await api<{ invitations: never[] }>('GET', '/admin/invitations')).invitations));
  }

  async invite() {
    await this.guard(async () => {
      const r = await api<{ link: string; expiresAt: string; emailed: boolean }>('POST', '/admin/invitations', this.inv);
      if (!r.emailed) this.link.set({ title: `Invitation${this.inv.email ? ` for ${this.inv.email}` : ''}`, url: r.link, expiresAt: r.expiresAt });
      else this.notice.set(`Invitation e-mailed to ${this.inv.email}.`);
      this.inv = { email: '', role: 'user', hours: 72, send: false };
      await this.loadInvites();
    });
  }

  async revokeInvite(id: string) {
    await this.guard(async () => {
      await api('DELETE', `/admin/invitations/${id}`);
      await this.loadInvites();
    });
  }

  async loadSettings() {
    await this.guard(async () => {
      const r = await api<{ settings: { defaultQuotaBytes: number } }>('GET', '/admin/settings');
      this.st.set(r.settings);
      this.quotaMb = Math.round(r.settings.defaultQuotaBytes / 1048576);
    });
  }

  async saveSettings() {
    const s = this.st();
    this.setErrors.set('');
    try {
      await api('PATCH', '/admin/settings', {
        appName: s.appName,
        publicUrl: s.publicUrl,
        registrationMode: s.registrationMode,
        defaultQuotaBytes: Math.round(Number(this.quotaMb) * 1048576),
        maintenance: s.maintenance,
        branding: { accent: s.branding.accent },
        smtp: { enabled: s.smtp.enabled, host: s.smtp.host, port: Number(s.smtp.port), secure: s.smtp.secure, user: s.smtp.user, from: s.smtp.from, password: this.smtpPassword || undefined },
        backup: { enabled: s.backup.enabled, time: s.backup.time, retention: Object.fromEntries(Object.entries(s.backup.retention).map(([k, v]) => [k, Number(v)])) },
      });
      this.smtpPassword = '';
      await this.api.refreshDiscovery();
      await this.loadSettings();
      this.notice.set('Settings saved.');
    } catch (e) {
      const d = e instanceof ApiError && e.details && typeof e.details === 'object' ? Object.entries(e.details as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
      this.setErrors.set(`${message(e)}${d ? ` — ${d}` : ''}`);
    }
  }

  async upload(kind: 'logo' | 'favicon', ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    await this.guard(async () => {
      await api('PUT', `/admin/branding/${kind}`, undefined, { type: f.type, data: f });
      this.notice.set(`${kind === 'logo' ? 'Logo' : 'Favicon'} saved.`);
      await this.loadSettings();
    });
  }

  async testEmail() {
    await this.guard(async () => {
      const r = await api<{ sentTo: string }>('POST', '/admin/settings/email-test');
      this.notice.set(`Test message sent to ${r.sentTo}.`);
    });
  }

  async loadBackups() {
    await this.guard(async () => this.bk.set(await api('GET', '/admin/backups')));
  }

  async backupNow() {
    await this.guard(async () => {
      await api('POST', '/admin/backups');
      this.notice.set('Backup started. It appears in the list when it has finished.');
      setTimeout(() => void this.loadBackups(), 4000);
      await this.loadBackups();
    });
  }

  async loadAudit(older = false) {
    const before = older && this.audit().length ? `&before=${encodeURIComponent(this.audit()[this.audit().length - 1].at)}` : '';
    await this.guard(async () => {
      const r = await api<{ entries: never[] }>('GET', `/admin/audit?action=${encodeURIComponent(this.auditAction)}${before}`);
      this.audit.set(older ? [...this.audit(), ...r.entries] : r.entries);
    });
  }

  async loadHealth() {
    await this.guard(async () => this.health.set((await api<{ checks: never[] }>('GET', '/admin/health')).checks));
  }

  copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => this.notice.set('Copied.'));
  }
}
