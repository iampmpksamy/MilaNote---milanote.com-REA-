/**
 * Talks to the Noteboard server the page was loaded from (same origin, cookie session, CSRF
 * header). When no server answers (the page is served as plain files), the app runs in local mode
 * and keeps boards in this browser, as before.
 */
import { Injectable, signal } from '@angular/core';
import type { Store } from '@noteboard/board-model';
import type { Prefs, StorageAdapter } from '@noteboard/ui-workspace';

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

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown, raw?: { type: string; data: Blob }): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let payload: BodyInit | undefined;
  if (raw) {
    headers['Content-Type'] = raw.type || 'application/octet-stream';
    payload = raw.data;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let r: Response;
  try {
    r = await fetch(`/api/v1${url}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your connection.");
  }
  const type = r.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await r.json() : null;
  if (!r.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(r.status, e?.code ?? 'http_error', e?.message ?? `The server answered ${r.status}`, e?.details);
  }
  return data as T;
}

@Injectable({ providedIn: 'root' })
export class ServerApi {
  readonly mode = signal<'local' | 'server'>('local');
  readonly discovery = signal<Discovery | null>(null);
  readonly me = signal<Me | null>(null);
  readonly mfaPending = signal(false);
  /** Set when the server needs a newer client than this one. */
  readonly tooOld = signal(false);

  async init(): Promise<void> {
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

  async refreshDiscovery(): Promise<void> {
    this.discovery.set(await api<Discovery>('GET', '/discovery'));
  }

  async refreshMe(): Promise<Me | null> {
    const r = await api<{ user: Me | null; mfaPending?: boolean }>('GET', '/me');
    this.me.set(r.mfaPending ? null : r.user);
    this.mfaPending.set(!!r.mfaPending);
    return this.me();
  }

  async logout(): Promise<void> {
    await api('POST', '/auth/logout').catch(() => undefined);
    this.me.set(null);
  }

  get isAdmin(): boolean {
    const r = this.me()?.role;
    return r === 'admin' || r === 'super_admin';
  }
}

/** Saves boards to the signed-in account. Saves are queued so two never race each other. */
export class ServerStorage implements StorageAdapter {
  readonly label: string;
  readonly remote = true;
  private rev = 0;
  private latest: string | null = null;
  private inflight: Promise<void> | null = null;
  readonly conflict = signal(false);

  constructor(appName: string) {
    this.label = `your ${appName} server`;
  }

  async load(): Promise<{ store: Store | null; prefs: Prefs | null }> {
    const r = await api<{ rev: number; store: Store | null; prefs: Prefs | null }>('GET', '/workspace');
    this.rev = r.rev;
    return { store: r.store, prefs: r.prefs };
  }

  saveStore(store: Store): Promise<void> {
    if (this.conflict()) return Promise.reject(new ApiError(409, 'conflict', 'Changed elsewhere; reload'));
    this.latest = JSON.stringify(store);
    if (!this.inflight)
      this.inflight = this.flush().finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async flush(): Promise<void> {
    while (this.latest !== null) {
      const body = this.latest;
      this.latest = null;
      try {
        const r = await api<{ rev: number }>('PUT', '/workspace', { rev: this.rev, store: JSON.parse(body) });
        this.rev = r.rev;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) this.conflict.set(true);
        if (this.latest === null) this.latest = body;
        throw e;
      }
    }
  }

  async savePrefs(prefs: Prefs): Promise<void> {
    await api('PUT', '/workspace/prefs', { prefs });
  }

  async putImage(name: string, data: Blob): Promise<void> {
    await api('PUT', `/assets/${encodeURIComponent(name)}`, undefined, { type: data.type, data });
  }

  async imageUrl(name: string): Promise<string | null> {
    return `/api/v1/assets/${encodeURIComponent(name)}`;
  }

  async listImages(): Promise<string[]> {
    return (await api<{ names: string[] }>('GET', '/assets')).names;
  }
}
