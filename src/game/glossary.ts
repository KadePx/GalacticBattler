// Plain-language definitions for game terms, shown in detail cards and the
// Fleet Archive. `match` finds the term inside ship / relic / synergy text, so
// a card can explain exactly the words it uses. Keep definitions true to the sim.

export interface Term {
  id: string;
  name: string;
  desc: string;
  match?: RegExp;
}

export const TERMS: Term[] = [
  {
    id: 'tick', name: 'TICK', match: /\btick/i,
    desc: 'Battles run in ticks. A ship marked "every 5T" attacks once every 5 ticks, so a lower number means a faster ship.',
  },
  {
    id: 'shield', name: 'SHIELD', match: /shield/i,
    desc: 'Blocks the next hit completely, then is used up. Piercing shots and zaps ignore shields.',
  },
  {
    id: 'pierce', name: 'PIERCE', match: /pierce/i,
    desc: 'The shot ignores shields and hits the hull directly.',
  },
  {
    id: 'cloak', name: 'CLOAK', match: /cloak/i,
    desc: 'A cloaked ship can\'t be targeted while any visible ally is still alive. Attacking reveals it.',
  },
  {
    id: 'ambush', name: 'AMBUSH', match: /ambush/i,
    desc: 'An attack made while cloaked. The Phantom\'s ambush deals double damage.',
  },
  {
    id: 'jam', name: 'JAM / STUN', match: /\bjam|stun/i,
    desc: 'Pushes the target\'s next attack back by a few ticks. Ion Cruiser jams also drain 1 of its ATK.',
  },
  {
    id: 'ram', name: 'RAM', match: /\bram/i,
    desc: 'When the Interceptor is destroyed, it crashes into an enemy for damage equal to its ATK.',
  },
  {
    id: 'fighter', name: 'FIGHTER', match: /fighter/i,
    desc: 'A small ship launched behind your line during battle. Not bought, no synergy. Torpedoes and Lances skip fighters (and mines and Echoes), and losing one doesn\'t trigger on-death effects.',
  },
  {
    id: 'zap', name: 'ZAP', match: /\bzap/i,
    desc: 'Damage fired back at an attacker when one of your shields blocks a hit. Zaps pierce shields.',
  },
  {
    id: 'rebuild', name: 'REBUILD', match: /rebuild/i,
    desc: 'Instead of being destroyed, the ship comes back with some HP. Counts as a loss for on-death effects.',
  },
  {
    id: 'reload', name: 'RELOAD', match: /reload/i,
    desc: 'The ship attacks again on the very next tick.',
  },
  {
    id: 'line', name: 'FRONT / BEHIND', match: /\bfront\b|rearmost|behind|neighbor/i,
    desc: 'Your fleet fights in a line. The front ship (rightmost in the shop) is shot first. "Behind" means toward the back of the line.',
  },
  {
    id: 'start', name: 'BATTLE START', match: /battle start|starts (with|shielded)/i,
    desc: 'Happens once, before anyone fires.',
  },
  {
    id: 'down', name: 'GOES DOWN', match: /goes down|ally lost|per ally|on death|dies/i,
    desc: 'When a ship is destroyed (or rebuilds). Triggers Salvagers (either side), Interceptors, Heralds, Vengeance and Reavers. Fighters, mines and Echoes don\'t count.',
  },
  {
    id: 'mark', name: 'MARK', match: /\bmark/i,
    desc: 'A marked enemy takes extra damage from every hit your fleet lands on it, for the rest of the battle.',
  },
  {
    id: 'mine', name: 'MINE', match: /\bmine/i,
    desc: 'A 1-HP charge placed in front of your line. Enemies shoot it first; when destroyed it explodes on the front enemy. Explosions grow in later rounds.',
  },
  {
    id: 'cleave', name: 'CLEAVE', match: /cleave/i,
    desc: 'The attack also hits the next enemy in line.',
  },
  {
    id: 'kill', name: 'KILL', match: /\bkill/i,
    desc: 'When this ship\'s shot destroys an enemy ship. Fighters and mines don\'t count.',
  },
  {
    id: 'faction', name: 'FACTIONS', match: /concord|reaver|\bvoid\b/i,
    desc: 'Every ship has a faction: Concord (shields, marks), Reavers (kills, mines) or Void (life-steal, echoes). Stacks with class bonuses.',
  },
  {
    id: 'blink', name: 'BLINK / MISS', match: /blink|\bmiss/i,
    desc: 'The next hit on this ship misses completely. Zaps and explosions can\'t be dodged.',
  },
  {
    id: 'heal', name: 'LIFE-STEAL', match: /heals? (itself|it )|heal \d+%|heal \+\d per hit/i,
    desc: 'The ship repairs itself when its shots deal damage, up to its starting HP.',
  },
  {
    id: 'drain', name: 'DRAIN', match: /drains?\b/i,
    desc: 'Permanently lowers the target\'s ATK for this battle.',
  },
  {
    id: 'thorns', name: 'THORNS', match: /thorns|deal \d back|hits it takes/i,
    desc: 'Whenever an enemy shot lands on this ship, the attacker takes damage back. Thorns pierce shields and never chain.',
  },
  {
    id: 'drag', name: 'DRAG', match: /drags?\b/i,
    desc: 'Moves an enemy from the back of its line to the front before the battle starts, so it gets shot first.',
  },
  {
    id: 'echo', name: 'ECHO', match: /\becho/i,
    desc: 'A Void copy that fights at the back of your line. Battle-only: not bought, no synergy, doesn\'t trigger on-death effects.'
  },
  {
    id: 'endless', name: 'ENDLESS',
    desc: 'After winning a run you can keep going. Enemies keep getting stronger; the run ends when your hull runs out. Endless wins pay extra XP.',
  },
  // General terms (shown in the archive; no auto-match).
  {
    id: 'merge', name: 'MERGE / LEVEL',
    desc: 'Drop a ship on a copy of itself to merge them: it gets stronger and gains XP. 2 XP makes level 2, 5 XP makes level 3. Levels unlock perks.',
  },
  {
    id: 'tier', name: 'TIER',
    desc: 'How advanced a ship is. Tier 2 ships appear from round 3 and tier 3 from round 5. Shown as T1/T2/T3 with a coloured border.',
  },
  {
    id: 'synergy', name: 'SYNERGY',
    desc: 'Each DIFFERENT ship in your fleet counts once toward its classes. Reach the numbers shown to unlock class bonuses.',
  },
  {
    id: 'bench', name: 'BENCH',
    desc: 'Spare slots on the left of the shop. Benched ships keep their levels but don\'t fight or count for synergy.',
  },
  {
    id: 'hull', name: 'HULL SCALING',
    desc: 'From round 5, every ship gets extra HP in battle (x1.2, then x1.4 and so on) so later fights don\'t end instantly.',
  },
  {
    id: 'overload', name: 'REACTOR OVERLOAD',
    desc: 'After tick 80 every shot deals extra damage, growing over time, so no battle can last forever.',
  },
  {
    id: 'freeze', name: 'FREEZE',
    desc: 'Keeps a shipyard ship through rerolls and into the next round so you can buy it later. Free.',
  },
  {
    id: 'relic', name: 'RELIC',
    desc: 'A permanent upgrade for the rest of the run. You pick one after every battle. Copies of the same relic stack.',
  },
];

/** Terms that appear in the given text, in glossary order, without duplicates. */
export function termsIn(...texts: string[]): Term[] {
  const all = texts.join(' ');
  return TERMS.filter((t) => t.match && t.match.test(all));
}
