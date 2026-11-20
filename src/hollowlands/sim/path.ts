// A* over the colony map. Eight directions, no cutting corners.
// Colonists walk the colony's own map (its gates always open to them); raiders and beasts walk
// the foes' map, where shut gates and every stretch of the town wall are blocked (see foeMap).

import { WALK_SPEED } from '../config';
import { cacheOf, foeMap } from './cache';
import type { Colony } from './types';

let cap = 0;
let g = new Uint32Array(0);
let from = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let heap = new Int32Array(0);
let hf = new Uint32Array(0);
let epoch = 0;

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

export interface Path { path: number[]; cost: number }

/** Counters for the dev runner. */
export const pathStats = { calls: 0, fails: 0, nodes: 0, foe: 0, early: 0, failNodes: 0 };

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
// The estimate of the walk left, per straight step and per extra diagonal one. Open ground costs
// 100 a step and a street 70, so this is greedy: paths come out a little longer than the very
// shortest, but on the big map the search looks at a fraction of the tiles.
const HS = 180;
const HD = 72;

/**
 * Cheapest walk from (sx,sy) to (tx,ty). With adj, stopping on any tile next to the target
 * counts (for working on a tree, a rock, a bed someone is lying in). Null when there is no way.
 * With foe, the walk is a raider's: shut gates and walls bar the way.
 */
export function findPath(c: Colony, sx: number, sy: number, tx: number, ty: number, adj: boolean, foe = false): Path | null {
  const W = c.w;
  const H = c.h;
  ensure(W * H);
  const k = cacheOf(c);
  let walk = k.walk;
  const s = sy * W + sx;
  const target = ty * W + tx;
  if (adj ? Math.abs(sx - tx) <= 1 && Math.abs(sy - ty) <= 1 : s === target) return { path: [s], cost: 0 };
  pathStats.calls++;
  if (foe) pathStats.foe++;
  if (foe) {
    // a raider's map: a target on the far side of a wall is not worth searching for
    const fm = foeMap(c);
    walk = fm.walk;
    if (!adj && !walk[target]) { pathStats.fails++; pathStats.early++; return null; }
    const comp = fm.comp;
    const cs = comp[s];
    let ok = cs !== 0 && comp[target] === cs;
    if (!ok && adj && cs) {
      for (let d = 0; d < 8 && !ok; d++) {
        const nx = tx + DX[d];
        const ny = ty + DY[d];
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && comp[ny * W + nx] === cs) ok = true;
      }
    }
    if (!ok) { pathStats.fails++; pathStats.early++; return null; }
  } else {
    if (!adj && !walk[target]) { pathStats.fails++; pathStats.early++; return null; }
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
      if (!ok) { pathStats.fails++; pathStats.early++; return null; }
    }
  }
  const ep = ++epoch;
  // the open list is a binary heap kept in two arrays (tile, estimate), worked inline
  const hp = heap;
  const hv = hf;
  const gg = g;
  const fr = from;
  const sp = stamp;
  const cl = closed;
  let size = 0;
  gg[s] = 0;
  fr[s] = -1;
  sp[s] = ep;
  {
    const dx = Math.abs(sx - tx);
    const dy = Math.abs(sy - ty);
    hp[0] = s;
    hv[0] = dx > dy ? HS * dx + HD * dy : HS * dy + HD * dx;
    size = 1;
  }
  let seen = 0;
  const limit = hp.length - 8;
  const OFF = [1, -1, W, -W, W + 1, -W + 1, W - 1, -W - 1];
  while (size > 0) {
    // pop the best
    const i = hp[0];
    size--;
    if (size > 0) {
      const li = hp[size];
      const lf = hv[size];
      let q = 0;
      for (;;) {
        let ch = q * 2 + 1;
        if (ch >= size) break;
        if (ch + 1 < size && hv[ch + 1] < hv[ch]) ch++;
        if (hv[ch] >= lf) break;
        hp[q] = hp[ch];
        hv[q] = hv[ch];
        q = ch;
      }
      hp[q] = li;
      hv[q] = lf;
    }
    if (cl[i] === ep) continue;
    cl[i] = ep;
    const x = i % W;
    const y = (i - x) / W;
    const ax = x > tx ? x - tx : tx - x;
    const ay = y > ty ? y - ty : ty - y;
    if (adj ? ax <= 1 && ay <= 1 && walk[i] > 0 : i === target) {
      const path: number[] = [];
      for (let n = i; n >= 0; n = fr[n]) path.push(n);
      path.reverse();
      pathStats.nodes += seen;
      return { path, cost: gg[i] };
    }
    if (++seen > 6000 || size > limit) break;
    const gi = gg[i];
    // which neighbours lie on the map, and which straight steps are open (no cutting corners)
    const oR = x < W - 1 && walk[i + 1] > 0;
    const oL = x > 0 && walk[i - 1] > 0;
    const oD = y < H - 1 && walk[i + W] > 0;
    const oU = y > 0 && walk[i - W] > 0;
    for (let d = 0; d < 8; d++) {
      let ok: boolean;
      switch (d) {
        case 0: ok = oR; break;
        case 1: ok = oL; break;
        case 2: ok = oD; break;
        case 3: ok = oU; break;
        case 4: ok = oR && oD; break;
        case 5: ok = oR && oU; break;
        case 6: ok = oL && oD; break;
        default: ok = oL && oU; break;
      }
      if (!ok) continue;
      const j = i + OFF[d];
      const wj = walk[j];
      if (!wj || cl[j] === ep) continue;
      const ng = gi + wj * (d >= 4 ? 14 : 10);
      if (sp[j] === ep && gg[j] <= ng) continue;
      sp[j] = ep;
      gg[j] = ng;
      fr[j] = i;
      // a touch greedy: paths stay near-shortest but the search looks at far fewer tiles
      const nx = x + DX[d];
      const ny = y + DY[d];
      const dx = nx > tx ? nx - tx : tx - nx;
      const dy = ny > ty ? ny - ty : ty - ny;
      const f = ng + (dx > dy ? HS * dx + HD * dy : HS * dy + HD * dx);
      // push
      let q = size++;
      while (q > 0) {
        const pq = (q - 1) >> 1;
        if (hv[pq] <= f) break;
        hp[q] = hp[pq];
        hv[q] = hv[pq];
        q = pq;
      }
      hp[q] = j;
      hv[q] = f;
    }
  }
  pathStats.fails++;
  pathStats.nodes += seen;
  pathStats.failNodes += seen;
  return null;
}

/** Ticks to walk a path of the given cost. */
export function walkTicks(cost: number, moveMult: number): number {
  if (cost <= 0) return 0;
  return Math.max(1, Math.ceil(cost / (100 * WALK_SPEED * Math.max(0.3, moveMult))));
}
