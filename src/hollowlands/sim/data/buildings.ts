// Building templates. Each is a small floor plan; the colony's planner picks where they go.
// # wall  + door  . floor  , open ground  = fence  g gate
// b bed  t table  c chair  h hearth  s stove  w workbench  a anvil  f forge  x crate  r barrel
// A altar  p pew  l loom  W well  e shelf  o sickbed  S statue
// k cauldron  v brewing vat  n grain bin  d desk  K bookshelf  R weapon rack  T bath  C chess table
// D dartboard  m music bench  H drying rack  L lamp  u rug  O wardrobe  Y brazier
// - low garden wall  % garden bed
// The castle: X castle wall  Z tower wall  P palisade  J throne  N banner  V tapestry  q hay
// (a space is outside the building: shapes need not be rectangles)
// A shack's floor is bare earth and its beds are straw; a townhouse's and a manor's floors are fine.

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
  // the poorest roof there is: a hut of rough boards on bare earth, straw to sleep on
  tpl('shack', 'Shack', 7, 0, 8, [
    '####',
    '#bb#',
    '#..#',
    '#+##',
  ]),
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
  // a narrow house of the inner streets, for a family doing well
  tpl('townhouse', 'Townhouse', 30, 12, 34, [
    '####',
    '#bb#',
    '#.u#',
    '#K.#',
    '#ch#',
    '#+##',
  ]),
  // a great family's house by the keep, with a walled garden in front
  tpl('manor', 'Manor', 70, 30, 80, [
    '#########',
    '#b.b.b.b#',
    '#.......#',
    '#K.u.u.O#',
    '#h..tc..#',
    '####+####',
    '-%%%,%%%-',
    '-%%%,%%%-',
    '----g----',
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
  // a lookout over the road: wardens see trouble coming from much further, and shoot from behind its walls
  tpl('tower', 'Watchtower', 16, 24, 30, [
    ' ### ',
    '#...#',
    '#.Y.#',
    '#...#',
    ' #+# ',
  ]),
  // fenced ground for the colony's beasts, with a trough
  tpl('pen', 'Animal pen', 16, 0, 14, [
    '=======',
    '=,,,,,=',
    '=,Q,,,=',
    '=,,,,,=',
    '=,,,,,=',
    '===g===',
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

/**
 * The castle on the rise, raised in stages, every part laid out on one 19 by 19 plan with its gate
 * toward the town (drawn here with the town to the south): a palisade and a timber hall first, then
 * the stone keep (great hall and throne, the lord's chambers, a chapel), then the curtain wall with
 * its corner towers and gatehouse, barracks where the timber hall stood, and stables.
 */
export const CASTLE_N = 19;
const C_SP = ' '.repeat(17);
export const CASTLE_TPL: Tpl[] = [
  tpl('palisade', 'Palisade', 70, 0, 55, ['P'.repeat(19), ...Array.from({ length: 17 }, () => 'P' + C_SP + 'P'), 'P'.repeat(9) + 'g' + 'P'.repeat(9)]),
  tpl('motte', 'Timber hall', 55, 0, 45, [
    '##+##',
    '#bNb#',
    '#b.b#',
    '#cth#',
    '#####',
  ]),
  tpl('keep', 'Keep', 60, 260, 300, [
    'XXXXXXXXX',
    'Xbbb#.A.X',
    'Xb.b#p.pX',
    'Xh.O#p.pX',
    'X#+###+#X',
    'XV.NJN.VX',
    'Xh.....hX',
    'Xctc.ctcX',
    'XXXX+XXXX',
  ]),
  tpl('curtain', 'Castle walls', 30, 300, 320, [
    'ZZZ' + 'X'.repeat(13) + 'ZZZ',
    'Z.Z' + ' '.repeat(13) + 'Z.Z',
    'Z+Z' + ' '.repeat(13) + 'Z+Z',
    ...Array.from({ length: 13 }, () => 'X' + C_SP + 'X'),
    'ZZZ' + ' '.repeat(13) + 'ZZZ',
    'Z.+' + ' '.repeat(13) + '+.Z',
    'ZZZXXXX     XXXXZZZ',
  ]),
  tpl('gatehouse', 'Gatehouse', 30, 80, 90, [
    'ZZgZZ',
    'Z.,.Z',
    'Z.,.Z',
    'ZZgZZ',
  ]),
  tpl('barracks', 'Barracks', 30, 50, 60, [
    '##+##',
    '#b.b#',
    '#bRb#',
    '#####',
  ]),
  tpl('stables', 'Stables', 50, 0, 45, [
    '##+##',
    '#q.Q#',
    '#qxQ#',
    '#####',
  ]),
];

/** Where each part stands on the castle's plan (gate to the south), and the stage that raises it. */
export const CASTLE_AT: Record<string, { x: number; y: number; stage: number; mat: number }> = {
  palisade: { x: 0, y: 0, stage: 1, mat: 0 },
  motte: { x: 1, y: 12, stage: 1, mat: 0 },
  keep: { x: 5, y: 2, stage: 2, mat: 1 },
  curtain: { x: 0, y: 0, stage: 3, mat: 1 },
  gatehouse: { x: 7, y: 15, stage: 3, mat: 1 },
  barracks: { x: 1, y: 12, stage: 3, mat: 1 },
  stables: { x: 13, y: 12, stage: 3, mat: 0 },
};
export const CASTLE_KINDS = new Set(Object.keys(CASTLE_AT));

/** A floor plan turned a quarter clockwise. */
export const turnRows = (rows: string[]): string[] => {
  const h = rows.length;
  const w = rows[0].length;
  const out: string[] = [];
  for (let y = 0; y < w; y++) {
    let s = '';
    for (let x = 0; x < h; x++) s += rows[h - 1 - x][y] ?? ' ';
    out.push(s);
  }
  return out;
};

export const TPL: Record<string, Tpl> = Object.fromEntries([...TPL_LIST, ...CASTLE_TPL].map((x) => [x.k, x]));
// each castle part turned to face its gate toward the town: '~r1' west, '~r2' north, '~r3' east
for (const t of CASTLE_TPL) {
  let rows = t.rows;
  for (let n = 1; n < 4; n++) {
    rows = turnRows(rows);
    TPL[t.k + '~r' + n] = { ...t, rows };
  }
}

/**
 * The town wall, raised in pieces round the octagon of the town plan's wall band (see walls.ts):
 * stretches of wall ('twall': a palisade of stakes behind a ditch, later rebuilt in stone), towers
 * ('wtower') and gates ('tgate': a timber gate in the palisade, later a stone gatehouse). A piece's
 * plan depends on its length and which way it runs, so every plan is made here up front: their costs
 * are the plan's own (a long stretch costs more than a short one), not the kind's. They are the
 * timber stage's costs: the stone asked for the stone stage is set when it is begun (walls.ts).
 *   twall~h<n> / ~v<n>: a straight run across or down; ~d<n> / ~a<n>: a diagonal run (down-right,
 *   down-left). wtower~s/e/n/w: a tower on a straight side, its door on the town side;
 *   wtower~se/ne/nw/sw: a smaller tower on a diagonal side. tgate~h/v: a timber gate in the
 *   palisade; tgate~H/V: the stone gatehouse; tgate~p: a postern, one gate wide.
 */
export const WALL_KINDS = new Set(['twall', 'wtower', 'tgate']);
export const WALL_MAX = 48;
{
  const add = (key: string, base: string, name: string, wood: number, stone: number, work: number, rows: string[]): void => {
    TPL[key] = tpl(base, name, wood, stone, work, rows);
  };
  add('twall', 'twall', 'Town wall', 3, 0, 1.6, ['P']);
  add('wtower', 'wtower', 'Wall tower', 10, 0, 40, ['Z+Z', 'Z.Z', 'ZZZ']);
  add('tgate', 'tgate', 'Town gate', 25, 0, 14, ['PgggP']);
  for (let n = 1; n <= WALL_MAX; n++) {
    const diag = (down: boolean): string[] => Array.from({ length: n }, (_, i) => { const col = down ? i : n - 1 - i; return ' '.repeat(col) + 'P' + ' '.repeat(n - 1 - col); });
    add('twall~h' + n, 'twall', 'Town wall', 2 * n, 0, 1.6 * n, ['P'.repeat(n)]);
    add('twall~v' + n, 'twall', 'Town wall', 2 * n, 0, 1.6 * n, Array.from({ length: n }, () => 'P'));
    add('twall~d' + n, 'twall', 'Town wall', 2 * n, 0, 1.6 * n, diag(true));
    add('twall~a' + n, 'twall', 'Town wall', 2 * n, 0, 1.6 * n, diag(false));
  }
  add('wtower~s', 'wtower', 'Wall tower', 10, 0, 40, ['Z+Z', 'Z.Z', 'ZZZ']);
  add('wtower~n', 'wtower', 'Wall tower', 10, 0, 40, ['ZZZ', 'Z.Z', 'Z+Z']);
  add('wtower~e', 'wtower', 'Wall tower', 10, 0, 40, ['ZZZ', '+.Z', 'ZZZ']);
  add('wtower~w', 'wtower', 'Wall tower', 10, 0, 40, ['ZZZ', 'Z.+', 'ZZZ']);
  add('wtower~se', 'wtower', 'Wall tower', 6, 0, 25, ['.Z', 'ZZ']);
  add('wtower~ne', 'wtower', 'Wall tower', 6, 0, 25, ['ZZ', '.Z']);
  add('wtower~nw', 'wtower', 'Wall tower', 6, 0, 25, ['ZZ', 'Z.']);
  add('wtower~sw', 'wtower', 'Wall tower', 6, 0, 25, ['Z.', 'ZZ']);
  add('tgate~h', 'tgate', 'Town gate', 25, 0, 14, ['PgggP']);
  add('tgate~v', 'tgate', 'Town gate', 25, 0, 14, ['P', 'g', 'g', 'g', 'P']);
  add('tgate~H', 'tgate', 'Gatehouse', 25, 0, 50, ['Z,,,Z', 'ZgggZ', 'Z,,,Z']);
  add('tgate~V', 'tgate', 'Gatehouse', 25, 0, 50, ['ZZZ', ',g,', ',g,', ',g,', 'ZZZ']);
  add('tgate~p', 'tgate', 'Postern', 6, 0, 4, ['g']);
}

/** What one piece of the town wall costs and takes to raise: its own plan's figures. */
export const wallCost = (b: { k: string; s?: string }): Tpl => TPL[b.s ?? b.k];

/**
 * Other floor plans for some kinds of building, so a colony is not all boxes. Keys are
 * 'kind~name'; each also comes mirrored ('~m'). Same kind, same cost, different shape.
 */
const OTHER_SHAPES: Record<string, string[]> = {
  'shack~lean': [
    '#####',
    '#b.b#',
    '##+##',
  ],
  'townhouse~b': [
    '####',
    '#bK#',
    '#..#',
    '#ub#',
    '#.h#',
    '#+##',
  ],
  'manor~court': [
    '-----------',
    '-%#######%-',
    '-%#b.b.b#%-',
    '-%#.u.u.#%-',
    '-%#b.h.K#%-',
    '-%#t.c.O#%-',
    '-%###+###%-',
    '-%%%,,,%%%-',
    '-----g-----',
  ],
  'cottage~oct': [
    ' #### ',
    '#b..x#',
    '#..c.#',
    ' #+## ',
  ],
  'house~l': [
    '####   ',
    '#b.#   ',
    '#..####',
    '#x...b#',
    '#c....#',
    '###+###',
  ],
  'house~t': [
    ' ##### ',
    '##b.b##',
    '#.....#',
    '#x...c#',
    '###+###',
  ],
  'bighouse~l': [
    '   #####',
    '   #b.b#',
    '####...#',
    '#b.....#',
    '#x.tc..#',
    '####+###',
  ],
  'bighouse~u': [
    '###   ###',
    '#b#####b#',
    '#.......#',
    '#b..tc.x#',
    '####+####',
  ],
  'hall~t': [
    '###########',
    '#sx.....xh#',
    '#ctc...ctc#',
    '#.........#',
    '##ctc.ctc##',
    ' #.......# ',
    ' ####+#### ',
  ],
  'shrine~x': [
    '  ###  ',
    '###A###',
    '#p...p#',
    '#p...p#',
    '###.###',
    '  #+#  ',
  ],
  'tavern~l': [
    '#######   ',
    '#rr..h#   ',
    '#.....####',
    '#ctc.....#',
    '#...ctc..#',
    '#####+####',
  ],
  'store~l': [
    '#####  ',
    '#xxx#  ',
    '#...###',
    '#xx..r#',
    '##+####',
  ],
  'workshop~l': [
    '######  ',
    '#w.l.#  ',
    '#....###',
    '#x.w...#',
    '##+#####',
  ],
};

/** Every shape a kind of building can take (its own first). */
export const SHAPES: Record<string, string[]> = {};
for (const [key, rows] of Object.entries(OTHER_SHAPES)) {
  const k = key.split('~')[0];
  const base = TPL[k];
  const mirrored = rows.map((r) => [...r].reverse().join(''));
  for (const [name, plan] of [[key, rows], [key + '~m', mirrored]] as const) {
    TPL[name] = { ...base, rows: plan };
    (SHAPES[k] ??= [k]).push(name);
  }
}

/** The floor plan a building was laid out from. */
export const shapeOf = (b: { k: string; s?: string }): string => b.s ?? b.k;

export const HOMES = ['shack', 'cottage', 'house', 'bighouse', 'longhouse', 'townhouse', 'manor'];

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
  pen: 'Chickens, goats, sheep and cows: eggs, milk and wool, if someone keeps them fed. The herder tends them.',
  tower: 'Wardens keep watch from here and see trouble coming from twice as far. Archers on the tower shoot further, safe behind its walls.',
  well: 'Fresh water.',
  shack: 'Rough boards over bare earth and straw to sleep on: the last roof of the poor.',
  cottage: 'A small home for one.',
  house: 'A plain family home.',
  bighouse: 'A home with room for a growing family.',
  longhouse: 'One long hall of beds and a fire, shared by many.',
  townhouse: 'A narrow house of the inner streets for a family doing well. Costly to keep.',
  manor: 'A great house by the keep, with a walled garden. Only the rich can keep one up.',
  graveyard: 'Where the dead are laid to rest.',
  palisade: 'A ring of sharpened stakes round the rise: the first wall of a castle.',
  motte: "The ruler's first hall on the rise, timber and thatch, where they live and hold court until a keep is raised.",
  keep: 'The stone heart of the castle: the great hall and the throne where the ruler holds audiences and feasts, the ruler\'s chambers above, and a chapel.',
  curtain: 'The castle\'s curtain wall, with a tower at each corner. Archers in the towers shoot further, safe behind stone.',
  gatehouse: 'The way into the castle, facing the town: two gates and a guardroom either side, where wardens keep watch.',
  barracks: 'Where the castle\'s guards sleep and drill. It serves as the guardhouse.',
  stables: 'Stalls, mangers and hay for the castle\'s horses.',
  twall: 'A stretch of the town wall. Raiders have to come through a gate or break a way in, and a breach must be mended.',
  wtower: 'A tower on the town wall. Wardens keep watch from it, and archers inside shoot further and are safe behind stone.',
  tgate: 'A gate in the town wall: open by day, shut at night and whenever the alarm is raised. It always opens for the colony\'s own people.',
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
      if (ch === '#' || ch === '+' || ch === '=' || ch === 'g' || ch === '-' || ch === 'X' || ch === 'Z' || ch === 'P') walls.push(cell);
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
  k: B.CAULDRON, v: B.VAT, n: B.BIN, d: B.DESK, K: B.BOOKS, R: B.RACK, T: B.BATH, C: B.CHESS, D: B.DARTS, m: B.MUSIC, H: B.DRYRACK, L: B.LAMP, u: B.RUG, O: B.WARDROBE, Y: B.BRAZIER, Q: B.TROUGH, '%': B.GARDEN,
  X: B.CWALL, Z: B.CTOWER, P: B.PALISADE, J: B.THRONE, N: B.BANNER, V: B.TAPESTRY, q: B.HAY,
};

/** Things a home gains as it is made finer. They sit on floor tiles and are kept when the floor is relaid. */
export const DECOR: number[] = [B.RUG, B.WARDROBE, B.LAMP, B.BOOKS];
export const isDecor = (s: number): boolean => DECOR.includes(s);

/** What a template cell becomes on the map. Floors lie under furniture, so furniture reports itself. */
export function cellCode(k: string, ch: string, mat: number): number {
  if (k === 'twall' || k === 'tgate' || k === 'wtower') {
    // the town wall: stakes and timber first, stone later
    if (ch === 'P') return mat ? B.CWALL : B.PALISADE;
    if (ch === 'Z') return mat ? B.CTOWER : B.PALISADE;
    if (ch === 'g') return B.GATE;
    if (ch === ',') return B.PAVING;
    if (ch === '.') return mat ? B.FLOOR_STONE : B.FLOOR_WOOD;
  }
  if (ch === '#') return mat ? B.WALL_STONE : B.WALL_WOOD;
  if (ch === '+' || ch === 'g') return B.DOOR;
  if (ch === '=') return B.FENCE;
  if (ch === '-') return B.LOWWALL;
  if (ch === '.') return k === 'shack' ? B.FLOOR_BARE : k === 'townhouse' || k === 'manor' ? B.FLOOR_FINE : mat ? B.FLOOR_STONE : B.FLOOR_WOOD;
  if (ch === ',') return k === 'field' ? B.TILLED : k === 'manor' || k === 'gatehouse' ? B.PAVING : B.NONE;
  if (ch === 'b' && k === 'shack') return B.STRAW;
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
