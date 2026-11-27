// Homes that show who lives in them. A family with silver builds a home of its own (a house, a
// narrow townhouse in the inner streets, a manor by the keep for the great families); it pays for
// it, and for its keep. Homes are made finer only as far as their kind allows, so a shack stays a
// shack. Homes that stand empty, or whose owners can no longer pay, go to seed; long-empty ones
// in a town with beds to spare are pulled down for their timber.

import { TICKS_PER_DAY, dayOf } from '../config';
import { touch, touchAt } from './cache';
import { CASTLE_KINDS, DECOR, cellCode, isDecor, shapeOf, spots } from './data/buildings';
import { log } from './events';
import { RANK } from './gov';
import { think } from './mood';
import { STAGE, awayById, pawnById, stage } from './pawn';
import { assignBeds, build, sharesWithStrangers } from './planner';
import { B, type Bld, type Colony, type Pawn } from './types';

/** How fine each kind of home is: 0 a shack, 4 a manor. */
export const TIER: Record<string, number> = { shack: 0, cottage: 1, longhouse: 1, house: 2, bighouse: 2, townhouse: 3, manor: 4 };
/** How far each tier of home can be made fine (its quality). */
const QCAP = [30, 56, 68, 84, 92];
export const homeCap = (k: string): number => QCAP[TIER[k] ?? 2];
/** What a family pays toward a home of its own, and what it costs them a day to keep up (servants,
 * firewood, the garden): a fine house is a drain on all but the richest. */
const PRICE: Record<string, number> = { house: 30, bighouse: 40, townhouse: 90, manor: 170 };
const UPKEEP = [0, 0, 0.08, 0.55, 1.5];
/** Days a family has to move into a home it has just bought or finished. */
const GRACE = 6 * TICKS_PER_DAY;

/** A grown colonist's household: them, their partner, and the children of either still at home age. */
export function household(c: Colony, p: Pawn): Pawn[] {
  const o = p.sp ? pawnById(c, p.sp) : undefined;
  const out = [p];
  if (o) out.push(o);
  for (const k of c.pawns) {
    if (k === p || k === o || stage(c, k) >= STAGE.ADULT) continue;
    if (k.mo === p.id || k.fa === p.id || (o && (k.mo === o.id || k.fa === o.id))) out.push(k);
  }
  return out;
}

/** Take silver from a family, the head first; returns what was paid. */
function pay(c: Colony, p: Pawn, n: number): number {
  const o = p.sp ? pawnById(c, p.sp) : undefined;
  let left = n;
  for (const x of o ? [p, o] : [p]) {
    const take = Math.min(x.coin, left);
    x.coin -= take;
    left -= take;
  }
  c.stock.silver += n - left;
  return n - left;
}

/** Once every few days: the family best placed to move up builds a home of its own. */
export function prosper(c: Colony): boolean {
  if (c.stock.wood < 40) return false;
  for (const b of c.blds) if (b.own && !b.built) return false;
  const pop = c.pawns.length;
  let manors = 0;
  let towns = 0;
  for (const b of c.blds) { if (b.k === 'manor') manors++; else if (b.k === 'townhouse') towns++; }
  let best: Pawn | undefined;
  let bestK = '';
  let bestS = -1;
  for (const p of c.pawns) {
    if (p.gone || p.thrall || p.rank <= RANK.OUTCAST || stage(c, p) < STAGE.ADULT) continue;
    const o = p.sp ? pawnById(c, p.sp) : undefined;
    // a couple decides together, once
    if (o && o.id < p.id && stage(c, o) >= STAGE.ADULT) continue;
    const coin = p.coin + (o?.coin ?? 0);
    if (coin < 45) continue;
    const rank = Math.max(p.rank, o?.rank ?? 0);
    const fam = household(c, p);
    const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
    // the ruler's family, housed in the castle, wants for nothing in the town
    if (home && CASTLE_KINDS.has(home.k)) continue;
    // sharing a roof with strangers counts as having nowhere of one's own
    const cur = home && !sharesWithStrangers(c, p) ? TIER[home.k] ?? 2 : -1;
    let k = '';
    if (((rank >= RANK.NOBLE && coin >= 50) || coin >= 170) && manors < 1 + Math.floor(pop / 30)) k = 'manor';
    else if (coin >= 90 && fam.length <= 2 && towns < Math.floor(pop / 8)) k = 'townhouse';
    else k = fam.length >= 3 ? 'bighouse' : 'house';
    const tier = TIER[k];
    if (tier <= cur || (home && home.beds.length < fam.length && tier === cur)) continue;
    const s = (tier - cur) * 100 + coin + rank * 20;
    if (s > bestS) { bestS = s; best = p; bestK = k; }
  }
  if (!best) return false;
  // an empty home as good as the one they want is bought, not built again
  const want = TIER[bestK];
  const size = household(c, best).length;
  let buy: Bld | undefined;
  for (const b of c.blds) {
    if (!b.built || b.own || !b.beds.length || b.beds.some((x) => x) || (TIER[b.k] ?? 2) < want || b.beds.length < size || CASTLE_KINDS.has(b.k) || b.k === 'infirmary') continue;
    if (!buy || b.q - b.dmg > buy.q - buy.dmg) buy = b;
  }
  if (buy) {
    buy.own = best.id;
    buy.got = c.tick;
    const paid = pay(c, best, Math.round((PRICE[buy.k] ?? 30) * 0.6));
    log(c, 'prosper', best.id, best.sp || undefined, buy.k, Math.round(paid));
    // they move in today
    assignBeds(c, false);
    return true;
  }
  // with plenty of plain beds standing empty, no new plain house is built: they wait for one to
  // come free (a townhouse or a manor is about standing, not room, and is built regardless)
  // (and plain houses go up one at a time, a few weeks apart)
  if (want <= 2 && (spareBeds(c) >= 6 + Math.floor(pop / 10) || c.stock.wood < 120 || dayOf(c.tick) % 9 !== 0)) return false;
  // no room left for a manor: a fine townhouse (or a big family house) will do
  let b = build(c, bestK);
  if (!b && bestK === 'manor') {
    bestK = household(c, best).length <= 2 ? 'townhouse' : 'bighouse';
    b = build(c, bestK);
  }
  if (!b) return false;
  b.own = best.id;
  b.got = c.tick;
  const paid = pay(c, best, PRICE[bestK] ?? 30);
  log(c, 'prosper', best.id, best.sp || undefined, bestK, Math.round(paid));
  return true;
}

/** Empty beds standing in the town's homes (a family's own spare room counts: lodgers go there last). */
function spareBeds(c: Colony): number {
  let n = 0;
  for (const b of c.blds) {
    if (!b.built || !b.beds.length || CASTLE_KINDS.has(b.k)) continue;
    for (const id of b.beds) if (!id) n++;
  }
  return n;
}

/** The heir to a family's home: the partner, else the eldest grown child living there. */
function heirOf(c: Colony, b: Bld, id: number): number | undefined {
  for (const bid of b.beds) {
    const p = bid ? pawnById(c, bid) : undefined;
    if (!p) continue;
    if (p.sp === id) return p.id;
  }
  let best: Pawn | undefined;
  for (const bid of b.beds) {
    const p = bid ? pawnById(c, bid) : undefined;
    if (!p || stage(c, p) < STAGE.ADULT || (p.mo !== id && p.fa !== id)) continue;
    if (!best || p.born < best.born) best = p;
  }
  return best?.id;
}

/** Take the finer things out of a home that has come down in the world. */
export function unfurnish(c: Colony, b: Bld): void {
  const want = (b.q >= 50 ? 1 : 0) + (b.q >= 64 ? 1 : 0) + (b.q >= 76 ? 1 : 0) + (b.q >= 88 ? 1 : 0);
  const have: number[] = [];
  const floor = spots(shapeOf(b), '.');
  for (const cell of floor) { const i = (b.y + cell.dy) * c.w + b.x + cell.dx; if (isDecor(c.st[i])) have.push(i); }
  if (have.length <= want) return;
  // the last things bought go first
  have.sort((x, y) => DECOR.indexOf(c.st[y]) - DECOR.indexOf(c.st[x]) || x - y);
  for (let n = have.length; n > want; n--) {
    const i = have[have.length - n];
    c.st[i] = cellCode(b.k, '.', b.mat);
    touchAt(c, i, false);
  }
}

/** Pull a building down: its ground goes back to the colony. */
export function raze(c: Colony, b: Bld): void {
  for (let dy = 0; dy < b.h; dy++) {
    for (let dx = 0; dx < b.w; dx++) {
      const i = (b.y + dy) * c.w + b.x + dx;
      if (c.sb[i] !== b.id) continue;
      c.sb[i] = 0;
      if (c.st[i] !== B.GRAVE) c.st[i] = 0;
    }
  }
  for (const p of c.pawns) if (p.home === b.id) p.home = 0;
  c.blds = c.blds.filter((x) => x !== b);
  touch(c);
}

/** Once a day: homes are kept up, or not. */
export function upkeep(c: Colony): void {
  let free = spareBeds(c);
  let razed = false;
  for (const b of c.blds.slice()) {
    if (!b.built || !b.beds.length || b.k === 'infirmary' || CASTLE_KINDS.has(b.k)) continue;
    const lived = b.beds.some((x) => x);
    if (lived) delete b.vac;
    else if (b.vac === undefined) b.vac = c.tick;
    const tier = TIER[b.k] ?? 2;
    if (b.own) {
      const o = pawnById(c, b.own);
      // the family moved on to somewhere better, or died out: it is anyone's now
      if (!o) { if (!awayById(c, b.own)) { const h = heirOf(c, b, b.own); if (h) b.own = h; else delete b.own; } }
      // (a family that has only just bought or finished it has a few days to move in)
      else if (o.home !== b.id && b.beds.every((x) => x !== o.id) && c.tick - (b.got ?? 0) > GRACE) delete b.own;
    }
    if (!lived) {
      b.q = Math.max(8, b.q - 0.6);
      if (c.tick - b.vac! > 20 * TICKS_PER_DAY) b.dmg = Math.min(80, b.dmg + 0.5);
    } else if (b.own) {
      const o = pawnById(c, b.own);
      const fee = UPKEEP[tier];
      if (o && fee > 0) {
        const have = o.coin + (o.sp ? pawnById(c, o.sp)?.coin ?? 0 : 0);
        if (have >= fee) pay(c, o, fee);
        else {
          b.q = Math.max(20, b.q - 1.2);
          // they can no longer keep it: it goes to whoever needs it
          if (b.q < homeCap(b.k) - 24) {
            delete b.own;
            delete b.got;
            think(c, o, 'shabbyhome');
            log(c, 'home_lost', o.id, undefined, b.k);
          }
        }
      }
    }
    if (b.q > homeCap(b.k) + 2) b.q = Math.max(homeCap(b.k), b.q - 0.5);
    unfurnish(c, b);
    // long empty and falling in, and there are beds to spare: pulled down for its timber
    if (!lived && !b.own && !razed && tier <= 2 && c.tick - b.vac! > 50 * TICKS_PER_DAY && b.dmg >= 28 && free - b.beds.length >= 4) {
      free -= b.beds.length;
      c.stock.wood += 6;
      log(c, 'razed', undefined, undefined, b.k);
      raze(c, b);
      razed = true;
    }
  }
}
