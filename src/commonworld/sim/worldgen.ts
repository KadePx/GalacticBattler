// Builds a fresh world map: height, climate, biomes, rivers and resources.

import { neighbors } from './hex';
import { hash32, Rand, S } from './rng';
import { SIM_V, type River, type Tiles, type World } from './types';

export const B = {
  OCEAN: 0, SHALLOW: 1, LAKE: 2, TUNDRA: 3, SNOW: 4, TAIGA: 5, GRASS: 6, PLAINS: 7,
  FOREST: 8, JUNGLE: 9, SAVANNA: 10, DESERT: 11, MARSH: 12, HILLS: 13, MOUNTAIN: 14,
} as const;

export interface BiomeInfo { n: string; c: string; f: number; m: number; land: boolean }
export const BIOMES: BiomeInfo[] = [
  { n: 'Ocean', c: '#1c3553', f: 0, m: 0, land: false },
  { n: 'Shallows', c: '#2c5a80', f: 1, m: 0, land: false },
  { n: 'Lake', c: '#3a74a3', f: 2, m: 0, land: false },
  { n: 'Tundra', c: '#9ba595', f: 1, m: 1, land: true },
  { n: 'Snow', c: '#e6edf0', f: 0, m: 0, land: true },
  { n: 'Taiga', c: '#46705a', f: 1, m: 3, land: true },
  { n: 'Grassland', c: '#80ad4f', f: 3, m: 1, land: true },
  { n: 'Plains', c: '#b5b65f', f: 2, m: 2, land: true },
  { n: 'Forest', c: '#3f8546', f: 1, m: 3, land: true },
  { n: 'Jungle', c: '#2a7038', f: 2, m: 2, land: true },
  { n: 'Savanna', c: '#c4b15b', f: 2, m: 1, land: true },
  { n: 'Desert', c: '#dcc68a', f: 0, m: 1, land: true },
  { n: 'Marsh', c: '#5e8a72', f: 1, m: 1, land: true },
  { n: 'Hills', c: '#9b8b5d', f: 1, m: 3, land: true },
  { n: 'Mountain', c: '#7c7470', f: 0, m: 2, land: true },
];

export const R = {
  NONE: 0, FERTILE: 1, FISH: 2, GAME: 3, STONE: 4, COPPER: 5, IRON: 6, GOLD: 7, HORSES: 8, SPICES: 9,
} as const;
export const RES_NAMES = ['', 'fertile soil', 'fish', 'game', 'stone', 'copper', 'iron', 'gold', 'horses', 'spices'];
export const RES_FOOD = [0, 1, 2, 1, 0, 0, 0, 0, 0, 0];
export const RES_MAT = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0];

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const v00 = hash32(seed, ix, iy) / 4294967296;
  const v10 = hash32(seed, ix + 1, iy) / 4294967296;
  const v01 = hash32(seed, ix, iy + 1) / 4294967296;
  const v11 = hash32(seed, ix + 1, iy + 1) / 4294967296;
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

function fbm(seed: number, x: number, y: number, oct: number): number {
  let s = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(seed + o * 1013, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

export function isLand(t: Tiles, i: number): boolean {
  return BIOMES[t.biome[i]].land;
}

export function makeTiles(n: number): Tiles {
  return {
    h: new Int16Array(n),
    temp: new Int8Array(n),
    moist: new Uint8Array(n),
    biome: new Uint8Array(n),
    river: new Uint16Array(n),
    flow: new Uint16Array(n),
    down: new Int32Array(n).fill(-1),
    res: new Uint8Array(n),
    owner: new Int16Array(n).fill(-1),
    work: new Int32Array(n).fill(-1),
    city: new Int32Array(n).fill(-1),
  };
}

export function generateWorld(seed: number, W = 128, H = 96): World {
  const n = W * H;
  const t = makeTiles(n);
  const sH = hash32(seed, S.GEN, 1);
  const sM = hash32(seed, S.GEN, 2);
  const sT = hash32(seed, S.GEN, 3);
  const sC = hash32(seed, S.GEN, 6);
  const raw = new Float64Array(n);

  // Height: fractal noise, pushed down toward the map edges so land sits in the middle.
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    const px = x + 0.5 * (y & 1);
    const py = y * 0.866;
    // Broad "continent" noise lets seas cut the land into several masses.
    const e = fbm(sH, px / 22, py / 22, 5) * 0.55 + fbm(sC, px / 40, py / 40, 2) * 0.75;
    const dx = (x / W - 0.5) * 2;
    const dy = (y / H - 0.5) * 2;
    const d2 = dx * dx * 0.9 + dy * dy;
    raw[i] = e - 0.3 * d2;
  }
  // Sea level so that ~40% of the map is land.
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const sea = sorted[Math.floor(n * 0.6)];
  const top = sorted[n - 1];
  for (let i = 0; i < n; i++) t.h[i] = Math.round(((raw[i] - sea) / (top - sea)) * 1000);

  // Hills and mountains: the highest slices of land.
  const landH = Array.from(t.h).filter((h) => h > 0).sort((a, b) => a - b);
  const mountainH = landH[Math.floor(landH.length * 0.94)] ?? 9999;
  const hillH = landH[Math.floor(landH.length * 0.8)] ?? 9999;

  // Distance to the sea (for moisture).
  const coastD = new Int16Array(n).fill(99);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (t.h[i] <= 0) { coastD[i] = 0; q.push(i); }
  const nb: number[] = [];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    for (const j of neighbors(W, H, c, nb)) {
      if (coastD[j] > coastD[c] + 1) { coastD[j] = coastD[c] + 1; q.push(j); }
    }
  }

  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    const lat = Math.abs(y - H / 2) / (H / 2);
    const elev = t.h[i] > 0 ? t.h[i] / 1000 : 0;
    const temp = 31 - lat * 46 - elev * 18 + (fbm(sT, x / 14, y / 14, 3) - 0.5) * 10;
    t.temp[i] = Math.max(-40, Math.min(45, Math.round(temp)));
    const m = fbm(sM, x / 18, y / 18, 4) * 100 + Math.max(0, 8 - coastD[i]) * 4 - 12;
    t.moist[i] = Math.max(0, Math.min(100, Math.round(m)));
  }

  for (let i = 0; i < n; i++) {
    if (t.h[i] <= 0) { t.biome[i] = B.OCEAN; continue; }
    const tc = t.temp[i];
    const m = t.moist[i];
    let b: number;
    if (tc < -8) b = B.SNOW;
    else if (tc < 0) b = B.TUNDRA;
    else if (tc < 6) b = m > 40 ? B.TAIGA : B.TUNDRA;
    else if (tc < 21) b = m < 18 ? B.DESERT : m < 38 ? B.PLAINS : m < 62 ? B.GRASS : m < 86 ? B.FOREST : B.MARSH;
    else b = m < 24 ? B.DESERT : m < 44 ? B.SAVANNA : m < 64 ? B.GRASS : m < 88 ? B.JUNGLE : B.MARSH;
    if (t.h[i] >= mountainH) b = B.MOUNTAIN;
    else if (t.h[i] >= hillH && b !== B.SNOW) b = B.HILLS;
    t.biome[i] = b;
  }

  // Rivers: start high and wet, run downhill to the sea. A pit becomes a lake.
  const rivers: River[] = [];
  const rr = new Rand(seed, S.GEN, 4);
  const cands: number[] = [];
  for (let i = 0; i < n; i++) {
    if (t.h[i] > hillH * 0.8 && t.moist[i] >= 35 && t.biome[i] !== B.SNOW) cands.push(i);
  }
  const srcs = rr.shuffle(cands);
  const want = Math.floor(n / 280);
  const used: number[] = [];
  for (const src of srcs) {
    if (rivers.length >= want) break;
    if (t.river[src]) continue;
    let near = false;
    for (const u of used) {
      const ux = u % W, uy = (u - ux) / W, sx = src % W, sy = (src - sx) / W;
      if (Math.abs(ux - sx) + Math.abs(uy - sy) < 6) { near = true; break; }
    }
    if (near) continue;
    const path: number[] = [];
    let cur = src;
    let end = -1; // tile the river drains into
    let merged = false;
    for (let step = 0; step < 200; step++) {
      path.push(cur);
      let best = -1;
      let bh = t.h[cur];
      for (const j of neighbors(W, H, cur, nb)) {
        const hj = isLand(t, j) ? t.h[j] : -1;
        if (hj < bh) { bh = hj; best = j; }
      }
      if (best === -1) break; // pit
      if (!isLand(t, best)) { end = best; break; }
      if (t.river[best] || path.includes(best)) { end = best; merged = t.river[best] > 0; break; }
      cur = best;
    }
    if (path.length < 4) continue;
    const id = rivers.length + 1;
    for (let k = 0; k < path.length; k++) {
      const i = path[k];
      t.river[i] = id;
      t.flow[i] += 1;
      t.down[i] = k + 1 < path.length ? path[k + 1] : end;
    }
    if (end === -1) {
      // Ends in a pit: the last tile becomes a lake.
      const last = path[path.length - 1];
      t.biome[last] = B.LAKE;
      t.river[last] = 0;
      t.down[path[path.length - 2]] = last;
    }
    if (merged) {
      // Swell the river it joins, all the way to the sea.
      let j = end;
      for (let g = 0; g < 400 && j >= 0 && t.river[j]; g++) { t.flow[j] += 1; j = t.down[j]; }
    }
    used.push(src);
    rivers.push({ id, src, mouth: end, len: path.length, name: null, namedBy: -1 });
  }

  // Shallows: ocean next to land.
  for (let i = 0; i < n; i++) {
    if (t.biome[i] !== B.OCEAN) continue;
    for (const j of neighbors(W, H, i, nb)) if (isLand(t, j)) { t.biome[i] = B.SHALLOW; break; }
  }

  // Resources.
  const rs = new Rand(seed, S.GEN, 5);
  for (let i = 0; i < n; i++) {
    const b = t.biome[i];
    const p = rs.float();
    let r: number = R.NONE;
    if (b === B.GRASS || b === B.PLAINS) r = p < 0.07 ? R.FERTILE : p < 0.11 ? R.HORSES : R.NONE;
    else if (b === B.HILLS) r = p < 0.1 ? R.STONE : p < 0.15 ? R.COPPER : p < 0.19 ? R.IRON : p < 0.21 ? R.GOLD : R.NONE;
    else if (b === B.MOUNTAIN) r = p < 0.1 ? R.STONE : p < 0.16 ? R.IRON : p < 0.2 ? R.GOLD : R.NONE;
    else if (b === B.FOREST || b === B.TAIGA) r = p < 0.09 ? R.GAME : R.NONE;
    else if (b === B.JUNGLE) r = p < 0.06 ? R.SPICES : p < 0.1 ? R.GAME : R.NONE;
    else if (b === B.SHALLOW) r = p < 0.09 ? R.FISH : R.NONE;
    else if (b === B.SAVANNA) r = p < 0.06 ? R.GAME : p < 0.09 ? R.HORSES : R.NONE;
    t.res[i] = r;
  }

  return { v: SIM_V, seed, tick: 0, W, H, t, rivers, civs: [], setts: [], spells: [], plagues: [], rels: [], wars: [], routes: [], age: 0, log: [], logBase: 0 };
}
