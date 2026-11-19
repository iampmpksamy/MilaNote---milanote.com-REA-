/**
 * Talks to the Noteboard server.
 *
 * - Browser: the server the page was loaded from (same origin, cookie session, CSRF header). When
 *   no server answers (the page is served as plain files), the app runs in local mode and keeps
 *   boards in this browser, as before.
 * - Native apps (Android, iOS, Windows): the server the person chose (native/servers.ts), with
 *   bearer tokens (native/connection.ts). The UI is bundled in the app, never loaded from the server.
 */
import { Injectable, signal } from '@angular/core';
import { apiUrl, conn, type NativeTokens, TokenKeeper } from '../native/connection';
import { appLabel, isNative } from '../native/platform';
import { dropReplica, readReplica, replicaKeys } from '../native/replica';
import { checkServer, loadRegistry, type Registry, type SavedServer, saveRegistry } from '../native/servers';

export interface Discovery {
  product: 'noteboard';
  edition: string;
  apiVersion: number;
  minClientApiVersion: number;
  serverVersion: string;
  appName: string;
  publicUrl: string | null;
  adminPath: string;
  setupRequired: boolean;
  registration: 'invite' | 'approval' | 'open' | 'closed';
  features: { email: boolean; passwordReset: string; mfa: string; adminMfaRequired: boolean; maxUploadMb: number };
  branding: { accent: string; logo: boolean; favicon: boolean };
  maintenance: { message: string } | null;
  native?: { auth: string; accessMinutes: number; refreshDays: number };
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'user';
  status: string;
  mfaEnabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The API version this client speaks. */
export const CLIENT_API_VERSION = 1;

function csrfToken(): string {
  const m = /(?:^|;\s*)(?:__Host-)?nb_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

async function send(method: string, url: string, headers: Record<string, string>, payload: BodyInit | undefined): Promise<Response> {
  if (conn.native) {
    headers['X-Noteboard-Client'] = 'native';
    headers['X-Noteboard-App'] = appLabel();
    if (conn.tokens?.accessToken) headers['Authorization'] = `Bearer ${conn.tokens.accessToken}`;
  } else if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  try {
    return await fetch(apiUrl(url), { method, headers, body: payload, credentials: conn.native ? 'omit' : 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your connection.");
  }
}

/** Sends a request; native apps refresh an expired access token once and try again. */
async function request(method: string, url: string, body?: unknown, raw?: { type: string; data: Blob }): Promise<Response> {
  const make = () => {
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;
    if (raw) {
      headers['Content-Type'] = raw.type || 'application/octet-stream';
      payload = raw.data;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return send(method, url, headers, payload);
  };
  // Opened without a connection: no access token yet. Get one first (some answers, like /me,
  // would otherwise just say "nobody is signed in").
  if (conn.native && conn.tokens && !conn.tokens.hasAccess && conn.tokens.refreshValue && !url.startsWith('/native/')) await conn.tokens.refresh();
  let r = await make();
  if (r.status === 401 && conn.native && conn.tokens && !url.startsWith('/native/')) {
    const code = await r
      .clone()
      .json()
      .then((d: { error?: { code?: string } }) => d.error?.code)
      .catch(() => undefined);
    if ((code === 'token_expired' || (code === 'signed_out' && !conn.tokens.hasAccess)) && (await conn.tokens.refresh())) r = await make();
  }
  return r;
}

async function fail(r: Response): Promise<never> {
  const data = (r.headers.get('content-type') ?? '').includes('json') ? await r.json().catch(() => null) : null;
  const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
  throw new ApiError(r.status, e?.code ?? 'http_error', e?.message ?? `The server answered ${r.status}`, e?.details);
}

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown, raw?: { type: string; data: Blob }): Promise<T> {
  const r = await request(method, url, body, raw);
  if (!r.ok) return fail(r);
  const data = (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : null;
  // Native sign-in answers carry tokens (login, invitation, setup); keep them safe, never in the page.
  const tokens = (data as { tokens?: NativeTokens } | null)?.tokens;
  if (tokens && conn.native && conn.tokens) {
    await conn.tokens.set(tokens);
    delete (data as { tokens?: NativeTokens }).tokens;
  }
  return data as T;
}

/** Downloads something the signed-in account may read (export, pictures) as a Blob. */
export async function apiBlob(url: string): Promise<Blob> {
  const r = await request('GET', url);
  if (!r.ok) return fail(r);
  return r.blob();
}

@Injectable({ providedIn: 'root' })
export class ServerApi {
  readonly mode = signal<'local' | 'server'>('local');
  readonly discovery = signal<Discovery | null>(null);
  readonly me = signal<Me | null>(null);
  readonly mfaPending = signal(false);
  /** Set when the server needs a newer client than this one. */
  readonly tooOld = signal(false);
  /** Native apps: no server chosen yet. */
  readonly needsServer = signal(false);
  /** Native apps: the chosen server can't be used right now (why). */
  readonly unavailable = signal('');
  /** Native apps: the server in use. */
  readonly server = signal<SavedServer | null>(null);
  /** Native apps: opened without a connection, from the copy kept on this device. */
  readonly offline = signal(false);
  readonly native = isNative();

  async init(): Promise<void> {
    if (this.native) return this.initNative();
    try {
      const r = await fetch('/api/v1/discovery', { cache: 'no-store', credentials: 'same-origin' });
      const d = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as Discovery) : null;
      if (d?.product !== 'noteboard') return;
      this.discovery.set(d);
      this.mode.set('server');
      this.tooOld.set(d.minClientApiVersion > CLIENT_API_VERSION);
      document.title = d.appName;
      if (d.branding.favicon) document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', '/api/v1/branding/favicon');
      await this.refreshMe();
      if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    } catch {
      /* no server: local mode */
    }
  }

  // ---------- native apps ----------

  private async initNative(): Promise<void> {
    conn.native = true;
    this.mode.set('server');
    document.documentElement.classList.add('nb-native');
    const reg = await loadRegistry();
    const s = reg.servers.find((x) => x.id === reg.current);
    if (!s) {
      this.needsServer.set(true);
      return;
    }
    this.server.set(s);
    conn.base = s.url;
    const keeper = new TokenKeeper(s.id, s.activeAccount ?? 'pending', (rt) => this.refreshCall(rt));
    keeper.onSignedOut = () => this.me.set(null);
    conn.tokens = keeper;
    const check = await checkServer(s.url);
    if (!check.ok) {
      if (check.reason === 'unreachable' && (await this.openOffline(s, keeper))) return;
      this.unavailable.set(check.message);
      if (check.info) this.discovery.set(check.info as unknown as Discovery);
      return;
    }
    this.discovery.set(check.info as unknown as Discovery);
    void this.cacheInfo(s.id, check.info);
    this.tooOld.set(check.info.minClientApiVersion > CLIENT_API_VERSION);
    if (await keeper.load()) {
      try {
        if (await keeper.refresh()) await this.refreshMe();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) this.unavailable.set(e.message);
      }
    }
  }

  /**
   * No connection: open the boards from the copy kept on this device, as the account last signed
   * in here. Sync starts by itself when the server answers again (the token is refreshed then).
   */
  private async openOffline(s: SavedServer, keeper: TokenKeeper): Promise<boolean> {
    const acc = s.accounts.find((a) => a.key === s.activeAccount && a.key !== 'pending');
    if (!acc || !s.info || !(await readReplica(`${s.id}|${acc.key}`))?.local) return false;
    await keeper.load();
    this.discovery.set({ adminPath: '/admin', features: { email: false, passwordReset: 'admin-link', mfa: 'totp', adminMfaRequired: true, maxUploadMb: 25 }, branding: { accent: '#2f6fed', logo: false, favicon: false }, maintenance: null, registration: 'invite', ...(s.info as object), setupRequired: false } as unknown as Discovery);
    this.me.set({ id: acc.key, email: acc.email, name: acc.name, role: acc.role ?? 'user', status: 'active', mfaEnabled: false, hasPassword: true, createdAt: '', lastLoginAt: null });
    this.offline.set(true);
    // When the connection comes back, check the session (it may have been ended elsewhere).
    addEventListener('online', () => void this.refreshMe().then(() => this.offline.set(false)).catch(() => undefined), { once: true });
    return true;
  }

  private async cacheInfo(id: string, info: unknown): Promise<void> {
    const reg = await loadRegistry();
    const saved = reg.servers.find((x) => x.id === id);
    if (!saved) return;
    saved.info = info as SavedServer['info'];
    await saveRegistry(reg);
  }

  private async refreshCall(refreshToken: string): Promise<NativeTokens | null> {
    const r = await send('POST', '/native/refresh', { 'Content-Type': 'application/json' }, JSON.stringify({ refreshToken }));
    if (r.status === 401) return null;
    if (!r.ok) return fail(r);
    return ((await r.json()) as { tokens: NativeTokens }).tokens;
  }

  /** Remembers who is signed in on this server (native), filing the tokens under that account. */
  private async rememberAccount(me: Me): Promise<void> {
    const s = this.server();
    if (!s || !conn.tokens) return;
    await conn.tokens.rename(me.id);
    const reg = await loadRegistry();
    const saved = reg.servers.find((x) => x.id === s.id);
    if (!saved) return;
    saved.accounts = [...saved.accounts.filter((a) => a.key !== me.id && a.key !== 'pending'), { key: me.id, email: me.email, name: me.name, role: me.role }];
    saved.activeAccount = me.id;
    saved.lastUsed = Date.now();
    await saveRegistry(reg);
    this.server.set(saved);
  }

  /** Switches to another server or account (native). Reloads so nothing from the old one stays in memory. */
  async switchTo(serverId: string, account: string | null): Promise<void> {
    const reg = await loadRegistry();
    const s = reg.servers.find((x) => x.id === serverId);
    if (!s) return;
    reg.current = serverId;
    s.activeAccount = account;
    s.lastUsed = Date.now();
    await saveRegistry(reg);
    location.replace('/');
  }

  async forgetServer(serverId: string): Promise<void> {
    const reg: Registry = await loadRegistry();
    const s = reg.servers.find((x) => x.id === serverId);
    if (!s) return;
    for (const a of [...s.accounts.map((x) => x.key), 'pending']) {
      const k = new TokenKeeper(s.id, a, async () => null);
      // End the session on that server too (best effort), then forget the token here.
      if ((await k.load()) && k.refreshValue)
        await fetch(`${s.url}/api/v1/native/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Noteboard-Client': 'native' },
          body: JSON.stringify({ refreshToken: k.refreshValue }),
          credentials: 'omit',
        }).catch(() => undefined);
      await k.clear();
    }
    for (const k of await replicaKeys(`${s.id}|`)) await dropReplica(k);
    reg.servers = reg.servers.filter((x) => x.id !== serverId);
    if (reg.current === serverId) reg.current = reg.servers[0]?.id ?? null;
    await saveRegistry(reg);
  }

  // ---------- both ----------

  async refreshDiscovery(): Promise<void> {
    this.discovery.set(await api<Discovery>('GET', '/discovery'));
  }

  async refreshMe(): Promise<Me | null> {
    const r = await api<{ user: Me | null; mfaPending?: boolean }>('GET', '/me');
    this.me.set(r.mfaPending ? null : r.user);
    this.mfaPending.set(!!r.mfaPending);
    if (this.native && r.user && !r.mfaPending) await this.rememberAccount(r.user);
    return this.me();
  }

  async logout(): Promise<void> {
    // This account's boards and pictures kept on this device go too.
    if (this.me()) await dropReplica(this.draftKey());
    if (this.native) {
      const keeper = conn.tokens;
      await api('POST', '/native/logout', { refreshToken: keeper?.refreshValue ?? '' }).catch(() => undefined);
      await keeper?.clear();
      const me = this.me();
      const s = this.server();
      if (s && me) {
        const reg = await loadRegistry();
        const saved = reg.servers.find((x) => x.id === s.id);
        if (saved) {
          saved.accounts = saved.accounts.filter((a) => a.key !== me.id);
          saved.activeAccount = null;
          await saveRegistry(reg);
          this.server.set(saved);
        }
      }
      this.me.set(null);
      return;
    }
    await api('POST', '/auth/logout').catch(() => undefined);
    this.me.set(null);
  }

  get isAdmin(): boolean {
    const r = this.me()?.role;
    return r === 'admin' || r === 'super_admin';
  }

  /** Where this account's unsent changes are kept on this device. */
  draftKey(): string {
    return `${this.server()?.id ?? location.host}|${this.me()?.id ?? 'anon'}`;
  }
}
