// Headless world runner for Commonworld. Not part of the game bundle.
//
//   npm run world                        500 years, 20 civs, seed 1
//   npm run world -- 1000 40 7           years, civs, seed
//   npm run world -- 1000 40 7 128x96    plus map size
//   npm run world -- golden              determinism check against dev/golden.json
//   npm run world -- golden --update     accept the current result as the new golden hash

import { recent } from '../chronicle';
import { suggestSpots } from '../sim/civ';
import { createWorld, deserialize, serialize, step, worldHash, AGES, VALUES, type World } from '../sim/index';
import { civAge } from '../sim/techs';

declare const process: { argv: string[]; exit(code: number): never };
declare const performance: { now(): number };

const args = process.argv.slice(2);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const k = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));

async function fsMod(): Promise<{ readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void; existsSync(p: string): boolean }> {
  return (await import('node:' + 'fs')) as never;
}

if (args[0] === 'golden') await golden(args.includes('--update'));
else report();

function report(): void {
  const years = Number(args[0]) || 500;
  const civs = Number(args[1]) || 20;
  const seed = Number(args[2]) || 1;
  const [W, H] = (args[3] ?? '128x96').split('x').map(Number);
  const t0 = performance.now();
  const w = createWorld({ seed, civs, W, H });
  console.log(`World seed ${seed}, ${W}x${H}, ${w.civs.length} ancient civs, generated in ${Math.round(performance.now() - t0)} ms`);
  console.log(`Rivers: ${w.rivers.length}, land tiles: ${Array.from(w.t.h).filter((h) => h > 0).length}`);

  console.log('\n' + ['year', 'civs', 'ever', 'setts', 'pop', 'largest', 'stab', 'famine', 'wars', 'conq', 'routes', 'age', 'ms/tick', 'max'].map((s, i) => (i === 5 ? pad(s, 22) : lpad(s, 7))).join(' '));
  let maxTick = 0;
  let sumTick = 0;
  let ticks = 0;
  let lastLog = 0;
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      const a = performance.now();
      step(w);
      const d = performance.now() - a;
      sumTick += d;
      ticks++;
      if (d > maxTick) maxTick = d;
    }
    if (y % 50 === 0 || y === years) {
      const live = w.setts.filter((s) => s.died < 0);
      const pops = new Map<number, number>();
      for (const s of live) pops.set(s.civ, (pops.get(s.civ) ?? 0) + s.pop);
      let big = -1;
      for (const [c, p] of pops) if (big < 0 || p > (pops.get(big) ?? 0)) big = c;
      const total = live.reduce((a, s) => a + s.pop, 0);
      const stab = live.length ? live.reduce((a, s) => a + s.stab, 0) / live.length : 0;
      const slice = w.log.slice(lastLog);
      lastLog = w.log.length;
      const famines = slice.filter((e) => e.k === 'famine').length;
      const conq = slice.filter((e) => e.k === 'conquest').length;
      const wars = w.wars.filter((x) => x.end < 0).length;
      console.log([
        lpad(y, 7), lpad(pops.size, 7), lpad(w.civs.length, 7), lpad(live.length, 7), lpad(k(total), 7),
        pad(big >= 0 ? `${w.civs[big].name} ${k(pops.get(big) ?? 0)}` : '-', 22),
        lpad(stab.toFixed(0), 7), lpad(famines, 7), lpad(wars, 7), lpad(conq, 7), lpad(w.routes.length, 7), lpad(AGES[w.age].slice(0, 6), 7),
        lpad((sumTick / ticks).toFixed(2), 7), lpad(maxTick.toFixed(1), 7),
      ].join(' '));
      sumTick = 0;
      ticks = 0;
      maxTick = 0;
    }
  }

  console.log('\nFounding values (all civs ever, incl. breakaways):');
  console.log(['value', 'civs', 'alive%', 'avg peak pop', 'avg peak setts'].map((s, i) => (i ? lpad(s, 14) : pad(s, 14))).join(''));
  for (const v of VALUES) {
    const cs = w.civs.filter((c) => c.values.includes(v));
    if (!cs.length) continue;
    const alive = cs.filter((c) => c.died < 0).length;
    console.log([
      pad(v, 14), lpad(cs.length, 14), lpad(Math.round((100 * alive) / cs.length), 14),
      lpad(k(cs.reduce((a, c) => a + c.peakPop, 0) / cs.length), 14),
      lpad((cs.reduce((a, c) => a + c.peakSetts, 0) / cs.length).toFixed(1), 14),
    ].join(''));
  }

  const kinds = new Map<string, number>();
  for (const e of w.log) kinds.set(e.k, (kinds.get(e.k) ?? 0) + 1);
  console.log('\nEvents: ' + [...kinds].sort((a, b) => b[1] - a[1]).map(([a, b]) => `${a} ${b}`).join(', '));

  const live = w.setts.filter((s) => s.died < 0);
  const ranked = w.civs.filter((c) => c.died < 0).map((c) => {
    const ss = live.filter((s) => s.civ === c.id);
    return { c, pop: ss.reduce((a, s) => a + s.pop, 0), n: ss.length, top: Math.max(...ss.map((s) => s.pop)) };
  }).sort((a, b) => b.pop - a.pop);
  console.log('\nLargest civs:');
  for (const { c, pop, n, top } of ranked.slice(0, 6)) {
    console.log(`  ${pad(c.name, 12)} ${pad(c.values.join('/'), 34)} pop ${lpad(k(pop), 6)}  setts ${lpad(n, 3)}  biggest ${lpad(k(top), 6)}  techs ${lpad(c.techs.length, 2)} (${AGES[civAge(c)]})  army ${k(c.army)}  wealth ${k(c.wealth)}  contacts ${c.contacts.length}  goal ${c.goal}`);
  }
  const tiers = [0, 0, 0, 0, 0];
  for (const s of live) tiers[s.tier]++;
  console.log(`\nSettlement sizes: hamlet ${tiers[0]}, village ${tiers[1]}, town ${tiers[2]}, city ${tiers[3]}, metropolis ${tiers[4]}`);
  const ended = w.wars.filter((x) => x.end >= 0);
  const res = new Map<string, number>();
  for (const x of ended) res.set(x.result, (res.get(x.result) ?? 0) + 1);
  const avgLen = ended.length ? ended.reduce((a, x) => a + (x.end - x.start) / 12, 0) / ended.length : 0;
  console.log(`
Wars: ${w.wars.length} (${w.wars.filter((x) => x.end < 0).length} ongoing), avg ${avgLen.toFixed(1)} yrs, results ${[...res].map(([a, b]) => `${a} ${b}`).join(', ')}`);
  console.log(`  causes ${['land', 'grudge', 'plunder', 'succession'].map((c) => `${c} ${w.wars.filter((x) => x.cause === c).length}`).join(', ')}; deaths ${k(w.wars.reduce((a, x) => a + x.deaths, 0))}; battles ${w.wars.reduce((a, x) => a + x.battles, 0)}`);
  const civYears = w.civs.reduce((a, c) => a + ((c.died >= 0 ? c.died : w.tick) - c.born) / 12, 0);
  const warYears = w.wars.reduce((a, x) => a + ((x.end >= 0 ? x.end : w.tick) - x.start) / 12 * (2 + x.atkAllies.length + x.defAllies.length), 0);
  console.log(`  share of civ-years at war: ${Math.round((100 * warYears) / Math.max(1, civYears))}%`);
  const rs = new Map<string, number>();
  for (const r of w.rels) if (w.civs[r.a].died < 0 && w.civs[r.b].died < 0) rs.set(r.st, (rs.get(r.st) ?? 0) + 1);
  console.log(`Relations now: ${[...rs].map(([a, b]) => `${a} ${b}`).join(', ')}; trade routes ${w.routes.length} (${w.routes.filter((r) => r.sea).length} by sea)`);
  const alive = w.civs.filter((c) => c.died < 0);
  const ages = AGES.map((_, i) => alive.filter((c) => civAge(c) === i).length);
  console.log(`World age: ${AGES[w.age]}. Civs by age: ${AGES.map((a, i) => `${a} ${ages[i]}`).join(', ')}`);
  console.log(`Great people alive: ${alive.reduce((a, c) => a + c.greats.length, 0)}`);
  const dead = w.civs.filter((c) => c.died >= 0).length;
  console.log(`Fallen civs: ${dead}. Ruins: ${w.setts.filter((s) => s.died >= 0).length}. Log size: ${w.log.length} events, save size ${k(serialize(w).length)}B`);

  if (ranked[0]) {
    const lines = recent(w, 100000, ranked[0].c.id).reverse();
    console.log(`\nChronicle of the ${ranked[0].c.name} (first 14 and last 10 of ${lines.length}):`);
    for (const l of [...lines.slice(0, 14), null, ...lines.slice(-10)]) {
      console.log(l ? `  ${lpad(l.year, 4)} AW  ${l.text}` : '  ...');
    }
  }
}

function goldenRun(splitAt: number): World {
  const YEARS = 400;
  let w = createWorld({ seed: 12345, civs: 20 });
  for (let t = 0; t < YEARS * 12; t++) {
    if (t === splitAt) w = deserialize(serialize(w));
    const inputs = t === 100 * 12 ? [{ k: 'found' as const, founder: 'golden-test', tile: suggestSpots(w, 1, 1)[0] ?? 0, values: ['curious', 'seafaring', 'devout'] as never }] : [];
    step(w, inputs);
  }
  return w;
}

async function golden(update: boolean): Promise<void> {
  const fs = await fsMod();
  const path = 'src/commonworld/dev/golden.json';
  const a = goldenRun(-1);
  const b = goldenRun(200 * 12);
  const ha = worldHash(a);
  const hb = worldHash(b);
  console.log(`straight run ${ha}, save/load at year 200 ${hb}`);
  if (ha !== hb) {
    console.log('FAIL: saving and loading mid-run changed the outcome (state is leaking outside World).');
    process.exit(1);
  }
  const founded = a.civs.some((c) => c.founder === 'golden-test');
  if (!founded) console.log('WARN: the scripted founding at year 100 was rejected.');
  const want = fs.existsSync(path) ? (JSON.parse(fs.readFileSync(path, 'utf8')) as { hash: string }).hash : null;
  if (update || !want) {
    fs.writeFileSync(path, JSON.stringify({ hash: ha, note: 'seed 12345, 20 civs, 400 years, founding at year 100' }, null, 2) + '\n');
    console.log(`golden hash ${want ? 'updated' : 'written'}: ${ha}`);
    return;
  }
  if (want !== ha) {
    console.log(`FAIL: expected ${want}. If this change to the sim is intended, run: npm run world -- golden --update`);
    process.exit(1);
  }
  console.log('OK: matches golden hash');
}
