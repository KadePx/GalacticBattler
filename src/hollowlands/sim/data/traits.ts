// Traits. Each has a point value (good traits cost points at creation, bad ones give points),
// shifts to stats and personality axes, and sometimes special behaviour the sim looks up by key.

import { AX } from '../types';

export type StatK = 'work' | 'learn' | 'move' | 'appetite' | 'sleep' | 'moodBase' | 'breakTh' | 'charm' | 'beauty' | 'tough' | 'immune' | 'joyNeed' | 'socNeed' | 'pain';

export interface TraitDef {
  k: string;
  name: string;
  desc: string;
  pts: number;
  group: 'temper' | 'social' | 'body' | 'mind' | 'faith' | 'appetite' | 'odd';
  /** trait keys this cannot be taken with */
  no?: string[];
  st?: Partial<Record<StatK, number>>;
  per?: [number, number][];
  /** how common among generated colonists (default 1) */
  w?: number;
}

const A = AX;
const t = (k: string, name: string, group: TraitDef['group'], pts: number, desc: string, x: Partial<TraitDef> = {}): TraitDef => ({ k, name, group, pts, desc, ...x });

export const TRAIT_LIST: TraitDef[] = [
  // Temperament
  t('cheerful', 'Cheerful', 'temper', 3, 'Finds something to smile about on the worst days.', { st: { moodBase: 8 }, no: ['gloomy', 'depressive'] }),
  t('gloomy', 'Gloomy', 'temper', -2, 'Expects the worst and is rarely surprised.', { st: { moodBase: -6 }, no: ['cheerful', 'depressive'] }),
  t('depressive', 'Melancholic', 'temper', -4, 'Carries a heaviness that never fully lifts.', { st: { moodBase: -12 }, no: ['cheerful', 'gloomy'], w: 0.5 }),
  t('steadfast', 'Steadfast', 'temper', 3, 'Bends a long way before breaking.', { st: { breakTh: -9 }, no: ['volatile', 'nervous'] }),
  t('nervous', 'Nervous', 'temper', -2, 'Frays quickly under strain.', { st: { breakTh: 7 }, no: ['steadfast', 'volatile'] }),
  t('volatile', 'Volatile', 'temper', -4, 'One bad day from an outburst, always.', { st: { breakTh: 13 }, per: [[A.TEMPER, 0.8]], no: ['steadfast', 'nervous'], w: 0.6 }),
  t('hothead', 'Hot-headed', 'temper', -2, 'Quick to anger and quicker to say so.', { per: [[A.TEMPER, 1.2]], no: ['gentle'] }),
  t('gentle', 'Gentle', 'temper', 1, 'Slow to anger. Dislikes raised voices.', { per: [[A.TEMPER, -1.2], [A.KIND, 0.4]], no: ['hothead', 'bloodlust'] }),
  t('brave', 'Brave', 'temper', 2, 'Runs toward the screaming.', { per: [[A.BRAVE, 1.3]], no: ['coward'] }),
  t('coward', 'Craven', 'temper', -2, 'Knows every hiding place in the colony.', { per: [[A.BRAVE, -1.3]], no: ['brave', 'bloodlust'] }),
  t('vengeful', 'Vengeful', 'temper', -1, 'Never forgets a wrong. Never forgives one either.', { per: [[A.LOYAL, 0.2]], no: ['forgiving'] }),
  t('forgiving', 'Forgiving', 'temper', 1, 'Lets old wounds close.', { per: [[A.KIND, 0.3]], no: ['vengeful'] }),
  t('bloodlust', 'Bloodthirsty', 'temper', -1, 'Enjoys a fight a little too much.', { per: [[A.BRAVE, 0.6], [A.TEMPER, 0.5], [A.KIND, -0.5]], no: ['gentle', 'coward', 'pacifist'], w: 0.5 }),
  t('pacifist', 'Pacifist', 'temper', -1, 'Will not raise a hand in anger.', { per: [[A.TEMPER, -0.8], [A.KIND, 0.5]], no: ['bloodlust'], w: 0.5 }),

  // Social
  t('kind', 'Kind', 'social', 2, 'Notices who is hurting and does something about it.', { per: [[A.KIND, 1.3]], st: { charm: 1 }, no: ['cruel', 'abrasive'] }),
  t('cruel', 'Cruel', 'social', -3, 'Enjoys finding the soft spot and pressing on it.', { per: [[A.KIND, -1.5]], no: ['kind'], w: 0.5 }),
  t('abrasive', 'Abrasive', 'social', -2, 'Says exactly what they think, mostly unasked.', { per: [[A.TEMPER, 0.5], [A.KIND, -0.6], [A.HONEST, 0.5]], st: { charm: -2 }, no: ['kind', 'silver'] }),
  t('silver', 'Silver-tongued', 'social', 3, 'Could sell snow to a frost giant.', { st: { charm: 3 }, no: ['abrasive', 'awkward'] }),
  t('awkward', 'Awkward', 'social', -1, 'Means well. Says it badly.', { st: { charm: -2 }, per: [[A.SOCIABLE, -0.4]], no: ['silver'] }),
  t('gregarious', 'Gregarious', 'social', 1, 'Withers without company.', { per: [[A.SOCIABLE, 1.3]], st: { socNeed: 0.4 }, no: ['loner'] }),
  t('loner', 'Loner', 'social', 0, 'Happiest when left alone.', { per: [[A.SOCIABLE, -1.4]], st: { socNeed: -0.7 }, no: ['gregarious'] }),
  t('gossip', 'Gossip', 'social', 0, 'Knows everything about everyone and shares it freely.', { per: [[A.GOSSIP, 1.5]] }),
  t('discreet', 'Discreet', 'social', 1, 'A secret told to them stays told.', { per: [[A.GOSSIP, -1.5], [A.LOYAL, 0.3]], no: ['gossip'] }),
  t('liar', 'Compulsive liar', 'social', -2, 'Would rather lie than tell the truth, even when the truth is easier.', { per: [[A.HONEST, -1.6]], no: ['honest'], w: 0.6 }),
  t('honest', 'Honest', 'social', 1, 'Cannot bring themselves to deceive.', { per: [[A.HONEST, 1.5]], no: ['liar', 'schemer'] }),
  t('schemer', 'Schemer', 'social', 0, 'Always three moves ahead, usually at someone\'s expense.', { per: [[A.AMBITION, 0.8], [A.HONEST, -0.8]], no: ['honest'] }),
  t('funny', 'Quick wit', 'social', 2, 'Always has a joke ready. Most of them land.', { per: [[A.HUMOR, 1.5]], st: { charm: 1 }, no: ['humorless'] }),
  t('humorless', 'Humourless', 'social', -1, 'Does not see what is so funny.', { per: [[A.HUMOR, -1.5]], no: ['funny'] }),
  t('flirt', 'Flirtatious', 'social', 0, 'Flirts with anyone who stands still.', { per: [[A.FLIRT, 1.4]], no: ['chaste'] }),
  t('chaste', 'Chaste', 'social', 0, 'Has no interest in romance.', { per: [[A.FLIRT, -2]], no: ['flirt', 'lecher'] }),
  t('lecher', 'Faithless', 'social', -2, 'A wandering eye and no brakes.', { per: [[A.FLIRT, 1.2], [A.LOYAL, -1.4]], no: ['chaste', 'devoted'], w: 0.6 }),
  t('devoted', 'Devoted', 'social', 2, 'Loves once, and completely.', { per: [[A.LOYAL, 1.5]], no: ['lecher'] }),
  t('jealous', 'Jealous', 'social', -2, 'Watches their partner like a hawk.', { per: [[A.TEMPER, 0.3]] }),
  t('bigot', 'Bigot', 'social', -2, 'Has no time for other peoples.', { no: ['openminded'] }),
  t('openminded', 'Open-minded', 'social', 1, 'Takes people as they come, whatever their ears look like.', { no: ['bigot'] }),
  t('ambitious', 'Ambitious', 'social', 0, 'Wants more: a title, a name, a seat at the high table.', { per: [[A.AMBITION, 1.5]], no: ['content'] }),
  t('content', 'Content', 'social', 1, 'Wants little and is glad of what they have.', { per: [[A.AMBITION, -1.4]], st: { moodBase: 3 }, no: ['ambitious', 'greedy'] }),
  t('generous', 'Generous', 'social', 1, 'Gives away the last of anything.', { per: [[A.GREED, -1.5], [A.KIND, 0.5]], no: ['greedy'] }),
  t('greedy', 'Greedy', 'social', -1, 'Counts what others have.', { per: [[A.GREED, 1.5]], no: ['generous', 'content'] }),

  // Body
  t('tough', 'Tough', 'body', 3, 'Shrugs off blows that would fell others.', { st: { tough: 0.4, pain: -0.3 }, no: ['frail'] }),
  t('frail', 'Frail', 'body', -3, 'Bruises in a stiff breeze.', { st: { tough: -0.3, immune: -0.2 }, no: ['tough'] }),
  t('hale', 'Hale', 'body', 2, 'Never seems to catch anything.', { st: { immune: 0.5 }, no: ['sickly'] }),
  t('sickly', 'Sickly', 'body', -2, 'Catches everything going round.', { st: { immune: -0.5 }, no: ['hale'] }),
  t('quick', 'Fleet', 'body', 1, 'Light on their feet.', { st: { move: 0.2 }, no: ['slow'] }),
  t('slow', 'Plodding', 'body', -1, 'Gets there eventually.', { st: { move: -0.2 }, no: ['quick'] }),
  t('beautiful', 'Beautiful', 'body', 3, 'People stop mid-sentence.', { st: { beauty: 2 }, no: ['ugly', 'homely'] }),
  t('homely', 'Homely', 'body', -1, 'A face only a mother could love.', { st: { beauty: -1 }, no: ['beautiful', 'ugly'] }),
  t('ugly', 'Hideous', 'body', -3, 'Children cry. Dogs bark.', { st: { beauty: -2 }, no: ['beautiful', 'homely'], w: 0.5 }),
  t('glutton', 'Glutton', 'appetite', -1, 'Eats for two and thinks about food constantly.', { st: { appetite: 0.4 }, no: ['ascetic'] }),
  t('ascetic', 'Ascetic', 'appetite', 1, 'Needs little and wants less. Comforts make them uneasy.', { st: { appetite: -0.2, joyNeed: -0.4 }, no: ['glutton', 'drunkard'] }),
  t('drunkard', 'Drunkard', 'appetite', -2, 'Never met a barrel they did not like.', { no: ['teetotal', 'ascetic'] }),
  t('teetotal', 'Teetotal', 'appetite', 0, 'Will not touch a drop.', { no: ['drunkard'] }),
  t('ironstomach', 'Iron stomach', 'appetite', 1, 'Eats anything, raw or rotten, without complaint.'),
  t('nightowl', 'Night owl', 'body', 0, 'Comes alive after dark and hates mornings.', { no: ['earlybird'] }),
  t('earlybird', 'Early riser', 'body', 0, 'Up before the sun, asleep by dusk.', { no: ['nightowl'] }),
  t('insomniac', 'Insomniac', 'body', -2, 'Sleep comes slowly and leaves early.', { st: { sleep: 0.25 }, no: ['heavysleeper'] }),
  t('heavysleeper', 'Heavy sleeper', 'body', 1, 'Could sleep through a siege.', { st: { sleep: -0.2 }, no: ['insomniac'] }),

  // Mind and work
  t('industrious', 'Industrious', 'mind', 3, 'Works like there are two of them.', { st: { work: 0.25 }, per: [[A.DILIGENT, 1.3]], no: ['lazy', 'slothful'] }),
  t('lazy', 'Lazy', 'mind', -2, 'Does what is asked. Eventually.', { st: { work: -0.2 }, per: [[A.DILIGENT, -1.2]], no: ['industrious', 'slothful'] }),
  t('slothful', 'Slothful', 'mind', -4, 'Has raised idleness to an art.', { st: { work: -0.35 }, per: [[A.DILIGENT, -1.8]], no: ['industrious', 'lazy'], w: 0.5 }),
  t('sharp', 'Sharp', 'mind', 3, 'Picks things up at once.', { st: { learn: 0.5 }, no: ['dull'] }),
  t('dull', 'Slow learner', 'mind', -2, 'Needs to be shown twice. Then again.', { st: { learn: -0.4 }, no: ['sharp'] }),
  t('perfectionist', 'Perfectionist', 'mind', 1, 'Slower than most, and better than most.', { st: { work: -0.1 } }),
  t('curious', 'Curious', 'mind', 1, 'Has to know what is in the box.', { per: [[A.CURIOUS, 1.5]], st: { learn: 0.15 } }),
  t('greenthumb', 'Green thumb', 'mind', 1, 'Things grow for them.'),
  t('nimble', 'Nimble fingers', 'mind', 1, 'Deft with tools, locks and other people\'s purses.'),
  t('clumsy', 'Clumsy', 'mind', -1, 'Drops it, trips over it, sits on it.', { no: ['nimble'] }),
  t('wanderlust', 'Wanderlust', 'mind', 0, 'Always wondering what is over the next hill.', { per: [[A.CURIOUS, 0.6]], no: ['homebody'] }),
  t('homebody', 'Homebody', 'mind', 0, 'Would not leave for all the silver in the hills.', { no: ['wanderlust'] }),

  // Faith
  t('pious', 'Pious', 'faith', 0, 'Sees the gods\' hand in everything.', { per: [[A.PIETY, 1.5]], no: ['skeptic'] }),
  t('skeptic', 'Sceptic', 'faith', 0, 'Believes what they can see.', { per: [[A.PIETY, -1.6]], no: ['pious', 'superstitious'] }),
  t('superstitious', 'Superstitious', 'faith', -1, 'Spits when a crow lands and never whistles indoors.', { per: [[A.PIETY, 0.5]], st: { breakTh: 3 }, no: ['skeptic'] }),

  // Odd
  t('klepto', 'Light-fingered', 'odd', -2, 'Things just end up in their pockets.', { per: [[A.GREED, 0.6], [A.HONEST, -0.6]], w: 0.5 }),
  t('pyro', 'Firebug', 'odd', -3, 'Stares at flames a little too long.', { w: 0.3 }),
  t('morbid', 'Morbid', 'odd', 0, 'At ease among the dead. Death does not trouble them.', { w: 0.6 }),
  t('nightmares', 'Haunted sleeper', 'odd', -2, 'Wakes shouting most nights.', { w: 0.6 }),
  t('talker', 'Talks to themselves', 'odd', 0, 'Holds long conversations with nobody.', { st: { socNeed: -0.2 }, w: 0.6 }),
  t('collector', 'Hoarder', 'odd', 0, 'Keeps every bone, button and bent nail.', { per: [[A.GREED, 0.5]], w: 0.6 }),
  t('animalfriend', 'Beast-friend', 'odd', 1, 'Animals trust them. People are less sure.', { w: 0.7 }),
  t('lucky', 'Lucky', 'odd', 3, 'The arrow always misses. The dice always land.', { no: ['jinxed'], w: 0.5 }),
  t('jinxed', 'Jinxed', 'odd', -3, 'If it can go wrong, it goes wrong for them.', { no: ['lucky'], w: 0.5 }),
  t('stubborn', 'Stubborn', 'temper', 0, 'Has never once changed their mind.', { st: { breakTh: -3 }, per: [[A.LOYAL, 0.3], [A.TEMPER, 0.2]] }),
  t('nosy', 'Nosy', 'social', 0, 'Reads other people\'s letters and tells you what they said.', { per: [[A.GOSSIP, 0.8], [A.CURIOUS, 0.6]], no: ['discreet'] }),
  t('proud', 'Proud', 'social', -1, 'Would rather starve than be seen to beg.', { per: [[A.AMBITION, 0.5], [A.TEMPER, 0.3]], st: { charm: -1 } }),
  t('softhearted', 'Soft-hearted', 'temper', 0, 'Cries at weddings, funerals and lame dogs.', { per: [[A.KIND, 0.8]], st: { breakTh: 3 }, no: ['cruel', 'bloodlust'] }),
  t('ironwilled', 'Iron-willed', 'mind', 3, 'Decides once and does not look back.', { st: { breakTh: -6, work: 0.05 }, no: ['nervous', 'volatile'] }),
  t('scatterbrained', 'Scatterbrained', 'mind', -1, 'Went to fetch water, came back with a hat.', { st: { work: -0.1, learn: -0.1 }, per: [[A.DILIGENT, -0.5]], no: ['perfectionist'] }),
  t('storyteller', 'Storyteller', 'odd', 1, 'Can hold a room with a tale.', { st: { charm: 1 }, per: [[A.HUMOR, 0.4]] }),
];

export const TRAITS: Record<string, TraitDef> = Object.fromEntries(TRAIT_LIST.map((x) => [x.k, x]));

export function traitsClash(a: string, b: string): boolean {
  return a === b || !!TRAITS[a]?.no?.includes(b) || !!TRAITS[b]?.no?.includes(a);
}
