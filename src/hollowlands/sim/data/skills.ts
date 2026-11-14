// What each skill does, in plain words. Kept in step with how the sim uses them: the work each
// one drives (jobs.ts), fighting (combat.ts), and the social and ruling systems.

export const SKILL_INFO: string[] = [
  /* Melee    */ 'Fighting hand to hand: hitting raiders and beasts, holding them off, and winning brawls. The strong also win duels and challenges for the seat.',
  /* Archery  */ 'Shooting raiders from a distance before they reach the colony, and bringing down game when hunting.',
  /* Building */ 'Raising and repairing buildings, felling trees and slowly rebuilding in stone. Skilled builders make finer homes, and fine homes lift everyone\'s mood.',
  /* Mining   */ 'Breaking boulders and rock for stone, and digging out ore for the forge.',
  /* Farming  */ 'Sowing, tending and harvesting the fields, and gathering berries. Better farmers bring in more from the same field.',
  /* Cooking  */ 'Turning raw food into meals, and brewing ale. A good cook sometimes makes a feast, which lifts the mood of whoever eats it.',
  /* Crafting */ 'Making clothes from cloth and leather, and goods to sell to traders. At high skill, now and then a masterwork.',
  /* Smithing */ 'Smelting ore into iron, then forging tools (everyone works faster with good tools) and weapons (fighters hit harder).',
  /* Medicine */ 'Tending wounds and sickness: stopping bleeding, keeping wounds clean, nursing the sick and making medicine from herbs. Also makes childbirth safer.',
  /* Animals  */ 'Fishing and hunting, and handling beasts. Helps a hunter stalk the deer, boar and hares out in the wild and bring them down.',
  /* Social   */ 'Charm and persuasion: how others take what they say, winning arguments, votes, converts and trials, holding a crowd with a story or a sermon.',
  /* Lore     */ 'Learning and memory. A learned teacher passes on more to the children; Lore makes sermons stronger, helps win the steward\'s post, counts when a colony chooses its elder, and a colonist with plenty of it can hold a crowd with a story. Children build it at the schoolhouse, adults by reading there, and it helps at the chessboard.',
];

/** How levels work, for the one-line legend. */
export const SKILL_LEVELS = 'Levels run from 0 to 20. Each level makes the work faster and better; skills grow with use and fade a little when unused. A passion makes them learn it faster and enjoy the work.';
