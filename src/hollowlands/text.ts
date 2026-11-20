// Turns what the sim records into words. Display only: changing the wording here never
// changes what happens in a colony.

import { SEASON_NAMES, when } from './config';
import { TPL } from './sim/data/buildings';
import { TECHS } from './sim/data/tech';
import { PROFS, PROF_LIST } from './sim/data/professions';
import { RACES } from './sim/data/races';
import { TH } from './sim/data/thoughts';
import { person } from './sim/pawn';
import { rulerTitle } from './sim/gov';
import type { Colony, Ev, Id } from './sim/types';

/** "Day 13 of Autumn, Year 3", optionally with the time of day. */
export function dateText(tick: number, withTime = false): string {
  const w = when(tick);
  const base = `Day ${w.day} of ${SEASON_NAMES[w.season]}, Year ${w.year}`;
  return withTime ? `${base} · ${clockText(tick)}` : base;
}

/** The time of day on a twelve-hour clock: "6:12 pm". */
export function clockText(tick: number): string {
  const w = when(tick);
  const h = w.hour % 12 || 12;
  return `${h}:${String(w.minute).padStart(2, '0')} ${w.hour < 12 ? 'am' : 'pm'}`;
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
  berserk: 'was killed by someone gone berserk',
  executed: 'was put to death',
  accident: 'died in an accident', match: 'was sent away to be married', escaped: 'escaped from thralldom', raiding: 'died raiding another colony', foe_raider: 'was killed by raiders from another colony', moved: 'left for another colony', settled: 'left to found a new colony', duel: 'died fighting for the seat', coup: 'was killed when the seat was seized', exiled: 'was exiled',
  bled: 'bled to death',
  taken: 'was carried off by slavers',
  foe_bandit: 'was cut down by bandits', foe_slaver: 'was killed by slavers', foe_orc: 'was butchered by orc raiders', foe_wolf: 'was torn apart by wolves',
  foe_ghoul: 'was dragged down by ghouls', foe_troll: 'was crushed by a troll', foe_boar: 'was gored by a boar',
  sick_flux: 'died of the flux', sick_fever: 'died of rot fever', sick_plague: 'died of the grey plague', sick_cough: 'died of lung-cough', sick_pox: 'died of goblin pox',
};

const BREAKS: Record<string, string> = {
  murder: 'has gone very quiet, and picked up a knife',
  sulk: 'has shut themselves away and will not speak to anyone',
  bingefood: 'is eating everything in sight',
  bingedrink: 'has crawled into a barrel',
  wander: 'has walked off into the wild in a daze',
  rave: 'is raging at anyone who comes near',
  tantrum: 'is smashing things',
  berserk: 'has gone berserk and is attacking anyone near',
};

const FOE_ONE: Record<string, string> = { raider: 'raider', bandit: 'bandit', slaver: 'slaver', orc: 'orc raider', wolf: 'wolf', ghoul: 'ghoul', troll: 'troll', boar: 'maddened boar' };
const FOE_MANY: Record<string, string> = { raider: 'raiders', bandit: 'bandits', slaver: 'slavers', orc: 'orc raiders', wolf: 'wolves', ghoul: 'ghouls', troll: 'trolls', boar: 'maddened boars' };
const ILL: Record<string, string> = { flux: 'the flux', fever: 'rot fever', plague: 'the grey plague', cough: 'lung-cough', pox: 'goblin pox' };
const PART: Record<string, string> = {
  eyeL: 'eye', eyeR: 'eye', armL: 'arm', armR: 'arm', handL: 'hand', handR: 'hand', legL: 'leg', legR: 'leg', footL: 'foot', footR: 'foot',
};

const CRIME: Record<string, string> = { theft: 'theft', murder: 'murder', assault: 'attempted murder', treason: 'treason', heresy: 'heresy', arson: 'setting fires' };
const SENTENCE = ['found not guilty', 'fined', 'put in the stocks', 'flogged', 'branded', 'had a hand cut off', 'exiled', 'hanged'];

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
  secret: 'a secret past',
  attack: 'an attempted killing',
  brawl: 'a brawl',
  bastard: 'a child\'s true father',
};

/** How much an event matters: 3 life-changing, 2 notable, 1 colour, 0 noise. */
export const WEIGHT: Record<string, number> = {
  death: 3, birth: 3, wedding: 3, lovers: 2, betrothed: 2, divorce: 3, breakup: 2, found_out: 3, affair: 2, bastard_plain: 3, stillbirth: 3,
  brawl: 2, break: 2, tantrum: 2, friends: 2, rivals: 2, reconciled: 2, masterwork: 2, inspired: 2, convert: 2, adult: 2, left: 3, funeral: 2,
  built: 1, stonework: 2, plan: 0, trade: 1, harvest: 1, hunt: 1, frost: 1, mock: 2, defend: 2, refused: 2, wedding_set: 1, wedding_off: 2, feast: 2,
  ruler: 3, election: 3, usurped: 3, regent: 2, regency_ends: 2, house_ends: 3, house_founded: 3, duel: 3, challenge: 3, coup: 3, plot_failed: 3, title: 2, raised: 2, law: 2,
  theft: 2, theft_hushed: 1, accused: 2, trial_set: 1, trial: 3, murder: 3, attack: 3, sermon: 1, saint: 3,
  raid: 3, allclear: 1, alarm: 2, rout: 2, slew: 2, looted: 3, seized: 3, rescued: 3, hero: 3, maimed: 3, sick: 2, recovered: 1, outbreak: 3, drunkard: 2,
  settlers: 3, founded: 3, news: 2,
  odd_goat: 3, odd_ring: 3, odd_raven: 3, odd_ogre: 3, odd_ghost: 3, odd_mushroom: 3, odd_coat: 3, odd_oath: 3, odd_bones: 2, odd_cat: 2, odd_weep: 2,
  schism: 3, fire_spread: 3, match_sent: 3, match: 3,
  asked: 2, blackmail: 3, prosthetic: 2, captured: 3, ransomed: 1, freed: 3, escaped: 3, plot: 3, plot_fades: 2, cult_whisper: 2, cult_found: 3, rite: 2, cult_rises: 3,
  raidout: 3, raiders_from: 2, raidback: 3, war_declared: 3, war_on_us: 3, incident: 2, set_out: 3, pen_stocked: 2, master: 3, dream: 3, festival_set: 1, festival: 2, contest: 2, apprenticed: 2, graduated: 2, bought_beasts: 1, dogcame: 2, adopted: 2, dogdied: 2, dogbark: 2, slaughter: 1, warband: 3, peace_sued: 3, peace_made: 3, spotted: 2, brokeup: 1, berserk_hit: 3, subdued: 3, subdue_failed: 2,
  market: 2, market_first: 3, market_sale: 2, carter: 1, alms: 1, feast_paid: 2,
  feast_set: 2, audience: 2, prosper: 2, home_lost: 2, razed: 1, castle: 3, walls: 3, siege: 3, breach: 3, mended: 2,
  discovery: 3, firstbuilt: 3, chronicle: 2, tech_trader: 1, glazed_first: 2, jewels_first: 2,
  joined: 3, blabbed: 3, heir: 3, heirloom: 2, nudge: 1, trader: 1, bard: 1, herd: 1, omen: 1, healer_visit: 1, bumper: 1, blight: 3, drought: 2, coldsnap: 2, storm: 2, fire: 3, rats: 2, eclipse: 2,
  insult: 1, argue: 1, comfort: 1, deeptalk: 1, gossip: 1, story: 1, apology: 1, gift: 1, rebuff: 1, flirt: 1, drunk: 1, unfriend: 1, pregnant: 2,
};

/** One of what each market stall sells, and the stall itself. */
const WARE_ONE: Record<string, string> = { bread: 'loaf', meat: 'cut of meat', cloth: 'bolt of cloth', pots: 'pot', tools: 'tool', ale: 'cask of ale', greens: 'basket of greens', fish: 'fish', dairy: 'cheese', herbs: 'remedy' };
const WARE_STALL: Record<string, string> = { bread: 'bread', meat: 'meat', cloth: 'cloth', pots: 'pots', tools: 'tools', ale: 'ale', greens: 'greens', fish: 'fish', dairy: 'eggs and cheese', herbs: 'herbs' };
const WARE_NAME: Record<string, string> = { bread: 'Bread', meat: 'Meat', cloth: 'Cloth', pots: 'Pots', tools: 'Tools', ale: 'Ale', greens: 'Greens', fish: 'Fish', dairy: 'Eggs and cheese', herbs: 'Herbs' };
export const wareName = (k: string): string => WARE_NAME[k] ?? k;
const PLURAL = new Set(['pots', 'tools', 'greens', 'herbs', 'dairy']);

/** A market day's summary: stalls, buyers, the busiest stall, and what was dear or cheap (e.s 'stalls|buyers|ware|dear:bread'), silver in e.n. */
function marketText(c: Colony, e: Ev): string {
  const [stalls, buyers, ware, said] = (e.s ?? '').split('|');
  let t = `Market day: ${buyers || 'a crowd of'} people went round ${stalls || 'the'} stalls, and ${e.n ?? 0} silver changed hands.`;
  if (e.a) t += ` ${first(c, e.a)}'s ${WARE_STALL[ware] ?? 'stall'} sold best.`;
  if (said) {
    const [k, w] = said.split(':');
    t += ` ${WARE_NAME[w] ?? w} ${PLURAL.has(w) ? 'were' : 'was'} ${k === 'dear' ? 'dear' : 'cheap'}.`;
  }
  return t;
}

/** The castle's stages in the chronicle: begun (e.s 'begun') and finished ('done'), stage in e.n. */
function castleText(c: Colony, e: Ev): string {
  const p = e.a ? person(c, e.a) : undefined;
  const lord = p ? 'the ' + rulerTitle(c, p).toLowerCase() : 'the colony';
  const Lord = lord.charAt(0).toUpperCase() + lord.slice(1);
  const name = p ? first(c, e.a) : '';
  if (e.s === 'rebuild') return 'Part of the castle was lost. The masons have laid out its foundations again.';
  if (e.s === 'begun') {
    if (e.n === 1) return `${Lord} has begun a keep on the hill: first a ring of sharpened stakes, and a timber hall inside it.`;
    if (e.n === 2) return `Masons are at work on the hill. ${p ? rulerTitle(c, p) + ' ' + name : 'The colony'} will have a keep of stone.`;
    return 'Work has begun on the castle walls: a curtain of stone, a tower at each corner, and a gatehouse facing the town.';
  }
  if (e.n === 1) return `The palisade stands on the hill, and the timber hall within it.${name ? ` ${name} has moved up from the town.` : ''}`;
  if (e.n === 2) return `The keep stands in stone. Banners hang in its great hall${name ? `, and ${name} sits on the throne` : ''}.`;
  return 'The castle walls are finished. The gates are hung, the towers stand ready, and the courtyard is laid with stone.';
}

/** The town wall going up, stage by stage (e.s 'begun' or 'done', the stage in e.n). */
function wallsText(c: Colony, e: Ev): string {
  const p = e.a ? person(c, e.a) : undefined;
  const who = p ? `${rulerTitle(c, p)} ${p.first}` : 'The colony';
  if (e.s === 'begun') {
    if (e.n === 1) return `${who} has ordered a wall round the town. A ditch is being dug along the line, and a palisade of sharpened stakes raised behind it, with timber towers and gates where the roads go out.`;
    return 'Masons have begun to rebuild the town wall in stone, stretch by stretch, with stone towers and a gatehouse on every road.';
  }
  if (e.n === 1) return 'The palisade is finished: a ditch and a ring of stakes round the whole town, with towers and gates. From now on the gates are shut at dusk.';
  return 'The town wall stands in stone all the way round. Gatehouses guard the roads, and towers rise along it.';
}

const BREACH: Record<string, string> = { palisade: 'the palisade', wall: 'the town wall', gate: 'the gate', gatehouse: 'the gatehouse gates', tower: 'a wall tower' };

/** A siege, beat by beat: e.s is 'what:host name[:more]'. */
function siegeText(c: Colony, e: Ev): string {
  const [what, name, more] = (e.s ?? '').split(':');
  const host = name ? `${name}'s host` : 'The host';
  const lead = e.a ? person(c, e.a) : undefined;
  const n = e.n ?? 0;
  switch (what) {
    case 'begin': return `${host} has come: ${n} ${FOE_MANY[more ?? ''] ?? 'warriors'} have made camp on the road outside the walls. The gates are shut and barred.`;
    case 'ladders': return `In the camp outside the walls they are lashing ladders together. They have ${n} now.`;
    case 'ram': return 'The besiegers have felled a tree and made a ram, roofed over with hides.';
    case 'rations': return `${lead ? `${rulerTitle(c, lead)} ${lead.first}` : 'The colony'} has ordered short rations. Nobody knows how long the gates must stay shut${n ? `, and there are ${n} days of food in the stores` : ''}.`;
    case 'sally': return `The gates were thrown open and ${lead ? lead.first : 'the colony'} led ${n} fighters out against the camp!`;
    case 'sallyhungry': return `With the stores nearly empty, ${lead ? lead.first : 'the colony'} led ${n} fighters out of the gates to break the siege.`;
    case 'paid': return `${lead ? lead.first : 'The colony'} sent ${n} silver out to the camp. ${host.charAt(0).toUpperCase() + host.slice(1)} took it, and is breaking camp.`;
    case 'gaveup': return `After ${n} days the besiegers' food has run out. They are breaking camp and going home.`;
    case 'assault': return `${host.charAt(0).toUpperCase() + host.slice(1)} is coming on with ladders and a ram: ${n} of them, against the walls!`;
    case 'ladder': return 'A ladder is up against the wall, and one of them is over the top!';
    case 'end': return more === 'won' ? `The siege is over. ${host.charAt(0).toUpperCase() + host.slice(1)} is broken, after ${n} day${n === 1 ? '' : 's'}.` : more === 'bought' ? `The siege is over, bought off after ${n} day${n === 1 ? '' : 's'}.` : `The siege is lifted. The last of ${host.charAt(0).toLowerCase() + host.slice(1)} has gone down the road.`;
  }
  return 'The siege goes on.';
}

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
    case 'stonework': return `The ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'} stands in stone now. ${a} set the last block.`;
    case 'built': return `${a} finished the ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'}.`;
    case 'discovery': return discoveryText(c, e);
    case 'firstbuilt': return `${full(c, e.a)} built the first ${bldName(e.s)} in ${c.name}.`;
    case 'tech_trader': { const [k, from] = (e.s ?? ':').split(':'); return `The traders from ${from} talked of ${(TECHS[k]?.name ?? 'their new ways').toLowerCase()} all evening, and people here listened.`; }
    case 'glazed_first': return `${a} fitted the colony's first glass windows, in a ${bldName(e.s)}. People keep stopping to look through them.`;
    case 'jewels_first': return `${a} has made the colony's first piece of jewellery: a silver ring for ${b}.`;
    case 'chronicle': return (e.n ?? 1) <= 1 ? `${a} has printed the first volume of the Chronicle of ${c.name}. Copies are going from hand to hand.` : `The press has finished volume ${e.n} of the Chronicle of ${c.name}.`;
    case 'plan': return `Work begins on a ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'}.`;
    case 'prosper': return `${e.b ? `${a} and ${b} have` : `${a} has`} put ${e.n ?? 'some'} silver toward a ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'home'} of their own.`;
    case 'home_lost': return `${a} can no longer keep up the ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'house'}. It goes to whoever needs a roof.`;
    case 'castle': return castleText(c, e);
    case 'walls': return wallsText(c, e);
    case 'siege': return siegeText(c, e);
    case 'breach': return `They have broken through ${BREACH[e.s ?? ''] ?? 'the wall'}!`;
    case 'mended': return e.s === 'gate' ? 'The broken gate has been rehung and barred.' : 'The breach in the wall has been closed.';
    case 'razed': return `The empty ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'house'} had fallen in, and was pulled down for its timber.`;
    case 'harvest': return `${a} brought in the last of the ${e.s === 'grain' ? 'barley' : e.s === 'flax' ? 'flax' : 'roots'}.`;
    case 'hunt': return `${a} came back with a fine kill.`;
    case 'frost': return 'The first hard frost. Anything still in the fields is lost.';
    case 'funeral': return e.n ? `${e.n} gathered to bury ${full(c, e.a)}.` : `Nobody came to bury ${full(c, e.a)}.`;
    case 'feast': return `${e.n ?? 'The whole colony'} sat down to the feast. The hall was loud until late.`;
    case 'feast_set': return e.s === 'harvest' ? 'The harvest is in. There will be a feast tonight.' : 'Midwinter. There will be a feast tonight, to spite the dark.';
    case 'audience': return e.s === 'granted' ? `${b} came before ${a} with empty hands, and did not leave with them empty.` : `${b} brought a plea before ${a} and was sent away.`;
    case 'left': return e.s === 'match' ? `${full(c, e.a)} has left to be married in another colony.` : e.s === 'escaped' ? `${full(c, e.a)} is gone, and so are the chains.` : e.s === 'exiled' ? `${full(c, e.a)} was cast out of the colony.` : e.s === 'moved' ? `${full(c, e.a)} packed up and left for another colony.` : e.s === 'settled' ? `${full(c, e.a)} left with the settlers.` : e.s === 'taken' ? `${full(c, e.a)} was carried off in chains.` : `${full(c, e.a)} has left the colony.`;
    case 'ruler': return `${full(c, e.a)} now rules${e.s === 'inherited' ? ', as was their birthright' : e.s === 'elected' ? ', by the colony\'s vote' : e.s === 'fought' ? ', by strength of arm' : e.s === 'coup' ? ', by force' : e.s === 'usurped' ? ', over the rightful heir' : ''}.`;
    case 'election': return `The colony voted. ${full(c, e.a)} won with ${e.n} votes${e.b ? `, beating ${first(c, e.b)}` : ''}.`;
    case 'usurped': return `${a} pushed ${b} aside and took the seat.`;
    case 'regent': return `${a} will rule in ${b}'s name until the child is grown.`;
    case 'regency_ends': return `${a} is of age and rules alone now.`;
    case 'house_ends': return `The house of ${e.s} has no heir. Its rule is over.`;
    case 'house_founded': return `${full(c, e.a)} has declared that the seat will pass to their children. The house of ${e.s} begins.`;
    case 'duel': return `${a} and ${b} fought for the seat. ${a} won.`;
    case 'challenge': return e.s === 'won' ? `${a} challenged ${b} for the seat and won.` : `${a} challenged ${b} for the seat and was beaten down.`;
    case 'coup': return `${full(c, e.a)} has seized the colony with ${e.n} behind them. ${b} is thrown down.`;
    case 'plot_failed': return `${a}'s plot against ${b} has come to light.`;
    case 'title': return `${b} has named ${a} ${e.s}.`;
    case 'raised': return `${a} is now counted among the colony's ${e.n === 4 ? 'notables' : 'betters'}.`;
    case 'law': return e.s === 'ration_on' ? 'The stores are low: food is rationed from today.' : 'Rationing has ended.';
    case 'theft': return `${b} caught ${a} stealing ${e.s === 'food' ? 'food' : e.s === 'ale' ? 'ale' : 'from the stores'}.`;
    case 'theft_hushed': return `${b} saw ${a} stealing and said nothing.`;
    case 'accused': return `${a} has accused ${b} of ${CRIME[e.s ?? ''] ?? 'a crime'}.`;
    case 'trial_set': return `${a} will stand trial for ${CRIME[e.s ?? ''] ?? 'a crime'} at noon.`;
    case 'trial': return `${full(c, e.a)} was tried for ${CRIME[e.s ?? ''] ?? 'a crime'} and ${SENTENCE[e.n ?? 0] ?? 'judged'}.`;
    case 'murder': return e.b ? `${full(c, e.a)} was murdered by ${full(c, e.b)}.` : `${full(c, e.a)} was found dead. Nobody saw who did it.`;
    case 'attack': return `${a} went for ${b} with a blade.`;
    case 'sermon': return `${a} preached to ${e.n} of the faithful.`;
    case 'saint': return `People have begun to pray to ${full(c, e.a)}.`;
    case 'raid': return `${e.n === 1 ? 'A' : e.n} ${e.n === 1 ? FOE_ONE[e.s ?? ''] ?? e.s : FOE_MANY[e.s ?? ''] ?? e.s} ${e.s === 'wolf' || e.s === 'boar' || e.s === 'ghoul' || e.s === 'troll' ? (e.n === 1 ? 'is' : 'are') + ' closing on the colony' : 'came up the road with weapons drawn'}.`;
    case 'alarm': return 'The alarm is raised!';
    case 'allclear': return 'It is over. The colony counts its wounds.';
    case 'rout': return `The ${FOE_MANY[e.s ?? ''] ?? 'attackers'} broke and ran.`;
    case 'slew': { const f = FOE_ONE[e.s ?? ''] ?? 'foe'; return `${a} killed ${/^[aeiou]/.test(f) ? 'an' : 'a'} ${f}.`; }
    case 'looted': return `${FOE_MANY[e.s ?? ''] ?? 'Raiders'} broke into the stores and carried off what they could.`.replace(/^./, (x) => x.toUpperCase());
    case 'seized': return `${full(c, e.a)} has been seized by slavers!`;
    case 'rescued': return `${a} cut ${b} free from the slavers.`;
    case 'hero': return `${full(c, e.a)} killed ${e.n} of them. Nobody will forget it.`;
    case 'maimed': { const part = PART[e.s ?? ''] ?? 'limb'; return `${a} has lost ${/^[aeiou]/.test(part) ? 'an' : 'a'} ${part}.`; }
    case 'sick': return `${a} has come down with ${ILL[e.s ?? ''] ?? 'something'}.`;
    case 'recovered': return `${a} has recovered from ${ILL[e.s ?? ''] ?? 'their illness'}.`;
    case 'outbreak': return `${ILL[e.s ?? ''] ?? 'Sickness'} has broken out.`.replace(/^./, (x) => x.toUpperCase());
    case 'drunkard': return `${a} cannot stay away from the barrel any more.`;
    case 'settlers': return `${full(c, e.a)} has led ${(e.n ?? 2) - 1} others out to found a new colony.`;
    case 'founded': return `${full(c, e.a)} and ${(e.n ?? 2) - 1} others from ${e.s} raised the first roof here.`;
    case 'news': { const [what, name] = (e.s ?? '').split(':'); const who = (e.s ?? '').split(':')[2]; return what === 'founded' ? `Word has come back: the settlers have founded ${name}.` : what === 'ruler' ? `News from ${name}: ${who || 'someone new'} rules there now.` : what === 'coup' ? `News from ${name}: the seat was taken by force.` : what === 'outbreak' ? `News from ${name}: sickness has broken out there.` : what === 'warlord' ? `Riders on the road: ${name} is on the march with a host.` : what === 'saint' ? `News from ${name}: they are praying to ${who || 'one of their dead'}.` : what === 'tech' ? techNews(name, who) : `News from ${name}.`; }
    case 'captured': return `${e.s === 'orc' ? 'An' : 'A'} ${FOE_ONE[e.s ?? ''] ?? 'raider'} was taken alive and put in chains: ${full(c, e.a)}.`;
    case 'ransomed': return 'A captured raider was ransomed back for silver.';
    case 'freed': return e.s === 'law' ? `${full(c, e.a)} is a thrall no longer: the new rule keeps no chains.` : `${full(c, e.a)} has earned their freedom.`;
    case 'escaped': return `${full(c, e.a)} slipped their chains in the night.`;
    case 'plot': return `${a} has begun to speak against ${b}, quietly, to people who might listen.`;
    case 'plot_fades': return `${a}'s plot has come to nothing.`;
    case 'cult_whisper': return `${a} has started leaving the house after dark.`;
    case 'cult_found': return `${b} has found out what ${a} prays to.`;
    case 'rite': return `${e.n} people were missing from their beds last night.`;
    case 'cult_rises': return `The Hollow Mother's ${e.n} no longer hide. They pray in the open now.`;
    case 'odd_goat': return `With the stores nearly bare, ${a} has declared the goat a sign from the gods. People are bringing it their questions.`;
    case 'odd_ring': return `${a} dug up a ring that is always cold, and will not let anyone else hold it.`;
    case 'odd_raven': return `A raven has been saying things it should not know, about ${a}. ${e.n} people heard.`;
    case 'odd_ogre': return `An ogre walked in off the road and asked, politely, for work. ${a} is staying.`;
    case 'odd_ghost': return `${a} swears ${b} was at the window last night.`;
    case 'odd_mushroom': return `${a} ate something from the wood, lay still for a day, and got up talking about the shape of everything.`;
    case 'odd_coat': return 'The tall trader who sold the colony its "medicine" turned out to be two goblins in a long coat. The medicine is river water.';
    case 'odd_oath': return `Deep in his cups, ${a} swore before everyone to guard the ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'hall'} door for life. Sober, ${a} means to keep the oath.`.replace('in his cups', 'in their cups');
    case 'odd_bones': return 'The ground gave way behind the stores: a pit, full to the brim with very old bones.';
    case 'odd_cat': return 'A three-legged cat has moved in and will not be moved out.';
    case 'odd_weep': return 'The altar stone was wet this morning. It has not rained.';
    case 'prosthetic': return `${a} has been fitted with a ${e.s?.startsWith('hand') ? 'hook' : 'wooden leg'}.`;
    case 'schism': return `${a} has broken with ${b} over the faith, and ${e.n} have followed into ${e.s === 'hearth_r' ? 'the Cold Hearth' : e.s === 'iron_r' ? 'the Unbound' : e.s === 'pale_r' ? 'the Red Lady' : e.s === 'green_r' ? 'the Deep Root' : 'the Clean Fang'}.`;
    case 'fire_spread': return `The fire jumped to ${e.n} more ${e.n === 1 ? 'roof' : 'roofs'} before it was beaten down.`;
    case 'match_sent': return `${b} has sent ${a} to ${e.s}, to marry into the house there.`;
    case 'match': return `${a} of ${e.s} is to marry ${b}: a match made between two colonies.`;
    case 'asked': return `${a} has a choice to make.`;
    case 'blackmail': return `${a} is making ${b} pay to keep a secret.`;
    case 'heir': return `${full(c, e.a)} takes up where ${first(c, e.b)} left off.`;
    case 'heirloom': return `${a} now keeps ${b}'s ${e.s ?? 'keepsake'}.`;
    case 'nudge': return e.s === 'yearn' ? `${a} has begun to look at the road.` : e.s === 'stay' ? `${a} has decided this is home.` : e.s === 'focus' ? `${a} has thrown themselves into their work.` : e.s === 'trade' ? (e.n !== undefined && e.n >= 0 && PROF_LIST[e.n] ? `${a} has asked to work as ${/^[aeiou]/i.test(PROF_LIST[e.n].name) ? 'an' : 'a'} ${PROF_LIST[e.n].name.toLowerCase()}.` : `${a} will take whatever trade suits them.`) : `${a} has ${b} on their mind.`;
    case 'blabbed': return `Drunk, ${a} let slip the secret they came here to bury. ${e.n} heard it.`;
    case 'joined': return e.s?.startsWith('match:') ? `${full(c, e.a)} has arrived from ${e.s.slice(6)}, sent to be married.` : e.s?.startsWith('exile:') ? `${full(c, e.a)} has arrived, cast out of ${e.s.slice(6)}.` : e.s?.startsWith('migrant:') ? `${full(c, e.a)} has come from ${e.s.slice(8)} to start again.` : e.s === 'refugee' ? `${full(c, e.a)} staggered in off the road, fleeing something worse.` : `${full(c, e.a)} has come to live here.`;
    case 'trader': return e.s ? `A caravan from ${e.s} stopped for the day.` : 'A trader\'s caravan stopped for the day.';
    case 'market_first': return `The first market was held in the square: ${e.n ?? 'a few'} stalls under bright awnings, and half the town came to look.`;
    case 'market': return marketText(c, e);
    case 'alms': return `After the market the treasury gave alms to the ${e.n ?? 'few'} poorest in the town.`;
    case 'feast_paid': return `The treasury paid ${e.n ?? 'a good deal of'} silver for the ${e.s === 'festival' ? 'festival' : 'feast'}: roast meat, white bread and wine for everyone.`;
    case 'market_sale': return `${a} paid ${e.n ?? 'a good deal of'} silver for the best ${WARE_ONE[e.s ?? ''] ?? 'thing'} on ${b}'s stall.`;
    case 'carter': {
      const [what, from] = (e.s ?? '').split('|');
      const whence = from ? ` from ${from}` : '';
      if (what === 'grain') return `A grain cart${whence} came in on market day. The treasury bought ${e.n ?? 'its'} sacks for the granary against a hard winter.`;
      return what === 'wood' ? `A timber cart${whence} came in on market day. The colony bought ${e.n ?? 'its'} logs off it.` : `A carter${whence} brought ${e.n ?? 'a load of'} stone to market. The colony bought the lot for its building.`;
    }
    case 'spotted': { const many = (e.n ?? 1) > 1; const f = many ? FOE_MANY[e.s ?? ''] ?? e.s : FOE_ONE[e.s ?? ''] ?? e.s; return `${a} saw ${many ? e.n + ' ' + f : (/^[aeiou]/.test(f ?? '') ? 'an ' : 'a ') + f} coming and raised the alarm.`; }
    case 'brokeup': return `${a} broke up a fight between ${e.s}.`;
    case 'berserk_hit': return `${a} has gone berserk and attacked ${b}.`;
    case 'subdued': return `${a} wrestled ${b} to the ground and ended the rampage.`;
    case 'subdue_failed': return `${a} tried to stop ${b} and was thrown off.`;
    case 'incident': return [`Hunters from ${e.s} were caught poaching on our land.`, `A trader from ${e.s} cheated us and was gone before anyone noticed.`, `Our people were turned back on the road by men from ${e.s}.`, `${e.s} drove off a herd that strayed onto their land, and kept half of it.`, `Word came that ${e.s} has been mocking us in their tavern.`, `Things went missing after visitors from ${e.s} left.`][e.n ?? 0] ?? `Trouble with ${e.s}.`;
    case 'set_out': return `${a} grew tired of waiting for settlers and set out alone for ${e.s}.`;
    case 'bought_beasts': return `The trader sold the colony ${e.s} for the pen.`;
    case 'festival_set': return `Today is ${e.s}. Everyone will gather in the afternoon.`;
    case 'festival': return `${(e.s ?? 'The festival').replace(/^the /, 'The ')} was held${(e.n ?? 0) >= 3 ? `, as it has been for ${e.n} years now` : (e.n ?? 0) === 1 ? ' for the first time' : ''}.`;
    case 'contest': { const [what, fest] = (e.s ?? ':').split(':'); return `${a} won the ${what} at ${fest}.`; }
    case 'dream': return `${full(c, e.a)}'s dream has come true: they ${e.s ?? 'got what they wanted'}.`;
    case 'master': return `${full(c, e.a)} is now a ${(e.s ?? 'master').toLowerCase()}.`;
    case 'apprenticed': return `${b} has taken ${a} on as an apprentice.`;
    case 'graduated': return `${a} has finished their apprenticeship under ${b}.`;
    case 'pen_stocked': return `The new pen has its first beasts: chickens and goats bought from a farm down the road.`;
    case 'dogcame': return `A stray dog wandered in off the road. They are calling it ${e.s}.`;
    case 'adopted': return `${e.s} the dog has decided ${a} is their person.`;
    case 'dogdied': return `${e.s}, ${e.a ? a + "'s" : 'the colony'} dog, has died.`;
    case 'dogbark': return `${e.s} started barking at something out past the fields.`;
    case 'slaughter': return `With the stores low, ${a} slaughtered a ${e.s}.`;
    case 'war_declared': return `${a} has declared war on ${e.s}. There has been too much blood between us.`;
    case 'war_on_us': return `${e.s} has declared war on us.`;
    case 'warband': return `${a} led ${e.n} fighters out against ${e.s}.`;
    case 'peace_sued': return `${a} has sued ${e.s} for peace${e.n ? `, and paid ${e.n} silver for it` : ''}. The war is over.`;
    case 'peace_made': return `${e.s} has asked for peace${e.n ? ` and sent ${e.n} silver` : ''}. The war is over.`;
    case 'raidout': return `${a} has sent ${e.n} fighters to raid ${e.s}.`;
    case 'raiders_from': return `They are from ${e.s}.`;
    case 'raidback': { const [name, lost] = (e.s ?? '').split(':'); return `The raiders are back from ${name}${e.n ? ' with full sacks' : ' with nothing'}${Number(lost) ? `. ${lost} of them did not return` : ''}.`; }
    case 'bard': return 'A wandering bard played in the hall until the fire burned low.';
    case 'herd': return 'A great herd is passing through the hills. The hunting will be good.';
    case 'omen': return 'A white stag was seen at the edge of the woods. The faithful take heart.';
    case 'healer_visit': return 'A travelling healer saw to the sick and left medicine behind.';
    case 'bumper': return 'Warm rain at the right time: the fields are thriving.';
    case 'blight': return `Blight has taken ${e.n ? 'much of' : 'some of'} the crop.`;
    case 'drought': return 'The rain has stopped. The fields are cracking.';
    case 'coldsnap': return 'A killing cold has come down from the north.';
    case 'storm': return 'A storm tore through the colony in the night.';
    case 'fire': return `The ${TPL[e.s ?? '']?.name.toLowerCase() ?? 'building'} caught fire${e.a ? `. Some say ${a} was seen nearby` : ''}.`;
    case 'rats': return 'Rats have got into the grain.';
    case 'eclipse': return 'The sun went dark at midday. The faithful are afraid.';
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
  bored: 'Needed a break', idle: 'Nothing pressing to do', free: 'Free time', love: 'Wanted to see their love', urge: 'Could not put it off any longer', crush: 'Could not stay away', friend: 'Wanted company', family: 'Wanted family',
  child: 'Being a child', baby: 'Being a baby', wedding: 'At the wedding', audience: 'Before the seat', trial: 'At the trial', sermon: 'Hearing the sermon', funeral: 'At the funeral', feast: 'At the feast', festival: 'At the festival', grief: 'Grieving', new: 'Just arrived',
  drink: 'Fancied a drink', drinkbored: 'Bored, so: a drink', relax: 'Resting', walk: 'Stretching their legs', pray: 'Praying', dice: 'Feeling lucky', hobby: 'Doing what they love',
  stargaze: 'Looking at the stars', bathe: 'Having a wash', subdue: 'Someone has gone berserk', subdued: 'Being held down', hotbath: 'Wanted a hot bath', chess: 'Fancied a game of chess', darts: 'Fancied a game of darts', music: 'Wanted to play', read: 'Wanted to read', school: 'Lessons at the schoolhouse', perform: 'Had an audience', market: 'Market day', stall: 'Keeping a stall at the market', shopping: 'Wanted something from the shops', stopped: 'Interrupted', born: 'Newborn', alarm: 'The colony is under attack', muster: 'Standing ready with the others', hurt: 'Too hurt or sick to work', seized: 'Seized', carried: 'Carried to bed', freed: 'Freed',
};

export function whyText(why: string): string {
  return WHY[why] ?? why;
}

export function raceName(k: string): string {
  return RACES[k as keyof typeof RACES]?.name ?? k;
}

const bldName = (k: string | undefined): string => (TPL[k ?? '']?.name ?? 'building').toLowerCase();

/** A discovery, told in full: who worked it out, and what the colony will build for it. */
function discoveryText(c: Colony, e: Ev): string {
  const [k, from] = (e.s ?? '').split(':');
  const d = TECHS[k];
  if (!d) return `${full(c, e.a)} has worked something out.`;
  const told = from ? ` Word of it had come from ${from}, but it took one of our own to make it work.` : '';
  const what = d.bld.length ? ` The colony will build its first ${k === 'milling' ? 'mill' : bldName(d.bld[0])}.` : k === 'irrigation' ? ' Ditches are being dug along the fields.' : k === 'rotation' ? ' The headlands are being sown with clover.' : '';
  return `${full(c, e.a)} has ${d.idea}.${told}${what}`;
}

/** News of a neighbour's discovery ('milling|Tamoc Ash' in who). */
function techNews(name: string, who: string | undefined): string {
  const [k, by] = (who ?? '').split('|');
  const d = TECHS[k];
  return `News from ${name}: ${by || 'someone there'} has worked out ${(d?.name ?? 'something new').toLowerCase()}. Our own people are talking about how it is done.`;
}
