// Daily maze: the same date always gives the same maze, so everyone races one track a day.
// Pure code (no DOM, no three.js): the API imports it too, to check submitted runs.

export const CS = 12; // cell size in metres
export const T = 0.45; // half the wall thickness
export const WALL_H = 2.6;
export const RAMP_H = 1.0;
export const N = 1, E = 2, S = 4, W = 8;
export const DIRS = [N, E, S, W];
export const DI = [0, 1, 0, -1];
export const DJ = [-1, 0, 1, 0];
const OPP = [S, W, N, E];

/** A ramp or boost pad in a cell; axis 0 runs along x, axis 1 along z. */
export interface Feature { c: number; axis: 0 | 1 }
export interface CrateSpot { x: number; z: number; s: number }

export interface Maze {
  day: string;
  num: number;
  w: number;
  h: number;
  /** Per cell: which of its four sides (N E S W bits) have a wall. */
  walls: Uint8Array;
  start: number;
  finish: number;
  /** Heading that faces out of the start cell. */
  startH: number;
  /** Steps from each cell to the finish. */
  dist: Int16Array;
  ramps: Feature[];
  boosts: Feature[];
  crates: CrateSpot[];
  /** Per cell: -1, or the axis of the ramp / boost pad in it. */
  rampAt: Int8Array;
  boostAt: Int8Array;
}

export function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const EPOCH = Date.UTC(2026, 10, 7);
/** Maze #1 is launch day. */
export const mazeNum = (day: string) => Math.round((Date.parse(day + 'T00:00:00Z') - EPOCH) / 864e5) + 1;
export const shiftDay = (day: string, by: number) => dayKey(Date.parse(day + 'T00:00:00Z') + by * 864e5);

export const isOpen = (m: Maze, c: number, d: number) => !(m.walls[c] & DIRS[d]);
export const cellAt = (m: Maze, x: number, z: number) => {
  const i = Math.floor(x / CS), j = Math.floor(z / CS);
  return i < 0 || j < 0 || i >= m.w || j >= m.h ? -1 : j * m.w + i;
};
export const cellCenter = (m: Maze, c: number): [number, number] => [((c % m.w) + 0.5) * CS, (Math.floor(c / m.w) + 0.5) * CS];
/** Heading whose forward vector (sin h, cos h) points in grid direction d. */
export const dirHeading = (d: number) => Math.atan2(DI[d], DJ[d]);

function neighbour(w: number, h: number, c: number, d: number) {
  const i = (c % w) + DI[d], j = Math.floor(c / w) + DJ[d];
  return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i;
}

function bfs(walls: Uint8Array, w: number, h: number, src: number) {
  const dist = new Int16Array(w * h).fill(-1);
  const q = [src];
  dist[src] = 0;
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    for (let d = 0; d < 4; d++) {
      if (walls[c] & DIRS[d]) continue;
      const n = neighbour(w, h, c, d);
      if (n >= 0 && dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}

const bits = (v: number) => (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);

export function genMaze(day: string): Maze {
  const r = rng(hash('motomaze/' + day));
  const w = 10 + Math.floor(r() * 3), h = 10 + Math.floor(r() * 3), n = w * h;
  const walls = new Uint8Array(n).fill(15);
  const carveFrom = [0, w - 1, (h - 1) * w, n - 1][Math.floor(r() * 4)];

  // A perfect maze by depth-first carving...
  const seen = new Uint8Array(n);
  const stack = [carveFrom];
  seen[carveFrom] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nb = neighbour(w, h, c, d);
      if (nb >= 0 && !seen[nb]) opts.push(d);
    }
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(r() * opts.length)];
    const nb = neighbour(w, h, c, d);
    walls[c] &= ~DIRS[d];
    walls[nb] &= ~OPP[d];
    seen[nb] = 1;
    stack.push(nb);
  }
  // ...then knock out some dead ends and a few extra walls, so there are several routes to pick from.
  const open = (c: number, d: number) => {
    const nb = neighbour(w, h, c, d);
    if (nb < 0) return;
    walls[c] &= ~DIRS[d];
    walls[nb] &= ~OPP[d];
  };
  for (let c = 0; c < n; c++) {
    if (bits(walls[c]) !== 3 || r() > 0.4) continue;
    const opts = [0, 1, 2, 3].filter((d) => walls[c] & DIRS[d] && neighbour(w, h, c, d) >= 0);
    if (opts.length) open(c, opts[Math.floor(r() * opts.length)]);
  }
  for (let k = Math.floor(n * 0.04); k > 0; k--) open(Math.floor(r() * n), Math.floor(r() * 4));

  // Start in whichever corner has the longest way to its farthest cell, and finish there.
  let start = carveFrom, finish = carveFrom, longest = -1;
  for (const corner of [0, w - 1, (h - 1) * w, n - 1]) {
    const fromStart = bfs(walls, w, h, corner);
    let far = corner;
    for (let c = 0; c < n; c++) if (fromStart[c] > fromStart[far]) far = c;
    if (fromStart[far] > longest) { longest = fromStart[far]; start = corner; finish = far; }
  }
  const dist = bfs(walls, w, h, finish);

  const m: Maze = {
    day, num: mazeNum(day), w, h, walls, start, finish, startH: 0, dist,
    ramps: [], boosts: [], crates: [], rampAt: new Int8Array(n).fill(-1), boostAt: new Int8Array(n).fill(-1),
  };
  let bestD = 0;
  for (let d = 0; d < 4; d++) if (isOpen(m, start, d)) { bestD = d; break; }
  m.startH = dirHeading(bestD);

  // Ramps sit in the middle of a straight run of 5 cells, so the landing is clear either way.
  const ci = (c: number) => c % w, cj = (c: number) => Math.floor(c / w);
  const nearKey = (c: number) => c === start || c === finish || neighbour(w, h, start, bestD) === c;
  const straight = (c: number, axis: 0 | 1, reach: number) => {
    const d = axis === 0 ? 1 : 2; // E or S
    const side = axis === 0 ? N | S : E | W;
    if ((walls[c] & side) !== side) return false;
    let a = c;
    for (let k = 0; k < reach; k++) { const p = neighbour(w, h, a, (d + 2) % 4); if (p < 0 || walls[p] & DIRS[d]) return false; a = p; }
    a = c;
    for (let k = 0; k < reach; k++) { if (walls[a] & DIRS[d]) return false; a = neighbour(w, h, a, d); if (a < 0) return false; }
    return true;
  };
  const far = (c: number, list: Feature[], gap: number) =>
    list.every((f) => Math.max(Math.abs(ci(f.c) - ci(c)), Math.abs(cj(f.c) - cj(c))) >= gap);
  const order = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
  const maxRamps = 3 + Math.floor(n / 30);
  for (const c of order) {
    if (m.ramps.length >= maxRamps) break;
    if (nearKey(c)) continue;
    for (const axis of [0, 1] as const) {
      if (straight(c, axis, 2) && far(c, m.ramps, 3)) { m.ramps.push({ c, axis }); m.rampAt[c] = axis; break; }
    }
  }
  for (const c of order) {
    if (m.boosts.length >= 8) break;
    if (nearKey(c) || m.rampAt[c] >= 0) continue;
    for (const axis of [0, 1] as const) {
      if (straight(c, axis, 1) && far(c, m.ramps, 2) && far(c, m.boosts, 3)) { m.boosts.push({ c, axis }); m.boostAt[c] = axis; break; }
    }
  }
  // Crate piles to smash through.
  let piles = 0;
  for (const c of order) {
    if (piles >= 10) break;
    if (nearKey(c) || m.rampAt[c] >= 0 || m.boostAt[c] >= 0 || r() < 0.5) continue;
    piles++;
    const [cx, cz] = cellCenter(m, c);
    for (let k = 3 + Math.floor(r() * 4); k > 0; k--) {
      m.crates.push({ x: cx + (r() - 0.5) * 6, z: cz + (r() - 0.5) * 6, s: 0.8 + r() * 0.5 });
    }
  }
  return m;
}

/** Ground height: flat, except for the humps on ramp cells. */
export function heightAt(m: Maze, x: number, z: number): number {
  const c = cellAt(m, x, z);
  if (c < 0) return 0;
  const a = m.rampAt[c];
  if (a < 0) return 0;
  const [cx, cz] = cellCenter(m, c);
  const u = Math.abs(a === 0 ? x - cx : z - cz);
  if (u <= 1.5) return RAMP_H;
  if (u < 5) return (RAMP_H * (5 - u)) / 3.5;
  return 0;
}

/** The wall on side d of cell (i, j), as a box [minX, minZ, maxX, maxZ]. Boxes overlap at the corners. */
export function wallBox(i: number, j: number, d: number): [number, number, number, number] {
  switch (d) {
    case 0: return [i * CS - T, j * CS - T, (i + 1) * CS + T, j * CS + T];
    case 2: return [i * CS - T, (j + 1) * CS - T, (i + 1) * CS + T, (j + 1) * CS + T];
    case 3: return [i * CS - T, j * CS - T, i * CS + T, (j + 1) * CS + T];
    default: return [(i + 1) * CS - T, j * CS - T, (i + 1) * CS + T, (j + 1) * CS + T];
  }
}

export interface Body { x: number; z: number; vx: number; vz: number }

/**
 * Push a circle out of nearby walls and bounce its velocity off them.
 * Returns the hardest impact speed (into the wall), or 0.
 */
export function collide(m: Maze, b: Body, rad: number, bounce = 0.2): number {
  const i0 = Math.floor(b.x / CS), j0 = Math.floor(b.z / CS);
  let impact = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
      const wl = m.walls[j * m.w + i];
      for (let d = 0; d < 4; d++) {
        if (!(wl & DIRS[d])) continue;
        const [x0, z0, x1, z1] = wallBox(i, j, d);
        const px = Math.max(x0, Math.min(x1, b.x)), pz = Math.max(z0, Math.min(z1, b.z));
        let dx = b.x - px, dz = b.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        let nx: number, nz: number, pen: number;
        if (d2 > 1e-10) {
          const dd = Math.sqrt(d2);
          nx = dx / dd; nz = dz / dd; pen = rad - dd;
        } else {
          // Centre inside the box: leave by the nearest face.
          const l = b.x - x0, rr = x1 - b.x, t = b.z - z0, bt = z1 - b.z;
          const mn = Math.min(l, rr, t, bt);
          if (mn === l) { nx = -1; nz = 0; } else if (mn === rr) { nx = 1; nz = 0; } else if (mn === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          pen = mn + rad;
          dx = nx; dz = nz;
        }
        b.x += nx * pen;
        b.z += nz * pen;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          b.vx -= (1 + bounce) * vn * nx;
          b.vz -= (1 + bounce) * vn * nz;
        }
      }
    }
  }
  return impact;
}
