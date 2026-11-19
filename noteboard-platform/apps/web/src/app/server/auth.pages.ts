/** Sign-in, first-run setup, invitations, password links, e-mail confirmation and registration. */
import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import qrcode from 'qrcode-generator';
import { api, ApiError, ServerApi } from './api';


export function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
}

@Component({
  selector: 'nb-auth-frame',
  template: `
    <main class="nb-auth">
      <section class="nb-auth-card">
        <svg class="nb-auth-logo" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9.5" /><rect x="6.5" y="7" width="7" height="8" rx="1" /><path d="M13.5 7l2.5 2.5h-2.5z" /></svg>
        <p class="nb-auth-app">{{ api.discovery()?.appName ?? 'Noteboard' }}</p>
        <ng-content />
      </section>
    </main>
  `,
})
export class AuthFrame {
  readonly api = inject(ServerApi);
}

/** Two-step sign-in set-up: QR code, code check, recovery codes. Used by setup and the account page. */
@Component({
  selector: 'nb-mfa-setup',
  imports: [FormsModule],
  template: `
    @if (codes(); as list) {
      <p><b>Two-step sign-in is on.</b> Keep these recovery codes somewhere safe. Each works once if you lose your phone.</p>
      <pre class="nb-codes" data-testid="recovery-codes">{{ list.join('\n') }}</pre>
      <button class="nb-btn primary" (click)="done.emit()">I've saved them</button>
    } @else if (secret()) {
      <p>Scan this with an authenticator app (such as Aegis, 2FAS, Google Authenticator or 1Password), then type the 6-digit code it shows.</p>
      <img class="nb-qr" [src]="qr()" alt="QR code for your authenticator app" width="180" height="180" />
      <p class="nb-muted">Can't scan? Enter this key: <code data-testid="mfa-secret">{{ secret() }}</code></p>
      <form (ngSubmit)="enable()">
        <label>Code<input name="code" data-testid="mfa-code" inputmode="numeric" autocomplete="one-time-code" [(ngModel)]="code" required /></label>
        @if (error()) {
          <p class="nb-error" role="alert">{{ error() }}</p>
        }
        <button class="nb-btn primary" type="submit" [disabled]="busy()">Turn on</button>
      </form>
    } @else {
      <button class="nb-btn primary" data-testid="mfa-start" (click)="start()" [disabled]="busy()">Set up two-step sign-in</button>
      @if (error()) {
        <p class="nb-error" role="alert">{{ error() }}</p>
      }
    }
  `,
})
export class MfaSetup {
  readonly done = output<void>();
  readonly secret = signal('');
  readonly uri = signal('');
  readonly codes = signal<string[] | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  code = '';
  readonly qr = computed(() => {
    if (!this.uri()) return '';
    const q = qrcode(0, 'M');
    q.addData(this.uri());
    q.make();
    return q.createDataURL(5, 2);
  });

  async start() {
    this.busy.set(true);
    try {
      const r = await api<{ secret: string; uri: string }>('POST', '/me/mfa/setup');
      this.secret.set(r.secret);
      this.uri.set(r.uri);
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async enable() {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/me/mfa/enable', { code: this.code });
      this.codes.set(r.recoveryCodes);
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'nb-login-page',
  imports: [AuthFrame, FormsModule, RouterLink],
  template: `
    <nb-auth-frame>
      @if (step() === 'password') {
        <h1>Sign in</h1>
        <form (ngSubmit)="signIn()">
          <label>E-mail<input name="email" type="email" autocomplete="username" data-testid="login-email" [(ngModel)]="email" required /></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" data-testid="login-password" [(ngModel)]="password" required /></label>
          @if (error()) {
            <p class="nb-error" role="alert">{{ error() }}</p>
          }
          <button class="nb-btn primary wide" type="submit" data-testid="login-submit" [disabled]="busy()">Sign in</button>
        </form>
        <p class="nb-muted small">
          @if (api.discovery()?.features?.email) {
            <a routerLink="/forgot">Forgot your password?</a>
          } @else {
            Forgot your password? Ask your administrator for a reset link.
          }
        </p>
        @if (api.discovery()?.registration === 'open' || api.discovery()?.registration === 'approval') {
          <p class="nb-muted small">New here? <a routerLink="/register">Create an account</a></p>
        } @else if (!api.native) {
          <p class="nb-muted small">New here? Open the invitation link your administrator sent you.</p>
        }
        @if (api.native) {
          <form class="nb-link-paste" (ngSubmit)="openLink()">
            <label
              >Invitation or password link
              <input name="link" data-testid="paste-link" autocapitalize="off" spellcheck="false" placeholder="Paste the link you were sent" [(ngModel)]="link" />
            </label>
            <button class="nb-btn small" type="submit">Open</button>
          </form>
          <p class="nb-muted small" data-testid="login-server">
            Server: {{ api.server()?.url }} · <a routerLink="/connect">Change</a>
          </p>
        }
      } @else {
        <h1>Two-step sign-in</h1>
        <form (ngSubmit)="verify()">
          <label>Code from your authenticator app (or a recovery code)<input name="code" autocomplete="one-time-code" data-testid="login-code" [(ngModel)]="code" required /></label>
          @if (error()) {
            <p class="nb-error" role="alert">{{ error() }}</p>
          }
          <button class="nb-btn primary wide" type="submit" data-testid="login-code-submit" [disabled]="busy()">Continue</button>
        </form>
      }
    </nb-auth-frame>
  `,
})
export class LoginPage implements OnInit {
  readonly api = inject(ServerApi);
  private readonly router = inject(Router);
  readonly step = signal<'password' | 'code'>('password');
  readonly error = signal('');
  readonly busy = signal(false);
  email = '';
  password = '';
  code = '';

  ngOnInit() {
    if (this.api.mfaPending()) this.step.set('code');
  }

  async signIn() {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await api<{ mfaRequired: boolean }>('POST', '/auth/login', { email: this.email, password: this.password });
      this.password = '';
      if (r.mfaRequired) this.step.set('code');
      else await this.enter();
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    this.busy.set(true);
    this.error.set('');
    try {
      await api('POST', '/auth/mfa', { code: this.code });
      await this.enter();
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async enter() {
    await this.api.refreshMe();
    await this.router.navigateByUrl('/');
  }

  link = '';

  /** Apps: opens an invitation or password link inside the app, only if it is for this server. */
  async openLink() {
    this.error.set('');
    let u: URL;
    try {
      u = new URL(this.link.trim());
    } catch {
      this.error.set('Paste the whole link, starting with https://');
      return;
    }
    const server = this.api.server()?.url ?? '';
    const known = [server, this.api.discovery()?.publicUrl ?? ''].filter(Boolean).map((x) => new URL(x).origin);
    if (!known.includes(u.origin)) {
      this.error.set(`This link is for ${u.origin}, not ${server}. Add that server first (Change server).`);
      return;
    }
    const m = /^\/(invite|reset|verify)\/([A-Za-z0-9_-]{10,100})$/.exec(u.pathname);
    if (!m) {
      this.error.set("That isn't an invitation or password link.");
      return;
    }
    this.link = '';
    await this.router.navigateByUrl(`/${m[1]}/${m[2]}`);
  }
}

@Component({
  selector: 'nb-setup-page',
  imports: [AuthFrame, FormsModule, MfaSetup, RouterLink],
  template: `
    <nb-auth-frame>
      @switch (step()) {
        @case ('form') {
          <h1>Set up {{ api.discovery()?.appName ?? 'Noteboard' }}</h1>
          <p class="nb-muted">Create the super administrator account. You need the one-time setup token from the server.</p>
          <ul class="nb-checks" data-testid="setup-checks">
            @for (c of checks(); track c.id) {
              <li [class.bad]="!c.ok"><span>{{ c.ok ? '✓' : '✗' }}</span> <b>{{ c.label }}</b> — {{ c.message }}</li>
            }
          </ul>
          <form (ngSubmit)="create()">
            <label>Setup token<input name="token" data-testid="setup-token" autocomplete="off" [(ngModel)]="token" required /></label>
            <p class="nb-muted small">{{ tokenHelp() }}</p>
            <label>Your name<input name="name" data-testid="setup-name" autocomplete="name" [(ngModel)]="name" required /></label>
            <label>E-mail<input name="email" type="email" data-testid="setup-email" autocomplete="username" [(ngModel)]="email" required /></label>
            <label>Password (10 characters or more)<input name="password" type="password" data-testid="setup-password" autocomplete="new-password" [(ngModel)]="password" required /></label>
            <label>Password again<input name="password2" type="password" data-testid="setup-password2" autocomplete="new-password" [(ngModel)]="password2" required /></label>
            <label>Public address of this app<input name="publicUrl" data-testid="setup-url" [(ngModel)]="publicUrl" placeholder="https://notes.example.com" /></label>
            <p class="nb-muted small">Used in invitation and password links. Use the HTTPS address people will open (for example your Cloudflare hostname); you can change it later in the admin panel.</p>
            @if (error()) {
              <p class="nb-error" role="alert">{{ error() }}</p>
            }
            <button class="nb-btn primary wide" type="submit" data-testid="setup-submit" [disabled]="busy()">Create administrator</button>
          </form>
        }
        @case ('mfa') {
          <h1>Protect the administrator account</h1>
          <p class="nb-muted">The admin panel needs two-step sign-in. You can do this now or later from your account page.</p>
          <nb-mfa-setup (done)="finish()" />
          <p><button class="nb-btn link" data-testid="setup-skip-mfa" (click)="finish()">Later</button></p>
        }
        @case ('closed') {
          <h1>Already set up</h1>
          <p>This server has an administrator. <a routerLink="/login">Sign in</a></p>
        }
      }
    </nb-auth-frame>
  `,
})
export class SetupPage implements OnInit {
  readonly api = inject(ServerApi);
  private readonly router = inject(Router);
  readonly step = signal<'form' | 'mfa' | 'closed'>('form');
  readonly checks = signal<{ id: string; label: string; ok: boolean; message: string }[]>([]);
  readonly tokenHelp = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  token = '';
  name = '';
  email = '';
  password = '';
  password2 = '';
  publicUrl = '';

  async ngOnInit() {
    try {
      const s = await api<{ setupRequired: boolean; publicUrl: string | null; checks: never[]; tokenHelp: string }>('GET', '/setup/status');
      if (!s.setupRequired) {
        this.step.set('closed');
        return;
      }
      this.checks.set(s.checks);
      this.tokenHelp.set(s.tokenHelp);
      this.publicUrl = s.publicUrl ?? location.origin;
      this.token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    } catch (e) {
      this.error.set(message(e));
    }
  }

  async create() {
    this.error.set('');
    if (this.password !== this.password2) {
      this.error.set('The two passwords are different');
      return;
    }
    this.busy.set(true);
    try {
      await api('POST', '/setup', { token: this.token, name: this.name, email: this.email, password: this.password, passwordConfirm: this.password2, publicUrl: this.publicUrl });
      this.password = this.password2 = '';
      await this.api.refreshDiscovery();
      await this.api.refreshMe();
      this.step.set('mfa');
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async finish() {
    await this.api.refreshMe();
    await this.router.navigateByUrl('/');
  }
}

@Component({
  selector: 'nb-invite-page',
  imports: [AuthFrame, FormsModule, RouterLink],
  template: `
    <nb-auth-frame>
      @if (mode() === 'invite' && !invite() && !error()) {
        <p class="nb-muted">Checking the invitation…</p>
      } @else if (mode() === 'invite' && !invite()) {
        <h1>Invitation</h1>
        <p class="nb-error" role="alert">{{ error() }}</p>
      } @else if (result()) {
        <h1>Almost there</h1>
        <p>{{ result() }}</p>
        <a class="nb-btn" routerLink="/login">Back to sign-in</a>
      } @else {
        <h1>{{ mode() === 'invite' ? 'Create your account' : 'Create an account' }}</h1>
        @if (mode() === 'register' && api.discovery()?.registration === 'approval') {
          <p class="nb-muted">An administrator approves new accounts before they can sign in.</p>
        }
        <form (ngSubmit)="register()">
          <label>Your name<input name="name" data-testid="reg-name" autocomplete="name" [(ngModel)]="name" required /></label>
          <label>E-mail<input name="email" type="email" data-testid="reg-email" autocomplete="username" [(ngModel)]="email" [readonly]="!!invite()?.email" required /></label>
          <label>Password (10 characters or more)<input name="password" type="password" data-testid="reg-password" autocomplete="new-password" [(ngModel)]="password" required /></label>
          <label>Password again<input name="password2" type="password" data-testid="reg-password2" autocomplete="new-password" [(ngModel)]="password2" required /></label>
          @if (error()) {
            <p class="nb-error" role="alert">{{ error() }}</p>
          }
          <button class="nb-btn primary wide" type="submit" data-testid="reg-submit" [disabled]="busy()">Create account</button>
        </form>
      }
    </nb-auth-frame>
  `,
})
export class InvitePage implements OnInit {
  readonly api = inject(ServerApi);
  private readonly router = inject(Router);
  readonly token = input<string>('');
  readonly mode = signal<'invite' | 'register'>('invite');
  readonly invite = signal<{ email: string | null } | null>(null);
  readonly error = signal('');
  readonly result = signal('');
  readonly busy = signal(false);
  name = '';
  email = '';
  password = '';
  password2 = '';

  async ngOnInit() {
    if (!this.token()) {
      this.mode.set('register');
      return;
    }
    try {
      const i = await api<{ email: string | null }>('GET', `/auth/invite/${encodeURIComponent(this.token())}`);
      this.invite.set(i);
      this.email = i.email ?? '';
    } catch (e) {
      this.error.set(message(e));
    }
  }

  async register() {
    this.error.set('');
    if (this.password !== this.password2) {
      this.error.set('The two passwords are different');
      return;
    }
    this.busy.set(true);
    try {
      const r = await api<{ status: string }>('POST', '/auth/register', { invite: this.token() || undefined, name: this.name, email: this.email, password: this.password });
      if (r.status === 'active') {
        await this.api.refreshMe();
        await this.router.navigateByUrl('/');
      } else if (r.status === 'pending') this.result.set('Your account is waiting for an administrator to approve it.');
      else this.result.set('Check your e-mail and open the confirmation link to finish.');
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'nb-reset-page',
  imports: [AuthFrame, FormsModule, RouterLink],
  template: `
    <nb-auth-frame>
      @if (done()) {
        <h1>Password saved</h1>
        <p>You can sign in with your new password now. Other devices were signed out.</p>
        <a class="nb-btn primary" routerLink="/login" data-testid="reset-done">Sign in</a>
      } @else if (info()) {
        <h1>Choose a password</h1>
        <p class="nb-muted">For {{ info()!.email }}</p>
        <form (ngSubmit)="save()">
          <label>New password (10 characters or more)<input name="password" type="password" data-testid="reset-password" autocomplete="new-password" [(ngModel)]="password" required /></label>
          <label>Password again<input name="password2" type="password" data-testid="reset-password2" autocomplete="new-password" [(ngModel)]="password2" required /></label>
          @if (error()) {
            <p class="nb-error" role="alert">{{ error() }}</p>
          }
          <button class="nb-btn primary wide" type="submit" data-testid="reset-submit" [disabled]="busy()">Save password</button>
        </form>
      } @else {
        <h1>Password link</h1>
        <p [class.nb-error]="!!error()">{{ error() || 'Checking the link…' }}</p>
      }
    </nb-auth-frame>
  `,
})
export class ResetPage implements OnInit {
  readonly token = input<string>('');
  readonly info = signal<{ email: string } | null>(null);
  readonly error = signal('');
  readonly done = signal(false);
  readonly busy = signal(false);
  password = '';
  password2 = '';

  async ngOnInit() {
    try {
      this.info.set(await api<{ email: string }>('GET', `/auth/reset/${encodeURIComponent(this.token())}`));
    } catch (e) {
      this.error.set(message(e));
    }
  }

  async save() {
    this.error.set('');
    if (this.password !== this.password2) {
      this.error.set('The two passwords are different');
      return;
    }
    this.busy.set(true);
    try {
      await api('POST', '/auth/password/reset', { token: this.token(), password: this.password });
      this.done.set(true);
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'nb-forgot-page',
  imports: [AuthFrame, FormsModule, RouterLink],
  template: `
    <nb-auth-frame>
      <h1>Reset your password</h1>
      @if (sent()) {
        <p>If that address has an account, a link is on its way. It works for 2 hours.</p>
      } @else {
        <form (ngSubmit)="send()">
          <label>E-mail<input name="email" type="email" autocomplete="username" [(ngModel)]="email" required /></label>
          @if (error()) {
            <p class="nb-error" role="alert">{{ error() }}</p>
          }
          <button class="nb-btn primary wide" type="submit">Send link</button>
        </form>
      }
      <p class="nb-muted small"><a routerLink="/login">Back to sign-in</a></p>
    </nb-auth-frame>
  `,
})
export class ForgotPage {
  readonly sent = signal(false);
  readonly error = signal('');
  email = '';
  async send() {
    try {
      await api('POST', '/auth/password/forgot', { email: this.email });
      this.sent.set(true);
    } catch (e) {
      this.error.set(message(e));
    }
  }
}

@Component({
  selector: 'nb-verify-page',
  imports: [AuthFrame, RouterLink],
  template: `
    <nb-auth-frame>
      <h1>Confirm your e-mail</h1>
      <p [class.nb-error]="state() === 'bad'">{{ text() }}</p>
      <a class="nb-btn" routerLink="/login">Sign in</a>
    </nb-auth-frame>
  `,
})
export class VerifyPage implements OnInit {
  readonly token = input<string>('');
  readonly state = signal<'wait' | 'ok' | 'bad'>('wait');
  readonly text = computed(() => ({ wait: 'Checking…', ok: 'Thanks — your address is confirmed.', bad: 'This link is not valid any more.' })[this.state()]);
  async ngOnInit() {
    try {
      await api('POST', '/auth/verify', { token: this.token() });
      this.state.set('ok');
    } catch {
      this.state.set('bad');
    }
  }
}
