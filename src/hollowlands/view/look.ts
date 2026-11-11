// Appearance shared by the map figures and the portraits: palettes and the body shape of
// each people. Display only. A colonist's `look` holds indices; this file gives them colour.

import { TICKS_PER_YEAR } from '../config';
import { RACES } from '../sim/data/races';
import type { Look, RaceK } from '../sim/types';

/** Six skin tones per people, indexed by `look.skin`. */
export const SKIN: Record<string, number[]> = {
  human: [0xf3d2b3, 0xe8b98f, 0xd39c6e, 0xb97a50, 0x8d5a3b, 0x5e3b28],
  dwarf: [0xf0c9a8, 0xe3ad86, 0xd19a72, 0xbf8560, 0xa06c4c, 0x7c5138],
  elf: [0xf7e6d3, 0xefd6bd, 0xe2c3a0, 0xcfa97f, 0xa98466, 0xd9d2e6],
  halfling: [0xf5d6b8, 0xecc09a, 0xdba77c, 0xc48a5e, 0x9a6744, 0x6e4630],
  orc: [0x8fa07a, 0x7d9168, 0x6c8160, 0x5f7458, 0x7a8a82, 0x56664f],
  goblin: [0xa4c36a, 0x8fb558, 0x7ba24b, 0x93a84e, 0x6c9146, 0xb3c77e],
  halfelf: [0xf5dcc4, 0xeac6a3, 0xd9ad84, 0xc08d62, 0x956547, 0x664231],
  halforc: [0xb9ad88, 0xa69d78, 0x97946e, 0x868a62, 0x9c8d70, 0x747b5a],
};

/** Hair colours, indexed by `look.hairCol`. The last one is grey. */
export const HAIR = [0x1d1a1c, 0x3b2a20, 0x5c3d26, 0x7a4a2a, 0xa8542c, 0xd2a85a, 0xe9d9a6, 0xb9bcc4];
export const GREY = 7;

/** Outfit colours, indexed by `look.garb`. */
export const GARB = [0x4f6fa8, 0x8a4a4a, 0x4f8a62, 0x8a6f3f, 0x6a5a9a, 0x3f8a8a, 0xa86a8a, 0x6b7280];

export const EYES = [0x3b2a20, 0x4a6a8a, 0x4f7a4a, 0x6b5a3a, 0x2a2a30, 0x7a6a9a];

/** 0 round, 1 slightly pointed, 2 long and pointed, 3 big bat ears */
export type EarK = 0 | 1 | 2 | 3;

export interface Shape {
  /** overall size of the map figure */
  size: number;
  /** shoulder width multiplier */
  wide: number;
  ears: EarK;
  /** 0 none, 1 small, 2 big */
  tusks: 0 | 1 | 2;
  /** portrait head: half-width and half-height in a 64 box */
  hw: number; hh: number;
}

export const SHAPE: Record<string, Shape> = {
  human: { size: 1, wide: 1, ears: 0, tusks: 0, hw: 13, hh: 15.5 },
  dwarf: { size: 0.84, wide: 1.28, ears: 0, tusks: 0, hw: 14.5, hh: 14.5 },
  elf: { size: 1, wide: 0.84, ears: 2, tusks: 0, hw: 11.6, hh: 16 },
  halfling: { size: 0.72, wide: 1.02, ears: 1, tusks: 0, hw: 13, hh: 14 },
  orc: { size: 1.2, wide: 1.2, ears: 1, tusks: 2, hw: 15, hh: 16 },
  goblin: { size: 0.68, wide: 0.95, ears: 3, tusks: 0, hw: 13.5, hh: 12.5 },
  halfelf: { size: 1, wide: 0.92, ears: 1, tusks: 0, hw: 12.4, hh: 15.6 },
  halforc: { size: 1.1, wide: 1.1, ears: 1, tusks: 1, hw: 14, hh: 15.8 },
};

/** Life stage worked out from age alone, so it works for the dead as well. Matches sim STAGE. */
export function stageOfAge(race: RaceK, years: number): number {
  const R = RACES[race];
  if (years >= R.old) return 4;
  if (years >= R.adult) return 3;
  if (years >= R.adult * 0.65) return 2;
  if (years >= R.adult * 0.2) return 1;
  return 0;
}

/** Age in years at a given tick. */
export const yearsAt = (born: number, tick: number): number => (tick - born) / TICKS_PER_YEAR;

/** Hair goes grey late in life whatever colour it started. */
export function hairIndex(race: RaceK, look: Look, years: number): number {
  return years >= RACES[race].old * 0.85 ? GREY : look.hairCol;
}

export const skinOf = (race: RaceK, look: Look): number => {
  const list = SKIN[race] ?? SKIN.human;
  return list[look.skin % list.length];
};
export const garbOf = (look: Look): number => GARB[look.garb % GARB.length];

/** Mix two colours (0 = a, 1 = b). */
export function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
export const darken = (c: number, t: number): number => mix(c, 0x000000, t);
export const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);
export const css = (c: number): string => '#' + c.toString(16).padStart(6, '0');
