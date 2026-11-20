// How the land and everything standing on it is drawn. Terrain is painted into a canvas
// (baked to one texture); natural features and built things are drawn as vector shapes into
// PixiJS Graphics, one map chunk at a time, so only chunks that changed get redrawn.

import type { Graphics } from 'pixi.js';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, TICKS_PER_DAY } from '../config';
import { riseAt } from '../sim/mapgen';
import { Z, frame, onKeep } from '../sim/town';
import { B, F, T, type Bld, type Colony } from '../sim/types';
import { css, darken, lighten, mix } from './look';
import { knows } from '../sim/known';
import { drawFieldWorks, drawPennant, drawTechThing, drawWindow, isTechThing } from './techart';

/** Tile size in world pixels at zoom 1. */
export const TS = 24;

/** Steady pseudo-random 0..1 for a tile, so details never flicker between redraws. */
export function hash2(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 374761, 668265263) ^ Math.imul(y + 2246822, 374761393) ^ Math.imul(k + 31, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- Seasonal palette ----------

export interface Pal {
  /** changes when the palette does, so layers know to redraw */
  key: number;
  /** ground colour per terrain code */
  ter: number[];
  /** three leaf tones for broadleaf trees */
  leaf: number[];
  pine: number;
  bush: number;
  /** 0..1 how much snow lies on things */
  snow: number;
}

//                      grass     dirt      soil      sand      marsh     shallow   deep      rock      stone     path
const TER: number[][] = [
  /* spring */ [0x6fa257, 0x8f7b5d, 0x735f42, 0xd3c491, 0x5a7a5c, 0x5fa5b7, 0x2f6d90, 0x565a66, 0x8b8e95, 0xb09b74],
  /* summer */ [0x4f8745, 0x8c7652, 0x6e5a3d, 0xd8c88f, 0x4f7350, 0x57a0b5, 0x2b698e, 0x585c68, 0x8d9097, 0xb39c70],
  /* autumn */ [0x8f8443, 0x866a4b, 0x69533a, 0xcfbf8c, 0x6e6f49, 0x5b98a8, 0x2d6485, 0x54575f, 0x888a90, 0xab9370],
  /* winter */ [0xc3ccc9, 0xa9a39b, 0x9b948a, 0xd8d4c3, 0xa3b3b0, 0x93bac7, 0x41789a, 0x7c818c, 0xb6bac1, 0xbfb7a6],
];
const LEAF: number[][] = [[0x76b25a, 0x68a650, 0x86bb62], [0x3f7d3f, 0x356f3a, 0x4a8744], [0xb8642b, 0xcc8d30, 0x9a4a28], [0x7f8a86, 0x8a938f, 0x767f7c]];
const PINE = [0x356b4c, 0x2c5f44, 0x33614a, 0x3d6a59];
const BUSH = [0x5c9a4c, 0x427a3e, 0x8a7a3a, 0x8e9a94];

/** The palette for a moment in the year. The first day of a season is a blend with the last. */
export function paletteAt(tick: number): Pal {
  const dayAbs = Math.floor(tick / TICKS_PER_DAY);
  const doy = ((dayAbs % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const s = Math.floor(doy / DAYS_PER_SEASON);
  const turning = dayAbs > 0 && doy % DAYS_PER_SEASON === 0;
  const p = (s + 3) % 4;
  const t = turning ? 0.55 : 1;
  const m = (a: number, b: number): number => (t >= 1 ? b : mix(a, b, t));
  return {
    key: s * 2 + (turning ? 1 : 0),
    ter: TER[s].map((v, i) => m(TER[p][i], v)),
    leaf: LEAF[s].map((v, i) => m(LEAF[p][i], v)),
    pine: m(PINE[p], PINE[s]),
    bush: m(BUSH[p], BUSH[s]),
    snow: s === 3 ? t : p === 3 ? 1 - t : 0,
  };
}

// ---------- Terrain (canvas) ----------

// Which ground flows round the corners of which: higher spreads over lower.
const RANK = [5, 4, 3, 6, 2, 7, 8, 0, 1, 9];
const isWater = (t: number): boolean => t === T.SHALLOW || t === T.DEEP;

function tileColor(c: Colony, pal: Pal, x: number, y: number): number {
  const base = pal.ter[c.ter[y * c.w + x]] ?? pal.ter[0];
  const j = hash2(x, y, 1);
  return j < 0.5 ? darken(base, (0.5 - j) * 0.06) : lighten(base, (j - 0.5) * 0.05);
}

/**
 * Light and shade from the land's hills and rises, per tile: slopes facing the light (north-west)
 * are brighter, slopes facing away darker, and high ground a touch paler. Null on flat land.
 */
function hillShade(c: Colony): Float32Array | null {
  if (!c.rises?.length) return null;
  const W = c.w;
  const H = c.h;
  const hc = new Float32Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) hc[y * (W + 1) + x] = riseAt(c.rises, x, y);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = hc[y * (W + 1) + x];
      const b = hc[y * (W + 1) + x + 1];
      const d = hc[(y + 1) * (W + 1) + x];
      const e = hc[(y + 1) * (W + 1) + x + 1];
      const sx = (b + e - a - d) / 2;
      const sy = (d + e - a - b) / 2;
      const lit = Math.max(-0.24, Math.min(0.24, (sx + sy) * 9));
      out[y * W + x] = 1 + lit + Math.min(0.08, (a + e) * 0.12);
    }
  }
  return out;
}

/** Paint the whole ground. Called only when terrain or season changes. */
export function bakeTerrain(c: Colony, cv: HTMLCanvasElement, pal: Pal): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = c.w;
  const H = c.h;
  const cols = new Array<number>(W * H);
  for (let i = 0; i < W * H; i++) cols[i] = tileColor(c, pal, i % W, Math.floor(i / W));
  // The ground is painted at 12 samples per tile. Each sample looks up its tile through a small
  // smooth wobble, so borders between grass, dirt, sand and water wander like real ground
  // instead of following the grid. Buildings and paths sit on top and hide the wobble there.
  const SUB = 12;
  const sw = W * SUB;
  const sh = H * SUB;
  const img = new ImageData(sw, sh);
  const vn = (fx: number, fy: number, k: number): number => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let tx = fx - x0;
    let ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, k);
    const b = hash2(x0 + 1, y0, k);
    const cc = hash2(x0, y0 + 1, k);
    const d = hash2(x0 + 1, y0 + 1, k);
    return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
  };
  const AMP = 0.42;
  const hs = hillShade(c);
  const hill = (fx: number, fy: number): number => {
    if (!hs) return 1;
    const gx = Math.max(0, Math.min(W - 1.001, fx - 0.5));
    const gy = Math.max(0, Math.min(H - 1.001, fy - 0.5));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const top = hs[y0 * W + x0] * (1 - tx) + hs[y0 * W + x1] * tx;
    const bot = hs[y1 * W + x0] * (1 - tx) + hs[y1 * W + x1] * tx;
    return top * (1 - ty) + bot * ty;
  };
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const fx = (sx + 0.5) / SUB;
      const fy = (sy + 0.5) / SUB;
      const wx = fx + (vn(fx * 1.3, fy * 1.3, 41) - 0.5) * 2 * AMP;
      const wy = fy + (vn(fx * 1.3, fy * 1.3, 42) - 0.5) * 2 * AMP;
      const tx = Math.max(0, Math.min(W - 1, Math.floor(wx)));
      const ty = Math.max(0, Math.min(H - 1, Math.floor(wy)));
      // walls of rock and the built-on ground keep their true shape
      const own = c.ter[Math.floor(fy) * W + Math.floor(fx)];
      const t = own === T.ROCK || own === T.PATH ? Math.floor(fy) * W + Math.floor(fx) : ty * W + tx;
      const col = cols[t];
      const shade = (1 + (vn(fx * 3.1, fy * 3.1, 43) - 0.5) * 0.09) * (isWater(c.ter[t]) ? 1 : hill(fx, fy));
      const o = (sy * sw + sx) * 4;
      img.data[o] = Math.min(255, ((col >> 16) & 255) * shade);
      img.data[o + 1] = Math.min(255, ((col >> 8) & 255) * shade);
      img.data[o + 2] = Math.min(255, (col & 255) * shade);
      img.data[o + 3] = 255;
    }
  }
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  small.getContext('2d')?.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(small, 0, 0, W * TS, H * TS);
  // Small details: tufts, pebbles, ripples, rock faces.
  const zone = frame(c).zone;
  const snowy = pal.snow > 0.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = c.ter[i];
      const px = x * TS;
      const py = y * TS;
      const z = zone[i];
      // the town's laid ground: the squares and the avenue in cobbles, the streets in packed gravel
      // with a kerb where they meet the lots, so the plan reads even from far off
      // the castle's courtyard, flagged once its walls are up
      const court = t === T.STONE && z === Z.NONE && (c.castle?.stage ?? 0) >= 3 && onKeep(c, x, y);
      if ((z !== Z.NONE && z !== Z.BAND && (t === T.STONE || t === T.PATH)) || court) {
        const cob = t === T.STONE && (z === Z.SQUARE || z === Z.PLAZA || z === Z.AVENUE || court);
        g.fillStyle = cob ? (snowy ? '#d9d6cc' : '#c7bca3') : snowy ? '#cfc8b8' : '#c4ad84';
        g.fillRect(px, py, TS, TS);
        if (cob) {
          g.fillStyle = snowy ? 'rgba(120,115,105,0.35)' : 'rgba(110,98,78,0.45)';
          for (let r = 0; r < 4; r++) g.fillRect(px, py + r * 6, TS, 1);
          for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) g.fillRect(px + ((q * 8 + (r & 1) * 4 + x * 3) % TS), py + r * 6, 1, 6);
        } else if (hash2(x, y, 31) < 0.5) {
          g.fillStyle = 'rgba(120,98,66,0.5)';
          g.fillRect(px + hash2(x, y, 32) * 20, py + hash2(x, y, 33) * 20, 2, 2);
        }
        const lot = (xx: number, yy: number): boolean => !court && xx >= 0 && yy >= 0 && xx < W && yy < H && zone[yy * W + xx] === Z.NONE;
        g.fillStyle = 'rgba(70,56,38,0.35)';
        if (lot(x, y - 1)) g.fillRect(px, py, TS, 2);
        if (lot(x, y + 1)) g.fillRect(px, py + TS - 2, TS, 2);
        if (lot(x - 1, y)) g.fillRect(px, py, 2, TS);
        if (lot(x + 1, y)) g.fillRect(px + TS - 2, py, 2, TS);
        continue;
      }
      const h = hash2(x, y, 2);
      const ox = 3 + hash2(x, y, 7) * (TS - 8);
      const oy = 4 + hash2(x, y, 8) * (TS - 9);
      const col = cols[i];
      if (t === T.GRASS) {
        if (h < 0.4) {
          g.fillStyle = css(pal.snow > 0.5 ? lighten(col, 0.35) : darken(col, 0.14));
          g.fillRect(px + ox, py + oy, 1.5, 3.5);
          g.fillRect(px + ox + 3, py + oy + 1, 1.5, 2.5);
          if (h < 0.16) g.fillRect(px + ((ox + 11) % 19), py + ((oy + 9) % 18), 1.5, 3);
        }
      } else if (t === T.DIRT || t === T.PATH || t === T.SAND || t === T.SOIL) {
        if (h < 0.45) {
          g.fillStyle = css(h < 0.22 ? darken(col, 0.13) : lighten(col, 0.14));
          g.beginPath();
          g.arc(px + ox, py + oy, 1.1 + h * 1.6, 0, Math.PI * 2);
          g.fill();
        }
      } else if (t === T.MARSH) {
        if (h < 0.35) {
          g.fillStyle = css(mix(col, pal.ter[T.SHALLOW], 0.32));
          g.beginPath();
          g.ellipse(px + ox, py + oy, 3.5 + h * 6, 2 + h * 3, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (isWater(t)) {
        if (h < (t === T.DEEP ? 0.22 : 0.34)) {
          g.strokeStyle = css(lighten(col, 0.2));
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(px + ox, py + oy + 5, 5, Math.PI * 1.2, Math.PI * 1.8);
          g.stroke();
        }
      } else if (t === T.ROCK) {
        // chiselled faces: light from the top left
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + TS, py);
        g.lineTo(px + ox, py + oy);
        g.lineTo(px, py + TS);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.13)';
        g.beginPath();
        g.moveTo(px + TS, py + TS);
        g.lineTo(px + TS, py);
        g.lineTo(px + ox, py + oy);
        g.lineTo(px, py + TS);
        g.closePath();
        g.fill();
        if (y < H - 1 && c.ter[i + W] !== T.ROCK) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(px, py + TS - 4, TS, 4); }
        if (y > 0 && c.ter[i - W] !== T.ROCK) { g.fillStyle = pal.snow > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.12)'; g.fillRect(px, py, TS, 3); }
      } else if (t === T.STONE) {
        if (h < 0.3) {
          g.strokeStyle = css(darken(col, 0.16));
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px + ox, py + oy);
          g.lineTo(px + ox + 4, py + oy + 3);
          g.lineTo(px + ox + 3, py + oy + 7);
          g.stroke();
        }
      }
    }
  }
}

// ---------- Natural features (vector) ----------

const FLOWER = [0xf2c94c, 0xe98ab0, 0xf4f1ea, 0xa58ae8];

/** Draw the features of one block of tiles. Tree crowns go on `canopy`, which sits above people. */
export function drawFeatures(c: Colony, ground: Graphics, canopy: Graphics, x0: number, y0: number, x1: number, y1: number, pal: Pal): void {
  ground.clear();
  canopy.clear();
  const snow = pal.snow;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * c.w + x;
      const f = c.feat[i];
      if (!f) continue;
      const cx = x * TS + TS / 2;
      const cy = y * TS + TS / 2;
      const k = hash2(x, y, 3);
      const fg = c.fg[i];
      if (f === F.TREE) {
        const grow = 0.55 + 0.45 * Math.min(1, fg / 100);
        const ox = cx + (hash2(x, y, 5) - 0.5) * 6;
        const oy = cy + (hash2(x, y, 6) - 0.5) * 6;
        const r = (9.5 + k * 3) * grow * (1 - snow * 0.14);
        const leaf = pal.leaf[Math.floor(hash2(x, y, 4) * 3) % 3];
        ground.ellipse(ox + 2.5, oy + 4.5, r * 1.02, r * 0.86).fill({ color: 0x0b1220, alpha: 0.24 });
        ground.circle(ox, oy, 2.4).fill(0x5a4636);
        canopy.circle(ox, oy, r).fill(leaf);
        canopy.circle(ox - r * 0.24, oy - r * 0.28, r * 0.62).fill(lighten(leaf, 0.13));
        if (snow > 0) canopy.circle(ox - r * 0.18, oy - r * 0.3, r * 0.5).fill({ color: 0xf2f5f7, alpha: 0.85 * snow });
      } else if (f === F.PINE) {
        const g = 0.6 + 0.4 * Math.min(1, fg / 100) + k * 0.12;
        ground.ellipse(cx + 2.5, cy + 6, 8 * g, 4.6 * g).fill({ color: 0x0b1220, alpha: 0.24 });
        canopy.poly([cx, cy - 13 * g, cx + 8.5 * g, cy + 7 * g, cx - 8.5 * g, cy + 7 * g]).fill(pal.pine);
        canopy.poly([cx, cy - 13 * g, cx + 5.6 * g, cy + 0.5 * g, cx - 5.6 * g, cy + 0.5 * g]).fill(lighten(pal.pine, 0.12));
        if (snow > 0) canopy.poly([cx, cy - 13 * g, cx + 3.4 * g, cy - 5 * g, cx - 3.4 * g, cy - 5 * g]).fill({ color: 0xf2f5f7, alpha: 0.9 * snow });
      } else if (f === F.SAPLING) {
        ground.ellipse(cx + 1, cy + 2.5, 3.6, 2).fill({ color: 0x0b1220, alpha: 0.2 });
        ground.circle(cx, cy, 2.8 + fg * 0.02).fill(lighten(pal.leaf[1], 0.1));
      } else if (f === F.STUMP) {
        ground.circle(cx, cy, 3.6).fill(0x6b5138);
        ground.circle(cx, cy, 2.1).fill(0xa4835c);
      } else if (f === F.BUSH) {
        ground.ellipse(cx + 1.5, cy + 4, 8, 4).fill({ color: 0x0b1220, alpha: 0.2 });
        ground.circle(cx - 3.2, cy + 1, 4.6).circle(cx + 3.2, cy + 1.5, 4.4).circle(cx, cy - 2.4, 4.9).fill(pal.bush);
        ground.circle(cx - 1, cy - 3.2, 2.6).fill(lighten(pal.bush, 0.14));
        if (fg >= 60) ground.circle(cx - 3.4, cy + 1.6, 1.4).circle(cx + 2.8, cy + 0.2, 1.4).circle(cx + 0.4, cy + 3.4, 1.4).circle(cx + 3.6, cy + 3.6, 1.2).fill(0xc2334a);
      } else if (f === F.BOULDER) {
        ground.ellipse(cx + 2, cy + 4, 8.6, 5).fill({ color: 0x0b1220, alpha: 0.24 });
        ground.ellipse(cx, cy + 0.8, 8 + k * 1.5, 6.2 + k).fill(0x7b7f88);
        ground.ellipse(cx - 1.6, cy - 1, 5.2, 3.6).fill(snow > 0.5 ? 0xe4e9ec : 0x9da1aa);
      } else if (f === F.ORE) {
        ground.ellipse(cx, cy, 8, 6.4).fill({ color: 0x23252b, alpha: 0.55 });
        const glint = k < 0.5 ? 0xd98a4a : 0xe9c46a;
        for (let n = 0; n < 3; n++) {
          const gx = cx + (hash2(x, y, 10 + n) - 0.5) * 11;
          const gy = cy + (hash2(x, y, 20 + n) - 0.5) * 8;
          ground.poly([gx, gy - 2.2, gx + 1.8, gy, gx, gy + 2.2, gx - 1.8, gy]).fill(n === 0 ? lighten(glint, 0.3) : glint);
        }
      } else if (f === F.HERB) {
        ground.ellipse(cx - 2.2, cy + 0.6, 2.8, 1.5).ellipse(cx + 2.2, cy + 0.6, 2.8, 1.5).fill(0x4f9a5a);
        ground.circle(cx, cy - 1.4, 1.5).fill(0xd9c9f2);
      } else if (f === F.FLOWERS) {
        if (snow > 0.5) continue;
        for (let n = 0; n < 4; n++) {
          ground.circle(cx + (hash2(x, y, 30 + n) - 0.5) * 16, cy + (hash2(x, y, 40 + n) - 0.5) * 16, 1.5).fill(FLOWER[Math.floor(hash2(x, y, 50 + n) * 4) % 4]);
        }
      } else if (f === F.REEDS) {
        for (let n = 0; n < 3; n++) {
          const rx = cx - 5 + n * 4.5 + (hash2(x, y, 60 + n) - 0.5) * 2;
          const top = cy - 6 + hash2(x, y, 70 + n) * 3;
          ground.rect(rx, top, 1.3, 11).fill(0x6f8f4a);
          ground.roundRect(rx - 0.6, top - 2.4, 2.5, 4, 1).fill(0x6b4c2c);
        }
      } else if (f === F.LOG) {
        // a tree the storm brought down: a trunk on its side with the root plate up
        const ang = (hash2(x, y, 8) - 0.5) * 1.2;
        const dx = Math.cos(ang) * 9;
        const dy = Math.sin(ang) * 9;
        ground.moveTo(cx - dx + 1.5, cy - dy + 3).lineTo(cx + dx + 1.5, cy + dy + 3).stroke({ width: 6, color: 0x0b1220, alpha: 0.22, cap: 'round' });
        ground.moveTo(cx - dx, cy - dy).lineTo(cx + dx, cy + dy).stroke({ width: 5.4, color: 0x6b5138, cap: 'round' });
        ground.moveTo(cx - dx * 0.8, cy - dy * 0.8 - 1).lineTo(cx + dx * 0.8, cy + dy * 0.8 - 1).stroke({ width: 1.2, color: 0x8f6e4c, cap: 'round' });
        ground.circle(cx - dx, cy - dy, 4.4).fill(0x5a4636);
        ground.circle(cx + dx + Math.cos(ang) * 2, cy + dy + Math.sin(ang) * 2, 4.2).fill({ color: pal.leaf[1], alpha: 0.85 });
      } else if (f === F.MUSHROOM) {
        for (let n = 0; n < 3; n++) {
          const mx = cx + (hash2(x, y, 80 + n) - 0.5) * 12;
          const my = cy + (hash2(x, y, 90 + n) - 0.5) * 10;
          ground.rect(mx - 0.6, my, 1.2, 2.6).fill(0xefe6d2);
          ground.ellipse(mx, my, 2.6, 1.7).fill(n === 1 ? 0xb84a3a : 0xc9a27a);
          if (n === 1) ground.circle(mx - 0.8, my - 0.4, 0.5).circle(mx + 0.9, my - 0.2, 0.5).fill(0xf6f1e4);
        }
      } else if (f === F.RUIN) {
        const px = x * TS;
        const py = y * TS;
        ground.roundRect(px + 1.5, py + 3.5, 21, 19, 3).fill(0x60646c);
        ground.roundRect(px + 2.5, py + 2.5, 19, 13, 3).fill(0x8a8e96);
        ground.moveTo(px + 8, py + 4).lineTo(px + 11, py + 9).lineTo(px + 9.5, py + 14).stroke({ width: 1, color: 0x4b4f58 });
        if (k < 0.6) ground.circle(px + 16, py + 12, 3 + k * 2).fill({ color: 0x5f8a55, alpha: 0.75 });
      }
    }
  }
}

// ---------- Crops ----------

const CROP_LEAF: Record<string, number> = { cabbage: 0x7fb069, onion: 0x6f9a4a, hops: 0x3f7a3a, herb: 0x5f8a55, beans: 0x3f8a3a };

/** One ripe plant of a crop, centred on (x, y). */
function drawCrop(g: Graphics, kind: string, x: number, y: number): void {
  switch (kind) {
    case 'grain': g.ellipse(x, y, 2.6, 3.4).fill(0xe2b84a); g.ellipse(x - 0.6, y - 1, 1.2, 1.8).fill(0xf4d87a); break;
    case 'wheat': g.ellipse(x, y, 2.2, 3.8).fill(0xd9a03a); g.ellipse(x, y - 1.2, 1.1, 2).fill(0xf0c060); g.moveTo(x, y - 3.6).lineTo(x + 1.6, y - 5.4).stroke({ width: 0.7, color: 0xf0c060 }); break;
    case 'oats': g.circle(x - 1.2, y, 1.5).circle(x + 1.2, y - 1, 1.5).circle(x, y + 1.6, 1.5).fill(0xd9cf8a); break;
    case 'potato': g.circle(x, y, 3.2).fill(0x4f8a3e); g.circle(x - 1, y - 0.8, 1.1).circle(x + 1.3, y + 0.6, 1).fill(0xf2f2f2); break;
    case 'cabbage': g.circle(x, y, 3.4).fill(0x8fc47a); g.circle(x, y, 2).fill(0xc8e6a8); break;
    case 'turnip': g.circle(x, y + 0.6, 2.6).fill(0xf0e6f0); g.circle(x, y + 1.2, 1.6).fill(0xb06ab0); g.ellipse(x, y - 2, 1.4, 2).fill(0x4f9a3e); break;
    case 'beans': g.circle(x, y, 3).fill(0x3f8a3a); g.ellipse(x - 1, y + 0.4, 0.8, 1.8).ellipse(x + 1.2, y - 0.4, 0.8, 1.8).fill(0xa8d46a); break;
    case 'onion': g.circle(x, y + 0.8, 2.4).fill(0xc9845a); g.moveTo(x, y - 1).lineTo(x - 1, y - 4.5).moveTo(x, y - 1).lineTo(x + 1, y - 4.5).stroke({ width: 0.9, color: 0x6f9a4a }); break;
    case 'hops': g.circle(x, y, 3.2).fill(0x3f7a3a); g.ellipse(x - 1, y, 1.2, 1.6).ellipse(x + 1.3, y + 0.8, 1.2, 1.6).fill(0xb8d86a); break;
    case 'herb': g.circle(x, y, 2.8).fill(0x5f8a55); g.circle(x - 0.8, y - 0.8, 1).circle(x + 1, y + 0.6, 1).fill(0xd9c9f2); break;
    case 'flax': g.circle(x, y, 2.8).fill(0xc9b458); g.circle(x - 0.6, y - 0.8, 1.3).fill(0x8fb4f0); break;
    default: g.circle(x, y, 3.1).fill(0x4f9a3e); g.circle(x + 0.8, y + 0.6, 1.5).fill(0xe2933a); break;
  }
}

// ---------- Built things (vector) ----------

const BLANKET = [0x8a4a4a, 0x4f6fa8, 0x4f8a62, 0x7a5a9a, 0xa8763f, 0x3f8a8a];
/** Each bed keeps its own blanket colour; the sleeper is drawn under the same one. */
export const blanketColor = (tile: number): number => BLANKET[Math.floor(hash2(tile, 17, 9) * BLANKET.length) % BLANKET.length];

const isWall = (s: number): boolean => s === B.WALL_WOOD || s === B.WALL_STONE || s === B.DOOR || s === B.CWALL || s === B.CTOWER || s === B.GATE;
/** A tile of the town wall or its gates, for the gates to line up with. */
const isLine = (s: number): boolean => s === B.PALISADE || s === B.CWALL || s === B.CTOWER || s === B.GATE || s === B.RUBBLE;
const WALL_PARTS = new Set(['twall', 'wtower', 'tgate']);
const isCastleWall = (s: number): boolean => s === B.CWALL || s === B.CTOWER;
/** Things of the castle's rooms that stand on a floor. */
const CASTLE_FURN = new Set<number>([B.THRONE, B.BANNER, B.TAPESTRY, B.HAY]);

/** Heraldic colours, field and charge, for a ruling house: worked out from its name, so they never change. */
const TINCTURES = [0xa8323a, 0x2f4f9a, 0x2f7a4a, 0x6a3a8a, 0x1f1f24, 0xc9862a];
const METALS = [0xe8c75a, 0xeeeae0];
export function houseColours(c: Colony): [number, number] {
  const r = c.pawns.find((p) => p.id === c.gov.ruler);
  const name = r ? r.fam : c.name;
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return [TINCTURES[h % TINCTURES.length], METALS[(h >>> 4) % METALS.length]];
}
const OPEN_AIR = new Set(['well', 'field', 'graveyard']);

/** A tile where firelight comes from, for the night lighting. 0 if none, else the radius in tiles. */
export function lightOf(st: number): number {
  return st === B.HEARTH ? 4.2 : st === B.FORGE ? 3.2 : st === B.OVEN || st === B.KILN || st === B.GLASSFURN ? 2.4 : st === B.BLOOMERY ? 3 : st === B.TORCH ? 3 : st === B.STOVE ? 2 : st === B.LAMP ? 2.4 : st === B.BRAZIER ? 3.6 : st === B.CAULDRON ? 1.6
    : st === B.LAMPPOST ? 3.4 : st === B.WAYSHRINE ? 1.4 : 0;
}

/**
 * Draw the built things of one block of tiles. `plan` holds, per tile, the code of something
 * planned but not built yet (drawn as a faint blueprint).
 */
export function drawStructs(c: Colony, g: Graphics, x0: number, y0: number, x1: number, y1: number, plan: Uint8Array, blds: Map<number, Bld>, pal: Pal): void {
  g.clear();
  // what the colony's discoveries add to things already standing: ditches and clover by the
  // fields, pennants on the towers (drawn last, over the tiles below them)
  const ditchK = knows(c, 'irrigation');
  const cloverK = knows(c, 'rotation');
  let dyed = false;
  for (const b of blds.values()) if (b.k === 'dyeworks' && b.built) { dyed = true; break; }
  const late: (() => void)[] = [];
  const W = c.w;
  const stAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= c.h ? 0 : c.st[y * W + x]);
  // the ditch in front of the town wall: a dark trench on the open ground just outside the line
  const ditch = (x: number, y: number): void => {
    const dx = x - c.cx;
    const dy = y - c.cy;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const ox = ax >= ay * 0.4142 ? Math.sign(dx) : 0;
    const oy = ay >= ax * 0.4142 ? Math.sign(dy) : 0;
    if (stAt(x + ox, y + oy)) return;
    const qx = (x + ox) * TS;
    const qy = (y + oy) * TS;
    g.rect(qx, qy, TS, TS).fill({ color: 0x2a2216, alpha: 0.32 });
    g.rect(qx + 3, qy + 3, TS - 6, TS - 6).fill({ color: 0x1a140c, alpha: 0.28 });
  };
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      const s = c.st[i];
      const px = x * TS;
      const py = y * TS;
      const cx = px + TS / 2;
      const cy = py + TS / 2;
      if (!s) {
        const want = plan[i];
        if (want) {
          const wall = want === B.WALL_WOOD || want === B.WALL_STONE || want === B.FENCE || want === B.CWALL || want === B.CTOWER || want === B.PALISADE;
          g.rect(px + 2, py + 2, TS - 4, TS - 4).fill({ color: 0xa5b0ff, alpha: wall ? 0.2 : 0.07 }).stroke({ width: 1, color: 0xa5b0ff, alpha: wall ? 0.5 : 0.28 });
        }
        continue;
      }
      const b = blds.get(c.sb[i]);
      const stone = !!b && b.mat === 1;
      const roofed = !!b && !OPEN_AIR.has(b.k);
      // a shack's floor is bare earth; a townhouse's or a manor's is fine red tile
      const kind = b ? (b.k === 'shack' ? 2 : b.k === 'townhouse' || b.k === 'manor' ? 3 : stone ? 1 : 0) : 0;
      const floor = (asStone: boolean = stone, fk: number = kind): void => {
        if (fk === 2) {
          g.rect(px, py, TS, TS).fill(0x7d6a52);
          for (let n = 0; n < 5; n++) g.circle(px + 3 + hash2(x, y, 40 + n) * 18, py + 3 + hash2(x, y, 50 + n) * 18, 0.8 + hash2(x, y, 60 + n) * 1.2).fill({ color: n % 2 ? 0x5e4e3b : 0x9a8668, alpha: 0.8 });
        } else if (fk === 3) {
          // glazed tiles, laid on the diagonal in two reds, with pale grout
          g.rect(px, py, TS, TS).fill((x + y) & 1 ? 0xa2503c : 0xb8664a);
          g.rect(px, py + 11.5, TS, 1).rect(px + 11.5, py, 1, TS).fill({ color: 0xead7b4, alpha: 0.55 });
          g.poly([px + 12, py + 4, px + 20, py + 12, px + 12, py + 20, px + 4, py + 12]).fill({ color: 0xd88a5e, alpha: 0.35 });
        } else if (asStone) {
          // pale, warm flagstones: clearly lighter than the walls around them
          g.rect(px, py, TS, TS).fill(0xc2b8a3);
          g.rect(px, py + 11.5, TS, 1).rect(px + ((x + y) & 1 ? 7 : 15), py, 1, 11.5).rect(px + ((x + y) & 1 ? 15 : 7), py + 12, 1, 12).fill({ color: 0x8c8270, alpha: 0.6 });
        } else {
          g.rect(px, py, TS, TS).fill(0xb48b5a);
          g.rect(px, py + 7.5, TS, 1).rect(px, py + 15.5, TS, 1).rect(px + ((x * 7 + y * 3) % 17) + 3, py, 1, 7.5).rect(px + ((x * 5 + y * 11) % 17) + 3, py + 8, 1, 7.5).fill({ color: 0x6e5133, alpha: 0.5 });
        }
        // walls cast a shadow into the room (light from the south-east, as on the map)
        if (isWall(stAt(x, y - 1))) g.rect(px, py, TS, 6).fill({ color: 0x1a120a, alpha: 0.32 });
        if (isWall(stAt(x - 1, y))) g.rect(px, py, 5, TS).fill({ color: 0x1a120a, alpha: 0.22 });
      };
      const shade = (sx: number, sy: number, w: number, h: number, r: number): void => {
        g.roundRect(sx + 1.5, sy + 2, w, h, r).fill({ color: 0x140c06, alpha: 0.28 });
      };
      if (s >= B.BED && roofed && s !== B.GRAVE && (s < B.FLOOR_BARE || s === B.STRAW || CASTLE_FURN.has(s) || (isTechThing(s) && s !== B.WHEEL))) floor();

      switch (s) {
        case B.FLOOR_WOOD:
        case B.FLOOR_STONE:
          floor(s === B.FLOOR_STONE, kind >= 2 ? kind : s === B.FLOOR_STONE ? 1 : 0);
          break;
        case B.FLOOR_BARE:
          floor(false, 2);
          break;
        case B.FLOOR_FINE:
          floor(false, 3);
          break;
        case B.WALL_WOOD:
        case B.WALL_STONE: {
          // walls are dark and raised: a near-black outline, a darker face on the south side,
          // and a top that runs on into neighbouring walls so they read as one thick wall
          const wood = s === B.WALL_WOOD;
          const poorWall = kind === 2;
          const fineWall = kind === 3 && wood;
          // a fine house in stone is of pale dressed ashlar, not grey rubble
          const ashlar = kind === 3 && !wood;
          const edge = poorWall ? 0x2f2a24 : wood ? 0x2e1f14 : ashlar ? 0x3a3630 : 0x2a2c32;
          const face = poorWall ? 0x5d5446 : fineWall ? 0x8a7a62 : wood ? 0x5a3c26 : ashlar ? 0xa3967c : 0x50545d;
          const top = poorWall ? 0x857a66 : fineWall ? 0xe2d6bc : wood ? 0x86603d : ashlar ? 0xdacdb0 : 0x7b808b;
          g.rect(px, py, TS, TS).fill(edge);
          const l = isWall(stAt(x - 1, y)) ? 0 : 2;
          const r = isWall(stAt(x + 1, y)) ? 0 : 2;
          const u = isWall(stAt(x, y - 1)) ? 0 : 2;
          const d = isWall(stAt(x, y + 1)) ? 0 : 7;
          g.rect(px + l, py + u, TS - l - r, TS - u - (d ? 2 : 0)).fill(face);
          g.rect(px + l, py + u, TS - l - r, TS - u - d).fill(top);
          if (poorWall) {
            // odd boards, gapped and patched
            g.rect(px + l, py + 6 + ((x * 3 + y) % 3), TS - l - r, 1).rect(px + l, py + 13 + ((x + y * 5) % 3), TS - l - r, 1).fill({ color: 0x2f2a24, alpha: 0.6 });
            if (hash2(x, y, 71) < 0.3) g.rect(px + 5 + hash2(x, y, 72) * 10, py + u + 2, 6, 5).fill({ color: 0x6e5a44, alpha: 0.9 });
          } else if (fineWall) {
            // limewash between dark timbers
            g.rect(px + l, py + u, TS - l - r, 2).rect(px + l, py + TS - d - 2, TS - l - r, 2).fill({ color: 0x4a3322, alpha: 0.85 });
            if ((x + y) % 2 === 0) g.rect(cx - 1, py + u, 2, TS - u - d).fill({ color: 0x4a3322, alpha: 0.85 });
          } else if (wood) {
            // log ends and grain
            g.rect(px + l, py + 7, TS - l - r, 1).rect(px + l, py + 14, TS - l - r, 1).fill({ color: 0x3a2716, alpha: 0.55 });
          } else {
            // cut blocks, offset row to row
            const off = (x + y) & 1 ? 6 : 14;
            g.rect(px + l, py + 8, TS - l - r, 1).fill({ color: 0x3a3d44, alpha: 0.7 });
            g.rect(px + off, py + u, 1, 8 - u).rect(px + ((off + 8) % 20) + 2, py + 9, 1, Math.max(0, TS - d - 9)).fill({ color: 0x3a3d44, alpha: 0.7 });
            g.rect(px + l, py + u, TS - l - r, 1).fill({ color: 0xb8bcc6, alpha: 0.5 });
          }
          // a glazed home: glass in every other stretch of straight wall
          if (b?.gl) {
            const ew = isWall(stAt(x - 1, y)) && isWall(stAt(x + 1, y)) && !isWall(stAt(x, y - 1)) && !isWall(stAt(x, y + 1));
            const ns = isWall(stAt(x, y - 1)) && isWall(stAt(x, y + 1)) && !isWall(stAt(x - 1, y)) && !isWall(stAt(x + 1, y));
            if ((ew && x % 2 === 0) || (ns && y % 2 === 0)) drawWindow(g, x, y, ew, false);
          }
          if (pal.snow > 0.5) g.rect(px + l, py + u, TS - l - r, 3).fill({ color: 0xf2f5f7, alpha: 0.55 });
          // a wall that steps diagonally (round towers, cut corners) is joined by a slanted piece
          // drawn over the empty corner between the two
          for (const dy of [-1, 1]) {
            if (!isWall(stAt(x + 1, y + dy)) || isWall(stAt(x + 1, y)) || isWall(stAt(x, y + dy))) continue;
            const side = stAt(x + 1, y) === 0; // the gap is beside us (else above or below us)
            if (!side && stAt(x, y + dy) !== 0) continue;
            const kx = px + TS;
            const ky = dy > 0 ? py + TS : py;
            const tri = side ? [kx, ky, kx, dy > 0 ? py : py + TS, kx + TS, ky] : [kx, ky, px, ky, kx, ky + dy * TS];
            g.poly(tri).fill(edge);
            // inset a little so the dark edge shows round the slanted top
            const mx = (tri[0] + tri[2] + tri[4]) / 3;
            const my = (tri[1] + tri[3] + tri[5]) / 3;
            g.poly(tri.map((v, i) => (i % 2 ? my + (v - my) * 0.8 : mx + (v - mx) * 0.8))).fill(top);
          }
          break;
        }
        case B.DOOR: {
          if (b && (b.k === 'gatehouse' || b.k === 'palisade')) {
            // a castle gate: a flagged way through, with heavy oak leaves swung back and an iron portcullis drawn up
            const across = isWall(stAt(x - 1, y)) || isWall(stAt(x + 1, y)) || stAt(x - 1, y) === B.PALISADE || stAt(x + 1, y) === B.PALISADE;
            g.rect(px, py, TS, TS).fill(b.k === 'palisade' ? 0x8a7a5e : 0xcfc4aa);
            if (across) {
              g.rect(px, py + 2, TS, 3).fill({ color: 0x2c2f36, alpha: 0.85 });
              for (let n = 0; n < 6; n++) g.rect(px + 1.5 + n * 4, py + 1, 1.2, 5).fill(0x2c2f36);
              g.rect(px + 1, py + 6, 5, 14).rect(px + TS - 6, py + 6, 5, 14).fill(0x6a4426);
              g.rect(px + 1, py + 9, 5, 1.2).rect(px + TS - 6, py + 9, 5, 1.2).rect(px + 1, py + 16, 5, 1.2).rect(px + TS - 6, py + 16, 5, 1.2).fill(0x2c2f36);
            } else {
              g.rect(px + 2, py, 3, TS).fill({ color: 0x2c2f36, alpha: 0.85 });
              for (let n = 0; n < 6; n++) g.rect(px + 1, py + 1.5 + n * 4, 5, 1.2).fill(0x2c2f36);
              g.rect(px + 6, py + 1, 14, 5).rect(px + 6, py + TS - 6, 14, 5).fill(0x6a4426);
              g.rect(px + 9, py + 1, 1.2, 5).rect(px + 9, py + TS - 6, 1.2, 5).rect(px + 16, py + 1, 1.2, 5).rect(px + 16, py + TS - 6, 1.2, 5).fill(0x2c2f36);
            }
            break;
          }
          if (b && b.k === 'graveyard') {
            g.rect(px + 1, py + 10, 22, 3).fill(0x9a7a50);
            g.circle(px + 2.5, cy, 3).circle(px + 21.5, cy, 3).fill(0x5a4030);
            break;
          }
          // a gap in the wall: dark frame posts, a worn threshold stone, and the door swung open
          floor();
          const across = isWall(stAt(x - 1, y)) || isWall(stAt(x + 1, y));
          const post = stone ? 0x2a2c32 : 0x2e1f14;
          if (across) {
            g.rect(px + 3, py + 6, 18, 12).fill(0x9a8f7c);
            g.rect(px + 3, py + 6, 18, 2).fill({ color: 0x000000, alpha: 0.18 });
            g.rect(px, py + 4, 4, 16).rect(px + TS - 4, py + 4, 4, 16).fill(post);
            g.moveTo(px + 4, py + 17).arc(px + 4, py + 17, 13, -Math.PI / 2, 0).stroke({ width: 1, color: 0xf2e6c8, alpha: 0.45 });
            g.roundRect(px + 3, py + 3, 3.5, 14, 1).fill(0x6a4426).stroke({ width: 1, color: 0x2a1d12 });
            g.rect(px + 3, py + 6, 3.5, 1.2).rect(px + 3, py + 13, 3.5, 1.2).fill(0x2c2f36);
          } else {
            g.rect(px + 6, py + 3, 12, 18).fill(0x9a8f7c);
            g.rect(px + 6, py + 3, 2, 18).fill({ color: 0x000000, alpha: 0.18 });
            g.rect(px + 4, py, 16, 4).rect(px + 4, py + TS - 4, 16, 4).fill(post);
            g.moveTo(px + 7, py + 4).arc(px + 7, py + 4, 13, 0, Math.PI / 2).stroke({ width: 1, color: 0xf2e6c8, alpha: 0.45 });
            g.roundRect(px + 3, py + 3, 14, 3.5, 1).fill(0x6a4426).stroke({ width: 1, color: 0x2a1d12 });
            g.rect(px + 6, py + 3, 1.2, 3.5).rect(px + 13, py + 3, 1.2, 3.5).fill(0x2c2f36);
          }
          break;
        }
        case B.GATE: {
          // a gate in the town wall: a way through, its heavy leaves swung back by day, shut and
          // barred at night and whenever there is trouble
          const shut = !!c.walls?.shut;
          const across = isLine(stAt(x - 1, y)) || isLine(stAt(x + 1, y));
          const down = !across && (isLine(stAt(x, y - 1)) || isLine(stAt(x, y + 1)));
          const stoneG = !!b && b.mat === 1;
          g.rect(px, py, TS, TS).fill(stoneG ? 0xcfc4aa : 0x8a7a5e);
          if (stoneG) g.rect(px, py + 11.5, TS, 1).rect(px + 11.5, py, 1, TS).fill({ color: 0x9a907a, alpha: 0.6 });
          const oak = 0x6a4426;
          const band = 0x2c2f36;
          if (shut) {
            // the leaves closed, planked, iron-banded, and a beam across them
            if (across || !down) {
              g.rect(px, py + 5, TS, 14).fill(oak).stroke({ width: 1, color: 0x2a1d12 });
              for (let n = 1; n < 4; n++) g.rect(px + n * 6, py + 5, 0.8, 14).fill({ color: 0x2a1d12, alpha: 0.6 });
              g.rect(px, py + 8, TS, 1.4).rect(px, py + 15, TS, 1.4).fill(band);
              g.rect(px, py + 11, TS, 2.4).fill(0x4a2e18);
            } else {
              g.rect(px + 5, py, 14, TS).fill(oak).stroke({ width: 1, color: 0x2a1d12 });
              for (let n = 1; n < 4; n++) g.rect(px + 5, py + n * 6, 14, 0.8).fill({ color: 0x2a1d12, alpha: 0.6 });
              g.rect(px + 8, py, 1.4, TS).rect(px + 15, py, 1.4, TS).fill(band);
              g.rect(px + 11, py, 2.4, TS).fill(0x4a2e18);
            }
          } else if (across || !down) {
            // open: the leaves stand back against the gateway's sides
            g.rect(px, py + 2, TS, 3).fill({ color: band, alpha: 0.85 });
            g.rect(px + 1, py + 6, 4, 13).rect(px + TS - 5, py + 6, 4, 13).fill(oak);
            g.rect(px + 1, py + 9, 4, 1.2).rect(px + TS - 5, py + 9, 4, 1.2).rect(px + 1, py + 16, 4, 1.2).rect(px + TS - 5, py + 16, 4, 1.2).fill(band);
          } else {
            g.rect(px + 2, py, 3, TS).fill({ color: band, alpha: 0.85 });
            g.rect(px + 6, py + 1, 13, 4).rect(px + 6, py + TS - 5, 13, 4).fill(oak);
            g.rect(px + 9, py + 1, 1.2, 4).rect(px + 9, py + TS - 5, 1.2, 4).rect(px + 16, py + 1, 1.2, 4).rect(px + 16, py + TS - 5, 1.2, 4).fill(band);
          }
          break;
        }
        case B.RUBBLE: {
          // a breach: tumbled stones (or broken stakes) and splinters, passable with care
          const wood = !b || !b.mat;
          g.rect(px, py, TS, TS).fill({ color: 0x5a5146, alpha: 0.55 });
          for (let n = 0; n < 7; n++) {
            const rx = px + 2 + hash2(x, y, 70 + n) * 18;
            const ry = py + 2 + hash2(x, y, 80 + n) * 18;
            if (wood && n % 2) g.roundRect(rx - 4, ry - 1, 9, 2.6, 1).fill(0x7a5232).stroke({ width: 0.6, color: 0x2a1d12 });
            else g.circle(rx, ry, 1.6 + hash2(x, y, 90 + n) * 2.2).fill(n % 3 ? 0x8d8e96 : 0x6e6f77).stroke({ width: 0.6, color: 0x2a2b31 });
          }
          break;
        }
        case B.CWALL:
        case B.CTOWER: {
          if (b && WALL_PARTS.has(b.k)) ditch(x, y);
          // the castle's walls: thick dressed stone, darker and heavier than any house wall, with
          // merlons along the wall-walk; the towers rounder and capped with a ring of them
          const tower = s === B.CTOWER;
          const edge = 0x1c1d22;
          const face = tower ? 0x55555c : 0x5f6068;
          const top = tower ? 0x8d8e96 : 0x9a9ba3;
          g.rect(px, py, TS, TS).fill(edge);
          const l = isWall(stAt(x - 1, y)) ? 0 : 1.5;
          const r = isWall(stAt(x + 1, y)) ? 0 : 1.5;
          const u = isWall(stAt(x, y - 1)) ? 0 : 1.5;
          const d = isWall(stAt(x, y + 1)) ? 0 : 8;
          g.rect(px + l, py + u, TS - l - r, TS - u - (d ? 1.5 : 0)).fill(face);
          g.rect(px + l, py + u, TS - l - r, TS - u - d).fill(top);
          // coursed blocks on the face
          if (d) g.rect(px + l, py + TS - 5, TS - l - r, 1).rect(px + l + ((x & 1) ? 5 : 11), py + TS - 9.5, 1, 4).fill({ color: 0x2a2b31, alpha: 0.7 });
          // the wall-walk: a darker strip down the middle, merlons along the open sides
          const ns = isCastleWall(stAt(x, y - 1)) || isCastleWall(stAt(x, y + 1));
          const ew = isCastleWall(stAt(x - 1, y)) || isCastleWall(stAt(x + 1, y));
          const walk = tower ? 0x6e6f77 : 0x7d7e86;
          if (ew || !ns) g.rect(px + l, cy - 3, TS - l - r, 6).fill(walk);
          if (ns) g.rect(cx - 3, py + u, 6, TS - u - d).fill(walk);
          const merlon = (mx: number, my: number): void => { g.rect(mx, my, 4.5, 4.5).fill(tower ? 0xa9aab2 : 0xb6b7bf).stroke({ width: 0.8, color: edge }); };
          if (ew || !ns) for (const mx of [px + 2, px + 9.5, px + 17]) { if (!isCastleWall(stAt(x, y - 1))) merlon(mx, py + u + 0.5); if (!isCastleWall(stAt(x, y + 1))) merlon(mx, py + TS - d - 5); }
          if (ns) for (const my of [py + 2, py + 9.5, py + 17]) { if (!isCastleWall(stAt(x - 1, y))) merlon(px + l + 0.5, my); if (!isCastleWall(stAt(x + 1, y))) merlon(px + TS - r - 5, my); }
          if (tower) g.rect(px + l, py + u, TS - l - r, TS - u - d).stroke({ width: 1.2, color: 0x3a3b42, alpha: 0.6 });
          // a pennant on each tower, once the colony can dye cloth
          // (at the top corner of each tower: over the middle of a square tower, on top of a narrow one)
          if (tower && dyed && stAt(x - 1, y) !== B.CTOWER && stAt(x, y - 1) !== B.CTOWER) {
            const [field, metal] = houseColours(c);
            const sq = stAt(x + 2, y) === B.CTOWER && stAt(x, y + 2) === B.CTOWER;
            late.push(() => drawPennant(g, sq ? x + 1 : x, sq ? y + 1 : y, field, metal));
          }
          if (pal.snow > 0.5) g.rect(px + l, py + u, TS - l - r, 3).fill({ color: 0xf2f5f7, alpha: 0.55 });
          break;
        }
        case B.PALISADE: {
          // the town's palisade has a ditch dug in front of it
          if (b && WALL_PARTS.has(b.k)) ditch(x, y);
          // a ring of sharpened stakes: logs side by side along the line, points outward
          const link = (dx: number, dy: number): boolean => { const n = stAt(x + dx, y + dy); return n === B.PALISADE || n === B.GATE || (n === B.DOOR && c.sb[(y + dy) * W + x + dx] === c.sb[i]); };
          const along = link(-1, 0) || link(1, 0);
          g.rect(px + (along ? 0 : 6), py + (along ? 6 : 0), along ? TS : 12, along ? 12 : TS).fill({ color: 0x140c06, alpha: 0.3 });
          for (let n = 0; n < 4; n++) {
            const o = 3 + n * 6;
            if (along) {
              g.roundRect(px + o - 2.6, py + 5, 5.2, 13, 2).fill(n % 2 ? 0x7a5232 : 0x8a6440).stroke({ width: 0.9, color: 0x2a1d12 });
              g.circle(px + o, py + 6.5, 1.6).fill(0xc9a27a);
            } else {
              g.roundRect(px + 5, py + o - 2.6, 13, 5.2, 2).fill(n % 2 ? 0x7a5232 : 0x8a6440).stroke({ width: 0.9, color: 0x2a1d12 });
              g.circle(px + 6.5, py + o, 1.6).fill(0xc9a27a);
            }
          }
          break;
        }
        case B.THRONE: {
          // a high-backed seat on a dais, cushioned in the house's colour
          const [field, metal] = houseColours(c);
          g.roundRect(px + 1, py + 1, 22, 22, 3).fill(0x8a7a5e).stroke({ width: 1, color: 0x3a3226 });
          shade(px + 5, py + 3, 14, 18, 2);
          g.roundRect(px + 5, py + 2, 14, 18, 2).fill(0x6a4426).stroke({ width: 1.2, color: 0x2a1d12 });
          g.roundRect(px + 5.5, py + 2, 13, 6, 2).fill(metal).stroke({ width: 0.8, color: 0x2a1d12 });
          g.roundRect(px + 7, py + 9, 10, 9, 1.5).fill(field);
          g.circle(cx, py + 5, 1.6).fill(field);
          break;
        }
        case B.BANNER: {
          // a banner on a staff, in the ruling house's colours
          const [field, metal] = houseColours(c);
          g.rect(px + 3, py + 2, 18, 2.2).fill(0x5a3d28);
          g.circle(px + 3, py + 3.1, 1.6).circle(px + 21, py + 3.1, 1.6).fill(0xd9b85a);
          g.poly([px + 6, py + 4, px + 18, py + 4, px + 18, py + 20, cx, py + 16.5, px + 6, py + 20]).fill(field).stroke({ width: 0.9, color: 0x1a120a });
          g.rect(cx - 1.4, py + 4, 2.8, 12.5).fill(metal);
          g.circle(cx, py + 9.5, 2.6).fill(metal).stroke({ width: 0.7, color: field });
          break;
        }
        case B.TAPESTRY: {
          // a long hanging against the wall: a hunt worked in wool
          const [field] = houseColours(c);
          g.rect(px + 1, py + 1, 22, 2).fill(0x5a3d28);
          g.rect(px + 2, py + 3, 20, 11).fill(mix(field, 0x6a5a3a, 0.45)).stroke({ width: 0.8, color: 0x2a1d12 });
          g.rect(px + 3, py + 4.5, 18, 8).stroke({ width: 0.8, color: 0xd9b85a, alpha: 0.8 });
          g.ellipse(px + 9, py + 9, 3, 1.6).fill(0xe8dcc0);
          g.circle(px + 15, py + 8.5, 1.4).fill(0x3f6a3a);
          for (let n = 0; n < 5; n++) g.rect(px + 3 + n * 4, py + 14, 1, 2).fill(0xd9b85a);
          break;
        }
        case B.HAY: {
          // a bale of hay
          shade(px + 3, py + 4, 18, 15, 2);
          g.roundRect(px + 3, py + 4, 18, 15, 2).fill(0xd9b85a).stroke({ width: 1, color: 0x8a6a2a });
          g.rect(px + 3, py + 8.5, 18, 1.4).rect(px + 3, py + 14, 18, 1.4).fill(0x8a6a2a);
          for (let n = 0; n < 5; n++) g.moveTo(px + 5 + n * 3.5, py + 5).lineTo(px + 6 + n * 3.5, py + 18).stroke({ width: 0.6, color: 0xb8963a, alpha: 0.8 });
          break;
        }
        case B.FENCE: {
          const link = (dx: number, dy: number): boolean => { const n = stAt(x + dx, y + dy); return n === B.FENCE || n === B.DOOR; };
          if (link(-1, 0)) g.rect(px, cy - 1.5, 12, 3).fill(0x8a6a44);
          if (link(1, 0)) g.rect(cx, cy - 1.5, 12, 3).fill(0x8a6a44);
          if (link(0, -1)) g.rect(cx - 1.5, py, 3, 12).fill(0x8a6a44);
          if (link(0, 1)) g.rect(cx - 1.5, cy, 3, 12).fill(0x8a6a44);
          g.circle(cx, cy, 3).fill(0x5a4030);
          g.circle(cx - 0.6, cy - 0.6, 1.5).fill(0x9a7a50);
          break;
        }
        case B.TILLED: {
          const frozen = pal.snow > 0.5;
          g.rect(px, py, TS, TS).fill(frozen ? 0x8f887e : 0x5d4630);
          g.rect(px, py + 3, TS, 2).rect(px, py + 11, TS, 2).rect(px, py + 19, TS, 2).fill({ color: frozen ? 0x7a746b : 0x473424, alpha: 0.9 });
          if (b && (ditchK || cloverK)) drawFieldWorks(g, b, x, y, ditchK, cloverK, frozen);
          const v = c.crop[i];
          if (!v) break;
          const kind = b?.crop ?? 'grain';
          const ripe = v >= 200;
          const gr = ripe ? 1 : v / 200;
          for (let row = 0; row < 3; row++) {
            for (let n = 0; n < 3; n++) {
              const qx = px + 4 + n * 8 + (hash2(x * 3 + n, y * 3 + row, 11) - 0.5) * 2;
              const qy = py + 4 + row * 8;
              if (ripe) drawCrop(g, kind, qx, qy);
              else g.circle(qx, qy, 0.9 + gr * 2.2).fill(mix(0x86c466, CROP_LEAF[kind] ?? 0x4f9a3e, gr));
            }
          }
          break;
        }
        case B.BED:
        case B.COT: {
          const cot = s === B.COT;
          shade(px + 3, py + 1, 18, 22, 2.5);
          g.roundRect(px + 3, py + 1, 18, 22, 2.5).fill(cot ? 0x8f8a80 : 0x6e4b2f).stroke({ width: 1.2, color: 0x2a1d12 });
          g.roundRect(px + 4.5, py + 2.5, 15, 19, 1.5).fill(0xe9e3d5);
          g.roundRect(px + 6.5, py + 3.5, 11, 5, 2).fill(0xffffff).stroke({ width: 0.8, color: 0xb9b1a0 });
          g.roundRect(px + 4.5, py + 10.5, 15, 11, 1.5).fill(cot ? 0xb9c7d6 : blanketColor(i));
          g.rect(px + 4.5, py + 10.5, 15, 2).fill({ color: 0xffffff, alpha: 0.3 });
          break;
        }
        case B.TABLE:
          shade(px + 1.5, py + 3, 21, 18, 3);
          g.roundRect(px + 1.5, py + 3, 21, 18, 3).fill(0xa87a4a).stroke({ width: 1.2, color: 0x2a1d12 });
          g.rect(px + 2.5, py + 9, 19, 0.8).rect(px + 2.5, py + 15, 19, 0.8).fill({ color: 0x5d4028, alpha: 0.55 });
          g.circle(cx - 4, cy - 1, 2.6).fill(0xe9e3d5).stroke({ width: 0.8, color: 0x8a8070 });
          g.circle(cx + 5, cy + 1.5, 1.8).fill(0xc9a24a);
          break;
        case B.CHAIR:
          shade(px + 6, py + 6, 12, 13, 3);
          g.roundRect(px + 6, py + 7, 12, 12, 3).fill(0xa47a4c).stroke({ width: 1.2, color: 0x2a1d12 });
          g.roundRect(px + 5.5, py + 4.5, 13, 4, 1.5).fill(0x5d4028).stroke({ width: 1, color: 0x2a1d12 });
          break;
        case B.HEARTH:
          g.circle(cx, cy, 14).fill({ color: 0xff9a3a, alpha: 0.14 });
          g.roundRect(px + 1.5, py + 1.5, 21, 21, 4).fill(0x5d6068);
          g.roundRect(px + 4.5, py + 4.5, 15, 15, 3).fill(0x2a2422);
          g.circle(cx, cy + 0.8, 5.2).fill(0xe8662a);
          g.circle(cx - 0.6, cy + 1.4, 3.1).fill(0xffc24a);
          g.circle(cx - 0.8, cy + 2, 1.4).fill(0xfff1c2);
          break;
        case B.STOVE:
          g.roundRect(px + 2.5, py + 2.5, 19, 19, 2.5).fill(0x3a3d45);
          g.circle(cx - 4.2, cy - 3.2, 3.2).circle(cx + 4.2, cy - 3.2, 3.2).fill(0x1f2126);
          g.circle(cx - 4.2, cy - 3.2, 1.6).fill(0x6b7280);
          g.roundRect(cx - 5.5, cy + 3.5, 11, 3.2, 1).fill(0xe8662a);
          break;
        case B.BENCH:
          // a workbench: a hammer and a saw on top, so it reads as a place of work
          shade(px + 1.5, py + 5, 21, 14, 2);
          g.roundRect(px + 1.5, py + 5, 21, 14, 2).fill(0x9a744a).stroke({ width: 1.2, color: 0x2a1d12 });
          g.rect(px + 4, py + 9, 9, 2.4).fill(0x4b4f58);
          g.rect(px + 7.5, py + 9, 2, 7).fill(0x7d5836);
          g.poly([px + 14, py + 8, px + 20, py + 8, px + 20, py + 16, px + 14, py + 13]).fill(0xc9ccd4).stroke({ width: 0.8, color: 0x4b4f58 });
          break;
        case B.ANVIL:
          g.ellipse(cx + 1, cy + 5, 8, 3.5).fill({ color: 0x0b1220, alpha: 0.25 });
          g.rect(cx - 4, cy + 1, 8, 6).fill(0x2c2f36);
          g.roundRect(cx - 8.5, cy - 5.5, 14, 7.5, 2).fill(0x4b4f58);
          g.poly([cx + 5, cy - 5.5, cx + 11, cy - 2, cx + 5, cy + 2]).fill(0x4b4f58);
          g.rect(cx - 7, cy - 4.5, 10, 1.5).fill({ color: 0xffffff, alpha: 0.25 });
          break;
        case B.FORGE:
          g.circle(cx, cy, 13).fill({ color: 0xff7a3a, alpha: 0.14 });
          g.roundRect(px + 1.5, py + 1.5, 21, 21, 3).fill(0x55585f);
          g.circle(cx, cy, 7.4).fill(0x241c1c);
          g.circle(cx, cy, 5.4).fill(0xd9482a);
          g.circle(cx - 1, cy - 1, 2.6).fill(0xffb347);
          break;
        case B.CRATE:
          shade(px + 4, py + 4, 16, 16, 1);
          g.rect(px + 4, py + 4, 16, 16).fill(0xb48a54).stroke({ width: 1.4, color: 0x2a1d12 });
          g.rect(px + 4, py + 9, 16, 1).rect(px + 4, py + 14.5, 16, 1).fill({ color: 0x6b4c2c, alpha: 0.7 });
          g.moveTo(px + 5, py + 5).lineTo(px + 19, py + 19).stroke({ width: 1.4, color: 0x6b4c2c });
          break;
        case B.BARREL:
          shade(cx - 8.5, cy - 8.5, 17, 17, 8.5);
          g.circle(cx, cy, 8.5).fill(0x9a6a3c).stroke({ width: 1.2, color: 0x2a1d12 });
          g.circle(cx, cy, 6.8).stroke({ width: 1.6, color: 0x4b4f58 });
          g.circle(cx, cy, 3.6).fill(0xb8864e);
          g.circle(cx, cy, 1.2).fill(0x4d3524);
          break;
        case B.ALTAR:
          g.roundRect(px + 2, py + 5, 20, 14, 2).fill(0xcfd3da);
          g.rect(cx - 3.5, py + 5, 7, 14).fill(0x7c8cff);
          g.circle(px + 5.5, cy, 1.7).circle(px + 18.5, cy, 1.7).fill(0xffd36a);
          break;
        case B.PEW:
          shade(px + 2, py + 6, 20, 10.5, 2);
          g.roundRect(px + 2, py + 8, 20, 8.5, 2).fill(0xa47a4c).stroke({ width: 1.1, color: 0x2a1d12 });
          g.roundRect(px + 2, py + 6, 20, 3, 1.2).fill(0x5d4028);
          break;
        case B.LOOM:
          g.rect(px + 4, py + 3, 16, 18).stroke({ width: 2, color: 0x7d5836 });
          g.rect(px + 7, py + 4, 1, 16).rect(px + 10, py + 4, 1, 16).rect(px + 13, py + 4, 1, 16).rect(px + 16, py + 4, 1, 16).fill(0xe9e3d5);
          g.rect(px + 5, py + 13, 14, 6).fill(0xb86a6a);
          break;
        case B.WELL:
          g.ellipse(cx + 1.5, cy + 3, 11, 9).fill({ color: 0x0b1220, alpha: 0.22 });
          g.circle(cx, cy, 10.5).fill(0x8c9099);
          g.circle(cx, cy, 7.2).fill(0x1f4560);
          g.circle(cx - 2, cy - 2, 2.2).fill({ color: 0xffffff, alpha: 0.2 });
          g.rect(cx - 11.5, cy - 1.3, 23, 2.6).fill(0x6e4b2f);
          break;
        case B.GRAVE:
          g.ellipse(cx, cy + 4, 6.5, 8).fill(pal.snow > 0.5 ? 0xb9c0c2 : 0x6b5a45);
          g.roundRect(cx - 5, py + 0.5, 10, 8.5, 3.5).fill(0xa9adb5);
          g.rect(cx - 2.5, py + 3.5, 5, 1).rect(cx - 2.5, py + 5.5, 5, 1).fill({ color: 0x4b4f58, alpha: 0.7 });
          break;
        case B.SHELF:
          // a shelf of jars and bundles
          shade(px + 2, py + 2.5, 20, 9, 1.5);
          g.roundRect(px + 2, py + 2.5, 20, 9, 1.5).fill(0x7d5836).stroke({ width: 1.1, color: 0x2a1d12 });
          g.roundRect(px + 4, py + 4, 4, 6, 1).fill(0x8fb4f0);
          g.roundRect(px + 9.5, py + 4, 4, 6, 1).fill(0x86c466);
          g.roundRect(px + 15, py + 4, 5, 6, 1).fill(0xe2933a);
          break;
        case B.STATUE:
          g.ellipse(cx + 1.5, cy + 3, 9, 7).fill({ color: 0x0b1220, alpha: 0.22 });
          g.circle(cx, cy, 8.5).fill(0x70747c);
          g.circle(cx, cy - 1, 5).fill(0xb9bdc5);
          g.circle(cx - 1.2, cy - 2.2, 2).fill(0xdfe2e8);
          break;
        case B.TORCH:
          g.circle(cx, cy, 9).fill({ color: 0xff9a3a, alpha: 0.16 });
          g.circle(cx, cy, 2.6).fill(0x5a3d28);
          g.circle(cx, cy, 1.9).fill(0xffc24a);
          break;
        case B.RUG: {
          // a woven rug: a coloured field with a border and a stripe
          const col = BLANKET[(x * 3 + y * 5) % BLANKET.length];
          g.roundRect(px + 1.5, py + 3, 21, 18, 2).fill(col);
          g.roundRect(px + 3.5, py + 5, 17, 14, 1.5).stroke({ width: 1.2, color: 0xf2e6c8, alpha: 0.55 });
          g.rect(px + 1.5, cy - 1, 21, 2).fill({ color: 0x000000, alpha: 0.18 });
          break;
        }
        case B.WARDROBE:
          shade(px + 3, py + 2, 18, 12, 1.5);
          g.roundRect(px + 3, py + 2, 18, 12, 1.5).fill(0x7a5232).stroke({ width: 1.2, color: 0x2a1d12 });
          g.rect(cx - 0.5, py + 3, 1, 10).fill(0x2a1d12);
          g.circle(cx - 2.5, py + 8, 0.9).circle(cx + 2.5, py + 8, 0.9).fill(0xd9b85a);
          break;
        case B.LAMP:
          g.circle(cx, cy, 10).fill({ color: 0xffd27a, alpha: 0.14 });
          shade(cx - 4, cy - 4, 8, 8, 4);
          g.circle(cx, cy, 4.2).fill(0x5a3d28).stroke({ width: 1, color: 0x2a1d12 });
          g.circle(cx, cy, 2.6).fill(0xffd27a);
          g.circle(cx - 0.6, cy - 0.6, 1).fill(0xfff6d8);
          break;
        case B.BOOKS: {
          // a bookcase: rows of coloured spines
          shade(px + 2, py + 2, 20, 10, 1.5);
          g.roundRect(px + 2, py + 2, 20, 10, 1.5).fill(0x5d4028).stroke({ width: 1.1, color: 0x2a1d12 });
          const spines = [0xb84a4a, 0x4f6fa8, 0x4f8a62, 0xd9b85a, 0x7a5a9a, 0xa8763f];
          for (let n = 0; n < 6; n++) g.rect(px + 3.5 + n * 3, py + 3.5 + (n % 2), 2.4, 7 - (n % 2)).fill(spines[(n + x) % spines.length]);
          break;
        }
        case B.DESK:
          shade(px + 2, py + 5, 20, 13, 1.5);
          g.roundRect(px + 2, py + 5, 20, 13, 1.5).fill(0xa87a4a).stroke({ width: 1.1, color: 0x2a1d12 });
          g.rect(px + 5, py + 8, 8, 6).fill(0xf2ead6);
          g.rect(px + 6, py + 9.5, 6, 0.8).rect(px + 6, py + 11.5, 5, 0.8).fill({ color: 0x4b4f58, alpha: 0.6 });
          g.moveTo(px + 15, py + 14).lineTo(px + 19, py + 8).stroke({ width: 1, color: 0x3a2a1c });
          break;
        case B.RACK:
          // a rack of spears and a shield
          shade(px + 2, py + 2, 20, 6, 1);
          g.rect(px + 2, py + 3, 20, 3).fill(0x5d4028);
          for (let n = 0; n < 3; n++) {
            g.moveTo(px + 5 + n * 5, py + 2).lineTo(px + 5 + n * 5, py + 20).stroke({ width: 1.4, color: 0x8a6440 });
            g.poly([px + 5 + n * 5, py + 0.5, px + 6.6 + n * 5, py + 3.5, px + 3.4 + n * 5, py + 3.5]).fill(0xc9ccd4);
          }
          g.circle(px + 19, py + 13, 4).fill(0x8a3a3a).stroke({ width: 1, color: 0xc9ccd4 });
          break;
        case B.CAULDRON:
          g.circle(cx, cy, 11).fill({ color: 0xff9a3a, alpha: 0.1 });
          shade(cx - 8, cy - 7, 16, 15, 7.5);
          g.circle(cx, cy + 1, 8).fill(0x2c2f36).stroke({ width: 1.2, color: 0x15171b });
          g.circle(cx, cy + 1, 6).fill(0x6e8a4a);
          g.circle(cx - 2, cy, 1.4).circle(cx + 2.4, cy + 2, 1).fill(0xa8c46a);
          g.roundRect(cx - 4, cy + 8.5, 8, 2.5, 1).fill(0xe8662a);
          break;
        case B.VAT:
          shade(cx - 10, cy - 10, 20, 20, 10);
          g.circle(cx, cy, 10).fill(0x8a5a32).stroke({ width: 1.3, color: 0x2a1d12 });
          g.circle(cx, cy, 8).stroke({ width: 1.4, color: 0x4b4f58 });
          g.circle(cx, cy, 6.4).fill(0xc98a3a);
          g.circle(cx - 2, cy - 2, 1.6).circle(cx + 2.4, cy + 1, 1.2).fill({ color: 0xf6f1e4, alpha: 0.8 });
          break;
        case B.BIN:
          // a grain bin: a lidded box with sacks spilling grain
          shade(px + 2.5, py + 3, 19, 18, 1.5);
          g.roundRect(px + 2.5, py + 3, 19, 18, 1.5).fill(0x9a744a).stroke({ width: 1.2, color: 0x2a1d12 });
          g.roundRect(px + 4.5, py + 5, 15, 9, 1).fill(0xe2c46a);
          for (let n = 0; n < 5; n++) g.circle(px + 6 + n * 3, py + 8 + (n % 2) * 2.5, 0.9).fill(0xc9a24a);
          g.rect(px + 2.5, py + 15, 19, 1).fill({ color: 0x2a1d12, alpha: 0.6 });
          break;
        case B.BATH:
          shade(px + 1.5, py + 3, 21, 18, 8);
          g.roundRect(px + 1.5, py + 3, 21, 18, 8).fill(0x8a6440).stroke({ width: 1.3, color: 0x2a1d12 });
          g.roundRect(px + 4, py + 5.5, 16, 13, 6).fill(0x6fa8c9);
          g.ellipse(cx - 2, cy - 1.5, 4, 2).fill({ color: 0xffffff, alpha: 0.35 });
          g.moveTo(cx - 3, py + 2).quadraticCurveTo(cx - 5, py - 1, cx - 3, py - 4).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
          g.moveTo(cx + 3, py + 2).quadraticCurveTo(cx + 1, py - 1, cx + 3, py - 4).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
          break;
        case B.CHESS: {
          shade(px + 2, py + 2, 20, 20, 2);
          g.roundRect(px + 2, py + 2, 20, 20, 2).fill(0x7a5232).stroke({ width: 1.2, color: 0x2a1d12 });
          for (let a = 0; a < 4; a++) for (let b2 = 0; b2 < 4; b2++) g.rect(px + 4 + a * 4, py + 4 + b2 * 4, 4, 4).fill((a + b2) & 1 ? 0x2a2422 : 0xe9e3d5);
          g.circle(px + 6, py + 6, 1.4).circle(px + 10, py + 6, 1.4).fill(0xf6f1e4).stroke({ width: 0.6, color: 0x2a2422 });
          g.circle(px + 14, py + 18, 1.4).circle(px + 18, py + 14, 1.4).fill(0x2a2422).stroke({ width: 0.6, color: 0xf6f1e4 });
          break;
        }
        case B.DARTS:
          // a dartboard on the wall
          g.circle(cx, py + 6, 7).fill(0x2a2422);
          g.circle(cx, py + 6, 5.6).fill(0xe9e3d5);
          g.circle(cx, py + 6, 3.8).fill(0xb84a4a);
          g.circle(cx, py + 6, 2).fill(0x4f8a62);
          g.circle(cx, py + 6, 0.8).fill(0xb84a4a);
          g.moveTo(cx + 1, py + 5).lineTo(cx + 4, py + 9).stroke({ width: 0.9, color: 0xd9b85a });
          break;
        case B.MUSIC:
          // a bench with a lute and a drum
          shade(px + 2, py + 8, 20, 10, 2);
          g.roundRect(px + 2, py + 8, 20, 10, 2).fill(0xa47a4c).stroke({ width: 1.1, color: 0x2a1d12 });
          g.ellipse(px + 8, py + 13, 4, 3.4).fill(0xd9a85a).stroke({ width: 0.8, color: 0x2a1d12 });
          g.moveTo(px + 11, py + 12).lineTo(px + 18, py + 7).stroke({ width: 1.4, color: 0x7a5232 });
          g.circle(px + 8, py + 13, 1).fill(0x2a1d12);
          g.circle(px + 17, py + 14, 3).fill(0xb84a4a).stroke({ width: 0.8, color: 0xe9e3d5 });
          break;
        case B.TROUGH:
          g.roundRect(px + 2, py + 7, 20, 10, 2).fill(0x7a5232).stroke({ width: 1.1, color: 0x2a1d12 });
          g.roundRect(px + 4, py + 9, 16, 6, 1.5).fill(0xc9b458);
          g.rect(px + 4, py + 11, 16, 1).fill({ color: 0x8a7a3a, alpha: 0.6 });
          break;
        case B.BRAZIER:
          g.circle(cx, cy, 13).fill({ color: 0xff9a3a, alpha: 0.14 });
          g.circle(cx, cy, 6.5).fill(0x3a3d45).stroke({ width: 1.2, color: 0x15171b });
          g.circle(cx, cy, 4.4).fill(0xe8662a);
          g.circle(cx - 0.8, cy - 0.6, 2.4).fill(0xffc24a);
          break;
        case B.DRYRACK:
          // herbs hung up to dry
          g.rect(px + 2, py + 3, 20, 2).fill(0x7a5232);
          for (let n = 0; n < 4; n++) {
            g.moveTo(px + 4.5 + n * 5, py + 5).lineTo(px + 4.5 + n * 5, py + 9).stroke({ width: 0.8, color: 0x7a5232 });
            g.ellipse(px + 4.5 + n * 5, py + 12, 2.2, 3.6).fill(n % 2 ? 0x6f9a4a : 0x8aa85a);
            g.circle(px + 4.5 + n * 5, py + 15, 1).fill(n % 2 ? 0xd9c9f2 : 0xf2e08a);
          }
          break;
        case B.STRAW:
          // a heap of straw with a coarse blanket thrown over it
          g.ellipse(cx + 1, cy + 1.5, 10, 9).fill({ color: 0x140c06, alpha: 0.2 });
          g.ellipse(cx, cy, 9.5, 9).fill(0xd2b25a);
          for (let n = 0; n < 6; n++) g.moveTo(px + 4 + n * 3, py + 5 + (n % 3)).lineTo(px + 6 + n * 3, py + 16 + (n % 2) * 2).stroke({ width: 0.8, color: 0xa88a3a, alpha: 0.8 });
          g.roundRect(px + 6, py + 11, 12, 8, 2).fill(0x7f7a6a);
          break;
        case B.GARDEN: {
          // a flower bed edged with clipped box
          const snowy = pal.snow > 0.5;
          g.rect(px, py, TS, TS).fill(snowy ? 0xc9d0cc : 0x557f3c);
          g.rect(px + 1, py + 1, TS - 2, TS - 2).stroke({ width: 2, color: snowy ? 0xa9b4ad : 0x3d6630 });
          if (!snowy) {
            const cols = [0xe8b84a, 0xd9667a, 0xf2ead6, 0xa77ad0, 0xe2803a];
            for (let n = 0; n < 6; n++) g.circle(px + 5 + hash2(x, y, 80 + n) * 14, py + 5 + hash2(x, y, 90 + n) * 14, 1.6).fill(cols[(n + x + y) % cols.length]);
          }
          break;
        }
        case B.PAVING:
          g.rect(px, py, TS, TS).fill(0xcfc4aa);
          g.rect(px, py + 11.5, TS, 1).rect(px + ((x + y) & 1 ? 8 : 15), py, 1, 11.5).rect(px + ((x + y) & 1 ? 14 : 6), py + 12, 1, 12).fill({ color: 0x9a8f78, alpha: 0.7 });
          break;
        case B.LOWWALL: {
          // a low garden wall of dressed stone, capped
          const link = (dx: number, dy: number): boolean => { const n = stAt(x + dx, y + dy); return n === B.LOWWALL || n === B.DOOR; };
          const seg = (sx: number, sy: number, w: number, h: number): void => { g.rect(sx, sy, w, h).fill(0x8c877c); g.rect(sx, sy, w, Math.min(h, 2.5)).fill(0xc9c3b4); };
          if (link(-1, 0)) seg(px, cy - 3.5, 12, 7);
          if (link(1, 0)) seg(cx, cy - 3.5, 12, 7);
          if (link(0, -1)) seg(cx - 3.5, py, 7, 12);
          if (link(0, 1)) seg(cx - 3.5, cy, 7, 12);
          g.rect(cx - 4, cy - 4, 8, 8).fill(0x8c877c).stroke({ width: 1, color: 0x4b4840 });
          g.rect(cx - 4, cy - 4, 8, 2.5).fill(0xd6d0c0);
          break;
        }
        case B.LAMPPOST:
          // seen from above: the lantern on its post, and its glow on the ground
          g.circle(cx, cy, 11).fill({ color: 0xffd27a, alpha: 0.12 });
          g.ellipse(cx + 3, cy + 4, 4, 2.4).fill({ color: 0x0b1220, alpha: 0.28 });
          g.circle(cx, cy, 2).fill(0x2c2f36);
          g.roundRect(cx - 3.6, cy - 5.6, 7.2, 7.2, 1.5).fill(0x2c2f36).stroke({ width: 1, color: 0x15171b });
          g.rect(cx - 2.2, cy - 4.2, 4.4, 4.4).fill(0xffd27a);
          g.circle(cx - 0.6, cy - 2.6, 0.9).fill(0xfff6d8);
          break;
        case B.SEAT:
          // a street bench of planks on two stone feet
          g.roundRect(px + 2.5, cy - 1, 19, 8, 1.5).fill({ color: 0x140c06, alpha: 0.22 });
          g.rect(px + 4, cy - 3, 3, 8).rect(px + 17, cy - 3, 3, 8).fill(0x8c877c);
          g.roundRect(px + 2, cy - 4.5, 20, 7, 1.5).fill(0x9a6e42).stroke({ width: 1.1, color: 0x2a1d12 });
          g.rect(px + 2.5, cy - 1.5, 19, 0.8).fill({ color: 0x5d4028, alpha: 0.6 });
          break;
        case B.SIGNPOST:
          // a post with boards pointing down the streets
          g.ellipse(cx + 3, cy + 4, 4, 2.4).fill({ color: 0x0b1220, alpha: 0.28 });
          g.poly([cx - 1, cy - 7, cx + 9, cy - 7, cx + 11.5, cy - 4.5, cx + 9, cy - 2, cx - 1, cy - 2]).fill(0xb8915c).stroke({ width: 1, color: 0x2a1d12 });
          g.poly([cx + 1, cy + 1, cx - 9, cy + 1, cx - 11.5, cy + 3.5, cx - 9, cy + 6, cx + 1, cy + 6]).fill(0xa47a4c).stroke({ width: 1, color: 0x2a1d12 });
          g.circle(cx, cy, 2.4).fill(0x5d4028).stroke({ width: 1, color: 0x2a1d12 });
          break;
        case B.FOUNTAIN:
          // a round stone basin with a spout in the middle
          g.ellipse(cx + 2, cy + 3, 12, 10).fill({ color: 0x0b1220, alpha: 0.22 });
          g.circle(cx, cy, 11.5).fill(0xa9a49a).stroke({ width: 1.2, color: 0x4b4840 });
          g.circle(cx, cy, 8.6).fill(pal.snow > 0.5 ? 0xd8e4ea : 0x4f9ac0);
          if (pal.snow <= 0.5) g.circle(cx, cy, 8.6).stroke({ width: 1.2, color: 0x8cc6dc, alpha: 0.6 });
          g.circle(cx, cy, 3).fill(0xc9c3b4).stroke({ width: 1, color: 0x4b4840 });
          g.circle(cx - 0.7, cy - 0.7, 1.2).fill(0xf2f8fb);
          break;
        case B.PUMP:
          // a town pump over a stone trough
          g.roundRect(px + 2, py + 9, 20, 10, 2).fill(0x8c877c).stroke({ width: 1.1, color: 0x4b4840 });
          g.roundRect(px + 4, py + 11, 16, 6, 1.5).fill(0x4f9ac0);
          g.roundRect(cx - 3.5, py + 1.5, 7, 9, 1.5).fill(0x3a3d45).stroke({ width: 1, color: 0x15171b });
          g.moveTo(cx + 3, py + 4).lineTo(cx + 9, py + 1).stroke({ width: 1.6, color: 0x3a3d45 });
          break;
        case B.WAYSHRINE:
          // a little roadside shrine: a stone niche with a candle burning in it
          g.circle(cx, cy, 8).fill({ color: 0xffd27a, alpha: 0.12 });
          g.ellipse(cx + 2, cy + 4, 8, 5).fill({ color: 0x0b1220, alpha: 0.25 });
          g.poly([cx - 8, cy + 6, cx - 8, cy - 3, cx, cy - 9, cx + 8, cy - 3, cx + 8, cy + 6]).fill(0x8c877c).stroke({ width: 1.1, color: 0x3a3830 });
          g.poly([cx - 8, cy - 3, cx, cy - 9, cx + 8, cy - 3, cx, cy - 6]).fill(0x6e5a44);
          g.roundRect(cx - 3, cy - 2, 6, 7, 2).fill(0x3a3830);
          g.circle(cx, cy + 1.5, 1.6).fill(0xffd27a);
          break;
        default:
          if (isTechThing(s)) drawTechThing(g, c, s, x, y);
          break;
      }
    }
  }
  for (const f of late) f();
}
