/** Routes anyone may call: discovery, health, branding and the one-time first-run setup. */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { API_VERSION, MIN_CLIENT_API_VERSION } from '../config';
import { passwordProblem } from '../crypto';
import { ACCESS_MINUTES, SESSION_DAYS } from '../services/accounts';
import { CTX, type Ctx } from '../ctx';
import { ApiFail, beginSession, limit, type NbRequest, str } from '../http';

export async function discovery(ctx: Ctx) {
  const s = await ctx.settings.get();
  return {
    product: 'noteboard',
    edition: 'homelab',
    apiVersion: API_VERSION,
    minClientApiVersion: MIN_CLIENT_API_VERSION,
    serverVersion: ctx.cfg.version,
    appName: s.appName,
    publicUrl: s.publicUrl || null,
    adminPath: ctx.cfg.adminPath,
    setupRequired: !s.setupCompletedAt,
    registration: s.registrationMode,
    features: {
      email: ctx.mail.enabled(s),
      passwordReset: ctx.mail.enabled(s) ? 'email-or-admin-link' : 'admin-link',
      mfa: 'totp',
      adminMfaRequired: ctx.cfg.adminMfaRequired,
      import: ['desktop-boards-json', 'browser-local'],
      maxUploadMb: ctx.cfg.maxUploadMb,
      // Map cards (search and map pictures through this server; MAP_PROVIDER=off turns them off).
      maps: ctx.cfg.map.provider !== 'off',
    },
    branding: { accent: s.branding.accent, logo: !!s.branding.logo, favicon: !!s.branding.favicon },
    maintenance: s.maintenance.enabled ? { message: s.maintenance.message } : null,
    // Native apps (Android, iOS, Windows): bearer tokens with refresh rotation (see /native/*).
    native: { auth: 'bearer-v1', accessMinutes: ACCESS_MINUTES, refreshDays: SESSION_DAYS },
  };
}

@Controller()
export class PublicRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  @Get('discovery')
  discovery() {
    return discovery(this.ctx);
  }

  /** Liveness: the process answers. */
  @Get('health')
  health() {
    return { status: 'ok', version: this.ctx.cfg.version };
  }

  /** Readiness: the database, Redis and file storage all answer. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = await readiness(this.ctx);
    if (!checks.every((c) => c.ok)) res.status(503);
    return { ready: checks.every((c) => c.ok), checks };
  }

  @Get('branding/:kind')
  async branding(@Param('kind') kind: string, @Res() res: Response) {
    const s = await this.ctx.settings.get();
    const name = kind === 'logo' ? s.branding.logo : kind === 'favicon' ? s.branding.favicon : null;
    const a = name ? await this.ctx.d.c.assets.findOne({ workspaceId: '_branding', name }) : null;
    const stream = a ? await this.ctx.blobs.get(a.key) : null;
    if (!a || !stream) throw new ApiFail(404, 'not_found', 'No picture set');
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    stream.pipe(res);
  }

  // ---------- first-run setup ----------

  @Get('setup/status')
  async setupStatus() {
    const required = await this.ctx.setupRequired();
    if (!required) return { setupRequired: false };
    const s = await this.ctx.settings.get();
    return {
      setupRequired: true,
      appName: s.appName,
      publicUrl: s.publicUrl || null,
      tokenExpiresAt: this.ctx.setupToken().expiresAt,
      checks: await readiness(this.ctx),
      tokenHelp:
        'The setup token is in the server log (CasaOS: app settings → Logs, container noteboard-api) and in DATA/config/setup-token.json, or run: docker exec noteboard-api node cli.js setup-token',
    };
  }

  @Post('setup')
  @HttpCode(201)
  async setup(@Req() req: NbRequest, @Res({ passthrough: true }) res: Response, @Body() body: Record<string, unknown>) {
    await limit(this.ctx, `setup:${req.nb.ip}`, 10, 900);
    if (!(await this.ctx.setupRequired())) throw new ApiFail(410, 'setup_closed', 'Setup has already been completed');
    const tok = this.ctx.checkSetupToken(body['token']);
    if (tok === 'expired') throw new ApiFail(400, 'token_expired', 'The setup token has expired. Restart the app (or run: node cli.js setup-token --new) for a new one.');
    if (tok !== 'ok') {
      await this.ctx.audit('setup.bad_token', { ip: req.nb.ip });
      throw new ApiFail(403, 'bad_token', 'The setup token is not right');
    }
    const email = str(body['email'], 254);
    const password = str(body['password'], 300);
    if (password !== str(body['passwordConfirm'], 300)) throw new ApiFail(400, 'password_mismatch', 'The two passwords are different');
    const pp = passwordProblem(password, email);
    if (pp) throw new ApiFail(400, 'weak_password', pp);
    // Claim setup atomically so two simultaneous requests can't both create an administrator.
    const claim = await this.ctx.d.c.settings.updateOne({ _id: 'platform', setupCompletedAt: null }, { $set: { setupCompletedAt: new Date() } });
    if (claim.modifiedCount !== 1) throw new ApiFail(410, 'setup_closed', 'Setup has already been completed');
    this.ctx.settings.invalidate();
    try {
      const user = await this.ctx.accounts.create({
        email,
        name: str(body['name'], 80),
        password,
        role: 'super_admin',
        status: 'active',
        source: 'setup',
        createdBy: null,
        emailVerified: true,
      });
      this.ctx.clearSetupToken();
      const publicUrl = str(body['publicUrl'], 300).trim();
      if (publicUrl) {
        const r = await this.ctx.settings.update({ publicUrl });
        if (Object.keys(r.errors).length) this.ctx.log(`setup: public address not saved: ${JSON.stringify(r.errors)}`);
      }
      await this.ctx.audit('setup.complete', { actor: user, ip: req.nb.ip });
      const { extra } = await beginSession(this.ctx, req, res, user);
      this.ctx.log(`setup complete: super administrator ${user.email} created; the setup route is now closed`);
      return { ok: true, next: 'mfa', ...extra };
    } catch (e) {
      await this.ctx.d.c.settings.updateOne({ _id: 'platform' }, { $set: { setupCompletedAt: null } });
      this.ctx.settings.invalidate();
      throw e;
    }
  }
}

export async function readiness(ctx: Ctx) {
  const checks: { id: string; label: string; ok: boolean; message: string }[] = [];
  const t = performance.now();
  try {
    await ctx.d.db.command({ ping: 1 });
    checks.push({ id: 'database', label: 'Database (MongoDB)', ok: true, message: `answers in ${Math.round(performance.now() - t)} ms` });
  } catch (e) {
    checks.push({ id: 'database', label: 'Database (MongoDB)', ok: false, message: (e as Error).message });
  }
  try {
    const ms = await ctx.kv.ping();
    checks.push({ id: 'redis', label: 'Cache and queue (Redis)', ok: true, message: `answers in ${ms} ms` });
  } catch (e) {
    checks.push({ id: 'redis', label: 'Cache and queue (Redis)', ok: false, message: (e as Error).message });
  }
  const st = await ctx.blobs.check();
  checks.push({ id: 'storage', label: `File storage (${ctx.blobs.driver})`, ok: !st, message: st ?? 'writable' });
  const s = await ctx.settings.get();
  checks.push({
    id: 'public_url',
    label: 'Public address',
    ok: true,
    message: s.publicUrl ? s.publicUrl : 'not set yet — links will use the address you opened the app with',
  });
  return checks;
}
