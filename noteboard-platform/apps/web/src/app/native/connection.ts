/**
 * Which server this app talks to and how it proves who it is.
 *
 * Browser: same origin, HttpOnly session cookie, CSRF header (unchanged).
 * Native apps: the chosen server's address, `X-Noteboard-Client: native` and a short-lived bearer
 * access token kept in memory; the refresh token sits in the system's protected storage under a
 * key that names the server and the account, so tokens never travel to another server.
 */
import { secretStore } from './platform';

export interface NativeTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  sessionId: string;
}

/** Key for a server+account's refresh token. `pending` holds a sign-in that hasn't named its account yet. */
export function tokenKey(serverId: string, account: string): string {
  return `rt.${serverId}.${account}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

export class TokenKeeper {
  private access: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  /** Called when the server ends the session (signed out elsewhere, revoked, reused). */
  onSignedOut: (() => void) | null = null;

  constructor(
    readonly serverId: string,
    private account: string,
    private readonly refreshCall: (refreshToken: string) => Promise<NativeTokens | null>,
  ) {}

  get hasAccess(): boolean {
    return !!this.access;
  }
  get accessToken(): string | null {
    return this.access;
  }
  get accountKey(): string {
    return this.account;
  }

  /** Reads the saved refresh token (if any) for this server and account. */
  async load(): Promise<boolean> {
    this.refreshToken = await (await secretStore()).get(tokenKey(this.serverId, this.account));
    return !!this.refreshToken;
  }

  async set(t: NativeTokens): Promise<void> {
    this.access = t.accessToken;
    this.refreshToken = t.refreshToken;
    await (await secretStore()).set(tokenKey(this.serverId, this.account), t.refreshToken);
  }

  /** Files a pending sign-in under the account it turned out to be. */
  async rename(account: string): Promise<void> {
    if (account === this.account) return;
    const s = await secretStore();
    await s.remove(tokenKey(this.serverId, this.account));
    this.account = account;
    if (this.refreshToken) await s.set(tokenKey(this.serverId, account), this.refreshToken);
  }

  /** Swaps the refresh token for new tokens; one refresh at a time. False when signed out. */
  refresh(): Promise<boolean> {
    if (!this.refreshToken) return Promise.resolve(false);
    this.refreshing ??= (async () => {
      try {
        const t = await this.refreshCall(this.refreshToken!);
        if (!t) {
          await this.clear();
          this.onSignedOut?.();
          return false;
        }
        await this.set(t);
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  get refreshValue(): string | null {
    return this.refreshToken;
  }

  async clear(): Promise<void> {
    this.access = null;
    this.refreshToken = null;
    await (await secretStore()).remove(tokenKey(this.serverId, this.account));
  }
}

export interface Connection {
  /** '' = same origin (browser). Otherwise the chosen server, e.g. https://notes.example.com */
  base: string;
  native: boolean;
  tokens: TokenKeeper | null;
}

export const conn: Connection = { base: '', native: false, tokens: null };

/** Full address of an API path on the current server. */
export const apiUrl = (path: string) => `${conn.base}/api/v1${path}`;
