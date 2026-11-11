import type { RaceK, SkillK } from '../types';

export interface RaceDef {
  k: RaceK;
  name: string;
  plural: string;
  /** ages in game years */
  adult: number; old: number; max: number;
  /** multipliers on needs and body */
  appetite: number; sleep: number; speed: number; size: number; tough: number;
  /** chance to conceive, relative to humans, and days carrying a child */
  fert: number; preg: number;
  /** degrees of cold shrugged off */
  cold: number;
  sk: Partial<Record<SkillK, number>>;
  /** shifts to the personality axes: [axis, amount] */
  per: [number, number][];
  /** faiths this people tends to follow, most likely first */
  faiths: string[];
  /** playable at creation */
  playable: boolean;
  blurb: string;
}

export const RACES: Record<RaceK, RaceDef> = {
  human: {
    k: 'human', name: 'Human', plural: 'Humans', adult: 16, old: 55, max: 80,
    appetite: 1, sleep: 1, speed: 1, size: 1, tough: 1, fert: 1, preg: 40, cold: 0,
    sk: { social: 1 }, per: [[7, 0.3]], faiths: ['hearth', 'pale', 'hearth', 'green'], playable: true,
    blurb: 'Adaptable and quick to learn. Short lives, long ambitions.',
  },
  dwarf: {
    k: 'dwarf', name: 'Dwarf', plural: 'Dwarves', adult: 30, old: 150, max: 220,
    appetite: 1.05, sleep: 1, speed: 0.85, size: 0.9, tough: 1.35, fert: 0.45, preg: 50, cold: 4,
    sk: { mine: 3, smith: 3, build: 1, melee: 1 }, per: [[13, 0.5], [11, 0.4], [1, 0.2]], faiths: ['iron', 'iron', 'iron', 'hearth'], playable: true,
    blurb: 'Tough, stubborn miners and smiths. An oath is forever, and so is a grudge.',
  },
  elf: {
    k: 'elf', name: 'Elf', plural: 'Elves', adult: 60, old: 350, max: 500,
    appetite: 0.8, sleep: 0.6, speed: 1.1, size: 0.95, tough: 0.9, fert: 0.12, preg: 80, cold: 1,
    sk: { archery: 3, lore: 2, craft: 2, medic: 1 }, per: [[12, 0.3], [7, -0.2]], faiths: ['green', 'green', 'green', 'pale'], playable: true,
    blurb: 'Keen-eyed and long-lived. They need little sleep and watch their friends grow old.',
  },
  halfling: {
    k: 'halfling', name: 'Halfling', plural: 'Halflings', adult: 20, old: 80, max: 110,
    appetite: 1.3, sleep: 1.05, speed: 0.9, size: 0.6, tough: 0.85, fert: 1.1, preg: 36, cold: 0,
    sk: { cook: 3, social: 2, farm: 2 }, per: [[10, 0.5], [0, 0.3], [3, 0.3]], faiths: ['hearth', 'hearth', 'hearth', 'green'], playable: true,
    blurb: 'Small, lucky and fond of comfort. Great cooks, great gossips, always hungry.',
  },
  orc: {
    k: 'orc', name: 'Orc', plural: 'Orcs', adult: 12, old: 40, max: 55,
    appetite: 1.2, sleep: 0.9, speed: 1, size: 1.3, tough: 1.4, fert: 1.2, preg: 30, cold: 6,
    sk: { melee: 4, animal: 1, mine: 1 }, per: [[1, 0.5], [6, 0.5], [0, -0.2]], faiths: ['teeth', 'teeth', 'teeth', 'iron'], playable: true,
    blurb: 'Strong, hardy and quick to heal. Honour is counted in scars. Few trust them.',
  },
  goblin: {
    k: 'goblin', name: 'Goblin', plural: 'Goblins', adult: 8, old: 28, max: 40,
    appetite: 0.65, sleep: 0.9, speed: 1.1, size: 0.55, tough: 0.7, fert: 1.7, preg: 20, cold: 0,
    sk: { craft: 3, cook: 1, animal: 1 }, per: [[6, -0.5], [9, 0.5], [12, 0.4], [4, -0.3]], faiths: ['teeth', 'hearth', 'pale', 'hollow'], playable: true,
    blurb: 'Frail, clever tinkerers who eat almost anything. Despised, and used to it.',
  },
  halfelf: {
    k: 'halfelf', name: 'Half-elf', plural: 'Half-elves', adult: 24, old: 110, max: 160,
    appetite: 0.9, sleep: 0.8, speed: 1.05, size: 1, tough: 0.95, fert: 0.6, preg: 50, cold: 0,
    sk: { archery: 1, lore: 1, social: 1 }, per: [[12, 0.2]], faiths: ['green', 'hearth', 'pale'], playable: false,
    blurb: 'Born between two peoples and not quite at home with either.',
  },
  halforc: {
    k: 'halforc', name: 'Half-orc', plural: 'Half-orcs', adult: 14, old: 48, max: 68,
    appetite: 1.1, sleep: 0.95, speed: 1, size: 1.15, tough: 1.2, fert: 1.1, preg: 36, cold: 3,
    sk: { melee: 2, animal: 1 }, per: [[1, 0.25], [6, 0.3]], faiths: ['teeth', 'hearth', 'pale'], playable: false,
    blurb: 'Stronger than their human kin, gentler than their orc kin, doubted by both.',
  },
};

export const PLAYABLE: RaceK[] = ['human', 'dwarf', 'elf', 'halfling', 'orc', 'goblin'];

/** How a people sees another by default, before anyone has met. */
const VIEW: Record<string, number> = {
  'dwarf>elf': -10, 'elf>dwarf': -10,
  'human>orc': -8, 'orc>human': -5, 'elf>orc': -14, 'orc>elf': -8, 'dwarf>orc': -12, 'orc>dwarf': -4, 'halfling>orc': -12, 'orc>halfling': -6,
  'human>goblin': -14, 'dwarf>goblin': -18, 'elf>goblin': -16, 'halfling>goblin': -12, 'orc>goblin': -8,
  'goblin>human': -4, 'goblin>dwarf': -8, 'goblin>elf': -8, 'goblin>orc': -2,
  'human>halfling': 3, 'halfling>human': 3, 'human>elf': 2, 'halfling>elf': 4, 'elf>halfling': 3, 'dwarf>halfling': 3, 'halfling>dwarf': 3,
  'elf>halfelf': -4, 'human>halfelf': -2, 'orc>halforc': -6, 'human>halforc': -8, 'elf>halforc': -12, 'dwarf>halforc': -10, 'halfling>halforc': -8,
  'dwarf>halfelf': -6, 'goblin>halforc': -2, 'human>dwarf': 1, 'dwarf>human': 1,
};

export function raceView(a: RaceK, b: RaceK): number {
  if (a === b) return 6;
  return VIEW[a + '>' + b] ?? 0;
}

/** The child of two peoples, or null when the pairing bears no children. */
export function childRace(m: RaceK, f: RaceK): RaceK | null {
  if (m === f) return m;
  const pair = [m, f].sort().join('+');
  if (pair === 'elf+human' || pair === 'halfelf+human' || pair === 'elf+halfelf') return 'halfelf';
  if (pair === 'human+orc' || pair === 'halforc+human' || pair === 'halforc+orc') return 'halforc';
  return null;
}
