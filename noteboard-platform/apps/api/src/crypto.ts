/** Password hashing, random tokens, field encryption and TOTP — all on Node's own crypto. */
import crypto from 'node:crypto';

// ---------- passwords ----------

// OWASP 2025 baseline for argon2id: 19 MiB memory, 2 passes, 1 lane.
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
type Argon2Fn = (
  alg: string,
  p: { message: Buffer | string; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  cb: (err: Error | null, key: Buffer) => void,
) => void;
const argon2 = (crypto as unknown as { argon2?: Argon2Fn }).argon2;

function argon2id(password: string, salt: Buffer, p = ARGON): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2!('argon2id', { message: password, nonce: salt, ...p }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function scrypt(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 32, { N: n, r: 8, p: 1, maxmem: 256 * n * 8 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

/** A PHC-style string: `$argon2id$v=19$m=…,t=…,p=…$salt$hash` (or `$scrypt$n=…$salt$hash` where argon2 is missing). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  if (argon2) {
    const key = await argon2id(password, salt);
    return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(salt)}$${b64(key)}`;
  }
  const n = 1 << 17;
  return `$scrypt$n=${n}$${b64(salt)}$${b64(await scrypt(password, salt, n))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts[1] === 'argon2id' && argon2) {
      const params = Object.fromEntries(parts[3].split(',').map((kv) => kv.split('='))) as Record<string, string>;
      const salt = Buffer.from(parts[4], 'base64');
      const want = Buffer.from(parts[5], 'base64');
      const got = await argon2id(password, salt, { memory: +params['m'], passes: +params['t'], parallelism: +params['p'], tagLength: want.length });
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    }
    if (parts[1] === 'scrypt') {
      const n = Number(parts[2].split('=')[1]);
      const salt = Buffer.from(parts[3], 'base64');
      const want = Buffer.from(parts[4], 'base64');
      const got = await scrypt(password, salt, n);
      return crypto.timingSafeEqual(got, want);
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Rules for new passwords; returns the problem or null. */
export function passwordProblem(password: unknown, email?: string): string | null {
  if (typeof password !== 'string') return 'Enter a password';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 256) return 'Use at most 256 characters';
  if (email && password.toLowerCase() === email.toLowerCase()) return "Don't use your e-mail address as the password";
  if (/^(.)\1+$/.test(password)) return 'Choose a less predictable password';
  return null;
}

// ---------- tokens ----------

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');
export const uuid = (): string => crypto.randomUUID();

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a), 'hex');
  const y = Buffer.from(sha256(b), 'hex');
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

// ---------- field encryption (AES-256-GCM) ----------

export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decrypt(sealed: string, keyB64: string): string {
  const [v, iv, tag, body] = sealed.split(':');
  if (v !== 'v1') throw new Error('unknown sealed format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretB32: string, at = Date.now(), step = 30): string {
  const counter = Math.floor(at / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** Accepts the code for now or one step either side; returns the matched step so it can't be reused. */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): number | null {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  for (const d of [0, -1, 1]) {
    const t = at + d * 30_000;
    if (safeEqual(totp(secretB32, t), c)) return Math.floor(t / 30_000);
  }
  return null;
}

export const newTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function recoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.randomBytes(8)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
