// Daily life in the streets, the part of it that is real: someone goes round at dusk lighting the
// street lamps one by one, a wedding party walks from the couple's door to the temple and mourners
// walk the dead from the temple to the grave, and on a fair day people sit on the street benches.
// Everything else in the streets (hens, washing, the wall-walk) is drawn by the view from the colony
// as it stands and is not in here.

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../config';
import { cacheOf } from './cache';
import { cells, shapeOf } from './data/buildings';
import { bury, die } from './life';
import { findPath } from './path';
import { STAGE, pawnById, stage } from './pawn';
import { hash32, S } from './rng';
import { opinion } from './social';
import { reach } from './town';
import { B, type ActK, type Bld, type Colony, type Id, type Pawn } from './types';

type Go = (k: ActK, x: number, y: number, dur: number, why: string, o?: { adj?: boolean; d?: number }) => boolean;

// ---------------------------------------------------------------- the lamplighter

/** The lamps are lit from half past five; by nine any that were missed are burning anyway. */
export const LAMP_T0 = 17 * TICKS_PER_HOUR + 5;
export const LAMP_T1 = 21 * TICKS_PER_HOUR;
/** They burn until the sky is light. */
export const LAMP_OUT = 6 * TICKS_PER_HOUR + 5;

/**
 * The street lamps in the order the lamplighter takes them: from the middle of the town, always on
 * to the nearest one not yet lit. (Street furniture is only set down at the day's start, so the
 * round is the same all evening.)
 */
export function lampRound(c: Colony): number[] {
  const R = reach(c) + 6;
  const x0 = Math.max(0, c.cx - R);
  const x1 = Math.min(c.w - 1, c.cx + R);
  const y0 = Math.max(0, c.cy - R);
  const y1 = Math.min(c.h - 1, c.cy + R);
  const left: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0, i = y * c.w + x0; x <= x1; x++, i++) if (c.st[i] === B.LAMPPOST) left.push(i);
  const out: number[] = [];
  let px = c.cx;
  let py = c.cy;
  while (left.length) {
    let best = 0;
    let bd = 1e9;
    for (let k = 0; k < left.length; k++) {
      const d = Math.abs((left[k] % c.w) - px) + Math.abs(Math.floor(left[k] / c.w) - py);
      if (d < bd) { bd = d; best = k; }
    }
    const i = left.splice(best, 1)[0];
    out.push(i);
    px = i % c.w;
    py = Math.floor(i / c.w);
  }
  return out;
}

/** Can they take a turn at the lamps? */
const canLight = (c: Colony, p: Pawn | undefined): p is Pawn => !!p && !p.gone && !p.brk && p.hp >= 50;

/**
 * At dusk the street lamps are lit one by one. Whoever is first free when the light starts to go
 * takes the pole and works out from the middle of the town; in a town with many lamps a second
 * starts from the far end of the round and they meet. If one of them is called away, the next
 * free hand takes over where they left off.
 */
export function lampAct(c: Colony, p: Pawn, go: Go): boolean {
  const t = c.tick;
  const inDay = t % TICKS_PER_DAY;
  if (inDay < LAMP_T0 || inDay >= LAMP_T1) return false;
  const day = dayOf(t);
  let L = c.lamp;
  if (!L || L[0] !== day) L = c.lamp = [day, lampRound(c).length, 0, 0, 0, 0];
  const n = L[1];
  if (L[3] + L[5] >= n) return false;
  let slot = p.id === L[2] ? 2 : p.id === L[4] ? 4 : 0;
  if (!slot) {
    for (const s of n >= 8 ? [2, 4] : [2]) {
      const o = L[s] ? pawnById(c, L[s]) : undefined;
      if (canLight(c, o) && o.act.k === 'lamps') continue;
      slot = s;
      break;
    }
    if (!slot) return false;
    L[slot] = p.id;
  }
  const round = lampRound(c);
  if (round.length !== n) return false;
  while (L[3] + L[5] < n) {
    const idx = slot === 2 ? L[3] : n - 1 - L[5];
    const i = round[idx];
    if (go('lamps', i % c.w, Math.floor(i / c.w), 1, 'dusk', { adj: true, d: idx })) return true;
    // no way to this one: it is lit from a window
    L[slot + 1]++;
  }
  return false;
}

/** A lamp is lit: on to the next. */
export function lampDone(c: Colony, p: Pawn): void {
  const L = c.lamp;
  if (!L || L[0] !== dayOf(c.tick) || L[3] + L[5] >= L[1]) return;
  if (p.id === L[2] && p.act.d === L[3]) L[3]++;
  else if (p.id === L[4] && p.act.d === L[1] - 1 - L[5]) L[5]++;
}

/** Is the n-th lamp of the round burning at this tick? (For the view; `round` is how many lamps there are.) */
export function lampLit(c: Colony, tick: number, n: number): boolean {
  const inDay = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  if (inDay >= LAMP_T1 || inDay < LAMP_OUT) return true;
  if (inDay < LAMP_T0) return false;
  const L = c.lamp;
  if (!L || L[0] !== dayOf(tick)) return false;
  return n < L[3] || n >= L[1] - L[5];
}

// ---------------------------------------------------------------- benches

/** A street bench with room on it, among the nearest few to where they are. Two can share one. */
export function benchFor(c: Colony, p: Pawn, pick: (n: number) => number): [number, number] | null {
  const R = reach(c) + 2;
  const k = cacheOf(c);
  const x0 = Math.max(0, c.cx - R);
  const x1 = Math.min(c.w - 1, c.cx + R);
  const y0 = Math.max(0, c.cy - R);
  const y1 = Math.min(c.h - 1, c.cy + R);
  const seats: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0, i = y * c.w + x0; x <= x1; x++, i++) if (c.st[i] === B.SEAT && k.reach[i]) seats.push(i);
  if (!seats.length) return null;
  const dist = (i: number): number => Math.abs((i % c.w) - p.x) + Math.abs(Math.floor(i / c.w) - p.y);
  seats.sort((a, b) => dist(a) - dist(b) || a - b);
  const near = seats.slice(0, 3);
  const first = pick(near.length);
  for (let n = 0; n < near.length; n++) {
    const i = near[(first + n) % near.length];
    const x = i % c.w;
    const y = Math.floor(i / c.w);
    let on = 0;
    for (const o of c.pawns) if (o !== p && o.act.tx === x && o.act.ty === y) on++;
    if (on < 2) return [x, y];
  }
  return null;
}

// ---------------------------------------------------------------- processions

/** Paces a procession covers in a tick: a third of a brisk walk. */
const PACE = 4;
/** How long before it sets off the walkers start to form up. */
const FORM = 14;

/** The open tile just outside a building's door. */
function doorstep(c: Colony, b: Bld): [number, number] | null {
  const k = cacheOf(c);
  for (const q of cells(shapeOf(b))) {
    const x = b.x + q.dx;
    const y = b.y + q.dy;
    if (c.st[y * c.w + x] !== B.DOOR) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const i = (y + dy) * c.w + x + dx;
      if (c.sb[i] !== b.id && k.walk[i] && k.reach[i]) return [x + dx, y + dy];
    }
  }
  return null;
}

/** Does the gathering stand beside its spot (a grave) rather than on it? */
const beside = (c: Colony, g: { x: number; y: number }): boolean => c.st[g.y * c.w + g.x] === B.GRAVE;

/** How many ticks the walk takes, for a way of `len` tiles walked by `pairs` pairs in file. */
const marchTicks = (len: number, pairs: number): number => Math.max(2, Math.ceil((len - pairs) / PACE));

/**
 * Who walks, in what order, from where and when. A wedding party walks from the couple's door: the
 * two of them first, then family and friends. A funeral walks from the temple (or the hall) to the
 * grave: those nearest the dead carry the bier, the rest follow. No procession if there is nowhere to
 * walk from, the way is too short, or the town has trouble.
 */
function plan(c: Colony, g: NonNullable<Colony['gath']>): NonNullable<NonNullable<Colony['gath']>['pr']> {
  // (the reason there is none is kept as the number: -1 trouble, -2 the people, -3 nowhere to start, -4 too few, -5 no way or too short)
  const none = (why: number): { x: number; y: number; t: number; ids: Id[] } => ({ x: 0, y: 0, t: why, ids: [] });
  if (c.siege || c.alarm) return none(-1);
  let from: [number, number] | null = null;
  const ids: Id[] = [];
  const able = (p: Pawn): boolean => !p.gone && !p.brk && p.hp >= 40 && stage(c, p) >= STAGE.CHILD;
  const scored: [number, Pawn][] = [];
  if (g.k === 'wedding') {
    const a = pawnById(c, g.a ?? 0);
    const b = pawnById(c, g.o ?? 0);
    if (!a || !b || !able(a) || !able(b)) return none(-2);
    const home = c.blds.find((x) => x.built && (x.id === a.home || x.id === b.home));
    if (!home || home.id === g.b) return none(-3);
    from = doorstep(c, home);
    ids.push(a.id, b.id);
    for (const p of c.pawns) {
      if (p === a || p === b || !able(p)) continue;
      const oa = opinion(c, p, a);
      const ob = opinion(c, p, b);
      if (oa <= -25 || ob <= -25) continue;
      const kin = p.mo === a.id || p.fa === a.id || p.mo === b.id || p.fa === b.id || a.mo === p.id || a.fa === p.id || b.mo === p.id || b.fa === p.id
        || (!!p.mo && (p.mo === a.mo || p.mo === b.mo));
      const friend = p.rel[a.id]?.f === 1 || p.rel[b.id]?.f === 1;
      const s = (kin ? 200 : 0) + (friend ? 80 : 0) + oa + ob;
      if (s > 0) scored.push([s, p]);
    }
  } else {
    const d = c.dead.find((x) => x.id === g.a);
    if (!d) return none(-2);
    // from the temple, or from the hall if the temple is where they are going
    const start = c.blds.find((x) => x.built && x.k === 'shrine' && x.id !== g.b) ?? c.blds.find((x) => x.built && x.k === 'hall' && x.id !== g.b);
    if (!start) return none(-3);
    from = doorstep(c, start);
    for (const p of c.pawns) {
      if (!able(p) || p.rel[d.id]?.f === -1) continue;
      const kin = p.id === d.sp || p.mo === d.id || p.fa === d.id || d.mo === p.id || d.fa === p.id || (!!p.mo && p.mo === d.mo);
      const friend = p.rel[d.id]?.f === 1;
      // (a few of the town always walk with the dead, whoever they were)
      const s = (kin ? 200 : 0) + (friend ? 80 : 0) + (p.fam === d.fam ? 40 : 0) + (stage(c, p) >= STAGE.ADULT ? 30 : 0) + (hash32(c.seed, S.AI, d.id, p.id, 78) % 28);
      scored.push([s, p]);
    }
  }
  if (!from) return none(-3);
  // the bier is carried by grown hands: the four in front are adults where there are enough
  const grown = (p: Pawn): number => (g.k === 'funeral' && stage(c, p) >= STAGE.TEEN ? 1 : 0);
  scored.sort((x, y) => grown(y[1]) - grown(x[1]) || y[0] - x[0] || x[1].id - y[1].id);
  for (const [, p] of scored.slice(0, 8)) ids.push(p.id);
  if (ids.length < (g.k === 'funeral' ? 4 : 2)) return none(-4);
  const way = findPath(c, from[0], from[1], g.x, g.y, beside(c, g));
  const pairs = (ids.length + 1) >> 1;
  if (!way || way.path.length < pairs + 8) return none(-5);
  const pr = { x: from[0], y: from[1], t: g.t0 - marchTicks(way.path.length, pairs) - 1, ids };
  if (c.tick >= pr.t - FORM) call(c, pr);
  return pr;
}

/** The walkers put down what they are doing in time to form up (sleepers and the hurt are left be). */
function call(c: Colony, pr: { t: number; ids: Id[] }): void {
  const t = c.tick;
  for (const id of pr.ids) {
    const p = pawnById(c, id);
    if (!p || p.gone || p.brk) continue;
    const k = p.act.k;
    if (k === 'sleep' || k === 'rest' || k === 'fight' || k === 'flee' || k === 'hide' || k === 'trek' || k === 'labour' || k === 'tend' || k === 'aid') continue;
    if (p.act.why === 'form' || p.act.why === 'procession') continue;
    p.act.t1 = Math.min(p.act.t1, Math.max(t + 1, p.act.ta));
  }
}

/** Each tick while a wedding or funeral is planned: when it is time to form up, the walkers are called. */
export function streetTick(c: Colony): void {
  const pr = c.gath?.pr;
  if (pr && pr.t >= 0 && c.tick === pr.t - FORM) call(c, pr);
}

/**
 * A colonist's part in a wedding or funeral procession: forming up two by two along the first paces
 * of the way, then walking it together at a slow pace, each pair a pace behind the one before.
 */
export function processionAct(c: Colony, p: Pawn, st: number, go: Go): boolean {
  const g = c.gath!;
  const t = c.tick;
  if (t >= g.t0 || t < g.t0 - 5 * TICKS_PER_HOUR) return false;
  let pr = g.pr;
  if (!pr) {
    // (a gathering already close when this was first looked at goes ahead as gatherings always did)
    if (t > g.t0 - 2 * TICKS_PER_HOUR) return false;
    pr = g.pr = plan(c, g);
  }
  if (pr.t < 0 || t < pr.t - FORM || t > pr.t + 1) return false;
  const n = pr.ids.indexOf(p.id);
  if (n < 0 || st < STAGE.CHILD || p.brk || p.food < 12) return false;
  const way = findPath(c, pr.x, pr.y, g.x, g.y, beside(c, g));
  const pairs = (pr.ids.length + 1) >> 1;
  if (!way || way.path.length < pairs + 8) return false;
  const path = way.path;
  const j = n >> 1;
  const at = path[pairs - 1 - j];
  const W = c.w;
  if (t < pr.t) {
    if (!go('attend', at % W, Math.floor(at / W), 1, 'form')) return false;
    if (p.act.ta <= pr.t) p.act.t1 = pr.t;
    return true;
  }
  if (p.y * W + p.x !== at) return false;
  const ta = pr.t + marchTicks(path.length, pairs);
  if (t >= ta) return false;
  const walk = path.slice(pairs - 1 - j, path.length - j);
  const end = walk[walk.length - 1];
  p.act = { k: 'attend', t0: t, ta, t1: ta, sx: p.x, sy: p.y, tx: end % W, ty: Math.floor(end / W), path: walk, w: undefined, b: undefined, o: undefined, d: n, why: 'procession' };
  for (const i of walk) if (c.wear[i] < 250) c.wear[i] += 2;
  return true;
}

// ---------------------------------------------------------------- for looking at it

/**
 * For local test colonies only: set a scene going now so it can be looked at. 'wedding' betroths two
 * free adults if nobody is betrothed and holds the wedding three hours from now; 'funeral' holds one
 * for the last of the dead to be buried (or, if the graves are empty, for the oldest of the living,
 * who dies of age on the spot); 'harvest' ripens the two fields nearest the granary and reaps half of
 * each. Returns the tile to look at and how many ticks until there is something to see, or null.
 */
export function forceScene(c: Colony, what: string): { x: number; y: number; wait: number } | null {
  const t = c.tick;
  if (what === 'wedding' || what === 'funeral') {
    const temple = c.blds.find((b) => b.built && b.k === 'shrine') ?? c.blds.find((b) => b.built && b.k === 'hall');
    let g: NonNullable<Colony['gath']> | null = null;
    if (what === 'wedding') {
      const free = (p: Pawn): boolean => !p.gone && !p.brk && stage(c, p) === STAGE.ADULT && !!p.home;
      let a = c.pawns.find((p) => free(p) && !!p.sp && p.rel[p.sp]?.k === 'betrothed' && !!pawnById(c, p.sp));
      let b = a ? pawnById(c, a.sp) : undefined;
      if (!a || !b) {
        a = c.pawns.find((p) => free(p) && !p.sp);
        b = a ? c.pawns.find((p) => p !== a && free(p) && !p.sp && p.fam !== a!.fam && p.home !== a!.home) : undefined;
        if (!a || !b) return null;
        a.sp = b.id;
        b.sp = a.id;
        (a.rel[b.id] ??= { m: [] }).k = 'betrothed';
        (b.rel[a.id] ??= { m: [] }).k = 'betrothed';
      }
      const x = temple ? temple.x + Math.floor(temple.w / 2) : c.cx;
      const y = temple ? temple.y + Math.floor(temple.h / 2) : c.cy;
      g = { k: 'wedding', t0: t + 3 * TICKS_PER_HOUR, t1: t + 6 * TICKS_PER_HOUR, b: temple?.id ?? 0, a: Math.min(a.id, b.id), o: Math.max(a.id, b.id), x, y };
    } else {
      let d = [...c.dead].reverse().find((x) => x.grave >= 0 && !x.left);
      if (!d) {
        const old = c.pawns.filter((p) => !p.gone && !p.owner).sort((x, y) => x.born - y.born || x.id - y.id)[0];
        if (!old) return null;
        die(c, old, 'age');
        bury(c);
        d = c.dead[c.dead.length - 1];
      }
      const yard = c.blds.find((b) => b.k === 'graveyard' && b.built);
      const at = yard ?? temple;
      const x = d.grave >= 0 ? d.grave % c.w : at ? at.x + Math.floor(at.w / 2) : c.cx;
      const y = d.grave >= 0 ? Math.floor(d.grave / c.w) : at ? at.y + Math.floor(at.h / 2) : c.cy;
      d.fun = 1;
      g = { k: 'funeral', t0: t + 3 * TICKS_PER_HOUR, t1: t + 5 * TICKS_PER_HOUR, b: at?.id ?? 0, a: d.id, x, y };
    }
    c.gath = g;
    const pr = (g.pr = plan(c, g));
    if (pr.t < 0) return { x: g.x, y: g.y, wait: g.t0 - t };
    return { x: pr.x, y: pr.y, wait: Math.max(0, pr.t - 2 - t) };
  }
  if (what === 'harvest') {
    const gran = c.blds.find((b) => b.built && b.k === 'granary') ?? c.blds.find((b) => b.built && b.k === 'store');
    const fields = c.blds.filter((b) => b.built && b.k === 'field').sort((a, b) => (gran ? Math.abs(a.x - gran.x) + Math.abs(a.y - gran.y) - Math.abs(b.x - gran.x) - Math.abs(b.y - gran.y) : 0) || a.id - b.id).slice(0, 2);
    if (!fields.length) return null;
    for (const f of fields) {
      f.crop ??= 'grain';
      let n = 0;
      for (const q of cells('field')) {
        const i = (f.y + q.dy) * c.w + f.x + q.dx;
        if (c.st[i] === B.TILLED) c.crop[i] = n++ % 2 ? 255 : 0;
      }
    }
    return { x: fields[0].x + (fields[0].w >> 1), y: fields[0].y + (fields[0].h >> 1), wait: 0 };
  }
  return null;
}
