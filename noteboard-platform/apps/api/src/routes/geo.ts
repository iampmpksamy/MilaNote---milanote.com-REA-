/**
 * Map cards: place search and map pictures, fetched by this server so browsers and apps never talk
 * to a third party (the page's Content-Security-Policy stays 'self').
 *
 * - GET /geo/search?q=… → [{ label, lat, lng, type, detail }] from Nominatim (or MAP_SEARCH_URL).
 *   At most one request per second goes out for the whole server (the public Nominatim usage
 *   policy); a short queue waits its turn, a longer one gets 429. Answers are kept in memory (LRU,
 *   24 hours, 1000 searches).
 * - GET /geo/tile/:z/:x/:y.png → a 256×256 map picture from the OpenStreetMap tile server (or
 *   MAP_TILE_URL), kept on disk for 7 days (MAP_CACHE_DIR, not part of backups). At most two
 *   pictures are fetched at a time; the same picture asked for twice is fetched once.
 * - MAP_PROVIDER=off turns both off (404 maps_off) and discovery says features.maps=false.
 * See docs/MAPS.md.
 */
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { MapConfig } from '../config';
import { CTX, type Ctx } from '../ctx';
import { ApiFail, limit, type NbRequest, needUser } from '../http';

export const GEO_USER_AGENT = 'Noteboard self-hosted (https://github.com/iampmpksamy/MilaNote---milanote.com-REA-)';
const SEARCH_GAP_MS = 1000;
/** Searches wait at most this long for their turn before the server says "try again in a moment". */
const SEARCH_MAX_WAIT_MS = 3000;
const SEARCH_TTL_MS = 24 * 3600 * 1000;
const SEARCH_CACHE_SIZE = 1000;
const TILE_TTL_MS = 7 * 24 * 3600 * 1000;
const TILE_MAX_BYTES = 1024 * 1024;
const TILE_PARALLEL = 2;
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface Place {
  label: string;
  lat: number;
  lng: number;
  type: string;
  /** The full address, for telling places with the same name apart. */
  detail: string;
}

/** A small least-recently-used cache with an age limit. */
export class Lru<V> {
  private readonly m = new Map<string, { at: number; v: V }>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}
  get(k: string, now = Date.now()): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    this.m.delete(k);
    if (now - e.at > this.ttlMs) return undefined;
    this.m.set(k, e);
    return e.v;
  }
  set(k: string, v: V, now = Date.now()): void {
    this.m.delete(k);
    this.m.set(k, { at: now, v });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  get size() {
    return this.m.size;
  }
}

/** Hands out one turn per `gapMs` for the whole server; refuses when the wait would be too long. */
export class Pacer {
  private next = 0;
  constructor(
    private readonly gapMs: number,
    private readonly maxWaitMs: number,
  ) {}
  async turn(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    if (at - now > this.maxWaitMs) throw new ApiFail(429, 'busy', 'Lots of map searches right now; try again in a moment');
    this.next = at + this.gapMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

/** Lets at most `n` jobs run at the same time. */
class Gate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly n: number) {}
  async run<T>(f: () => Promise<T>): Promise<T> {
    if (this.running >= this.n) {
      // A long queue means someone is fetching far more than a person browsing a map would.
      if (this.waiting.length >= 64) throw new ApiFail(429, 'busy', 'The map is busy; try again in a moment');
      await new Promise<void>((r) => this.waiting.push(r));
    }
    this.running++;
    try {
      return await f();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

interface NominatimPlace {
  display_name?: string;
  name?: string;
  lat?: string | number;
  lon?: string | number;
  type?: string;
  category?: string;
  address?: Record<string, string>;
}

/** "Eiffel Tower, Paris, France" rather than the full postal address, when the parts are known. */
export function shortLabel(p: NominatimPlace): string {
  const full = String(p.display_name ?? '').trim();
  const a = p.address;
  if (!a) return full;
  const first = (p.name || full.split(',')[0] || '').trim();
  const place = a['city'] || a['town'] || a['village'] || a['hamlet'] || a['municipality'] || a['county'] || a['state'] || '';
  const parts: string[] = [];
  for (const x of [first, place, a['country'] ?? '']) if (x && !parts.includes(x)) parts.push(x);
  return parts.join(', ') || full;
}

export function toPlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const r of raw as NominatimPlace[]) {
    const lat = Number(r?.lat);
    const lng = Number(r?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const detail = String(r.display_name ?? '').slice(0, 400);
    out.push({ label: shortLabel(r).slice(0, 200) || detail.slice(0, 200), lat, lng, type: String(r.type ?? r.category ?? '').slice(0, 40), detail });
  }
  return out.slice(0, 10);
}

export function searchUrl(template: string, q: string): string {
  const v = encodeURIComponent(q);
  if (template.includes('{q}')) return template.replace('{q}', v);
  return `${template}${template.includes('?') ? '&' : '?'}q=${v}`;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** Checks z/x/y ("12", "2048", "1361.png"); null when they are not a tile of the map. */
export function parseTile(zs: string, xs: string, ys: string): { z: number; x: number; y: number } | null {
  const m = /^(\d{1,7})(?:\.png)?$/.exec(ys);
  if (!/^\d{1,2}$/.test(zs) || !/^\d{1,7}$/.test(xs) || !m) return null;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(m[1]);
  if (z < 0 || z > 18) return null; // the cards zoom to 18 at most
  const n = 2 ** z;
  return x < n && y < n ? { z, x, y } : null;
}

const searches = new Map<string, Lru<Place[]>>();
const pacers = new Map<string, Pacer>();
const searching = new Map<string, Promise<Place[]>>();

@Controller('geo')
export class GeoRoutes {
  private readonly cfg: MapConfig;
  private readonly cache: Lru<Place[]>;
  private readonly pacer: Pacer;
  private readonly gate = new Gate(TILE_PARALLEL);
  private readonly fetching = new Map<string, Promise<Buffer | null>>();

  constructor(@Inject(CTX) private readonly ctx: Ctx) {
    this.cfg = ctx.cfg.map;
    // One cache and one pace per upstream address for the whole process.
    const key = this.cfg.searchUrl;
    if (!searches.has(key)) searches.set(key, new Lru<Place[]>(SEARCH_CACHE_SIZE, SEARCH_TTL_MS));
    if (!pacers.has(key)) pacers.set(key, new Pacer(SEARCH_GAP_MS, SEARCH_MAX_WAIT_MS));
    this.cache = searches.get(key)!;
    this.pacer = pacers.get(key)!;
  }

  private on(): void {
    if (this.cfg.provider === 'off') throw new ApiFail(404, 'maps_off', 'Maps are turned off on this server');
  }

  @Get('search')
  async search(@Req() req: NbRequest, @Query('q') qIn: unknown): Promise<Place[]> {
    const { user } = needUser(req);
    this.on();
    // Per person, so one account can't use up the server's share of the free search service.
    await limit(this.ctx, `geo:search:${user._id}`, 30, 60, 'Too many map searches; wait a minute');
    const q = (typeof qIn === 'string' ? qIn : '').replace(/\s+/g, ' ').trim();
    if (!q) return [];
    if (q.length > 200) throw new ApiFail(400, 'too_long', 'Search for at most 200 characters');
    const key = q.toLowerCase();
    const known = this.cache.get(key);
    if (known) return known;
    // The same search asked for at the same time goes out once.
    let p = searching.get(key);
    if (!p) {
      p = this.fetchPlaces(q, key).finally(() => searching.delete(key));
      searching.set(key, p);
    }
    return p;
  }

  private async fetchPlaces(q: string, key: string): Promise<Place[]> {
    await this.pacer.turn();
    let r: globalThis.Response;
    try {
      r = await fetch(searchUrl(this.cfg.searchUrl, q), {
        headers: { 'User-Agent': GEO_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      this.ctx.log(`map search failed: ${(e as Error).message}`);
      throw new ApiFail(502, 'map_unavailable', "The map search service can't be reached right now");
    }
    if (r.status === 429) throw new ApiFail(429, 'busy', 'The map search service is busy; try again in a moment');
    if (!r.ok) {
      this.ctx.log(`map search answered ${r.status}`);
      throw new ApiFail(502, 'map_unavailable', 'The map search service is not working right now');
    }
    const places = toPlaces(await r.json().catch(() => null));
    this.cache.set(key, places);
    return places;
  }

  @Get('tile/:z/:x/:y')
  async tile(@Req() req: NbRequest, @Res() res: Response, @Param('z') zs: string, @Param('x') xs: string, @Param('y') ys: string) {
    const { user } = needUser(req);
    this.on();
    // Generous for browsing (a map card needs about a dozen), far below bulk downloading.
    await limit(this.ctx, `geo:tile:${user._id}`, 600, 60, 'Too many map pictures at once; wait a minute');
    const t = parseTile(zs, xs, ys);
    if (!t) throw new ApiFail(400, 'bad_tile', 'That is not a map tile (zoom 0-18, x and y within the map)');
    const file = path.join(this.cfg.cacheDir, String(t.z), String(t.x), `${t.y}.png`);
    let stale: Buffer | null = null;
    try {
      const st = await fs.promises.stat(file);
      const data = await fs.promises.readFile(file);
      if (Date.now() - st.mtimeMs < TILE_TTL_MS) return this.send(res, data, 'hit');
      stale = data;
    } catch {
      /* not kept yet */
    }
    let data = this.fetching.get(file);
    if (!data) {
      data = this.gate.run(() => this.fetchTile(t.z, t.x, t.y, file)).finally(() => this.fetching.delete(file));
      this.fetching.set(file, data);
    }
    const fresh = await data;
    if (fresh) return this.send(res, fresh, 'miss');
    if (stale) return this.send(res, stale, 'stale');
    throw new ApiFail(502, 'map_unavailable', "The map pictures can't be fetched right now");
  }

  private send(res: Response, data: Buffer, cache: string) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Noteboard-Cache', cache);
    res.end(data);
  }

  private async fetchTile(z: number, x: number, y: number, file: string): Promise<Buffer | null> {
    try {
      const r = await fetch(tileUrl(this.cfg.tileUrl, z, x, y), { headers: { 'User-Agent': GEO_USER_AGENT, Accept: 'image/png,image/*' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!r.ok) {
        this.ctx.log(`map tile ${z}/${x}/${y}: the tile server answered ${r.status}`);
        return null;
      }
      const data = Buffer.from(await r.arrayBuffer());
      // Only real PNG pictures of a sane size are kept and served.
      if (data.length > TILE_MAX_BYTES || data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) {
        this.ctx.log(`map tile ${z}/${x}/${y}: the tile server did not send a PNG picture`);
        return null;
      }
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, file);
      } catch (e) {
        this.ctx.log(`map tile cache not written: ${(e as Error).message}`);
      }
      return data;
    } catch (e) {
      this.ctx.log(`map tile ${z}/${x}/${y}: ${(e as Error).message}`);
      return null;
    }
  }
}

/**
 * Deletes kept map pictures older than `maxAgeDays` (run daily by the worker). The cache only holds
 * what people actually looked at; this keeps it from growing for ever. Returns files removed.
 */
export async function pruneTiles(dir: string, maxAgeDays = 30): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;
  const walk = async (d: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
        await fs.promises.rmdir(p).catch(() => undefined); // only succeeds when empty
      } else if (e.isFile()) {
        const st = await fs.promises.stat(p).catch(() => null);
        if (st && st.mtimeMs < cutoff) {
          await fs.promises.rm(p, { force: true });
          removed++;
        }
      }
    }
  };
  await walk(dir);
  return removed;
}
