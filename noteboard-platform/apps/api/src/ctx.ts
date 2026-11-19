/** Everything a request handler needs, built once at start-up and shared. */
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config';
import { randomToken, safeEqual } from './crypto';
import type { AuditDoc, Database, UserDoc } from './db';
import type { Kv } from './kv';
import type { AppSecrets } from './secrets';
import { Accounts } from './services/accounts';
import { Backups } from './services/backups';
import type { BlobStore } from './services/blobs';
import { Mailer } from './services/mail';
import { Settings } from './services/settings';
import { Workspaces } from './services/workspaces';

export const CTX = Symbol('noteboard context');

export class Ctx {
  readonly settings: Settings;
  readonly accounts: Accounts;
  readonly workspaces: Workspaces;
  readonly backups: Backups;
  readonly mail = new Mailer();
  readonly startedAt = new Date();

  constructor(
    readonly cfg: Config,
    readonly secrets: AppSecrets,
    readonly d: Database,
    readonly kv: Kv,
    readonly blobs: BlobStore,
    readonly log: (m: string) => void,
  ) {
    this.settings = new Settings(d, cfg, secrets.encryptionKey);
    this.accounts = new Accounts(d, secrets.encryptionKey);
    this.workspaces = new Workspaces(d, blobs);
    this.backups = new Backups(d, cfg, kv, log);
  }

  async audit(action: string, p: { actor?: UserDoc | null; target?: string | null; ip?: string | null; details?: Record<string, unknown> } = {}) {
    const doc: AuditDoc = {
      at: new Date(),
      actorId: p.actor?._id ?? null,
      actorEmail: p.actor?.email ?? null,
      action,
      target: p.target ?? null,
      ip: p.ip ?? null,
      details: p.details ?? {},
    };
    await this.d.c.audit.insertOne(doc).catch((e) => this.log(`audit write failed: ${(e as Error).message}`));
  }

  // ---------- first-run setup token ----------

  private get tokenFile() {
    return path.join(this.cfg.dirs.config, 'setup-token.json');
  }

  /** The current one-time setup token, made (or replaced when expired) on demand. */
  setupToken(forceNew = false): { token: string; expiresAt: Date } {
    if (!forceNew && fs.existsSync(this.tokenFile)) {
      const t = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')) as { token: string; expiresAt: string };
      if (new Date(t.expiresAt) > new Date()) return { token: t.token, expiresAt: new Date(t.expiresAt) };
    }
    const token = randomToken(18);
    const expiresAt = new Date(Date.now() + this.cfg.setupTokenHours * 3600_000);
    fs.mkdirSync(this.cfg.dirs.config, { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify({ token, expiresAt: expiresAt.toISOString() }), { mode: 0o600 });
    return { token, expiresAt };
  }

  checkSetupToken(given: unknown): 'ok' | 'wrong' | 'expired' {
    if (!fs.existsSync(this.tokenFile)) return 'expired';
    const t = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')) as { token: string; expiresAt: string };
    if (new Date(t.expiresAt) <= new Date()) return 'expired';
    return typeof given === 'string' && safeEqual(given.trim(), t.token) ? 'ok' : 'wrong';
  }

  clearSetupToken() {
    fs.rmSync(this.tokenFile, { force: true });
  }

  async setupRequired(): Promise<boolean> {
    const s = await this.settings.get();
    return !s.setupCompletedAt;
  }

  /** The address to put in links: the configured public URL, else the address the request came to. */
  async baseUrl(fallbackOrigin: string): Promise<string> {
    return (await this.settings.get()).publicUrl || fallbackOrigin;
  }
}
