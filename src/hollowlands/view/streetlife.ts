// The small life of the streets, worked out from the colony as it stands and the clock: hens, dogs
// and cats in the yards beside homes, pigeons round the fountain, where a warden on the wall walks
// his beat, which fields are being reaped and where the sheaves stand, which street lamps are lit,
// and what the people who are at home, at school or at their ease are seen to be doing there (a
// toddler crawling about, someone sweeping the step or fetching water from the well).
// Nothing here is stored in the colony and nothing here draws: these are pure functions of the
// colony and the tick, so two people watching the same town see the same hen in the same place, and
// a test can count what is moving without a screen. street.ts draws what this works out.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { CROPS, HOMES, cells, shapeOf } from '../sim/data/buildings';
import { marketOpen } from '../sim/market';
import { STAGE, stage } from '../sim/pawn';
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
/** What the view needs to know about a home for the chores done at its door: the tile outside the door, a tile beside that, its hens (if it keeps any), and its id. */
export interface HomeSpot { b: number; door: number; side: number; hens: Yard | null }
export interface Scene {
  yards: Yard[];
  homes: Map<number, HomeSpot>;
  /** the wells people draw water from (tile index) */
  wells: number[];
  /** the windmills and watermills, whose sails and wheels always turn (tile index of the middle of each) */
  mills: number[];
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
export interface Actor { k: string; x: number; y: number; face: number; moving: boolean; /** 0..1 through whatever it does when still */ u: number; id: number; lift?: number }

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
  // (the wall-walk runs on over the little posterns and the next tower's own stonework)
  const wallAt = (i: number): boolean => { const st = c.st[i]; return (st === B.CWALL || st === B.PALISADE || st === B.GATE || st === B.CTOWER) && c.sb[i] !== b.id && WALLK.has(kinds.get(c.sb[i]) ?? ''); };
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
  const stone = c.st[starts[0]] !== B.PALISADE;
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
    if (leg.length >= 1) legs.push(leg);
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

/** Towers with rooks on them, at most. */
const MAX_ROOSTS = 7;

/** The tile outside a home's door, and a clear tile beside that one (for the chopping block). */
function doorSpot(c: Colony, b: Bld): HomeSpot {
  const W = c.w;
  const out: HomeSpot = { b: b.id, door: -1, side: -1, hens: null };
  for (const q of cells(shapeOf(b))) {
    const x = b.x + q.dx;
    const y = b.y + q.dy;
    if (c.st[y * W + x] !== B.DOOR) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const i = (y + dy) * W + x + dx;
      if (c.sb[i] === 0 && passable(c, i) && c.st[i] !== B.TILLED) {
        out.door = i;
        // beside the step, along the wall
        for (const j of dx ? [i + W, i - W] : [i + 1, i - 1]) if (c.sb[j] === 0 && passable(c, j) && c.st[j] === B.NONE && c.ter[j] !== T.PATH && c.ter[j] !== T.SHALLOW) { out.side = j; break; }
        return out;
      }
    }
  }
  return out;
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
  const homes = new Map<number, HomeSpot>();
  const towers: Bld[] = [];
  const mills: number[] = [];
  const kinds = new Map<number, string>();
  for (const b of c.blds) if (b.built) kinds.set(b.id, b.k);
  for (const b of c.blds) {
    if (!b.built) continue;
    if (HOME.has(b.k)) {
      // not every home keeps animals, and nobody keeps them at an empty house
      if (!b.beds.some((x) => x)) continue;
      const spot = doorSpot(c, b);
      homes.set(b.id, spot);
      const roll = hash2(b.id, 7, 61);
      if (roll > 0.86) continue;
      const y = yardOf(c, b);
      if (!y) continue;
      const k = roll < 0.56 ? 'hen' : roll < 0.71 ? 'dog' : 'cat';
      const yard: Yard = { b: b.id, x: y[0], y: y[1], w: y[2], h: y[3], k, n: k === 'hen' ? 2 + Math.floor(hash2(b.id, 8, 62) * 3) : 1 };
      yards.push(yard);
      if (k === 'hen') spot.hens = yard;
    } else if ((b.k === 'wtower' || b.k === 'tgate') && !b.br && b.s !== 'tgate~p') {
      const beat = beatOf(c, b, kinds);
      if (beat) beats.set(b.id, beat);
      if (b.k === 'wtower') towers.push(b);
    } else if (b.k === 'windmill' || b.k === 'watermill') mills.push((b.y + (b.h >> 1)) * c.w + b.x + (b.w >> 1));
  }
  // a few towers have their pair of rooks, never more than seven in a town: the same ones every day
  towers.sort((a, b) => hash2(a.id, 5, 59) - hash2(b.id, 5, 59) || a.id - b.id);
  for (const b of towers.slice(0, Math.min(MAX_ROOSTS, Math.ceil(towers.length / 3)))) roosts.push((b.x + b.w / 2) * TS, (b.y + b.h / 2) * TS);
  const flocks: number[] = [];
  const seats: number[] = [];
  const wells: number[] = [];
  for (let i = 0; i < c.st.length; i++) {
    const s = c.st[i];
    if (s === B.FOUNTAIN || s === B.PUMP) flocks.push(i);
    else if (s === B.SEAT) seats.push(i);
    else if (s === B.WELL) wells.push(i);
  }
  return { yards, homes, wells, mills, beats, flocks, roosts, reaped: reapedFields(c), lamps: lampRound(c), seats };
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

/** Are the pigeons on the square? By day, not in a storm or in snow or hard cold, and not on market day when it is full of stalls. */
export const pigeonsOut = (c: Colony, tf: number): boolean => hensOut(c, tf) && !(c.weather >= 2 && c.temp < 0) && !marketOpen(c);

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
 * Where someone is on a there-and-back walk at tick tf, between arriving (ta) and the end of their turn
 * (t1): a whole number of rounds at about `pace` tiles a tick, with `rest` ticks stood still at the
 * start of each. Returns false while they stand.
 */
function loopAt(beat: Beat, ta: number, t1: number, tf: number, pace: number, rest: number, out: { x: number; y: number; moving: boolean }): boolean {
  const dur = t1 - ta;
  const round = beat.len / (TS * pace) + rest;
  const n = Math.max(1, Math.round(dur / round));
  const t = ((tf - ta) / dur) * n;
  const u = (t - Math.floor(t)) * round;
  const walk = round - rest;
  if (u >= walk || tf >= t1) return false;
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

/**
 * Where a warden is on his beat at tick tf: he sets out from his post when he arrives, walks the
 * wall both ways at a slow pace, and is back at the post as his turn ends. Returns false if he
 * is standing at the post.
 */
export function beatAt(beat: Beat, p: Pawn, tf: number, out: { x: number; y: number; moving: boolean }): boolean {
  return loopAt(beat, p.act.ta, p.act.t1, tf, 3.2, REST, out);
}

// ---------------------------------------------------------------- what people are seen doing

/** Someone the view shows a little off where the colony has them, or busy with something: what, and where (world pixels). */
export interface Staged { k: string; x: number; y: number; moving: boolean }

/** Things done at ease that the view gives a little life of their own (see street.ts for each). */
export const PASTIMES = new Set(['chess', 'dice', 'darts', 'music', 'perform', 'listen', 'read', 'pray', 'eat', 'drink', 'bathe', 'hobby', 'relax', 'visit', 'court', 'shop', 'sell', 'attend', 'mourn']);
/** Work with a tool that already swung before the street scenes (the rest is given a stir of its own). */
const SWUNG = new Set(['wood', 'mine', 'build', 'smith', 'farm']);

const waterWays = new WeakMap<Colony, Map<string, Beat | null>>();
/** The way from a home's door to the nearest well and back (if there is one within a short walk). */
function waterWay(c: Colony, h: HomeSpot, s: Scene): Beat | null {
  if (h.door < 0 || !s.wells.length) return null;
  const W = c.w;
  const dx = h.door % W;
  const dy = Math.floor(h.door / W);
  let well = -1;
  let bd = 17;
  for (const i of s.wells) {
    const d = Math.abs((i % W) - dx) + Math.abs(Math.floor(i / W) - dy);
    if (d < bd) { bd = d; well = i; }
  }
  if (well < 0 || bd < 3) return null;
  let m = waterWays.get(c);
  if (!m) waterWays.set(c, (m = new Map()));
  const key = `${h.door}:${well}:${c.blds.length}`;
  let got = m.get(key);
  if (got === undefined) {
    // (to the open tile beside the well, not onto it)
    let end = -1;
    for (const j of [well + 1, well - 1, well + W, well - W]) if (passable(c, j) && c.sb[j] === 0) { end = j; break; }
    const path = end >= 0 ? route(c, dx, dy, end % W, Math.floor(end / W)) : null;
    got = null;
    if (path && path.length >= 2 && path.length < 40) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const i of path) { xs.push((i % W + 0.5) * TS); ys.push((Math.floor(i / W) + 0.5) * TS); }
      for (let k = path.length - 2; k >= 0; k--) { xs.push(xs[k]); ys.push(ys[k]); }
      const cum = [0];
      for (let k = 1; k < xs.length; k++) cum.push(cum[k - 1] + Math.sqrt((xs[k] - xs[k - 1]) ** 2 + (ys[k] - ys[k - 1]) ** 2));
      got = { xs, ys, cum, len: cum[cum.length - 1], top: false };
    }
    if (m.size > 200) m.clear();
    m.set(key, got);
  }
  return got;
}

/**
 * What someone at home with nothing pressing is seen doing out of doors on a fair day: sweeping the
 * step, splitting wood beside it, throwing grain to the hens, or going to the well with the buckets.
 * Which it is depends on who they are and when they sat down, so it does not change while they are at it.
 */
function chore(c: Colony, p: Pawn, tf: number, s: Scene, o: Staged): boolean {
  const a = p.act;
  if (!p.home || a.why === 'bench' || a.t1 - a.ta < 4 || c.weather >= 2 || c.temp < -6) return false;
  if (c.sb[a.ty * c.w + a.tx] !== p.home) return false;
  const hour = (((tf % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY) / TICKS_PER_HOUR;
  if (hour < 7 || hour >= 19 || stage(c, p) < STAGE.TEEN) return false;
  const h = s.homes.get(p.home);
  if (!h || h.door < 0 || hash2(p.id, a.t0, 90) > 0.85) return false;
  const roll = hash2(p.id, a.t0, 91);
  const W = c.w;
  o.moving = false;
  if (h.hens && roll < 0.3 && hensOut(c, tf)) {
    o.k = 'hens';
    o.x = (h.hens.x + h.hens.w / 2) * TS;
    o.y = (h.hens.y + h.hens.h / 2) * TS;
    return true;
  }
  if (roll < 0.6) {
    const way = waterWay(c, h, s);
    if (way) {
      o.k = 'water';
      if (!loopAt(way, a.ta, a.t1, tf, 3.6, 0.6, o)) { o.x = way.xs[0]; o.y = way.ys[0]; o.moving = false; }
      return true;
    }
  }
  if (roll < 0.8 && h.side >= 0) {
    o.k = 'chop';
    o.x = (h.side % W + 0.5) * TS;
    o.y = (Math.floor(h.side / W) + 0.5) * TS;
    return true;
  }
  o.k = 'sweep';
  o.x = (h.door % W + 0.5) * TS + Math.sin(tf * 1.3 + p.id) * 4;
  o.y = (Math.floor(h.door / W) + 0.5) * TS;
  return true;
}

/**
 * How the view stages someone who has arrived at what they are doing, if it does: a warden walks the
 * wall by his post (or paces his tower, or drills in the yard), a teacher walks the front of the
 * class, a toddler crawls about the room, someone at home at their ease is out at a chore. `o` is
 * filled with what and where. Everything here follows from the colony and the tick alone.
 */
export function stageOf(c: Colony, p: Pawn, tf: number, s: Scene, o: Staged): boolean {
  const a = p.act;
  if (tf < a.ta || a.k === 'sleep') return false;
  const x = (a.tx + 0.5) * TS;
  const y = (a.ty + 0.5) * TS;
  if (a.k === 'work') {
    if (a.w === 'guard') {
      if (a.d === 1) { o.k = 'drill'; o.x = x; o.y = y; o.moving = false; return true; }
      const beat = a.b ? s.beats.get(a.b) : undefined;
      if (beat && a.t1 - a.ta >= 6 && loopAt(beat, a.ta, a.t1, tf, 3.2, REST, o)) { o.k = 'patrol'; return true; }
      // no wall to walk: a few paces to and fro where he stands
      o.k = 'watch';
      o.x = x + Math.sin(tf * 1.1 + p.id) * 6;
      o.y = y + Math.cos(tf * 0.7 + p.id * 1.3) * 4;
      o.moving = false;
      return true;
    }
    if (a.w === 'teach' || a.w === 'preach') { o.k = 'teach'; o.x = x + Math.sin(tf * 0.9 + p.id) * 7; o.y = y; o.moving = false; return true; }
    return false;
  }
  if (a.k === 'play') {
    if (a.why !== 'baby') return false;
    // on hands and knees round the room (never off its own tile)
    o.k = 'toddler';
    o.x = x + Math.sin(tf * 0.9 + p.id * 1.7) * 6;
    o.y = y + Math.cos(tf * 0.63 + p.id * 2.3) * 4.5;
    o.moving = false;
    return true;
  }
  if (a.k === 'relax' || a.k === 'idle' || a.k === 'hobby') return chore(c, p, tf, s, o);
  return false;
}

/** How lit a street lamp is right now (0 or 1), by its place in the lamplighter's round. */
export function lampOn(c: Colony, tf: number, n: number): boolean {
  return lampLit(c, Math.floor(tf), n);
}

/**
 * Everything of the street scenes that is alive at tick tf, for counting: the animals in the yards,
 * the pigeons, the rooks on the towers, and the people the view stages or gives something to do with
 * their hands ('patrol' a warden walking the wall, 'water' someone on the way to the well, 'toddler',
 * 'chore' at the door, 'school' a pupil writing, 'pastime' a game or a meal or a talk, 'atwork' work
 * that had no movement of its own before). Walking, tool-swinging and children's games are in the
 * colony itself and are not listed here.
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
  if (pigeonsOut(c, tf)) {
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
  for (const i of s.mills) out.push({ k: 'mill', x: (i % c.w + 0.5) * TS, y: (Math.floor(i / c.w) + 0.5) * TS, face: 1, moving: false, u: 0, id: i });
  // people: those the view stages, and those it gives something to do with their hands where they are
  const o: Staged = { k: '', x: 0, y: 0, moving: false };
  for (const p of c.pawns) {
    const a = p.act;
    if (tf < a.ta || a.k === 'sleep') continue;
    if (stageOf(c, p, tf, s, o)) { out.push({ k: o.k === 'patrol' || o.k === 'toddler' || o.k === 'water' ? o.k : o.k === 'drill' || o.k === 'watch' || o.k === 'teach' ? 'atwork' : 'chore', x: o.x, y: o.y, face: 1, moving: o.moving, u: 0, id: p.id }); continue; }
    const k = a.k === 'study' ? 'school' : PASTIMES.has(a.k) ? 'pastime' : a.k === 'work' && a.w && !SWUNG.has(a.w) ? 'atwork' : '';
    if (k) out.push({ k, x: (a.tx + 0.5) * TS, y: (a.ty + 0.5) * TS, face: 1, moving: false, u: 0, id: p.id });
  }
  return out;
}

/** A tile a cart can roll over: open ground, roads and paving, the gate. */
export function passable(c: Colony, i: number): boolean {
  const s = c.st[i];
  if (s !== B.NONE && s !== B.PAVING && s !== B.GATE && s !== B.TILLED) return false;
  const t = c.ter[i];
  if (t === T.DEEP || t === T.ROCK) return false;
  const f = c.feat[i];
  return f === F.NONE || f === F.FLOWERS || f === F.HERB || f === F.MUSHROOM || f === F.STUMP;
}

/**
 * The way a cart (or someone with a yoke of buckets) goes from one tile to another, keeping to the
 * roads where it can (the view's own search, run only when the ends change, so the colony's pathing
 * is untouched).
 */
export function route(c: Colony, sx: number, sy: number, tx: number, ty: number): number[] | null {
  const W = c.w;
  const x0 = 0;
  const y0 = 0;
  const x1 = W - 1;
  const y1 = c.h - 1;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const dist = new Int32Array(n).fill(0x3fffffff);
  const prev = new Int32Array(n).fill(-1);
  // a bucket queue: steps cost 2 on a road and 5 off it
  const buckets: number[][] = [];
  const at = (x: number, y: number): number => (y - y0) * bw + (x - x0);
  const s0 = at(sx, sy);
  const goal = at(tx, ty);
  dist[s0] = 0;
  buckets[0] = [s0];
  let cur = 0;
  let left = 1;
  while (left > 0) {
    const bk = buckets[cur];
    if (!bk || !bk.length) { cur++; continue; }
    const v = bk.pop() as number;
    left--;
    if (dist[v] !== cur) continue;
    if (v === goal) break;
    const vx = (v % bw) + x0;
    const vy = Math.floor(v / bw) + y0;
    for (let k = 0; k < 4; k++) {
      const nx = vx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = vy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const gi = ny * W + nx;
      const u = at(nx, ny);
      if (u !== goal && u !== s0 && !passable(c, gi)) continue;
      const t = c.ter[gi];
      const road = t === T.PATH || t === T.STONE || c.wear[gi] > 40 || c.st[gi] === B.PAVING || c.st[gi] === B.GATE;
      // (a ford through the shallows if there is no other way)
      const nd = cur + (road ? 2 : t === T.SHALLOW ? 12 : 5);
      if (nd >= dist[u]) continue;
      dist[u] = nd;
      prev[u] = v;
      (buckets[nd] ??= []).push(u);
      left++;
    }
  }
  if (prev[goal] < 0) return null;
  const out: number[] = [];
  for (let v = goal; v >= 0; v = prev[v]) {
    out.push((Math.floor(v / bw) + y0) * W + (v % bw) + x0);
    if (v === s0) break;
  }
  out.reverse();
  // drop the tiles the cart can glide past (it cuts across little jogs in the road instead of
  // turning at every step)
  const keep = new Uint8Array(out.length);
  keep[0] = 1;
  keep[out.length - 1] = 1;
  const simplify = (a: number, b: number): void => {
    const ax = out[a] % W;
    const ay = Math.floor(out[a] / W);
    const bx = out[b] % W;
    const by = Math.floor(out[b] / W);
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) || 1;
    let far = 0;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const px = out[k] % W;
      const py = Math.floor(out[k] / W);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > far) { far = d; at = k; }
    }
    // a straight run is kept only if every tile it crosses is open
    let clear = true;
    if (at >= 0 && far <= 0.75) {
      const n = Math.ceil(len * 2);
      for (let k = 1; k < n && clear; k++) {
        const qx = Math.round(ax + ((bx - ax) * k) / n);
        const qy = Math.round(ay + ((by - ay) * k) / n);
        const qi = qy * W + qx;
        if (qi !== out[a] && qi !== out[b] && !passable(c, qi)) clear = false;
      }
    }
    if (at >= 0 && (far > 0.75 || !clear)) {
      keep[at] = 1;
      simplify(a, at);
      simplify(at, b);
    }
  };
  simplify(0, out.length - 1);
  const pts: number[] = [];
  for (let k = 0; k < out.length; k++) if (keep[k]) pts.push(out[k]);
  return pts.length >= 2 ? pts : null;
}
