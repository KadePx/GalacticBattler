// Milestone 6: what a founder can do. Influence refills slowly and buys small nudges: an edict
// (a priority for a generation), answers to omens, naming rights, gifts and alliance offers.
// Omens are questions the sim puts to a founder; if nobody answers in time, the AI decides.
// Everything here arrives as an input and is applied at the start of a tick, so it replays
// identically on the server and in every browser.

import { ev, newRuler, tally } from './civ';
import { rel, relOf, setState } from './diplo';
import { civilWar } from './people';
import { Rand, S } from './rng';
import { TECHS, techCost } from './techs';
import {
  EDICTS, TICKS_PER_YEAR, type ActInput, type Civ, type OfferInput, type Omen, type World,
} from './types';
import { endWar } from './war';

export const INF_TICKS = 480; // ticks per point of influence (3 a day at a month a minute)
export const INF_CAP = 9;
export const COST = { edict: 2, omen: 1, name: 1, gift: 2, propose: 3 } as const;
export const EDICT_YEARS = 40;
export const OMEN_TICKS = 720; // how long an omen waits for its founder (60 years: 12 hours today)
export const PROTECT_MAX_YEARS = 120; // protection can last this long while a people is small
export const NAME_YEARS = 30; // how long after a birth or founding its name can still be given

/** Influence a founder has right now. */
export function influence(w: World, c: Civ): number {
  if (!c.founder || c.died >= 0) return 0;
  return Math.min(INF_CAP, c.inf + (w.tick - c.infT) / INF_TICKS);
}

function spend(w: World, c: Civ, n: number): boolean {
  const have = influence(w, c);
  if (have < n) return false;
  c.inf = have - n;
  c.infT = w.tick;
  return true;
}

export function edictOn(w: World, c: Civ): string {
  return c.edict && c.edictUntil > w.tick ? c.edict : '';
}

/** Ask a founder something. One open omen of each kind per people. */
export function openOmen(w: World, c: Civ, k: Omen['k'], o: Partial<Omen> = {}): Omen | null {
  if (!c.founder || c.died >= 0 || w.omens.some((x) => x.civ === c.id && x.k === k)) return null;
  const om: Omen = { id: w.omenN++, civ: c.id, k, t: w.tick, due: w.tick + OMEN_TICKS, ...o };
  w.omens.push(om);
  ev(w, { k: 'omen', a: c.id, b: o.b, n: om.id, x: k });
  return om;
}

/** How many choices each kind of omen offers. */
export const OMEN_CHOICES: Record<Omen['k'], number> = { claim: 2, war: 2, sign: 3, pact: 2 };

function acceptAlliance(w: World, a: Civ, b: Civ): boolean {
  const r = relOf(w, a.id, b.id);
  return !!r && r.st !== 'war' && r.op >= 25;
}

function ally(w: World, a: number, b: number): void {
  const r = rel(w, a, b);
  if (r.st === 'war' || r.st === 'ally') return;
  setState(w, r, 'ally');
  r.op = Math.max(r.op, 30);
  ev(w, { k: 'ally', a: Math.min(a, b), b: Math.max(a, b) });
}

/** Settle an omen. pick = -1 means the founder never answered and the AI decides. */
export function resolveOmen(w: World, om: Omen, pick: number): void {
  w.omens = w.omens.filter((x) => x !== om);
  const c = w.civs[om.civ];
  if (c.died >= 0) return;
  const r = new Rand(w.seed, S.PLAYER, w.tick, om.id);
  const by = pick >= 0 ? 1 : 0; // the chronicle says whether the founder chose
  if (om.k === 'claim') {
    if (pick === 0) {
      for (const s of w.setts) if (s.civ === c.id && s.died < 0) s.stab = Math.min(95, s.stab + 5);
      ev(w, { k: 'omen_claim', a: c.id, x: om.x, y: om.y, n: 0 });
    } else if (pick === 1) {
      const heir = c.ruler;
      c.ruler = { ...newRuler(w, c, om.z ?? null), name: om.y ?? heir.name };
      ev(w, { k: 'omen_claim', a: c.id, x: om.x, y: om.y, z: om.z, n: 1 });
    } else {
      // Unanswered: the rival may still press the claim, as a realm without a sign would.
      const ids = w.setts.filter((s) => s.civ === c.id && s.died < 0);
      const stab = ids.reduce((a, s) => a + s.stab, 0) / Math.max(1, ids.length);
      const p = 0.1 + (ids.length >= 6 ? 0.1 : 0) + (stab < 45 ? 0.15 : 0);
      if (!r.chance(p) || !civilWar(w, c, r, om.x ?? c.ruler.name, { name: om.y ?? '', house: om.z ?? '' })) {
        ev(w, { k: 'omen_claim', a: c.id, x: om.x, y: om.y, n: 2 });
      }
    }
  } else if (om.k === 'war') {
    const war = w.wars[om.n ?? -1];
    if (!war || war.end >= 0 || pick < 0) return;
    if (pick === 0) {
      c.army = Math.floor(c.army * 1.3);
      c.weary = Math.max(0, c.weary - 20);
      ev(w, { k: 'omen_war', a: c.id, b: om.b, x: war.name, n: 0 });
    } else {
      const enemy = w.civs[om.b ?? -1];
      const pay = c.wealth * 0.25;
      c.wealth -= pay;
      if (enemy && enemy.died < 0) enemy.wealth += pay;
      ev(w, { k: 'omen_war', a: c.id, b: om.b, x: war.name, n: 1 });
      endWar(w, war, 'stalemate');
    }
  } else if (om.k === 'sign') {
    let p = pick;
    if (p < 0) p = c.values.includes('martial') ? 2 : c.values.includes('curious') ? 1 : 0;
    const cap = w.setts[c.capital];
    if (p === 0) {
      w.spells.push({ k: 'bounty', tile: cap.tile, r: 8, start: w.tick, end: w.tick + 3 * TICKS_PER_YEAR, mult: 1250 });
    } else if (p === 1) {
      const t = c.research >= 0 ? TECHS[c.research] : null;
      c.lore += t ? techCost(t) * 0.35 : 100;
    } else {
      c.army = Math.floor(c.army * 1.25) + 20;
      for (const s of w.setts) if (s.civ === c.id && s.died < 0) s.stab = Math.min(95, s.stab + 3);
    }
    ev(w, { k: 'omen_sign', a: c.id, n: p, z: by ? 'chosen' : '' });
  } else if (om.k === 'pact') {
    const from = w.civs[om.b ?? -1];
    if (!from || from.died >= 0) return;
    const yes = pick === 0 || (pick < 0 && acceptAlliance(w, c, from));
    if (yes) ally(w, c.id, from.id);
    else ev(w, { k: 'proposal_refused', a: from.id, b: c.id, n: by });
  }
}

/** A founder's nudge. Anything invalid (wrong owner, too little influence) is ignored. */
export function applyAct(w: World, inp: ActInput): void {
  const c = w.civs.find((x) => x.founder === inp.founder && x.died < 0);
  if (!c) return;
  if (inp.k === 'edict') {
    if (!(EDICTS as readonly string[]).includes(inp.edict) || !spend(w, c, COST.edict)) return;
    c.edict = inp.edict;
    c.edictUntil = w.tick + EDICT_YEARS * TICKS_PER_YEAR;
    ev(w, { k: 'edict', a: c.id, x: inp.edict });
  } else if (inp.k === 'omen') {
    const om = w.omens.find((o) => o.id === inp.id && o.civ === c.id);
    if (!om || !Number.isInteger(inp.pick) || inp.pick < 0 || inp.pick >= OMEN_CHOICES[om.k] || !spend(w, c, COST.omen)) return;
    resolveOmen(w, om, inp.pick);
  } else if (inp.k === 'name') {
    if (typeof inp.name !== 'string' || inp.name.length < 3 || inp.name.length > 24 || !nameable(w, c, inp.what, inp.id) || !spend(w, c, COST.name)) return;
    giveName(w, c, inp.what, inp.id, inp.name);
  } else if (inp.k === 'gift') {
    const o = w.civs[inp.to];
    const rl = o && o.id !== c.id ? relOf(w, c.id, o.id) : null;
    if (!o || o.died >= 0 || !rl || rl.st === 'war' || !c.contacts.includes(o.id) || !spend(w, c, COST.gift)) return;
    const gold = c.wealth * 0.1;
    c.wealth -= gold;
    o.wealth += gold;
    rl.op = Math.min(100, rl.op + 15);
    rl.grudge = Math.max(0, rl.grudge - 10);
    ev(w, { k: 'gift', a: c.id, b: o.id, n: Math.round(gold) });
  } else if (inp.k === 'propose') {
    const o = w.civs[inp.to];
    const rl = o && o.id !== c.id ? relOf(w, c.id, o.id) : null;
    if (!o || o.died >= 0 || !rl || rl.st === 'war' || rl.st === 'ally' || !c.contacts.includes(o.id) || !spend(w, c, COST.propose)) return;
    ev(w, { k: 'proposal', a: c.id, b: o.id });
    if (o.founder && openOmen(w, o, 'pact', { b: c.id })) return;
    if (acceptAlliance(w, o, c)) ally(w, c.id, o.id);
    else ev(w, { k: 'proposal_refused', a: c.id, b: o.id, n: 0 });
  }
}

/** Can this founder still give this thing a name? */
export function nameable(w: World, c: Civ, what: string, id: number): boolean {
  const recent = (born: number) => w.tick - born <= NAME_YEARS * TICKS_PER_YEAR;
  if (!Number.isInteger(id) || id < 0) return false;
  if (what === 'sett') {
    const s = w.setts[id];
    return !!s && s.civ === c.id && s.died < 0 && !s.pn && recent(s.born);
  }
  if (what === 'great') {
    const g = c.greats[id];
    return !!g && !g.pn && recent(g.born);
  }
  if (what === 'wonder') {
    const wd = w.wonders[id];
    return !!wd && !wd.by && w.setts[wd.s].civ === c.id && w.setts[wd.s].died < 0;
  }
  if (what === 'river') {
    const rv = w.rivers[id];
    return !!rv && !rv.pn && (rv.namedBy === c.id || rv.namedBy < 0) && riverTouches(w, rv.id, c.id) >= 0;
  }
  return false;
}

/** A settlement of this people on the river, or -1 if the river never crosses their land. */
export function riverTouches(w: World, river: number, civ: number): number {
  const t = w.t;
  let land = false;
  for (let i = 0; i < t.river.length; i++) {
    if (t.river[i] !== river || t.owner[i] !== civ) continue;
    land = true;
    const s = t.work[i] >= 0 ? t.work[i] : t.city[i];
    if (s >= 0) return s;
  }
  return land ? w.civs[civ].capital : -1;
}

function giveName(w: World, c: Civ, what: string, id: number, name: string): void {
  if (what === 'sett') {
    const s = w.setts[id];
    const old = s.name;
    s.name = name;
    s.pn = 1;
    delete s.g;
    ev(w, { k: 'renamed', a: c.id, s: s.id, x: old, y: name });
  } else if (what === 'great') {
    const g = c.greats[id];
    const old = g.name;
    g.name = name;
    g.pn = 1;
    ev(w, { k: 'great_named', a: c.id, x: old, y: name, z: g.kind });
  } else if (what === 'wonder') {
    const wd = w.wonders[id];
    const old = wd.name;
    wd.name = `the ${name}`;
    wd.by = c.byName || 'founder';
    ev(w, { k: 'wonder_named', a: c.id, s: wd.s, x: old, y: wd.name });
  } else if (what === 'river') {
    const rv = w.rivers[id];
    rv.name = name;
    rv.namedBy = c.id;
    rv.pn = 1;
    delete rv.g;
    ev(w, { k: 'river_named', a: c.id, s: riverTouches(w, rv.id, c.id), x: name });
  }
}

/** A pilgrim's offering: a little calm, and a count that everyone can see. */
export function applyOffer(w: World, inp: OfferInput): void {
  const s = w.setts[inp.s];
  if (!s || s.died >= 0) return;
  s.offers = (s.offers ?? 0) + 1;
  s.stab = Math.min(95, s.stab + 1);
  if (s.offers % 10 === 0) ev(w, { k: 'pilgrims', a: s.civ, s: s.id, n: s.offers });
}

/** Yearly: unanswered omens fall to the AI, edicts lapse, and now and then the sky gives a sign. */
export function yearlyPlayer(w: World): void {
  for (const om of w.omens.slice()) {
    if (w.civs[om.civ].died >= 0) w.omens = w.omens.filter((x) => x !== om);
    else if (om.due <= w.tick) resolveOmen(w, om, -1);
  }
  const pops: number[] = [];
  for (const c of w.civs) if (c.died < 0) pops.push(tally.pop[c.id]);
  pops.sort((a, b) => a - b);
  const median = pops.length ? pops[pops.length >> 1] : 0;
  for (const c of w.civs) {
    if (!c.founder || c.died >= 0) continue;
    if (c.edict && c.edictUntil <= w.tick) c.edict = '';
    // A young people stays under protection while it is smaller than most. Growing (more towns,
    // more people) doesn't end it early; only outgrowing the typical people of the world does.
    if (w.tick - c.born < PROTECT_MAX_YEARS * TICKS_PER_YEAR && tally.pop[c.id] < median) {
      c.protectedUntil = Math.max(c.protectedUntil, w.tick + 2 * TICKS_PER_YEAR);
    }
    const r = new Rand(w.seed, S.PLAYER, w.tick, c.id, 0x5167);
    if (r.chance(1 / 50)) openOmen(w, c, 'sign');
  }
}
