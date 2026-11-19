// Native app sign-in (Android, iOS, Windows): bearer tokens, refresh rotation, CORS for the app
// origins only, cookies ignored, and idempotent saves. Run: npx nx run api:integration
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MongoClient } from 'mongodb';
import { client, sampleStore, startServer, totp } from './harness.mjs';

const PW = 'correct horse battery 42';
let srv;
const s = {};

/** A native app: no cookies at all, marks requests, sends the access token. */
function app(base, origin = 'https://localhost') {
  const a = {
    access: null,
    refresh: null,
    async req(method, url, body, extra = {}) {
      const h = { 'x-noteboard-client': 'native', 'x-noteboard-app': 'Noteboard Android test', origin, ...extra };
      if (a.access) h.authorization = `Bearer ${a.access}`;
      if (body !== undefined) h['content-type'] = 'application/json';
      const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const type = r.headers.get('content-type') ?? '';
      const data = type.includes('json') ? await r.json() : null;
      if (data?.tokens) {
        a.access = data.tokens.accessToken;
        a.refresh = data.tokens.refreshToken;
      }
      return { status: r.status, data, headers: r.headers };
    },
    get: (u) => a.req('GET', u),
    post: (u, b = {}) => a.req('POST', u, b),
    put: (u, b) => a.req('PUT', u, b),
  };
  return a;
}

before(async () => {
  srv = await startServer({ ADMIN_MFA_REQUIRED: 'false' });
  const c = client(srv.base);
  await c.get('/api/v1/discovery');
  const r = await c.post('/api/v1/setup', { token: srv.setupToken(), name: 'Ann Admin', email: 'ann@example.com', password: PW, passwordConfirm: PW, publicUrl: 'https://notes.example.com' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  s.admin = c;
});
after(async () => {
  await srv?.stop();
});

describe('native apps: connection', () => {
  it('discovery tells the app how to sign in', async () => {
    const d = await app(srv.base).get('/api/v1/discovery');
    assert.equal(d.data.product, 'noteboard');
    assert.equal(d.data.native.auth, 'bearer-v1');
    assert.equal(d.headers.get('access-control-allow-origin'), 'https://localhost');
    assert.equal(d.headers.get('access-control-allow-credentials'), null, 'never credentialed CORS');
  });

  it('answers CORS preflights only for the app origins, never with "*"', async () => {
    for (const origin of ['https://localhost', 'capacitor://localhost', 'http://tauri.localhost', 'tauri://localhost']) {
      const r = await fetch(`${srv.base}/api/v1/workspace`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type,x-noteboard-client,x-noteboard-app' } });
      assert.equal(r.status, 204, origin);
      assert.equal(r.headers.get('access-control-allow-origin'), origin);
      assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
      assert.match(r.headers.get('access-control-allow-headers'), /X-Noteboard-App/);
      assert.equal(r.headers.get('access-control-allow-credentials'), null);
    }
    const evil = await fetch(`${srv.base}/api/v1/workspace`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  it('refuses native-marked requests from other web sites', async () => {
    const r = await app(srv.base, 'https://evil.example').post('/api/v1/auth/login', { email: 'ann@example.com', password: PW });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'bad_origin');
  });
});

describe('native apps: sign-in', () => {
  it('invitation acceptance returns tokens, not a cookie', async () => {
    const inv = await s.admin.post('/api/v1/admin/invitations', { email: 'bob@example.com', hours: 24 });
    assert.equal(inv.status, 201, JSON.stringify(inv.data));
    const token = inv.data.link.split('/invite/')[1];
    const bob = app(srv.base);
    const reg = await bob.post('/api/v1/auth/register', { invite: token, name: 'Bob', email: 'bob@example.com', password: PW });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    assert.ok(reg.data.tokens.accessToken && reg.data.tokens.refreshToken);
    assert.deepEqual(reg.headers.getSetCookie(), [], 'no cookies for apps');
    assert.equal((await bob.get('/api/v1/me')).data.user.email, 'bob@example.com');
  });

  it('signs in with a password and works without CSRF cookies', async () => {
    const bob = app(srv.base);
    const r = await bob.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mfaRequired, false);
    assert.deepEqual(r.headers.getSetCookie(), []);
    const save = await bob.put('/api/v1/workspace', { rev: 0, store: sampleStore('from the phone'), opId: 'op-phone-0001' });
    assert.equal(save.status, 200, JSON.stringify(save.data));
    assert.equal(save.data.rev, 1);
    s.bob = bob;
  });

  it('a browser sees the same boards (cross-device)', async () => {
    const b = client(srv.base);
    await b.get('/api/v1/discovery');
    await b.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    const ws = await b.get('/api/v1/workspace');
    assert.equal(ws.data.rev, 1);
    assert.ok(JSON.stringify(ws.data.store).includes('from the phone'));
    s.bobBrowser = b;
  });

  it('ignores browser cookies on native requests', async () => {
    const cookie = [...s.bobBrowser.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(`${srv.base}/api/v1/workspace`, { headers: { 'x-noteboard-client': 'native', cookie } });
    assert.equal(r.status, 401, 'a cookie alone never signs in a native request');
    const noToken = app(srv.base);
    assert.equal((await noToken.get('/api/v1/workspace')).status, 401);
  });

  it('a stolen-looking access token is refused', async () => {
    const x = app(srv.base);
    x.access = 'A'.repeat(43);
    assert.equal((await x.get('/api/v1/workspace')).status, 401);
  });
});

describe('native apps: tokens', () => {
  it('rotates the refresh token on every use', async () => {
    const bob = s.bob;
    const oldAccess = bob.access;
    const oldRefresh = bob.refresh;
    const r = await bob.post('/api/v1/native/refresh', { refreshToken: oldRefresh });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.notEqual(bob.refresh, oldRefresh);
    assert.notEqual(bob.access, oldAccess);
    assert.equal((await bob.get('/api/v1/workspace')).status, 200);
    const stale = app(srv.base);
    stale.access = oldAccess;
    assert.equal((await stale.get('/api/v1/workspace')).status, 401, 'the old access token stops working');
    s.oldRefresh = oldRefresh;
  });

  it('ends the session when an old refresh token is used again', async () => {
    const thief = app(srv.base);
    const r = await thief.post('/api/v1/native/refresh', { refreshToken: s.oldRefresh });
    assert.equal(r.status, 401);
    assert.equal(r.data.error.code, 'session_revoked');
    assert.equal((await s.bob.get('/api/v1/workspace')).status, 401, 'the real app is signed out too');
    assert.equal((await s.bob.post('/api/v1/native/refresh', { refreshToken: s.bob.refresh })).status, 401);
  });

  it('reports an expired access token so the app can refresh', async () => {
    const bob = app(srv.base);
    await bob.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    const m = await MongoClient.connect(srv.env.MONGO_URL);
    try {
      await m.db().collection('sessions').updateMany({ 'native.client': /Android test/ }, { $set: { 'native.accessExpiresAt': new Date(Date.now() - 1000) } });
    } finally {
      await m.close();
    }
    const r = await bob.get('/api/v1/workspace');
    assert.equal(r.status, 401);
    assert.equal(r.data.error.code, 'token_expired');
    assert.equal((await bob.post('/api/v1/native/refresh', { refreshToken: bob.refresh })).status, 200);
    assert.equal((await bob.get('/api/v1/workspace')).status, 200);
    s.bob = bob;
  });

  it('lists the app on the account page and lets the browser sign it out', async () => {
    const list = await s.bobBrowser.get('/api/v1/me/sessions');
    const appSession = list.data.sessions.find((x) => x.kind === 'app');
    assert.ok(appSession, JSON.stringify(list.data));
    assert.match(appSession.userAgent, /Android test/);
    assert.equal((await s.bobBrowser.del(`/api/v1/me/sessions/${appSession.id}`)).data.revoked, 1);
    assert.equal((await s.bob.get('/api/v1/workspace')).status, 401);
    assert.equal((await s.bob.post('/api/v1/native/refresh', { refreshToken: s.bob.refresh })).status, 401);
  });

  it('signs out (both tokens end)', async () => {
    const bob = app(srv.base);
    await bob.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    assert.equal((await bob.post('/api/v1/native/logout')).status, 200);
    assert.equal((await bob.get('/api/v1/workspace')).status, 401);
    assert.equal((await bob.post('/api/v1/native/refresh', { refreshToken: bob.refresh })).status, 401);
  });
});

describe('native apps: two-step sign-in', () => {
  it('asks for the code and gives nothing until it is entered', async () => {
    const setup = await s.bobBrowser.post('/api/v1/me/mfa/setup');
    const on = await s.bobBrowser.post('/api/v1/me/mfa/enable', { code: totp(setup.data.secret) });
    assert.equal(on.status, 200, JSON.stringify(on.data));
    const bob = app(srv.base);
    const login = await bob.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    assert.equal(login.data.mfaRequired, true);
    assert.equal(login.data.user, null);
    const blocked = await bob.get('/api/v1/workspace');
    assert.equal(blocked.status, 401);
    assert.equal(blocked.data.error.code, 'mfa_required');
    const ok = await bob.post('/api/v1/auth/mfa', { code: on.data.recoveryCodes[0] });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal((await bob.get('/api/v1/workspace')).status, 200);
    s.bob = bob;
  });
});

describe('saving from a flaky connection', () => {
  it('acknowledges a retried save instead of reporting a conflict with itself', async () => {
    const bob = s.bob;
    const rev = (await bob.get('/api/v1/workspace')).data.rev;
    const first = await bob.put('/api/v1/workspace', { rev, store: sampleStore('retry me'), opId: 'op-retry-0001' });
    assert.equal(first.status, 200);
    // The answer was lost; the app sends the same save again.
    const again = await bob.put('/api/v1/workspace', { rev, store: sampleStore('retry me'), opId: 'op-retry-0001' });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(again.data.rev, first.data.rev);
    assert.equal(again.data.replayed, true);
    // A different save based on the same old revision is still a conflict.
    const stale = await bob.put('/api/v1/workspace', { rev, store: sampleStore('stale'), opId: 'op-other-0002' });
    assert.equal(stale.status, 409);
  });
});
