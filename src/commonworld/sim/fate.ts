// Milestone 7: how realms end and what rises after. A great realm gone sour can collapse into
// successor states; towns of a fallen people may rise again under its name's memory; unhappy
// towns drift to a neighbour whose culture outshines their own rulers'.

import { ev, shareArmy, spawnCiv, tally, transferSett } from './civ';
import { endEra, startEra } from './realm';
import { rel, relOf } from './diplo';
import { hexDist } from './hex';
import { Rand, S } from './rng';
import { TICKS_PER_YEAR, type Civ, type Sett, type World } from './types';

const REVIVE_YEARS = 400; // how long the memory of a fallen people can still raise rebels

/** A realm of many towns with no loyalty left breaks into pieces. */
export function collapse(w: World, c: Civ, r: Rand): boolean {
  const cap = w.setts[c.capital];
  const towns = (tally.list[c.id] ?? []).map((id) => w.setts[id]).filter((s) => s.id !== c.capital).sort((a, b) => b.pop - a.pop || a.id - b.id);
  const heads: Sett[] = [];
  for (const s of towns) {
    if (heads.length >= 3) break;
    if (hexDist(w.W, s.tile, cap.tile) < 4 || heads.some((h) => hexDist(w.W, h.tile, s.tile) < 4)) continue;
    heads.push(s);
  }
  if (!heads.length) return false;
  const centres = [cap, ...heads];
  const share = new Map<number, Sett[]>();
  for (const s of towns) {
    if (heads.includes(s)) continue;
    let best = cap;
    for (const h of centres) if (hexDist(w.W, s.tile, h.tile) < hexDist(w.W, s.tile, best.tile)) best = h;
    if (best !== cap) (share.get(best.id) ?? share.set(best.id, []).get(best.id)!).push(s);
  }
  for (const h of heads) {
    const n = spawnCiv(w, c, h, r);
    for (const s of share.get(h.id) ?? []) transferSett(w, s, n.id);
    shareArmy(w, c, n);
    for (const s of [h, ...(share.get(h.id) ?? [])]) s.stab = Math.max(s.stab, 55);
    const rl = rel(w, n.id, c.id);
    rl.grudge = 20;
    rl.truce = w.tick + 15 * TICKS_PER_YEAR;
  }
  ev(w, { k: 'collapse', a: c.id, n: heads.length + 1 });
  if (c.era === 'golden') endEra(w, c); // an age of glory does not survive this
  if (!c.era) startEra(w, c, 'dark', r, r.range(20, 40));
  return true;
}

/** Towns first built by a fallen people rise again as its successor. */
function revive(w: World, s: Sett, r: Rand): void {
  const old = w.civs[s.o];
  const owner = w.civs[s.civ];
  const n = spawnCiv(w, owner, s, r, { values: old.values, phon: old.phon, parent: old.id });
  // They take the old name back, unless a living people already bears it.
  if (!w.civs.some((x) => x.died < 0 && x !== n && x.name === old.name)) n.name = old.name;
  if (old.faith >= 0 && w.faiths[old.faith].died < 0) n.faith = old.faith;
  for (const id of (tally.list[owner.id] ?? []).slice()) {
    const o = w.setts[id];
    if (o !== s && o.o === old.id && o.id !== owner.capital && hexDist(w.W, o.tile, s.tile) <= 4 && o.stab < 50) transferSett(w, o, n.id);
  }
  s.stab = 70;
  shareArmy(w, owner, n);
  rel(w, n.id, owner.id).grudge = 30;
  rel(w, n.id, owner.id).truce = w.tick + 15 * TICKS_PER_YEAR; // the old masters need time to answer
  ev(w, { k: 'revival', a: n.id, b: owner.id, s: s.id, x: old.name, n: old.id });
}

export function yearlyFate(w: World): void {
  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const ids = tally.list[c.id] ?? [];
    if (ids.length < 8) continue;
    let stab = 0;
    for (const id of ids) stab += w.setts[id].stab;
    stab /= ids.length;
    if (stab >= 32 || (c.lastCollapse !== undefined && w.tick - c.lastCollapse < 80 * TICKS_PER_YEAR)) continue;
    const r = new Rand(w.seed, S.CULTURE, w.tick, c.id, 0xc011);
    if (r.chance(0.2) && collapse(w, c, r)) c.lastCollapse = w.tick;
  }

  const revived = new Set<number>();
  for (const c of w.civs) if (c.parent >= 0 && w.civs[c.parent].died >= 0 && c.born >= w.civs[c.parent].died) revived.add(c.parent);
  for (const s of w.setts) {
    if (s.died >= 0 || s.o === s.civ || s.stab >= 35 || revived.has(s.o)) continue;
    const old = w.civs[s.o];
    const owner = w.civs[s.civ];
    if (old.died < 0 || w.tick - old.died > REVIVE_YEARS * TICKS_PER_YEAR || owner.capital === s.id) continue;
    if (old.parent >= 0 && w.civs[old.parent].name === old.name) continue; // already a people risen again
    const r = new Rand(w.seed, S.CULTURE, w.tick, s.id, 0x4e7);
    if (!r.chance(0.02)) continue;
    revive(w, s, r);
    revived.add(old.id);
  }
}

/**
 * Yearly per settlement: an unhappy town looks across the border. If a neighbour at peace with
 * its rulers has far more culture, it may simply change sides.
 */
export function maybeDefect(w: World, s: Sett, r: Rand): boolean {
  const c = w.civs[s.civ];
  if (s.stab >= 25 || c.capital === s.id) return false;
  let best: Civ | null = null;
  for (const o of w.setts) {
    if (o.died >= 0 || o.civ === s.civ || hexDist(w.W, o.tile, s.tile) > 5) continue;
    const n = w.civs[o.civ];
    if (n.culture < Math.max(100, c.culture * 2) || (best && best.culture >= n.culture)) continue;
    if (relOf(w, c.id, n.id)?.st === 'war') continue;
    best = n;
  }
  if (!best || !r.chance(0.1)) return false;
  transferSett(w, s, best.id);
  s.stab = 60;
  rel(w, c.id, best.id).grudge += 10;
  ev(w, { k: 'defect', a: best.id, b: c.id, s: s.id });
  return true;
}
