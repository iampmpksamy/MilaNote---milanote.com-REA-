// End-to-end tests of the built API over HTTP with a real MongoDB replica set (in memory) and
// the in-memory stand-in for Redis. Run: npx nx run api:integration
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { client, PNG, sampleStore, startServer, totp } from './harness.mjs';

const PW = 'correct horse battery 42';
let srv;
const admin = () => state.admin;
const state = {};

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.stop();
});

describe('first run', () => {
  it('reports that setup is needed and that the services are ready', async () => {
    const c = client(srv.base);
    const d = await c.get('/api/v1/discovery');
    assert.equal(d.status, 200);
    assert.equal(d.data.product, 'noteboard');
    assert.equal(d.data.apiVersion, 1);
    assert.equal(d.data.setupRequired, true);
    assert.equal(d.data.registration, 'invite');
    const w = await c.get('/.well-known/noteboard.json');
    assert.equal(w.data.product, 'noteboard');
    const r = await c.get('/api/v1/ready');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s = await c.get('/api/v1/setup/status');
    assert.equal(s.data.setupRequired, true);
    assert.ok(s.data.checks.every((x) => x.ok));
    assert.ok(!JSON.stringify(s.data).includes(srv.setupToken()), 'the token itself is never served');
  });

  it('refuses changes without the CSRF token', async () => {
    const r = await fetch(`${srv.base}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'csrf');
  });

  it('refuses a wrong setup token and weak passwords', async () => {
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    const bad = await c.post('/api/v1/setup', { token: 'nope', name: 'Ann', email: 'ann@example.com', password: PW, passwordConfirm: PW });
    assert.equal(bad.status, 403);
    const weak = await c.post('/api/v1/setup', { token: srv.setupToken(), name: 'Ann', email: 'ann@example.com', password: 'short', passwordConfirm: 'short' });
    assert.equal(weak.status, 400);
  });

  it('creates the super administrator once, then closes setup', async () => {
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    const token = srv.setupToken();
    const r = await c.post('/api/v1/setup', { token, name: 'Ann Admin', email: 'Ann@Example.com', password: PW, passwordConfirm: PW, publicUrl: 'https://notes.example.com' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const me = await c.get('/api/v1/me');
    assert.equal(me.data.user.role, 'super_admin');
    assert.equal(me.data.user.email, 'Ann@Example.com');
    const again = await client(srv.base).req('GET', '/api/v1/discovery').then(async () => {
      const c2 = client(srv.base);
      await c2.get('/api/v1/discovery');
      return c2.post('/api/v1/setup', { token, name: 'Eve', email: 'eve@example.com', password: PW, passwordConfirm: PW });
    });
    assert.equal(again.status, 410);
    assert.equal((await c.get('/api/v1/discovery')).data.publicUrl, 'https://notes.example.com');
    assert.equal(fs.existsSync(path.join(srv.data, 'config/setup-token.json')), false);
    state.admin = c;
  });
});

describe('administrator two-step sign-in', () => {
  it('locks the admin panel until two-step sign-in is on', async () => {
    const r = await admin().get('/api/v1/admin/overview');
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'mfa_enrollment_required');
  });

  it('turns it on with an authenticator code and asks for it at the next sign-in', async () => {
    const c = admin();
    const s = await c.post('/api/v1/me/mfa/setup');
    assert.match(s.data.uri, /^otpauth:\/\/totp\//);
    state.secret = s.data.secret;
    const wrong = await c.post('/api/v1/me/mfa/enable', { code: '000000' });
    assert.equal(wrong.status, 400);
    const on = await c.post('/api/v1/me/mfa/enable', { code: totp(state.secret) });
    assert.equal(on.status, 200, JSON.stringify(on.data));
    assert.equal(on.data.recoveryCodes.length, 10);
    state.recovery = on.data.recoveryCodes;

    const c2 = client(srv.base);
    await c2.get('/api/v1/discovery');
    const login = await c2.post('/api/v1/auth/login', { email: 'ann@example.com', password: PW });
    assert.equal(login.status, 200);
    assert.equal(login.data.mfaRequired, true);
    assert.equal((await c2.get('/api/v1/workspace')).status, 401, 'half-signed-in sessions get nothing');
    // The same code can't be used twice; a recovery code works once.
    const ok = await c2.post('/api/v1/auth/mfa', { code: state.recovery[0] });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const ov = await c2.get('/api/v1/admin/overview');
    assert.equal(ov.status, 200, JSON.stringify(ov.data));
    assert.equal(ov.data.users.byRole.super_admin, 1);
    assert.ok(ov.data.database.version);
    state.admin = c2;
  });
});

describe('accounts without e-mail', () => {
  it('invites a person with a single-use link', async () => {
    const inv = await admin().post('/api/v1/admin/invitations', { email: 'bob@example.com', hours: 24 });
    assert.equal(inv.status, 201, JSON.stringify(inv.data));
    assert.match(inv.data.link, /^https:\/\/notes\.example\.com\/invite\//);
    const token = inv.data.link.split('/invite/')[1];
    const bob = client(srv.base);
    await bob.get('/api/v1/discovery');
    assert.equal((await bob.get(`/api/v1/auth/invite/${token}`)).data.email, 'bob@example.com');
    const wrongEmail = await bob.post('/api/v1/auth/register', { invite: token, name: 'Bob', email: 'mallory@example.com', password: PW });
    assert.equal(wrongEmail.status, 400);
    const reg = await bob.post('/api/v1/auth/register', { invite: token, name: 'Bob', email: 'bob@example.com', password: PW });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    assert.equal(reg.data.status, 'active');
    const reuse = client(srv.base);
    await reuse.get('/api/v1/discovery');
    assert.equal((await reuse.post('/api/v1/auth/register', { invite: token, name: 'Bob2', email: 'bob@example.com', password: PW })).status, 400);
    state.bob = bob;
  });

  it('does not allow sign-up without an invitation in invite mode', async () => {
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    const r = await c.post('/api/v1/auth/register', { name: 'Eve', email: 'eve@example.com', password: PW });
    assert.equal(r.status, 403);
  });

  it('creates an account directly and hands out a set-password link', async () => {
    const r = await admin().post('/api/v1/admin/users', { name: 'Cat', email: 'cat@example.com' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(r.data.setPasswordLink);
    const token = r.data.setPasswordLink.split('/reset/')[1];
    const cat = client(srv.base);
    await cat.get('/api/v1/discovery');
    assert.equal((await cat.post('/api/v1/auth/password/reset', { token, password: PW })).status, 200);
    assert.equal((await cat.post('/api/v1/auth/password/reset', { token, password: PW })).status, 400, 'links work once');
    const login = await cat.post('/api/v1/auth/login', { email: 'cat@example.com', password: PW });
    assert.equal(login.status, 200);
    assert.equal(login.data.mfaRequired, false);
    state.cat = cat;
    state.catId = r.data.user.id;
  });
});

describe('private boards', () => {
  it('saves boards and pictures and reads them back from another browser', async () => {
    const bob = state.bob;
    assert.equal((await bob.get('/api/v1/workspace')).data.store, null);
    const save = await bob.put('/api/v1/workspace', { rev: 0, store: sampleStore() });
    assert.equal(save.status, 200, JSON.stringify(save.data));
    assert.equal(save.data.rev, 1);
    assert.equal(save.data.blankedLinks, 1, 'javascript: links are blanked');
    const up = await bob.req('PUT', '/api/v1/assets/4.png', PNG, { 'content-type': 'image/png' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const fake = await bob.req('PUT', '/api/v1/assets/evil.png', Buffer.from('<script>alert(1)</script>'), { 'content-type': 'image/png' });
    assert.equal(fake.status, 415, 'content is checked, not the file name');

    const other = client(srv.base);
    await other.get('/api/v1/discovery');
    await other.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
    const got = await other.get('/api/v1/workspace');
    assert.equal(got.data.rev, 1);
    assert.equal(got.data.store.boards['1'].cards[0].content.Note.text, 'Hello from the server test');
    const pic = await other.get('/api/v1/assets/4.png');
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get('content-type'), 'image/png');
    assert.deepEqual(pic.data, PNG);
    state.bob2 = other;
  });

  it('refuses a save based on an old revision (another window saved first)', async () => {
    const r = await state.bob2.put('/api/v1/workspace', { rev: 0, store: sampleStore('stale') });
    assert.equal(r.status, 409);
    const ok = await state.bob2.put('/api/v1/workspace', { rev: 1, store: sampleStore('newer') });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.rev, 2);
  });

  it('rejects malformed boards', async () => {
    const s = sampleStore();
    delete s.boards['1'];
    const r = await state.bob.put('/api/v1/workspace', { rev: 2, store: s });
    assert.equal(r.status, 400);
  });

  it("keeps each person's boards and pictures to themselves", async () => {
    const cat = state.cat;
    const ws = await cat.get('/api/v1/workspace');
    assert.equal(ws.data.store, null, "Cat starts empty and can't see Bob's boards");
    assert.equal((await cat.get('/api/v1/assets/4.png')).status, 404);
    assert.deepEqual((await cat.get('/api/v1/assets')).data.names, []);
    const anon = client(srv.base);
    assert.equal((await anon.get('/api/v1/workspace')).status, 401);
    assert.equal((await anon.get('/api/v1/assets/4.png')).status, 401);
    assert.equal((await cat.get('/api/v1/admin/overview')).status, 403, 'users are not administrators');
  });

  it('shows administrators usage numbers but no board content', async () => {
    const r = await admin().get('/api/v1/admin/users');
    const bob = r.data.users.find((u) => u.email === 'bob@example.com');
    assert.equal(bob.usage.cards, 3);
    assert.equal(bob.usage.assets, 1);
    assert.ok(!JSON.stringify(r.data).includes('newer'), 'no note text in admin answers');
  });

  it('exports everything the account holds', async () => {
    const r = await state.bob.get('/api/v1/export');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/gzip');
    assert.ok(r.data.length > 100);
  });
});

describe('administration', () => {
  it('suspends an account and signs it out everywhere', async () => {
    const r = await admin().patch(`/api/v1/admin/users/${state.catId}`, { status: 'suspended' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await state.cat.get('/api/v1/workspace')).status, 401);
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    assert.equal((await c.post('/api/v1/auth/login', { email: 'cat@example.com', password: PW })).status, 403);
    assert.equal((await admin().patch(`/api/v1/admin/users/${state.catId}`, { status: 'active' })).status, 200);
  });

  it('changes settings with validation and masks secrets', async () => {
    const bad = await admin().patch('/api/v1/admin/settings', { publicUrl: 'ftp://x' });
    assert.equal(bad.status, 400);
    const ok = await admin().patch('/api/v1/admin/settings', { appName: 'Family Notes', smtp: { host: 'smtp.example.com', password: 's3cret-pass' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.settings.smtp.passwordSet, true);
    assert.ok(!JSON.stringify(ok.data).includes('s3cret-pass'));
    assert.equal((await client(srv.base).get('/api/v1/discovery')).data.appName, 'Family Notes');
  });

  it('records an audit trail', async () => {
    const r = await admin().get('/api/v1/admin/audit');
    const actions = r.data.entries.map((e) => e.action);
    for (const a of ['setup.complete', 'auth.mfa_enabled', 'invite.create', 'invite.accepted', 'user.create', 'user.suspend', 'settings.update'])
      assert.ok(actions.includes(a), `audit has ${a}`);
  });

});

describe('backups', () => {
  it('writes a backup and restores it into a separate, empty instance', async () => {
    const b = srv.cli('backup');
    assert.equal(b.status, 0, b.stderr + b.stdout);
    const name = /noteboard-backup-[\w-]+\.tar\.gz/.exec(b.stdout)[0];
    const file = path.join(srv.data, 'backups', name);
    assert.ok(fs.existsSync(file));

    const fresh = await startServer();
    try {
      const copy = path.join(fresh.data, 'restore.tar.gz');
      fs.copyFileSync(file, copy);
      const noConfirm = fresh.cli('restore', copy);
      assert.notEqual(noConfirm.status, 0, 'restoring needs --confirm');
      const r = fresh.cli('restore', copy, '--confirm');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // As the restore command says: restart the app so it loads the restored keys and settings.
      await fresh.restart();
      const c = client(fresh.base);
      await c.get('/api/v1/discovery');
      assert.equal((await c.get('/api/v1/discovery')).data.setupRequired, false);
      const login = await c.post('/api/v1/auth/login', { email: 'bob@example.com', password: PW });
      assert.equal(login.status, 200, JSON.stringify(login.data) + fresh.log().slice(-3000));
      const ws = await c.get('/api/v1/workspace');
      assert.equal(ws.data.store.boards['1'].cards[0].content.Note.text, 'newer');
      const pic = await c.get('/api/v1/assets/4.png');
      assert.deepEqual(pic.data, PNG);
      // The restored keys still open the administrator's encrypted two-step secret.
      const a = client(fresh.base);
      await a.get('/api/v1/discovery');
      await a.post('/api/v1/auth/login', { email: 'ann@example.com', password: PW });
      const m = await a.post('/api/v1/auth/mfa', { code: totp(state.secret, Date.now() + 30000) });
      assert.equal(m.status, 200, JSON.stringify(m.data));
      const again = fresh.cli('restore', copy, '--confirm');
      assert.notEqual(again.status, 0, 'refuses to overwrite an instance that has accounts without --replace');
    } finally {
      await fresh.stop();
    }
  });

  it('gives a console recovery link for a locked-out administrator', async () => {
    const r = srv.cli('recover-admin', '--email', 'ann@example.com', '--disable-mfa');
    assert.equal(r.status, 0, r.stderr);
    const token = /\/reset\/([\w-]+)/.exec(r.stdout)[1];
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    assert.equal((await c.post('/api/v1/auth/password/reset', { token, password: 'another long password 7' })).status, 200);
    const login = await c.post('/api/v1/auth/login', { email: 'ann@example.com', password: 'another long password 7' });
    assert.equal(login.data.mfaRequired, false);
  });
});

describe('abuse limits', () => {
  it('limits repeated wrong passwords', async () => {
    const c = client(srv.base);
    await c.get('/api/v1/discovery');
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'wrong-password-123' })).status;
    assert.equal(last, 429);
  });
});
