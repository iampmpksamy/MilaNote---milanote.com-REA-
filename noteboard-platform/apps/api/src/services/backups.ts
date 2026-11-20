/**
 * Backups: one .tar.gz holding every database collection (MongoDB Extended JSON, one document per
 * line), the uploaded files, the keys needed to read encrypted fields, and a manifest.
 * Files are written owner-only (0600) to DATA/backups and are never served without a super
 * administrator's session. Restoring is a deliberate command-line step (see cli.ts).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BSON } from 'mongodb';
import type { Config, Retention } from '../config';
import { sha256 } from '../crypto';
import { type BackupDoc, type Database, DATA_COLLECTIONS, SCHEMA_VERSION, schemaVersion } from '../db';
import type { Kv } from '../kv';
import { type AppSecrets, readSecrets, secretsFile, writeFileAtomic } from '../secrets';
import { readTarGz, TarWriter } from './tar';
import { pipeline } from 'node:stream/promises';

export const BACKUP_RE = /^noteboard-backup-(\d{8})-(\d{6})-(scheduled|manual|pre-migration|pre-restore)\.tar\.gz$/;

export interface BackupInfo {
  name: string;
  kind: BackupDoc['kind'];
  createdAt: Date;
  size: number;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function listBackupFiles(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = BACKUP_RE.exec(name);
    if (!m) continue;
    const [, d, t, kind] = m;
    const createdAt = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`);
    out.push({ name, kind: kind as BackupDoc['kind'], createdAt, size: fs.statSync(path.join(dir, name)).size });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Which backups to delete. Scheduled backups follow daily/weekly/monthly retention (the newest in
 * each of the last N days, ISO weeks and months is kept); manual ones keep the newest `manual`;
 * safety backups taken before migrations or restores keep the newest 5.
 */
export function backupsToDelete(list: BackupInfo[], r: Retention, tz: string): string[] {
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d);
  const dayKey = (d: Date) => fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const monthKey = (d: Date) => fmt(d, { year: 'numeric', month: '2-digit' });
  const weekKey = (d: Date) => {
    const [y, m, dd] = dayKey(d).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    const dow = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dow + 3);
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return `${t.getUTCFullYear()}-W${week}`;
  };
  const keep = new Set<string>();
  const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const scheduled = sorted.filter((b) => b.kind === 'scheduled');
  for (const [n, key] of [
    [r.daily, dayKey],
    [r.weekly, weekKey],
    [r.monthly, monthKey],
  ] as const) {
    const seen = new Set<string>();
    for (const b of scheduled) {
      const k = key(b.createdAt);
      if (seen.has(k)) continue;
      if (seen.size >= n) break;
      seen.add(k);
      keep.add(b.name);
    }
  }
  sorted.filter((b) => b.kind === 'manual').slice(0, r.manual).forEach((b) => keep.add(b.name));
  sorted
    .filter((b) => b.kind === 'pre-migration' || b.kind === 'pre-restore')
    .slice(0, 5)
    .forEach((b) => keep.add(b.name));
  return sorted.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

export class Backups {
  constructor(
    private readonly d: Database,
    private readonly cfg: Config,
    private readonly kv: Kv,
    private readonly log: (m: string) => void,
  ) {}

  get dir() {
    return this.cfg.dirs.backups;
  }

  async create(kind: BackupDoc['kind'], by: string | null): Promise<BackupDoc> {
    if (!(await this.kv.setNx('nb:lock:backup', `${os.hostname()}:${process.pid}`, 3600)))
      throw new Error('Another backup is already running; try again when it has finished');
    const createdAt = new Date();
    const name = `noteboard-backup-${stamp(createdAt)}-${kind}.tar.gz`;
    const doc: BackupDoc = { _id: name, kind, status: 'running', size: 0, sha256: null, createdAt, finishedAt: null, by, error: null, counts: {} };
    await this.d.c.backups.insertOne(doc);
    const file = path.join(this.dir, name);
    const part = `${file}.partial`;
    const tmpDir = path.join(this.dir, '.tmp');
    try {
      await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
      const out = fs.createWriteStream(part, { mode: 0o600 });
      const tar = new TarWriter(out);
      const counts: Record<string, number> = {};
      for (const coll of DATA_COLLECTIONS) {
        const dump = path.join(tmpDir, `${coll}.ndjson`);
        const w = fs.createWriteStream(dump, { mode: 0o600 });
        let n = 0;
        for await (const doc of this.d.db.collection(coll).find({})) {
          if (!w.write(BSON.EJSON.stringify(doc, { relaxed: false }) + '\n')) await new Promise<void>((r) => w.once('drain', () => r()));
          n++;
        }
        await new Promise<void>((resolve, reject) => {
          w.on('error', reject);
          w.end(() => resolve());
        });
        counts[coll] = n;
        await tar.addFile(`db/${coll}.ndjson`, dump);
        await fs.promises.rm(dump, { force: true });
      }
      let files = 0;
      let bytes = 0;
      if (this.cfg.storageDriver === 'local') {
        const walk = async (dir: string, rel: string) => {
          let entries: fs.Dirent[];
          try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) await walk(p, `${rel}/${e.name}`);
            else if (e.isFile() && !e.name.includes('.part-')) {
              await tar.addFile(`${rel}/${e.name}`, p);
              files++;
              bytes += (await fs.promises.stat(p)).size;
            }
          }
        };
        await walk(this.cfg.dirs.uploads, 'uploads');
      }
      const s = readSecrets(this.cfg.dirs.secrets);
      const keys = { encryptionKey: s.encryptionKey, sessionSecret: s.sessionSecret };
      await tar.addBuffer('config/keys.json', Buffer.from(JSON.stringify(keys, null, 2)));
      const manifest = {
        product: 'noteboard',
        format: 1,
        appVersion: this.cfg.version,
        schemaVersion: await schemaVersion(this.d),
        createdAt: createdAt.toISOString(),
        kind,
        storageDriver: this.cfg.storageDriver,
        counts,
        uploads: { files, bytes, included: this.cfg.storageDriver === 'local' },
        note: 'Contains the keys that decrypt two-step sign-in secrets and the SMTP password. Keep this file private.',
      };
      await tar.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
      await tar.finish();
      await fs.promises.rename(part, file);
      await fs.promises.chmod(file, 0o600);
      const size = (await fs.promises.stat(file)).size;
      const hash = await new Promise<string>((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file)
          .on('data', (c) => h.update(c))
          .on('end', () => resolve(h.digest('hex')))
          .on('error', reject);
      });
      const done = { status: 'ok' as const, size, sha256: hash, finishedAt: new Date(), counts };
      await this.d.c.backups.updateOne({ _id: name }, { $set: done });
      this.log(`backup written: ${name} (${Math.round(size / 1024)} KB)`);
      return { ...doc, ...done };
    } catch (e) {
      await fs.promises.rm(part, { force: true }).catch(() => undefined);
      await this.d.c.backups.updateOne({ _id: name }, { $set: { status: 'failed', error: (e as Error).message, finishedAt: new Date() } });
      throw e;
    } finally {
      await this.kv.del('nb:lock:backup');
    }
  }

  async prune(r: Retention, tz: string): Promise<string[]> {
    const gone = backupsToDelete(listBackupFiles(this.dir), r, tz);
    for (const name of gone) {
      await fs.promises.rm(path.join(this.dir, name), { force: true });
      await this.d.c.backups.deleteOne({ _id: name });
    }
    if (gone.length) this.log(`removed ${gone.length} old backup(s) by the retention policy`);
    return gone;
  }

  file(name: string): string | null {
    if (!BACKUP_RE.test(name)) return null;
    const f = path.join(this.dir, name);
    return fs.existsSync(f) ? f : null;
  }

  /**
   * Restores a backup into this instance. Refuses if the database already has accounts unless
   * `replace` is set, in which case a pre-restore backup is taken first.
   */
  async restore(file: string, opts: { replace: boolean }): Promise<{ counts: Record<string, number>; files: number }> {
    let manifest: Record<string, unknown> | null = null;
    await readTarGz(file, async (e, body) => {
      if (e.name === 'manifest.json') {
        const chunks: Buffer[] = [];
        for await (const c of body) chunks.push(c as Buffer);
        manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } else body.resume();
    });
    const m = manifest as Record<string, unknown> | null;
    if (!m || m['product'] !== 'noteboard') throw new Error('This is not a Noteboard backup');
    if ((m['schemaVersion'] as number) > SCHEMA_VERSION)
      throw new Error(`This backup comes from a newer version (schema ${m['schemaVersion']}); upgrade Noteboard before restoring it`);
    const users = await this.d.c.users.estimatedDocumentCount();
    if (users > 0 && !opts.replace) throw new Error('This instance already has accounts. Restore into a new, empty instance, or pass --replace to overwrite it.');
    if (users > 0) await this.create('pre-restore', 'cli');
    const counts: Record<string, number> = {};
    let files = 0;
    const own = new Set<string>(DATA_COLLECTIONS);
    for (const coll of DATA_COLLECTIONS) if (coll !== 'backups') await this.d.db.collection(coll).deleteMany({});
    await readTarGz(file, async (e, body) => {
      // Uploaded files (pictures, audio, video) go straight to disk without being held in memory.
      if (e.name.startsWith('uploads/') && this.cfg.storageDriver === 'local') {
        const target = path.join(this.cfg.dirs.uploads, ...e.name.slice('uploads/'.length).split('/'));
        if (!target.startsWith(path.resolve(this.cfg.dirs.uploads))) throw new Error(`unsafe path ${e.name}`);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await pipeline(body, fs.createWriteStream(target, { mode: 0o640 }));
        files++;
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(c as Buffer);
      const data = Buffer.concat(chunks);
      const dbm = /^db\/([a-z_]+)\.ndjson$/.exec(e.name);
      if (dbm && own.has(dbm[1]) && dbm[1] !== 'backups') {
        const docs = data
          .toString('utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => BSON.EJSON.parse(l, { relaxed: false }) as Record<string, unknown>);
        const coll = this.d.db.collection(dbm[1]);
        for (let i = 0; i < docs.length; i += 500) await coll.insertMany(docs.slice(i, i + 500) as never[]);
        counts[dbm[1]] = docs.length;
      } else if (e.name === 'config/keys.json') {
        const keys = JSON.parse(data.toString('utf8')) as Pick<AppSecrets, 'encryptionKey' | 'sessionSecret'>;
        const cur = readSecrets(this.cfg.dirs.secrets);
        writeFileAtomic(secretsFile(this.cfg.dirs.secrets), JSON.stringify({ ...cur, ...keys }, null, 2), 0o400);
      }
    });
    await this.d.c.sessions.deleteMany({});
    return { counts, files };
  }
}

export const sha = sha256;
