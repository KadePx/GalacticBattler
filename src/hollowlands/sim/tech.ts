// Discoveries. Lore gathers from the elders, the learned, the books on people's shelves and the
// schoolhouse; once there is enough, someone works out the next thing the colony is ready for, and
// it is told by name. Word of it goes to the neighbours, and what neighbours have found out comes
// cheaper (their traders talk). Most discoveries bring a building and a trade of their own: the
// mill grinds flour, the bakery bakes bread, the kiln fires pots and bricks, the glassworks glazes
// people's windows, the tannery and the dye works make clothes that last and clothes in colour,
// the steelworks makes steel, the jeweller takes the rich's silver, and the press prints the
// colony's chronicle.

import { DAYS_PER_YEAR, TICKS_PER_DAY, dayOf } from '../config';
import { CASTLE_KINDS, HOMES } from './data/buildings';
import { TECHS, TECH_BLDS, TECH_LIST, TECH_PROF, type TechDef } from './data/tech';
import { mouths } from './econ';
import { bump, log, note } from './events';
import { knows, techDirty, techScan } from './known';
import { think } from './mood';
import { STAGE, pawnById, per, stage } from './pawn';
import { Rand, S, hash32 } from './rng';
import { AX, B, type Act, type Bld, type Colony, type Pawn, type WorkK } from './types';

export { knows };

type Tech = NonNullable<Colony['tech']>;

export const blankTech = (): Tech => ({ lore: 0, got: [], heard: {}, first: {}, ord: [], vol: 0, pg: 0 });

/** The days between one discovery and the next, at the least. */
const GAP_DAYS = 12;
/** A work variant: fitting glass into a home's windows. */
export const GLAZE = 77;

/** Lore it takes to work this out now: dearer with every discovery made, cheaper if the neighbours already know. */
export function costOf(c: Colony, d: TechDef): number {
  const t = c.tech;
  const n = t ? t.got.length : 0;
  return Math.round((d.base + 16 * n) * (t && t.heard[d.k] ? 0.6 : 1));
}

/** Can the colony work this out yet: what it needs first is known, and it has what it would need? */
function ready(c: Colony, d: TechDef): boolean {
  if (knows(c, d.k)) return false;
  for (const k of d.pre) if (!knows(c, k)) return false;
  const pop = c.pawns.length;
  let fields = 0;
  let smithy = false;
  let school = false;
  for (const b of c.blds) { if (b.k === 'field') fields++; else if (b.built && b.k === 'smithy') smithy = true; else if (b.built && b.k === 'school') school = true; }
  switch (d.k) {
    case 'rotation': return fields >= 2;
    case 'milling': return fields >= 3;
    case 'kiln': return pop >= 14;
    case 'tanning': return pop >= 16;
    case 'steel': return smithy;
    case 'jewellery': return pop >= 25;
    case 'printing': return school;
    default: return true;
  }
}

/** The next thing the colony is ready to work out, the cheapest first (each colony leans its own way). */
export function nextTech(c: Colony): TechDef | undefined {
  let best: TechDef | undefined;
  let bs = 1e9;
  for (let i = 0; i < TECH_LIST.length; i++) {
    const d = TECH_LIST[i];
    if (!ready(c, d)) continue;
    const s = costOf(c, d) + (hash32(c.seed, S.TECH, 1, i) % 24);
    if (s < bs) { bs = s; best = d; }
  }
  return best;
}

/** Lore gathered in study, reading, teaching and at the press. */
export function addLore(c: Colony, n: number): void {
  if (c.tech && n > 0) c.tech.lore += n;
}

/** Start of each day: lore from the old and the learned and the books, a discovery when there is enough, the jeweller's custom. */
export function dailyTech(c: Colony): void {
  const t = (c.tech ??= blankTech());
  let add = 0;
  for (const p of c.pawns) {
    if (p.gone || p.thrall) continue;
    const st = stage(c, p);
    if (st === STAGE.ELDER) add += 0.05 + p.sk[11] * 0.008;
    else if (st >= STAGE.ADULT && p.sk[11] >= 8) add += 0.02 + (p.sk[11] - 8) * 0.004;
    if (p.prof === 'lorekeeper') add += 0.12;
  }
  // books on the shelves, the schoolhouse's and people's own
  let books = 0;
  let school = false;
  for (const b of c.blds) {
    if (!b.built) continue;
    if (b.k === 'school') school = true;
    else if (!b.beds.length) continue;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (c.st[y * c.w + x] === B.BOOKS) books++;
  }
  add += Math.min(0.8, books * 0.03) + (school ? 0.2 : 0);
  t.lore += add;
  const day = dayOf(c.tick);
  const last = t.got.length ? t.got[t.got.length - 1].t : -1e9;
  if (c.tick - last >= GAP_DAYS * TICKS_PER_DAY) {
    const d = nextTech(c);
    if (d && t.lore >= costOf(c, d)) discover(c, d);
  }
  if (techScan(c).blds.has('jeweller')) orders(c, day);
}

/** Who works it out: whoever is best at the work it touches, learned, and curious. */
function discover(c: Colony, d: TechDef): void {
  const t = c.tech!;
  const r = new Rand(c.seed, S.TECH, c.tick, 2);
  let who: Pawn | undefined;
  let ws = -1e9;
  for (const p of c.pawns) {
    if (p.gone || p.thrall || stage(c, p) < STAGE.ADULT) continue;
    // (someone who has already made their name gives others a chance)
    let made = 0;
    for (const g of t.got) if (g.a === p.id) made++;
    const s = p.sk[d.skill] + p.sk[11] * 0.6 + per(p, AX.CURIOUS) * 3 + r.float() * 3 - made * 4;
    if (s > ws) { ws = s; who = p; }
  }
  if (!who) return;
  t.lore -= costOf(c, d);
  const from = t.heard[d.k];
  t.got.push(from ? { k: d.k, t: c.tick, a: who.id, from } : { k: d.k, t: c.tick, a: who.id });
  delete t.heard[d.k];
  think(c, who, 'discovered');
  // a purse from the treasury, if it can spare one
  if (c.stock.silver >= 10) { c.stock.silver -= 10; who.coin += 10; }
  note(c, who, 'discovery', undefined, d.k);
  log(c, 'discovery', who.id, undefined, from ? d.k + ':' + from : d.k);
  bump(c, 'discoveries');
  techDirty(c);
  // word of it goes down the road to the neighbours
  c.out.push({ k: 'news', what: 'tech', who: d.k + '|' + who.first + ' ' + who.fam });
}

/** News from a neighbour of something they have worked out: our own people start to puzzle it out too. */
export function heardOf(c: Colony, k: string, from: string): void {
  if (!TECHS[k]) return;
  const t = (c.tech ??= blankTech());
  if (knows(c, k) || t.heard[k]) return;
  t.heard[k] = from;
}

/** A trader in from a neighbour who knows something we do not: they talk, and people listen. */
export function traderTalk(c: Colony, from: string | undefined): void {
  const t = c.tech;
  if (!t || !from) return;
  let k = '';
  for (const key in t.heard) if (t.heard[key] === from) { k = key; break; }
  if (!k) return;
  t.lore += 6;
  log(c, 'tech_trader', undefined, undefined, k + ':' + from);
}

/** The first of a new kind of building is finished: told by name, as a story people will repeat. */
export function firstBuilt(c: Colony, b: Bld, p: Pawn): void {
  techDirty(c);
  if (!TECH_BLDS.has(b.k)) return;
  const t = (c.tech ??= blankTech());
  if (t.first[b.k]) return;
  t.first[b.k] = c.tick;
  note(c, p, 'firstbuilt', undefined, b.k);
  log(c, 'firstbuilt', p.id, undefined, b.k, b.id);
}

/** The kinds of building the colony now wants for what it knows (the mill on the river if it can, else on the wind). */
export function techWants(c: Colony): string[] {
  const out: string[] = [];
  const t = c.tech;
  if (!t) return out;
  for (const g of t.got) {
    const d = TECHS[g.k];
    if (d && d.bld.length) out.push(d.bld[0]);
  }
  return out;
}

// ---------- Work ----------

type Offer = (w: WorkK, urgency: number, why: string, make: () => Job | null) => void;
interface Job { w: WorkK; x: number; y: number; adj: boolean; dur: number; b?: number; d?: number; o?: number; why: string }
type MkJob = (w: WorkK, tile: number, adj: boolean, why: string, b?: number, d?: number) => Job;
type Spot = (b: Bld, chars: string) => number;

/** The trade nearest to each discovered trade, whose holders lend a hand there. */
const NEAR_PROF: Record<string, string> = { windmill: 'farmer', watermill: 'farmer', bakery: 'cook', kiln: 'carpenter', glassworks: 'potter', tannery: 'weaver', dyeworks: 'weaver', steelworks: 'smith', jeweller: 'smith', printer: 'lorekeeper' };

/** Bricks worth keeping in hand: for the homes going up, and, while stone is short, for all the town's building. */
function brickWant(c: Colony): number {
  let homes = 0;
  let all = 0;
  for (const b of c.blds) {
    if (b.built || CASTLE_KINDS.has(b.k)) continue;
    all += b.need.stone;
    if (HOMES.includes(b.k)) homes += b.need.stone;
  }
  return Math.min(80, 12 + (c.stock.stone < all ? all : homes));
}

/** A home that could do with glass in its windows: the finest first. */
function unglazed(c: Colony): Bld | undefined {
  let best: Bld | undefined;
  for (const b of c.blds) {
    if (!b.built || b.gl || !HOMES.includes(b.k) || b.k === 'shack' || !b.beds.some((x) => x)) continue;
    if (!best || b.q > best.q) best = b;
  }
  return best;
}

/** Work at the buildings of what the colony has discovered. Those who hold the trade come first. */
export function techJobs(c: Colony, p: Pawn, offer: Offer, job: MkJob, spot: Spot, woodTarget: number): void {
  // fuel for the ovens and the kilns only while the woodpile is healthy; pots and glass only from plenty
  const woodLow = c.stock.wood < woodTarget * 0.6;
  const woodRich = c.stock.wood >= woodTarget;
  const tb = techScan(c).blds;
  if (!tb.size) return;
  const s = c.stock;
  const pop = c.pawns.length;
  const m = mouths(c);
  // the trade that keeps the building first, then those of the nearest trade (a cook at the ovens,
  // a weaver at the vats), then anyone with a spare hour
  const mine = (k: string): number => (p.prof === TECH_PROF[k] ? 1 : p.prof === NEAR_PROF[k] ? 0.7 : 0.3);
  const mill = tb.get('watermill') ?? tb.get('windmill');
  // (grain for the brewers is left in the bins: the mill takes only what is over)
  if (mill && s.grain >= 16 + m * 10 && s.flour < m * 2) offer('farm', 2.6 * mine(mill.k), 'mill', () => job('farm', spot(mill, 'M'), true, 'Grinding grain at the mill', mill.id));
  const bakery = tb.get('bakery');
  if (bakery && s.flour >= 3 && s.bread < m * 1.5 && !woodLow) offer('cook', 3.2 * mine('bakery'), 'bake', () => job('cook', spot(bakery, 'E'), true, 'Baking bread', bakery.id));
  const kiln = tb.get('kiln');
  if (kiln && ((!woodLow && s.brick < brickWant(c)) || (woodRich && s.goods < pop))) offer('craft', 2 * mine('kiln'), 'kiln', () => job('craft', spot(kiln, 'I'), true, s.brick < brickWant(c) ? 'Firing bricks' : 'Throwing pots', kiln.id));
  const glass = tb.get('glassworks');
  if (glass) {
    const home = s.glass >= 2 ? unglazed(c) : undefined;
    if (home) offer('craft', 2.2 * mine('glassworks'), 'glaze', () => job('craft', (home.y + home.h - 1) * c.w + home.x + Math.floor(home.w / 2), true, 'Fitting glass in the windows', home.id, GLAZE));
    else if (woodRich && s.glass < 8 && unglazed(c)) offer('craft', 1.8 * mine('glassworks'), 'glass', () => job('craft', spot(glass, 'F'), true, 'Blowing glass', glass.id));
  }
  const tan = tb.get('tannery');
  if (tan && s.leather >= 3) offer('craft', 1.8 * mine('tannery'), 'tan', () => job('craft', spot(tan, 'y'), true, 'Working hides in the pits', tan.id));
  const dye = tb.get('dyeworks');
  if (dye && (s.cloth >= 3 || s.leather >= 4) && s.clothes >= 1 + pop * 0.2) offer('craft', 1.6 * mine('dyeworks'), 'dye', () => job('craft', spot(dye, 'z'), true, 'At the dye vats', dye.id));
  const steel = tb.get('steelworks');
  if (steel && (s.iron >= 2 || (s.ore >= 3 && s.wood >= 4)) && (s.tools < 3 + pop * 0.2 || s.weapons < pop * 0.35 || s.iron < 6)) offer('smith', 3.1 * mine('steelworks'), 'steel', () => job('smith', spot(steel, 'B'), true, 'Making steel', steel.id));
  const jw = tb.get('jeweller');
  if (jw && c.tech && c.tech.ord.length) offer('craft', 2.4 * mine('jeweller'), 'jewel', () => job('craft', spot(jw, 'j'), true, 'Setting a stone in silver', jw.id));
  const press = tb.get('printer');
  if (press && s.wood >= 4) offer('teach', 1.8 * mine('printer'), 'press', () => job('teach', spot(press, 'i'), true, 'At the press', press.id));
}

/** Is this an hour's work at one of the discovered trades (or glazing a home)? */
export function isTechWork(c: Colony, a: Act): Bld | undefined {
  if (!a.b || a.w === 'build') return undefined;
  if (a.d === GLAZE) return c.blds.find((b) => b.id === a.b);
  const b = c.blds.find((x) => x.id === a.b);
  return b && b.built && TECH_BLDS.has(b.k) ? b : undefined;
}

/** What an hour or two at the mill, the ovens, the kiln or the press comes to. */
export function techWork(c: Colony, p: Pawn, a: Act, b: Bld, speed: number, hours: number, r: Rand, made: (k: string, n: number) => void): void {
  const s = c.stock;
  const pop = c.pawns.length;
  const fuel = (n: number): void => { s.wood = Math.max(0, s.wood - n); };
  if (a.d === GLAZE) {
    if (b.gl || s.glass < 2 || !b.built) return;
    s.glass -= 2;
    b.gl = 1;
    b.q = Math.min(100, b.q + 3);
    techDirty(c);
    bump(c, 'glazed');
    if (!c.stats.glazedSeen) { c.stats.glazedSeen = 1; log(c, 'glazed_first', p.id, undefined, b.k, b.id); }
    return;
  }
  switch (b.k) {
    case 'windmill':
    case 'watermill': {
      const n = Math.min(s.grain, speed * hours * (b.k === 'watermill' ? 3 : 2.3));
      s.grain -= n;
      s.flour += n;
      made('flour', n);
      break;
    }
    case 'bakery': {
      const n = Math.min(s.flour, speed * hours * 1.6);
      s.flour -= n;
      fuel(0.3 * hours);
      s.bread += n * 1.6;
      made('bread', n * 1.6);
      break;
    }
    case 'kiln': {
      fuel(0.45 * hours);
      if (s.brick < brickWant(c) || s.goods >= pop) { const n = speed * hours * 1.5; s.brick += n; made('brick', n); }
      else { const n = speed * hours * 0.9; s.goods += n; made('goods', n); }
      break;
    }
    case 'glassworks': {
      fuel(0.6 * hours);
      const n = speed * hours * 0.5;
      s.glass += n;
      made('glass', n);
      break;
    }
    case 'tannery': {
      const n = Math.min(s.leather / 2, speed * hours * 0.45);
      s.leather -= n * 2;
      if (s.clothes < 2 + pop * 0.25) { s.clothes += n * 1.2; made('clothes', n * 1.2); } else { s.goods += n * 2; made('goods', n * 2); }
      break;
    }
    case 'dyeworks': {
      const k = s.cloth >= 1 ? 'cloth' : 'leather';
      const n = Math.min(s[k], speed * hours * 0.6);
      s[k] -= n;
      s.berries = Math.max(0, s.berries - 0.15 * hours);
      s.goods += n * 1.8;
      made('goods', n * 1.8);
      bump(c, 'dyed', n);
      break;
    }
    case 'steelworks': {
      let n = Math.max(1, Math.round(speed * hours * 0.9));
      while (n-- > 0) {
        if (s.ore >= 3 && s.wood >= 1 && s.iron < 6) { s.ore -= 3; s.wood -= 1; s.iron += 2.4; made('iron', 2.4); }
        else if (s.iron >= 2 && s.wood >= 1) {
          s.iron -= 2;
          s.wood -= 1;
          const armed = s.weapons >= pop * 0.3;
          const tools = armed && (s.tools < 3 + pop * 0.2 || s.weapons >= pop * 0.4);
          s[tools ? 'tools' : 'weapons'] += 1;
          made(tools ? 'tools' : 'weapons', 1);
          bump(c, 'steel');
        } else break;
      }
      break;
    }
    case 'jeweller': {
      const t = c.tech;
      if (!t || !t.ord.length || !r.chance(Math.min(1, (speed * hours) / 4))) break;
      const who = pawnById(c, t.ord.shift()!);
      bump(c, 'jewels');
      if (!who) break;
      think(c, who, 'newjewels');
      if (!c.stats.jewelSeen) { c.stats.jewelSeen = 1; log(c, 'jewels_first', p.id, who.id); }
      break;
    }
    case 'printer': {
      const t = c.tech;
      if (!t) break;
      fuel(0.15 * hours);
      t.lore += 0.06 * hours * speed;
      t.pg += hours * speed;
      if (t.pg >= 36) {
        t.pg -= 36;
        t.vol++;
        log(c, 'chronicle', p.id, undefined, undefined, t.vol);
        if (t.vol === 1) note(c, p, 'chronicle');
      }
      break;
    }
    default: break;
  }
}

// ---------- The jeweller's custom ----------

/** The well-off order rings and brooches: most of what they pay goes on silver and stones from the traders, the rest to the jeweller. */
function orders(c: Colony, day: number): void {
  const t = c.tech!;
  if (t.ord.length >= 6) return;
  const r = new Rand(c.seed, S.TECH, day, 3);
  const maker = c.pawns.find((p) => p.prof === 'jeweller' && !p.gone);
  let n = 0;
  for (const p of c.pawns) {
    if (n >= 2 || t.ord.length >= 6) break;
    if (p.gone || p.thrall || p.coin < 70 || stage(c, p) < STAGE.ADULT || t.ord.includes(p.id)) continue;
    const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
    const grand = home && (home.k === 'manor' || home.k === 'townhouse');
    if (!r.chance(grand ? 0.08 : 0.035)) continue;
    const price = Math.round(Math.min(45, 10 + (p.coin - 60) * 0.2));
    p.coin -= price;
    if (maker && maker !== p) maker.coin += price * 0.35;
    else c.stock.silver += price * 0.1;
    t.ord.push(p.id);
    bump(c, 'jewelSpent', price);
    n++;
  }
  void DAYS_PER_YEAR;
}
