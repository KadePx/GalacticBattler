// Makes the land a colony sits on: open ground in the middle with a gentle rise beside it, a
// river (sometimes two) crossing the land with fords, hills and rocky outcrops with ore, lakes,
// woods with clearings, a coast on coast maps, and a road in from the edge of the world.

import { Rand, S, hash32 } from './rng';
import { KEEP_R } from './town';
import { F, T, type Colony } from './types';

export const BIOMES = ['valley', 'hills', 'marsh', 'coast', 'forest', 'highland'] as const;

/** How each kind of land is put together. */
interface Prof {
  /** height of the mountains in the far corner */
  mount: number;
  /** chance of a second river */
  river2: number;
  lakes: [number, number];
  outcrops: [number, number];
  rises: [number, number];
  /** forest noise above this grows trees (lower: more woods) */
  forest: number;
  /** extra wetness */
  wet: number;
  /** share of conifers in the woods */
  pine: number;
  /** heights where the ground turns to stone, then to bare rock */
  stone: number;
  rock: number;
  /** river width */
  wide: number;
}

const PROF: Record<string, Prof> = {
  valley: { mount: 0.4, river2: 0.35, lakes: [1, 2], outcrops: [3, 4], rises: [3, 5], forest: 0.43, wet: 0, pine: 0.2, stone: 0.66, rock: 0.74, wide: 0.4 },
  hills: { mount: 0.5, river2: 0.2, lakes: [1, 2], outcrops: [4, 6], rises: [7, 10], forest: 0.45, wet: -0.03, pine: 0.45, stone: 0.64, rock: 0.73, wide: 0 },
  marsh: { mount: 0.16, river2: 0.5, lakes: [4, 6], outcrops: [2, 3], rises: [1, 3], forest: 0.5, wet: 0.15, pine: 0.1, stone: 0.68, rock: 0.76, wide: 0.6 },
  coast: { mount: 0.32, river2: 0, lakes: [0, 1], outcrops: [3, 4], rises: [2, 4], forest: 0.45, wet: 0.04, pine: 0.25, stone: 0.66, rock: 0.74, wide: 0.3 },
  forest: { mount: 0.26, river2: 0.3, lakes: [1, 2], outcrops: [2, 3], rises: [2, 4], forest: 0.3, wet: 0.04, pine: 0.35, stone: 0.67, rock: 0.75, wide: 0.2 },
  highland: { mount: 0.6, river2: 0.25, lakes: [2, 3], outcrops: [6, 8], rises: [6, 9], forest: 0.5, wet: -0.05, pine: 0.8, stone: 0.6, rock: 0.7, wide: -0.2 },
};

function vnoise(seed: number, off: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const h = (a: number, b: number): number => hash32(seed, S.GEN, off, a, b) / 4294967296;
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const cc = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
}

/** A smooth dome: 1 at the middle, 0 at radius r and beyond. */
export function bump(d: number, r: number): number {
  if (d >= r) return 0;
  const q = 1 - (d * d) / (r * r);
  return q * q;
}

/** Height a list of rises adds at a point (the view shades hills with the same sum). */
export function riseAt(rises: number[][] | undefined, x: number, y: number): number {
  let h = 0;
  if (!rises) return 0;
  for (const [rx, ry, rr, ra] of rises) h += ra * bump(Math.sqrt((x - rx) * (x - rx) + (y - ry) * (y - ry)), rr);
  return h;
}

// sides of the map: north, east, south, west
const SIDE_DX = [0, 1, 0, -1];
const SIDE_DY = [-1, 0, 1, 0];

export function genMap(c: Colony): void {
  const W = c.w;
  const H = c.h;
  const N = W * H;
  const seed = c.seed;
  const r = new Rand(seed, S.GEN, 1);
  const P = PROF[c.biome] ?? PROF.valley;
  // distances below were set for a 72-tile map; a bigger map keeps a bigger clearing for its town
  const K = Math.min(W, H) / 72;
  const cx = (c.cx = Math.floor(W / 2) + r.range(-Math.round(3 * K), Math.round(3 * K)));
  const cy = (c.cy = Math.floor(H / 2) + r.range(-Math.round(3 * K), Math.round(3 * K)));
  const dCentre = (x: number, y: number): number => Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));

  // The mountains stand in one corner; the sea (on a coast) and the road lie on the two far sides.
  const mx = r.chance(0.5) ? 0 : W - 1;
  const my = r.chance(0.5) ? 0 : H - 1;
  const far = [my === 0 ? 2 : 0, mx === 0 ? 1 : 3];
  const coast = c.biome === 'coast';
  const first = r.int(2);
  const seaSide = coast ? far[first] : -1;
  const roadSide = coast ? far[1 - first] : far[first];
  const roadV = roadSide === 0 || roadSide === 2; // the road runs north-south

  // ---------- Height: rolling noise, the mountain corner, hills, and a rise by the town ----------
  const rises: number[][] = [[mx, my, Math.round(W * 0.78), P.mount]];
  const nRise = r.range(P.rises[0], P.rises[1]);
  for (let k = 0, tries = 0; k < nRise && tries < 60; tries++) {
    const x = r.range(6, W - 7);
    const y = r.range(6, H - 7);
    if (dCentre(x, y) < 14 * K) continue;
    rises.push([x, y, r.range(Math.round(4 * K), Math.round(7 * K)), 0.08 + r.float() * (c.biome === 'hills' || c.biome === 'highland' ? 0.2 : 0.12)]);
    k++;
  }
  // the rise beside the town, where a keep will one day stand: away from the road and the river
  const away = (roadSide + 2) % 4;
  const kd = Math.round(13 * K) + r.range(0, 2);
  const side = r.chance(0.5) ? 1 : -1;
  const kx = Math.round(cx + SIDE_DX[away] * kd + SIDE_DX[(away + 1) % 4] * side * r.range(2, 6));
  const ky = Math.round(cy + SIDE_DY[away] * kd + SIDE_DY[(away + 1) % 4] * side * r.range(2, 6));
  c.keep = { x: kx, y: ky };
  const keepRise = [kx, ky, Math.round(5 * K), 0.1];

  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let e = 0.5 * vnoise(seed, 1, x, y, 20) + 0.3 * vnoise(seed, 2, x, y, 9) + 0.2 * vnoise(seed, 3, x, y, 4);
      e = e * 0.62 + 0.08 + riseAt(rises, x, y);
      const dc = dCentre(x, y);
      // the town's ground is kept low and open
      if (dc < 15 * K) e = Math.min(e, 0.45 + Math.max(0, dc - 11 * K) * 0.07);
      e += keepRise[3] * bump(Math.sqrt((x - kx) * (x - kx) + (y - ky) * (y - ky)), keepRise[2]);
      elev[i] = e;
      moist[i] = 0.6 * vnoise(seed, 4, x, y, 16) + 0.4 * vnoise(seed, 5, x, y, 6) + P.wet;
    }
  }
  rises.push(keepRise);
  c.rises = rises.map((q) => [q[0], q[1], q[2], Math.round(q[3] * 1000) / 1000]);

  // ---------- Ground ----------
  for (let i = 0; i < N; i++) {
    const e = elev[i];
    const m = moist[i];
    let t: number = T.GRASS;
    if (e > P.rock) t = T.ROCK;
    else if (e > P.stone) t = T.STONE;
    else if (m > 0.68 && e < 0.42) t = T.MARSH;
    else if (m > 0.5 && m < 0.64 && e < 0.56) t = T.SOIL;
    else if (m < 0.3) t = T.DIRT;
    c.ter[i] = t;
  }

  // ---------- The road in, from the far edge to the middle ----------
  const road: number[] = [];
  const onRoad = new Uint8Array(N);
  {
    const sx = roadV ? 0 : SIDE_DX[roadSide];
    const sy = roadV ? SIDE_DY[roadSide] : 0;
    const a0 = roadV ? cy : cx;
    const a1 = roadV ? (sy > 0 ? H - 1 : 0) : sx > 0 ? W - 1 : 0;
    const st = roadV ? sy : sx;
    const base = roadV ? cx : cy;
    const lim = roadV ? W : H;
    const wig = (a: number): number => Math.max(3, Math.min(lim - 4, Math.round(base + (vnoise(seed, 7, 0, a, 12) - vnoise(seed, 7, 0, a0, 12)) * 12)));
    let prev = wig(a0);
    const put = (a: number, b: number): void => {
      for (let w = 0; w <= 1; w++) {
        const x = roadV ? b + w : a;
        const y = roadV ? a : b + w;
        const i = y * W + x;
        if (!onRoad[i]) { onRoad[i] = 1; road.push(i); }
      }
    };
    for (let a = a0; a !== a1 + st; a += st) {
      const b = wig(a);
      // no gaps where the road bends: fill across to where it was
      for (let q = Math.min(prev, b); q <= Math.max(prev, b); q++) put(a, q);
      prev = b;
    }
    c.gx = roadV ? prev : a1;
    c.gy = roadV ? a1 : prev;
  }
  const nearRoad = (x: number, y: number, d: number): boolean => {
    for (let yy = Math.max(0, y - d); yy <= Math.min(H - 1, y + d); yy++) for (let xx = Math.max(0, x - d); xx <= Math.min(W - 1, x + d); xx++) if (onRoad[yy * W + xx]) return true;
    return false;
  };

  // ---------- Water ----------
  // how far each tile is from the nearest river, less that river's width there
  const rd = new Float32Array(N).fill(99);
  const ford = new Uint8Array(N);
  const stamp = (x: number, y: number, w: number, isFord: boolean): void => {
    const R = 4;
    for (let yy = Math.floor(y - R); yy <= Math.ceil(y + R); yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = Math.floor(x - R); xx <= Math.ceil(x + R); xx++) {
        if (xx < 0 || xx >= W) continue;
        const i = yy * W + xx;
        const d = Math.sqrt((xx - x) * (xx - x) + (yy - y) * (yy - y)) - w;
        if (d < rd[i]) rd[i] = d;
        if (isFord && d < 1.6) ford[i] = 1;
      }
    }
  };
  /** A river across the whole map: horizontal (h) or vertical, wandering about a line `off` from the centre. */
  const river = (h: boolean, off: number, salt: number, minOff: number): void => {
    const L = h ? W : H;
    const vc = h ? cy : cx;
    const uc = h ? cx : cy;
    const fords = [r.range(Math.round(L * 0.12), Math.round(L * 0.4)), r.range(Math.round(L * 0.6), Math.round(L * 0.88))];
    const sgn = off >= 0 ? 1 : -1;
    for (let s = 0; s < L * 2; s++) {
      const u = s / 2;
      let v = vc + off + (vnoise(seed, salt, 0, u, 16) - 0.5) * 16 + (vnoise(seed, salt + 1, 0, u, 5) - 0.5) * 3;
      // the river bends away from the town rather than through it
      const du = Math.abs(u - uc);
      const keep = minOff - du * 0.35;
      if (keep > 0 && (v - vc) * sgn < keep) v = vc + sgn * keep;
      const w = Math.max(0.6, 1.1 + P.wide + (vnoise(seed, salt + 2, 0, u, 9) - 0.5) * 1.2);
      const isFord = fords.some((f) => Math.abs(u - f) <= 1.5);
      if (h) stamp(u, v, w, isFord);
      else stamp(v, u, w, isFord);
    }
  };
  const towardRoad = roadSide === 2 || roadSide === 1 ? 1 : -1;
  const riverOff = Math.round(13 * K) + r.range(0, Math.round(4 * K));
  river(roadV, towardRoad * riverOff, 20, Math.round(11 * K));
  if (r.chance(P.river2)) river(!roadV, (r.chance(0.5) ? 1 : -1) * (Math.round(19 * K) + r.range(0, Math.round(6 * K))), 30, Math.round(16 * K));
  const marshy = c.biome === 'marsh';
  for (let i = 0; i < N; i++) {
    const d = rd[i];
    if (d >= 2.4) continue;
    if (d < 0 && !ford[i]) c.ter[i] = T.DEEP;
    else if (d < 1.3 + (marshy ? 0.8 : 0)) c.ter[i] = T.SHALLOW;
    else if (c.ter[i] !== T.ROCK) c.ter[i] = marshy ? T.MARSH : elev[i] > 0.5 ? T.STONE : T.SAND;
  }

  // the sea, along the far side on a coast
  if (coast) {
    const into = (x: number, y: number): number => (seaSide === 0 ? -y : seaSide === 1 ? x : seaSide === 2 ? y : -x);
    const along = (x: number, y: number): number => (seaSide === 0 || seaSide === 2 ? x : y);
    const reach = Math.round(19 * K) + r.range(0, Math.round(4 * K));
    const line = into(cx, cy) + reach;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = along(x, y);
        const d = into(x, y) - (line + (vnoise(seed, 6, 0, a, 11) - 0.5) * 12 + (vnoise(seed, 16, 0, a, 4) - 0.5) * 3);
        const i = y * W + x;
        if (d > 3.2) c.ter[i] = T.DEEP;
        else if (d > 0) c.ter[i] = T.SHALLOW;
        else if (d > -2.6 && c.ter[i] !== T.ROCK && c.ter[i] !== T.DEEP && c.ter[i] !== T.SHALLOW) c.ter[i] = T.SAND;
      }
    }
  }

  // lakes and pools, out in the wild and clear of the road
  const nLake = r.range(P.lakes[0], P.lakes[1]);
  for (let k = 0, tries = 0; k < nLake && tries < 80; tries++) {
    const x = r.range(8, W - 9);
    const y = r.range(8, H - 9);
    const lr = marshy ? r.range(2, Math.round(3 * K)) : r.range(Math.round(2.5 * K), Math.round(5 * K));
    if (dCentre(x, y) < 14 * K + lr || nearRoad(x, y, lr + 5)) continue;
    for (let yy = y - lr - 4; yy <= y + lr + 4; yy++) {
      for (let xx = x - lr - 4; xx <= x + lr + 4; xx++) {
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        const i = yy * W + xx;
        const d = lr - Math.sqrt((xx - x) * (xx - x) + (yy - y) * (yy - y)) + (vnoise(seed, 12 + k, xx, yy, 4) - 0.5) * 3;
        if (onRoad[i]) continue;
        if (d > 1.6) c.ter[i] = T.DEEP;
        else if (d > 0) { if (c.ter[i] !== T.DEEP) c.ter[i] = T.SHALLOW; }
        else if (d > -1.4 && c.ter[i] !== T.DEEP && c.ter[i] !== T.SHALLOW && c.ter[i] !== T.ROCK) c.ter[i] = marshy ? T.MARSH : T.SAND;
      }
    }
    k++;
  }

  // ---------- Rocky outcrops: bare rock with ore in it, stony ground and boulders round about ----------
  const crag = new Uint8Array(N);
  const nCrag = r.range(P.outcrops[0], P.outcrops[1]);
  for (let k = 0, tries = 0; k < nCrag && tries < 120; tries++) {
    // the first is always a short walk from the town, so there is stone to be had
    const ux = r.float() * 2 - 1;
    const uy = r.float() * 2 - 1;
    const ul = Math.sqrt(ux * ux + uy * uy);
    if (ul < 0.2 || ul > 1) continue;
    const dist = k === 0 ? r.range(Math.round(16 * K), Math.round(20 * K)) : r.range(Math.round(17 * K), Math.round(33 * K));
    const x = Math.round(cx + (ux / ul) * dist);
    const y = Math.round(cy + (uy / ul) * dist);
    const or = r.range(Math.round(1.6 * K), Math.round((c.biome === 'highland' || c.biome === 'hills' ? 3.6 : 2.8) * K));
    if (x < or + 4 || y < or + 4 || x >= W - or - 4 || y >= H - or - 4) continue;
    if (nearRoad(x, y, or + 4) || c.ter[y * W + x] === T.DEEP || c.ter[y * W + x] === T.SHALLOW) continue;
    // nor on the rise kept for the keep
    if (Math.sqrt((x - kx) * (x - kx) + (y - ky) * (y - ky)) < or + 5 * K) continue;
    for (let yy = y - or - 4; yy <= y + or + 4; yy++) {
      for (let xx = x - or - 4; xx <= x + or + 4; xx++) {
        const i = yy * W + xx;
        const t = c.ter[i];
        if (t === T.DEEP || t === T.SHALLOW || onRoad[i]) continue;
        const d = or - Math.sqrt((xx - x) * (xx - x) + (yy - y) * (yy - y)) + (vnoise(seed, 40 + k, xx, yy, 3) - 0.5) * 3;
        if (d > 0) { c.ter[i] = T.ROCK; crag[i] = 2; }
        else if (d > -2.8) { if (t !== T.ROCK) c.ter[i] = T.STONE; crag[i] = 1; }
      }
    }
    k++;
  }

  // the road is laid last, over everything; where it meets water it fords it
  for (const i of road) {
    const t = c.ter[i];
    if (t === T.DEEP || t === T.SHALLOW) {
      c.ter[i] = T.SHALLOW;
      const x = i % W;
      const y = (i - x) / W;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) if (c.ter[yy * W + xx] === T.DEEP) c.ter[yy * W + xx] = T.SHALLOW;
    } else c.ter[i] = T.PATH;
  }

  // the heart of the town and the top of the rise are dry, open ground whatever else happened
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = c.ter[i];
      if (t === T.PATH) continue;
      const near = dCentre(x, y) < 6 * K || Math.sqrt((x - kx) * (x - kx) + (y - ky) * (y - ky)) < KEEP_R + 1;
      if (near && (t === T.DEEP || t === T.SHALLOW || t === T.ROCK || t === T.MARSH)) c.ter[i] = T.GRASS;
    }
  }

  // ---------- Growing and lying things ----------
  const fr = new Rand(seed, S.GEN, 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = c.ter[i];
      const roll = fr.float();
      const roll2 = fr.float();
      const dc = dCentre(x, y);
      const forest = vnoise(seed, 8, x, y, 11) * 0.7 + vnoise(seed, 9, x, y, 4) * 0.3;
      if (t === T.ROCK) {
        if (vnoise(seed, 10, x, y, 4) > (crag[i] ? 0.6 : 0.74)) { c.feat[i] = F.ORE; c.fg[i] = 100; }
        continue;
      }
      if (t === T.PATH || t === T.DEEP || t === T.SAND) continue;
      if (t === T.SHALLOW) { if (roll < 0.12 && !onRoad[i]) c.feat[i] = F.REEDS; continue; }
      if (t === T.STONE) {
        if (roll < (crag[i] ? 0.2 : 0.13)) { c.feat[i] = F.BOULDER; c.fg[i] = 100; }
        else if (roll < 0.17 && dc > 8 * K) { c.feat[i] = F.PINE; c.fg[i] = 100; }
        continue;
      }
      const dk = Math.sqrt((x - kx) * (x - kx) + (y - ky) * (y - ky));
      const clear = Math.min(dc < 8 * K ? 0 : dc < 13 * K ? (dc - 8 * K) / (5 * K) : 1, dk < 4 * K ? 0 : 1);
      // glades: open meadows in the middle of the woods
      const glade = vnoise(seed, 11, x, y, 7) > 0.7 ? 0.25 : 1;
      const dens = Math.max(0, forest - P.forest) * (c.biome === 'forest' ? 2.6 : 2) * clear * glade * (t === T.SOIL ? 0.5 : 1) + 0.012 * clear;
      if (roll < dens) {
        c.feat[i] = elev[i] > 0.56 || roll2 < P.pine ? F.PINE : F.TREE;
        c.fg[i] = 100;
      } else if (roll2 < 0.016 && forest > 0.34 && dc > 6 * K && t !== T.MARSH) {
        c.feat[i] = F.BUSH;
        c.fg[i] = 0;
      } else if (roll2 < (crag[i] ? 0.08 : 0.022) && dc > 7 * K && dk > 3 * K) {
        c.feat[i] = F.BOULDER;
        c.fg[i] = 100;
      } else if (roll2 < (t === T.MARSH ? 0.05 : 0.027) && dc > 6 * K) {
        c.feat[i] = F.HERB;
        c.fg[i] = 100;
      } else if (roll2 < (glade < 1 ? 0.12 : 0.05) && t === T.GRASS) {
        c.feat[i] = F.FLOWERS;
      }
    }
  }

  // An old ruin somewhere out in the wild
  for (let tries = 0; tries < 40; tries++) {
    const x = r.range(6, W - 10);
    const y = r.range(6, H - 10);
    if (dCentre(x, y) < 20 * K || c.ter[y * W + x] !== T.GRASS) continue;
    const w = r.range(3, 5);
    const h = r.range(3, 4);
    for (let k = 0; k <= w; k++) {
      for (const [px, py] of [[x + k, y], [x + k, y + h]] as const) {
        const i = py * W + px;
        if (r.chance(0.7) && (c.ter[i] === T.GRASS || c.ter[i] === T.DIRT || c.ter[i] === T.SOIL)) c.feat[i] = F.RUIN;
      }
    }
    for (let k = 1; k < h; k++) {
      for (const px of [x, x + w]) {
        const i = (y + k) * W + px;
        if (r.chance(0.65) && (c.ter[i] === T.GRASS || c.ter[i] === T.DIRT || c.ter[i] === T.SOIL)) c.feat[i] = F.RUIN;
      }
    }
    break;
  }
}
