/**
 * Map card helpers: Web-Mercator tile maths and the way to the server's map routes
 * (/api/v1/geo/*, see apps/api/src/routes/geo.ts). The page never talks to a map service itself.
 */
import { inject } from '@angular/core';
import { STORAGE, type StorageAdapter } from '../../storage';

export const TILE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

export interface Place {
  label: string;
  lat: number;
  lng: number;
  type: string;
  detail?: string;
}

export interface TileSpot {
  /** Unique in the grid (the world repeats sideways at low zoom). */
  id: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/** World pixel position of a place at zoom `z` (256 px tiles). */
export function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const size = TILE * 2 ** z;
  const s = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

/** The tiles that cover a `w`×`h` picture centred on the place, with their offsets in it. */
export function tileGrid(lat: number, lng: number, z: number, w: number, h: number): TileSpot[] {
  const c = project(lat, lng, z);
  const left = c.x - w / 2;
  const top = c.y - h / 2;
  const n = 2 ** z;
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((left + w - 1) / TILE);
  const y0 = Math.max(0, Math.floor(top / TILE));
  const y1 = Math.min(n - 1, Math.floor((top + h - 1) / TILE));
  const out: TileSpot[] = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      out.push({ id: `${tx}/${ty}`, z, x: ((tx % n) + n) % n, y: ty, left: Math.round(tx * TILE - left), top: Math.round(ty * TILE - top) });
  return out;
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(Number.isFinite(z) ? z : 13)));

/** The place on openstreetmap.org (opened by the person's browser, outside the app). */
export function osmLink(lat: number, lng: number, zoom: number): string {
  const a = lat.toFixed(5);
  const o = lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${o}#map=${clampZoom(zoom)}/${a}/${o}`;
}

export type MapProblem = 'offline' | 'off' | 'busy' | 'error';

/** What went wrong, from the error the storage's apiGet threw (`status` 0 = no connection). */
export function problemOf(e: unknown): MapProblem {
  const x = e as { status?: number; code?: string } | null;
  if (x?.code === 'maps_off') return 'off';
  if (x?.status === 429 || x?.code === 'busy') return 'busy';
  if (x?.status === 0 || x?.code === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
  return 'error';
}

/** Map pictures fetched in this session, per account (object URLs, kept until the page closes). */
const sessions = new WeakMap<StorageAdapter, Map<string, Promise<string>>>();

export interface MapClient {
  /** False in local mode: maps come through a Noteboard server. */
  readonly available: boolean;
  search(q: string): Promise<Place[]>;
  /** An object URL for the picture; rejects (and is tried again next time) when it can't be had. */
  tile(z: number, x: number, y: number): Promise<string>;
}

/** Call in an injection context (a card's field initialiser). */
export function mapClient(): MapClient {
  const storage = inject(STORAGE, { optional: true });
  const get = storage?.apiGet?.bind(storage);
  if (!storage || !get) {
    const none = () => Promise.reject(Object.assign(new Error('Maps need a Noteboard server'), { status: -1, code: 'no_server' }));
    return { available: false, search: none, tile: none };
  }
  let tiles = sessions.get(storage);
  if (!tiles) sessions.set(storage, (tiles = new Map()));
  const cache = tiles;
  return {
    available: true,
    async search(q: string) {
      const r = await get(`/geo/search?q=${encodeURIComponent(q)}`, 'json');
      return Array.isArray(r) ? (r as Place[]).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : [];
    },
    tile(z: number, x: number, y: number) {
      const key = `${z}/${x}/${y}`;
      let p = cache.get(key);
      if (!p) {
        p = (get(`/geo/tile/${key}.png`, 'blob') as Promise<Blob>).then((b) => URL.createObjectURL(b));
        p.catch(() => cache.delete(key));
        cache.set(key, p);
      }
      return p;
    },
  };
}
