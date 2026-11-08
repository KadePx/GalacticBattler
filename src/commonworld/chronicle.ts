// Turns the event log into readable history. Text is chosen from templates by a hash of the
// event, so the same event always reads the same way.

import { Rand, S } from './sim/rng';
import { AGES } from './sim/techs';
import { TIER_NAMES, TICKS_PER_YEAR, type Ev, type World } from './sim/types';

export interface Line { year: number; text: string; civs: number[]; kind: string; major: boolean }

const MAJOR = new Set([
  'found_civ', 'civ_fall', 'secede', 'monument', 'plague_start', 'plague_end', 'tier_up', 'contact', 'succession',
  'war', 'conquest', 'peace', 'crisis', 'new_dynasty', 'age', 'ally', 'great_born',
]);

const GREAT_WORD: Record<string, string> = { general: 'general', scholar: 'scholar', builder: 'master builder', merchant: 'merchant prince', prophet: 'prophet' };

function fmt(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)},000` : n.toLocaleString('en-US');
}

export function yearOf(t: number): number {
  return Math.floor(t / TICKS_PER_YEAR);
}

export function line(w: World, e: Ev, idx: number): Line {
  const r = new Rand(w.seed, S.CHRON, idx);
  const P = (i?: number) => (i !== undefined && w.civs[i] ? `the ${w.civs[i].name}` : 'a people');
  const Pc = (i?: number) => {
    const s = P(i);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const T = (i?: number) => (i !== undefined && w.setts[i] ? w.setts[i].name : 'a place');
  const pick = (...opts: string[]) => r.pick(opts);
  let text: string;
  switch (e.k) {
    case 'found_civ':
      text = pick(
        `${Pc(e.a)} came to ${T(e.s)} and lit the first hearth, led by ${e.x}.`,
        `Under ${e.x}, ${P(e.a)} settled at ${T(e.s)}. Here their story begins.`,
        `${Pc(e.a)} raised their first roofs at ${T(e.s)}, and ${e.x} named it home.`,
      );
      break;
    case 'found_sett':
      text = pick(
        `Settlers from ${e.x} founded ${T(e.s)}.`,
        `${Pc(e.a)} walked out from ${e.x} and built ${T(e.s)}.`,
        `A new village, ${T(e.s)}, grew from the families of ${e.x}.`,
      );
      break;
    case 'river_named':
      text = `${Pc(e.a)} gave the river at ${T(e.s)} its name: the ${e.x}.`;
      break;
    case 'tier_up':
      text = pick(
        `${T(e.s)} grew into a ${TIER_NAMES[e.n ?? 2]}.`,
        `${T(e.s)} was now a ${TIER_NAMES[e.n ?? 2]}, the pride of ${P(e.a)}.`,
      );
      break;
    case 'famine':
      text = pick(
        `Famine came to ${T(e.s)}. ${fmt(e.n ?? 0)} died hungry.`,
        `The stores of ${T(e.s)} ran empty, and ${fmt(e.n ?? 0)} starved.`,
        `A hungry year in ${T(e.s)}: ${fmt(e.n ?? 0)} were lost.`,
      );
      break;
    case 'abandon':
      text = pick(`${T(e.s)} was abandoned.`, `The last families left ${T(e.s)}. Only ruins remain.`);
      break;
    case 'capital_move':
      text = `${Pc(e.a)} made ${T(e.s)} their new seat of power.`;
      break;
    case 'civ_fall':
      text = e.b !== undefined
        ? `${Pc(e.a)} were conquered by ${P(e.b)}. They endured ${e.n} years and once numbered ${fmt(Number(e.y) || 0)}.`
        : `${Pc(e.a)} are no more. They endured ${e.n} years and once numbered ${fmt(Number(e.y) || 0)}.`;
      break;
    case 'tech':
      text = e.y
        ? `${Pc(e.a)} learned ${e.x} from the scholars of captured ${e.y}.`
        : e.z
          ? `${e.z} taught ${P(e.a)} ${e.x}.`
          : pick(`${Pc(e.a)} learned ${e.x}.`, `In the land of ${P(e.a)}, someone worked out ${e.x}.`, `${Pc(e.a)} took up ${e.x}.`);
      break;
    case 'age':
      text = `The world entered the ${AGES[e.n ?? 0]} Age.`;
      break;
    case 'trade_open':
      text = pick(
        `${e.n ? 'Ships' : 'Caravans'} began to run between ${T(e.s)} and ${e.x}. ${Pc(e.a)} and ${P(e.b)} were trading partners.`,
        `Merchants of ${P(e.a)} opened a ${e.n ? 'sea lane' : 'road'} from ${T(e.s)} to ${e.x}, in the land of ${P(e.b)}.`,
      );
      break;
    case 'pact':
      text = `${Pc(e.a)} and ${P(e.b)} swore a pact of trade and friendship.`;
      break;
    case 'ally':
      text = pick(`${Pc(e.a)} and ${P(e.b)} became allies.`, `${Pc(e.a)} and ${P(e.b)} swore to stand together in war.`);
      break;
    case 'pact_end':
      text = `The pact between ${P(e.a)} and ${P(e.b)} lapsed.`;
      break;
    case 'ally_end':
      text = `The alliance between ${P(e.a)} and ${P(e.b)} fell apart.`;
      break;
    case 'war': {
      const why = e.y === 'land' ? 'hungry for land' : e.y === 'grudge' ? 'nursing old wrongs' : e.y === 'succession' ? 'over the throne' : 'eager for plunder';
      text = pick(`${Pc(e.a)}, ${why}, declared war on ${P(e.b)}: ${e.x} had begun.`, `${e.x} began. ${Pc(e.a)} marched against ${P(e.b)}, ${why}.`);
      break;
    }
    case 'war_join':
      text = `${Pc(e.a)} joined ${e.x} against ${P(e.b)}.`;
      break;
    case 'battle':
      text = e.y
        ? `${Pc(e.a)} under the general ${e.y} defeated ${P(e.b)} at ${e.x}. ${fmt(e.n ?? 0)} fell.`
        : pick(`${Pc(e.a)} beat ${P(e.b)} at ${e.x}. ${fmt(e.n ?? 0)} fell.`, `${e.x}: ${P(e.a)} carried the day against ${P(e.b)}; ${fmt(e.n ?? 0)} died.`);
      break;
    case 'conquest':
      text = pick(`${T(e.s)} fell to ${P(e.a)}.`, `${Pc(e.a)} took ${T(e.s)} from ${P(e.b)}.`, `After a long siege, ${T(e.s)} opened its gates to ${P(e.a)}.`);
      break;
    case 'peace': {
      const res = e.z === 'victory' ? `${P(e.a)} won` : e.z === 'defeat' ? `${P(e.b)} held them off` : 'neither side won';
      text = `${e.x} ended after ${e.n} ${e.n === 1 ? 'year' : 'years'}: ${res}.`;
      break;
    }
    case 'great_born':
      text = pick(`A great ${GREAT_WORD[e.y ?? ''] ?? e.y}, ${e.x}, rose among ${P(e.a)}.`, `${Pc(e.a)} began to speak of ${e.x}, a ${GREAT_WORD[e.y ?? ''] ?? e.y} without equal.`);
      break;
    case 'great_died':
      text = e.n ? `${e.x}, the ${GREAT_WORD[e.y ?? ''] ?? e.y} of ${P(e.a)}, died, remembered for ${e.n} great deeds.` : `${e.x}, the ${GREAT_WORD[e.y ?? ''] ?? e.y} of ${P(e.a)}, died.`;
      break;
    case 'crisis':
      text = `${e.x} died and the throne was contested. ${T(e.s)} and ${(e.n ?? 1) - 1} other towns backed ${e.y} of House ${e.z}, and broke away as ${P(e.a)}.`;
      break;
    case 'new_dynasty':
      text = `${e.x} died without a clear heir. ${e.y} of House ${e.z} seized the throne of ${P(e.a)}.`;
      break;
    case 'succession':
      if (e.z) {
        text = pick(
          `${e.x} died after ${e.n} years of rule. ${e.y} of House ${e.z} took the seat.`,
          `The reign of ${e.x} ended after ${e.n} years; ${e.y} of House ${e.z} rose in their place.`,
          `${Pc(e.a)} mourned ${e.x} (${e.n} years). ${e.y} of House ${e.z} now leads them.`,
        );
        break;
      }
      text = pick(
        `${e.x} died after ${e.n} years of rule. ${e.y} took the seat.`,
        `The reign of ${e.x} ended after ${e.n} years; ${e.y} rose in their place.`,
        `${Pc(e.a)} mourned ${e.x} (${e.n} years). ${e.y} now leads them.`,
      );
      break;
    case 'innovation':
      text = pick(`${Pc(e.a)} learned ${e.x}.`, `In the land of ${P(e.a)}, someone worked out ${e.x}.`, `${Pc(e.a)} took up ${e.x}.`);
      break;
    case 'monument':
      text = pick(
        `${Pc(e.a)} finished ${e.x} at ${T(e.s)}.`,
        `Under ${e.y}, ${P(e.a)} raised ${e.x}. It will stand for ages.`,
      );
      break;
    case 'temple':
      text = `${T(e.s)} raised its first temple.`;
      break;
    case 'walls':
      text = `${T(e.s)} built walls of earth and stone.`;
      break;
    case 'revolt':
      text = pick(`Unrest boiled over in ${T(e.s)}.`, `The people of ${T(e.s)} rose against their leaders.`);
      break;
    case 'secede':
      text = `${T(e.s)} broke away from ${P(e.b)}. Its people now call themselves ${P(e.a)}, led by ${e.x}.`;
      break;
    case 'contact':
      text = pick(
        `${Pc(e.a)} met ${P(e.b)} for the first time, near ${T(e.s)}.`,
        `Travellers from ${P(e.b)} came to ${T(e.s)}. ${Pc(e.a)} were no longer alone.`,
      );
      break;
    case 'drought':
      text = pick(`Drought settled over the lands of ${P(e.a)}.`, `The rains failed ${P(e.a)}.`);
      break;
    case 'bounty':
      text = pick(`A golden harvest for ${P(e.a)}.`, `${Pc(e.a)} had a year of plenty.`);
      break;
    case 'winter':
      text = `A bitter winter fell on ${P(e.a)}.`;
      break;
    case 'flood':
      text = pick(
        `The river rose over ${T(e.s)} and took ${fmt(e.n ?? 0)}. The silt it left was rich.`,
        `Floods drowned ${fmt(e.n ?? 0)} in ${T(e.s)}.`,
      );
      break;
    case 'plague_start':
      text = `${e.x} broke out in ${T(e.s)}.`;
      break;
    case 'plague_reach':
      text = `${e.x} reached ${T(e.s)}.`;
      break;
    case 'plague_end':
      text = `${e.x} finally passed, after taking ${fmt(e.n ?? 0)} lives.`;
      break;
    default:
      text = e.k;
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  const civs = [e.a, e.b].filter((x): x is number => x !== undefined);
  return { year: yearOf(e.t), text, civs, kind: e.k, major: MAJOR.has(e.k) };
}

/** The last `limit` lines, optionally for one civ only. */
export function recent(w: World, limit: number, civ = -1): Line[] {
  const out: Line[] = [];
  for (let i = w.log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = w.log[i];
    if (civ >= 0 && e.a !== civ && e.b !== civ) continue;
    out.push(line(w, e, w.logBase + i));
  }
  return out;
}
