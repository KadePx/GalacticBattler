// The town plan. A market square in the middle; a main avenue from the square out along the road
// to the gate; streets on a grid lined up with it; quarters round them (crafts by the gate road,
// the temple and its little square on one side, fine homes toward the keep's rise, poorer ones on
// the edge); and a ring kept clear where a town wall will one day stand, with the farms and pens
// outside it. Worked out from the colony's land each time (nothing stored), so older colonies
// follow it for whatever they build next.

import { dropFeat, touch } from './cache';
import { hash32, S } from './rng';
import { B, F, T, isStreetThing, type Colony } from './types';

/** Distance between streets; the blocks between them are BLOCK - 1 tiles across. */
export const BLOCK = 12;
/** Radius of the ground on the rise kept clear for a keep. */
export const KEEP_R = 7;
/** Half the width of the market square. */
export const SQUARE = 5;
/** Half the width of the temple's little square. */
export const PLAZA = 2;
/** Width of the band kept clear for the town wall. */
export const WALL_W = 3;

/** Ground on the rise held for the keep: nothing else is built there. */
export function onKeep(c: Colony, x: number, y: number): boolean {
  const k = c.keep;
  if (!k) return false;
  const dx = x - k.x;
  const dy = y - k.y;
  return dx * dx + dy * dy <= KEEP_R * KEEP_R;
}

/** The lane round the foot of the keep's rise. */
function keepRing(c: Colony, x: number, y: number): boolean {
  const k = c.keep;
  if (!k) return false;
  const dx = x - k.x;
  const dy = y - k.y;
  const d2 = dx * dx + dy * dy;
  return d2 > KEEP_R * KEEP_R && d2 <= 72;
}

/**
 * How far out the streets run: three blocks each way on a 128-tile map, two on the old 72-tile
 * ones. Worked out from the colony's own land, so older, smaller maps still plan sensibly.
 */
export const reach = (c: { w: number; h: number }): number => Math.round((20 * Math.min(c.w, c.h)) / 72 / BLOCK) * BLOCK;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Distance out from the square as the wall runs: an octagon, square with its corners cut. */
export const octo = (dx: number, dy: number): number => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay, (ax + ay) * 0.72);
};

/** What the plan holds each tile for. */
export const Z = { NONE: 0, STREET: 1, SQUARE: 2, PLAZA: 3, AVENUE: 4, LANE: 5, BAND: 6 } as const;

/** The shape of a town: which way the gate lies, which side the crafts and the temple take. */
export interface Frame {
  /** unit step toward the gate (along the road), and across it toward the crafts quarter */
  gx: number; gy: number; px: number; py: number;
  /** toward the keep's rise (a unit vector) and how far it lies */
  kx: number; ky: number; kd: number;
  /** inner edge of the wall's band, in octo() distance */
  wall: number;
  /** the temple square's middle, the market fountain */
  tx: number; ty: number; fx: number; fy: number;
  /** per tile, what the plan holds it for (Z) */
  zone: Uint8Array;
  /** street furniture to set out, once the ground under it is clear: [x, y, code] */
  things: [number, number, number][];
}

const frames = new WeakMap<object, { cx: number; cy: number; gx: number; gy: number; kx: number; ky: number; w: number; f: Frame }>();

/** The town's plan, worked out once per colony (it depends only on the land). */
export function frame(c: Colony): Frame {
  const got = frames.get(c);
  const kx0 = c.keep ? c.keep.x : -1;
  const ky0 = c.keep ? c.keep.y : -1;
  if (got && got.cx === c.cx && got.cy === c.cy && got.gx === c.gx && got.gy === c.gy && got.kx === kx0 && got.ky === ky0 && got.w === c.w) return got.f;
  const vx = c.gx - c.cx;
  const vy = c.gy - c.cy;
  const [gx, gy] = Math.abs(vy) >= Math.abs(vx) ? [0, vy >= 0 ? 1 : -1] : [vx >= 0 ? 1 : -1, 0];
  let kx = -gx;
  let ky = -gy;
  let kd = 26;
  if (c.keep) {
    const dx = c.keep.x - c.cx;
    const dy = c.keep.y - c.cy;
    kd = Math.sqrt(dx * dx + dy * dy) || 1;
    kx = dx / kd;
    ky = dy / kd;
  }
  // the crafts take the side of the avenue away from the keep, the temple the side toward it
  let px = gy;
  let py = -gx;
  if (px * kx + py * ky > 0) { px = -px; py = -py; }
  const wall = reach(c) + 3;
  const tx = c.cx - px * BLOCK;
  const ty = c.cy - py * BLOCK;
  const zone = new Uint8Array(c.w * c.h);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const dx = x - c.cx;
      const dy = y - c.cy;
      const od = octo(dx, dy);
      const along = dx * gx + dy * gy;
      const across = dx * gy - dy * gx;
      let z: number = Z.NONE;
      if (keepRing(c, x, y)) z = Z.LANE;
      else if (Math.abs(dx) <= SQUARE && Math.abs(dy) <= SQUARE) z = Z.SQUARE;
      else if (Math.abs(x - tx) <= PLAZA && Math.abs(y - ty) <= PLAZA) z = Z.PLAZA;
      else if (along > 0 && along < wall + WALL_W && Math.abs(across) <= 1) z = Z.AVENUE;
      else if (od <= wall - 2 && (mod(dx, BLOCK) === 0 || mod(dy, BLOCK) === 0)) z = Z.STREET;
      else if (od >= wall && od < wall + WALL_W) z = Z.BAND;
      zone[y * c.w + x] = z;
    }
  }
  const f: Frame = { gx, gy, px, py, kx, ky, kd, wall, tx, ty, fx: c.cx + 2 * px - 2 * gx, fy: c.cy + 2 * py - 2 * gy, zone, things: [] };
  frames.set(c, { cx: c.cx, cy: c.cy, gx: c.gx, gy: c.gy, kx: kx0, ky: ky0, w: c.w, f });
  f.things = streetThings(c, f);
  return f;
}

const zoneAt = (c: Colony, x: number, y: number): number => (x < 0 || y < 0 || x >= c.w || y >= c.h ? Z.NONE : frame(c).zone[y * c.w + x]);

/** The open square at the colony's heart. */
export const inSquare = (c: Colony, x: number, y: number): boolean => zoneAt(c, x, y) === Z.SQUARE;
/** The temple's little square. */
export const inPlaza = (c: Colony, x: number, y: number): boolean => zoneAt(c, x, y) === Z.PLAZA;
/** The main avenue: three tiles wide, from the square out along the road through the wall. */
export const onAvenue = (c: Colony, x: number, y: number): boolean => zoneAt(c, x, y) === Z.AVENUE;
/** A street: the grid (one tile wide, every BLOCK tiles, inside the wall), the avenue, the lane round the keep. */
export const isStreet = (c: Colony, x: number, y: number): boolean => { const z = zoneAt(c, x, y); return z === Z.STREET || z === Z.AVENUE || z === Z.LANE; };

/** The band kept clear for the town wall (where the avenue crosses it is where the gate goes). */
export function inWallBand(c: Colony, x: number, y: number): boolean {
  const w = frame(c).wall;
  const d = octo(x - c.cx, y - c.cy);
  return d >= w && d < w + WALL_W;
}

/** Inside the wall's line. */
export function insideWall(c: Colony, x: number, y: number): boolean {
  return octo(x - c.cx, y - c.cy) < frame(c).wall;
}

/** Ground people walk on in the plan: streets, the avenue and the squares. */
export const publicGround = (c: Colony, x: number, y: number): boolean => { const z = zoneAt(c, x, y); return z >= Z.STREET && z <= Z.LANE; };

/** Ground the plan keeps open: the public ground and the wall's band. */
export const reserved = (c: Colony, x: number, y: number): boolean => zoneAt(c, x, y) !== Z.NONE;

/** Kinds that belong in the castle quarter. */
const FINE = new Set(['manor', 'townhouse', 'guardhouse']);

/** Kinds of building that stand outside the wall. */
export const OUTSIDE = new Set(['field', 'pen', 'graveyard']);

interface Pref { near: number; spread: number; dx?: number; dy?: number; aw?: number }

const unit = (x: number, y: number): [number, number] => {
  const l = Math.sqrt(x * x + y * y) || 1;
  return [x / l, y / l];
};

/** The quarter a kind of building belongs in: a preferred distance from the square, and a side. */
export function quarter(c: Colony, k: string): Pref {
  const f = frame(c);
  const out = f.wall + WALL_W;
  const [cx, cy] = unit(f.gx + f.px, f.gy + f.py);
  switch (k) {
    case 'hall': return { near: 10, spread: 1.5, dx: f.px, dy: f.py, aw: 3 };
    case 'store': return { near: 11, spread: 1.2, dx: cx, dy: cy, aw: 2 };
    case 'well': return { near: 7, spread: 1 };
    case 'kitchen': return { near: 12, spread: 1, dx: f.px, dy: f.py, aw: 1.5 };
    // the crafts quarter: between the gate road and the edge, away from the keep
    case 'smithy': case 'workshop': case 'brewery': case 'herbalist': case 'granary':
      return { near: 18, spread: 0.8, dx: cx, dy: cy, aw: 5 };
    case 'tavern': return { near: 14, spread: 1, dx: f.gx, dy: f.gy, aw: 4 };
    case 'gamehall': case 'bathhouse': { const [x, y] = unit(f.gx - f.px, f.gy - f.py); return { near: 16, spread: 0.9, dx: x, dy: y, aw: 3 }; }
    // the temple district, round its little square
    case 'shrine': return { near: 15, spread: 1, dx: -f.px, dy: -f.py, aw: 6 };
    case 'school': case 'infirmary': return { near: 19, spread: 0.9, dx: -f.px, dy: -f.py, aw: 4 };
    // the castle quarter
    case 'guardhouse': return { near: Math.max(12, f.kd - KEEP_R - 4), spread: 0.8, dx: f.kx, dy: f.ky, aw: 5 };
    case 'tower': return { near: f.wall - 8, spread: 0.3 };
    // outside the wall: farms, pens and the dead
    case 'field': return { near: out + 3, spread: 0.8 };
    case 'pen': return { near: out + 3, spread: 0.6 };
    case 'graveyard': return { near: out + 5, spread: 0.6, dx: -f.px, dy: -f.py, aw: 6 };
    // homes in rings: the finest by the keep and the square, the poorest out by the wall
    case 'manor': return { near: Math.max(14, f.kd - 2), spread: 0.6, dx: f.kx, dy: f.ky, aw: 4 };
    case 'townhouse': return { near: 13, spread: 1, dx: f.kx, dy: f.ky, aw: 2 };
    case 'house': case 'bighouse': return { near: 20, spread: 0.7, dx: -f.gx, dy: -f.gy, aw: 2.5 };
    case 'cottage': case 'longhouse': return { near: 27, spread: 0.7, dx: f.gx, dy: f.gy, aw: 2.5 };
    case 'shack': return { near: f.wall - 4, spread: 0.8, dx: cx, dy: cy, aw: 3 };
  }
  return { near: 14, spread: 1 };
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
  if (q.aw && d > 0.5) {
    const cos = (ddx * (q.dx ?? 0) + ddy * (q.dy ?? 0)) / d;
    s -= q.aw * (1 - cos) * Math.min(1, d / 10);
  }
  if (k === 'field' || k === 'graveyard') return s;
  // the ground between the square and the keep is held for the great families' houses
  if (!FINE.has(k) && d > 9) {
    const f = frame(c);
    if (d < f.kd + KEEP_R + 4 && (ddx * f.kx + ddy * f.ky) / d > 0.5) s -= 9;
  }
  // the door (or a garden gate) opens onto a street or a square
  for (let dy = 0; dy < rows.length; dy++) {
    for (let dx = 0; dx < rows[dy].length; dx++) {
      const ch = rows[dy][dx];
      if (ch !== '+' && ch !== 'g') continue;
      for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx + ox;
        const ny = y + dy + oy;
        const outside = ny < y || ny >= y + h || nx < x || nx >= x + w;
        if (!outside || !publicGround(c, nx, ny)) continue;
        s += 6;
        if (k === 'tavern' && onAvenue(c, nx, ny)) s += 3;
        if (k === 'shrine' && inPlaza(c, nx, ny)) s += 5;
        break;
      }
    }
  }
  // squared up with the street grid: an edge right against a street
  if (isStreet(c, x - 1, y) || isStreet(c, x + w, y)) s += 1.5;
  if (isStreet(c, x, y - 1) || isStreet(c, x, y + h)) s += 1.5;
  // close beside its neighbours, a lane's width apart, so the blocks fill up and leave whole
  // blocks free for the bigger buildings
  let near = 0;
  for (let xx = x - 1; xx <= x + w; xx++) near += neighbour(c, xx, y - 1) + neighbour(c, xx, y + h);
  for (let yy = y; yy < y + h; yy++) near += neighbour(c, x - 1, yy) + neighbour(c, x + w, yy);
  near *= 1.5;
  for (let xx = x - 2; xx <= x + w + 1; xx++) near += neighbour(c, xx, y - 2) + neighbour(c, xx, y + h + 1);
  for (let yy = y - 1; yy <= y + h; yy++) near += neighbour(c, x - 2, yy) + neighbour(c, x + w + 1, yy);
  s += Math.min(5, near * 0.25);
  return s;
}

const neighbour = (c: Colony, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return 0;
  const id = c.sb[y * c.w + x];
  return id ? 1 : 0;
};

/**
 * Where the street furniture goes: lamps round the market square and along the avenue, benches
 * on the square, a fountain in it and a pump in the temple square, signposts where the avenue
 * meets the cross streets, and lamps, benches or little shrines on some street corners.
 */
function streetThings(c: Colony, f: Frame): [number, number, number][] {
  const out: [number, number, number][] = [];
  const S0 = SQUARE;
  out.push([f.fx, f.fy, B.FOUNTAIN]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push([c.cx + sx * S0, c.cy + sy * S0, B.LAMPPOST]);
  // benches along the two sides of the square that the avenue does not cross
  for (const side of [-1, 1]) for (const along of [-3, 3]) out.push([c.cx + f.px * side * S0 + f.gx * along, c.cy + f.py * side * S0 + f.gy * along, B.SEAT]);
  // the temple square: a pump in one corner, a bench in another, a lamp
  out.push([f.tx + PLAZA * f.gx + PLAZA * f.px, f.ty + PLAZA * f.gy + PLAZA * f.py, B.PUMP]);
  out.push([f.tx - PLAZA * f.gx - PLAZA * f.px, f.ty - PLAZA * f.gy - PLAZA * f.py, B.SEAT]);
  out.push([f.tx - PLAZA * f.gx + PLAZA * f.px, f.ty - PLAZA * f.gy + PLAZA * f.py, B.LAMPPOST]);
  // lamps down the avenue on alternate sides, a signpost at each crossing
  for (let a = S0 + 4, n = 0; a < f.wall - 1; a += 6, n++) {
    const side = n % 2 ? 1 : -1;
    out.push([c.cx + f.gx * a + f.gy * side, c.cy + f.gy * a - f.gx * side, B.LAMPPOST]);
  }
  for (let a = BLOCK; a < f.wall - 1; a += BLOCK) out.push([c.cx + f.gx * a - f.gy, c.cy + f.gy * a + f.gx, B.SIGNPOST]);
  // street corners: one corner of a crossing, chosen by the land's own luck
  const R = reach(c);
  for (let j = -R; j <= R; j += BLOCK) {
    for (let i = -R; i <= R; i += BLOCK) {
      if (octo(i, j) > f.wall - 4) continue;
      if (Math.abs(i) <= S0 && Math.abs(j) <= S0) continue;
      const x = c.cx + i;
      const y = c.cy + j;
      if (onAvenue(c, x, y) || inPlaza(c, x, y) || keepRing(c, x, y) || onKeep(c, x, y)) continue;
      const h = hash32(c.seed, S.PLAN, 900 + i, 900 + j);
      const cx = h & 1 ? 1 : -1;
      const cy = h & 2 ? 1 : -1;
      const roll = (h >>> 8) % 100;
      const ring = Math.max(Math.abs(i), Math.abs(j)) / BLOCK;
      const code = ring <= 1 ? (roll < 70 ? B.LAMPPOST : B.SEAT) : roll < 26 ? B.WAYSHRINE : roll < 58 ? B.LAMPPOST : roll < 72 ? B.SEAT : roll < 86 ? B.SIGNPOST : 0;
      if (code) out.push([x + cx, y + cy, code]);
    }
  }
  return out;
}

/** Each day, a few more paces of street and square are worn and laid as paths, nearest first. */
export function pave(c: Colony, n: number): void {
  let done = 0;
  let changed = false;
  const f = frame(c);
  const R = f.wall + WALL_W + 2;
  for (let r = 0; r <= R && done < n; r++) {
    for (let y = c.cy - r; y <= c.cy + r && done < n; y++) {
      for (let x = c.cx - r; x <= c.cx + r && done < n; x++) {
        if (Math.max(Math.abs(x - c.cx), Math.abs(y - c.cy)) !== r) continue;
        if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1 || !publicGround(c, x, y)) continue;
        // the streets stop at the foot of the rise kept for the keep
        if (onKeep(c, x, y)) continue;
        const i = y * c.w + x;
        if (c.sb[i] || c.st[i]) continue;
        const t = c.ter[i];
        const flagged = inSquare(c, x, y) || inPlaza(c, x, y) || onAvenue(c, x, y);
        if (t !== T.GRASS && t !== T.DIRT && t !== T.SOIL && t !== T.SAND && !(flagged && t === T.PATH)) continue;
        const ft = c.feat[i];
        if (ft !== F.NONE && ft !== F.FLOWERS && ft !== F.BUSH && ft !== F.HERB && ft !== F.MUSHROOM && ft !== F.SAPLING) continue;
        // the squares and the avenue are flagged, the streets are trodden earth
        c.ter[i] = flagged ? T.STONE : T.PATH;
        if (ft !== F.NONE) { c.feat[i] = F.NONE; c.fg[i] = 0; }
        done++;
        changed = true;
      }
    }
  }
  // street furniture, where the ground under it has been laid or is still clear
  for (const [x, y, code] of f.things) {
    if (x < 2 || y < 2 || x >= c.w - 2 || y >= c.h - 2) continue;
    const i = y * c.w + x;
    if (c.st[i] || c.sb[i] || c.feat[i] !== F.NONE) continue;
    const t = c.ter[i];
    if (t !== T.GRASS && t !== T.DIRT && t !== T.SOIL && t !== T.PATH && t !== T.STONE && t !== T.SAND) continue;
    // set out only as the town reaches that far: something is built within a few paces
    if (!publicGround(c, x, y) && !builtNear(c, x, y)) continue;
    // nothing that would close a doorway
    let door = false;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (c.st[i + oy * c.w + ox] === B.DOOR) door = true;
    if (door) continue;
    c.st[i] = code;
    changed = true;
  }
  if (changed) { touch(c); for (const ft of [F.FLOWERS, F.BUSH, F.HERB, F.MUSHROOM, F.SAPLING]) dropFeat(c, ft); }
}

function builtNear(c: Colony, x: number, y: number): boolean {
  for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) if (c.sb[yy * c.w + xx]) return true;
  return false;
}

/** Street furniture a building may stand beside (not the fountain or the pump). */
export const passableThing = (s: number): boolean => isStreetThing(s) && s !== B.FOUNTAIN && s !== B.PUMP;
