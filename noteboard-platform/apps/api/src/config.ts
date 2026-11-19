/**
 * Server configuration, read once from the environment and checked before anything starts.
 * Infrastructure values (ports, paths, proxies) live here; values an administrator can change
 * later (name, public address, registration, SMTP) are only seeded from here on first start and
 * then kept in the database (see settings.ts).
 */
import path from 'node:path';

export const VERSION = process.env['NOTEBOARD_VERSION'] || '3.0.0-dev';
export const API_VERSION = 1;
export const MIN_CLIENT_API_VERSION = 1;

export type RegistrationMode = 'invite' | 'approval' | 'open' | 'closed';
export const REGISTRATION_MODES: RegistrationMode[] = ['invite', 'approval', 'open', 'closed'];

export interface Retention {
  daily: number;
  weekly: number;
  monthly: number;
  manual: number;
}

export interface Config {
  version: string;
  port: number;
  dataDir: string;
  dirs: { config: string; secrets: string; uploads: string; backups: string; logs: string };
  appName: string;
  accent: string;
  publicUrl: string;
  tz: string;
  registrationMode: RegistrationMode;
  adminPath: string;
  adminMfaRequired: boolean;
  cookieSecure: 'auto' | 'always' | 'never';
  trustedProxies: string[];
  maxUploadMb: number;
  storageDriver: 'local' | 's3';
  s3: { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string; forcePathStyle: boolean };
  smtp: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; from: string };
  backup: { time: string; retention: Retention };
  mongo: { host: string; port: number; replicaSet: string; db: string; url: string | null };
  redis: { host: string; port: number; url: string | null };
  setupTokenHours: number;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = env['NOTEBOARD_DATA'] || '/data';
  const configDir = env['NOTEBOARD_CONFIG_DIR'] || path.join(dataDir, 'config');
  const adminPath = '/' + (env['ADMIN_PATH'] || '/admin').replace(/^\/+|\/+$/g, '');
  return {
    version: VERSION,
    port: int(env['PORT'], 3000),
    dataDir,
    dirs: {
      config: configDir,
      secrets: env['NOTEBOARD_SECRETS_DIR'] || path.join(configDir, 'secrets'),
      uploads: env['NOTEBOARD_UPLOADS_DIR'] || path.join(dataDir, 'uploads'),
      backups: env['NOTEBOARD_BACKUPS_DIR'] || path.join(dataDir, 'backups'),
      logs: env['NOTEBOARD_LOGS_DIR'] || path.join(dataDir, 'logs'),
    },
    appName: (env['APP_NAME'] || 'Noteboard').trim(),
    accent: env['BRAND_ACCENT'] || '#2f6fed',
    publicUrl: (env['APP_PUBLIC_URL'] || env['PUBLIC_URL'] || '').trim().replace(/\/+$/, ''),
    tz: env['TZ'] || 'UTC',
    registrationMode: (env['REGISTRATION_MODE'] || 'invite') as RegistrationMode,
    adminPath,
    adminMfaRequired: bool(env['ADMIN_MFA_REQUIRED'], true),
    cookieSecure: (env['COOKIE_SECURE'] || 'auto') as Config['cookieSecure'],
    trustedProxies: (env['TRUSTED_PROXIES'] || 'loopback,linklocal,uniquelocal')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxUploadMb: int(env['MAX_UPLOAD_MB'], 25),
    storageDriver: (env['STORAGE_DRIVER'] || 'local') as Config['storageDriver'],
    s3: {
      endpoint: env['S3_ENDPOINT'] || '',
      region: env['S3_REGION'] || 'us-east-1',
      bucket: env['S3_BUCKET'] || '',
      accessKey: env['S3_ACCESS_KEY'] || '',
      secretKey: env['S3_SECRET_KEY'] || '',
      forcePathStyle: bool(env['S3_FORCE_PATH_STYLE'], true),
    },
    smtp: {
      enabled: bool(env['SMTP_ENABLED'], false),
      host: env['SMTP_HOST'] || '',
      port: int(env['SMTP_PORT'], 587),
      secure: bool(env['SMTP_SECURE'], false),
      user: env['SMTP_USER'] || '',
      password: env['SMTP_PASSWORD'] || '',
      from: env['SMTP_FROM'] || '',
    },
    backup: {
      time: env['BACKUP_TIME'] || '03:00',
      retention: {
        daily: int(env['BACKUP_KEEP_DAILY'], 7),
        weekly: int(env['BACKUP_KEEP_WEEKLY'], 4),
        monthly: int(env['BACKUP_KEEP_MONTHLY'], 6),
        manual: int(env['BACKUP_KEEP_MANUAL'], 10),
      },
    },
    mongo: {
      host: env['MONGO_HOST'] || 'noteboard-mongo',
      port: int(env['MONGO_PORT'], 27017),
      replicaSet: env['MONGO_REPLICA_SET'] || 'rs0',
      db: env['MONGO_DB'] || 'noteboard',
      url: env['MONGO_URL'] || null,
    },
    redis: { host: env['REDIS_HOST'] || 'noteboard-redis', port: int(env['REDIS_PORT'], 6379), url: env['REDIS_URL'] ?? null },
    setupTokenHours: int(env['SETUP_TOKEN_HOURS'], 24),
  };
}

/** Checks a public address: empty (not set yet) or an http(s) origin with an optional path. */
export function checkPublicUrl(u: string): string | null {
  if (!u) return null;
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    return 'APP_PUBLIC_URL is not a valid address (example: https://notes.example.com)';
  }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return 'APP_PUBLIC_URL must start with https:// or http://';
  if (p.username || p.password) return 'APP_PUBLIC_URL must not contain a user name or password';
  if (p.search || p.hash) return 'APP_PUBLIC_URL must not contain ? or #';
  return null;
}

export function validateConfig(c: Config): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) e.push('PORT must be 1-65535');
  if (!c.appName || c.appName.length > 60) e.push('APP_NAME must be 1-60 characters');
  if (!/^#[0-9a-fA-F]{6}$/.test(c.accent)) e.push('BRAND_ACCENT must be a colour like #2f6fed');
  const pu = checkPublicUrl(c.publicUrl);
  if (pu) e.push(pu);
  if (!REGISTRATION_MODES.includes(c.registrationMode)) e.push(`REGISTRATION_MODE must be one of ${REGISTRATION_MODES.join(', ')}`);
  if (!/^\/[a-z0-9-]{1,40}$/.test(c.adminPath) || ['/api', '/setup', '/login', '/invite', '/reset', '/account'].includes(c.adminPath))
    e.push('ADMIN_PATH must look like /admin (letters, digits, dashes) and not clash with app routes');
  if (!['auto', 'always', 'never'].includes(c.cookieSecure)) e.push('COOKIE_SECURE must be auto, always or never');
  if (!Number.isFinite(c.maxUploadMb) || c.maxUploadMb < 1 || c.maxUploadMb > 2048) e.push('MAX_UPLOAD_MB must be 1-2048');
  if (!['local', 's3'].includes(c.storageDriver)) e.push('STORAGE_DRIVER must be local or s3');
  if (c.storageDriver === 's3' && (!c.s3.endpoint || !c.s3.bucket || !c.s3.accessKey || !c.s3.secretKey))
    e.push('STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY');
  if (c.smtp.enabled && (!c.smtp.host || !c.smtp.from)) e.push('SMTP_ENABLED=true needs SMTP_HOST and SMTP_FROM');
  if (!Number.isInteger(c.smtp.port) || c.smtp.port < 1 || c.smtp.port > 65535) e.push('SMTP_PORT must be 1-65535');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.backup.time)) e.push('BACKUP_TIME must be HH:MM (24-hour)');
  for (const [k, v] of Object.entries(c.backup.retention))
    if (!Number.isInteger(v) || v < 0 || v > 365) e.push(`BACKUP_KEEP_${k.toUpperCase()} must be 0-365`);
  try {
    new Intl.DateTimeFormat('en', { timeZone: c.tz });
  } catch {
    e.push(`TZ "${c.tz}" is not a known time zone (example: Asia/Kolkata)`);
  }
  if (!Number.isInteger(c.setupTokenHours) || c.setupTokenHours < 1 || c.setupTokenHours > 168) e.push('SETUP_TOKEN_HOURS must be 1-168');
  return e;
}
