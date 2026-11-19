// The town plan: a square in the middle, streets on a grid lined up with it, and quarters, so a
// colony grows as a town rather than a scatter. Worked out from the colony's centre each time
// (nothing stored), so older colonies follow it for whatever they build next.

import { cellCode } from './data/buildings';
import { dropFeat, touch } from './cache';
import { B, F, T, type Colony } from './types';

/** Distance between streets; the blocks between them are BLOCK - 1 tiles across. */
export const BLOCK = 12;
/** Radius of the ground on the rise kept clear for a keep. */
export const KEEP_R = 7;

/** Ground on the rise held for the keep: nothing else is built there. */
export function onKeep(c: Colony, x: number, y: number): boolean {
  const k = c.keep;
  if (!k) return false;
  const dx = x - k.x;
  const dy = y - k.y;
  return dx * dx + dy * dy <= KEEP_R * KEEP_R;
}

/** Half the width of the square. */
export const SQUARE = 4;
/**
 * How far out the streets run: three blocks each way on a 128-tile map, two on the old 72-tile
 * ones. Worked out from the colony's own land, so older, smaller maps still plan sensibly.
 */
export const reach = (c: { w: number; h: number }): number => Math.round((20 * Math.min(c.w, c.h)) / 72 / BLOCK) * BLOCK;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** The open square at the colony's heart. */
export function inSquare(c: Colony, x: number, y: number): boolean {
  return Math.abs(x - c.cx) <= SQUARE && Math.abs(y - c.cy) <= SQUARE;
}

/** A street tile: one tile wide, every BLOCK tiles each way from the centre, through the inner town. */
export function isStreet(c: Colony, x: number, y: number): boolean {
  const dx = x - c.cx;
  const dy = y - c.cy;
  const R = reach(c);
  if (Math.abs(dx) > R || Math.abs(dy) > R) return false;
  return mod(dx, BLOCK) === 0 || mod(dy, BLOCK) === 0;
}

/** Ground the plan keeps open: streets and the square. */
export const reserved = (c: Colony, x: number, y: number): boolean => inSquare(c, x, y) || isStreet(c, x, y);

/** The quarter a kind of building belongs in, as a preferred distance from the square. */
export function quarter(c: Colony, k: string): { near: number; spread: number } {
  const REACH = reach(c);
  if (k === 'hall' || k === 'store') return { near: 6, spread: 1.5 };
  if (k === 'well') return { near: 5, spread: 1 };
  // farms and pens lie outside the town's streets, homes in a ring around the workshops
  if (k === 'field') return { near: REACH + 6, spread: 0.7 };
  if (k === 'pen' || k === 'graveyard') return { near: REACH, spread: 0.6 };
  if (k === 'tower') return { near: REACH - 4, spread: 0.3 };
  if (k === 'cottage' || k === 'house' || k === 'bighouse' || k === 'longhouse') return { near: 16, spread: 0.8 };
  // workshops, the smithy, the kitchen and the rest: round the square
  return { near: 10, spread: 1 };
}

/**
 * How well a plot sits in the plan: in its quarter, inside a block, with its door onto a street
 * and lined up with the block's edge. Higher is better.
 */
export function lotScore(c: Colony, k: string, x: number, y: number, w: number, h: number, rows: string[]): number {
  // plain multiplication and sqrt: exact in every browser (hypot and ** are not)
  const ddx = x + w / 2 - c.cx;
  const ddy = y + h / 2 - c.cy;
  const d = Math.sqrt(ddx * ddx + ddy * ddy);
  const q = quarter(c, k);
  let s = -Math.abs(d - q.near) * q.spread;
  if (k === 'field' || k === 'graveyard') return s;
  // the door opens onto a street (or the square)
  for (let dy = 0; dy < rows.length; dy++) {
    for (let dx = 0; dx < rows[dy].length; dx++) {
      if (rows[dy][dx] !== '+') continue;
      const below = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([ox, oy]) => {
        const nx = x + dx + ox;
        const ny = y + dy + oy;
        const outside = ny < y || ny >= y + h || nx < x || nx >= x + w;
        return outside && reserved(c, nx, ny);
      });
      if (below) s += 6;
    }
  }
  // squared up with the street grid: an edge right against a street
  if (isStreet(c, x - 1, y) || isStreet(c, x + w, y)) s += 1.5;
  if (isStreet(c, x, y - 1) || isStreet(c, x, y + h)) s += 1.5;
  return s;
}

/** Each day, a few more paces of street and square are worn and laid as paths, nearest first. */
export function pave(c: Colony, n: number): void {
  let done = 0;
  let changed = false;
  const REACH = reach(c);
  for (let r = 0; r <= REACH && done < n; r++) {
    for (let y = c.cy - r; y <= c.cy + r && done < n; y++) {
      for (let x = c.cx - r; x <= c.cx + r && done < n; x++) {
        if (Math.max(Math.abs(x - c.cx), Math.abs(y - c.cy)) !== r) continue;
        if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1 || !reserved(c, x, y)) continue;
        // the streets stop at the foot of the rise kept for the keep
        if (onKeep(c, x, y)) continue;
        const i = y * c.w + x;
        if (c.sb[i] || c.st[i]) continue;
        const t = c.ter[i];
        if (t !== T.GRASS && t !== T.DIRT && t !== T.SOIL && t !== T.SAND) continue;
        const f = c.feat[i];
        if (f !== F.NONE && f !== F.FLOWERS && f !== F.BUSH && f !== F.HERB && f !== F.MUSHROOM && f !== F.SAPLING) continue;
        // the square is flagged, the streets are trodden earth
        c.ter[i] = inSquare(c, x, y) ? T.STONE : T.PATH;
        if (f !== F.NONE) { c.feat[i] = F.NONE; c.fg[i] = 0; }
        done++;
        changed = true;
      }
    }
  }
  if (changed) { touch(c); for (const f of [F.FLOWERS, F.BUSH, F.HERB, F.MUSHROOM, F.SAPLING]) dropFeat(c, f); }
  void cellCode;
  void B;
}
