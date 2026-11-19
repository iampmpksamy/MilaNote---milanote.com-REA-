/**
 * The servers a native app knows: address, what the server said about itself, and the accounts
 * signed in there. Nothing secret is kept here (tokens live in protected storage, see connection.ts).
 */
import { httpAllowed, prefGet, prefSet } from './platform';

export interface SavedAccount {
  /** The user id on that server ("pending" while a two-step sign-in is unfinished). */
  key: string;
  email: string;
  name: string;
}

export interface SavedServer {
  id: string;
  url: string;
  appName: string;
  serverVersion: string;
  publicUrl: string | null;
  accounts: SavedAccount[];
  activeAccount: string | null;
  lastUsed: number;
}

export interface Registry {
  servers: SavedServer[];
  current: string | null;
}

/** Suggested on first launch; the person can change it. */
export const SUGGESTED_SERVER = 'https://notes.6dainas.cloud';

/** Oldest server API this app works with, and the native sign-in it needs. */
export const MIN_SERVER_API = 1;
export const CLIENT_API = 1;

const KEY = 'nb.servers.v1';

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await prefGet(KEY);
    const r = raw ? (JSON.parse(raw) as Registry) : null;
    if (r && Array.isArray(r.servers)) return r;
  } catch {
    /* start fresh */
  }
  return { servers: [], current: null };
}

export async function saveRegistry(r: Registry): Promise<void> {
  await prefSet(KEY, JSON.stringify(r));
}

export const serverId = (url: string) => url.toLowerCase().replace(/^https?:\/\//, (m) => (m.startsWith('https') ? 's_' : 'h_')).replace(/[^a-z0-9]/g, '_');

/** Cleans up what the person typed. Adds https:// when no scheme is given. */
export function normalizeUrl(input: string): { url: string; error?: string; insecure?: boolean } {
  let t = input.trim();
  if (!t) return { url: '', error: 'Enter the address of your Noteboard server' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `https://${t}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { url: '', error: 'That is not a valid address (example: https://notes.example.com)' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url: '', error: 'Use an https:// address' };
  if (/\s/.test(t) || !/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i.test(u.hostname))
    return { url: '', error: 'That is not a valid address (example: https://notes.example.com)' };
  if (u.username || u.password) return { url: '', error: 'Leave the user name and password out of the address' };
  if (u.search || u.hash) return { url: '', error: 'Use just the server address, without ? or #' };
  const url = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  if (u.protocol === 'http:') {
    if (!httpAllowed())
      return { url, error: 'This app only connects over https://. Put the server behind HTTPS (Cloudflare Tunnel, Tailscale HTTPS or a trusted certificate).' };
    return { url, insecure: true };
  }
  return { url };
}

export interface ServerInfo {
  product: string;
  apiVersion: number;
  minClientApiVersion: number;
  serverVersion: string;
  appName: string;
  publicUrl: string | null;
  setupRequired: boolean;
  native?: { auth: string };
  [k: string]: unknown;
}

export type CheckResult =
  | { ok: true; info: ServerInfo; notes: string[] }
  | { ok: false; reason: 'unreachable' | 'not_noteboard' | 'app_too_old' | 'server_too_old' | 'setup_required'; message: string; info?: ServerInfo };

/** Asks a server who it is (GET /api/v1/discovery) and whether this app can work with it. */
export async function checkServer(url: string, timeoutMs = 10_000): Promise<CheckResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let info: ServerInfo;
  try {
    const r = await fetch(`${url}/api/v1/discovery`, { headers: { 'X-Noteboard-Client': 'native' }, cache: 'no-store', credentials: 'omit', signal: ctl.signal });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.includes('json')) return { ok: false, reason: 'not_noteboard', message: `That address answered, but it is not a Noteboard server (HTTP ${r.status}).` };
    info = (await r.json()) as ServerInfo;
  } catch (e) {
    const timeout = (e as Error)?.name === 'AbortError';
    if (!timeout && (await answersWithoutAppAccess(url)))
      return {
        ok: false,
        reason: 'server_too_old',
        message:
          "The server answered, but it doesn't let the apps in yet (no native sign-in). Update the Noteboard server to 3.0.0-alpha.4 or newer; the browser keeps working meanwhile.",
      };
    return {
      ok: false,
      reason: 'unreachable',
      message: timeout
        ? 'The server did not answer in time. Check the address and your connection.'
        : "Can't reach the server. Check the address and your connection. The server needs a certificate this device trusts.",
    };
  } finally {
    clearTimeout(timer);
  }
  if (info?.product !== 'noteboard') return { ok: false, reason: 'not_noteboard', message: 'That address answered, but it is not a Noteboard server.' };
  if (info.minClientApiVersion > CLIENT_API) return { ok: false, reason: 'app_too_old', info, message: `This server (${info.serverVersion}) needs a newer version of the app. Update the app.` };
  if (info.apiVersion < MIN_SERVER_API || info.native?.auth !== 'bearer-v1')
    return { ok: false, reason: 'server_too_old', info, message: `This server (${info.serverVersion}) is too old for the apps. Update the server to 3.0.0-alpha.4 or newer.` };
  if (info.setupRequired)
    return { ok: false, reason: 'setup_required', info, message: `This server isn't set up yet. Open ${url}/setup in a browser to create the administrator, then come back.` };
  const notes: string[] = [];
  if (info.publicUrl && info.publicUrl.replace(/\/+$/, '') !== url) notes.push(`The server's public address is ${info.publicUrl}.`);
  return { ok: true, info, notes };
}

export function upsertServer(r: Registry, url: string, info: ServerInfo): SavedServer {
  const id = serverId(url);
  let s = r.servers.find((x) => x.id === id);
  if (!s) {
    s = { id, url, appName: info.appName, serverVersion: info.serverVersion, publicUrl: info.publicUrl, accounts: [], activeAccount: null, lastUsed: Date.now() };
    r.servers.push(s);
  }
  Object.assign(s, { url, appName: info.appName, serverVersion: info.serverVersion, publicUrl: info.publicUrl, lastUsed: Date.now() });
  r.current = id;
  return s;
}

/**
 * After a failed check: is something answering at that address, just without letting apps read
 * the answer (a Noteboard server older than 3.0.0-alpha.4 has no CORS for the apps)? A plain
 * request in `no-cors` mode succeeds whenever the server answers over a trusted connection, but
 * its content can't be read, so nothing from it is used except "it answered".
 */
async function answersWithoutAppAccess(url: string): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    await fetch(`${url}/api/v1/health`, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
