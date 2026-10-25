// Bot opponents: a bot plays through the same shop rules as the player,
// round by round, and its fleet is frozen into a snapshot. Used when no
// ghost of a real player is available for this round.
//
// Each bot follows a build archetype so opponents feel different from each
// other, and each archetype doubles as a template for a player playstyle.

import { SHIPS, levelOf, MAX_XP } from '../sim/ships';
import { count } from '../sim/relics';
import { hashStr, pick, rand, type RngState } from '../sim/rng';
import type { FleetShip, Snapshot } from '../sim/types';
import { FLEET_SIZE, ROUND_SCRAP, SHIP_COST, REROLL_COST, mergeInto, rollShopFor, rollRelicOffer } from './run';

export interface Archetype {
  id: string;
  label: string; // shown in the battle header
  titles: string[];
  core: string[]; // ships this build wants
  relics: string[]; // relics this build prefers
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'swarm', label: 'SWARM FLEET', titles: ['Hive Mother', 'Swarmlord', 'Brood Captain'],
    core: ['carrier', 'queen', 'salvager', 'command', 'scout'], relics: ['squadron', 'hangar', 'vengeance', 'targeting'],
  },
  {
    id: 'fortress', label: 'FORTRESS FLEET', titles: ['Warden', 'Castellan', 'Iron Admiral'],
    core: ['bulwark', 'aegis', 'reflector', 'revenant', 'drone', 'dread'], relics: ['matrix', 'plating', 'nanites'],
  },
  {
    id: 'artillery', label: 'ARTILLERY FLEET', titles: ['Gunnery Chief', 'Bombardier', 'Siegemaster'],
    core: ['torpedo', 'lance', 'siege', 'dread', 'bulwark'], relics: ['warheads', 'alpha', 'plating'],
  },
  {
    id: 'blitz', label: 'BLITZ FLEET', titles: ['Ace', 'Wing Commander', 'Speed Demon'],
    core: ['scout', 'raider', 'phantom', 'gunboat', 'command'], relics: ['overclock', 'alpha', 'targeting'],
  },
  {
    id: 'martyr', label: 'MARTYR FLEET', titles: ['Zealot', 'Death Captain', 'Scrap Prophet'],
    core: ['interceptor', 'salvager', 'revenant', 'carrier', 'raider'], relics: ['vengeance', 'hangar', 'squadron'],
  },
  {
    id: 'control', label: 'CONTROL FLEET', titles: ['Tactician', 'Jammer Queen', 'Signal Chief'],
    core: ['ion', 'drone', 'command', 'aegis', 'lance'], relics: ['jammer', 'overclock', 'nanites'],
  },
  {
    id: 'balanced', label: 'RAIDER', titles: ['Captain', 'Corsair', 'Commodore'],
    core: [], relics: [],
  },
];

const NAMES = ['Vex', 'Nyx', 'Korr', 'Talon', 'Ryn', 'Zed', 'Mox', 'Skarn', 'Ilya', 'Drax', 'Quill', 'Juno', 'Sable', 'Orin'];

// Lower = closer to the front.
const FRONT_PRIORITY: Record<string, number> = {
  bulwark: 0, aegis: 0.5, reflector: 0.8, revenant: 1, dread: 1, gunboat: 2, raider: 2, interceptor: 1.5,
  carrier: 3, ion: 3, command: 3, scout: 4, phantom: 4, salvager: 4.5, lance: 5, queen: 5.5,
  torpedo: 6, siege: 6, drone: 6,
};

/** Extra scrap bots get in later rounds, so the back half of a run stays a challenge. */
export const botBonusScrap = (round: number) => (round >= 10 ? 2 : round >= 6 ? 1 : 0);

export function botSnapshot(seed: number, round: number, archetypeId?: string, bonus = true): Snapshot {
  const s: RngState = { rng: seed };
  const arch = ARCHETYPES.find((a) => a.id === archetypeId) ?? pick(s, ARCHETYPES);
  const fleet: FleetShip[] = [];
  const relics: string[] = [];

  for (let r = 1; r <= round; r++) {
    let scrap = ROUND_SCRAP + 2 * count(relics, 'salvage') + (bonus ? botBonusScrap(r) : 0);
    let shop: (string | null)[] = rollShopFor(s, r);
    let rerolls = 0;
    while (scrap >= SHIP_COST) {
      const idx = chooseBuy(s, shop, fleet, arch);
      if (idx >= 0) {
        const def = shop[idx]!;
        shop[idx] = null;
        scrap -= SHIP_COST;
        const d = SHIPS[def];
        const match = fleet.find((f) => f.def === def && f.xp < MAX_XP);
        if (match) mergeInto(match, d.atk, d.hp, 0);
        else {
          if (fleet.length >= FLEET_SIZE) {
            const weakest = weakestIndex(fleet, arch);
            scrap += levelOf(fleet[weakest].xp);
            fleet.splice(weakest, 1);
          }
          fleet.push({ def, atk: d.atk, hp: d.hp, xp: 0 });
        }
      } else if (scrap >= SHIP_COST + REROLL_COST && rerolls < 3) {
        scrap -= REROLL_COST;
        rerolls++;
        shop = rollShopFor(s, r);
      } else break;
    }
    if (r < round) {
      const offer = rollRelicOffer(s, relics);
      relics.push(offer.find((id) => arch.relics.includes(id)) ?? pick(s, offer));
    }
  }

  fleet.sort((a, b) => (FRONT_PRIORITY[a.def] ?? 3) - (FRONT_PRIORITY[b.def] ?? 3) || b.hp - a.hp);
  const padded: (FleetShip | null)[] = [...fleet];
  while (padded.length < FLEET_SIZE) padded.push(null);

  const wins = Math.floor((round - 1) * (0.35 + rand(s) * 0.4));
  return {
    v: 1, id: `bot-${seed}-${round}`, runId: 'bot', name: `${pick(s, arch.titles)} ${pick(s, NAMES)}`,
    round, wins, lives: 5, fleet: padded, relics, createdAt: 0, style: arch.label,
  };
}

/** Deterministic bot for a given run and round. */
export const botFor = (runId: string, round: number) => botSnapshot(hashStr(`${runId}:${round}:bot`), round);

const power = (f: FleetShip, arch: Archetype) =>
  f.atk + f.hp + SHIPS[f.def].tier * 4 + (arch.core.includes(f.def) ? 10 : 0);

function weakestIndex(fleet: FleetShip[], arch: Archetype) {
  let w = 0;
  fleet.forEach((f, i) => { if (power(f, arch) < power(fleet[w], arch)) w = i; });
  return w;
}

function chooseBuy(s: RngState, shop: (string | null)[], fleet: FleetShip[], arch: Archetype): number {
  const options = shop.map((d, i) => ({ d, i })).filter((o) => o.d) as { d: string; i: number }[];
  if (!options.length) return -1;
  const merge = options.find((o) => fleet.some((f) => f.def === o.d && f.xp < MAX_XP));
  if (merge) return merge.i;
  const fresh = (def: string): FleetShip => ({ def, atk: SHIPS[def].atk, hp: SHIPS[def].hp, xp: 0 });
  if (fleet.length < FLEET_SIZE) {
    // Prefer the archetype's ships, higher tiers, and shared classes (synergy).
    const owned = new Set(fleet.flatMap((f) => SHIPS[f.def].classes));
    const score = (def: string) =>
      SHIPS[def].tier * 8 + (arch.core.includes(def) ? 14 : 0) +
      SHIPS[def].classes.filter((c) => owned.has(c)).length * 4 + rand(s) * 6;
    return options.reduce((best, o) => (score(o.d) > score(best.d) ? o : best)).i;
  }
  // Fleet full: only replace the weakest ship with something clearly better for this build.
  const weakest = fleet[weakestIndex(fleet, arch)];
  const upgrade = options.find((o) => power(fresh(o.d), arch) > power(weakest, arch) + 2);
  return upgrade ? upgrade.i : -1;
}
