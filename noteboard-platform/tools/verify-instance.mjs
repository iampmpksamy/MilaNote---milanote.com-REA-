// Signs in to a running Noteboard and prints what it holds, to compare before and after a restart,
// container recreation, upgrade or restore. Prints counts and hashes only, never note text.
//   node tools/verify-instance.mjs http://10.0.0.2:18765 bob@example.com 'password'
import crypto from 'node:crypto';

const [base, email, password] = process.argv.slice(2);
const jar = new Map();
async function req(method, url, body) {
  const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (jar.get('nb_csrf') && method !== 'GET') headers['x-csrf-token'] = jar.get('nb_csrf');
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return r;
}
const d = await (await req('GET', '/api/v1/discovery')).json();
const login = await req('POST', '/api/v1/auth/login', { email, password });
if (!login.ok) throw new Error(`sign-in failed: ${login.status} ${await login.text()}`);
const ws = await (await req('GET', '/api/v1/workspace')).json();
const boards = Object.values(ws.store?.boards ?? {});
const cards = boards.reduce((n, b) => n + b.cards.length, 0);
const images = boards.flatMap((b) => b.cards.filter((c) => c.content.Image).map((c) => c.content.Image.file));
const pics = [];
for (const name of images) {
  const r = await req('GET', `/api/v1/assets/${encodeURIComponent(name)}`);
  pics.push(`${r.status}:${crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex').slice(0, 12)}`);
}
const storeHash = crypto.createHash('sha256').update(JSON.stringify(ws.store)).digest('hex').slice(0, 16);
console.log(JSON.stringify({ server: d.serverVersion, setupRequired: d.setupRequired, rev: ws.rev, boards: boards.length, cards, storeHash, pictures: pics }));
