// Layout of the cat sprite sheets in public/home/pets (made with PixelLab, facing right).
// One animation per row, frames left to right, every cell `cell` pixels square, feet on the same line.

export type Anim = 'walk' | 'idle' | 'eat' | 'lick' | 'loaf' | 'yawn';
interface Sheet { cell: number; rows: { anim: Anim; frames: number }[] }

const ROWS: Sheet['rows'] = [
  { anim: 'walk', frames: 6 }, { anim: 'idle', frames: 8 }, { anim: 'eat', frames: 7 },
  { anim: 'lick', frames: 12 }, { anim: 'loaf', frames: 10 }, { anim: 'yawn', frames: 11 },
];
export const SHEETS: Record<'korra' | 'kaia', Sheet> = { korra: { cell: 64, rows: ROWS }, kaia: { cell: 64, rows: ROWS } };

/** Room furniture in public/home/pets/props (also PixelLab), sizes in sprite pixels. */
export const PROPS = {
  tree: { w: 74, h: 108 }, plant: { w: 68, h: 112 }, shelf: { w: 85, h: 109 }, basket: { w: 60, h: 32 }, bedteal: { w: 60, h: 31 },
  bowlteal: { w: 50, h: 30 }, bowlpink: { w: 51, h: 28 }, yarn: { w: 41, h: 45 }, menu: { w: 47, h: 59 },
  swatch: { w: 58, h: 49 }, box: { w: 63, h: 48 },
} as const;
export type PropId = keyof typeof PROPS;

/** Lying down and sleeping lives in its own sheet per cat (<name>-sleep.png): one row, wider cells. */
export const SLEEP = { cell: 80, frames: 9 };
