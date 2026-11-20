// Things worked out from the map that are never saved: which tiles can be walked, which can
// be reached from the middle of the colony, and where the trees, rocks and bushes are.
// Anything that changes the map calls touch() and these are rebuilt on next use.

import { B, F, T, type Colony } from './types';

export interface Cache {
  /** 0 = blocked, otherwise the cost of stepping on the tile (10 = open ground) */
  walk: Uint8Array;
  /** 1 if the tile can be walked to from the colony centre */
  reach: Uint8Array;
  dirty: boolean;
  feats: Map<number, number[]>;
  /** every tile, nearest the colony centre first (ties by index): lists built in this order need no sorting */
  order: Int32Array;
  /** every feature list was built in one pass since the last change, so a missing one was dropped */
  all: boolean;
}

const store = new WeakMap<object, Cache>();

/**
 * How each field's plots stand (ripe, bare, growing) by field id, counted at most once a tick.
 * Anything that sows, reaps or kills a crop calls cropsChanged().
 */
export const fieldMemo = new WeakMap<object, { t: number; n: Map<number, [number, number, number]> }>();

export function cropsChanged(c: Colony): void {
  fieldMemo.delete(c);
}

export function touch(c: Colony): void {
  const k = store.get(c);
  if (k) k.dirty = true;
}

/**
 * One tile changed. If it is still as open (or as blocked) as it was, nothing about who can
 * reach what has changed: only its walking cost and the feature lists need redoing, which is
 * far cheaper than a whole touch().
 */
export function touchAt(c: Colony, i: number): void {
  const k = store.get(c);
  if (!k || k.dirty) return;
  const w = tileCost(c, i);
  if (!w !== !k.walk[i]) { k.dirty = true; return; }
  k.walk[i] = w;
  k.feats.clear();
  k.all = false;
}

export function tileCost(c: Colony, i: number): number {
  const s = c.st[i];
  if (s === B.WALL_WOOD || s === B.WALL_STONE || s === B.FENCE || s === B.WELL || s === B.STATUE || s === B.LOWWALL || s === B.FOUNTAIN || s === B.PUMP) return 0;
  if (s === B.CWALL || s === B.CTOWER || s === B.PALISADE) return 0;
  const t = c.ter[i];
  if (t === T.DEEP || t === T.ROCK) return 0;
  const f = c.feat[i];
  if (f === F.BOULDER || f === F.ORE || f === F.RUIN) return 0;
  if (s === B.DOOR) return 9;
  if (s === B.FLOOR_WOOD || s === B.FLOOR_STONE || s === B.FLOOR_FINE || s === B.FLOOR_BARE) return 8;
  if (s === B.PAVING) return 7;
  if (s === B.RUG) return 8;
  if (s >= B.BED) return 26;
  let cost = t === T.PATH ? 7 : t === T.SAND ? 12 : t === T.MARSH ? 18 : t === T.SHALLOW ? 26 : 10;
  if (s === B.TILLED) cost = 13;
  if (f === F.TREE || f === F.PINE) cost += 8;
  else if (f === F.BUSH || f === F.SAPLING) cost += 4;
  else if (f === F.LOG) cost += 10;
  return cost;
}

export function cacheOf(c: Colony): Cache {
  let k = store.get(c);
  if (!k) {
    k = { walk: new Uint8Array(c.w * c.h), reach: new Uint8Array(c.w * c.h), dirty: true, feats: new Map(), order: byDistance(c), all: false };
    store.set(c, k);
  }
  if (k.dirty) rebuild(c, k);
  return k;
}

export const cacheStats = { rebuilds: 0, lists: 0 };
function byDistance(c: Colony): Int32Array {
  const n = c.w * c.h;
  const d = new Float64Array(n);
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i % c.w) - c.cx;
    const y = Math.floor(i / c.w) - c.cy;
    d[i] = x * x + y * y;
    out[i] = i;
  }
  out.sort((a, b) => d[a] - d[b] || a - b);
  return out;
}

function rebuild(c: Colony, k: Cache): void {
  cacheStats.rebuilds++;
  const n = c.w * c.h;
  for (let i = 0; i < n; i++) k.walk[i] = tileCost(c, i);
  k.reach.fill(0);
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const start = c.cy * c.w + c.cx;
  k.reach[start] = 1;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const x = i % c.w;
    const y = (i - x) / c.w;
    if (x > 0 && !k.reach[i - 1] && k.walk[i - 1]) { k.reach[i - 1] = 1; q[tail++] = i - 1; }
    if (x < c.w - 1 && !k.reach[i + 1] && k.walk[i + 1]) { k.reach[i + 1] = 1; q[tail++] = i + 1; }
    if (y > 0 && !k.reach[i - c.w] && k.walk[i - c.w]) { k.reach[i - c.w] = 1; q[tail++] = i - c.w; }
    if (y < c.h - 1 && !k.reach[i + c.w] && k.walk[i + c.w]) { k.reach[i + c.w] = 1; q[tail++] = i + c.w; }
  }
  k.feats.clear();
  k.all = false;
  k.dirty = false;
}

function nearReach(c: Colony, k: Cache, i: number): boolean {
  if (k.reach[i]) return true;
  const x = i % c.w;
  const y = (i - x) / c.w;
  return (x > 0 && !!k.reach[i - 1]) || (x < c.w - 1 && !!k.reach[i + 1]) || (y > 0 && !!k.reach[i - c.w]) || (y < c.h - 1 && !!k.reach[i + c.w]);
}

/** Feature key for bare rock faces that can be quarried. */
export const ROCK_FACE = 100;
/** Feature key for the water's edge, to fish from. */
export const SHORE = 101;

/** Reachable tiles holding a feature, nearest the colony centre first. */
export function featList(c: Colony, f: number): number[] {
  const k = cacheOf(c);
  let out = k.feats.get(f);
  if (out) return out;
  if (!k.all) {
    allLists(c, k);
    out = k.feats.get(f);
    if (out) return out;
  }
  out = [];
  cacheStats.lists++;
  const order = k.order;
  const n = order.length;
  for (let o = 0; o < n; o++) {
    const i = order[o];
    if (f === ROCK_FACE) {
      if (c.ter[i] !== T.ROCK || c.feat[i] !== F.NONE || c.sb[i]) continue;
    } else if (f === SHORE) {
      if (c.ter[i] !== T.SHALLOW && c.ter[i] !== T.DEEP) continue;
    } else if (c.feat[i] !== f || c.sb[i]) continue;
    if (nearReach(c, k, i)) out.push(i);
  }
  k.feats.set(f, out);
  return out;
}

const FEAT_MAX = 16;

/** Every feature list at once, in one walk over the map (each list comes out as featList would make it). */
function allLists(c: Colony, k: Cache): void {
  cacheStats.lists++;
  const by: number[][] = [];
  for (let f = 0; f < FEAT_MAX; f++) by.push([]);
  const rock: number[] = [];
  const shore: number[] = [];
  const order = k.order;
  const n = order.length;
  for (let o = 0; o < n; o++) {
    const i = order[o];
    const f = c.feat[i];
    const t = c.ter[i];
    const free = !c.sb[i];
    const isRock = t === T.ROCK && f === F.NONE && free;
    const isShore = t === T.SHALLOW || t === T.DEEP;
    if (!isRock && !isShore && (f === F.NONE || !free)) continue;
    if (!nearReach(c, k, i)) continue;
    if (isRock) rock.push(i);
    if (isShore) shore.push(i);
    if (f !== F.NONE && free && f < FEAT_MAX) by[f].push(i);
  }
  for (let f = 1; f < FEAT_MAX; f++) if (!k.feats.has(f)) k.feats.set(f, by[f]);
  if (!k.feats.has(ROCK_FACE)) k.feats.set(ROCK_FACE, rock);
  if (!k.feats.has(SHORE)) k.feats.set(SHORE, shore);
  k.all = true;
}

/** Forget one feature list (after a bush is picked clean, say) without rebuilding the walk map. */
export function dropFeat(c: Colony, f: number): void {
  store.get(c)?.feats.delete(f);
}
