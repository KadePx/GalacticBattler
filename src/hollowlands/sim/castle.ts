// The castle on the rise. A ruler who means to stay (a lord, a chief, a tyrant), or any town grown
// big and rich enough, raises it in three stages as timber, stone and silver allow:
//   1. a palisade of stakes round the rise and a timber hall inside it;
//   2. the stone keep: a great hall with the throne and the house's banners, the ruler's chambers,
//      a chapel;
//   3. the curtain wall with a tower at each corner and a gatehouse toward the town, barracks where
//      the timber hall stood, and stables.
// Every part is laid out on one plan (see CASTLE_AT) and built like any other building, by the
// colony's builders, from its stores. The ruler and their family live in it; audiences and feasts
// are held in its hall; the guards sleep and drill in its barracks; its towers are walls to shoot from.

import { TICKS_PER_DAY, dayOf } from '../config';
import { touch } from './cache';
import { CASTLE_AT, CASTLE_KINDS, CASTLE_N, TPL, shapeOf, spots } from './data/buildings';
import { log } from './events';
import { raze } from './homes';
import { assignBeds, placeBuilding } from './planner';
import { pawnById } from './pawn';
import { keepR } from './town';
import { B, F, T, type Bld, type Colony } from './types';

export { CASTLE_KINDS };

/** The parts each stage raises. */
const STAGE_PARTS: string[][] = [[], ['palisade', 'motte'], ['keep'], ['curtain', 'gatehouse', 'barracks', 'stables']];
/** Silver paid out to the masons when a stage begins (the timber stage asks none). */
const SILVER = [0, 0, 60, 100];
/** Stone in the stores before a stage is begun (the rest is quarried as the work goes on). */
const STONE = [0, 0, 120, 150];
/** Days between one stage finishing and the next being begun: the work is spread over years. */
const REST_DAYS = 55;
/** Days a colony must have stood before its ruler begins a castle. */
const MIN_AGE_DAYS = 30;

/** Can this colony's land hold a castle at all (the old, small maps cannot)? */
export const castleLand = (c: Colony): boolean => !!c.keep && keepR(c) >= 13;

/** Which way the castle faces: its gate toward the town. 0 south, 1 west, 2 north, 3 east (quarter turns of the plan). */
export function castleTurn(c: Colony): number {
  const k = c.keep!;
  const dx = c.cx - k.x;
  const dy = c.cy - k.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 0 : 2;
  return dx < 0 ? 1 : 3;
}

/** Where a part of the castle stands on the map, and the floor plan it takes there. */
export function partSite(c: Colony, k: string, turn: number): { x: number; y: number; shape: string } {
  const at = CASTLE_AT[k];
  const t = TPL[k];
  let x = at.x;
  let y = at.y;
  let w = t.rows[0].length;
  let h = t.rows.length;
  for (let n = 0; n < turn; n++) {
    // a quarter turn clockwise of the whole plan
    const nx = CASTLE_N - y - h;
    y = x;
    x = nx;
    const tw = w;
    w = h;
    h = tw;
  }
  const half = (CASTLE_N - 1) / 2;
  return { x: c.keep!.x - half + x, y: c.keep!.y - half + y, shape: turn ? `${k}~r${turn}` : k };
}

/** The castle's parts as they stand (built or not). */
export const castleParts = (c: Colony): Bld[] => c.blds.filter((b) => CASTLE_KINDS.has(b.k));

/** The hall where the ruler sits: the keep once it stands, else the timber hall. */
export function castleHall(c: Colony): Bld | undefined {
  let hall: Bld | undefined;
  for (const b of c.blds) {
    if (!b.built) continue;
    if (b.k === 'keep') return b;
    if (b.k === 'motte') hall = b;
  }
  return hall;
}

/** The throne's tile in the keep, if there is one. */
export function throneTile(c: Colony, b: Bld): number {
  const cell = spots(shapeOf(b), 'J')[0];
  return cell ? (b.y + cell.dy) * c.w + b.x + cell.dx : -1;
}

/** Where people gather in the castle's hall: the middle of the great hall, below the throne. */
export function hallSpot(c: Colony, b: Bld): { b: number; x: number; y: number } {
  const th = throneTile(c, b);
  if (th < 0) return { b: b.id, x: b.x + Math.floor(b.w / 2), y: b.y + Math.floor(b.h / 2) };
  // two paces from the throne, out into the hall (away from the wall behind it)
  const tx = th % c.w;
  const ty = Math.floor(th / c.w);
  let best = { b: b.id, x: tx, y: ty };
  for (const [dx, dy] of [[0, 2], [0, -2], [2, 0], [-2, 0]]) {
    const x = tx + dx;
    const y = ty + dy;
    if (c.sb[y * c.w + x] !== b.id) continue;
    const s = c.st[y * c.w + x];
    if (s === B.FLOOR_STONE || s === B.FLOOR_WOOD) { best = { b: b.id, x, y }; break; }
  }
  return best;
}

/** Make the ground under a part fit to build on: water filled, rock dressed, trees and stones cleared. */
function clearGround(c: Colony, x0: number, y0: number, rows: string[]): void {
  for (let dy = 0; dy < rows.length; dy++) {
    for (let dx = 0; dx < rows[dy].length; dx++) {
      if (rows[dy][dx] === ' ') continue;
      const i = (y0 + dy) * c.w + x0 + dx;
      const t = c.ter[i];
      if (t === T.DEEP || t === T.SHALLOW || t === T.MARSH || t === T.SAND) c.ter[i] = T.DIRT;
      else if (t === T.ROCK) c.ter[i] = T.STONE;
      if (c.feat[i] === F.ORE || c.feat[i] === F.RUIN || c.feat[i] === F.BOULDER) c.feat[i] = F.NONE;
      // street things or a stray grave do not stand in the way of a castle
      if (!c.sb[i] && c.st[i]) c.st[i] = 0;
    }
  }
  touch(c);
}

function placePart(c: Colony, k: string, turn: number): Bld {
  const { x, y, shape } = partSite(c, k, turn);
  const rows = TPL[shape].rows;
  // whatever of the castle stood on this ground before (the palisade under the curtain wall, the
  // timber hall where the barracks go) is pulled down for it
  const old = new Set<number>();
  for (let dy = 0; dy < rows.length; dy++) for (let dx = 0; dx < rows[dy].length; dx++) if (rows[dy][dx] !== ' ') { const id = c.sb[(y + dy) * c.w + x + dx]; if (id) old.add(id); }
  for (const id of old) { const b = c.blds.find((q) => q.id === id); if (b) raze(c, b); }
  clearGround(c, x, y, rows);
  const t = TPL[k];
  const b = placeBuilding(c, k, x, y, false, CASTLE_AT[k].mat, shape);
  b.need = { wood: t.wood, stone: t.stone };
  return b;
}

/** Is the colony minded and able to raise a castle? */
function wantsCastle(c: Colony): boolean {
  const pop = c.pawns.length;
  const lordly = c.gov.k === 'lord' || c.gov.k === 'chief' || c.gov.k === 'tyrant';
  if (lordly && pop >= 20) return true;
  // a big, rich town wants one whoever rules it
  return pop >= 50 && c.stock.stone >= 150 && c.stock.silver >= 60;
}

/** Once a day: the next stage of the castle begun, a finished one marked, and its lord housed in it. */
export function dailyCastle(c: Colony): void {
  if (!castleLand(c)) return;
  const ruler = pawnById(c, c.gov.ruler);
  const cs = c.castle;
  if (!cs) {
    if (!ruler || !wantsCastle(c)) return;
    // the town's own needs first: its hall and stores up, nobody sleeping rough, timber to spare
    let roofless = 0;
    for (const p of c.pawns) if (!p.home) roofless++;
    // and a colony settled in a while, with some stone laid by: no lord starts a castle on the first day
    if (!c.blds.some((b) => b.k === 'hall' && b.built) || c.stock.wood < 90 || roofless > 2) return;
    if (dayOf(c.tick) < MIN_AGE_DAYS || c.stock.stone < 40) return;
    c.castle = { stage: 0, work: 1, turn: castleTurn(c), at: [] };
    for (const k of STAGE_PARTS[1]) placePart(c, k, c.castle.turn);
    log(c, 'castle', ruler.id, undefined, 'begun', 1);
    return;
  }
  const parts = castleParts(c);
  // a part of a finished stage lost (burned, pulled down) is laid out again, unless a later stage has
  // built over it (the palisade under the curtain wall, the timber hall under the barracks)
  if (!cs.work) {
    const over = cs.stage >= 3 ? new Set(['palisade', 'motte']) : new Set<string>();
    for (let s = 1; s <= cs.stage; s++) for (const k of STAGE_PARTS[s]) if (!over.has(k) && !parts.some((b) => b.k === k)) { placePart(c, k, cs.turn); log(c, 'castle', ruler?.id, undefined, 'rebuild', s); }
  }
  if (cs.work) {
    // a part lost (burned, pulled down) is laid out again
    for (const k of STAGE_PARTS[cs.work]) if (!parts.some((b) => b.k === k)) placePart(c, k, cs.turn);
    if (STAGE_PARTS[cs.work].every((k) => c.blds.some((b) => b.k === k && b.built))) {
      cs.stage = cs.work;
      cs.work = 0;
      cs.at.push(c.tick);
      if (cs.stage === 3) paveCourt(c);
      log(c, 'castle', ruler?.id, undefined, 'done', cs.stage);
    }
  } else if (cs.stage < 3 && ruler && wantsCastle(c)) {
    const next = cs.stage + 1;
    const rested = c.tick - (cs.at[cs.stage - 1] ?? 0) >= REST_DAYS * TICKS_PER_DAY;
    if (rested && c.stock.stone >= STONE[next] && c.stock.silver >= SILVER[next] && c.stock.wood >= 60) {
      c.stock.silver -= SILVER[next];
      cs.work = next;
      for (const k of STAGE_PARTS[next]) placePart(c, k, cs.turn);
      log(c, 'castle', ruler.id, undefined, 'begun', next);
    }
  }
  // the ruler's house lives in the castle's hall
  const hall = castleHall(c);
  for (const b of castleParts(c)) {
    if (b !== hall && b.own) b.own = undefined;
  }
  if (hall && ruler && hall.own !== ruler.id) {
    hall.own = ruler.id;
    hall.got = c.tick;
    assignBeds(c, false);
  }
}

/** The castle's courtyard is laid with flags once the walls close round it. */
function paveCourt(c: Colony): void {
  const half = (CASTLE_N - 1) / 2;
  const k = c.keep!;
  for (let y = k.y - half + 1; y < k.y + half; y++) {
    for (let x = k.x - half + 1; x < k.x + half; x++) {
      const i = y * c.w + x;
      if (c.sb[i] || c.st[i]) continue;
      const t = c.ter[i];
      if (t === T.GRASS || t === T.DIRT || t === T.SOIL || t === T.PATH || t === T.SAND) c.ter[i] = T.STONE;
      if (c.feat[i] !== F.NONE) { c.feat[i] = F.NONE; c.fg[i] = 0; }
    }
  }
  touch(c);
}

/** Stone the quarriers should lay by for the castle's next stage (0 while none is wanted). */
export function castleStone(c: Colony): number {
  const cs = c.castle;
  if (!cs || cs.work || cs.stage >= 3 || !castleLand(c)) return 0;
  return STONE[cs.stage + 1] + 20;
}

/** Is this a castle part (not to be bought, sold, let or left to fall in like a home)? */
export const isCastle = (b: { k: string }): boolean => CASTLE_KINDS.has(b.k);
