/**
 * MongoDB: first-start bootstrap (replica set, application user), typed collections, indexes and
 * versioned migrations. Everything here is idempotent and safe to run on every start.
 */
import os from 'node:os';
import { Collection, Db, MongoClient, ObjectId } from 'mongodb';
import type { Arrow, Board, TrashItem } from '@noteboard/board-model';
import type { Config, RegistrationMode, Retention } from './config';
import type { AppSecrets } from './secrets';

export type Role = 'super_admin' | 'admin' | 'user';
export type UserStatus = 'active' | 'pending' | 'suspended';

export interface UserDoc {
  _id: string;
  email: string;
  emailLower: string;
  name: string;
  passwordHash: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  mfa: { enabled: boolean; secretEnc?: string; pendingSecretEnc?: string; recovery?: string[]; lastStep?: number };
  quotaBytes: number | null;
  source: 'setup' | 'admin' | 'invite' | 'register';
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  failedLogins: number;
  lockedUntil: Date | null;
}

export interface SessionDoc {
  _id: string; // sha256 of the cookie value (browser) or a random id (native app)
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string;
  userAgent: string;
  mfaPending: boolean;
  /** Native app sessions (bearer tokens); absent for browser cookie sessions. */
  native?: {
    client: string; // "android", "ios", "windows" + app version, shown on the account page
    accessHash: string; // sha256 of the current short-lived access token
    accessExpiresAt: Date;
    refreshHash: string; // sha256 of the current refresh token (rotated on every use)
    prevRefreshHash: string | null; // the one before: presenting it again means it was copied
  };
}

export interface TokenDoc {
  _id: string; // sha256 of the token
  kind: 'invite' | 'reset' | 'verify';
  email: string | null;
  userId: string | null;
  role: Role;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  note: string;
}

export interface WorkspaceDoc {
  _id: string;
  ownerId: string;
  name: string;
  rev: number;
  root: number;
  next_id: number;
  version: number;
  trash: TrashItem[];
  imports: unknown[];
  prefs: Record<string, unknown> | null;
  usage: { boards: number; cards: number; arrows: number; assets: number; assetBytes: number };
  /** The last save's client operation id and the revision it produced, so a retried save is acknowledged instead of refused. */
  lastOp?: { id: string; rev: number } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardDoc {
  _id: string; // `${workspaceId}:${boardId}`
  workspaceId: string;
  boardId: number;
  hash: string;
  data: Board;
  updatedAt: Date;
}

export interface AssetDoc {
  _id: string;
  workspaceId: string;
  name: string;
  key: string;
  size: number;
  mime: string;
  sha256: string;
  createdAt: Date;
}

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordEnc: string | null;
  from: string;
}

export interface SettingsDoc {
  _id: 'platform';
  appName: string;
  publicUrl: string;
  registrationMode: RegistrationMode;
  smtp: SmtpSettings;
  branding: { accent: string; logo: string | null; favicon: string | null };
  maintenance: { enabled: boolean; message: string };
  defaultQuotaBytes: number;
  backup: { enabled: boolean; time: string; retention: Retention };
  setupCompletedAt: Date | null;
  updatedAt: Date;
}

export interface AuditDoc {
  _id?: ObjectId;
  at: Date;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  details: Record<string, unknown>;
}

export interface BackupDoc {
  _id: string; // file name
  kind: 'scheduled' | 'manual' | 'pre-migration' | 'pre-restore';
  status: 'running' | 'ok' | 'failed';
  size: number;
  sha256: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  by: string | null;
  error: string | null;
  counts: Record<string, number>;
}

export interface MetaDoc {
  _id: string;
  [k: string]: unknown;
}

export interface Collections {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  tokens: Collection<TokenDoc>;
  workspaces: Collection<WorkspaceDoc>;
  boards: Collection<BoardDoc>;
  assets: Collection<AssetDoc>;
  settings: Collection<SettingsDoc>;
  audit: Collection<AuditDoc>;
  backups: Collection<BackupDoc>;
  meta: Collection<MetaDoc>;
}

/** Collections included in backups, in restore order. */
export const DATA_COLLECTIONS = ['settings', 'users', 'workspaces', 'boards', 'assets', 'tokens', 'audit', 'meta', 'backups'] as const;

export interface Database {
  client: MongoClient;
  db: Db;
  c: Collections;
  close(): Promise<void>;
}

export type Log = (msg: string) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

async function connectWithRetry(url: string, log: Log, what: string, seconds = 180): Promise<MongoClient> {
  const end = Date.now() + seconds * 1000;
  let lastErr: unknown;
  let n = 0;
  while (Date.now() < end) {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    try {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      return client;
    } catch (e) {
      lastErr = e;
      await client.close().catch(() => undefined);
      if (n++ % 6 === 0) log(`waiting for MongoDB (${what}): ${(e as Error).message}`);
      await sleep(2500);
    }
  }
  throw new Error(`MongoDB did not become reachable (${what}): ${(lastErr as Error)?.message}. Check that the noteboard-mongo container is running and healthy.`);
}

/**
 * Starts the single-member replica set and creates (or re-keys) the application user. Uses the
 * root account only for this, then connects as the application user.
 */
async function bootstrap(cfg: Config, s: AppSecrets, log: Log): Promise<void> {
  const { host, port, replicaSet, db } = cfg.mongo;
  const root = await connectWithRetry(
    `mongodb://${enc(s.mongoRootUser)}:${enc(s.mongoRootPassword)}@${host}:${port}/?authSource=admin&directConnection=true`,
    log,
    'root',
  );
  try {
    const admin = root.db('admin');
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch (e) {
      const code = (e as { codeName?: string }).codeName;
      if (code !== 'NotYetInitialized') throw e;
      log(`initiating replica set ${replicaSet}`);
      await admin.command({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `${host}:${port}` }] } });
    }
    for (let i = 0; i < 60; i++) {
      const hello = await admin.command({ hello: 1 });
      if (hello['isWritablePrimary']) break;
      await sleep(1000);
    }
    const target = root.db(db);
    const info = await target.command({ usersInfo: s.mongoAppUser });
    const roles = [
      { role: 'readWrite', db },
      { role: 'dbAdmin', db },
    ];
    if ((info['users'] as unknown[]).length === 0) {
      log(`creating database user ${s.mongoAppUser}`);
      await target.command({ createUser: s.mongoAppUser, pwd: s.mongoAppPassword, roles });
    } else {
      await target.command({ updateUser: s.mongoAppUser, pwd: s.mongoAppPassword, roles });
    }
  } finally {
    await root.close();
  }
}

export async function connectDatabase(cfg: Config, s: AppSecrets | null, log: Log, opts: { bootstrap: boolean }): Promise<Database> {
  let url: string;
  if (cfg.mongo.url) url = cfg.mongo.url;
  else {
    if (!s) throw new Error('secrets are required to reach MongoDB');
    if (opts.bootstrap) await bootstrap(cfg, s, log);
    const { host, port, replicaSet, db } = cfg.mongo;
    url = `mongodb://${enc(s.mongoAppUser)}:${enc(s.mongoAppPassword)}@${host}:${port}/${db}?replicaSet=${replicaSet}&authSource=${db}`;
  }
  const client = await connectWithRetry(url, log, 'application');
  const db = client.db(cfg.mongo.db);
  const c: Collections = {
    users: db.collection('users'),
    sessions: db.collection('sessions'),
    tokens: db.collection('tokens'),
    workspaces: db.collection('workspaces'),
    boards: db.collection('boards'),
    assets: db.collection('assets'),
    settings: db.collection('settings'),
    audit: db.collection('audit'),
    backups: db.collection('backups'),
    meta: db.collection('meta'),
  };
  return { client, db, c, close: () => client.close() };
}

// ---------- migrations ----------

export interface Migration {
  version: number;
  name: string;
  /** Changes stored data in a way older versions can't read: a backup is taken first. */
  breaking: boolean;
  up(d: Database): Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'collections and indexes',
    breaking: false,
    async up({ c }) {
      await c.users.createIndex({ emailLower: 1 }, { unique: true });
      await c.sessions.createIndex({ userId: 1 });
      await c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await c.tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
      await c.tokens.createIndex({ kind: 1, createdAt: -1 });
      await c.workspaces.createIndex({ ownerId: 1 }, { unique: true });
      await c.boards.createIndex({ workspaceId: 1, boardId: 1 }, { unique: true });
      await c.assets.createIndex({ workspaceId: 1, name: 1 }, { unique: true });
      await c.audit.createIndex({ at: -1 });
      await c.audit.createIndex({ actorId: 1, at: -1 });
      await c.backups.createIndex({ createdAt: -1 });
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function schemaVersion(d: Database): Promise<number> {
  const m = await d.c.meta.findOne({ _id: 'schema' });
  return (m?.['version'] as number) ?? 0;
}

/**
 * Runs pending migrations under a lock so two starting containers never migrate at once.
 * `beforeBreaking` is called (to take a backup) before the first breaking step on existing data.
 */
export async function migrate(d: Database, log: Log, beforeBreaking: (from: number) => Promise<void>): Promise<number> {
  const me = `${os.hostname()}:${process.pid}`;
  for (let i = 0; ; i++) {
    const now = new Date();
    try {
      await d.c.meta.updateOne(
        { _id: 'migration-lock', $or: [{ until: { $lt: now } }, { until: { $exists: false } }] },
        { $set: { until: new Date(now.getTime() + 10 * 60_000), by: me } },
        { upsert: true },
      );
      break;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || i > 120) throw e;
      if (i % 10 === 0) log('another container is migrating the database; waiting');
      await sleep(1000);
    }
  }
  try {
    let current = await schemaVersion(d);
    const fresh = current === 0 && (await d.c.users.estimatedDocumentCount()) === 0;
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      if (m.breaking && !fresh) {
        log(`migration ${m.version} changes stored data; taking a backup first`);
        await beforeBreaking(current);
      }
      log(`migration ${m.version}: ${m.name}`);
      await m.up(d);
      await d.c.meta.updateOne(
        { _id: 'schema' },
        { $set: { version: m.version, updatedAt: new Date() }, $push: { history: { version: m.version, name: m.name, at: new Date() } } as never },
        { upsert: true },
      );
      current = m.version;
    }
    if (current > SCHEMA_VERSION)
      log(`warning: the database (schema ${current}) is newer than this version of Noteboard (schema ${SCHEMA_VERSION}); restore a backup or upgrade the images`);
    return current;
  } finally {
    await d.c.meta.deleteOne({ _id: 'migration-lock', by: me });
  }
}

export type { Arrow };
