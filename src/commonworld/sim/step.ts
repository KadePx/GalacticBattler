// One tick = one game month. step() is the only thing that moves the world forward.

import {
  TIER_POP, canFoundAt, claimTiles, ev, foundCiv, foundSettlement, has, killSett, mods, recount, scoreSite, suggestSpots,
  spawnCiv, tally, tendReserves, tierFor, type Mods,
} from './civ';
import { rel, relOf, yearlyDiplo } from './diplo';
import { invest, isCoastal, luxuryCount, settIncome, yearlyEcon } from './econ';
import { forWithin, hexDist, neighbors } from './hex';
import { monumentName, plagueName } from './names';
import { greatCount, succession, yearlyGreats } from './people';
import { applyAct, applyOffer, edictOn, yearlyPlayer } from './player';
import { yearlyDisasters } from './disaster';
import { applyGod, monthlyHordes } from './god';
import { yearlyFaith } from './faith';
import { maybeDefect, yearlyFate } from './fate';
import { refreshWonderFx, wonderFx, yearlyWonders } from './wonders';
import { Rand, S } from './rng';
import { AGES, TECHS, civAge, pickResearch, techCost } from './techs';
import {
  GOALS, TICKS_PER_YEAR, VALUES, type BKey, type Civ, type Goal, type Input, type Sett, type ValueId,
  type World,
} from './types';
import { considerPeace, considerWar, monthlyArmy, monthlyWar } from './war';
import { isLand } from './worldgen';

const SEASON = [-1, -1, -0.5, 0, 0.5, 1, 1, 1, 0.5, 0, -0.5, -1];
const GROWTH = 0.0055; // per month, at full stability with empty land
const SETTLER_MAT = 80;
const SETTLE_RANGE = 7;
const CONTACT_RANGE = 9;

const BMAX: Record<BKey, number> = { fields: 5, granary: 3, walls: 3, temple: 3, market: 3, workshop: 3, monument: 1 };
const BTIER: Record<BKey, number> = { fields: 0, granary: 1, walls: 1, temple: 1, market: 2, workshop: 1, monument: 3 };
const BCOST: Record<BKey, number> = { fields: 30, granary: 40, walls: 60, temple: 50, market: 60, workshop: 45, monument: 600 };
export function buildCost(k: BKey, lvl: number): number {
  return BCOST[k] * (lvl + 1) * (lvl + 2) / 2;
}

const GOAL_BUILD: Record<Goal, Partial<Record<BKey, number>>> = {
  grow: { fields: 3, granary: 2, workshop: 1 },
  expand: { fields: 2, workshop: 1 },
  fortify: { walls: 3, granary: 1.5 },
  worship: { temple: 3, fields: 1 },
  build: { monument: 3, workshop: 2, temple: 1 },
  trade: { market: 3, workshop: 1.5 },
};
const VALUE_GOAL: Partial<Record<ValueId, Partial<Record<Goal, number>>>> = {
  expansionist: { expand: 1.5 },
  isolationist: { expand: -0.8, fortify: 0.5 },
  martial: { fortify: 1.2 },
  devout: { worship: 1.4 },
  mercantile: { trade: 1.4 },
  pragmatic: { grow: 1.2 },
  artistic: { build: 1.4 },
  curious: { grow: 0.4, build: 0.4 },
  seafaring: { expand: 0.5, trade: 0.5 },
  stubborn: { fortify: 0.6 },
  egalitarian: { grow: 0.6 },
  ancestral: { worship: 0.6, build: 0.6 },
};

// Per-tick scratch (never saved): which civs are at war this tick.
let warring = new Uint8Array(0);

export function step(w: World, inputs: Input[] = []): void {
  refreshWonderFx(w);
  for (const inp of inputs) applyInput(w, inp);
  recount(w);
  markWars(w);
  const month = w.tick % TICKS_PER_YEAR;
  if (month === 0) {
    yearly(w);
    recount(w);
    markWars(w);
  }
  for (const c of w.civs) if (c.died < 0 && !c.horde) monthlyArmy(w, c, warring[c.id] === 1);
  monthlyHordes(w);
  const n = w.setts.length;
  for (let k = 0; k < n; k++) {
    const s = w.setts[k];
    if (s.died < 0) monthly(w, s);
  }
  monthlyWar(w);
  for (let k = 0; k < n; k++) {
    const s = w.setts[k];
    if (s.died < 0 && s.id % TICKS_PER_YEAR === month) settYearly(w, s);
  }
  endPlagues(w);
  w.tick++;
}

function markWars(w: World): void {
  if (warring.length < w.civs.length) warring = new Uint8Array(w.civs.length + 64);
  warring.fill(0);
  for (const war of w.wars) {
    if (war.end >= 0) continue;
    for (const c of [war.atk, war.def, ...war.atkAllies, ...war.defAllies]) warring[c] = 1;
  }
}

function applyInput(w: World, inp: Input): void {
  if (inp.k === 'offer') { applyOffer(w, inp); return; }
  if (inp.k === 'god') { applyGod(w, inp); return; }
  if (inp.k !== 'found') { applyAct(w, inp); return; }
  {
    if (w.civs.some((c) => c.founder === inp.founder)) return; // one founding per person
    if (!canFoundAt(w, inp.tile)) return;
    const values = [...new Set(inp.values)].filter((v) => (VALUES as readonly string[]).includes(v));
    if (values.length !== 3) return;
    // Late arrivals get a head start scaled to the age of the world, but still start small.
    const boon = lateBoon(w);
    const c = foundCiv(w, {
      tile: inp.tile, values, founder: inp.founder, name: inp.name, capital: inp.capital, motto: inp.motto,
      byName: inp.byName, banner: inp.banner, phon: inp.phon, lex: inp.lex, pop: boon.pop,
    });
    c.techs = boon.techs;
    c.protectedUntil = w.tick + 30 * TICKS_PER_YEAR;
    const home = w.setts[c.capital];
    home.mat += boon.mat;
    // No more settlers than the land can feed: the rest found a second town nearby, if there is room.
    const fit = (x: Sett) => Math.max(120, Math.round(avgCap(x, mods(c)) * 0.85));
    const extra = home.pop - fit(home);
    if (extra > 0) {
      setPop(home, fit(home));
      let best = -1;
      let bestScore = 4;
      forWithin(w.W, w.H, home.tile, 6, (i) => {
        if (hexDist(w.W, home.tile, i) < 3) return;
        const sc = scoreSite(w, c, i);
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      if (best >= 0 && extra >= 150) {
        const t = foundSettlement(w, c, best, extra, home.id);
        setPop(t, Math.min(extra, fit(t)));
        ev(w, { k: 'found_sett', a: c.id, s: t.id, x: home.name });
      }
    }
    c.army = Math.floor(home.pop * 0.02);
    w.reserves = w.reserves.filter((t) => hexDist(w.W, t, inp.tile) > 4);
  }
}

function setPop(s: Sett, pop: number): void {
  s.pop = pop;
  s.food = pop * 3;
  s.tier = s.maxTier = tierFor(pop);
}

/** What a newcomer starts with: the knowledge most peoples share, and more settlers in later ages. */
export function lateBoon(w: World): { pop: number; mat: number; techs: number[] } {
  const alive = w.civs.filter((c) => c.died < 0);
  const known = new Set<number>();
  for (const t of TECHS) {
    const n = alive.filter((c) => c.techs.includes(t.id)).length;
    if (alive.length && n * 2 >= alive.length && t.req.every((r) => known.has(r))) known.add(t.id);
  }
  // Enough settlers to stand beside an ordinary capital of the age, not just a camp.
  const caps = alive.filter((c) => !c.founder).map((c) => w.setts[c.capital]?.pop ?? 0).sort((a, b) => a - b);
  const median = caps.length ? caps[caps.length >> 1] : 0;
  const pop = Math.min(5000, Math.max(120 + 60 * w.age, Math.round(median * 0.4)));
  return { pop, mat: 40 + 40 * w.age, techs: [...known] };
}

// ---- Monthly ----

function spellMult(w: World, tile: number): number {
  let m = 1;
  for (const sp of w.spells) {
    if (sp.start <= w.tick && w.tick < sp.end && hexDist(w.W, tile, sp.tile) <= sp.r) m *= sp.mult / 1000;
  }
  return m;
}

function avgCap(s: Sett, m: Mods): number {
  return Math.max(1, s.cap * m.food * (1 + 0.12 * s.b.fields));
}

function monthly(w: World, s: Sett): void {
  const c = w.civs[s.civ];
  const m = mods(c);
  const r = new Rand(w.seed, S.GROW, w.tick, s.id);
  const month = w.tick % TICKS_PER_YEAR;
  const y = Math.floor(s.tile / w.W);
  const temp = w.t.temp[s.tile];
  const amp = Math.max(0.04, Math.min(0.45, (22 - temp) / 60));
  let mult = 1 + amp * SEASON[(month + (y > w.H / 2 ? 6 : 0)) % 12];
  mult *= spellMult(w, s.tile) * (1 + wonderFx(c).food);
  if (s.silt > w.tick) mult *= 1.15;
  if (s.siege > 0) mult *= 0.8; // fields burned, roads cut
  const cap = avgCap(s, m);

  // Food: people farm what the land allows; the rest goes into store.
  const prod = Math.min(cap * mult, s.pop * 1.3);
  s.food = Math.round(s.food + prod - s.pop);
  const store = s.pop * (3 + 2 * s.b.granary);
  if (s.food > store) s.food = store;
  if (s.food < 0) {
    const deaths = Math.min(s.pop, r.round(-s.food * 0.35));
    s.pop -= deaths;
    s.starve += deaths;
    s.food = 0;
  } else {
    // Families only grow when there's food put by for the lean months.
    const g = GROWTH * (0.4 + s.stab / 100) * m.grow;
    const d = s.pop * g * (1 - s.pop / cap);
    if (d < 0 || s.food >= s.pop * 2) s.pop += r.round(d);
  }

  // Materials and coin.
  const labor = Math.min(1, s.pop / cap);
  let matMul = (1 + 0.2 * s.b.workshop + 0.1 * s.b.market) * m.mat * (0.5 + s.stab / 200);
  if (greatCount(c, 'builder')) matMul *= 1.1;
  s.mat += (s.matBase * labor * matMul) / 6;
  if (s.mat > Math.max(600, s.pop)) s.mat = Math.max(600, s.pop); // storehouses only hold so much
  c.wealth += settIncome(w, s, c) * (greatCount(c, 'merchant') ? 1.15 : 1) * (1 + wonderFx(c).wealth);

  // Sickness.
  if (s.plague > 0) {
    const deaths = r.round(s.pop * (0.02 + r.float() * 0.03) * (1 - Math.min(0.85, m.plagueRes + wonderFx(c).plagueRes)));
    s.pop -= deaths;
    w.plagues[s.plagueId].deaths += deaths;
    s.plague--;
    if (s.plague === 0) s.immune = w.tick + 70 * TICKS_PER_YEAR;
    const spread = 1 - m.plagueRes * 0.5;
    for (const o of w.setts) {
      if (o.died >= 0 || o.plague > 0 || o.immune > w.tick || o === s) continue;
      if (hexDist(w.W, s.tile, o.tile) > 7) continue;
      if (r.chance((o.civ === s.civ ? 0.14 : 0.07) * spread)) infect(w, o, s.plagueId, r);
    }
    // Traders carry it along their routes.
    for (const rt of w.routes) {
      const other = rt.a === s.id ? rt.b : rt.b === s.id ? rt.a : -1;
      if (other < 0) continue;
      const o = w.setts[other];
      if (o.plague === 0 && o.immune <= w.tick && r.chance(0.1 * spread)) infect(w, o, s.plagueId, r);
    }
  }

  // Stability drifts toward what the situation supports.
  const target = stabTarget(w, s, c, m);
  if (s.stab < target) s.stab += target - s.stab > 15 ? 2 : 1;
  else if (s.stab > target) s.stab -= s.stab - target > 15 ? 2 : 1;

  if (s.pop < 15) killSett(w, s);
}

function stabTarget(w: World, s: Sett, c: Civ, m: Mods): number {
  let t = 52 + m.stab * 0.3 + luxuryCount(c) * 3;
  if (has(c, 'stubborn')) t += 8;
  if (has(c, 'isolationist')) t += 4;
  if (has(c, 'martial')) t += 3;
  t += s.b.temple * (has(c, 'devout') ? 5 : 3) + s.b.walls * 1.5 + s.b.monument * 5;
  t += greatCount(c, 'prophet') * 4 + wonderFx(c).stab;
  if (c.faith >= 0) {
    if (s.b.temple > 0) t += 2;
    if (w.faiths[c.faith].holy === s.id) t += 8;
  }
  const tr = c.ruler.trait;
  t += tr === 'pious' ? 3 : tr === 'just' ? 4 : tr === 'greedy' ? -2 : tr === 'cruel' ? -3 : 0;
  const sizePen = Math.max(0, tally.live[c.id] - 3) * 2.2 * (has(c, 'egalitarian') ? 0.5 : 1) * (1 - m.sizePen);
  const cap = w.setts[c.capital];
  const dist = cap && cap !== s ? hexDist(w.W, s.tile, cap.tile) : 0;
  t -= sizePen + dist * 1.2 * (has(c, 'martial') ? 0.8 : 1);
  if (s.lastFamine >= 0 && w.tick - s.lastFamine < 5 * TICKS_PER_YEAR) t -= 15;
  if (s.plague > 0) t -= 10;
  if (s.conq >= 0 && w.tick - s.conq < 20 * TICKS_PER_YEAR) t -= 12 * (1 - (w.tick - s.conq) / (20 * TICKS_PER_YEAR));
  if (warring[c.id]) t -= 4 + c.weary / 10;
  if (has(c, 'ancestral')) t += Math.min(10, (w.tick - s.born) / (30 * TICKS_PER_YEAR));
  return Math.max(5, Math.min(95, Math.round(t)));
}

function infect(w: World, s: Sett, pid: number, r: Rand): void {
  s.plague = r.range(4, 10);
  s.plagueId = pid;
  const p = w.plagues[pid];
  if (!p.civs.includes(s.civ)) {
    p.civs.push(s.civ);
    if (p.origin !== s.id) ev(w, { k: 'plague_reach', a: s.civ, s: s.id, x: p.name });
  }
}

function endPlagues(w: World): void {
  for (const p of w.plagues) {
    if (p.end >= 0) continue;
    if (w.setts.some((s) => s.died < 0 && s.plagueId === p.id && s.plague > 0)) continue;
    p.end = w.tick;
    ev(w, { k: 'plague_end', x: p.name, n: p.deaths, a: w.setts[p.origin].civ });
  }
}

// ---- Yearly, per settlement (staggered across the months) ----

function settYearly(w: World, s: Sett): void {
  const c = w.civs[s.civ];
  const m = mods(c);
  const r = new Rand(w.seed, S.BUILD, w.tick, s.id);

  if (s.starve >= 10 && s.starve > s.pop * 0.04) {
    ev(w, { k: 'famine', a: c.id, s: s.id, n: s.starve });
    s.lastFamine = w.tick;
    c.ruler.famines++;
  }
  s.starve = 0;
  if (s.siegeBy >= 0 && w.civs[s.siegeBy].died < 0 && relOf(w, s.civ, s.siegeBy)?.st !== 'war') {
    s.siege = 0;
    s.siegeBy = -1;
  }

  s.tier = tierFor(s.pop);
  if (s.tier > s.maxTier) {
    s.maxTier = s.tier;
    if (s.tier >= 2) ev(w, { k: 'tier_up', a: c.id, s: s.id, n: s.tier });
  }
  claimTiles(w, s);

  if (s.stab < 20 && r.chance(0.15)) {
    const lost = Math.floor(s.pop * 0.04);
    s.pop -= lost;
    s.mat = 0;
    s.stab += 25; // anger spent; it takes years to build again
    ev(w, { k: 'revolt', a: c.id, s: s.id, n: lost });
    return;
  }
  const capS = w.setts[c.capital];
  if (maybeDefect(w, s, r)) return;
  if (s.stab < 12 && s.id !== c.capital && tally.live[c.id] >= 5 && hexDist(w.W, s.tile, capS.tile) >= 5 && r.chance(0.2)) {
    secede(w, s, r);
    return;
  }

  const cap = avgCap(s, m);
  const wantsOut = c.goal === 'expand' ? s.pop > cap * 0.3 : s.pop > cap * 0.7;
  if (wantsOut && s.pop >= TIER_POP[1] && s.mat >= SETTLER_MAT && s.noSites <= w.tick && !warring[c.id]) {
    if (trySettle(w, s, c)) return;
  }
  tryBuild(w, s, c, r);
}

function trySettle(w: World, s: Sett, c: Civ): boolean {
  let best = -1;
  let bestScore = 7;
  forWithin(w.W, w.H, s.tile, SETTLE_RANGE, (i) => {
    const d = hexDist(w.W, s.tile, i);
    if (d < 3) return;
    const sc = scoreSite(w, c, i) - d * 0.7;
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  if (best < 0) {
    s.noSites = w.tick + 6 * TICKS_PER_YEAR;
    return false;
  }
  const take = Math.max(60, Math.floor(s.pop * 0.12));
  s.pop -= take;
  s.mat -= SETTLER_MAT;
  const n = foundSettlement(w, c, best, take, s.id);
  tally.live[c.id]++;
  tally.list[c.id].push(n.id);
  c.ruler.founded++;
  ev(w, { k: 'found_sett', a: c.id, s: n.id, x: s.name });
  return true;
}

function tryBuild(w: World, s: Sett, c: Civ, r: Rand): void {
  const gw = GOAL_BUILD[c.goal];
  const famineRecent = s.lastFamine >= 0 && w.tick - s.lastFamine < 10 * TICKS_PER_YEAR;
  const builder = greatCount(c, 'builder') > 0 || c.ruler.trait === 'builder';
  const costOf = (k: BKey) => buildCost(k, s.b[k]) * (k === 'monument' && builder ? 0.6 : 1);
  let pick: BKey | null = null;
  let bestW = 0;
  for (const k of Object.keys(BMAX) as BKey[]) {
    const lvl = s.b[k];
    if (lvl >= BMAX[k] || s.tier < BTIER[k] || costOf(k) > s.mat) continue;
    let wt = 0.3 + (gw[k] ?? 0);
    if (k === 'fields') wt += 1;
    if (k === 'granary' && famineRecent) wt += 3;
    if (k === 'temple' && (has(c, 'devout') || c.ruler.trait === 'pious')) wt += 1;
    if (k === 'walls' && (has(c, 'martial') || warring[c.id] || s.siege > 0)) wt += 1.5;
    if (k === 'market' && has(c, 'mercantile')) wt += 1;
    if (k === 'monument' && (has(c, 'artistic') || builder)) wt += 1.5;
    wt = wt / (1 + lvl * 0.6) + r.float() * 0.5;
    if (wt > bestW) { bestW = wt; pick = k; }
  }
  if (!pick) return;
  s.mat -= costOf(pick);
  s.b[pick]++;
  c.ruler.built++;
  if (pick === 'monument') {
    s.monument = monumentName(r, s.name, c.ruler.name);
    const b = c.greats.find((g) => g.kind === 'builder');
    if (b) b.deeds++;
    ev(w, { k: 'monument', a: c.id, s: s.id, x: s.monument, y: b ? b.name : c.ruler.name });
  } else if ((pick === 'temple' || pick === 'walls') && s.b[pick] === 1 && s.tier >= 2) {
    ev(w, { k: pick, a: c.id, s: s.id });
  }
}

function secede(w: World, s: Sett, r: Rand): void {
  const old = w.civs[s.civ];
  const c = spawnCiv(w, old, s, r);
  s.stab = 70;
  const rl = rel(w, c.id, old.id);
  rl.grudge = 25;
  rl.truce = w.tick + 30 * TICKS_PER_YEAR; // the old realm is too shaken to strike back at once
  ev(w, { k: 'secede', a: c.id, b: old.id, s: s.id, x: c.ruler.name });
}

// ---- Yearly, world and civs ----

function randomLand(w: World, r: Rand, ok: (i: number) => boolean = () => true): number {
  for (let k = 0; k < 60; k++) {
    const i = r.int(w.W * w.H);
    if (isLand(w.t, i) && ok(i)) return i;
  }
  return -1;
}

/** Civs whose capital sits inside the area (weather only makes the chronicle when it hits home). */
function civsNear(w: World, tile: number, rad: number): number[] {
  const out: number[] = [];
  for (const c of w.civs) {
    if (c.died < 0 && hexDist(w.W, w.setts[c.capital].tile, tile) <= rad) out.push(c.id);
  }
  return out;
}

/** Shared border length between every pair of civs (tile edges). */
function borders(w: World): Map<number, number> {
  const out = new Map<number, number>();
  const nb: number[] = [];
  const own = w.t.owner;
  for (let i = 0; i < own.length; i++) {
    const o = own[i];
    if (o < 0) continue;
    for (const j of neighbors(w.W, w.H, i, nb)) {
      if (j <= i) continue;
      const p = own[j];
      if (p < 0 || p === o) continue;
      const k = o < p ? o * 65536 + p : p * 65536 + o;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

function yearlyNature(w: World): void {
  const r = new Rand(w.seed, S.CLIMATE, w.tick);
  w.spells = w.spells.filter((sp) => sp.end > w.tick);
  if (r.chance(0.3)) {
    const tile = randomLand(w, r);
    if (tile >= 0) {
      const yrs = r.range(1, 3);
      const rad = r.range(4, 8);
      w.spells.push({ k: 'drought', tile, r: rad, start: w.tick, end: w.tick + yrs * TICKS_PER_YEAR, mult: 550 + r.int(150) });
      for (const a of civsNear(w, tile, rad)) ev(w, { k: 'drought', a, n: yrs });
    }
  }
  if (r.chance(0.25)) {
    const tile = randomLand(w, r);
    if (tile >= 0) {
      const rad = r.range(5, 8);
      w.spells.push({ k: 'bounty', tile, r: rad, start: w.tick, end: w.tick + TICKS_PER_YEAR, mult: 1200 });
      for (const a of civsNear(w, tile, rad)) ev(w, { k: 'bounty', a });
    }
  }
  if (r.chance(0.2)) {
    const tile = randomLand(w, r, (i) => w.t.temp[i] < 10);
    if (tile >= 0) {
      const rad = r.range(8, 12);
      w.spells.push({ k: 'winter', tile, r: rad, start: w.tick, end: w.tick + 4, mult: 600 });
      for (const a of civsNear(w, tile, rad)) ev(w, { k: 'winter', a });
    }
  }
  // Floods along big rivers: deadly, but they leave rich silt behind.
  const rf = new Rand(w.seed, S.EVENT, w.tick);
  for (const s of w.setts) {
    if (s.died >= 0 || w.t.flow[s.tile] < 3 || !rf.chance(0.012)) continue;
    const lost = Math.floor(s.pop * (0.03 + rf.float() * 0.05));
    s.pop -= lost;
    s.silt = w.tick + TICKS_PER_YEAR;
    ev(w, { k: 'flood', a: s.civ, s: s.id, n: lost });
  }
  // A new plague can start in a crowded place.
  const rp = new Rand(w.seed, S.PLAGUE, w.tick);
  if (rp.chance(0.035)) {
    const cands = w.setts.filter((s) => s.died < 0 && s.pop > 2500 && s.immune <= w.tick && s.plague === 0);
    if (cands.length) {
      const o = rp.pick(cands);
      const p = { id: w.plagues.length, name: plagueName(rp), start: w.tick, end: -1, deaths: 0, origin: o.id, civs: [] as number[] };
      w.plagues.push(p);
      ev(w, { k: 'plague_start', a: o.civ, s: o.id, x: p.name });
      infect(w, o, p.id, rp);
    }
  }
}

function research(w: World, c: Civ, r: Rand): void {
  const m = mods(c);
  const pop = tally.pop[c.id];
  const scholars = greatCount(c, 'scholar');
  // Research grows slower than population: a huge realm is not a huge academy.
  c.lore += Math.sqrt(pop) * 0.15 * (has(c, 'curious') ? 1.5 : 1) * (1 + 0.1 * Math.min(5, c.contacts.length)) * m.lore *
    (c.ruler.trait === 'wise' ? 1.15 : 1) * (1 + 0.25 * scholars) * (edictOn(w, c) === 'research' ? 1.35 : 1) * (1 + wonderFx(c).lore) + 0.5;
  const known = (id: number) => {
    let n = 0;
    for (const k of c.contacts) {
      const o = w.civs[k];
      if (o.died < 0 && o.techs.includes(id) && relOf(w, c.id, k)?.st !== 'war') n++;
    }
    return n;
  };
  const ids = tally.list[c.id] ?? [];
  const sit = {
    atWar: warring[c.id] === 1,
    hungry: ids.some((id) => w.setts[id].lastFamine >= 0 && w.tick - w.setts[id].lastFamine < 10 * TICKS_PER_YEAR),
    coastal: isCoastal(w, w.setts[c.capital].tile),
    known,
  };
  if (c.research < 0 || c.techs.includes(c.research)) c.research = pickResearch(c, sit, r);
  for (let guard = 0; guard < 4 && c.research >= 0; guard++) {
    const t = TECHS[c.research];
    const cost = techCost(t) * (1 - Math.min(0.5, 0.1 * known(t.id)));
    if (c.lore < cost) break;
    c.lore -= cost;
    c.techs.push(t.id);
    const sch = c.greats.find((g) => g.kind === 'scholar');
    if (sch) sch.deeds++;
    ev(w, { k: 'tech', a: c.id, x: t.name, z: sch?.name });
    c.research = pickResearch(c, sit, r);
  }
}

function pickGoal(w: World, c: Civ, crowding: number, room: number, r: Rand): void {
  const n = Math.max(1, tally.live[c.id]);
  const util: Record<Goal, number> = {
    grow: 1,
    expand: room > 0 ? 0.6 + crowding * 2 * room : -9,
    fortify: 0.2 + 0.25 * Math.min(4, c.contacts.length) + (warring[c.id] ? 1.5 : 0),
    worship: 0.3,
    build: 0.3,
    trade: 0.2 + 0.2 * Math.min(4, c.contacts.length),
  };
  let stabSum = 0;
  let towns = 0;
  for (const id of tally.list[c.id] ?? []) {
    stabSum += w.setts[id].stab;
    if (w.setts[id].tier >= 2) towns++;
  }
  if (stabSum / n < 45) util.worship += 1;
  util.build += towns ? 0.5 : -9;
  if (c.ruler.trait === 'pious') util.worship += 0.6;
  if (c.ruler.trait === 'builder') util.build += 0.6;
  if (c.ruler.trait === 'greedy') util.trade += 0.6;
  for (const v of c.values) {
    const vg = VALUE_GOAL[v];
    if (vg) for (const g of GOALS) util[g] += vg[g] ?? 0;
  }
  const ed = edictOn(w, c);
  if (ed && ed !== 'research') util[ed as Goal] += 3; // a founder's edict weighs heavily, but is not an order
  let best: Goal = 'grow';
  let bu = -99;
  for (const g of GOALS) {
    const u = util[g] + r.float() * 0.6;
    if (u > bu) { bu = u; best = g; }
  }
  c.goal = best;
}

function contacts(w: World): void {
  const live = w.setts.filter((s) => s.died < 0);
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    const ax = a.tile % w.W;
    const ay = (a.tile - ax) / w.W;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      if (a.civ === b.civ) continue;
      const bx = b.tile % w.W;
      const by = (b.tile - bx) / w.W;
      if (Math.abs(ax - bx) > CONTACT_RANGE + 1 || Math.abs(ay - by) > CONTACT_RANGE) continue;
      const ca = w.civs[a.civ];
      if (ca.contacts.includes(b.civ)) continue;
      if (hexDist(w.W, a.tile, b.tile) > CONTACT_RANGE) continue;
      ca.contacts.push(b.civ);
      w.civs[b.civ].contacts.push(a.civ);
      rel(w, a.civ, b.civ);
      ev(w, { k: 'contact', a: a.civ, b: b.civ, s: a.id });
    }
  }
}

function worldAge(w: World): void {
  const alive = w.civs.filter((c) => c.died < 0);
  const need = Math.max(2, Math.ceil(alive.length / 3));
  // One Age at a time, so every Age gets its moment in the chronicle.
  const a = w.age + 1;
  if (a < AGES.length && alive.filter((c) => civAge(c) >= a).length >= need) {
    w.age = a;
    ev(w, { k: 'age', n: a });
  }
}

function yearly(w: World): void {
  yearlyNature(w);
  yearlyDisasters(w);
  yearlyPlayer(w);

  const crowd = new Float64Array(w.civs.length);
  const canGrow = new Float64Array(w.civs.length);
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    crowd[s.civ] += s.pop / avgCap(s, mods(w.civs[s.civ]));
    if (s.noSites <= w.tick) canGrow[s.civ] += 1;
  }

  const border = borders(w);
  const routes = new Map<number, number>();
  yearlyEcon(w, routes);
  yearlyDiplo(w, border, routes);

  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const n = Math.max(1, tally.live[c.id]);
    c.peakPop = Math.max(c.peakPop, tally.pop[c.id]);
    c.peakSetts = Math.max(c.peakSetts, tally.live[c.id]);
    const ra = new Rand(w.seed, S.AI, w.tick, c.id);
    succession(w, c);
    if (c.died >= 0) continue;
    c.contacts = c.contacts.filter((k) => w.civs[k].died < 0);
    yearlyGreats(w, c, warring[c.id] === 1);
    research(w, c, new Rand(w.seed, S.INNO, w.tick, c.id));
    pickGoal(w, c, crowd[c.id] / n, canGrow[c.id] / n, ra);
    invest(w, c);
    if (!warring[c.id]) c.weary = Math.max(0, c.weary - 8);
  }

  markWars(w);
  considerPeace(w);
  markWars(w);
  considerWar(w, border, canGrow);
  contacts(w);
  yearlyFaith(w);
  yearlyWonders(w);
  yearlyFate(w);
  worldAge(w);
  tendReserves(w);
  backfill(w);
}

const FILL_FROM = 2; // years the founders have the world to themselves
const FILL_GAP = 8; // hexes between a newcomer and any town or held-open homeland

/**
 * Yearly, in a world that began empty: AI peoples arrive on open land, a few at a time, until
 * the world holds `fill` peoples. They keep clear of everyone already there and of the homelands
 * held open for founders, and they come knowing what most peoples already know.
 */
function backfill(w: World): void {
  if (!w.fill || w.tick < FILL_FROM * TICKS_PER_YEAR) return;
  const alive = w.civs.filter((c) => c.died < 0).length;
  const want = w.fill - alive;
  if (want <= 0) return;
  const n = Math.max(1, Math.ceil(want / 3));
  const r = new Rand(w.seed, S.FOUND, w.tick, 0xf11);
  const towns = w.setts.filter((s) => s.died < 0).map((s) => s.tile);
  const placed: number[] = [];
  // Roomy first; if the land is filling up, closer (but never on a held-open homeland).
  for (const [gap, held] of [[FILL_GAP, FILL_GAP], [6, 4]]) {
    const clear = (t: number) => [...towns, ...placed].every((o) => hexDist(w.W, o, t) >= gap) && w.reserves.every((o) => hexDist(w.W, o, t) >= held);
    for (const t of suggestSpots(w, 80, gap)) {
      if (placed.length >= n) break;
      if (canFoundAt(w, t) && clear(t)) placed.push(t);
    }
  }
  for (const t of placed) {
    const boon = lateBoon(w);
    const c = foundCiv(w, { tile: t, values: randomValues(r), founder: null, pop: Math.max(100, Math.round(boon.pop * 0.6)) });
    c.techs = boon.techs;
  }
  if (placed.length) recount(w);
}

function randomValues(r: Rand): ValueId[] {
  const out: ValueId[] = [];
  while (out.length < 3) {
    const v = r.pick(VALUES);
    if (out.includes(v)) continue;
    if ((v === 'expansionist' && out.includes('isolationist')) || (v === 'isolationist' && out.includes('expansionist'))) continue;
    out.push(v);
  }
  return out;
}
