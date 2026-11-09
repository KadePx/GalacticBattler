// Named people: great generals, scholars, builders, merchants and prophets, and the rulers'
// dynasties, including the succession crises that can tear a realm in two.

import { ev, has, newRuler, spawnCiv, tally, transferSett } from './civ';
import { rel } from './diplo';
import { hexDist } from './hex';
import { epithet, NAME_KEY, word } from './names';
import { Rand, S } from './rng';
import { GREAT_KINDS, TICKS_PER_YEAR, type Civ, type GreatKind, type World } from './types';
import { declareWar } from './war';
import { openOmen } from './player';

const KIND_VALUE: Record<GreatKind, string> = { general: 'martial', scholar: 'curious', builder: 'artistic', merchant: 'mercantile', prophet: 'devout' };

export function greatCount(c: Civ, k: GreatKind): number {
  let n = 0;
  for (const g of c.greats) if (g.kind === k) n++;
  return n;
}

/** Yearly: great people pass on and new ones rise. */
export function yearlyGreats(w: World, c: Civ, atWar: boolean): void {
  const r = new Rand(w.seed, S.RULER, w.tick, c.id, 0x6e);
  c.greats = c.greats.filter((g) => {
    if (g.dies > w.tick) return true;
    ev(w, { k: 'great_died', a: c.id, x: g.name, y: g.kind, n: g.deeds });
    return false;
  });
  if (c.greats.length >= 3) return;
  const p = Math.min(0.06, 0.01 + tally.pop[c.id] / 3e6);
  if (!r.chance(p)) return;
  const wts = GREAT_KINDS.map((k) => 1 + (has(c, KIND_VALUE[k] as never) ? 2 : 0) + (k === 'general' && atWar ? 3 : 0) - greatCount(c, k));
  let x = r.float() * wts.reduce((a, b) => a + Math.max(0.1, b), 0);
  let kind: GreatKind = 'scholar';
  for (let i = 0; i < GREAT_KINDS.length; i++) {
    x -= Math.max(0.1, wts[i]);
    if (x <= 0) { kind = GREAT_KINDS[i]; break; }
  }
  const name = word(c.phon, c.lex, NAME_KEY.GREAT, c.greatN++);
  c.greats.push({ name, kind, born: w.tick, dies: w.tick + r.range(20, 40) * TICKS_PER_YEAR, deeds: 0 });
  ev(w, { k: 'great_born', a: c.id, x: name, y: kind });
}

/** Yearly: if the ruler has died, the throne passes, sometimes not peacefully. */
export function succession(w: World, c: Civ): void {
  if (c.ruler.dies > w.tick) return;
  const old = c.ruler;
  const yrs = Math.floor((w.tick - old.since) / TICKS_PER_YEAR);
  const title = `${old.name} ${epithet(new Rand(w.seed, S.RULER, c.id, c.rulers, 1), yrs, old.founded, old.built, old.famines)}`;
  const r = new Rand(w.seed, S.RULER, w.tick, c.id, 0xc415);
  const ids = tally.list[c.id] ?? [];
  let stab = 0;
  for (const id of ids) stab += w.setts[id].stab;
  stab /= Math.max(1, ids.length);
  const crisisP = 0.05 + (ids.length >= 6 ? 0.1 : 0) + (stab < 45 ? 0.12 : 0) + (old.trait === 'cruel' ? 0.05 : 0) - (has(c, 'ancestral') ? 0.05 : 0);
  // A founder's people: the heir takes the seat, but a rival claimant waits for the founder's sign.
  if (c.founder && ids.length >= 2 && !w.omens.some((o) => o.civ === c.id && o.k === 'claim')) {
    c.ruler = newRuler(w, c, old.house);
    ev(w, { k: 'succession', a: c.id, x: title, y: c.ruler.name, z: old.house, n: yrs });
    const rival = newRuler(w, c, null);
    openOmen(w, c, 'claim', { x: c.ruler.name, y: rival.name, z: rival.house });
    return;
  }
  if (!r.chance(crisisP)) {
    c.ruler = newRuler(w, c, old.house);
    ev(w, { k: 'succession', a: c.id, x: title, y: c.ruler.name, z: old.house, n: yrs });
    return;
  }
  // A crisis. A big, distant town backs a rival claimant; if there is none, a new house seizes the throne.
  if (civilWar(w, c, r, title, null)) return;
  c.ruler = newRuler(w, c, null);
  for (const id of ids) w.setts[id].stab = Math.max(5, w.setts[id].stab - 10);
  ev(w, { k: 'new_dynasty', a: c.id, x: title, y: c.ruler.name, z: c.ruler.house, n: yrs });
}

/**
 * A rival claimant splits the realm: a big town far from the capital and the towns nearer to it
 * than to the capital break away and go to war. claimant = null makes up a new ruler for them
 * (a contested succession); a given claimant is a founder's unanswered omen. Returns false if
 * the realm is too small or has no such town.
 */
export function civilWar(w: World, c: Civ, r: Rand, title: string, claimant: { name: string; house: string } | null): boolean {
  const ids = tally.list[c.id] ?? [];
  const cap = w.setts[c.capital];
  const rivals = ids.map((id) => w.setts[id]).filter((s) => s.id !== c.capital && hexDist(w.W, s.tile, cap.tile) >= 4).sort((a, b) => b.pop - a.pop || a.id - b.id);
  if (ids.length < 4 || !rivals.length) return false;
  if (!claimant) c.ruler = newRuler(w, c, c.ruler.house);
  const claim = rivals[0];
  const side = ids.map((id) => w.setts[id]).filter((s) => s.id !== c.capital && s.id !== claim.id && hexDist(w.W, s.tile, claim.tile) < hexDist(w.W, s.tile, cap.tile));
  const n = spawnCiv(w, c, claim, r);
  if (claimant) {
    n.ruler.name = claimant.name;
    n.ruler.house = claimant.house;
  }
  for (const s of side) transferSett(w, s, n.id);
  rel(w, n.id, c.id).grudge = 40;
  ev(w, { k: claimant ? 'claim_war' : 'crisis', a: n.id, b: c.id, s: claim.id, x: title, y: n.ruler.name, z: n.ruler.house, n: side.length + 1 });
  declareWar(w, n, c, 'succession', r);
  return true;
}
