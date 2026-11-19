// Starts the built server (dist/apps/api/main.js) against a throw-away MongoDB replica set and
// talks to it over real HTTP, keeping cookies and the CSRF header like a browser would.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const root = path.resolve(import.meta.dirname, '../../..');
const dist = path.join(root, 'dist/apps/api');

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

export async function startServer(extraEnv = {}) {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-int-'));
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    NOTEBOARD_DATA: data,
    MONGO_URL: rs.getUri('noteboard'),
    REDIS_URL: 'memory',
    MAIL_TRANSPORT: 'memory',
    TZ: 'Asia/Kolkata',
    ...extraEnv,
  };
  let proc;
  let log = '';
  const base = `http://127.0.0.1:${port}`;
  const launch = async () => {
    proc = spawn(process.execPath, [path.join(dist, 'main.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => (log += d));
    proc.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 200; i++) {
      try {
        const r = await fetch(`${base}/api/v1/health`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      if (proc.exitCode !== null) throw new Error(`server exited:\n${log}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const halt = async () => {
    proc.kill();
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
  };
  await launch();
  return {
    async restart() {
      await halt();
      await launch();
    },
    base,
    data,
    env,
    log: () => log,
    setupToken: () => JSON.parse(fs.readFileSync(path.join(data, 'config/setup-token.json'), 'utf8')).token,
    cli: (...args) => spawnSync(process.execPath, [path.join(dist, 'cli.js'), ...args], { env, encoding: 'utf8' }),
    async stop() {
      await halt();
      await rs.stop();
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

/** A browser-like client: keeps cookies, sends the CSRF token back on changes. */
export function client(base) {
  const jar = new Map();
  const c = {
    jar,
    async req(method, url, body, headers = {}) {
      const h = { ...headers };
      if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const csrf = jar.get('nb_csrf');
      if (csrf && method !== 'GET') h['x-csrf-token'] = csrf;
      let payload = body;
      if (body !== undefined && !Buffer.isBuffer(body)) {
        h['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const r = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) {
        const [kv, ...attrs] = sc.split(';');
        const i = kv.indexOf('=');
        const k = kv.slice(0, i).trim();
        const v = kv.slice(i + 1).trim();
        if (attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k);
        else jar.set(k, v);
      }
      const type = r.headers.get('content-type') ?? '';
      const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
      return { status: r.status, data, headers: r.headers };
    },
    get: (u) => c.req('GET', u),
    post: (u, b = {}) => c.req('POST', u, b),
    put: (u, b) => c.req('PUT', u, b),
    patch: (u, b) => c.req('PATCH', u, b),
    del: (u) => c.req('DELETE', u),
  };
  return c;
}

// RFC 6238 TOTP, to act as the user's authenticator app.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totp(secret, at = Date.now()) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of secret.replace(/=+$/, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function sampleStore(note = 'Hello from the server test') {
  return {
    boards: {
      1: {
        id: 1,
        name: 'Home',
        parent: null,
        color: 0,
        icon: null,
        cards: [
          { id: 2, pos: [10, 10], width: 300, color: 0, z: 1, container: 'Canvas', locked: false, align: 0, content: { Note: { text: note } } },
          { id: 3, pos: [10, 200], width: 280, color: 0, z: 2, container: 'Canvas', locked: false, align: 0, content: { Link: { url: 'javascript:alert(1)', title: 'bad' } } },
          { id: 4, pos: [400, 10], width: 200, color: 0, z: 3, container: 'Canvas', locked: false, align: 0, content: { Image: { file: '4.png', caption: '', aspect: 1 } } },
        ],
        arrows: [],
        unsorted: [],
        pan: [0, 0],
        zoom: 1,
      },
    },
    root: 1,
    next_id: 5,
    trash: [],
    version: 2,
  };
}
