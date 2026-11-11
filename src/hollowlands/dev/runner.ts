// Headless colony runner for Hollow Lands. Not part of the game bundle.
//
//   npm run hl                      3 years, seed 1, 16 colonists
//   npm run hl -- 10 7 20           years, seed, colonists
//   npm run hl -- 10 7 20 dwarf     plus the main people
//   npm run hl -- golden            determinism check against dev/golden.json
//   npm run hl -- golden --update   accept the current result as the new golden hash
//   npm run hl -- many 5 12         5 years across 12 seeds: survival and averages

import { DAYS_PER_SEASON, SEASON_NAMES, TICKS_PER_DAY, TICKS_PER_HOUR, when } from '../config';
import { TH } from '../sim/data/thoughts';
import { foodDays } from '../sim/econ';
import { colonyHash, createColony, deserialize, serialize, step, type Colony, type RaceK } from '../sim/index';
import { STAGE, ageYears, fullName, stage } from '../sim/pawn';
import { WEIGHT, dateText, evText } from '../text';

declare const process: { argv: string[]; exit(code: number): never };
declare const performance: { now(): number };

const args = process.argv.slice(2);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function fsMod(): Promise<{ readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void; existsSync(p: string): boolean }> {
  return (await import('node:' + 'fs')) as never;
}

if (args[0] === 'golden') await golden(args.includes('--update'));
else if (args[0] === 'many') many();
else report();

function avgMood(c: Colony): [number, number] {
  let sum = 0;
  let min = 100;
  let n = 0;
  for (const p of c.pawns) {
    if (stage(c, p) < STAGE.TEEN) continue;
    sum += p.mood;
    n++;
    if (p.mood < min) min = p.mood;
  }
  return [n ? sum / n : 0, n ? min : 0];
}

function report(): void {
  const years = Number(args[0]) || 3;
  const seed = Number(args[1]) || 1;
  const pop = Number(args[2]) || 16;
  const race = args[3] as RaceK | undefined;
  const t0 = performance.now();
  const c = createColony({ seed, pop, race });
  console.log(`${c.name} (${c.biome}), seed ${seed}: ${c.pawns.length} colonists, ${c.blds.length} buildings, made in ${Math.round(performance.now() - t0)} ms`);
  for (const p of c.pawns) {
    console.log(`  ${pad(fullName(p), 24)} ${pad(p.race, 9)} ${p.sex ? 'm' : 'f'} ${lpad(ageYears(c, p).toFixed(0), 4)}  ${pad(p.prof || '-', 11)} ${p.traits.join(', ')}`);
  }

  const use: Record<string, number> = {};
  const thoughts: Record<string, number> = {};
  let samples = 0;
  let last: Record<string, number> = {};
  const diff = (k: string): number => (c.stats[k] ?? 0) - (last[k] ?? 0);
  console.log('\n' + [pad('season', 16), 'pop', 'kids', 'food d', 'meals', 'wood', 'stone', 'ale', 'mood', 'low', 'brk', 'brawl', 'born', 'died', 'blds', 'ms'].map((s, i) => (i ? lpad(s, 6) : s)).join(' '));
  const total = years * 4;
  let slowest = 0;
  for (let q = 0; q < total; q++) {
    const a = performance.now();
    const end = c.tick + DAYS_PER_SEASON * TICKS_PER_DAY;
    while (c.tick < end) {
      step(c);
      if (c.tick % TICKS_PER_HOUR === 0) {
        for (const p of c.pawns) {
          if (stage(c, p) < STAGE.TEEN) continue;
          const k = p.act.k === 'work' ? 'work:' + p.act.w : c.tick < p.act.ta ? 'walking' : p.act.k;
          use[k] = (use[k] ?? 0) + 1;
          samples++;
          if (c.tick % (TICKS_PER_HOUR * 6) === 0) {
            for (const t of p.th) thoughts[t.k] = (thoughts[t.k] ?? 0) + 1;
            for (const s of p.sit) thoughts[s[0]] = (thoughts[s[0]] ?? 0) + 1;
          }
        }
      }
    }
    const ms = performance.now() - a;
    if (ms > slowest) slowest = ms;
    const w = when(c.tick - 1);
    const [mood, low] = avgMood(c);
    const kids = c.pawns.filter((p) => stage(c, p) < STAGE.ADULT).length;
    console.log([
      pad(`${SEASON_NAMES[w.season]} Y${w.year}`, 16), c.pawns.length, kids, foodDays(c).toFixed(1), Math.round(c.stock.meal + c.stock.feast), Math.round(c.stock.wood), Math.round(c.stock.stone),
      Math.round(c.stock.ale), mood.toFixed(0), low.toFixed(0), diff('breaks'), diff('brawls'), diff('births'), diff('deaths'), `${c.blds.filter((b) => b.built).length}/${c.blds.length}`, ms.toFixed(0),
    ].map((s, i) => (i ? lpad(s, 6) : s)).join(' '));
    last = { ...c.stats };
    if (!c.pawns.length) { console.log('The colony is dead.'); break; }
  }

  console.log(`\nSlowest season ${slowest.toFixed(0)} ms (a year is 4 seasons; budget 2000 ms per year)`);
  console.log('\nCounters:');
  console.log('  ' + Object.keys(c.stats).sort().map((k) => `${k} ${Math.round(c.stats[k])}`).join(', '));
  console.log('\nHow adults spent their time:');
  console.log('  ' + Object.entries(use).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${((n / samples) * 100).toFixed(1)}%`).join(', '));
  console.log('\nMost common thoughts (mood each):');
  console.log('  ' + Object.entries(thoughts).sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, n]) => `${k}(${TH[k]?.m ?? '?'}) ${n}`).join(', '));
  console.log('\nBuildings:');
  console.log('  ' + c.blds.map((b) => `${b.k}${b.crop ? ':' + b.crop : ''}${b.built ? '' : ' (' + Math.round(b.prog * 100) + '%)'}`).join(', '));
  console.log('\nStores: ' + Object.entries(c.stock).filter(([, n]) => n >= 0.5).map(([k, n]) => `${k} ${Math.round(n)}`).join(', '));

  let friends = 0;
  let rivals = 0;
  let couples = 0;
  for (const p of c.pawns) {
    if (p.sp && p.id < p.sp) couples++;
    for (const k in p.rel) if (+k > p.id) { if (p.rel[k].f === 1) friends++; else if (p.rel[k].f === -1) rivals++; }
  }
  console.log(`\nPeople now: ${c.pawns.length} living, ${c.dead.length} dead or gone, ${couples} couples, ${friends} friendships, ${rivals} rivalries`);
  for (const p of c.pawns) {
    const partner = p.sp ? c.pawns.find((o) => o.id === p.sp) : undefined;
    console.log(`  ${pad(fullName(p), 24)} ${pad(p.race, 9)} ${lpad(ageYears(c, p).toFixed(0), 4)} mood ${lpad(p.mood.toFixed(0), 3)} ${pad(p.prof || '-', 11)} ${pad(partner ? (p.rel[partner.id]?.k ?? '?') + ' ' + partner.first : '', 20)} ${p.act.k}${p.act.w ? ':' + p.act.w : ''}`);
  }
  console.log('\nThe dead:');
  for (const d of c.dead) console.log(`  ${pad(d.first + ' ' + d.fam, 24)} ${pad(d.race, 9)} ${lpad(((d.died - d.born) / (TICKS_PER_DAY * 60)).toFixed(0), 4)}  ${d.cause}  (${dateText(d.died)})`);
  console.log('\nRecent story:');
  for (const e of c.log.filter((x) => (WEIGHT[x.k] ?? 0) >= 2).slice(-45)) console.log(`  ${pad(dateText(e.t), 22)} ${evText(c, e)}`);
}

function many(): void {
  const years = Number(args[1]) || 5;
  const n = Number(args[2]) || 10;
  const keys = ['births', 'joined', 'deaths', 'raids', 'taken', 'breaks', 'brawls', 'weddings', 'affairs', 'thefts', 'trials', 'convictions', 'wrongful', 'murders', 'rulers', 'elections', 'coups', 'houses', 'saints'];
  const sick = (c: Colony): number => Object.keys(c.stats).filter((k) => k.startsWith('death_sick')).reduce((a, k) => a + c.stats[k], 0);
  const slain = (c: Colony): number => Object.keys(c.stats).filter((k) => k.startsWith('death_foe') || k === 'death_bled' || k === 'death_wounds').reduce((a, k) => a + c.stats[k], 0);
  console.log([pad('seed', 6), pad('colony', 16), 'pop', 'mood', 'd_sick', 'd_fight', ...keys.map((k) => k.replace('death_', 'd_').slice(0, 7))].map((s, i) => (i > 1 ? lpad(s, 8) : s)).join(' '));
  const t0 = performance.now();
  for (let seed = 1; seed <= n; seed++) {
    const c = createColony({ seed, pop: 16 });
    const end = c.tick + years * 60 * TICKS_PER_DAY;
    while (c.tick < end && c.pawns.length) step(c);
    console.log([pad(seed, 6), pad(c.name, 16), c.pawns.length, avgMood(c)[0].toFixed(0), sick(c), slain(c), ...keys.map((k) => Math.round(c.stats[k] ?? 0))].map((s, i) => (i > 1 ? lpad(s, 8) : s)).join(' '));
  }
  console.log(`${((performance.now() - t0) / (n * years)).toFixed(0)} ms per colony-year`);
}

async function golden(update: boolean): Promise<void> {
  const fs = await fsMod();
  const path = 'src/hollowlands/dev/golden.json';
  const run = (): { hash: string; mid: string } => {
    const c = createColony({ seed: 7, pop: 16 });
    for (let k = 0; k < TICKS_PER_DAY * 45; k++) step(c);
    // save and load half way: a restored colony must carry on exactly the same
    const mid = colonyHash(c);
    const c2 = deserialize(serialize(c));
    for (let k = 0; k < TICKS_PER_DAY * 45; k++) { step(c); step(c2); }
    const a = colonyHash(c);
    const b = colonyHash(c2);
    if (a !== b) { console.error(`FAIL: a saved and reloaded colony drifted (${a} vs ${b})`); process.exit(1); }
    return { hash: a, mid };
  };
  const one = run();
  const two = run();
  if (one.hash !== two.hash) { console.error(`FAIL: two identical runs differ (${one.hash} vs ${two.hash})`); process.exit(1); }
  if (update || !fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(one, null, 2) + '\n');
    console.log(`golden updated: ${one.hash}`);
    return;
  }
  const want = JSON.parse(fs.readFileSync(path, 'utf8')) as { hash: string };
  if (want.hash !== one.hash) { console.error(`FAIL: golden hash changed (${want.hash} -> ${one.hash}). If the sim change is intended, run with --update.`); process.exit(1); }
  console.log(`golden ok: ${one.hash}`);
}
