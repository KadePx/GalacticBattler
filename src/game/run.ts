// Run state and shop rules: buying, merging, selling, rerolling, results.

import { SHIPS, SHOP_SHIPS, MAX_XP, levelOf, shopSize, tierCap } from '../sim/ships';
import { RELICS, count } from '../sim/relics';
import { hashStr, pick, rand, type RngState } from '../sim/rng';
import type { FleetShip, Snapshot } from '../sim/types';
import { CMD_MAP, type PassiveSlot } from '../sim/commanders';

export const START_LIVES = 5;
export const WIN_TARGET = 10;
export const ROUND_SCRAP = 10;
export const SHIP_COST = 3;

/**
 * Ship pricing model. The game uses 'flat' (every ship costs SHIP_COST); the
 * others exist so the balance tool can compare alternatives.
 *   t1late: tier 1 ships cost 2 from round 5.   tiered: T1=2, T2=3, T3=4.
 */
export type Pricing = 'flat' | 't1late' | 'tiered';
let pricing: Pricing = 'flat';
export const setPricing = (p: Pricing) => { pricing = p; };
export const minShipCost = () => (pricing === 'flat' ? SHIP_COST : 2);
export function shipCost(def: string, round: number): number {
  const tier = SHIPS[def]?.tier ?? 1;
  if (pricing === 'tiered') return tier + 1;
  if (pricing === 't1late' && tier === 1 && round >= 5) return 2;
  return SHIP_COST;
}
export const REROLL_COST = 1;
export const FLEET_SIZE = 5;
export const BENCH_SIZE = 3;

export type Phase = 'shop' | 'relic' | 'over';
export type Outcome = 'W' | 'L' | 'D';

export interface Run extends RngState {
  v: 1;
  runId: string;
  round: number;
  wins: number;
  lives: number;
  scrap: number;
  fleet: (FleetShip | null)[];
  bench?: (FleetShip | null)[]; // reserve ships: not in battle
  shop: (string | null)[];
  frozen?: boolean[]; // frozen shop slots survive rerolls and new rounds
  relics: string[];
  relicOffer: string[];
  history: Outcome[];
  phase: Phase;
  lastOpponent?: string;
  // Commander (runs from before commanders existed have none).
  cmd?: string;
  passive?: PassiveSlot;
  skin?: boolean;
  powerUsed?: boolean; // shop power, once per round
  xpAwarded?: { pilotBefore: number; cmdBefore: number };
}

export interface RunOptions {
  cmd: string;
  passive: PassiveSlot;
  starter: boolean;
  skin: boolean;
}

export function newRun(opts?: RunOptions): Run {
  const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const run: Run = {
    v: 1, runId, rng: hashStr(runId), round: 1, wins: 0, lives: START_LIVES, scrap: 0,
    fleet: Array(FLEET_SIZE).fill(null), bench: Array(BENCH_SIZE).fill(null), shop: [], frozen: [], relics: [], relicOffer: [], history: [], phase: 'shop',
  };
  if (opts && CMD_MAP[opts.cmd]) {
    run.cmd = opts.cmd;
    run.passive = opts.passive;
    run.skin = opts.skin;
  }
  startRound(run);
  // Starting ship: paid for out of the first round's scrap, so it's a head start in direction, not power.
  const starter = opts?.starter && run.cmd ? SHIPS[CMD_MAP[run.cmd].starter] : null;
  if (starter) {
    run.fleet[0] = { def: starter.id, atk: starter.atk, hp: starter.hp, xp: 0 };
    run.scrap -= SHIP_COST;
  }
  return run;
}

export const runPassive = (run: Run) => (run.cmd ? `${run.cmd}.${run.passive ?? 'a'}` : '');

export function rollShopFor(s: RngState, round: number, deep = false): string[] {
  const cap = tierCap(round);
  // Deep scan: no tier 1 ships, and one tier above the normal cap.
  const maxT = deep ? Math.min(3, cap + 1) : cap;
  const minT = deep && maxT >= 2 ? 2 : 1;
  const pool = SHOP_SHIPS.filter((d) => d.tier >= minT && d.tier <= maxT);
  return Array.from({ length: shopSize(round) }, () => pick(s, pool).id);
}

/** New shop offers, keeping any frozen ships in their slots. */
function restock(run: Run, deep = false) {
  const fresh = rollShopFor(run, run.round, deep);
  const frozen = run.frozen ?? [];
  run.shop = fresh.map((def, i) => (frozen[i] && run.shop[i] ? run.shop[i] : def));
  run.frozen = run.shop.map((_, i) => !!frozen[i] && !!run.shop[i]);
}

export function startRound(run: Run) {
  run.scrap = ROUND_SCRAP + 2 * count(run.relics, 'salvage') + (runPassive(run) === 'vance.b' ? 1 : 0);
  run.powerUsed = false;
  restock(run);
}

/**
 * The commander's shop power. `slot` is the selected ship for targeted powers.
 * Returns an error message, or null on success.
 */
export function usePower(run: Run, slot: number | null): string | null {
  const c = run.cmd ? CMD_MAP[run.cmd] : null;
  if (!c) return 'No commander';
  if (run.powerUsed) return 'Already used this round';
  if (run.scrap < c.power.cost) return 'Not enough scrap';
  const target = slot === null ? null : slotGet(run, slot);
  if (c.power.target && !target) return 'Select one of your ships first';

  switch (c.id) {
    case 'vance': {
      if (target!.xp >= MAX_XP) return 'Already max level';
      const before = levelOf(target!.xp);
      target!.xp++;
      const gained = levelOf(target!.xp) - before;
      target!.atk += gained;
      target!.hp += gained;
      break;
    }
    case 'kael':
      target!.hp += 3;
      break;
    case 'orin':
      target!.atk += 1;
      break;
    case 'nyx': {
      const options = run.shop.map((d, i) => ({ d, i })).filter((o) => o.d);
      if (!options.length) return 'The shipyard is empty';
      const pickOne = options[Math.floor(rand(run) * options.length)];
      const refund = shipCost(pickOne.d!, run.round);
      run.scrap += refund; // quickBuy charges the normal price; Plunder makes it free
      const err = quickBuy(run, pickOne.i);
      if (err) {
        run.scrap -= refund;
        return err;
      }
      break;
    }
    case 'ryx': {
      const ships = run.fleet.filter(Boolean) as FleetShip[];
      if (!ships.length) return 'Your fleet is empty';
      const s = ships[Math.floor(rand(run) * ships.length)];
      s.atk++;
      s.hp++;
      break;
    }
    case 'juno':
      if (run.shop.length && run.shop.every((_, i) => run.frozen?.[i])) return 'Everything is frozen';
      restock(run, true);
      break;
    default:
      return 'Unknown power';
  }
  run.scrap -= c.power.cost;
  run.powerUsed = true;
  return null;
}

export function reroll(run: Run): string | null {
  if (run.scrap < REROLL_COST) return 'Not enough scrap';
  if (run.shop.length && run.shop.every((_, i) => run.frozen?.[i])) return 'Everything is frozen';
  run.scrap -= REROLL_COST;
  restock(run);
  return null;
}

export function toggleFreeze(run: Run, i: number) {
  if (!run.shop[i]) return;
  run.frozen = run.shop.map((_, k) => (k === i ? !run.frozen?.[k] : !!run.frozen?.[k]));
}

/** Merge a copy (stats atk/hp, xp) into target. Level-ups give a +1/+1 bonus. */
export function mergeInto(target: FleetShip, atk: number, hp: number, xp: number) {
  const before = levelOf(target.xp);
  target.atk = Math.max(target.atk, atk) + 1;
  target.hp = Math.max(target.hp, hp) + 1;
  target.xp = Math.min(MAX_XP, target.xp + xp + 1);
  const gained = levelOf(target.xp) - before;
  target.atk += gained;
  target.hp += gained;
}

export const canMerge = (target: FleetShip | null | undefined, def: string) =>
  !!target && target.def === def && target.xp < MAX_XP;

// Slots are numbered 0..FLEET_SIZE-1 for the fleet, then FLEET_SIZE.. for the bench.
// Benched ships don't fight, don't count for synergies and aren't in snapshots.
export const TOTAL_SLOTS = FLEET_SIZE + BENCH_SIZE;
export const isBench = (slot: number) => slot >= FLEET_SIZE;

export function slotGet(run: Run, slot: number): FleetShip | null {
  if (!isBench(slot)) return run.fleet[slot] ?? null;
  return run.bench?.[slot - FLEET_SIZE] ?? null;
}

function slotSet(run: Run, slot: number, ship: FleetShip | null) {
  if (!isBench(slot)) {
    run.fleet[slot] = ship;
    return;
  }
  if (!run.bench) run.bench = Array(BENCH_SIZE).fill(null);
  run.bench[slot - FLEET_SIZE] = ship;
}

const allSlots = () => Array.from({ length: TOTAL_SLOTS }, (_, i) => i);

export function buy(run: Run, shopIdx: number, slot: number): string | null {
  const def = run.shop[shopIdx];
  if (!def) return null;
  const cost = shipCost(def, run.round);
  if (run.scrap < cost) return 'Not enough scrap';
  const target = slotGet(run, slot);
  if (target && !canMerge(target, def)) return target.def === def ? 'Already max level' : 'Slot taken';
  run.scrap -= cost;
  run.shop[shopIdx] = null;
  if (run.frozen) run.frozen[shopIdx] = false;
  const d = SHIPS[def];
  if (target) mergeInto(target, d.atk, d.hp, 0);
  else slotSet(run, slot, { def, atk: d.atk, hp: d.hp, xp: 0 });
  return null;
}

/** Buy into the best slot: merge with a matching ship, else first empty fleet slot, else the bench. */
export function quickBuy(run: Run, shopIdx: number): string | null {
  const def = run.shop[shopIdx];
  if (!def) return null;
  const slots = allSlots();
  let slot = slots.find((i) => canMerge(slotGet(run, i), def));
  if (slot === undefined) slot = slots.find((i) => !slotGet(run, i));
  if (slot === undefined) return 'Fleet and bench are full';
  return buy(run, shopIdx, slot);
}

export function move(run: Run, from: number, to: number): string | null {
  if (from === to) return null;
  const a = slotGet(run, from);
  const b = slotGet(run, to);
  if (!a) return null;
  if (b && b.def === a.def && b.xp < MAX_XP && a.xp < MAX_XP) {
    mergeInto(b, a.atk, a.hp, a.xp);
    slotSet(run, from, null);
    return null;
  }
  slotSet(run, to, a);
  slotSet(run, from, b);
  return null;
}

export const sellValue = (run: Run, s: FleetShip) => levelOf(s.xp) + count(run.relics, 'magnet');

export function sell(run: Run, slot: number): string | null {
  const s = slotGet(run, slot);
  if (!s) return null;
  run.scrap += sellValue(run, s);
  slotSet(run, slot, null);
  return null;
}

export function makeSnapshot(run: Run, name = 'You'): Snapshot {
  return {
    v: 1, id: `${run.runId}-r${run.round}`, runId: run.runId, name, round: run.round,
    wins: run.wins, lives: run.lives, fleet: run.fleet.map((s) => (s ? { ...s } : null)),
    relics: [...run.relics], createdAt: Date.now(),
    cmd: run.cmd ? { id: run.cmd, p: run.passive ?? 'a' } : undefined,
  };
}

export function rollRelicOffer(s: RngState, owned: string[], n = 3): string[] {
  // Prefer relics the player does not own yet; stacking is allowed once the pool runs dry.
  const fresh = RELICS.filter((r) => !owned.includes(r.id)).map((r) => r.id);
  const pool = fresh.length >= n ? fresh : RELICS.map((r) => r.id);
  const out: string[] = [];
  while (out.length < n && out.length < pool.length) {
    const id = pool[Math.floor(rand(s) * pool.length)];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function applyResult(run: Run, winner: 0 | 1 | -1) {
  const o: Outcome = winner === 0 ? 'W' : winner === 1 ? 'L' : 'D';
  run.history.push(o);
  if (o === 'W') run.wins++;
  if (o === 'L') run.lives--;
  if (run.wins >= WIN_TARGET || run.lives <= 0) {
    run.phase = 'over';
  } else {
    run.phase = 'relic';
    run.relicOffer = rollRelicOffer(run, run.relics);
  }
}

export function chooseRelic(run: Run, id: string) {
  run.relics.push(id);
  run.relicOffer = [];
  run.round++;
  run.phase = 'shop';
  startRound(run);
}
