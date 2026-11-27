// Neighbours. Beyond raids and wars (abroad.ts), colonies deal with each other in peace: trade
// agreements that put caravans on the road, alliances that send riders to break a siege, tribute
// from the weak to the strong, marriages between ruling houses, and tournaments where one town's
// knights ride against another's.
//
// Where two colonies stand with each other is decided by the keeper of the land (routes.ts) and told
// to both in the same words, so they never disagree. What this file does is live it: envoys walk
// out of the gate and are gone for days, carts come in and unload in the square, a foreign bride
// arrives with her escort, the lists are set up on the green and the town turns out to watch.
//
// Travellers are of two kinds. Road folk (carters, heralds, escorts) are made up, like any other
// visitor. But an envoy, a knight or a fighter sent to an ally is one of the colony's own: they
// leave the map and are held here (c.nb.away) until the day they are due home, and where they went
// they are shown as a guest with the same name and face. They come home on their own clock whatever
// happened at the other end, so nobody is ever lost between two colonies.

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, hourOf } from '../config';
import { cacheOf } from './cache';
import { canFight } from './combat';
import { foodDays } from './econ';
import { bump, log, note } from './events';
import { comeIn, fit, tiedDown } from './exped';
import { isDown, wound } from './health';
import { think } from './mood';
import { STAGE, has, makePawn, mkAct, normPawn, pawnById, per, stage, toDead } from './pawn';
import { Rand, S, hashStr } from './rng';
import type { SiteStat } from './routes';
import { importPawns } from './settle';
import { relieved } from './siege';
import { TECHS } from './data/tech';
import { heardOf, knows, traderTalk } from './tech';
import { frame } from './town';
import { admit, inside, openNear, roadEnd, roadFolk, say, seatOfRule, setNext, trouble, type GuestSpec } from './visit';
import { wallR } from './walls';
import { AX, SK, type ActK, type Bld, type Colony, type Id, type Input, type NbAway, type NbTie, type NbTourney, type Pawn, type ResK, type Visitor } from './types';

const H = TICKS_PER_HOUR;
const D = TICKS_PER_DAY;

type NB = NonNullable<Colony['nb']>;

/** Those who come on a neighbour's business, for cards and lists (see VIS_INFO for the passing visitors). */
export const NB_INFO: Record<string, { name: string; why: string }> = {
  trader: { name: 'Caravan master', why: 'Works the road between two towns that have agreed to trade, carrying what each has to spare to the other.' },
  cart: { name: 'Ox-cart', why: 'Loaded for the road.' },
  envoy: { name: 'Envoy', why: 'Sent by a neighbouring ruler to speak with ours.' },
  herald: { name: 'Herald', why: 'Carries the envoy\'s banner and says nothing.' },
  carter: { name: 'Tribute carter', why: 'Carries a season\'s tribute from one town to another.' },
  knight: { name: 'Knight', why: 'Rides for a neighbouring town.' },
  escort: { name: 'Bridal escort', why: 'Rode with the bridal party, and goes home when the gifts are handed over.' },
};

const bldOf = (c: Colony, k: string): Bld | undefined => c.blds.find((b) => b.k === k && b.built);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const rulerOf = (c: Colony): Pawn | undefined => pawnById(c, c.gov.regent || c.gov.ruler);

/** The colony's dealings with its neighbours, begun blank if it has none yet. */
export function nbOf(c: Colony): NB {
  return (c.nb ??= { ties: {}, away: [], go: [], loads: [] });
}

function tieOf(c: Colony, id: string, name: string): NbTie {
  const nb = nbOf(c);
  const t = (nb.ties[id] ??= { name });
  if (name) t.name = name;
  return t;
}

/** Bound to a neighbour by alliance, marriage or tribute: no raids, no wars between us while it lasts. */
export function bound(c: Colony, id: string): boolean {
  const t = c.nb?.ties[id];
  return !!t && (t.ally !== undefined || t.kin !== undefined || t.trib !== undefined);
}

/** On good terms with a neighbour (any tie at all): slights are sooner forgotten. */
export function friendly(c: Colony, id: string): boolean {
  const t = c.nb?.ties[id];
  return !!t && (t.ally !== undefined || t.kin !== undefined || t.trade !== undefined);
}

/** Those of the colony's own who are on the road to a neighbour or at one (off the map, and coming back). */
export function roadPawns(c: Colony): Pawn[] {
  const nb = c.nb;
  if (!nb || !nb.away.length) return [];
  return nb.away.map((a) => a.pw);
}

// ---------------------------------------------------------------- what the land is told of us

/** Is one a child, brother or sister of the ruler, or of the ruler's name? */
function ofHouse(ruler: Pawn, p: Pawn): boolean {
  return p.mo === ruler.id || p.fa === ruler.id || (ruler.mo !== 0 && p.mo === ruler.mo) || (ruler.fa !== 0 && p.fa === ruler.fa) || p.fam === ruler.fam;
}

/** Those of the ruling house (or of good family: the house's wards) who could be sent to marry into a neighbour's: the heir stays home. */
function sendable(c: Colony): Pawn[] {
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler) return [];
  const tied = tiedDown(c);
  let heir: Pawn | undefined;
  if (c.gov.k === 'lord') for (const p of c.pawns) if ((p.mo === ruler.id || p.fa === ruler.id) && (!heir || p.born < heir.born)) heir = p;
  const out: Pawn[] = [];
  for (const p of c.pawns) {
    if (p === ruler || p === heir || p.gone || p.owner || p.sp || p.thrall || p.preg || p.brk || tied.has(p.id)) continue;
    if (stage(c, p) !== STAGE.ADULT || has(p, 'chaste') || isDown(p) || p.ill) continue;
    if (!ofHouse(ruler, p) && p.rank < 3) continue;
    out.push(p);
  }
  const w = (p: Pawn): number => (p.mo === ruler.id || p.fa === ruler.id ? 20 : ofHouse(ruler, p) ? 10 : 0) + p.rank;
  return out.sort((a, b) => w(b) - w(a) || a.id - b.id);
}

/** Those here whose hand is free for someone of a neighbour's house: the ruler's own first, then the ruler, then the well born. */
function hands(c: Colony): Pawn[] {
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler) return [];
  const out: Pawn[] = [];
  for (const p of c.pawns) {
    if (p.gone || p.owner || p.sp || p.thrall || p.brk || stage(c, p) !== STAGE.ADULT || has(p, 'chaste')) continue;
    if (p !== ruler && !ofHouse(ruler, p) && p.rank < 3) continue;
    out.push(p);
  }
  const w = (p: Pawn): number => (p.mo === ruler.id || p.fa === ruler.id ? 30 : p === ruler ? 20 : ofHouse(ruler, p) ? 10 : 0) + p.rank;
  return out.sort((a, b) => w(b) - w(a) || a.id - b.id);
}

/** What this colony tells the keeper of the land about itself (see SiteStat). */
export function siteStat(c: Colony): SiteStat {
  let fight = 0;
  for (const p of c.pawns) if (canFight(c, p)) fight++;
  const ruler = pawnById(c, c.gov.ruler);
  const fierce = !ruler ? 0 : c.gov.k === 'chief' || c.gov.k === 'tyrant' || per(ruler, AX.KIND) < -0.8 || has(ruler, 'bloodlust') ? 2 : per(ruler, AX.GREED) > 0.3 || per(ruler, AX.AMBITION) > 0.4 ? 1 : 0;
  let spare = 0;
  let hand = 0;
  for (const p of sendable(c)) spare |= p.sex ? 2 : 1;
  for (const p of hands(c)) hand |= p.sex ? 2 : 1;
  const sick = !!c.plague && c.tick - c.plague.last < 8 * D;
  const busy = trouble(c) || !!c.raidFrom || sick || foodDays(c) < 4 || c.pawns.length < 8 ? 1 : 0;
  return { pop: c.pawns.length + (c.nb?.away.length ?? 0), fight, silver: Math.round(c.stock.silver), gov: c.gov.k, castle: c.castle?.stage ?? 0, walls: c.walls?.done ?? 0, fierce, spare, hand, busy };
}

// ---------------------------------------------------------------- goods

/** What a thing is worth on the road, in silver. */
const PRICE: Partial<Record<ResK, number>> = {
  grain: 0.25, veg: 0.2, flour: 0.35, bread: 0.5, ale: 0.4, hops: 0.3, wood: 0.3, stone: 0.4, brick: 0.6, ore: 0.6, iron: 1.6, leather: 1, cloth: 1.2, clothes: 2.2, tools: 3, weapons: 3.5,
  goods: 1.4, glass: 2, herbs: 1, medicine: 3,
};
/** What a town keeps for itself before it sells: [for the town, for each head]. */
const KEEP: Partial<Record<ResK, [number, number]>> = {
  grain: [20, 8], veg: [10, 5], flour: [5, 1.5], bread: [5, 1.5], ale: [10, 2], hops: [10, 0], wood: [80, 2], stone: [60, 0], brick: [40, 0], ore: [12, 0], iron: [10, 0], leather: [8, 0],
  cloth: [6, 0.2], clothes: [2, 0.5], tools: [2, 0.6], weapons: [2, 0.5], goods: [2, 0.6], glass: [12, 0], herbs: [8, 0], medicine: [6, 0],
};
const FOODS = new Set<string>(['grain', 'veg', 'flour', 'bread']);

const worth = (res: [string, number][]): number => res.reduce((a, r) => a + r[1] * (PRICE[r[0] as ResK] ?? 0.5), 0);

/** What the colony has to spare: up to three kinds worth carrying, to about the given value in all, none of a kind in `not`. */
function spareLoad(c: Colony, value: number, not: string[] = []): [string, number][] {
  const pop = c.pawns.length;
  const fed = foodDays(c) > 14;
  const opts: [string, number, number][] = [];
  for (const k in KEEP) {
    if (not.includes(k) || (FOODS.has(k) && !fed)) continue;
    const kp = KEEP[k as ResK]!;
    const over = c.stock[k as ResK] - kp[0] - kp[1] * pop;
    const p = PRICE[k as ResK] ?? 0.5;
    if (over * p < 4) continue;
    opts.push([k, over * 0.5, over * 0.5 * p]);
  }
  opts.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
  const out: [string, number][] = [];
  let left = value;
  for (const o of opts.slice(0, 3)) {
    if (left < 3) break;
    const p = PRICE[o[0] as ResK] ?? 0.5;
    // (a cart holds thirty to fifty sacks, as they happen to be stacked)
    const n = Math.floor(Math.min(o[1], 30 + ((hashStr(o[0]) + c.tick) % 21), Math.min(left, value * 0.5) / p));
    if (n < 1) continue;
    out.push([o[0], n]);
    left -= n * p;
  }
  return out;
}

const resStr = (res: [string, number][]): string => res.map((r) => `${r[0]}:${Math.round(r[1])}`).join(',');

function takeStock(c: Colony, res: [string, number][]): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, n] of res) {
    const got = Math.floor(Math.min(n, Math.max(0, c.stock[k as ResK] ?? 0)));
    if (got < 1) continue;
    c.stock[k as ResK] -= got;
    out.push([k, got]);
  }
  return out;
}

function giveStock(c: Colony, res: [string, number][]): void {
  for (const [k, n] of res) if (typeof c.stock[k as ResK] === 'number' && n > 0 && Number.isFinite(n)) c.stock[k as ResK] += n;
}

// ---------------------------------------------------------------- people on the road

/** One of ours as they will be seen in another town: the same name and face. */
function specOf(p: Pawn, k: string): GuestSpec & { id: Id; sk: number } {
  return { k, first: p.first, fam: p.fam, race: p.race, sex: p.sex, born: p.born, look: { ...p.look, marks: p.look.marks.slice() }, id: p.id, sk: Math.round(p.sk[SK.melee] * 10) / 10 };
}

/** A tick by daylight at or after t: the small hours wait for eight, the evening for the next morning. */
function byDay(t: number, salt: number): number {
  const hour = hourOf(t);
  if (hour >= 7 && hour < 18) return t;
  return t - (t % D) + (hour >= 18 ? D : 0) + 8 * H + (salt % H);
}

/** Put an arrival off until it can come in by daylight and in peace. False once there is nothing to wait for (or it has waited long enough). */
function hold(c: Colony, e: Input, max = 10): boolean {
  const hour = hourOf(c.tick);
  const bad = trouble(c);
  if (!bad && hour >= 7 && hour < 18) return false;
  const w = Number(e.w ?? 0);
  if (w >= max) return false;
  c.inq.push({ ...e, t: bad ? c.tick + 4 * H : byDay(c.tick, c.seed), w: w + 1 });
  return true;
}

/** Choose who rides: the fit and unattached, best first by the given measure. Players' own colonists are never sent. */
function pick(c: Colony, n: number, score: (p: Pawn) => number, ok: (p: Pawn) => boolean): Pawn[] {
  const tied = tiedDown(c);
  const nb = c.nb;
  const out: Pawn[] = [];
  for (const p of c.pawns) {
    if (p.owner || !fit(c, p, tied) || !ok(p)) continue;
    if (nb && nb.go.some((g) => g.id === p.id)) continue;
    out.push(p);
  }
  return out.sort((a, b) => score(b) - score(a) || a.id - b.id).slice(0, n);
}

/** Set some of ours on the road: they walk out by the gate at their hour, and are due home at `back`. */
function sendOut(c: Colony, who: Pawn[], k: string, to: string, toId: string, road: number, back: number): void {
  const nb = nbOf(c);
  const t = byDay(c.tick + H, c.seed + who.length);
  for (const p of who) nb.go.push({ id: p.id, k, to, toId, t, road, back: byDay(Math.max(back, t + 2 * H), p.id) });
}

/** One of ours leaves the map for a neighbour's. */
function takeRoad(c: Colony, p: Pawn, g: NB['go'][number]): void {
  const [ex, ey] = roadEnd(c);
  p.x = ex;
  p.y = ey;
  p.act = mkAct('idle', c.tick, ex, ey, 1, 'away');
  p.say = undefined;
  c.pawns = c.pawns.filter((o) => o !== p);
  if (g.k === 'wed') {
    // gone for good, to a new life: the neighbour's keeper has them now
    c.dead.push(toDead(c, p, 'match', undefined, true));
    for (const b of c.blds) for (let i = 0; i < b.beds.length; i++) if (b.beds[i] === p.id) b.beds[i] = 0;
    for (const o of c.pawns) {
      if (o.id === p.mo || o.id === p.fa) think(c, o, 'missing', p.id);
      if (o.crush === p.id) o.crush = 0;
    }
    return;
  }
  nbOf(c).away.push({ pw: p, k: g.k, to: g.to, t0: c.tick, t: g.back });
  for (const o of c.pawns) if (o.sp === p.id || ((o.mo === p.id || o.fa === p.id) && stage(c, o) >= STAGE.CHILD)) think(c, o, 'd_kinaway', p.id);
}

/** A party of ours has taken the road (or as many of it as reached the gate): the chronicle says so, and word goes ahead. */
function partyOut(c: Colony, k: string, toId: string, to: string, gone: Pawn[]): void {
  if (!gone.length) return;
  const lead = gone[0];
  const from = { fromId: c.id, fromName: c.name };
  switch (k) {
    case 'trade': case 'ally': case 'tribute': {
      const ruler = rulerOf(c);
      log(c, 'd_envoy_out', lead.id, ruler?.id, `${to}|${k}`);
      note(c, lead, 'd_envoy', undefined, `${to}|${k}`);
      c.out.push({ k: 'envoy', to: toId, ...from, what: k, who: [specOf(lead, 'envoy')] });
      break;
    }
    case 'tourney':
      log(c, 'd_tn_ride', lead.id, gone[1]?.id, to, gone.length);
      c.out.push({ k: 'knights', to: toId, ...from, who: gone.map((p) => specOf(p, 'knight')) });
      break;
    case 'relief':
      log(c, 'd_aid_sent', lead.id, undefined, to, gone.length);
      c.out.push({ k: 'relief', to: toId, ...from, who: gone.map((p) => specOf(p, 'knight')) });
      break;
    case 'wed': {
      const ruler = pawnById(c, c.gov.ruler);
      const dowry = Math.floor(clamp(c.stock.silver * 0.05, 0, 40));
      c.stock.silver -= dowry;
      const ward = ruler && !ofHouse(ruler, lead) ? 1 : 0;
      log(c, 'd_wed_sent', lead.id, ruler?.id, `${to}|${ruler?.fam ?? lead.fam}|${ward ? 'ward' : ''}`, dowry);
      c.out.push({ k: 'migrant', to: toId, why: 'royal', ...from, house: ruler?.fam ?? lead.fam, ward, dowry, pawn: JSON.parse(JSON.stringify({ ...lead, gone: undefined })) });
      bump(c, 'matches');
      bump(c, 'royalSent');
      break;
    }
    default: break;
  }
}

/** Every tick while anyone is getting ready to go, is due home, or the lists are up. */
export function stepNeigh(c: Colony): void {
  const nb = c.nb!;
  const t = c.tick;
  if (nb.go.length) {
    // those setting out: stirred at their hour, off the map when they reach the end of the road
    const bad = trouble(c);
    const done = new Set<string>();
    const left = new Map<Id, Pawn>();
    for (const g of nb.go) {
      const key = g.k + '|' + g.toId;
      if (done.has(key)) continue;
      done.add(key);
      const group = nb.go.filter((o) => o.k === g.k && o.toId === g.toId);
      let waiting = 0;
      for (const o of group) {
        if (o.x) continue;
        const p = pawnById(c, o.id);
        if (!p || p.gone || bad || isDown(p) || p.brk || t > o.t + 4 * H) { o.x = 2; continue; }
        if (t === o.t && p.act.k !== 'trek' && p.act.k !== 'fight' && p.act.k !== 'flee' && p.act.k !== 'attend') p.act.t1 = Math.min(p.act.t1, Math.max(t, p.act.ta));
        if (p.act.k === 'trek' && p.act.why === 'd_leave' && t >= p.act.ta && t >= o.t) { takeRoad(c, p, o); left.set(p.id, p); o.x = 1; continue; }
        waiting++;
      }
      if (waiting) continue;
      const gone: Pawn[] = [];
      for (const o of group) {
        if (o.x !== 1) continue;
        const p = left.get(o.id) ?? nb.away.find((a) => a.pw.id === o.id)?.pw;
        if (p) gone.push(p);
      }
      partyOut(c, g.k, g.toId, g.to, gone);
      nb.go = nb.go.filter((o) => !(o.k === g.k && o.toId === g.toId));
      break;
    }
  }
  if (nb.away.length && t % H === 3) {
    const hour = hourOf(t);
    if (hour >= 7 && hour <= 19 && !trouble(c)) {
      for (let i = 0; i < nb.away.length; i++) {
        const a = nb.away[i];
        if (t < a.t) continue;
        nb.away.splice(i--, 1);
        homeAgain(c, a);
      }
    }
  }
  const tn = nb.tn;
  if (!tn) return;
  // (a morning of trouble only puts the setting up off: they try again each hour until noon)
  if (tn.st === 0 && tn.x < 0 && t % H === 5 && dayOf(t) === tn.day && t < tn.t0) tourneyDay(c, tn);
  if (tn.st === 0 && t >= tn.t0) {
    // the lists open at their hour: the riders are called to their ends
    if (tn.x < 0 || trouble(c) || tn.kn.length < 2) { tourneyOff(c, tn); return; }
    tn.st = 1;
    log(c, 'd_tn_day', rulerOf(c)?.id, undefined, [...new Set(tn.kn.filter((k) => k.v).map((k) => k.from))].join(', '), tn.kn.length);
    if (c.vis) for (const v of c.vis.l) if (v.k === 'knight' && v.g === v.id && v.m === 1) v.t1 = Math.min(v.t1, Math.max(t, v.ta));
  }
  if (tn.st === 1) tourneyTick(c, tn);
}

/** One of ours walks back in at the end of the road, with whatever came of it. */
function homeAgain(c: Colony, a: NbAway): void {
  const p = a.pw;
  comeIn(c, p, a.t0);
  p.act.why = 'd_home';
  const r = new Rand(c.seed, S.PACT, c.tick, p.id, 3);
  switch (a.k) {
    case 'tourney': {
      const res = a.word === undefined ? 'none' : a.won ? 'won' : a.hurt ? 'hurt' : (a.wins ?? 0) > 0 ? 'some' : 'out';
      if (a.won) { p.coin += a.prize ?? 0; think(c, p, 'd_champion'); bump(c, 'tourneyWins'); }
      else if (a.word !== undefined) think(c, p, (a.wins ?? 0) > 0 ? 'd_rodewell' : 'd_unhorsed');
      if (a.hurt) wound(c, p, 'bruise', 8 + r.int(8), r);
      log(c, 'd_tn_home', p.id, undefined, `${a.to}|${res}|${a.word ?? ''}`, a.won ? a.prize ?? 0 : a.wins ?? 0);
      note(c, p, 'd_tn_rode', undefined, `${a.to}|${res}`);
      break;
    }
    case 'relief':
      think(c, p, 'd_rodeout');
      // (one line for the whole party: told for the first of them home)
      if (!c.nb!.away.some((o) => o.k === 'relief' && o.to === a.to)) log(c, 'd_aid_home', p.id, undefined, a.to);
      note(c, p, 'd_relief', undefined, a.to);
      break;
    default: {
      // an envoy: the agreement they carried is sealed, if it still stands
      const id = Object.keys(c.nb!.ties).find((k) => c.nb!.ties[k].name === a.to);
      const tie = id ? c.nb!.ties[id] : undefined;
      const bit = a.k === 'trade' ? 1 : a.k === 'ally' ? 2 : 4;
      const stands = !!tie && (a.k === 'trade' ? tie.trade !== undefined : a.k === 'ally' ? tie.ally !== undefined : tie.trib === 2);
      if (tie && stands) tie.said = (tie.said ?? 0) | bit;
      log(c, 'd_envoy_home', p.id, undefined, `${a.to}|${a.k}|${stands ? 'ok' : 'no'}`);
      if (stands) think(c, p, 'd_envoydone');
      if (stands && a.k === 'ally') for (const o of c.pawns) if (stage(c, o) >= STAGE.TEEN) think(c, o, 'd_allied');
      if (stands && a.k === 'tribute') tribMood(c, false);
      break;
    }
  }
  for (const o of c.pawns) if (o !== p && (o.sp === p.id || ((o.mo === p.id || o.fa === p.id) && stage(c, o) >= STAGE.CHILD))) think(c, o, 'x_kinhome', p.id);
}

// ---------------------------------------------------------------- once a day

/** Once a day: grudges ease between friends, allies are sent for when a host camps outside, the lists go up on the day. */
export function dailyNeigh(c: Colony): void {
  const nb = c.nb;
  if (!nb) return;
  const day = dayOf(c.tick);
  const g = c.grudge;
  if (g) for (const id in nb.ties) if (g[id] && friendly(c, id)) g[id] = Math.max(0, g[id] - 0.5);
  // neighbours who are gone, and with whom nothing stands: forgotten
  for (const id of Object.keys(nb.ties)) {
    const t = nb.ties[id];
    if (t.trade === undefined && t.ally === undefined && t.kin === undefined && t.trib === undefined && !c.near?.some((n) => n.id === id)) delete nb.ties[id];
  }
  if (nb.loads.length) nb.loads = nb.loads.filter((l) => !!c.vis && c.vis.l.some((v) => v.g === l.g));
  if (nb.wed) {
    const a = pawnById(c, nb.wed.a);
    const b = pawnById(c, nb.wed.b);
    if (!a || !b || a.sp !== b.id) delete nb.wed;
  }
  // a host camped outside the walls: riders slip out to the allies
  const sg = c.siege;
  if (sg && sg.phase === 0 && nb.aid !== sg.t0 && c.tick - sg.t0 >= D / 2) {
    const allies = Object.keys(nb.ties).filter((id) => nb.ties[id].ally !== undefined && c.near?.some((n) => n.id === id)).slice(0, 2);
    if (allies.length) {
      nb.aid = sg.t0;
      for (const id of allies) c.out.push({ k: 'aid', to: id, fromId: c.id, fromName: c.name, host: sg.name });
      log(c, 'd_aid_ask', rulerOf(c)?.id, undefined, allies.map((id) => nb.ties[id].name).join(', '));
    }
  }
  const tn = nb.tn;
  if (tn) {
    if (day > tn.day) delete nb.tn;
    else if (day === tn.day && tn.st === 0) tourneyDay(c, tn);
  }
}

// ---------------------------------------------------------------- what arrives

/** Things that reach the colony from its neighbours and from the keeper of the land. True if it was one of ours. */
export function neighInput(c: Colony, e: Input): boolean {
  const k = e.k;
  if (k !== 'pact' && k !== 'caravan' && k !== 'tribute' && k !== 'envoy' && k !== 'knights' && k !== 'relief' && k !== 'aid' && k !== 'tourney_end' && k !== 'pactnews' && k !== 'nbdo' && !(k === 'migrant' && e.why === 'royal')) return false;
  // the road takes time
  if (e.delay) {
    const { delay, ...rest } = e;
    c.inq.push({ ...rest, t: c.tick + Number(delay) } as Input);
    return true;
  }
  if (!c.pawns.length) return true;
  const from = String(e.fromName ?? e.name ?? '');
  const fromId = String(e.fromId ?? e.with ?? '');
  switch (k) {
    case 'pact': pact(c, e, fromId, from); break;
    case 'nbdo': later(c, e); break;
    case 'envoy': if (!hold(c, e)) envoyIn(c, e, fromId, from); break;
    case 'caravan': if (!hold(c, e, 8)) caravanIn(c, e, fromId, from); break;
    case 'tribute': if (!hold(c, e, 8)) tributeIn(c, e, fromId, from); break;
    case 'knights': if (!hold(c, e, 4)) knightsIn(c, e, fromId, from); break;
    case 'relief': reliefIn(c, e, fromId, from); break;
    case 'aid': aidAsked(c, e, fromId, from); break;
    case 'migrant': if (!hold(c, e, 8)) brideIn(c, e, fromId, from); break;
    case 'tourney_end': {
      for (const res of (e.res as { id: Id; w: number; hurt: number; won: number }[]) ?? []) {
        const a = c.nb?.away.find((x) => x.k === 'tourney' && x.pw.id === res.id);
        if (!a) continue;
        a.wins = Number(res.w) || 0;
        a.hurt = res.hurt ? 1 : 0;
        a.won = res.won ? 1 : 0;
        a.prize = res.won ? Number(e.prize) || 0 : 0;
        a.word = e.off ? 'off' : String(e.champ ?? '');
      }
      break;
    }
    case 'pactnews': {
      if (e.what === 'wed') {
        log(c, 'd_wed_news', undefined, undefined, `${from}|${String(e.a ?? '')}|${String(e.b ?? '')}`);
        const d = c.dead.find((x) => x.id === Number(e.id) && x.left);
        if (d) for (const p of c.pawns) if (p.id === d.mo || p.id === d.fa) think(c, p, 'd_kinwed', d.id);
      } else if (e.what === 'tribmiss') {
        if (c.nb?.ties[fromId]?.trib === 2) { (c.grudge ??= {})[fromId] = (c.grudge[fromId] ?? 0) + 6; log(c, 'd_trib_missed', undefined, undefined, from); }
      } else if (e.what === 'noaid') log(c, 'd_aid_no', undefined, undefined, from);
      break;
    }
    default: break;
  }
  return true;
}

/** The keeper of the land says how we now stand with a neighbour. */
function pact(c: Colony, e: Input, id: string, name: string): void {
  const what = String(e.what);
  const day = Number(e.day) || dayOf(c.tick);
  const road = Number(e.road) || 120;
  const ruler = rulerOf(c);
  if (what === 'tourney') { tourneyCalled(c, e, id, name); return; }
  if (what === 'caravan') { c.inq.push({ t: byDay(c.tick + 6 * H, c.seed), k: 'nbdo', what: 'cv_go', with: id, name, road, n: Number(e.n) || 0 }); return; }
  if (what === 'wed') { wedSend(c, e, id, name, road); return; }
  if (!id) return;
  const tie = tieOf(c, id, name);
  tie.last = day;
  switch (what) {
    case 'trade': case 'ally': {
      if (what === 'trade') tie.trade = day; else tie.ally = day;
      bump(c, what === 'trade' ? 'tradePacts' : 'alliances');
      const bit = what === 'trade' ? 1 : 2;
      tie.said = (tie.said ?? 0) & ~bit;
      if (e.role === 'send') {
        const envoy = pick(c, 1, (p) => p.sk[SK.social] + p.rank, (p) => !canFight(c, p) || p.sk[SK.social] >= 4)[0] ?? pick(c, 1, (p) => p.sk[SK.social], () => true)[0];
        if (envoy && !trouble(c)) sendOut(c, [envoy], what, name, id, road, c.tick + 2 * road + D + 10 * H);
      }
      // should no envoy ever come or go, word of it gets round all the same
      c.inq.push({ t: c.tick + 6 * D, k: 'nbdo', what: 'word', with: id, f: what });
      if (what === 'ally' && c.grudge) c.grudge[id] = 0;
      break;
    }
    case 'tribute': {
      const pay = e.role === 'pay';
      tie.trib = pay ? 1 : 2;
      tie.tribT = day;
      bump(c, 'tributes');
      tie.said = (tie.said ?? 0) & ~4;
      if (c.grudge) c.grudge[id] = 0;
      if (e.why === 'peace') {
        tie.said |= 4;
        log(c, pay ? 'd_trib_pay' : 'd_trib_take', ruler?.id, undefined, `${name}|peace`);
        tribMood(c, pay);
        if (pay) c.inq.push({ t: byDay(c.tick + D, c.seed), k: 'nbdo', what: 'trib_go', with: id });
      } else if (!pay) {
        // our herald rides to name the price
        const envoy = pick(c, 1, (p) => p.sk[SK.social] + p.rank + per(p, AX.BRAVE) * 2, () => true)[0];
        if (envoy && !trouble(c)) sendOut(c, [envoy], 'tribute', name, id, road, c.tick + 2 * road + D + 10 * H);
        c.inq.push({ t: c.tick + 6 * D, k: 'nbdo', what: 'word', with: id, f: 'tribute' });
      } else c.inq.push({ t: c.tick + 5 * D, k: 'nbdo', what: 'word', with: id, f: 'tribute' });
      break;
    }
    case 'tribute_due': if (tie.trib === 1) c.inq.push({ t: byDay(c.tick + 6 * H, c.seed), k: 'nbdo', what: 'trib_go', with: id }); break;
    case 'tribute_end': {
      if (tie.trib !== undefined) log(c, 'd_trib_end', ruler?.id, undefined, `${name}|${tie.trib === 1 ? 'pay' : 'take'}|${String(e.why ?? '')}`);
      delete tie.trib; delete tie.tribT;
      break;
    }
    case 'kin': tie.kin = day; if (c.grudge) c.grudge[id] = 0; break;
    case 'lapsed': {
      const f = String(e.f);
      if ((f === 'trade' && tie.trade !== undefined) || (f === 'ally' && tie.ally !== undefined)) log(c, 'd_lapsed', undefined, undefined, `${name}|${f}`);
      if (f === 'trade') delete tie.trade; else if (f === 'ally') delete tie.ally;
      break;
    }
    case 'broken': {
      if (tie.trade !== undefined || tie.ally !== undefined || tie.trib !== undefined) log(c, 'd_broken', undefined, undefined, name);
      delete tie.trade; delete tie.ally; delete tie.trib; delete tie.tribT;
      break;
    }
    default: break;
  }
}

function tribMood(c: Colony, pay: boolean): void {
  for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT && (pay ? per(p, AX.BRAVE) > 0 || per(p, AX.AMBITION) > 0.3 : per(p, AX.GREED) > 0 || per(p, AX.AMBITION) > 0.3)) think(c, p, pay ? 'd_tribute_pay' : 'd_tribute_take');
}

/** Told once, however it came about: the agreement is made (an envoy's visit says it better, when there is one). */
function sealed(c: Colony, id: string, f: string, how: string, a?: Id, x = ''): void {
  const tie = c.nb?.ties[id];
  if (!tie) return;
  const bit = f === 'trade' ? 1 : f === 'ally' ? 2 : 4;
  const stands = f === 'trade' ? tie.trade !== undefined : f === 'ally' ? tie.ally !== undefined : tie.trib !== undefined;
  if (!stands || ((tie.said ?? 0) & bit)) return;
  tie.said = (tie.said ?? 0) | bit;
  const ruler = rulerOf(c);
  if (f === 'tribute') {
    const pay = tie.trib === 1;
    log(c, pay ? 'd_trib_pay' : 'd_trib_take', ruler?.id, undefined, `${tie.name}|${how}|${x}`);
    tribMood(c, pay);
    if (pay) c.inq.push({ t: byDay(c.tick + 14 * H, c.seed), k: 'nbdo', what: 'trib_go', with: id });
  } else {
    log(c, f === 'trade' ? 'd_trade' : 'd_ally', ruler?.id, a, `${tie.name}|${how}|${x}`);
    if (f === 'ally') for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'd_allied');
  }
}

/** Things this colony put off to a set hour. */
function later(c: Colony, e: Input): void {
  const id = String(e.with ?? '');
  switch (String(e.what)) {
    case 'word': sealed(c, id, String(e.f), 'word'); break;
    case 'cv_go': caravanOut(c, e, id); break;
    case 'trib_go': tributeOut(c, e, id); break;
    case 'tn_go': tourneyRide(c, e, id); break;
    case 'tn_day': { const tn = c.nb?.tn; if (tn && tn.st === 0 && tn.x < 0 && tn.day === dayOf(c.tick)) tourneyDay(c, tn); break; }
    default: break;
  }
}

// ---------------------------------------------------------------- envoys

function envoyIn(c: Colony, e: Input, id: string, name: string): void {
  const who = (e.who as GuestSpec[]) ?? [];
  const what = String(e.what);
  if (!who.length) return;
  const r = new Rand(c.seed, S.PACT, c.tick, 21);
  const herald = roadFolk(c, 'herald', new Rand(hashStr(id), S.PACT, 22), 0, 0.2);
  const lead = admit(c, [{ ...who[0], k: 'envoy' }, herald], name, seatOfRule(c, { id: 1 } as Visitor) ?? openNear(c, c.cx, c.cy, 3, r), byDay(c.tick + 20 * H, 5) - c.tick);
  if (!lead) { sealed(c, id, what, 'word'); return; }
  lead.o = rulerOf(c)?.id ?? 0;
  lead.d = what === 'trade' ? 1 : what === 'ally' ? 2 : 3;
  say(c, lead, 'terms');
  log(c, 'd_envoy_come', lead.o || undefined, undefined, `${name}|${lead.first} ${lead.fam}|${what}|${lead.g}`);
  bump(c, 'envoys');
}

/** The neighbour whose business a guest is here on (their f is its name). */
function tieIdOf(c: Colony, name: string): string {
  const ties = c.nb?.ties;
  if (ties) for (const id in ties) if (ties[id].name === name) return id;
  return c.near?.find((n) => n.name === name)?.id ?? '';
}

// ---------------------------------------------------------------- caravans

/** The carters who work the road between two towns: always the same master, with a cart or two. */
function caravanFolk(c: Colony, a: string, b: string, carts: number): GuestSpec[] {
  const key = a < b ? a + '|' + b : b + '|' + a;
  const r = new Rand(hashStr(key), S.PACT, 11);
  const out = [roadFolk(c, 'trader', r, r.pick([5, 3, 0]), 0.5)];
  for (let k = 0; k < carts; k++) out.push({ ...out[0], k: 'cart', first: 'an ox-cart', fam: '' });
  return out;
}

/** The square, by the mouth of the avenue: where carts stand. */
function cartStand(c: Colony, r: Rand): [number, number] | null {
  const f = frame(c);
  return openNear(c, c.cx + f.gx * 3, c.cy + f.gy * 3, 2, r) ?? openNear(c, c.cx, c.cy, 4, r) ?? openNear(c, c.cx, c.cy, 7, r);
}

/** The carters come in empty to load what we have to spare for a neighbour. */
function caravanOut(c: Colony, e: Input, id: string): void {
  const nb = nbOf(c);
  const tie = nb.ties[id];
  if (!tie || tie.trade === undefined || trouble(c) || foodDays(c) < 3 || c.pawns.length < 8) return;
  const res = spareLoad(c, 70);
  const silver = res.length ? 0 : c.stock.silver >= 90 ? 30 : 0;
  if (!res.length && !silver) return;
  const r = new Rand(c.seed, S.PACT, c.tick, 12);
  const lead = admit(c, caravanFolk(c, c.id, id, res.length >= 3 ? 2 : 1), tie.name, cartStand(c, r), 9 * H);
  if (!lead) {
    // no way in for a cart (a wall going up across the road): the load goes out by hand, unseen
    const took = takeStock(c, res);
    c.stock.silver -= silver;
    c.out.push({ k: 'caravan', to: id, fromId: c.id, fromName: c.name, leg: 0, res: took, silver, who: caravanFolk(c, c.id, id, 1) });
    return;
  }
  lead.d = 1;
  nb.loads.push({ g: lead.g, res, silver, to: id, leg: 0 });
}

/** A caravan comes in at the gate: a neighbour's goods (leg 0), or our own carters home with what they got for ours (leg 1). */
function caravanIn(c: Colony, e: Input, id: string, name: string): void {
  const nb = nbOf(c);
  const res = ((e.res as [string, number][]) ?? []).filter((x) => Array.isArray(x) && typeof x[1] === 'number');
  const silver = Number(e.silver) || 0;
  const leg = Number(e.leg) || 0;
  const who = ((e.who as GuestSpec[]) ?? []).slice(0, 4);
  const r = new Rand(c.seed, S.PACT, c.tick, 13);
  if (leg === 0 && trouble(c)) {
    // the gates are shut against trouble: the carters turn round with their load
    c.out.push({ k: 'caravan', to: id, fromId: c.id, fromName: c.name, leg: 1, res, silver, who, turned: 1 });
    return;
  }
  // (carters home while there is still trouble at the gate unload out of sight)
  const lead = who.length && !trouble(c) ? admit(c, who, name, cartStand(c, r), 10 * H) : null;
  if (!lead) {
    giveStock(c, res);
    c.stock.silver += silver;
    if (leg === 0) { log(c, 'd_cv_in', undefined, undefined, `${name}||${resStr(res)}|0`, 0); bump(c, 'caravans'); }
    else { log(c, 'd_cv_home', undefined, undefined, `${name}|${who[0] ? `${who[0].first} ${who[0].fam}` : 'The carters'}|${resStr(res)}|${e.turned ? 'turned' : ''}|0`, silver); bump(c, 'caravansHome'); }
    return;
  }
  lead.d = leg === 0 ? 2 : 3;
  nb.loads.push({ g: lead.g, res, silver, to: id, leg: leg === 0 ? 1 : 2 });
  if (leg === 0) {
    const carts = who.filter((x) => x.k === 'cart').length;
    log(c, 'd_cv_in', undefined, undefined, `${name}|${lead.first} ${lead.fam}|${resStr(res)}|${lead.g}`, carts);
    bump(c, 'caravans');
    const tie = nb.ties[id];
    if (tie) { tie.cv = (tie.cv ?? 0) + 1; tie.last = dayOf(c.tick); }
    say(c, lead, 'wares');
    if (e.turned) lead.b |= 8;
  } else if (e.turned) lead.b |= 8;
  // what they know there that we do not: the carters talk
  if (leg === 0 && Array.isArray(e.tech)) for (const tk of e.tech as string[]) if (TECHS[String(tk)] && !knows(c, String(tk)) && !c.tech?.heard[String(tk)]) { heardOf(c, String(tk), name); traderTalk(c, name); break; }
}

/** The goods change hands in the square: theirs come off the carts, and what we have to spare goes on for the road back. */
function caravanTrade(c: Colony, v: Visitor, party: Visitor[]): void {
  const nb = c.nb!;
  const load = nb.loads.find((l) => l.g === v.g);
  if (!load) return;
  const value = worth(load.res);
  giveStock(c, load.res);
  const back = takeStock(c, spareLoad(c, value + load.silver, load.res.map((x) => x[0])));
  const got = worth(back);
  // what our goods do not cover is paid in silver, while the treasury can bear it; what theirs does not, they pay
  let pay = 0;
  if (got < value) pay = Math.floor(clamp(value - got, 0, Math.max(0, c.stock.silver - 40)));
  else if (got > value) pay = -Math.floor(Math.min(load.silver, got - value));
  c.stock.silver -= pay;
  load.back = back;
  load.bs = load.silver + pay;
  log(c, 'd_cv_trade', undefined, undefined, `${v.f}|${v.first} ${v.fam}|${resStr(load.res)}|${resStr(back)}|${v.g}`, pay);
  say(c, v, 'trade');
  for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD && (p.id + v.id) % 3 === 0) think(c, p, 'd_caravan');
  void party;
}

// ---------------------------------------------------------------- tribute

/** A season's tribute is loaded for the neighbour we pay. */
function tributeOut(c: Colony, e: Input, id: string): void {
  const nb = nbOf(c);
  const tie = nb.ties[id];
  if (!tie || tie.trib !== 1) return;
  if (trouble(c)) { const w = Number(e.w ?? 0); if (w < 3) c.inq.push({ ...e, t: c.tick + D, w: w + 1 }); return; }
  const silver = c.stock.silver >= 12 ? Math.floor(clamp(c.stock.silver * 0.08, 6, 40)) : 0;
  const grain = foodDays(c) > 12 ? Math.floor(Math.min(30, c.pawns.length * 0.4, c.stock.grain * 0.1)) : 0;
  if (!silver && grain < 5) {
    log(c, 'd_trib_none', rulerOf(c)?.id, undefined, tie.name);
    c.out.push({ k: 'pactnews', to: id, fromId: c.id, fromName: c.name, what: 'tribmiss' });
    return;
  }
  const res: [string, number][] = grain >= 5 ? [['grain', grain]] : [];
  const r = new Rand(c.seed, S.PACT, c.tick, 14);
  const folk = [roadFolk(c, 'carter', new Rand(hashStr(c.id), S.PACT, 15), 3, 0.5)];
  folk.push({ ...folk[0], k: 'cart', first: 'an ox-cart', fam: '' });
  const hall = bldOf(c, 'keep') ?? bldOf(c, 'hall');
  const lead = admit(c, folk, tie.name, hall ? openNear(c, hall.x + (hall.w >> 1), hall.y + hall.h + 1, 2, r) ?? cartStand(c, r) : cartStand(c, r), 9 * H);
  if (!lead) {
    const took = takeStock(c, res);
    c.stock.silver -= silver;
    log(c, 'd_trib_out', rulerOf(c)?.id, undefined, `${tie.name}||${resStr(took)}`, silver);
    c.out.push({ k: 'tribute', to: id, fromId: c.id, fromName: c.name, res: took, silver, who: folk });
    tie.tb = (tie.tb ?? 0) + 1;
    return;
  }
  lead.d = 1;
  nb.loads.push({ g: lead.g, res, silver, to: id, leg: 0 });
}

function tributeIn(c: Colony, e: Input, id: string, name: string): void {
  const nb = nbOf(c);
  const res = ((e.res as [string, number][]) ?? []).filter((x) => Array.isArray(x) && typeof x[1] === 'number');
  const silver = Number(e.silver) || 0;
  const who = ((e.who as GuestSpec[]) ?? []).slice(0, 3);
  const r = new Rand(c.seed, S.PACT, c.tick, 16);
  const hall = bldOf(c, 'keep') ?? bldOf(c, 'hall');
  const lead = who.length && !trouble(c) ? admit(c, who, name, hall ? openNear(c, hall.x + (hall.w >> 1), hall.y + hall.h + 1, 2, r) ?? cartStand(c, r) : cartStand(c, r), 9 * H) : null;
  const tie = nb.ties[id];
  if (tie) { tie.tb = (tie.tb ?? 0) + 1; tie.last = dayOf(c.tick); }
  bump(c, 'tributeIn');
  if (!lead) {
    giveStock(c, res);
    c.stock.silver += silver;
    log(c, 'd_trib_in', rulerOf(c)?.id, undefined, `${name}||${resStr(res)}`, silver);
    return;
  }
  lead.d = 2;
  nb.loads.push({ g: lead.g, res, silver });
}

// ---------------------------------------------------------------- marriages between houses

/** Someone of our ruling house is sent to marry into a neighbour's. */
function wedSend(c: Colony, e: Input, id: string, name: string, road: number): void {
  if (trouble(c) || c.nb?.go.some((g) => g.k === 'wed')) return;
  const hand = Number(e.hand) || 3;
  // a woman goes where a man's hand is free, a man where a woman's is
  const who = sendable(c).find((p) => (p.sex === 0 ? (hand & 2) !== 0 : (hand & 1) !== 0) && !c.nb?.go.some((g) => g.id === p.id));
  if (!who) return;
  tieOf(c, id, name);
  sendOut(c, [who], 'wed', name, id, road, 0);
}

/** Someone of a neighbour's ruling house comes in at the gate with an escort and a cart of gifts, to marry here. */
function brideIn(c: Colony, e: Input, id: string, name: string): void {
  const old = e.pawn as Pawn | undefined;
  if (!old || typeof old !== 'object') return;
  const nb = nbOf(c);
  const r = new Rand(c.seed, S.PACT, c.tick, 17);
  const nid = importPawns(c, { k: 'settlers', t: c.tick, from: '', fromName: name, leader: old.id, pawns: [old], stock: {} }, r);
  const p = c.pawns.find((x) => x.id === nid);
  if (!p) return;
  const [ex, ey] = roadEnd(c);
  p.x = ex;
  p.y = ey;
  p.act = mkAct('idle', c.tick, ex, ey, 1, 'new');
  p.bio.pop();
  p.rank = 5;
  const dowry = clamp(Number(e.dowry) || 0, 0, 60);
  c.stock.silver += dowry;
  const house = String(e.house ?? p.fam);
  note(c, p, 'd_wed_came', undefined, `${name}|${house}`);
  const o = hands(c).find((x) => x !== p && x.sex !== p.sex);
  if (o) {
    p.sp = o.id;
    o.sp = p.id;
    p.rel[o.id] = { m: [], k: 'betrothed', s: c.tick };
    o.rel[p.id] = { ...(o.rel[p.id] ?? { m: [] }), k: 'betrothed', s: c.tick };
    if (o.crush) o.crush = 0;
    nb.wed = { a: p.id, b: o.id, from: name, fromId: id, house, an: `${p.first} ${p.fam}`, bn: `${o.first} ${o.fam}`, was: old.id };
    note(c, o, 'd_wed_match', p.id, `${name}|${house}`);
  }
  log(c, 'd_wed_come', p.id, o?.id, `${name}|${house}|${e.ward ? 'ward' : ''}`, dowry);
  bump(c, 'migrants');
  bump(c, 'royalCame');
  if (id) tieOf(c, id, name).last = dayOf(c.tick);
  // the escort: two riders and the cart of gifts, to the hall and home again in the morning
  const er = new Rand(hashStr(id), S.PACT, 18, p.id);
  const folk = [roadFolk(c, 'escort', er, 0, 0.2), roadFolk(c, 'escort', er, 0, 0.2)];
  folk.push({ ...folk[0], k: 'cart', first: 'a cart of gifts', fam: '' });
  const hall = bldOf(c, 'keep') ?? bldOf(c, 'hall');
  const lead = trouble(c) ? null : admit(c, folk, name, hall ? openNear(c, hall.x + (hall.w >> 1), hall.y + hall.h + 1, 2, r) ?? cartStand(c, r) : cartStand(c, r), byDay(c.tick + 18 * H, 7) - c.tick);
  if (lead) { lead.o = p.id; say(c, lead, 'gifts'); }
}

/** Called at the end of a wedding: was it the one between our house and a neighbour's? */
export function royalWedding(c: Colony, a: Pawn, b: Pawn, there: Pawn[]): boolean {
  const w = c.nb?.wed;
  if (!w || !((w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id))) return false;
  const came = w.a === a.id ? a : b;
  const host = came === a ? b : a;
  const cost = Math.floor(Math.min(c.stock.silver, 20));
  c.stock.silver -= cost;
  for (const p of there) if (p !== a && p !== b) { think(c, p, 'd_royalwed'); p.joy = Math.min(100, p.joy + 15); }
  log(c, 'd_wed', came.id, host.id, `${w.from}|${w.house}`, Math.max(0, there.length - 2));
  note(c, came, 'd_wed', host.id, w.from);
  if (w.fromId) c.out.push({ k: 'pactnews', to: w.fromId, fromId: c.id, fromName: c.name, what: 'wed', a: w.an, b: w.bn, id: w.was });
  bump(c, 'royalWeddings');
  delete c.nb!.wed;
  return true;
}

// ---------------------------------------------------------------- allies

/** An ally is besieged and asks our help. */
function aidAsked(c: Colony, e: Input, id: string, name: string): void {
  const tie = c.nb?.ties[id];
  if (!tie || tie.ally === undefined) return;
  if (trouble(c)) {
    const w = Number(e.w ?? 0);
    if (w < 4) { c.inq.push({ ...e, t: c.tick + 12 * H, w: w + 1 }); return; }
  }
  let fighters = 0;
  for (const p of c.pawns) if (canFight(c, p)) fighters++;
  const who = trouble(c) || fighters < 9 ? [] : pick(c, fighters >= 16 ? 3 : 2, (p) => p.sk[SK.melee] + per(p, AX.BRAVE) * 2, (p) => canFight(c, p) && p.sk[SK.melee] >= 3);
  if (who.length < 2) {
    log(c, 'd_aid_none', rulerOf(c)?.id, undefined, name);
    c.out.push({ k: 'pactnews', to: id, fromId: c.id, fromName: c.name, what: 'noaid' });
    return;
  }
  const road = Number(e.road) || 180;
  sendOut(c, who, 'relief', name, id, road, c.tick + 2 * road + 2 * D);
}

/** An ally's riders reach us: they fall on a camped host from behind, and come in at the gate when the road is clear. */
function reliefIn(c: Colony, e: Input, id: string, name: string): void {
  const who = ((e.who as GuestSpec[]) ?? []).slice(0, 4);
  if (!who.length) return;
  const leadName = `${who[0].first} ${who[0].fam}`;
  let broke = Number(e.broke) || 0;
  const sg = c.siege;
  if (sg && sg.phase === 0 && !broke) {
    relieved(c, name, who.length);
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'd_relieved');
    bump(c, 'reliefs');
    broke = 1;
  }
  const hour = hourOf(c.tick);
  if (trouble(c) || hour < 6 || hour >= 20) {
    const w = Number(e.w ?? 0);
    if (w < 14) { c.inq.push({ ...e, t: c.tick + 3 * H, w: w + 1, broke }); return; }
  }
  const r = new Rand(c.seed, S.PACT, c.tick, 19);
  log(c, broke ? 'd_relief' : 'd_relief_late', rulerOf(c)?.id, undefined, `${name}|${leadName}`, who.length);
  const lead = trouble(c) ? null : admit(c, who.map((x) => ({ ...x, k: 'knight' })), name, openNear(c, c.cx, c.cy, 3, r), byDay(c.tick + 16 * H, 3) - c.tick);
  if (lead) { lead.d = 9; say(c, lead, 'relief'); }
  if (c.grudge && id) c.grudge[id] = 0;
}

// ---------------------------------------------------------------- tournaments

/** A flat, open stretch of green for the lists: outside the wall beside the road, else anywhere near town; with room for the pavilions if there is any, without if not. */
export function listsSpot(c: Colony): { x: number; y: number; h: number } | null {
  const f = frame(c);
  const k = cacheOf(c);
  const d0 = wallR(c) + 6;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let pass = 0; pass < 3; pass++) {
    // first along the road's own line, then turned across it; roomy first, then just the lists and the crowd
    for (const h of pass === 2 ? [f.gx === 0 ? 0 : 1] : [f.gx === 0 ? 1 : 0]) {
      const wide = pass === 0 ? 6 : 3;
      const rx = h ? 7 : wide;
      const ry = h ? wide : 7;
      const ok = (x: number, y: number): boolean => {
        if (x - rx < 2 || y - ry < 2 || x + rx >= c.w - 2 || y + ry >= c.h - 2) return false;
        let open = 0;
        let n = 0;
        for (let yy = y - ry; yy <= y + ry; yy++) {
          for (let xx = x - rx; xx <= x + rx; xx++) {
            const i = yy * c.w + xx;
            n++;
            if (k.walk[i] && k.reach[i] && !c.sb[i] && !c.st[i] && !c.crop[i]) open++;
            else if (h ? yy === y : xx === x) return false;
          }
        }
        return open >= n * (pass === 0 ? 0.86 : 0.8);
      };
      for (let d = d0; d <= d0 + 18; d += 2) {
        for (const o of [7, -7, 11, -11, 15, -15, 3, -3]) {
          const x = c.cx + f.gx * d + f.px * o;
          const y = c.cy + f.gy * d + f.py * o;
          if (ok(x, y)) return { x, y, h };
        }
      }
      for (let rad = 8; rad <= 48; rad += 4) {
        for (const [dx, dy] of DIRS) {
          const x = c.cx + dx * rad;
          const y = c.cy + dy * rad;
          if (ok(x, y)) return { x, y, h };
        }
      }
    }
  }
  return null;
}

/** Where a rider waits: at one end of the lists or the other. */
function endSpot(tn: NbTourney, n: number): [number, number] {
  const side = n % 2 ? 1 : -1;
  const row = (n >> 1) % 3 - 1;
  return tn.h ? [tn.x + side * 7, tn.y + row] : [tn.x + row, tn.y + side * 7];
}

/** A place in the crowd, along the rail on either side. */
function crowdSpot(c: Colony, tn: NbTourney, n: number): [number, number] | null {
  const k = cacheOf(c);
  for (let tries = 0; tries < 6; tries++) {
    const m = n * 7 + tries * 13;
    const along = (m % 11) - 5;
    const side = (m >> 4) % 2 ? 1 : -1;
    const deep = 2 + ((m >> 5) % 2);
    const x = tn.h ? tn.x + along : tn.x + side * deep;
    const y = tn.h ? tn.y + side * deep : tn.y + along;
    if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) continue;
    const i = y * c.w + x;
    if (k.walk[i] && k.reach[i]) return [x, y];
  }
  return null;
}

/** The keeper of the land has named a tournament: here, or at a neighbour's who bids our knights ride. */
function tourneyCalled(c: Colony, e: Input, id: string, name: string): void {
  const nb = nbOf(c);
  const when = Number(e.when) || dayOf(c.tick) + 5;
  if (e.role === 'host') {
    if (nb.tn) return;
    const guests = ((e.guests as { id: string; name: string }[]) ?? []).slice(0, 4).map((g) => ({ id: String(g.id), name: String(g.name) }));
    nb.tn = { day: when, t0: when * D + 13 * H, t1: when * D + 17 * H, x: -1, y: -1, h: 1, guests, kn: [], b: [], st: 0 };
    log(c, 'd_tn_call', rulerOf(c)?.id, undefined, guests.map((g) => g.name).join(', '), when - dayOf(c.tick));
    return;
  }
  const road = Number(e.road) || 180;
  tieOf(c, id, name);
  log(c, 'd_tn_bid', undefined, undefined, name, when - dayOf(c.tick));
  // they ride the day before (two days, if the road is long)
  const go = (when - (road > 16 * H ? 2 : 1)) * D + 7 * H;
  c.inq.push({ t: Math.max(c.tick + 1, go), k: 'nbdo', what: 'tn_go', with: id, name, road, when });
}

/** Our knights ride for a neighbour's tournament. */
function tourneyRide(c: Colony, e: Input, id: string): void {
  if (trouble(c)) return;
  let fighters = 0;
  for (const p of c.pawns) if (canFight(c, p)) fighters++;
  if (fighters < 6) return;
  const who = pick(c, fighters >= 14 ? 2 : 1, (p) => p.sk[SK.melee] + per(p, AX.BRAVE), (p) => canFight(c, p) && p.sk[SK.melee] >= 4);
  if (!who.length) return;
  const when = Number(e.when) || dayOf(c.tick) + 1;
  const road = Number(e.road) || 180;
  sendOut(c, who, 'tourney', String(e.name ?? ''), id, road, (when + 1) * D + 7 * H + road);
}

/** Knights ride in for the tournament. */
function knightsIn(c: Colony, e: Input, id: string, name: string): void {
  const who = ((e.who as (GuestSpec & { id: Id; sk: number })[]) ?? []).slice(0, 2);
  if (!who.length) return;
  const nb = nbOf(c);
  const tn = nb.tn;
  const r = new Rand(c.seed, S.PACT, c.tick, 20);
  const on = !!tn && tn.st === 0 && c.tick < tn.t0;
  const stay = on ? (tn!.day + 1) * D + 7 * H - c.tick : byDay(c.tick + 14 * H, 9) - c.tick;
  const lead = trouble(c) ? null : admit(c, who.map((x) => ({ ...x, k: 'knight' })), name, openNear(c, c.cx, c.cy, 4, r), stay);
  if (!lead) return;
  log(c, 'd_tn_come', undefined, undefined, `${name}|${who.map((x) => `${x.first} ${x.fam}`).join(' and ')}|${lead.g}`, who.length);
  if (!on) return;
  const party = c.vis!.l.filter((v) => v.g === lead.g);
  party.forEach((v, n) => {
    if (tn!.kn.length < 10) tn!.kn.push({ id: 0, v: v.id, name: `${v.first} ${v.fam}`, from: name, fromId: id, home: Number(who[n]?.id) || 0, sk: Number(who[n]?.sk) || 4, w: 0, out: 0, hurt: 0 });
  });
}

/** The morning of the tournament: the lists go up, our own riders are named. */
function tourneyDay(c: Colony, tn: NbTourney): void {
  if (c.pawns.length < 10) { tourneyOff(c, tn); return; }
  if (trouble(c)) return;
  const spot = listsSpot(c);
  if (!spot) { tourneyOff(c, tn); return; }
  tn.x = spot.x;
  tn.y = spot.y;
  tn.h = spot.h;
  const tied = new Set<Id>();
  if (c.gath) { if (c.gath.a) tied.add(c.gath.a); if (c.gath.o) tied.add(c.gath.o); }
  const own = c.pawns.filter((p) => canFight(c, p) && stage(c, p) === STAGE.ADULT && !tied.has(p.id) && !isDown(p) && !p.brk && !p.ill && !p.preg && p.hp >= 75 && p.sk[SK.melee] >= 4)
    .sort((a, b) => b.sk[SK.melee] - a.sk[SK.melee] || a.id - b.id).slice(0, Math.max(2, Math.min(3, 10 - tn.kn.length)));
  for (const p of own) if (tn.kn.length < 10) tn.kn.push({ id: p.id, v: 0, name: `${p.first} ${p.fam}`, from: c.name, fromId: c.id, home: p.id, sk: p.sk[SK.melee], w: 0, out: 0, hurt: 0 });
  if (tn.kn.length < 2 && !tn.guests.length) tourneyOff(c, tn);
}

function tourneyOff(c: Colony, tn: NbTourney): void {
  tn.st = 2;
  log(c, 'd_tn_off', rulerOf(c)?.id);
  tourneyWord(c, tn, '', '', 0, true);
}

/** Word of how it went, for each town whose knights rode. */
function tourneyWord(c: Colony, tn: NbTourney, champ: string, champFrom: string, prize: number, off: boolean): void {
  const towns = new Map<string, { id: Id; w: number; hurt: number; won: number }[]>();
  tn.kn.forEach((k) => {
    if (!k.v || !k.fromId) return;
    const l = towns.get(k.fromId) ?? [];
    l.push({ id: k.home, w: k.w, hurt: k.hurt, won: !off && k.name === champ && k.from === champFrom ? 1 : 0 });
    towns.set(k.fromId, l);
  });
  for (const [to, res] of towns) c.out.push({ k: 'tourney_end', to, fromId: c.id, fromName: c.name, champ: champ ? `${champ} of ${champFrom}` : '', prize, res, ...(off ? { off: 1 } : {}) });
}

/** Every tick of the tournament: it opens, the bouts are ridden, the purse is given. */
function tourneyTick(c: Colony, tn: NbTourney): void {
  const t = c.tick;
  if (trouble(c)) { tourneyOff(c, tn); return; }
  if (t >= tn.t1) { tourneyEnd(c, tn); return; }
  // who is still in it: ours must still be standing, a guest still here
  const inIt: number[] = [];
  tn.kn.forEach((k, i) => {
    if (k.out) return;
    if (k.id) { const p = pawnById(c, k.id); if (!p || isDown(p) || p.brk) { k.out = 1; return; } }
    else if (!c.vis?.l.some((v) => v.id === k.v)) { k.out = 1; return; }
    inIt.push(i);
  });
  if (inIt.length < 2) return;
  const bouts = tn.kn.length - 1;
  const gap = Math.max(3, Math.floor((tn.t1 - tn.t0 - 10) / bouts));
  const last = tn.b.length ? tn.b[tn.b.length - 1][2] : tn.t0 + 5 - gap;
  if (t < tn.t0 + 5 || t < last + gap) return;
  // the two who have ridden least meet next
  inIt.sort((a, b) => tn.kn[a].w - tn.kn[b].w || a - b);
  const a = inIt[0];
  const b = inIt[1];
  const r = new Rand(c.seed, S.PACT, t, 30);
  const sa = tn.kn[a].sk + r.float() * 9;
  const sb = tn.kn[b].sk + r.float() * 9;
  const w = sa >= sb ? a : b;
  const l = w === a ? b : a;
  tn.kn[w].w++;
  tn.kn[l].out = 1;
  if (r.chance(0.2)) {
    tn.kn[l].hurt = 1;
    const p = tn.kn[l].id ? pawnById(c, tn.kn[l].id) : undefined;
    if (p) wound(c, p, 'bruise', 6 + r.int(8), r);
  }
  tn.b.push([w, l, t]);
  if (inIt.length === 2) {
    // that was the last course: the purse is given before the crowd goes home
    const champ = tn.kn[w];
    const second = tn.kn[l];
    const prize = Math.floor(clamp(c.stock.silver * 0.08, 0, 30));
    c.stock.silver -= prize;
    const p = champ.id ? pawnById(c, champ.id) : undefined;
    if (p) { p.coin += prize; think(c, p, 'd_champion'); note(c, p, 'd_tn_won', undefined, c.name); }
    log(c, 'd_tn_end', p?.id, second.id || undefined, `${champ.name}|${champ.from}|${second.name}|${second.from}`, prize);
    tn.pz = prize;
    const v = champ.v ? c.vis?.l.find((x) => x.id === champ.v) : undefined;
    if (v) { v.n = prize; say(c, v, 'joust'); }
  }
}

/** The tournament is over: the crowd goes home merry, and word goes to every town whose knights rode. */
function tourneyEnd(c: Colony, tn: NbTourney): void {
  tn.st = 2;
  const left = tn.kn.filter((k) => !k.out);
  const champ = left.length === 1 && tn.b.length ? left[0] : undefined;
  let there = 0;
  for (const p of c.pawns) {
    if (p.act.k !== 'attend' || (p.act.why !== 'tourney' && p.act.why !== 'joust') || c.tick < p.act.ta) continue;
    there++;
    think(c, p, 'd_tourney');
    p.joy = Math.min(100, p.joy + 25);
  }
  const prize = champ ? tn.pz ?? 0 : 0;
  if (!champ) log(c, 'd_tn_draw', undefined, undefined, undefined, there);
  else log(c, 'd_tn_crowd', undefined, undefined, `${champ.name}|${champ.from}`, there);
  tourneyWord(c, tn, champ?.name ?? '', champ?.from ?? '', prize, false);
  bump(c, 'tourneys');
  for (const k of tn.kn) {
    if (!k.id || k === champ) continue;
    const p = pawnById(c, k.id);
    if (p) { think(c, p, k.w > 0 ? 'd_rodewell' : 'd_unhorsed'); note(c, p, 'd_tn_rode', undefined, `${c.name}|${k.hurt ? 'hurt' : k.w > 0 ? 'some' : 'out'}`); }
  }
}

// ---------------------------------------------------------------- what colonists do about it

type Go = (k: ActK, x: number, y: number, dur: number, why: string) => boolean;

/** A colonist's part in all this: taking the road at their hour, riding at the lists, standing in the crowd. */
export function neighAct(c: Colony, p: Pawn, st: number, go2: Go): boolean {
  const nb = c.nb!;
  const t = c.tick;
  if (nb.go.length) {
    const g = nb.go.find((o) => o.id === p.id && !o.x);
    if (g && t >= g.t) {
      const [ex, ey] = roadEnd(c);
      if (go2('trek', ex, ey, 2, 'd_leave')) return true;
    }
  }
  const tn = nb.tn;
  if (tn && tn.x >= 0 && tn.st <= 1 && t >= tn.t0 - 12 && t < tn.t1 - 3) {
    if (tn.st === 0 && t >= tn.t0) return false;
    // a wedding or a funeral that falls in the same hours comes first for those it concerns, and for everyone once it has begun
    const g = c.gath;
    if (g && t < g.t1 - 4 && (t >= g.t0 - 12 || p.id === g.a || p.id === g.o)) return false;
    const n = tn.kn.findIndex((k) => k.id === p.id);
    if (n >= 0) {
      const [x, y] = endSpot(tn, n);
      if (go2('attend', x, y, Math.max(1, tn.t1 - t), 'joust')) { p.act.t1 = tn.t1 + 1; return true; }
    }
    if (st < STAGE.CHILD || p.brk || p.food < 12 || (p.id + tn.day) % 6 === 0) return false;
    const s = crowdSpot(c, tn, p.id);
    if (s && go2('attend', s[0], s[1], Math.max(1, tn.t1 - t), 'tourney')) { p.act.t1 = tn.t1 + 1; return true; }
  }
  return false;
}

// ---------------------------------------------------------------- guests on a neighbour's business

/** Where a guest on a neighbour's business spends this part of the day. */
export function nbStop(c: Colony, v: Visitor, r: Rand, hour: number): [number, number] | null {
  const pub = bldOf(c, 'tavern') ?? bldOf(c, 'hall');
  const evening = hour >= 18;
  switch (v.k) {
    case 'envoy': return evening && pub && (v.b & 1) ? inside(c, pub, v.id, 'c') : seatOfRule(c, v);
    case 'knight': {
      const tn = c.nb?.tn;
      if (tn && tn.x >= 0 && tn.st <= 1 && c.tick >= tn.t0 - 2 * H && c.tick < tn.t1) {
        const n = tn.kn.findIndex((k) => k.v === v.id);
        if (n >= 0) return endSpot(tn, n);
      }
      if (evening && pub) return inside(c, pub, v.id, 'c');
      return openNear(c, c.cx, c.cy, 5, r);
    }
    // (carters stay by their carts)
    default: return null;
  }
}

/** The turning points of such a visit. True when the guest has already moved on this turn. */
export function nbBeats(c: Colony, v: Visitor, party: Visitor[], r: Rand, hour: number): boolean {
  const nb = c.nb;
  if (!nb) return false;
  const t = c.tick;
  const early = (hrs: number): void => { v.dep = Math.min(v.dep, hour < 15 ? t + hrs * H : byDay(t + 12 * H, v.id)); };
  switch (v.k) {
    case 'trader': {
      if (v.b & 1) return false;
      // an hour to get the carts into the square and the tailboards down
      if (t < v.ta + H) { setNext(c, v, party, H); return true; }
      v.b |= 1;
      const load = nb.loads.find((l) => l.g === v.g);
      if (!load) return false;
      if (v.d === 1) {
        // loading our goods for the neighbour
        load.res = takeStock(c, load.res);
        load.silver = Math.floor(Math.min(load.silver, Math.max(0, c.stock.silver)));
        c.stock.silver -= load.silver;
        log(c, 'd_cv_load', undefined, undefined, `${v.f}|${v.first} ${v.fam}|${resStr(load.res)}|${v.g}`, load.silver);
        say(c, v, 'load');
        v.dep = t + 2 * H;
      } else if (v.d === 2) {
        if (v.b & 8) { giveStock(c, load.res); c.stock.silver += load.silver; load.back = []; load.bs = 0; }
        else caravanTrade(c, v, party);
        early(4);
      } else {
        // home again: what they got for our goods comes off the carts
        giveStock(c, load.res);
        c.stock.silver += load.silver;
        log(c, 'd_cv_home', undefined, undefined, `${v.f}|${v.first} ${v.fam}|${resStr(load.res)}|${v.b & 8 ? 'turned' : ''}|${v.g}`, load.silver);
        say(c, v, 'unload');
        load.res = [];
        load.silver = 0;
        const tie = nb.ties[load.to ?? ''];
        if (tie) tie.last = dayOf(t);
        bump(c, 'caravansHome');
        v.dep = t + 2 * H;
      }
      setNext(c, v, party, H);
      return true;
    }
    case 'carter': {
      if (v.b & 1) return false;
      if (t < v.ta + H) { setNext(c, v, party, H); return true; }
      v.b |= 1;
      const load = nb.loads.find((l) => l.g === v.g);
      if (!load) return false;
      const lord = rulerOf(c);
      if (v.d === 1) {
        load.res = takeStock(c, load.res);
        load.silver = Math.floor(Math.min(load.silver, Math.max(0, c.stock.silver)));
        c.stock.silver -= load.silver;
        log(c, 'd_trib_out', lord?.id, undefined, `${v.f}|${v.first} ${v.fam}|${resStr(load.res)}|${v.g}`, load.silver);
        const tie = nb.ties[load.to ?? ''];
        if (tie) { tie.tb = (tie.tb ?? 0) + 1; tie.last = dayOf(t); }
        v.dep = t + H;
      } else {
        giveStock(c, load.res);
        c.stock.silver += load.silver;
        log(c, 'd_trib_in', lord?.id, undefined, `${v.f}|${v.first} ${v.fam}|${resStr(load.res)}|${v.g}`, load.silver);
        load.res = [];
        load.silver = 0;
        early(2);
      }
      say(c, v, 'dues');
      setNext(c, v, party, H);
      return true;
    }
    case 'envoy': {
      // the ruler hears them a couple of hours after they come
      if ((v.b & 1) || hour < 8 || hour >= 20) return false;
      if (t < v.ta + 2 * H) { setNext(c, v, party, H); return true; }
      v.b |= 1;
      const what = v.d === 1 ? 'trade' : v.d === 2 ? 'ally' : 'tribute';
      const id = tieIdOf(c, v.f);
      sealed(c, id, what, 'envoy', undefined, `${v.first} ${v.fam}|${v.g}`);
      say(c, v, 'sealed');
      return false;
    }
    default: return false;
  }
}

/** A party on a neighbour's business has left the map: what goes down the road with it. */
export function nbGone(c: Colony, v: Visitor): void {
  const nb = c.nb;
  if (!nb) return;
  const i = nb.loads.findIndex((l) => l.g === v.g);
  if (i < 0) return;
  const load = nb.loads[i];
  nb.loads.splice(i, 1);
  const who = (carts: number): GuestSpec[] => {
    const lead: GuestSpec = { k: v.k, first: v.first, fam: v.fam, race: v.race, sex: v.sex, born: v.born, look: v.look };
    const out = [lead];
    for (let k = 0; k < carts; k++) out.push({ ...lead, k: 'cart', first: 'an ox-cart', fam: '' });
    return out;
  };
  if (!load.to) {
    // tribute that came in, and its carter gone before the cart was emptied: it is ours all the same
    if (load.res.length || load.silver) { giveStock(c, load.res); c.stock.silver += load.silver; log(c, 'd_trib_in', rulerOf(c)?.id, undefined, `${v.f}||${resStr(load.res)}`, load.silver); }
    return;
  }
  if (v.k === 'trader') {
    if (load.leg === 0) {
      // our goods, on their way to the neighbour (unloaded again here if they never got loaded)
      if (!(v.b & 1)) return;
      const tech = c.tech ? c.tech.got.slice(-3).map((g) => g.k) : [];
      c.out.push({ k: 'caravan', to: load.to, fromId: c.id, fromName: c.name, leg: 0, res: load.res, silver: load.silver, who: who(load.res.length >= 3 ? 2 : 1), tech });
      bump(c, 'caravansOut');
    } else if (load.leg === 1) {
      // the neighbour's carters going home with what they got here (or with their own load, if nothing changed hands)
      const traded = (v.b & 1) !== 0;
      const res = traded ? load.back ?? [] : load.res;
      c.out.push({ k: 'caravan', to: load.to, fromId: c.id, fromName: c.name, leg: 1, res, silver: traded ? load.bs ?? 0 : load.silver, who: who(res.length >= 3 ? 2 : 1), ...(v.b & 8 ? { turned: 1 } : {}) });
    } else if (load.res.length || load.silver) {
      // (home, but gone again before the carts were emptied: the goods stay)
      giveStock(c, load.res);
      c.stock.silver += load.silver;
    }
  } else if (v.k === 'carter') {
    if (load.leg === 0 && (v.b & 1)) c.out.push({ k: 'tribute', to: load.to, fromId: c.id, fromName: c.name, res: load.res, silver: load.silver, who: who(1) });
  }
}

/** How much a colonist wants to go and look at a guest on a neighbour's business. */
export function nbCall(c: Colony, p: Pawn, v: Visitor, st: number, hour: number): number {
  switch (v.k) {
    case 'trader': return st >= STAGE.ADULT && hour >= 8 && hour < 18 && v.d === 2 && p.coin >= 6 ? 0.8 : 0;
    case 'knight': return st === STAGE.CHILD && hour >= 9 && hour < 19 ? 0.9 : st >= STAGE.TEEN && hour >= 17 && hour < 22 && per(p, AX.SOCIABLE) > 0.3 ? 0.5 : 0;
    default: return 0;
  }
}

/** A colonist has spent a while with such a guest. */
export function nbMet(c: Colony, p: Pawn, v: Visitor, r: Rand): void {
  if (v.k === 'trader') {
    if (p.coin < 6 || !r.chance(0.5)) return;
    const price = Math.min(p.coin - 2, 2 + r.int(6));
    p.coin -= price;
    v.n += price;
    think(c, p, 'trinket');
  } else if (v.k === 'knight') think(c, p, 'd_sawknight');
}

// ---------------------------------------------------------------- for the dev hooks and the tests

/**
 * Local test colonies only: set one of these dealings going now, as if a neighbour (made up, if the
 * colony has none) were at the other end. 'trade' and 'ally' bring an envoy; 'envoy' sends ours out;
 * 'caravan' brings carts in, 'caravan_out' loads ours; 'tribute' brings a tribute cart, 'tribute_out'
 * sends one; 'wed' brings a bride or groom with an escort; 'tourney' holds a tournament here today (or
 * tomorrow, after noon) with knights from two towns, 'tourney_out' sends our knights to one; 'relief'
 * brings an ally's riders.
 */
export function forcePact(c: Colony, what: string): boolean {
  const near = c.near?.length ? c.near : (c.near = [{ id: 'zz1', name: 'Greywater' }, { id: 'zz2', name: 'Thornwick' }]);
  const n = near[0];
  const m = near[1] ?? near[0];
  const day = dayOf(c.tick);
  const r = new Rand(c.seed, S.PACT, c.tick, 99);
  const t = c.tick + 1;
  const base = { with: n.id, name: n.name, day, road: 120 };
  const from = { fromId: n.id, fromName: n.name };
  const folk = (k: string, s: number): GuestSpec => roadFolk(c, k, new Rand(c.seed, S.PACT, c.tick, 98, s), 0, 0.3);
  const knightSpec = (s: number): GuestSpec & { id: Id; sk: number } => ({ ...folk('knight', s), id: 900 + s, sk: 5 + (s * 3) % 7 });
  switch (what) {
    case 'trade': case 'ally':
      c.inq.push({ t, k: 'pact', what, role: 'host', ...base }, { t: t + 1, k: 'envoy', what, ...from, who: [folk('envoy', 1)] });
      return true;
    case 'envoy': c.inq.push({ t, k: 'pact', what: 'trade', role: 'send', ...base }); return true;
    case 'caravan':
      tieOf(c, n.id, n.name).trade ??= day;
      c.inq.push({ t, k: 'caravan', leg: 0, ...from, res: [['cloth', 8], ['iron', 6], ['ale', 20]], silver: 0, who: caravanFolk(c, c.id, n.id, 2) });
      return true;
    case 'caravan_out':
      tieOf(c, n.id, n.name).trade ??= day;
      c.inq.push({ t, k: 'nbdo', what: 'cv_go', ...base });
      return true;
    case 'tribute': {
      const tie = tieOf(c, n.id, n.name);
      tie.trib = 2; tie.tribT ??= day; tie.said = (tie.said ?? 0) | 4;
      const cart = folk('carter', 2);
      c.inq.push({ t, k: 'tribute', ...from, res: [['grain', 24]], silver: 18, who: [cart, { ...cart, k: 'cart', first: 'an ox-cart', fam: '' }] });
      return true;
    }
    case 'tribute_out': c.inq.push({ t, k: 'pact', what: 'tribute', role: 'pay', why: 'peace', ...base }); return true;
    case 'wed': {
      const hand = hands(c)[0];
      const p = makePawn(c, r, { sex: hand ? (hand.sex ? 0 : 1) : 0, age: 22 });
      p.fam = 'Vael';
      c.inq.push({ t, k: 'migrant', why: 'royal', ...from, house: 'Vael', dowry: 25, pawn: JSON.parse(JSON.stringify(normPawn(p))) });
      return true;
    }
    case 'tourney': {
      const nb = nbOf(c);
      if (nb.tn) return false;
      const when = hourOf(c.tick) < 9 ? day : day + 1;
      nb.tn = { day: when, t0: when * D + 13 * H, t1: when * D + 17 * H, x: -1, y: -1, h: 1, guests: [n, m], kn: [], b: [], st: 0 };
      log(c, 'd_tn_call', rulerOf(c)?.id, undefined, `${n.name}, ${m.name}`, when - day);
      c.inq.push({ t, k: 'knights', ...from, who: [knightSpec(1), knightSpec(2)] }, { t: t + 2, k: 'knights', fromId: m.id, fromName: m.name, who: [knightSpec(3)] });
      if (when === day) c.inq.push({ t: t + 3, k: 'nbdo', what: 'tn_day' });
      return true;
    }
    case 'tourney_out': c.inq.push({ t, k: 'pact', what: 'tourney', role: 'guest', ...base, when: day + 1 }); return true;
    case 'relief':
      tieOf(c, n.id, n.name).ally ??= day;
      c.inq.push({ t, k: 'relief', ...from, who: [knightSpec(4), knightSpec(5), knightSpec(6)] });
      return true;
    default: return false;
  }
}

