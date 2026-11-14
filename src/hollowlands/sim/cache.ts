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
}

const store = new WeakMap<object, Cache>();

export function touch(c: Colony): void {
  const k = store.get(c);
  if (k) k.dirty = true;
}

export function tileCost(c: Colony, i: number): number {
  const s = c.st[i];
  if (s === B.WALL_WOOD || s === B.WALL_STONE || s === B.FENCE || s === B.WELL || s === B.STATUE) return 0;
  const t = c.ter[i];
  if (t === T.DEEP || t === T.ROCK) return 0;
  const f = c.feat[i];
  if (f === F.BOULDER || f === F.ORE || f === F.RUIN) return 0;
  if (s === B.DOOR) return 9;
  if (s === B.FLOOR_WOOD || s === B.FLOOR_STONE) return 8;
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
    k = { walk: new Uint8Array(c.w * c.h), reach: new Uint8Array(c.w * c.h), dirty: true, feats: new Map() };
    store.set(c, k);
  }
  if (k.dirty) rebuild(c, k);
  return k;
}

function rebuild(c: Colony, k: Cache): void {
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
  out = [];
  const n = c.w * c.h;
  for (let i = 0; i < n; i++) {
    if (f === ROCK_FACE) {
      if (c.ter[i] !== T.ROCK || c.feat[i] !== F.NONE || c.sb[i]) continue;
    } else if (f === SHORE) {
      if (c.ter[i] !== T.SHALLOW && c.ter[i] !== T.DEEP) continue;
    } else if (c.feat[i] !== f || c.sb[i]) continue;
    if (nearReach(c, k, i)) out.push(i);
  }
  const d = (i: number): number => {
    const x = (i % c.w) - c.cx;
    const y = Math.floor(i / c.w) - c.cy;
    return x * x + y * y;
  };
  out.sort((a, b) => d(a) - d(b) || a - b);
  k.feats.set(f, out);
  return out;
}

/** Forget one feature list (after a bush is picked clean, say) without rebuilding the walk map. */
export function dropFeat(c: Colony, f: number): void {
  store.get(c)?.feats.delete(f);
}
