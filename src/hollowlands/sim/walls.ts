// The town wall. When a town has grown (or has been raided once), it raises a wall on the band the
// town plan keeps clear for it: first a ditch and a palisade of stakes with timber towers and gates,
// then, years later, the same line in stone, with stone towers and a gatehouse on every road.
//
// The wall's line is an octagon round the market square, one tile thick, in the middle of the band.
// It is cut into pieces (stretches of wall, towers, gates) that are laid out and built one after
// another by the colony's builders, like any other building, so the wall can be seen going up. The
// plan of pieces is worked out once, when the wall is begun, and kept with the colony.
//
// Colonists pass their own gates at any hour. Raiders and beasts walk a map of their own (see
// foeMap in cache.ts) on which the wall is solid and the gates are shut at night, in an alarm and
// through a siege: they must come through an open gate or break a way in.

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../config';
import { cacheOf, foeMap } from './cache';
import { TPL, WALL_KINDS, cells, shapeOf } from './data/buildings';
import { bump, log } from './events';
import { raze } from './homes';
import { placeBuilding, syncTiles } from './planner';
import { frame, insideWall, octo, onKeep } from './town';
import { idleAct } from './pawn';
import { B, F, T, type Bld, type Colony, type Pawn } from './types';

export { WALL_KINDS };

/** A piece of the wall in the colony's plan: its kind, floor plan and corner, and the building standing for it (0 none yet, -1 given up on). */
export interface WallPiece { k: string; s: string; x: number; y: number; b: number }

/** Is this a piece of the town wall? */
export const isWallPart = (b: { k: string }): boolean => WALL_KINDS.has(b.k);

/** Pieces of the current stage laid out and waiting for builders at once (more when trouble is near). */
const LAID = 3;
/** Stone and wood a tile of wall asks to be rebuilt in stone. */
const STONE_TILE = 3;
/** Days between the palisade being finished and the stone wall being begun, at the soonest. */
const REST_DAYS = 40;

// ---------- The plan ----------

/** The middle of the wall band: the line the wall runs on, in octo() distance (straight sides). */
export const wallR = (c: Colony): number => frame(c).wall + 1;

/** Work out the wall's pieces from the land as it is now. */
export function planWalls(c: Colony): WallPiece[] {
  const W = c.w;
  const H = c.h;
  const R = wallR(c);
  const D = Math.round(R / 0.72);
  const s = D - R;
  const cx = c.cx;
  const cy = c.cy;
  // the ring, in order round the town from the middle of the south side: [x, y, side]
  // sides: 0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW
  const V: [number, number][] = [[0, R], [s, R], [R, s], [R, -s], [s, -R], [-s, -R], [-R, -s], [-R, s], [-s, R], [0, R]];
  const SIDE = [0, 1, 2, 3, 4, 5, 6, 7, 0];
  const ring: [number, number, number][] = [];
  for (let k = 0; k < 9; k++) {
    let [x, y] = V[k];
    const [x1, y1] = V[k + 1];
    const sx = Math.sign(x1 - x);
    const sy = Math.sign(y1 - y);
    if (k === 0) ring.push([cx + x, cy + y, 0]);
    while (x !== x1 || y !== y1) {
      x += sx;
      y += sy;
      if (k === 8 && x === x1 && y === y1) break;
      ring.push([cx + x, cy + y, SIDE[k]]);
    }
  }
  const tileOk = (x: number, y: number): boolean => {
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
    const i = y * W + x;
    const t = c.ter[i];
    if (t === T.DEEP || t === T.ROCK) return false;
    if (onKeep(c, x, y)) return false;
    const b = c.sb[i];
    return !b || isWallPart(c.blds.find((q) => q.id === b) ?? { k: '' });
  };
  const fits = (sh: string, x0: number, y0: number): boolean => {
    for (const cell of cells(sh)) if (!tileOk(x0 + cell.dx, y0 + cell.dy)) return false;
    return true;
  };
  const pieces: WallPiece[] = [];
  const claimed = new Set<number>();
  const claim = (sh: string, x0: number, y0: number, k: string): boolean => {
    const cl = cells(sh);
    for (const cell of cl) if (claimed.has((y0 + cell.dy) * W + x0 + cell.dx)) return false;
    if (!fits(sh, x0, y0)) return false;
    for (const cell of cl) claimed.add((y0 + cell.dy) * W + x0 + cell.dx);
    pieces.push({ k, s: sh, x: x0, y: y0, b: 0 });
    return true;
  };
  // gates where the four straight streets cross the line, the avenue's first
  const fr = frame(c);
  const gates: [number, number, string, number, number][] = [
    [0, R, 'tgate~H', -2, -1], [R, 0, 'tgate~V', -1, -2], [0, -R, 'tgate~H', -2, -1], [-R, 0, 'tgate~V', -1, -2],
  ];
  gates.sort((a, b) => (b[0] * fr.gx + b[1] * fr.gy) - (a[0] * fr.gx + a[1] * fr.gy));
  const kc0 = cacheOf(c);
  for (const [gx, gy, sh, ox, oy] of gates) {
    // a gate only where there is a way up to it from the town and away from it outside (a house
    // built across the avenue long ago makes it no place for a gate)
    const nx = -Math.sign(gx);
    const ny = -Math.sign(gy);
    const inI = (cy + gy + ny * 2) * W + cx + gx + nx * 2;
    const outI = (cy + gy - ny * 2) * W + cx + gx - nx * 2;
    if (!kc0.reach[inI] || !kc0.walk[outI]) continue;
    claim(sh, cx + gx + ox, cy + gy + oy, 'tgate');
  }
  // towers at the eight corners, and halfway along each straight side between corner and gate
  const tw = (x: number, y: number): string => (y === R ? 'wtower~s' : y === -R ? 'wtower~n' : x === R ? 'wtower~e' : 'wtower~w');
  const m = Math.round(s / 2);
  for (const [vx, vy] of V.slice(1, 9)) claim(tw(vx, vy), cx + vx - 1, cy + vy - 1, 'wtower');
  for (const [vx, vy] of [[m, R], [-m, R], [R, m], [R, -m], [m, -R], [-m, -R], [-R, m], [-R, -m]]) claim(tw(vx, vy), cx + vx - 1, cy + vy - 1, 'wtower');
  // on each diagonal side: a postern in the middle and a small tower a quarter of the way from each end
  const diag: [number, number][][] = [[], [], [], []];
  for (const [x, y, side] of ring) if (side % 2 === 1) diag[(side - 1) / 2].push([x, y]);
  const DT: Record<number, [string, number, number]> = { 0: ['wtower~se', 0, 0], 1: ['wtower~ne', 0, -1], 2: ['wtower~nw', -1, -1], 3: ['wtower~sw', -1, 0] };
  for (let d = 0; d < 4; d++) {
    const run = diag[d].filter(([x, y]) => !claimed.has(y * W + x));
    if (run.length < 8) continue;
    const mid = run[Math.floor(run.length / 2)];
    claim('tgate~p', mid[0], mid[1], 'tgate');
    const [sh, ox, oy] = DT[d];
    for (const at of [Math.floor(run.length / 4), Math.floor((run.length * 3) / 4)]) claim(sh, run[at][0] + ox, run[at][1] + oy, 'wtower');
  }
  // the road (and any worn way out across the line) gets a postern of its own, unless a gate is near
  const gateTiles: number[] = [];
  const refreshGates = (): void => {
    gateTiles.length = 0;
    for (const p of pieces) if (p.k === 'tgate') for (const cell of cells(p.s)) if (cell.ch === 'g') gateTiles.push((p.y + cell.dy) * W + p.x + cell.dx);
  };
  refreshGates();
  for (let n = 0; n < ring.length; n++) {
    const [x, y] = ring[n];
    const i = y * W + x;
    if (c.ter[i] !== T.PATH || claimed.has(i) || !tileOk(x, y)) continue;
    let near = false;
    for (const g of gateTiles) if (Math.max(Math.abs((g % W) - x), Math.abs(Math.floor(g / W) - y)) <= 5) near = true;
    if (!near && claim('tgate~p', x, y, 'tgate')) refreshGates();
  }
  // nobody may be shut away from ground they could reach before: wherever the line would cut off
  // land (a field beyond a river bend, a meadow between rock and wall), a postern is put in
  // (what stands now counts: a house is as much in the way as a cliff)
  const kc = cacheOf(c);
  const passable = (i: number): boolean => { const t = c.ter[i]; return kc.walk[i] > 0 || (!c.sb[i] && t !== T.DEEP && t !== T.ROCK); };
  const ringSet = new Set<number>();
  for (const [x, y] of ring) if (tileOk(x, y)) ringSet.add(y * W + x);
  const blockedAll = (): Set<number> => {
    const out = new Set<number>(ringSet);
    for (const p of pieces) for (const cell of cells(p.s)) {
      const i = (p.y + cell.dy) * W + p.x + cell.dx;
      if (cell.ch === 'Z' || cell.ch === 'P') out.add(i);
      else out.delete(i);
    }
    return out;
  };
  const flood = (blocked: Set<number> | null): Uint8Array => {
    const seen = new Uint8Array(W * H);
    const q: number[] = [cy * W + cx];
    seen[cy * W + cx] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H || seen[j] || !passable(j) || (blocked && blocked.has(j))) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    return seen;
  };
  const before = flood(null);
  for (let tries = 0; tries < 16; tries++) {
    const now = flood(blockedAll());
    let fix = -1;
    for (const [x, y] of ring) {
      const i = y * W + x;
      if (claimed.has(i) || !ringSet.has(i)) continue;
      let inR = false;
      let lost = false;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (now[j]) inR = true;
        else if (before[j] && !ringSet.has(j)) lost = true;
      }
      if (inR && lost) { fix = i; break; }
    }
    if (fix < 0) break;
    if (!claim('tgate~p', fix % W, Math.floor(fix / W), 'tgate')) break;
  }
  // the rest of the line: stretches of wall, no more than seven tiles each, cut where a side turns
  // and where the line meets water or bare rock
  const DIR = ['h', 'a', 'v', 'd', 'h', 'a', 'v', 'd'];
  let run: [number, number][] = [];
  let runSide = -1;
  const flush = (): void => {
    if (!run.length) return;
    const xs = run.map((t) => t[0]);
    const ys = run.map((t) => t[1]);
    const n = run.length;
    pieces.push({ k: 'twall', s: 'twall~' + DIR[runSide] + n, x: Math.min(...xs), y: Math.min(...ys), b: 0 });
    for (const [x, y] of run) claimed.add(y * W + x);
    run = [];
  };
  for (const [x, y, side] of ring) {
    const i = y * W + x;
    if (claimed.has(i) || !tileOk(x, y)) { flush(); continue; }
    if (side !== runSide || run.length >= 7) flush();
    runSide = side;
    run.push([x, y]);
  }
  flush();
  // the order they go up in: the gates first (the avenue's gate before all), then outward round the line
  const ringAt = new Map<number, number>();
  ring.forEach(([x, y], n) => ringAt.set(y * W + x, n));
  const pos = (p: WallPiece): number => {
    let best = 1e9;
    for (const cell of cells(p.s)) { const n = ringAt.get((p.y + cell.dy) * W + p.x + cell.dx); if (n !== undefined && n < best) best = n; }
    return best;
  };
  const gate0 = pieces.find((p) => p.k === 'tgate');
  const start = gate0 ? pos(gate0) : 0;
  const L = ring.length;
  const dist = (p: WallPiece): number => { const d = Math.abs(pos(p) - start); return Math.min(d, L - d); };
  pieces.sort((a, b) => (a.k === 'tgate' ? 0 : 1) - (b.k === 'tgate' ? 0 : 1) || dist(a) - dist(b) || pos(a) - pos(b));
  return pieces;
}

// ---------- Raising it ----------

/** Can this land hold a town wall (the old, small maps cannot)? */
export const wallLand = (c: Colony): boolean => Math.min(c.w, c.h) >= 100;

function wantsWall(c: Colony): boolean {
  if (dayOf(c.tick) < 15 || !c.blds.some((b) => b.k === 'hall' && b.built) || c.stock.wood < 60) return false;
  return c.pawns.length >= 35 || (c.stats.raids ?? 0) >= 1;
}

function wantsStone(c: Colony): boolean {
  const w = c.walls!;
  const rested = c.tick - (w.at[0] ?? 0) >= REST_DAYS * TICKS_PER_DAY;
  const reason = c.pawns.length >= 50 || (c.stats.raids ?? 0) >= 3 || (c.castle?.stage ?? 0) >= 2 || !!c.siege;
  return rested && reason && c.stock.stone >= 120;
}

const bldById = (c: Colony, id: number): Bld | undefined => (id > 0 ? c.blds.find((b) => b.id === id) : undefined);

/** Lay out one piece for building (a new one, or one rebuilt in stone where it stands). */
function lay(c: Colony, p: WallPiece, stage: number): boolean {
  const old = bldById(c, p.b);
  if (old && stage >= 2 && !old.mat && old.built) {
    // rebuilt in stone where it stands: the old timber stays up until the stone replaces it
    const n = cells(p.s).length;
    old.mat = 1;
    old.built = false;
    old.prog = 0;
    old.dmg = 0;
    old.br = undefined;
    old.need = { wood: Math.round(n * 0.6) + (p.k === 'tgate' ? 15 : 0), stone: n * STONE_TILE + (p.k === 'tgate' ? 20 : p.k === 'wtower' ? 10 : 0) };
    if (p.k === 'tgate' && p.s !== 'tgate~p') old.name = 'Gatehouse';
    return true;
  }
  if (old) return false;
  // the ground must be the wall's: nothing else built on it, no grave or street thing in the way
  for (const cell of cells(p.s)) {
    const i = (p.y + cell.dy) * c.w + p.x + cell.dx;
    if (c.sb[i] || (c.st[i] && c.st[i] !== B.RUBBLE) || c.ter[i] === T.DEEP || c.ter[i] === T.ROCK) return false;
  }
  for (const cell of cells(p.s)) {
    const i = (p.y + cell.dy) * c.w + p.x + cell.dx;
    if (c.st[i] === B.RUBBLE) c.st[i] = 0;
    // a wall stands on firm ground: the ford it crosses is filled, the stones and logs cleared
    if (c.ter[i] === T.SHALLOW || c.ter[i] === T.MARSH) c.ter[i] = T.DIRT;
    if (c.feat[i] === F.ORE || c.feat[i] === F.RUIN || c.feat[i] === F.BOULDER) c.stock.stone += 3;
  }
  const mat = stage >= 2 ? 1 : 0;
  const b = placeBuilding(c, p.k, p.x, p.y, false, 0, p.s);
  if (mat) {
    const n = cells(p.s).length;
    b.mat = 1;
    b.need = { wood: Math.round(n * 0.6) + (p.k === 'tgate' ? 15 : 0), stone: n * STONE_TILE + (p.k === 'tgate' ? 20 : p.k === 'wtower' ? 10 : 0) };
  }
  if (p.k === 'tgate' && p.s !== 'tgate~p') b.name = mat ? 'Gatehouse' : 'Town gate';
  if (p.s === 'tgate~p') b.name = 'Postern';
  p.b = b.id;
  return true;
}

/** Is this piece finished for the stage? */
function standing(c: Colony, p: WallPiece, stage: number): boolean {
  if (p.b < 0) return true;
  const b = bldById(c, p.b);
  return !!b && b.built && b.mat >= (stage >= 2 ? 1 : 0);
}

/** Once a day: the wall begun, its next pieces laid out, a finished stage marked, lost pieces laid out again. */
export function dailyWalls(c: Colony): void {
  if (!wallLand(c) || !c.pawns.length) return;
  let w = c.walls;
  if (!w) {
    if (!wantsWall(c)) return;
    w = c.walls = { stage: 1, done: 0, shut: 0, at: [], pl: planWalls(c) };
    log(c, 'walls', c.gov.ruler || undefined, undefined, 'begun', 1);
  }
  const pl = w.pl;
  // a piece pulled down or burned is forgotten, to be laid out again
  for (const p of pl) if (p.b > 0 && !bldById(c, p.b)) p.b = 0;
  if (w.stage === w.done && w.done < 2 && wantsStone(c)) {
    w.stage = 2;
    log(c, 'walls', c.gov.ruler || undefined, undefined, 'begun', 2);
  }
  const stage = Math.max(1, w.stage);
  const threat = !!c.siege || c.foes.length > 0;
  let open = 0;
  for (const p of pl) {
    if (p.b <= 0) continue;
    const b = bldById(c, p.b);
    if (b && !b.built) open++;
  }
  for (const p of pl) {
    if (open >= (threat ? LAID + 2 : LAID)) break;
    if (standing(c, p, stage) || p.b < 0) continue;
    const b = bldById(c, p.b);
    if (b && !b.built) continue;
    if (lay(c, p, stage)) open++;
    else {
      // ground that will not come clear (someone's grave, a building of old) is given up on after a while
      const k = 'wallwait' + pl.indexOf(p);
      c.stats[k] = (c.stats[k] ?? 0) + 1;
      if (c.stats[k] > 20) { p.b = -1; delete c.stats[k]; }
    }
  }
  if (w.stage > w.done && pl.every((p) => standing(c, p, w!.stage))) {
    w.done = w.stage;
    w.at.push(c.tick);
    log(c, 'walls', c.gov.ruler || undefined, undefined, 'done', w.done);
    bump(c, 'wallsDone');
  }
}

/** Stone the quarriers should lay by for the wall (while the stone wall is wanted or going up). */
export function wallStone(c: Colony): number {
  const w = c.walls;
  if (!w || w.done >= 2) return 0;
  if (w.stage >= 2) return 90;
  return w.done >= 1 && (c.pawns.length >= 45 || (c.stats.raids ?? 0) >= 2) ? 130 : 0;
}

// ---------- The gates ----------

/** Shut at night, while the alarm is up and through a siege; open by day. */
export function gatesShut(c: Colony): boolean {
  if (c.alarm || (c.siege && c.siege.phase < 2)) return true;
  const hour = Math.floor((c.tick % TICKS_PER_DAY) / TICKS_PER_HOUR);
  return hour >= 21 || hour < 5;
}

/** Each tick: the gates opened or shut. */
export function tickGates(c: Colony): void {
  const w = c.walls;
  if (!w) return;
  const shut = gatesShut(c) ? 1 : 0;
  if (shut !== w.shut) w.shut = shut;
}

// ---------- Under attack ----------

/** The tiles of the wall a foe can get at from where it stands: its outer face, gates first. */
export function wallTarget(c: Colony, fx: number, fy: number, ram: boolean, ladders: boolean): number {
  const w = c.walls;
  if (!w) return 0;
  const fm = foeMap(c);
  const W = c.w;
  const here = fm.comp[fy * W + fx];
  if (!here) return 0;
  let best = 0;
  let bd = 1e9;
  for (const p of w.pl) {
    const b = p.b > 0 ? bldById(c, p.b) : undefined;
    if (!b) continue;
    for (const cell of cells(shapeOf(b))) {
      const i = (b.y + cell.dy) * W + b.x + cell.dx;
      const s = c.st[i];
      if (s !== B.PALISADE && s !== B.CWALL && s !== B.CTOWER && s !== B.GATE) continue;
      if (s === B.GATE && fm.walk[i]) continue;
      const x = i % W;
      const y = (i - x) / W;
      // it must face the foe's side of the wall
      if (!(fm.comp[i - 1] === here || fm.comp[i + 1] === here || fm.comp[i - W] === here || fm.comp[i + W] === here)) continue;
      const gate = s === B.GATE;
      let d = Math.max(Math.abs(x - fx), Math.abs(y - fy)) + (gate ? (ram ? -14 : -5) : ladders ? -3 : 0) + (s === B.CTOWER ? 8 : 0) - b.dmg * 0.1;
      d += (i % 7) * 0.01;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

/** How much a blow takes out of a piece of wall: timber gives sooner than stone, a gate sooner than a wall. */
function toughness(b: Bld, s: number): number {
  if (s === B.GATE) return b.mat ? 80 : 45;
  if (s === B.CTOWER) return 90;
  return b.mat ? 60 : 24;
}

/**
 * A foe hammers at the wall (or a gate) at tile i. With a ram a gate gives far sooner; with
 * ladders a raider may go over the top. Returns where the foe ends up, if it climbed over.
 */
export function hitWall(c: Colony, i: number, dmg: number, ram: boolean, ladder: boolean, chance: number): number {
  const b = bldById(c, c.sb[i]);
  if (!b || !isWallPart(b)) return -1;
  const s = c.st[i];
  if (ladder && s !== B.GATE && chance < 0.05) {
    // up a ladder and over: onto the ground just inside
    const W = c.w;
    const x = i % W;
    const y = (i - x) / W;
    const dIn = octo(x - c.cx, y - c.cy);
    for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [0, -2], [2, 0], [-2, 0]]) {
      const nx = x + ox;
      const ny = y + oy;
      const j = ny * W + nx;
      // (only ground further in than the wall itself: the town side)
      if (octo(nx - c.cx, ny - c.cy) > dIn - 0.6) continue;
      if (foeMap(c).walk[j]) return j;
    }
  }
  b.dmg = Math.min(100, b.dmg + (dmg / toughness(b, s)) * (ram && s === B.GATE ? 1.5 : 1));
  if (b.dmg >= 100) breach(c, b, i);
  return -1;
}

/** A piece of wall gives way: a few tiles of it lie in rubble until it is mended. */
export function breach(c: Colony, b: Bld, at: number): void {
  const list = cells(shapeOf(b));
  const W = c.w;
  const ax = at % W;
  const ay = (at - ax) / W;
  const br: number[] = [];
  list.forEach((cell, n) => {
    const x = b.x + cell.dx;
    const y = b.y + cell.dy;
    if (Math.max(Math.abs(x - ax), Math.abs(y - ay)) <= 1 && 'PZg'.includes(cell.ch)) br.push(n);
  });
  if (!br.length) return;
  b.br = br;
  b.dmg = 100;
  syncTiles(c, b);
  log(c, 'breach', undefined, undefined, b.k === 'tgate' ? (b.mat ? 'gatehouse' : 'gate') : b.k === 'wtower' ? 'tower' : b.mat ? 'wall' : 'palisade', b.id);
  bump(c, 'breaches');
}

/** A mended piece of wall: the rubble is cleared and the gap closed. */
export function mended(c: Colony, b: Bld): void {
  if (!b.br || b.dmg > 40) return;
  b.br = undefined;
  syncTiles(c, b);
  log(c, 'mended', undefined, undefined, b.k === 'tgate' ? 'gate' : 'wall', b.id);
}

/** Built pieces of the wall a colonist may stand in or behind to shoot from: tower floors and the gatehouses' inner flags. */
export function wallPosts(c: Colony): number[] {
  const out: number[] = [];
  const w = c.walls;
  if (!w) return out;
  for (const p of w.pl) {
    const b = p.b > 0 ? bldById(c, p.b) : undefined;
    if (!b || !b.built) continue;
    for (const cell of cells(shapeOf(b))) {
      if (cell.ch !== '.' && cell.ch !== ',') continue;
      const x = b.x + cell.dx;
      const y = b.y + cell.dy;
      if (cell.ch === ',' && !insideWall(c, x, y) && octo(x - c.cx, y - c.cy) >= wallR(c) - 0.01) continue;
      out.push(y * c.w + x);
    }
  }
  return out;
}

/**
 * The ground kept open on both sides of each gate (three tiles deep), so no building ever shuts
 * a gate off from the town or the fields. Worked out once per wall plan.
 */
const ways = new WeakMap<object, { n: number; m: Uint8Array }>();
export function gateWays(c: Colony): Uint8Array | undefined {
  const w = c.walls;
  if (!w) return undefined;
  const got = ways.get(w.pl);
  if (got && got.n === w.pl.length) return got.m;
  const m = new Uint8Array(c.w * c.h);
  const W = c.w;
  for (const p of w.pl) {
    if (p.k !== 'tgate') continue;
    for (const cell of cells(p.s)) {
      if (cell.ch !== 'g') continue;
      const x = p.x + cell.dx;
      const y = p.y + cell.dy;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < c.h && Math.abs(dx) + Math.abs(dy) <= 4) m[ny * W + nx] = 1;
      }
    }
  }
  ways.set(w.pl, { n: w.pl.length, m });
  return m;
}

/**
 * Nobody is ever walled in: a colonist who finds themselves on a tile cut off from the town (a
 * stretch of wall finished round the builder, a gateway closed in at both ends) climbs out to the
 * nearest open ground. Checked once an hour for each colonist, and only on the wall's band.
 */
export function unstick(c: Colony, p: Pawn): void {
  if (!c.walls || c.tick < p.act.ta) return;
  const k = cacheOf(c);
  const W = c.w;
  const i = p.y * W + p.x;
  if (k.reach[i] || k.reach[i - 1] || k.reach[i + 1] || k.reach[i - W] || k.reach[i + W]) return;
  const R = wallR(c);
  const od = octo(p.x - c.cx, p.y - c.cy);
  if (k.walk[i] && (od < R - 3 || od > R + 3)) return;
  for (let r = 1; r <= 8; r++) {
    for (let y = p.y - r; y <= p.y + r; y++) {
      for (let x = p.x - r; x <= p.x + r; x++) {
        if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) !== r || x < 1 || y < 1 || x >= W - 1 || y >= c.h - 1) continue;
        const j = y * W + x;
        if (!k.reach[j] || !k.walk[j]) continue;
        p.x = x;
        p.y = y;
        p.act = idleAct(c, p, 1, 'idle');
        return;
      }
    }
  }
}

/** Name of a wall piece's plan, for the cards. */
export const wallName = (b: Bld): string => b.name ?? (b.k === 'twall' ? (b.mat ? 'Town wall' : 'Palisade') : TPL[b.k]?.name ?? b.k);

