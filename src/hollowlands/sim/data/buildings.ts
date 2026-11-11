// Building templates. Each is a small floor plan; the colony's planner picks where they go.
// # wall  + door  . floor  , open ground  = fence  g gate
// b bed  t table  c chair  h hearth  s stove  w workbench  a anvil  f forge  x crate  r barrel
// A altar  p pew  l loom  W well  e shelf  o sickbed  S statue

import { B } from '../types';

export interface Tpl {
  k: string;
  name: string;
  rows: string[];
  wood: number;
  stone: number;
  /** colonist-hours to build at average skill */
  work: number;
}

const tpl = (k: string, name: string, wood: number, stone: number, work: number, rows: string[]): Tpl => ({ k, name, rows, wood, stone, work });

export const TPL_LIST: Tpl[] = [
  tpl('cottage', 'Cottage', 14, 2, 14, [
    '####',
    '#bx#',
    '#.c#',
    '#+##',
  ]),
  tpl('house', 'House', 22, 4, 22, [
    '#####',
    '#b.b#',
    '#...#',
    '#x.c#',
    '##+##',
  ]),
  tpl('bighouse', 'Family house', 32, 6, 32, [
    '#######',
    '#b.b.b#',
    '#.....#',
    '#bx.tc#',
    '###+###',
  ]),
  tpl('longhouse', 'Longhouse', 40, 6, 40, [
    '#########',
    '#b.b.b.b#',
    '#.......#',
    '#b.h..xb#',
    '####+####',
  ]),
  tpl('hall', 'Great hall', 50, 12, 55, [
    '#########',
    '#sx...xh#',
    '#.......#',
    '#ctc.ctc#',
    '#ctc.ctc#',
    '#.......#',
    '####+####',
  ]),
  tpl('store', 'Storehouse', 26, 4, 24, [
    '######',
    '#xxxx#',
    '#....#',
    '#xx.r#',
    '##+###',
  ]),
  tpl('tavern', 'Tavern', 40, 8, 42, [
    '########',
    '#rr.ctc#',
    '#......#',
    '#ctc..h#',
    '#...ctc#',
    '###+####',
  ]),
  tpl('shrine', 'Shrine', 24, 14, 34, [
    '#####',
    '#.A.#',
    '#...#',
    '#p.p#',
    '#p.p#',
    '##+##',
  ]),
  tpl('smithy', 'Smithy', 22, 16, 32, [
    '######',
    '#f.a.#',
    '#....#',
    '#x.w.#',
    '##+###',
  ]),
  tpl('workshop', 'Workshop', 26, 4, 28, [
    '######',
    '#w.l.#',
    '#....#',
    '#x.w.#',
    '##+###',
  ]),
  tpl('infirmary', 'Infirmary', 26, 6, 30, [
    '######',
    '#o.o.#',
    '#....#',
    '#o.ex#',
    '##+###',
  ]),
  tpl('well', 'Well', 2, 10, 10, [
    ',,,',
    ',W,',
    ',,,',
  ]),
  tpl('field', 'Field', 0, 0, 12, [
    ',,,,,,,,',
    ',,,,,,,,',
    ',,,,,,,,',
    ',,,,,,,,',
    ',,,,,,,,',
    ',,,,,,,,',
    ',,,,,,,,',
  ]),
  tpl('graveyard', 'Graveyard', 12, 2, 12, [
    '=======',
    '=,,,,,=',
    '=,,,,,=',
    '=,,,,,=',
    '=,,,,,=',
    '===g===',
  ]),
];

export const TPL: Record<string, Tpl> = Object.fromEntries(TPL_LIST.map((x) => [x.k, x]));

export const HOMES = ['cottage', 'house', 'bighouse', 'longhouse'];

export interface Cell { dx: number; dy: number; ch: string }

const cellCache = new Map<string, Cell[]>();

/** Every cell of a template in the order it gets built: walls and fences, then floors, then furniture. */
export function cells(k: string): Cell[] {
  let out = cellCache.get(k);
  if (out) return out;
  const t = TPL[k];
  const walls: Cell[] = [];
  const floors: Cell[] = [];
  const furn: Cell[] = [];
  for (let dy = 0; dy < t.rows.length; dy++) {
    for (let dx = 0; dx < t.rows[dy].length; dx++) {
      const ch = t.rows[dy][dx];
      if (ch === ' ') continue;
      const cell = { dx, dy, ch };
      if (ch === '#' || ch === '+' || ch === '=' || ch === 'g') walls.push(cell);
      else if (ch === '.' || ch === ',') floors.push(cell);
      else furn.push(cell);
    }
  }
  out = [...walls, ...floors, ...furn];
  cellCache.set(k, out);
  return out;
}

/** Template cells holding a given piece of furniture, e.g. spots('hall', 'c') for the chairs. */
export function spots(k: string, ch: string): Cell[] {
  return cells(k).filter((c) => ch.includes(c.ch));
}

const FURN: Record<string, number> = {
  b: B.BED, t: B.TABLE, c: B.CHAIR, h: B.HEARTH, s: B.STOVE, w: B.BENCH, a: B.ANVIL, f: B.FORGE, x: B.CRATE, r: B.BARREL,
  A: B.ALTAR, p: B.PEW, l: B.LOOM, W: B.WELL, e: B.SHELF, o: B.COT, S: B.STATUE,
};

/** What a template cell becomes on the map. Floors lie under furniture, so furniture reports itself. */
export function cellCode(k: string, ch: string, mat: number): number {
  if (ch === '#') return mat ? B.WALL_STONE : B.WALL_WOOD;
  if (ch === '+' || ch === 'g') return B.DOOR;
  if (ch === '=') return B.FENCE;
  if (ch === '.') return mat ? B.FLOOR_STONE : B.FLOOR_WOOD;
  if (ch === ',') return k === 'field' ? B.TILLED : B.NONE;
  return FURN[ch] ?? B.NONE;
}

export interface CropDef { k: string; name: string; res: 'grain' | 'veg' | 'cloth'; days: number; yield: number; sow: number[] }

export const CROPS: Record<string, CropDef> = {
  grain: { k: 'grain', name: 'Barley', res: 'grain', days: 24, yield: 4.4, sow: [0] },
  veg: { k: 'veg', name: 'Roots and greens', res: 'veg', days: 13, yield: 2.3, sow: [0, 1] },
  flax: { k: 'flax', name: 'Flax', res: 'cloth', days: 20, yield: 0.5, sow: [0] },
};
