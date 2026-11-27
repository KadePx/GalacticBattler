// What passes between colonies, and what the wider land does to all of them. Pure functions,
// used by both the one-process world (world.ts) and the server's region keeper.

import { hash32, hashStr, S } from './rng';

/**
 * What the keeper of the land knows of a colony when it weighs up its dealings with its neighbours
 * (each colony reports these about itself; see siteStat in neigh.ts): people, those who can fight,
 * silver, kind of rule, castle and wall stages, a hard ruler, who of the ruling house could be sent
 * to marry (bits: 1 a woman, 2 a man) and whose hand is free here, and whether it has trouble at home.
 */
export interface SiteStat { pop: number; fight: number; silver: number; gov: string; castle: number; walls: number; fierce: number; spare: number; hand: number; busy: number }

export interface Place { id: string; name: string; x: number; y: number; dead?: number; nearSent?: string; ruins?: string; st?: SiteStat; wars?: string[] }
export interface Delivery { to: string; input: Record<string, unknown> }

/** How two colonies stand with each other, as the land keeps it (days are game days). */
export interface Tie {
  /** a trade agreement, an alliance, a marriage between the houses: the day each was made */
  trade?: number; ally?: number; kin?: number;
  /** tribute: who pays (a colony id), since when, and the day it last fell due */
  trib?: string; tribT?: number; due?: number;
  /** caravans: the day the last set out, and how many so far */
  cv?: number; cvn?: number;
}
/** Someone on the road between two colonies, for the map: from, to, set out and arrives (ticks), and what they are. */
export interface Trip { a: string; b: string; t0: number; t1: number; k: string }
/** Everything between colonies that is not a war: ties by pair ('a|b', ids in order), who is on the road, the tournament called, and when things last happened. */
export interface Pacts {
  day0: number;
  ties: Record<string, Tie>;
  trips: Trip[];
  tn?: { host: string; day: number; guests: string[] };
  tnLast?: number;
  /** the day each colony last sent or received someone to marry */
  wed?: Record<string, number>;
}

const gap = (a: Place, b: Place): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Living colonies other than this one, nearest first. */
export function nearest<T extends Place>(sites: T[], fromId: string): T[] {
  const me = sites.find((s) => s.id === fromId);
  return sites.filter((s) => s.id !== fromId && !s.dead).sort((a, b) => (me ? gap(a, me) - gap(b, me) : 0) || (a.id < b.id ? -1 : 1));
}

/** Where one outgoing message goes. Settler parties are handled by the caller. */
export function routeMsg(sites: Place[], fromId: string, fromName: string, m: Record<string, unknown>): Delivery[] {
  const near = nearest(sites, fromId);
  if (typeof m.to === 'string') {
    if (!sites.some((s) => s.id === m.to && !s.dead)) return [];
    return [{ to: m.to, input: m.k === 'migrant' && m.why !== 'royal' ? { k: 'migrant', pawn: m.pawn, fromName: m.fromName, why: m.why } : { ...m, to: undefined } }];
  }
  if (m.k === 'migrant') return near[0] ? [{ to: near[0].id, input: { k: 'migrant', pawn: m.pawn, fromName: m.fromName, why: m.why } }] : [];
  if (m.k === 'news') return near.slice(0, 3).map((s) => ({ to: s.id, input: { k: 'news', what: m.what, name: fromName, who: m.who } }));
  return [];
}

/** Tell each colony who its neighbours are, whenever that has changed. */
export function nearLists(sites: Place[]): Delivery[] {
  const out: Delivery[] = [];
  for (const s of sites) {
    if (s.dead) continue;
    const list = nearest(sites, s.id).slice(0, 4).map((n) => ({ id: n.id, name: n.name }));
    // dead colonies within a few days' walk: their ruins are somewhere to send an expedition
    const dead = sites.filter((d) => d.dead && d.id !== s.id && gap(d, s) <= 18 && !sites.some((o) => !o.dead && o.x === d.x && o.y === d.y)).sort((a, b) => gap(a, s) - gap(b, s) || (a.id < b.id ? -1 : 1)).slice(0, 4);
    const key = list.map((n) => n.id).join(',') + (dead.length ? '|' + dead.map((n) => n.id).join(',') : '');
    if (key === (s.nearSent ?? '')) continue;
    s.nearSent = key;
    out.push({ to: s.id, input: dead.length ? { k: 'near', list, dead: dead.map((n) => n.name) } : { k: 'near', list } });
  }
  return out;
}

const WARLORDS = ['Gorgath the Flayer', 'Old Mother Tusk', 'Urzag Nine-Fingers', 'the Red Thane', 'Skarn of the Pit', 'Queen Vessa the Pale'];

/**
 * Now and then something bigger than any one colony moves across the land: a warlord's host,
 * a plague, a winter that will not end. Returns what each colony receives, or nothing.
 */
export function landThreat(seed: number, day: number, sites: Place[], state: { lastThreat?: number }): Delivery[] {
  const alive = sites.filter((s) => !s.dead);
  if (alive.length < 2 || day < 60 || day - (state.lastThreat ?? 0) < 45) return [];
  if (hash32(seed, S.STORY, 700, day) % 100 >= 3) return [];
  state.lastThreat = day;
  const roll = hash32(seed, S.STORY, 701, day) % 10;
  const out: Delivery[] = [];
  if (roll < 5) {
    const who = WARLORDS[hash32(seed, S.STORY, 702, day) % WARLORDS.length];
    for (const s of alive) {
      out.push({ to: s.id, input: { k: 'news', what: 'warlord', name: who, who: '' } });
      // a walled town sees the whole host camp outside its gates; an open one only its raiders
      out.push({ to: s.id, input: { k: 'raid', kind: 'orc', n: 3 + (hash32(seed, S.STORY, 703, day, s.x, s.y) % 3), siege: 10, name: who, delay: 240 + (hash32(seed, S.STORY, 704, day, s.x) % 1200) } });
    }
  } else if (roll < 8) {
    for (const s of alive) out.push({ to: s.id, input: { k: 'news', what: 'outbreak', name: 'the road', who: 'plague' } });
  } else {
    for (const s of alive) out.push({ to: s.id, input: { k: 'mod', mod: 'coldsnap', days: 8 } });
  }
  return out;
}

/** An abandoned colony close enough for settlers to move into, if they are so minded. */
export function ruinFor<T extends Place>(seed: number, sites: T[], parent: Place | undefined, n: number): T | undefined {
  if (!parent || hash32(seed, S.GEN, 950, n) % 100 >= 40) return undefined;
  return sites.filter((s) => s.dead && gap(s, parent) <= 18 && !sites.some((o) => !o.dead && o.x === s.x && o.y === s.y)).sort((a, b) => gap(a, parent) - gap(b, parent))[0];
}

// ---------------------------------------------------------------- neighbours: pacts, caravans, tournaments

export const pairKey = (a: string, b: string): string => (a < b ? a + '|' + b : b + '|' + a);

/** Ticks of road between two places: half a day to a day and a half for neighbours. */
export const roadTicks = (a: Place, b: Place): number => Math.min(400, 60 + gap(a, b) * 8);

/** Messages that put someone on the road for the map to show, and what the map calls them. */
const TRIP_OF: Record<string, string> = { caravan: 'caravan', tribute: 'tribute', envoy: 'envoy', knights: 'knights', relief: 'relief', migrant: 'bride' };

/**
 * What the land makes of a message on its way between two colonies: the road takes time (a delay
 * the receiver waits out), the travellers are marked on the map, and some messages change how the
 * two stand (a war ends agreements, a marriage joins the houses, a peace that was paid for becomes
 * tribute). Returns more to deliver, if the news concerns anyone else.
 */
export function routePact(sites: Place[], state: { pacts?: Pacts }, fromId: string, now: number, m: Record<string, unknown>, out: Delivery[]): Delivery[] {
  const P = state.pacts;
  const extra: Delivery[] = [];
  if (!P || typeof m.to !== 'string') return extra;
  const a = sites.find((s) => s.id === fromId);
  const b = sites.find((s) => s.id === m.to && !s.dead);
  if (!a || !b) return extra;
  const key = pairKey(a.id, b.id);
  const k = String(m.k);
  const day = Math.floor(now / 240);
  if (TRIP_OF[k] && (k !== 'migrant' || m.why === 'royal')) {
    const road = roadTicks(a, b);
    for (const d of out) if (d.to === b.id && d.input.k === k) { d.input.delay = road; d.input.road = road; }
    P.trips.push({ a: a.id, b: b.id, t0: now, t1: now + road, k: TRIP_OF[k] });
    if (P.trips.length > 40) P.trips.splice(0, P.trips.length - 40);
  }
  if (k === 'aid') for (const d of out) if (d.to === b.id && d.input.k === k) d.input.road = roadTicks(a, b);
  if (k === 'migrant' && m.why === 'royal') {
    (P.ties[key] ??= {}).kin = day;
    (P.wed ??= {})[a.id] = day;
    P.wed[b.id] = day;
    extra.push({ to: a.id, input: { k: 'pact', what: 'kin', with: b.id, name: b.name, day } }, { to: b.id, input: { k: 'pact', what: 'kin', with: a.id, name: a.name, day } });
  } else if (k === 'war') {
    const t = P.ties[key];
    if (t && (t.trade !== undefined || t.ally !== undefined || t.trib !== undefined)) {
      delete t.trade; delete t.ally; delete t.trib; delete t.tribT; delete t.due; delete t.cv;
      extra.push({ to: a.id, input: { k: 'pact', what: 'broken', with: b.id, name: b.name, day } }, { to: b.id, input: { k: 'pact', what: 'broken', with: a.id, name: a.name, day } });
    }
  } else if (k === 'peace' && Number(m.tribute) > 0) {
    // the one who sued for peace goes on paying for it, for a year
    const t = (P.ties[key] ??= {});
    // (not in the land's first days of keeping such things: a world already running wakes to them gently;
    // and nobody pays two masters)
    let pays = false;
    for (const key2 in P.ties) if (P.ties[key2].trib === a.id) pays = true;
    if (t.trib === undefined && t.ally === undefined && !pays && day >= P.day0 + 10) {
      t.trib = a.id; t.tribT = day; t.due = day;
      extra.push({ to: a.id, input: { k: 'pact', what: 'tribute', role: 'pay', with: b.id, name: b.name, day, road: roadTicks(a, b), why: 'peace' } }, { to: b.id, input: { k: 'pact', what: 'tribute', role: 'take', with: a.id, name: a.name, day, road: roadTicks(a, b), why: 'peace' } });
    }
  }
  return extra;
}

const season = (day: number): number => Math.floor((day % 60) / 15);

/**
 * Once a day the land weighs up every pair of neighbours: a trade agreement where there is none,
 * caravans where there is one, an alliance between old partners (sooner when a warlord is abroad),
 * tribute from the weak to the strong and hard, a marriage between ruling houses, and now and then
 * a tournament. Both colonies are told the same thing, so they never disagree about where they
 * stand. Nothing happens on the first day (the land only takes note), and each pair has its own
 * few days of grace after that, so a world already running wakes to this gently.
 */
export function pactsDaily(seed: number, day: number, now: number, sites: Place[], state: { pacts?: Pacts; lastThreat?: number }): Delivery[] {
  const out: Delivery[] = [];
  if (!state.pacts) { state.pacts = { day0: day, ties: {}, trips: [] }; return out; }
  const P = state.pacts;
  const alive = sites.filter((s) => !s.dead && s.st);
  const by = new Map(alive.map((s) => [s.id, s]));
  P.trips = P.trips.filter((t) => t.t1 > now - 240);
  // ties with the dead are over
  for (const key of Object.keys(P.ties)) {
    const [x, y] = key.split('|');
    if (!by.has(x) || !by.has(y)) { if (sites.some((s) => (s.id === x || s.id === y) && s.dead)) delete P.ties[key]; continue; }
    const t = P.ties[key];
    if (t.trade === undefined && t.ally === undefined && t.kin === undefined && t.trib === undefined) delete P.ties[key];
  }
  const count = (id: string, f: 'trade' | 'ally'): number => { let n = 0; for (const key in P.ties) if (P.ties[key][f] !== undefined && key.split('|').includes(id)) n++; return n; };
  const tell = (a: Place, b: Place, what: string, x: Record<string, unknown> = {}, xb: Record<string, unknown> = x): void => {
    const road = roadTicks(a, b);
    out.push({ to: a.id, input: { k: 'pact', what, with: b.id, name: b.name, day, road, ...x } }, { to: b.id, input: { k: 'pact', what, with: a.id, name: a.name, day, road, ...xb } });
  };
  const warlord = state.lastThreat !== undefined && day - state.lastThreat < 40;
  const winter = season(day) === 3;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].id < alive[j].id ? alive[i] : alive[j];
      const b = a === alive[i] ? alive[j] : alive[i];
      // neighbours: each among the other's nearest four, or already bound to each other
      const key = pairKey(a.id, b.id);
      let t: Tie | undefined = P.ties[key];
      if (!t && !(nearest(sites, a.id).slice(0, 4).includes(b) || nearest(sites, b.id).slice(0, 4).includes(a))) continue;
      const A = a.st!;
      const B = b.st!;
      const ph = hashStr(key);
      if (day < P.day0 + 2 + (ph % 9)) continue;
      const roll = (n: number): number => hash32(seed, S.PACT, day, ph, n) % 1000;
      const atWar = !!a.wars?.includes(b.id) || !!b.wars?.includes(a.id);
      if (atWar) {
        if (t && (t.trade !== undefined || t.ally !== undefined || t.trib !== undefined)) {
          delete t.trade; delete t.ally; delete t.trib; delete t.tribT; delete t.due; delete t.cv;
          tell(a, b, 'broken');
        }
        continue;
      }
      const quiet = !A.busy && !B.busy;
      // old agreements run out
      if (t?.trade !== undefined && day - t.trade >= 150) { delete t.trade; delete t.cv; tell(a, b, 'lapsed', { f: 'trade' }); }
      if (t?.ally !== undefined && day - t.ally >= 240) { delete t.ally; tell(a, b, 'lapsed', { f: 'ally' }); }
      if (t?.kin !== undefined && day - t.kin >= 600) delete t.kin;
      if (t?.trib !== undefined) {
        const payer = t.trib === a.id ? a : b;
        const lord = payer === a ? b : a;
        if (day - (t.tribT ?? day) >= 120 || payer.st!.fight >= lord.st!.fight + 4) {
          const why = day - (t.tribT ?? day) >= 120 ? 'time' : 'strong';
          delete t.trib; delete t.tribT; delete t.due;
          tell(payer, lord, 'tribute_end', { role: 'pay', why }, { role: 'take', why });
        } else if (day - (t.due ?? day) >= 15 && !payer.st!.busy) {
          t.due = day;
          out.push({ to: payer.id, input: { k: 'pact', what: 'tribute_due', with: lord.id, name: lord.name, day, road: roadTicks(a, b) } });
        }
      }
      // a trade agreement between two towns that have something to sell
      if (t?.trade === undefined && quiet && A.pop >= 12 && B.pop >= 12 && count(a.id, 'trade') < 2 && count(b.id, 'trade') < 2 && roll(1) < 40) {
        t = P.ties[key] ??= {};
        t.trade = day;
        t.cv = day - 6;
        const first = roll(2) < 500;
        tell(first ? a : b, first ? b : a, 'trade', { role: 'send' }, { role: 'host' });
        continue;
      }
      // caravans along an agreed road, each way in turn
      if (t?.trade !== undefined && quiet && !winter && day - (t.cv ?? t.trade) >= 11 + (hash32(seed, S.PACT, ph, t.cvn ?? 0) % 6)) {
        t.cv = day;
        t.cvn = (t.cvn ?? 0) + 1;
        const from = (t.cvn + ph) % 2 ? a : b;
        const to = from === a ? b : a;
        out.push({ to: from.id, input: { k: 'pact', what: 'caravan', with: to.id, name: to.name, day, road: roadTicks(a, b), n: t.cvn } });
        continue;
      }
      // an alliance: between those who already trade or are kin, and between anyone when a warlord is abroad
      if (t?.ally === undefined && t?.trib === undefined && quiet && count(a.id, 'ally') < 2 && count(b.id, 'ally') < 2) {
        const close = (t?.trade !== undefined && day - t.trade >= 12) || t?.kin !== undefined;
        if ((close || warlord) && roll(3) < (warlord ? (close ? 120 : 45) : 22)) {
          t = P.ties[key] ??= {};
          t.ally = day;
          const first = roll(4) < 500;
          tell(first ? a : b, first ? b : a, 'ally', { role: 'send', why: warlord ? 'warlord' : '' }, { role: 'host', why: warlord ? 'warlord' : '' });
          continue;
        }
      }
      // tribute: a strong, hard neighbour leans on a weaker one that has silver to give
      if (t?.trib === undefined && t?.ally === undefined && t?.kin === undefined && t?.trade === undefined && quiet) {
        const s = A.fight >= B.fight ? a : b;
        const w = s === a ? b : a;
        const S1 = s.st!;
        const W1 = w.st!;
        const lean = S1.fight >= W1.fight * 1.3 + 3 && S1.fierce >= 1;
        // (nobody pays two masters, and nobody takes from more than two)
        let paying = 0;
        let taking = 0;
        for (const key2 in P.ties) { const tr = P.ties[key2].trib; if (tr === w.id) paying++; else if (tr !== undefined && key2.split('|').includes(s.id)) taking++; }
        if (lean && !paying && taking < 2 && W1.silver >= 40 && roll(5) < (S1.fierce >= 2 ? 20 : 5)) {
          t = P.ties[key] ??= {};
          t.trib = w.id; t.tribT = day; t.due = day;
          tell(s, w, 'tribute', { role: 'take', why: 'demand' }, { role: 'pay', why: 'demand' });
          continue;
        }
      }
      // a marriage between the houses of two towns with castles
      // (a house makes such a match once in a few years)
      if (t?.kin === undefined && quiet && day >= P.day0 + 20 && A.castle >= 1 && B.castle >= 1 && day - (P.wed?.[a.id] ?? -999) >= 150 && day - (P.wed?.[b.id] ?? -999) >= 150 && roll(6) < 12) {
        // who has someone to send, and whose hand is free for them (a woman to a man, a man to a woman)
        const fits = (x: SiteStat, y: SiteStat): boolean => ((x.spare & 1) !== 0 && (y.hand & 2) !== 0) || ((x.spare & 2) !== 0 && (y.hand & 1) !== 0);
        const ab = fits(A, B) && B.pop < 96;
        const ba = fits(B, A) && A.pop < 96;
        if (ab || ba) {
          const from = ab && (!ba || roll(7) < 500) ? a : b;
          const to = from === a ? b : a;
          (P.wed ??= {})[from.id] = day - 120;
          out.push({ to: from.id, input: { k: 'pact', what: 'wed', with: to.id, name: to.name, day, road: roadTicks(a, b), hand: to.st!.hand } });
        }
      }
    }
  }
  // a tournament, now and then, in the warm half of the year: one town hosts, its neighbours send knights
  if (P.tn && day > P.tn.day) delete P.tn;
  if (!P.tn && season(day) < 3 && day % 15 <= 9 && day - (P.tnLast ?? P.day0 - 20) >= 40 + (hash32(seed, S.PACT, 900, P.tnLast ?? 0) % 25)) {
    let host: Place | undefined;
    let best = -1;
    for (const s of alive) {
      const st = s.st!;
      if (st.busy || st.pop < 30 || (st.castle < 1 && st.pop < 45) || s.wars?.length) continue;
      const sc = st.castle * 12 + st.pop + (hash32(seed, S.PACT, 901, day, hashStr(s.id)) % 40);
      if (sc > best) { best = sc; host = s; }
    }
    if (host) {
      const h = host;
      const guests = nearest(alive, h.id).filter((s) => !s.st!.busy && s.st!.pop >= 15 && s.st!.fight >= 6 && !s.wars?.includes(h.id) && !h.wars?.includes(s.id)).slice(0, 4);
      if (guests.length) {
        const when = day + 5;
        P.tn = { host: h.id, day: when, guests: guests.map((g) => g.id) };
        P.tnLast = day;
        out.push({ to: h.id, input: { k: 'pact', what: 'tourney', role: 'host', day, when, guests: guests.map((g) => ({ id: g.id, name: g.name })) } });
        for (const g of guests) out.push({ to: g.id, input: { k: 'pact', what: 'tourney', role: 'guest', with: h.id, name: h.name, day, when, road: roadTicks(g, h) } });
      }
    }
  }
  return out;
}
