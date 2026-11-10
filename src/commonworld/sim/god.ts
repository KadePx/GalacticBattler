// The owner's hand: events sent from the admin tool and applied as inputs like any other, so
// every browser replays them exactly. Includes the horde, a people that cannot be broken by
// unrest or weariness and makes war on everyone near it until the owner calls it off.

import { ev, foundCiv, recount, spawnCiv, tally } from './civ';
import { rel, relOf, setState } from './diplo';
import { forWithin, hexDist } from './hex';
import { plagueName } from './names';
import { Rand, S } from './rng';
import { TICKS_PER_YEAR, type Civ, type GodInput, type Sett, type World } from './types';
import { activeWars, declareWar, endWar, strength } from './war';
export { hordeWar } from './war';
import { isLand } from './worldgen';
import { collapse } from './fate';

/** Wars a horde keeps going at once (it picks the nearest peoples): more power, more fronts. */
const fronts = (c: Civ) => 1 + Math.round(c.horde ?? 1);

const alive = (w: World, id: number | undefined): Civ | null => (id !== undefined && w.civs[id] && w.civs[id].died < 0 ? w.civs[id] : null);
const town = (w: World, id: number | undefined): Sett | null => (id !== undefined && w.setts[id] && w.setts[id].died < 0 ? w.setts[id] : null);

function hurtAll(w: World, centre: Sett, radius: number, near: number, far: number): number {
  let lost = 0;
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    const d = hexDist(w.W, s.tile, centre.tile);
    if (d > radius) continue;
    const n = Math.floor(s.pop * (d === 0 ? near : far));
    s.pop -= n;
    lost += n;
    s.stab = Math.max(5, s.stab - (d === 0 ? 10 : 4));
  }
  return lost;
}

export function applyGod(w: World, g: GodInput): void {
  recount(w); // inputs land before the month's tallies are rebuilt
  const r = new Rand(w.seed, S.EVENT, w.tick, 0x60d, w.log.length);
  const s = town(w, g.s);
  const a = alive(w, g.a);
  const b = alive(w, g.b);
  switch (g.what) {
    case 'say':
      if (g.text) ev(w, { k: 'god', a: a?.id, s: s?.id, x: g.text.slice(0, 280) });
      return;
    case 'plague': {
      if (!s) return;
      const p = { id: w.plagues.length, name: g.name || plagueName(r), start: w.tick, end: -1, deaths: 0, origin: s.id, civs: [s.civ] };
      w.plagues.push(p);
      s.plague = r.range(6, 12);
      s.plagueId = p.id;
      s.immune = -1;
      ev(w, { k: 'plague_start', a: s.civ, s: s.id, x: p.name });
      return;
    }
    case 'quake':
      if (s) ev(w, { k: 'quake', a: s.civ, s: s.id, n: hurtAll(w, s, 3, 0.15, 0.05) });
      return;
    case 'eruption':
      if (s) {
        const lost = hurtAll(w, s, 4, 0.3, 0.1);
        for (const o of w.setts) if (o.died < 0 && hexDist(w.W, o.tile, s.tile) <= 4) o.silt = w.tick + 5 * TICKS_PER_YEAR;
        ev(w, { k: 'eruption', a: s.civ, s: s.id, n: lost });
      }
      return;
    case 'fire':
      if (s) { const lost = Math.floor(s.pop * 0.12); s.pop -= lost; s.mat = 0; ev(w, { k: 'fire', a: s.civ, s: s.id, n: lost }); }
      return;
    case 'flood':
      if (s) { const lost = hurtAll(w, s, 2, 0.1, 0.04); s.silt = w.tick + TICKS_PER_YEAR; ev(w, { k: 'flood', a: s.civ, s: s.id, n: lost }); }
      return;
    case 'tsunami':
      if (s) ev(w, { k: 'tsunami', a: s.civ, s: s.id, n: hurtAll(w, s, 4, 0.12, 0.06) });
      return;
    case 'famine':
      if (!a) return;
      for (const id of tally.list[a.id] ?? []) {
        const t = w.setts[id];
        const lost = Math.floor(t.pop * 0.15);
        t.pop -= lost;
        t.lastFamine = w.tick;
        t.stab = Math.max(5, t.stab - 15);
        if (id === a.capital) ev(w, { k: 'famine', a: a.id, s: id, n: lost });
      }
      return;
    case 'bless':
      if (!a) return;
      for (const id of tally.list[a.id] ?? []) w.setts[id].stab = 95;
      a.wealth += 500 + tally.pop[a.id] * 0.05;
      a.weary = 0;
      ev(w, { k: 'god', a: a.id, x: g.text || `A season of plenty and peace came to the ${a.name}. Their towns were content and their coffers full.` });
      return;
    case 'war':
      if (!a || !b || a === b || relOf(w, a.id, b.id)?.st === 'war') return;
      if (!a.contacts.includes(b.id)) { a.contacts.push(b.id); b.contacts.push(a.id); }
      rel(w, a.id, b.id);
      declareWar(w, a, b, 'grudge', r);
      return;
    case 'peace':
      if (!a || !b) return;
      for (const war of w.wars) {
        if (war.end >= 0) continue;
        const sides = [war.atk, war.def];
        if (sides.includes(a.id) && sides.includes(b.id)) endWar(w, war, 'stalemate');
      }
      return;
    case 'revolt': {
      if (!s) return;
      const old = w.civs[s.civ];
      if (old.capital === s.id || tally.live[old.id] < 2) return;
      const c = spawnCiv(w, old, s, r);
      s.stab = 70;
      const rl = rel(w, c.id, old.id);
      rl.grudge = 25;
      rl.truce = w.tick + 10 * TICKS_PER_YEAR;
      ev(w, { k: 'secede', a: c.id, b: old.id, s: s.id, x: c.ruler.name });
      return;
    }
    case 'collapse':
      if (a && !a.horde) collapse(w, a, r);
      return;
    case 'horde':
      spawnHorde(w, g, r);
      return;
    case 'calm':
      if (!a?.horde) return;
      a.horde = undefined;
      ev(w, { k: 'horde_end', a: a.id });
      return;
  }
}

/** Where a horde rides in from: open land near the most towns, unless the owner chose a place. */
function hordeSite(w: World, g: GodInput): number {
  const free = (i: number) => {
    if (!isLand(w.t, i) || w.t.owner[i] !== -1) return false;
    let ok = true;
    forWithin(w.W, w.H, i, 2, (j) => { if (w.t.city[j] !== -1) ok = false; });
    return ok;
  };
  const near = g.tile !== undefined ? g.tile : alive(w, g.a) ? w.setts[w.civs[g.a!].capital].tile : -1;
  let best = -1;
  let bs = -Infinity;
  for (let i = 0; i < w.W * w.H; i++) {
    if (!free(i)) continue;
    let sc = 0;
    if (near >= 0) sc = -hexDist(w.W, i, near);
    else for (const s of w.setts) if (s.died < 0 && hexDist(w.W, s.tile, i) <= 14) sc += 1 + s.pop / 5000;
    if (sc > bs) { bs = sc; best = i; }
  }
  return best;
}

function spawnHorde(w: World, g: GodInput, r: Rand): void {
  const tile = hordeSite(w, g);
  if (tile < 0) return;
  const c = foundCiv(w, { tile, values: ['martial', 'expansionist', 'stubborn'], founder: null, pop: 4000, name: g.name || undefined });
  recount(w);
  c.horde = Math.max(1, Math.min(6, g.power ?? 2));
  c.hue = 352;
  c.ruler.trait = 'cruel';
  const techs = new Set<number>();
  for (const o of w.civs) if (o.died < 0) for (const t of o.techs) techs.add(t);
  c.techs = [...techs].sort((x, y) => x - y);
  c.wealth = 5000;
  for (const o of w.civs) {
    if (o.died >= 0 || o === c) continue;
    c.contacts.push(o.id);
    o.contacts.push(c.id);
  }
  ev(w, { k: 'horde', a: c.id, s: c.capital, x: c.ruler.name });
  hordeArmy(w, c);
  hordeWars(w, c, r);
}

/** Enemies' combined armies, so the horde always outnumbers them. */
function hordeArmy(w: World, c: Civ): void {
  let foes = 0;
  for (const war of activeWars(w, c.id)) {
    const enemy = war.atk === c.id || war.atkAllies.includes(c.id) ? [war.def, ...war.defAllies] : [war.atk, ...war.atkAllies];
    for (const e of enemy) foes += w.civs[e].died < 0 ? strength(w.civs[e]) : 0;
  }
  const want = Math.floor((c.horde ?? 1) * (foes + 1500));
  if (c.army < want) c.army += Math.ceil((want - c.army) * 0.25);
}

/** The horde picks fights with the nearest peoples it is not already fighting. */
function hordeWars(w: World, c: Civ, r: Rand): void {
  const fighting = new Set<number>();
  for (const war of activeWars(w, c.id)) for (const x of [war.atk, war.def, ...war.atkAllies, ...war.defAllies]) fighting.add(x);
  fighting.delete(c.id);
  if (fighting.size >= fronts(c)) return;
  const mine = (tally.list[c.id] ?? []).map((id) => w.setts[id]);
  if (!mine.length) return;
  const dist = new Map<number, number>();
  for (const s of w.setts) {
    if (s.died >= 0 || s.civ === c.id || fighting.has(s.civ)) continue;
    let d = Infinity;
    for (const m of mine) d = Math.min(d, hexDist(w.W, m.tile, s.tile));
    dist.set(s.civ, Math.min(dist.get(s.civ) ?? Infinity, d));
  }
  const targets = [...dist].sort((x, y) => x[1] - y[1] || x[0] - y[0]).slice(0, fronts(c) - fighting.size);
  for (const [id] of targets) {
    const o = w.civs[id];
    if (o.horde) continue;
    const rl = rel(w, c.id, o.id);
    rl.truce = -1;
    if (rl.st === 'ally' || rl.st === 'pact') setState(w, rl, 'peace');
    declareWar(w, c, o, 'plunder', r);
  }
}

/** Monthly, for each horde: armies refilled, towns cowed, no weariness. */
export function monthlyHordes(w: World): void {
  for (const c of w.civs) {
    if (c.died >= 0 || !c.horde) continue;
    hordeArmy(w, c);
    c.weary = 0;
    for (const id of tally.list[c.id] ?? []) {
      const s = w.setts[id];
      if (s.stab < 70) s.stab = 70;
    }
    if (w.tick % 3 === 0) hordeWars(w, c, new Rand(w.seed, S.AI, w.tick, 0x40d, c.id));
  }
}

