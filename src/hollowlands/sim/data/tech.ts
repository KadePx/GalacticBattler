// What a colony can come to know. Each discovery needs others before it and a store of lore to
// work it out; most bring a building of their own, worked by a trade of their own. Costs rise with
// every discovery made, so a colony goes through them in a natural order over the years.

export interface TechDef {
  k: string;
  name: string;
  /** discoveries it needs first */
  pre: string[];
  /** lore it costs before anything else is known (each discovery already made adds to it) */
  base: number;
  /** the skill that makes someone likely to be the one who works it out */
  skill: number;
  /** the buildings that put it to work (the first is the usual one; a mill may be either) */
  bld: string[];
  /** what the one who works it out has done, after their name: "Tamoc has ..." */
  idea: string;
  /** one line for the colony panel: what it does */
  blurb: string;
}

const t = (k: string, name: string, pre: string[], base: number, skill: number, bld: string[], idea: string, blurb: string): TechDef => ({ k, name, pre, base, skill, bld, idea, blurb });

export const TECH_LIST: TechDef[] = [
  t('rotation', 'Crop rotation', [], 30, 4, [],
    'worked out that a field rested in turn under clover and beans gives more the year after',
    'Each field rests in turn, its headland under clover: bigger harvests.'),
  t('milling', 'Milling', ['rotation'], 50, 4, ['watermill', 'windmill'],
    'worked out how to make the wind, or the river, turn a millstone',
    'Grain ground to flour at the mill. Flour goes further in the pot than grain.'),
  t('kiln', 'The kiln', [], 50, 6, ['kiln'],
    'found good clay down by the water, and a way to fire it hard',
    'Pots for the market, and bricks that stand in for stone in people\'s homes.'),
  t('tanning', 'Tanning', [], 60, 6, ['tannery'],
    'learned to cure hides in oak-bark pits until they last for years',
    'Leather that lasts: clothes wear out more slowly, and hunters bring back more hides.'),
  t('baking', 'Baking', ['milling'], 65, 5, ['bakery'],
    'built an oven that bakes bread for a whole street at once',
    'Flour baked into bread: a loaf feeds more than the grain it came from, and people like it better.'),
  t('irrigation', 'Irrigation', ['rotation'], 75, 4, [],
    'dug the first ditch to carry water out to the fields',
    'Ditches carry water to the fields: bigger harvests, and a drought does far less harm.'),
  t('glass', 'Glassmaking', ['kiln'], 90, 6, ['glassworks'],
    'melted sand into glass clear enough to see through',
    'Glass in the windows: a glazed home is warmer and burns less wood.'),
  t('dyeing', 'Dyeing', ['tanning'], 90, 6, ['dyeworks'],
    'found how to fix madder red and woad blue fast in cloth',
    'The colony goes about in colour, banners fly from its towers, and dyed cloth sells well.'),
  t('steel', 'Steel', ['kiln'], 105, 7, ['steelworks'],
    'learned to fold charcoal into iron and make steel',
    'Steel tools hold an edge far longer, and steel blades bite deeper.'),
  t('jewellery', 'Jewellery', ['glass'], 120, 7, ['jeweller'],
    'learned to set stones in silver so they catch the light',
    'Rings and brooches for those who can pay: where the rich spend what they cannot eat.'),
  t('printing', 'Printing', ['dyeing'], 140, 11, ['printer'],
    'carved letters in wood, inked them and pressed them onto paper',
    'The press prints the colony\'s chronicle, a volume at a time, and gives the whole town more to read.'),
];

export const TECHS: Record<string, TechDef> = Object.fromEntries(TECH_LIST.map((x) => [x.k, x]));

/** Every kind of building a discovery brings. */
export const TECH_BLDS = new Set(TECH_LIST.flatMap((x) => x.bld));

/** The trade that works each of those buildings. */
export const TECH_PROF: Record<string, string> = {
  windmill: 'miller', watermill: 'miller', bakery: 'baker', kiln: 'potter', glassworks: 'glazier', tannery: 'tanner',
  dyeworks: 'dyer', steelworks: 'smith', jeweller: 'jeweller', printer: 'printer',
};
