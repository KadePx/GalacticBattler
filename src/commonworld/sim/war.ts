// Abstract war: armies are numbers, battles are rolls weighed by strength, terrain, walls and
// generals. Sieges take towns; peace comes from victory, exhaustion or stalemate.

import { ev, has, mods, moveCapital, tally, transferSett } from './civ';
import { allies, rel, relOf, setState } from './diplo';
import { hexDist } from './hex';
import { Rand, S } from './rng';
import { available } from './techs';
import { TICKS_PER_YEAR, type Civ, type Sett, type War, type World } from './types';
import { B } from './worldgen';
import { openOmen } from './player';
import { wonderFx } from './wonders';
import { ordinal } from './names';
import { flee, mayAttack, maybeSubjugate } from './realm';

export function generalOf(c: Civ): string | null {
  return c.greats.find((g) => g.kind === 'general')?.name ?? null;
}

export function strength(c: Civ): number {
  if (c.died >= 0) return 0;
  const m = mods(c);
  let s = c.army * (1 + m.mil);
  if (has(c, 'martial')) s *= 1.15;
  if (generalOf(c)) s *= 1.25;
  return s * (1 - c.weary / 250);
}

export function activeWars(w: World, c: number): War[] {
  return w.wars.filter((x) => x.end < 0 && (x.atk === c || x.def === c || x.atkAllies.includes(c) || x.defAllies.includes(c)));
}

function sideOf(war: War, c: number): 1 | -1 | 0 {
  if (war.atk === c || war.atkAllies.includes(c)) return 1;
  if (war.def === c || war.defAllies.includes(c)) return -1;
  return 0;
}

/** Monthly: grow or shrink the army toward what the realm wants, drawing people from its towns. */
export function monthlyArmy(w: World, c: Civ, atWar: boolean): void {
  const pop = tally.pop[c.id];
  let want = pop * (atWar ? 0.05 : 0.012);
  if (has(c, 'martial')) want *= 1.4;
  if (c.ruler.trait === 'bold' || c.ruler.trait === 'cruel') want *= 1.15;
  if (c.ruler.trait === 'cautious') want *= 1.1;
  const ids = tally.list[c.id] ?? [];
  if (!ids.length) return;
  if (c.army < want) {
    const add = Math.floor((want - c.army) * 0.1);
    if (add <= 0) return;
    let took = 0;
    for (const id of ids) {
      const s = w.setts[id];
      const t = Math.min(Math.floor(s.pop * 0.05), Math.floor((add * s.pop) / pop));
      s.pop -= t;
      took += t;
    }
    c.army += took;
  } else if (c.army > want * 1.1) {
    const back = Math.floor((c.army - want) * 0.05);
    c.army -= back;
    for (const id of ids) w.setts[id].pop += Math.floor((back * w.setts[id].pop) / pop);
  }
  // Upkeep; an unpaid army melts away.
  c.wealth -= c.army / 400;
  if (c.wealth < 0) {
    c.wealth = 0;
    c.army = Math.floor(c.army * 0.97);
  }
}

/**
 * A war's name says why it was fought: a claim, a faith, a grudge, land or loot. Names that
 * the world has used before get an ordinal ("the Second ..."), so no two wars share a name.
 */
function warName(w: World, a: Civ, b: Civ, target: Sett | null, r: Rand, cause: War['cause']): string {
  const pair = `the ${a.name}–${b.name} War`;
  const river = target && w.t.river[target.tile] ? w.rivers[w.t.river[target.tile] - 1].name : null;
  const month = w.tick % TICKS_PER_YEAR;
  const south = target ? Math.floor(target.tile / w.W) > w.H / 2 : false;
  const winter = south ? month >= 5 && month <= 7 : month <= 1 || month === 11;
  let base: string;
  if (cause === 'succession') base = `the War of the ${a.ruler.house} Claim`;
  else if (cause === 'independence') base = `the ${a.name} Revolt`;
  else if (cause === 'faith') base = r.chance(0.5) ? `the ${a.name} Crusade` : `the Holy War for ${target?.name ?? b.name}`;
  else if (cause === 'grudge') base = pair;
  else if (cause === 'plunder') base = target && r.chance(0.5) ? `the Raids on ${target.name}` : winter && !w.wars.some((x) => x.name.endsWith('Winter War')) ? 'the Winter War' : pair;
  else {
    const p = r.int(3);
    base = p === 0 && river ? `the War of the ${river}` : p === 1 && target ? `the War for ${target.name}` : pair;
  }
  const earlier = w.wars.filter((x) => x.name === base || x.name.endsWith(base.replace(/^the /, ' '))).length;
  return ordinal(base, earlier);
}

export function declareWar(w: World, a: Civ, b: Civ, cause: War['cause'], r: Rand): War {
  const target = nearestPair(w, a.id, b.id)?.[1] ?? null;
  const war: War = {
    id: w.wars.length, name: warName(w, a, b, target, r, cause), atk: a.id, def: b.id, atkAllies: [], defAllies: [],
    cause, start: w.tick, end: -1, score: 0, battles: 0, deaths: 0, taken: [], lost: [], result: '',
  };
  w.wars.push(war);
  const ra = rel(w, a.id, b.id);
  setState(w, ra, 'war');
  ev(w, { k: 'war', a: a.id, b: b.id, x: war.name, y: cause });
  // Defenders' allies answer the call; attackers' allies join if they also dislike the target.
  for (const o of allies(w, b.id)) {
    if (o === a.id || relOf(w, o, a.id)?.st === 'ally') continue;
    war.defAllies.push(o);
    setState(w, rel(w, o, a.id), 'war');
    ev(w, { k: 'war_join', a: o, b: a.id, x: war.name });
  }
  for (const o of allies(w, a.id)) {
    if (o === b.id || war.defAllies.includes(o) || (relOf(w, o, b.id)?.op ?? 0) > -10) continue;
    war.atkAllies.push(o);
    setState(w, rel(w, o, b.id), 'war');
    ev(w, { k: 'war_join', a: o, b: b.id, x: war.name });
  }
  // Tributaries follow their overlord into war, and an overlord shields its tributaries.
  const join = (o: Civ, side: number[], enemy: number) => {
    if (o.died >= 0 || o.id === a.id || o.id === b.id || war.atkAllies.includes(o.id) || war.defAllies.includes(o.id)) return;
    if (relOf(w, o.id, enemy)?.st === 'ally') return;
    side.push(o.id);
    setState(w, rel(w, o.id, enemy), 'war');
    ev(w, { k: 'war_join', a: o.id, b: enemy, x: war.name, y: 'lord' });
  };
  if (cause !== 'independence') {
    for (const v of w.civs) {
      if (v.lord === a.id) join(v, war.atkAllies, b.id);
      else if (v.lord === b.id) join(v, war.defAllies, a.id);
    }
    if (b.lord >= 0 && b.lord !== a.id) join(w.civs[b.lord], war.defAllies, a.id);
  }
  // A founder's people are asked how to meet the war.
  openOmen(w, a, 'war', { b: b.id, n: war.id });
  openOmen(w, b, 'war', { b: a.id, n: war.id });
  return war;
}

/** Closest pair of settlements between two civs: [from, to]. */
function nearestPair(w: World, from: number, to: number): [Sett, Sett] | null {
  let best: [Sett, Sett] | null = null;
  let bd = Infinity;
  for (const i of tally.list[from] ?? []) {
    for (const j of tally.list[to] ?? []) {
      const d = hexDist(w.W, w.setts[i].tile, w.setts[j].tile);
      if (d < bd) { bd = d; best = [w.setts[i], w.setts[j]]; }
    }
  }
  return best;
}

/** Yearly: rulers weigh up their neighbours and some choose war. */
export function considerWar(w: World, border: Map<number, number>, canGrow: Float64Array): void {
  // When each people's last war ended: realms rest a few years between campaigns.
  const lastEnd = new Map<number, number>();
  for (const x of w.wars) {
    if (x.end < 0 || w.tick - x.end > 10 * TICKS_PER_YEAR) continue;
    for (const k of [x.atk, x.def, ...x.atkAllies, ...x.defAllies]) lastEnd.set(k, Math.max(lastEnd.get(k) ?? -1, x.end));
  }
  for (const c of w.civs) {
    if (c.died >= 0 || c.lord >= 0 || c.weary > 30 || c.protectedUntil > w.tick || activeWars(w, c.id).length) continue;
    const rest = (has(c, 'martial') ? 3 : has(c, 'isolationist') ? 8 : 5) + (c.ruler.trait === 'cautious' ? 2 : c.ruler.trait === 'bold' ? -1 : 0) + (c.era === 'dark' ? 6 : 0);
    if (w.tick - (lastEnd.get(c.id) ?? -9999) < rest * TICKS_PER_YEAR) continue;
    const r = new Rand(w.seed, S.AI, w.tick, 0x3a, c.id);
    const my = strength(c);
    if (my < 50) continue;
    let best: Civ | null = null;
    let bestD = 2;
    for (const k of c.contacts) {
      const o = w.civs[k];
      if (o.died >= 0 || o.protectedUntil > w.tick || !mayAttack(c, o)) continue;
      const rl = relOf(w, c.id, k);
      if (!rl || rl.st === 'war' || rl.st === 'ally' || rl.truce > w.tick) continue;
      const edge = border.get(c.id < k ? c.id * 65536 + k : k * 65536 + c.id) ?? 0;
      if (!edge) continue;
      let theirs = strength(o) + 30;
      for (const al of allies(w, k)) if (al !== c.id) theirs += strength(w.civs[al]) * 0.5;
      // An overlord and its tributaries stand together.
      if (o.lord >= 0) theirs += strength(w.civs[o.lord]) * 0.6;
      for (const v of w.civs) if (v.lord === k && v.died < 0) theirs += strength(v) * 0.4;
      let d = Math.min(4, (my / theirs - 1) * 1.2) - rl.op / 25 - 1 + r.float() * 0.6;
      if (canGrow[c.id] === 0) d += 0.7; // nowhere left to settle
      if (has(c, 'martial')) d += 0.4;
      if (has(c, 'expansionist')) d += 0.3;
      if (has(c, 'isolationist')) d -= 0.4;
      if (c.ruler.trait === 'bold' || c.ruler.trait === 'cruel') d += 0.5;
      if (c.ruler.trait === 'cautious' || c.ruler.trait === 'just') d -= 0.5;
      if (rl.st === 'pact') d -= 0.7;
      if (c.era === 'dark') d -= 1.2; // a people in its dark years looks inward
      const zeal = c.faith >= 0 && o.faith >= 0 && c.faith !== o.faith && has(c, 'devout');
      if (zeal) d += 0.3;
      d -= c.weary / 30;
      if (d > bestD) { bestD = d; best = o; }
    }
    if (best) {
      const rl = relOf(w, c.id, best.id)!;
      const zeal = c.faith >= 0 && best.faith >= 0 && c.faith !== best.faith && has(c, 'devout');
      declareWar(w, c, best, rl.grudge > 20 ? 'grudge' : zeal && rl.op < -10 ? 'faith' : canGrow[c.id] === 0 ? 'land' : 'plunder', r);
    }
  }
}

function battleName(w: World, t: Sett, r: Rand, siege: boolean): string {
  if (siege) return `the Siege of ${t.name}`;
  const river = w.t.river[t.tile] ? w.rivers[w.t.river[t.tile] - 1].name : null;
  const b = w.t.biome[t.tile];
  const p = r.int(4);
  if (river && p < 2) return `the Battle of the ${river} Ford`;
  if (b === B.HILLS && p < 3) return `the Battle of ${t.name} Heights`;
  if ((b === B.FOREST || b === B.JUNGLE || b === B.TAIGA) && p < 3) return `the Battle of ${t.name} Wood`;
  return `the Battle of ${t.name}`;
}

function sideStrength(w: World, ids: number[]): number {
  let s = 0;
  for (const id of ids) s += strength(w.civs[id]) * 0.5;
  return s;
}

/** Every three months each war sees a clash at the front. */
export function monthlyWar(w: World): void {
  for (const war of w.wars) {
    if (war.end >= 0 || w.tick % 3 !== war.id % 3) continue;
    const A = w.civs[war.atk];
    const D = w.civs[war.def];
    if (A.died >= 0 || D.died >= 0) continue;
    const r = new Rand(w.seed, S.EVENT, w.tick, 0xba7, war.id);
    const sA = strength(A) + sideStrength(w, war.atkAllies);
    const sD = strength(D) + sideStrength(w, war.defAllies);
    // The stronger side usually presses the attack.
    const atkMoves = r.float() < (sA + 1) / (sA + sD + 2) + (war.score < 0 ? -0.1 : 0.1);
    const X = atkMoves ? A : D;
    const Y = atkMoves ? D : A;
    const pair = nearestPair(w, X.id, Y.id);
    if (!pair) continue;
    // Keep pressing a siege already under way.
    let T = pair[1];
    for (const id of tally.list[Y.id] ?? []) {
      const s = w.setts[id];
      if (s.siegeBy === X.id && s.siege > 0) { T = s; break; }
    }
    const my = mods(Y);
    const def = my.def + wonderFx(Y).def;
    let fX = strength(X) * 0.55 + (atkMoves ? sideStrength(w, war.atkAllies) : sideStrength(w, war.defAllies)) * 0.5;
    let fY = strength(Y) * 0.45 + (atkMoves ? sideStrength(w, war.defAllies) : sideStrength(w, war.atkAllies)) * 0.4;
    fY += T.pop * 0.012 * (1 + T.b.walls * 0.5) * (1 + def);
    if (w.t.biome[T.tile] === B.HILLS) fY *= 1.2;
    if (Y.capital === T.id) fY *= 1.15;
    const ratio = (fX * (0.7 + r.float() * 0.6) + 1) / (fY * (0.7 + r.float() * 0.6) + 1);
    const xWins = ratio > 1;
    const winner = xWins ? X : Y;
    const loser = xWins ? Y : X;
    const commitW = (xWins ? 0.55 : 0.45) * winner.army;
    const commitL = (xWins ? 0.45 : 0.55) * loser.army;
    const lossL = Math.floor(commitL * (0.12 + r.float() * 0.08) * Math.min(2, xWins ? ratio : 1 / ratio));
    const lossW = Math.floor(commitW * (0.05 + r.float() * 0.04));
    loser.army = Math.max(0, loser.army - lossL);
    winner.army = Math.max(0, winner.army - lossW);
    const civilian = Math.floor(T.pop * 0.01);
    T.pop -= civilian;
    war.deaths += lossL + lossW + civilian;
    war.battles++;
    winner.ruler.won++;
    const gen = generalOf(winner);
    if (gen) for (const g of winner.greats) if (g.kind === 'general') g.deeds++;
    loser.weary = Math.min(100, loser.weary + 4 + (lossL / Math.max(1, tally.pop[loser.id])) * 400);
    winner.weary = Math.min(100, winner.weary + 1.5);
    const sign = winner.id === A.id ? 1 : -1;
    const firstHere = T.siegeBy !== X.id || T.siege === 0;
    war.score += sign * (xWins && ratio > 1.6 ? 8 : 5);

    if (xWins && ratio > 1.15) {
      if (T.siegeBy !== X.id) T.siege = 0;
      T.siegeBy = X.id;
      T.siege += ratio > 1.8 ? 2 : 1;
    } else if (!xWins) {
      T.siege = Math.max(0, T.siege - 1);
    }
    // One name per place per war; only the first clash and crushing ones make the chronicle.
    const decisive = ratio > 2.6 || ratio < 1 / 2.6;
    if (firstHere || decisive) {
      const name = battleName(w, T, new Rand(w.seed, S.EVENT, war.id, T.id), !firstHere && xWins);
      ev(w, { k: 'battle', a: winner.id, b: loser.id, s: T.id, x: name, n: lossL + lossW, y: gen ?? undefined });
    }

    const need = 3 + T.b.walls * 2 + T.tier + Math.round(def * 3);
    if (xWins && T.siege >= need) capture(w, war, T, X, Y, r);
  }
}

function capture(w: World, war: War, T: Sett, X: Civ, Y: Civ, r: Rand): void {
  const wasCapital = Y.capital === T.id;
  transferSett(w, T, X.id);
  T.conq = w.tick;
  T.stab = 35;
  T.pop -= Math.floor(T.pop * 0.08);
  // Some flee to their own people's nearest town.
  flee(w, T, Y.id, Math.floor(T.pop * 0.06), 'war');
  const loot = T.mat + Y.wealth * 0.15;
  X.wealth += loot;
  Y.wealth *= 0.85;
  T.mat = 0;
  if (X.id === war.atk) war.taken.push(T.id);
  else war.lost.push(T.id);
  war.score += X.id === war.atk ? 15 : -15;
  ev(w, { k: 'conquest', a: X.id, b: Y.id, s: T.id, x: war.name });
  // Scholars and books change hands with the town.
  if (r.chance(0.35)) {
    const opts = available(X).filter((t) => Y.techs.includes(t.id));
    if (opts.length) {
      const t = r.pick(opts);
      X.techs.push(t.id);
      if (X.research === t.id) X.research = -1;
      ev(w, { k: 'tech', a: X.id, x: t.name, y: T.name });
    }
  }
  if (wasCapital || !(tally.list[Y.id] ?? []).length) moveCapital(w, Y, X.id);
}

/** Yearly: wars end in victory, exhaustion or stalemate. */
export function considerPeace(w: World): void {
  for (const war of w.wars) {
    if (war.end >= 0) continue;
    const A = w.civs[war.atk];
    const D = w.civs[war.def];
    const yrs = (w.tick - war.start) / TICKS_PER_YEAR;
    const r = new Rand(w.seed, S.AI, w.tick, 0x9ea, war.id);
    let result: War['result'] = '';
    if (A.died >= 0 || D.died >= 0) result = 'conquered';
    else if (shouldSubmit(w, war, A, D, r)) result = 'submitted';
    else if (war.score >= 30 && yrs >= 2 && r.chance(0.5)) result = 'victory';
    else if (war.score <= -30 && yrs >= 2 && r.chance(0.5)) result = 'defeat';
    else if (A.weary > 55 || D.weary > 65 || yrs >= 15) result = war.score >= 20 ? 'victory' : war.score <= -20 ? 'defeat' : 'stalemate';
    if (result) endWar(w, war, result);
  }
}

/**
 * A small people facing a far stronger one, and already losing, may bow rather than be wiped
 * out: it becomes the attacker's tributary. The proud and the warlike rarely do.
 */
function shouldSubmit(w: World, war: War, A: Civ, D: Civ, r: Rand): boolean {
  if (D.lord >= 0 || A.lord >= 0 || war.cause === 'independence' || war.cause === 'succession') return false;
  if (war.score < 10 && !war.taken.length) return false;
  const theirs = strength(A) + war.atkAllies.reduce((s, k) => s + strength(w.civs[k]) * 0.5, 0);
  const mine = strength(D) + war.defAllies.reduce((s, k) => s + strength(w.civs[k]) * 0.5, 0);
  if (theirs < mine * 2.5 + 40) return false;
  let p = 0.4;
  if (has(D, 'stubborn')) p *= 0.4;
  if (has(D, 'martial')) p *= 0.6;
  if (war.cause === 'faith' || war.cause === 'grudge') p *= 0.6; // the attacker wants more than tribute
  return r.chance(p);
}

/** The peace hands the winner the town they were besieging, if any (never a capital). */
function cede(w: World, war: War, winner: Civ, loser: Civ): void {
  let best: Sett | null = null;
  for (const id of tally.list[loser.id] ?? []) {
    const s = w.setts[id];
    if (s.siegeBy === winner.id && s.siege > 0 && s.id !== loser.capital && (!best || s.siege > best.siege)) best = s;
  }
  if (!best) return;
  transferSett(w, best, winner.id);
  best.conq = w.tick;
  best.stab = 40;
  if (winner.id === war.atk) war.taken.push(best.id);
  else war.lost.push(best.id);
  ev(w, { k: 'cede', a: winner.id, b: loser.id, s: best.id, x: war.name });
}

export function endWar(w: World, war: War, result: War['result']): void {
  war.end = w.tick;
  war.result = result;
  const sideA = [war.atk, ...war.atkAllies];
  const sideD = [war.def, ...war.defAllies];
  for (const a of sideA) {
    for (const d of sideD) {
      const rl = relOf(w, a, d);
      if (!rl || rl.st !== 'war') continue;
      // Stay at war if another war still pits them against each other.
      if (w.wars.some((o) => o !== war && o.end < 0 && sideOf(o, a) !== 0 && sideOf(o, a) === -sideOf(o, d))) continue;
      setState(w, rl, 'peace');
      rl.truce = w.tick + 30 * TICKS_PER_YEAR;
      rl.grudge += result === 'victory' || result === 'defeat' ? 30 : 15;
    }
  }
  const A = w.civs[war.atk];
  const D = w.civs[war.def];
  const rs = new Rand(w.seed, S.AI, w.tick, 0x7b, war.id);
  if (result === 'submitted') {
    for (const v of w.civs) if (v.died < 0 && v.lord === D.id) { v.lord = -1; v.lordSince = -1; }
    D.lord = A.id;
    D.lordSince = w.tick;
  } else if (result === 'victory' && D.died < 0) {
    const pay = D.wealth * 0.5;
    D.wealth -= pay;
    A.wealth += pay;
    cede(w, war, A, D);
    maybeSubjugate(w, A, D, rs);
  } else if (result === 'defeat' && A.died < 0) {
    const pay = A.wealth * 0.5;
    A.wealth -= pay;
    D.wealth += pay;
    cede(w, war, D, A);
    maybeSubjugate(w, D, A, rs);
  }
  if (result !== 'conquered') {
    ev(w, { k: 'peace', a: war.atk, b: war.def, x: war.name, z: result, n: Math.max(1, Math.round((w.tick - war.start) / TICKS_PER_YEAR)) });
  }
}
