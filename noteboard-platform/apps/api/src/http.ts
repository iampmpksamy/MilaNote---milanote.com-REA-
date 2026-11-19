/**
 * Request plumbing shared by every route: cookies, CSRF, rate limits, the signed-in session,
 * role checks and the JSON error format `{ "error": { "code", "message" } }`.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Ctx } from './ctx';
import { randomToken, safeEqual } from './crypto';
import type { SessionDoc, UserDoc } from './db';
import { type NativeTokens, SESSION_DAYS } from './services/accounts';
import { ApiFail } from './services/workspaces';

export { ApiFail };

export interface NbState {
  ip: string;
  secure: boolean;
  origin: string;
  cookies: Record<string, string>;
  session: SessionDoc | null;
  user: UserDoc | null;
  /** A native app request: bearer tokens only, cookies ignored (so no CSRF exposure). */
  native: boolean;
}

/** Native apps mark every request with this header; browsers can't send it cross-site without CORS approval. */
export const NATIVE_HEADER = 'x-noteboard-client';

export type NbRequest = Request & { nb: NbState };

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

const secureFor = (ctx: Ctx, req: Request) => (ctx.cfg.cookieSecure === 'always' ? true : ctx.cfg.cookieSecure === 'never' ? false : req.secure);
export const sessionCookieName = (secure: boolean) => (secure ? '__Host-nb_session' : 'nb_session');
export const csrfCookieName = (secure: boolean) => (secure ? '__Host-nb_csrf' : 'nb_csrf');

function cookie(name: string, value: string, o: { secure: boolean; httpOnly: boolean; maxAge: number; sameSite: 'Lax' | 'Strict' }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${o.maxAge}`,
    `SameSite=${o.sameSite}`,
    o.httpOnly ? 'HttpOnly' : '',
    o.secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function appendCookie(res: Response, c: string) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [...(Array.isArray(prev) ? prev : [String(prev)]), c] : [c]);
}

export function setSessionCookie(res: Response, req: NbRequest, token: string, days: number) {
  appendCookie(res, cookie(sessionCookieName(req.nb.secure), token, { secure: req.nb.secure, httpOnly: true, maxAge: days * 86400, sameSite: 'Lax' }));
}
/** The client's own description for the account page ("Noteboard Android 3.0.0-alpha.4"). */
const clientName = (req: NbRequest) => (req.get('x-noteboard-app') ?? req.get('user-agent') ?? 'Noteboard app').slice(0, 120);

/**
 * Signs the user in on this client: a cookie for the browser, or tokens in the answer for a native
 * app (which keeps them in the system's protected storage). Returns what to add to the answer.
 */
export async function beginSession(ctx: Ctx, req: NbRequest, res: Response, user: UserDoc): Promise<{ session: SessionDoc; extra: { tokens?: NativeTokens } }> {
  if (req.nb.native) {
    const { session, tokens } = await ctx.accounts.startNativeSession(user, req.nb.ip, clientName(req));
    return { session, extra: { tokens } };
  }
  const { token, session } = await ctx.accounts.startSession(user, req.nb.ip, req.get('user-agent') ?? '');
  setSessionCookie(res, req, token, SESSION_DAYS);
  return { session, extra: {} };
}

export function clearSessionCookie(res: Response, req: NbRequest) {
  appendCookie(res, cookie(sessionCookieName(req.nb.secure), '', { secure: req.nb.secure, httpOnly: true, maxAge: 0, sameSite: 'Lax' }));
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Express middleware that runs before every API route. */
export function requestState(ctx: Ctx) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = req as NbRequest;
      const secure = secureFor(ctx, req);
      const native = (req.get(NATIVE_HEADER) ?? '').toLowerCase() === 'native';
      // Native requests never use cookies: whatever a webview might carry is ignored.
      const cookies = native ? {} : parseCookies(req.headers.cookie);
      r.nb = { ip: req.ip ?? '', secure, origin: `${req.protocol}://${req.get('host') ?? ''}`, cookies, session: null, user: null, native };
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // CORS only for the native apps' own origins, never with credentials (cookies), never "*".
      const reqOrigin = req.get('origin');
      if (reqOrigin && ctx.cfg.nativeOrigins.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, ETag');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Noteboard-Client, X-Noteboard-App');
          res.setHeader('Access-Control-Max-Age', '600');
          res.status(204).end();
          return;
        }
      }
      if (native && reqOrigin && !ctx.cfg.nativeOrigins.includes(reqOrigin) && reqOrigin !== r.nb.origin)
        throw new ApiFail(403, 'bad_origin', 'Requests from other sites are not accepted');

      // Rate limit everything a little, by client address.
      if ((await ctx.kv.hit(`nb:rl:all:${r.nb.ip}`, 60)) > 1200) throw new ApiFail(429, 'rate_limited', 'Too many requests; wait a minute');

      if (native) {
        const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.get('authorization') ?? '');
        if (m) {
          const found = await ctx.accounts.resolveAccess(m[1]);
          // Refresh and sign-out work with the refresh token, whatever access token comes along.
          if (found === 'expired' && !req.path.startsWith('/v1/native/')) throw new ApiFail(401, 'token_expired', 'The sign-in needs refreshing');
          if (found === 'expired') {
            next();
            return;
          }
          if (found) {
            r.nb.session = found.session;
            r.nb.user = found.user;
          }
        }
        next();
        return;
      }

      // CSRF: a random cookie the page must echo in a header on every change, plus an Origin check.
      let csrf = cookies[csrfCookieName(secure)];
      if (!csrf) {
        csrf = randomToken(24);
        appendCookie(res, cookie(csrfCookieName(secure), csrf, { secure, httpOnly: false, maxAge: 365 * 86400, sameSite: 'Strict' }));
      }
      if (UNSAFE.has(req.method)) {
        const given = req.get('x-csrf-token') ?? '';
        if (!given || !safeEqual(given, csrf)) throw new ApiFail(403, 'csrf', 'This request was refused (missing security token). Reload the page and try again.');
        const origin = req.get('origin');
        if (origin) {
          const allowed = new Set([r.nb.origin]);
          const pub = (await ctx.settings.get()).publicUrl;
          if (pub) allowed.add(new URL(pub).origin);
          if (!allowed.has(origin)) throw new ApiFail(403, 'bad_origin', 'Requests from other sites are not accepted');
        }
      }

      const token = cookies[sessionCookieName(secure)];
      if (token) {
        const found = await ctx.accounts.resolve(token);
        if (found) {
          r.nb.session = found.session;
          r.nb.user = found.user;
        } else clearSessionCookie(res, r);
      }
      next();
    } catch (e) {
      sendError(res, e, ctx.log);
    }
  };
}

export async function limit(ctx: Ctx, key: string, max: number, windowSec: number, message = 'Too many attempts; wait a few minutes and try again') {
  if ((await ctx.kv.hit(`nb:rl:${key}`, windowSec)) > max) throw new ApiFail(429, 'rate_limited', message);
}

export function needUser(req: NbRequest): { user: UserDoc; session: SessionDoc } {
  const { user, session } = req.nb;
  if (!user || !session) throw new ApiFail(401, 'signed_out', 'Sign in to continue');
  if (session.mfaPending) throw new ApiFail(401, 'mfa_required', 'Enter the code from your authenticator app');
  return { user, session };
}

/** Administrators must use two-step sign-in (unless ADMIN_MFA_REQUIRED=false). */
export function needAdmin(ctx: Ctx, req: NbRequest, superOnly = false): { user: UserDoc; session: SessionDoc } {
  const s = needUser(req);
  if (s.user.role !== 'super_admin' && (superOnly || s.user.role !== 'admin'))
    throw new ApiFail(403, 'forbidden', superOnly ? 'Only the super administrator can do this' : 'Administrators only');
  if (ctx.cfg.adminMfaRequired && !s.user.mfa.enabled)
    throw new ApiFail(403, 'mfa_enrollment_required', 'Turn on two-step sign-in for your account before using the admin panel');
  return s;
}

export async function notInMaintenance(ctx: Ctx, user: UserDoc) {
  const m = (await ctx.settings.get()).maintenance;
  if (m.enabled && user.role === 'user') throw new ApiFail(503, 'maintenance', m.message || 'The server is in maintenance; changes are paused for a moment');
}

export const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function sendError(res: Response, e: unknown, log: (m: string) => void) {
  {
    if (res.headersSent) return;
    if (e instanceof ApiFail) {
      res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
      return;
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      res.status(status).json({ error: { code: status === 404 ? 'not_found' : 'http_error', message: status === 404 ? 'Not found' : e.message } });
      return;
    }
    const t = (e as { type?: string; status?: number })?.type;
    if (t === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'That is larger than this server accepts' } });
      return;
    }
    if (t === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json', message: 'The request body is not valid JSON' } });
      return;
    }
    log(`error: ${(e as Error)?.stack ?? String(e)}`);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server. The details are in the server log.' } });
  }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(private readonly log: (m: string) => void) {}
  catch(e: unknown, host: ArgumentsHost) {
    sendError(host.switchToHttp().getResponse<Response>(), e, this.log);
  }
}
