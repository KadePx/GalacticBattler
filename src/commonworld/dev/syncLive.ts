// Debug: join a running world server like a browser does (static + snapshot, then sync) and
// check the state hash. Run: npm run world:synclive -- [base url]

import { assemble, stateHash, step, type Input } from '../sim/index';

declare const process: { argv: string[] };
const base = process.argv[2] ?? 'http://localhost:5175';

async function gz(p: string): Promise<string> {
  const r = await fetch(`${base}/api/cw/${p}`);
  return new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).text();
}

const st = (await (await fetch(`${base}/api/cw/state`)).json()) as { world: string; tick: number; hash: string };
const w = assemble(await gz('static'), await gz('snapshot'));
console.log(`snapshot tick ${w.tick} hash ${stateHash(w)} (server said ${st.tick} ${st.hash})`);
await new Promise((r) => setTimeout(r, 4000));
const s = (await (await fetch(`${base}/api/cw/sync?world=${st.world}&tick=${w.tick}`)).json()) as { tick: number; hash: string; inputs: [number, Input][] };
const from = w.tick;
while (w.tick < s.tick) step(w, s.inputs.filter(([t]) => t === w.tick).map(([, i]) => i));
console.log(`stepped ${w.tick - from} months: client ${stateHash(w)} server ${s.hash} -> ${stateHash(w) === s.hash ? 'IN STEP' : 'MISMATCH'}`);
