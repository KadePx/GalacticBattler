// What each fleet ship actually fights with, and where its bonuses come from.
// Uses the real battle code to set up a fight against an empty side, so the shop
// can never disagree with the battle. Nothing here changes the battle rules.

import { simulate } from '../sim/battle';
import type { Snapshot } from '../sim/types';
import { makeSnapshot, type Run } from './run';

export interface BattleStats { atk: number; hp: number; shield: number }
export interface Gain { atk: number; hp: number; shield: number }

const NONE: Gain = { atk: 0, hp: 0, shield: 0 };
export const hasGain = (g: Gain) => g.atk > 0 || g.hp > 0 || g.shield > 0;
/** "+2/+3", "+1 SH" and so on, for small labels. */
export function gainLabel(g: Gain): string {
  const parts: string[] = [];
  if (g.atk > 0 && g.hp > 0) parts.push(`+${g.atk}/+${g.hp}`);
  else if (g.atk > 0) parts.push(`+${g.atk} ATK`);
  else if (g.hp > 0) parts.push(`+${g.hp} HP`);
  if (g.shield > 0) parts.push(`+${g.shield}SH`);
  return parts.join(' ');
}

/**
 * Stands in for a ship we take away: it keeps its place in the line (so the ships around
 * it don't shift into new neighbours), but has no class and no ability.
 */
const STAND_IN = { def: 'fighter', atk: 0, hp: 1, xp: 0 };

/**
 * Battle-start stats for each fleet slot (null where empty). Round 1 is used so the
 * numbers show bonuses only, not the later rounds' hull scaling.
 */
export function battleStats(base: Snapshot): (BattleStats | null)[] {
  const me: Snapshot = { ...base, round: 1 };
  const empty: Snapshot = { ...base, id: 'preview-empty', round: 1, fleet: [], relics: [], cmd: undefined, salute: undefined, bench: 0, reserve: undefined };
  const units = simulate(me, empty).units.filter((u) => u.side === 0);
  // Fleet ships come first, in fleet order (empty slots skipped); fighters follow.
  let k = 0;
  return base.fleet.map((s) => {
    if (!s) return null;
    const u = units[k++];
    return u ? { atk: u.atk, hp: u.maxHp, shield: u.shield } : null;
  });
}

const diff = (a: BattleStats | null, b: BattleStats | null): Gain =>
  a && b ? { atk: Math.max(0, a.atk - b.atk), hp: Math.max(0, a.hp - b.hp), shield: Math.max(0, a.shield - b.shield) } : NONE;

export interface Combos {
  stats: BattleStats;
  /** Total bonus over the ship's own stats. */
  total: Gain;
  /** What each other fleet ship adds to this one (synergies, auras, neighbours). */
  partners: { slot: number; gain: Gain }[];
  /** What each relic adds (one entry per relic id). */
  relics: { id: string; gain: Gain }[];
  /** What the commander's passive (and power) adds. */
  commander: Gain;
}

/** Everything that boosts the ship in fleet slot `i`, found by taking each piece away. */
export function combosFor(run: Run, i: number): Combos | null {
  const ship = run.fleet[i];
  if (!ship) return null;
  const snap = makeSnapshot(run);
  const full = battleStats(snap)[i];
  if (!full) return null;
  const without = (patch: Partial<Snapshot>) => battleStats({ ...snap, ...patch })[i];

  const partners: Combos['partners'] = [];
  run.fleet.forEach((other, j) => {
    if (!other || j === i) return;
    const fleet = snap.fleet.map((s, k) => (k === j ? STAND_IN : s));
    const gain = diff(full, without({ fleet }));
    if (hasGain(gain)) partners.push({ slot: j, gain });
  });

  const relics: Combos['relics'] = [];
  for (const id of new Set(snap.relics)) {
    const gain = diff(full, without({ relics: snap.relics.filter((r) => r !== id) }));
    if (hasGain(gain)) relics.push({ id, gain });
  }

  const commander = diff(full, without({ cmd: undefined, salute: undefined }));
  const total = { atk: Math.max(0, full.atk - ship.atk), hp: Math.max(0, full.hp - ship.hp), shield: full.shield };
  return { stats: full, total, partners, relics, commander };
}

/** Battle-start stats for the whole fleet, for the slot labels. */
export const fleetBattleStats = (run: Run) => battleStats(makeSnapshot(run));

