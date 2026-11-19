/**
 * Native apps (Android, iOS, Windows). They sign in through the same /auth routes as the browser,
 * sending `X-Noteboard-Client: native`, and get tokens instead of a cookie. These routes keep the
 * tokens fresh and end the session. See docs/NATIVE_AUTHENTICATION.md.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { CTX, type Ctx } from '../ctx';
import { ApiFail, limit, type NbRequest, str } from '../http';
import { publicUser } from '../services/accounts';

function nativeOnly(req: NbRequest) {
  if (!req.nb.native) throw new ApiFail(400, 'native_only', 'This is for the Noteboard apps (send X-Noteboard-Client: native)');
}

@Controller('native')
export class NativeRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  /** Swaps the refresh token for a new pair. The old refresh token stops working. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    nativeOnly(req);
    await limit(this.ctx, `refresh:${req.nb.ip}`, 120, 60);
    const r = await this.ctx.accounts.refreshNative(str(b['refreshToken'], 100), req.nb.ip);
    if (r === 'reused') {
      await this.ctx.audit('auth.refresh_reused', { ip: req.nb.ip, details: { action: 'session ended' } });
      throw new ApiFail(401, 'session_revoked', 'This sign-in was used somewhere else and has been ended for safety. Sign in again.');
    }
    if (!r) throw new ApiFail(401, 'signed_out', 'Sign in again');
    return { tokens: r.tokens, mfaRequired: r.session.mfaPending, user: r.session.mfaPending ? null : publicUser(r.user) };
  }

  /** Ends this app's session (both tokens). Works with the access token or the refresh token. */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    nativeOnly(req);
    if (req.nb.session) {
      await this.ctx.accounts.revokeSession(req.nb.session._id, req.nb.session.userId);
      await this.ctx.audit('auth.logout', { actor: req.nb.user, ip: req.nb.ip, details: { client: req.nb.session.native?.client } });
      return { ok: true };
    }
    const refresh = str(b['refreshToken'], 100);
    if (refresh) await this.ctx.accounts.revokeByRefresh(refresh);
    return { ok: true };
  }
}
