// Headless colony runner for Hollow Lands. Not part of the game bundle.
//
//   npm run hl                      3 years, seed 1, 16 colonists
//   npm run hl -- 10 7 20           years, seed, colonists
//   npm run hl -- 10 7 20 dwarf     plus the main people
//   npm run hl -- golden            determinism check against dev/golden.json
//   npm run hl -- golden --update   accept the current result as the new golden hash
//   npm run hl -- many 5 12         5 years across 12 seeds: survival and averages
//   npm run hl -- size 3 1 90       snapshot size after 3 years, seed 1, 90 colonists (raw and gzipped)
//   npm run hl -- many 5 6 1 90     ... from seed 1, starting with 90 colonists (default 40)
//   npm run hl -- land 20 5         the land of seeds 1..20: water, wood, stone in reach, then 5 years each (0: land only)

import { DAYS_PER_SEASON, SEASON_NAMES, TICKS_PER_DAY, TICKS_PER_HOUR, when } from '../config';
import { TH } from '../sim/data/thoughts';
import { foodDays } from '../sim/econ';
import { colonyHash, createColony, deserialize, serialize, step, type Colony, type RaceK } from '../sim/index';
import { pathStats } from '../sim/path';
import { ROCK_FACE, SHORE, cacheStats, featList } from '../sim/cache';
import { F } from '../sim/types';
import { STAGE, ageYears, fullName, stage } from '../sim/pawn';
import { WEIGHT, dateText, evText } from '../text';
import { infect } from '../sim/health';
import { Rand } from '../sim/rng';
import { callParty } from '../sim/exped';

declare const process: { argv: string[]; exit(code: number): never };
declare const performance: { now(): number };

const args = process.argv.slice(2);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function fsMod(): Promise<{ readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void; existsSync(p: string): boolean }> {
  return (await import('node:' + 'fs')) as never;
}

if (args[0] === 'golden') await golden(args.includes('--update'));
else if (args[0] === 'size') await size();
else if (args[0] === 'many') many();
else if (args[0] === 'land') land();
else if (args[0] === 'plague') plagueTest();
else if (args[0] === 'castle') castleTest();
else report();

//   npm run hl -- plague 8 1 60     8 seeds from 1, 60 colonists: a year and a half, then the grey plague; deaths in 60 days
function plagueTest(): void {
  const n = Number(args[1]) || 8;
  const from = Number(args[2]) || 1;
  const pop = Number(args[3]) || 60;
  let tot0 = 0;
  let totDead = 0;
  for (let seed = from; seed < from + n; seed++) {
    const c = createColony({ seed, pop });
    const t1 = c.tick + 90 * TICKS_PER_DAY;
    while (c.tick < t1) step(c);
    const before = c.pawns.length;
    const d0 = c.stats.death_sick_plague ?? 0;
    const s0 = c.stats.sick_plague ?? 0;
    const r = new Rand(seed, 999);
    for (let k = 0; k < 2; k++) infect(c, r.pick(c.pawns), 'plague');
    const t2 = c.tick + 60 * TICKS_PER_DAY;
    while (c.tick < t2) step(c);
    const dead = (c.stats.death_sick_plague ?? 0) - d0;
    tot0 += before;
    totDead += dead;
    console.log(`${pad(seed, 4)} ${pad(c.name, 16)} pop ${lpad(before, 3)} -> ${lpad(c.pawns.length, 3)}  fell ill ${lpad((c.stats.sick_plague ?? 0) - s0, 3)}  died of plague ${lpad(dead, 3)} (${((100 * dead) / before).toFixed(0)}%)`);
  }
  console.log(`all: ${totDead} of ${tot0} died of plague (${((100 * totDead) / tot0).toFixed(1)}%)`);
}

//   npm run hl -- castle 6 4 1 45   a lord's colony: 6 years, 4 seeds from 1, 45 colonists; the castle's stage each year
function castleTest(): void {
  const years = Number(args[1]) || 6;
  const n = Number(args[2]) || 4;
  const from = Number(args[3]) || 1;
  const pop = Number(args[4]) || 45;
  const t0 = performance.now();
  for (let seed = from; seed < from + n; seed++) {
    const c = createColony({ seed, pop });
    c.gov.k = 'lord';
    const row: string[] = [];
    for (let y = 1; y <= years; y++) {
      const end = c.tick + 60 * TICKS_PER_DAY;
      while (c.tick < end && c.pawns.length) step(c);
      const cs = (c as unknown as { castle?: { stage: number } }).castle;
      row.push(`y${y}:${cs ? cs.stage : '-'}`);
    }
    const cs = (c as unknown as { castle?: { stage: number; at?: number[] } }).castle;
    const parts = c.blds.filter((b) => ['motte', 'palisade', 'keep', 'curtain', 'gatehouse', 'barracks', 'stables'].includes(b.k)).map((b) => `${b.k}${b.built ? '' : '(' + Math.round(b.prog * 100) + '%)'}`);
    const deaths = Object.keys(c.stats).filter((k) => k.startsWith('death_')).sort((a, b) => c.stats[b] - c.stats[a]).slice(0, 4).map((k) => k.slice(6) + ' ' + c.stats[k]).join(', ');
    console.log(`     deaths: ${deaths || '-'}; left ${c.stats.left ?? 0}, settlers ${c.stats.settlers ?? 0}`);
    console.log(`${pad(seed, 4)} ${pad(c.name, 16)} pop ${lpad(c.pawns.length, 3)} gov ${pad(c.gov.k, 7)} ${row.join(' ')}  at ${cs?.at?.map((t) => (t / (60 * TICKS_PER_DAY)).toFixed(1)).join('/') ?? '-'}  stone ${Math.round(c.stock.stone)} silver ${Math.round(c.stock.silver)}  ${parts.join(' ')}`);
  }
  console.log(`${((performance.now() - t0) / (n * years)).toFixed(0)} ms per colony-year`);
}

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
  console.log('\n' + [pad('season', 16), 'pop', 'kids', 'food d', 'meals', 'wood', 'stone', 'ale', 'mood', 'low', 'brk', 'brawl', 'born', 'died', 'blds', 'trees', 'ms'].map((s, i) => (i ? lpad(s, 6) : s)).join(' '));
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
      Math.round(c.stock.ale), mood.toFixed(0), low.toFixed(0), diff('breaks'), diff('brawls'), diff('births'), diff('deaths'), `${c.blds.filter((b) => b.built).length}/${c.blds.length}`, c.feat.filter((f) => f === 1 || f === 2).length + '/' + c.feat.filter((f) => f === 8).length, ms.toFixed(0),
    ].map((s, i) => (i ? lpad(s, 6) : s)).join(' '));
    last = { ...c.stats };
    if (!c.pawns.length) { console.log('The colony is dead.'); break; }
  }

  console.log(`\nSlowest season ${slowest.toFixed(0)} ms (a year is 4 seasons; budget 5000 ms per year at 90 colonists)`);
  console.log(`Paths: ${pathStats.calls} searches (${pathStats.foe} by foes), ${pathStats.fails} failed (${pathStats.early} at once, ${pathStats.failNodes} tiles looked at in the rest), ${(pathStats.nodes / Math.max(1, pathStats.calls)).toFixed(0)} tiles looked at each; map cache rebuilt ${cacheStats.rebuilds} times, ${cacheStats.lists} feature lists`);
  console.log('\nCounters:');
  console.log('  ' + Object.keys(c.stats).sort().map((k) => `${k} ${Math.round(c.stats[k])}`).join(', '));
  console.log('\nHow adults spent their time:');
  console.log('  ' + Object.entries(use).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${((n / samples) * 100).toFixed(1)}%`).join(', '));
  console.log('\nMost common thoughts (mood each):');
  console.log('  ' + Object.entries(thoughts).sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, n]) => `${k}(${TH[k]?.m ?? '?'}) ${n}`).join(', '));
  console.log('\nBuildings:');
  console.log('  ' + c.blds.map((b) => `${b.k}${b.crop ? ':' + b.crop : ''}${b.built ? '' : ' (' + Math.round(b.prog * 100) + '%)'}`).join(', '));
  console.log('  no room for: ' + Object.keys(c.nosite).join(', '));
  console.log('\nStores: ' +Object.entries(c.stock).filter(([, n]) => n >= 0.5).map(([k, n]) => `${k} ${Math.round(n)}`).join(', '));

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

/** What each map gives a town: the nearest water, wood and stone it can walk to, and room to grow. */
function land(): void {
  const n = Number(args[1]) || 20;
  const years = args[2] === undefined ? 5 : Number(args[2]);
  const t0 = performance.now();
  console.log([pad('seed', 5), pad('biome', 9), pad('colony', 14), 'water', 'trees40', 'wood d', 'stone40', 'stone d', 'ore', 'keep', 'pop', 'peak', 'roofless', 'p-days', 'no room for'].map((s, i) => (i > 2 ? lpad(s, 8) : s)).join(' '));
  for (let seed = 1; seed <= n; seed++) {
    const c = createColony({ seed, pop: 40 });
    const dist = (i: number): number => Math.round(Math.hypot((i % c.w) - c.cx, Math.floor(i / c.w) - c.cy));
    const within = (l: number[], d: number): number => l.filter((i) => dist(i) <= d).length;
    const shore = featList(c, SHORE);
    const trees = [...featList(c, F.TREE), ...featList(c, F.PINE)].sort((a, b) => dist(a) - dist(b));
    const stone = [...featList(c, F.BOULDER), ...featList(c, ROCK_FACE), ...featList(c, F.ORE)].sort((a, b) => dist(a) - dist(b));
    const ore = featList(c, F.ORE);
    const k = c.keep ? c.ter[c.keep.y * c.w + c.keep.x] : -1;
    const row = [pad(seed, 5), pad(c.biome, 9), pad(c.name, 14), shore.length ? dist(shore[0]) : '-', within(trees, 40), trees.length ? dist(trees[0]) : '-', within(stone, 40), stone.length ? dist(stone[0]) : '-', ore.length ? dist(ore[0]) : '-', k <= 2 ? 'open' : 'ter' + k];
    let peak = 0;
    let pdays = 0;
    const end = c.tick + years * 60 * TICKS_PER_DAY;
    while (c.tick < end && c.pawns.length) {
      step(c);
      if (c.tick % TICKS_PER_DAY !== 0) continue;
      peak = Math.max(peak, c.pawns.length);
      for (const p of c.pawns) if (!p.home) pdays++;
    }
    row.push(c.pawns.length, peak, c.pawns.filter((p) => !p.home).length, pdays, Object.keys(c.nosite).join(' ') || '-');
    console.log(row.map((s, i) => (i > 2 && i < 14 ? lpad(s, 8) : i === 14 ? ' ' + s : s)).join(' '));
  }
  if (years) console.log(`${((performance.now() - t0) / (n * years)).toFixed(0)} ms per colony-year`);
}

function many(): void {
  const years = Number(args[1]) || 5;
  const n = Number(args[2]) || 10;
  const keys = ['births', 'joined', 'deaths', 'raids', 'taken', 'breaks', 'brawls', 'weddings', 'affairs', 'thefts', 'trials', 'convictions', 'wrongful', 'murders', 'rulers', 'elections', 'coups', 'houses', 'saints'];
  const sick = (c: Colony): number => Object.keys(c.stats).filter((k) => k.startsWith('death_sick')).reduce((a, k) => a + c.stats[k], 0);
  const slain = (c: Colony): number => Object.keys(c.stats).filter((k) => k.startsWith('death_foe') || k === 'death_bled' || k === 'death_wounds').reduce((a, k) => a + c.stats[k], 0);
  console.log([pad('seed', 6), pad('colony', 16), 'pop', 'mood', 'd_sick', 'd_fight', ...keys.map((k) => k.replace('death_', 'd_').slice(0, 7))].map((s, i) => (i > 1 ? lpad(s, 8) : s)).join(' '));
  const t0 = performance.now();
  const from = Number(args[3]) || 1;
  const town: string[] = [];
  for (let seed = from; seed < from + n; seed++) {
    const c = createColony({ seed, pop: Number(args[4]) || 40 });
    const end = c.tick + years * 60 * TICKS_PER_DAY;
    // who has gone without a bed, and for how long
    const roofless = new Map<number, number>();
    let longest = 0;
    let homelessDays = 0;
    let peak = 0;
    let popSum = 0;
    let days = 0;
    while (c.tick < end && c.pawns.length) {
      step(c);
      if (c.tick % TICKS_PER_DAY !== 0) continue;
      days++;
      popSum += c.pawns.length;
      if (c.pawns.length > peak) peak = c.pawns.length;
      for (const p of c.pawns) {
        if (p.home) { roofless.delete(p.id); continue; }
        homelessDays++;
        const d = (roofless.get(p.id) ?? 0) + 1;
        roofless.set(p.id, d);
        if (d > longest) longest = d;
      }
    }
    console.log([pad(seed, 6), pad(c.name, 16), c.pawns.length, avgMood(c)[0].toFixed(0), sick(c), slain(c), ...keys.map((k) => Math.round(c.stats[k] ?? 0))].map((s, i) => (i > 1 ? lpad(s, 8) : s)).join(' '));
    const homeless = c.pawns.filter((p) => !p.home).length;
    town.push(`  ${pad(seed, 6)} ${pad(c.name, 16)} pop ${lpad(c.pawns.length, 3)} (avg ${(popSum / Math.max(1, days)).toFixed(0)}, peak ${peak})  buildings ${lpad(c.blds.filter((b) => b.built).length, 3)}/${lpad(c.blds.length, 3)}  beds ${lpad(c.blds.reduce((a, b) => a + (b.built ? b.beds.length : 0), 0), 3)}  homeless now ${homeless}, person-days ${homelessDays}, longest ${longest} d  no room for: ${Object.keys(c.nosite).join(' ') || '-'}`);
    const ills = Object.keys(c.stats).filter((k) => k.startsWith('death_sick_')).sort().map((k) => k.slice(11) + ' ' + c.stats[k]).join(', ');
    const cs = (c as unknown as { castle?: { stage: number; at?: number[] } }).castle;
    town.push(`         sick deaths: ${ills || '-'}${cs ? `  castle stage ${cs.stage}${cs.at?.length ? ' (years ' + cs.at.map((t) => (t / (60 * TICKS_PER_DAY)).toFixed(1)).join(', ') + ')' : ''}` : ''}`);
  }
  console.log(`${((performance.now() - t0) / (n * years)).toFixed(0)} ms per colony-year`);
  console.log('Towns:');
  for (const line of town) console.log(line);
}

async function golden(update: boolean): Promise<void> {
  const fs = await fsMod();
  const path = 'src/hollowlands/dev/golden.json';
  const run = (): { hash: string; mid: string; exp: string } => {
    const c = createColony({ seed: 7, pop: 16 });
    for (let k = 0; k < TICKS_PER_DAY * 45; k++) step(c);
    // save and load half way: a restored colony must carry on exactly the same
    const mid = colonyHash(c);
    // reload copies at several points; each must end exactly where the original does
    const copies = [deserialize(serialize(c))];
    for (let k = 0; k < TICKS_PER_DAY * 45; k++) {
      step(c);
      for (const x of copies) step(x);
      if (k > 0 && k % (TICKS_PER_DAY * 11) === 0) copies.push(deserialize(serialize(c)));
    }
    const a = colonyHash(c);
    copies.forEach((x, n) => { const b = colonyHash(x); if (a !== b) { console.error(`FAIL: reloaded copy ${n} drifted (${a} vs ${b})`); process.exit(1); } });
    return { hash: a, mid, exp: expCase() };
  };
  // a second case that reaches an expedition: a town of 50, a party called on day 21, and reload
  // copies taken while it musters, while it is away and as it comes home
  function expCase(): string {
    const c = createColony({ seed: 3, pop: 50 });
    for (let k = 0; k < TICKS_PER_DAY * 20; k++) step(c);
    while (c.tick % TICKS_PER_DAY !== 1) step(c);
    if (c.exp) c.exp.l = [];
    const q = callParty(c, { k: 'tomb', name: 'the Barrow of Kings', d: 2, p: 'relic', far: 1 });
    if (!q) { console.error('FAIL: the golden expedition could not form a party'); process.exit(1); }
    const copies = [deserialize(serialize(c))];
    const marks = new Set([70, 85, 300, 620, 900, 1100]);
    for (let k = 0; k < TICKS_PER_DAY * 24; k++) {
      step(c);
      for (const x of copies) step(x);
      if (marks.has(k)) copies.push(deserialize(serialize(c)));
    }
    if (!(c.stats.expeditions >= 1) || !c.exp || !c.exp.done.length) { console.error('FAIL: the golden expedition never set out and came home'); process.exit(1); }
    const a = colonyHash(c);
    copies.forEach((x, n) => { const b = colonyHash(x); if (a !== b) { console.error(`FAIL: expedition case, reloaded copy ${n} drifted (${a} vs ${b})`); process.exit(1); } });
    return a;
  }
  const one = run();
  const two = run();
  if (one.hash !== two.hash || one.exp !== two.exp) { console.error(`FAIL: two identical runs differ (${one.hash}/${one.exp} vs ${two.hash}/${two.exp})`); process.exit(1); }
  if (update || !fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(one, null, 2) + '\n');
    console.log(`golden updated: ${one.hash} (expedition case ${one.exp})`);
    return;
  }
  const want = JSON.parse(fs.readFileSync(path, 'utf8')) as { hash: string; exp?: string };
  if (want.exp !== one.exp) { console.error(`FAIL: golden expedition hash changed (${want.exp} -> ${one.exp}). If the sim change is intended, run with --update.`); process.exit(1); }
  if (want.hash !== one.hash) { console.error(`FAIL: golden hash changed (${want.hash} -> ${one.hash}). If the sim change is intended, run with --update.`); process.exit(1); }
  console.log(`golden ok: ${one.hash} (expedition case ${one.exp})`);
}

async function size(): Promise<void> {
  const years = Number(args[1]) || 3;
  const seed = Number(args[2]) || 1;
  const pop = Number(args[3]) || 90;
  const zlib = (await import('node:' + 'zlib')) as unknown as { gzipSync(b: Uint8Array, o?: { level: number }): Uint8Array };
  const c = createColony({ seed, pop });
  const end = c.tick + years * 60 * TICKS_PER_DAY;
  while (c.tick < end && c.pawns.length) step(c);
  const json = serialize(c);
  const bytes = new TextEncoder().encode(json);
  const kb = (n: number): string => (n / 1024).toFixed(0) + ' KB';
  console.log(`${c.name}: ${c.pawns.length} colonists, ${c.dead.length} dead, ${c.blds.length} buildings, ${c.w}x${c.h} after ${years} years`);
  console.log(`snapshot ${kb(bytes.length)} raw, ${kb(zlib.gzipSync(bytes, { level: 9 }).length)} gzipped`);
  // what takes the room
  const raw = JSON.parse(json) as Record<string, unknown>;
  const parts = Object.entries(raw).map(([k, v]) => [k, JSON.stringify(v).length] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('largest parts (raw): ' + parts.map(([k, n]) => `${k} ${kb(n)}`).join(', '));
}
