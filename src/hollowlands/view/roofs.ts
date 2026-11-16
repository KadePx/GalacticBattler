// Roofs. From a distance a colony should read as a town: each building gets a roof that follows
// its outline, in the style of the people who mostly live there. Up close they fade away and the
// rooms show through.

import type { Graphics } from 'pixi.js';
import { TPL, shapeOf } from '../sim/data/buildings';
import { B, type Bld, type Colony, type RaceK } from '../sim/types';
import { darken, lighten, mix } from './look';
import { TS, hash2, lightOf } from './tiles';

export type RoofStyle = 'thatch' | 'slate' | 'shingle' | 'turf' | 'hide' | 'patch';

/** Buildings with no roof at all. */
export const OPEN_AIR = new Set(['field', 'well', 'graveyard', 'pen']);

/** The roof style a people builds. Stone buildings of thatching folk get slate instead. */
export function roofStyle(c: Colony, b: Bld): RoofStyle {
  const n: Partial<Record<RaceK, number>> = {};
  for (const p of c.pawns) n[p.race] = (n[p.race] ?? 0) + 1;
  let main: RaceK = 'human';
  let best = -1;
  for (const k in n) if ((n[k as RaceK] ?? 0) > best) { best = n[k as RaceK] ?? 0; main = k as RaceK; }
  const base: Record<string, RoofStyle> = { human: 'thatch', halfelf: 'thatch', dwarf: 'slate', elf: 'shingle', halfling: 'turf', orc: 'hide', halforc: 'hide', goblin: 'patch' };
  const s = base[main] ?? 'thatch';
  if (b.mat === 1 && (s === 'thatch' || s === 'patch' || s === 'hide')) return 'slate';
  return s;
}

const PAL: Record<RoofStyle, number[]> = {
  thatch: [0xc9a35a, 0xb8914a, 0xd6b46a],
  slate: [0x5d6470, 0x666e7b, 0x535a66],
  shingle: [0x4f8a86, 0x5a968f, 0x467a76],
  turf: [0x7fa860, 0x76a058, 0x8ab46a],
  hide: [0x8a6440, 0x9a7048, 0x7d5a38],
  patch: [0x8a6a8a, 0x6a7a5a, 0x9a6a4a, 0x5a6a8a, 0x8a8a5a],
};

/** The tiles a building's roof covers (everything inside its outline). */
export function roofTiles(c: Colony, b: Bld): Set<number> {
  const t = TPL[shapeOf(b)];
  const out = new Set<number>();
  if (!t) return out;
  for (let dy = 0; dy < t.rows.length; dy++) {
    for (let dx = 0; dx < t.rows[dy].length; dx++) if (t.rows[dy][dx] !== ' ') out.add((b.y + dy) * c.w + b.x + dx);
  }
  return out;
}

/** Tiles under the roof where a fire burns, for chimneys. */
export function chimneys(c: Colony, b: Bld): number[] {
  const out: number[] = [];
  for (const i of roofTiles(c, b)) if (lightOf(c.st[i]) >= 2 && c.st[i] !== B.LAMP && c.st[i] !== B.TORCH) out.push(i);
  return out;
}

/** Draw a building's roof in world space. */
export function drawRoof(g: Graphics, c: Colony, b: Bld, style: RoofStyle, snow = 0): void {
  g.clear();
  const tiles = roofTiles(c, b);
  if (!tiles.size) return;
  const pal = PAL[style];
  const across = b.w >= b.h; // the ridge runs along the longer side
  const ridge = across ? (b.y + b.h / 2) * TS : (b.x + b.w / 2) * TS;
  const has = (x: number, y: number): boolean => tiles.has(y * c.w + x);
  const tileCol = (x: number, y: number): number => style === 'patch' ? pal[Math.floor(hash2(x, y, 41) * pal.length) % pal.length] : pal[0];

  // the body of the roof: the sunny slope lighter, the far one in shade
  for (const i of tiles) {
    const x = i % c.w;
    const y = Math.floor(i / c.w);
    const px = x * TS;
    const py = y * TS;
    const mid = across ? py + TS / 2 : px + TS / 2;
    const sunny = mid < ridge;
    const col = tileCol(x, y);
    // stronger near the ridge, as light falls on a slope
    const d = Math.abs(mid - ridge) / ((across ? b.h : b.w) * TS / 2);
    g.rect(px, py, TS, TS).fill(sunny ? lighten(col, 0.2 - d * 0.1) : darken(col, 0.18 + (1 - d) * 0.12));
    // texture
    if (style === 'thatch') {
      for (let k = 0; k < 4; k++) {
        const yy = py + 3 + k * 6 + (hash2(x, y, 50 + k) - 0.5) * 1.5;
        g.moveTo(px, yy).quadraticCurveTo(px + TS / 2, yy + 1.6, px + TS, yy).stroke({ width: 0.9, color: darken(col, 0.22), alpha: 0.7 });
      }
    } else if (style === 'slate') {
      for (let row = 0; row < 4; row++) {
        const off = (row + y) % 2 ? 0 : 6;
        for (let k = -1; k < 3; k++) g.rect(px + off + k * 12, py + row * 6, 11, 5.2).fill(row % 2 ? lighten(col, 0.05) : col).stroke({ width: 0.6, color: darken(col, 0.3), alpha: 0.6 });
      }
    } else if (style === 'shingle') {
      for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) {
        const cx = px + 3 + k * 6 + (row % 2 ? 3 : 0);
        g.moveTo(cx - 3, py + row * 6 + 2).arc(cx, py + row * 6 + 2, 3, Math.PI, 0, true).stroke({ width: 0.8, color: darken(col, 0.28), alpha: 0.7 });
      }
    } else if (style === 'turf') {
      for (let k = 0; k < 5; k++) g.circle(px + hash2(x, y, 60 + k) * TS, py + hash2(x, y, 70 + k) * TS, 1.6).fill(darken(col, 0.15));
      if (hash2(x, y, 80) < 0.35) g.circle(px + hash2(x, y, 81) * TS, py + hash2(x, y, 82) * TS, 1.2).fill(hash2(x, y, 83) < 0.5 ? 0xf2e08a : 0xe8a8c0);
    } else if (style === 'hide') {
      g.moveTo(px, py + 12).lineTo(px + TS, py + 12).stroke({ width: 0.8, color: darken(col, 0.35), alpha: 0.6 });
      for (let k = 0; k < 4; k++) g.moveTo(px + 3 + k * 6, py + 10.5).lineTo(px + 4.5 + k * 6, py + 13.5).stroke({ width: 0.7, color: 0xe9dcc0, alpha: 0.6 });
    } else {
      g.rect(px + 1, py + 1, TS - 2, TS - 2).stroke({ width: 0.7, color: darken(col, 0.4), alpha: 0.5 });
      for (let k = 0; k < 3; k++) g.moveTo(px + 4 + k * 7, py + 2).lineTo(px + 4 + k * 7, py + 5).stroke({ width: 0.6, color: 0xe9dcc0, alpha: 0.5 });
    }
  }

  // snow lies on the roof in winter, thinner on the sunny slope
  if (snow > 0) {
    for (const i of tiles) {
      const x = i % c.w;
      const y = Math.floor(i / c.w);
      const mid = across ? y * TS + TS / 2 : x * TS + TS / 2;
      g.rect(x * TS, y * TS, TS, TS).fill({ color: 0xf2f5f7, alpha: snow * (mid < ridge ? 0.55 : 0.75) });
    }
  }

  // the ridge cap
  const ridgeCol = style === 'thatch' ? 0x9a7a3a : style === 'turf' ? 0x5f8a45 : darken(pal[0], 0.3);
  for (const i of tiles) {
    const x = i % c.w;
    const y = Math.floor(i / c.w);
    if (across) {
      const ry = ridge - 1.5;
      if (y * TS <= ry && (y + 1) * TS >= ry) g.rect(x * TS, ry, TS, 3).fill(ridgeCol);
    } else {
      const rx = ridge - 1.5;
      if (x * TS <= rx && (x + 1) * TS >= rx) g.rect(rx, y * TS, 3, TS).fill(ridgeCol);
    }
  }

  // the eaves: a dark edge where the roof ends, and a soft shadow cast to the south-east
  const eave = darken(pal[0], 0.45);
  for (const i of tiles) {
    const x = i % c.w;
    const y = Math.floor(i / c.w);
    const px = x * TS;
    const py = y * TS;
    if (!has(x, y - 1)) g.rect(px, py, TS, 2).fill(eave);
    if (!has(x - 1, y)) g.rect(px, py, 2, TS).fill(eave);
    if (!has(x + 1, y)) { g.rect(px + TS - 2, py, 2, TS).fill(eave); g.rect(px + TS, py + 3, 4, TS - 3).fill({ color: 0x0b1220, alpha: 0.22 }); }
    if (!has(x, y + 1)) { g.rect(px, py + TS - 3, TS, 3).fill(eave); g.rect(px + 3, py + TS, TS, 5).fill({ color: 0x0b1220, alpha: 0.25 }); }
  }

  // orc longhouses wear bone at the gable ends
  if (style === 'hide') {
    const ends = across ? [[b.x, ridge / TS], [b.x + b.w, ridge / TS]] : [[ridge / TS, b.y], [ridge / TS, b.y + b.h]];
    for (const [ex, ey] of ends) {
      const x = ex * TS;
      const y = ey * TS;
      g.moveTo(x - 4, y - 4).lineTo(x, y).lineTo(x - 4, y + 4).stroke({ width: 1.8, color: 0xf3efe2, cap: 'round' });
    }
  }

  // chimneys over the fires
  for (const i of chimneys(c, b)) {
    const px = (i % c.w) * TS;
    const py = Math.floor(i / c.w) * TS;
    g.rect(px + 5, py + 3, 14, 14).fill({ color: 0x0b1220, alpha: 0.3 });
    g.rect(px + 4, py + 2, 14, 14).fill(style === 'slate' || b.mat === 1 ? 0x7b808b : 0x8a6440).stroke({ width: 1.2, color: 0x2a1d12 });
    g.rect(px + 7, py + 5, 8, 8).fill(0x140e0a);
  }
  void mix;
}
