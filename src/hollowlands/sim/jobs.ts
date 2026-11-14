// Work: what needs doing, who is best placed to do it, and what comes of an hour's labour.

import { DAYS_PER_YEAR, TICKS_PER_HOUR, dayOf, seasonOf } from '../config';
import { ROCK_FACE, SHORE, cacheOf, dropFeat, featList, touch } from './cache';
import { BACKS } from './data/backstories';
import { CROPS, DECOR, cells, isDecor, spots, shapeOf } from './data/buildings';
import { PROFS } from './data/professions';
import { foodDays, mouths, rawFood } from './econ';
import { anySowable, chooseCrop, sowable, variety } from './farm';
import { bump, log, note } from './events';
import { isDown, needsTending, tend } from './health';
import { think, workSkillOf } from './mood';
import { advanceBuild, canBuild, syncTiles } from './planner';
import { BEAST_KINDS, plantAround, plantSpot } from './wild';
import { TPL } from './data/buildings';
import { STAGE, gainXp, has, mkAct, pawnById, posAt, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { B, F, T, type Act, type Bld, type Colony, type Pawn, type WorkK } from './types';

export interface Job { w: WorkK; x: number; y: number; adj: boolean; dur: number; b?: number; d?: number; o?: number; why: string }

export function workSpeed(c: Colony, p: Pawn, skill: number): number {
  let v = stat(p, 'work') * (0.5 + 0.075 * p.sk[skill]);
  const st = stage(c, p);
  if (st === STAGE.TEEN) v *= 0.6;
  else if (st === STAGE.ELDER) v *= 0.8;
  if (p.insp && p.insp[0] === 'frenzy') v *= 1.6;
  v *= 0.85 + 0.3 * (p.mood / 100);
  if (p.drunk > 50) v *= 0.7;
  if (p.hp < 50) v *= 0.7;
  return Math.max(0.1, v);
}

/** The tool each kind of work wants. Without it the work goes slower. */
export const TOOL_FOR: Partial<Record<WorkK, string>> = { wood: 'axe', mine: 'pick', farm: 'hoe', build: 'hammer', hunt: 'bow', fish: 'rod', smith: 'tongs', craft: 'knife' };
export const TOOL_NAMES: Record<string, string> = { axe: 'an axe', pick: 'a pick', hoe: 'a hoe and sickle', hammer: 'a hammer and saw', bow: 'a hunting bow', rod: 'a rod and net', tongs: "smith's tongs", knife: 'a knife and awl' };

/** Take the tool a job needs from the store, putting back what they carried. Keeps the old one if the store is bare. */
export function equip(c: Colony, p: Pawn, w: WorkK): void {
  const k = TOOL_FOR[w];
  if (!k || (p.tool && p.tool[0] === k) || c.stock.tools < 1) return;
  // what is left of the old tool goes back on the rack for someone else
  if (p.tool) c.stock.tools += p.tool[1] / 100;
  c.stock.tools -= 1;
  p.tool = [k, 100];
}

/** How much the right tool (or the lack of it) changes the pace of this work. */
export function toolMult(p: Pawn, w: WorkK): number {
  const k = TOOL_FOR[w];
  if (!k) return 1;
  return p.tool && p.tool[0] === k ? 1.15 : 0.82;
}

const DUR: Record<WorkK, number> = { farm: 10, forage: 8, hunt: 36, fish: 16, wood: 12, mine: 14, cook: 10, build: 12, craft: 14, smith: 14, brew: 12, heal: 10, teach: 12, preach: 12, guard: 20, herbs: 8 };
const CROWD: Record<WorkK, number> = { farm: 0.2, forage: 0.6, hunt: 1, fish: 1, wood: 0.6, mine: 0.8, cook: 2.5, build: 0.4, craft: 3, smith: 3, brew: 3, heal: 2, teach: 5, preach: 5, guard: 2, herbs: 3 };

interface FieldNeed { b: Bld; op: number; n: number }

/** What a field needs most: 1 harvest, 0 sowing, 2 tending. */
function fieldNeed(c: Colony, b: Bld): FieldNeed | null {
  if (!b.built || !b.crop) return null;
  const def = CROPS[b.crop];
  const season = seasonOf(c.tick);
  const doy = dayOf(c.tick) % DAYS_PER_YEAR;
  let ripe = 0;
  let bare = 0;
  let growing = 0;
  for (const cell of cells('field')) {
    const v = c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx];
    if (v === 255) ripe++;
    else if (v === 0) bare++;
    else growing++;
  }
  if (ripe) return { b, op: 1, n: ripe };
  // a field lying bare can take a new crop; a half-sown one goes on with what it has
  if (bare && (!growing ? anySowable(c) : sowable(c, def.old ? { ...def, old: false } : def))) return { b, op: 0, n: bare };
  void season; void doy;
  if (growing && (b.tend ?? 0) < 88) return { b, op: 2, n: growing };
  return null;
}

function targeted(c: Colony, self: Pawn, tile: number): boolean {
  for (const o of c.pawns) if (o !== self && o.act.k === 'work' && o.act.d === tile) return true;
  return false;
}

function nearestFree(c: Colony, p: Pawn, list: number[], r: Rand, take: number, ok?: (i: number) => boolean): number {
  const picks: number[] = [];
  for (const i of list) {
    if (ok && !ok(i)) continue;
    if (targeted(c, p, i)) continue;
    picks.push(i);
    if (picks.length >= take) break;
  }
  return picks.length ? r.pick(picks) : -1;
}

/** No ore within reach: the rock face nearest a vein, to tunnel toward it. */
function towardOre(c: Colony): number {
  const faces = featList(c, ROCK_FACE);
  if (!faces.length) return -1;
  const ores: number[] = [];
  for (let i = 0; i < c.feat.length; i++) if (c.feat[i] === F.ORE) ores.push(i);
  if (!ores.length) return -1;
  let best = -1;
  let bd = 1e9;
  for (const f of faces) {
    const fx = f % c.w;
    const fy = Math.floor(f / c.w);
    for (const o of ores) {
      const d = Math.abs((o % c.w) - fx) + Math.abs(Math.floor(o / c.w) - fy);
      if (d < bd) { bd = d; best = f; }
    }
  }
  return best;
}

function bldOf(c: Colony, k: string): Bld | undefined {
  return c.blds.find((b) => b.k === k && b.built);
}

function spotTile(c: Colony, b: Bld, chars: string, r: Rand): number {
  const list = spots(shapeOf(b), chars);
  if (!list.length) return (b.y + Math.floor(b.h / 2)) * c.w + b.x + Math.floor(b.w / 2);
  const cell = r.pick(list);
  return (b.y + cell.dy) * c.w + b.x + cell.dx;
}

/** The best thing for this colonist to work on right now, or null if nothing is worth doing. */
export function findJob(c: Colony, p: Pawn, r: Rand): Job | null {
  const pop = c.pawns.length;
  const season = seasonOf(c.tick);
  const days = foodDays(c);
  const stores = season >= 2 ? 22 : season === 1 ? 16 : 10;
  const fp = Math.max(0, Math.min(1, 1 - days / stores));
  const busy: Partial<Record<WorkK, number>> = {};
  for (const o of c.pawns) if (o !== p && o.act.k === 'work' && o.act.w) busy[o.act.w] = (busy[o.act.w] ?? 0) + 1;
  const refuses = (w: WorkK): boolean => !!BACKS[p.bc]?.no?.includes(w) || !!BACKS[p.ba]?.no?.includes(w);
  const mine = PROFS[p.prof]?.work;
  const opts: { w: WorkK; s: number; why: string; make: () => Job | null }[] = [];
  const offer = (w: WorkK, urgency: number, why: string, make: () => Job | null): void => {
    if (urgency <= 0 || refuses(w)) return;
    const sk = workSkillOf(w);
    const apt = (0.55 + 0.07 * p.sk[sk]) * (p.pas[sk] === 2 ? 1.5 : p.pas[sk] === 1 ? 1.2 : 1) * (mine === w ? 1.9 : 1) * (p.focus && p.focus[1] > c.tick && p.focus[0] === sk ? 1.8 : 1);
    const s = (urgency * apt) / (1 + (busy[w] ?? 0) * CROWD[w]) + r.float() * 0.6;
    opts.push({ w, s, why, make });
  };
  const job = (w: WorkK, tile: number, adj: boolean, why: string, b?: number, d?: number): Job => ({ w, x: tile % c.w, y: Math.floor(tile / c.w), adj, dur: DUR[w], b, d, why });

  // The hurt and the sick come first
  let patient: Pawn | undefined;
  let worst = 0;
  for (const o of c.pawns) {
    if (o === p || o.gone || !needsTending(o, c.tick)) continue;
    if (c.pawns.some((x) => x !== p && x.act.k === 'work' && x.act.w === 'heal' && x.act.o === o.id)) continue;
    const need = 1 + (o.inj.some((i) => i.bleed > 0) ? 4 : 0) + (isDown(o) ? 2 : 0);
    if (need > worst) { worst = need; patient = o; }
  }
  if (patient) {
    const pt = patient;
    offer('heal', 7 + worst * 1.5, 'heal', () => {
      const i = posAt(c, pt, c.tick);
      const j = job('heal', i, true, pt.first + ' needs tending');
      j.o = pt.id;
      j.dur = 6;
      return j;
    });
  }
  const infirmary = bldOf(c, 'infirmary');
  if (c.stock.herbs >= 2 && c.stock.medicine < 2 + pop * 0.2 && (mine === 'heal' || mine === 'herbs' || p.sk[8] >= 6)) {
    offer('heal', 1.7, 'medicine', () => {
      const hut = bldOf(c, 'herbalist');
      if (hut) return job('heal', spotTile(c, hut, 'kH', r), true, 'Making medicine', hut.id, 1);
      const b = infirmary ?? bldOf(c, 'hall');
      return b ? job('heal', spotTile(c, b, infirmary ? 'e' : 't', r), true, 'Making medicine', b.id, 1) : null;
    });
  }
  if (mine === 'guard' && (p.prof === 'guard' || p.prof === 'scout')) {
    offer('guard', 2.6, 'guard', () => {
      if (r.chance(0.35)) {
        const gh = bldOf(c, 'guardhouse');
        return gh ? job('guard', spotTile(c, gh, 'R', r), true, 'Weapons practice', gh.id, 1) : job('guard', c.cy * c.w + c.cx + r.range(-2, 2), false, 'Weapons practice', undefined, 1);
      }
      // the tower first, if nobody is up there
      const tower = c.blds.find((b) => b.k === 'tower' && b.built);
      if (tower && !c.pawns.some((o) => o !== p && o.act.w === 'guard' && c.sb[o.act.ty * c.w + o.act.tx] === tower.id)) return job('guard', spotTile(c, tower, '.', r), true, 'On watch from the tower', tower.id);
      const k = cacheOf(c);
      for (let tries = 0; tries < 12; tries++) {
        const x = c.cx + r.range(-17, 17);
        const y = c.cy + r.range(-17, 17);
        if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) continue;
        if (Math.abs(x - c.cx) + Math.abs(y - c.cy) < 14) continue;
        if (k.reach[y * c.w + x] && k.walk[y * c.w + x] < 20) return job('guard', y * c.w + x, false, 'On watch');
      }
      return null;
    });
  }

  // Cooking
  const meals = c.stock.meal + c.stock.feast;
  const mealTarget = mouths(c) * 1.6;
  if (rawFood(c) >= 4 && meals < mealTarget) {
    offer('cook', 3 + 6 * (1 - meals / mealTarget), 'cook', () => {
      const kit = bldOf(c, 'kitchen');
      if (kit) return job('cook', spotTile(c, kit, 'sk', r), true, 'The colony needs meals', kit.id);
      const hall = bldOf(c, 'hall');
      return hall ? job('cook', spotTile(c, hall, 's', r), true, 'The colony needs meals', hall.id) : job('cook', c.cy * c.w + c.cx, false, 'The colony needs meals');
    });
  }

  // Fields
  let best: FieldNeed | null = null;
  for (const b of c.blds) {
    if (b.k !== 'field') continue;
    const need = fieldNeed(c, b);
    if (!need) continue;
    const rank = (n: FieldNeed): number => (n.op === 1 ? 3 : n.op === 0 ? 2 : 1);
    if (!best || rank(need) > rank(best) || (rank(need) === rank(best) && need.n > best.n)) best = need;
  }
  if (best) {
    const fb = best;
    offer('farm', fb.op === 1 ? 8.5 : fb.op === 0 ? 6.5 : 2.6, 'farm', () => {
      const list = cells('field');
      const start = r.int(list.length);
      for (let k = 0; k < list.length; k++) {
        const cell = list[(start + k) % list.length];
        const i = (fb.b.y + cell.dy) * c.w + fb.b.x + cell.dx;
        const v = c.crop[i];
        if ((fb.op === 1 && v === 255) || (fb.op === 0 && v === 0) || (fb.op === 2 && v > 0 && v < 255)) {
          return job('farm', i, false, fb.op === 1 ? 'The crop is ripe' : fb.op === 0 ? 'Time to sow' : 'The field needs tending', fb.b.id, fb.op);
        }
      }
      return null;
    });
  }

  // Building
  const site = c.blds.find((b) => canBuild(c, b));
  if (site) {
    offer('build', 5.5, 'build', () => {
      const list = cells(shapeOf(site));
      const cell = list[Math.min(list.length - 1, Math.floor(site.prog * list.length))];
      return job('build', (site.y + cell.dy) * c.w + site.x + cell.dx, true, 'There is building to be done', site.id);
    });
  }

  let worn: Bld | undefined;
  for (const b of c.blds) if (b.built && b.dmg >= 12 && (!worn || b.dmg > worn.dmg)) worn = b;
  if (worn && c.stock.wood >= 2) {
    const wb = worn;
    offer('build', 1.5 + wb.dmg / 12, 'repair', () => job('build', (wb.y + wb.h - 1) * c.w + wb.x + Math.floor(wb.w / 2), true, 'The ' + wb.k + ' needs mending', wb.id, 1));
  }

  // Wood and stone
  let needWood = 0;
  let needStone = 0;
  for (const b of c.blds) if (!b.built) { needWood += b.need.wood; needStone += b.need.stone; }
  const woodTarget = 25 + pop * 3 + needWood + (season >= 2 ? pop * 5 : season === 1 ? pop * 2 : 0);
  if (c.stock.wood < woodTarget) {
    offer('wood', 1 + 6 * (1 - c.stock.wood / woodTarget), 'wood', () => {
      const fallen = nearestFree(c, p, featList(c, F.LOG), r, 3);
      if (fallen >= 0) return job('wood', fallen, true, 'Clearing a tree the storm brought down', undefined, fallen);
      const a = nearestFree(c, p, featList(c, F.TREE), r, 6);
      const b2 = nearestFree(c, p, featList(c, F.PINE), r, 3);
      const pick = a < 0 ? b2 : b2 < 0 ? a : r.chance(0.75) ? a : b2;
      return pick < 0 ? null : job('wood', pick, true, season >= 2 ? 'Winter is coming and the woodpile is low' : 'The colony needs wood', undefined, pick);
    });
  }
  // the woods are thinning: someone with a feel for growing things plants for later
  const standing = featList(c, F.TREE).length + featList(c, F.PINE).length;
  if (season < 3 && standing < 40 && featList(c, F.SAPLING).length < 45 && (mine === 'wood' || mine === 'farm' || p.sk[4] >= 4)) {
    offer('wood', standing < 12 ? 3.2 : 1.6, 'wood', () => {
      const i = plantSpot(c, r);
      if (i < 0) return null;
      const j = job('wood', i, false, 'Planting trees for the years ahead', undefined, i);
      j.o = -1;
      return j;
    });
  }
  const smithy = bldOf(c, 'smithy');
  // a colony that has found its feet starts turning timber into stone
  const timber = pop >= 10 ? c.blds.find((b) => b.built && !b.mat && b.k !== 'field' && b.k !== 'well' && b.k !== 'graveyard') : undefined;
  const stoneTarget = 12 + needStone + (pop >= 10 ? 20 : 0) + (timber ? 45 : 0);
  const wantOre = !!smithy && c.stock.ore < 8 && c.stock.iron < 6;
  if (c.stock.stone < stoneTarget || wantOre) {
    offer('mine', wantOre ? 3 : 0.8 + 5 * (1 - c.stock.stone / stoneTarget), 'mine', () => {
      let pick = wantOre ? nearestFree(c, p, featList(c, F.ORE), r, 3) : -1;
      if (pick < 0 && wantOre) pick = towardOre(c);
      const stone = c.stock.stone < stoneTarget;
      if (pick < 0 && stone) pick = nearestFree(c, p, featList(c, F.BOULDER), r, 4);
      if (pick < 0 && stone) pick = nearestFree(c, p, featList(c, ROCK_FACE), r, 4);
      return pick < 0 ? null : job('mine', pick, true, wantOre ? 'The forge needs ore' : 'The colony needs stone', undefined, pick);
    });
  }

  // Food from the wild
  if (c.game > 15 && (p.sk[1] >= 3 || mine === 'hunt' || fp > 0.5)) {
    offer('hunt', (0.7 + 6 * fp) * (0.3 + 0.7 * (c.game / 100)), 'hunt', () => {
      // a beast in sight first: the nearest one nobody else is after
      let prey = -1;
      let pd = 1e9;
      for (const b of c.beasts ?? []) {
        if (!BEAST_KINDS[b.k]?.prey) continue;
        if (c.pawns.some((o) => o !== p && o.act.k === 'work' && o.act.w === 'hunt' && o.act.d === b.id)) continue;
        const d = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
        if (d < pd) { pd = d; prey = b.id; }
      }
      const beast = c.beasts?.find((b) => b.id === prey);
      if (beast) {
        const j = job('hunt', beast.y * c.w + beast.x, true, 'Stalking a ' + BEAST_KINDS[beast.k].name);
        j.d = beast.id;
        j.dur = 20;
        return j;
      }
      const trees = featList(c, F.TREE);
      if (trees.length < 4) return job('hunt', c.gy * c.w + c.gx, false, 'Gone hunting');
      const pick = trees[trees.length - 1 - r.int(Math.max(1, Math.floor(trees.length * 0.25)))];
      return job('hunt', pick, true, fp > 0.5 ? 'The stores are low: gone hunting' : 'Gone hunting');
    });
  }
  const shore = featList(c, SHORE);
  if (shore.length && c.temp > -3) {
    offer('fish', (0.45 + 5 * fp) * (season === 3 ? 0.4 : 1), 'fish', () => {
      const pick = nearestFree(c, p, shore, r, 10);
      return pick < 0 ? null : job('fish', pick, true, 'Gone fishing', undefined, pick);
    });
  }
  if (season === 2) {
    const caps = featList(c, F.MUSHROOM);
    if (caps.length >= 2) {
      offer('forage', 1.2 + 3 * fp, 'forage', () => {
        const pick = nearestFree(c, p, caps, r, 5);
        return pick < 0 ? null : job('forage', pick, true, 'Mushrooms are up in the woods', undefined, pick);
      });
    }
  }
  if (season >= 1 && season <= 2) {
    const bushes = featList(c, F.BUSH);
    if (bushes.some((i) => c.fg[i] >= 60)) {
      offer('forage', 1.1 + 4.5 * fp, 'forage', () => {
        const pick = nearestFree(c, p, bushes, r, 5, (i) => c.fg[i] >= 60);
        return pick < 0 ? null : job('forage', pick, true, 'The berries are ripe', undefined, pick);
      });
    }
  }
  if (c.stock.herbs < 6 && season < 3) {
    offer('herbs', 1.3, 'herbs', () => {
      const pick = nearestFree(c, p, featList(c, F.HERB), r, 5, (i) => c.fg[i] >= 100);
      return pick < 0 ? null : job('herbs', pick, true, 'Gathering herbs', undefined, pick);
    });
  }

  // Crafts
  const tavern = bldOf(c, 'tavern');
  const hall = bldOf(c, 'hall');
  const brewery = bldOf(c, 'brewery');
  if (c.stock.ale < pop * 1.5 && c.stock.grain >= 10 + mouths(c) * 9 && (tavern || hall)) {
    offer('brew', 2.5, 'brew', () => {
      if (brewery) return job('brew', spotTile(c, brewery, 'v', r), true, 'The barrels are running dry', brewery.id);
      const b = tavern ?? hall!;
      return job('brew', spotTile(c, b, tavern ? 'r' : 'x', r), true, 'The barrels are running dry', b.id);
    });
  }
  const shop = bldOf(c, 'workshop');
  // no iron to be had: the workshop turns out simple tools of wood and a little leather
  if (shop && c.stock.tools < 1 + pop * 0.1 && c.stock.wood >= 40 && !(smithyHasIron(c))) {
    offer('craft', 3, 'craft', () => job('craft', spotTile(c, shop, 'w', r), true, 'The colony is short of tools', shop.id, 2));
  }
  if (c.stock.clothes < 1 + pop * 0.2 && (c.stock.leather >= 2 || c.stock.cloth >= 2) && (shop || hall)) {
    offer('craft', 3.2, 'craft', () => {
      const b = shop ?? hall!;
      return job('craft', spotTile(c, b, shop ? 'wl' : 't', r), true, 'People need clothes', b.id);
    });
  } else if (shop && c.stock.goods < pop * 7 && (c.stock.leather >= 6 || c.stock.cloth >= 6 || c.stock.wood >= woodTarget + 20)) {
    offer('craft', 1.5, 'craft', () => job('craft', spotTile(c, shop, 'wl', r), true, 'Making goods to trade', shop.id, 1));
  }

  // Stone lasts. One building at a time, the hall first.
  // only stone to spare: new buildings waiting on stone come first
  if (timber && !site && c.stock.stone >= 20 + needStone) {
    const order = ['hall', 'store', 'shrine', 'tavern', 'smithy'];
    let pick = timber;
    for (const b of c.blds) {
      if (!b.built || b.mat || b.k === 'field' || b.k === 'well' || b.k === 'graveyard') continue;
      if (b.up) { pick = b; break; }
      if (order.indexOf(b.k) >= 0 && (order.indexOf(pick.k) < 0 || order.indexOf(b.k) < order.indexOf(pick.k))) pick = b;
    }
    const sb = pick;
    offer('build', 2.4, 'stone', () => job('build', (sb.y + sb.h - 1) * c.w + sb.x + Math.floor(sb.w / 2), true, 'Rebuilding the ' + TPL[sb.k].name.toLowerCase() + ' in stone', sb.id, 3));
  }

  // Making good homes better
  if (c.stock.wood >= woodTarget * 0.6) {
    let poor: Bld | undefined;
    const cap = 38 + p.sk[2] * 4;
    for (const b of c.blds) if (b.built && b.beds.length && b.q < cap && b.q < 92 && (!poor || b.q < poor.q)) poor = b;
    if (poor) {
      const pb = poor;
      offer('build', 1.6, 'improve', () => job('build', (pb.y + pb.h - 1) * c.w + pb.x + Math.floor(pb.w / 2), true, 'Making a home a little finer', pb.id, 2));
    }
  }
  if (smithy && ((c.stock.ore >= 3 && c.stock.wood >= 2) || (c.stock.iron >= 2 && (c.stock.tools < 2 + pop * 0.15 || c.stock.weapons < pop * 0.3)))) {
    offer('smith', 2.8, 'smith', () => job('smith', spotTile(c, smithy, 'a', r), true, 'Work at the forge', smithy.id));
  }
  if (mine === 'teach' && (hall || bldOf(c, 'school'))) {
    let kids = 0;
    for (const o of c.pawns) { const s = stage(c, o); if (s === STAGE.CHILD || s === STAGE.TEEN) kids++; }
    const school = bldOf(c, 'school');
    if (kids) offer('teach', 2.2, 'teach', () => (school ? job('teach', spotTile(c, school, 'K', r), true, 'Teaching the young', school.id) : job('teach', spotTile(c, hall!, 't', r), true, 'Teaching the young', hall!.id)));
  }

  opts.sort((a, b) => b.s - a.s);
  for (const o of opts) {
    if (o.s < 1) break;
    const j = o.make();
    if (j) return j;
  }
  return null;
}

const smithyHasIron = (c: Colony): boolean => c.stock.iron >= 2 && c.blds.some((b) => b.k === 'smithy' && b.built);

const lv0 = (p: Pawn, w: WorkK): number => p.sk[workSkillOf(w)];

/** Work done in the building made for it goes better. */
export function placeMult(c: Colony, w: WorkK, b?: number): number {
  if (!b) return 1;
  const k = c.blds.find((x) => x.id === b)?.k;
  return k && PLACE[k] === w ? PLACE_BONUS[k] ?? 1.25 : 1;
}
const PLACE: Record<string, WorkK> = { kitchen: 'cook', brewery: 'brew', school: 'teach', guardhouse: 'guard', herbalist: 'heal', smithy: 'smith', workshop: 'craft' };
const PLACE_BONUS: Record<string, number> = { kitchen: 1.3, brewery: 1.4, school: 1.5, guardhouse: 1.5, herbalist: 1.5, smithy: 1.1, workshop: 1.1 };

/** An hour or two of work comes to something. */
export function finishWork(c: Colony, p: Pawn, a: Act): void {
  const w = a.w;
  if (!w) return;
  const hours = Math.max(0, Math.min(c.tick, a.t1) - a.ta) / TICKS_PER_HOUR;
  if (hours <= 0) return;
  const sk = workSkillOf(w);
  const lv = p.sk[sk];
  const tm = toolMult(p, w);
  const speed = workSpeed(c, p, sk) * tm * placeMult(c, w, a.b);
  const r = new Rand(c.seed, S.JOB, c.tick, p.id);
  if (tm > 1 && p.tool) {
    // tools wear with use; a skilled hand is easier on them
    p.tool[1] -= hours * (0.5 - Math.min(0.2, lv0(p, w) * 0.01));
    if (p.tool[1] <= 0) { p.tool = undefined; think(c, p, 'brokentool'); bump(c, 'toolsBroken'); }
  }
  gainXp(p, sk, hours);
  if (p.pas[sk] === 2 && r.chance(0.25)) think(c, p, 'lovework');
  const made = (k: string, n: number): void => bump(c, 'made_' + k, n);
  const lucky = has(p, 'lucky') ? 1.25 : has(p, 'jinxed') ? 0.75 : 1;
  const tile = a.d ?? -1;

  switch (w) {
    case 'farm': {
      const b = c.blds.find((x) => x.id === a.b);
      if (!b || !b.crop) break;
      const def = CROPS[b.crop];
      const op = a.d ?? 2;
      if (op === 2) { b.tend = Math.min(100, (b.tend ?? 0) + 7 * speed * hours); break; }
      if (op === 0 && cells('field').every((cell) => c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx] === 0)) {
        // a bare field: decide what it grows this time
        const was = b.crop;
        b.crop = chooseCrop(c, b);
        // beans leave the ground better than they found it
        if (was === 'beans' && b.crop !== 'beans') b.tend = Math.min(100, (b.tend ?? 0) + 30);
      }
      const sowDef = CROPS[b.crop];
      if (op === 0 && !sowable(c, sowDef.old ? { ...sowDef, old: false } : sowDef)) break;
      let n = Math.max(1, Math.round((op === 1 ? 2 : 2.4) * speed * hours));
      let got = 0;
      const list = cells('field');
      const start = list.findIndex((cell) => b.x + cell.dx === a.tx && b.y + cell.dy === a.ty);
      for (let k = 0; k < list.length && n > 0; k++) {
        const cell = list[(Math.max(0, start) + k) % list.length];
        const i = (b.y + cell.dy) * c.w + b.x + cell.dx;
        if (op === 0 && c.crop[i] === 0) { c.crop[i] = 1; n--; }
        else if (op === 1 && c.crop[i] === 255) {
          c.crop[i] = 0;
          n--;
          got += def.yield * (c.ter[i] === T.SOIL ? 1.2 : 1) * (0.75 + 0.025 * lv) * (has(p, 'greenthumb') ? 1.15 : 1);
        }
      }
      if (got > 0) {
        c.stock[def.res] += got;
        made(def.res, got);
        (c.fresh ??= {})[b.crop] = c.tick;
        if (!cells('field').some((cell) => c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx] === 255)) {
          think(c, p, 'goodharvest');
          log(c, 'harvest', p.id, undefined, b.crop, b.id);
        }
      }
      break;
    }
    case 'wood': {
      if (a.o === -1) {
        // planting young trees for the years ahead
        if (tile >= 0 && plantAround(c, tile)) { bump(c, 'planted'); dropFeat(c, F.SAPLING); }
        break;
      }
      if (tile >= 0 && c.feat[tile] === F.LOG) {
        const left = c.fg[tile] - 19 * speed * hours;
        if (left <= 0) { c.feat[tile] = F.NONE; c.fg[tile] = 0; c.stock.wood += 6; made('wood', 6); dropFeat(c, F.LOG); touch(c); }
        else c.fg[tile] = Math.round(left);
        break;
      }
      if (tile < 0 || (c.feat[tile] !== F.TREE && c.feat[tile] !== F.PINE)) break;
      const left = c.fg[tile] - 19 * speed * hours;
      if (left <= 0) {
        const n = c.feat[tile] === F.PINE ? 7 : 9;
        c.feat[tile] = F.NONE;
        c.fg[tile] = 0;
        c.stock.wood += n;
        made('wood', n);
        touch(c);
      } else c.fg[tile] = Math.round(left);
      break;
    }
    case 'mine': {
      if (tile < 0) break;
      const f = c.feat[tile];
      if (f === F.BOULDER || f === F.ORE) {
        const left = c.fg[tile] - (f === F.ORE ? 18 : 24) * speed * hours;
        if (left <= 0) {
          c.feat[tile] = F.NONE;
          c.fg[tile] = 0;
          if (f === F.ORE) { c.stock.ore += 6; c.stock.stone += 3; made('ore', 6); c.ter[tile] = T.STONE; }
          else { c.stock.stone += 8; made('stone', 8); }
          touch(c);
        } else c.fg[tile] = Math.round(left);
      } else if (c.ter[tile] === T.ROCK) {
        const done = c.fg[tile] + 20 * speed * hours;
        if (done >= 100) {
          c.ter[tile] = T.STONE;
          c.fg[tile] = 0;
          c.stock.stone += 12;
          made('stone', 12);
          touch(c);
        } else c.fg[tile] = Math.round(done);
      }
      break;
    }
    case 'cook': {
      let n = Math.min(rawFood(c), Math.max(1, Math.round(3.6 * speed * hours)));
      if (c.stock.wood >= 0.5) c.stock.wood -= 0.5;
      const s = c.stock;
      const rich = (s.meat >= 1 || s.fish >= 1) && (s.veg >= 1 || s.grain >= 1 || s.berries >= 1);
      const kinds = variety(c);
      const kitchen = c.blds.find((x) => x.id === a.b)?.k === 'kitchen';
      const fine = rich && lv >= 4 && r.chance(0.1 + lv * 0.035 + Math.max(0, kinds - 3) * 0.04 + (kitchen ? 0.08 : 0));
      let used = 0;
      const order: ('meat' | 'fish' | 'berries' | 'veg' | 'grain' | 'mushrooms')[] = ['fish', 'meat', 'mushrooms', 'berries', 'veg', 'grain'];
      let guard = 0;
      while (n > 0.5 && guard++ < 40) {
        let took = false;
        for (const k of order) {
          if (n <= 0.5) break;
          if (s[k] >= 1) { s[k] -= 1; n--; used++; took = true; }
        }
        if (!took) break;
      }
      const out = used * (1.1 + Math.min(0.2, kinds * 0.03));
      if (fine) { s.feast += out; made('feast', out); } else { s.meal += out; made('meal', out); }
      break;
    }
    case 'build': {
      const b = c.blds.find((x) => x.id === a.b);
      if (!b) break;
      if (b.built && a.d === 3 && !b.mat) {
        const t = TPL[b.k];
        const need = t.wood * 1.6 + 25;
        const dp = Math.min(1 - (b.up ?? 0), (hours * speed) / (t.work * 4), c.stock.stone / need);
        if (dp <= 0) break;
        c.stock.stone = Math.max(0, c.stock.stone - need * dp);
        b.up = (b.up ?? 0) + dp;
        if (b.up >= 0.999) {
          b.up = undefined;
          b.mat = 1;
          b.q = Math.min(100, b.q + 10);
          b.dmg = 0;
          syncTiles(c, b);
          think(c, p, 'builtit');
          log(c, 'stonework', p.id, undefined, b.k);
        }
      } else if (b.built && a.d === 2) {
        b.q = Math.min(92, b.q + 0.9 * speed * hours);
        furnish(c, b);
        c.stock.wood = Math.max(0, c.stock.wood - 0.8 * hours);
        c.stock.stone = Math.max(0, c.stock.stone - 0.3 * hours);
      } else if (b.built) {
        const fix = Math.min(b.dmg, 9 * speed * hours);
        b.dmg -= fix;
        c.stock.wood = Math.max(0, c.stock.wood - fix * 0.12);
      } else advanceBuild(c, b, hours * speed, p);
      break;
    }
    case 'hunt': {
      const prey = a.d !== undefined ? c.beasts?.find((b) => b.id === a.d) : undefined;
      if (a.d !== undefined) {
        // after a particular animal: close enough for a shot, or it got away
        if (!prey) break;
        const d = Math.max(Math.abs(prey.x - p.x), Math.abs(prey.y - p.y));
        const def = BEAST_KINDS[prey.k];
        const shot = Math.min(0.9, (0.38 + 0.035 * p.sk[1] + 0.02 * p.sk[9]) * (d <= 3 ? 1.2 : d <= 7 ? 0.8 : 0.25) * lucky);
        if (!r.chance(shot)) { prey.x = Math.max(1, Math.min(c.w - 2, prey.x + Math.sign(prey.x - p.x) * 3)); prey.px = prey.x; break; }
        c.beasts = c.beasts!.filter((b) => b !== prey);
        const meat = Math.round((def.meat[0] + r.int(def.meat[1] - def.meat[0] + 1)) * (0.8 + 0.02 * lv));
        c.stock.meat += meat;
        c.stock.leather += def.hide;
        c.game = Math.max(0, c.game - 4);
        made('meat', meat);
        gainXp(p, 9, hours * 0.5);
        if (meat >= 16) { think(c, p, 'goodhunt'); log(c, 'hunt', p.id, undefined, undefined, meat); }
        break;
      }
      const chance = Math.min(0.92, (0.3 + 0.035 * p.sk[1] + 0.02 * p.sk[9]) * (0.4 + 0.6 * (c.game / 100)) * lucky);
      if (r.chance(chance)) {
        const meat = Math.round((9 + r.int(14)) * (0.8 + 0.02 * lv));
        c.stock.meat += meat;
        c.stock.leather += 1 + r.int(2);
        c.game = Math.max(0, c.game - 5);
        made('meat', meat);
        gainXp(p, 9, hours * 0.5);
        if (meat >= 18) { think(c, p, 'goodhunt'); log(c, 'hunt', p.id, undefined, undefined, meat); }
      }
      break;
    }
    case 'fish': {
      const n = Math.max(0, Math.round((0.5 + 0.1 * lv) * hours * (0.4 + r.float() * 1.2) * lucky));
      c.stock.fish += n;
      made('fish', n);
      break;
    }
    case 'forage': {
      if (tile >= 0 && c.feat[tile] === F.MUSHROOM) {
        c.feat[tile] = F.NONE;
        const n = 2.5 + lv * 0.2;
        c.stock.mushrooms += n;
        made('mushrooms', n);
        dropFeat(c, F.MUSHROOM);
        touch(c);
        break;
      }
      if (tile < 0 || c.feat[tile] !== F.BUSH || c.fg[tile] < 60) break;
      const n = 3 + lv * 0.25;
      c.fg[tile] = 0;
      c.stock.berries += n;
      made('berries', n);
      dropFeat(c, F.BUSH);
      break;
    }
    case 'herbs': {
      if (tile < 0 || c.feat[tile] !== F.HERB || c.fg[tile] < 100) break;
      c.fg[tile] = 0;
      c.stock.herbs += p.sk[8] >= 6 ? 2 : 1;
      dropFeat(c, F.HERB);
      break;
    }
    case 'brew': {
      const n = Math.min(c.stock.grain, 5 * speed * hours);
      c.stock.grain -= n;
      const hop = Math.min(c.stock.hops, n * 0.25);
      c.stock.hops -= hop;
      const ale = n + hop * 2.4;
      c.stock.ale += ale;
      made('ale', ale);
      break;
    }
    case 'craft': {
      if (a.d === 2) {
        const n = Math.min(c.stock.wood / 4, speed * hours * 0.3);
        c.stock.wood -= n * 4;
        c.stock.leather = Math.max(0, c.stock.leather - n * 0.3);
        c.stock.tools += n;
        made('tools', n);
        break;
      }
      if (a.d === 1) {
        const k = c.stock.leather >= 2 ? 'leather' : c.stock.cloth >= 2 ? 'cloth' : c.stock.wood >= 3 ? 'wood' : '';
        if (!k) break;
        const n = speed * hours * 0.8;
        c.stock[k] = Math.max(0, c.stock[k] - n * 1.5);
        c.stock.goods += n;
        made('goods', n);
        masterwork(c, p, r, lv, 'a carving so fine people stop to stare');
        break;
      }
      let n = Math.floor(speed * hours * 0.7 + r.float());
      while (n-- > 0) {
        const k = c.stock.cloth >= 2 ? 'cloth' : c.stock.leather >= 2 ? 'leather' : '';
        if (!k) break;
        c.stock[k] -= 2;
        c.stock.clothes += 1;
        made('clothes', 1);
        masterwork(c, p, r, lv, 'a fine cloak');
      }
      break;
    }
    case 'smith': {
      let n = Math.max(1, Math.round(speed * hours * 0.8));
      while (n-- > 0) {
        if (c.stock.ore >= 3 && c.stock.wood >= 1 && c.stock.iron < 6) { c.stock.ore -= 3; c.stock.wood -= 1; c.stock.iron += 2; made('iron', 2); }
        else if (c.stock.iron >= 2) {
          c.stock.iron -= 2;
          // the colony must be able to defend itself; past that, tools for the work
          const armed = c.stock.weapons >= c.pawns.length * 0.25;
          const tools = armed && (c.stock.tools < 2 + c.pawns.length * 0.15 || c.stock.weapons >= c.pawns.length * 0.35);
          c.stock[tools ? 'tools' : 'weapons'] += 1;
          made(tools ? 'tools' : 'weapons', 1);
          masterwork(c, p, r, lv, tools ? 'a perfect axe-head' : 'a blade worth naming');
        } else break;
      }
      break;
    }
    case 'heal': {
      if (a.d === 1) {
        const n = Math.min(Math.floor(c.stock.herbs / 2), Math.max(1, Math.round(speed * hours)));
        c.stock.herbs -= n * 2;
        c.stock.medicine += n;
        made('medicine', n);
        break;
      }
      const o = pawnById(c, a.o ?? 0);
      if (!o || o.gone) break;
      const oi = posAt(c, o, c.tick);
      if (Math.abs((oi % c.w) - p.x) > 2 || Math.abs(Math.floor(oi / c.w) - p.y) > 2) break;
      tend(c, p, o, r);
      gainXp(p, 8, 1.5);
      if (isDown(o)) {
        // carry them to a bed
        const bed = bedFor(c, o);
        if (bed >= 0) {
          o.x = bed % c.w;
          o.y = Math.floor(bed / c.w);
          o.act = mkAct('rest', c.tick, o.x, o.y, 30, 'carried');
          o.act.b = c.sb[bed];
        }
      }
      break;
    }
    case 'guard': {
      if (a.d === 1) gainXp(p, p.sk[1] > p.sk[0] ? 1 : 0, hours * 1.5);
      else gainXp(p, 0, hours * 0.3);
      break;
    }
    case 'teach': {
      for (const o of c.pawns) {
        const s = stage(c, o);
        if (s !== STAGE.CHILD && s !== STAGE.TEEN) continue;
        // a learned teacher teaches more, and leans toward what they know best
        const good = 0.5 + p.sk[11] * 0.08;
        let sub = r.int(12);
        if (r.chance(0.4)) { let best = 0; for (let k = 1; k < 12; k++) if (p.sk[k] > p.sk[best]) best = k; sub = best; }
        o.sk[sub] = Math.min(20, o.sk[sub] + 0.02 * hours * stat(o, 'learn') * good);
        o.sk[11] = Math.min(20, o.sk[11] + 0.012 * hours * stat(o, 'learn') * good);
      }
      break;
    }
    default: break;
  }
}

/** Somewhere to lay a patient: a free sickbed, else their own bed. -1 if neither. */
export function bedFor(c: Colony, o: Pawn): number {
  const inf = bldOf(c, 'infirmary');
  if (inf) {
    for (const cell of spots(shapeOf(inf), 'o')) {
      const x = inf.x + cell.dx;
      const y = inf.y + cell.dy;
      if (!c.pawns.some((q) => q !== o && q.act.tx === x && q.act.ty === y)) return y * c.w + x;
    }
  }
  const home = o.home ? c.blds.find((b) => b.id === o.home) : undefined;
  if (home) {
    const cell = spots(shapeOf(home), 'b')[home.beds.indexOf(o.id)];
    if (cell) return (home.y + cell.dy) * c.w + home.x + cell.dx;
  }
  return -1;
}

function masterwork(c: Colony, p: Pawn, r: Rand, lv: number, what: string): void {
  const muse = p.insp && p.insp[0] === 'muse';
  if (!muse && !(lv >= 9 && r.chance(0.012 * (lv - 7)))) return;
  if (muse) p.insp = undefined;
  think(c, p, 'masterwork');
  p.coin += 6;
  log(c, 'masterwork', p.id, undefined, what);
  note(c, p, 'masterwork', undefined, what);
  bump(c, 'masterworks');
}

/** As a home is made finer it gains things: a rug, then a wardrobe, a lamp, a shelf of books. */
export function furnish(c: Colony, b: Bld): void {
  const floor = spots(shapeOf(b), '.');
  if (!floor.length) return;
  const have: number[] = [];
  for (const cell of floor) { const s = c.st[(b.y + cell.dy) * c.w + b.x + cell.dx]; if (isDecor(s)) have.push(s); }
  const want = (b.q >= 50 ? 1 : 0) + (b.q >= 64 ? 1 : 0) + (b.q >= 76 ? 1 : 0) + (b.q >= 88 ? 1 : 0);
  if (have.length >= Math.min(want, floor.length - 1)) return;
  const next = DECOR.find((d) => !have.includes(d));
  if (next === undefined) return;
  // rugs go in the open; the rest stand against a wall, away from the door
  let best = -1;
  let bestS = -1e9;
  for (const cell of floor) {
    const x = b.x + cell.dx;
    const y = b.y + cell.dy;
    const i = y * c.w + x;
    const s = c.st[i];
    if (s !== B.FLOOR_WOOD && s !== B.FLOOR_STONE) continue;
    let walls = 0;
    let door = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = c.st[(y + dy) * c.w + x + dx];
      if (n === B.WALL_WOOD || n === B.WALL_STONE) walls++;
      if (n === B.DOOR) door = true;
    }
    if (door) continue;
    const sc = (next === B.RUG ? -walls : walls) * 10 - ((x * 7 + y * 13 + b.id) % 5);
    if (sc > bestS) { bestS = sc; best = i; }
  }
  if (best < 0) return;
  c.st[best] = next;
  touch(c);
}
