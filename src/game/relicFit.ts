// How well a relic fits the current fleet, so the relic pick screen can point
// out combos ("boosts your Lance and Torpedo") and which ships it touches.

import { count } from '../sim/relics';
import { SHIPS } from '../sim/ships';
import type { FleetShip } from '../sim/types';
import type { Run } from './run';
import { TRAIT_MAP, traitCounts } from '../sim/traits';
import type { ShipClass } from '../sim/ships';
import { drillTargets } from './run';
import { REWARD_MAP } from './rewards';

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
  const fighterMakers = shipsOf(fleet, ['carrier', 'queen', 'brood']);
  // Slurms' Brood Nest fighters are plain on purpose, so they don't count here.
  const fighterSources = fighterMakers.length + count(run.relics, 'hangar');

  const targeted = (defs: string[]): RelicFit => {
    const slots = shipsOf(fleet, defs);
    return slots.length
      ? { kind: 'combo', slots, note: `Boosts your ${names(fleet, slots)}` }
      : { kind: 'none', slots: [], note: 'None in your fleet yet' };
  };

  const special = REWARD_MAP[id];
  if (special) {
    if (id === 'x:drill') {
      return { kind: 'econ', slots: drillTargets(fleet), note: special.note };
    }
    return { kind: 'econ', slots: [], note: special.note };
  }
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
    case 'banner_c':
    case 'banner_r':
    case 'banner_v': {
      const f: ShipClass = id === 'banner_c' ? 'concord' : id === 'banner_r' ? 'reaver' : 'void';
      const have = traitCounts(fleet, run.relics)[f];
      const slots = fleet.map((s, i) => (s && SHIPS[s.def].classes.includes(f) ? i : -1)).filter((i) => i >= 0);
      const next = TRAIT_MAP[f].tiers.find((t) => have < t.n)?.n;
      if (next && have + 1 >= next) return { kind: 'combo', slots, note: `Unlocks ${TRAIT_MAP[f].short} (${next})` };
      return slots.length
        ? { kind: 'all', slots, note: `${TRAIT_MAP[f].short} ${have} -> ${have + 1}` }
        : { kind: 'none', slots: [], note: `No ${TRAIT_MAP[f].short} ships yet` };
    }
    case 'minefield': {
      const layers = shipsOf(fleet, ['minelayer']);
      return layers.length
        ? { kind: 'combo', slots: layers, note: 'More mines up front' }
        : { kind: 'all', slots: front, note: 'Soaks the first enemy shot' };
    }
    case 'trophy': {
      const killers = shipsOf(fleet, ['scrapper', 'ravager', 'lance', 'phantom', 'eclipse', 'corsair']);
      return killers.length
        ? { kind: 'combo', slots: killers, note: `Combos with your ${names(fleet, killers)}` }
        : { kind: 'all', slots: all, note: 'Kills make ships stronger' };
    }
    case 'napalm':
    case 'gyro': {
      const slots = id === 'napalm'
        ? fleet.map((s, i) => (s && SHIPS[s.def].classes.includes('artillery') ? i : -1)).filter((i) => i >= 0)
        : fleet.map((s, i) => (s && s.xp >= 5 ? i : -1)).filter((i) => i >= 0);
      if (slots.length) return { kind: 'combo', slots, note: `Boosts your ${names(fleet, slots)}` };
      return { kind: 'none', slots: [], note: id === 'napalm' ? 'No artillery ships yet' : 'No level 3 ships yet' };
    }
    case 'ablative':
      return { kind: 'all', slots: front, note: front.length ? `Armors your ${names(fleet, front)}` : 'Armors your front ship' };
    case 'beacon':
      return { kind: 'all', slots: all, note: 'Turns a loss into a rally' };
    case 'reserves': {
      const benched = (run.bench ?? []).find(Boolean);
      return benched
        ? { kind: 'combo', slots: [], note: `Your ${SHIPS[benched.def].name} waits in reserve` }
        : { kind: 'none', slots: [], note: 'Needs a ship on your bench' };
    }
    case 'bounty':
      return { kind: 'econ', slots: [], note: 'Pays for every kill' };
    case 'insurance':
      return { kind: 'econ', slots: [], note: 'Softens a loss' };
    case 'dice':
      return { kind: 'econ', slots: [], note: 'Cheaper rerolls' };
    case 'salvage':
      return { kind: 'econ', slots: [], note: 'More ships each round' };
    case 'magnet':
      return { kind: 'econ', slots: [], note: 'Better when you sell often' };
    default:
      return { kind: 'all', slots: [], note: '' };
  }
}
