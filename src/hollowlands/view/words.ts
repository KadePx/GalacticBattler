// Words the viewer needs that the sim does not provide: what someone is doing, life-story
// lines, faith and resource names. Display only; nothing here feeds back into a colony.

import { PROFS } from '../sim/data/professions';
import { breakLine } from '../sim/mood';
import { person } from '../sim/pawn';
import type { Bio, Colony, Dead, Id, Pawn } from '../sim/types';
import { evText } from '../text';

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const WEATHER = ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow', 'Fog'];
export const STAGE_NAMES = ['Baby', 'Child', 'Youth', 'Adult', 'Elder'];

export const FAITHS: Record<string, string> = {
  hearth: 'The Hearth', iron: 'The Iron Ancestors', pale: 'The Pale Lady', green: 'The Green Choir', teeth: 'The Old Teeth', hollow: 'The Hollow Mother',
};
export const faithName = (k: string): string => FAITHS[k] ?? (k ? k[0].toUpperCase() + k.slice(1) : 'No faith');
export const DEVOTION = ['in name only', 'lightly held', 'devout', 'zealous'];

// Keyed by plain strings so new resources, work and actions in the sim fall back to their code.
export const RES_NAMES: Record<string, string> = {
  grain: 'Grain', veg: 'Vegetables', meat: 'Meat', fish: 'Fish', berries: 'Berries', meal: 'Meals', feast: 'Feast dishes', ale: 'Ale',
  wood: 'Wood', stone: 'Stone', ore: 'Ore', iron: 'Iron', leather: 'Leather', cloth: 'Cloth', herbs: 'Herbs', medicine: 'Medicine',
  tools: 'Tools', clothes: 'Clothes', weapons: 'Weapons', silver: 'Silver', goods: 'Goods', hops: 'Hops', mushrooms: 'Mushrooms',
};

const WORK: Record<string, string> = {
  farm: 'Working the fields', forage: 'Foraging', hunt: 'Hunting', fish: 'Fishing', wood: 'Cutting wood', mine: 'Mining', cook: 'Cooking', build: 'Building',
  craft: 'Crafting', smith: 'Smithing', brew: 'Brewing', heal: 'Tending the sick', teach: 'Teaching', preach: 'Preaching', guard: 'Standing guard', herbs: 'Gathering herbs',
};

const ACT: Record<string, string> = {
  idle: 'Standing about', wander: 'Wandering', sleep: 'Sleeping', eat: 'Eating', drink: 'Having a drink', relax: 'Relaxing', walk: 'Out for a walk', pray: 'Praying',
  dice: 'Playing dice', hobby: 'Busy with a hobby', play: 'Playing', visit: 'Visiting {o}', sulk: 'Sulking', binge: 'Bingeing', tantrum: 'Smashing things', rave: 'Raging',
  court: 'Courting {o}', wed: 'Getting married', attend: 'At the gathering', mourn: 'Mourning', labour: 'In labour', rest: 'Resting in bed', perform: 'Performing',
  listen: 'Listening', stargaze: 'Watching the stars', bathe: 'Washing', work: 'Working',
  chess: 'Playing chess', darts: 'Throwing darts', music: 'Playing music', read: 'Reading', study: 'At school',
  fight: 'Fighting', flee: 'Running for it', hide: 'Hiding', tend: 'Tending the hurt', train: 'Training',
};

const firstOf = (c: Colony, id: Id | undefined): string => {
  const o = id ? person(c, id) : undefined;
  return o ? o.first : 'someone';
};

/** A few words for what a colonist is doing right now. */
export function actText(c: Colony, p: Pawn): string {
  const a = p.act;
  let s = a.k === 'work' && a.w ? WORK[a.w] ?? 'Working' : ACT[a.k] ?? a.k;
  s = s.replace('{o}', firstOf(c, a.o));
  // still on the way there (the tick being shown is the one just stepped: c.tick - 1)
  if (c.tick - 1 < a.ta && a.path && a.path.length > 1 && a.k !== 'wander' && a.k !== 'walk') return 'Off to: ' + s[0].toLowerCase() + s.slice(1);
  return s;
}

const BREAK_BIO: Record<string, string> = {
  sulk: 'Shut themselves away and would not speak to anyone', bingefood: 'Broke down and ate everything in sight', bingedrink: 'Broke down and crawled into a barrel',
  wander: 'Walked off into the wild in a daze', rave: 'Broke down and raged at everyone', tantrum: 'Broke down and smashed things',
};
const LOST: Record<string, string> = { spouse: 'love', child: 'child', parent: 'parent', sibling: 'sibling', friend: 'friend' };

// Local copies of a few sim names, so the viewer keeps working while those systems change.
export const PART_NAMES: Record<string, string> = {
  head: 'head', eyeL: 'left eye', eyeR: 'right eye', jaw: 'jaw', torso: 'chest', armL: 'left arm', armR: 'right arm', handL: 'left hand', handR: 'right hand',
  legL: 'left leg', legR: 'right leg', footL: 'left foot', footR: 'right foot',
};
export const ILL_NAMES: Record<string, string> = { flux: 'the flux', fever: 'rot fever', plague: 'the grey plague', cough: 'lung-cough', pox: 'goblin pox' };
const FOE_NAMES: Record<string, string> = { bandit: 'a bandit', slaver: 'a slaver', orc: 'an orc raider', wolf: 'a wolf', ghoul: 'a ghoul', troll: 'a troll', boar: 'a maddened boar' };

/** 'lost_hand' -> 'Lost hand': a readable fallback for codes the viewer has no words for. */
export const pretty = (k: string): string => (k ? k[0].toUpperCase() + k.slice(1) : '').replace(/_/g, ' ').replace(/([a-z])([LR])$/, (_, a: string, s: string) => `${a} (${s === 'L' ? 'left' : 'right'})`);

/** One line of a life story. Names come back as plain text; the caller links them. */
export function bioText(c: Colony, b: Bio): string {
  const o = firstOf(c, b.o);
  switch (b.k) {
    case 'lovers': return `Fell in love with ${o}.`;
    case 'betrothed': return `Became betrothed to ${o}.`;
    case 'wedding': return `Married ${o}.`;
    case 'birth': return `Welcomed a child, ${o}.`;
    case 'stillbirth': return 'Lost a baby.';
    case 'friends': return `Became friends with ${o}.`;
    case 'rivals': return `Fell out with ${o} for good.`;
    case 'brawl_won': return `Beat ${o} in a brawl.`;
    case 'brawl_lost': return `Was beaten by ${o} in a brawl.`;
    case 'killed': return `Killed ${o} in a brawl.`;
    case 'break': return (BREAK_BIO[b.s ?? ''] ?? 'Broke down') + '.';
    case 'trade': return `Became the colony's ${(PROFS[b.s ?? '']?.name ?? b.s ?? 'worker').toLowerCase()}.`;
    case 'lost': return `Lost their ${LOST[b.s ?? ''] ?? 'friend'}, ${o}.`;
    case 'adult': return 'Came of age.';
    case 'masterwork': return `Made ${b.s ?? 'a masterwork'}.`;
    case 'inspired': return b.s === 'frenzy' ? 'Worked for days like someone possessed.' : b.s === 'insight' ? 'Saw everything clearly for a while.' : 'Was struck by an idea for something beautiful.';
    case 'convert': return `Took up ${o}'s faith${b.s ? ', ' + faithName(b.s) : ''}.`;
    case 'affair': return `Began an affair with ${o}.`;
    case 'found_out': return `Found out about ${o}'s betrayal.`;
    case 'divorce': return `Left their marriage to ${o}.`;
    case 'divorced': return `Was left by their spouse, ${o}.`;
    case 'breakup': return `Ended things with ${o}.`;
    case 'dumped': return `Was left by ${o}.`;
    case 'heartbroken': return `Gave up on ${o}, heartbroken.`;
    // kinds from the newer parts of the sim: arrivals, wounds, raids, crime and rule
    case 'arrived': return `Arrived at ${b.s ?? 'the colony'}.`;
    case 'sick': return `Fell ill with ${ILL_NAMES[b.s ?? ''] ?? 'a sickness'}.`;
    case 'maimed': return `Lost their ${PART_NAMES[b.s ?? ''] ?? b.s ?? 'limb'}.`;
    case 'scarred': return 'Was left with a scarred face.';
    case 'addled': return 'Took a blow to the head and was never quite the same.';
    case 'ailment': return `Age brought ${pretty(b.s ?? 'aches').toLowerCase()}.`;
    case 'drunkard': return 'Could no longer stay away from the barrel.';
    case 'slew': return `Killed ${FOE_NAMES[b.s ?? ''] ?? 'an attacker'}.`;
    case 'seized': return 'Was seized by raiders.';
    case 'rescued': return `Was rescued by ${o}.`;
    case 'caught': return `Was caught in the act by ${o}.`;
    case 'acquitted': return 'Stood trial and was acquitted.';
    case 'punished': return 'Stood trial and was punished.';
    case 'murdered': return `Murdered ${o}.`;
    case 'raised': return `Rose to the rank of ${(b.s ?? 'notable').toLowerCase()}.`;
    case 'title': return `Was named ${(b.s ?? 'to an office').toLowerCase()}.`;
    case 'ruler': return 'Became ruler of the colony.';
    case 'regent': return `Became regent for ${o}.`;
    case 'challenge': return `Challenged ${o} for the rule and ${b.s === 'won' ? 'won' : 'lost'}.`;
    case 'plot_failed': return `Plotted against ${o} and was found out.`;
    case 'house_founded': return `Founded House ${b.s ?? ''}.`.replace(' .', '.');
    case 'odd_goat': return 'Declared the goat a sign from the gods.';
    case 'odd_ring': return 'Dug up a ring that is always cold.';
    case 'odd_ogre': return `Walked in off the road and asked for work at ${b.s ?? 'the colony'}.`;
    case 'odd_ghost': return `Saw ${o} at the window.`;
    case 'odd_mushroom': return 'Ate something from the wood and saw the shape of everything.';
    case 'odd_oath': return 'Swore a drunken oath to guard a door for life, and kept it.';
    case 'prosthetic': return `Was fitted with a ${(b.s ?? '').startsWith('hand') ? 'hook' : 'wooden leg'}.`;
    case 'schism': return `Broke with ${o} over the faith and led others away.`;
    case 'match': return `Was matched with ${o} to bind two colonies.`;
    case 'founded': return `Helped found ${b.s ?? 'a new colony'}.`;
    case 'settled': return 'Left with the settlers to found a new colony.';
    case 'moved': return 'Packed up and left for another colony.';
    case 'migrated': return `Arrived from ${b.s ?? 'another colony'}.`;
    case 'heir': return `Took up where ${o} left off.`;
    case 'heirloom': return `Was left ${o}'s ${b.s ?? 'keepsake'}.`;
    case 'blackmail': return `Made ${o} pay to keep a secret.`;
    case 'plotter': return b.o ? `Joined ${o}'s plot against the ruler.` : 'Began to plot against the ruler.';
    case 'cult': return b.o ? `Was brought to the Hollow Mother by ${o}.` : 'Found the Hollow Mother.';
    case 'enthralled': return `Was taken alive in a raid and put in chains at ${b.s ?? 'the colony'}.`;
    case 'freed': return 'Was freed.';
    default: return pretty(b.k) + (b.o ? ` (${o})` : '') + '.';
  }
}

/**
 * How someone died or left, as a short phrase. Built from the sim's own death sentence so new
 * causes read correctly without the viewer keeping its own list.
 */
export function causeText(c: Colony, d: Dead): string {
  const line = evText(c, { t: d.died, k: 'death', a: d.id, b: d.by, s: d.cause });
  const name = `${d.first} ${d.fam} `;
  let s = (line.startsWith(name) ? line.slice(name.length) : line).replace(/\.$/, '');
  if (s === 'died' && d.left) return 'Left the colony';
  s = s.replace(/^was /, '');
  return s ? s[0].toUpperCase() + s.slice(1) : 'Died';
}

/** Colour for a mood value, judged against that colonist's own breaking points. */
export function moodColor(p: Pawn): string {
  const b = breakLine(p);
  if (p.mood < b.extreme) return '#ef4444';
  if (p.mood < b.major) return '#f87171';
  if (p.mood < b.minor) return '#fbbf24';
  if (p.mood < 50) return '#9aa4b8';
  if (p.mood < 68) return '#86efac';
  return '#4ade80';
}

export function moodWord(p: Pawn): string {
  const b = breakLine(p);
  if (p.mood < b.extreme) return 'At breaking point';
  if (p.mood < b.major) return 'Close to breaking';
  if (p.mood < b.minor) return 'Strained';
  if (p.mood < 50) return 'Getting by';
  if (p.mood < 68) return 'Content';
  return 'Happy';
}

export function qualityWord(q: number): string {
  return q < 20 ? 'Shoddy' : q < 40 ? 'Plain' : q < 60 ? 'Sound' : q < 80 ? 'Fine' : 'Masterful';
}
