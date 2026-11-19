/**
 * Secrets made once by the init container and kept in DATA/config/secrets across upgrades.
 * Nothing here is ever regenerated if it already exists, and nothing is printed or served.
 *
 *   app-secrets.json      api/worker (uid 1000, 0400): database and Redis passwords, keys
 *   mongo-root-password   MongoDB's first-start root password (uid 1000 / gid 999, 0440)
 *   mongo-keyfile         replica-set key (uid 999, 0400)
 *   redis.conf            Redis config with its password (uid 999, 0400)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AppSecrets {
  createdAt: string;
  mongoAppUser: string;
  mongoAppPassword: string;
  mongoRootUser: string;
  mongoRootPassword: string;
  redisPassword: string;
  sessionSecret: string;
  /** AES-256-GCM key (base64) for TOTP secrets and the SMTP password stored in the database. */
  encryptionKey: string;
}

const rnd = (n: number) => crypto.randomBytes(n).toString('base64url');

export function newSecrets(): AppSecrets {
  return {
    createdAt: new Date().toISOString(),
    mongoAppUser: 'noteboard',
    mongoAppPassword: rnd(32),
    mongoRootUser: 'root',
    mongoRootPassword: rnd(32),
    redisPassword: rnd(32),
    sessionSecret: rnd(48),
    encryptionKey: crypto.randomBytes(32).toString('base64'),
  };
}

export const secretsFile = (dir: string) => path.join(dir, 'app-secrets.json');

export function readSecrets(dir: string): AppSecrets {
  const file = secretsFile(dir);
  if (!fs.existsSync(file))
    throw new Error(`Secrets not found at ${file}. The noteboard-init service creates them; check that it ran and that the config folder is mounted.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AppSecrets;
}

/** Overwrites a file atomically (write a temp file, then rename). */
export function writeFileAtomic(file: string, data: string | Buffer, mode: number): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, mode);
}

export function redisConf(password: string): string {
  return [
    '# Written by noteboard-init. Do not share this file.',
    `requirepass ${password}`,
    'appendonly yes',
    'appendfsync everysec',
    'save 900 1 300 10 60 10000',
    'dir /data',
    'protected-mode yes',
    'maxmemory-policy noeviction',
    '',
  ].join('\n');
}
