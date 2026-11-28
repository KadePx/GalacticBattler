// The small life of the streets, worked out from the colony as it stands and the clock: hens, dogs
// and cats in the yards beside homes, pigeons round the fountain, where a warden on the wall walks
// his beat, which fields are being reaped and where the sheaves stand, which street lamps are lit.
// Nothing here is stored in the colony and nothing here draws: these are pure functions of the
// colony and the tick, so two people watching the same town see the same hen in the same place, and
// a test can count what is moving without a screen. street.ts draws what this works out.

import { DAYS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { CROPS, HOMES, cells, shapeOf } from '../sim/data/buildings';
import { marketOpen } from '../sim/market';
import { lampLit, lampRound } from '../sim/street';
import { B, F, T, type Bld, type Colony, type Pawn } from '../sim/types';
import { TS, hash2 } from './tiles';

const HOME = new Set(HOMES);

/** A patch of open ground beside a home (a rectangle of tiles) and what lives in it. */
export interface Yard { b: number; x: number; y: number; w: number; h: number; k: 'hen' | 'dog' | 'cat'; n: number }
/** A warden's beat along the wall from a tower or gate: points in world pixels, there and back. */
export interface Beat { xs: number[]; ys: number[]; cum: number[]; len: number; top: boolean }
/** A field being reaped (or just reaped): the bare tiles the sheaves stand on, and what was grown. */
export interface Reaped { b: number; tiles: number[]; veg: boolean; cx: number; cy: number }
export interface Scene {
  yards: Yard[];
  beats: Map<number, Beat>;
  /** where pigeons gather: the fountain and the pump (tile index) */
  flocks: number[];
  reaped: Reaped[];
  /** where rooks keep: the tops of the wall's towers and gates (world pixels, x then y) */
  roosts: number[];
  /** the street lamps, in the order they are lit */
  lamps: number[];
  seats: number[];
}

/** One small creature (or a guard on his beat): where it is in world pixels and what it is up to. */
export interface Actor { k: 'hen' | 'dog' | 'cat' | 'pigeon' | 'rook' | 'patrol'; x: number; y: number; face: number; moving: boolean; /** 0..1 through whatever it does when still */ u: number; id: number; lift?: number }

/** Bare ground a small animal can be on: no building, no street, no water, nothing growing big. */
function open(c: Colony, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) return false;
  const i = y * c.w + x;
  const t = c.ter[i];
  return c.st[i] === B.NONE && c.sb[i] === 0 && c.wear[i] <= 110 && t !== T.PATH && t !== T.SHALLOW && t !== T.DEEP && t !== T.ROCK && (c.feat[i] === F.NONE || c.feat[i] === F.FLOWERS);
}

/** The yard beside a home: the biggest clear rectangle (up to 4 by 2) along one of its sides. */
function yardOf(c: Colony, b: Bld): [number, number, number, number] | null {
  let best: [number, number, number, number] | null = null;
  let area = 0;
  const tryRun = (x: number, y: number, dx: number, dy: number, ox: number, oy: number, max: number): void => {
    // a run of open tiles along the wall, and a second row further out if that is clear too
    let n = 0;
    while (n < max && n < 4 && open(c, x + dx * n, y + dy * n)) n++;
    if (n < 2) return;
    let deep = true;
    for (let k = 0; k < n; k++) if (!open(c, x + dx * k + ox, y + dy * k + oy)) { deep = false; break; }
    const a = n * (deep ? 2 : 1);
    if (a <= area) return;
    area = a;
    const x0 = Math.min(x, x + ox * (deep ? 1 : 0));
    const y0 = Math.min(y, y + oy * (deep ? 1 : 0));
    best = [x0, y0, dx ? n : deep ? 2 : 1, dy ? n : deep ? 2 : 1];
  };
  const start = Math.floor(hash2(b.id, 9, 60) * 4);
  for (let s = 0; s < 4; s++) {
    const side = (start + s) % 4;
    if (side === 0) for (let x = b.x; x < b.x + b.w - 1; x++) tryRun(x, b.y + b.h, 1, 0, 0, 1, b.x + b.w - x);
    else if (side === 1) for (let x = b.x; x < b.x + b.w - 1; x++) tryRun(x, b.y - 1, 1, 0, 0, -1, b.x + b.w - x);
    else if (side === 2) for (let y = b.y; y < b.y + b.h - 1; y++) tryRun(b.x + b.w, y, 0, 1, 1, 0, b.y + b.h - y);
    else for (let y = b.y; y < b.y + b.h - 1; y++) tryRun(b.x - 1, y, 0, 1, -1, 0, b.y + b.h - y);
    if (area >= 6) break;
  }
  return best;
}

const WALLK = new Set(['twall', 'wtower', 'tgate']);

/**
 * The beat a warden walks from a tower or gate: out along the top of the wall one way, back, out the
 * other way, back.
 */
function beatOf(c: Colony, b: Bld, kinds: Map<number, string>): Beat | null {
  const W = c.w;
  const wallAt = (i: number): boolean => (c.st[i] === B.CWALL || c.st[i] === B.PALISADE) && kinds.get(c.sb[i]) === 'twall';
  // the two ends of wall that meet this tower
  const starts: number[] = [];
  for (let y = b.y - 1; y <= b.y + b.h; y++) {
    for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      if (x < 0 || y < 0 || x >= W || y >= c.h) continue;
      const i = y * W + x;
      if (wallAt(i) && !starts.some((s) => Math.abs((s % W) - x) <= 1 && Math.abs(Math.floor(s / W) - y) <= 1)) starts.push(i);
    }
  }
  if (!starts.length) return null;
  const stone = c.st[starts[0]] === B.CWALL;
  const runs: number[][] = [];
  for (const s of starts.slice(0, 2)) {
    const run = [s];
    const seen = new Set<number>([s]);
    let cur = s;
    for (let n = 0; n < 7; n++) {
      let next = -1;
      // straight on before round a corner
      for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) {
        const j = cur + d;
        if (j < 0 || j >= c.st.length || seen.has(j) || !wallAt(j)) continue;
        if (Math.abs((j % W) - (cur % W)) > 1) continue;
        // not back toward the tower
        const jx = j % W;
        const jy = Math.floor(j / W);
        if (jx >= b.x - 1 && jx <= b.x + b.w && jy >= b.y - 1 && jy <= b.y + b.h) continue;
        next = j;
        break;
      }
      if (next < 0) break;
      seen.add(next);
      run.push(next);
      cur = next;
    }
    runs.push(run);
  }
  // (a palisade has its fighting step behind the stakes, a stone wall its wall-walk: either way he is up on the wall)
  const pt = (i: number): [number, number] => [((i % W) + 0.5) * TS, (Math.floor(i / W) + 0.5) * TS];
  const legs: [number, number][][] = [];
  for (const run of runs) {
    const leg: [number, number][] = [];
    for (const i of run) leg.push(pt(i));
    if (leg.length >= 2) legs.push(leg);
  }
  if (!legs.length) return null;
  // where he stands when he is not walking: the tower's own floor (or the gateway)
  const spot = cells(shapeOf(b)).find((q) => q.ch === (b.k === 'tgate' ? ',' : '.'));
  const hx = (b.x + (spot ? spot.dx : b.w >> 1) + 0.5) * TS;
  const hy = (b.y + (spot ? spot.dy : b.h >> 1) + 0.5) * TS;
  const xs = [hx];
  const ys = [hy];
  for (const leg of legs) {
    for (const p of leg) { xs.push(p[0]); ys.push(p[1]); }
    for (let k = leg.length - 2; k >= 0; k--) { xs.push(leg[k][0]); ys.push(leg[k][1]); }
    xs.push(hx);
    ys.push(hy);
  }
  const cum = [0];
  for (let k = 1; k < xs.length; k++) cum.push(cum[k - 1] + Math.sqrt((xs[k] - xs[k - 1]) ** 2 + (ys[k] - ys[k - 1]) ** 2));
  return { xs, ys, cum, len: cum[cum.length - 1], top: stone };
}

/** The fields being reaped now, or reaped in the last day and not yet sown again. */
function reapedFields(c: Colony): Reaped[] {
  const out: Reaped[] = [];
  const recent = new Set<number>();
  for (let k = c.log.length - 1; k >= 0 && c.tick - c.log[k].t < TICKS_PER_DAY * 1.5; k--) if (c.log[k].k === 'harvest' && c.log[k].n) recent.add(c.log[k].n as number);
  const list = cells('field');
  for (const b of c.blds) {
    if (b.k !== 'field' || !b.built) continue;
    let ripe = 0;
    const bare: number[] = [];
    let growing = 0;
    for (const q of list) {
      const i = (b.y + q.dy) * c.w + b.x + q.dx;
      if (c.st[i] !== B.TILLED) continue;
      const v = c.crop[i];
      if (v === 255) ripe++;
      else if (v === 0) bare.push(i);
      else growing++;
    }
    if (growing || !bare.length) continue;
    if (!(ripe > 0 || recent.has(b.id))) continue;
    const res = CROPS[b.crop ?? 'grain']?.res ?? 'grain';
    out.push({ b: b.id, tiles: bare, veg: res === 'veg' || res === 'herbs', cx: b.x + (b.w >> 1), cy: b.y + (b.h >> 1) });
  }
  return out;
}

/** Read the town for everything the street scenes need. Not cheap: call it every few seconds, not every frame. */
export function scan(c: Colony): Scene {
  const yards: Yard[] = [];
  const beats = new Map<number, Beat>();
  const roosts: number[] = [];
  const kinds = new Map<number, string>();
  for (const b of c.blds) if (b.built) kinds.set(b.id, b.k);
  for (const b of c.blds) {
    if (!b.built) continue;
    if (HOME.has(b.k)) {
      // not every home keeps animals, and nobody keeps them at an empty house
      const roll = hash2(b.id, 7, 61);
      if (roll > 0.86 || !b.beds.some((x) => x)) continue;
      const y = yardOf(c, b);
      if (!y) continue;
      const k = roll < 0.56 ? 'hen' : roll < 0.71 ? 'dog' : 'cat';
      yards.push({ b: b.id, x: y[0], y: y[1], w: y[2], h: y[3], k, n: k === 'hen' ? 2 + Math.floor(hash2(b.id, 8, 62) * 3) : 1 });
    } else if ((b.k === 'wtower' || b.k === 'tgate') && !b.br) {
      const beat = beatOf(c, b, kinds);
      if (beat) beats.set(b.id, beat);
      // (not every tower has its pair of rooks)
      if (hash2(b.id, 5, 59) < 0.6) roosts.push((b.x + b.w / 2) * TS, (b.y + b.h / 2) * TS);
    }
  }
  const flocks: number[] = [];
  const seats: number[] = [];
  for (let i = 0; i < c.st.length; i++) {
    const s = c.st[i];
    if (s === B.FOUNTAIN || s === B.PUMP) flocks.push(i);
    else if (s === B.SEAT) seats.push(i);
  }
  return { yards, beats, flocks, roosts, reaped: reapedFields(c), lamps: lampRound(c), seats };
}

const memo = new WeakMap<Colony, { key: string; s: Scene }>();
/** The scene, re-read when the town or the hour changes (for callers with no clock of their own). */
export function sceneOf(c: Colony): Scene {
  const key = `${c.blds.length}|${Math.floor(c.tick / TICKS_PER_HOUR)}`;
  const m = memo.get(c);
  if (m && m.key === key) return m.s;
  const s = scan(c);
  memo.set(c, { key, s });
  return s;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Are the hens out? From first light to dusk, and not in a storm or a blizzard. */
export function hensOut(c: Colony, tf: number): boolean {
  const hour = (((tf % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY) / TICKS_PER_HOUR;
  return hour >= 6 && hour < 19.5 && c.weather < 3;
}

/**
 * Where the k-th animal of a yard is at tick tf. Each lives in spells: it picks a place in the yard,
 * goes there, and stays a while (pecking, lying down, washing a paw) before the next.
 */
export function yardActor(y: Yard, k: number, tf: number, out: Actor): void {
  // a hen moves every 12 seconds or so and a dog or a cat far less often
  const span = y.k === 'hen' ? 2 : y.k === 'dog' ? 5 : 7;
  const walk = y.k === 'hen' ? 0.38 : y.k === 'dog' ? 0.22 : 0.16;
  const seed = y.b * 13 + k;
  const t = tf / span + hash2(seed, 1, 63);
  const e = Math.floor(t);
  const u = t - e;
  const px = (n: number): number => (y.x + 0.22 + hash2(seed, n, 64) * (y.w - 0.44)) * TS;
  const py = (n: number): number => (y.y + 0.25 + hash2(seed, n, 65) * (y.h - 0.5)) * TS;
  // a dog or a cat lies where it is for most spells (never more than five running); a hen is always off somewhere new
  const stay = (n: number): boolean => y.k !== 'hen' && n % 6 !== 0 && hash2(seed, n, 66) < 0.6;
  const last = (n: number): number => { let m = n; while (stay(m)) m--; return m; };
  const to = last(e);
  const from = to === e ? last(e - 1) : to;
  const x0 = px(from);
  const y0 = py(from);
  const x1 = px(to);
  const y1 = py(to);
  const moving = to !== from && u < walk;
  const f = moving ? smooth(u / walk) : 1;
  out.k = y.k;
  out.id = seed;
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  out.moving = moving;
  out.u = moving ? u / walk : (u - walk) / (1 - walk);
  if (x1 !== x0) out.face = x1 > x0 ? 1 : -1;
  else out.face = hash2(seed, 3, 67) < 0.5 ? 1 : -1;
}

/** How many pigeons keep to a fountain. */
export const FLOCK = 6;

/**
 * Where the k-th pigeon of a flock is. They potter about the paving near the fountain; `near` is how
 * close (in pixels) the nearest person on the move is to the fountain, and when someone comes close they go up.
 */
export function pigeon(c: Colony, at: number, k: number, tf: number, near: number, out: Actor): boolean {
  const span = 3;
  const seed = at * 7 + k;
  const t = tf / span + hash2(seed, 1, 68);
  const e = Math.floor(t);
  const u = t - e;
  const fx = (at % c.w + 0.5) * TS;
  const fy = (Math.floor(at / c.w) + 0.5) * TS;
  const spot = (n: number, o: { x: number; y: number }): boolean => {
    const a = hash2(seed, n, 69) * 6.2832;
    const r = (1.1 + hash2(seed, n, 70) * 1.3) * TS;
    o.x = fx + Math.cos(a) * r;
    o.y = fy + Math.sin(a) * r * 0.8;
    const i = Math.floor(o.y / TS) * c.w + Math.floor(o.x / TS);
    const s = c.st[i];
    return (s === B.NONE || s === B.PAVING) && c.sb[i] === 0;
  };
  if (!spot(e, P1)) return false;
  const had = spot(e - 1, P0);
  const walk = 0.3;
  const moving = had && u < walk;
  const f = !had ? 1 : moving ? smooth(u / walk) : 1;
  out.k = 'pigeon';
  out.id = seed;
  out.x = had ? P0.x + (P1.x - P0.x) * f : P1.x;
  out.y = had ? P0.y + (P1.y - P0.y) * f : P1.y;
  out.face = P1.x >= P0.x ? 1 : -1;
  out.moving = moving;
  out.u = moving ? u / walk : (u - walk) / (1 - walk);
  // someone walks through: up they go, out and round, and settle again when it is quiet
  const lift = Math.max(0, Math.min(1, (TS * 2.2 - near) / (TS * 1.2)));
  out.lift = lift;
  if (lift > 0) {
    const a = hash2(seed, 2, 71) * 6.2832 + tf * 0.9;
    out.x += Math.cos(a) * lift * TS * 1.1;
    out.y += Math.sin(a) * lift * TS * 0.7 - lift * 14;
    out.moving = true;
  }
  return true;
}
const P0 = { x: 0, y: 0 };
const P1 = { x: 0, y: 0 };

/** How many rooks keep to a tower. */
export const ROOKS = 2;

/**
 * Where the k-th rook of a tower is: perched on the stonework, shuffling along it, and every half
 * minute or so off on a turn round the tower and back to where it sat. `lift` is how far through a
 * flight it is (0 when perched).
 */
export function rook(x: number, y: number, k: number, tf: number, out: Actor): void {
  const seed = Math.floor(x) * 31 + Math.floor(y) * 17 + k;
  const span = 5 + hash2(seed, 1, 72) * 3;
  const t = tf / span + hash2(seed, 2, 72);
  const e = Math.floor(t);
  const u = t - e;
  const px = x + (hash2(seed, 3, 73) - 0.5) * TS * 0.9;
  const py = y + (hash2(seed, 4, 73) - 0.5) * TS * 0.7 - 3;
  const fly = 0.28;
  out.k = 'rook';
  out.id = seed;
  if (u < fly && hash2(seed, e, 74) < 0.8) {
    // out and round: a loop that starts and ends on the perch, now one way round and now the other
    const turn = hash2(seed, e, 75) < 0.5 ? 1 : -1;
    const th = (u / fly) * 6.2832;
    const R = TS * (1.5 + hash2(seed, e, 76) * 1.2);
    const a0 = hash2(seed, e, 77) * 6.2832;
    out.x = px + (Math.cos(a0 + th * turn) - Math.cos(a0)) * R;
    out.y = py + (Math.sin(a0 + th * turn) - Math.sin(a0)) * R * 0.7;
    out.face = -Math.sin(a0 + th * turn) * turn >= 0 ? 1 : -1;
    out.moving = true;
    out.u = u / fly;
    out.lift = Math.sin((u / fly) * Math.PI);
    return;
  }
  // on the perch: a sidle along the stone now and then
  const hop = Math.floor(u * 4);
  out.x = px + (hash2(seed, e * 4 + hop, 78) - 0.5) * 7;
  out.y = py;
  out.face = hash2(seed, e * 4 + hop, 79) < 0.5 ? 1 : -1;
  out.moving = false;
  out.u = u;
  out.lift = 0;
}

/** Are the rooks about? By day, in anything short of a storm. */
export const rooksOut = (c: Colony, tf: number): boolean => { const hour = (((tf % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY) / TICKS_PER_HOUR; return hour >= 5.5 && hour < 20 && c.weather < 3; };

/** Ticks a warden stands at his post between rounds of his beat. */
const REST = 1.5;

/** Is this colonist on watch at a wall tower or gate (arrived, and standing their turn)? */
export function onBeat(p: Pawn, tf: number): boolean {
  const a = p.act;
  return a.k === 'work' && a.w === 'guard' && !!a.b && tf >= a.ta && a.t1 - a.ta >= 6;
}

/**
 * Where a warden is on his beat at tick tf: he sets out from his post when he arrives, walks the
 * wall both ways at a slow pace, and is back at the post as his turn ends. Returns false if he
 * is standing at the post.
 */
export function beatAt(beat: Beat, p: Pawn, tf: number, out: { x: number; y: number; moving: boolean }): boolean {
  const a = p.act;
  const dur = a.t1 - a.ta;
  // about a tile in two seconds; a whole number of rounds in the turn, with a rest at the post between
  const round = beat.len / (TS * 3.2) + REST;
  const n = Math.max(1, Math.round(dur / round));
  const t = ((tf - a.ta) / dur) * n;
  const u = (t - Math.floor(t)) * round;
  const walk = round - REST;
  if (u >= walk) return false;
  const d = (u / walk) * beat.len;
  let k = 1;
  while (k < beat.cum.length - 1 && beat.cum[k] < d) k++;
  const seg = beat.cum[k] - beat.cum[k - 1] || 1;
  const f = Math.max(0, Math.min(1, (d - beat.cum[k - 1]) / seg));
  out.x = beat.xs[k - 1] + (beat.xs[k] - beat.xs[k - 1]) * f;
  out.y = beat.ys[k - 1] + (beat.ys[k] - beat.ys[k - 1]) * f;
  out.moving = true;
  return true;
}

/** How lit a street lamp is right now (0 or 1), by its place in the lamplighter's round. */
export function lampOn(c: Colony, tf: number, n: number): boolean {
  return lampLit(c, Math.floor(tf), n);
}

/** Is it harvest for the carts: any field with sheaves standing? */
export const harvestOn = (s: Scene): boolean => s.reaped.length > 0;

/**
 * Everything of the street scenes that is alive at tick tf, for counting: the animals in the yards,
 * the pigeons, the rooks on the towers, and the wardens walking their beats. (What colonists themselves do is in the colony.)
 */
export function streetActors(c: Colony, tf: number, s: Scene = sceneOf(c)): Actor[] {
  const out: Actor[] = [];
  const hens = hensOut(c, tf);
  for (const y of s.yards) {
    if (y.k === 'hen' && !hens) continue;
    for (let k = 0; k < y.n; k++) {
      const a: Actor = { k: y.k, x: 0, y: 0, face: 1, moving: false, u: 0, id: 0 };
      yardActor(y, k, tf, a);
      out.push(a);
    }
  }
  const season = Math.floor((Math.floor(tf / TICKS_PER_DAY) % (DAYS_PER_SEASON * 4)) / DAYS_PER_SEASON);
  if (hens && !marketOpen(c) && !(season === 3 && c.weather >= 2)) {
    for (const at of s.flocks) {
      for (let k = 0; k < FLOCK; k++) {
        const a: Actor = { k: 'pigeon', x: 0, y: 0, face: 1, moving: false, u: 0, id: 0 };
        if (pigeon(c, at, k, tf, 1e9, a)) out.push(a);
      }
    }
  }
  if (rooksOut(c, tf)) {
    for (let j = 0; j < s.roosts.length; j += 2) {
      for (let k = 0; k < ROOKS; k++) {
        const a: Actor = { k: 'rook', x: 0, y: 0, face: 1, moving: false, u: 0, id: 0 };
        rook(s.roosts[j], s.roosts[j + 1], k, tf, a);
        out.push(a);
      }
    }
  }
  const o = { x: 0, y: 0, moving: false };
  for (const p of c.pawns) {
    if (!onBeat(p, tf)) continue;
    const beat = s.beats.get(p.act.b as number);
    if (beat && beatAt(beat, p, tf, o)) out.push({ k: 'patrol', x: o.x, y: o.y, face: 1, moving: true, u: 0, id: p.id });
  }
  return out;
}
