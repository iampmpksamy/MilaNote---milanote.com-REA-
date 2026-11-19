/** Accounts: users, sessions, one-time links (invitations, password resets, e-mail checks), MFA. */
import { decrypt, encrypt, hashPassword, newTotpSecret, randomToken, recoveryCodes, sha256, uuid, verifyPassword, verifyTotp } from '../crypto';
import type { Database, Role, SessionDoc, TokenDoc, UserDoc, UserStatus } from '../db';
import { ApiFail } from './workspaces';

export const SESSION_DAYS = 30;
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

export const normEmail = (e: string) => e.trim().toLowerCase();
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i;

export function publicUser(u: UserDoc) {
  return {
    id: u._id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerified,
    mfaEnabled: u.mfa.enabled,
    hasPassword: !!u.passwordHash,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

export class Accounts {
  constructor(
    private readonly d: Database,
    private readonly key: string,
  ) {}

  findByEmail(email: string) {
    return this.d.c.users.findOne({ emailLower: normEmail(email) });
  }
  findById(id: string) {
    return this.d.c.users.findOne({ _id: id });
  }

  async create(p: {
    email: string;
    name: string;
    password: string | null;
    role: Role;
    status: UserStatus;
    source: UserDoc['source'];
    createdBy: string | null;
    emailVerified: boolean;
  }): Promise<UserDoc> {
    if (!EMAIL_RE.test(p.email.trim())) throw new ApiFail(400, 'invalid_email', 'Enter a valid e-mail address');
    const name = p.name.trim().slice(0, 80);
    if (!name) throw new ApiFail(400, 'invalid_name', 'Enter a name');
    const now = new Date();
    const u: UserDoc = {
      _id: uuid(),
      email: p.email.trim(),
      emailLower: normEmail(p.email),
      name,
      passwordHash: p.password ? await hashPassword(p.password) : null,
      role: p.role,
      status: p.status,
      emailVerified: p.emailVerified,
      mfa: { enabled: false },
      quotaBytes: null,
      source: p.source,
      createdBy: p.createdBy,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      failedLogins: 0,
      lockedUntil: null,
    };
    try {
      await this.d.c.users.insertOne(u);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ApiFail(409, 'email_taken', 'An account with this e-mail address already exists');
      throw e;
    }
    return u;
  }

  /** Checks the password; counts failures and locks the account for a while after too many. */
  async checkLogin(email: string, password: string): Promise<UserDoc> {
    const u = await this.findByEmail(String(email ?? ''));
    const fail = () => new ApiFail(401, 'bad_credentials', 'That e-mail address and password do not match');
    if (!u || !u.passwordHash) {
      await hashPassword('timing-equaliser'); // similar time whether or not the account exists
      throw fail();
    }
    if (u.lockedUntil && u.lockedUntil > new Date())
      throw new ApiFail(429, 'locked', 'Too many wrong passwords. Try again in a few minutes, or ask an administrator for a reset link.');
    if (!(await verifyPassword(String(password ?? ''), u.passwordHash))) {
      const n = (u.failedLogins ?? 0) + 1;
      await this.d.c.users.updateOne(
        { _id: u._id },
        { $set: { failedLogins: n >= LOCK_AFTER ? 0 : n, lockedUntil: n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } },
      );
      throw fail();
    }
    if (u.status === 'suspended') throw new ApiFail(403, 'suspended', 'This account is suspended. Contact your administrator.');
    if (u.status === 'pending') throw new ApiFail(403, 'pending', 'This account is waiting for an administrator to approve it.');
    if (!u.emailVerified) throw new ApiFail(403, 'unverified', 'Confirm your e-mail address first: open the link we sent you.');
    await this.d.c.users.updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return u;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await this.d.c.users.updateOne(
      { _id: userId },
      { $set: { passwordHash: await hashPassword(password), updatedAt: new Date(), failedLogins: 0, lockedUntil: null } },
    );
  }

  // ---------- sessions ----------

  async startSession(u: UserDoc, ip: string, userAgent: string): Promise<{ token: string; session: SessionDoc }> {
    const token = randomToken(32);
    const now = new Date();
    const session: SessionDoc = {
      _id: sha256(token),
      userId: u._id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400_000),
      ip,
      userAgent: userAgent.slice(0, 300),
      mfaPending: u.mfa.enabled,
    };
    await this.d.c.sessions.insertOne(session);
    return { token, session };
  }

  async resolve(token: string): Promise<{ session: SessionDoc; user: UserDoc } | null> {
    if (!token || token.length > 100) return null;
    const session = await this.d.c.sessions.findOne({ _id: sha256(token) });
    if (!session || session.expiresAt < new Date()) return null;
    const user = await this.findById(session.userId);
    if (!user || user.status !== 'active') return null;
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      const now = new Date();
      await this.d.c.sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400_000) } });
    }
    return { session, user };
  }

  revokeSession(id: string, userId: string) {
    return this.d.c.sessions.deleteOne({ _id: id, userId });
  }
  async revokeAll(userId: string, except?: string): Promise<number> {
    const r = await this.d.c.sessions.deleteMany(except ? { userId, _id: { $ne: except } } : { userId });
    return r.deletedCount;
  }

  // ---------- one-time links ----------

  async issue(kind: TokenDoc['kind'], p: { email?: string | null; userId?: string | null; role?: Role; hours: number; createdBy: string | null; note?: string }) {
    const raw = randomToken(32);
    const now = new Date();
    const doc: TokenDoc = {
      _id: sha256(raw),
      kind,
      email: p.email ? p.email.trim() : null,
      userId: p.userId ?? null,
      role: p.role ?? 'user',
      createdBy: p.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + p.hours * 3600_000),
      usedAt: null,
      revokedAt: null,
      note: (p.note ?? '').slice(0, 200),
    };
    // A new reset or e-mail link replaces earlier unused ones for the same account.
    if (kind !== 'invite' && p.userId) await this.d.c.tokens.updateMany({ kind, userId: p.userId, usedAt: null }, { $set: { revokedAt: now } });
    await this.d.c.tokens.insertOne(doc);
    return { raw, doc };
  }

  async peek(kind: TokenDoc['kind'], raw: string): Promise<TokenDoc | null> {
    if (typeof raw !== 'string' || raw.length > 100) return null;
    const t = await this.d.c.tokens.findOne({ _id: sha256(raw), kind });
    if (!t || t.usedAt || t.revokedAt || t.expiresAt < new Date()) return null;
    return t;
  }

  /** Marks the link used, atomically; null when it was already used, revoked or expired. */
  async consume(kind: TokenDoc['kind'], raw: string): Promise<TokenDoc | null> {
    if (typeof raw !== 'string' || raw.length > 100) return null;
    return this.d.c.tokens.findOneAndUpdate(
      { _id: sha256(raw), kind, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { returnDocument: 'after' },
    );
  }

  // ---------- two-step sign-in (TOTP) ----------

  async mfaBegin(u: UserDoc): Promise<string> {
    const secret = newTotpSecret();
    await this.d.c.users.updateOne({ _id: u._id }, { $set: { 'mfa.pendingSecretEnc': encrypt(secret, this.key) } });
    return secret;
  }

  async mfaEnable(u: UserDoc, code: string): Promise<string[]> {
    if (!u.mfa.pendingSecretEnc) throw new ApiFail(400, 'no_pending_secret', 'Start the set-up again');
    const secret = decrypt(u.mfa.pendingSecretEnc, this.key);
    const step = verifyTotp(secret, code);
    if (step === null) throw new ApiFail(400, 'bad_code', 'That code is not right. Check the time on your phone and try the newest code.');
    const codes = recoveryCodes();
    await this.d.c.users.updateOne(
      { _id: u._id },
      { $set: { mfa: { enabled: true, secretEnc: encrypt(secret, this.key), recovery: codes.map((c) => sha256(c)), lastStep: step } } },
    );
    return codes;
  }

  /** Checks a 6-digit code (not reusable) or a recovery code (used up). */
  async mfaCheck(u: UserDoc, code: string): Promise<boolean> {
    if (!u.mfa.enabled || !u.mfa.secretEnc) return false;
    const c = String(code ?? '').trim();
    const step = verifyTotp(decrypt(u.mfa.secretEnc, this.key), c);
    if (step !== null) {
      const r = await this.d.c.users.updateOne({ _id: u._id, $or: [{ 'mfa.lastStep': { $lt: step } }, { 'mfa.lastStep': { $exists: false } }] }, { $set: { 'mfa.lastStep': step } });
      return r.modifiedCount === 1;
    }
    const h = sha256(c.toLowerCase());
    if (u.mfa.recovery?.includes(h)) {
      const r = await this.d.c.users.updateOne({ _id: u._id, 'mfa.recovery': h }, { $pull: { 'mfa.recovery': h } });
      return r.modifiedCount === 1;
    }
    return false;
  }

  async mfaDisable(userId: string): Promise<void> {
    await this.d.c.users.updateOne({ _id: userId }, { $set: { mfa: { enabled: false } } });
  }
}
