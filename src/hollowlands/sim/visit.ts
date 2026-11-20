// Visitors: people who walk in off the road, stay a few days and go. A merchant with a mule and
// rare goods, a minstrel for the tavern and the festivals, pilgrims for the shrine, a refugee family
// hoping to be taken in, a wandering wizard, the king's tax collector with two guards and a banner,
// a bounty hunter asking after someone's past. They are not colonists: they eat at the tavern,
// sleep where they can, and are counted nowhere but here. One party at a time, every couple of
// weeks; never while there is fighting, and those already here shelter until it is over.

import { DAYS_PER_YEAR, HARD_CAP, SOFT_CAP, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR, dayOf, hourOf } from '../config';
import { cacheOf } from './cache';
import { HOMES, shapeOf, spots } from './data/buildings';
import { PLAYABLE, RACES, childRace } from './data/races';
import { foodDays, takeMeal } from './econ';
import { bump, log, note } from './events';
import { mainFaith } from './faith';
import { festivalToday } from './festivals';
import { wound } from './health';
import { depart } from './life';
import { marketOpen } from './market';
import { think } from './mood';
import { familyName, givenName } from './names';
import { findPath, walkTicks } from './path';
import { STAGE, has, makePawn, mkAct, normPawn, pawnById, per, stage } from './pawn';
import { Rand, S, hash32 } from './rng';
import { addFact, findFact, learn, opinion } from './social';
import { addLore, costOf, nextTech } from './tech';
import { AX, type Bld, type Colony, type Look, type Pawn, type RaceK, type Visitor } from './types';

const H = TICKS_PER_HOUR;
const D = TICKS_PER_DAY;

/** The kinds of party that come, in the order the colony panel lists them. */
export const VIS_KINDS = ['merchant', 'minstrel', 'pilgrim', 'refugee', 'wizard', 'taxman', 'hunter'] as const;

/** What each kind of visitor is called, and what they are here for (for cards and lists). */
export const VIS_INFO: Record<string, { name: string; why: string }> = {
  merchant: { name: 'Travelling merchant', why: 'Sells rare goods to the colony and trinkets to anyone with silver in their purse.' },
  minstrel: { name: 'Minstrel', why: 'Plays in the tavern of an evening, and at any festival that is on. People gather to listen.' },
  pilgrim: { name: 'Pilgrim', why: 'On the road to holy places. Prays at the shrine and talks faith with anyone who will listen.' },
  refugee: { name: 'Refugee', why: 'Fled from worse, and hopes to be taken in. The ruler will decide.' },
  wizard: { name: 'Wandering wizard', why: 'Old, strange and learned. Blesses, heals, foretells, and sets curious minds alight.' },
  taxman: { name: 'Tax collector', why: 'Sent by a distant king to collect what he says the colony owes. Pay, or refuse and see what comes.' },
  hunter: { name: 'Bounty hunter', why: 'Asking around after someone with a price on their head.' },
  guard: { name: 'King\'s guard', why: 'Walks behind the tax collector and says nothing.' },
  mule: { name: 'Pack mule', why: 'Carries the merchant\'s wares.' },
};

/** A few words a visitor says aloud, by key (shown over their heads). */
export const VIS_SAY: Record<string, string> = {
  wares: 'Fine wares!', silk: 'Silk from the south!', deal: 'A bargain, friend.', song: '♪ ♫ ♪', tune: '♫', bow: 'My thanks!', pray: 'Peace on this house.',
  alms: 'Bless you.', beg: 'Please, shelter...', thanks: 'Thank you!', sad: 'We will go on.', hello: 'Well met.', bless: '✧ Be blessed ✧', fortune: 'I see...',
  lights: '✧ Look up! ✧', demand: 'For the King!', paid: 'The King thanks you.', refused: 'You will regret this.', ask: 'Seen this face?', found: 'There you are.',
  gone: 'Cold trail.', ouch: 'Curse you!', paidoff: 'Keep them, then.', hide: 'Inside, quickly!',
};

// ---------- Names and faces ----------

const WIZ_FIRST = ['Aldric', 'Merrow', 'Ysolde', 'Tobin', 'Hesper', 'Orrin', 'Calloway', 'Morwen', 'Fennick', 'Ilsabet'];
const WIZ_EPI = ['the Grey', 'of the Seven Stars', 'Ashcloak', 'the Wanderer', 'Hollowstaff', 'the Unhurried', 'Owl-eyed', 'of the Long Road'];
const KINGS = ['King Aldwin of Vael', 'Queen Morra of the Saltmarch', 'King Haldor the Fat', 'the Iron King of Dunmere', 'King Osric the Pious', 'Queen Elsabet of the Hundred Towers'];
const ORIGINS = ['the southern cities', 'over the mountains', 'the salt coast', 'the river towns', 'the far east', 'the old capital'];
const WHENCE = ['a burned village in the east', 'the warlord\'s hosts', 'floods in the lowlands', 'a famine in the hills', 'a town taken by plague', 'a lord who hanged their kin', 'raiders who took everything'];
const INSTRUMENTS = ['lute', 'fiddle', 'pipes', 'harp', 'lute'];
/** Backstories that come with a price on someone's head, and what the bounty calls them. */
const WANTED_BACK: Record<string, string> = {
  deserter: 'deserter', smuggler: 'smuggler', bandit: 'bandit', escapedthrall: 'runaway thrall', poisoner: 'poisoner', graverobber: 'grave robber',
  sneakthief: 'thief', raider: 'raider', fence: 'fence', exilednoble: 'runaway heir',
};
const WANTED_SECRET: Record<string, string> = { deserter: 'deserter', killer: 'killer', thief: 'thief', bigamist: 'runaway spouse', noble: 'runaway heir' };
/** Rare things a merchant sells to the colony: what, and its price in silver. */
const RARE: { k: string; price: number }[] = [
  { k: 'silk', price: 24 }, { k: 'spice', price: 20 }, { k: 'seed', price: 18 }, { k: 'book', price: 30 }, { k: 'tools', price: 22 }, { k: 'relic', price: 36 },
];
/** Trinkets for an ordinary purse, and fine things for a fine house. */
export const TRINKETS = ['a copper ring', 'a carved comb', 'a ribbon of southern blue', 'a tin brooch', 'a little glass bead', 'a lucky charm', 'a painted cup', 'a whistle'];
export const FINERY = ['a silk hanging', 'a silver-framed mirror', 'a painted chest', 'a carpet from the east', 'a brass lamp', 'a set of fine glasses'];

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const bldOf = (c: Colony, k: string): Bld | undefined => c.blds.find((b) => b.k === k && b.built);

function mainRace(c: Colony): RaceK {
  const n: Record<string, number> = {};
  let best: RaceK = 'human';
  for (const p of c.pawns) {
    n[p.race] = (n[p.race] ?? 0) + 1;
    if (n[p.race] > (n[best] ?? 0)) best = p.race;
  }
  return PLAYABLE.includes(best) ? best : 'human';
}

function lookFor(r: Rand, race: RaceK, sex: 0 | 1, old: boolean, garb: number): Look {
  const beard = sex === 1 ? (race === 'dwarf' ? 1 + r.int(4) : race === 'elf' || race === 'goblin' ? 0 : r.int(5)) : 0;
  return { skin: r.int(6), hair: r.int(10), hairCol: old ? 7 : r.int(7), body: r.int(5), face: r.int(6), eyes: r.int(6), beard, marks: [], garb };
}

// ---------- Bookkeeping ----------

function vs(c: Colony): NonNullable<Colony['vis']> {
  return (c.vis ??= { l: [], n: 1, gone: dayOf(c.tick), seen: {}, nx: '', at: 0, wrath: 0, paid: 0, refused: 0 });
}

/** Fighting on the map, the alarm up, or a host camped outside. */
const trouble = (c: Colony): boolean => c.foes.length > 0 || !!c.alarm || (!!c.siege && c.siege.phase < 2);

/** The tile a visitor is on at tick t (part-way along the road if still walking). */
export function visTile(c: Colony, v: Visitor, t: number): number {
  const p = v.path;
  if (!p || p.length < 2 || t >= v.ta) return v.y * c.w + v.x;
  if (t <= v.t0) return p[0];
  return p[Math.min(p.length - 1, Math.floor(((t - v.t0) / (v.ta - v.t0)) * (p.length - 1)))];
}

/** Everyone in one visitor's party, the leader first. */
const partyOf = (c: Colony, v: Visitor): Visitor[] => (c.vis ? c.vis.l.filter((x) => x.g === v.g) : [v]);

/** The leader of each party here. */
export function guests(c: Colony): Visitor[] {
  return c.vis ? c.vis.l.filter((v) => v.g === v.id) : [];
}

const tag = (v: Visitor, x = ''): string => `${v.id}|${v.k}|${v.first} ${v.fam}|${v.f}|${x}`;
/** A line in the colony's chronicle about a visitor (the text is worked out from s, so it reads the same after they have gone). */
function vlog(c: Colony, v: Visitor, beat: string, a?: number, b?: number, x = '', n?: number): void {
  log(c, 'v_' + beat, a || undefined, b || undefined, tag(v, x), n);
}
/** A line in a colonist's own story about a visitor. */
function vnote(c: Colony, p: Pawn, v: Visitor, beat: string, o?: number, x = ''): void {
  note(c, p, 'v_' + beat, o || undefined, `${v.k}|${v.first} ${v.fam}|${x}`);
}

function say(c: Colony, v: Visitor, k: string): void {
  v.say = [k, c.tick];
}

// ---------- Walking ----------

const isOpen = (c: Colony, i: number): boolean => { const k = cacheOf(c); return !!k.walk[i] && !!k.reach[i]; };

/** An open tile near (x, y), out in the street. */
function openNear(c: Colony, x: number, y: number, rad: number, r: Rand): [number, number] | null {
  for (let k = 0; k < 14; k++) {
    const nx = x + r.range(-rad, rad);
    const ny = y + r.range(-rad, rad);
    if (nx < 1 || ny < 1 || nx >= c.w - 1 || ny >= c.h - 1) continue;
    const i = ny * c.w + nx;
    if (isOpen(c, i) && !c.sb[i]) return [nx, ny];
  }
  return null;
}

/** A floor tile inside a building (seat-like spots first). */
function inside(c: Colony, b: Bld, n: number, chars = 'c.'): [number, number] {
  let list = spots(shapeOf(b), chars[0]);
  if (!list.length) list = spots(shapeOf(b), '.');
  if (!list.length) return [b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2)];
  const cell = list[n % list.length];
  return [b.x + cell.dx, b.y + cell.dy];
}

/** Walk one visitor from where they are to (x, y). False when there is no way there. */
function walk(c: Colony, v: Visitor, x: number, y: number, adj: boolean): boolean {
  const here = visTile(c, v, c.tick);
  const sx = here % c.w;
  const sy = (here - sx) / c.w;
  const found = findPath(c, sx, sy, x, y, adj);
  if (!found) return false;
  const end = found.path[found.path.length - 1];
  v.x = end % c.w;
  v.y = (end - v.x) / c.w;
  v.t0 = c.tick;
  v.ta = c.tick + walkTicks(found.cost, v.k === 'mule' ? 0.75 : 0.7);
  if (found.path.length > 1) v.path = found.path;
  else delete v.path;
  return true;
}

const OFFS = [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1]];

/** The whole party walks to (x, y): the leader there, the rest close by. */
function go(c: Colony, v: Visitor, x: number, y: number): boolean {
  if (!walk(c, v, x, y, false) && !walk(c, v, x, y, true)) return false;
  let n = 0;
  for (const m of partyOf(c, v)) {
    if (m === v) continue;
    let ok = false;
    for (let k = 0; k < OFFS.length && !ok; k++) {
      const [dx, dy] = OFFS[(n + k) % OFFS.length];
      const tx = v.x + dx;
      const ty = v.y + dy;
      if (tx > 0 && ty > 0 && tx < c.w - 1 && ty < c.h - 1 && isOpen(c, ty * c.w + tx)) ok = walk(c, m, tx, ty, false);
    }
    if (!ok && !walk(c, m, v.x, v.y, true)) { m.x = v.x; m.y = v.y; m.t0 = v.t0; m.ta = v.ta; if (v.path) m.path = v.path.slice(); else delete m.path; }
    m.t1 = v.t1;
    n++;
  }
  return true;
}

/** Where the road leaves the map. */
const roadEnd = (c: Colony): [number, number] => [clamp(c.gx, 0, c.w - 1), clamp(c.gy, 1, c.h - 2)];

// ---------- Who comes ----------

/** Someone with a price on their head, if anyone here has one (and has not been hunted before). */
export function quarry(c: Colony, r: Rand): [Pawn, string] | null {
  const list: [Pawn, string][] = [];
  for (const p of c.pawns) {
    if (p.gone || stage(c, p) < STAGE.ADULT) continue;
    const w = (p.secret && WANTED_SECRET[p.secret]) || WANTED_BACK[p.ba];
    if (!w || p.bio.some((b) => b.k === 'v_hunted')) continue;
    list.push([p, w]);
  }
  return list.length ? r.pick(list) : null;
}

function festivalSoon(c: Colony, within: number): number {
  const doy = dayOf(c.tick) % DAYS_PER_YEAR;
  for (let d = 0; d <= within; d++) if (festivalToday((doy + d) % DAYS_PER_YEAR)) return d;
  return -1;
}

function pickKind(c: Colony, r: Rand, day: number): string {
  const V = vs(c);
  const pop = c.pawns.length;
  const silver = c.stock.silver;
  const since = (k: string): number => day - (V.seen[k] ?? 0);
  const holy = !!bldOf(c, 'shrine') || c.dead.some((d) => d.saint);
  const opts: [string, number][] = [
    ['merchant', 1.3],
    ['minstrel', festivalSoon(c, 2) >= 0 ? 5 : 1],
    ['pilgrim', holy ? 0.9 : 0.45],
    ['refugee', pop + 2 >= HARD_CAP ? 0 : pop < SOFT_CAP * 0.6 ? 1.3 : pop < SOFT_CAP ? 0.8 : 0.35],
    ['wizard', day >= 30 ? 0.55 : 0],
    // a full treasury draws the king's eye, but not more than about once a year
    ['taxman', silver >= 60 && since('taxman') >= 50 ? 0.6 + Math.min(2, silver / 300) : 0],
    ['hunter', day >= 30 && quarry(c, new Rand(c.seed, S.VISIT, day, 3)) ? 0.6 : 0],
  ];
  let total = 0;
  // a kind not seen for a season or more is likelier to turn up
  for (const o of opts) { o[1] *= Math.min(4, 1 + since(o[0]) / 45); total += o[1]; }
  if (total <= 0) return '';
  let roll = r.float() * total;
  for (const o of opts) { roll -= o[1]; if (roll <= 0 && o[1] > 0) return o[0]; }
  return '';
}

/** A party walks in off the road. */
function arrive(c: Colony, kind: string, r: Rand): void {
  const V = vs(c);
  const [sx, sy] = roadEnd(c);
  const day = dayOf(c.tick);
  const party: Visitor[] = [];
  const make = (k: string, race: RaceK, sex: 0 | 1, first: string, fam: string, years: number, garb: number): Visitor => {
    const R = RACES[race];
    const v: Visitor = {
      id: V.n++, k, g: 0, first, fam, race, sex, born: c.tick - Math.round(years * TICKS_PER_YEAR), look: lookFor(r, race, sex, years > R.old * 0.8, garb),
      x: sx, y: sy, t0: c.tick, ta: c.tick, t1: c.tick, arr: c.tick, dep: c.tick + 2 * D, m: 0, o: 0, n: 0, d: 0, b: 0, f: '',
    };
    v.g = party.length ? party[0].id : v.id;
    party.push(v);
    return v;
  };
  const someone = (k: string, race: RaceK, garb: number, old = 0.4): Visitor => {
    const sex: 0 | 1 = r.chance(0.5) ? 0 : 1;
    const R = RACES[race];
    return make(k, race, sex, givenName(r, race, sex), familyName(r, race), R.adult + (R.old - R.adult) * (old * 0.6 + r.float() * 0.5), garb);
  };
  const local = (): RaceK => (r.chance(0.5) ? mainRace(c) : r.pick(PLAYABLE));
  let lead: Visitor;
  switch (kind) {
    case 'merchant': {
      lead = someone('merchant', local(), r.pick([0, 5, 3]));
      lead.f = c.near?.length && r.chance(0.35) ? c.near[r.int(c.near.length)].name : r.pick(ORIGINS);
      lead.dep = c.tick + (2 + r.int(2)) * D;
      make('mule', 'human', 1, 'the mule', '', 5, 3);
      break;
    }
    case 'minstrel': {
      lead = someone('minstrel', local(), r.pick([1, 6, 2]), 0.1);
      lead.f = r.pick(INSTRUMENTS);
      const fest = festivalSoon(c, 2);
      lead.dep = fest >= 0 ? c.tick + (fest + 1) * D : c.tick + (2 + r.int(2)) * D;
      break;
    }
    case 'pilgrim': {
      const faith = r.chance(0.6) ? mainFaith(c) : r.pick(RACES[local()].faiths);
      lead = someone('pilgrim', local(), r.pick([3, 7]), 0.6);
      lead.f = faith;
      for (let k = r.int(3); k > 0; k--) { const m = someone('pilgrim', local(), r.pick([3, 7]), 0.5); m.f = faith; }
      lead.dep = c.tick + (2 + r.int(2)) * D;
      break;
    }
    case 'refugee': {
      const race = local();
      const fam = familyName(r, race);
      const whence = r.pick(WHENCE);
      const pa = makePawn(c, r, { race, sex: 1, fam });
      const lone = r.chance(0.25);
      const pb = lone ? undefined : makePawn(c, r, { race: r.chance(0.85) ? race : local(), sex: 0, fam });
      const adults = pb ? [pa, pb] : [pa];
      if (pb) {
        if (pa.orient === 2) pa.orient = 1;
        if (pb.orient === 2) pb.orient = 1;
        pa.sp = pb.id; pb.sp = pa.id;
        pa.rel[pb.id] = { m: [], k: 'spouse', s: c.tick - TICKS_PER_YEAR };
        pb.rel[pa.id] = { m: [], k: 'spouse', s: c.tick - TICKS_PER_YEAR };
      }
      const kids: Pawn[] = [];
      const kr = pb ? childRace(pb.race, pa.race) : pa.race;
      for (let k = r.int(pb ? 3 : 2); k > 0 && kr; k--) {
        const kid = makePawn(c, r, { race: kr, fam, mo: pb?.id ?? 0, fa: pa.id, age: 2 + r.float() * RACES[kr].adult * 0.7 });
        kid.faith = (pb ?? pa).faith;
        kids.push(kid);
      }
      for (const p of [...adults, ...kids]) {
        p.food = 25;
        const v = make('refugee', p.race, p.sex, p.first, p.fam, (c.tick - p.born) / TICKS_PER_YEAR, p.look.garb);
        v.look = { ...p.look, marks: p.look.marks.slice() };
        v.born = p.born;
        v.f = whence;
        v.pw = p;
      }
      lead = party[0];
      lead.dep = c.tick + 3 * D;
      break;
    }
    case 'wizard': {
      const race: RaceK = r.chance(0.45) ? 'elf' : r.chance(0.5) ? 'human' : r.pick(PLAYABLE);
      lead = make('wizard', race, r.chance(0.7) ? 1 : 0, r.pick(WIZ_FIRST), r.pick(WIZ_EPI), RACES[race].adult + (RACES[race].old - RACES[race].adult) * (0.75 + r.float() * 0.2), 4);
      lead.look.hairCol = 7;
      lead.look.beard = lead.sex === 1 && race !== 'elf' && race !== 'goblin' ? 4 : 0;
      lead.dep = c.tick + (2 + r.int(2)) * D;
      break;
    }
    case 'taxman': {
      lead = someone('taxman', r.chance(0.6) ? 'human' : local(), 7, 0.5);
      lead.f = KINGS[hash32(c.seed, S.VISIT, 77) % KINGS.length];
      // a quarter of the treasury, and something for every mouth
      lead.n = Math.round(clamp(c.stock.silver * 0.25 + c.pawns.length * 0.5, 20, 600));
      lead.dep = c.tick + 2 * D;
      for (let k = 0; k < 2; k++) someone('guard', r.chance(0.7) ? 'human' : local(), 0, 0.2);
      break;
    }
    case 'hunter': {
      const q = quarry(c, new Rand(c.seed, S.VISIT, day, 3));
      if (!q) return;
      lead = someone('hunter', local(), r.pick([7, 3]), 0.3);
      lead.o = q[0].id;
      lead.f = q[1];
      lead.n = 30 + r.int(40);
      lead.dep = c.tick + (2 + r.int(2)) * D;
      break;
    }
    default: return;
  }
  const dest = firstStop(c, lead, r);
  if (!dest) return;
  V.l.push(...party);
  lead.t1 = c.tick;
  if (!go(c, lead, dest[0], dest[1])) { V.l = V.l.filter((x) => x.g !== lead.g); return; }
  lead.t1 = lead.ta;
  for (const m of party) m.t1 = lead.t1;
  V.seen[kind] = day;
  bump(c, 'visitors');
  bump(c, 'vis_' + kind);
  arrivalBeat(c, lead, party, r);
}

/** Where a party heads first. */
function firstStop(c: Colony, v: Visitor, r: Rand): [number, number] | null {
  switch (v.k) {
    case 'pilgrim': return holyPlace(c, v, r);
    case 'refugee': { const hall = bldOf(c, 'hall'); return openNear(c, hall ? hall.x + (hall.w >> 1) : c.cx, hall ? hall.y + hall.h + 1 : c.cy, 2, r) ?? openNear(c, c.cx, c.cy, 4, r); }
    case 'taxman': return seatOfRule(c, v);
    case 'hunter': { const pub = bldOf(c, 'tavern'); return pub ? inside(c, pub, v.id) : openNear(c, c.cx, c.cy, 4, r); }
    default: return openNear(c, c.cx, c.cy, 3, r) ?? openNear(c, c.cx, c.cy, 6, r);
  }
}

/** The hall, or the keep's great hall once there is a keep. */
function seatOfRule(c: Colony, v: Visitor): [number, number] | null {
  const b = bldOf(c, 'keep') ?? bldOf(c, 'hall');
  return b ? inside(c, b, v.id, '.') : [c.cx, c.cy];
}

/** The shrine, a saint's grave, a wayside shrine, or failing all those the square. */
function holyPlace(c: Colony, v: Visitor, r: Rand): [number, number] | null {
  const saint = c.dead.find((d) => d.saint && d.grave >= 0);
  if (saint && (v.b & 2) === 0 && r.chance(0.6)) return [saint.grave % c.w, Math.floor(saint.grave / c.w)];
  const shrine = bldOf(c, 'shrine');
  if (shrine) return inside(c, shrine, v.id + r.int(4), 'p');
  return openNear(c, c.cx, c.cy, 4, r);
}

function lodging(c: Colony, v: Visitor): [number, number] | null {
  const b = bldOf(c, 'tavern') ?? bldOf(c, 'hall');
  return b ? inside(c, b, v.id * 3 + 1, '.') : null;
}

// ---------- The day's round ----------

/** Once a day: the king's anger, guests at table, and whether anyone is on the road. */
export function dailyVisitors(c: Colony): void {
  const day = dayOf(c.tick);
  const V = vs(c);
  // the first time round only takes note of the day: nobody is already on the road
  if (!c.stats.visSeen) { c.stats.visSeen = 1; V.gone = day; return; }
  const r = new Rand(c.seed, S.VISIT, day);
  if (V.wrath && day >= V.wrath && !trouble(c)) {
    // the king does not forget a refusal
    V.wrath = 0;
    const n = 3 + Math.floor(c.pawns.length / 18);
    c.inq.push({ t: c.tick + (8 + r.int(6)) * H + r.int(H), k: 'raid', kind: 'soldier', n, king: 1 });
  }
  // guests eat: those who can pay at the tavern, the refugees on the colony's charity
  for (const v of V.l) {
    if (v.k === 'mule' || v.m === 2) continue;
    const meal = takeMeal(c, true);
    if (meal && v.k !== 'refugee') c.stock.silver += 1;
  }
  if (V.nx || V.l.length || trouble(c) || c.pawns.length < 6) return;
  if (day - V.gone < 4 || !r.chance(0.13)) return;
  const k = pickKind(c, r, day);
  if (!k) return;
  V.nx = k;
  V.at = c.tick + (7 + r.int(8)) * H + r.int(H);
}

/** Every tick (while anyone is here or on the road): parties arrive, move on, and go. */
export function stepVisitors(c: Colony): void {
  const V = c.vis;
  if (!V) return;
  if (V.nx && c.tick >= V.at) {
    const k = V.nx;
    V.nx = '';
    V.at = 0;
    if (!trouble(c)) arrive(c, k, new Rand(c.seed, S.VISIT, c.tick, 1));
  }
  if (!V.l.length) return;
  let i = 0;
  while (i < V.l.length) {
    const v = V.l[i];
    i++;
    if (v.g !== v.id || c.tick < v.t1) continue;
    const n = V.l.length;
    decide(c, v);
    // a party that left the map (or joined the colony) is gone from the list: start over
    if (V.l.length !== n) i = 0;
  }
}

/** A party's leader makes up their mind what to do next. */
function decide(c: Colony, v: Visitor): void {
  const V = c.vis!;
  const r = new Rand(c.seed, S.VISIT, c.tick, v.id);
  const party = partyOf(c, v);
  const t = c.tick;
  if (v.m === 2) {
    if (t >= v.ta) {
      V.l = V.l.filter((x) => x.g !== v.g);
      V.gone = dayOf(t);
      goneBeat(c, v);
    } else v.t1 = v.ta;
    return;
  }
  if (v.m === 0) {
    if (t < v.ta) { v.t1 = v.ta; return; }
    v.m = 1;
  }
  const hour = hourOf(t);
  // fighting: under a roof until it is over, and on their way soon after
  if (trouble(c)) {
    const s = lodging(c, v);
    if ((v.b & 1024) === 0) { v.b |= 1024; say(c, v, 'hide'); vlog(c, v, 'shelter'); }
    if (s && (v.x !== s[0] || v.y !== s[1])) go(c, v, s[0], s[1]);
    v.dep = Math.max(v.dep, t + D / 2);
    setNext(c, v, party, 2 * H);
    return;
  }
  if (t >= v.dep) { leave(c, v, party); return; }
  if (beats(c, v, party, r, hour)) return;
  // night: a bed at the tavern, or a corner of the hall
  if (hour >= 22 || hour < 6) {
    const s = lodging(c, v);
    if (s && (v.x !== s[0] || v.y !== s[1])) go(c, v, s[0], s[1]);
    const toSix = ((30 - hour) % 24) * H - (t % H);
    setNext(c, v, party, Math.max(H, toSix));
    return;
  }
  const s = dayStop(c, v, r, hour);
  if (s && (Math.abs(v.x - s[0]) > 1 || Math.abs(v.y - s[1]) > 1)) go(c, v, s[0], s[1]);
  showSay(c, v, r, hour);
  setNext(c, v, party, (2 + r.int(2)) * H + r.int(H));
}

function setNext(c: Colony, v: Visitor, party: Visitor[], wait: number): void {
  v.t1 = Math.max(v.ta, c.tick) + wait;
  for (const m of party) m.t1 = v.t1;
}

/** Where a visitor spends this part of the day. */
function dayStop(c: Colony, v: Visitor, r: Rand, hour: number): [number, number] | null {
  const pub = bldOf(c, 'tavern') ?? bldOf(c, 'hall');
  const evening = hour >= 17;
  const fest = c.gath && c.gath.k === 'festival' && c.tick >= c.gath.t0 - 2 * H && c.tick < c.gath.t1 ? c.gath : undefined;
  switch (v.k) {
    case 'minstrel':
      if (fest) return openNear(c, fest.x, fest.y, 1, r) ?? [fest.x, fest.y];
      if (evening && pub) return inside(c, pub, v.id + 2, '.');
      return openNear(c, c.cx, c.cy, 3, r);
    case 'merchant': {
      if (evening && pub) return inside(c, pub, v.id, 'c');
      // on market day, in among the stalls
      return openNear(c, c.cx, c.cy, marketOpen(c) ? 4 : 2, r);
    }
    case 'pilgrim': return evening && pub ? inside(c, pub, v.id, 'c') : holyPlace(c, v, r);
    case 'wizard': {
      if (evening && pub) return inside(c, pub, v.id, 'c');
      const school = bldOf(c, 'school');
      if (school && r.chance(0.3)) return openNear(c, school.x + (school.w >> 1), school.y + school.h + 1, 2, r);
      return openNear(c, c.cx, c.cy, 5, r);
    }
    case 'refugee': { const hall = bldOf(c, 'hall'); return hall ? openNear(c, hall.x + (hall.w >> 1), hall.y + hall.h + 1, 2, r) : openNear(c, c.cx, c.cy, 3, r); }
    case 'taxman': return seatOfRule(c, v);
    case 'hunter': {
      if (pub && (evening || r.chance(0.4))) return inside(c, pub, v.id + r.int(5), 'c');
      return openNear(c, c.cx, c.cy, 6, r);
    }
    default: return null;
  }
}

/** Now and then they call out (the view shows it over their head for a while). */
function showSay(c: Colony, v: Visitor, r: Rand, hour: number): void {
  if (!r.chance(0.5)) return;
  switch (v.k) {
    case 'merchant': say(c, v, r.pick(['wares', 'silk', 'deal'])); break;
    case 'minstrel': say(c, v, 'tune'); break;
    case 'pilgrim': say(c, v, 'pray'); break;
    case 'refugee': say(c, v, 'beg'); break;
    case 'wizard': say(c, v, hour >= 18 ? 'fortune' : 'hello'); break;
    case 'hunter': say(c, v, 'ask'); break;
    default: break;
  }
}

function leave(c: Colony, v: Visitor, party: Visitor[]): void {
  const [ex, ey] = roadEnd(c);
  v.m = 2;
  for (const m of party) m.m = 2;
  if (!go(c, v, ex, ey)) {
    // no way out on foot (a wall going up across the road): they are gone all the same
    c.vis!.l = c.vis!.l.filter((x) => x.g !== v.g);
    c.vis!.gone = dayOf(c.tick);
    goneBeat(c, v);
    return;
  }
  setNext(c, v, party, 0);
}

// ---------- What each kind does ----------

const ruler = (c: Colony): Pawn | undefined => pawnById(c, c.gov.regent || c.gov.ruler);

/** The first things said on arriving. */
function arrivalBeat(c: Colony, v: Visitor, party: Visitor[], r: Rand): void {
  switch (v.k) {
    case 'merchant': vlog(c, v, 'come'); say(c, v, 'wares'); break;
    case 'minstrel': vlog(c, v, 'come', undefined, undefined, festivalSoon(c, 2) >= 0 ? 'fest' : ''); say(c, v, 'tune'); break;
    case 'pilgrim': vlog(c, v, 'come', undefined, undefined, '', party.length); say(c, v, 'pray'); break;
    case 'refugee': vlog(c, v, 'come', undefined, undefined, '', party.length); say(c, v, 'beg'); break;
    case 'wizard': vlog(c, v, 'come'); say(c, v, 'hello'); break;
    case 'taxman': vlog(c, v, 'come', ruler(c)?.id, undefined, '', v.n); say(c, v, 'demand'); break;
    case 'hunter': {
      const q = pawnById(c, v.o);
      vlog(c, v, 'come', q?.id);
      say(c, v, 'ask');
      if (q) {
        think(c, q, 'hunted');
        note(c, q, 'v_hunted', undefined, `${v.k}|${v.first} ${v.fam}|${v.f}`);
      }
      break;
    }
    default: break;
  }
  void r;
}

/** The turning points of a visit, kind by kind. True when the visitor has already moved on this turn. */
function beats(c: Colony, v: Visitor, party: Visitor[], r: Rand, hour: number): boolean {
  const day = dayOf(c.tick) - dayOf(v.arr);
  switch (v.k) {
    case 'merchant': {
      if ((v.b & 1) === 0 && hour >= 9 && hour < 17) { v.b |= 1; rareSale(c, v, r); }
      if ((v.b & 2) === 0 && marketOpen(c)) { v.b |= 2; vlog(c, v, 'fair'); say(c, v, 'silk'); }
      return false;
    }
    case 'minstrel': {
      const fest = c.gath && c.gath.k === 'festival' && c.tick >= c.gath.t0 - 2 * H && c.tick < c.gath.t1;
      if (fest && (v.b & 4) === 0) { v.b |= 4; vlog(c, v, 'festival', undefined, undefined, c.gath!.f ?? ''); say(c, v, 'song'); }
      // after the evening in the tavern: how many came to listen
      if (hour >= 22 && v.d > 0) { vlog(c, v, 'played', undefined, undefined, '', v.d); v.n += v.d; v.d = 0; }
      if ((v.b & 1) === 0 && day >= 1 && hour >= 18) { v.b |= 1; song(c, v); }
      if (hour >= 17 && hour < 22) say(c, v, 'song');
      return false;
    }
    case 'pilgrim': {
      if ((v.b & 1) === 0 && hour >= 9 && hour < 18 && c.tick >= v.ta) {
        v.b |= 1;
        const saint = c.dead.find((d) => d.saint && d.grave >= 0 && Math.abs((d.grave % c.w) - v.x) <= 1 && Math.abs(Math.floor(d.grave / c.w) - v.y) <= 1);
        const gift = 2 + r.int(5) + party.length;
        c.stock.silver += gift;
        if (saint) {
          v.b |= 2;
          vlog(c, v, 'saint', saint.id, undefined, '', gift);
          for (const p of c.pawns) if (p.faith === v.f && p.dev >= 1 && stage(c, p) >= STAGE.TEEN) think(c, p, 'pilgrimsaint');
        } else vlog(c, v, 'offering', undefined, undefined, '', gift);
        say(c, v, 'pray');
      }
      return false;
    }
    case 'refugee': {
      if ((v.b & 1) === 0 && day >= 1 && hour >= 11) { v.b |= 1; return refugeeFate(c, v, party, r); }
      return false;
    }
    case 'wizard': {
      if ((v.b & 1) === 0 && hour >= 19 && hour < 22) { v.b |= 1; wonder(c, v, r, 0); }
      else if ((v.b & 2) === 0 && day >= 1 && hour >= 10 && hour < 16) { v.b |= 2; wonder(c, v, r, 1); }
      return false;
    }
    case 'taxman': {
      // the ruler hears him out in the hall a few hours after he comes
      if ((v.b & 1) === 0 && c.tick >= v.ta + 2 * H && hour >= 8 && hour < 20) { v.b |= 1; taxFate(c, v, r); v.dep = Math.min(v.dep, c.tick + 3 * H); }
      return false;
    }
    case 'hunter': {
      if ((v.b & 1) === 0 && c.tick >= v.arr + 30 * H && hour >= 9 && hour < 21) {
        v.b |= 1;
        hunt(c, v, r);
        v.dep = Math.min(v.dep, c.tick + 2 * H);
      }
      return false;
    }
    default: return false;
  }
}

/** The merchant sells the colony something it cannot make. */
function rareSale(c: Colony, v: Visitor, r: Rand): void {
  const can = RARE.filter((x) => c.stock.silver >= x.price + 20);
  if (!can.length) { vlog(c, v, 'nosale'); return; }
  const it = r.pick(can);
  c.stock.silver -= it.price;
  v.n += it.price;
  switch (it.k) {
    case 'silk': c.stock.cloth += 8; break;
    case 'spice': for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'spiced'); break;
    case 'seed': for (const b of c.blds) if (b.k === 'field') b.tend = Math.min(100, (b.tend ?? 0) + 25); break;
    case 'book': if (c.tech) addLore(c, 12); break;
    case 'tools': c.stock.tools += 5; break;
    case 'relic': for (const p of c.pawns) if (p.dev >= 2) think(c, p, 'relic'); break;
    default: break;
  }
  say(c, v, 'deal');
  vlog(c, v, 'rare', undefined, undefined, it.k, it.price);
}

/** Who the minstrel's new song is about: the colony's hero, its ruler, or the town itself. */
const FAME: Record<string, number> = { slew: 3, rescued_someone: 4, contest: 2, masterwork: 2, discovery: 3, dream: 1, firstbuilt: 1, master: 2, hero: 3 };

function song(c: Colony, v: Visitor): void {
  let best: Pawn | undefined;
  let bs = 0;
  let what = '';
  for (const p of c.pawns) {
    if (stage(c, p) < STAGE.TEEN || p.bio.some((b) => b.k === 'v_song')) continue;
    let s = 0;
    let last = '';
    for (const b of p.bio) { const f = FAME[b.k]; if (f) { s += f; last = b.k; } }
    if (s > bs) { bs = s; best = p; what = last; }
  }
  if (!best) { best = ruler(c); what = 'ruler'; }
  if (!best) { vlog(c, v, 'song', undefined, undefined, 'town'); return; }
  vlog(c, v, 'song', best.id, undefined, what);
  vnote(c, best, v, 'song', undefined, what);
  think(c, best, 'songaboutme');
  say(c, v, 'song');
}

/** The refugees learn whether they may stay. True: they have gone (into the colony, or back to the road). */
function refugeeFate(c: Colony, v: Visitor, party: Visitor[], r: Rand): boolean {
  const pop = c.pawns.length;
  const n = party.length;
  const lord = ruler(c);
  let free = 0;
  for (const b of c.blds) if (b.built && HOMES.includes(b.k)) for (const id of b.beds) if (!id) free++;
  const head = v.pw!;
  let s = 0.62 + (lord ? per(lord, AX.KIND) * 0.25 : 0) - (pop >= SOFT_CAP ? 0.35 : 0) - (free < n ? 0.12 : 0) - (foodDays(c) < 8 ? 0.3 : 0) + (pop < SOFT_CAP * 0.6 ? 0.2 : 0);
  if (lord && has(lord, 'bigot') && lord.race !== head.race) s -= 0.45;
  const room = pop + n <= HARD_CAP - 1;
  if (room && r.chance(clamp(s, 0.05, 0.95))) {
    takeIn(c, v, party, r);
    return true;
  }
  vlog(c, v, 'turnedaway', lord?.id, undefined, room ? '' : 'full', n);
  for (const p of c.pawns) {
    if (stage(c, p) < STAGE.ADULT || per(p, AX.KIND) <= 0.5) continue;
    think(c, p, 'turnedaway');
    if (lord && p !== lord && room) think(c, p, 'turnedthemaway', lord.id);
  }
  say(c, v, 'sad');
  leave(c, v, party);
  return true;
}

/** The family becomes part of the colony, where they stand. */
function takeIn(c: Colony, v: Visitor, party: Visitor[], r: Rand): void {
  const lord = ruler(c);
  const joined: Pawn[] = [];
  for (const m of party) {
    if (!m.pw) continue;
    const p = normPawn(m.pw);
    const ti = visTile(c, m, c.tick);
    p.x = ti % c.w;
    p.y = (ti - p.x) / c.w;
    p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
    c.pawns.push(p);
    joined.push(p);
  }
  c.vis!.l = c.vis!.l.filter((x) => x.g !== v.g);
  c.vis!.gone = dayOf(c.tick);
  const a = joined[0];
  const b = joined.find((p) => p.id === a.sp);
  for (const p of joined) {
    think(c, p, 'arrived');
    think(c, p, 'takenin');
    note(c, p, 'v_takenin', lord?.id, `${v.k}|${v.first} ${v.fam}|${v.f}`);
    for (const o of c.pawns) {
      if (o === p || joined.includes(o) || stage(c, o) < STAGE.ADULT) continue;
      if (per(o, AX.KIND) > 0.8 || has(o, 'gregarious')) think(c, p, 'welcomed', o.id);
      else if (has(o, 'bigot') && o.race !== p.race) { think(c, p, 'unwelcome', o.id); think(c, o, 'newcomer', p.id); }
    }
  }
  if (lord && !joined.includes(lord)) for (const p of joined) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'shelteredby', lord.id);
  // the road was hard on one of them
  if (r.chance(0.35)) wound(c, r.pick(joined.filter((p) => stage(c, p) >= STAGE.ADULT)), 'cut', 8 + r.int(12), r);
  vlog(c, v, 'takenin', a.id, b?.id, '', joined.length);
  bump(c, 'joined', joined.length);
  bump(c, 'refugeesIn', joined.length);
}

/** One of the wizard's wonders: blessing, healing, lights in the sky, old knowledge, a fortune. */
function wonder(c: Colony, v: Visitor, r: Rand, n: number): void {
  const sick = c.pawns.filter((p) => p.ill || p.inj.some((i) => i.sev >= 25));
  const babes = c.pawns.filter((p) => stage(c, p) === STAGE.BABY && !p.bio.some((b) => b.k === 'v_blessed'));
  const fields = c.blds.filter((b) => b.k === 'field' && b.built);
  const next = c.tech ? nextTech(c) : undefined;
  const opts: [string, number][] = [
    ['heal', sick.length ? 3 : 0],
    ['babe', babes.length ? 2 : 0],
    ['fields', fields.length && hourOf(c.tick) < 18 ? 1.5 : 0],
    ['lights', n === 0 ? 2 : 0.3],
    ['lore', next ? 1.6 : 0],
    ['fortune', 1.2],
  ];
  let total = 0;
  for (const o of opts) if ((v.d & (1 << opts.indexOf(o))) === 0) total += o[1];
  let roll = r.float() * total;
  let k = 'fortune';
  for (let i = 0; i < opts.length; i++) {
    if (v.d & (1 << i)) continue;
    roll -= opts[i][1];
    if (roll <= 0 && opts[i][1] > 0) { k = opts[i][0]; v.d |= 1 << i; break; }
  }
  say(c, v, k === 'lights' ? 'lights' : k === 'fortune' ? 'fortune' : 'bless');
  switch (k) {
    case 'heal': {
      const p = sick.sort((a, b) => (b.ill ? b.ill.sev : 0) + b.inj.reduce((s, i) => s + i.sev, 0) - (a.ill ? a.ill.sev : 0) - a.inj.reduce((s, i) => s + i.sev, 0) || a.id - b.id)[0];
      if (p.ill) p.ill.imm = 100;
      for (const i of p.inj) { i.sev *= 0.4; i.bleed = 0; i.inf = 0; }
      think(c, p, 'wizardhealed');
      vnote(c, p, v, 'healed');
      vlog(c, v, 'healed', p.id);
      break;
    }
    case 'babe': {
      const p = r.pick(babes);
      if (!has(p, 'lucky') && !has(p, 'jinxed')) p.traits = [...p.traits, 'lucky'];
      vnote(c, p, v, 'blessed');
      for (const o of c.pawns) if (o.id === p.mo || o.id === p.fa) think(c, o, 'wizardblessed');
      vlog(c, v, 'blessed', p.id);
      break;
    }
    case 'fields': {
      for (const b of fields) b.tend = Math.min(100, (b.tend ?? 0) + 40);
      for (const p of c.pawns) if (p.prof === 'farmer') think(c, p, 'wizardblessed');
      vlog(c, v, 'fields');
      break;
    }
    case 'lights': {
      for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'wizardlights');
      vlog(c, v, 'lights');
      break;
    }
    case 'lore': {
      const d = next!;
      addLore(c, Math.round(costOf(c, d) * 0.3));
      // the most curious of the colony sit up half the night with him
      const keen = c.pawns.filter((p) => stage(c, p) >= STAGE.ADULT).sort((a, b) => b.sk[11] + per(b, AX.CURIOUS) * 4 - (a.sk[11] + per(a, AX.CURIOUS) * 4) || a.id - b.id)[0];
      if (keen) {
        if (!keen.insp) keen.insp = ['insight', c.tick + 2 * D];
        vnote(c, keen, v, 'lore', undefined, d.k);
        think(c, keen, 'wizardtalk');
      }
      vlog(c, v, 'lore', keen?.id, undefined, d.k);
      break;
    }
    default: {
      const young = c.pawns.filter((p) => stage(c, p) >= STAGE.TEEN && !p.bio.some((b) => b.k === 'v_fortune'));
      if (!young.length) { vlog(c, v, 'lights'); break; }
      const p = r.pick(young);
      const good = r.chance(has(p, 'lucky') ? 0.8 : has(p, 'jinxed') ? 0.3 : 0.6);
      think(c, p, good ? 'goodfortune' : 'badfortune');
      vnote(c, p, v, 'fortune', undefined, good ? 'good' : 'bad');
      vlog(c, v, 'fortune', p.id, undefined, good ? 'good' : 'bad');
      break;
    }
  }
}

/** The ruler pays the king's man, or sends him off empty-handed. */
function taxFate(c: Colony, v: Visitor, r: Rand): void {
  const V = c.vis!;
  const lord = ruler(c);
  const silver = c.stock.silver;
  const due = v.n;
  let fighters = 0;
  for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT && !has(p, 'pacifist')) fighters++;
  let no = 0.18 + (silver < due ? 0.3 : 0) + (c.walls && c.walls.done >= 1 ? 0.12 : 0) + ((c.castle?.stage ?? 0) >= 2 ? 0.1 : 0) + (fighters >= 30 ? 0.08 : 0) - V.refused * 0.08 + V.paid * 0.04;
  if (lord) no += per(lord, AX.BRAVE) * 0.12 + per(lord, AX.AMBITION) * 0.12 + per(lord, AX.GREED) * 0.12;
  if (r.chance(clamp(no, 0.06, 0.85))) {
    V.refused++;
    v.b |= 4;
    say(c, v, 'refused');
    // the king hears of it: his soldiers come in a month or so, or he sets the neighbours against us
    const near = c.near?.length ? c.near[0] : undefined;
    if (near && r.chance(0.4)) {
      const g = (c.grudge ??= {});
      g[near.id] = (g[near.id] ?? 0) + 25;
      vlog(c, v, 'refused', lord?.id, undefined, 'feud:' + near.name, due);
    } else {
      V.wrath = dayOf(c.tick) + 20 + r.int(20);
      vlog(c, v, 'refused', lord?.id, undefined, 'soldiers', due);
    }
    if (lord) note(c, lord, 'v_tax_no', undefined, `${v.k}|${v.first} ${v.fam}|${v.f}`);
    for (const p of c.pawns) {
      if (stage(c, p) < STAGE.ADULT) continue;
      if (per(p, AX.BRAVE) > 0.2 || per(p, AX.AMBITION) > 0.5) think(c, p, 'defiedking');
      else if (per(p, AX.BRAVE) < -0.2) think(c, p, 'kingwrath');
    }
    return;
  }
  V.paid++;
  const pay = Math.min(due, Math.floor(silver));
  c.stock.silver -= pay;
  // what silver will not cover, he takes in goods
  const short = due - pay;
  if (short > 0) c.stock.goods = Math.max(0, c.stock.goods - short);
  v.n = pay;
  say(c, v, 'paid');
  vlog(c, v, 'paid', lord?.id, undefined, short > 0 ? 'short' : '', pay);
  if (lord) note(c, lord, 'v_tax_paid', undefined, `${v.k}|${v.first} ${v.fam}|${v.f}`);
  for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT && (per(p, AX.GREED) > 0.3 || per(p, AX.AMBITION) > 0.6)) think(c, p, 'kingtax');
  bump(c, 'taxPaid', pay);
}

/** The bounty hunter finds the one he came for, or does not; and what the colony does about it. */
function hunt(c: Colony, v: Visitor, r: Rand): void {
  const q = pawnById(c, v.o);
  if (!q || q.gone) { vlog(c, v, 'lost'); say(c, v, 'gone'); return; }
  let friends = 0;
  for (const o of c.pawns) if (o !== q && o.rel[q.id]?.f === 1) friends++;
  const found = 0.45 + v.d * 0.15 - Math.min(0.3, friends * 0.06) - (q.owner ? 0.15 : 0);
  if (!r.chance(clamp(found, 0.1, 0.9))) {
    think(c, q, 'hunterwent');
    note(c, q, 'v_hidden', undefined, `${v.k}|${v.first} ${v.fam}|${v.f}`);
    vlog(c, v, 'miss', q.id);
    say(c, v, 'gone');
    return;
  }
  // everyone learns what they were
  say(c, v, 'found');
  const fact = findFact(c, 'secret', q.id) ?? addFact(c, 'secret', q.id, undefined, true, q.secret ?? v.f);
  if (!q.know.includes(fact.id)) q.know.push(fact.id);
  let told = 0;
  for (const o of r.shuffle(c.pawns)) { if (told >= 10) break; if (o !== q && stage(c, o) >= STAGE.TEEN) { learn(c, o, fact); told++; } }
  think(c, q, 'exposed');
  note(c, q, 'v_exposed', undefined, `${v.k}|${v.first} ${v.fam}|${v.f}`);
  const lord = ruler(c);
  const kin = (a: Pawn, b: Pawn): boolean => a.sp === b.id || a.mo === b.id || a.fa === b.id || b.mo === a.id || b.fa === a.id;
  const shield = !!lord && (lord === q || kin(lord, q) || opinion(c, lord, q) > 25 || q.rank >= 5);
  // the colony buys them free
  if ((shield || q.owner) && c.stock.silver >= v.n) {
    c.stock.silver -= v.n;
    say(c, v, 'paidoff');
    vlog(c, v, 'bought', q.id, lord?.id, '', v.n);
    if (lord && lord !== q) think(c, q, 'savedfromhunter', lord.id);
    return;
  }
  const brave = per(q, AX.BRAVE) > 0.4 || q.sk[0] >= 8 || has(q, 'brawler');
  if (brave || q.owner) {
    // a fight in the street
    const win = q.sk[0] + r.float() * 10 > 7 + r.float() * 10;
    if (win) {
      think(c, q, 'slewfoe');
      vnote(c, q, v, 'beathunter');
      vlog(c, v, 'beaten', q.id);
      say(c, v, 'ouch');
      return;
    }
    wound(c, q, 'cut', 18 + r.int(16), r);
    if (q.owner) { vlog(c, v, 'wounded', q.id); return; }
  } else if (per(q, AX.BRAVE) < 0 || r.chance(0.4)) {
    vlog(c, v, 'fled', q.id);
    depart(c, q, 'fled_hunter');
    return;
  }
  vlog(c, v, 'taken', q.id, undefined, '', v.n);
  for (const o of c.pawns) if (o !== q && (kin(o, q) || o.rel[q.id]?.f === 1)) think(c, o, 'takenbyhunter', q.id);
  depart(c, q, 'bounty');
}

/** A party leaves: a line for the chronicle on how it went. */
function goneBeat(c: Colony, v: Visitor): void {
  switch (v.k) {
    case 'merchant': vlog(c, v, 'gone', undefined, undefined, '', v.d); if (v.d) bump(c, 'trinkets', v.d); break;
    case 'minstrel': case 'wizard': case 'pilgrim': vlog(c, v, 'gone', undefined, undefined, '', v.n); break;
    default: break;
  }
}

// ---------- Colonists going to see them ----------

/** A visitor worth going to see right now, and how much this colonist wants to. */
export function guestCall(c: Colony, p: Pawn, st: number, hour: number): [Visitor, number] | null {
  const V = c.vis;
  if (!V || !V.l.length) return null;
  for (const v of V.l) {
    if (v.g !== v.id || v.m !== 1 || c.tick < v.ta) continue;
    let w = 0;
    switch (v.k) {
      case 'minstrel': {
        const fest = c.gath?.k === 'festival';
        if (st >= STAGE.CHILD && ((hour >= 17 && hour < 23) || fest)) w = 2.6 + per(p, AX.SOCIABLE) * 0.5;
        else if (st >= STAGE.CHILD && hour >= 10) w = 0.5;
        break;
      }
      case 'merchant': if (st >= STAGE.ADULT && hour >= 8 && hour < 19 && p.coin >= 6) w = 0.9 + (p.coin >= 40 ? 0.8 : 0) + (marketOpen(c) ? 0.6 : 0); break;
      case 'wizard': if (st >= STAGE.CHILD && hour >= 9 && hour < 22) w = 0.8 + Math.max(0, per(p, AX.CURIOUS)) + (st === STAGE.CHILD ? 1 : 0); break;
      case 'pilgrim': if (st >= STAGE.TEEN && hour >= 7 && hour < 20) w = p.dev * 0.5 + (has(p, 'pious') ? 1 : 0); break;
      case 'refugee': if (st >= STAGE.ADULT && hour >= 7 && hour < 20 && per(p, AX.KIND) > 0.2) w = 0.4 + per(p, AX.KIND) * 0.6; break;
      case 'hunter': if (st >= STAGE.ADULT && p.id !== v.o && hour >= 8 && hour < 22 && per(p, AX.GOSSIP) > 0.4) w = 0.6; break;
      default: break;
    }
    if (w > 0) return [v, w];
  }
  return null;
}

/** A spot in the little crowd round a visitor. */
export function guestSpot(c: Colony, v: Visitor, r: Rand): [number, number] | null {
  for (let k = 0; k < 8; k++) {
    const x = v.x + r.range(-2, 2);
    const y = v.y + r.range(-2, 2);
    if ((x === v.x && y === v.y) || x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) continue;
    if (isOpen(c, y * c.w + x)) return [x, y];
  }
  return null;
}

/** A colonist has spent a while with a visitor: what came of it. */
export function metGuest(c: Colony, p: Pawn, id: number, r: Rand): void {
  const v = c.vis?.l.find((x) => x.id === id);
  if (!v || v.m === 2) return;
  const st = stage(c, p);
  switch (v.k) {
    case 'minstrel': {
      think(c, p, 'minstrelsong');
      p.joy = Math.min(100, p.joy + 15);
      v.d++;
      if (st >= STAGE.ADULT && p.coin >= 3 && r.chance(0.4)) { p.coin -= 1; v.n += 1; }
      break;
    }
    case 'merchant': {
      if (p.coin < 6) break;
      const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
      const fine = p.coin >= 60 && (home?.k === 'manor' || home?.k === 'townhouse' || p.rank >= 4);
      if (fine && home && r.chance(0.6)) {
        const price = Math.min(p.coin - 10, 25 + r.int(21));
        const it = r.pick(FINERY);
        p.coin -= price;
        v.n += price;
        v.d++;
        home.q = Math.min(100, home.q + 6);
        think(c, p, 'trinket');
        vnote(c, p, v, 'finery', undefined, it);
        if (r.chance(0.5)) vlog(c, v, 'finery', p.id, undefined, it, price);
        break;
      }
      if (!r.chance(0.55)) break;
      const price = Math.min(p.coin - 2, 3 + r.int(8));
      const it = r.pick(TRINKETS);
      p.coin -= price;
      v.n += price;
      v.d++;
      const love = p.sp ? pawnById(c, p.sp) : undefined;
      if (love && r.chance(0.35)) {
        think(c, love, 'trinketgift', p.id);
        vnote(c, p, v, 'gift', love.id, it);
      } else {
        think(c, p, 'trinket');
        vnote(c, p, v, 'trinket', undefined, it);
      }
      break;
    }
    case 'wizard': {
      think(c, p, 'wizardtalk');
      if (st >= STAGE.TEEN) { addLore(c, 0.3 + Math.max(0, per(p, AX.CURIOUS)) * 0.3); p.sk[11] = Math.min(18, p.sk[11] + 0.05); }
      if (st >= STAGE.ADULT && !p.insp && per(p, AX.CURIOUS) > 0.3 && r.chance(0.15)) {
        p.insp = ['insight', c.tick + 2 * D];
        vnote(c, p, v, 'inspired');
      }
      break;
    }
    case 'pilgrim': {
      if (p.faith === v.f) {
        think(c, p, 'pilgrimtalk');
        if (p.dev < 3 && r.chance(0.12)) { p.dev++; vnote(c, p, v, 'devout'); }
      } else if (p.dev >= 3) think(c, p, 'heathens');
      else if (p.dev === 0 && r.chance(0.08)) {
        p.faith = v.f;
        p.dev = 1;
        vnote(c, p, v, 'converted', undefined, v.f);
        vlog(c, v, 'converted', p.id);
      } else think(c, p, 'pilgrimtalk');
      break;
    }
    case 'refugee': {
      if (takeMeal(c, true)) think(c, p, 'helpedrefugees');
      break;
    }
    case 'hunter': {
      const q = pawnById(c, v.o);
      if (!q || q.gone) break;
      // a rival, or someone who knows, points the way
      const knows = q.secret && p.know.some((f) => c.facts.some((x) => x.id === f && x.k === 'secret' && x.a === q.id));
      if (opinion(c, p, q) < -10 || (knows && per(p, AX.HONEST) > 0.5)) {
        v.d++;
        vnote(c, p, v, 'told', q.id);
        think(c, q, 'betrayedtohunter', p.id);
        vlog(c, v, 'told', p.id, q.id);
      }
      break;
    }
    default: break;
  }
}

/** Everyone in the party led by this id. */
export function partyOfId(c: Colony, g: number): Visitor[] {
  return c.vis ? c.vis.l.filter((v) => v.g === g) : [];
}

/** The visitor (or party leader) with this id, if they are still here. */
export function visitorById(c: Colony, id: number): Visitor | undefined {
  return c.vis?.l.find((v) => v.id === id);
}
