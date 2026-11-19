// A stand-in for OpenStreetMap in the map card browser test (playwright.map.config.mts): place
// search like Nominatim and 256×256 PNG map pictures drawn here, so tests never use the internet.
// Usage: node apps/web-e2e/server/fake-geo.mjs <port>
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const port = Number(process.argv[2] ?? 47348);
const stats = { searches: 0, tiles: 0, agents: [] };

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A map-like picture: land colour, a few "streets", a park and water, different per tile. */
function tilePng(z, x, y) {
  const w = 256;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  const seed = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  for (let j = 0; j < w; j++) {
    raw[j * (w * 3 + 1)] = 0;
    for (let i = 0; i < w; i++) {
      let c = [242, 239, 233];
      const gx = (i + (seed & 63)) % 64;
      const gy = (j + ((seed >> 6) & 63)) % 64;
      if ((i - 180) ** 2 + (j - 70) ** 2 < 900) c = [200, 230, 190];
      if (j > 200 + 12 * Math.sin((i + x * 256) / 30)) c = [170, 211, 223];
      if (gx < 3 || gy < 3) c = [255, 255, 255];
      if (gx === 3 || gy === 3) c = [214, 210, 202];
      raw.set(c, j * (w * 3 + 1) + 1 + i * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PLACES = [
  {
    display_name: 'Eiffel Tower, 5, Avenue Anatole France, Quartier du Gros-Caillou, Paris 7e Arrondissement, Paris, Île-de-France, France métropolitaine, 75007, France',
    name: 'Eiffel Tower',
    lat: '48.8582599',
    lon: '2.2945006',
    type: 'attraction',
    address: { city: 'Paris', country: 'France' },
  },
  { display_name: 'Eiffel Tower, 3655, Las Vegas Boulevard South, Paradise, Clark County, Nevada, 89109, United States', name: 'Eiffel Tower', lat: '36.1125', lon: '-115.1726', type: 'attraction', address: { town: 'Paradise', country: 'United States' } },
];

createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/health') return void res.end('ok');
  if (u.pathname === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify(stats));
  }
  // Who asks for places and pictures (should only ever be the Noteboard server).
  if (!stats.agents.includes(req.headers['user-agent'])) stats.agents.push(req.headers['user-agent']);
  if (u.pathname === '/search') {
    stats.searches++;
    const q = u.searchParams.get('q') ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify(/eiffel/i.test(q) ? PLACES : []));
  }
  const m = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u.pathname);
  if (m) {
    stats.tiles++;
    res.writeHead(200, { 'content-type': 'image/png' });
    return void res.end(tilePng(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1', () => console.log(`fake map service on http://127.0.0.1:${port}`));
