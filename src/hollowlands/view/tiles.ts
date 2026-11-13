// How the land and everything standing on it is drawn. Terrain is painted into a canvas
// (baked to one texture); natural features and built things are drawn as vector shapes into
// PixiJS Graphics, one map chunk at a time, so only chunks that changed get redrawn.

import type { Graphics } from 'pixi.js';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, TICKS_PER_DAY } from '../config';
import { B, F, T, type Bld, type Colony } from '../sim/types';
import { css, darken, lighten, mix } from './look';

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

/** Paint the whole ground. Called only when terrain or season changes. */
export function bakeTerrain(c: Colony, cv: HTMLCanvasElement, pal: Pal): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = c.w;
  const H = c.h;
  const cols = new Array<number>(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const col = (cols[y * W + x] = tileColor(c, pal, x, y));
      g.fillStyle = css(col);
      g.fillRect(x * TS, y * TS, TS, TS);
    }
  }
  // Soften the grid: where two neighbours at a corner share another ground, it rounds the corner.
  const R = 9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = c.ter[y * W + x];
      for (let k = 0; k < 4; k++) {
        const sx = k & 1 ? 1 : -1;
        const sy = k & 2 ? 1 : -1;
        const nx = x + sx;
        const ny = y + sy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const a = c.ter[y * W + nx];
        if (a === t || a !== c.ter[ny * W + x] || RANK[a] < RANK[t]) continue;
        const cx = x * TS + (sx > 0 ? TS : 0);
        const cy = y * TS + (sy > 0 ? TS : 0);
        g.fillStyle = css(cols[y * W + nx]);
        g.beginPath();
        g.moveTo(cx - sx * R, cy);
        g.arcTo(cx, cy, cx, cy - sy * R, R);
        g.lineTo(cx, cy);
        g.closePath();
        g.fill();
      }
    }
  }
  // Small details: tufts, pebbles, ripples, rock faces.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = c.ter[i];
      const px = x * TS;
      const py = y * TS;
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
        // a pale line where water meets land
        g.fillStyle = 'rgba(255,255,255,0.2)';
        if (x > 0 && !isWater(c.ter[i - 1])) g.fillRect(px, py, 2, TS);
        if (x < W - 1 && !isWater(c.ter[i + 1])) g.fillRect(px + TS - 2, py, 2, TS);
        if (y > 0 && !isWater(c.ter[i - W])) g.fillRect(px, py, TS, 2);
        if (y < H - 1 && !isWater(c.ter[i + W])) g.fillRect(px, py + TS - 2, TS, 2);
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

// ---------- Built things (vector) ----------

const BLANKET = [0x8a4a4a, 0x4f6fa8, 0x4f8a62, 0x7a5a9a, 0xa8763f, 0x3f8a8a];
/** Each bed keeps its own blanket colour; the sleeper is drawn under the same one. */
export const blanketColor = (tile: number): number => BLANKET[Math.floor(hash2(tile, 17, 9) * BLANKET.length) % BLANKET.length];

const isWall = (s: number): boolean => s === B.WALL_WOOD || s === B.WALL_STONE || s === B.DOOR;
const OPEN_AIR = new Set(['well', 'field', 'graveyard']);

/** A tile where firelight comes from, for the night lighting. 0 if none, else the radius in tiles. */
export function lightOf(st: number): number {
  return st === B.HEARTH ? 4.2 : st === B.FORGE ? 3.2 : st === B.TORCH ? 3 : st === B.STOVE ? 2 : 0;
}

/**
 * Draw the built things of one block of tiles. `plan` holds, per tile, the code of something
 * planned but not built yet (drawn as a faint blueprint).
 */
export function drawStructs(c: Colony, g: Graphics, x0: number, y0: number, x1: number, y1: number, plan: Uint8Array, blds: Map<number, Bld>, pal: Pal): void {
  g.clear();
  const W = c.w;
  const stAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= c.h ? 0 : c.st[y * W + x]);
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
          const wall = want === B.WALL_WOOD || want === B.WALL_STONE || want === B.FENCE;
          g.rect(px + 2, py + 2, TS - 4, TS - 4).fill({ color: 0xa5b0ff, alpha: wall ? 0.2 : 0.07 }).stroke({ width: 1, color: 0xa5b0ff, alpha: wall ? 0.5 : 0.28 });
        }
        continue;
      }
      const b = blds.get(c.sb[i]);
      const stone = !!b && b.mat === 1;
      const roofed = !!b && !OPEN_AIR.has(b.k);
      const floor = (asStone: boolean = stone): void => {
        if (asStone) {
          g.rect(px, py, TS, TS).fill(0x8f939b);
          g.rect(px, py + 11.5, TS, 1).rect(px + ((x + y) & 1 ? 7 : 15), py, 1, 11.5).rect(px + ((x + y) & 1 ? 15 : 7), py + 12, 1, 12).fill({ color: 0x5d6068, alpha: 0.55 });
        } else {
          g.rect(px, py, TS, TS).fill(0xa98558);
          g.rect(px, py + 7.5, TS, 1).rect(px, py + 15.5, TS, 1).rect(px + ((x * 7 + y * 3) % 17) + 3, py, 1, 7.5).rect(px + ((x * 5 + y * 11) % 17) + 3, py + 8, 1, 7.5).fill({ color: 0x6e5133, alpha: 0.5 });
        }
      };
      if (s >= B.BED && roofed && s !== B.GRAVE) floor();

      switch (s) {
        case B.FLOOR_WOOD:
        case B.FLOOR_STONE:
          floor(s === B.FLOOR_STONE);
          break;
        case B.WALL_WOOD:
        case B.WALL_STONE: {
          const edge = s === B.WALL_WOOD ? 0x4d3524 : 0x565a62;
          const top = s === B.WALL_WOOD ? 0x7d5a3a : 0x8f939c;
          g.rect(px, py, TS, TS).fill(edge);
          // the lighter top runs on into neighbouring walls so they read as one thick wall
          const l = isWall(stAt(x - 1, y)) ? 0 : 3;
          const r = isWall(stAt(x + 1, y)) ? 0 : 3;
          const u = isWall(stAt(x, y - 1)) ? 0 : 3;
          const d = isWall(stAt(x, y + 1)) ? 0 : 4;
          g.rect(px + l, py + u, TS - l - r, TS - u - d).fill(top);
          if (s === B.WALL_STONE) g.rect(px + 4, py + 11, 16, 1).rect(px + 12, py + 4, 1, 7).fill({ color: 0x565a62, alpha: 0.5 });
          else g.rect(px + 5, py + 8, 14, 1).rect(px + 5, py + 15, 14, 1).fill({ color: 0x4d3524, alpha: 0.4 });
          if (pal.snow > 0.5) g.rect(px + l, py + u, TS - l - r, 3).fill({ color: 0xf2f5f7, alpha: 0.5 });
          break;
        }
        case B.DOOR: {
          if (b && b.k === 'graveyard') {
            g.rect(px + 1, py + 10, 22, 3).fill(0x9a7a50);
            g.circle(px + 2.5, cy, 3).circle(px + 21.5, cy, 3).fill(0x5a4030);
            break;
          }
          floor();
          const across = isWall(stAt(x - 1, y)) || isWall(stAt(x + 1, y));
          if (across) {
            g.rect(px, py + 7, TS, 10).fill(0x4d3524);
            g.roundRect(px + 2, py + 8.5, 20, 7, 1.5).fill(0xb98a52);
            g.circle(px + 18, py + 12, 1.3).fill(0x3a2a1c);
          } else {
            g.rect(px + 7, py, 10, TS).fill(0x4d3524);
            g.roundRect(px + 8.5, py + 2, 7, 20, 1.5).fill(0xb98a52);
            g.circle(px + 12, py + 18, 1.3).fill(0x3a2a1c);
          }
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
          const v = c.crop[i];
          if (!v) break;
          const kind = b?.crop ?? 'grain';
          const ripe = v >= 200;
          const gr = ripe ? 1 : v / 200;
          for (let row = 0; row < 3; row++) {
            for (let n = 0; n < 3; n++) {
              const qx = px + 4 + n * 8 + (hash2(x * 3 + n, y * 3 + row, 11) - 0.5) * 2;
              const qy = py + 4 + row * 8;
              if (ripe) {
                if (kind === 'veg') { g.circle(qx, qy, 3.1).fill(0x4f9a3e); g.circle(qx + 0.8, qy + 0.6, 1.5).fill(0xe2933a); }
                else if (kind === 'flax') { g.circle(qx, qy, 2.8).fill(0xc9b458); g.circle(qx - 0.6, qy - 0.8, 1.3).fill(0x8fb4f0); }
                else { g.ellipse(qx, qy, 2.6, 3.4).fill(0xe2b84a); g.ellipse(qx - 0.6, qy - 1, 1.2, 1.8).fill(0xf4d87a); }
              } else {
                g.circle(qx, qy, 0.9 + gr * 2.2).fill(mix(0x86c466, 0x4f9a3e, gr));
              }
            }
          }
          break;
        }
        case B.BED:
        case B.COT: {
          const cot = s === B.COT;
          g.roundRect(px + 3, py + 1, 18, 22, 2.5).fill(cot ? 0x8f8a80 : 0x6e4b2f);
          g.roundRect(px + 4.5, py + 2.5, 15, 19, 1.5).fill(0xe9e3d5);
          g.roundRect(px + 6.5, py + 3.5, 11, 5, 2).fill(0xffffff);
          g.roundRect(px + 4.5, py + 10.5, 15, 11, 1.5).fill(cot ? 0xb9c7d6 : blanketColor(i));
          g.rect(px + 4.5, py + 10.5, 15, 2).fill({ color: 0xffffff, alpha: 0.25 });
          break;
        }
        case B.TABLE:
          g.roundRect(px + 1.5, py + 3, 21, 18, 3).fill(0x7d5836);
          g.roundRect(px + 2.5, py + 3.5, 19, 15.5, 2.5).fill(0xa87a4a);
          g.circle(cx - 4, cy - 1, 2.4).fill(0xe9e3d5);
          g.circle(cx + 5, cy + 1.5, 1.6).fill(0xc9a24a);
          break;
        case B.CHAIR:
          g.roundRect(px + 6, py + 7, 12, 12, 3).fill(0x8f6a44);
          g.roundRect(px + 6, py + 5, 12, 3.5, 1.5).fill(0x5d4028);
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
          g.roundRect(px + 1.5, py + 5, 21, 14, 2).fill(0x6e5133);
          g.roundRect(px + 2.5, py + 5.5, 19, 11.5, 1.5).fill(0x9a744a);
          g.rect(px + 5, py + 8.5, 8, 2).fill(0x4b4f58);
          g.rect(px + 8, py + 8.5, 2, 6).fill(0x7d5836);
          g.circle(px + 17.5, py + 12.5, 2.2).fill(0xc9ccd4);
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
          g.rect(px + 4, py + 4, 16, 16).fill(0x9c7446).stroke({ width: 1.5, color: 0x6b4c2c });
          g.moveTo(px + 4, py + 4).lineTo(px + 20, py + 20).moveTo(px + 20, py + 4).lineTo(px + 4, py + 20).stroke({ width: 1.2, color: 0x6b4c2c });
          break;
        case B.BARREL:
          g.circle(cx, cy, 8.5).fill(0x4b4f58);
          g.circle(cx, cy, 7.2).fill(0x8a5f38);
          g.circle(cx, cy, 4.6).fill(0xa87a4a);
          g.circle(cx, cy, 1.2).fill(0x4d3524);
          break;
        case B.ALTAR:
          g.roundRect(px + 2, py + 5, 20, 14, 2).fill(0xcfd3da);
          g.rect(cx - 3.5, py + 5, 7, 14).fill(0x7c8cff);
          g.circle(px + 5.5, cy, 1.7).circle(px + 18.5, cy, 1.7).fill(0xffd36a);
          break;
        case B.PEW:
          g.roundRect(px + 2, py + 8, 20, 8.5, 2).fill(0x8f6a44);
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
          g.roundRect(px + 2, py + 2.5, 20, 9, 1.5).fill(0x7d5836);
          g.circle(px + 6, py + 7, 2).fill(0x8fb4f0);
          g.circle(px + 11, py + 7, 2).fill(0x86c466);
          g.circle(px + 16, py + 7, 2).fill(0xe2933a);
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
        default:
          break;
      }
    }
  }
}
