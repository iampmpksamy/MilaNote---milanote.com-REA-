/** Shared start-up for the API, the worker and the command line: logging and connections. */
import fs from 'node:fs';
import path from 'node:path';
import { type Config, loadConfig, validateConfig } from './config';
import { Ctx } from './ctx';
import { connectDatabase } from './db';
import { type Kv, MemoryKv, RedisKv } from './kv';
import { type AppSecrets, newSecrets, readSecrets } from './secrets';
import { type BlobStore, LocalBlobs, S3Blobs } from './services/blobs';

export function makeLogger(name: string, cfg: Config | null) {
  let file: string | null = null;
  if (cfg) {
    try {
      fs.mkdirSync(cfg.dirs.logs, { recursive: true });
      file = path.join(cfg.dirs.logs, `${name}.log`);
    } catch {
      file = null;
    }
  }
  return (msg: string) => {
    const line = `${new Date().toISOString()} [${name}] ${msg}`;
    console.log(line);
    if (!file) return;
    try {
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st && st.size > 10 * 1024 * 1024) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line + '\n', { mode: 0o640 });
    } catch {
      /* logging must never stop the server */
    }
  };
}

export function configOrExit(name: string): Config {
  const cfg = loadConfig();
  const errors = validateConfig(cfg);
  if (errors.length) {
    console.error(`[${name}] The configuration has problems:\n - ${errors.join('\n - ')}\nFix these environment values and start the app again.`);
    process.exit(2);
  }
  return cfg;
}

/** Tests and development can run without the init container (MONGO_URL + REDIS_URL=memory). */
export function secretsFor(cfg: Config): AppSecrets {
  const file = path.join(cfg.dirs.secrets, 'app-secrets.json');
  if (cfg.mongo.url && !fs.existsSync(file)) {
    const s = newSecrets();
    fs.mkdirSync(cfg.dirs.secrets, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
    return s;
  }
  return readSecrets(cfg.dirs.secrets);
}

export async function connectAll(name: string, opts: { bootstrap: boolean }) {
  const cfg = configOrExit(name);
  const log = makeLogger(name, cfg);
  const secrets = secretsFor(cfg);
  const d = await connectDatabase(cfg, secrets, log, opts);
  const kv: Kv = cfg.redis.url === 'memory' ? new MemoryKv() : RedisKv.connect({ ...cfg.redis, password: secrets.redisPassword });
  const blobs: BlobStore = cfg.storageDriver === 's3' ? new S3Blobs(cfg.s3) : new LocalBlobs(cfg.dirs.uploads);
  return new Ctx(cfg, secrets, d, kv, blobs, log);
}
