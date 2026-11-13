// A* over the colony map. Eight directions, no cutting corners.

import { WALK_SPEED } from '../config';
import { cacheOf } from './cache';
import type { Colony } from './types';

let cap = 0;
let g = new Uint32Array(0);
let from = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let heap = new Int32Array(0);
let hf = new Uint32Array(0);
let epoch = 0;
let size = 0;

function ensure(n: number): void {
  if (cap >= n) return;
  cap = n;
  g = new Uint32Array(n);
  from = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  heap = new Int32Array(n * 8);
  hf = new Uint32Array(n * 8);
}

function push(i: number, f: number): void {
  let k = size++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (hf[p] <= f) break;
    heap[k] = heap[p];
    hf[k] = hf[p];
    k = p;
  }
  heap[k] = i;
  hf[k] = f;
}

function pop(): number {
  const top = heap[0];
  size--;
  if (size > 0) {
    const i = heap[size];
    const f = hf[size];
    let k = 0;
    for (;;) {
      let ch = k * 2 + 1;
      if (ch >= size) break;
      if (ch + 1 < size && hf[ch + 1] < hf[ch]) ch++;
      if (hf[ch] >= f) break;
      heap[k] = heap[ch];
      hf[k] = hf[ch];
      k = ch;
    }
    heap[k] = i;
    hf[k] = f;
  }
  return top;
}

export interface Path { path: number[]; cost: number }

/** Counters for the dev runner. */
export const pathStats = { calls: 0, fails: 0, nodes: 0 };

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Cheapest walk from (sx,sy) to (tx,ty). With adj, stopping on any tile next to the target
 * counts (for working on a tree, a rock, a bed someone is lying in). Null when there is no way.
 */
export function findPath(c: Colony, sx: number, sy: number, tx: number, ty: number, adj: boolean): Path | null {
  const W = c.w;
  const H = c.h;
  ensure(W * H);
  const k = cacheOf(c);
  const walk = k.walk;
  const s = sy * W + sx;
  const target = ty * W + tx;
  if (adj ? Math.abs(sx - tx) <= 1 && Math.abs(sy - ty) <= 1 : s === target) return { path: [s], cost: 0 };
  pathStats.calls++;
  if (!adj && !walk[target]) { pathStats.fails++; return null; }
  // From open ground, a target in a pocket nobody can reach is not worth searching for
  if (k.reach[s]) {
    let ok = !!k.reach[target];
    if (!ok && adj) {
      for (let d = 0; d < 8 && !ok; d++) {
        const nx = tx + DX[d];
        const ny = ty + DY[d];
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && k.reach[ny * W + nx]) ok = true;
      }
    }
    if (!ok) { pathStats.fails++; return null; }
  }
  epoch++;
  size = 0;
  g[s] = 0;
  from[s] = -1;
  stamp[s] = epoch;
  {
    const dx = Math.abs(sx - tx);
    const dy = Math.abs(sy - ty);
    push(s, dx > dy ? 96 * dx + 38 * dy : 96 * dy + 38 * dx);
  }
  let seen = 0;
  const limit = heap.length - 8;
  while (size > 0) {
    const i = pop();
    if (closed[i] === epoch) continue;
    closed[i] = epoch;
    const x = i % W;
    const y = (i - x) / W;
    const ax = x > tx ? x - tx : tx - x;
    const ay = y > ty ? y - ty : ty - y;
    if (adj ? ax <= 1 && ay <= 1 && walk[i] > 0 : i === target) {
      const path: number[] = [];
      for (let n = i; n >= 0; n = from[n]) path.push(n);
      path.reverse();
      pathStats.nodes += seen;
      return { path, cost: g[i] };
    }
    if (++seen > 6000 || size > limit) break;
    const gi = g[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const w = walk[j];
      if (!w || closed[j] === epoch) continue;
      if (d >= 4 && (!walk[y * W + nx] || !walk[ny * W + x])) continue;
      const ng = gi + w * (d >= 4 ? 14 : 10);
      if (stamp[j] === epoch && g[j] <= ng) continue;
      stamp[j] = epoch;
      g[j] = ng;
      from[j] = i;
      // a touch greedy: paths stay near-shortest but the search looks at far fewer tiles
      const dx = nx > tx ? nx - tx : tx - nx;
      const dy = ny > ty ? ny - ty : ty - ny;
      push(j, ng + (dx > dy ? 96 * dx + 38 * dy : 96 * dy + 38 * dx));
    }
  }
  pathStats.fails++;
  pathStats.nodes += seen;
  return null;
}

/** Ticks to walk a path of the given cost. */
export function walkTicks(cost: number, moveMult: number): number {
  if (cost <= 0) return 0;
  return Math.max(1, Math.ceil(cost / (100 * WALK_SPEED * Math.max(0.3, moveMult))));
}
