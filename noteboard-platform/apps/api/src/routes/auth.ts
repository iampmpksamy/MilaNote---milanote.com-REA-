/** Sign-in, sign-out, two-step codes, registration, invitations, password links and the account page. */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { otpauthUri, passwordProblem, verifyPassword } from '../crypto';
import { CTX, type Ctx } from '../ctx';
import type { UserDoc } from '../db';
import { ApiFail, clearSessionCookie, limit, type NbRequest, needUser, setSessionCookie, str } from '../http';
import { normEmail, publicUser, SESSION_DAYS } from '../services/accounts';

export async function sendLink(ctx: Ctx, to: string, subject: string, intro: string, link: string): Promise<boolean> {
  const s = await ctx.settings.get();
  if (!ctx.mail.enabled(s)) return false;
  try {
    await ctx.mail.send(s, ctx.settings.smtpPassword(s), {
      to,
      subject: `${s.appName}: ${subject}`,
      text: `${intro}\n\n${link}\n\nIf you didn't expect this message, you can ignore it.`,
    });
    return true;
  } catch (e) {
    ctx.log(`e-mail to ${to} failed: ${(e as Error).message}`);
    return false;
  }
}

@Controller('auth')
export class AuthRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  @Post('login')
  @HttpCode(200)
  async login(@Req() req: NbRequest, @Res({ passthrough: true }) res: Response, @Body() b: Record<string, unknown>) {
    const email = normEmail(str(b['email'], 254));
    await limit(this.ctx, `login:ip:${req.nb.ip}`, 20, 60);
    await limit(this.ctx, `login:email:${email}`, 15, 900);
    let user: UserDoc;
    try {
      user = await this.ctx.accounts.checkLogin(email, str(b['password'], 300));
    } catch (e) {
      await this.ctx.audit('auth.login_failed', { target: email, ip: req.nb.ip, details: { reason: (e as ApiFail).code } });
      throw e;
    }
    const { token, session } = await this.ctx.accounts.startSession(user, req.nb.ip, req.get('user-agent') ?? '');
    setSessionCookie(res, req, token, SESSION_DAYS);
    await this.ctx.audit(session.mfaPending ? 'auth.password_ok' : 'auth.login', { actor: user, ip: req.nb.ip });
    return { mfaRequired: session.mfaPending, user: session.mfaPending ? null : publicUser(user) };
  }

  @Post('mfa')
  @HttpCode(200)
  async mfa(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user, session } = req.nb;
    if (!user || !session) throw new ApiFail(401, 'signed_out', 'Sign in to continue');
    if (!session.mfaPending) return { user: publicUser(user) };
    await limit(this.ctx, `mfa:${session._id}`, 8, 300, 'Too many wrong codes; sign in again in a few minutes');
    if (!(await this.ctx.accounts.mfaCheck(user, str(b['code'], 40)))) {
      await this.ctx.audit('auth.mfa_failed', { actor: user, ip: req.nb.ip });
      throw new ApiFail(400, 'bad_code', 'That code is not right');
    }
    await this.ctx.d.c.sessions.updateOne({ _id: session._id }, { $set: { mfaPending: false } });
    await this.ctx.audit('auth.login', { actor: user, ip: req.nb.ip, details: { mfa: true } });
    return { user: publicUser(user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: NbRequest, @Res({ passthrough: true }) res: Response) {
    if (req.nb.session) {
      await this.ctx.accounts.revokeSession(req.nb.session._id, req.nb.session.userId);
      await this.ctx.audit('auth.logout', { actor: req.nb.user, ip: req.nb.ip });
    }
    clearSessionCookie(res, req);
    return { ok: true };
  }

  @Get('invite/:token')
  async invite(@Param('token') token: string) {
    const t = await this.ctx.accounts.peek('invite', token);
    if (!t) throw new ApiFail(404, 'invalid_link', 'This invitation link is not valid any more. Ask for a new one.');
    return { email: t.email, role: t.role, expiresAt: t.expiresAt };
  }

  @Post('register')
  @HttpCode(201)
  async register(@Req() req: NbRequest, @Res({ passthrough: true }) res: Response, @Body() b: Record<string, unknown>) {
    await limit(this.ctx, `register:${req.nb.ip}`, 10, 900);
    const s = await this.ctx.settings.get();
    const email = str(b['email'], 254).trim();
    const password = str(b['password'], 300);
    const pp = passwordProblem(password, email);
    if (pp) throw new ApiFail(400, 'weak_password', pp);
    const inviteToken = str(b['invite'], 100);
    let invite = null;
    if (inviteToken) {
      invite = await this.ctx.accounts.peek('invite', inviteToken);
      if (!invite) throw new ApiFail(400, 'invalid_link', 'This invitation link is not valid any more. Ask for a new one.');
      if (invite.email && normEmail(invite.email) !== normEmail(email))
        throw new ApiFail(400, 'wrong_email', 'Use the e-mail address the invitation was sent to');
    } else if (s.registrationMode === 'invite' || s.registrationMode === 'closed') {
      throw new ApiFail(403, 'registration_closed', 'New accounts need an invitation from an administrator');
    }
    const email_on = this.ctx.mail.enabled(s);
    const status = invite ? 'active' : s.registrationMode === 'approval' ? 'pending' : 'active';
    // Self-registered accounts confirm their address when e-mail is available.
    const verified = !!invite || !email_on;
    const user = await this.ctx.accounts.create({
      email,
      name: str(b['name'], 80),
      password,
      role: invite?.role === 'admin' ? 'admin' : 'user',
      status,
      source: invite ? 'invite' : 'register',
      createdBy: invite?.createdBy ?? null,
      emailVerified: verified,
    });
    if (invite && !(await this.ctx.accounts.consume('invite', inviteToken))) {
      await this.ctx.d.c.users.deleteOne({ _id: user._id });
      throw new ApiFail(400, 'invalid_link', 'This invitation link was just used. Ask for a new one.');
    }
    await this.ctx.audit(invite ? 'invite.accepted' : 'auth.registered', { actor: user, ip: req.nb.ip, details: { status } });
    if (!verified) {
      const { raw } = await this.ctx.accounts.issue('verify', { userId: user._id, email, hours: 48, createdBy: null });
      await sendLink(this.ctx, email, 'confirm your e-mail address', 'Open this link to confirm your address:', `${await this.ctx.baseUrl(req.nb.origin)}/verify/${raw}`);
      return { status: 'verify_email' };
    }
    if (status === 'pending') return { status: 'pending' };
    const { token } = await this.ctx.accounts.startSession(user, req.nb.ip, req.get('user-agent') ?? '');
    setSessionCookie(res, req, token, SESSION_DAYS);
    return { status: 'active', user: publicUser(user) };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() b: Record<string, unknown>) {
    const t = await this.ctx.accounts.consume('verify', str(b['token'], 100));
    if (!t?.userId) throw new ApiFail(400, 'invalid_link', 'This link is not valid any more');
    await this.ctx.d.c.users.updateOne({ _id: t.userId }, { $set: { emailVerified: true } });
    return { ok: true };
  }

  /** Always answers the same way, so it can't be used to find out who has an account. */
  @Post('password/forgot')
  @HttpCode(200)
  async forgot(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    await limit(this.ctx, `forgot:${req.nb.ip}`, 5, 900);
    const s = await this.ctx.settings.get();
    if (!this.ctx.mail.enabled(s)) throw new ApiFail(400, 'email_off', 'This server does not send e-mail. Ask your administrator for a password reset link.');
    const u = await this.ctx.accounts.findByEmail(str(b['email'], 254));
    if (u && u.status === 'active') {
      const { raw } = await this.ctx.accounts.issue('reset', { userId: u._id, email: u.email, hours: 2, createdBy: null });
      await sendLink(this.ctx, u.email, 'reset your password', 'Open this link within 2 hours to choose a new password:', `${await this.ctx.baseUrl(req.nb.origin)}/reset/${raw}`);
      await this.ctx.audit('password.reset_requested', { actor: u, ip: req.nb.ip });
    }
    return { ok: true };
  }

  @Get('reset/:token')
  async resetInfo(@Param('token') token: string) {
    const t = await this.ctx.accounts.peek('reset', token);
    const u = t?.userId ? await this.ctx.accounts.findById(t.userId) : null;
    if (!t || !u) throw new ApiFail(404, 'invalid_link', 'This password link is not valid any more. Ask for a new one.');
    return { email: u.email, name: u.name, expiresAt: t.expiresAt };
  }

  @Post('password/reset')
  @HttpCode(200)
  async reset(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    await limit(this.ctx, `reset:${req.nb.ip}`, 10, 900);
    const token = str(b['token'], 100);
    const peek = await this.ctx.accounts.peek('reset', token);
    const u = peek?.userId ? await this.ctx.accounts.findById(peek.userId) : null;
    if (!peek || !u) throw new ApiFail(400, 'invalid_link', 'This password link is not valid any more. Ask for a new one.');
    const password = str(b['password'], 300);
    const pp = passwordProblem(password, u.email);
    if (pp) throw new ApiFail(400, 'weak_password', pp);
    if (!(await this.ctx.accounts.consume('reset', token))) throw new ApiFail(400, 'invalid_link', 'This password link was already used');
    await this.ctx.accounts.setPassword(u._id, password);
    await this.ctx.d.c.users.updateOne({ _id: u._id }, { $set: { emailVerified: true } });
    await this.ctx.accounts.revokeAll(u._id);
    await this.ctx.audit('password.reset', { actor: u, ip: req.nb.ip });
    return { ok: true };
  }
}

@Controller('me')
export class MeRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  /** Who is signed in (or `user: null`), including a half-finished two-step sign-in. */
  @Get()
  me(@Req() req: NbRequest) {
    const { user, session } = req.nb;
    if (!user || !session) return { user: null };
    return { user: publicUser(user), mfaPending: session.mfaPending };
  }

  @Patch()
  async update(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    const name = str(b['name'], 80).trim();
    if (!name) throw new ApiFail(400, 'invalid_name', 'Enter a name');
    await this.ctx.d.c.users.updateOne({ _id: user._id }, { $set: { name, updatedAt: new Date() } });
    return { user: publicUser({ ...user, name }) };
  }

  @Post('password')
  @HttpCode(200)
  async password(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user, session } = needUser(req);
    await limit(this.ctx, `pwchange:${user._id}`, 10, 900);
    if (user.passwordHash && !(await verifyPassword(str(b['current'], 300), user.passwordHash)))
      throw new ApiFail(400, 'bad_password', 'Your current password is not right');
    const pw = str(b['password'], 300);
    const pp = passwordProblem(pw, user.email);
    if (pp) throw new ApiFail(400, 'weak_password', pp);
    await this.ctx.accounts.setPassword(user._id, pw);
    const others = await this.ctx.accounts.revokeAll(user._id, session._id);
    await this.ctx.audit('password.changed', { actor: user, ip: req.nb.ip, details: { otherSessionsSignedOut: others } });
    return { ok: true, otherSessionsSignedOut: others };
  }

  @Get('sessions')
  async sessions(@Req() req: NbRequest) {
    const { user, session } = needUser(req);
    const list = await this.ctx.d.c.sessions.find({ userId: user._id }).sort({ lastSeenAt: -1 }).toArray();
    return {
      sessions: list.map((s) => ({
        id: s._id.slice(0, 16),
        current: s._id === session._id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    };
  }

  @Delete('sessions/:id')
  async revoke(@Req() req: NbRequest, @Param('id') id: string) {
    const { user } = needUser(req);
    if (!/^[0-9a-f]{16}$/.test(id)) throw new ApiFail(400, 'bad_id', 'Unknown session');
    const r = await this.ctx.d.c.sessions.deleteOne({ userId: user._id, _id: { $regex: `^${id}` } });
    return { revoked: r.deletedCount };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  async mfaSetup(@Req() req: NbRequest) {
    const { user } = needUser(req);
    if (user.mfa.enabled) throw new ApiFail(400, 'already_on', 'Two-step sign-in is already on');
    const secret = await this.ctx.accounts.mfaBegin(user);
    const s = await this.ctx.settings.get();
    return { secret, uri: otpauthUri(secret, user.email, s.appName) };
  }

  @Post('mfa/enable')
  @HttpCode(200)
  async mfaEnable(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    const fresh = (await this.ctx.accounts.findById(user._id))!;
    const codes = await this.ctx.accounts.mfaEnable(fresh, str(b['code'], 20));
    await this.ctx.audit('auth.mfa_enabled', { actor: user, ip: req.nb.ip });
    return { recoveryCodes: codes };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  async mfaDisable(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    if (!user.passwordHash || !(await verifyPassword(str(b['password'], 300), user.passwordHash)))
      throw new ApiFail(400, 'bad_password', 'Your password is not right');
    if (!(await this.ctx.accounts.mfaCheck(user, str(b['code'], 40)))) throw new ApiFail(400, 'bad_code', 'That code is not right');
    await this.ctx.accounts.mfaDisable(user._id);
    await this.ctx.audit('auth.mfa_disabled', { actor: user, ip: req.nb.ip });
    return { ok: true, note: user.role !== 'user' && this.ctx.cfg.adminMfaRequired ? 'The admin panel stays locked until you turn it on again.' : undefined };
  }
}
