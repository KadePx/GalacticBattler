// The market. Once a week, in a town big enough to want one, the trades set out stalls in the
// market square: the baker's bread, the butcher's meat, the weaver's cloth, the potter's pots, the
// smith's tools, ale, greens, fish, eggs and herbs. People come in from their work with their own
// silver and buy, the well-off buying the best of what is on the table; the stallholders take the
// silver home, less the market toll, which goes to the colony's treasury. Prices follow what is in
// the stores: bread is dear when the larder is low, ale cheap when the cellar is full. Carters come
// in on market day too, and the treasury buys stone and timber off them in bulk for the walls, the
// castle and the town's building. On other days the masters of the trades sell from their shops.
//
// Wages are paid here too: a trade's wage depends on the trade and on how good its holder is at it,
// so a master smith earns several times what a ratcatcher does.

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../config';
import { cacheOf } from './cache';
import { castleStone } from './castle';
import { bump, log } from './events';
import { isDown, needsRest } from './health';
import { think } from './mood';
import { STAGE, has, pawnById, per, stage } from './pawn';
import { Rand, S, hash32 } from './rng';
import { frame } from './town';
import { wallStone } from './walls';
import { AX, type Colony, type Pawn, type ResK } from './types';

/** What a stall sells: the trades that keep it, the skill that makes them good at it, the stores it sells from. */
export interface WareDef {
  k: string;
  /** the trades that keep this stall, first choice first */
  profs: string[];
  skill: number;
  res: ResK[];
  /** price of one in silver, when the stores hold just what the town wants */
  base: number;
  /** what the town wants in store, per head */
  per: number;
  /** never sold below this much per head: the colony's own need comes first */
  keep: number;
  /** the shop it is sold from on other days ('' for none) */
  shop: string;
}

export const WARES: WareDef[] = [
  { k: 'bread', profs: ['baker', 'cook', 'quartermaster'], skill: 5, res: ['meal'], base: 0.5, per: 2, keep: 0.3, shop: 'kitchen' },
  { k: 'meat', profs: ['butcher', 'hunter'], skill: 5, res: ['meat'], base: 0.7, per: 1, keep: 0, shop: '' },
  { k: 'cloth', profs: ['weaver'], skill: 6, res: ['clothes', 'cloth'], base: 2.2, per: 0.3, keep: 0, shop: 'workshop' },
  { k: 'pots', profs: ['potter', 'carpenter'], skill: 6, res: ['goods'], base: 1.4, per: 0.4, keep: 0, shop: 'workshop' },
  { k: 'tools', profs: ['smith'], skill: 7, res: ['tools'], base: 3, per: 0.4, keep: 0.2, shop: 'smithy' },
  { k: 'ale', profs: ['brewer', 'tavernkeeper'], skill: 5, res: ['ale'], base: 0.4, per: 1.5, keep: 0.6, shop: 'brewery' },
  { k: 'greens', profs: ['farmer'], skill: 4, res: ['veg'], base: 0.3, per: 6, keep: 2, shop: '' },
  { k: 'fish', profs: ['fisher'], skill: 9, res: ['fish'], base: 0.4, per: 1, keep: 0, shop: '' },
  { k: 'dairy', profs: ['herder'], skill: 9, res: ['eggs', 'milk'], base: 0.4, per: 0.8, keep: 0, shop: '' },
  { k: 'herbs', profs: ['herbalist'], skill: 8, res: ['herbs'], base: 1, per: 0.2, keep: 0.05, shop: 'herbalist' },
];
const FOOD = new Set(['bread', 'meat', 'greens', 'fish', 'dairy']);

/** A town holds a market once it has this many people. */
export const MARKET_POP = 18;
/** Market hours. */
export const OPEN_H = 8;
export const CLOSE_H = 15;
/** Share of each sale that goes to the treasury. */
const TOLL = 0.1;
/** How much more the best of a stall costs than the plain: plain, good, fine, the finest. */
const GRADE = [1, 1.8, 3, 5];

/** The colony's market state, made blank. */
export function blankMarket(): NonNullable<Colony['mkt']> {
  return { t0: 0, t1: 0, n: 0, st: [], went: [], carts: [], coin: 0, sale: 0, pr: [] };
}

// ---------- Wages ----------

/** A day's wage for each trade before skill: the learned trades pay best, the rough work least. */
const PAY: Record<string, number> = {
  smith: 0.7, mason: 0.65, healer: 0.65, midwife: 0.55, herbalist: 0.55, priest: 0.55, lorekeeper: 0.55, quartermaster: 0.6, tavernkeeper: 0.55, bard: 0.45,
  carpenter: 0.5, weaver: 0.45, potter: 0.45, baker: 0.45, butcher: 0.45, brewer: 0.45, builder: 0.4, miner: 0.4, cook: 0.4, guard: 0.4, scout: 0.4,
  farmer: 0.3, herder: 0.3, fisher: 0.3, hunter: 0.3, woodcutter: 0.3, gravedigger: 0.22, ratcatcher: 0.2,
};

/** A colonist's day's wage: their trade, how good they are at it, and the ruler's cut. */
export function wage(c: Colony, p: Pawn, skill: number): number {
  if (!p.prof) return 0;
  const lv = p.sk[skill] ?? 0;
  const w = (PAY[p.prof] ?? 0.35) + Math.max(0, lv - 5) * 0.025 + (p.mastered?.includes(skill) ? 0.1 : 0);
  return c.gov.laws.tax ? w * 0.7 : w;
}

// ---------- The square ----------

export interface Slot { x: number; y: number; dx: number; dy: number }

/**
 * Where the stalls stand: two rows facing each other across the square on the sides the avenue does
 * not cross, and a short row at the back, facing the avenue. Each is the tile the stallholder stands
 * on and the way they face (toward their customers). Worked out from the town plan alone.
 */
export function stallSlots(c: Colony): Slot[] {
  const f = frame(c);
  const out: Slot[] = [];
  const at = (a: number, q: number, fa: number, fq: number): void => {
    out.push({ x: c.cx + f.gx * a + f.px * q, y: c.cy + f.gy * a + f.py * q, dx: f.gx * fa + f.px * fq, dy: f.gy * fa + f.py * fq });
  };
  for (const a of [-1, 1, -3]) for (const s of [1, -1]) at(a, 4 * s, 0, -s);
  for (const q of [0, -2, 2]) at(-4, q, 1, 0);
  for (const s of [1, -1]) at(3, 4 * s, 0, -s);
  return out;
}

/** Where the carters stand their carts: in the mouth of the avenue, just inside the square. */
export function cartSlots(c: Colony): { x: number; y: number }[] {
  const f = frame(c);
  // (a cart is drawn reaching right, its ox in the shafts: two side by side, or one above the other)
  if (f.gx === 0) return [{ x: c.cx - 3, y: c.cy + f.gy * 4 }, { x: c.cx + 1, y: c.cy + f.gy * 4 }];
  const x = c.cx + f.gx * 4 - (f.gx < 0 ? 2 : 0);
  return [{ x, y: c.cy - 1 }, { x, y: c.cy + 1 }];
}

const openGround = (c: Colony, x: number, y: number): boolean => {
  if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) return false;
  const i = y * c.w + x;
  const k = cacheOf(c);
  return !!k.reach[i] && !!k.walk[i] && k.walk[i] <= 20 && !c.st[i];
};

/** The market is open right now. */
export const marketOpen = (c: Colony): boolean => !!c.mkt && c.mkt.st.length > 0 && c.tick >= c.mkt.t0 && c.tick < c.mkt.t1;

/** The weekday the market is held on (fixed for each colony). */
export const marketDow = (c: Colony): number => hash32(c.seed, S.MARKET, 1) % 7;

/** Days until the next market day (0 for today). */
export function daysToMarket(c: Colony): number {
  const d = dayOf(c.tick);
  return (((marketDow(c) - d) % 7) + 7) % 7;
}

// ---------- Prices ----------

/** What a stall has to sell, above what the colony keeps back for itself. */
export function onHand(c: Colony, w: WareDef): number {
  let n = 0;
  for (const k of w.res) n += c.stock[k];
  return Math.max(0, n - w.keep * c.pawns.length);
}

/** How far the price of a ware sits from its usual, by how full the stores are: 0.7 when there is plenty, up to 2 when it is scarce. */
export function priceMult(c: Colony, w: WareDef): number {
  let have = 0;
  for (const k of w.res) have += c.stock[k];
  const r = have / Math.max(1, w.per * c.pawns.length);
  const m = r >= 2 ? 0.7 : r >= 1 ? 1 - 0.3 * (r - 1) : 1 + (1 - r);
  return Math.round(m * 20) / 20;
}

export const priceOf = (c: Colony, w: WareDef): number => Math.round(w.base * priceMult(c, w) * 100) / 100;

// ---------- The day ----------

/** Start of each day: is today market day? */
export function dailyMarket(c: Colony): void {
  const day = dayOf(c.tick);
  const m = c.mkt;
  if (m) { m.t0 = 0; m.t1 = 0; }
  if (day % 7 !== marketDow(c) || c.pawns.length < MARKET_POP) return;
  const mk = (c.mkt ??= blankMarket());
  const t = day * TICKS_PER_DAY;
  mk.t0 = t + OPEN_H * TICKS_PER_HOUR;
  mk.t1 = t + CLOSE_H * TICKS_PER_HOUR;
}

/** Every tick: the market opens and shuts at its hours (or early, when trouble comes). */
export function tickMarket(c: Colony): void {
  const m = c.mkt!;
  if (c.tick === m.t0 && !m.st.length) openMarket(c);
  else if (m.st.length && (c.tick >= m.t1 || c.alarm || (c.siege && c.siege.phase < 2))) closeMarket(c);
}

/** Can this colonist keep a stall today? */
function free(c: Colony, p: Pawn): boolean {
  return !p.gone && !p.thrall && !p.brk && stage(c, p) >= STAGE.ADULT && !needsRest(p) && !isDown(p);
}

function openMarket(c: Colony): void {
  const m = c.mkt!;
  // no market while raiders are about, a host is camped outside, or the plague is new
  const plague = c.plague && c.tick - c.plague.last < 6 * TICKS_PER_DAY;
  if (c.alarm || c.foes.length || (c.siege && c.siege.phase < 2) || plague) { m.t0 = 0; m.t1 = 0; return; }
  const slots = stallSlots(c).filter((s) => openGround(c, s.x, s.y));
  const used = new Set<number>();
  const st: NonNullable<Colony['mkt']>['st'] = [];
  for (let wi = 0; wi < WARES.length && st.length < slots.length; wi++) {
    const w = WARES[wi];
    if (onHand(c, w) < 1) continue;
    let best: Pawn | undefined;
    for (const prof of w.profs) {
      for (const p of c.pawns) {
        if (p.prof !== prof || used.has(p.id) || !free(c, p)) continue;
        if (!best || p.sk[w.skill] > best.sk[w.skill]) best = p;
      }
      if (best) break;
    }
    if (!best) continue;
    used.add(best.id);
    const s = slots[st.length];
    st.push({ k: wi, o: best.id, x: s.x, y: s.y, dx: s.dx, dy: s.dy, n: 0, e: 0 });
  }
  if (st.length < 3) { m.t0 = 0; m.t1 = 0; return; }
  m.st = st;
  m.went = [];
  m.coin = 0;
  m.sale = 0;
  m.pr = WARES.map((w) => Math.round(priceMult(c, w) * 100));
  m.carts = [];
  m.n++;
  bump(c, 'marketDays');
  if (!c.stats.marketSeen) {
    c.stats.marketSeen = 1;
    log(c, 'market_first', undefined, undefined, undefined, st.length);
  }
  carters(c, new Rand(c.seed, S.MARKET, c.tick, 2));
}

/** Stone the town is waiting on: for its wall, its castle, and whatever it has begun to build. */
export function stoneWant(c: Colony): number {
  let n = wallStone(c) + castleStone(c);
  for (const b of c.blds) if (!b.built) n += b.need.stone;
  return n;
}

/** Carters come in on market day; the treasury buys stone and timber off them for the town's building. */
function carters(c: Colony, r: Rand): void {
  const m = c.mkt!;
  const s = c.stock;
  const pop = c.pawns.length;
  const from = c.near?.length ? r.pick(c.near).name : '';
  const want = stoneWant(c);
  if (want - s.stone >= 10 && s.silver >= 20) {
    const price = s.stone < 20 ? 0.6 : 0.5;
    const n = Math.floor(Math.min(90, want - s.stone, (s.silver * 0.5) / price));
    if (n >= 10) {
      s.stone += n;
      s.silver -= n * price;
      m.carts.push('stone');
      bump(c, 'bulkStone', n);
      log(c, 'carter', undefined, undefined, `stone|${from}`, n);
    }
  }
  if (s.wood < pop * 5 && s.silver >= 15) {
    const price = 0.25;
    const n = Math.floor(Math.min(200, pop * 8 - s.wood, (s.silver * 0.4) / price));
    if (n >= 15) {
      s.wood += n;
      s.silver -= n * price;
      m.carts.push('wood');
      bump(c, 'bulkWood', n);
      log(c, 'carter', undefined, undefined, `wood|${from}`, n);
    }
  }
}

function closeMarket(c: Colony): void {
  const m = c.mkt!;
  let best = m.st[0];
  for (const s of m.st) if (s.e > best.e) best = s;
  for (const s of m.st) {
    const p = pawnById(c, s.o);
    if (p && s.e >= 3) think(c, p, 'soldwell');
  }
  // what the day was like: the dearest ware, else the cheapest
  let dear = -1;
  let cheap = -1;
  for (let i = 0; i < m.st.length; i++) {
    const k = m.st[i].k;
    const pr = m.pr[k] ?? 100;
    if (pr >= 140 && (dear < 0 || pr > (m.pr[dear] ?? 0))) dear = k;
    if (pr <= 75 && (cheap < 0 || pr < (m.pr[cheap] ?? 999))) cheap = k;
  }
  const buyers = new Set(m.went).size;
  const said = dear >= 0 ? `dear:${WARES[dear].k}` : cheap >= 0 ? `cheap:${WARES[cheap].k}` : '';
  // a day cut short by trouble with nothing sold is not worth a line
  if (buyers > 0) log(c, 'market', best.e > 0 ? best.o : undefined, undefined, `${m.st.length}|${buyers}|${WARES[best.k].k}|${said}`, Math.round(m.coin));
  bump(c, 'marketCoin', m.coin);
  m.st = [];
  m.went = [];
  m.carts = [];
  m.t1 = Math.min(m.t1, c.tick);
}

// ---------- Buying and selling ----------

/** How fine a thing this colonist buys: 0 plain .. 3 the finest, by their purse (the thrifty buy plainer). */
function gradeFor(p: Pawn): number {
  let g = p.coin >= 120 ? 3 : p.coin >= 60 ? 2 : p.coin >= 20 ? 1 : 0;
  if (per(p, AX.GREED) > 0.4 && g > 0) g--;
  return g;
}

/** How many times a colonist goes round the stalls in a day: the well-off linger. */
const visits = (p: Pawn): number => (p.coin >= 60 ? 3 : p.coin >= 15 ? 2 : 1);

/** How much this colonist wants a ware right now. */
function wantOf(c: Colony, p: Pawn, w: WareDef): number {
  if (w.k === 'tools') return p.tool ? (p.tool[1] < 45 ? 4 : 0.4) : 0;
  if (w.k === 'cloth') return p.cloth < 50 ? 4 : 0.8;
  if (w.k === 'ale') return stage(c, p) < STAGE.ADULT || has(p, 'teetotal') ? 0 : has(p, 'drunkard') ? 3 : 1;
  if (FOOD.has(w.k)) return p.food < 60 ? 2.4 : 1;
  if (w.k === 'herbs') return p.inj.length || p.ill ? 3 : 0.5;
  return p.joy < 45 ? 2 : 1.2;
}

/** On market day: a stallholder goes to their stall; anyone else with silver may go round the stalls. */
export function goMarket(c: Colony, p: Pawn, r: Rand, set: (x: number, y: number, k: 'shop' | 'sell', dur: number, why: string, o: number, d: number) => boolean): boolean {
  const m = c.mkt!;
  const left = m.t1 - c.tick;
  if (left < 6) return false;
  for (let i = 0; i < m.st.length; i++) {
    const s = m.st[i];
    if (s.o !== p.id) continue;
    return set(s.x, s.y, 'sell', Math.min(30, left), 'stall', 0, i);
  }
  if (p.coin < 0.3 || !r.chance(0.35)) return false;
  let n = 0;
  for (const id of m.went) if (id === p.id) n++;
  if (n >= visits(p)) return false;
  // the stall they most want, among those with something left to sell
  let total = 0;
  const opts: [number, number][] = [];
  for (let i = 0; i < m.st.length; i++) {
    const s = m.st[i];
    if (s.o === p.id) continue;
    const w = WARES[s.k];
    if (onHand(c, w) < 1) continue;
    const v = wantOf(c, p, w);
    if (v <= 0) continue;
    opts.push([i, v]);
    total += v;
  }
  if (!opts.length) return false;
  let roll = r.float() * total;
  let pick = opts[0][0];
  for (const [i, v] of opts) { roll -= v; if (roll <= 0) { pick = i; break; } }
  const s = m.st[pick];
  // stand in front of the stall, a step or two off to one side
  const side = r.range(-1, 1);
  const ox = s.dy !== 0 ? side : 0;
  const oy = s.dx !== 0 ? side : 0;
  for (const [fx, fy] of [[s.x + s.dx * 2 + ox, s.y + s.dy * 2 + oy], [s.x + s.dx * 2, s.y + s.dy * 2], [s.x + s.dx * 3, s.y + s.dy * 3]]) {
    if (!openGround(c, fx, fy)) continue;
    return set(fx, fy, 'shop', 10 + r.int(10), 'market', s.o, pick);
  }
  return false;
}

/** A shop on an ordinary day: a trade's master sells from their workshop. Returns [building, ware, master] or null. */
export function pickShop(c: Colony, p: Pawn, r: Rand): [number, number, number] | null {
  const opts: [number, number, number][] = [];
  for (let wi = 0; wi < WARES.length; wi++) {
    const w = WARES[wi];
    if (!w.shop || onHand(c, w) < 1 || wantOf(c, p, w) <= 0.5) continue;
    const b = c.blds.find((x) => x.k === w.shop && x.built);
    if (!b) continue;
    let best: Pawn | undefined;
    for (const o of c.pawns) if (o !== p && w.profs.includes(o.prof) && stage(c, o) >= STAGE.ADULT && (!best || o.sk[w.skill] > best.sk[w.skill])) best = o;
    if (best) opts.push([b.id, wi, best.id]);
  }
  return opts.length ? r.pick(opts) : null;
}

/** The colonist has reached the stall (or the shop): buy, if they can. */
export function buy(c: Colony, p: Pawn, stall: number, seller: number, shop: boolean): void {
  const m = c.mkt;
  let wi: number;
  if (shop) wi = stall;
  else {
    const s = m && marketOpen(c) ? m.st[stall] : undefined;
    if (!s || s.o !== seller) return;
    wi = s.k;
    m!.went.push(p.id);
  }
  const w = WARES[wi];
  const o = pawnById(c, seller);
  if (!w || !o || o === p || onHand(c, w) < 1) return;
  const price = priceOf(c, w) * (shop ? 1.15 : 1);
  let g = gradeFor(p);
  while (g > 0 && p.coin < price * GRADE[g]) g--;
  const cost = Math.round(price * GRADE[g] * 100) / 100;
  if (p.coin < cost) {
    if (!shop && priceMult(c, w) >= 1.3) think(c, p, 'pricey');
    return;
  }
  // one of whatever the stall has
  let res: ResK = w.res[0];
  for (const k of w.res) if (c.stock[k] >= 1) { res = k; break; }
  if (c.stock[res] < 1) return;
  c.stock[res] -= 1;
  p.coin -= cost;
  o.coin += cost * (1 - TOLL);
  c.stock.silver += cost * TOLL;
  bump(c, 'marketSales');
  bump(c, 'marketSpent', cost);
  if (!shop) {
    const s = m!.st[stall];
    s.n++;
    s.e += cost * (1 - TOLL);
    m!.coin += cost;
    // the day's grandest sale is talked about
    if (!m!.sale && cost >= 5 && g >= 2) {
      m!.sale = 1;
      log(c, 'market_sale', p.id, o.id, w.k, Math.round(cost));
    }
  } else bump(c, 'shopSales');
  // what it does for them
  if (FOOD.has(w.k)) p.food = Math.min(100, p.food + 22);
  else if (w.k === 'cloth') { if (res === 'clothes' && p.cloth < 80) p.cloth = 100; p.joy = Math.min(100, p.joy + 8); }
  else if (w.k === 'tools') { if (p.tool) p.tool[1] = 100; }
  else if (w.k === 'ale') { p.drunk += 12; p.joy = Math.min(100, p.joy + 8); }
  else p.joy = Math.min(100, p.joy + 12);
  think(c, p, g >= 2 ? 'boughtfine' : 'market');
}

