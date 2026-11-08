// Debug: does a client built from a snapshot stay in step with the world it came from?
// Loads the dev server's saved world (.vite/cw), copies it like a browser would, steps both,
// and reports the first month where their state hashes differ. Run: npm run world:sync

import { assemble, serializeDynamic, stateHash, step } from '../sim/index';

declare const process: { argv: string[] };
const fs = (await import('node:' + 'fs')) as { readFileSync(p: string, e: string): string };

const st = fs.readFileSync('.vite/cw/static.txt', 'utf8');
const server = assemble(st, fs.readFileSync('.vite/cw/dyn.txt', 'utf8'));
const client = assemble(st, serializeDynamic(server));
console.log(`start tick ${server.tick}, hashes ${stateHash(server)} / ${stateHash(client)}`);
const n = Number(process.argv[2]) || 240;
for (let k = 0; k < n; k++) {
  step(server);
  // The server trims its log; the client keeps everything.
  if (server.log.length > 300) { const d = server.log.length - 300; server.log.splice(0, d); server.logBase += d; }
  step(client);
  const a = stateHash(server);
  const b = stateHash(client);
  if (a !== b) {
    console.log(`DIVERGED at tick ${server.tick}`);
    const sa = JSON.parse(serializeDynamic(server));
    const sb = JSON.parse(serializeDynamic(client));
    for (const key of Object.keys(sa)) {
      if (key === 'log' || key === 'logBase') continue;
      if (JSON.stringify(sa[key]) !== JSON.stringify(sb[key])) console.log(`  differs: ${key}`);
    }
    break;
  }
  if (k === n - 1) console.log(`in step for ${n} months`);
}
