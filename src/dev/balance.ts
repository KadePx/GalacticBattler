// Headless balance report. Runs thousands of bot battles and full runs with the
// real simulator and prints trends. Not part of the game bundle.
//
//   npm run balance            (default sample sizes)
//   npm run balance -- 400     (more fights per cell = less noise, slower)

import { ARCHETYPES, botSnapshot } from '../game/bot';
import { ENDLESS_REPAIR, setPricing, type Pricing } from '../game/run';
import { simulate } from '../sim/battle';
import { COMMANDERS } from '../sim/commanders';
import { RELICS } from '../sim/relics';
import { SHIPS, levelOf } from '../sim/ships';
import type { Snapshot } from '../sim/types';

declare const process: { argv: string[] }; // Node global; avoids pulling in @types/node

const N = Number(process.argv[2]) || 200;
const ROUNDS = [3, 5, 7, 9, 11];
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function header(title: string) {
  console.log(`\n=== ${title} ===`);
}

// Opponent pool: a random-archetype bot for (seed, round).
const foe = (seed: number, round: number) => botSnapshot(900000 + seed * 7919 + round * 104729, round);

// ---------- A: archetype win rate by round vs random bots ----------
function styleByRound() {
  header(`STYLE WIN % vs random bots (N=${N} per cell)`);
  console.log(pad('style', 11) + ROUNDS.map((r) => lpad(`r${r}`, 6)).join('') + lpad('avg', 6));
  const ticks: number[] = [];
  let draws = 0;
  let games = 0;
  for (const a of ARCHETYPES) {
    const row: number[] = [];
    for (const round of ROUNDS) {
      let w = 0;
      for (let i = 0; i < N; i++) {
        const me = botSnapshot(10000 + i * 131 + round, round, a.id);
        const r = simulate(me, foe(i, round));
        if (r.winner === 0) w++;
        if (r.winner === -1) draws++;
        ticks.push(r.ticks);
        games++;
      }
      row.push(pct(w, N));
    }
    const avg = Math.round(row.reduce((s, v) => s + v, 0) / row.length);
    console.log(pad(a.id, 11) + row.map((v) => lpad(v, 6)).join('') + lpad(avg, 6));
  }
  const avgT = ticks.reduce((s, v) => s + v, 0) / ticks.length;
  console.log(`avg fight length ${avgT.toFixed(1)} ticks, draws ${((100 * draws) / games).toFixed(1)}%`);
}

// ---------- B: full runs (bot-skill player, no bonus scrap) ----------
function fullRuns() {
  const runsN = Math.max(150, N);
  header(`FULL RUNS: bot-skill player vs bots (N=${runsN} runs per style)`);
  console.log(pad('style', 11) + lpad('clear%', 8) + lpad('avgW', 6) + lpad('avgRnd', 8));
  for (const a of ARCHETYPES) {
    let cleared = 0;
    let wins = 0;
    let rounds = 0;
    for (let i = 0; i < runsN; i++) {
      let w = 0;
      let lives = 5;
      let round = 1;
      for (; w < 10 && lives > 0; round++) {
        const me = botSnapshot(5000 + i * 31, round, a.id, false);
        const res = simulate(me, foe(i * 13 + 7, round)).winner;
        if (res === 0) w++;
        if (res === 1) lives--;
      }
      if (w >= 10) cleared++;
      wins += w;
      rounds += round - 1;
    }
    console.log(pad(a.id, 11) + lpad(pct(cleared, runsN), 8) + lpad((wins / runsN).toFixed(1), 6) + lpad((rounds / runsN).toFixed(1), 8));
  }
}

// ---------- C/D: ship and relic presence win rates ----------
function presence() {
  const shipW: Record<string, number> = {};
  const shipP: Record<string, number> = {};
  const shipLv3: Record<string, number> = {};
  const relW: Record<string, number> = {};
  const relP: Record<string, number> = {};
  let games = 0;
  for (const round of [4, 6, 8, 10]) {
    for (let i = 0; i < N * 3; i++) {
      const a = botSnapshot(300000 + i * 17 + round, round);
      const b = foe(i + 50000, round);
      const r = simulate(a, b);
      games++;
      for (const [snap, side] of [[a, 0], [b, 1]] as [Snapshot, 0 | 1][]) {
        const won = r.winner === side;
        for (const def of new Set(snap.fleet.filter(Boolean).map((s) => s!.def))) {
          shipP[def] = (shipP[def] ?? 0) + 1;
          if (won) shipW[def] = (shipW[def] ?? 0) + 1;
        }
        for (const s of snap.fleet) if (s && levelOf(s.xp) === 3) shipLv3[s.def] = (shipLv3[s.def] ?? 0) + 1;
        for (const id of new Set(snap.relics)) {
          relP[id] = (relP[id] ?? 0) + 1;
          if (won) relW[id] = (relW[id] ?? 0) + 1;
        }
      }
    }
  }
  header(`SHIP presence win % (fleets containing the ship; ${games} battles, rounds 4-10)`);
  const ships = Object.keys(shipP).sort((x, y) => shipW[y] / shipP[y] - shipW[x] / shipP[x]);
  for (const s of ships) {
    console.log(pad(s, 12) + lpad(`T${SHIPS[s].tier}`, 4) + lpad(pct(shipW[s] ?? 0, shipP[s]), 5) + '%' +
      lpad(`seen ${pct(shipP[s], games * 2)}%`, 10));
  }
  header('RELIC presence win %');
  const rels = RELICS.map((r) => r.id).filter((id) => relP[id]).sort((x, y) => (relW[y] ?? 0) / relP[y] - (relW[x] ?? 0) / relP[x]);
  for (const r of rels) console.log(pad(r, 12) + lpad(pct(relW[r] ?? 0, relP[r]), 5) + '%' + lpad(`seen ${pct(relP[r], games * 2)}%`, 10));
}

// ---------- D: swap test (fair ship comparison) ----------
// Same fleets, same slot, same level: only the ship changes. Compare within a tier.
function swapTest() {
  const n = N * 2;
  header(`SHIP SWAP TEST: put a level-2 copy into the same slot of the same fleets (N=${n} per round)`);
  const rounds = [5, 8, 11];
  console.log(pad('ship', 12) + lpad('tier', 5) + rounds.map((r) => lpad(`r${r}`, 6)).join('') + lpad('avg', 6) + lpad('vsTier', 8));
  const rows: { id: string; tier: number; avg: number; cells: number[] }[] = [];
  for (const def of Object.values(SHIPS).filter((s) => s.tier > 0)) {
    const cells = rounds.map((round) => {
      let w = 0;
      for (let i = 0; i < n; i++) {
        const a = botSnapshot(600000 + i * 37 + round, round);
        const filled = a.fleet.map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
        const slot = filled[i % filled.length];
        a.fleet[slot] = { def: def.id, atk: def.atk + 2, hp: def.hp + 2, xp: 2 };
        if (simulate(a, foe(i + 77000, round)).winner === 0) w++;
      }
      return pct(w, n);
    });
    rows.push({ id: def.id, tier: def.tier, cells, avg: cells.reduce((s, v) => s + v, 0) / cells.length });
  }
  for (const tier of [1, 2, 3]) {
    const group = rows.filter((r) => r.tier === tier);
    const mean = group.reduce((s, r) => s + r.avg, 0) / group.length;
    for (const r of group.sort((x, y) => y.avg - x.avg)) {
      const d = Math.round(r.avg - mean);
      console.log(pad(r.id, 12) + lpad(`T${tier}`, 5) + r.cells.map((v) => lpad(v, 6)).join('') + lpad(Math.round(r.avg), 6) + lpad(d >= 0 ? `+${d}` : d, 8));
    }
  }
}

// ---------- P: pricing models ----------
// Every fleet (player and opponents) shops under the same pricing rule.
function pricingCompare() {
  const modes: Pricing[] = ['flat', 't1late', 'tiered'];
  const runsN = Math.max(300, N);
  header(`PRICING MODELS (styles N=${N}/cell, runs N=${runsN}/style)`);
  const rows: Record<string, string[]> = {};
  const put = (k: string, v: string) => { (rows[k] ??= []).push(v); };
  for (const mode of modes) {
    setPricing(mode);
    // Style balance (average over rounds) and fight length.
    const avgs: number[] = [];
    let ticks = 0;
    let fights = 0;
    for (const a of ARCHETYPES) {
      let w = 0;
      let n = 0;
      for (const round of ROUNDS) {
        for (let i = 0; i < N; i++) {
          const r = simulate(botSnapshot(10000 + i * 131 + round, round, a.id), foe(i, round));
          if (r.winner === 0) w++;
          ticks += r.ticks;
          fights++;
          n++;
        }
      }
      avgs.push(pct(w, n));
    }
    put('style win% spread', `${Math.min(...avgs)}-${Math.max(...avgs)}`);
    put('fight length (ticks)', (ticks / fights).toFixed(1));
    // Full runs.
    const clears: number[] = [];
    for (const a of ARCHETYPES) {
      let cleared = 0;
      for (let i = 0; i < runsN; i++) {
        let w = 0;
        let lives = 5;
        for (let round = 1; w < 10 && lives > 0; round++) {
          const res = simulate(botSnapshot(5000 + i * 31, round, a.id, false), foe(i * 13 + 7, round)).winner;
          if (res === 0) w++;
          if (res === 1) lives--;
        }
        if (w >= 10) cleared++;
      }
      clears.push(pct(cleared, runsN));
    }
    put('clear% avg', String(Math.round(clears.reduce((s, v) => s + v, 0) / clears.length)));
    put('clear% spread', `${Math.min(...clears)}-${Math.max(...clears)}`);
    // Fleet composition.
    for (const round of [5, 8, 11]) {
      let ships = 0;
      let tierSum = 0;
      let t1 = 0;
      let lvl = 0;
      const n = N * 2;
      for (let i = 0; i < n; i++) {
        const f = botSnapshot(700000 + i * 41 + round, round).fleet.filter(Boolean);
        ships += f.length;
        for (const s of f) {
          tierSum += SHIPS[s!.def].tier;
          if (SHIPS[s!.def].tier === 1) t1++;
          lvl += levelOf(s!.xp);
        }
      }
      put(`r${round} ships / avg tier`, `${(ships / n).toFixed(1)} / ${(tierSum / ships).toFixed(2)}`);
      put(`r${round} % tier 1 / avg level`, `${pct(t1, ships)}% / ${(lvl / ships).toFixed(2)}`);
    }
  }
  setPricing('flat');
  console.log(pad('', 24) + modes.map((m) => lpad(m, 14)).join(''));
  for (const [k, vals] of Object.entries(rows)) console.log(pad(k, 24) + vals.map((v) => lpad(v, 14)).join(''));
}

// ---------- N: endless mode ----------
// Bot-skill players who clear keep going until their hull runs out.
function endless() {
  const runsN = Math.max(400, N);
  header(`ENDLESS: cleared runs that keep going (N=${runsN} runs per style)`);
  console.log(pad('style', 11) + lpad('clears', 8) + lpad('avgExtra', 10) + lpad('median', 8) + lpad('p90', 6) + lpad('maxRnd', 8));
  for (const a of ARCHETYPES) {
    const extras: number[] = [];
    let maxRound = 0;
    for (let i = 0; i < runsN; i++) {
      let w = 0;
      let lives = 5;
      let round = 1;
      let extra = 0;
      for (; lives > 0 && round <= 40; round++) {
        const res = simulate(botSnapshot(5000 + i * 31, round, a.id, false), foe(i * 13 + 7, round)).winner;
        if (res === 0) {
          w++;
          if (w > 10) extra++;
          if (w === 10) lives = Math.min(5, lives + ENDLESS_REPAIR); // Keep Going repairs the hull
        }
        if (res === 1) lives--;
        if (w < 10 && lives <= 0) break;
      }
      if (w >= 10) {
        extras.push(extra);
        maxRound = Math.max(maxRound, round - 1);
      }
    }
    extras.sort((x, y) => x - y);
    const q = (f: number) => (extras.length ? extras[Math.min(extras.length - 1, Math.floor(f * extras.length))] : 0);
    const avg = extras.length ? extras.reduce((s, v) => s + v, 0) / extras.length : 0;
    console.log(pad(a.id, 11) + lpad(`${pct(extras.length, runsN)}%`, 8) + lpad(avg.toFixed(1), 10) + lpad(q(0.5), 8) + lpad(q(0.9), 6) + lpad(maxRound, 8));
  }
}

// ---------- E: commander passives ----------
function passives() {
  header(`COMMANDER PASSIVE win % (random bot with this passive vs random bots, N=${N * 3})`);
  const ids = ['none', ...COMMANDERS.flatMap((c) => [`${c.id}.a`, `${c.id}.b`])];
  for (const pid of ids) {
    let w = 0;
    let n = 0;
    for (const round of [3, 6, 9]) {
      for (let i = 0; i < N; i++) {
        const a = botSnapshot(20000 + i * 17 + round, round);
        a.cmd = pid === 'none' ? undefined : { id: pid.split('.')[0], p: pid.split('.')[1] as 'a' | 'b' };
        if (pid === 'tess.a') a.bench = 2; // bots don't bench ships; assume a typical bench
        const r = simulate(a, foe(i + 9000, round));
        n++;
        if (r.winner === 0) w++;
      }
    }
    console.log(pad(pid, 10) + lpad(pct(w, n), 5) + '%');
  }
}

// ---------- F: style vs style ----------
function matrix() {
  const round = 8;
  header(`STYLE vs STYLE at round ${round} (row win %, N=${Math.round(N / 2)})`);
  const ids = ARCHETYPES.map((a) => a.id);
  console.log(pad('', 11) + ids.map((id) => lpad(id.slice(0, 5), 6)).join(''));
  for (const a of ids) {
    const row = ids.map((b) => {
      let w = 0;
      const n = Math.round(N / 2);
      for (let i = 0; i < n; i++) {
        const r = simulate(botSnapshot(40000 + i * 7, round, a), botSnapshot(80000 + i * 11, round, b));
        if (r.winner === 0) w++;
      }
      return pct(w, n);
    });
    console.log(pad(a, 11) + row.map((v) => lpad(v, 6)).join(''));
  }
}

const t0 = Date.now();
const only = process.argv[3];
if (!only || only.includes('a')) styleByRound();
if (!only || only.includes('b')) fullRuns();
if (!only || only.includes('c')) presence();
if (!only || only.includes('d')) swapTest();
if (!only || only.includes('e')) passives();
if (!only || only.includes('f')) matrix();
if (only && only.includes('p')) pricingCompare();
if (only && only.includes('n')) endless();
console.log(`\n(done in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
