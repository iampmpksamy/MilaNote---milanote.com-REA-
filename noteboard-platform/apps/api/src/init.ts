/**
 * noteboard-init: runs once before the other services on every start (as root, then exits).
 * Checks the configuration and the data folders, sets their owners and permissions, and creates
 * the secrets the first time. It never overwrites existing secrets or data.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, validateConfig } from './config';
import { type AppSecrets, newSecrets, redisConf, secretsFile, writeFileAtomic } from './secrets';

const APP_UID = 1000;
const MONGO_UID = 999;
const REDIS_UID = 999;
const REDIS_GID = 1000;

// Filesystems MongoDB and Redis must not run on (statfs f_type).
const BAD_FS: Record<number, string> = {
  0x6969: 'NFS',
  0x517b: 'SMB',
  0xff534d42: 'CIFS/SMB',
  0xfe534d42: 'SMB2/3',
  0x65735546: 'FUSE (e.g. NTFS-3G or mergerfs)',
  0x01021997: '9p',
  0x4d44: 'FAT/vFAT',
  0x2011bab0: 'exFAT',
  0x794c7630: 'the container itself (overlay) — the folder is not mounted, so data would be lost',
};

const out = (m: string) => console.log(`[init] ${m}`);
const fail = (m: string): never => {
  console.error(`[init] PROBLEM: ${m}`);
  process.exit(1);
};

function prepare(dir: string, uid: number, gid: number, mode: number) {
  fs.mkdirSync(dir, { recursive: true });
  fs.chownSync(dir, uid, gid);
  fs.chmodSync(dir, mode);
}

function checkFs(dir: string, what: string, allow: boolean) {
  const st = fs.statfsSync(dir);
  const bad = BAD_FS[st.type >>> 0];
  if (!bad) return;
  const msg = `${what} (${dir}) is on ${bad}. Keep it on a local Linux filesystem such as ext4, XFS, Btrfs or ZFS.`;
  if (bad.startsWith('the container') || !allow) fail(`${msg}${bad.startsWith('the container') ? '' : ' (Set ALLOW_UNSUPPORTED_FS=true only if you accept the risk.)'}`);
  out(`warning: ${msg}`);
}

function isEmpty(dir: string) {
  return !fs.existsSync(dir) || fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length === 0;
}

function main() {
  const cfg = loadConfig();
  const errors = validateConfig(cfg);
  if (errors.length) fail(`the configuration has problems:\n - ${errors.join('\n - ')}`);
  if (process.getuid?.() !== 0) fail('noteboard-init must run as root (user: "0:0") to set folder owners; it changes nothing outside the data folders');
  const allow = /^(1|true|yes)$/i.test(process.env['ALLOW_UNSUPPORTED_FS'] ?? '');
  const dbDir = process.env['NOTEBOARD_DB_DIR'] || '/data/database';
  const redisDir = process.env['NOTEBOARD_REDIS_DIR'] || '/data/redis';

  // Database files need a local filesystem; uploads and backups may sit on a network share (warned).
  for (const [d, what, strict] of [
    [dbDir, 'The database folder', true],
    [redisDir, 'The Redis folder', true],
    [cfg.dirs.uploads, 'The uploads folder', false],
    [cfg.dirs.backups, 'The backups folder', false],
    [cfg.dirs.config, 'The config folder', true],
  ] as const) {
    fs.mkdirSync(d, { recursive: true });
    checkFs(d, what, strict ? allow : true);
  }

  prepare(cfg.dirs.config, APP_UID, APP_UID, 0o750);
  prepare(cfg.dirs.secrets, APP_UID, APP_UID, 0o711);
  prepare(dbDir, MONGO_UID, MONGO_UID, 0o700);
  prepare(redisDir, REDIS_UID, REDIS_GID, 0o700);
  prepare(cfg.dirs.uploads, APP_UID, APP_UID, 0o750);
  prepare(cfg.dirs.backups, APP_UID, APP_UID, 0o700);
  prepare(cfg.dirs.logs, APP_UID, APP_UID, 0o750);

  const file = secretsFile(cfg.dirs.secrets);
  let s: AppSecrets;
  if (fs.existsSync(file)) {
    s = JSON.parse(fs.readFileSync(file, 'utf8')) as AppSecrets;
    out('secrets found (kept as they are)');
  } else {
    if (!isEmpty(dbDir))
      fail(
        `the database folder ${dbDir} already has data but ${file} is missing. New passwords would not open the existing database. ` +
          'Put back the config/secrets folder from your copy or backup, or move the database folder away to start fresh.',
      );
    s = newSecrets();
    writeFileAtomic(file, JSON.stringify(s, null, 2), 0o400);
    out('created new secrets (database, Redis, session and encryption keys)');
  }
  fs.chownSync(file, APP_UID, APP_UID);
  fs.chmodSync(file, 0o400);

  // Files the database and Redis containers read; rewritten from the kept secrets each start.
  const rootPw = path.join(cfg.dirs.secrets, 'mongo-root-password');
  writeFileAtomic(rootPw, s.mongoRootPassword, 0o440);
  fs.chownSync(rootPw, APP_UID, MONGO_UID);
  const keyFile = path.join(cfg.dirs.secrets, 'mongo-keyfile');
  if (!fs.existsSync(keyFile)) writeFileAtomic(keyFile, crypto.randomBytes(756).toString('base64'), 0o400);
  fs.chownSync(keyFile, MONGO_UID, MONGO_UID);
  fs.chmodSync(keyFile, 0o400);
  const conf = path.join(cfg.dirs.secrets, 'redis.conf');
  writeFileAtomic(conf, redisConf(s.redisPassword), 0o400);
  fs.chownSync(conf, REDIS_UID, REDIS_GID);

  const tok = path.join(cfg.dirs.config, 'setup-token.json');
  if (fs.existsSync(tok)) fs.chownSync(tok, APP_UID, APP_UID);
  out(`ready: data folders checked and owned correctly; storage ${cfg.storageDriver}; public address ${cfg.publicUrl || '(not set)'}`);
}

main();
