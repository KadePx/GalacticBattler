// Headless check of the founder systems: several player peoples act at random for centuries
// (edicts, omen answers, names, gifts, alliance offers, offerings) while the AI settles every
// omen nobody answers. Checks nothing crashes, saves round-trip, and prints what happened.
// Run: npx esbuild src/commonworld/dev/playerSim.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/playersim.mjs && node node_modules/.cache/playersim.mjs [years] [seed]

import { foundingSpots } from '../sim/civ';
import { createWorld, deserialize, serialize, step, worldHash, EDICTS, type Input } from '../sim/index';
import { influence, nameable } from '../sim/player';
import { Rand } from '../sim/rng';

declare const process: { argv: string[]; exit(code: number): never };

const years = Number(process.argv[2]) || 500;
const seed = Number(process.argv[3]) || 7;
const w = createWorld({ seed });
for (let t = 0; t < 60 * 12; t++) step(w);
const founders = ['fA', 'fB', 'fC', 'fD'];
const spots = foundingSpots(w, founders.length);
step(w, founders.slice(0, spots.length).map((f, i) => ({ k: 'found', founder: f, tile: spots[i], values: ['curious', 'devout', 'martial'] }) as Input));
console.log(`year 60: ${w.civs.filter((c) => c.founder).length} founders arrived`);

const r = new Rand(seed, 99);
let acts = 0;
for (let t = 0; t < years * 12; t++) {
  const inputs: Input[] = [];
  if (t % 6 === 0) {
    for (const f of founders) {
      const c = w.civs.find((x) => x.founder === f && x.died < 0);
      if (!c || influence(w, c) < 3 || !r.chance(0.3)) continue;
      const om = w.omens.find((o) => o.civ === c.id);
      const roll = r.int(5);
      if (om && r.chance(0.6)) inputs.push({ k: 'omen', founder: f, id: om.id, pick: r.int(om.k === 'sign' ? 3 : 2) });
      else if (roll === 0) inputs.push({ k: 'edict', founder: f, edict: r.pick(EDICTS) });
      else if (roll === 1 && c.contacts.length) inputs.push({ k: 'gift', founder: f, to: r.pick(c.contacts) });
      else if (roll === 2 && c.contacts.length) inputs.push({ k: 'propose', founder: f, to: r.pick(c.contacts) });
      else {
        const s = w.setts.find((x) => nameable(w, c, 'sett', x.id));
        if (s) inputs.push({ k: 'name', founder: f, what: 'sett', id: s.id, name: r.pick(['Haven', 'Brightwater', 'Stonereach', 'Fair Meet']) });
      }
    }
    const live = w.setts.filter((s) => s.died < 0);
    if (live.length && r.chance(0.5)) inputs.push({ k: 'offer', s: r.pick(live).id });
  }
  acts += inputs.length;
  step(w, inputs);
}

const kinds = new Map<string, number>();
for (const e of w.log) kinds.set(e.k, (kinds.get(e.k) ?? 0) + 1);
const show = ['omen', 'omen_claim', 'claim_war', 'omen_war', 'omen_sign', 'edict', 'renamed', 'gift', 'proposal', 'proposal_refused', 'ally', 'pilgrims', 'faith_found', 'convert', 'schism', 'wonder', 'revival', 'collapse', 'defect'];
console.log(`after ${years} more years (${acts} inputs): ${show.map((k) => `${k} ${kinds.get(k) ?? 0}`).join(', ')}`);
for (const f of founders) {
  const c = w.civs.find((x) => x.founder === f);
  if (c) console.log(`  ${f}: the ${c.name} ${c.died >= 0 ? `fell in year ${Math.floor(c.died / 12)}` : `alive, ${w.setts.filter((s) => s.civ === c.id && s.died < 0).length} towns, influence ${influence(w, c).toFixed(1)}, faith ${c.faith >= 0 ? w.faiths[c.faith].name : 'none'}`}`);
}
console.log(`open omens ${w.omens.length}; offerings ${w.setts.reduce((a, s) => a + (s.offers ?? 0), 0)}`);
const back = deserialize(serialize(w));
const ok = worldHash(back) === worldHash(w);
console.log(ok ? 'save round trip ok' : 'SAVE ROUND TRIP FAILED');
if (!ok) process.exit(1);
