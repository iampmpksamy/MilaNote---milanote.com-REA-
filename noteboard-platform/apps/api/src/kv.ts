/**
 * Redis access used for rate limits, locks, the worker's job queue and heartbeats.
 * MemoryKv stands in for Redis in tests and single-process development (REDIS_URL=memory).
 */
import { Redis } from 'ioredis';

export interface Kv {
  /** Increments a counter that expires `ttlSec` after it was first set; returns the new value. */
  hit(key: string, ttlSec: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** Sets only if absent (a lock); true when this call set it. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  push(queue: string, value: string): Promise<void>;
  /** Waits up to `timeoutSec` for the oldest queued value. */
  pop(queue: string, timeoutSec: number): Promise<string | null>;
  len(queue: string): Promise<number>;
  ping(): Promise<number>;
  info(): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export class RedisKv implements Kv {
  private blocking: Redis | null = null;
  constructor(private readonly r: Redis) {}

  static connect(opts: { host: string; port: number; url: string | null; password: string }): RedisKv {
    const common = { password: opts.password || undefined, lazyConnect: false, maxRetriesPerRequest: 3, enableOfflineQueue: true };
    const r = opts.url ? new Redis(opts.url, common) : new Redis({ host: opts.host, port: opts.port, ...common });
    r.on('error', () => undefined); // reported through ping()/health instead of crashing
    return new RedisKv(r);
  }
  async hit(key: string, ttlSec: number) {
    const [[, n]] = (await this.r.multi().incr(key).expire(key, ttlSec, 'NX').exec()) as [[unknown, number]];
    return n;
  }
  get(key: string) {
    return this.r.get(key);
  }
  async set(key: string, value: string, ttlSec?: number) {
    if (ttlSec) await this.r.set(key, value, 'EX', ttlSec);
    else await this.r.set(key, value);
  }
  async setNx(key: string, value: string, ttlSec: number) {
    return (await this.r.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async push(queue: string, value: string) {
    await this.r.lpush(queue, value);
  }
  async pop(queue: string, timeoutSec: number) {
    if (!this.blocking) {
      this.blocking = this.r.duplicate();
      this.blocking.on('error', () => undefined);
    }
    const res = await this.blocking.brpop(queue, timeoutSec);
    return res ? res[1] : null;
  }
  len(queue: string) {
    return this.r.llen(queue);
  }
  async ping() {
    const t = performance.now();
    await this.r.ping();
    return Math.round((performance.now() - t) * 10) / 10;
  }
  async info() {
    const text = await this.r.info();
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = /^([a-z_0-9]+):(.*)\r?$/.exec(line);
      if (m && ['redis_version', 'used_memory_human', 'uptime_in_seconds', 'connected_clients', 'aof_enabled'].includes(m[1])) out[m[1]] = m[2].trim();
    }
    return out;
  }
  async close() {
    this.blocking?.disconnect();
    await this.r.quit().catch(() => undefined);
  }
}

export class MemoryKv implements Kv {
  private m = new Map<string, { v: string; exp: number }>();
  private q = new Map<string, string[]>();
  private live(key: string) {
    const e = this.m.get(key);
    if (e && e.exp && e.exp < Date.now()) this.m.delete(key);
    return this.m.get(key);
  }
  async hit(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.m.set(key, { v: String(n), exp: e?.exp || Date.now() + ttlSec * 1000 });
    return n;
  }
  async get(key: string) {
    return this.live(key)?.v ?? null;
  }
  async set(key: string, value: string, ttlSec?: number) {
    this.m.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  }
  async setNx(key: string, value: string, ttlSec: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async push(queue: string, value: string) {
    (this.q.get(queue) ?? this.q.set(queue, []).get(queue)!).unshift(value);
  }
  async pop(queue: string, timeoutSec: number) {
    const end = Date.now() + timeoutSec * 1000;
    for (;;) {
      const v = this.q.get(queue)?.pop();
      if (v !== undefined) return v;
      if (Date.now() >= end) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  async len(queue: string) {
    return this.q.get(queue)?.length ?? 0;
  }
  async ping() {
    return 0;
  }
  async info() {
    return { redis_version: 'memory (tests only)' };
  }
  async close() {
    /* nothing */
  }
}
