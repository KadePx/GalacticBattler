// Building templates. Each is a small floor plan; the colony's planner picks where they go.
// # wall  + door  . floor  , open ground  = fence  g gate
// b bed  t table  c chair  h hearth  s stove  w workbench  a anvil  f forge  x crate  r barrel
// A altar  p pew  l loom  W well  e shelf  o sickbed  S statue
// k cauldron  v brewing vat  n grain bin  d desk  K bookshelf  R weapon rack  T bath  C chess table
// D dartboard  m music bench  H drying rack  L lamp  u rug  O wardrobe

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
  // Buildings with one purpose: work done in them goes better
  tpl('kitchen', 'Kitchen', 24, 6, 26, [
    '######',
    '#sk.e#',
    '#....#',
    '#t.xr#',
    '##+###',
  ]),
  tpl('brewery', 'Brewhouse', 26, 6, 28, [
    '######',
    '#vv.r#',
    '#....#',
    '#vr.n#',
    '##+###',
  ]),
  tpl('granary', 'Granary', 28, 10, 26, [
    '######',
    '#nnnn#',
    '#....#',
    '#nn.x#',
    '##+###',
  ]),
  tpl('school', 'Schoolhouse', 30, 6, 32, [
    '#######',
    '#K.L.K#',
    '#.....#',
    '#dc.dc#',
    '#dc.dc#',
    '###+###',
  ]),
  tpl('guardhouse', 'Guardhouse', 24, 14, 30, [
    '######',
    '#RR.o#',
    '#....#',
    '#t.co#',
    '##+###',
  ]),
  tpl('herbalist', "Herbalist's hut", 18, 4, 20, [
    '#####',
    '#HkH#',
    '#...#',
    '#e.x#',
    '##+##',
  ]),
  tpl('bathhouse', 'Bathhouse', 26, 18, 36, [
    '#######',
    '#T.h.T#',
    '#.....#',
    '#T.c.T#',
    '###+###',
  ]),
  tpl('gamehall', 'Games hall', 34, 6, 34, [
    '#########',
    '#D.D..m.#',
    '#.......#',
    '#cCc.cCc#',
    '#.......#',
    '####+####',
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

/** What a building is for, in one line, for its card. */
export const PURPOSE: Record<string, string> = {
  hall: 'Where the colony eats together, and where the cooking is done until there is a kitchen.',
  store: "Keeps the colony's goods.",
  tavern: 'Ale, dice, songs and stories of an evening.',
  shrine: 'For prayer and sermons.',
  smithy: 'Ore is smelted and iron forged into tools and weapons here. Smithing goes a little faster at its own forge.',
  workshop: 'Clothes, goods to trade and, when iron is short, simple tools are made here.',
  infirmary: 'Sickbeds for the wounded and the ill.',
  kitchen: 'Cooks work faster here and turn out fine dishes more often.',
  brewery: 'Brewing goes much faster here. Hops from the fields make the grain go further.',
  granary: 'Grain, vegetables and hops keep more than twice as long with a granary.',
  school: 'Children come for lessons in the mornings; a teacher here teaches far better. Adults come to read.',
  guardhouse: 'Guards drill at the weapon racks and learn faster.',
  herbalist: 'Medicine is made much faster among the drying racks and the cauldron.',
  bathhouse: 'A hot bath lifts the mood and helps the sick shake off illness. The water is heated with wood.',
  gamehall: 'Chess, darts and music of an evening.',
  well: 'Fresh water.',
  graveyard: 'Where the dead are laid to rest.',
};

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
  k: B.CAULDRON, v: B.VAT, n: B.BIN, d: B.DESK, K: B.BOOKS, R: B.RACK, T: B.BATH, C: B.CHESS, D: B.DARTS, m: B.MUSIC, H: B.DRYRACK, L: B.LAMP, u: B.RUG, O: B.WARDROBE,
};

/** Things a home gains as it is made finer. They sit on floor tiles and are kept when the floor is relaid. */
export const DECOR: number[] = [B.RUG, B.WARDROBE, B.LAMP, B.BOOKS];
export const isDecor = (s: number): boolean => DECOR.includes(s);

/** What a template cell becomes on the map. Floors lie under furniture, so furniture reports itself. */
export function cellCode(k: string, ch: string, mat: number): number {
  if (ch === '#') return mat ? B.WALL_STONE : B.WALL_WOOD;
  if (ch === '+' || ch === 'g') return B.DOOR;
  if (ch === '=') return B.FENCE;
  if (ch === '.') return mat ? B.FLOOR_STONE : B.FLOOR_WOOD;
  if (ch === ',') return k === 'field' ? B.TILLED : B.NONE;
  return FURN[ch] ?? B.NONE;
}

export type CropRes = 'grain' | 'veg' | 'cloth' | 'hops' | 'herbs';

export interface CropDef {
  k: string; name: string; res: CropRes; days: number; yield: number;
  /** seasons it can be sown in */
  sow: number[];
  /** shrugs off frost and keeps growing slowly into the cold */
  hardy?: boolean;
  /** kept so old fields still grow, but never chosen again */
  old?: boolean;
  /** one line for the field's card */
  note: string;
}

export const CROPS: Record<string, CropDef> = {
  grain: { k: 'grain', name: 'Barley', res: 'grain', days: 22, yield: 4.2, sow: [0], note: 'Hardy grain for bread and ale.' },
  wheat: { k: 'wheat', name: 'Wheat', res: 'grain', days: 26, yield: 4.8, sow: [0], note: 'Slow, but the richest grain harvest.' },
  oats: { k: 'oats', name: 'Oats', res: 'grain', days: 18, yield: 3.4, sow: [0, 1], hardy: true, note: 'Quick grain that stands the cold.' },
  veg: { k: 'veg', name: 'Roots and greens', res: 'veg', days: 13, yield: 2.3, sow: [0, 1], old: true, note: 'A mixed vegetable patch.' },
  potato: { k: 'potato', name: 'Potatoes', res: 'veg', days: 18, yield: 3.8, sow: [0], note: 'Fills the larder and keeps well.' },
  cabbage: { k: 'cabbage', name: 'Cabbages', res: 'veg', days: 16, yield: 2.6, sow: [1, 2], hardy: true, note: 'Sown late; grows on into the first frosts.' },
  turnip: { k: 'turnip', name: 'Turnips', res: 'veg', days: 11, yield: 2.0, sow: [0, 1, 2], hardy: true, note: 'Fast and forgiving; can be sown almost any time.' },
  beans: { k: 'beans', name: 'Beans', res: 'veg', days: 15, yield: 2.4, sow: [0, 1], note: 'Good ground for whatever is sown after them.' },
  onion: { k: 'onion', name: 'Onions', res: 'veg', days: 20, yield: 2.4, sow: [0], note: 'They make any pot better.' },
  hops: { k: 'hops', name: 'Hops', res: 'hops', days: 22, yield: 1.8, sow: [0], note: 'For brewing: ale with hops goes further and tastes better.' },
  herb: { k: 'herb', name: 'Herb garden', res: 'herbs', days: 14, yield: 0.7, sow: [0, 1], note: 'Healing herbs, grown rather than hunted for.' },
  flax: { k: 'flax', name: 'Flax', res: 'cloth', days: 20, yield: 0.5, sow: [0], note: 'Spun into cloth for clothes.' },
};
