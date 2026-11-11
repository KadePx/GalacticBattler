// Stores, seasons and the land: what the colony has, what the weather is doing, and how
// crops, bushes and trees grow back.

import { DAYS_PER_SEASON, DAYS_PER_YEAR, dayOf, seasonOf } from '../config';
import { dropFeat, touch } from './cache';
import { CROPS, cells } from './data/buildings';
import { bump, log } from './events';
import { STAGE, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { B, F, RAW_FOOD, RES, T, type Colony, type ResK } from './types';

export function emptyStock(): Record<ResK, number> {
  const s = {} as Record<ResK, number>;
  for (const k of RES) s[k] = 0;
  return s;
}

export const rawFood = (c: Colony): number => c.stock.grain + c.stock.veg + c.stock.meat + c.stock.fish + c.stock.berries;
export const foodUnits = (c: Colony): number => rawFood(c) + c.stock.meal + c.stock.feast;
export const hasFood = (c: Colony): boolean => foodUnits(c) >= 1;

/** Mouths to feed, counted in adult humans. */
export function mouths(c: Colony): number {
  let n = 0;
  for (const p of c.pawns) n += stat(p, 'appetite') * (stage(c, p) <= STAGE.CHILD ? 0.8 : 1);
  return Math.max(1, n);
}

const mouthMemo = new WeakMap<Colony, [number, number]>();

/** Days of food in the stores at the rate the colony eats. */
export function foodDays(c: Colony): number {
  let m = mouthMemo.get(c);
  if (!m || m[0] !== c.tick) { m = [c.tick, mouths(c)]; mouthMemo.set(c, m); }
  return foodUnits(c) / (m[1] * 1.75);
}

/** Take one helping of the best food going. Returns what was eaten, or '' if the stores are bare. */
export function takeMeal(c: Colony, ironStomach: boolean): string {
  const s = c.stock;
  if (s.feast >= 1) { s.feast -= 1; return 'feast'; }
  if (s.meal >= 1) { s.meal -= 1; return 'meal'; }
  for (const k of ['berries', 'veg', 'fish', 'meat', 'grain'] as const) {
    if (s[k] >= 1) { s[k] -= 1; return ironStomach || k === 'berries' ? 'meal' : 'raw'; }
  }
  // scraps of this and that
  if (foodUnits(c) < 1) return '';
  let need = 1;
  for (const k of ['feast', 'meal', 'berries', 'veg', 'fish', 'meat', 'grain'] as const) {
    const n = Math.min(need, s[k]);
    s[k] -= n;
    need -= n;
    if (need <= 0.0001) break;
  }
  return ironStomach ? 'meal' : 'raw';
}

const TEMP_CURVE: [number, number][] = [[0, 7], [15, 17], [23, 25], [30, 20], [45, 6], [52, -8], [60, 7]];

export function seasonTemp(dayOfYear: number): number {
  for (let i = 1; i < TEMP_CURVE.length; i++) {
    const [d1, t1] = TEMP_CURVE[i];
    if (dayOfYear <= d1) {
      const [d0, t0] = TEMP_CURVE[i - 1];
      return t0 + ((t1 - t0) * (dayOfYear - d0)) / (d1 - d0);
    }
  }
  return 7;
}

/** Start of each day: weather, growth, rot, wear. */
export function dailyLand(c: Colony): void {
  const day = dayOf(c.tick);
  const doy = day % DAYS_PER_YEAR;
  const season = seasonOf(c.tick);
  const r = new Rand(c.seed, S.WEATHER, day);
  const prevTemp = c.temp;
  c.temp = Math.round(seasonTemp(doy) + (r.float() + r.float() - 1) * 5) - (c.mods.some((m) => m[0] === 'coldsnap' && m[1] > c.tick) ? 11 : 0);
  const drought = c.mods.some((m) => m[0] === 'drought' && m[1] > c.tick);
  const roll = r.float();
  const wet = c.biome === 'marsh' ? 0.12 : c.biome === 'coast' ? 0.06 : 0;
  if (c.temp <= 0) c.weather = roll < 0.3 + wet ? 4 : roll < 0.55 ? 1 : 0;
  else if (drought) c.weather = roll < 0.3 ? 1 : 0;
  else if (roll < 0.05) c.weather = 3;
  else if (roll < 0.24 + wet + (season === 2 ? 0.08 : 0)) c.weather = 2;
  else if (roll < 0.3 + wet) c.weather = 5;
  else if (roll < 0.55) c.weather = 1;
  else c.weather = 0;

  // Crops
  const firstFrost = c.temp < -1 && prevTemp >= -1 && season >= 2;
  for (const b of c.blds) {
    if (b.k !== 'field' || !b.built || !b.crop) continue;
    const def = CROPS[b.crop];
    const care = 0.55 + 0.65 * ((b.tend ?? 0) / 100);
    const wx = c.weather === 2 ? 1.15 : c.weather === 3 ? 0.9 : 1;
    const grow = season === 3 || c.temp < 2 ? 0 : (200 / def.days) * care * wx * (drought ? 0.2 : 1);
    for (const cell of cells('field')) {
      const i = (b.y + cell.dy) * c.w + b.x + cell.dx;
      const v = c.crop[i];
      if (v === 0) continue;
      if (v === 255) { if (firstFrost && r.chance(0.5)) c.crop[i] = 0; continue; }
      if (firstFrost) { c.crop[i] = 0; continue; }
      const nv = v + grow * (c.ter[i] === T.SOIL ? 1.2 : 1);
      c.crop[i] = nv >= 200 ? 255 : Math.max(1, Math.floor(nv));
    }
    b.tend = Math.max(0, (b.tend ?? 0) - 7);
  }
  if (firstFrost) log(c, 'frost');

  // Wild things
  const n = c.w * c.h;
  let changed = false;
  for (let i = 0; i < n; i++) {
    const f = c.feat[i];
    if (f === F.BUSH) {
      if (season === 3) c.fg[i] = 0;
      else if (season >= 1 && c.fg[i] < 100) c.fg[i] = Math.min(100, c.fg[i] + 9);
    } else if (f === F.HERB) {
      if (c.fg[i] < 100 && season < 3) c.fg[i] = Math.min(100, c.fg[i] + 5);
    } else if (f === F.SAPLING) {
      if (season < 3 && (day + i) % 6 !== 0) c.fg[i]++;
      if (c.fg[i] >= 100) { c.feat[i] = F.TREE; changed = true; }
    }
  }
  if (season < 3) {
    for (let k = 0; k < 5; k++) {
      const x = 2 + r.int(c.w - 4);
      const y = 2 + r.int(c.h - 4);
      const i = y * c.w + x;
      if (c.feat[i] !== F.NONE || c.sb[i] || c.st[i] || (c.ter[i] !== T.GRASS && c.ter[i] !== T.DIRT)) continue;
      const dx = x - c.cx;
      const dy = y - c.cy;
      if (dx * dx + dy * dy < 100) continue;
      const near = c.feat[i - 1] === F.TREE || c.feat[i + 1] === F.TREE || c.feat[i - c.w] === F.TREE || c.feat[i + c.w] === F.TREE || c.feat[i - 1] === F.PINE || c.feat[i + c.w] === F.PINE;
      if (!near) continue;
      c.feat[i] = F.SAPLING;
      c.fg[i] = 0;
      changed = true;
    }
  }
  c.game = Math.min(100, c.game + (season === 3 ? 0.5 : 1.3));

  // Rot. Cold keeps things.
  const cold = c.temp < 3;
  const rot = (k: ResK, warm: number, chill: number): void => {
    const lost = c.stock[k] * (cold ? chill : warm);
    if (lost > 0.01) { c.stock[k] -= lost; bump(c, 'rotted', lost); }
  };
  rot('meat', 0.1, 0.01);
  rot('fish', 0.12, 0.01);
  rot('berries', 0.07, 0.02);
  rot('veg', 0.018, 0.008);
  rot('grain', 0.003, 0.003);
  rot('meal', 0.08, 0.02);
  rot('feast', 0.1, 0.02);
  c.stock.tools = Math.max(0, c.stock.tools - c.pawns.length * 0.004);

  // Hearths burn through wood when it is cold
  if (c.temp < 6) {
    let homes = 0;
    for (const b of c.blds) if (b.built && b.beds.some((x) => x)) homes++;
    const burn = Math.min(c.stock.wood, (1.5 + homes * 0.7) * (c.temp < -4 ? 1.6 : 1));
    c.stock.wood -= burn;
    bump(c, 'woodBurned', burn);
  }

  // Weather wears at buildings
  for (const b of c.blds) {
    if (!b.built || b.k === 'field' || b.k === 'graveyard' || b.k === 'well') continue;
    b.dmg = Math.min(80, b.dmg + (b.mat ? 0.1 : 0.22) + (c.weather === 3 ? 1.5 : 0));
  }

  // Feet wear paths into the grass
  if (day % 4 === 0) {
    for (let i = 0; i < n; i++) {
      const w = c.wear[i];
      if (!w) continue;
      if (!c.sb[i] && !c.st[i]) {
        if (w >= 90 && c.ter[i] === T.DIRT) { c.ter[i] = T.PATH; changed = true; }
        else if (w >= 36 && (c.ter[i] === T.GRASS || c.ter[i] === T.SOIL)) { c.ter[i] = T.DIRT; if (c.feat[i] === F.FLOWERS) c.feat[i] = F.NONE; changed = true; }
      }
      c.wear[i] = Math.floor(w * 0.82);
    }
  }
  if (changed) touch(c);
  dropFeat(c, F.BUSH);
  dropFeat(c, F.HERB);
  void DAYS_PER_SEASON;
  void B;
}
