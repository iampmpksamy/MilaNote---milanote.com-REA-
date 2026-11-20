/** noteboard-worker: scheduled and requested backups, retention, heartbeat. Same image as the API. */
import fs from 'node:fs';
import { SCHEMA_VERSION, schemaVersion } from './db';
import { connectAll } from './runtime';
import { pruneTiles } from './routes/geo';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p['year']}-${p['month']}-${p['day']}`, hm: `${p['hour']}:${p['minute']}` };
}

async function main() {
  const ctx = await connectAll('worker', { bootstrap: false });
  const { log, kv, cfg } = ctx;
  for (let i = 0; (await schemaVersion(ctx.d)) < SCHEMA_VERSION; i++) {
    if (i % 12 === 0) log('waiting for the API to prepare the database');
    await sleep(5000);
  }
  log(`worker ${cfg.version} running (time zone ${cfg.tz})`);
  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  // Redis heartbeat for the admin panel; a file for the container health check.
  const beat = async () => {
    const now = new Date().toISOString();
    try {
      fs.writeFileSync('/tmp/nb-worker-alive', now);
    } catch {
      /* not in a container */
    }
    await kv.set('nb:worker:heartbeat', now, 300).catch(() => undefined);
  };
  await beat();
  const beatTimer = setInterval(beat, 30_000);
  let lastTilePrune = 0;

  const runBackup = async (kind: 'scheduled' | 'manual', by: string) => {
    try {
      await ctx.backups.create(kind, by);
      await ctx.audit('backup.created', { details: { kind, by } });
    } catch (e) {
      log(`backup failed: ${(e as Error).message}`);
      await ctx.audit('backup.failed', { details: { kind, by, error: (e as Error).message } });
    }
    const s = await ctx.settings.get();
    await ctx.backups.prune(s.backup.retention, cfg.tz).catch((e) => log(`pruning failed: ${(e as Error).message}`));
  };

  let lastCheck = 0;
  while (running) {
    const job = await kv.pop('nb:jobs', 5).catch(async (e) => {
      log(`queue unavailable: ${(e as Error).message}`);
      await sleep(5000);
      return null;
    });
    if (job) {
      try {
        const j = JSON.parse(job) as { type: string; kind?: string; by?: string };
        if (j.type === 'backup') await runBackup('manual', j.by ?? 'admin');
      } catch (e) {
        log(`bad job ignored: ${(e as Error).message}`);
      }
    }
    if (cfg.map.provider !== 'off' && Date.now() - lastTilePrune > 86_400_000) {
      lastTilePrune = Date.now();
      const n = await pruneTiles(cfg.map.cacheDir).catch(() => 0);
      if (n) log(`removed ${n} map pictures not looked at for 30 days`);
    }
    if (Date.now() - lastCheck > 60_000) {
      lastCheck = Date.now();
      try {
        const s = await ctx.settings.get();
        if (s.backup.enabled) {
          const now = localParts(cfg.tz);
          if (now.hm >= s.backup.time) {
            const last = await ctx.d.c.backups.find({ kind: 'scheduled', status: { $in: ['ok', 'running'] } }).sort({ createdAt: -1 }).limit(1).next();
            if (!last || localParts(cfg.tz, last.createdAt).day !== now.day) await runBackup('scheduled', 'schedule');
          }
        }
      } catch (e) {
        log(`schedule check failed: ${(e as Error).message}`);
      }
    }
  }
  clearInterval(beatTimer);
  await kv.close();
  await ctx.d.close();
  log('worker stopped');
}

main().catch((e) => {
  console.error(`[worker] stopped with an error: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
