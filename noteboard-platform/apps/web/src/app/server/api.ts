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
import type { Store } from '@noteboard/board-model';
import type { Prefs, StorageAdapter } from '@noteboard/ui-workspace';
import { apiUrl, conn, type NativeTokens, TokenKeeper } from '../native/connection';
import { type Draft, dropDraft, getDraft, newOpId, putDraft } from '../native/drafts';
import { appLabel, isNative } from '../native/platform';
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
      this.unavailable.set(check.message);
      if (check.info) this.discovery.set(check.info as unknown as Discovery);
      return;
    }
    this.discovery.set(check.info as unknown as Discovery);
    this.tooOld.set(check.info.minClientApiVersion > CLIENT_API_VERSION);
    if (await keeper.load()) {
      try {
        if (await keeper.refresh()) await this.refreshMe();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) this.unavailable.set(e.message);
      }
    }
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
    saved.accounts = [...saved.accounts.filter((a) => a.key !== me.id && a.key !== 'pending'), { key: me.id, email: me.email, name: me.name }];
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

export type SaveState = 'saved' | 'saving' | 'retrying' | 'conflict' | 'failed';

/**
 * Saves boards to the signed-in account.
 *
 * - Saves are queued so two never race each other; only the newest state is sent.
 * - Each save carries the revision it was made on: the server refuses it (409) if someone saved
 *   in between, so a stale copy never overwrites newer boards.
 * - Each save carries an operation id: when an answer is lost and the save is sent again, the
 *   server acknowledges it instead of reporting a conflict.
 * - Until the server confirms a save, it is kept on this device (drafts.ts) and retried with
 *   growing pauses when the connection or the server fails.
 */
export class ServerStorage implements StorageAdapter {
  readonly label: string;
  readonly remote = true;
  private rev = 0;
  private latest: string | null = null;
  private inflight: Promise<void> | null = null;
  private pending: { body: string; opId: string; baseRev: number } | null = null;
  private attempts = 0;
  private readonly blobUrls = new Map<string, string>();
  readonly conflict = signal(false);
  readonly state = signal<SaveState>('saved');
  /** A change kept on this device that could not be sent because the boards changed elsewhere. */
  readonly strandedDraft = signal<Draft | null>(null);

  constructor(
    appName: string,
    private readonly draftKey = 'default',
  ) {
    this.label = `your ${appName} server`;
  }

  /** Why the boards could not be loaded (shown instead of the boards; nothing is saved). */
  readonly loadError = signal('');

  async load(): Promise<{ store: Store | null; prefs: Prefs | null }> {
    try {
      return await this.loadInner();
    } catch (e) {
      this.loadError.set(e instanceof ApiError ? e.message : 'Your boards could not be loaded.');
      throw e;
    }
  }

  private async loadInner(): Promise<{ store: Store | null; prefs: Prefs | null }> {
    const r = await api<{ rev: number; store: Store | null; prefs: Prefs | null }>('GET', '/workspace');
    this.rev = r.rev;
    let store = r.store;
    // A change saved on this device but not confirmed by the server last time.
    const d = await getDraft(this.draftKey);
    if (d) {
      if (d.baseRev === r.rev || d.baseRev + 1 === r.rev) {
        try {
          const done = await api<{ rev: number }>('PUT', '/workspace', { rev: d.baseRev, store: JSON.parse(d.body), opId: d.opId });
          this.rev = done.rev;
          store = JSON.parse(d.body) as Store;
          if (d.next) {
            const more = await api<{ rev: number }>('PUT', '/workspace', { rev: this.rev, store: JSON.parse(d.next), opId: newOpId() });
            this.rev = more.rev;
            store = JSON.parse(d.next) as Store;
          }
          await dropDraft(this.draftKey);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) this.strandedDraft.set(d);
          else throw e;
        }
      } else this.strandedDraft.set(d);
    }
    return { store, prefs: r.prefs };
  }

  /** Throws the kept change away (after the person saved it as a file or decided against it). */
  async discardDraft(): Promise<void> {
    await dropDraft(this.draftKey);
    this.strandedDraft.set(null);
  }

  saveStore(store: Store): Promise<void> {
    if (this.conflict()) return Promise.reject(new ApiError(409, 'conflict', 'Changed elsewhere; reload'));
    this.latest = JSON.stringify(store);
    if (this.pending) void putDraft(this.draftKey, { ...this.pending, next: this.latest, at: Date.now() });
    this.wake?.();
    if (!this.inflight)
      this.inflight = this.flush().finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Sends saves until the server has the newest state. Waits and tries again while it can't be reached. */
  private async flush(): Promise<void> {
    while (this.latest !== null || this.pending) {
      if (!this.pending) {
        // A save that was sent but not confirmed is repeated as is (same operation id) until the
        // server answers, so it can't conflict with itself; newer edits follow it.
        this.pending = { body: this.latest!, opId: newOpId(), baseRev: this.rev };
        this.latest = null;
        await putDraft(this.draftKey, { ...this.pending, at: Date.now() });
      }
      const p = this.pending;
      this.state.set(this.attempts ? 'retrying' : 'saving');
      try {
        const r = await api<{ rev: number }>('PUT', '/workspace', { rev: p.baseRev, store: JSON.parse(p.body), opId: p.opId });
        this.rev = r.rev;
        this.pending = null;
        this.attempts = 0;
        if (this.latest === null) await dropDraft(this.draftKey);
        this.state.set('saved');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          this.conflict.set(true);
          this.state.set('conflict');
          this.strandedDraft.set({ ...p, at: Date.now() });
          this.pending = null;
          throw e;
        }
        const transient = e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);
        if (!transient) {
          // Refused for good (invalid, signed out, over quota): the draft stays on this device.
          this.state.set('failed');
          this.pending = null;
          throw e;
        }
        this.state.set('retrying');
        await this.pause();
      }
    }
  }

  private wake: (() => void) | null = null;

  /** Waits 2 s, 5 s, 10 s … 60 s between attempts; a new edit or `retryNow()` cuts the wait short. */
  private pause(): Promise<void> {
    const waits = [2, 5, 10, 20, 30, 60];
    const s = waits[Math.min(this.attempts++, waits.length - 1)];
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
      const t = setTimeout(done, s * 1000);
      this.wake = done;
    });
  }

  retryNow(): void {
    this.wake?.();
  }

  async savePrefs(prefs: Prefs): Promise<void> {
    await api('PUT', '/workspace/prefs', { prefs });
  }

  async putImage(name: string, data: Blob): Promise<void> {
    await api('PUT', `/assets/${encodeURIComponent(name)}`, undefined, { type: data.type, data });
    const old = this.blobUrls.get(name);
    if (old) {
      URL.revokeObjectURL(old);
      this.blobUrls.delete(name);
    }
  }

  async imageUrl(name: string): Promise<string | null> {
    if (!conn.native) return `/api/v1/assets/${encodeURIComponent(name)}`;
    // Apps can't put a token on <img src>, so pictures are fetched with it and shown from memory.
    const have = this.blobUrls.get(name);
    if (have) return have;
    try {
      const url = URL.createObjectURL(await apiBlob(`/assets/${encodeURIComponent(name)}`));
      this.blobUrls.set(name, url);
      return url;
    } catch {
      return null;
    }
  }

  async listImages(): Promise<string[]> {
    return (await api<{ names: string[] }>('GET', '/assets')).names;
  }
}
