// Wealth, luxuries and strategic resources, and trade routes between settlements.

import { ev, has, mods, tally } from './civ';
import { relOf, atWar } from './diplo';
import { hexDist, neighbors } from './hex';
import { Rand, S } from './rng';
import type { Civ, Sett, World } from './types';
import { R, isLand } from './worldgen';

export const LUXURIES = [R.GOLD, R.SPICES];
export const STRATEGIC = [R.COPPER, R.IRON, R.HORSES];
const TRADEABLE = [...LUXURIES, ...STRATEGIC].reduce((m, r) => m | (1 << r), 0);

export function luxuryCount(c: Civ): number {
  let n = 0;
  for (const r of LUXURIES) if (c.access & (1 << r)) n++;
  return n;
}

export function isCoastal(w: World, tile: number): boolean {
  const nb: number[] = [];
  for (const j of neighbors(w.W, w.H, tile, nb)) if (!isLand(w.t, j)) return true;
  return false;
}

export function routeCapacity(w: World, c: Civ): number {
  const m = mods(c);
  let markets = 0;
  for (const id of tally.list[c.id] ?? []) markets += w.setts[id].b.market;
  const merchants = c.greats.filter((g) => g.kind === 'merchant').length;
  return 1 + Math.floor(m.trade / 2) + (has(c, 'mercantile') ? 1 : 0) + merchants + Math.min(3, Math.floor(markets / 6));
}

function routeValue(a: Sett, b: Sett, d: number): number {
  return Math.sqrt(a.pop * b.pop) / (d + 4);
}

/** Yearly: refresh resource access, pay out trade, drop dead routes and open new ones. */
export function yearlyEcon(w: World, routesPerPair: Map<number, number>): void {
  const n = w.civs.length;
  // What each civ holds itself.
  const own = new Int32Array(n);
  for (let i = 0; i < w.t.owner.length; i++) {
    const o = w.t.owner[i];
    if (o >= 0 && w.t.work[i] >= 0 && w.t.res[i]) own[o] |= (1 << w.t.res[i]) & TRADEABLE;
  }

  // Drop routes that no longer make sense.
  w.routes = w.routes.filter((r) => {
    const a = w.setts[r.a];
    const b = w.setts[r.b];
    return a.died < 0 && b.died < 0 && a.civ !== b.civ && !atWar(w, a.civ, b.civ);
  });

  // Access = own + what trade partners hold. Trade pays both sides.
  const acc = Int32Array.from(own);
  const count = new Int32Array(n);
  for (const r of w.routes) {
    const a = w.setts[r.a];
    const b = w.setts[r.b];
    acc[a.civ] |= own[b.civ];
    acc[b.civ] |= own[a.civ];
    count[a.civ]++;
    count[b.civ]++;
    const d = hexDist(w.W, a.tile, b.tile);
    const v = routeValue(a, b, d) * 0.08 * (1 + 0.15 * (a.b.market + b.b.market));
    const ca = w.civs[a.civ];
    const cb = w.civs[b.civ];
    ca.wealth += v * mods(ca).wealth;
    cb.wealth += v * mods(cb).wealth;
    const k = a.civ < b.civ ? a.civ * 65536 + b.civ : b.civ * 65536 + a.civ;
    routesPerPair.set(k, (routesPerPair.get(k) ?? 0) + 1);
  }
  for (const c of w.civs) if (c.died < 0) c.access = acc[c.id];

  // Open new routes.
  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const cap = routeCapacity(w, c);
    if (count[c.id] >= cap) continue;
    const r = new Rand(w.seed, S.AI, w.tick, 0x7a, c.id);
    if (!(c.goal === 'trade' || has(c, 'mercantile') || r.chance(0.35))) continue;
    const m = mods(c);
    const landR = 6 + 2 * m.range;
    const seaR = m.sail > 0 ? 6 + 5 * m.sail : 0;
    let best: [Sett, Sett, boolean] | null = null;
    let bestV = 0;
    for (const sid of tally.list[c.id] ?? []) {
      const s = w.setts[sid];
      if (s.tier < 1) continue;
      const sx = s.tile % w.W;
      const sy = (s.tile - sx) / w.W;
      const coastS = seaR > 0 && isCoastal(w, s.tile);
      for (const o of w.setts) {
        if (o.died >= 0 || o.civ === c.id || o.tier < 1) continue;
        const ox = o.tile % w.W;
        const oy = (o.tile - ox) / w.W;
        const reach = Math.max(landR, seaR);
        if (Math.abs(ox - sx) > reach + 1 || Math.abs(oy - sy) > reach) continue;
        const rl = relOf(w, c.id, o.civ);
        if (!rl || rl.st === 'war' || rl.op < -5) continue;
        if (count[o.civ] >= routeCapacity(w, w.civs[o.civ]) && rl.op < 30) continue;
        const d = hexDist(w.W, s.tile, o.tile);
        let sea = false;
        if (d > landR) {
          if (!(coastS && d <= seaR && isCoastal(w, o.tile))) continue;
          sea = true;
        }
        if (w.routes.some((x) => (x.a === s.id && x.b === o.id) || (x.a === o.id && x.b === s.id))) continue;
        // New goods are worth reaching for.
        const gain = own[o.civ] & ~acc[c.id];
        const v = routeValue(s, o, d) * (1 + (gain ? 0.5 : 0));
        if (v > bestV) { bestV = v; best = [s, o, sea]; }
      }
    }
    if (!best) continue;
    const [s, o, sea] = best;
    const first = !w.routes.some((x) => {
      const a = w.setts[x.a].civ;
      const b = w.setts[x.b].civ;
      return (a === c.id && b === o.civ) || (a === o.civ && b === c.id);
    });
    w.routes.push({ a: s.id, b: o.id, start: w.tick, sea });
    count[c.id]++;
    count[o.civ]++;
    if (first) ev(w, { k: 'trade_open', a: c.id, b: o.civ, s: s.id, x: o.name, n: sea ? 1 : 0 });
  }
}

/** Monthly income from a settlement's people and markets. */
export function settIncome(w: World, s: Sett, c: Civ): number {
  const m = mods(c);
  let gold = 0;
  if (w.t.res[s.tile] === R.GOLD || w.t.res[s.tile] === R.SPICES) gold = 1;
  return ((s.pop / 4000) * (1 + 0.3 * s.b.market) + gold * 0.3) * m.wealth * (0.5 + s.stab / 200) * (c.ruler.trait === 'greedy' ? 1.15 : 1);
}

/** Yearly: a rich treasury is spent on its settlements' building stock. */
export function invest(w: World, c: Civ): void {
  const reserve = 60 + (c.army / 400) * 24;
  if (c.wealth <= reserve) return;
  const spend = (c.wealth - reserve) * 0.3;
  const ids = tally.list[c.id] ?? [];
  const pop = tally.pop[c.id] || 1;
  for (const id of ids) w.setts[id].mat += (spend * w.setts[id].pop) / pop;
  c.wealth -= spend;
}
