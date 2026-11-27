// Animals the colony keeps: chickens, goats, sheep and cows in the pen, and dogs that pick a
// colonist and follow them about.

import { TICKS_PER_DAY, dayOf, seasonOf } from '../config';
import { cacheOf } from './cache';
import { cells } from './data/buildings';
import { bump, log } from './events';
import { think } from './mood';
import { STAGE, awayById, pawnById, posAt, stage } from './pawn';
import { Rand, S } from './rng';
import type { Animal, Bld, Colony, Pawn } from './types';

export interface AnimalDef { k: string; name: string; plural: string; feed: number; prod: number; res: 'eggs' | 'milk' | 'cloth' | ''; meat: number; hide: number; price: number; life: number }

export const ANIMALS: Record<string, AnimalDef> = {
  chicken: { k: 'chicken', name: 'chicken', plural: 'chickens', feed: 0.04, prod: 0.8, res: 'eggs', meat: 2, hide: 0, price: 2, life: 6 },
  goat: { k: 'goat', name: 'goat', plural: 'goats', feed: 0.15, prod: 1.1, res: 'milk', meat: 8, hide: 1, price: 6, life: 12 },
  sheep: { k: 'sheep', name: 'sheep', plural: 'sheep', feed: 0.15, prod: 0.18, res: 'cloth', meat: 9, hide: 1, price: 6, life: 11 },
  cow: { k: 'cow', name: 'cow', plural: 'cows', feed: 0.35, prod: 2.6, res: 'milk', meat: 22, hide: 2, price: 14, life: 18 },
  dog: { k: 'dog', name: 'dog', plural: 'dogs', feed: 0.1, prod: 0, res: '', meat: 0, hide: 0, price: 0, life: 13 },
};

const DOG_NAMES = ['Rook', 'Bramble', 'Ash', 'Moss', 'Patch', 'Thorn', 'Biscuit', 'Smudge', 'Wolf', 'Badger', 'Pip', 'Grim', 'Fennel', 'Soot', 'Hob', 'Tansy', 'Bran', 'Nettle', 'Clover', 'Burr'];

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const pens = (c: Colony): Bld[] => c.blds.filter((b) => b.k === 'pen' && b.built);
/** How many beasts the pens hold. Dogs live with people, not in the pen. */
export const penRoom = (c: Colony): number => pens(c).length * 10;
export const livestock = (c: Colony): Animal[] => (c.herd ?? []).filter((a) => a.k !== 'dog');

/** The open ground inside a pen, as tile indexes. */
function penTiles(c: Colony, b: Bld): number[] {
  const out: number[] = [];
  for (const cell of cells('pen')) if (cell.ch === ',') out.push((b.y + cell.dy) * c.w + b.x + cell.dx);
  return out;
}

function homePen(c: Colony, a: Animal): Bld | undefined {
  const list = pens(c);
  return list.find((b) => a.x >= b.x && a.x < b.x + b.w && a.y >= b.y && a.y < b.y + b.h) ?? list[a.id % Math.max(1, list.length)];
}

function addAnimal(c: Colony, k: string, at: number, r: Rand): Animal {
  const a: Animal = { id: (c.nextAnimal = (c.nextAnimal ?? 0) + 1), k, x: at % c.w, y: Math.floor(at / c.w), px: at % c.w, py: Math.floor(at / c.w), born: c.tick - r.int(TICKS_PER_DAY * 60), prod: 0, fed: 100 };
  (c.herd ??= []).push(a);
  return a;
}

/** Every tick: beasts amble about the pen; dogs keep up with their person and bark at trouble. */
export function stepHerd(c: Colony): void {
  const list = c.herd;
  if (!list?.length) return;
  const r = new Rand(c.seed, S.WILD, c.tick, 7);
  const k = cacheOf(c);
  for (const a of list) {
    a.px = a.x;
    a.py = a.y;
    if (a.k === 'dog') {
      // trouble on the map: a dog hears it long before anyone else
      if (!c.alarm) {
        for (const f of c.foes) {
          if (Math.abs(f.x - a.x) + Math.abs(f.y - a.y) <= 16 && f.wait <= c.tick + 6) {
            c.alarm = c.tick;
            log(c, 'dogbark', a.owner, undefined, a.name, a.id);
            log(c, 'alarm');
            break;
          }
        }
      }
      const o = a.owner ? pawnById(c, a.owner) : undefined;
      let tx = c.cx;
      let ty = c.cy;
      if (o && !o.gone) { const i = posAt(c, o, c.tick); tx = i % c.w; ty = Math.floor(i / c.w); }
      const far = Math.abs(tx - a.x) + Math.abs(ty - a.y);
      if (far <= 1 || (far <= 3 && !r.chance(0.25))) continue;
      let best = -1;
      let bd = far;
      for (const [dx, dy] of STEPS) {
        const i = (a.y + dy) * c.w + a.x + dx;
        if (!k.walk[i]) continue;
        const d = Math.abs(tx - a.x - dx) + Math.abs(ty - a.y - dy);
        if (d < bd || (d === bd && r.chance(0.3))) { bd = d; best = i; }
      }
      // a long way behind: they run to catch up
      if (best < 0 || far > 30) { a.x = tx; a.y = ty; a.px = tx; a.py = ty; continue; }
      a.x = best % c.w;
      a.y = Math.floor(best / c.w);
      continue;
    }
    if (!r.chance(a.k === 'chicken' ? 0.22 : 0.1)) continue;
    const pen = homePen(c, a);
    if (!pen) continue;
    const inside = new Set(penTiles(c, pen));
    const [dx, dy] = STEPS[r.int(4)];
    const i = (a.y + dy) * c.w + a.x + dx;
    if (inside.has(i)) { a.x = i % c.w; a.y = Math.floor(i / c.w); }
  }
}

/** Once a day: feeding, eggs and milk, young ones, old age, strays and the first beasts for a new pen. */
export function dailyHerd(c: Colony): void {
  const day = dayOf(c.tick);
  const r = new Rand(c.seed, S.WILD, day, 8);
  const list = (c.herd ??= []);
  const room = penRoom(c);

  // a new pen is stocked from a farm down the road
  if (room && !livestock(c).length && !(c.stats.penStocked > 0)) {
    const pen = pens(c)[0];
    const tiles = penTiles(c, pen);
    for (const k of ['chicken', 'chicken', 'chicken', 'goat', 'goat', r.chance(0.5) ? 'sheep' : 'chicken']) addAnimal(c, k, r.pick(tiles), r);
    c.stats.penStocked = 1;
    c.stock.silver = Math.max(0, c.stock.silver - 18);
    log(c, 'pen_stocked', undefined, undefined, undefined, 6);
  }

  // feeding: grain first, then vegetables; the hungry give nothing and may not last
  let need = 0;
  for (const a of list) need += ANIMALS[a.k]?.feed ?? 0;
  const fromGrain = Math.min(c.stock.grain, need);
  c.stock.grain -= fromGrain;
  const fromVeg = Math.min(c.stock.veg, need - fromGrain);
  c.stock.veg -= fromVeg;
  const share = need > 0 ? (fromGrain + fromVeg) / need : 1;
  for (const a of list) a.fed = Math.max(0, Math.min(100, a.fed + (share >= 0.99 ? 25 : -30 * (1 - share))));

  // what they give, waiting for the herder to collect
  for (const a of list) {
    const def = ANIMALS[a.k];
    if (!def?.prod || a.fed < 40) continue;
    const mature = c.tick - a.born > TICKS_PER_DAY * 30;
    if (mature) a.prod = Math.min(def.prod * 6, a.prod + def.prod * (seasonOf(c.tick) === 3 ? 0.6 : 1));
  }

  // old age, and starving beasts
  for (const a of list.slice()) {
    const def = ANIMALS[a.k];
    const years = (c.tick - a.born) / (TICKS_PER_DAY * 60);
    if (a.fed <= 0 || years > def.life + r.float() * 2) {
      c.herd = c.herd!.filter((x) => x !== a);
      if (a.k === 'dog') {
        const o = a.owner ? pawnById(c, a.owner) : undefined;
        if (o) think(c, o, 'dogdied');
        log(c, 'dogdied', a.owner, undefined, a.name);
      } else if (a.fed <= 0) bump(c, 'herdStarved');
    }
  }

  // young ones, in spring and summer, while there is room
  const season = seasonOf(c.tick);
  if (season <= 1) {
    for (const k of ['chicken', 'goat', 'sheep', 'cow']) {
      const grown = livestock(c).filter((a) => a.k === k && a.fed > 60 && c.tick - a.born > TICKS_PER_DAY * 40);
      if (grown.length < 2 || livestock(c).length >= room || !r.chance(k === 'chicken' ? 0.12 : 0.05)) continue;
      const mother = r.pick(grown);
      const young = addAnimal(c, k, mother.y * c.w + mother.x, r);
      young.born = c.tick;
      bump(c, 'animalsBorn');
    }
  }

  // a stray turns up now and then, and chooses someone
  const dogs = list.filter((a) => a.k === 'dog');
  if (dogs.length < Math.max(1, Math.floor(c.pawns.length / 7)) && r.chance(0.012)) {
    const dog = addAnimal(c, 'dog', c.gy * c.w + c.gx, r);
    dog.name = DOG_NAMES[r.int(DOG_NAMES.length)];
    log(c, 'dogcame', undefined, undefined, dog.name);
  }
  for (const d of (c.herd ?? []).filter((a) => a.k === 'dog')) {
    const o = d.owner ? pawnById(c, d.owner) : undefined;
    if (o && !o.gone) continue;
    // their person is away with an expedition: they wait at home
    if (d.owner && awayById(c, d.owner)) continue;
    if (o?.gone || d.owner) {
      // their person is gone: they wait a while, then choose someone new
      if (r.chance(0.6)) continue;
    }
    const pick = chooseOwner(c, r);
    if (!pick) continue;
    d.owner = pick.id;
    think(c, pick, 'gotdog');
    log(c, 'adopted', pick.id, undefined, d.name);
  }
}

/** Who a dog takes to: someone good with animals who has no dog yet, the kind before the cruel. */
function chooseOwner(c: Colony, r: Rand): Pawn | undefined {
  const taken = new Set((c.herd ?? []).filter((a) => a.k === 'dog' && a.owner).map((a) => a.owner));
  let best: Pawn | undefined;
  let bs = -1e9;
  for (const p of c.pawns) {
    if (p.gone || taken.has(p.id) || stage(c, p) < STAGE.CHILD) continue;
    const s = p.sk[9] + p.per[0] * 3 + (stage(c, p) === STAGE.CHILD ? 3 : 0) + r.float() * 5;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}

/** A passing trader sells a beast or two, if the pen has room and the colony has silver. */
export function buyBeasts(c: Colony, r: Rand): string {
  const room = penRoom(c) - livestock(c).length;
  if (room < 2 || c.stock.silver < 30) return '';
  const k = r.pick(['cow', 'sheep', 'goat', 'cow']);
  const def = ANIMALS[k];
  const n = k === 'cow' ? 1 : 2;
  const pen = pens(c)[0];
  const tiles = penTiles(c, pen);
  for (let i = 0; i < n; i++) addAnimal(c, k, r.pick(tiles), r);
  c.stock.silver -= def.price * n;
  return n === 1 ? 'a ' + def.name : 'two ' + def.plural;
}

/** A colonist's dog, if they have one. */
export function dogOf(c: Colony, p: Pawn): Animal | undefined {
  return c.herd?.find((a) => a.k === 'dog' && a.owner === p.id);
}

/** The herder's rounds: collect eggs, milk and wool; in a hungry season, slaughter one. */
export function herdWork(c: Colony, p: Pawn, speed: number, hours: number, hungry: boolean): void {
  const stock = livestock(c);
  let got = 0;
  for (const a of stock) {
    const def = ANIMALS[a.k];
    if (!def.res || a.prod <= 0) continue;
    const n = Math.min(a.prod, def.prod * 2 * speed * hours);
    a.prod -= n;
    c.stock[def.res] += n;
    got += n;
    bump(c, 'made_' + def.res, n);
  }
  for (const a of stock) a.fed = Math.min(100, a.fed + 5);
  if (hungry && stock.length > 3) {
    const old = stock.filter((a) => a.k !== 'chicken').sort((x, y) => x.born - y.born)[0] ?? stock[0];
    const def = ANIMALS[old.k];
    c.herd = c.herd!.filter((x) => x !== old);
    c.stock.meat += def.meat;
    c.stock.leather += def.hide;
    log(c, 'slaughter', p.id, undefined, old.k);
  }
  void got;
}

/** What the herder has to do: is there anything to collect, or a hungry pen? */
export function herdNeed(c: Colony): number {
  let prod = 0;
  let hungry = 0;
  for (const a of livestock(c)) { prod += a.prod / Math.max(0.1, ANIMALS[a.k].prod); if (a.fed < 50) hungry++; }
  return prod / 4 + hungry * 0.5;
}

void cells;
