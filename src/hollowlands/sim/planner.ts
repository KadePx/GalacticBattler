// The colony decides what to build and where, who sleeps where, and who holds which trade.
// (Later the ruler and council will steer this; for now it is common sense.)

import { DAYS_PER_YEAR, dayOf, seasonOf } from '../config';
import { dropFeat, touch } from './cache';
import { BACKS } from './data/backstories';
import { CROPS, HOMES, SHAPES, TPL, cellCode, cells, isDecor, shapeOf, spots } from './data/buildings';
import { PROFS, PROF_LIST } from './data/professions';
import { mouths } from './econ';
import { chooseCrop } from './farm';
import { bump, log, note } from './events';
import { bury } from './life';
import { think } from './mood';
import { STAGE, pawnById, stage } from './pawn';
import { hash32, S } from './rng';
import { B, F, T, type Bld, type Colony, type Pawn } from './types';

/** Lay out a template's tiles as far as it has been built. */
export function syncTiles(c: Colony, b: Bld): void {
  const list = cells(shapeOf(b));
  const n = b.built ? list.length : Math.floor(b.prog * list.length);
  for (let i = 0; i < n; i++) {
    const cell = list[i];
    const code = cellCode(b.k, cell.ch, b.mat);
    if (code === B.NONE) continue;
    const ti = (b.y + cell.dy) * c.w + b.x + cell.dx;
    if (c.st[ti] !== code && c.st[ti] !== B.GRAVE && !(cell.ch === '.' && isDecor(c.st[ti]))) c.st[ti] = code;
  }
  touch(c);
}

export function placeBuilding(c: Colony, k: string, x: number, y: number, instant: boolean, mat = 0, shape = k): Bld {
  const t = TPL[shape];
  const cost = TPL[k];
  const w = t.rows[0].length;
  const h = t.rows.length;
  const wood = mat ? Math.round(cost.wood * 0.3) : cost.wood;
  const stone = mat ? Math.round(cost.stone + cost.wood * 0.7) : cost.stone;
  const b: Bld = {
    id: c.nextBld++, k, x, y, w, h, prog: instant ? 1 : 0, built: instant, q: instant ? 42 : 0, mat,
    beds: spots(shape, 'b').map(() => 0), need: { wood: instant ? 0 : wood, stone: instant ? 0 : stone }, made: c.tick, dmg: 0,
  };
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = (y + dy) * c.w + x + dx;
      // a space in the plan is outside: the land there stays the colony's, not the building's
      if (t.rows[dy][dx] !== ' ') c.sb[i] = b.id;
      const f = c.feat[i];
      if (f === F.TREE || f === F.PINE) c.stock.wood += 4;
      else if (f === F.BOULDER) c.stock.stone += 4;
      c.feat[i] = F.NONE;
      c.fg[i] = 0;
      if (c.ter[i] === T.MARSH) c.ter[i] = T.DIRT;
    }
  }
  if (shape !== k) b.s = shape;
  c.blds.push(b);
  syncTiles(c, b);
  return b;
}

const OPEN = new Set<number>([T.GRASS, T.DIRT, T.SOIL, T.SAND, T.STONE, T.MARSH]);

/** Best free plot for a building, or null if the land is full. */
export function findSite(c: Colony, k: string, shape = k): [number, number] | null {
  const t = TPL[shape];
  const w = t.rows[0].length;
  const h = t.rows.length;
  const field = k === 'field';
  const minR = field ? 8 : k === 'graveyard' ? 14 : k === 'tower' ? 11 : k === 'hall' ? 0 : 3;
  const maxR = field ? 31 : 28;
  let best: [number, number] | null = null;
  let bestScore = -1e9;
  for (let y = 3; y < c.h - h - 3; y++) {
    for (let x = 3; x < c.w - w - 3; x++) {
      const mx = x + w / 2 - c.cx;
      const my = y + h / 2 - c.cy;
      const d = Math.sqrt(mx * mx + my * my);
      if (d < minR || d > maxR) continue;
      let ok = true;
      let soil = 0;
      for (let yy = y - 1; yy <= y + h && ok; yy++) {
        for (let xx = x - 1; xx <= x + w; xx++) {
          const i = yy * c.w + xx;
          const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
          const ter = c.ter[i];
          if (c.sb[i] || c.st[i] || c.feat[i] === F.RUIN || c.feat[i] === F.ORE) { ok = false; break; }
          if (inside ? !OPEN.has(ter) : !OPEN.has(ter) && ter !== T.PATH) { ok = false; break; }
          if (Math.abs(xx - c.cx) <= 1 && Math.abs(yy - c.cy) <= 1 && inside) { ok = false; break; }
          if (inside && ter === T.SOIL) soil++;
        }
      }
      if (!ok) continue;
      // a tower stands out along the road, where trouble comes from
      const road = k === 'tower' ? Math.hypot(x + w / 2 - (c.cx + (c.gx - c.cx) * 0.45), y + h / 2 - (c.cy + (c.gy - c.cy) * 0.45)) : 0;
      let score = field ? soil * 0.3 - d * 0.55 : k === 'graveyard' ? -Math.abs(d - 17) : k === 'tower' ? -road : -d;
      score += (hash32(c.seed, S.PLAN, x, y, c.nextBld) / 4294967296) * 1.6;
      if (score > bestScore) { bestScore = score; best = [x, y]; }
    }
  }
  return best;
}

export function build(c: Colony, k: string, instant = false, crop?: string): Bld | null {
  // no point measuring the same crowded ground every morning
  if (c.nosite[k] && c.tick - c.nosite[k] < 240 * 12) return null;
  // a new building may take one of its kind's other shapes; an instant one (a new colony's first) keeps the plain plan
  const opts = SHAPES[k];
  const shape = opts && !instant ? opts[hash32(c.seed, S.PLAN, 77, c.nextBld) % opts.length] : k;
  let use = shape;
  let site = findSite(c, k, shape);
  if (!site && shape !== k) { use = k; site = findSite(c, k); }
  if (!site) { c.nosite[k] = c.tick; return null; }
  delete c.nosite[k];
  let dwarves = 0;
  for (const p of c.pawns) if (p.race === 'dwarf') dwarves++;
  const stoneLover = c.pawns.length > 0 && dwarves / c.pawns.length > 0.4;
  const mat = k !== 'field' && k !== 'well' && k !== 'graveyard' && (stoneLover || (k === 'shrine' && c.stock.stone > 60)) ? 1 : 0;
  const b = placeBuilding(c, k, site[0], site[1], instant, mat, use);
  if (k === 'field') { b.crop = crop ?? 'veg'; b.tend = 40; }
  if (!instant) log(c, 'plan', undefined, undefined, k, b.id);
  return b;
}

/** Put work into a building. Returns false if it is stalled for want of materials. */
export function advanceBuild(c: Colony, b: Bld, hours: number, p: Pawn): boolean {
  if (b.built) return false;
  const t = TPL[b.k];
  let dp = hours / (t.work * 1.6);
  if (b.prog + dp > 1) dp = 1 - b.prog;
  const left = 1 - b.prog;
  for (const res of ['wood', 'stone'] as const) {
    if (b.need[res] <= 0) continue;
    const want = (b.need[res] * dp) / left;
    if (c.stock[res] < want) dp = Math.min(dp, (c.stock[res] / b.need[res]) * left);
  }
  if (dp <= 0.0005) return false;
  for (const res of ['wood', 'stone'] as const) {
    if (b.need[res] <= 0) continue;
    const use = Math.min(c.stock[res], (b.need[res] * dp) / left);
    c.stock[res] -= use;
    b.need[res] -= use;
  }
  b.q += (20 + p.sk[2] * 5.5) * dp;
  b.prog += dp;
  if (b.prog >= 0.999) {
    b.prog = 1;
    b.built = true;
    b.need.wood = 0;
    b.need.stone = 0;
    b.q = Math.max(5, Math.min(100, Math.round(b.q)));
    think(c, p, 'builtit');
    log(c, 'built', p.id, undefined, b.k, b.id);
    bump(c, 'buildings');
    if (b.beds.length) assignBeds(c, false);
    if (b.k === 'graveyard') bury(c);
  }
  syncTiles(c, b);
  return true;
}

export const canBuild = (c: Colony, b: Bld): boolean => !b.built && (b.need.wood <= 0.01 || c.stock.wood >= 1) && (b.need.stone <= 0.01 || c.stock.stone >= 1);

export function assignBeds(c: Colony, quiet: boolean): void {
  const homes = c.blds.filter((b) => b.built && b.beds.length > 0);
  for (const b of homes) for (let i = 0; i < b.beds.length; i++) if (b.beds[i] && !pawnById(c, b.beds[i])) b.beds[i] = 0;
  for (const p of c.pawns) {
    if (!p.home) continue;
    const b = homes.find((x) => x.id === p.home);
    if (!b || !b.beds.includes(p.id)) p.home = 0;
  }
  const free = (b: Bld): number => b.beds.filter((x) => !x).length;
  const move = (p: Pawn, b: Bld): void => {
    const old = homes.find((x) => x.id === p.home);
    if (old) old.beds[old.beds.indexOf(p.id)] = 0;
    b.beds[b.beds.indexOf(0)] = p.id;
    const was = p.home;
    p.home = b.id;
    if (!quiet && !was && stage(c, p) >= STAGE.TEEN) think(c, p, 'newhome');
  };
  for (const p of c.pawns) {
    if (p.home || p.gone) continue;
    let pick: Bld | undefined;
    const kin = [p.sp, stage(c, p) < STAGE.ADULT ? p.mo : 0, stage(c, p) < STAGE.ADULT ? p.fa : 0];
    for (const id of kin) {
      const o = id ? pawnById(c, id) : undefined;
      const b = o?.home ? homes.find((x) => x.id === o.home) : undefined;
      if (b && free(b) > 0) { pick = b; break; }
    }
    if (!pick) {
      let bestN = 99;
      for (const b of homes) {
        const f = free(b);
        if (f <= 0) continue;
        const n = b.beds.length - f;
        if (n < bestN) { bestN = n; pick = b; }
      }
    }
    if (pick) move(p, pick);
  }
  rehouse(c, homes, move);
  // couples under one roof
  for (const p of c.pawns) {
    if (!p.sp || p.id > p.sp || !p.home) continue;
    const o = pawnById(c, p.sp);
    if (!o || !o.home || o.home === p.home) continue;
    const a = homes.find((x) => x.id === p.home);
    const b = homes.find((x) => x.id === o.home);
    if (a && free(a) > 0) move(o, a);
    else if (b && free(b) > 0) move(p, b);
  }
}

const isKin = (a: Pawn, b: Pawn): boolean => a.sp === b.id || a.mo === b.id || a.fa === b.id || b.mo === a.id || b.fa === a.id || (!!a.mo && a.mo === b.mo);

/** Does this colonist share their home with someone who is not family? */
export function sharesWithStrangers(c: Colony, p: Pawn): boolean {
  const b = p.home ? c.blds.find((x) => x.id === p.home) : undefined;
  if (!b) return false;
  for (const id of b.beds) {
    if (!id || id === p.id) continue;
    const o = pawnById(c, id);
    if (o && !isKin(p, o)) return true;
  }
  return false;
}

/** When a home stands empty, the people who most need a place of their own move in. */
function rehouse(c: Colony, homes: Bld[], move: (p: Pawn, b: Bld) => void): void {
  for (const b of homes) {
    if (b.beds.some((x) => x)) continue;
    let done = false;
    if (b.beds.length >= 2) {
      for (const p of c.pawns) {
        if (!p.sp || p.id > p.sp || stage(c, p) < STAGE.ADULT) continue;
        const o = pawnById(c, p.sp);
        if (!o) continue;
        if (p.home === o.home && !sharesWithStrangers(c, p)) continue;
        const kids = c.pawns.filter((k) => (k.mo === p.id || k.mo === o.id) && stage(c, k) < STAGE.ADULT);
        if (2 + kids.length > b.beds.length) continue;
        move(p, b);
        move(o, b);
        for (const k of kids) move(k, b);
        done = true;
        break;
      }
    }
    if (done) continue;
    if (b.beds.length > 2) continue;
    for (const p of c.pawns) {
      if (stage(c, p) < STAGE.ADULT || p.sp || !sharesWithStrangers(c, p)) continue;
      if (c.pawns.some((k) => k.mo === p.id && stage(c, k) < STAGE.ADULT)) continue;
      move(p, b);
      break;
    }
  }
}

function slots(c: Colony, adults: number, kids: number): Record<string, number> {
  const has = (k: string): boolean => c.blds.some((b) => b.k === k && b.built);
  return {
    farmer: Math.max(1, Math.round(adults * 0.24)),
    cook: adults >= 16 ? 2 : 1,
    builder: adults >= 12 ? 2 : 1,
    woodcutter: adults >= 14 ? 2 : adults >= 4 ? 1 : 0,
    miner: adults >= 6 ? 1 : 0,
    hunter: adults >= 14 ? 2 : adults >= 4 ? 1 : 0,
    fisher: adults >= 8 ? 1 : 0,
    brewer: adults >= 8 && (has('tavern') || has('hall')) ? 1 : 0,
    smith: has('smithy') ? 1 : 0,
    weaver: has('workshop') ? 1 : 0,
    healer: adults >= 8 ? 1 : 0,
    guard: adults >= 20 ? 2 : adults >= 10 ? 1 : 0,
    priest: has('shrine') ? 1 : 0,
    lorekeeper: kids >= 3 && adults >= 8 ? 1 : 0,
    herbalist: adults >= 14 ? 1 : 0,
    midwife: adults >= 18 ? 1 : 0,
    mason: adults >= 16 ? 1 : 0,
    carpenter: adults >= 20 ? 1 : 0,
    scout: adults >= 22 ? 1 : 0,
    tavernkeeper: has('tavern') ? 1 : 0,
    bard: adults >= 16 ? 1 : 0,
    gravedigger: has('graveyard') && adults >= 12 ? 1 : 0,
    ratcatcher: adults >= 18 ? 1 : 0,
    quartermaster: adults >= 20 ? 1 : 0,
  };
}

export function assignProfs(c: Colony, quiet: boolean): void {
  const adults = c.pawns.filter((p) => { const s = stage(c, p); return s >= STAGE.ADULT; });
  const kids = c.pawns.length - adults.length;
  const want = slots(c, adults.length, kids);
  for (const def of PROF_LIST) {
    let have = 0;
    for (const p of adults) if (p.prof === def.k) have++;
    while (have < (want[def.k] ?? 0)) {
      let best: Pawn | undefined;
      let score = -1;
      for (const p of adults) {
        if (p.prof) continue;
        if (BACKS[p.bc]?.no?.includes(def.work) || BACKS[p.ba]?.no?.includes(def.work)) continue;
        const s = p.sk[def.skill] + p.pas[def.skill] * 3 - (stage(c, p) === STAGE.ELDER ? 2 : 0);
        if (s > score) { score = s; best = p; }
      }
      if (!best || score < 1) break;
      best.prof = def.k;
      have++;
      if (!quiet) {
        think(c, best, 'newtrade');
        log(c, 'trade', best.id, undefined, def.k);
        note(c, best, 'trade', undefined, def.k);
      }
    }
  }
  void PROFS;
}

/** Once a day: beds, trades, and the next thing worth building. */
export function plan(c: Colony): void {
  assignBeds(c, false);
  assignProfs(c, false);
  const pop = c.pawns.length;
  if (!pop) return;
  const pending = c.blds.filter((b) => !b.built);
  // no stone to be had for weeks: build it in timber instead
  for (const b of pending) {
    if (b.need.stone > 0.01 && c.stock.stone < 1 && c.tick - b.made > 240 * 12) {
      b.need.wood += b.need.stone * 1.5;
      b.need.stone = 0;
    }
  }
  const pendingFields = pending.filter((b) => b.k === 'field').length;
  if (pending.length - pendingFields >= (pop >= 14 ? 2 : 1)) return;
  const count = (k: string): number => c.blds.filter((b) => b.k === k).length;
  const season = seasonOf(c.tick);
  const doy = dayOf(c.tick) % DAYS_PER_YEAR;

  // Fields first, while there is still time to plant
  const fields = c.blds.filter((b) => b.k === 'field');
  const wantFields = Math.ceil(mouths(c) * 0.34);
  if (fields.length < wantFields && pendingFields === 0 && (season === 0 || season === 3 || (season === 1 && doy < 22))) {
    if (build(c, 'field', false, chooseCrop(c, null))) return;
  }
  if (pending.length - pendingFields >= 1 && pop < 14) return;

  if (!count('hall')) { build(c, 'hall'); return; }
  if (!count('store')) { build(c, 'store'); return; }
  let homeless = 0;
  for (const p of c.pawns) if (!p.home) homeless++;
  let beds = 0;
  for (const b of c.blds) if (!b.built && b.beds.length) beds += b.beds.length;
  if (homeless > beds) {
    let rough = 0;
    for (const p of c.pawns) if (p.race === 'orc' || p.race === 'goblin') rough++;
    const need = homeless - beds;
    const k = need >= 4 ? (rough / pop > 0.5 ? 'longhouse' : 'bighouse') : need >= 2 ? 'house' : 'cottage';
    if (build(c, k)) return;
  }
  if (c.dead.some((d) => !d.left) && !count('graveyard')) { if (build(c, 'graveyard')) return; }
  if (pop >= 4 && !count('well')) { if (build(c, 'well')) return; }
  if (pop >= 7 && !count('workshop')) { if (build(c, 'workshop')) return; }
  if (pop >= 9 && !count('tavern')) { if (build(c, 'tavern')) return; }
  if (pop >= 7 && !count('shrine')) { if (build(c, 'shrine')) return; }
  if (pop >= 10 && !count('smithy')) { if (build(c, 'smithy')) return; }
  if (pop >= 12 && !count('infirmary')) { if (build(c, 'infirmary')) return; }
  if (pop >= 24 && count('store') < 2) { if (build(c, 'store')) return; }
  // as the colony grows, work moves into buildings made for it
  let kids = 0;
  for (const p of c.pawns) if (stage(c, p) < STAGE.ADULT && stage(c, p) > STAGE.BABY) kids++;
  const want: [string, boolean][] = [
    ['kitchen', pop >= 12],
    ['granary', pop >= 14],
    ['brewery', pop >= 15 && count('tavern') > 0],
    ['school', pop >= 14 && kids >= 4],
    ['herbalist', pop >= 16],
    ['guardhouse', pop >= 18],
    ['gamehall', pop >= 19],
    ['bathhouse', pop >= 21],
    // after the first real fight, or once the colony is big enough to be worth robbing
    ['tower', pop >= 18 || (pop >= 12 && (c.stats.raids ?? 0) >= 2)],
  ];
  for (const [k, ok] of want) if (ok && !count(k)) { if (build(c, k)) return; }

  // With the needs met, people want homes of their own
  if (!pending.length && c.stock.wood >= 30) {
    let beds = 0;
    for (const b of c.blds) beds += b.beds.length;
    if (beds < pop + 4) {
      let couple = false;
      let single = false;
      for (const p of c.pawns) {
        if (stage(c, p) < STAGE.ADULT) continue;
        const o = p.sp ? pawnById(c, p.sp) : undefined;
        if (o && (o.home !== p.home || sharesWithStrangers(c, p))) couple = true;
        else if (!o && sharesWithStrangers(c, p)) single = true;
      }
      if (couple) { if (build(c, 'house')) return; }
      else if (single) { if (build(c, 'cottage')) return; }
    }
  }
  void HOMES;
  void CROPS;
  void dropFeat;
}
