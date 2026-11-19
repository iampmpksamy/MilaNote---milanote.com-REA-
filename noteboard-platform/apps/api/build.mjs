// Bundles the server into dist/apps/api: main.js (API), worker.js, init.js and cli.js.
// Everything is bundled except optional native add-ons the libraries load only when configured.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'dist/apps/api');
const version = process.env.NOTEBOARD_VERSION || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.rmSync(out, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: { main: 'apps/api/src/main.ts', worker: 'apps/api/src/worker.ts', init: 'apps/api/src/init.ts', cli: 'apps/api/src/cli.ts' },
  outdir: out,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  legalComments: 'linked',
  tsconfig: 'apps/api/tsconfig.app.json',
  define: { 'process.env.NOTEBOARD_VERSION': JSON.stringify(version) },
  external: [
    '@nestjs/microservices', '@nestjs/microservices/*', '@nestjs/websockets', '@nestjs/websockets/*', 'class-validator', 'class-transformer',
    '@fastify/static', 'kerberos', '@mongodb-js/zstd', '@aws-sdk/credential-providers', 'gcp-metadata', 'snappy', 'socks', 'aws4',
    'mongodb-client-encryption',
  ],
  logLevel: 'warning',
});
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'noteboard-server', version, private: true, main: 'main.js' }, null, 2));
console.log(`built noteboard-server ${version} -> ${path.relative(root, out)}`);
