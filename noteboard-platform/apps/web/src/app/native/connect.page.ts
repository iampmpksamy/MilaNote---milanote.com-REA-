/**
 * Native apps only: choose the Noteboard server (first launch), switch servers or accounts, and
 * see why the current server can't be used. Every server keeps its own accounts and tokens.
 */
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthFrame } from '../server/auth.pages';
import { ServerApi } from '../server/api';
import { httpAllowed } from './platform';
import { checkServer, type CheckResult, loadRegistry, normalizeUrl, type Registry, saveRegistry, SUGGESTED_SERVER, upsertServer } from './servers';

@Component({
  selector: 'nb-connect-page',
  imports: [AuthFrame, FormsModule],
  template: `
    <nb-auth-frame>
      <h1>{{ reg().servers.length ? 'Your servers' : 'Connect to your Noteboard' }}</h1>

      @if (api.unavailable(); as why) {
        <p class="nb-error" role="alert" data-testid="unavailable">{{ why }}</p>
        <button class="nb-btn wide" (click)="retry()">Try again</button>
      }

      @if (reg().servers.length) {
        <ul class="nb-server-list" data-testid="server-list">
          @for (s of reg().servers; track s.id) {
            <li [class.current]="s.id === reg().current">
              <div class="nb-server-head">
                <b>{{ s.appName }}</b>
                <small class="nb-muted">{{ s.url }} · {{ s.serverVersion }}</small>
                @if (s.url.startsWith('http:')) {
                  <small class="nb-warn">Not encrypted (development only)</small>
                }
              </div>
              @for (a of s.accounts; track a.key) {
                @if (a.key !== 'pending') {
                  <button class="nb-btn small" (click)="api.switchTo(s.id, a.key)" [attr.aria-current]="s.id === reg().current && a.key === s.activeAccount">
                    {{ a.name }} <small>{{ a.email }}</small>
                  </button>
                }
              }
              <div class="nb-row">
                <button class="nb-btn small" (click)="api.switchTo(s.id, 'pending')">{{ s.accounts.length ? 'Sign in with another account' : 'Sign in' }}</button>
                <button class="nb-btn small danger" (click)="forget(s.id)">Forget</button>
              </div>
            </li>
          }
        </ul>
        <h2>Add a server</h2>
      } @else {
        <p class="nb-muted">Enter the address of the Noteboard server you use (your home lab, through Cloudflare Tunnel, Tailscale or your own domain).</p>
      }

      <form (ngSubmit)="test()">
        <label
          >Server address
          <input name="url" data-testid="server-url" type="url" inputmode="url" autocapitalize="off" autocomplete="url" spellcheck="false" [(ngModel)]="url" (ngModelChange)="result.set(null)" required />
        </label>
        @if (insecure()) {
          <p class="nb-warn" role="alert" data-testid="insecure-warning">
            <b>Not encrypted.</b> This development build allows a plain http:// address on your own network. Passwords and boards travel unencrypted. Don't use it outside a trusted network.
          </p>
        }
        @if (error()) {
          <p class="nb-error" role="alert" data-testid="connect-error">{{ error() }}</p>
        }
        @if (result(); as r) {
          @if (r.ok) {
            <div class="nb-ok" data-testid="connect-ok">
              <b>{{ r.info.appName }}</b> · Noteboard {{ r.info.serverVersion }} · ready
              @for (n of r.notes; track n) {
                <br /><small>{{ n }}</small>
              }
            </div>
          }
        }
        <div class="nb-row">
          <button class="nb-btn wide" type="submit" data-testid="server-test" [disabled]="busy()">Test connection</button>
          <button class="nb-btn primary wide" type="button" data-testid="server-save" [disabled]="busy() || !result()?.ok" (click)="save()">Save and continue</button>
        </div>
      </form>
      @if (httpAllowedHere) {
        <p class="nb-muted small">Development build: plain http:// addresses are accepted with a warning.</p>
      }
    </nb-auth-frame>
  `,
})
export class ConnectPage implements OnInit {
  readonly api = inject(ServerApi);
  readonly reg = signal<Registry>({ servers: [], current: null });
  readonly result = signal<CheckResult | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly insecure = signal(false);
  readonly httpAllowedHere = httpAllowed();
  url = '';

  async ngOnInit() {
    this.reg.set(await loadRegistry());
    this.url = this.reg().servers.length ? '' : SUGGESTED_SERVER;
  }

  async test(): Promise<boolean> {
    this.error.set('');
    this.result.set(null);
    const n = normalizeUrl(this.url);
    this.insecure.set(!!n.insecure);
    if (n.error) {
      this.error.set(n.error);
      return false;
    }
    this.url = n.url;
    this.busy.set(true);
    try {
      const r = await checkServer(n.url);
      this.result.set(r);
      if (!r.ok) this.error.set(r.message);
      return r.ok;
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    const r = this.result();
    if (!r?.ok) return;
    const reg = await loadRegistry();
    const s = upsertServer(reg, this.url, r.info);
    s.activeAccount = s.accounts.find((a) => a.key !== 'pending')?.key ?? 'pending';
    await saveRegistry(reg);
    await this.api.switchTo(s.id, s.activeAccount);
  }

  async forget(id: string) {
    if (!confirm('Forget this server? You will be signed out of it on this device. Your boards stay on the server.')) return;
    await this.api.forgetServer(id);
    this.reg.set(await loadRegistry());
  }

  retry() {
    location.replace('/');
  }
}
