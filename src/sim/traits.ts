// Fleet synergies. Each DIFFERENT ship type in your fleet counts once toward
// its classes, so you are rewarded for variety, not for stacking copies.

import { SHIPS, type ShipClass } from './ships';
import type { FleetShip } from './types';
import { count } from './relics';

export interface TraitDef {
  id: ShipClass;
  name: string;
  short: string; // for tight spaces
  faction?: boolean;
  color: string;
  tiers: { n: number; desc: string }[];
}

export const TRAITS: TraitDef[] = [
  {
    id: 'strike', name: 'STRIKE', short: 'STRIKE', color: '#ff9f43',
    tiers: [{ n: 2, desc: 'Strike ships +1 ATK, +2 HP.' }, { n: 3, desc: 'Strike ships +2 ATK, +2 HP, 1 tick faster.' }],
  },
  {
    id: 'guard', name: 'GUARD', short: 'GUARD', color: '#7fe7ff',
    tiers: [{ n: 2, desc: 'Guard ships +5 HP.' }, { n: 3, desc: 'Guard ships +9 HP and a shield.' }],
  },
  {
    id: 'artillery', name: 'ARTILLERY', short: 'ARTY', color: '#ff5e7e',
    tiers: [{ n: 2, desc: 'Artillery +2 ATK.' }, { n: 3, desc: 'Artillery +2 ATK, fires 3 ticks early.' }],
  },
  {
    id: 'tech', name: 'TECH', short: 'TECH', color: '#7dff8a',
    tiers: [{ n: 2, desc: 'Tech ships attack 1 tick faster, +2 HP.' }, { n: 4, desc: 'Tech ships faster, all ships +3 HP.' }],
  },
  {
    id: 'concord', name: 'CONCORD', short: 'CONCORD', faction: true, color: '#a8c8ff',
    tiers: [{ n: 3, desc: 'Concord ships +2 HP.' }, { n: 5, desc: '+2 HP; the front 2 start shielded.' }],
  },
  {
    id: 'reaver', name: 'REAVERS', short: 'REAVERS', faction: true, color: '#ff8a4a',
    tiers: [{ n: 3, desc: '+2 HP. Enemy down: +1 ATK, repair 1.' }, { n: 5, desc: '+1/+2. Enemy down: +2 ATK, repair 2.' }],
  },
];

export const TRAIT_MAP = Object.fromEntries(TRAITS.map((t) => [t.id, t])) as Record<ShipClass, TraitDef>;

/** Distinct ships per class/faction. Banner relics each count as one more faction ship. */
export function traitCounts(fleet: readonly (FleetShip | null)[], relics: readonly string[] = []): Record<ShipClass, number> {
  const counts: Record<ShipClass, number> = { strike: 0, guard: 0, artillery: 0, tech: 0, concord: 0, reaver: 0 };
  counts.concord += count(relics, 'banner_c');
  counts.reaver += count(relics, 'banner_r');
  const seen = new Set<string>();
  for (const s of fleet) {
    if (!s || seen.has(s.def) || !SHIPS[s.def]) continue;
    seen.add(s.def);
    for (const c of SHIPS[s.def].classes) counts[c]++;
  }
  return counts;
}

/** 0 = inactive, 1 = first threshold reached, 2 = second threshold reached. */
export function traitLevel(id: ShipClass, count: number): number {
  const t = TRAIT_MAP[id];
  return t.tiers.filter((tier) => count >= tier.n).length;
}
