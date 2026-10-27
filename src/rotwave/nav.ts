import { ColliderGrid, HALF } from './map';
import { Collider } from './models';

// Navigation on a 1x1 grid covering the map.
//  - Player units use A* over scenery AND player buildings, with a clearance
//    map so wide vehicles don't try to squeeze through gaps meant for infantry.
//  - Zombies use a flow field toward the HQ that ignores player buildings, so
//    they walk into barricades and tear through them.

export const N = HALF * 2 + 4;
const OFF = N / 2;
const SQRT2 = Math.SQRT2;

export interface Pt {
  x: number;
  z: number;
}

/** Tiny binary heap of cell indices keyed by an external score array. */
class Heap {
  items: number[] = [];
  constructor(private key: Float32Array) {}
  push(i: number) {
    const h = this.items;
    h.push(i);
    let k = h.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.key[h[p]] <= this.key[h[k]]) break;
      [h[p], h[k]] = [h[k], h[p]];
      k = p;
    }
  }
  pop() {
    const h = this.items;
    const top = h[0];
    const end = h.pop()!;
    if (h.length) {
      h[0] = end;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < h.length && this.key[h[l]] < this.key[h[m]]) m = l;
        if (r < h.length && this.key[h[r]] < this.key[h[m]]) m = r;
        if (m === k) break;
        [h[m], h[k]] = [h[k], h[m]];
        k = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
  }
}

const cellOf = (x: number, z: number) => {
  const i = Math.floor(x + OFF), j = Math.floor(z + OFF);
  if (i < 0 || j < 0 || i >= N || j >= N) return -1;
  return i * N + j;
};
const cx = (c: number) => Math.floor(c / N) - OFF + 0.5;
const cz = (c: number) => (c % N) - OFF + 0.5;

export class Nav {
  /** 1 where scenery blocks the cell centre. */
  stat = new Uint8Array(N * N);
  /** 1 where a player building blocks the cell centre. */
  dyn = new Uint8Array(N * N);
  /** distance (cells) from each cell to the nearest blocked cell */
  clear = new Float32Array(N * N);
  /** zombie flow field: walking distance to the HQ around scenery */
  flow = new Float32Array(N * N);

  private g = new Float32Array(N * N);
  private f = new Float32Array(N * N);
  private from = new Int32Array(N * N);
  private stamp = new Uint32Array(N * N);
  private closed = new Uint32Array(N * N);
  private run = 0;
  private heap = new Heap(this.f);

  constructor(statics: ColliderGrid) {
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = i - OFF + 0.5, z = j - OFF + 0.5;
        const edge = Math.abs(x) > HALF - 0.5 || Math.abs(z) > HALF - 0.5;
        if (edge || !statics.free(x, z, 0.25)) this.stat[i * N + j] = 1;
      }
    this.buildFlow(statics);
    this.buildClearance();
  }

  private buildFlow(statics: ColliderGrid) {
    // zombies need a bit more room than a cell centre test gives them
    const blocked = new Uint8Array(N * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) if (!statics.free(i - OFF + 0.5, j - OFF + 0.5, 0.45)) blocked[i * N + j] = 1;
    const field = this.flow;
    field.fill(Infinity);
    const heap = new Heap(field);
    const done = new Uint8Array(N * N);
    const start = cellOf(0, 0);
    field[start] = 0;
    heap.push(start);
    while (heap.size) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      const ci = Math.floor(c / N), cj = c % N;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = ni * N + nj;
          if (blocked[n]) continue;
          if (di && dj && (blocked[ci * N + nj] || blocked[ni * N + cj])) continue;
          const d = field[c] + (di && dj ? SQRT2 : 1);
          if (d < field[n]) {
            field[n] = d;
            heap.push(n);
          }
        }
    }
  }

  /** Recompute building blockers after something is built or destroyed. */
  setBuildings(colliders: Collider[]) {
    this.dyn.fill(0);
    for (const c of colliders) {
      const rr = c.r + 0.25;
      for (let i = Math.floor(c.x - rr + OFF); i <= Math.floor(c.x + rr + OFF); i++)
        for (let j = Math.floor(c.z - rr + OFF); j <= Math.floor(c.z + rr + OFF); j++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const x = i - OFF + 0.5, z = j - OFF + 0.5;
          if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) this.dyn[i * N + j] = 1;
        }
    }
    this.buildClearance();
  }

  /** Two-pass chamfer distance transform from blocked cells. */
  private buildClearance() {
    const d = this.clear;
    for (let k = 0; k < N * N; k++) d[k] = this.stat[k] || this.dyn[k] ? 0 : 1e6;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const k = i * N + j;
        if (!d[k]) continue;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - N] + 1);
        if (j > 0) v = Math.min(v, d[k - 1] + 1);
        if (i > 0 && j > 0) v = Math.min(v, d[k - N - 1] + SQRT2);
        if (i > 0 && j < N - 1) v = Math.min(v, d[k - N + 1] + SQRT2);
        d[k] = v;
      }
    for (let i = N - 1; i >= 0; i--)
      for (let j = N - 1; j >= 0; j--) {
        const k = i * N + j;
        if (!d[k]) continue;
        let v = d[k];
        if (i < N - 1) v = Math.min(v, d[k + N] + 1);
        if (j < N - 1) v = Math.min(v, d[k + 1] + 1);
        if (i < N - 1 && j < N - 1) v = Math.min(v, d[k + N + 1] + SQRT2);
        if (i < N - 1 && j > 0) v = Math.min(v, d[k + N - 1] + SQRT2);
        d[k] = v;
      }
  }

  private ok(c: number, need: number) {
    return c >= 0 && this.clear[c] >= need;
  }

  /** How much clearance a mover of radius r needs, in cells. */
  static need(r: number) {
    return r + 0.55;
  }

  /** Nearest cell a mover of radius r can stand in, searching outward. */
  nearestOpen(x: number, z: number, r: number): number {
    const need = Nav.need(r);
    const c0 = cellOf(Math.max(-HALF + 1, Math.min(HALF - 1, x)), Math.max(-HALF + 1, Math.min(HALF - 1, z)));
    if (this.ok(c0, need)) return c0;
    const i0 = Math.floor(c0 / N), j0 = c0 % N;
    for (let ring = 1; ring < 10; ring++) {
      let best = -1, bd = Infinity;
      for (let di = -ring; di <= ring; di++)
        for (let dj = -ring; dj <= ring; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const c = i * N + j;
          if (!this.ok(c, need)) continue;
          const d = (cx(c) - x) ** 2 + (cz(c) - z) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Can a mover of radius r walk the straight segment a->b? */
  lineClear(ax: number, az: number, bx: number, bz: number, r: number) {
    const need = Nav.need(r);
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(len / 0.35);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.ok(cellOf(ax + (bx - ax) * t, az + (bz - az) * t), need)) return false;
    }
    return true;
  }

  /**
   * A* path for a mover of radius r. Returns smoothed waypoints ending at the
   * goal (or the nearest open spot to it), or null if there's no way there.
   */
  path(sx: number, sz: number, tx: number, tz: number, r: number): Pt[] | null {
    const need = Nav.need(r);
    let start = cellOf(sx, sz);
    if (!this.ok(start, need)) start = this.nearestOpen(sx, sz, r);
    let goal = cellOf(tx, tz);
    let exact = true;
    if (!this.ok(goal, need)) {
      goal = this.nearestOpen(tx, tz, r);
      exact = false;
    }
    if (start < 0 || goal < 0) return null;
    const end: Pt = exact ? { x: tx, z: tz } : { x: cx(goal), z: cz(goal) };
    if (this.lineClear(sx, sz, end.x, end.z, r)) return [end];

    const run = ++this.run;
    const { g, f, from, stamp, closed, heap } = this;
    heap.clear();
    const gi = Math.floor(goal / N), gj = goal % N;
    const h = (c: number) => {
      const di = Math.abs(Math.floor(c / N) - gi), dj = Math.abs((c % N) - gj);
      return Math.max(di, dj) + (SQRT2 - 1) * Math.min(di, dj);
    };
    stamp[start] = run;
    g[start] = 0;
    f[start] = h(start);
    from[start] = -1;
    heap.push(start);
    let found = false;
    let expanded = 0;
    while (heap.size && expanded < 30000) {
      const c = heap.pop();
      if (closed[c] === run) continue;
      closed[c] = run;
      expanded++;
      if (c === goal) {
        found = true;
        break;
      }
      const ci = Math.floor(c / N), cj = c % N;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = ni * N + nj;
          if (closed[n] === run || !this.ok(n, need)) continue;
          if (di && dj && (!this.ok(ci * N + nj, need) || !this.ok(ni * N + cj, need))) continue;
          const ng = g[c] + (di && dj ? SQRT2 : 1);
          if (stamp[n] !== run || ng < g[n]) {
            stamp[n] = run;
            g[n] = ng;
            f[n] = ng + h(n);
            from[n] = c;
            heap.push(n);
          }
        }
    }
    if (!found) return null;
    // walk back, then string-pull to drop unnecessary corners
    const cells: Pt[] = [];
    for (let c = goal; c >= 0; c = from[c]) cells.push({ x: cx(c), z: cz(c) });
    cells.reverse();
    cells[cells.length - 1] = end;
    const out: Pt[] = [];
    let ax = sx, az = sz;
    let k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let m = cells.length - 1; m > k + 1; m--) {
        if (this.lineClear(ax, az, cells[m].x, cells[m].z, r)) {
          far = m;
          break;
        }
      }
      out.push(cells[far]);
      ax = cells[far].x;
      az = cells[far].z;
      k = far;
    }
    if (!out.length) out.push(end);
    return out;
  }

  flowAt(x: number, z: number) {
    const c = cellOf(x, z);
    return c < 0 ? Infinity : this.flow[c];
  }

  private flowOut = { x: 0, z: 0 };
  /** Downhill direction on the zombie flow field, or null. */
  flowDir(x: number, z: number) {
    const c = cellOf(x, z);
    if (c < 0 || !isFinite(this.flow[c])) return null;
    const i = Math.floor(c / N), j = c % N;
    let best = this.flow[c];
    let bc = c;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = ni * N + nj;
        if (this.flow[n] < best) {
          best = this.flow[n];
          bc = n;
        }
      }
    if (bc === c) return null;
    const dx = cx(bc) - x, dz = cz(bc) - z;
    const d = Math.hypot(dx, dz) || 1;
    this.flowOut.x = dx / d;
    this.flowOut.z = dz / d;
    return this.flowOut;
  }
}
