// A complete local server for development and the server-mode browser tests, without Docker:
// a throw-away MongoDB replica set, the built API (dist/apps/api) with the in-memory Redis stand-in,
// and the built web app with /api proxied to the API, like the gateway does.
// Usage: node tools/dev-stack.mjs [webPort=4322] [dataDir=tmp/dev-stack]
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const webPort = Number(process.argv[2] ?? 4322);
const data = resolve(process.argv[3] ?? 'tmp/dev-stack');
const apiPort = webPort + 1000;
const web = resolve('dist/apps/web/browser');
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const api = spawn(process.execPath, ['dist/apps/api/main.js'], {
  env: { ...process.env, PORT: String(apiPort), NOTEBOARD_DATA: data, MONGO_URL: rs.getUri('noteboard'), REDIS_URL: 'memory', MAIL_TRANSPORT: 'memory', ADMIN_MFA_REQUIRED: 'true' },
  stdio: 'inherit',
});
const stop = async () => {
  api.kill();
  await rs.stop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// The same security headers as the gateway, so CSP problems show up in local tests too.
const security = Object.fromEntries(
  readFileSync('apps/web/gateway/security-headers.conf', 'utf8')
    .split('\n')
    .map((l) => /^add_header\s+(\S+)\s+"(.*)"\s+always;/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname === '/.well-known/noteboard.json') {
    const p = request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    p.on('error', () => res.writeHead(502).end());
    req.pipe(p);
    return;
  }
  let file = normalize(join(web, decodeURIComponent(url.pathname)));
  if (!file.startsWith(web)) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(web, 'index.html');
  res.writeHead(200, { ...security, 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(webPort, '127.0.0.1', () => console.log(`dev stack on http://127.0.0.1:${webPort} (data ${data})`));
