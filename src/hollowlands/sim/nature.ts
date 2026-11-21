// The land's own moods, and the strange things that come with them: wildfire in the woods,
// floods on the low ground, the earth shaking, falling stars and the northern lights, locusts,
// hard winters, a haunting, a cursed find, and once in a long while a dragon. Each leaves marks
// on the map that heal, and each gives the colony something to do about it.
// (The colony's own dramas, elopements, feuds, a lost child, duels and noble matches, are in drama.ts.)

import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, seasonOf } from '../config';
import { ROCK_FACE, SHORE, cacheOf, cropsChanged, featList, touchAt } from './cache';
import { WALL_KINDS, cells, shapeOf, spots } from './data/buildings';
import { bump, log, note } from './events';
import { wound } from './health';
import { livestock } from './herd';
import { riseAt } from './mapgen';
import { indoors, think } from './mood';
import { STAGE, gainXp, has, pawnById, per, posAt, stage } from './pawn';
import { Rand, S } from './rng';
import { addLore } from './tech';
import { reach } from './town';
import { breach } from './walls';
import { dramaAct, dramaCan, dramaDaily, dramaRun, dramaStep, dramaDone } from './drama';
import { AX, F, T, type Act, type ActK, type Bld, type Colony, type Nat, type Pawn } from './types';

const H = TICKS_PER_HOUR;
const D = TICKS_PER_DAY;

/** What a colonist lending a hand is doing (act.d of an 'aid' act). */
export const AID = { FIRE: 1, DIKE: 2, SEARCH: 3, RUBBLE: 4, LOCUST: 5, VIGIL: 6, CURSE: 7, STAR: 8 } as const;

/** Walk somewhere and do something there (setAct for one colonist). */
export type Go = (k: ActK, x: number, y: number, dur: number, why: string, o?: { adj?: boolean; o?: number; d?: number; b?: number }) => boolean;

const CURSED = ['a black idol with too many teeth', 'an eye of green glass that is always wet', 'a little iron crown, too small for any head', 'a bone flute that plays when no one is holding it', 'a lump of red stone that is warm to the touch'];
export const cursedThing = (s: number): string => CURSED[s % CURSED.length];

const FLAMMABLE = new Set<number>([F.TREE, F.PINE, F.BUSH, F.SAPLING, F.LOG, F.HERB, F.MUSHROOM, F.FLOWERS]);
const STEP4 = [1, -1, 0, 0];
const STEP4Y = [0, 0, 1, -1];
/** The eight steps round a tile, straight ones at even indexes. */
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

/** A compass word for where a tile lies from the middle of the colony. */
export function compass(c: Colony, x: number, y: number): string {
  const dx = x - c.cx;
  const dy = y - c.cy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const ns = dy < 0 ? 'north' : 'south';
  const ew = dx < 0 ? 'west' : 'east';
  if (ax < ay * 0.45) return ns;
  if (ay < ax * 0.45) return ew;
  return `${ns}-${ew}`;
}

/** Something the land is doing right now that people respond to (or that the view draws). */
export function natBusy(n: Nat, t = 0): boolean {
  return !!(n.fire.length || n.fl || n.loc || n.dr || n.lost || n.el || n.duel || (n.qk !== undefined && n.qk > t));
}

/** A random open tile near (x,y) that colonists can walk to, or -1. */
export function openNear(c: Colony, r: Rand, x: number, y: number, rmin: number, rmax: number, tries = 16): number {
  const k = cacheOf(c);
  for (let n = 0; n < tries; n++) {
    const tx = x + r.range(-rmax, rmax);
    const ty = y + r.range(-rmax, rmax);
    if (tx < 2 || ty < 2 || tx >= c.w - 2 || ty >= c.h - 2) continue;
    if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) < rmin) continue;
    const i = ty * c.w + tx;
    if (!k.reach[i] || !k.walk[i] || k.walk[i] > 20 || c.st[i] || c.sb[i]) continue;
    return i;
  }
  return -1;
}

const memo = new WeakMap<object, { t: number; n: number[] }>();
/** How many are already lending a hand at a kind of task this tick. */
export function aidCount(c: Colony): number[] {
  let m = memo.get(c);
  if (!m || m.t !== c.tick) {
    m = { t: c.tick, n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    for (const p of c.pawns) if (p.act.k === 'aid' && p.act.t1 > c.tick && p.act.d !== undefined) m.n[p.act.d] = (m.n[p.act.d] ?? 0) + 1;
    memo.set(c, m);
  }
  return m.n;
}

// ------------------------------------------------------------------ the daily roll

/** Once a day, at midnight: what the land has been doing, and now and then something new. */
export function dailyNature(c: Colony): void {
  const day = dayOf(c.tick);
  let n = c.nat;
  if (!n) {
    // the first look: a colony that was already running starts its clock now, with nothing to tell
    c.nat = n = { nx: day + 8, seen: {}, fire: [], ash: [], rub: [] };
    c.stats.natSeen = 1;
    return;
  }
  upkeep(c, n, day);
  dramaDaily(c, n, day);
  winter(c, n, day);
  if (day < 20 || day < n.nx || c.foes.length || c.siege || natBusy(n, c.tick) || c.pawns.length < 6) return;
  const r = new Rand(c.seed, S.NATURE, day);
  if (!r.chance(0.08)) return;
  const season = seasonOf(c.tick);
  const dry = c.mods.some((m) => m[0] === 'drought' && m[1] > c.tick);
  const clear = c.weather === 0 || c.weather === 1;
  const wet = c.weather === 2 || c.weather === 3;
  let growing = 0;
  for (const b of c.blds) if (b.k === 'field' && b.built) for (const cell of cells('field')) { const v = c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx]; if (v > 0) growing++; }
  const graves = c.dead.filter((d) => !d.left && d.grave >= 0).length;
  const yard = c.blds.some((b) => b.k === 'graveyard' && b.built);
  const opts: [string, number][] = [
    ['wildfire', wet || c.weather === 4 ? 0 : (season === 1 ? 1.4 : season === 2 ? 0.7 : season === 0 ? 0.3 : 0) * (dry ? 2 : 1)],
    ['flood', c.temp <= 0 ? 0 : (season === 0 ? 1.3 : season === 2 ? 0.8 : 0.3) * (wet ? 1.6 : 1)],
    ['quake', 0.45],
    ['meteors', clear ? 0.6 : 0],
    ['aurora', clear ? (season === 3 ? 1 : 0.3) : 0],
    ['locusts', growing >= 40 && (season === 1 || season === 0) ? 0.9 : 0],
    ['haunt', yard && graves >= 1 && !n.haunt ? 0.45 : 0],
    ['curse', !n.curse && (featList(c, ROCK_FACE).length || featList(c, F.ORE).length) ? 0.55 : 0],
    ['dragon', day >= 150 && (n.seen.dragon === undefined || day - n.seen.dragon > 360) ? 0.2 : 0],
    ...dramaCan(c, n, r, season),
  ];
  let total = 0;
  for (const o of opts) {
    // what came lately is less likely to come again soon
    const last = n.seen[o[0]];
    if (last !== undefined && day - last < 200) o[1] *= day - last < 100 ? 0.1 : 0.3;
    total += Math.max(0, o[1]);
  }
  if (total <= 0) return;
  let roll = r.float() * total;
  let k = '';
  for (const o of opts) { roll -= Math.max(0, o[1]); if (roll <= 0 && o[1] > 0) { k = o[0]; break; } }
  if (!k) return;
  if (!startNat(c, k)) return;
  n.nx = day + 5 + r.int(6);
}

/** Set one kind going now (the daily roll, and the dev tools that force one). False if it came to nothing. */
export function startNat(c: Colony, k: string): boolean {
  const n = c.nat;
  if (!n) return false;
  const day = dayOf(c.tick);
  const rr = new Rand(c.seed, S.NATURE, day, 7);
  let ok = false;
  switch (k) {
    case 'wildfire': ok = wildfire(c, n, rr); break;
    case 'flood': ok = flood(c, n, rr); break;
    case 'quake': ok = quake(c, n, rr); break;
    case 'meteors':
    case 'aurora': ok = skyShow(c, n, k); break;
    case 'locusts': ok = locusts(c, n, rr); break;
    case 'haunt': ok = haunt(c, n, rr); break;
    case 'curse': ok = curse(c, n, rr); break;
    case 'dragon': ok = dragon(c, n, rr); break;
    default: ok = dramaRun(c, n, k, rr); break;
  }
  if (!ok) return false;
  n.seen[k] = day;
  bump(c, 'natEvents');
  return true;
}

/** Each midnight: scorched ground greens again, cracks fade, rubble and the star's crater go, the haunting and the curse do their work. */
function upkeep(c: Colony, n: Nat, day: number): void {
  const r = new Rand(c.seed, S.NATURE, day, 3);
  // ash: grass first, then young trees, over a season or two
  if (n.ash.length && seasonOf(c.tick) < 3) {
    const keep: number[] = [];
    for (let j = 0; j < n.ash.length; j += 2) {
      const i = n.ash[j];
      const age = day - n.ash[j + 1];
      if (age >= 40 || (age >= 20 && r.chance(0.08))) {
        if (c.feat[i] === F.NONE && !c.sb[i] && !c.st[i] && (c.ter[i] === T.GRASS || c.ter[i] === T.DIRT) && r.chance(0.35)) { c.feat[i] = F.SAPLING; c.fg[i] = 10; touchAt(c, i); }
        continue;
      }
      keep.push(i, n.ash[j + 1]);
    }
    n.ash = keep;
  }
  if (n.ash.length > 4000) n.ash = n.ash.slice(n.ash.length - 4000);
  if (n.cr && c.tick >= n.cr.t) delete n.cr;
  // rubble nobody got round to clearing is carted off in the end
  if (n.rub.length && !n.cr) n.rub = [];
  if (n.qk !== undefined && c.tick - n.qk > D * 30) delete n.qk;
  if (n.cra && c.tick >= n.cra.t1) delete n.cra;
  if (n.sky && c.tick >= n.sky.t1) delete n.sky;

  // the dead walk the graveyard by night: the fearful sleep badly
  const h = n.haunt;
  if (h) {
    if (c.tick >= h.t1 || !c.blds.some((b) => b.id === h.b)) {
      log(c, 'n_haunt_fades', h.d);
      delete n.haunt;
    } else {
      for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD && (has(p, 'superstitious') || p.dev >= 2 || stage(c, p) === STAGE.CHILD) && r.chance(0.5)) think(c, p, 'haunted');
    }
  }

  // the cursed thing brings bad luck to whoever keeps it, and to their house
  const u = n.curse;
  if (u) {
    const a = pawnById(c, u.a);
    if (!a || a.gone) delete n.curse;
    else if (c.tick >= u.t1) {
      log(c, 'n_curse_end', a.id, undefined, 'lost|' + u.s);
      note(c, a, 'n_curse_gone', undefined, 'lost');
      delete n.curse;
    } else if (r.chance(0.35) && u.k < 3) {
      const house = c.pawns.filter((p) => !p.gone && (p === a || (a.home && p.home === a.home)) && stage(c, p) >= STAGE.CHILD);
      const v = house.length ? r.pick(house) : a;
      const roll = r.float();
      if (roll < 0.4) { wound(c, v, 'bruise', 5 + r.int(6), r); log(c, 'n_curse_hurt', v.id, a.id, String(u.s)); }
      else if (roll < 0.7 && c.stock.ale > 4) { const lost = Math.round(c.stock.ale * 0.2); c.stock.ale -= lost; log(c, 'n_curse_sour', a.id, undefined, String(u.s), lost); }
      else if (c.stock.tools >= 2) { c.stock.tools -= 1; log(c, 'n_curse_tools', a.id, undefined, String(u.s)); }
      else { wound(c, v, 'bruise', 4 + r.int(5), r); log(c, 'n_curse_hurt', v.id, a.id, String(u.s)); }
      u.k++;
      for (const p of c.pawns) if (p !== a && has(p, 'superstitious') && stage(c, p) >= STAGE.ADULT) think(c, p, 'omen_bad');
    }
  }
}

/** The hard winter: foretold in late autumn, felt all winter, and gone with the spring. */
function winter(c: Colony, n: Nat, day: number): void {
  const doy = day % DAYS_PER_YEAR;
  const year = Math.floor(day / DAYS_PER_YEAR);
  if (doy === 38) {
    const r = new Rand(c.seed, S.NATURE, day, 11);
    const last = n.seen.winter;
    if (!r.chance(last !== undefined && day - last < DAYS_PER_YEAR * 2 ? 0.08 : 0.25)) return;
    // until the end of the year: the woodcutters work for it from now (see jobs.ts), the cold bites from midwinter (econ.ts)
    c.mods.push(['hardwinter', (year + 1) * DAYS_PER_YEAR * D]);
    n.seen.winter = day;
    log(c, 'n_winter_warn');
    bump(c, 'natEvents');
  } else if (doy === 45 && c.mods.some((m) => m[0] === 'hardwinter' && m[1] > c.tick)) {
    log(c, 'n_winter');
    for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'hardwinter');
  } else if (doy === 0 && n.seen.winter !== undefined && day - n.seen.winter < 30) {
    log(c, 'n_winter_end');
    for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'winterover');
  }
}

// ------------------------------------------------------------------ every tick

/** Every tick while something is going on: the fire spreads, the water rises and falls, the swarm moves, the dragon flies. */
export function stepNature(c: Colony): void {
  const n = c.nat;
  if (!n) return;
  const t = c.tick;
  if (n.qk === t) quakeNow(c, n);
  if (n.fire.length && t % 5 === 0) stepFire(c, n);
  if (n.fl) stepFlood(c, n);
  if (n.loc) stepLocusts(c, n);
  if (n.dr) stepDragon(c, n);
  if (n.sky) stepSky(c, n);
  if (n.lost || n.el || n.duel) dramaStep(c, n);
}

// ------------------------------------------------------------------ wildfire

function wildfire(c: Colony, n: Nat, r: Rand): boolean {
  const trees = featList(c, F.TREE);
  if (trees.length < 30) return false;
  const far = reach(c) + 5;
  const W = c.w;
  for (let tries = 0; tries < 40; tries++) {
    const i = trees[trees.length - 1 - r.int(Math.min(trees.length, Math.max(20, Math.floor(trees.length * 0.7))))];
    const x = i % W;
    const y = (i - x) / W;
    if (Math.max(Math.abs(x - c.cx), Math.abs(y - c.cy)) < far || x < 3 || y < 3 || x >= W - 3 || y >= c.h - 3) continue;
    let wood = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const f = c.feat[i + dy * W + dx]; if (f === F.TREE || f === F.PINE) wood++; }
    if (wood < 9) continue;
    n.fire = [i, 40 + r.int(30)];
    for (const j of [i - 1, i + 1, i - W, i + W]) if ((c.feat[j] === F.TREE || c.feat[j] === F.PINE) && r.chance(0.7)) n.fire.push(j, 40 + r.int(30));
    // it catches in the heat of the afternoon (told when it does: see stepFire)
    n.wf = { x, y, n: 0, out: 0, hit: 0, t0: dayOf(c.tick) * D + (12 + r.int(5)) * H };
    return true;
  }
  return false;
}

/** Start a fire at a tile (a dragon's breath on the trees, say). */
export function ignite(c: Colony, i: number, r: Rand): void {
  const n = c.nat;
  if (!n || !FLAMMABLE.has(c.feat[i])) return;
  for (let j = 0; j < n.fire.length; j += 2) if (n.fire[j] === i) return;
  n.fire.push(i, 30 + r.int(30));
  if (!n.wf) n.wf = { x: i % c.w, y: Math.floor(i / c.w), n: 0, out: 0, hit: 0, t0: c.tick + 5 - (c.tick % 5) };
}

/** Burnt through: the tree is gone, the ground is black. */
function burnOut(c: Colony, n: Nat, i: number): void {
  c.feat[i] = F.NONE;
  c.fg[i] = 0;
  n.ash.push(i, dayOf(c.tick));
  if (n.wf) n.wf.n++;
  touchAt(c, i);
}

function stepFire(c: Colony, n: Nat): void {
  const wf = n.wf;
  if (wf && c.tick < wf.t0) return;
  if (wf && c.tick === wf.t0) {
    log(c, 'n_wildfire', undefined, undefined, compass(c, wf.x, wf.y));
    for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD && p.phobia === 'fire') think(c, p, 'omen_bad');
  }
  const r = new Rand(c.seed, S.NATURE, c.tick, 21);
  const season = seasonOf(c.tick);
  const rain = c.weather === 2 || c.weather === 3 ? 0.14 : c.weather === 4 ? 0.4 : 0;
  const dry = (c.mods.some((m) => m[0] === 'drought' && m[1] > c.tick) ? 1.7 : 1) * (season === 1 ? 1.25 : season === 3 ? 0.5 : 1);
  const spent = wf ? wf.n + wf.out : 0;
  // it runs out of steam in the end: a fire that has taken a big stretch of wood dies down
  const spread = rain ? 0.015 : spent > 220 ? 0.01 : 0.2 * dry;
  const W = c.w;
  const list = n.fire;
  const next: number[] = [];
  const burning = new Set<number>();
  for (let j = 0; j < list.length; j += 2) burning.add(list[j]);
  let crops = false;
  for (let j = 0; j < list.length; j += 2) {
    const i = list[j];
    let fuel = list[j + 1] - 5;
    if (!FLAMMABLE.has(c.feat[i])) { if (wf) wf.out++; continue; }
    if (rain && r.chance(rain)) { burnOut(c, n, i); continue; }
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d];
      const ny = y + DY8[d];
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= c.h - 1) continue;
      const k = ny * W + nx;
      // a building in the way catches; a field's crop burns where the fire reaches it
      const bid = c.sb[k];
      if (bid) {
        const b = c.blds.find((q) => q.id === bid);
        if (b && b.built && b.k !== 'field' && b.k !== 'graveyard' && b.k !== 'well' && r.chance(0.3)) {
          b.dmg = Math.min(b.mat ? 50 : 85, b.dmg + (b.mat ? 1 : 4));
          if (wf && !wf.hit) log(c, 'n_fire_town', undefined, undefined, b.k);
          if (wf) wf.hit++;
        }
        if (b && b.k === 'field' && c.crop[k] > 0 && r.chance(0.4)) { c.crop[k] = 0; crops = true; }
        continue;
      }
      if (burning.has(k) || !FLAMMABLE.has(c.feat[k]) || list.length + next.length >= 140) continue;
      if (r.chance((c.feat[k] === F.TREE || c.feat[k] === F.PINE || c.feat[k] === F.LOG ? spread : spread * 0.6) * (d & 1 ? 0.5 : 1))) {
        burning.add(k);
        next.push(k, 30 + r.int(30));
      }
    }
    if (fuel <= 0) { burnOut(c, n, i); continue; }
    next.push(i, fuel);
  }
  if (crops) cropsChanged(c);
  n.fire = next;
  if (!next.length) fireOut(c, n);
}

function fireOut(c: Colony, n: Nat): void {
  const wf = n.wf;
  delete n.wf;
  if (!wf) return;
  let fought = 0;
  for (const p of c.pawns) {
    if (p.th.some((t) => t.k === 'beatfire' && t.x > c.tick)) { fought++; think(c, p, 'foughtfire'); }
  }
  log(c, 'n_fire_out', undefined, undefined, String(fought), wf.n);
}

// ------------------------------------------------------------------ flood

function flood(c: Colony, n: Nat, r: Rand): boolean {
  const W = c.w;
  const R = 36;
  const k = cacheOf(c);
  const depth = new Map<number, number>();
  let q: number[] = [];
  for (let y = Math.max(1, c.cy - R); y < Math.min(c.h - 1, c.cy + R); y++) {
    for (let x = Math.max(1, c.cx - R); x < Math.min(W - 1, c.cx + R); x++) {
      const i = y * W + x;
      if (c.ter[i] === T.SHALLOW || c.ter[i] === T.DEEP) { depth.set(i, 0); q.push(i); }
    }
  }
  if (q.length < 12) return false;
  const top = 2 + r.int(3);
  const low = (i: number): boolean => {
    const t = c.ter[i];
    if (t !== T.GRASS && t !== T.DIRT && t !== T.SOIL && t !== T.SAND && t !== T.MARSH && t !== T.PATH) return false;
    const x = i % W;
    return riseAt(c.rises, x, (i - x) / W) < 0.22;
  };
  const out: number[] = [];
  for (let d = 1; d <= top && out.length < 1600; d++) {
    const nq: number[] = [];
    for (const i of q) {
      const x = i % W;
      const y = (i - x) / W;
      for (let s = 0; s < 4; s++) {
        const nx = x + STEP4[s];
        const ny = y + STEP4Y[s];
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= c.h - 1 || Math.max(Math.abs(nx - c.cx), Math.abs(ny - c.cy)) > R) continue;
        const j = ny * W + nx;
        if (depth.has(j) || !low(j)) continue;
        // the marsh drinks it up and passes it on
        depth.set(j, d);
        nq.push(j);
        out.push(j, d);
      }
    }
    q = nq;
  }
  // only worth telling when it reaches what people have made or walk
  let fields = 0;
  let near = 0;
  const seen = new Set<number>();
  for (let j = 0; j < out.length; j += 2) {
    const i = out[j];
    if (k.reach[i]) near++;
    const b = c.sb[i];
    if (b && !seen.has(b)) { seen.add(b); if (c.blds.find((x) => x.id === b)?.k === 'field') fields++; }
  }
  if (out.length < 60 || near < 30) return false;
  const t = c.tick + (7 + r.int(6)) * H;
  n.fl = { t0: t, pk: t + 14 * H, t1: t + 14 * H + 30 * H, l: out, top, lost: 0, dk: 0 };
  log(c, 'n_flood', undefined, undefined, c.temp < 8 && seasonOf(c.tick) === 0 ? 'melt' : 'rain', fields);
  return true;
}

/** How deep the water stands at tick t (0 when there is no flood). */
export function floodLevel(n: Nat, t: number): number {
  const f = n.fl;
  if (!f || t < f.t0 || t >= f.t1) return 0;
  return t < f.pk ? (f.top * (t - f.t0)) / (f.pk - f.t0) : (f.top * (f.t1 - t)) / (f.t1 - f.pk);
}

function stepFlood(c: Colony, n: Nat): void {
  const f = n.fl!;
  const t = c.tick;
  if (t >= f.t1) {
    log(c, 'n_flood_end', undefined, undefined, String(f.dk), f.lost);
    for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT && (p.prof === 'farmer' || f.lost > 20)) think(c, p, f.lost > 20 ? 'flooded' : 'floodheld');
    delete n.fl;
    cropsChanged(c);
    return;
  }
  if (t % H !== 0 || t < f.t0) return;
  const lvl = floodLevel(n, t);
  const r = new Rand(c.seed, S.NATURE, t, 22);
  // the earth heaped against it keeps the worst off the fields
  const loss = 0.06 * Math.max(0.2, 1 - f.dk * 0.07);
  const hit = new Set<number>();
  let crops = false;
  for (let j = 0; j < f.l.length; j += 2) {
    if (f.l[j + 1] > lvl) continue;
    const i = f.l[j];
    const b = c.sb[i];
    if (!b) continue;
    if (c.crop[i] > 0) { if (r.chance(loss)) { c.crop[i] = 0; f.lost++; crops = true; } continue; }
    if (!hit.has(b)) hit.add(b);
  }
  for (const id of hit) {
    const b = c.blds.find((x) => x.id === id);
    if (b && b.built && b.k !== 'field' && b.k !== 'graveyard' && b.k !== 'well' && !WALL_KINDS.has(b.k)) {
      b.dmg = Math.min(50, b.dmg + (b.mat ? 0.3 : 0.8));
      if (b.k === 'store' && r.chance(0.3)) { c.stock.grain *= 0.99; c.stock.flour *= 0.99; }
    }
  }
  if (crops) cropsChanged(c);
}

// ------------------------------------------------------------------ quake

function quake(c: Colony, n: Nat, r: Rand): boolean {
  // it strikes some hour of the day to come (see stepNature)
  n.qk = dayOf(c.tick) * D + (6 + r.int(15)) * H + r.int(H);
  return true;
}

function quakeNow(c: Colony, n: Nat): void {
  const r = new Rand(c.seed, S.NATURE, c.tick, 26);
  const W = c.w;
  const ex = c.cx + r.range(-14, 14);
  const ey = c.cy + r.range(-14, 14);
  // cracks run out from where it struck
  const cr: number[] = [];
  const seenCr = new Set<number>();
  const lines = 3 + r.int(3);
  for (let l = 0; l < lines; l++) {
    let x = ex + r.range(-4, 4);
    let y = ey + r.range(-4, 4);
    let d = r.int(8);
    const len = 7 + r.int(10);
    for (let s = 0; s < len; s++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= c.h - 2) break;
      const i = y * W + x;
      const t = c.ter[i];
      if (t !== T.DEEP && t !== T.SHALLOW && !seenCr.has(i)) { seenCr.add(i); cr.push(i); }
      if (r.chance(0.3)) d = (d + (r.chance(0.5) ? 1 : 7)) % 8;
      x += DX8[d];
      y += DY8[d];
    }
  }
  n.cr = { t: c.tick + 20 * D, l: cr };
  // what stands near it shakes: timber worse than stone, and a stretch of wall may come down
  let damaged = 0;
  const shaken: Bld[] = [];
  for (const b of c.blds) {
    if (!b.built || b.k === 'field' || b.k === 'graveyard') continue;
    if (Math.max(Math.abs(b.x + b.w / 2 - ex), Math.abs(b.y + b.h / 2 - ey)) > 32) continue;
    const wall = WALL_KINDS.has(b.k);
    const hit = wall ? 10 + r.int(22) : b.mat ? 2 + r.int(7) : 5 + r.int(14);
    b.dmg = Math.min(wall ? 95 : 80, b.dmg + hit);
    if (hit >= 12) { damaged++; shaken.push(b); }
  }
  const walls = c.blds.filter((b) => WALL_KINDS.has(b.k) && b.built && !b.br && b.dmg >= 60);
  if (walls.length && r.chance(0.4)) {
    const b = r.pick(walls);
    const cell = cells(shapeOf(b)).find((q) => 'PZg'.includes(q.ch));
    if (cell) breach(c, b, (b.y + cell.dy) * W + b.x + cell.dx);
  }
  // those under a roof that shook hard may be hurt by what falls
  let hurt = 0;
  for (const p of c.pawns) {
    if (hurt >= 2 || p.gone || stage(c, p) < STAGE.CHILD) continue;
    const b = c.sb[posAt(c, p, c.tick)];
    if (!b || !shaken.some((x) => x.id === b) || !r.chance(0.3)) continue;
    wound(c, p, 'bruise', 6 + r.int(7), r);
    note(c, p, 'n_quake_hurt');
    hurt++;
  }
  // rubble in the street beside what shook worst
  const k = cacheOf(c);
  for (const b of shaken.slice(0, 8)) {
    for (let tries = 0; tries < 6; tries++) {
      const x = b.x - 1 + r.int(b.w + 2);
      const y = b.y - 1 + r.int(b.h + 2);
      const i = y * W + x;
      if (x < 1 || y < 1 || x >= W - 1 || y >= c.h - 1 || c.sb[i] || c.st[i] || !k.walk[i] || n.rub.includes(i)) continue;
      n.rub.push(i);
      break;
    }
  }
  // a rock face split open: ore where there was none
  let ore = 0;
  const faces = featList(c, ROCK_FACE);
  for (let tries = 0; tries < 30 && !ore && faces.length; tries++) {
    const i = faces[r.int(Math.min(faces.length, 400))];
    let x = i % W;
    let y = (i - x) / W;
    const dx = r.range(-1, 1) || 1;
    const dy = r.range(-1, 1);
    for (let s = 0; s < 6 && ore < 5; s++) {
      const j = y * W + x;
      if (x < 1 || y < 1 || x >= W - 1 || y >= c.h - 1 || c.ter[j] !== T.ROCK || c.feat[j] !== F.NONE || c.sb[j]) break;
      c.feat[j] = F.ORE;
      c.fg[j] = 100;
      touchAt(c, j);
      if (!seenCr.has(j)) { seenCr.add(j); cr.push(j); }
      ore++;
      x += dx;
      y += dy;
    }
  }
  for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD && per(p, AX.BRAVE) < 0.6) think(c, p, 'quake');
  log(c, 'n_quake', undefined, undefined, String(hurt), damaged);
  if (ore) log(c, 'n_vein', undefined, undefined, undefined, ore);
  bump(c, 'quakes');
}

// ------------------------------------------------------------------ the night sky

function skyShow(c: Colony, n: Nat, k: string): boolean {
  const d0 = dayOf(c.tick) * D;
  n.sky = { k, t0: d0 + 21 * H, t1: d0 + D + 4 * H, done: 0 };
  return true;
}

function stepSky(c: Colony, n: Nat): void {
  const s = n.sky!;
  const t = c.tick;
  if (t >= s.t1) { delete n.sky; return; }
  if (t < s.t0) return;
  if (!s.done) {
    s.done = 1;
    log(c, s.k === 'meteors' ? 'n_meteors' : 'n_aurora');
    for (const p of c.pawns) {
      if (stage(c, p) < STAGE.CHILD) continue;
      think(c, p, s.k === 'meteors' ? 'starfall' : 'aurora');
      if (p.dev >= 2 || has(p, 'superstitious')) think(c, p, 'omen_good');
    }
    // the learned sit up and write down what they saw
    addLore(c, s.k === 'meteors' ? 10 : 14);
  }
  if (s.k === 'meteors' && s.done === 1 && t >= s.t0 + 3 * H) {
    s.done = 2;
    const r = new Rand(c.seed, S.NATURE, t, 23);
    if (!r.chance(0.5)) return;
    // one came down beyond the fields, still glowing
    const k = cacheOf(c);
    for (let tries = 0; tries < 30; tries++) {
      const R = reach(c) + 4 + r.int(14);
      const x = c.cx + r.range(-R, R);
      const y = c.cy + r.range(-R, R);
      if (x < 3 || y < 3 || x >= c.w - 3 || y >= c.h - 3 || Math.max(Math.abs(x - c.cx), Math.abs(y - c.cy)) < reach(c)) continue;
      const i = y * c.w + x;
      if (!k.reach[i] || c.sb[i] || c.st[i] || (c.ter[i] !== T.GRASS && c.ter[i] !== T.DIRT && c.ter[i] !== T.SAND)) continue;
      if (c.feat[i] !== F.NONE) { c.feat[i] = F.NONE; touchAt(c, i); }
      n.cra = { i, t1: t + 14 * D, a: 0 };
      log(c, 'n_starfall', undefined, undefined, compass(c, x, y));
      return;
    }
  }
}

// ------------------------------------------------------------------ locusts

function fieldWithCrops(c: Colony, x: number, y: number): Bld | undefined {
  let best: Bld | undefined;
  let bd = 1e9;
  for (const b of c.blds) {
    if (b.k !== 'field' || !b.built) continue;
    let crop = 0;
    for (const cell of cells('field')) if (c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx] > 0) crop++;
    if (crop < 4) continue;
    const d = Math.abs(b.x + 2 - x) + Math.abs(b.y + 2 - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function locusts(c: Colony, n: Nat, r: Rand): boolean {
  const side = r.int(4);
  const x = side === 1 ? c.w - 1 : side === 3 ? 0 : 4 + r.int(c.w - 8);
  const y = side === 0 ? 0 : side === 2 ? c.h - 1 : 4 + r.int(c.h - 8);
  const f = fieldWithCrops(c, x, y);
  if (!f) return false;
  let growing = 0;
  for (const b of c.blds) if (b.k === 'field' && b.built) for (const cell of cells('field')) if (c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx] > 0) growing++;
  const t = c.tick + (8 + r.int(6)) * H;
  n.loc = { x, y, px: x, py: y, tx: f.x + 2, ty: f.y + 2, t0: t, t1: t + 30 * H, n: 0, sc: 0, go: 0, cap: Math.max(12, Math.round(growing * 0.45)) };
  log(c, 'n_locusts', undefined, undefined, compass(c, x, y));
  return true;
}

function stepLocusts(c: Colony, n: Nat): void {
  const L = n.loc!;
  const t = c.tick;
  if (t < L.t0) return;
  if (t % H === 0 && L.sc > 0) L.sc = Math.max(0, L.sc - 2);
  // time to go: driven off, eaten their fill, or simply moving on
  if (!L.go && (t >= L.t1 || L.sc >= 14 || L.n >= L.cap)) {
    L.go = L.sc >= 14 ? 2 : 1;
    const dx = L.x - c.cx;
    const dy = L.y - c.cy;
    if (Math.abs(dx) > Math.abs(dy)) { L.tx = dx < 0 ? -6 : c.w + 6; L.ty = L.y; } else { L.ty = dy < 0 ? -6 : c.h + 6; L.tx = L.x; }
  }
  if (t % 2 === 0) {
    L.px = L.x;
    L.py = L.y;
    const sx = Math.sign(L.tx - L.x);
    const sy = Math.sign(L.ty - L.y);
    if (L.go || Math.abs(L.tx - L.x) > 1 || Math.abs(L.ty - L.y) > 1) { L.x += sx; L.y += sy; }
    if (L.go && (L.x < -4 || L.y < -4 || L.x > c.w + 4 || L.y > c.h + 4)) {
      log(c, 'n_locusts_gone', undefined, undefined, L.go === 2 ? 'driven' : 'left', L.n);
      for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT) think(c, p, L.go === 2 ? 'droveswarm' : L.n > 20 ? 'locustlost' : 'omen_good');
      delete n.loc;
      return;
    }
  }
  if (L.go || t % 5 !== 0) return;
  // eating: noise and smoke put them off
  const r = new Rand(c.seed, S.NATURE, t, 24);
  const bite = 0.3 * (1 - Math.min(0.8, L.sc * 0.06));
  let any = false;
  let ate = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = L.x + dx;
      const y = L.y + dy;
      if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
      const i = y * c.w + x;
      if (c.crop[i] <= 0) continue;
      any = true;
      if (r.chance(bite)) { c.crop[i] = 0; L.n++; ate = true; }
    }
  }
  if (ate) cropsChanged(c);
  if (!any && Math.abs(L.tx - L.x) <= 1 && Math.abs(L.ty - L.y) <= 1) {
    const f = fieldWithCrops(c, L.x, L.y);
    if (f) { L.tx = f.x + 2; L.ty = f.y + 2; } else L.t1 = t;
  }
}

// ------------------------------------------------------------------ the dragon

function dragon(c: Colony, n: Nat, r: Rand): boolean {
  // it comes in from one edge, passes over the town, and is gone over the other
  const ang = r.int(8);
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const ox = c.cx + r.range(-8, 8);
  const oy = c.cy + r.range(-8, 8);
  const far = c.w;
  const x0 = ox - DX[ang] * far;
  const y0 = oy - DY[ang] * far;
  const x1 = ox + DX[ang] * far;
  const y1 = oy + DY[ang] * far;
  const t0 = dayOf(c.tick) * D + (10 + r.int(6)) * H;
  const fields = c.blds.some((b) => b.k === 'field' && b.built);
  const beasts = livestock(c).length > 0;
  const roll = r.float();
  const k = fields && roll < 0.4 ? 'field' : beasts && roll < 0.75 ? 'beast' : 'pass';
  n.dr = { x0, y0, x1, y1, t0, t1: t0 + 26, k, done: 0 };
  return true;
}

/** Where the dragon is at tick t (fractional), or null when it is not in the sky. */
export function dragonAt(n: Nat, t: number): [number, number] | null {
  const d = n.dr;
  if (!d || t < d.t0 || t > d.t1) return null;
  const u = (t - d.t0) / (d.t1 - d.t0);
  return [d.x0 + (d.x1 - d.x0) * u, d.y0 + (d.y1 - d.y0) * u];
}

function stepDragon(c: Colony, n: Nat): void {
  const d = n.dr!;
  const t = c.tick;
  if (t >= d.t1 + 30) { delete n.dr; return; }
  if (t === d.t0) {
    log(c, 'n_dragon', undefined, undefined, compass(c, d.x0, d.y0));
    bump(c, 'dragons');
  }
  if (d.done || t < d.t0 + 13) return;
  d.done = 1;
  const r = new Rand(c.seed, S.NATURE, t, 25);
  if (d.k === 'field') {
    // it breathes once on the fields as it goes over
    let best: Bld | undefined;
    let most = 0;
    for (const b of c.blds) {
      if (b.k !== 'field' || !b.built) continue;
      let crop = 0;
      for (const cell of cells('field')) if (c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx] > 0) crop++;
      if (crop > most) { most = crop; best = b; }
    }
    if (best) {
      for (const cell of cells('field')) {
        const i = (best.y + cell.dy) * c.w + best.x + cell.dx;
        c.crop[i] = 0;
        n.ash.push(i, dayOf(t));
      }
      cropsChanged(c);
      // and the trees beside it catch
      for (let dy = -3; dy <= best.h + 2; dy++) for (let dx = -3; dx <= best.w + 2; dx++) {
        const x = best.x + dx;
        const y = best.y + dy;
        if (x > 1 && y > 1 && x < c.w - 1 && y < c.h - 1 && (c.feat[y * c.w + x] === F.TREE || c.feat[y * c.w + x] === F.PINE) && r.chance(0.35)) ignite(c, y * c.w + x, r);
      }
      log(c, 'n_dragon_field', undefined, undefined, best.crop ?? 'grain', most);
    } else d.k = 'pass';
  } else if (d.k === 'beast') {
    const list = livestock(c);
    if (list.length) {
      const order = ['cow', 'sheep', 'goat', 'chicken'];
      list.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k) || a.id - b.id);
      const a = list[0];
      c.herd = (c.herd ?? []).filter((x) => x !== a);
      log(c, 'n_dragon_beast', undefined, undefined, a.k);
    } else d.k = 'pass';
  }
  if (d.k === 'pass') log(c, 'n_dragon_pass');
  for (const p of c.pawns) {
    if (stage(c, p) < STAGE.CHILD) continue;
    const awe = per(p, AX.BRAVE) > 0.5 || per(p, AX.CURIOUS) > 0.6;
    think(c, p, awe ? 'dragonawe' : 'dragonfear');
    note(c, p, 'n_dragon', undefined, awe ? 'awe' : 'fear');
  }
}

// ------------------------------------------------------------------ mysteries

function haunt(c: Colony, n: Nat, r: Rand): boolean {
  const yard = c.blds.find((b) => b.k === 'graveyard' && b.built);
  if (!yard) return false;
  const graves = c.dead.filter((d) => !d.left && d.grave >= 0).sort((a, b) => b.died - a.died);
  if (!graves.length) return false;
  // the restless one: someone not long dead, or one who died badly
  const bad = graves.filter((d) => d.cause === 'murder' || d.cause === 'executed' || d.cause.startsWith('foe_') || d.cause === 'brawl');
  const d = bad.length && r.chance(0.6) ? r.pick(bad) : graves[r.int(Math.min(4, graves.length))];
  // who keeps the vigil: the priest, or the most devout, or the bravest
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) === STAGE.ADULT && !p.thrall && !p.owner && p.hp > 60);
  if (!adults.length) return false;
  const v = adults.find((p) => p.prof === 'priest') ?? adults.slice().sort((a, b) => b.dev * 2 + per(b, AX.BRAVE) - (a.dev * 2 + per(a, AX.BRAVE)) || a.id - b.id)[0];
  n.haunt = { b: yard.id, d: d.id, t1: c.tick + 6 * D, v: v.id, n: 0 };
  log(c, 'n_haunt', d.id, v.id);
  return true;
}

function curse(c: Colony, n: Nat, r: Rand): boolean {
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT && !p.thrall && p.hp > 50);
  const miner = adults.filter((p) => p.prof === 'miner').sort((a, b) => b.sk[3] - a.sk[3] || a.id - b.id)[0] ?? adults.slice().sort((a, b) => b.sk[3] - a.sk[3] || a.id - b.id)[0];
  if (!miner) return false;
  const s = r.int(CURSED.length);
  n.curse = { a: miner.id, t0: c.tick, t1: c.tick + 14 * D, s, k: 0 };
  log(c, 'n_curse', miner.id, undefined, String(s));
  note(c, miner, 'n_curse', undefined, String(s));
  think(c, miner, has(miner, 'greedy') ? 'cursedkeep' : 'cursedfear');
  for (const p of adults) if (p !== miner && (has(p, 'superstitious') || p.dev >= 2)) think(c, p, 'omen_bad');
  return true;
}

// ------------------------------------------------------------------ people lending a hand

/**
 * Called from decide() for each colonist: when the land turns on the colony, people go and do
 * something about it. True if this colonist now has something to do.
 */
export function natAct(c: Colony, p: Pawn, r: Rand, st: number, hour: number, go: Go): boolean {
  const n = c.nat!;
  if (!(n.fire.length || n.fl || n.loc || n.dr || n.lost || n.el || n.duel || n.haunt || n.curse || n.cra || n.rub.length)) return false;
  if ((n.lost || n.el || n.duel) && dramaAct(c, n, p, r, st, hour, go)) return true;
  if (p.brk || p.thrall || st < STAGE.CHILD) return false;
  const t = c.tick;
  // a dragon overhead: everyone gets under a roof
  if (n.dr && t >= n.dr.t0 - 2 && t <= n.dr.t1 + 6 && !indoors(c, p) && per(p, AX.BRAVE) < 0.7) {
    const home = p.home ? c.blds.find((b) => b.id === p.home && b.built) : undefined;
    const b = home ?? c.blds.find((x) => x.k === 'hall' && x.built);
    if (b) {
      const fl = spots(shapeOf(b), '.');
      const cell = fl.length ? r.pick(fl) : { dx: Math.floor(b.w / 2), dy: Math.floor(b.h / 2) };
      if (go('hide', b.x + cell.dx, b.y + cell.dy, 20, 'dragon', { b: b.id })) return true;
    }
  }
  if (p.food < 18 || p.rest < 10 || p.hp < 55 || (st !== STAGE.ADULT && !(st === STAGE.CHILD && n.loc))) return false;
  const busy = aidCount(c);
  // a fire in the woods: beat it out with wet sacks and branches before it reaches the town
  if (n.fire.length && n.wf && t >= n.wf.t0 + 2 * H && busy[AID.FIRE] < Math.min(12, 3 + n.fire.length / 3) && st === STAGE.ADULT) {
    const k = cacheOf(c);
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < n.fire.length; j += 2) {
      const i = n.fire[j];
      const x = i % c.w;
      const y = (i - x) / c.w;
      const d = Math.abs(x - c.cx) + Math.abs(y - c.cy) + Math.abs(x - p.x) * 0.3 + Math.abs(y - p.y) * 0.3 + r.float() * 6;
      if (d < bd && (k.reach[i] || k.reach[i - 1] || k.reach[i + 1])) { bd = d; best = i; }
    }
    if (best >= 0 && go('aid', best % c.w, Math.floor(best / c.w), 8, 'fire', { adj: true, d: AID.FIRE })) { busy[AID.FIRE]++; return true; }
  }
  // the water rising: heap earth along the edge of the fields
  const fl = n.fl;
  if (fl && t >= fl.t0 - 3 * H && t < fl.pk + 8 * H && busy[AID.DIKE] < 8 && st === STAGE.ADULT && hour >= 5 && hour < 22) {
    const lvl = floodLevel(n, t);
    const want = Math.min(fl.top, Math.floor(lvl) + 1);
    const k = cacheOf(c);
    const start = r.int(fl.l.length / 2) * 2;
    for (let s = 0; s < fl.l.length; s += 2) {
      const j = (start + s) % fl.l.length;
      if (fl.l[j + 1] !== want) continue;
      const i = fl.l[j];
      if (!k.reach[i] || c.sb[i] || c.st[i]) continue;
      if (go('aid', i % c.w, Math.floor(i / c.w), 12, 'flood', { d: AID.DIKE })) { busy[AID.DIKE]++; return true; }
      break;
    }
  }
  // the swarm in the fields: everyone out with pots and pans and smoky fires
  const L = n.loc;
  if (L && !L.go && t >= L.t0 && busy[AID.LOCUST] < 12 && hour >= 5 && hour < 21) {
    const x = Math.max(1, Math.min(c.w - 2, L.x));
    const y = Math.max(1, Math.min(c.h - 2, L.y));
    if (Math.max(Math.abs(L.x - c.cx), Math.abs(L.y - c.cy)) < reach(c) + 40) {
      const i = openNear(c, r, x, y, 0, 3, 8);
      if (i >= 0 && go('aid', i % c.w, Math.floor(i / c.w), 10, 'locusts', { d: AID.LOCUST })) { busy[AID.LOCUST]++; return true; }
    }
  }
  if (st !== STAGE.ADULT) return false;
  // the haunting: one keeps watch among the graves through the late evening
  const h = n.haunt;
  if (h && p.id === h.v && (hour >= 18 || hour < 1) && !p.th.some((x) => x.k === 'vigil' && x.x > t + 12 * H)) {
    const yard = c.blds.find((b) => b.id === h.b);
    if (yard) {
      const cell = r.pick(cells('graveyard'));
      if (go('aid', yard.x + cell.dx, yard.y + cell.dy, 3 * H, 'vigil', { adj: true, d: AID.VIGIL })) return true;
    }
  }
  // the cursed thing: given to the river (or the shrine) once its keeper has had enough of it
  const u = n.curse;
  if (u && p.id === u.a && hour >= 8 && hour < 18 && t - u.t0 >= (has(p, 'greedy') ? 7 : 2) * D) {
    const shrine = c.blds.find((b) => b.k === 'shrine' && b.built);
    const shore = featList(c, SHORE);
    if (shore.length) {
      const i = shore[Math.min(shore.length - 1, r.int(Math.min(8, shore.length)))];
      if (go('aid', i % c.w, Math.floor(i / c.w), 6, 'curse', { adj: true, d: AID.CURSE })) return true;
    }
    if (shrine && go('aid', shrine.x + Math.floor(shrine.w / 2), shrine.y + shrine.h - 1, 6, 'curse', { adj: true, d: AID.CURSE, b: shrine.id })) return true;
  }
  // the star that fell: someone goes out to see
  const cr = n.cra;
  if (cr && cr.a >= 0 && hour >= 7 && hour < 17) {
    if (!cr.a && (per(p, AX.CURIOUS) > 0.3 || per(p, AX.BRAVE) > 0.4) && r.chance(0.3)) cr.a = p.id;
    if (cr.a === p.id && go('aid', cr.i % c.w, Math.floor(cr.i / c.w), 10, 'star', { adj: true, d: AID.STAR })) return true;
  }
  // rubble in the streets: a few lend a hand in working hours
  if (n.rub.length && busy[AID.RUBBLE] < 3 && hour >= 7 && hour < 18 && r.chance(0.25)) {
    const i = n.rub[r.int(n.rub.length)];
    if (go('aid', i % c.w, Math.floor(i / c.w), 15, 'rubble', { adj: true, d: AID.RUBBLE })) { busy[AID.RUBBLE]++; return true; }
  }
  return false;
}

/** Called from finish(): what came of lending a hand. */
export function natDone(c: Colony, p: Pawn, a: Act, r: Rand): void {
  const n = c.nat;
  if (!n || c.tick < a.ta) return;
  const W = c.w;
  switch (a.d) {
    case AID.FIRE: {
      // beat out what burns within reach
      let out = 0;
      const keep: number[] = [];
      for (let j = 0; j < n.fire.length; j += 2) {
        const i = n.fire[j];
        const x = i % W;
        const y = (i - x) / W;
        // beaten out: the tree lives, scorched, on blackened ground
        if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1 && r.chance(0.4)) { out++; n.ash.push(i, dayOf(c.tick)); continue; }
        keep.push(i, n.fire[j + 1]);
      }
      n.fire = keep;
      if (n.wf) n.wf.out += out;
      think(c, p, 'beatfire');
      gainXp(p, 2, 0.5);
      if (r.chance(0.03)) wound(c, p, 'burn', 5 + r.int(5), r);
      if (!keep.length) fireOut(c, n);
      break;
    }
    case AID.DIKE: if (n.fl) { n.fl.dk++; gainXp(p, 2, 0.6); } break;
    case AID.LOCUST: if (n.loc && Math.max(Math.abs(n.loc.x - p.x), Math.abs(n.loc.y - p.y)) <= 3) n.loc.sc++; break;
    case AID.RUBBLE: {
      const at = n.rub.findIndex((i) => Math.max(Math.abs((i % W) - p.x), Math.abs(Math.floor(i / W) - p.y)) <= 1);
      if (at < 0) break;
      n.rub.splice(at, 1);
      c.stock.stone += 2;
      gainXp(p, 2, 0.5);
      if (!n.rub.length) log(c, 'n_cleared', p.id);
      break;
    }
    case AID.VIGIL: {
      const h = n.haunt;
      if (!h || h.v !== p.id) break;
      h.n++;
      if (h.n < (p.prof === 'priest' || p.dev >= 3 ? 2 : 3)) { think(c, p, 'vigil'); break; }
      log(c, 'n_haunt_laid', p.id, h.d);
      note(c, p, 'n_haunt_laid', h.d);
      think(c, p, 'laidghost');
      for (const o of c.pawns) if (o !== p && stage(c, o) >= STAGE.CHILD) think(c, o, 'ghostgone', p.id);
      delete n.haunt;
      break;
    }
    case AID.CURSE: {
      const u = n.curse;
      if (!u || u.a !== p.id) break;
      const where = a.b ? 'shrine' : 'water';
      log(c, 'n_curse_end', p.id, undefined, where + '|' + u.s);
      note(c, p, 'n_curse_gone', undefined, where);
      think(c, p, 'cursefree');
      delete n.curse;
      break;
    }
    case AID.STAR: {
      const cr = n.cra;
      if (!cr || cr.a !== p.id) break;
      const iron = 8 + r.int(9);
      c.stock.iron += iron;
      cr.a = -1;
      cr.t1 = Math.min(cr.t1, c.tick + 4 * D);
      log(c, 'n_stariron', p.id, undefined, undefined, iron);
      note(c, p, 'n_stariron');
      think(c, p, 'stariron');
      if (!p.heirloom) p.heirloom = 'a shard of star-iron';
      break;
    }
    case AID.SEARCH: dramaDone(c, n, p, r); break;
    default: break;
  }
}

