import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPublicUrl, loadConfig, validateConfig } from './config';
import { base32Decode, base32Encode, decrypt, encrypt, hashPassword, passwordProblem, totp, verifyPassword, verifyTotp } from './crypto';
import { nextBackupAt } from './routes/admin';
import { backupsToDelete, type BackupInfo } from './services/backups';
import { sniffImage } from './services/blobs';
import { checkStore, safeLinkUrl } from './services/store-check';
import { readTarGz, TarWriter } from './services/tar';

describe('configuration', () => {
  it('uses the homelab defaults', () => {
    const c = loadConfig({});
    expect(c.registrationMode).toBe('invite');
    expect(c.adminPath).toBe('/admin');
    expect(c.storageDriver).toBe('local');
    expect(c.smtp.enabled).toBe(false);
    expect(validateConfig(c)).toEqual([]);
  });

  it('explains bad values', () => {
    const c = loadConfig({ APP_PUBLIC_URL: 'notes.example.com', REGISTRATION_MODE: 'everyone', TZ: 'Mars/Base', MAX_UPLOAD_MB: '0', SMTP_ENABLED: 'true', BACKUP_TIME: '25:00' });
    const e = validateConfig(c).join('\n');
    expect(e).toMatch(/APP_PUBLIC_URL/);
    expect(e).toMatch(/REGISTRATION_MODE/);
    expect(e).toMatch(/TZ/);
    expect(e).toMatch(/MAX_UPLOAD_MB/);
    expect(e).toMatch(/SMTP_HOST/);
    expect(e).toMatch(/BACKUP_TIME/);
  });

  it('checks public addresses', () => {
    expect(checkPublicUrl('https://notes.6dainas.cloud')).toBeNull();
    expect(checkPublicUrl('http://10.0.0.2:8765')).toBeNull();
    expect(checkPublicUrl('ftp://x')).not.toBeNull();
    expect(checkPublicUrl('https://user:pw@x.com')).not.toBeNull();
    expect(checkPublicUrl('https://x.com/?a=1')).not.toBeNull();
  });

  it('rejects admin paths that clash with the app', () => {
    expect(validateConfig(loadConfig({ ADMIN_PATH: '/api' })).join()).toMatch(/ADMIN_PATH/);
    expect(validateConfig(loadConfig({ ADMIN_PATH: '/control' }))).toEqual([]);
  });
});

describe('crypto', () => {
  it('matches the RFC 6238 SHA-1 test vectors (last 6 digits)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1111111109_000)).toBe('081804');
    expect(totp(secret, 2000000000_000)).toBe('279037');
    expect(verifyTotp(secret, '287082', 59_000)).not.toBeNull();
    expect(verifyTotp(secret, '287083', 59_000)).toBeNull();
  });

  it('round-trips base32', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 7]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });

  it('hashes passwords with a salt and verifies them', async () => {
    const h1 = await hashPassword('a long enough password');
    const h2 = await hashPassword('a long enough password');
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^\$(argon2id|scrypt)\$/);
    expect(await verifyPassword('a long enough password', h1)).toBe(true);
    expect(await verifyPassword('a long enough passworD', h1)).toBe(false);
  });

  it('judges new passwords', () => {
    expect(passwordProblem('short')).toMatch(/10/);
    expect(passwordProblem('aaaaaaaaaaaa')).not.toBeNull();
    expect(passwordProblem('me@example.com', 'me@example.com')).not.toBeNull();
    expect(passwordProblem('correct horse battery')).toBeNull();
  });

  it('encrypts fields so they can only be read with the key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const other = Buffer.alloc(32, 8).toString('base64');
    const sealed = encrypt('smtp-password', key);
    expect(sealed).not.toContain('smtp-password');
    expect(decrypt(sealed, key)).toBe('smtp-password');
    expect(() => decrypt(sealed, other)).toThrow();
  });
});

describe('board checks', () => {
  const store = () => ({
    boards: { '1': { id: 1, name: 'Home', parent: null, color: 0, icon: null, cards: [], arrows: [], unsorted: [], pan: [0, 0], zoom: 1 } },
    root: 1,
    next_id: 2,
    trash: [],
    version: 2,
  });

  it('accepts a valid store and counts it', () => {
    const r = checkStore(store());
    expect(r.ok).toBe(true);
    expect(r.counts.boards).toBe(1);
  });

  it('rejects broken stores', () => {
    expect(checkStore(null).ok).toBe(false);
    expect(checkStore({ ...store(), root: 9 }).ok).toBe(false);
    const s = store();
    (s.boards['1'] as Record<string, unknown>)['id'] = 5;
    expect(checkStore(s).ok).toBe(false);
  });

  it('allows only safe link schemes', () => {
    expect(safeLinkUrl('https://example.com')).toBe(true);
    expect(safeLinkUrl('example.com/page')).toBe(true);
    expect(safeLinkUrl('mailto:a@b.c')).toBe(true);
    expect(safeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(safeLinkUrl('data:text/html,x')).toBe(false);
  });

  it('recognises pictures by content', () => {
    expect(sniffImage(Buffer.from('89504e470d0a1a0a0000000d', 'hex'))).toBe('image/png');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>    '))).toBeNull();
  });
});

describe('backups', () => {
  const at = (iso: string, kind: BackupInfo['kind'] = 'scheduled'): BackupInfo => ({ name: `${kind}-${iso}`, kind, createdAt: new Date(iso), size: 1 });

  it('keeps the newest backup of each recent day, week and month', () => {
    const list: BackupInfo[] = [];
    for (let d = 0; d < 120; d++) list.push(at(new Date(Date.UTC(2026, 10, 19, 21, 30) - d * 86400_000).toISOString()));
    const gone = new Set(backupsToDelete(list, { daily: 7, weekly: 4, monthly: 6, manual: 10 }, 'UTC'));
    const kept = list.filter((b) => !gone.has(b.name));
    expect(kept.length).toBeGreaterThanOrEqual(7);
    expect(kept.length).toBeLessThanOrEqual(7 + 4 + 6);
    for (let d = 0; d < 7; d++) expect(gone.has(list[d].name)).toBe(false);
    expect(gone.has(list[119].name)).toBe(true);
  });

  it('keeps manual backups by count and leaves scheduled rules alone', () => {
    const list = [at('2026-11-01T00:00:00Z', 'manual'), at('2026-11-02T00:00:00Z', 'manual'), at('2026-11-03T00:00:00Z', 'manual')];
    expect(backupsToDelete(list, { daily: 7, weekly: 4, monthly: 6, manual: 2 }, 'UTC')).toEqual([list[0].name]);
  });

  it('computes the next scheduled time in the server time zone', () => {
    const n = nextBackupAt('03:00', 'Asia/Kolkata', new Date('2026-11-19T12:00:00Z'));
    expect(n.toISOString()).toBe('2026-11-19T21:30:00.000Z');
  });

  it('writes and reads back archives', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-tar-')), 'a.tar.gz');
    const t = new TarWriter(fs.createWriteStream(file));
    const long = `uploads/${'d'.repeat(36)}/${'f'.repeat(90)}.png`;
    await t.addBuffer('manifest.json', Buffer.from('{"a":1}'));
    await t.addBuffer(long, Buffer.alloc(1000, 3));
    await t.finish();
    const seen: Record<string, number> = {};
    await readTarGz(file, async (e, body) => {
      let n = 0;
      for await (const c of body) n += (c as Buffer).length;
      seen[e.name] = n;
    });
    expect(seen).toEqual({ 'manifest.json': 7, [long]: 1000 });
  });
});
