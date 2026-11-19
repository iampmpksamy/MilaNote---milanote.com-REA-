/**
 * The administrator API behind /admin. Administrators manage accounts and the server; they get
 * usage numbers per account but no route here returns anyone's boards or pictures.
 */
import fs from 'node:fs';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { passwordProblem, sha256 } from '../crypto';
import { CTX, type Ctx } from '../ctx';
import { type Role, SCHEMA_VERSION, schemaVersion, type UserDoc } from '../db';
import { ApiFail, type NbRequest, needAdmin, str } from '../http';
import { normEmail, publicUser } from '../services/accounts';
import { listBackupFiles } from '../services/backups';
import { sniffImage } from '../services/blobs';
import { sendLink } from './auth';
import { readiness } from './public';

const HOURS = (v: unknown, d: number, max: number) => {
  const n = Number(v ?? d);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new ApiFail(400, 'bad_hours', `Choose 1 to ${max} hours`);
  return n;
};

export function nextBackupAt(time: string, tz: string, now = new Date()): Date {
  // The next wall-clock HH:MM in the server's time zone.
  const [h, m] = time.split(':').map(Number);
  for (let add = 0; add < 49 * 60; add++) {
    const t = new Date(Math.ceil(now.getTime() / 60000) * 60000 + add * 60000);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
    if (parts === `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`) return t;
  }
  return now;
}

@Controller('admin')
export class AdminRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  @Get('overview')
  async overview(@Req() req: NbRequest) {
    needAdmin(this.ctx, req);
    const { c, db } = this.ctx.d;
    const [usersByStatus, usersByRole, usage, sessions, build, stats, redisInfo, redisMs, space, last, hb, queued, schema] = await Promise.all([
      c.users.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      c.users.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray(),
      c.workspaces
        .aggregate<{
          _id: null;
          workspaces: number;
          boards: number;
          cards: number;
          assets: number;
          assetBytes: number;
        }>([{ $group: { _id: null, workspaces: { $sum: 1 }, boards: { $sum: '$usage.boards' }, cards: { $sum: '$usage.cards' }, assets: { $sum: '$usage.assets' }, assetBytes: { $sum: '$usage.assetBytes' } } }])
        .toArray(),
      c.sessions.countDocuments({ expiresAt: { $gt: new Date() } }),
      db.admin().command({ buildInfo: 1 }),
      db.command({ dbStats: 1 }),
      this.ctx.kv.info().catch(() => ({})),
      this.ctx.kv.ping().catch(() => -1),
      this.ctx.blobs.space(),
      c.backups.find({ status: 'ok' }).sort({ createdAt: -1 }).limit(1).next(),
      this.ctx.kv.get('nb:worker:heartbeat'),
      this.ctx.kv.len('nb:jobs'),
      schemaVersion(this.ctx.d),
    ]);
    const s = await this.ctx.settings.get();
    const backups = listBackupFiles(this.ctx.cfg.dirs.backups);
    const backupSpace = await fs.promises.statfs(this.ctx.cfg.dirs.backups).catch(() => null);
    return {
      server: {
        appName: s.appName,
        version: this.ctx.cfg.version,
        schemaVersion: schema,
        schemaVersionExpected: SCHEMA_VERSION,
        node: process.version,
        startedAt: this.ctx.startedAt,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        publicUrl: s.publicUrl || null,
        registration: s.registrationMode,
        email: this.ctx.mail.enabled(s),
        maintenance: s.maintenance.enabled,
        storageDriver: this.ctx.blobs.driver,
        timeZone: this.ctx.cfg.tz,
      },
      users: {
        byStatus: Object.fromEntries(usersByStatus.map((x) => [x._id, x.n])),
        byRole: Object.fromEntries(usersByRole.map((x) => [x._id, x.n])),
        activeSessions: sessions,
      },
      content: usage[0] ? { ...usage[0], _id: undefined } : { workspaces: 0, boards: 0, cards: 0, assets: 0, assetBytes: 0 },
      database: {
        version: build['version'],
        dataBytes: stats['dataSize'],
        storageBytes: stats['storageSize'],
        indexBytes: stats['indexSize'],
        documents: stats['objects'],
      },
      redis: { ...redisInfo, pingMs: redisMs },
      disk: {
        uploads: space,
        backups: backupSpace ? { free: backupSpace.bavail * backupSpace.bsize, total: backupSpace.blocks * backupSpace.bsize } : null,
      },
      backups: {
        count: backups.length,
        totalBytes: backups.reduce((a, b) => a + b.size, 0),
        last: last ? { name: last._id, at: last.finishedAt, size: last.size } : null,
        nextScheduledAt: s.backup.enabled ? nextBackupAt(s.backup.time, this.ctx.cfg.tz) : null,
      },
      worker: { lastHeartbeat: hb, queued },
    };
  }

  @Get('health')
  async health(@Req() req: NbRequest) {
    needAdmin(this.ctx, req);
    const checks = await readiness(this.ctx);
    const hb = await this.ctx.kv.get('nb:worker:heartbeat');
    const age = hb ? (Date.now() - new Date(hb).getTime()) / 1000 : null;
    checks.push({
      id: 'worker',
      label: 'Background worker',
      ok: age !== null && age < 120,
      message: age === null ? 'no heartbeat yet' : `last heartbeat ${Math.round(age)} s ago`,
    });
    return { checks };
  }

  // ---------- users ----------

  @Get('users')
  async users(@Req() req: NbRequest, @Query('q') q?: string) {
    needAdmin(this.ctx, req);
    const filter = q ? { $or: [{ emailLower: { $regex: escapeRe(q.toLowerCase()) } }, { name: { $regex: escapeRe(q), $options: 'i' } }] } : {};
    const users = await this.ctx.d.c.users.find(filter).sort({ createdAt: 1 }).limit(500).toArray();
    const ws = await this.ctx.d.c.workspaces.find({ ownerId: { $in: users.map((u) => u._id) } }, { projection: { ownerId: 1, usage: 1, updatedAt: 1 } }).toArray();
    const sessions = await this.ctx.d.c.sessions
      .aggregate<{ _id: string; n: number }>([{ $match: { expiresAt: { $gt: new Date() } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }])
      .toArray();
    const s = await this.ctx.settings.get();
    return {
      users: users.map((u) => {
        const w = ws.find((x) => x.ownerId === u._id);
        return {
          ...publicUser(u),
          quotaBytes: u.quotaBytes,
          effectiveQuotaBytes: u.quotaBytes ?? s.defaultQuotaBytes,
          usage: w?.usage ?? { boards: 0, cards: 0, arrows: 0, assets: 0, assetBytes: 0 },
          lastSavedAt: w?.updatedAt ?? null,
          sessions: sessions.find((x) => x._id === u._id)?.n ?? 0,
          source: u.source,
        };
      }),
    };
  }

  @Post('users')
  @HttpCode(201)
  async createUser(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user: admin } = needAdmin(this.ctx, req);
    const role = (str(b['role'], 20) || 'user') as Role;
    if (!['user', 'admin'].includes(role)) throw new ApiFail(400, 'bad_role', 'Role must be user or admin');
    if (role === 'admin' && admin.role !== 'super_admin') throw new ApiFail(403, 'forbidden', 'Only the super administrator can create administrators');
    const email = str(b['email'], 254);
    const password = str(b['password'], 300);
    if (password) {
      const pp = passwordProblem(password, email);
      if (pp) throw new ApiFail(400, 'weak_password', pp);
    }
    const u = await this.ctx.accounts.create({
      email,
      name: str(b['name'], 80),
      password: password || null,
      role,
      status: 'active',
      source: 'admin',
      createdBy: admin._id,
      emailVerified: true,
    });
    let link: string | null = null;
    let emailed = false;
    if (!password) {
      const { raw } = await this.ctx.accounts.issue('reset', { userId: u._id, email: u.email, hours: 72, createdBy: admin._id, note: 'first password' });
      link = `${await this.ctx.baseUrl(req.nb.origin)}/reset/${raw}`;
      if (b['send'] === true) emailed = await sendLink(this.ctx, u.email, 'your new account', `${admin.name} created an account for you. Open this link within 3 days to choose your password:`, link);
    }
    await this.ctx.audit('user.create', { actor: admin, target: u.email, ip: req.nb.ip, details: { role, link: !!link } });
    return { user: publicUser(u), setPasswordLink: link, emailed };
  }

  @Patch('users/:id')
  async updateUser(@Req() req: NbRequest, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const { user: admin } = needAdmin(this.ctx, req);
    const u = await this.ctx.accounts.findById(id);
    if (!u) throw new ApiFail(404, 'not_found', 'No such account');
    this.guardTarget(admin, u);
    const set: Partial<UserDoc> = {};
    if ('name' in b) {
      const n = str(b['name'], 80).trim();
      if (!n) throw new ApiFail(400, 'invalid_name', 'Enter a name');
      set.name = n;
    }
    if ('status' in b) {
      const st = b['status'];
      if (!['active', 'suspended'].includes(st as string)) throw new ApiFail(400, 'bad_status', 'Status must be active or suspended');
      if (u._id === admin._id) throw new ApiFail(400, 'self', "You can't suspend your own account");
      set.status = st as UserDoc['status'];
    }
    if ('role' in b) {
      if (admin.role !== 'super_admin') throw new ApiFail(403, 'forbidden', 'Only the super administrator can change roles');
      const r = b['role'] as Role;
      if (!['user', 'admin', 'super_admin'].includes(r)) throw new ApiFail(400, 'bad_role', 'Unknown role');
      if (u._id === admin._id && r !== 'super_admin') throw new ApiFail(400, 'self', "You can't remove your own super administrator role");
      set.role = r;
    }
    if ('quotaBytes' in b) {
      const q = b['quotaBytes'];
      if (q !== null && (!Number.isFinite(Number(q)) || Number(q) < 0)) throw new ApiFail(400, 'bad_quota', 'Use a size in bytes, 0 for no limit, or null for the default');
      set.quotaBytes = q === null ? null : Math.floor(Number(q));
    }
    if ('emailVerified' in b) set.emailVerified = !!b['emailVerified'];
    if (!Object.keys(set).length) throw new ApiFail(400, 'nothing', 'Nothing to change');
    set.updatedAt = new Date();
    await this.ctx.d.c.users.updateOne({ _id: u._id }, { $set: set });
    if (set.status === 'suspended') await this.ctx.accounts.revokeAll(u._id);
    const action = set.status === 'suspended' ? 'user.suspend' : set.status === 'active' && u.status !== 'active' ? 'user.activate' : 'user.update';
    await this.ctx.audit(action, { actor: admin, target: u.email, ip: req.nb.ip, details: { ...set, updatedAt: undefined } });
    return { user: publicUser({ ...u, ...set } as UserDoc) };
  }

  @Post('users/:id/reset-link')
  @HttpCode(201)
  async resetLink(@Req() req: NbRequest, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const { user: admin } = needAdmin(this.ctx, req);
    const u = await this.ctx.accounts.findById(id);
    if (!u) throw new ApiFail(404, 'not_found', 'No such account');
    this.guardTarget(admin, u);
    const hours = HOURS(b['hours'], 24, 168);
    const { raw, doc } = await this.ctx.accounts.issue('reset', { userId: u._id, email: u.email, hours, createdBy: admin._id, note: 'admin link' });
    const link = `${await this.ctx.baseUrl(req.nb.origin)}/reset/${raw}`;
    const emailed = b['send'] === true ? await sendLink(this.ctx, u.email, 'reset your password', 'Open this link to choose a new password:', link) : false;
    await this.ctx.audit('user.reset_link', { actor: admin, target: u.email, ip: req.nb.ip, details: { hours, emailed } });
    return { link, expiresAt: doc.expiresAt, emailed };
  }

  @Delete('users/:id/sessions')
  async revokeSessions(@Req() req: NbRequest, @Param('id') id: string) {
    const { user: admin } = needAdmin(this.ctx, req);
    const u = await this.ctx.accounts.findById(id);
    if (!u) throw new ApiFail(404, 'not_found', 'No such account');
    this.guardTarget(admin, u);
    const n = await this.ctx.accounts.revokeAll(u._id, u._id === admin._id ? req.nb.session!._id : undefined);
    await this.ctx.audit('user.sessions_revoked', { actor: admin, target: u.email, ip: req.nb.ip, details: { count: n } });
    return { revoked: n };
  }

  @Post('users/:id/mfa-reset')
  @HttpCode(200)
  async mfaReset(@Req() req: NbRequest, @Param('id') id: string) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    const u = await this.ctx.accounts.findById(id);
    if (!u) throw new ApiFail(404, 'not_found', 'No such account');
    if (u._id === admin._id) throw new ApiFail(400, 'self', 'Turn it off from your own account page instead');
    await this.ctx.accounts.mfaDisable(u._id);
    await this.ctx.accounts.revokeAll(u._id);
    await this.ctx.audit('user.mfa_reset', { actor: admin, target: u.email, ip: req.nb.ip });
    return { ok: true };
  }

  private guardTarget(admin: UserDoc, u: UserDoc) {
    if (admin.role !== 'super_admin' && u.role !== 'user' && u._id !== admin._id)
      throw new ApiFail(403, 'forbidden', 'Only the super administrator can change other administrators');
  }

  // ---------- invitations ----------

  @Get('invitations')
  async invitations(@Req() req: NbRequest) {
    needAdmin(this.ctx, req);
    const list = await this.ctx.d.c.tokens.find({ kind: 'invite' }).sort({ createdAt: -1 }).limit(200).toArray();
    const now = new Date();
    return {
      invitations: list.map((t) => ({
        id: t._id.slice(0, 16),
        email: t.email,
        role: t.role,
        note: t.note,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        state: t.usedAt ? 'used' : t.revokedAt ? 'revoked' : t.expiresAt < now ? 'expired' : 'open',
      })),
    };
  }

  @Post('invitations')
  @HttpCode(201)
  async invite(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user: admin } = needAdmin(this.ctx, req);
    const role = (str(b['role'], 20) || 'user') as Role;
    if (!['user', 'admin'].includes(role)) throw new ApiFail(400, 'bad_role', 'Role must be user or admin');
    if (role === 'admin' && admin.role !== 'super_admin') throw new ApiFail(403, 'forbidden', 'Only the super administrator can invite administrators');
    const email = str(b['email'], 254).trim();
    if (email && (await this.ctx.accounts.findByEmail(email))) throw new ApiFail(409, 'email_taken', 'That person already has an account');
    const hours = HOURS(b['hours'], 72, 336);
    const { raw, doc } = await this.ctx.accounts.issue('invite', { email: email || null, role, hours, createdBy: admin._id, note: str(b['note'], 200) });
    const link = `${await this.ctx.baseUrl(req.nb.origin)}/invite/${raw}`;
    const emailed = email && b['send'] === true ? await sendLink(this.ctx, email, 'you are invited', `${admin.name} invited you to ${(await this.ctx.settings.get()).appName}. Open this link to create your account:`, link) : false;
    await this.ctx.audit('invite.create', { actor: admin, target: email || '(any e-mail)', ip: req.nb.ip, details: { role, hours, emailed } });
    return { link, expiresAt: doc.expiresAt, emailed };
  }

  @Delete('invitations/:id')
  async revokeInvite(@Req() req: NbRequest, @Param('id') id: string) {
    const { user: admin } = needAdmin(this.ctx, req);
    if (!/^[0-9a-f]{16}$/.test(id)) throw new ApiFail(400, 'bad_id', 'Unknown invitation');
    const r = await this.ctx.d.c.tokens.updateOne({ kind: 'invite', _id: { $regex: `^${id}` }, usedAt: null }, { $set: { revokedAt: new Date() } });
    await this.ctx.audit('invite.revoke', { actor: admin, target: id, ip: req.nb.ip });
    return { revoked: r.modifiedCount };
  }

  // ---------- settings and branding ----------

  @Get('settings')
  async settings(@Req() req: NbRequest) {
    needAdmin(this.ctx, req);
    return { settings: await this.ctx.settings.masked(), adminPath: this.ctx.cfg.adminPath, maxUploadMb: this.ctx.cfg.maxUploadMb };
  }

  @Patch('settings')
  async patchSettings(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    const r = await this.ctx.settings.update(b);
    if (Object.keys(r.errors).length) throw new ApiFail(400, 'invalid_settings', 'Some settings are not valid', r.errors);
    await this.ctx.audit('settings.update', { actor: admin, ip: req.nb.ip, details: { changed: r.changed } });
    return { settings: await this.ctx.settings.masked() };
  }

  @Post('settings/email-test')
  @HttpCode(200)
  async emailTest(@Req() req: NbRequest) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    const s = await this.ctx.settings.get();
    if (!this.ctx.mail.enabled(s)) throw new ApiFail(400, 'email_off', 'Turn e-mail on and save first');
    try {
      await this.ctx.mail.send(s, this.ctx.settings.smtpPassword(s), { to: admin.email, subject: `${s.appName}: test message`, text: 'E-mail from your Noteboard server works.' });
    } catch (e) {
      throw new ApiFail(502, 'email_failed', `The mail server refused: ${(e as Error).message}`);
    }
    return { sentTo: admin.email };
  }

  @Put('branding/:kind')
  async branding(@Req() req: NbRequest, @Param('kind') kind: string) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    if (kind !== 'logo' && kind !== 'favicon') throw new ApiFail(404, 'not_found', 'Unknown picture');
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || !data.length) throw new ApiFail(400, 'empty', 'Send the picture as the request body');
    if (data.length > 1024 * 1024) throw new ApiFail(413, 'too_large', 'Use a picture under 1 MB');
    const mime = sniffImage(data);
    if (!mime || !['image/png', 'image/webp', 'image/x-icon', 'image/jpeg'].includes(mime)) throw new ApiFail(415, 'unsupported_type', 'Use a PNG, WebP, JPEG or ICO file');
    const key = `_branding/${kind}-${sha256(data).slice(0, 16)}`;
    await this.ctx.blobs.put(key, data);
    await this.ctx.d.c.assets.updateOne(
      { workspaceId: '_branding', name: kind },
      { $set: { key, size: data.length, mime, sha256: sha256(data), createdAt: new Date() }, $setOnInsert: { _id: `_branding:${kind}` } },
      { upsert: true },
    );
    await this.ctx.d.c.settings.updateOne({ _id: 'platform' }, { $set: { [`branding.${kind}`]: kind, updatedAt: new Date() } });
    this.ctx.settings.invalidate();
    await this.ctx.audit('branding.update', { actor: admin, target: kind, ip: req.nb.ip });
    return { ok: true };
  }

  @Delete('branding/:kind')
  async brandingReset(@Req() req: NbRequest, @Param('kind') kind: string) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    if (kind !== 'logo' && kind !== 'favicon') throw new ApiFail(404, 'not_found', 'Unknown picture');
    await this.ctx.d.c.settings.updateOne({ _id: 'platform' }, { $set: { [`branding.${kind}`]: null } });
    this.ctx.settings.invalidate();
    await this.ctx.audit('branding.reset', { actor: admin, target: kind, ip: req.nb.ip });
    return { ok: true };
  }

  // ---------- backups ----------

  @Get('backups')
  async backups(@Req() req: NbRequest) {
    needAdmin(this.ctx, req, true);
    const files = listBackupFiles(this.ctx.cfg.dirs.backups);
    const records = await this.ctx.d.c.backups.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    const s = await this.ctx.settings.get();
    return {
      folder: this.ctx.cfg.dirs.backups,
      schedule: { ...s.backup, timeZone: this.ctx.cfg.tz, nextAt: s.backup.enabled ? nextBackupAt(s.backup.time, this.ctx.cfg.tz) : null },
      running: !!(await this.ctx.kv.get('nb:lock:backup')),
      queued: await this.ctx.kv.len('nb:jobs'),
      files: files.map((f) => ({ ...f, record: records.find((r) => r._id === f.name) ?? null })),
      failures: records.filter((r) => r.status === 'failed').slice(0, 10),
    };
  }

  @Post('backups')
  @HttpCode(202)
  async backupNow(@Req() req: NbRequest) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    await this.ctx.kv.push('nb:jobs', JSON.stringify({ type: 'backup', kind: 'manual', by: admin.email, at: new Date().toISOString() }));
    await this.ctx.audit('backup.requested', { actor: admin, ip: req.nb.ip });
    return { queued: true };
  }

  @Get('backups/:name/download')
  async download(@Req() req: NbRequest, @Res() res: Response, @Param('name') name: string) {
    const { user: admin } = needAdmin(this.ctx, req, true);
    const file = this.ctx.backups.file(name);
    if (!file) throw new ApiFail(404, 'not_found', 'No such backup');
    await this.ctx.audit('backup.download', { actor: admin, target: name, ip: req.nb.ip });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', String(fs.statSync(file).size));
    fs.createReadStream(file).pipe(res);
  }

  // ---------- audit log ----------

  @Get('audit')
  async audit(@Req() req: NbRequest, @Query('before') before?: string, @Query('action') action?: string, @Query('actor') actor?: string) {
    needAdmin(this.ctx, req);
    const f: Record<string, unknown> = {};
    if (before && !isNaN(Date.parse(before))) f['at'] = { $lt: new Date(before) };
    if (action) f['action'] = { $regex: `^${escapeRe(action)}` };
    if (actor) f['actorEmail'] = normEmail(actor);
    const rows = await this.ctx.d.c.audit.find(f).sort({ at: -1 }).limit(100).toArray();
    return { entries: rows.map((r) => ({ ...r, _id: String(r._id) })) };
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}
