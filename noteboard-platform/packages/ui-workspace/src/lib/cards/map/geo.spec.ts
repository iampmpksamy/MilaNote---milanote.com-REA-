import { TestBed } from '@angular/core/testing';
import { MemoryStorage, STORAGE } from '../../storage';
import { clampZoom, mapClient, osmLink, problemOf, project, tileGrid } from './geo';

describe('map tiles', () => {
  it('projects places like the OpenStreetMap tile scheme', () => {
    // Zoom 0: the whole world is one 256 px tile, (0, 0) is its middle.
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    // The Eiffel Tower is in tile 16/33185/22545 (the slippy-map formula, written differently).
    const p = project(48.8582599, 2.2945006, 16);
    expect(Math.floor(p.x / 256)).toBe(33185);
    expect(Math.floor(p.y / 256)).toBe(22545);
    const r = (48.8582599 * Math.PI) / 180;
    expect(p.y / 256 / 2 ** 16).toBeCloseTo((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2, 9);
    // The poles are clamped, not infinite.
    expect(Number.isFinite(project(90, 0, 3).y)).toBe(true);
  });

  it('covers the picture with tiles, centred on the place', () => {
    const g = tileGrid(0, 0, 2, 320, 200);
    // Centre at world pixel (512, 512): the picture spans 352..672 × 412..612.
    expect(g.map((t) => t.id)).toEqual(['1/1', '2/1', '1/2', '2/2']);
    expect(g[0]).toMatchObject({ z: 2, x: 1, y: 1, left: -96, top: -156 });
    for (const t of g) {
      expect(t.left).toBeLessThan(320);
      expect(t.top).toBeLessThan(200);
      expect(t.left + 256).toBeGreaterThan(0);
      expect(t.top + 256).toBeGreaterThan(0);
    }
  });

  it('wraps sideways at the date line and stops at the top and bottom of the world', () => {
    const g = tileGrid(80, 179.9, 2, 600, 400);
    expect(g.every((t) => t.x >= 0 && t.x < 4 && t.y >= 0 && t.y < 4)).toBe(true);
    expect(new Set(g.map((t) => t.id)).size).toBe(g.length);
    expect(g.some((t) => t.x === 0)).toBe(true);
    expect(g.every((t) => t.y >= 0)).toBe(true);
  });

  it('links to openstreetmap.org with a pin, and clamps zoom to 2-18', () => {
    expect(osmLink(48.8582599, 2.2945006, 15)).toBe('https://www.openstreetmap.org/?mlat=48.85826&mlon=2.29450#map=15/48.85826/2.29450');
    expect(clampZoom(1)).toBe(2);
    expect(clampZoom(25)).toBe(18);
    expect(clampZoom(Number.NaN)).toBe(13);
  });

  it('tells no connection, maps off and busy apart', () => {
    expect(problemOf({ status: 0, code: 'offline' })).toBe('offline');
    expect(problemOf({ status: 404, code: 'maps_off' })).toBe('off');
    expect(problemOf({ status: 429, code: 'busy' })).toBe('busy');
    expect(problemOf({ status: 502, code: 'map_unavailable' })).toBe('error');
  });
});

describe('map client', () => {
  it('is unavailable without a server', () => {
    TestBed.configureTestingModule({ providers: [{ provide: STORAGE, useValue: new MemoryStorage() }] });
    const c = TestBed.runInInjectionContext(() => mapClient());
    expect(c.available).toBe(false);
  });

  it('asks the server, and fetches each map picture once per session', async () => {
    const calls: string[] = [];
    let fail = true;
    const storage = Object.assign(new MemoryStorage(), {
      apiGet: async (path: string, as: 'json' | 'blob') => {
        calls.push(`${as} ${path}`);
        if (as === 'json') return [{ label: 'Eiffel Tower, Paris, France', lat: 48.85, lng: 2.29, type: 'attraction' }, { label: 'bad', lat: 'x' }];
        if (fail) throw Object.assign(new Error('offline'), { status: 0 });
        return new Blob(['png'], { type: 'image/png' });
      },
    });
    TestBed.configureTestingModule({ providers: [{ provide: STORAGE, useValue: storage }] });
    const c = TestBed.runInInjectionContext(() => mapClient());
    expect(c.available).toBe(true);
    const found = await c.search('Eiffel tower');
    expect(found.map((p) => p.label)).toEqual(['Eiffel Tower, Paris, France']);
    expect(calls).toEqual(['json /geo/search?q=Eiffel%20tower']);
    await expect(c.tile(3, 4, 2)).rejects.toMatchObject({ status: 0 });
    fail = false;
    const url = await c.tile(3, 4, 2);
    expect(url).toMatch(/^blob:/);
    expect(await c.tile(3, 4, 2)).toBe(url);
    expect(calls.filter((x) => x === 'blob /geo/tile/3/4/2.png')).toHaveLength(2);
  });
});
