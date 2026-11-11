// Backstories: one from childhood, one from adult life. They set starting skills, sometimes
// refuse certain work, and leave a mark on personality.

import { AX, type RaceK, type SkillK, type WorkK } from '../types';

export interface BackDef {
  k: string;
  name: string;
  desc: string;
  /** only these peoples (all if omitted) */
  races?: RaceK[];
  sk: Partial<Record<SkillK, number>>;
  /** work they refuse to do */
  no?: WorkK[];
  per?: [number, number][];
  /** a trait this life leaves them with */
  trait?: string;
  /** points it costs at creation (negative gives points) */
  pts?: number;
}

const A = AX;
const b = (k: string, name: string, desc: string, sk: BackDef['sk'], x: Partial<BackDef> = {}): BackDef => ({ k, name, desc, sk, ...x });

export const CHILDHOODS: BackDef[] = [
  b('farmchild', 'Farm child', 'Grew up with dirt under the nails and up before dawn.', { farm: 3, animal: 1 }),
  b('mineorphan', 'Mine orphan', 'Raised in the dark by whoever had bread to spare.', { mine: 3, melee: 1 }, { per: [[A.BRAVE, 0.3]] }),
  b('templefoundling', 'Temple foundling', 'Left on the temple steps and raised on prayers and porridge.', { lore: 3, medic: 1 }, { per: [[A.PIETY, 0.6]] }),
  b('wolfchild', 'Raised by wolves', 'Found in the woods, half-wild. Still growls when cornered.', { animal: 4, melee: 2, social: -2 }, { per: [[A.SOCIABLE, -0.5]] }),
  b('slaverschild', 'Slaver\'s child', 'Grew up counting chained heads. Has tried to forget.', { social: 2, melee: 1 }, { per: [[A.KIND, -0.3]] }),
  b('plaguesurvivor', 'Plague survivor', 'The only one in the house who woke up.', { medic: 2 }, { trait: 'hale', per: [[A.PIETY, 0.3]] }),
  b('noblebastard', 'Noble bastard', 'Fed at the high table, but only at the far end.', { social: 2, lore: 2, melee: 1 }, { per: [[A.AMBITION, 0.7]], pts: 2 }),
  b('streetrat', 'Street rat', 'Stole to eat and ran to live.', { craft: 1, social: 2, melee: 1 }, { per: [[A.HONEST, -0.4], [A.GREED, 0.3]] }),
  b('innkeeperskid', 'Innkeeper\'s brat', 'Heard every story twice before they were ten.', { cook: 2, social: 3 }, { per: [[A.GOSSIP, 0.5]] }),
  b('smithsapprentice', 'Forge brat', 'Pumped the bellows until they could lift the hammer.', { smith: 3, craft: 1 }),
  b('shepherd', 'Shepherd', 'Alone on the hill with the flock and the weather.', { animal: 3, archery: 1 }, { per: [[A.SOCIABLE, -0.3]] }),
  b('refugee', 'Refugee child', 'Carried out of a burning town on someone\'s back.', { cook: 1, build: 1, medic: 1 }, { per: [[A.BRAVE, -0.2], [A.KIND, 0.3]] }),
  b('campfollower', 'Camp follower', 'Grew up behind an army, patching boots and soldiers.', { medic: 2, cook: 2, melee: 1 }),
  b('scribechild', 'Scribe\'s pupil', 'Ink-stained from the age of six.', { lore: 4, social: 1 }, { per: [[A.CURIOUS, 0.4]] }),
  b('poacher', 'Poacher\'s whelp', 'Learned to walk quietly and lie to wardens.', { archery: 3, animal: 1 }, { per: [[A.HONEST, -0.3]] }),
  b('fisherchild', 'Fisher child', 'Could gut a pike before they could read. Still cannot read.', { animal: 2, cook: 2, lore: -1 }),
  b('warrenrunt', 'Warren runt', 'Smallest of forty. Survived by being quickest.', { craft: 2, melee: 1, social: 1 }, { races: ['goblin'], per: [[A.BRAVE, -0.3]] }),
  b('clanwhelp', 'Clan whelp', 'First scar at five. First tusk at nine.', { melee: 3, animal: 1 }, { races: ['orc', 'halforc'], per: [[A.BRAVE, 0.4]] }),
  b('holdchild', 'Child of the hold', 'Raised under stone, on oaths and ancestor-songs.', { mine: 2, smith: 2, lore: 1 }, { races: ['dwarf'], per: [[A.LOYAL, 0.4]] }),
  b('grovechild', 'Grove-raised', 'Spent a long childhood among old trees and older songs.', { archery: 2, lore: 2, medic: 1 }, { races: ['elf', 'halfelf'] }),
  b('burrowchild', 'Burrow child', 'Six meals a day, forty cousins and no secrets.', { cook: 3, farm: 1, social: 1 }, { races: ['halfling'], per: [[A.GOSSIP, 0.4]] }),
  b('chimneysweep', 'Chimney sweep', 'Small, sooty and underfed.', { build: 2, craft: 1 }, { per: [[A.DILIGENT, 0.3]] }),
  b('circuschild', 'Tumbler\'s child', 'Born in a wagon between two towns.', { social: 3, animal: 1, melee: 1 }, { per: [[A.HUMOR, 0.5]] }),
  b('gravekeeperskid', 'Gravekeeper\'s child', 'Played among the headstones. Knows which ones whisper.', { lore: 2, build: 1, mine: 1 }, { trait: 'morbid' }),
];

export const ADULTHOODS: BackDef[] = [
  b('farmer', 'Farmer', 'Worked the same fields their grandparents did, until they could not.', { farm: 5, animal: 2 }),
  b('sellsword', 'Sellsword', 'Fought for whoever paid. Some of them even paid.', { melee: 5, archery: 2 }, { per: [[A.BRAVE, 0.4], [A.LOYAL, -0.3]] }),
  b('deserter', 'Deserter', 'Left the line one night and never looked back. Others are still looking.', { melee: 3, archery: 2, animal: 1 }, { per: [[A.BRAVE, -0.5]], pts: -1 }),
  b('graverobber', 'Grave robber', 'The dead have no use for rings.', { mine: 3, craft: 2, lore: 1 }, { per: [[A.GREED, 0.5], [A.PIETY, -0.5]] }),
  b('hedgewitch', 'Hedge witch', 'Sold cures, curses and good advice from a hut nobody visited by daylight.', { medic: 5, lore: 2, cook: 1 }, { per: [[A.CURIOUS, 0.3]] }),
  b('disgracedpriest', 'Disgraced priest', 'Cast out of the temple. Will not say why.', { lore: 4, social: 3 }, { per: [[A.PIETY, 0.3], [A.HONEST, -0.3]], pts: 1 }),
  b('pitfighter', 'Pit fighter', 'Killed for crowds. Still hears them cheering.', { melee: 7 }, { per: [[A.BRAVE, 0.6], [A.TEMPER, 0.3]] }),
  b('jester', 'Court jester', 'Paid to mock a lord, then fled for doing it too well.', { social: 5, lore: 1 }, { per: [[A.HUMOR, 1], [A.HONEST, 0.3]] }),
  b('escapedthrall', 'Escaped thrall', 'Wore a collar for years. Would die before wearing one again.', { farm: 2, mine: 2, build: 2 }, { per: [[A.BRAVE, 0.3], [A.DILIGENT, 0.3]], pts: -1 }),
  b('ratcatcher', 'Ratcatcher', 'Someone has to. Knows every cellar and what lives in it.', { animal: 3, melee: 2, craft: 1 }),
  b('smuggler', 'Smuggler', 'Moved things past people who would have taxed them.', { social: 3, craft: 2, archery: 1 }, { per: [[A.HONEST, -0.6], [A.GREED, 0.4]] }),
  b('alchemist', 'Failed alchemist', 'Turned a great deal of gold into lead.', { lore: 4, medic: 2, craft: 2 }, { per: [[A.CURIOUS, 0.8]], no: ['hunt'] }),
  b('shipwrecked', 'Shipwreck survivor', 'Washed up with nothing but a story nobody believes.', { animal: 2, build: 2, cook: 1, craft: 1 }),
  b('executioner', 'Headsman', 'Did the work nobody thanks you for.', { melee: 4, medic: 1 }, { trait: 'morbid', per: [[A.SOCIABLE, -0.3]] }),
  b('blacksmith', 'Blacksmith', 'Shod horses and mended ploughs for a village that is ash now.', { smith: 6, craft: 2, melee: 1 }),
  b('miner', 'Miner', 'Twenty years underground and a cough to show for it.', { mine: 6, build: 2 }),
  b('hunter', 'Hunter', 'Fed a village through hard winters with a bow and patience.', { archery: 5, animal: 3, cook: 1 }),
  b('cook', 'Cook', 'Ran a kitchen where nobody dared complain.', { cook: 6, social: 1 }, { no: ['mine'] }),
  b('carpenter', 'Carpenter', 'Built houses, barns and more coffins than they would like.', { build: 6, craft: 2 }),
  b('midwife', 'Midwife', 'Brought half a town into the world and laid out the other half.', { medic: 5, social: 2 }, { per: [[A.KIND, 0.4]] }),
  b('brewer', 'Brewer', 'Made the ale that made the trouble.', { cook: 4, craft: 2, social: 2 }),
  b('weaver', 'Weaver', 'Worked the loom from dawn until the light went.', { craft: 6, social: 1 }, { no: ['mine', 'hunt'] }),
  b('bard', 'Wandering bard', 'Sang for suppers and slept in haylofts across three kingdoms.', { social: 6, lore: 2 }, { trait: 'storyteller', no: ['mine'], per: [[A.FLIRT, 0.4]] }),
  b('soldier', 'Soldier', 'Stood in a shield wall for a lord whose name they have forgotten.', { melee: 4, archery: 2, build: 1 }, { per: [[A.LOYAL, 0.4], [A.DILIGENT, 0.3]] }),
  b('monk', 'Wandering monk', 'Walked barefoot from shrine to shrine, owning nothing.', { lore: 4, medic: 2, farm: 1 }, { per: [[A.PIETY, 1], [A.GREED, -0.6]], no: ['hunt'] }),
  b('bandit', 'Reformed bandit', 'Took purses on the high road. Says those days are done.', { melee: 3, archery: 3, social: 1 }, { per: [[A.HONEST, -0.4], [A.GREED, 0.4]], pts: -1 }),
  b('exilednoble', 'Exiled heir', 'Born to a hall and a name. Has the name left.', { social: 4, lore: 3, melee: 2 }, { per: [[A.AMBITION, 1]], no: ['mine', 'cook'], pts: 3 }),
  b('herbalist', 'Herbalist', 'Knows which leaf heals, which kills, and how little separates them.', { medic: 4, farm: 3, cook: 1 }),
  b('mason', 'Stonemason', 'Raised walls meant to outlast the people behind them.', { build: 5, mine: 3 }),
  b('trapper', 'Trapper', 'Spent winters alone with the snares and the silence.', { animal: 4, archery: 3, craft: 1 }, { per: [[A.SOCIABLE, -0.5]] }),
  b('gambler', 'Gambler', 'Won a fortune and lost two.', { social: 5, craft: 1 }, { per: [[A.GREED, 0.5], [A.HONEST, -0.3]] }),
  b('tinker', 'Scrap tinker', 'Can mend anything with wire, spit and spite.', { craft: 6, smith: 2 }, { races: ['goblin'] }),
  b('raider', 'Clan raider', 'Rode with the warband until the warband was gone.', { melee: 6, animal: 2 }, { races: ['orc', 'halforc'], per: [[A.BRAVE, 0.5]] }),
  b('runesmith', 'Oath-smith', 'Forged blades with names and the vows that go with them.', { smith: 7, lore: 2 }, { races: ['dwarf'], per: [[A.LOYAL, 0.4]] }),
  b('warden', 'Forest warden', 'Kept a wood for two centuries and buried three human friends.', { archery: 5, animal: 2, medic: 2 }, { races: ['elf', 'halfelf'] }),
  b('pastrycook', 'Pie-maker', 'Famous in four villages for the eel pie.', { cook: 7, social: 1 }, { races: ['halfling'], no: ['mine', 'hunt'] }),
];

/** For those born and raised in a colony. Never rolled for newcomers. */
export const HOMEGROWN: BackDef[] = [
  b('colonyborn', 'Child of the colony', 'Born here. Knows every face, every path and every grudge.', { farm: 1, cook: 1, social: 1 }),
  b('homegrown', 'Raised here', 'Grew up doing whatever needed doing.', { build: 1, farm: 1 }),
];

export const BACKS: Record<string, BackDef> = Object.fromEntries([...CHILDHOODS, ...ADULTHOODS, ...HOMEGROWN].map((x) => [x.k, x]));
