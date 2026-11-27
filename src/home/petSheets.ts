// Layout of the cat sprite sheets in public/home/pets (made with PixelLab, facing right).
// One animation per row, frames left to right, every cell `cell` pixels square, feet on the same line.

export type Anim = 'walk' | 'idle' | 'eat' | 'lick' | 'loaf' | 'yawn';
interface Sheet { cell: number; rows: { anim: Anim; frames: number }[] }

const ROWS: Sheet['rows'] = [
  { anim: 'walk', frames: 6 }, { anim: 'idle', frames: 8 }, { anim: 'eat', frames: 7 },
  { anim: 'lick', frames: 12 }, { anim: 'loaf', frames: 10 }, { anim: 'yawn', frames: 11 },
];
export const SHEETS: Record<'korra' | 'kaia', Sheet> = { korra: { cell: 64, rows: ROWS }, kaia: { cell: 64, rows: ROWS } };
