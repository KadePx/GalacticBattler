// Expeditions: now and then the colony sends a small named party out beyond its own land to
// search a ruin, a cave, an old tomb. They muster at the gate, walk out along the road and are
// gone for days. While they are away they are off the map and out of the colony's list (no work,
// no meals), but they are still the colony's own: their homes, families and trades are kept for
// them. A line a day tells how they fare. They come home with silver, a relic for the hall, a map
// to somewhere further, a freed captive, wounds, or nothing; and once in a long while they do
// not come home at all.

import { DAYS_PER_SEASON, HARD_CAP, TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, hourOf, seasonOf } from '../config';
import { cacheOf, touchAt } from './cache';
import { castleHall } from './castle';
import { canFight } from './combat';
import { cells, shapeOf } from './data/buildings';
import { foodDays } from './econ';
import { bump, log, note } from './events';
import { isDown, needsRest, wound } from './health';
import { die } from './life';
import { think } from './mood';
import { natBusy } from './nature';
import { findPath } from './path';
import { STAGE, awayById, gainXp, has, makePawn, mkAct, pawnById, per, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { arrive, hasMod } from './story';
import { addLore } from './tech';
import { AX, B, F, type ActK, type Bld, type Colony, type Ev, type Id, type Pawn, type XParty, type XRelic, type XSite } from './types';

const H = TICKS_PER_HOUR;
const D = TICKS_PER_DAY;

/** Relics the colony can have on display at once. */
export const RELIC_CAP = 6;
/** Expeditions kept for the colony's page once they are over. */
const DONE_KEEP = 8;
/** Days overdue before word goes round, and before the party is given up for lost. */
const OVERDUE = 3;
const GIVEN_UP = 7;

export const SITE_KINDS = ['ruin', 'cave', 'tomb', 'wreck', 'tower'] as const;
const FAR_NAMES: Record<string, string[]> = {
  ruin: ['the ruins of Caer Vael', 'the Drowned Abbey', 'the Broken Hall of Ysmere', 'the old fort at Dunmere', 'the Burnt Priory', 'the Sunken Road'],
  cave: ['the Weeping Caves', 'the Wolfsmouth', 'the Glittering Deep', 'the Echoing Halls', 'the Blind Caverns', 'Old Mother\'s Cellar'],
  tomb: ['the Barrow of Kings', 'the Tomb of the Nameless Queen', 'the Seven Cairns', 'the Crypt of Saint Ossa', 'the Hollow Barrow', 'the Grave of the Nine'],
  wreck: ['the wreck of the Grey Gull', 'the wreck of the Queen Morra', 'the longship in the reeds', 'the lost wagons of the salt merchants', 'the Red Thane\'s abandoned war-camp', 'the wreck of the Saint Ossa'],
  tower: ['the Leaning Tower', 'the Tower of Orrin the Unwise', 'the Watchtower at World\'s End', 'the Star-gazer\'s Tower', 'the Black Finger', 'the Lantern of the Drowned'],
};
/** What each kind of place is most likely said to hold. */
const PROMISE: Record<string, string[]> = {
  ruin: ['goods', 'silver', 'lore', 'relic'], cave: ['iron', 'iron', 'silver', 'relic'], tomb: ['relic', 'silver', 'relic', 'goods'],
  wreck: ['silver', 'goods', 'goods', 'iron'], tower: ['lore', 'relic', 'lore', 'silver'],
};

/** The relics: what each is, and what it does for the colony while it is on display. */
export const RELIC_KINDS: { k: string; fx: 'mood' | 'def' | 'dev' | 'lore' }[] = [
  { k: 'Crown', fx: 'mood' }, { k: 'Sword', fx: 'def' }, { k: 'Chalice', fx: 'dev' }, { k: 'Tablets', fx: 'lore' },
  { k: 'Horn', fx: 'def' }, { k: 'Idol', fx: 'dev' }, { k: 'Star-stone', fx: 'lore' }, { k: 'Banner', fx: 'mood' },
];
const RELIC_OF = ['the Nameless Queen', 'Old King Hrolf', 'the Drowned Prince', 'the Last Watch', 'Saint Ossa', 'the First Winter', 'the Nine Sisters', 'the Grey Pilgrim', 'Caer Vael', 'the Hollow King', 'the Long Night', 'Ysmere'];
const EPITHETS: Record<string, string> = { camp: 'the Seeker', ruin: 'the Seeker', cave: 'the Delver', tomb: 'Barrow-walker', wreck: 'Wreck-finder', tower: 'of the Tower' };

type Exp = NonNullable<Colony['exp']>;

const blank = (): Exp => ({ n: 1, nx: 0, l: [], rel: [], nr: 1, sites: [], seen: [], dead: [], done: [], late: [], ak: -99 });

/** The colony's expedition state, begun (with the first party some days off) if it has none yet. */
export function expOf(c: Colony): Exp {
  if (!c.exp) { c.exp = blank(); c.exp.nx = dayOf(c.tick) + 8; }
  return c.exp;
}

/** Everyone away with an expedition, the missing included. */
export function awayPawns(c: Colony): Pawn[] {
  const x = c.exp;
  if (!x) return [];
  const out: Pawn[] = [];
  for (const q of x.l) for (const p of q.pw) out.push(p);
  for (const l of x.late) out.push(l.pw);
  return out;
}

/** Those away who are expected home: not the missing, nor anyone given up for lost. */
export function awayDue(c: Colony): Pawn[] {
  const x = c.exp;
  if (!x) return [];
  const out: Pawn[] = [];
  for (const q of x.l) if (q.m !== 4) for (const p of q.pw) out.push(p);
  return out;
}

/** The colony gathers once for a whole party that never came home. */
export function memorialEnd(c: Colony, there: Pawn[]): void {
  const x = c.exp;
  const m = x?.mem;
  for (const p of there) think(c, p, 'x_memorial');
  log(c, 'x_memorial', m?.a, undefined, m?.site ?? '', there.length);
  if (x && m) delete x.mem;
}

/** Is this colonist away with an expedition (alive, as far as anyone knows, and coming back)? */
export const isAway = (c: Colony, id: Id): boolean => !!awayById(c, id);

/** The party a colonist belongs to (mustering, away or walking home), if any. */
export function partyOf(c: Colony, id: Id): XParty | undefined {
  const x = c.exp;
  if (!x) return undefined;
  for (const q of x.l) if (q.ids.includes(id) && !q.fallen.includes(id)) return q;
  return undefined;
}

/** Relics doing a given kind of good, for the rest of the sim to ask about. */
export function relicCount(c: Colony, fx: string): number {
  const x = c.exp;
  if (!x || !x.rel.length) return 0;
  let n = 0;
  for (const r of x.rel) if (r.fx === fx && r.i >= 0) n++;
  return n;
}

const troubled = (c: Colony): boolean => !!(c.foes.length || c.alarm || c.siege || c.raidFrom);

/** Is this a time to send people away? Not under attack, in plague or famine, in the snow, or with the land in uproar. */
function quietTimes(c: Colony): boolean {
  if (troubled(c)) return false;
  if (c.plague && c.tick - c.plague.last < 8 * D) return false;
  if (foodDays(c) < 5) return false;
  if (seasonOf(c.tick) === 3 || hasMod(c, 'coldsnap') || hasMod(c, 'hardwinter')) return false;
  if (c.nat && natBusy(c.nat, c.tick)) return false;
  for (const p of c.pawns) if (p.ill && p.ill.k === 'plague') return false;
  return true;
}

/** The tile where the road leaves the map. */
function roadEnd(c: Colony): [number, number] {
  return [c.gx, Math.max(1, Math.min(c.h - 2, c.gy))];
}

/** An open tile colonists can stand on at or near (x,y): the n-th of them, so a group spreads out. */
function standAt(c: Colony, x: number, y: number, n: number): [number, number] | null {
  const k = cacheOf(c);
  let seen = 0;
  let first: [number, number] | null = null;
  for (let rad = 0; rad <= 4; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 1 || ty < 1 || tx >= c.w - 1 || ty >= c.h - 1) continue;
        const i = ty * c.w + tx;
        if (!k.walk[i] || !k.reach[i] || c.st[i] === B.DOOR || c.st[i] === B.GATE || c.st[i] >= B.BED && c.st[i] < B.FLOOR_BARE) continue;
        if (!first) first = [tx, ty];
        if (seen++ === n) return [tx, ty];
      }
    }
  }
  return first;
}

/** Where a party musters (just inside the gate on the road out, or at the edge of town) and the heart of town where it is welcomed home. */
function musterSpots(c: Colony): { x: number; y: number; wx: number; wy: number } | null {
  const w = standAt(c, c.cx, c.cy, 0);
  if (!w) return null;
  const [ex, ey] = roadEnd(c);
  const found = findPath(c, w[0], w[1], ex, ey, false);
  if (!found || found.path.length < 12) return null;
  const path = found.path;
  let at = Math.min(path.length - 6, 26);
  for (let k = 0; k < path.length; k++) if (c.st[path[k]] === B.GATE) { at = Math.max(2, k - 3); break; }
  const i = path[at];
  const s = standAt(c, i % c.w, Math.floor(i / c.w), 0);
  if (!s) return null;
  return { x: s[0], y: s[1], wx: w[0], wy: w[1] };
}

// ---------------------------------------------------------------- where to go

function farSite(c: Colony, x: Exp, r: Rand): XSite {
  const k = r.pick(SITE_KINDS);
  const names = FAR_NAMES[k].filter((n) => !x.seen.includes(n));
  const name = names.length ? r.pick(names) : r.pick(FAR_NAMES[k]);
  const roll = r.float();
  const d = roll < 0.4 ? 1 : roll < 0.8 ? 2 : 3;
  return { k, name, d, p: r.pick(PROMISE[k]), far: 1 + r.int(3) };
}

/** Pick where the next party goes: somewhere a map has shown, the old stones on the colony's own land, a dead colony nearby, or a place of legend. */
function pickSite(c: Colony, x: Exp, r: Rand): XSite {
  if (x.sites.length) return x.sites.shift()!;
  const opts: XSite[] = [];
  // the ruins on the colony's own land (or the dead colony it was built over)
  const local = c.ruins ? `the old cellars of ${c.ruins}` : 'the old stones beyond the fields';
  if (!x.seen.includes(local)) {
    let ruins = c.ruins ? 3 : 0;
    if (!ruins) for (let i = 0; i < c.feat.length && ruins < 3; i++) if (c.feat[i] === F.RUIN) ruins++;
    if (ruins >= 3) opts.push({ k: 'ruin', name: local, d: 1, p: 'goods', far: 1 });
  }
  // colonies that died: their halls stand empty a day or two down the road
  for (const name of x.dead) {
    const n = `the ruins of ${name}`;
    if (!x.seen.includes(n)) { opts.push({ k: 'ruin', name: n, d: 2, p: r.chance(0.5) ? 'silver' : 'relic', far: 2 }); break; }
  }
  if (opts.length && r.chance(0.45)) return r.pick(opts);
  return farSite(c, x, r);
}

/** A warlord's host has gone from the gates: what it left of its camp is worth a look. */
export function campLeft(c: Colony, name: string): void {
  const x = c.exp;
  if (!x || x.sites.length >= 3) return;
  const n = `the abandoned war-camp of ${name}`;
  if (x.seen.includes(n) || x.sites.some((s) => s.name === n)) return;
  x.sites.push({ k: 'camp', name: n, d: 1, p: 'goods', far: 1 });
}

// ---------------------------------------------------------------- who goes

const arms = (p: Pawn): number => Math.max(p.sk[0], p.sk[1]);

/** People who cannot be spared or are caught up in something: titles, masters, plots, trials, weddings, dramas, today's stalls, a visitor's business. */
export function tiedDown(c: Colony): Set<Id> {
  const out = new Set<Id>();
  for (const k in c.gov.titles) out.add(c.gov.titles[k]);
  out.add(c.gov.ruler);
  out.add(c.gov.regent);
  if (c.plot) { out.add(c.plot.lead); for (const id of c.plot.mem) out.add(id); }
  for (const t of c.trials) { out.add(t.a); out.add(t.by); }
  if (c.gath) { if (c.gath.a) out.add(c.gath.a); if (c.gath.o) out.add(c.gath.o); }
  const n = c.nat;
  if (n) {
    if (n.curse) out.add(n.curse.a);
    if (n.haunt) out.add(n.haunt.v);
    if (n.cra) out.add(n.cra.a);
    if (n.lost) out.add(n.lost.a);
    if (n.el) { out.add(n.el.a); out.add(n.el.b); out.add(n.el.by); }
    if (n.duel) { out.add(n.duel.a); out.add(n.duel.b); out.add(n.duel.o); }
    if (n.nw) { out.add(n.nw.a); out.add(n.nw.b); }
  }
  if (c.mkt) for (const s of c.mkt.st) out.add(s.o);
  if (c.tech) for (const id of c.tech.ord) out.add(id);
  if (c.vis) for (const v of c.vis.l) if (v.o) out.add(v.o);
  for (const p of c.pawns) {
    if (p.appr) { out.add(p.id); out.add(p.appr[0]); }
    // nobody leaves with a child on the way
    if (p.preg) { out.add(p.id); out.add(p.preg.fa); if (p.sp) out.add(p.sp); }
    // small children keep their parents at home
    if (stage(c, p) <= STAGE.CHILD) { out.add(p.mo); out.add(p.fa); }
  }
  return out;
}

export function fit(c: Colony, p: Pawn, tied: Set<Id>, chosen = false): boolean {
  if (p.gone || stage(c, p) !== STAGE.ADULT || tied.has(p.id)) return false;
  if (isDown(p) || needsRest(p) || p.brk || p.preg || p.thrall || p.ill || p.inj.length || p.hp < 75 || p.ask || (p.urge && p.urge[2] > c.tick)) return false;
  if (p.sp && p.rel[p.sp]?.k === 'betrothed') return false;
  if (p.owner && !chosen && !(p.vol !== undefined && p.vol > c.tick)) return false;
  return true;
}

/** How keen someone is to go: the curious and the bold, less so those only just back from the last one. */
function keen(c: Colony, p: Pawn): number {
  let back = 0;
  for (let i = p.bio.length - 1; i >= 0 && i >= p.bio.length - 12; i--) {
    const b = p.bio[i];
    if (b.k === 'x_led' || b.k === 'x_went') { if (c.tick - b.t < 40 * D) back = c.tick - b.t < 20 * D ? 9 : 5; break; }
  }
  return -back + per(p, AX.CURIOUS) * 3 + per(p, AX.BRAVE) * 3 + (has(p, 'wanderlust') ? 6 : 0) - (has(p, 'homebody') ? 8 : 0) + (p.goal === 'wander' || p.goal === 'remembered' || p.goal === 'rich' ? 4 : 0);
}

/** Choose the party: a leader, then the best fit for each part (fighters, a scout, someone who can read old stone or bind a wound). */
function pickParty(c: Colony, r: Rand): { ids: Id[]; ro: string[] } | null {
  const tied = tiedDown(c);
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT && !isDown(p));
  if (adults.length < 18) return null;
  const pool = c.pawns.filter((p) => fit(c, p, tied));
  // nobody who is the only one of their trade, and never more than a third of the wardens
  const trade: Record<string, number> = {};
  for (const p of adults) if (p.prof) trade[p.prof] = (trade[p.prof] ?? 0) + 1;
  let wardens = 0;
  for (const p of adults) if (p.prof === 'guard' || p.prof === 'scout') wardens++;
  let wardensOut = 0;
  const spare = (p: Pawn): boolean => {
    if (p.owner) return true;
    if (p.prof === 'guard' || p.prof === 'scout') return wardensOut < Math.floor(wardens / 3);
    return !p.prof || (trade[p.prof] ?? 0) >= 2;
  };
  const want = Math.max(2, Math.min(5, Math.floor(adults.length / 9), 2 + r.int(4)));
  const noise = new Map<Id, number>();
  for (const p of pool) noise.set(p.id, r.float() * 4);
  const base = new Map<Id, number>();
  for (const p of pool) base.set(p.id, keen(c, p));
  const k = (p: Pawn): number => base.get(p.id)! + noise.get(p.id)!;
  const ids: Id[] = [];
  const ro: string[] = [];
  const take = (p: Pawn, role: string): void => {
    ids.push(p.id);
    ro.push(role);
    if (p.prof) trade[p.prof]--;
    if (p.prof === 'guard' || p.prof === 'scout') wardensOut++;
  };
  const best = (score: (p: Pawn) => number, min: number): Pawn | undefined => {
    let out: Pawn | undefined;
    let top = min;
    for (const p of pool) {
      if (ids.includes(p.id) || !spare(p)) continue;
      const s = score(p);
      if (s > top) { top = s; out = p; }
    }
    return out;
  };
  const lead = best((p) => (canFight(c, p) ? per(p, AX.BRAVE) * 4 + p.sk[10] + arms(p) * 0.6 + p.rank * 1.5 + k(p) : -1e9), 4);
  if (!lead) return null;
  take(lead, 'lead');
  // a player's colonist who stepped forward goes (two at most)
  for (const p of pool) if (p.owner && !ids.includes(p.id) && ids.length < Math.min(want, 3)) take(p, canFight(c, p) ? 'sword' : p.sk[11] >= p.sk[8] ? 'lore' : 'heal');
  const parts: [string, (p: Pawn) => number, number][] = [
    ['sword', (p) => (canFight(c, p) ? arms(p) + k(p) * 0.5 : -1e9), 3],
    ['scout', (p) => (p.prof === 'scout' || p.prof === 'hunter' ? 6 : 0) + p.sk[1] * 0.6 + p.sk[9] * 0.4 + k(p) * 0.5, 4],
    ['lore', (p) => Math.max(p.sk[11], p.sk[8]) + k(p) * 0.4, 5],
    ['sword', (p) => (canFight(c, p) ? arms(p) + k(p) * 0.5 : -1e9), 3],
  ];
  for (const [role, score, min] of parts) {
    if (ids.length >= want) break;
    const p = best(score, min);
    if (p) take(p, role === 'lore' && p.sk[8] > p.sk[11] ? 'heal' : role);
  }
  // still short: anyone willing
  while (ids.length < 2) {
    const p = best((q) => k(q) + arms(q) * 0.3, -3);
    if (!p) break;
    take(p, canFight(c, p) ? 'sword' : 'pack');
  }
  if (ids.length < 2) return null;
  return { ids, ro };
}

/** Call an expedition now, if a party and a way out can be found. Returns the party, or null. */
export function callParty(c: Colony, site?: XSite): XParty | null {
  const x = (c.exp ??= blank());
  if (x.l.length) return null;
  const day = dayOf(c.tick);
  const r = new Rand(c.seed, S.EXPED, day, 1);
  const spots = musterSpots(c);
  if (!spots) return null;
  const who = pickParty(c, r);
  if (!who) return null;
  const s = site ?? pickSite(c, x, r);
  const go = day * D + 8 * H + (c.tick % D > 6 * H ? D : 0);
  const stay = 1 + (s.d >= 2 && r.chance(0.5) ? 1 : 0);
  const q: XParty = {
    id: x.n++, site: s, lead: who.ids[0], ids: who.ids, ro: who.ro, pw: [], m: 0, t0: c.tick, go, back: go - 8 * H + (s.far * 2 + stay) * D + (10 + r.int(5)) * H, t3: 0,
    x: spots.x, y: spots.y, wx: spots.wx, wy: spots.wy, stay, day: 0, beats: [], silver: 0, iron: 0, goods: 0, lore: 0, relic: -1, rn: '', hurt: 0, fallen: [], cap: 0, od: 0,
  };
  x.l.push(q);
  for (const id of q.ids) { const p = pawnById(c, id); if (p) p.vol = undefined; }
  beat(c, q, 'x_call', q.lead, undefined, `${s.name}|${s.k}|${s.far}`, q.ids.length);
  return q;
}

function beat(c: Colony, q: XParty, k: string, a?: Id, b?: Id, s?: string, n?: number): void {
  const e: Ev = { t: c.tick, k };
  if (a !== undefined) e.a = a;
  if (b !== undefined) e.b = b;
  if (s !== undefined) e.s = s;
  if (n !== undefined) e.n = n;
  q.beats.push(e);
  log(c, k, a, b, s, n);
}

// ---------------------------------------------------------------- day by day

/** Each midnight: tell the day's part of the tale of a party that is away, look after the relics, and call the next party when the time is right. */
export function dailyExped(c: Colony): void {
  let x = c.exp;
  const day = dayOf(c.tick);
  if (!x) {
    // the first look: a colony that was already running starts its clock now, some days off
    if (c.pawns.length < 20) return;
    x = c.exp = blank();
    x.nx = day + 5 + new Rand(c.seed, S.EXPED, day, 2).int(12);
    return;
  }
  for (const q of x.l.slice()) {
    if (q.m === 2) awayDay(c, x, q, day);
    else if (q.m === 4) missingDay(c, x, q, day);
  }
  if (x.mem) {
    if (!c.gath && !troubled(c)) {
      const yard = c.blds.find((b) => b.k === 'graveyard' && b.built) ?? c.blds.find((b) => b.k === 'shrine' && b.built) ?? c.blds.find((b) => b.k === 'hall' && b.built);
      c.gath = { k: 'memorial', t0: c.tick + 10 * H, t1: c.tick + 12 * H, b: yard?.id ?? 0, a: x.mem.a, x: yard ? yard.x + Math.floor(yard.w / 2) : c.cx, y: yard ? yard.y + Math.floor(yard.h / 2) : c.cy };
    } else if (c.gath?.k !== 'memorial' && day - dayOf(x.mem.t) > 6) delete x.mem;
  }
  if (x.rel.length) relicsDaily(c, x, day);
  for (const p of c.pawns) if (p.vol !== undefined && p.vol <= c.tick) p.vol = undefined;
  if (x.l.length || day < x.nx - 1) return;
  if (!quietTimes(c)) { if (day >= x.nx) x.nx = day + 2; return; }
  if (day < x.nx) {
    // the day before: talk of it goes round, and the players' own are asked if they would go. Only when a
    // party could really form, and not again for a while after the last time of asking
    if (day - (x.ak ?? -99) < 10 || !c.pawns.some((p) => p.owner) || !musterSpots(c) || !pickParty(c, new Rand(c.seed, S.EXPED, day, 9))) return;
    let asked = false;
    for (const p of c.pawns) if (p.owner && !p.ask && p.vol === undefined && stage(c, p) === STAGE.ADULT && !isDown(p) && !p.thrall) { askVenture(c, p); asked = true; }
    if (asked) x.ak = day;
    return;
  }
  const q = callParty(c);
  x.nx = day + (q ? 0 : 4);
}

/** Put the question to a player's colonist (as ask() in ask.ts does; that file imports this one). It lapses in a day. */
function askVenture(c: Colony, p: Pawn): void {
  p.ask = { k: 'venture', o: undefined, n: undefined, x: c.tick + D };
  log(c, 'asked', p.id, undefined, 'venture');
}

/** A colonist steps forward for the next party (a player's choice). */
export function volunteer(c: Colony, p: Pawn): void {
  // (it stands until a party next sets out with them)
  p.vol = c.tick + 6000 * D;
  log(c, 'x_vol', p.id);
}

const HAZARDS: Record<string, string[]> = { camp: ['trap', 'beast'], ruin: ['collapse', 'beast'], cave: ['fall', 'water', 'beast'], tomb: ['trap', 'collapse', 'beast'], wreck: ['water', 'fall'], tower: ['fall', 'trap', 'collapse'] };
const HAZ_WOUND: Record<string, string> = { collapse: 'crush', fall: 'crush', trap: 'cut', beast: 'bite', water: 'bruise' };
const HAZ_CAUSE: Record<string, string> = { collapse: 'x_crush', fall: 'x_fall', trap: 'x_trap', beast: 'x_beast', water: 'x_drown' };

/** How well the party can look after itself against a place this dangerous: about 1 is a fair match. */
function strength(c: Colony, q: XParty): number {
  let s = 0;
  for (const p of q.pw) s += 2 + arms(p) + (c.stock.weapons >= q.pw.length ? 2 : 0);
  return s / (q.site.d * 16);
}
const hasRole = (q: XParty, role: string): boolean => q.pw.some((p) => q.ro[q.ids.indexOf(p.id)] === role);

/** Someone is hurt on the road or in the dark. A player's colonist is never killed out there. */
function hurt(c: Colony, q: XParty, p: Pawn, kind: string, sev: number, r: Rand): void {
  wound(c, p, kind, hasRole(q, 'heal') ? sev * 0.7 : sev, r);
  // bound up on the road: it will not bleed or fester, and they can walk home on it
  for (const i of p.inj) { i.tend = 1; i.bleed = 0; }
  if (p.hp < 30) p.hp = 30;
  q.hurt++;
}

function fall(c: Colony, x: Exp, q: XParty, p: Pawn, cause: string): void {
  // far from anyone at home who might have seen it
  p.act = mkAct('idle', c.tick, -99, -99, 1, 'away');
  q.pw = q.pw.filter((o) => o !== p);
  q.fallen.push(p.id);
  die(c, p, cause);
  for (const o of q.pw) think(c, o, 'x_lostmate', p.id);
  void x;
}

function awayDay(c: Colony, x: Exp, q: XParty, day: number): void {
  q.day++;
  const d = q.day;
  const s = q.site;
  const r = new Rand(c.seed, S.EXPED, day, 3, q.id);
  const lead = q.pw.find((p) => p.id === q.lead) ?? q.pw[0];
  if (!lead) return;
  if (lead.id !== q.lead) q.lead = lead.id;
  const str = strength(c, q);
  const scout = hasRole(q, 'scout');
  const tag = d * 1000;
  if (d < s.far || (d > s.far + q.stay && d < s.far * 2 + q.stay)) {
    // a day on the road
    if (r.chance((0.06 + 0.04 * s.d) * (scout ? 0.5 : 1))) {
      const what = r.chance(0.5) ? 'wolves' : 'bandits';
      const victim = r.chance(Math.max(0.15, 0.7 - str * 0.3)) ? r.pick(q.pw) : undefined;
      if (victim) hurt(c, q, victim, what === 'wolves' ? 'bite' : 'cut', 8 + r.int(12), r);
      beat(c, q, 'x_ambush', victim?.id, undefined, `${s.name}|${what}`, tag);
    } else {
      let v = r.int(6);
      const last = q.beats[q.beats.length - 1];
      if (last && last.k === 'x_road' && (last.n ?? 0) % 10 === v) v = (v + 1 + r.int(4)) % 6;
      beat(c, q, 'x_road', undefined, undefined, s.name, tag + v + (d > s.far ? 10 : 0));
    }
    return;
  }
  if (d === s.far) { beat(c, q, 'x_reach', lead.id, undefined, `${s.name}|${s.k}`, tag + s.d); return; }
  if (d === s.far + q.stay + 1 && d <= s.far * 2 + q.stay) {
    if (d === s.far * 2 + q.stay) return; // home today: the gate will tell it
    beat(c, q, 'x_homeward', lead.id, undefined, `${s.name}|${q.relic >= 0 || q.silver + q.goods * 3 + q.iron * 3 >= 70 ? 'rich' : q.fallen.length ? 'grim' : q.hurt ? 'hurt' : q.silver + q.goods + q.iron + q.lore > 0 || q.map || q.cap ? 'some' : 'bare'}`, tag);
    return;
  }
  if (d > s.far + q.stay) return;

  // a day in the place itself: something bars the way, and the leader's nature decides
  const bold = per(lead, AX.BRAVE) + per(lead, AX.CURIOUS) * 0.5 + per(lead, AX.GREED) * 0.4 + (has(lead, 'reckless') ? 1 : 0) - (has(lead, 'cautious') ? 1 : 0) + (r.float() * 1.4 - 0.7);
  const dare = bold > 0.25;
  beat(c, q, dare ? 'x_dare' : 'x_care', lead.id, undefined, `${s.name}|${s.k}`, tag + r.int(3));
  // the worst of it: a party that pushes too deep into a bad place may never be seen again
  if (r.chance((dare ? 0.035 * s.d - 0.02 : s.d === 3 ? 0.012 : 0) * (scout ? 0.5 : 1) * (str > 1.3 ? 0.6 : 1))) { q.m = 4; return; }
  const risk = Math.max(0.04, Math.min(0.6, 0.06 + 0.09 * s.d + (dare ? 0.12 : 0) - 0.08 * str));
  if (r.chance(risk)) {
    const haz = r.pick(HAZARDS[s.k] ?? HAZARDS.ruin);
    const victim = r.pick(q.pw);
    const sev = 10 + r.int(10 + s.d * 8);
    const deadly = !victim.owner && q.pw.length > 1 && r.chance((dare ? 0.22 : 0.08) * (s.d / 2) * (hasRole(q, 'heal') ? 0.5 : 1) / Math.max(0.6, stat(victim, 'tough')));
    beat(c, q, 'x_hazard', victim.id, undefined, `${s.name}|${haz}`, tag + (deadly ? 1 : 0));
    if (deadly) fall(c, x, q, victim, HAZ_CAUSE[haz]);
    else hurt(c, q, victim, HAZ_WOUND[haz], sev, r);
    if (!q.pw.length) { conclude(c, x, q, 'lost'); return; }
  }
  // and what they find
  const finder = r.pick(q.pw);
  const scholar = q.pw.find((p) => q.ro[q.ids.indexOf(p.id)] === 'lore') ?? (finder.sk[11] >= 5 ? finder : undefined);
  const rich = (dare ? 1.5 : 0.8) * (0.7 + s.d * 0.3);
  const roll = r.float();
  const p0 = s.p;
  const relicOdds = x.rel.length + (q.relic >= 0 ? 1 : 0) >= RELIC_CAP ? 0 : p0 === 'relic' ? (dare ? 0.5 : 0.22) : dare ? 0.1 : 0.04;
  if (q.relic < 0 && roll < relicOdds) {
    const have = new Set(x.rel.map((e) => e.k));
    let k = r.int(RELIC_KINDS.length);
    for (let n = 0; n < RELIC_KINDS.length && have.has(k); n++) k = (k + 1) % RELIC_KINDS.length;
    const names = RELIC_OF.filter((n) => !x!.rel.some((e) => e.name.endsWith(n)));
    const name = `the ${RELIC_KINDS[k].k} of ${r.pick(names.length ? names : RELIC_OF)}`;
    if (s.k === 'tomb' && per(lead, AX.PIETY) > 0.9 && !has(lead, 'greedy')) {
      // a devout leader will not rob the dead
      beat(c, q, 'x_left_be', lead.id, undefined, `${s.name}|${name}`, tag);
      for (const p of q.pw) think(c, p, 'x_leftbe');
    } else {
      q.relic = k;
      q.rn = name;
      beat(c, q, 'x_relic', finder.id, undefined, `${s.name}|${name}|${s.k}`, tag);
    }
    return;
  }
  const r2 = r.float();
  if (r2 < 0.3 / rich) { beat(c, q, 'x_bare', undefined, undefined, s.name, tag + r.int(3)); return; }
  if (r2 < 0.3 / rich + 0.07 && s.d >= 2 && !q.cap && c.pawns.length + awayPawns(c).length < HARD_CAP - 2) {
    q.cap = 1;
    beat(c, q, 'x_captive', lead.id, undefined, `${s.name}|${s.k}`, tag);
    return;
  }
  if (r2 > 0.9 && !q.map && x.sites.length < 2) {
    const next = farSite(c, x, r);
    next.d = Math.min(3, next.d + 1);
    next.p = r.chance(0.6) ? 'relic' : 'silver';
    q.map = next;
    beat(c, q, 'x_map', (scholar ?? finder).id, undefined, `${s.name}|${next.name}|${s.k}`, tag);
    return;
  }
  const what = scholar && r2 > 0.72 ? 'lore' : r.chance(0.6) ? p0 : r.pick(['silver', 'goods', 'iron']);
  if (what === 'lore' && scholar) {
    const n = Math.round((6 + r.int(8) + scholar.sk[11] * 0.6) * rich);
    q.lore += n;
    beat(c, q, 'x_lore', scholar.id, undefined, `${s.name}|${s.k}`, tag + n);
  } else if (what === 'iron') {
    const n = Math.max(2, Math.round((3 + r.int(5)) * rich));
    q.iron += n;
    beat(c, q, 'x_find', finder.id, undefined, `${s.name}|iron`, tag + n);
  } else if (what === 'goods') {
    const n = Math.max(2, Math.round((4 + r.int(7)) * rich));
    q.goods += n;
    beat(c, q, 'x_find', finder.id, undefined, `${s.name}|goods`, tag + n);
  } else {
    const n = Math.max(5, Math.round((10 + r.int(24)) * rich));
    q.silver += n;
    beat(c, q, 'x_find', finder.id, undefined, `${s.name}|silver`, tag + n);
  }
  // a grasping leader will not leave while there might be more
  if (d === s.far + q.stay && q.stay < 3 && per(lead, AX.GREED) > 0.7 && r.chance(0.5)) {
    q.stay++;
    q.back += D;
    beat(c, q, 'x_linger', lead.id, undefined, s.name, tag);
  }
}

/** A party that has not come home: first the worry, then the mourning. One of them may yet walk in, weeks later. */
function missingDay(c: Colony, x: Exp, q: XParty, day: number): void {
  const over = day - dayOf(q.back);
  if (over >= OVERDUE && !q.od) {
    q.od = 1;
    beat(c, q, 'x_overdue', q.lead, undefined, q.site.name, q.pw.length);
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN && q.pw.some((m) => m.id === p.sp || m.mo === p.id || m.fa === p.id || p.mo === m.id || p.fa === m.id)) think(c, p, 'x_fear');
  }
  if (over < GIVEN_UP) return;
  const r = new Rand(c.seed, S.EXPED, day, 4, q.id);
  // a player's colonist always finds the way home in the end; of the others, sometimes one
  const live: Pawn[] = q.pw.filter((p) => p.owner);
  const rest = q.pw.filter((p) => !p.owner);
  if (!live.length && rest.length && r.chance(0.35)) live.push(r.pick(rest));
  beat(c, q, 'x_mourned', q.lead, undefined, q.site.name, q.pw.length);
  const n0 = q.pw.length;
  for (const p of q.pw.slice()) {
    if (live.includes(p)) continue;
    fall(c, x, q, p, 'x_lost');
    // remembered together, not one funeral after another
    const d = c.dead[c.dead.length - 1];
    if (d && d.id === p.id) d.fun = 1;
  }
  x.mem = { site: q.site.name, n: n0, a: q.lead, t: c.tick };
  for (const p of live) x.late.push({ pw: p, t: (day + 5 + r.int(14)) * D + (9 + r.int(8)) * H, site: q.site.name, id: q.id, n: live.length });
  q.pw = [];
  for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'x_lostparty');
  conclude(c, x, q, 'lost');
}

// ---------------------------------------------------------------- tick by tick

/** Every tick while a party is mustering, leaving or due home, or a survivor is on the way. */
export function stepExped(c: Colony): void {
  const x = c.exp!;
  const t = c.tick;
  for (let k = 0; k < x.late.length; k++) {
    const l = x.late[k];
    if (t < l.t || troubled(c) || hourOf(t) < 7 || hourOf(t) > 19) continue;
    x.late.splice(k--, 1);
    survivor(c, x, l);
  }
  const q = x.l[0];
  if (!q) return;
  if (q.m === 0) {
    if (troubled(c)) { callOff(c, x, q); return; }
    if (t < q.go) return;
    // whoever is fit to go when the hour comes
    const ids: Id[] = [];
    const ro: string[] = [];
    const tied = tiedDown(c);
    for (let i = 0; i < q.ids.length; i++) {
      const p = pawnById(c, q.ids[i]);
      // (anyone hurt, taken ill, or caught up in something since they were chosen stays behind)
      if (!p || !fit(c, p, tied, true)) continue;
      ids.push(p.id);
      ro.push(q.ro[i]);
      if (p.act.k === 'trek') p.act.t1 = Math.min(p.act.t1, Math.max(t, p.act.ta));
    }
    q.ids = ids;
    q.ro = ro;
    if (ids.length < 2 || !ids.includes(q.lead)) { callOff(c, x, q); return; }
    q.m = 1;
    return;
  }
  if (q.m === 1) {
    let out = false;
    for (const p of c.pawns) {
      if (p.act.k !== 'trek' || p.act.why !== 'x_leave' || t < p.act.ta || !q.ids.includes(p.id)) continue;
      const [ex, ey] = roadEnd(c);
      p.x = ex;
      p.y = ey;
      p.act = mkAct('idle', t, ex, ey, 1, 'away');
      p.say = undefined;
      q.pw.push(p);
      out = true;
    }
    if (out) {
      const gone = new Set(q.pw);
      c.pawns = c.pawns.filter((p) => !gone.has(p));
    }
    if (q.pw.length < q.ids.length && t < q.go + 5 * H && !troubled(c)) return;
    // the road is taken: anyone who never reached it stays behind
    const order = q.ids.slice();
    q.pw.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const ro = q.pw.map((p) => q.ro[order.indexOf(p.id)]);
    q.ids = q.pw.map((p) => p.id);
    q.ro = ro;
    if (q.pw.length < 2) {
      for (const p of q.pw) comeIn(c, p, q.t0);
      q.pw = [];
      callOff(c, x, q);
      return;
    }
    if (!q.ids.includes(q.lead)) q.lead = q.ids[0];
    q.m = 2;
    beat(c, q, 'x_left', q.lead, undefined, q.site.name, q.ids.length);
    bump(c, 'expeditions');
    for (const p of q.pw) for (const o of c.pawns) if (o.sp === p.id || ((o.mo === p.id || o.fa === p.id) && stage(c, o) >= STAGE.CHILD)) think(c, o, 'x_kinaway', p.id);
    return;
  }
  if (q.m === 2) {
    if (t < q.back || troubled(c) || hourOf(t) < 7 || hourOf(t) > 19) return;
    q.m = 3;
    q.t3 = t;
    const spots = musterSpots(c);
    if (spots) { q.wx = spots.wx; q.wy = spots.wy; }
    for (const p of q.pw) comeIn(c, p, q.t0);
    q.pw = [];
    beat(c, q, 'x_back', q.lead, undefined, `${q.site.name}|${mood(q)}`, q.ids.length - q.fallen.length);
    return;
  }
  if (q.m === 3) {
    const lead = pawnById(c, q.lead);
    const there = lead && lead.act.k === 'trek' && lead.act.why === 'x_home' && t >= lead.act.ta + 8;
    if (there || t >= q.t3 + 4 * H || troubled(c)) conclude(c, x, q, 'home');
  }
}

const mood = (q: XParty): string => (q.relic >= 0 || q.silver + q.goods * 3 + q.iron * 3 >= 70 ? 'rich' : q.fallen.length ? 'grim' : q.silver + q.goods + q.iron + q.lore > 0 || q.map || q.cap ? 'some' : 'bare');

function callOff(c: Colony, x: Exp, q: XParty): void {
  log(c, 'x_off', q.lead, undefined, q.site.name);
  for (const id of q.ids) { const p = pawnById(c, id); if (p && p.act.k === 'trek') p.act.t1 = Math.min(p.act.t1, Math.max(c.tick, p.act.ta)); }
  x.l = x.l.filter((o) => o !== q);
  // the place is still there: they will try again
  if (x.sites.length < 3) x.sites.unshift(q.site);
  x.nx = dayOf(c.tick) + 6;
}

/** Someone walks back onto the map at the end of the road, and learns what happened while they were gone. */
export function comeIn(c: Colony, p: Pawn, since: number): void {
  const [ex, ey] = roadEnd(c);
  p.x = ex;
  p.y = ey;
  p.act = mkAct('idle', c.tick, ex, ey, 1, 'x_home');
  p.food = Math.max(p.food, 60);
  p.rest = Math.max(30, Math.min(p.rest, 55));
  p.soc = Math.max(p.soc, 50);
  // ties that ended while they were away
  const sp = p.sp ? pawnById(c, p.sp) : undefined;
  if (p.sp && sp && sp.sp !== p.id) { const rel = p.rel[sp.id]; if (rel?.k && rel.k !== 'ex') rel.k = 'ex'; think(c, p, 'dumped', sp.id); }
  if (p.sp && (!sp || sp.sp !== p.id)) p.sp = 0;
  for (let i = c.dead.length - 1; i >= 0; i--) {
    const d = c.dead[i];
    if (d.died < since) break;
    const rel = p.rel[d.id];
    if (d.left) { if (rel?.k && rel.k !== 'ex') rel.k = 'ex'; continue; }
    const k = rel?.k === 'spouse' || rel?.k === 'lover' || rel?.k === 'betrothed' ? 'died_spouse' : d.mo === p.id || d.fa === p.id ? 'died_child' : p.mo === d.id || p.fa === d.id ? 'died_parent' : rel?.f === 1 ? 'died_friend' : '';
    if (k) think(c, p, k, d.id);
    if (rel?.k && rel.k !== 'ex') delete rel.k;
  }
  if (p.home) { const b = c.blds.find((o) => o.id === p.home); if (!b || !b.beds.includes(p.id)) p.home = 0; }
  if (p.appr && !pawnById(c, p.appr[0])) p.appr = undefined;
  c.pawns.push(p);
}

function survivor(c: Colony, x: Exp, l: Exp['late'][number]): void {
  const p = l.pw;
  const r = new Rand(c.seed, S.EXPED, c.tick, 5, p.id);
  comeIn(c, p, l.t - 40 * D);
  wound(c, p, 'cut', 10 + r.int(8), r);
  for (const i of p.inj) { i.tend = 1; i.bleed = 0; }
  if (p.hp < 35) p.hp = 35;
  p.food = 30;
  log(c, 'x_survivor', p.id, undefined, l.site, l.n ?? 1);
  note(c, p, 'x_survived', undefined, `${l.site}|${l.n ?? 1}`);
  think(c, p, 'x_survived');
  bump(c, 'expSurvivors');
  for (const o of c.pawns) {
    if (o === p || stage(c, o) < STAGE.CHILD) continue;
    if (o.sp === p.id || o.mo === p.id || o.fa === p.id || p.mo === o.id || p.fa === o.id) think(c, o, 'x_kinhome', p.id);
    else think(c, o, 'x_miracle');
  }
  const done = x.done.find((d) => d.id === l.id);
  if (done) done.beats.push({ t: c.tick, k: 'x_survivor', a: p.id, s: l.site, n: l.n ?? 1 });
}

// ---------------------------------------------------------------- the end of it

/** The halls a relic may stand in: the castle's first, once there is one, then the colony's own. */
function relicHalls(c: Colony): Bld[] {
  const out: Bld[] = [];
  const seat = castleHall(c);
  if (seat) out.push(seat);
  const hall = c.blds.find((b) => b.k === 'hall' && b.built);
  if (hall) out.push(hall);
  return out;
}

/** A place for a relic against the wall of a hall, out of the way of the door and the tables (-1 if there is none). */
function relicSpot(c: Colony, hall: Bld): number {
  const W = c.w;
  let best = -1;
  let top = -1;
  for (const cell of cells(shapeOf(hall))) {
    const x = hall.x + cell.dx;
    const y = hall.y + cell.dy;
    const i = y * W + x;
    const s = c.st[i];
    if (c.sb[i] !== hall.id || (s !== B.FLOOR_WOOD && s !== B.FLOOR_STONE && s !== B.FLOOR_FINE && s !== B.FLOOR_BARE)) continue;
    let wall = 0;
    let bad = false;
    let open = 0;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      const n = c.st[j];
      if (n === B.DOOR || n === B.GATE || n === B.RELIC) bad = true;
      else if (n === B.WALL_WOOD || n === B.WALL_STONE || n === B.CWALL) wall++;
      else if (n === B.FLOOR_WOOD || n === B.FLOOR_STONE || n === B.FLOOR_FINE || n === B.FLOOR_BARE || n === B.RUG) open++;
    }
    // best against a wall with the floor open in front of it; failing that a corner, or out on the open floor
    if (bad || (!wall && open < 4)) continue;
    const score = (wall && open >= 2 ? 100 : wall ? 50 : 0) + wall * 10 + open - (Math.abs(x - (hall.x + hall.w / 2)) + Math.abs(y - (hall.y + hall.h / 2))) * 0.1;
    if (score > top) { top = score; best = i; }
  }
  return best;
}

/** Set a relic on a stand in the first hall with room for it. Returns the hall, if one was found. */
function placeRelic(c: Colony, rel: XRelic, halls: Bld[]): Bld | undefined {
  for (const hall of halls) {
    const i = relicSpot(c, hall);
    if (i < 0) continue;
    rel.i = i;
    rel.f = c.st[i];
    c.st[i] = B.RELIC;
    touchAt(c, i, false);
    return hall;
  }
  return undefined;
}

/** Take a relic off its stand (the hall is being rebuilt, or it is moving up to the castle). */
function liftRelic(c: Colony, rel: XRelic): void {
  if (rel.i >= 0 && c.st[rel.i] === B.RELIC) { c.st[rel.i] = c.sb[rel.i] ? rel.f || B.FLOOR_WOOD : B.NONE; touchAt(c, rel.i, false); }
  rel.i = -1;
}

/** Once a day: every relic is where it should be (the hall may have been rebuilt, or a castle raised), and does its quiet good. */
function relicsDaily(c: Colony, x: Exp, day: number): void {
  const halls = relicHalls(c);
  for (const rel of x.rel) {
    if (rel.i >= 0 && (c.st[rel.i] !== B.RELIC || !halls.some((h) => h.id === c.sb[rel.i]))) liftRelic(c, rel);
    // up to the castle, once its hall has a wall to stand it against
    else if (rel.i >= 0 && halls.length > 1 && c.sb[rel.i] !== halls[0].id && relicSpot(c, halls[0]) >= 0) liftRelic(c, rel);
    if (rel.i < 0) placeRelic(c, rel, halls);
  }
  const lore = relicCount(c, 'lore');
  if (lore) addLore(c, lore * 0.8);
  const dev = relicCount(c, 'dev');
  if (dev && day % Math.max(4, 12 - dev * 3) === 0) {
    // someone who came to look stays to pray
    const r = new Rand(c.seed, S.EXPED, day, 6);
    const pool = c.pawns.filter((p) => !p.gone && p.dev < 2 && stage(c, p) >= STAGE.ADULT && !has(p, 'skeptic'));
    if (pool.length) { const p = r.pick(pool); p.dev++; think(c, p, 'x_relicawe'); }
  }
}

/** The party is home (or given up): share out what they brought, set the relic in the hall, and write it all down. */
function conclude(c: Colony, x: Exp, q: XParty, how: string): void {
  const t = c.tick;
  const s = q.site;
  x.l = x.l.filter((o) => o !== q);
  if (!x.seen.includes(s.name)) { x.seen.push(s.name); if (x.seen.length > 24) x.seen.shift(); }
  const day = dayOf(t);
  let out = how;
  if (how === 'home') {
    const r = new Rand(c.seed, S.EXPED, t, 7, q.id);
    const home = q.ids.map((id) => pawnById(c, id)).filter((p): p is Pawn => !!p && !p.gone);
    const lead = home.find((p) => p.id === q.lead) ?? home[0];
    const worth = q.silver + q.goods * 3 + q.iron * 3 + q.lore;
    out = q.relic >= 0 || worth >= 110 ? 'triumph' : q.fallen.length ? 'grim' : worth >= 40 || q.map || q.cap ? 'good' : worth > 0 ? 'thin' : 'empty';
    // the finders keep a tenth each (a fifth for the leader); the rest goes to the common store
    let left = q.silver;
    for (const p of home) { const cut = Math.floor(q.silver * (p === lead ? 0.2 : 0.1)); if (cut > 0 && left >= cut) { p.coin += cut; left -= cut; } }
    c.stock.silver += left;
    c.stock.goods += q.goods;
    c.stock.iron += q.iron;
    if (q.lore) addLore(c, q.lore);
    log(c, 'x_home', lead?.id ?? q.lead, undefined, `${s.name}|${out}|${q.silver}|${q.goods}|${q.iron}|${q.lore}|${q.fallen.length}|${q.hurt}`, home.length);
    if (q.relic >= 0 && lead) {
      const rel: XRelic = { id: x.nr++, k: q.relic, name: q.rn, by: lead.id, t, from: s.name, fx: RELIC_KINDS[q.relic].fx, i: -1, f: 0 };
      x.rel.push(rel);
      const placed = placeRelic(c, rel, relicHalls(c));
      log(c, 'x_relic_set', lead.id, undefined, `${rel.name}|${placed ? (placed.k === 'hall' ? 'hall' : 'keep') : 'store'}`, rel.k);
      note(c, lead, 'x_relic', undefined, `${rel.name}|${s.name}`);
      bump(c, 'relics');
    }
    if (q.map && x.sites.length < 3) x.sites.push(q.map);
    if (q.cap && c.pawns.length < HARD_CAP - 1) {
      const p = makePawn(c, r, {});
      arrive(c, p, `rescued:${s.name}`);
      if (lead) { think(c, p, 'x_freed', lead.id); note(c, p, 'x_freed', lead.id, s.name); }
      bump(c, 'expRescued');
    }
    const famous = out === 'triumph';
    for (const p of home) {
      note(c, p, p === lead ? 'x_led' : 'x_went', p === lead ? undefined : lead?.id, `${s.name}|${out}`);
      think(c, p, famous ? 'x_triumph' : out === 'good' ? 'x_goodtrip' : out === 'grim' ? 'x_grimtrip' : out === 'empty' ? 'x_emptytrip' : 'x_backhome');
      gainXp(p, 0, 12);
      gainXp(p, 11, 10);
      for (const o of home) if (o !== p) think(c, p, 'x_roadmate', o.id);
      if (p.act.k === 'trek') p.act.t1 = Math.min(p.act.t1, Math.max(t + 2, p.act.ta));
    }
    const ids = new Set(q.ids);
    for (const o of c.pawns) {
      if (ids.has(o.id) || stage(c, o) < STAGE.CHILD) continue;
      const kin = home.find((p) => o.sp === p.id || o.mo === p.id || o.fa === p.id || p.mo === o.id || p.fa === o.id);
      if (kin) think(c, o, 'x_kinhome', kin.id);
      else if (o.act.k === 'attend' && o.act.why === 'welcome' && t >= o.act.ta && (famous || out === 'good')) think(c, o, 'x_welcomed');
      if (o.act.k === 'attend' && o.act.why === 'welcome') o.act.t1 = Math.min(o.act.t1, Math.max(t + 4 + (o.id % 5), o.act.ta));
    }
    if (famous && lead) {
      bump(c, 'expTriumphs');
      // a name that sticks, for the one who led them to a relic or a hoard
      if (!lead.epi) {
        lead.epi = EPITHETS[s.k] ?? 'the Far-walker';
        log(c, 'x_title', lead.id, undefined, lead.epi);
        note(c, lead, 'x_title', undefined, lead.epi);
      }
    }
    // a feast for a party that did well, if the larder allows
    if ((famous || out === 'good') && !c.gath && foodDays(c) > 7 && !troubled(c)) {
      const base = day * D;
      let t0 = base + 18 * H;
      if (t > t0 - 3 * H) t0 += D;
      const seat = castleHall(c);
      const hall = seat ?? c.blds.find((b) => b.k === 'hall' && b.built);
      c.gath = { k: 'feast', t0, t1: t0 + 3 * H, b: hall?.id ?? 0, x: hall ? hall.x + Math.floor(hall.w / 2) : c.cx, y: hall ? hall.y + Math.floor(hall.h / 2) : c.cy };
      log(c, 'x_feast', lead?.id ?? q.lead, undefined, s.name);
    }
    bump(c, 'exp_' + out);
  } else bump(c, 'exp_lost');
  x.done.push({ id: q.id, site: s, lead: q.lead, ids: q.ids, t0: q.go, t1: t, out, beats: q.beats });
  if (x.done.length > DONE_KEEP) x.done.shift();
  // a few a year: the bigger the town, the sooner the next
  const r = new Rand(c.seed, S.EXPED, day, 8);
  const pop = c.pawns.length;
  x.nx = day + (out === 'lost' ? 2 * DAYS_PER_SEASON : 0) + (pop >= 40 ? 9 : pop >= 28 ? 14 : 20) + r.int(9);
}

// ---------------------------------------------------------------- what people do about it

type Go = (k: ActK, x: number, y: number, dur: number, why: string) => boolean;

/** A colonist's part in an expedition: mustering, walking out, walking home, seeing them off, welcoming them back. */
export function expAct(c: Colony, p: Pawn, st: number, go: Go): boolean {
  const x = c.exp!;
  const q = x.l[0];
  if (!q || q.m === 2 || q.m === 4) return false;
  const t = c.tick;
  const n = q.ids.indexOf(p.id);
  if (n >= 0) {
    if (q.m === 0) {
      if (t < q.go - 2 * H) return false;
      const s = standAt(c, q.x, q.y, n);
      return !!s && go('trek', s[0], s[1], Math.max(1, q.go - t), 'x_gather');
    }
    if (q.m === 1) {
      // the leader first with the banner, the rest strung out behind
      if (t < q.go + n) { p.act = mkAct('trek', t, p.x, p.y, q.go + n - t, 'x_gather'); return true; }
      const [ex, ey] = roadEnd(c);
      return go('trek', ex, ey, 1, 'x_leave');
    }
    if (q.m === 3) {
      if (p.act.why === 'x_home' && p.act.k === 'trek' && Math.abs(p.x - q.wx) + Math.abs(p.y - q.wy) < 6) { p.act = mkAct('trek', t, p.x, p.y, 4, 'x_home'); return true; }
      const s = standAt(c, q.wx, q.wy, n);
      return !!s && go('trek', s[0], s[1], 12, 'x_home');
    }
    return false;
  }
  if (st < STAGE.CHILD || p.brk) return false;
  const kin = (): boolean => q.ids.some((id) => p.sp === id || p.mo === id || p.fa === id) || q.ids.some((id) => { const m = pawnById(c, id); return !!m && (m.mo === p.id || m.fa === p.id); });
  if (q.m === 0 && t >= q.go - H && kin()) {
    // seeing them off
    const s = standAt(c, q.x, q.y, 6 + (p.id % 8));
    return !!s && go('attend', s[0], s[1], Math.max(1, q.go + 6 - t), 'farewell');
  }
  if (q.m === 3 && t < q.t3 + 3 * H && p.food >= 40 && (kin() || (p.id + q.id) % 3 === 0)) {
    const s = standAt(c, q.wx, q.wy, 6 + ((p.id * 7) % 30));
    return !!s && go('attend', s[0], s[1], Math.max(4, q.t3 + 3 * H - t), 'welcome');
  }
  return false;
}
