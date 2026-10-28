// Run state and shop rules: buying, merging, selling, rerolling, results.

import { PROTOTYPES, SHIPS, SHOP_SHIPS, MAX_XP, levelOf, shopSize, tierCap, xpForNext } from '../sim/ships';
import { count } from '../sim/relics';
import { hashStr, pick, rand, type RngState } from '../sim/rng';
import type { FleetShip, Snapshot } from '../sim/types';
import { CMD_MAP, type PassiveSlot } from '../sim/commanders';
import { isReward, rollRewardOffer } from './rewards';

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
/** Hull points repaired when a won run continues into endless mode. */
export const ENDLESS_REPAIR = 2;

export type Phase = 'shop' | 'relic' | 'over';

/** Shipyard events: about one round in three, from round 2. */
export type ShopEvent = 'sale' | 'supply' | 'veteran' | 'elite' | 'rolls';
export const EVENT_INFO: Record<ShopEvent, { name: string; desc: string }> = {
  sale: { name: 'FIRE SALE', desc: 'ships cost 2 this round.' },
  supply: { name: 'SUPPLY DROP', desc: '+3 scrap this round.' },
  veteran: { name: 'VETERAN', desc: 'one ship is level 2 (costs 5).' },
  elite: { name: 'ELITE DEALER', desc: 'one ship is a tier higher.' },
  rolls: { name: 'OPEN MARKET', desc: '2 free rerolls this round.' },
};
export const VETERAN_COST = 5;
export const SALE_COST = 2;
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
  // XP already paid for this run (an endless run can pay out a second time).
  xpAwarded?: { pilotBefore: number; cmdBefore: number; paid?: number; last?: number };
  // Endless: keep playing after a win; the run only ends when the hull runs out.
  endless?: boolean;
  endlessFrom?: number; // history length when endless started
  // One-time bonuses from special rewards, used up at the start of the next round.
  boost?: { scrap?: number; market?: boolean };
  market?: number; // Black Market: free higher-tier rerolls left this round
  freeRolls?: number; // Loaded Dice: free rerolls left this round
  event?: ShopEvent; // this round's shipyard event, if any
  vetSlot?: number; // Veteran for Hire: the shop slot holding a level 2 ship
  notice?: string; // shown once in the shop (what a special reward just did)
  nextOpp?: Snapshot; // an online player's fleet fetched for this round (snapshot PvP)
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

/** Prospectors in the fleet (not the bench) pay 1/3/5 scrap a round by level, so merging never costs income. */
export const prospectorScrap = (fleet: (FleetShip | null)[]) =>
  fleet.reduce((n, f) => n + (f && f.def === 'prospector' ? [0, 1, 3, 5][levelOf(f.xp)] : 0), 0);

export const runPassive = (run: Run) => (run.cmd ? `${run.cmd}.${run.passive ?? 'a'}` : '');

/**
 * A fresh shipyard. 'deep' (Black Market): no tier 1, and one tier above the normal cap.
 * 'scan' (Juno's Deep Scan): no tier 1 ships, but never above the normal cap.
 */
export function rollShopFor(s: RngState, round: number, deep: boolean | 'scan' = false): string[] {
  const cap = tierCap(round);
  const maxT = deep === true ? Math.min(3, cap + 1) : cap;
  const minT = deep && maxT >= 2 ? 2 : 1;
  const pool = SHOP_SHIPS.filter((d) => d.tier >= minT && d.tier <= maxT);
  return Array.from({ length: shopSize(round) }, () => pick(s, pool).id);
}

/** New shop offers, keeping any frozen ships in their slots. */
function restock(run: Run, deep: boolean | 'scan' = false) {
  const fresh = rollShopFor(run, run.round, deep);
  const frozen = run.frozen ?? [];
  run.shop = fresh.map((def, i) => (frozen[i] && run.shop[i] ? run.shop[i] : def));
  run.frozen = run.shop.map((_, i) => !!frozen[i] && !!run.shop[i]);
  if (run.vetSlot !== undefined && !run.frozen[run.vetSlot]) run.vetSlot = undefined;
}

export function startRound(run: Run) {
  run.scrap = ROUND_SCRAP + 2 * count(run.relics, 'salvage') + (runPassive(run) === 'vance.b' ? 1 : 0) + (run.boost?.scrap ?? 0) + prospectorScrap(run.fleet);
  run.powerUsed = false;
  restock(run, !!run.boost?.market);
  run.market = run.boost?.market ? 2 : 0;
  run.freeRolls = 2 * count(run.relics, 'dice');
  rollEvent(run);
  run.boost = undefined;
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
      const refund = costAt(run, pickOne.i);
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
      restock(run, 'scan');
      break;
    case 'sera':
    case 'nihl': {
      // Replace a random unfrozen shipyard slot with a random faction ship you could normally see.
      const faction = c.id === 'sera' ? 'concord' : 'void';
      const slots = run.shop.map((_, i) => i).filter((i) => !run.frozen?.[i]);
      if (!slots.length) return 'Everything is frozen';
      const pool = SHOP_SHIPS.filter((d) => d.classes.includes(faction) && d.tier <= tierCap(run.round));
      const k = slots[Math.floor(rand(run) * slots.length)];
      run.shop[k] = pick(run, pool).id;
      if (run.vetSlot === k) run.vetSlot = undefined;
      break;
    }
    case 'tess': {
      // REFIT: turn the ship into a random other ship of the same tier, keeping its level and bonuses.
      const old = SHIPS[target!.def];
      if (old.tier === 4) return 'Prototypes can\'t be refit';
      // Never into a type you already have (copies that can't merge would be a trap).
      const owned = new Set([...run.fleet, ...(run.bench ?? [])].filter(Boolean).map((f) => f!.def));
      const pool = SHOP_SHIPS.filter((d) => d.tier === old.tier && !owned.has(d.id));
      if (!pool.length) return 'Nothing to refit into';
      const nu = pick(run, pool);
      target!.atk = Math.max(nu.atk, nu.atk + (target!.atk - old.atk));
      target!.hp = Math.max(nu.hp, nu.hp + (target!.hp - old.hp));
      target!.def = nu.id;
      break;
    }
    case 'grisk': {
      const reavers = new Set(run.fleet.filter((f) => f && SHIPS[f.def].classes.includes('reaver')).map((f) => f!.def)).size;
      if (reavers < 2) return 'Needs 2 different Reaver ships';
      run.scrap += 1;
      break;
    }
    default:
      return 'Unknown power';
  }
  run.scrap -= c.power.cost;
  run.powerUsed = true;
  return null;
}

export function reroll(run: Run): string | null {
  if (run.market && !(run.shop.length && run.shop.every((_, i) => run.frozen?.[i]))) {
    run.market--;
    restock(run, true);
    return null;
  }
  if (run.scrap < REROLL_COST && !run.freeRolls) return 'Not enough scrap';
  if (run.shop.length && run.shop.every((_, i) => run.frozen?.[i])) return 'Everything is frozen';
  if (run.freeRolls) run.freeRolls--;
  else run.scrap -= REROLL_COST;
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
  const cost = costAt(run, shopIdx);
  if (run.scrap < cost) return 'Not enough scrap';
  const vet = run.vetSlot === shopIdx;
  const target = slotGet(run, slot);
  if (target && !canMerge(target, def)) return target.def === def ? 'Already max level' : 'Slot taken';
  run.scrap -= cost;
  run.shop[shopIdx] = null;
  if (run.frozen) run.frozen[shopIdx] = false;
  const d = SHIPS[def];
  // A veteran is a level 2 ship: what two merges would make (+3/+3, 2 XP).
  const atk = d.atk + (vet ? 3 : 0);
  const hp = d.hp + (vet ? 3 : 0);
  if (vet) run.vetSlot = undefined;
  if (target) mergeInto(target, atk, hp, vet ? 2 : 0);
  else slotSet(run, slot, { def, atk, hp, xp: vet ? 2 : 0 });
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

function firstBenched(run: Run): FleetShip | undefined {
  const r = (run.bench ?? []).find(Boolean);
  return r ? { ...r } : undefined;
}

export function makeSnapshot(run: Run, name = 'You'): Snapshot {
  return {
    v: 1, id: `${run.runId}-r${run.round}`, runId: run.runId, name, round: run.round,
    wins: run.wins, lives: run.lives, fleet: run.fleet.map((s) => (s ? { ...s } : null)),
    relics: [...run.relics], createdAt: Date.now(),
    cmd: run.cmd ? { id: run.cmd, p: run.passive ?? 'a' } : undefined,
    bench: (run.bench ?? []).filter(Boolean).length,
    reserve: firstBenched(run),
  };
}

export function applyResult(run: Run, winner: 0 | 1 | -1, kills = 0) {
  const o: Outcome = winner === 0 ? 'W' : winner === 1 ? 'L' : 'D';
  run.history.push(o);
  run.nextOpp = undefined;
  // Scrap relics that pay out next round.
  const bounty = count(run.relics, 'bounty') * Math.min(3, kills);
  const insured = o === 'L' ? 4 * count(run.relics, 'insurance') : 0;
  if (bounty + insured) {
    run.boost = { ...run.boost, scrap: (run.boost?.scrap ?? 0) + bounty + insured };
    addNotice(run, `+${bounty + insured} SCRAP FROM ${bounty && insured ? 'RELICS' : bounty ? 'BOUNTIES' : 'INSURANCE'}`);
  }
  if (o === 'W') run.wins++;
  if (o === 'L') run.lives--;
  if ((!run.endless && run.wins >= WIN_TARGET) || run.lives <= 0) {
    run.phase = 'over';
  } else {
    run.phase = 'relic';
    run.relicOffer = rewardOffer(run);
  }
}

function rewardOffer(run: Run): string[] {
  const ships = allSlots().map((i) => slotGet(run, i)).filter(Boolean) as FleetShip[];
  return rollRewardOffer(run, run.relics, {
    round: run.round,
    lostLast: run.history[run.history.length - 1] === 'L',
    canRecruit: ships.length < TOTAL_SLOTS,
    canDrill: drillTargets(run.fleet).length > 0,
    canRepair: run.lives < START_LIVES,
  });
}

/** After a won run: keep the same fleet going in endless mode (starts with a relic pick). */
export function goEndless(run: Run) {
  run.endless = true;
  run.endlessFrom = run.history.length;
  run.lives = Math.min(START_LIVES, run.lives + ENDLESS_REPAIR); // a fresh start for the long haul
  run.phase = 'relic';
  run.relicOffer = rewardOffer(run);
}

/** Why the commander's power can't be used right now (beyond cost / once a round), or null. */
export function powerProblem(run: Run): string | null {
  if (run.cmd === 'grisk') {
    const reavers = new Set(run.fleet.filter((f) => f && SHIPS[f.def].classes.includes('reaver')).map((f) => f!.def)).size;
    if (reavers < 2) return 'NO REAVERS';
  }
  return null;
}

/** Wins earned after switching to endless. */
export const endlessWins = (run: Run) => (run.endless ? run.history.slice(run.endlessFrom ?? 0).filter((o) => o === 'W').length : 0);

/** Top-bar label: "WINS 3/10", or "ENDLESS 14W" once endless. */
export const winsLabel = (run: Run) => (run.endless ? `ENDLESS ${run.wins}W` : `WINS ${run.wins}/${WIN_TARGET}`);

export function chooseRelic(run: Run, id: string) {
  if (isReward(id)) applyReward(run, id);
  else run.relics.push(id);
  run.relicOffer = [];
  run.round++;
  run.phase = 'shop';
  startRound(run);
}

/** Give a ship 1 XP; a level-up adds +1/+1 like a merge does. */
export function train(f: FleetShip) {
  if (f.xp >= MAX_XP) return;
  const before = levelOf(f.xp);
  f.xp++;
  const gained = levelOf(f.xp) - before;
  f.atk += gained;
  f.hp += gained;
}

/** A free ship for a Recruit Contract: best tier you can buy next round, sharing a class with your fleet if possible. */
export function recruitShip(s: RngState, fleet: (FleetShip | null)[], round: number): string {
  const tier = tierCap(round + 1);
  const pool = SHOP_SHIPS.filter((d) => d.tier === tier);
  const classes = new Set(fleet.filter(Boolean).flatMap((f) => SHIPS[f!.def].classes));
  const fits = pool.filter((d) => d.classes.some((c) => classes.has(c)));
  return pick(s, fits.length ? fits : pool).id;
}

export function applyReward(run: Run, id: string) {
  const slots = allSlots();
  switch (id) {
    case 'x:recruit':
    case 'x:proto': {
      const def = id === 'x:proto' ? prototypeShip(run, [...run.fleet, ...(run.bench ?? [])]) : recruitShip(run, run.fleet, run.round);
      const d = SHIPS[def];
      const twin = slots.find((i) => canMerge(slotGet(run, i), def));
      // The first empty fleet slot, then the bench.
      const free = slots.find((i) => !slotGet(run, i));
      if (twin !== undefined) mergeInto(slotGet(run, twin)!, d.atk, d.hp, 0);
      else {
        if (free === undefined) run.boost = { ...run.boost, scrap: (run.boost?.scrap ?? 0) + SHIP_COST };
        else slotSet(run, free, { def, atk: d.atk, hp: d.hp, xp: 0 });
      }
      addNotice(run, `${d.name.toUpperCase()} ${twin !== undefined ? 'MERGED INTO YOURS' : free !== undefined && isBench(free) ? 'JOINED YOUR BENCH' : 'JOINED YOUR FLEET'}`);
      break;
    }
    case 'x:drill': {
      for (const i of drillTargets(run.fleet)) drill(run.fleet[i]!);
      addNotice(run, 'COMBAT DRILLS: 3 SHIPS +1 XP, +1/+1');
      break;
    }
    case 'x:cache':
      run.boost = { ...run.boost, scrap: (run.boost?.scrap ?? 0) + 7 };
      addNotice(run, '+7 SCRAP FROM SCRAP CACHE');
      break;
    case 'x:market':
      run.boost = { ...run.boost, market: true };
      addNotice(run, 'BLACK MARKET: 2 FREE REROLLS');
      break;
    case 'x:repair':
      run.lives = Math.min(START_LIVES, run.lives + 1);
      addNotice(run, 'HULL REPAIRED');
      break;
  }
}

/** Combat Drills: up to 3 fleet ships below max level, closest to their next level first. */
export function drillTargets(fleet: (FleetShip | null)[]): number[] {
  const toNext = (f: FleetShip) => (xpForNext(f.xp) ?? 99) - f.xp;
  return fleet.map((f, i) => (f && f.xp < MAX_XP ? i : -1)).filter((i) => i >= 0)
    .sort((a, b) => toNext(fleet[a]!) - toNext(fleet[b]!) || a - b).slice(0, 3);
}

/** +1 XP and +1/+1 (a level-up adds its usual +1/+1 on top). */
export function drill(f: FleetShip) {
  train(f);
  f.atk++;
  f.hp++;
}

/** A Prototype reward: one you don't own yet if possible. */
export function prototypeShip(s: RngState, owned: (FleetShip | null)[]): string {
  const have = new Set(owned.filter(Boolean).map((f) => f!.def));
  const fresh = PROTOTYPES.filter((d) => !have.has(d.id));
  return pick(s, fresh.length ? fresh : PROTOTYPES).id;
}

/** Queue a line for the next shop visit (several stack, one per line). */
function addNotice(run: Run, msg: string) {
  run.notice = run.notice ? `${run.notice}\n${msg}` : msg;
}

/** What a shipyard slot costs right now (events change prices). */
export function costAt(run: Run, i: number): number {
  const def = run.shop[i];
  if (!def) return SHIP_COST;
  if (run.vetSlot === i) return VETERAN_COST;
  if (run.event === 'sale') return Math.min(SALE_COST, shipCost(def, run.round));
  return shipCost(def, run.round);
}

/** Maybe start a shipyard event for this round (called from startRound, after restocking). */
function rollEvent(run: Run) {
  run.event = undefined;
  if (run.round < 2 || rand(run) >= 0.3) return;
  const open = run.shop.map((d, i) => (d && !run.frozen?.[i] ? i : -1)).filter((i) => i >= 0);
  const cap = tierCap(run.round);
  const options: ShopEvent[] = ['sale', 'supply'];
  if (open.length && run.vetSlot === undefined) options.push('veteran');
  options.push('rolls');
  if (open.length && cap < 3) options.push('elite');
  const ev = pick(run, options);
  run.event = ev;
  if (ev === 'supply') run.scrap += 3;
  if (ev === 'rolls') run.freeRolls = (run.freeRolls ?? 0) + 2;
  if (ev === 'veteran') run.vetSlot = pick(run, open);
  if (ev === 'elite') {
    const slot = pick(run, open);
    run.shop[slot] = pick(run, SHOP_SHIPS.filter((d) => d.tier === cap + 1)).id;
  }
}
