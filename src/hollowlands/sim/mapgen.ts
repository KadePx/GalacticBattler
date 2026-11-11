// Makes the land a colony sits on: a clearing in the middle, a mountain corner, water on the
// far side, woods, soil, and a road out to the rest of the world.

import { Rand, S, hash32 } from './rng';
import { F, T, type Colony } from './types';

export const BIOMES = ['valley', 'hills', 'marsh', 'coast'] as const;

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

export function genMap(c: Colony): void {
  const W = c.w;
  const H = c.h;
  const seed = c.seed;
  const r = new Rand(seed, S.GEN, 1);
  const biome = c.biome;
  const cx = (c.cx = Math.floor(W / 2) + r.range(-3, 3));
  const cy = (c.cy = Math.floor(H / 2) + r.range(-3, 3));
  const mx = r.chance(0.5) ? 0 : W - 1;
  const my = r.chance(0.5) ? 0 : H - 1;
  const mountain = biome === 'hills' ? 0.6 : biome === 'valley' ? 0.4 : biome === 'coast' ? 0.34 : 0.18;
  const elev = new Float32Array(W * H);
  const moist = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dm = Math.sqrt((x - mx) * (x - mx) + (y - my) * (y - my)) / (W * 1.1);
      let e = 0.5 * vnoise(seed, 1, x, y, 20) + 0.3 * vnoise(seed, 2, x, y, 9) + 0.2 * vnoise(seed, 3, x, y, 4);
      e = e * 0.62 + Math.max(0, 1 - dm * 1.6) * mountain + 0.08;
      const dc = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (dc < 15) e = Math.min(e, 0.45 + Math.max(0, dc - 11) * 0.07);
      elev[i] = e;
      moist[i] = 0.6 * vnoise(seed, 4, x, y, 16) + 0.4 * vnoise(seed, 5, x, y, 6);
    }
  }

  // Ground
  for (let i = 0; i < W * H; i++) {
    const e = elev[i];
    const m = moist[i] + (biome === 'marsh' ? 0.14 : 0);
    let t: number = T.GRASS;
    if (e > 0.74) t = T.ROCK;
    else if (e > 0.66) t = T.STONE;
    else if (m > 0.68 && e < 0.42) t = T.MARSH;
    else if (m > 0.5 && m < 0.64 && e < 0.56) t = T.SOIL;
    else if (m < 0.3) t = T.DIRT;
    c.ter[i] = t;
  }

  // Water on the side away from the mountain
  const wx = mx === 0 ? Math.floor(W * 0.83) : Math.floor(W * 0.17);
  const sign = mx === 0 ? 1 : -1;
  const setWater = (x: number, y: number, d: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    const dc = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    if (dc < 13) return;
    if (d < 1.1) c.ter[i] = T.DEEP;
    else if (d < 2.3) { if (c.ter[i] !== T.DEEP) c.ter[i] = T.SHALLOW; }
    else if (d < 3.3 && c.ter[i] !== T.DEEP && c.ter[i] !== T.SHALLOW && c.ter[i] !== T.ROCK) c.ter[i] = T.SAND;
  };
  if (biome === 'coast') {
    for (let y = 0; y < H; y++) {
      const edge = wx + sign * 2 + (vnoise(seed, 6, 0, y, 9) - 0.5) * 8;
      for (let x = 0; x < W; x++) {
        const d = (x - edge) * sign;
        if (d > 2.2) c.ter[y * W + x] = T.DEEP;
        else if (d > 0) c.ter[y * W + x] = T.SHALLOW;
        else if (d > -2.5 && c.ter[y * W + x] !== T.ROCK) c.ter[y * W + x] = T.SAND;
      }
    }
  } else if (biome === 'hills') {
    const px = wx + sign * r.range(-2, 4);
    const py = Math.floor(H / 2) + r.range(-14, 14);
    const pr = r.range(4, 6);
    for (let y = py - pr - 4; y <= py + pr + 4; y++) {
      for (let x = px - pr - 4; x <= px + pr + 4; x++) {
        const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)) - pr + vnoise(seed, 6, x, y, 4) * 2.4;
        if (d < 3.3) setWater(x, y, d + 1.2 < 0 ? 0 : d + 1.2);
      }
    }
  } else {
    const ford1 = r.range(8, H - 9);
    const ford2 = r.range(8, H - 9);
    for (let y = 0; y < H; y++) {
      const rc = wx + (vnoise(seed, 6, 0, y, 10) - 0.5) * 12;
      const ford = Math.abs(y - ford1) <= 1 || Math.abs(y - ford2) <= 1;
      for (let x = Math.floor(rc) - 5; x <= Math.floor(rc) + 5; x++) {
        const d = Math.abs(x - rc);
        setWater(x, y, ford && d < 1.1 ? 1.2 : d);
      }
    }
  }

  // The road out, on the side away from the mountain
  const gy = (c.gy = my === 0 ? H - 1 : 0);
  let gx = cx;
  const step = gy > cy ? 1 : -1;
  for (let y = cy; y !== gy + step; y += step) {
    gx = Math.max(3, Math.min(W - 4, Math.round(cx + (vnoise(seed, 7, 0, y, 12) - vnoise(seed, 7, 0, cy, 12)) * 10)));
    for (let dx = 0; dx <= 1; dx++) {
      const i = y * W + gx + dx;
      c.ter[i] = c.ter[i] === T.DEEP || c.ter[i] === T.SHALLOW ? T.SHALLOW : T.PATH;
    }
  }
  c.gx = gx;

  // Growing and lying things
  const fr = new Rand(seed, S.GEN, 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = c.ter[i];
      const roll = fr.float();
      const roll2 = fr.float();
      const dc = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      const forest = vnoise(seed, 8, x, y, 11) * 0.7 + vnoise(seed, 9, x, y, 4) * 0.3;
      if (t === T.ROCK) {
        if (vnoise(seed, 10, x, y, 4) > 0.74) { c.feat[i] = F.ORE; c.fg[i] = 100; }
        continue;
      }
      if (t === T.PATH || t === T.DEEP || t === T.SAND) continue;
      if (t === T.SHALLOW) { if (roll < 0.12) c.feat[i] = F.REEDS; continue; }
      if (t === T.STONE) {
        if (roll < 0.13) { c.feat[i] = F.BOULDER; c.fg[i] = 100; }
        else if (roll < 0.17 && dc > 8) { c.feat[i] = F.PINE; c.fg[i] = 100; }
        continue;
      }
      const clear = dc < 8 ? 0 : dc < 13 ? (dc - 8) / 5 : 1;
      const dens = Math.max(0, forest - (biome === 'marsh' ? 0.5 : 0.42)) * 1.7 * clear * (t === T.SOIL ? 0.5 : 1) + 0.012 * clear;
      if (roll < dens) {
        c.feat[i] = elev[i] > 0.56 || (biome === 'hills' && roll2 < 0.4) ? F.PINE : F.TREE;
        c.fg[i] = 100;
      } else if (roll2 < 0.016 && forest > 0.34 && dc > 6 && t !== T.MARSH) {
        c.feat[i] = F.BUSH;
        c.fg[i] = 0;
      } else if (roll2 < 0.022 && dc > 7) {
        c.feat[i] = F.BOULDER;
        c.fg[i] = 100;
      } else if (roll2 < (t === T.MARSH ? 0.05 : 0.027) && dc > 6) {
        c.feat[i] = F.HERB;
        c.fg[i] = 100;
      } else if (roll2 < 0.05 && t === T.GRASS) {
        c.feat[i] = F.FLOWERS;
      }
    }
  }

  // An old ruin somewhere out in the wild
  for (let tries = 0; tries < 40; tries++) {
    const x = r.range(6, W - 10);
    const y = r.range(6, H - 10);
    const dc = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    if (dc < 20 || c.ter[y * W + x] !== T.GRASS) continue;
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
