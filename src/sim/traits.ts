// Fleet synergies. Each DIFFERENT ship type in your fleet counts once toward
// its classes, so you are rewarded for variety, not for stacking copies.

import { SHIPS, type ShipClass } from './ships';
import type { FleetShip } from './types';

export interface TraitDef {
  id: ShipClass;
  name: string;
  color: string;
  tiers: { n: number; desc: string }[];
}

export const TRAITS: TraitDef[] = [
  {
    id: 'strike', name: 'STRIKE', color: '#ff9f43',
    tiers: [{ n: 2, desc: 'Strike ships +1 ATK, +2 HP.' }, { n: 4, desc: 'Strike ships +4 ATK, +4 HP, 1 tick faster.' }],
  },
  {
    id: 'guard', name: 'GUARD', color: '#7fe7ff',
    tiers: [{ n: 2, desc: 'Guard ships +5 HP.' }, { n: 3, desc: 'Guard ships +9 HP and a shield.' }],
  },
  {
    id: 'artillery', name: 'ARTILLERY', color: '#ff5e7e',
    tiers: [{ n: 2, desc: 'Artillery +2 ATK.' }, { n: 3, desc: 'Artillery +2 ATK, fires 3 ticks early.' }],
  },
  {
    id: 'tech', name: 'TECH', color: '#7dff8a',
    tiers: [{ n: 2, desc: 'Tech ships attack 1 tick faster.' }, { n: 4, desc: 'Tech ships faster, all ships +3 HP.' }],
  },
];

export const TRAIT_MAP = Object.fromEntries(TRAITS.map((t) => [t.id, t])) as Record<ShipClass, TraitDef>;

export function traitCounts(fleet: readonly (FleetShip | null)[]): Record<ShipClass, number> {
  const counts: Record<ShipClass, number> = { strike: 0, guard: 0, artillery: 0, tech: 0 };
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
