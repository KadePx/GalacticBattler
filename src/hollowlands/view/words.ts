// Words the viewer needs that the sim does not provide: what someone is doing, life-story
// lines, faith and resource names. Display only; nothing here feeds back into a colony.

import { PROFS } from '../sim/data/professions';
import { TECHS } from '../sim/data/tech';
import { TPL } from '../sim/data/buildings';
import { breakLine } from '../sim/mood';
import { cursedThing } from '../sim/nature';
import { person } from '../sim/pawn';
import { TICKS_PER_DAY } from '../config';
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
  tools: 'Tools', clothes: 'Clothes', weapons: 'Weapons', silver: 'Silver', goods: 'Goods', hops: 'Hops', mushrooms: 'Mushrooms', eggs: 'Eggs', milk: 'Milk',
  flour: 'Flour', bread: 'Bread', brick: 'Bricks', glass: 'Glass',
};

const WORK: Record<string, string> = {
  farm: 'Working the fields', forage: 'Foraging', hunt: 'Hunting', fish: 'Fishing', wood: 'Cutting wood', mine: 'Mining', cook: 'Cooking', build: 'Building',
  craft: 'Crafting', smith: 'Smithing', brew: 'Brewing', heal: 'Tending the sick', teach: 'Teaching', preach: 'Preaching', guard: 'Standing guard', herbs: 'Gathering herbs', herd: 'Tending the beasts',
};

const ACT: Record<string, string> = {
  idle: 'Standing about', wander: 'Wandering', sleep: 'Sleeping', eat: 'Eating', drink: 'Having a drink', relax: 'Relaxing', walk: 'Out for a walk', pray: 'Praying',
  dice: 'Playing dice', hobby: 'Busy with a hobby', play: 'Playing', visit: 'Visiting {o}', sulk: 'Sulking', binge: 'Bingeing', tantrum: 'Smashing things', rave: 'Raging',
  court: 'Courting {o}', wed: 'Getting married', attend: 'At the gathering', mourn: 'Mourning', labour: 'In labour', rest: 'Resting in bed', perform: 'Performing',
  listen: 'Listening', stargaze: 'Watching the stars', bathe: 'Washing', work: 'Working',
  berserk: 'Attacking {o}', subdue: 'Stopping {o}',
  chess: 'Playing chess', darts: 'Throwing darts', music: 'Playing music', read: 'Reading', study: 'At school',
  fight: 'Fighting', flee: 'Running for it', hide: 'Hiding', tend: 'Tending the hurt', train: 'Training',
  shop: 'Buying from {o}', sell: 'Minding a stall',
  aid: 'Lending a hand', duel: 'Duelling {o}', trek: 'With the expedition',
};

/** Lending a hand when the land turns (act.d), and a few acts done for an unusual reason (act.why). */
const AID_ACT: Record<number, string> = { 1: 'Beating out the fire', 2: 'Heaping earth against the flood', 3: 'Searching the woods for {o}', 4: 'Clearing rubble', 5: 'Driving off the locusts', 6: 'Keeping vigil in the graveyard', 7: 'Getting rid of the cursed thing', 8: 'Going to see the fallen star' };
const WHY_ACT: Record<string, string> = { d_leave: 'Taking the road to a neighbour', d_home: 'Home from the road', tourney: 'Watching the tournament', joust: 'Riding in the tournament', x_gather: 'Mustering at the gate with the expedition', x_leave: 'Setting out with the expedition', x_home: 'Home from the expedition', farewell: 'Seeing the expedition off', welcome: 'Welcoming the expedition home', lost: 'Lost in the woods', elope: 'Running off with {o}', dragon: 'Hiding from the dragon' };

const GUEST_ACT: Record<string, string> = {
  minstrel: 'Listening to the minstrel', merchant: 'Looking over the merchant\'s wares', wizard: 'Hearing the wizard out', pilgrim: 'Talking faith with the pilgrims',
  refugee: 'Bringing bread to the refugees', hunter: 'Talking to the bounty hunter', trader: 'Looking over what the caravan brought', knight: 'Gone to look at the knights',
};

const firstOf = (c: Colony, id: Id | undefined): string => {
  const o = id ? person(c, id) : undefined;
  return o ? o.first : 'someone';
};

/** A line in someone's life story about a visitor (b.s is "kind|name|detail"). */
function visitBio(c: Colony, b: Bio, o: string): string {
  const [, name, x] = (b.s ?? '').split('|');
  switch (b.k) {
    case 'v_hunted': return `A bounty hunter, ${name}, came looking for the ${x} they once were.`;
    case 'v_hidden': return `Kept out of sight until the bounty hunter ${name} gave up.`;
    case 'v_exposed': return `Was found out by the bounty hunter ${name}. Everyone knows now.`;
    case 'v_beathunter': return `Beat the bounty hunter ${name} in a fight in the street.`;
    case 'v_told': return `Told the bounty hunter ${name} where to find ${o}.`;
    case 'v_song': return `The minstrel ${name} made a song about them.`;
    case 'v_trinket': return `Bought ${x} from ${name} the merchant.`;
    case 'v_gift': return `Bought ${x} from the merchant ${name} for ${o}.`;
    case 'v_finery': return `Bought ${x} for the house from ${name} the merchant.`;
    case 'v_healed': return `Was healed by ${name} the wizard.`;
    case 'v_blessed': return `Was blessed as a baby by ${name} the wizard.`;
    case 'v_lore': return `Sat up all night with ${name} the wizard, talking of ${(TECHS[x]?.name ?? 'old secrets').toLowerCase()}.`;
    case 'v_fortune': return x === 'good' ? `Had a bright future foretold by ${name} the wizard.` : `Had their palm read by ${name} the wizard, who would not say what was there.`;
    case 'v_inspired': return `Was set alight by a long talk with ${name} the wizard.`;
    case 'v_devout': return `Talked faith with the pilgrim ${name}, and came away more devout.`;
    case 'v_converted': return `Took up the faith of the pilgrim ${name}.`;
    case 'v_takenin': return `Fled ${x} and was taken in at ${c.name}${b.o ? ` by ${o}` : ''}.`;
    case 'v_tax_paid': return `Paid the king's tax to ${name}.`;
    case 'v_tax_no': return `Refused to pay ${x} when ${name} came for the king's tax.`;
    default: return `Met ${name ?? 'a traveller'}.`;
  }
}

/** A line in someone's life story about the land's events and the colony's dramas. */
function natBio(c: Colony, b: Bio, o: string): string {
  const s = b.s ?? '';
  switch (b.k) {
    case 'n_curse': return `Found ${cursedThing(Number(s))} deep in the mine.`;
    case 'n_curse_gone': return s === 'lost' ? 'Lost the cursed thing from the mine, and was glad of it.' : s === 'shrine' ? 'Gave the cursed thing from the mine to the shrine.' : 'Threw the cursed thing from the mine into deep water.';
    case 'n_quake_hurt': return 'Was hurt when the earth shook.';
    case 'n_stariron': return 'Found star-iron where a star fell to earth.';
    case 'n_dragon': return s === 'awe' ? 'Saw a dragon fly over the colony, and was not afraid.' : 'Saw a dragon fly over the colony.';
    case 'n_haunt_laid': return `Laid ${o}'s restless spirit to rest.`;
    case 'n_feud': return `Started a feud with ${o} and the ${s || 'other'} family.`;
    case 'n_feud_peace': { const [x, y] = s.split('|'); return `Made peace between the ${x} and ${y} families.`; }
    case 'n_lost_home': return 'Was lost all night in the woods.';
    case 'n_lost_found': return `Was lost in the woods until ${o} found them.`;
    case 'n_found': return `Found ${o}, lost in the woods.`;
    case 'n_eloped': return `Ran off in the night to marry ${o}.`;
    case 'n_duel_won': return `Beat ${o} in a duel${s ? ` over ${firstOf(c, Number(s))}` : ''}.`;
    case 'n_duel_lost': return `Lost a duel to ${o}${s ? ` over ${firstOf(c, Number(s))}` : ''}.`;
    case 'n_suitor': return `Came from ${s || 'a noble house'} to marry ${o}.`;
    case 'n_suitor_got': return `Was asked for in marriage by ${o} of the house of ${s || 'a noble family'}.`;
    default: return pretty(b.k) + '.';
  }
}

/** Where someone away with an expedition is, as far as the colony knows, and how many days they have been gone (null if they are not away). */
export function awayWhere(c: Colony, id: Id): { where: string; day: number; site: string } | null {
  // on the road to a neighbour, or at one
  const road = c.nb?.away.find((a) => a.pw.id === id);
  if (road) {
    const what = road.k === 'wed' ? `On the road to ${road.to}, to be married there` : road.k === 'tourney' ? `Riding in the tournament at ${road.to}` : road.k === 'relief' ? `Gone to the relief of ${road.to}` : `Our envoy to ${road.to}`;
    return { where: what, day: Math.max(1, Math.floor(c.tick / TICKS_PER_DAY) - Math.floor(road.t0 / TICKS_PER_DAY) + 1), site: road.to };
  }
  const x = c.exp;
  if (!x) return null;
  const today = Math.floor(Math.max(0, c.tick - 1) / TICKS_PER_DAY);
  for (const q of x.l) {
    if (!q.pw.some((p) => p.id === id)) continue;
    const s = q.site;
    const day = Math.max(1, today - Math.floor(q.go / TICKS_PER_DAY) + 1);
    const due = Math.floor(q.back / TICKS_PER_DAY);
    const d = q.m === 4 ? day - 1 : q.day;
    const where = q.m === 1 ? `Setting out for ${s.name}` : q.od ? `Overdue from ${s.name}: no word` : today > due ? `Due home from ${s.name}` : d < s.far ? `On the road to ${s.name}` : d <= s.far + q.stay ? `At ${s.name}` : `On the road home from ${s.name}`;
    return { where, day, site: s.name };
  }
  for (const l of x.late) if (l.pw.id === id) return { where: `Missing since the expedition to ${l.site}`, day: 0, site: l.site };
  return null;
}

/** A line in someone's life story about an expedition (b.s is "place|how it went"). */
function expBio(b: Bio, o: string): string {
  const p = (b.s ?? '').split('|');
  const end = p[1] === 'triumph' ? ', and came home famous' : p[1] === 'grim' ? '. Not everyone came home' : p[1] === 'empty' ? ', and came home with nothing' : p[1] === 'good' ? ', and came home with something to show for it' : '';
  switch (b.k) {
    case 'x_led': return `Led an expedition to ${p[0]}${end}.`;
    case 'x_went': return `Went with ${o}'s expedition to ${p[0]}${end}.`;
    case 'x_relic': return `Brought ${p[0]} home from ${p[1] ?? 'the wilds'}.`;
    case 'x_title': return `Came to be called "${b.s ?? ''}".`;
    case 'x_survived': return Number(p[1]) > 1 ? `Came home at last, one of the party lost at ${p[0]}.` : `Walked home alone, the last of the party lost at ${p[0]}.`;
    case 'x_freed': return `Was freed from a cage at ${p[0]} by ${o}, and came home with them.`;
    default: return 'Went on an expedition.';
  }
}

/** A line in someone's life story about the colony's dealings with a neighbour (b.s is "town|detail"). */
function dipBio(c: Colony, b: Bio, o: string): string {
  const p = (b.s ?? '').split('|');
  switch (b.k) {
    case 'd_envoy': return `Rode to ${p[0]} as the colony's envoy, ${p[1] === 'ally' ? 'to make an alliance' : p[1] === 'tribute' ? 'to demand tribute' : 'to make a trade agreement'}.`;
    case 'd_tn_won': return `Won the tournament at ${p[0]}.`;
    case 'd_tn_rode': return p[1] === 'won' ? `Won the tournament at ${p[0]}.` : p[1] === 'hurt' ? `Rode in the tournament at ${p[0]}, and was unhorsed and hurt.` : p[1] === 'some' ? `Rode well in the tournament at ${p[0]}.` : p[1] === 'out' ? `Rode in the tournament at ${p[0]}, and was unhorsed.` : `Rode to the tournament at ${p[0]}.`;
    case 'd_relief': return `Rode to the relief of ${p[0]}.`;
    case 'd_wed_came': return `Came from ${p[0]}, of the house of ${p[1]}, to marry here.`;
    case 'd_wed_match': return `Was promised to ${o} of ${p[0]}, to join the two houses.`;
    case 'd_wed': return `Married ${o}, joining the houses of ${p[0]} and ${c.name}.`;
    default: return 'Had dealings with a neighbour.';
  }
}

/** A few words for what a colonist is doing right now. */
export function actText(c: Colony, p: Pawn): string {
  const a = p.act;
  if (a.why === 'away') { const w = awayWhere(c, p.id); if (w) return w.day ? `${w.where} (day ${w.day})` : w.where; }
  let s = a.k === 'work' && a.w ? WORK[a.w] ?? 'Working' : a.k === 'aid' ? AID_ACT[a.d ?? 0] ?? 'Lending a hand' : WHY_ACT[a.why] ?? ACT[a.k] ?? a.k;
  // at a shop, buying from its master only when the master is there; otherwise just shopping
  if (a.k === 'shop' && a.b) { const o = a.o ? person(c, a.o) : undefined; if (!o || !('act' in o) || o.act.b !== a.b) s = 'Shopping'; }
  if (a.k === 'listen' && a.why === 'guest') {
    const g = c.vis?.l.find((x) => x.id === a.d);
    s = g ? GUEST_ACT[g.k] ?? 'With a visitor' : 'With a visitor';
  }
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
    case 'contest': return `Won the ${b.s ?? 'contest'} at the festival.`;
    case 'dream': return `Their dream came true: they ${b.s ?? 'got what they wanted'}.`;
    case 'rescued_someone': return `Rescued ${o} from raiders.`;
    case 'master': return `Earned the title ${b.s ?? 'master'}.`;
    case 'apprenticed': return `Apprenticed to ${o}.`;
    case 'graduated': return `Finished their apprenticeship under ${o}.`;
    case 'trade': return `Became the colony's ${(PROFS[b.s ?? '']?.name ?? b.s ?? 'worker').toLowerCase()}.`;
    case 'lost': return `Lost their ${LOST[b.s ?? ''] ?? 'friend'}, ${o}.`;
    case 'adult': return 'Came of age.';
    case 'masterwork': return `Made ${b.s ?? 'a masterwork'}.`;
    case 'discovery': return `Worked out ${(TECHS[b.s ?? '']?.name ?? 'something new').toLowerCase()}, the first in the colony to do it.`;
    case 'firstbuilt': return `Built the colony's first ${(TPL[b.s ?? '']?.name ?? 'building').toLowerCase()}.`;
    case 'chronicle': return "Printed the first volume of the colony's chronicle.";
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
    default: if (b.k.startsWith('v_')) return visitBio(c, b, o);
      if (b.k.startsWith('n_')) return natBio(c, b, o);
      if (b.k.startsWith('x_')) return expBio(b, o);
      if (b.k.startsWith('d_')) return dipBio(c, b, o);
    return pretty(b.k) + (b.o ? ` (${o})` : '') + '.';
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
