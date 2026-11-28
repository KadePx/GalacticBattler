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
import { cursedThing } from './sim/nature';
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
  foe_soldier: 'was cut down by the king\'s soldiers', bounty: 'was taken away in chains by a bounty hunter', fled_hunter: 'fled before a bounty hunter could take them',
  foe_bandit: 'was cut down by bandits', foe_slaver: 'was killed by slavers', foe_orc: 'was butchered by orc raiders', foe_wolf: 'was torn apart by wolves',
  foe_ghoul: 'was dragged down by ghouls', foe_troll: 'was crushed by a troll', foe_boar: 'was gored by a boar',
  x_crush: 'was crushed under falling stone on an expedition, far from home', x_fall: 'fell to their death on an expedition, far from home', x_trap: 'was killed by an old trap on an expedition, far from home',
  x_beast: 'was killed by something in the dark on an expedition, far from home', x_drown: 'drowned in black water on an expedition, far from home', x_lost: 'went out with an expedition and never came home',
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

const FOE_ONE: Record<string, string> = { soldier: 'king\'s soldier', raider: 'raider', bandit: 'bandit', slaver: 'slaver', orc: 'orc raider', wolf: 'wolf', ghoul: 'ghoul', troll: 'troll', boar: 'maddened boar' };
const FOE_MANY: Record<string, string> = { soldier: 'king\'s soldiers', raider: 'raiders', bandit: 'bandits', slaver: 'slavers', orc: 'orc raiders', wolf: 'wolves', ghoul: 'ghouls', troll: 'trolls', boar: 'maddened boars' };
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

const SITE_WORD: Record<string, string> = { camp: 'what a host left behind,', ruin: 'an old ruin', cave: 'a cave', tomb: 'an old tomb', wreck: 'a wreck', tower: 'an old tower' };
const PROMISE_WORD: Record<string, string> = { relic: 'something old and precious', silver: 'buried silver', iron: 'good old iron', goods: 'fine things left behind', lore: 'old knowledge' };
const DANGER_WORD = ['', 'not thought dangerous', 'said to be dangerous', 'a place few come back from'];
const OUT_WORD: Record<string, string> = { triumph: 'A famous expedition', good: 'Came home with something to show for it', thin: 'Came home with little', empty: 'Came home with nothing', grim: 'Came home, but not all of them', lost: 'Never came home', off: 'Called off' };
const ROLE_WORD: Record<string, string> = { lead: 'leader', sword: 'fighter', scout: 'scout', lore: 'scholar', heal: 'healer', pack: 'porter' };
export const siteWord = (k: string): string => SITE_WORD[k] ?? 'an old place';
export const promiseWord = (p: string): string => PROMISE_WORD[p] ?? 'who knows what';
export const dangerWord = (d: number): string => DANGER_WORD[d] ?? '';
export const outcomeWord = (k: string): string => OUT_WORD[k] ?? '';
export const roleWord = (k: string): string => ROLE_WORD[k] ?? '';
const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

const ROAD = [
  'made good time on the old road', 'forded a cold river and camped on the far bank', 'lost half a day to a washed-out track', 'shared a fire with a tinker who knew the way',
  'walked all day in the rain', 'slept in a shepherd\'s hut and were glad of it',
];
const ROAD_HOME = ['made good time on the road home', 'crossed the river again, lower now', 'walked from first light to dark', 'slept under the same oak as on the way out', 'met a carter who had news of home', 'could see the smoke of home by evening'];
const BAR: Record<string, string[]> = {
  camp: ['a ditch full of sharpened stakes', 'a supply wagon tipped on its side', 'a burnt palisade, still smouldering'],
  ruin: ['a cellar stair half fallen in', 'a vault door rusted shut', 'a well shaft with rungs going down into the dark'],
  cave: ['a flooded passage', 'a crack barely wide enough to crawl through', 'a drop with no bottom their torches could find'],
  tomb: ['a sealed door carved with warnings', 'a passage strewn with old bones', 'a stone slab that would take all of them to move'],
  wreck: ['a hold full of black water', 'a hull tipped on its side and groaning', 'a cabin door swollen shut'],
  tower: ['a stair with no rail, climbing into the dark', 'a trapdoor bolted from above', 'a floor half fallen away'],
};
const WHERE_FOUND: Record<string, string> = { camp: 'under a tipped wagon', wreck: 'deep in the hold', cave: 'at the back of the deepest cave', tower: 'in the room at the top', tomb: 'in the last chamber', ruin: 'in the last cellar' };
const HAZ: Record<string, [string, string]> = {
  collapse: ['The roof came down. {a} was dug out hurt but alive.', 'The roof came down on {a}.'],
  fall: ['{a} fell, and was hauled back up on a rope with something broken.', '{a} fell, a long way.'],
  trap: ['Something old and sharp swung out of the wall and opened {a}\'s arm.', 'Something old and sharp swung out of the wall. {a} never saw it.'],
  beast: ['Something lived in there. It got its teeth into {a} before they drove it off.', 'Something lived in there. It took {a}.'],
  water: ['The water rose faster than they could climb. {a} was pulled out half drowned.', 'The water rose faster than they could climb. {a} did not come up.'],
};

/** The feed's telling of an expedition (e.s is "place|detail", e.n the day of the journey times a thousand plus a count). */
function expText(c: Colony, e: Ev): string {
  const a = first(c, e.a);
  const p = (e.s ?? '').split('|');
  const site = p[0] || 'the wilds';
  const n = e.n ?? 0;
  const day = `Day ${Math.floor(n / 1000)}: `;
  const m = n % 1000;
  switch (e.k) {
    case 'x_call': { const far = Number(p[2]) || 1; return `${full(c, e.a)} is gathering a party of ${NUM_WORD[n] ?? n} to seek out ${site}, ${siteWord(p[1])} ${far === 1 ? 'a day\'s walk' : `${NUM_WORD[far] ?? far} days' walk`} away. They leave from the gate this morning.`; }
    case 'x_left': return `${full(c, e.a)} and ${NUM_WORD[n - 1] ?? n - 1} ${n - 1 === 1 ? 'other' : 'others'} walked out along the road with packs on their backs and a banner at their head, bound for ${site}.`;
    case 'x_off': return `The expedition to ${site} has been called off for now.`;
    case 'x_road': return `${day}the party ${(m >= 10 ? ROAD_HOME : ROAD)[m % 10] ?? ROAD[0]}.`;
    case 'x_ambush': return `${day}${p[1] === 'wolves' ? 'wolves came at the camp in the night' : 'bandits were waiting where the road narrows'}. ${e.a ? `${a} was ${p[1] === 'wolves' ? 'bitten' : 'cut'} before they were driven off.` : 'The party drove them off unhurt.'}`;
    case 'x_reach': return `${day}the party reached ${site}. ${m >= 3 ? 'Nobody liked the look of it.' : m === 2 ? 'They made camp outside and went in at first light.' : 'It was quiet, and long empty.'}`;
    case 'x_dare': return `${day}${(BAR[p[1]] ?? BAR.ruin)[m % 3]} barred the way. ${a} would not turn back, and they went on in.`;
    case 'x_care': return `${day}${(BAR[p[1]] ?? BAR.ruin)[m % 3]} barred the way. ${a} judged it not worth a life, and they searched what they could reach.`;
    case 'x_hazard': return day + (HAZ[p[1]] ?? HAZ.collapse)[m ? 1 : 0].replace('{a}', a);
    case 'x_find': return `${day}${a} ${p[1] === 'iron' ? `found ${m} bars of good old iron under the rubble` : p[1] === 'goods' ? `brought out ${m} loads of fine old things: glass, bronze and carved bone` : `turned up a rotted chest with ${m} silver in it`}.`;
    case 'x_relic': return `${day}${WHERE_FOUND[p[2] ?? ''] ?? 'in the last chamber'} ${a} found ${p[1] ?? 'something old and precious'}.`;
    case 'x_left_be': return `${day}${p[1] ?? 'something precious'} lay in the dead one's hands. ${a} would not rob a grave: they said a prayer and left it there.`;
    case 'x_map': return `${day}${a} found a map ${p[2] === 'camp' ? 'among the papers the host left behind' : p[2] === 'wreck' ? 'in an oilcloth, still dry' : p[2] === 'cave' ? 'scratched into the rock' : 'scratched into a wall'}: the way to ${p[1] ?? 'somewhere further'}.`;
    case 'x_lore': return `${day}${a} spent the day ${p[1] === 'camp' ? 'going through the letters and tallies the host left behind' : p[1] === 'wreck' ? 'drying out a log-book page by page' : 'copying old carvings by candlelight'}.`;
    case 'x_captive': return `${day}they found someone alive ${p[1] === 'camp' ? 'among the wagons' : p[1] === 'wreck' ? 'below decks' : 'in there'}, caged and half starved. ${a} broke the lock.`;
    case 'x_bare': return `${day}${['nothing but dust, bones and other people\'s footprints. Someone had been there first', 'they searched every corner and found nothing worth the carrying', 'whatever was there once is long gone'][m % 3]}.`;
    case 'x_linger': return `${a} would not leave while there might be more to find. They stayed another day.`;
    case 'x_homeward': return `${day}the party turned for home${p[1] === 'rich' ? ', packs heavy' : p[1] === 'grim' ? ', one fewer than set out' : p[1] === 'hurt' ? ', helping their wounded along' : p[1] === 'bare' ? ' with nothing to show for it' : ''}.`;
    case 'x_back': return `The expedition is back from ${site}: ${NUM_WORD[n] ?? n} of them at the gate${p[1] === 'rich' ? ', bent under what they carry' : p[1] === 'grim' ? ', walking slowly' : p[1] === 'bare' ? ', packs empty' : ''}.`;
    case 'x_home': {
      const got: string[] = [];
      if (Number(p[2]) > 0) got.push(`${p[2]} silver`);
      if (Number(p[3]) > 0) got.push(`${p[3]} loads of fine goods`);
      if (Number(p[4]) > 0) got.push(`${p[4]} bars of old iron`);
      if (Number(p[5]) > 0) got.push('pages of old lore');
      const list = got.length > 1 ? got.slice(0, -1).join(', ') + ' and ' + got[got.length - 1] : got[0];
      const cost = Number(p[6]) > 0 ? ` ${NUM_WORD[Number(p[6])] ?? p[6]} of them did not come back.` : '';
      if (p[1] === 'triumph') return `${full(c, e.a)}'s party is home from ${site}${list ? ` with ${list}` : ''}, and a tale people will be telling for years.${cost}`;
      if (p[1] === 'empty') return `${full(c, e.a)}'s party is home from ${site} with nothing but sore feet.${cost}`;
      return `${full(c, e.a)}'s party is home from ${site}${list ? ` with ${list}` : ''}.${cost}`;
    }
    case 'x_relic_set': return p[1] === 'store' ? `${p[0][0].toUpperCase() + p[0].slice(1)} ${/s of /.test(p[0]) ? 'have' : 'has'} been put away safe until there is a hall to show ${/s of /.test(p[0]) ? 'them' : 'it'} in.` : `${p[0][0].toUpperCase() + p[0].slice(1)} ${/s of /.test(p[0]) ? 'have' : 'has'} been set on a stand in the ${p[1] === 'keep' ? 'great hall of the castle' : 'hall'}, where everyone can see ${/s of /.test(p[0]) ? 'them' : 'it'}.`;
    case 'x_feast': return `There will be a feast to welcome the expedition home.`;
    case 'x_title': return `People have started calling ${a} "${first(c, e.a)} ${e.s ?? ''}".`;
    case 'x_overdue': return `The party sent to ${site} should have been home days ago. There has been no word.`;
    case 'x_mourned': return `Nobody has come back from ${site}. The colony has given the ${NUM_WORD[n] ?? n} of them up for lost.`;
    case 'x_survivor': return n > 1 ? `${full(c, e.a)} walked in at the gate, thin as a rake: one of the party lost at ${site}, come home after all.` : `${full(c, e.a)} walked in at the gate alone, thin as a rake: the last of the party lost at ${site}.`;
    case 'x_memorial': return `${n} gathered to remember the party lost at ${site}. There was nothing to bury.`;
    case 'x_seat_held': return `${full(c, e.a)} is heir to ${full(c, e.b)}, and away with the expedition. The seat is kept empty until they are home.`;
    case 'x_vol': return `${a} has stepped forward to go with the next expedition.`;
    default: return `${e.k}: ${a}`;
  }
}

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
  discovery: 3, firstbuilt: 3, cleared: 1, chronicle: 2, tech_trader: 1, glazed_first: 2, jewels_first: 2,
  joined: 3, blabbed: 3, heir: 3, heirloom: 2, nudge: 1, trader: 1, bard: 1, herd: 1, omen: 1, healer_visit: 1, bumper: 1, blight: 3, drought: 2, coldsnap: 2, storm: 2, fire: 3, rats: 2, eclipse: 2,
  n_wildfire: 3, n_fire_town: 3, n_fire_out: 2, n_flood: 3, n_flood_end: 2, n_quake: 3, n_vein: 2, n_cleared: 1, n_meteors: 2, n_aurora: 2, n_starfall: 2, n_stariron: 2,
  n_locusts: 3, n_locusts_gone: 2, n_dragon: 3, n_dragon_field: 3, n_dragon_beast: 3, n_dragon_pass: 2, n_haunt: 3, n_haunt_laid: 2, n_haunt_fades: 2,
  n_curse: 3, n_curse_hurt: 2, n_curse_sour: 2, n_curse_tools: 2, n_curse_end: 2, n_winter_warn: 2, n_winter: 3, n_winter_end: 2,
  n_elope: 3, n_eloped: 3, n_feud: 3, n_feud_clash: 2, n_feud_end: 2, n_feud_wed: 3, n_lost: 3, n_found: 3, n_lost_home: 2, n_challenge: 3, n_duel: 3, n_duel_off: 2, n_suitor: 3, n_noble_wed: 3,
  v_come: 2, v_gone: 1, v_shelter: 1, v_fair: 1, v_rare: 2, v_nosale: 1, v_finery: 1, v_festival: 2, v_played: 1, v_song: 2, v_saint: 2, v_offering: 1, v_converted: 2,
  v_takenin: 3, v_turnedaway: 3, v_healed: 2, v_blessed: 2, v_fields: 2, v_lights: 2, v_lore: 2, v_fortune: 2, v_paid: 3, v_refused: 3, v_kingmen: 3,
  x_call: 2, x_left: 3, x_off: 1, x_road: 1, x_ambush: 2, x_reach: 2, x_dare: 2, x_care: 2, x_hazard: 3, x_find: 2, x_relic: 3, x_left_be: 2, x_map: 2, x_lore: 2, x_captive: 3, x_bare: 1, x_linger: 1,
  x_homeward: 1, x_back: 3, x_home: 3, x_relic_set: 3, x_feast: 2, x_title: 3, x_overdue: 3, x_mourned: 3, x_survivor: 3, x_vol: 2, x_memorial: 3, x_seat_held: 3,
  v_told: 2, v_miss: 2, v_lost: 1, v_bought: 3, v_beaten: 3, v_wounded: 3, v_fled: 3, v_taken: 3,
  d_envoy_out: 2, d_envoy_home: 3, d_envoy_come: 2, d_trade: 3, d_ally: 3, d_trib_pay: 3, d_trib_take: 3, d_trib_out: 2, d_trib_in: 2, d_trib_none: 2, d_trib_missed: 2, d_trib_end: 3,
  d_lapsed: 2, d_broken: 3, d_cv_in: 2, d_cv_trade: 2, d_cv_home: 2, d_wed_sent: 3, d_wed_back: 3, d_wed_come: 3, d_wed: 3, d_wed_news: 3,
  d_tn_call: 3, d_tn_bid: 2, d_tn_ride: 3, d_tn_come: 2, d_tn_day: 2, d_tn_off: 2, d_tn_end: 3, d_tn_crowd: 2, d_tn_draw: 2, d_tn_home: 3,
  d_aid_ask: 3, d_aid_sent: 3, d_aid_none: 2, d_aid_no: 2, d_aid_home: 2, d_relief: 3, d_relief_late: 2,
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
    case 'relief': return `Riders from ${more ?? 'our allies'} fell on the camp from behind! ${host.charAt(0).toUpperCase() + host.slice(1)} is breaking camp.`;
    case 'harry': return `${n} riders from ${more ?? 'our allies'} fell on the camp in the night and burned its wagons. They are too few to break ${host.charAt(0).toLowerCase() + host.slice(1)}, but it cannot sit out there long now.`;
    case 'end': return more === 'won' ? `The siege is over. ${host.charAt(0).toUpperCase() + host.slice(1)} is broken, after ${n} day${n === 1 ? '' : 's'}.` : more === 'bought' ? `The siege is over, bought off after ${n} day${n === 1 ? '' : 's'}.` : `The siege is lifted. The last of ${host.charAt(0).toLowerCase() + host.slice(1)} has gone down the road.`;
  }
  return 'The siege goes on.';
}

export function evText(c: Colony, e: Ev): string {
  const a = first(c, e.a);
  const b = first(c, e.b);
  if (e.k.startsWith('v_')) return visitText(c, e);
  if (e.k.startsWith('n_')) return natText(c, e);
  if (e.k.startsWith('x_')) return expText(c, e);
  if (e.k.startsWith('d_')) return dipText(c, e);
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
    case 'cleared': { const [old, k] = (e.s ?? ':').split(':'); return `The old ${bldName(old)} was pulled down to make room for the ${bldName(k)}.`; }
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
    case 'looted': if (e.s === 'soldier') return "The king's soldiers broke into the treasury and took the king's due, and more besides.";
      return `${FOE_MANY[e.s ?? ''] ?? 'Raiders'} broke into the stores and carried off what they could.`.replace(/^./, (x) => x.toUpperCase());
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
    case 'joined': return e.s?.startsWith('match:') ? `${full(c, e.a)} has arrived from ${e.s.slice(6)}, sent to be married.` : e.s?.startsWith('rescued:') ? `${full(c, e.a)} has come home with the expedition, freed from a cage at ${e.s.slice(8)}, and means to stay.` : e.s?.startsWith('exile:') ? `${full(c, e.a)} has arrived, cast out of ${e.s.slice(6)}.` : e.s?.startsWith('migrant:') ? `${full(c, e.a)} has come from ${e.s.slice(8)} to start again.` : e.s === 'refugee' ? `${full(c, e.a)} staggered in off the road, fleeing something worse.` : `${full(c, e.a)} has come to live here.`;
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
      if (what === 'famine') return `Word of the hunger went out, and a grain cart${whence} came in. The treasury paid a hard price for ${e.n ?? 'its'} sacks.`;
      if (what === 'charity') return `They heard${from ? ' in ' + from : ''} that the colony was starving, and sent ${e.n ?? 'some'} sacks of grain on a cart, asking nothing for them.`;
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

const FAITH_NAME: Record<string, string> = { hearth: 'the Hearth', iron: 'the Iron Ancestors', pale: 'the Pale Lady', green: 'the Green Choir', teeth: 'the Old Teeth', hollow: 'the Hollow Mother' };
/** What the colony bought from a merchant. */
const RARE_TEXT: Record<string, string> = {
  silk: 'a bale of southern silk', spice: 'a chest of spices, and tonight every pot smells of far places', seed: 'seed of a hardier crop for the fields',
  book: 'a book of the old learning', tools: 'a crate of good steel tools', relic: 'a holy relic, a finger bone in a silver box',
};
/** What the minstrel's song was about. */
const SONG_TEXT: Record<string, string> = {
  slew: ' and the foe they cut down', rescued_someone: ' and the life they saved', contest: ' and their win at the festival games', masterwork: ' and the masterwork from their hands',
  discovery: ' and what they worked out', ruler: ', who rules here', master: ', master of their craft', dream: ' and the dream they made come true', firstbuilt: ' and the first of its kind they raised',
};

/** A line about a visitor. The visitor's name, kind and business travel in the event, so it reads the same after they have gone. */
function visitText(c: Colony, e: Ev): string {
  const beat = e.k.slice(2);
  if (beat === 'kingmen') return `The king's soldiers have come for the tax that was refused: ${e.n ?? 'a band'} of them, marching up the road.`;
  const [, k, name, f, x] = (e.s ?? '').split('|');
  const a = first(c, e.a);
  const fa = full(c, e.a);
  const b = first(c, e.b);
  const n = e.n ?? 0;
  const fam = (name ?? '').split(' ').slice(1).join(' ');
  switch (beat) {
    case 'come':
      switch (k) {
        case 'merchant': return `${name}, a merchant from ${f}, led a laden mule in off the road and set out wares in the square.`;
        case 'minstrel': return `${name}, a minstrel with a ${f}, walked in off the road singing${x === 'fest' ? ', just in time for the festival' : ''}.`;
        case 'pilgrim': return n > 1 ? `${n} pilgrims of ${FAITH_NAME[f] ?? f} came up the road, led by ${name}, and asked the way to the shrine.` : `${name}, a pilgrim of ${FAITH_NAME[f] ?? f}, came up the road and asked the way to the shrine.`;
        case 'refugee': return n > 1 ? `A family of ${n} came in off the road with nothing but what they carried: the ${fam} family, fleeing ${f}.` : `${name} came in off the road alone, fleeing ${f}, and sat down by the hall.`;
        case 'wizard': return `${name}, a wandering wizard, came up the road leaning on a staff. Children followed at a safe distance.`;
        case 'taxman': return `${name} rode in under the banner of ${f} with two guards, and demanded ${n} silver in the king's name.`;
        case 'hunter': return e.a ? `${name}, a bounty hunter with a crossbow, came asking after a ${f}. ${a} has gone very quiet.` : `${name}, a bounty hunter, came asking after a ${f}.`;
        default: return `${name} came in off the road.`;
      }
    case 'shelter': return `${name} took shelter indoors until the fighting was done.`;
    case 'gone':
      if (k === 'merchant') return `${name} packed up and took the road out${n ? `, ${n} ${n === 1 ? 'trinket' : 'trinkets'} lighter` : ''}.`;
      if (k === 'minstrel') return `${name} took the road again${n ? `, ${n} silver richer in tips` : ''}.`;
      if (k === 'wizard') return `${name} was gone before dawn. Nobody saw which way.`;
      return 'The pilgrims went on their way to the next holy place.';
    case 'fair': return `It is market day, and ${name} has set out silks and spices among the stalls.`;
    case 'rare': return `The colony bought ${RARE_TEXT[x] ?? 'something rare'} from ${name} for ${n} silver.`;
    case 'nosale': return `${name} had rare things to sell, but the treasury could not stretch to them.`;
    case 'finery': return `${fa} bought ${x} from ${name} for ${n} silver.`;
    case 'festival': return `${name} played the ${f} at the festival, and everyone danced.`;
    case 'played': return `${n} ${n === 1 ? 'person' : 'people'} crowded round to hear ${name} play the ${f}.`;
    case 'song': return x === 'town' ? `${name} made a song about ${c.name}. It is already being sung in the tavern.` : `${name} made a song about ${fa}${SONG_TEXT[x] ?? ''}. It is already being sung in the tavern.`;
    case 'saint': return `The pilgrims knelt at the grave of ${fa} and left ${n} silver for the shrine.`;
    case 'offering': return `The pilgrims prayed at the shrine and left ${n} silver as an offering.`;
    case 'converted': return `${fa} has taken up the pilgrims' faith: ${FAITH_NAME[f] ?? f}.`;
    case 'takenin': if (n <= 1) return `${name} has been taken in. Fleeing ${f}, they now call ${c.name} home.`;
      return `The ${fam} family have been taken in. ${n} new ${n === 1 ? 'soul' : 'souls'}, fleeing ${f}, now call ${c.name} home.`;
    case 'turnedaway': { const who = n <= 1 ? name : `the ${fam} family`; return x === 'full' ? `There is no room left for ${who}. They took the road again.` : `${e.a ? a + ' would' : 'The colony would'} not take ${who} in. They took the road again, slowly.`; }
    case 'healed': return `${name} laid hands on ${fa}, and by morning ${a} was mending.`;
    case 'blessed': return `${name} blessed the baby ${a}. A lucky child, they say now.`;
    case 'fields': return `${name} walked the fields at dusk, muttering. By morning the crops stood taller.`;
    case 'lights': return `${name} filled the night sky with coloured lights. Nobody slept for hours.`;
    case 'lore': return `${name} sat up half the night with ${e.a ? a : 'the curious'}, talking of ${(TECHS[x]?.name ?? 'old secrets').toLowerCase()}. The colony is closer to working it out.`;
    case 'fortune': return x === 'good' ? `${name} read ${fa}'s palm and foretold great things.` : `${name} read ${fa}'s palm, went pale, and would not say what was there.`;
    case 'paid': return `${e.a ? a : 'The colony'} paid the king's ${n} silver${x === 'short' ? ', and goods to make up what the treasury could not' : ''}. ${name} rode off with it.`;
    case 'refused': return `${e.a ? a : 'The colony'} refused to pay ${f} a single coin. ${name} rode off with a warning.${x.startsWith('feud:') ? ` Word of it has reached ${x.slice(5)}, and they will not forget it.` : ' The king will send soldiers.'}`;
    case 'told': return `${a} told the bounty hunter where to find ${b}.`;
    case 'miss': return `${name} gave up and rode away. ${a} came out of hiding.`;
    case 'lost': return `${name} left: whoever was wanted is gone from here.`;
    case 'bought': return `${name} found ${fa}, the ${f}. ${e.b ? b : 'The colony'} paid ${n} silver to let them be.`;
    case 'beaten': return `${name} found ${fa}, the ${f}, and lost the fight that followed. The hunter limped away.`;
    case 'wounded': return `${name} found ${fa}, the ${f}. There was a fight, and ${a} was hurt, but would not be taken.`;
    case 'fled': return `${name} found out ${fa}, the ${f}, but ${a} slipped away before they could be taken, and has not come back.`;
    case 'taken': return `${name} found ${fa}, the ${f}, and took them away in chains.`;
    default: return `${name ?? 'A visitor'} passed through.`;
  }
}

const GOODS: Record<string, [string, string]> = {
  grain: ['sack of grain', 'sacks of grain'], veg: ['basket of greens', 'baskets of greens'], flour: ['sack of flour', 'sacks of flour'], bread: ['loaf', 'loaves'], ale: ['cask of ale', 'casks of ale'],
  hops: ['sack of hops', 'sacks of hops'], wood: ['log', 'logs'], stone: ['block of stone', 'blocks of stone'], brick: ['brick', 'bricks'], ore: ['load of ore', 'loads of ore'], iron: ['bar of iron', 'bars of iron'],
  leather: ['hide', 'hides'], cloth: ['bolt of cloth', 'bolts of cloth'], clothes: ['suit of clothes', 'suits of clothes'], tools: ['tool', 'tools'], weapons: ['weapon', 'weapons'], goods: ['crate of wares', 'crates of wares'],
  glass: ['pane of glass', 'panes of glass'], herbs: ['bundle of herbs', 'bundles of herbs'], medicine: ['jar of medicine', 'jars of medicine'],
};
const listOf = (l: string[]): string => (l.length <= 1 ? l[0] ?? '' : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
/** "grain:40,cloth:6" as "40 sacks of grain and 6 bolts of cloth" (silver first, if any). */
export function goodsText(s: string | undefined, silver = 0): string {
  const out: string[] = silver > 0 ? [`${silver} silver`] : [];
  for (const part of (s ?? '').split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (!k || !(n > 0)) continue;
    const w = GOODS[k];
    out.push(`${n} ${w ? w[n === 1 ? 0 : 1] : k}`);
  }
  return listOf(out);
}

/** Dealings with the neighbours (see sim/neigh.ts). Names of other towns and their people travel in e.s, so a line reads the same years later. */
function dipText(c: Colony, e: Ev): string {
  const p = (e.s ?? '').split('|');
  const a = first(c, e.a);
  const fa = full(c, e.a);
  const n = e.n ?? 0;
  const pa = e.a ? person(c, e.a) : undefined;
  const pb = e.b ? person(c, e.b) : undefined;
  const title = (x: typeof pa): string => (x ? `${rulerTitle(c, x)} ${x.first}` : 'The colony');
  const days = (d: number): string => (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
  const rider = (name: string, from: string): string => (from === c.name ? `our own ${name}` : `${name} of ${from}`);
  switch (e.k) {
    case 'd_envoy_out':
      if (p[1] === 'ally') return `${title(pb)} sent ${fa} down the road to ${p[0]}, to offer them an alliance.`;
      if (p[1] === 'tribute') return `${title(pb)} sent ${fa} to ${p[0]}, to tell them what being left in peace will cost.`;
      return `${title(pb)} sent ${fa} down the road to ${p[0]}, to offer them a trade agreement.`;
    case 'd_envoy_home':
      if (p[2] !== 'ok') return `${fa} is home from ${p[0]}, with nothing to show for the journey.`;
      if (p[1] === 'ally') return `${fa} is home from ${p[0]} with an alliance sworn. If either town is besieged, the other will ride to its aid.`;
      if (p[1] === 'tribute') return `${fa} is home from ${p[0]}. They will pay: tribute, every season.`;
      return `${fa} is home from ${p[0]} with the trade agreement sealed. Their carts will come to our market, and ours will go to theirs.`;
    case 'd_envoy_come': return `${p[1]}, an envoy of ${p[0]}, rode in behind a herald and asked for ${pa ? title(pa) : 'whoever rules here'}.`;
    case 'd_trade':
      if (p[1] === 'envoy') return `${title(pa)} heard out ${p[2]} in the hall, and it is agreed: ${p[0]}'s carts will come to our market, and ours will go to theirs.`;
      return `Word came down the road: a trade agreement stands between us and ${p[0]}.`;
    case 'd_ally':
      if (p[1] === 'envoy') return `${title(pa)} and the envoy ${p[2]} have sworn an alliance between us and ${p[0]}. If either town is besieged, the other will ride to its aid.`;
      return `Word came down the road: we are allied with ${p[0]} now.`;
    case 'd_trib_pay':
      if (p[1] === 'peace') return `By the terms of the peace, we will send ${p[0]} tribute every season for two years.`;
      if (p[1] === 'envoy') return `${p[2]} of ${p[0]} named the price of being left in peace, and ${title(pa)} has agreed to it: tribute, every season.`;
      return `It is settled: we will send ${p[0]} tribute every season, rather than face their spears.`;
    case 'd_trib_take':
      if (p[1] === 'peace') return `By the terms of the peace, ${p[0]} will send us tribute every season for two years.`;
      return `${p[0]} has agreed to send us tribute every season.`;
    case 'd_trib_out': return `The season's tribute has left for ${p[0]}: ${goodsText(p[2], n) || 'what could be spared'}.${p[1] ? ` ${p[1]} drove the cart.` : ''}`;
    case 'd_trib_in': return `The season's tribute came in from ${p[0]}: ${goodsText(p[2], n) || 'not much'}.`;
    case 'd_trib_none': return `There was nothing to spare for ${e.s}'s tribute this season. They will not take it kindly.`;
    case 'd_trib_missed': return `No tribute came from ${e.s} this season. It has been noted.`;
    case 'd_trib_end':
      if (p[1] === 'pay') return p[2] === 'strong' ? `We are too strong now to pay ${p[0]} for peace. The tribute is at an end.` : `The two years are up: we owe ${p[0]} no more tribute.`;
      return p[2] === 'strong' ? `${p[0]} has grown strong, and will send no more tribute.` : `The two years are up: ${p[0]}'s tribute is at an end.`;
    case 'd_lapsed': return p[1] === 'ally' ? `The alliance with ${p[0]} has run its course.` : `The trade agreement with ${p[0]} has run its course. The carts will stop until a new one is made.`;
    case 'd_broken': return p[1] === 'dead' ? `${p[0]} is no more. Whatever stood between us and them has ended with it.` : `Every agreement with ${p[0]} is void now: there is war between us.`;
    case 'd_cv_in': {
      const what = goodsText(p[2]) || 'silver to buy with';
      return `Goods came in from ${p[0]}: ${what}.`;
    }
    case 'd_cv_trade': {
      // one line for the whole visit: who came, what came off the carts, what went on
      const theirs = goodsText(p[2]);
      const ours = goodsText(p[3]);
      const carts = Number(p[4]) > 1 ? `${p[4]} ox-carts` : 'an ox-cart';
      const paid = n > 0 ? ` The treasury paid ${n} silver for the difference.` : n < 0 ? ` ${p[1]} paid ${-n} silver for the difference.` : '';
      if (!theirs) return ours ? `${p[1]} came in from ${p[0]} with ${carts} and bought ${ours} in the square${n < 0 ? ` for ${-n} silver` : ''}.` : `${p[1]} came in from ${p[0]} with ${carts}, and found nothing here to buy.`;
      return `A caravan from ${p[0]} came in at the gate: ${p[1]}, with ${carts}. In the square ${theirs} came off${ours ? `, and ${ours} of ours went on` : ''}.${paid}`;
    }
    case 'd_cv_home': {
      // one line for the whole journey: what went, what it fetched
      const sent = goodsText(p[4]);
      if (p[3] === 'turned') return `${p[1]}'s wagons are back from ${p[0]} still loaded: there was no trading to be done there.`;
      const what = goodsText(p[2], n);
      const took = sent ? ` took ${sent} of ours to ${p[0]}, and are back` : ` are back from ${p[0]}`;
      return what ? `${p[1]}'s wagons${took} with ${what}.` : `${p[1]}'s wagons${took} with empty carts.`;
    }
    case 'd_wed_sent': return `${fa}, ${p[2] === 'ward' ? 'a ward' : ''} of the house of ${p[1]}, has left for ${p[0]} to marry into its ruling house${n ? `, with ${n} silver in gifts` : ''}. ${pa && pa.sex ? 'He' : 'She'} goes to make a new life there.`.replace(',  of', ', of');
    case 'd_wed_back': return `${fa} is home again: the road to ${e.s} led to a town that is no more. There will be no wedding.`;
    case 'd_wed_come': return `${fa}, ${p[2] === 'ward' ? 'a ward of' : 'of'} the house of ${p[1]} in ${p[0]}, came in at the gate with an escort and a cart of gifts${pb ? `, to marry ${full(c, e.b)}` : ''}.${n ? ` ${n} silver came as dowry.` : ''}`;
    case 'd_wed': return `The marriage of ${a} and ${first(c, e.b)} joins the house of ${p[1]} in ${p[0]} to ${c.name}. ${a} came as a stranger and is one of ours now, and there was feasting until late.`;
    case 'd_wed_news': return `Word from ${p[0]}: ${p[1]} has been wed to ${p[2]}. Our houses are joined.`;
    case 'd_tn_call': return `${title(pa)} has called a tournament, ${days(n)}. Knights of ${listOf((e.s ?? '').split(', '))} are bidden to ride.`;
    case 'd_tn_bid': return `${e.s} will hold a tournament ${days(n)}, and has bidden our knights to ride.`;
    case 'd_tn_ride': return `${fa}${pb ? ` and ${full(c, e.b)}` : ''} rode out for the tournament at ${e.s}.`;
    case 'd_tn_come': return `${n > 1 ? 'Knights' : 'A knight'} of ${p[0]} rode in: ${p[1]}.`;
    case 'd_tn_day': return `The lists are up on the green and the tournament has begun: ${n} riders will break lances this afternoon${e.s ? `, ours against the knights of ${listOf(e.s.split(', '))}` : ''}.`;
    case 'd_tn_off': return 'The tournament has been called off.';
    case 'd_tn_end': return `${rider(p[0], p[1]).replace(/^o/, 'O')} unhorsed ${rider(p[2], p[3])} in the last course and took the purse${n ? ` of ${n} silver` : ''}.`;
    case 'd_tn_crowd': return `${n} people watched the tournament from the rail. They will be talking about ${p[0]}'s riding for a long while.`;
    case 'd_tn_draw': return 'The tournament ended with no champion named.';
    case 'd_tn_home':
      if (p[2] === 'off') return `${fa} is home from ${p[0]}: the tournament was never held.`;
      if (p[1] === 'won') return `${fa} is home from ${p[0]} as champion of the tournament${n ? `, with a purse of ${n} silver` : ''}.`;
      if (p[1] === 'hurt') return `${fa} is home from the tournament at ${p[0]}, unhorsed and bruised, but with a tale to tell.`;
      if (p[1] === 'some') return `${fa} is home from the tournament at ${p[0]}, having won ${n === 1 ? 'a course' : `${n} courses`} before being unhorsed.${p[2] ? ` ${p[2]} took the purse.` : ''}`;
      if (p[1] === 'out') return `${fa} is home from the tournament at ${p[0]}, unhorsed in the first course.${p[2] ? ` ${p[2]} took the purse.` : ''}`;
      return `${fa} is home from ${p[0]}.`;
    case 'd_aid_ask': return `Riders slipped out past the camp in the night, to ask ${listOf((e.s ?? '').split(', '))} for help.`;
    case 'd_aid_sent': return `${fa} led ${n} riders out to the relief of our allies in ${e.s}.`;
    case 'd_aid_none': return `${e.s} is besieged and has asked our help, but we have no one to send.`;
    case 'd_aid_no': return `Word from ${e.s}: they cannot come to our aid.`;
    case 'd_aid_home': return `${fa} and the others are home from ${e.s}.`;
    case 'd_relief': return p[2] === 'harry' ? `The riders of ${p[0]} who burned the besiegers' wagons came in at the gate, ${p[1]} at their head.` : `The riders of ${p[0]} who broke the siege came in at the gate to cheers, ${p[1]} at their head.`;
    case 'd_relief_late': return `${n} riders of ${p[0]} came to our aid, ${p[1]} at their head. The danger had passed, but they were fed and thanked.`;
    default: return 'Word came from a neighbour.';
  }
}

export function thoughtText(c: Colony, k: string, o?: Id): string {
  const d = TH[k];
  if (!d) return k;
  return d.t.replace('{o}', first(c, o));
}

const WHY: Record<string, string> = {
  d_leave: 'Taking the road to a neighbour', d_home: 'Home from the road', tourney: 'At the tournament', joust: 'Riding in the tournament',
  form: 'Chosen to walk in the procession', procession: 'Walking in the procession', dusk: 'It is their turn to light the lamps', bench: 'A fair day for sitting out',
  memorial: 'Remembering the lost', x_gather: 'Chosen for the expedition', x_leave: 'Chosen for the expedition', x_home: 'Back from the wilds', farewell: 'Someone of theirs is going', welcome: 'The expedition is home', away: 'Chosen for the expedition',
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
  const told = from ? [` They had heard it was done in ${from}.`, ` ${from} knew it first.`, ` Traders had talked of it, out of ${from}.`][e.t % 3] : '';
  const what = d.bld.length ? ` The colony will build its first ${k === 'milling' ? 'mill' : bldName(d.bld[0])}.` : k === 'irrigation' ? ' Ditches are being dug along the fields.' : k === 'rotation' ? ' The headlands are being sown with clover.' : '';
  return `${full(c, e.a)} has ${d.idea}.${told}${what}`;
}

/** News of a neighbour's discovery ('milling|Tamoc Ash' in who). */
function techNews(name: string, who: string | undefined): string {
  const [k, by] = (who ?? '').split('|');
  const d = TECHS[k];
  return `News from ${name}: ${by || 'someone there'} has worked out ${(d?.name ?? 'something new').toLowerCase()}. Our own people are talking about how it is done.`;
}

/** A line about the land turning on the colony, a mystery, or one of the colony's own dramas (see sim/nature.ts and sim/drama.ts). */
function natText(c: Colony, e: Ev): string {
  const a = first(c, e.a);
  const b = first(c, e.b);
  const n = e.n ?? 0;
  const s = e.s ?? '';
  const fams = (): [string, string] => { const p = s.split('|'); return [p[p.length - 2] ?? 'one', p[p.length - 1] ?? 'the other']; };
  switch (e.k) {
    case 'n_wildfire': return s === 'dragon' ? 'The trees by the burnt field have caught. The fire is running into the woods.' : `Smoke over the woods to the ${s || 'north'}: a wildfire has taken hold in the trees. People are turning out with wet sacks and spades.`;
    case 'n_fire_town': return `The wildfire has reached the ${bldName(s)}. Sparks are falling on the roofs.`;
    case 'n_fire_out': { const f = Number(s) || 0; return `The wildfire is out. ${n ? `${n} stretches of woodland burned` : 'Hardly a tree was lost'}${f ? `, and ${f} people came home black with soot from beating at the flames` : ''}.`; }
    case 'n_flood': return `${s === 'melt' ? 'The snowmelt has the river over its banks' : 'After the rain the water is over its banks'}, and it is rising over the low ground${n ? ` toward ${n === 1 ? 'one of the fields' : `${n} of the fields`}` : ''}.`;
    case 'n_flood_end': return `The water has gone back down. ${n ? `It took the crops from ${n} plots` : 'The fields came through it'}${Number(s) > 3 ? ', and the earth heaped along the edges kept the worst of it off' : ''}.`;
    case 'n_quake': { const hurt = Number(s) || 0; return `The earth shook. Cracks opened in the ground${n ? ` and ${n === 1 ? 'one building was' : `${n} buildings were`} damaged` : ''}${hurt ? `; ${hurt === 1 ? 'one person was' : `${hurt} people were`} hurt by what fell` : ''}.`; }
    case 'n_vein': return 'Where the quake split the rock face, a fresh vein of ore shows through.';
    case 'n_cleared': return `The last of the rubble from the quake has been cleared. ${a} carted the final load away.`;
    case 'n_meteors': return 'Stars are falling tonight, dozens of them, streaking across the sky. Half the colony is out in the street to watch.';
    case 'n_aurora': return 'The northern lights are out tonight: green and violet curtains across the whole sky.';
    case 'n_starfall': return `One of the falling stars came down to the ${s || 'north'}, beyond the fields. Something is still glowing in the hole it made.`;
    case 'n_stariron': return `${a} walked out to the fallen star and came back with ${n || 'a sack of'} pounds of star-iron, black and heavy and still warm.`;
    case 'n_locusts': return `A dark cloud is coming in from the ${s || 'east'}, and it is humming: locusts, headed for the fields.`;
    case 'n_locusts_gone': return s === 'driven' ? `The locusts are gone, driven off with pots and pans and smoky fires. They stripped ${n} plots before they went.` : `The locusts have moved on, leaving ${n} plots stripped bare.`;
    case 'n_dragon': return `A dragon. It came over the hills from the ${s || 'north'}, so low its shadow covered the whole town. People ran for their doors.`;
    case 'n_dragon_field': return `The dragon breathed once as it passed. The ${s || 'grain'} field is ash.`;
    case 'n_dragon_beast': return `The dragon dropped on the pen and took a ${s || 'beast'}, and was gone before anyone could scream.`;
    case 'n_dragon_pass': return 'It did not stop. It passed over and was gone into the clouds, and nobody has spoken above a whisper since.';
    case 'n_haunt': return `There are lights in the graveyard at night, and the old folk say it is ${a}, who cannot rest. ${b} means to keep watch among the graves until it stops.`;
    case 'n_haunt_laid': return `${a} kept watch among the graves and spoke to ${b}'s spirit. The lights have not come back.`;
    case 'n_haunt_fades': return `The lights over the graveyard have stopped. Nobody can say why. ${a} rests easy again.`;
    case 'n_curse': return `Deep in the mine, ${a} broke into a hollow in the rock and found ${cursedThing(Number(s))}, and brought it home.`;
    case 'n_curse_hurt': return e.a === e.b ? `${a} had a bad fall. People are starting to look at what ${a} brought up from the mine.` : `${a} had a bad fall in ${b}'s house. People blame what ${b} brought up from the mine.`;
    case 'n_curse_sour': return `${n || 'Several'} casks of ale turned to vinegar overnight. Everyone knows what ${a} keeps on the shelf.`;
    case 'n_curse_tools': return `Tools keep breaking around ${a}. It is the thing from the mine, people say.`;
    case 'n_curse_end': {
      const [how, k] = s.split('|');
      const thing = cursedThing(Number(k));
      if (how === 'water') return `${a} threw ${thing} into the deep water. The bad luck went with it.`;
      if (how === 'shrine') return `${a} gave ${thing} to the shrine, to be buried under the altar stone.`;
      return `${thing[0].toUpperCase()}${thing.slice(1)}, the thing ${a} found in the mine, is gone. Nobody admits to taking it.`;
    }
    case 'n_winter_warn': return 'The geese went south early and the berries hang thick on the rowans. The old folk say a hard winter is coming, and the woodcutters are working late.';
    case 'n_winter': return 'The hard winter has come. The wells freeze over at night and the snow lies deep.';
    case 'n_winter_end': return 'The hard winter has broken at last. The first green is showing through the snow.';
    case 'n_elope': return n ? `${a} and ${b} slipped out of the colony after dark, against ${first(c, n)}'s word.` : `${a} and ${b} slipped out of the colony after dark. They have been courting for a season and more, and they are done with waiting.`;
    case 'n_eloped': return `${a} and ${b} came back at dawn, married under an oak in the woods.${n ? ` ${first(c, n)} will not speak to them.` : ' Nobody is very surprised.'}`;
    case 'n_feud': { const [x, y] = fams(); return s.startsWith('elope') ? `${a} has sworn the ${x} family will never forgive the ${y} family. It is a feud now.` : `The bad blood between the ${x} and ${y} families has become a feud. It began with ${a} and ${b}.`; }
    case 'n_feud_clash': return s === 'fists' ? `${a} and ${b} came to blows. The feud between their families goes on.` : s === 'fence' ? `Someone smashed the fence at ${b}'s house in the night. Everyone says it was ${a}.` : `${a} and ${b} traded insults at the well. The feud between their families goes on.`;
    case 'n_feud_end': { const [x, y] = s.split('|'); return e.a ? `${a} sat the ${x} and ${y} families down at one table, and the feud is over.` : `The feud between the ${x} and ${y} families has burned itself out.`; }
    case 'n_feud_wed': return `${a} and ${b} are married, and their two families have had to make peace.`;
    case 'n_lost': return `${a} went into the woods after a stray goat and has not come back. A search party is going out with torches${e.b ? `, ${b} at its head` : ''}.`;
    case 'n_found': return `${a} found ${b} in the woods, cold and frightened but unhurt, and carried them home.`;
    case 'n_lost_home': return `${a} found the way home alone at first light, scratched and hungry, after a night in the woods.`;
    case 'n_challenge': return `${a} has challenged ${b} to a duel over ${first(c, n)}. They meet at dawn in the square.`;
    case 'n_duel': { const x = first(c, n); return s === 'heart' ? `${a} beat ${b} in the duel at dawn, and ${x} has gone to ${a}.` : s === 'kept' ? `${a} beat ${b} in the duel at dawn, and keeps ${x}.` : `${a} beat ${b} in the duel at dawn. ${x} was not impressed.`; }
    case 'n_duel_off': return `${a} did not turn up for the duel with ${b}. The whole colony knows.`;
    case 'n_suitor': return `${full(c, e.a)} rode in from ${s || 'a noble house beyond the hills'} with a letter and a ring, asking for the hand of ${b}. ${b} has said yes.`;
    case 'n_noble_wed': { const [old, nw, h] = s.split('|'); return `With that, the houses of ${old || 'one family'} and ${nw || 'another'} are joined${h ? `, and ${h} is kin to us now` : ''}. Banners hung in the hall, the treasury paid for the feast, and it ran late into the night.`; }
    default: return `${e.k}: ${a}`;
  }
}
