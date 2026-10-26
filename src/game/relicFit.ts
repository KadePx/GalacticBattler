// How well a relic fits the current fleet, so the relic pick screen can point
// out combos ("boosts your Lance and Torpedo") and which ships it touches.

import { count } from '../sim/relics';
import { SHIPS } from '../sim/ships';
import type { FleetShip } from '../sim/types';
import type { Run } from './run';

export type FitKind = 'combo' | 'all' | 'econ' | 'none';

export interface RelicFit {
  kind: FitKind;
  slots: number[]; // fleet slots (0 = front) the relic affects
  note: string; // short line for the card, under ~30 chars
}

const shipsOf = (fleet: (FleetShip | null)[], defs: string[]) =>
  fleet.map((s, i) => (s && defs.includes(s.def) ? i : -1)).filter((i) => i >= 0);

/** "Lance" for one kind of ship, "3 ships" for several, so notes stay within two short lines. */
const names = (fleet: (FleetShip | null)[], slots: number[]) => {
  const uniq = [...new Set(slots.map((i) => SHIPS[fleet[i]!.def].name))];
  return uniq.length === 1 ? uniq[0] : `${slots.length} ships`;
};

export function relicFit(id: string, run: Run): RelicFit {
  const fleet = run.fleet;
  const all = fleet.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const front = all.length ? [all[0]] : [];
  const fighterMakers = shipsOf(fleet, ['carrier', 'queen']);
  // Ryx's Brood Nest fighters are plain on purpose, so they don't count here.
  const fighterSources = fighterMakers.length + count(run.relics, 'hangar');

  const targeted = (defs: string[]): RelicFit => {
    const slots = shipsOf(fleet, defs);
    return slots.length
      ? { kind: 'combo', slots, note: `Boosts your ${names(fleet, slots)}` }
      : { kind: 'none', slots: [], note: 'None in your fleet yet' };
  };

  switch (id) {
    case 'targeting':
    case 'plating':
    case 'overclock':
    case 'alpha':
      return { kind: 'all', slots: all, note: all.length ? `Affects all ${all.length} ships` : 'Affects every ship' };
    case 'matrix':
      return { kind: 'all', slots: front, note: front.length ? `Shields your ${names(fleet, front)}` : 'Shields your front ship' };
    case 'warheads':
      return targeted(['torpedo', 'lance', 'siege']);
    case 'nanites':
      return targeted(['drone']);
    case 'jammer': {
      const ions = shipsOf(fleet, ['ion']);
      return ions.length
        ? { kind: 'combo', slots: ions, note: `Boosts your ${names(fleet, ions)}` }
        : { kind: 'all', slots: all, note: 'Every ship opens with a jam' };
    }
    case 'squadron':
      return fighterSources
        ? { kind: 'combo', slots: fighterMakers, note: 'Boosts your fighters' }
        : { kind: 'none', slots: [], note: 'You launch no fighters yet' };
    case 'hangar': {
      const sq = count(run.relics, 'squadron') > 0 || (run.cmd === 'ryx' && run.passive === 'b');
      return sq
        ? { kind: 'combo', slots: [], note: 'Combos with your fighter boosts' }
        : { kind: 'all', slots: [], note: 'Adds a ship to every battle' };
    }
    case 'vengeance': {
      const slots = shipsOf(fleet, ['salvager', 'revenant', 'interceptor']);
      return slots.length
        ? { kind: 'combo', slots, note: `Combos with your ${names(fleet, slots)}` }
        : { kind: 'all', slots: [], note: 'Best with many small ships' };
    }
    case 'salvage':
      return { kind: 'econ', slots: [], note: 'More ships each round' };
    case 'magnet':
      return { kind: 'econ', slots: [], note: 'Better when you sell often' };
    default:
      return { kind: 'all', slots: [], note: '' };
  }
}
