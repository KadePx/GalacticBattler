// The land beyond the fences: animals that wander it, storms that bring trees down, mushrooms
// in autumn, and woods that grow back.

import { DAYS_PER_YEAR, dayOf, seasonOf } from '../config';
import { cacheOf, dropFeat, featList, touch } from './cache';
import { bump } from './events';
import { Rand, S } from './rng';
import { F, T, type Beast, type Colony } from './types';

/** What each animal is worth to a hunter, and how it behaves. */
export const BEAST_KINDS: Record<string, { name: string; meat: [number, number]; hide: number; shy: number; prey: boolean }> = {
  deer: { name: 'deer', meat: [14, 22], hide: 2, shy: 5, prey: true },
  boar: { name: 'boar', meat: [12, 18], hide: 1, shy: 3, prey: true },
  hare: { name: 'hare', meat: [3, 5], hide: 0, shy: 4, prey: true },
  fox: { name: 'fox', meat: [0, 0], hide: 1, shy: 6, prey: false },
};

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

function open(c: Colony, i: number): boolean {
  if (c.sb[i] || c.st[i]) return false;
  const t = c.ter[i];
  if (t === T.DEEP || t === T.ROCK || t === T.SHALLOW) return false;
  const f = c.feat[i];
  return f !== F.BOULDER && f !== F.ORE && f !== F.RUIN;
}

/** Every tick: animals graze, wander and shy away from people. */
export function stepWild(c: Colony): void {
  const list = c.beasts;
  if (!list || !list.length) return;
  const r = new Rand(c.seed, S.WILD, c.tick);
  for (const b of list) {
    b.px = b.x;
    b.py = b.y;
    const def = BEAST_KINDS[b.k];
    // anyone close? then move away from them, quickly
    let fx = 0;
    let fy = 0;
    let scared = false;
    for (const p of c.pawns) {
      if (p.act.k === 'sleep') continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (Math.abs(dx) <= def.shy && Math.abs(dy) <= def.shy) { fx += Math.sign(dx); fy += Math.sign(dy); scared = true; }
    }
    if (!scared && !r.chance(b.k === 'hare' ? 0.3 : 0.18)) continue;
    // keep away from the heart of the colony
    const cx = b.x - c.cx;
    const cy = b.y - c.cy;
    const home = cx * cx + cy * cy < 100;
    let best = -1;
    let bestS = -1e9;
    for (const [dx, dy] of STEPS) {
      const x = b.x + dx;
      const y = b.y + dy;
      if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) continue;
      const i = y * c.w + x;
      if (!open(c, i)) continue;
      let s = r.float();
      if (scared) s += dx * fx + dy * fy;
      if (home) s += (dx * Math.sign(cx) + dy * Math.sign(cy)) * 2;
      // deer and boar like the trees, hares like open ground and fields
      const f = c.feat[i];
      if ((b.k === 'deer' || b.k === 'boar') && (f === F.TREE || f === F.PINE)) s += 0.4;
      if (b.k === 'hare' && c.crop[i] > 0 && c.crop[i] < 255) s += 0.6;
      if (s > bestS) { bestS = s; best = i; }
    }
    if (best < 0) continue;
    b.x = best % c.w;
    b.y = Math.floor(best / c.w);
    // a hare in the vegetables
    const ci = best;
    if (b.k === 'hare' && c.crop[ci] > 20 && c.crop[ci] < 255 && r.chance(0.25)) { c.crop[ci] -= 15; bump(c, 'nibbled'); }
  }
}

/** Once a day: animals come and go with the game, storms fell trees, mushrooms, saplings. */
export function dailyWild(c: Colony): void {
  const day = dayOf(c.tick);
  const season = seasonOf(c.tick);
  const r = new Rand(c.seed, S.WILD, day, 1);
  const list = (c.beasts ??= []);

  // Animals: how many are about follows how much game the land holds
  const want = Math.min(11, Math.round((c.game / 9) * (season === 3 ? 0.6 : 1)));
  if (list.length > want) {
    // the one furthest out wanders off
    let far = 0;
    let fd = -1;
    list.forEach((b, i) => { const d = Math.abs(b.x - c.cx) + Math.abs(b.y - c.cy); if (d > fd) { fd = d; far = i; } });
    list.splice(far, 1);
  } else if (list.length < want) {
    for (let k = 0; k < 2 && list.length < want; k++) {
      const edge = r.int(4);
      const t = 1 + r.int(c.w - 2);
      const x = edge === 0 ? 1 : edge === 1 ? c.w - 2 : t;
      const y = edge === 2 ? 1 : edge === 3 ? c.h - 2 : edge < 2 ? t : t;
      if (!open(c, y * c.w + x)) continue;
      const forest = c.biome === 'valley' || c.biome === 'hills';
      const roll = r.float();
      const kind = roll < (forest ? 0.4 : 0.25) ? 'deer' : roll < (forest ? 0.6 : 0.4) ? 'boar' : roll < 0.85 ? 'hare' : 'fox';
      list.push({ id: (c.nextBeast = (c.nextBeast ?? 0) + 1), k: kind, x, y, px: x, py: y });
    }
  }

  // Storms bring trees down
  if (c.weather === 3) {
    const trees = featList(c, F.TREE);
    const n = Math.min(trees.length, 1 + r.int(3));
    for (let k = 0; k < n; k++) {
      const i = trees[r.int(trees.length)];
      if (c.feat[i] !== F.TREE) continue;
      c.feat[i] = F.LOG;
      c.fg[i] = 45;
      bump(c, 'stormfelled');
    }
    if (n) { dropFeat(c, F.TREE); dropFeat(c, F.LOG); touch(c); }
  }

  // Mushrooms come up under the trees in autumn and are gone with the frost
  const n = c.w * c.h;
  if (season === 3 || c.temp < -2) {
    let any = false;
    for (let i = 0; i < n; i++) if (c.feat[i] === F.MUSHROOM) { c.feat[i] = F.NONE; any = true; }
    if (any) { dropFeat(c, F.MUSHROOM); touch(c); }
  } else if (season === 2 && c.weather !== 3) {
    let have = 0;
    for (let i = 0; i < n; i++) if (c.feat[i] === F.MUSHROOM) have++;
    for (let k = 0; k < 6 && have < 24; k++) {
      const x = 2 + r.int(c.w - 4);
      const y = 2 + r.int(c.h - 4);
      const i = y * c.w + x;
      if (c.feat[i] !== F.NONE || c.sb[i] || c.st[i] || c.ter[i] !== T.GRASS) continue;
      const shade = c.feat[i - 1] === F.TREE || c.feat[i + 1] === F.TREE || c.feat[i - c.w] === F.TREE || c.feat[i + c.w] === F.TREE || c.feat[i - 1] === F.PINE || c.feat[i + 1] === F.PINE;
      if (!shade) continue;
      c.feat[i] = F.MUSHROOM;
      c.fg[i] = 100;
      have++;
      touch(c);
    }
    dropFeat(c, F.MUSHROOM);
  }

  // The wild seeds itself, out past the colony
  if (season < 3) {
    for (let k = 0; k < 2; k++) {
      const x = 2 + r.int(c.w - 4);
      const y = 2 + r.int(c.h - 4);
      const i = y * c.w + x;
      const dx = x - c.cx;
      const dy = y - c.cy;
      if (dx * dx + dy * dy < 400) continue;
      if (c.feat[i] !== F.NONE || c.sb[i] || c.st[i] || c.ter[i] !== T.GRASS) continue;
      c.feat[i] = F.SAPLING;
      c.fg[i] = 0;
      touch(c);
    }
  }
  void DAYS_PER_YEAR;
}

/** Find an open spot out in the wild to plant young trees. -1 if there is none. */
export function plantSpot(c: Colony, r: Rand): number {
  const k = cacheOf(c);
  for (let tries = 0; tries < 20; tries++) {
    const x = c.cx + r.range(-24, 24);
    const y = c.cy + r.range(-24, 24);
    if (x < 2 || y < 2 || x >= c.w - 2 || y >= c.h - 2) continue;
    const dx = x - c.cx;
    const dy = y - c.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 196 || d2 > 600) continue;
    const i = y * c.w + x;
    if (!k.reach[i] || c.feat[i] !== F.NONE || c.sb[i] || c.st[i] || (c.ter[i] !== T.GRASS && c.ter[i] !== T.DIRT)) continue;
    return i;
  }
  return -1;
}

/** Plant a few saplings around a spot. */
export function plantAround(c: Colony, i: number): number {
  let n = 0;
  for (const [dx, dy] of [[0, 0], ...STEPS]) {
    const j = i + dy * c.w + dx;
    if (j < 0 || j >= c.feat.length) continue;
    if (c.feat[j] !== F.NONE || c.sb[j] || c.st[j] || (c.ter[j] !== T.GRASS && c.ter[j] !== T.DIRT)) continue;
    c.feat[j] = F.SAPLING;
    c.fg[j] = 10;
    if (++n >= 3) break;
  }
  if (n) touch(c);
  return n;
}

export type { Beast };
