// Turns what the sim records into words. Display only: changing the wording here never
// changes what happens in a colony.

import { SEASON_NAMES, when } from './config';
import { TPL } from './sim/data/buildings';
import { PROFS } from './sim/data/professions';
import { RACES } from './sim/data/races';
import { TH } from './sim/data/thoughts';
import { person } from './sim/pawn';
import type { Colony, Ev, Id } from './sim/types';

export function dateText(tick: number, withTime = false): string {
  const w = when(tick);
  const base = `${w.day} ${SEASON_NAMES[w.season]}, Year ${w.year}`;
  return withTime ? `${base}, ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}` : base;
}

const first = (c: Colony, id: Id | undefined): string => {
  const p = id ? person(c, id) : undefined;
  return p ? p.first : 'someone';
};
const full = (c: Colony, id: Id | undefined): string => {
  const p = id ? person(c, id) : undefined;
  return p ? `${p.first} ${p.fam}` : 'someone';
};

const CAUSES: Record<string, string> = {
  age: 'died of old age',
  starved: 'starved to death',
  brawl: 'was killed in a brawl',
  childbirth: 'died in childbirth',
  cold: 'froze to death',
  sickness: 'died of sickness',
  wounds: 'died of their wounds',
  raid: 'was killed in a raid',
  beast: 'was killed by a beast',
  murder: 'was murdered',
  executed: 'was put to death',
  accident: 'died in an accident',
};

const BREAKS: Record<string, string> = {
  sulk: 'has shut themselves away and will not speak to anyone',
  bingefood: 'is eating everything in sight',
  bingedrink: 'has crawled into a barrel',
  wander: 'has walked off into the wild in a daze',
  rave: 'is raging at anyone who comes near',
  tantrum: 'is smashing things',
};

const FACTS: Record<string, string> = {
  affair: 'an affair',
  scene: 'an ugly scene',
  drunk: 'a drunken night',
  kind: 'a kindness',
  hero: 'a brave deed',
  coward: 'an act of cowardice',
  theft: 'a theft',
  killing: 'a killing',
  slander: 'a nasty rumour',
  brawl: 'a brawl',
  bastard: 'a child\'s true father',
};

/** How much an event matters: 3 life-changing, 2 notable, 1 colour, 0 noise. */
export const WEIGHT: Record<string, number> = {
  death: 3, birth: 3, wedding: 3, lovers: 2, betrothed: 2, divorce: 3, breakup: 2, found_out: 3, affair: 2, bastard_plain: 3, stillbirth: 3,
  brawl: 2, break: 2, tantrum: 2, friends: 2, rivals: 2, reconciled: 2, masterwork: 2, inspired: 2, convert: 2, adult: 2, left: 3, funeral: 2,
  built: 1, plan: 0, trade: 1, harvest: 1, hunt: 1, frost: 1, mock: 2, defend: 2, refused: 2, wedding_set: 1, wedding_off: 2, feast: 2,
  insult: 1, argue: 1, comfort: 1, deeptalk: 1, gossip: 1, story: 1, apology: 1, gift: 1, rebuff: 1, flirt: 1, drunk: 1, unfriend: 1, pregnant: 2,
};

export function evText(c: Colony, e: Ev): string {
  const a = first(c, e.a);
  const b = first(c, e.b);
  switch (e.k) {
    case 'death': return `${full(c, e.a)} ${CAUSES[e.s ?? ''] ?? 'died'}${e.b && e.s === 'brawl' ? ` at the hands of ${full(c, e.b)}` : ''}.`;
    case 'birth': return `${full(c, e.b)} gave birth to ${a}${e.n && person(c, e.n) ? `, child of ${first(c, e.n)}` : ''}.`;
    case 'stillbirth': return `${full(c, e.a)} lost her baby.`;
    case 'pregnant': return `${a} is expecting a child.`;
    case 'bastard_plain': return `One look at baby ${a} and the whole colony knows ${first(c, e.n)} is not the father.`;
    case 'adult': return `${full(c, e.a)} has come of age.`;
    case 'lovers': return `${a} and ${b} have fallen for each other.`;
    case 'affair': return `${a} and ${b} have begun something they should not have.`;
    case 'flirt': return `${a} and ${b} were seen flirting.`;
    case 'rebuff': return `${b} turned ${a} down flat.`;
    case 'betrothed': return `${a} asked ${b} to marry, and ${b} said yes.`;
    case 'refused': return `${a} asked for ${b}'s hand and was refused.`;
    case 'wedding_set': return `${a} and ${b} will be wed tomorrow.`;
    case 'wedding_off': return `The wedding of ${a} and ${b} did not happen.`;
    case 'wedding': return `${a} and ${b} were married${e.n ? ` before ${e.n} guests` : ''}.`;
    case 'breakup': return `${a} has ended things with ${b}.`;
    case 'divorce': return `${a} has left their marriage to ${b}.`;
    case 'found_out': return e.s === 'child' ? `${a} has learned the child is not theirs. ${b} has some explaining to do.` : `${a} has found out about ${b} and ${first(c, e.n)}.`;
    case 'friends': return `${a} and ${b} have become friends.`;
    case 'rivals': return `${a} and ${b} now openly despise each other.`;
    case 'unfriend': return `${a} and ${b} have drifted apart.`;
    case 'reconciled': return `${a} and ${b} have buried the hatchet.`;
    case 'insult': return `${a} insulted ${b}.`;
    case 'argue': return `${a} and ${b} had a shouting match.`;
    case 'brawl': return `${a} and ${b} came to blows. ${a} won.`;
    case 'mock': return `${a} mocked ${b} in front of everyone.`;
    case 'defend': return `${a} stood up for ${b} against ${first(c, e.n)}.`;
    case 'comfort': return `${a} comforted ${b}.`;
    case 'deeptalk': return `${a} and ${b} talked long into the hour.`;
    case 'gossip': return `${a} told ${b} about ${FACTS[e.s ?? ''] ?? 'something'} involving ${first(c, e.n)}.`;
    case 'story': return `${a} held ${e.n ?? 'a few'} listeners with a tale.`;
    case 'apology': return `${a} apologised to ${b}.`;
    case 'gift': return `${a} gave ${b} a gift.`;
    case 'convert': return `${a} has taken up ${b}'s faith.`;
    case 'drunk': return `${a} got roaring drunk and made a fool of themselves.`;
    case 'break': return `${full(c, e.a)} ${BREAKS[e.s ?? ''] ?? 'has broken down'}.`;
    case 'tantrum': return `${a} wrecked part of the ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'colony'} in a rage.`;
    case 'inspired': return `${a} is ${e.s === 'frenzy' ? 'working like someone possessed' : e.s === 'insight' ? 'seeing everything clearly at last' : 'struck by an idea for something beautiful'}.`;
    case 'masterwork': return `${a} made ${e.s ?? 'a masterwork'}.`;
    case 'trade': return `${a} is now the colony's ${PROFS[e.s ?? '']?.name.toLowerCase() ?? e.s}.`;
    case 'built': return `${a} finished the ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'}.`;
    case 'plan': return `Work begins on a ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'}.`;
    case 'harvest': return `${a} brought in the last of the ${e.s === 'grain' ? 'barley' : e.s === 'flax' ? 'flax' : 'roots'}.`;
    case 'hunt': return `${a} came back with a fine kill.`;
    case 'frost': return 'The first hard frost. Anything still in the fields is lost.';
    case 'funeral': return `${e.n ?? 'A few'} gathered to bury ${full(c, e.a)}.`;
    case 'feast': return `The colony feasted.`;
    case 'left': return `${full(c, e.a)} has left the colony.`;
    default: return `${e.k}: ${a}${e.b ? ' and ' + b : ''}`;
  }
}

export function thoughtText(c: Colony, k: string, o?: Id): string {
  const d = TH[k];
  if (!d) return k;
  return d.t.replace('{o}', first(c, o));
}

const WHY: Record<string, string> = {
  hungry: 'Hungry', starving: 'Starving', tired: 'Worn out', exhausted: 'Collapsed from exhaustion', night: 'Time to sleep', break: 'Not in their right mind',
  bored: 'Needed a break', idle: 'Nothing pressing to do', free: 'Free time', love: 'Wanted to see their love', crush: 'Could not stay away', friend: 'Wanted company', family: 'Wanted family',
  child: 'Being a child', baby: 'Being a baby', wedding: 'At the wedding', funeral: 'At the funeral', feast: 'At the feast', grief: 'Grieving', new: 'Just arrived',
  drink: 'Fancied a drink', drinkbored: 'Bored, so: a drink', relax: 'Resting', walk: 'Stretching their legs', pray: 'Praying', dice: 'Feeling lucky', hobby: 'Doing what they love',
  stargaze: 'Looking at the stars', bathe: 'Having a wash', perform: 'Had an audience', stopped: 'Interrupted', born: 'Newborn',
};

export function whyText(why: string): string {
  return WHY[why] ?? why;
}

export function raceName(k: string): string {
  return RACES[k as keyof typeof RACES]?.name ?? k;
}
