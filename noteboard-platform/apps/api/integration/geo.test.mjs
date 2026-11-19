// Map cards: place search and map pictures through the server (/api/v1/geo/*), with a fake map
// service on this machine standing in for OpenStreetMap (the tests never use the internet).
// Run: npx nx run api:integration
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { client, PNG, startServer } from './harness.mjs';

const PW = 'correct horse battery 42';
const UA = 'Noteboard self-hosted (https://github.com/iampmpksamy/MilaNote---milanote.com-REA-)';

/** The fake map service: counts what it was asked, answers like Nominatim and the tile server. */
const fake = { searches: [], tiles: [], agents: new Set() };
let upstream;
let base;

function startFake() {
  return new Promise((resolve) => {
    upstream = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      fake.agents.add(req.headers['user-agent']);
      if (u.pathname === '/search') {
        const q = u.searchParams.get('q') ?? '';
        fake.searches.push({ q, at: Date.now(), format: u.searchParams.get('format') });
        const body = /eiffel/i.test(q)
          ? [
              {
                display_name: 'Eiffel Tower, 5, Avenue Anatole France, Paris 7e Arrondissement, Paris, Île-de-France, 75007, France',
                name: 'Eiffel Tower',
                lat: '48.8582599',
                lon: '2.2945006',
                type: 'attraction',
                address: { city: 'Paris', country: 'France' },
              },
              { display_name: 'Eiffel Tower, Las Vegas, Nevada, United States', lat: '36.1125', lon: '-115.1726', type: 'attraction' },
              { display_name: 'Broken', lat: 'x', lon: '1' },
            ]
          : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      const m = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u.pathname);
      if (m) {
        fake.tiles.push(m.slice(1).join('/'));
        if (m[1] === '5') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>not a picture</html>');
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG);
        return;
      }
      res.writeHead(404).end();
    }).listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${upstream.address().port}`;
      resolve();
    });
  });
}

async function signedIn(srv) {
  const c = client(srv.base);
  await c.get('/api/v1/discovery');
  const r = await c.post('/api/v1/setup', { token: srv.setupToken(), name: 'Ann Admin', email: 'ann@example.com', password: PW, passwordConfirm: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

describe('maps on (fake OpenStreetMap)', () => {
  let srv;
  let c;
  before(async () => {
    await startFake();
    srv = await startServer({ MAP_SEARCH_URL: `${base}/search?format=jsonv2&limit=6&q={q}`, MAP_TILE_URL: `${base}/tiles/{z}/{x}/{y}.png` });
    c = await signedIn(srv);
  });
  after(async () => {
    await srv?.stop();
    upstream?.close();
  });

  it('discovery says maps are available', async () => {
    const d = await client(srv.base).get('/api/v1/discovery');
    assert.equal(d.data.features.maps, true);
  });

  it('needs a signed-in person', async () => {
    const anon = client(srv.base);
    assert.equal((await anon.get('/api/v1/geo/search?q=eiffel')).status, 401);
    assert.equal((await anon.get('/api/v1/geo/tile/1/0/0.png')).status, 401);
    assert.equal(fake.searches.length + fake.tiles.length, 0, 'nothing was sent upstream');
  });

  it('searches places and answers label, lat, lng and type', async () => {
    const r = await c.get('/api/v1/geo/search?q=' + encodeURIComponent('Eiffel tower'));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.length, 2, 'the broken entry is left out');
    assert.deepEqual(
      { label: r.data[0].label, lat: r.data[0].lat, lng: r.data[0].lng, type: r.data[0].type },
      { label: 'Eiffel Tower, Paris, France', lat: 48.8582599, lng: 2.2945006, type: 'attraction' },
    );
    assert.match(r.data[0].detail, /Avenue Anatole France/);
    assert.equal(r.data[1].label, 'Eiffel Tower, Las Vegas, Nevada, United States');
    assert.equal(fake.searches.length, 1);
    assert.equal(fake.searches[0].q, 'Eiffel tower');
    assert.equal(fake.searches[0].format, 'jsonv2');
    assert.deepEqual([...fake.agents], [UA]);
    assert.deepEqual((await c.get('/api/v1/geo/search?q=')).data, []);
    assert.equal((await c.get('/api/v1/geo/search?q=' + 'a'.repeat(201))).status, 400);
  });

  it('keeps answers: the same search again does not go upstream', async () => {
    const r = await c.get('/api/v1/geo/search?q=' + encodeURIComponent('  eiffel   TOWER '));
    assert.equal(r.status, 200);
    assert.equal(r.data[0].label, 'Eiffel Tower, Paris, France');
    assert.equal(fake.searches.length, 1);
  });

  it('sends at most one search per second upstream, and says "try again" when too many wait', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    fake.searches.length = 0;
    const two = await Promise.all([c.get('/api/v1/geo/search?q=alpha'), c.get('/api/v1/geo/search?q=beta')]);
    assert.deepEqual(
      two.map((r) => r.status),
      [200, 200],
    );
    assert.equal(fake.searches.length, 2);
    assert.ok(fake.searches[1].at - fake.searches[0].at >= 950, `searches ${fake.searches[1].at - fake.searches[0].at} ms apart`);
    const many = await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((q) => c.get('/api/v1/geo/search?q=' + q)));
    const busy = many.filter((r) => r.status === 429);
    assert.ok(busy.length >= 1, 'some searches are refused');
    assert.equal(busy[0].data.error.code, 'busy');
    assert.match(busy[0].data.error.message, /try again in a moment/);
    assert.ok(many.filter((r) => r.status === 200).length >= 3);
    const times = fake.searches.map((s) => s.at);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 950, 'never faster than one per second');
  });

  it('serves map pictures and keeps them on disk', async () => {
    const r = await c.get('/api/v1/geo/tile/3/4/2.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('cache-control'), 'private, max-age=86400');
    assert.ok(Buffer.compare(r.data, PNG) === 0);
    assert.deepEqual(fake.tiles, ['3/4/2']);
    const file = path.join(srv.data, 'uploads', '.map-tiles', '3', '4', '2.png');
    assert.ok(fs.existsSync(file), 'kept on disk');
    const again = await c.get('/api/v1/geo/tile/3/4/2.png');
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('x-noteboard-cache'), 'hit');
    assert.deepEqual(fake.tiles, ['3/4/2'], 'the second time comes from the disk');
    // Kept across a restart; older than 7 days is fetched again.
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    fs.utimesSync(file, old, old);
    assert.equal((await c.get('/api/v1/geo/tile/3/4/2.png')).status, 200);
    assert.deepEqual(fake.tiles, ['3/4/2', '3/4/2']);
  });

  it('refuses coordinates outside the map', async () => {
    for (const t of ['20/0/0.png', '3/8/0.png', '3/0/8.png', 'a/0/0.png', '3/-1/0.png', '3/0/1.jpg', '0/0/1.png']) {
      const r = await c.get(`/api/v1/geo/tile/${t}`);
      assert.equal(r.status, 400, t);
      assert.equal(r.data.error.code, 'bad_tile');
    }
    assert.equal((await c.get('/api/v1/geo/tile/0/0/0.png')).status, 200);
    assert.equal((await c.get('/api/v1/geo/tile/19/524287/524287.png')).status, 200);
  });

  it('never passes on something that is not a picture', async () => {
    const r = await c.get('/api/v1/geo/tile/5/1/1.png');
    assert.equal(r.status, 502);
    assert.equal(r.data.error.code, 'map_unavailable');
    assert.equal(fs.existsSync(path.join(srv.data, 'uploads', '.map-tiles', '5', '1', '1.png')), false);
  });
});

describe('maps off (MAP_PROVIDER=off)', () => {
  let srv;
  let c;
  before(async () => {
    srv = await startServer({ MAP_PROVIDER: 'off', MAP_SEARCH_URL: 'http://127.0.0.1:9/search', MAP_TILE_URL: 'http://127.0.0.1:9/{z}/{x}/{y}.png' });
    c = await signedIn(srv);
  });
  after(async () => {
    await srv?.stop();
  });

  it('discovery says so and both routes answer maps_off', async () => {
    assert.equal((await c.get('/api/v1/discovery')).data.features.maps, false);
    const s = await c.get('/api/v1/geo/search?q=eiffel');
    assert.equal(s.status, 404);
    assert.equal(s.data.error.code, 'maps_off');
    const t = await c.get('/api/v1/geo/tile/1/0/0.png');
    assert.equal(t.status, 404);
    assert.equal(t.data.error.code, 'maps_off');
  });
});
