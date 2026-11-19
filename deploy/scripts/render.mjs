// Writes the repository's default deployment files from deploy/installer/compose.js, the same code
// the offline settings generator uses. `--check` only compares (for CI) and fails when they differ.
//   node deploy/scripts/render.mjs [--check] [--version 3.0.0-alpha.2]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const deploy = path.resolve(import.meta.dirname, '..');
const gen = require(path.join(deploy, 'installer', 'compose.js'));
const args = process.argv.slice(2);
const check = args.includes('--check');
const vi = args.indexOf('--version');
const opts = vi >= 0 ? { version: args[vi + 1] } : {};

const problems = gen.validate(opts);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const files = {
  'casaos/docker-compose.yml': gen.render(opts, 'casaos'),
  'compose/docker-compose.yml': gen.render(opts, 'compose'),
  'compose/.env.example': gen.envFile(opts),
};
let stale = 0;
for (const [rel, text] of Object.entries(files)) {
  const file = path.join(deploy, rel);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (old === text) continue;
  if (check) {
    console.error(`out of date: deploy/${rel} (run node deploy/scripts/render.mjs)`);
    stale++;
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote deploy/${rel}`);
  }
}
process.exit(stale ? 1 : 0);
