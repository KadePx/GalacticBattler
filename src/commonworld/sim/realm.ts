// The long rhythms of a realm and the world: tributaries bound to an overlord, golden and dark
// ages, the climate's slow swings, and refugees fleeing famine and war.

import { ev, has, tally } from './civ';
import { relOf } from './diplo';
import { hexDist } from './hex';
import { greatCount } from './people';
import { Rand, S } from './rng';
import { TICKS_PER_YEAR, type Civ, type ClimateK, type Sett, type World } from './types';
import { activeWars, declareWar, strength } from './war';

const Y = TICKS_PER_YEAR;

// ---- Tributaries ----

/** The peoples paying tribute to `c`. */
export function vassalsOf(w: World, c: number): Civ[] {
  return w.civs.filter((x) => x.died < 0 && x.lord === c);
}

/** A beaten people becomes the winner's tributary, if the winner is far the stronger. */
export function maybeSubjugate(w: World, winner: Civ, loser: Civ, r: Rand): void {
  if (winner.died >= 0 || loser.died >= 0 || winner.lord >= 0 || loser.lord >= 0) return;
  if (loser.protectedUntil > w.tick || !(tally.list[loser.id] ?? []).length) return;
  if (strength(winner) < 2 * strength(loser) + 60 || !r.chance(0.4)) return;
  for (const v of vassalsOf(w, loser.id)) free(w, v, 'freed');
  loser.lord = winner.id;
  loser.lordSince = w.tick;
  ev(w, { k: 'tribute', a: loser.id, b: winner.id });
}

function free(w: World, c: Civ, why: 'freed' | 'released' | 'lord_fell'): void {
  ev(w, { k: 'tribute_end', a: c.id, b: c.lord, x: why, n: Math.max(1, Math.round((w.tick - c.lordSince) / Y)) });
  c.lord = -1;
  c.lordSince = -1;
}

/** Can `a` make war on `b`? Tributaries make no wars of their own, except to break free. */
export function mayAttack(a: Civ, b: Civ): boolean {
  return a.lord < 0 && b.lord !== a.id;
}

function yearlyTribute(w: World, c: Civ, r: Rand): void {
  const lord = w.civs[c.lord];
  if (lord.died >= 0) { free(w, c, 'lord_fell'); return; }
  const pay = c.wealth * 0.12;
  c.wealth -= pay;
  lord.wealth += pay;
  const yrs = (w.tick - c.lordSince) / Y;
  const op = relOf(w, c.id, lord.id)?.op ?? 0;
  // Break free when the overlord looks weak, busy or cruel.
  const mine = strength(c);
  const theirs = strength(lord) + vassalsOf(w, lord.id).filter((v) => v !== c).reduce((s, v) => s + strength(v) * 0.3, 0);
  const busy = activeWars(w, lord.id).length > 0;
  let p = 0;
  if (mine > theirs * 0.8) p += 0.25;
  if (busy) p += 0.06;
  if (lord.ruler.trait === 'cruel') p += 0.03;
  if (op < -30) p += 0.04;
  if (has(c, 'stubborn')) p *= 1.4;
  if (yrs >= 5 && r.chance(p)) {
    const old = c.lord;
    c.lord = -1;
    c.lordSince = -1;
    declareWar(w, c, w.civs[old], 'independence', r);
    return;
  }
  // Long, quiet tribute may simply lapse.
  if (yrs >= 60 && op > 10 && r.chance(0.03)) free(w, c, 'released');
}

// ---- Golden and dark ages ----

function avgStab(w: World, c: Civ): number {
  const ids = tally.list[c.id] ?? [];
  let s = 0;
  for (const id of ids) s += w.setts[id].stab;
  return ids.length ? s / ids.length : 0;
}

const DARK_NAMES = ['the Dark Years', 'the Troubles', 'the Time of Sorrows', 'the Long Night', 'the Ashen Years', 'the Hungry Years'];

export function startEra(w: World, c: Civ, k: 'golden' | 'dark', r: Rand, years: number): void {
  c.era = k;
  c.eraSince = w.tick;
  c.eraUntil = w.tick + years * Y;
  c.eraName = k === 'golden' ? `the Golden Age of ${c.ruler.name}` : r.pick(DARK_NAMES);
  w.eras.push({ civ: c.id, k, name: c.eraName, start: w.tick, end: -1 });
  ev(w, { k: 'era', a: c.id, x: c.eraName, y: k });
}

export function endEra(w: World, c: Civ): void {
  for (let i = w.eras.length - 1; i >= 0; i--) {
    if (w.eras[i].civ === c.id && w.eras[i].end < 0) { w.eras[i].end = w.tick; break; }
  }
  ev(w, { k: 'era_end', a: c.id, x: c.eraName, y: c.era, n: Math.max(1, Math.round((w.tick - c.eraSince) / Y)) });
  c.era = '';
  c.eraName = '';
  c.eraUntil = -1;
}

function yearlyEra(w: World, c: Civ, r: Rand, atWar: boolean): void {
  const stab = avgStab(w, c);
  const ids = tally.list[c.id] ?? [];
  const famine = ids.some((id) => w.setts[id].lastFamine >= 0 && w.tick - w.setts[id].lastFamine < 10 * Y);
  if (c.era === 'golden') {
    if (w.tick >= c.eraUntil || stab < 40 || (atWar && c.weary > 50)) endEra(w, c);
    return;
  }
  if (c.era === 'dark') {
    if (w.tick >= c.eraUntil || stab >= 62) endEra(w, c);
    return;
  }
  if (!ids.length) return;
  const recentWonder = w.wonders.some((x) => x.civ === c.id && w.tick - x.t < 30 * Y);
  const greats = c.greats.length + (recentWonder ? 1 : 0) + (greatCount(c, 'scholar') ? 1 : 0);
  // Golden ages are rare: a people gets one in a long while, and only a few shine at once.
  let lastGold = -1;
  for (const e of w.eras) if (e.civ === c.id && e.k === 'golden') lastGold = e.end < 0 ? w.tick : e.end;
  const shining = w.civs.filter((x) => x.died < 0 && x.era === 'golden').length;
  const room = shining < Math.max(2, Math.floor(w.civs.filter((x) => x.died < 0).length / 12));
  if (stab >= 68 && !atWar && !famine && greats >= 2 && room && (lastGold < 0 || w.tick - lastGold > 150 * Y) &&
    r.chance(0.015 + (has(c, 'artistic') ? 0.01 : 0))) {
    startEra(w, c, 'golden', r, r.range(25, 50));
  } else if ((stab < 30 || (famine && stab < 40)) && r.chance(0.08)) {
    startEra(w, c, 'dark', r, r.range(15, 35));
  }
}

/** How a people's age changes it: [research, culture, growth, stability]. */
export function eraFx(c: Civ): { lore: number; culture: number; grow: number; stab: number } {
  if (c.era === 'golden') return { lore: 1.25, culture: 1.5, grow: 1.15, stab: 5 };
  if (c.era === 'dark') return { lore: 0.6, culture: 0.5, grow: 0.9, stab: -4 };
  return { lore: 1, culture: 1, grow: 1, stab: 0 };
}

// ---- Climate ----

export const CLIMATES: Record<ClimateK, { name: string; text: string }> = {
  cold: { name: 'the Long Winter', text: 'Harder winters everywhere; cold lands harvest less.' },
  warm: { name: 'the Long Summer', text: 'Mild years; the cold north harvests more, the hot south dries out.' },
  dry: { name: 'the Dry Years', text: 'The rains fail far more often.' },
  wet: { name: 'the Great Rains', text: 'Rich harvests, but rivers flood and sickness spreads.' },
};

export function climateNow(w: World): ClimateK | '' {
  const c = w.climates[w.climates.length - 1];
  return c && c.end > w.tick ? c.k : '';
}

function yearlyClimate(w: World): void {
  const r = new Rand(w.seed, S.CLIMATE, w.tick, 0xc1a);
  const last = w.climates[w.climates.length - 1];
  if (last && last.end > w.tick) return;
  if (last && last.end === w.tick) ev(w, { k: 'climate_end', x: last.name });
  // A calm spell between swings.
  if (last && w.tick - last.end < 60 * Y) return;
  if (!r.chance(0.012)) return;
  const k = r.pick(['cold', 'warm', 'dry', 'wet'] as ClimateK[]);
  const yrs = r.range(40, 120);
  const name = CLIMATES[k].name;
  const n = w.climates.filter((x) => x.k === k).length;
  w.climates.push({ k, name: n ? `${name} ${['', 'II', 'III', 'IV', 'V'][Math.min(4, n)]}`.trim() : name, start: w.tick, end: w.tick + yrs * Y });
  ev(w, { k: 'climate', x: w.climates[w.climates.length - 1].name, y: k });
}

/** Food multiplier from the climate at a tile. */
export function climateFood(w: World, tile: number): number {
  const k = climateNow(w);
  if (!k) return 1;
  const temp = w.t.temp[tile];
  if (k === 'cold') return temp < 8 ? 0.93 : 0.98;
  if (k === 'warm') return temp < 8 ? 1.1 : temp > 22 ? 0.95 : 1.02;
  if (k === 'wet') return 1.04;
  return 1;
}

// ---- Refugees ----

/** Some of a town's people flee to the nearest town of their own people that can take them. */
export function flee(w: World, from: Sett, civ: number, n: number, kind: 'famine' | 'war'): void {
  if (n < 20) return;
  let best: Sett | null = null;
  let bd = 99;
  for (const id of tally.list[civ] ?? []) {
    const s = w.setts[id];
    if (s === from || s.died >= 0 || s.siege > 0) continue;
    if (kind === 'famine' && s.food < s.pop * 1.5) continue;
    const d = hexDist(w.W, s.tile, from.tile);
    if (d < bd && d <= 10) { bd = d; best = s; }
  }
  if (!best) return;
  const k = Math.min(n, from.pop - 15);
  if (k <= 0) return;
  from.pop -= k;
  best.pop += k;
  if (k >= 400) ev(w, { k: 'refugees', a: civ, s: best.id, n: k, x: from.name, y: kind });
}

// ---- Yearly ----

export function yearlyRealm(w: World, warring: Uint8Array): void {
  yearlyClimate(w);
  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const r = new Rand(w.seed, S.CULTURE, w.tick, c.id, 0x4e1);
    if (c.lord >= 0) yearlyTribute(w, c, r);
    yearlyEra(w, c, r, warring[c.id] === 1);
  }
}
