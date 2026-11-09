// Relations between peoples: opinion, trade pacts and alliances. Wars live in war.ts.

import { ev, has } from './civ';
import { Rand, S } from './rng';
import { TICKS_PER_YEAR, type Civ, type Rel, type ValueId, type World } from './types';
import { faithOpinion } from './faith';

const index = new WeakMap<World, { n: number; m: Map<number, Rel> }>();
const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);

function map(w: World): Map<number, Rel> {
  let ix = index.get(w);
  if (!ix || ix.n !== w.rels.length) {
    const m = new Map<number, Rel>();
    for (const r of w.rels) m.set(key(r.a, r.b), r);
    ix = { n: w.rels.length, m };
    index.set(w, ix);
  }
  return ix.m;
}

export function relOf(w: World, a: number, b: number): Rel | undefined {
  return map(w).get(key(a, b));
}

/** The relation between two civs, created on first contact. */
export function rel(w: World, a: number, b: number): Rel {
  const m = map(w);
  let r = m.get(key(a, b));
  if (!r) {
    r = { a: Math.min(a, b), b: Math.max(a, b), op: baseOpinion(w.civs[a], w.civs[b]), st: 'peace', since: w.tick, truce: -1, grudge: 0 };
    w.rels.push(r);
    m.set(key(a, b), r);
    index.set(w, { n: w.rels.length, m });
  }
  return r;
}

export function atWar(w: World, a: number, b: number): boolean {
  return relOf(w, a, b)?.st === 'war';
}

export function allies(w: World, c: number): number[] {
  const out: number[] = [];
  for (const r of w.rels) {
    if (r.st !== 'ally') continue;
    const o = r.a === c ? r.b : r.b === c ? r.a : -1;
    if (o >= 0 && w.civs[o].died < 0) out.push(o);
  }
  return out;
}

const CLASH: [ValueId, ValueId][] = [
  ['expansionist', 'isolationist'], ['devout', 'curious'], ['martial', 'egalitarian'], ['mercantile', 'isolationist'], ['ancestral', 'curious'],
];

/** How two peoples feel about each other just from who they are. */
export function baseOpinion(a: Civ, b: Civ): number {
  let op = 0;
  for (const v of a.values) if (b.values.includes(v)) op += 8;
  for (const [x, y] of CLASH) if ((has(a, x) && has(b, y)) || (has(a, y) && has(b, x))) op -= 8;
  if (a.parent === b.id || b.parent === a.id || (a.parent >= 0 && a.parent === b.parent)) op += 10;
  if (has(a, 'isolationist') || has(b, 'isolationist')) op -= 5;
  return op;
}

/**
 * Why two peoples feel as they do, as [why, amount]. Each year their opinion moves a fifth of
 * the way toward the sum. Shared with the people page, so the reasons shown are the real ones.
 */
export function opinionParts(A: Civ, B: Civ, r: Rel, edge: number, nRoutes: number): [string, number][] {
  const out: [string, number][] = [];
  const add = (why: string, v: number) => { if (v) out.push([why, v]); };
  let shared = 0;
  for (const v of A.values) if (B.values.includes(v)) shared += 8;
  add('Shared values', shared);
  let clash = 0;
  for (const [x, y] of CLASH) if ((has(A, x) && has(B, y)) || (has(A, y) && has(B, x))) clash -= 8;
  add('Clashing values', clash);
  add('Kinship', A.parent === B.id || B.parent === A.id || (A.parent >= 0 && A.parent === B.parent) ? 10 : 0);
  add('Distrust of outsiders', has(A, 'isolationist') || has(B, 'isolationist') ? -5 : 0);
  const f = faithOpinion(A, B);
  add(f > 0 ? 'Same faith' : 'Rival faiths', f);
  add('Trade', Math.min(16, nRoutes * 4));
  add('Border friction', -Math.min(25, edge / 3));
  add('Old grudges', -r.grudge * 0.5);
  add(r.st === 'ally' ? 'Alliance' : r.st === 'pact' ? 'Trade pact' : 'At war', r.st === 'ally' ? 12 : r.st === 'pact' ? 5 : r.st === 'war' ? -50 : 0);
  add('A cruel ruler', A.ruler.trait === 'cruel' || B.ruler.trait === 'cruel' ? -5 : 0);
  add('Two just rulers', A.ruler.trait === 'just' && B.ruler.trait === 'just' ? 5 : 0);
  add('Tribute', A.lord === B.id || B.lord === A.id ? -8 : 0); // tribute breeds resentment
  return out;
}

/** Yearly: opinions drift toward what borders, trade and history say; pacts and alliances form or lapse. */
export function yearlyDiplo(w: World, border: Map<number, number>, routes: Map<number, number>): void {
  for (const r of w.rels) {
    const A = w.civs[r.a];
    const B = w.civs[r.b];
    if (A.died >= 0 || B.died >= 0) continue;
    const k = key(r.a, r.b);
    const nRoutes = routes.get(k) ?? 0;
    let target = 0;
    for (const [, v] of opinionParts(A, B, r, border.get(k) ?? 0, nRoutes)) target += v;
    r.op = Math.max(-100, Math.min(100, r.op + (target - r.op) * 0.2));
    r.grudge *= 0.93;
    if (r.st === 'war') continue;

    const rr = new Rand(w.seed, S.AI, w.tick, 0xd1, k);
    if (r.st === 'peace' && r.op >= 12 && nRoutes > 0) {
      setState(w, r, 'pact');
      ev(w, { k: 'pact', a: r.a, b: r.b });
    } else if (r.st === 'pact' && r.op < -5) {
      setState(w, r, 'peace');
      ev(w, { k: 'pact_end', a: r.a, b: r.b });
    } else if ((r.st === 'peace' || r.st === 'pact') && r.op >= 40) {
      // A shared enemy makes friends of neighbours.
      const common = w.rels.some((x) => x.st === 'war' && (x.a === r.a || x.b === r.a) && (relOf(w, r.b, x.a === r.a ? x.b : x.a)?.op ?? 0) < -10);
      if (common || rr.chance(0.12)) {
        setState(w, r, 'ally');
        ev(w, { k: 'ally', a: r.a, b: r.b });
      }
    } else if (r.st === 'ally' && r.op < 15) {
      setState(w, r, 'peace');
      ev(w, { k: 'ally_end', a: r.a, b: r.b });
    }
  }
}

export function setState(w: World, r: Rel, st: Rel['st']): void {
  r.st = st;
  r.since = w.tick;
}

export function yearsSince(w: World, r: Rel): number {
  return Math.floor((w.tick - r.since) / TICKS_PER_YEAR);
}
