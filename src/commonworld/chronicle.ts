// Turns the event log into readable history. Text is chosen from templates by a hash of the
// event, so the same event always reads the same way.

import { Rand, S } from './sim/rng';
import { AGES } from './sim/techs';
import { TIER_NAMES, TICKS_PER_YEAR, type Ev, type World } from './sim/types';

/** Major for one people, but too common to fill the world's "great events" feed. */
export const WORLD_QUIET = new Set(['succession', 'great_born', 'contact', 'tier_up', 'ally', 'marriage', 'pilgrims']);

export interface Line { year: number; text: string; civs: number[]; kind: string; major: boolean }

const MAJOR = new Set([
  'found_civ', 'civ_fall', 'secede', 'monument', 'plague_start', 'plague_end', 'tier_up', 'contact', 'succession',
  'war', 'conquest', 'peace', 'crisis', 'new_dynasty', 'age', 'ally', 'great_born',
  'omen_claim', 'claim_war', 'omen_war', 'omen_sign', 'edict', 'renamed', 'great_named', 'wonder_named', 'gift', 'pilgrims',
  'faith_found', 'schism', 'wonder', 'quake', 'eruption', 'tsunami', 'collapse', 'revival', 'defect',
  'tribute', 'tribute_end', 'era', 'era_end', 'climate', 'climate_end', 'usurp', 'cede', 'marriage',
]);

const GREAT_WORD: Record<string, string> = { general: 'general', scholar: 'scholar', builder: 'master builder', merchant: 'merchant prince', prophet: 'prophet' };

function fmt(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)},000` : n.toLocaleString('en-US');
}

const years = (n: number) => (n < 1 ? 'less than a year' : `${n} ${n === 1 ? 'year' : 'years'}`);
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "the Shaking Wasting" reads badly; two -ing words in a row become "Sickness".
const plague = (x?: string) => (x ?? 'a plague').replace(/(\w+ing) Wasting\b/, '$1 Sickness');
const DEED: Record<string, [string, string]> = { general: ['victory', 'victories'], scholar: ['discovery', 'discoveries'], builder: ['great work', 'great works'] };

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
  // " at Thoi", unless the name already says where ("the Great Library of Thoi").
  const at = (e: Ev) => (e.s !== undefined && w.setts[e.s] && e.x?.includes(w.setts[e.s].name) ? '' : ` at ${T(e.s)}`);
  const gloss = (g?: string) => (g ? ` (“${g}” in their tongue)` : '');
  const pick = (...opts: string[]) => r.pick(opts);
  let text: string;
  switch (e.k) {
    case 'found_civ':
      if (e.a !== undefined && w.civs[e.a]?.founder) {
        const by = w.civs[e.a].byName;
        text = `${Pc(e.a)} arrived from beyond the known lands and lit their first hearth at ${T(e.s)}, led by ${e.x}.${by ? ` Their founder was ${by}.` : ''}`;
        break;
      }
      text = pick(
        `${Pc(e.a)} came to ${T(e.s)} and lit the first hearth, led by ${e.x}.`,
        `Under ${e.x}, ${P(e.a)} settled at ${T(e.s)}. Here their story begins.`,
        `${Pc(e.a)} raised their first roofs at ${T(e.s)}, and ${e.x} called it home.`,
      );
      break;
    case 'found_sett':
      text = pick(
        `Settlers from ${e.x} founded ${T(e.s)}${gloss(e.s !== undefined ? w.setts[e.s]?.g : undefined)}.`,
        `${Pc(e.a)} walked out from ${e.x} and built ${T(e.s)}.`,
        `A new village, ${T(e.s)}, grew from the families of ${e.x}.`,
      );
      break;
    case 'river_named':
      text = `${Pc(e.a)} gave the river at ${T(e.s)} its name: the ${e.x}${gloss(w.rivers.find((v) => v.name === e.x)?.g)}.`;
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
    {
      const peak = Number(e.y) || 0;
      const n = e.n ?? 0;
      const life = n < 1 ? 'They lasted less than a year' : `They endured ${years(n)}`;
      text = `${e.b !== undefined ? `${Pc(e.a)} were conquered by ${P(e.b)}.` : `${Pc(e.a)} are no more.`} ${life}${peak > 0 ? ` and at their height numbered ${fmt(peak)}` : ''}.`;
      break;
    }
    case 'tech':
      text = e.y
        ? `Scholars taken at ${e.y} brought ${e.x} to ${P(e.a)}.`
        : e.z
          ? `Thanks to ${e.z}, ${e.x} came to ${P(e.a)}.`
          : pick(`${cap1(e.x ?? '')} came to ${P(e.a)}.`, `${Pc(e.a)} adopted ${e.x}.`, `${Pc(e.a)} now had ${e.x}.`);
      break;
    case 'age':
      text = `The world entered the ${AGES[e.n ?? 0]} Age.`;
      break;
    case 'trade_open':
      text = pick(
        `${e.n ? 'Ships' : 'Caravans'} began to run between ${T(e.s)} and ${e.x}. ${Pc(e.a)} and ${P(e.b)} were now trading partners.`,
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
      const why = e.y === 'land' ? 'hungry for land' : e.y === 'grudge' ? 'nursing old wrongs' : e.y === 'succession' ? 'pressing a claim to the throne' : e.y === 'faith' ? 'in the name of their faith' : e.y === 'independence' ? 'refusing to pay tribute any longer' : 'eager for plunder';
      text = pick(`${Pc(e.a)}, ${why}, declared war on ${P(e.b)}: ${e.x} had begun.`, `${e.x} began. ${Pc(e.a)} marched against ${P(e.b)}, ${why}.`);
      break;
    }
    case 'war_join':
      text = e.y === 'lord' ? `${Pc(e.a)}, bound by tribute and oath, joined ${e.x} against ${P(e.b)}.` : `${Pc(e.a)} joined ${e.x} against ${P(e.b)}.`;
      break;
    case 'tribute':
      text = pick(`Beaten, ${P(e.a)} bowed to ${P(e.b)} and agreed to pay them tribute.`, `${Pc(e.a)} became tributaries of ${P(e.b)}, sending them a share of their wealth each year.`);
      break;
    case 'tribute_end':
      text = e.x === 'lord_fell'
        ? `With ${P(e.b)} gone, ${P(e.a)} owed tribute to no one.`
        : e.x === 'freed'
          ? `${Pc(e.a)} no longer paid tribute to ${P(e.b)}, whose own masters now ruled them.`
          : `After ${years(e.n ?? 0)}, ${P(e.b)} released ${P(e.a)} from their tribute.`;
      break;
    case 'era':
      text = e.y === 'golden'
        ? pick(`${Pc(e.a)} entered ${e.x}: their towns were calm, their learning bold and their works admired.`, `Under ${e.x?.replace(/^the Golden Age of /, '')}, ${P(e.a)} flourished. Later ages would call it ${e.x}.`)
        : pick(`${Pc(e.a)} fell into ${e.x}. Learning faltered and hope ran thin.`, `For ${P(e.a)}, ${e.x} began.`);
      break;
    case 'era_end':
      text = e.y === 'golden' ? `For ${P(e.a)}, ${e.x ?? 'the golden age'} came to an end after ${years(e.n ?? 0)}.` : `${Pc(e.a)} came out of ${e.x} after ${years(e.n ?? 0)}.`;
      break;
    case 'climate':
      text = e.y === 'cold' ? `The winters grew long and bitter across the world. It was the start of ${e.x}.`
        : e.y === 'warm' ? `The world warmed. ${cap1(e.x ?? '')} had begun.`
        : e.y === 'dry' ? `The rains grew rare across the world, and ${e.x} began.`
        : `Rain fell and fell. ${cap1(e.x ?? '')} had come.`;
      break;
    case 'climate_end':
      text = `${cap1(e.x ?? 'The long swing of weather')} came to an end, and the seasons turned as before.`;
      break;
    case 'marriage':
      text = pick(`House ${e.x} of ${P(e.a)} and House ${e.y} of ${P(e.b)} were joined by marriage.`, `A royal wedding bound ${P(e.a)} to ${P(e.b)}: the houses of ${e.x} and ${e.y} became one family.`);
      break;
    case 'regency':
      text = `The new ruler of ${P(e.a)}, ${e.x}, was only ${e.n ?? 'a few'} years old. ${e.y} would rule as regent until they came of age.`;
      break;
    case 'regency_end':
      text = `${e.x} came of age and took the rule of ${P(e.a)} from the regent ${e.y}.`;
      break;
    case 'usurp':
      text = `The regent ${e.y} pushed the young ${e.x} aside and seized the throne of ${P(e.a)}, founding House ${e.z}.`;
      break;
    case 'retongue':
      text = `Generations under ${P(e.a)} had changed how its people spoke: ${e.x} was now called ${e.y}${gloss(e.s !== undefined ? w.setts[e.s]?.g : undefined)}.`;
      break;
    case 'cede':
      text = `By the peace that ended ${e.x}, ${T(e.s)} was handed to ${P(e.a)}.`;
      break;
    case 'refugees':
      text = e.y === 'famine' ? `${fmt(e.n ?? 0)} hungry people left ${e.x} for ${T(e.s)}.` : `${fmt(e.n ?? 0)} people fled the fall of ${e.x} and found shelter in ${T(e.s)}.`;
      break;
    case 'battle':
    {
      const at = /^the Siege/.test(e.x ?? '') ? 'in' : 'at';
      const dead = e.n ? ` ${fmt(e.n)} fell.` : '';
      text = e.y
        ? `Led by the general ${e.y}, ${P(e.a)} defeated ${P(e.b)} ${at} ${e.x}.${dead}`
        : pick(`${Pc(e.a)} defeated ${P(e.b)} ${at} ${e.x}.${dead}`, `${Pc(e.a)} won ${e.x} against ${P(e.b)}.${dead}`);
      break;
    }
    case 'conquest':
      text = pick(`${T(e.s)} fell to ${P(e.a)}.`, `${Pc(e.a)} took ${T(e.s)} from ${P(e.b)}.`, `After a long siege, ${T(e.s)} opened its gates to ${P(e.a)}.`);
      break;
    case 'peace': {
      const res = e.z === 'victory' ? `${P(e.a)} won` : e.z === 'defeat' ? `${P(e.b)} held them off` : e.z === 'submitted' ? `${P(e.b)} bowed to ${P(e.a)} and agreed to pay them tribute` : 'neither side won';
      text = `${e.x} ended after ${years(e.n ?? 0)}: ${res}.`;
      break;
    }
    case 'great_born':
      text = pick(`A great ${GREAT_WORD[e.y ?? ''] ?? e.y}, ${e.x}, rose among ${P(e.a)}.`, `${Pc(e.a)} began to speak of ${e.x}, a ${GREAT_WORD[e.y ?? ''] ?? e.y} without equal.`);
      break;
    case 'great_died':
    {
      const d = DEED[e.y ?? ''];
      const n = e.n ?? 0;
      const fame = n && d ? `, remembered for ${n === 1 ? `one ${d[0]}` : `${n} ${d[1]}`}` : '';
      text = `${e.x}, the ${GREAT_WORD[e.y ?? ''] ?? e.y} of ${P(e.a)}, died${fame}.`;
    }
      break;
    case 'crisis':
    {
      const others = (e.n ?? 1) - 1;
      const who = others < 1 ? T(e.s) : `${T(e.s)} and ${others === 1 ? 'one other town' : `${others} other towns`}`;
      text = `${e.x} died and the throne was contested. ${who} backed ${e.y} of House ${e.z} and broke away as ${P(e.a)}.`;
    }
      break;
    case 'new_dynasty':
      text = `${e.x} died without a clear heir. ${e.y} of House ${e.z} seized the throne of ${P(e.a)}.`;
      break;
    case 'succession':
      if (e.z) {
        text = pick(
          `${e.x} died after a reign of ${years(e.n ?? 0)}. ${e.y} of House ${e.z} took the seat.`,
          `The reign of ${e.x} ended after ${years(e.n ?? 0)}; ${e.y} of House ${e.z} rose in their place.`,
          `${Pc(e.a)} mourned ${e.x}, who had ruled for ${years(e.n ?? 0)}. ${e.y} of House ${e.z} now led them.`,
        );
        break;
      }
      text = pick(
        `${e.x} died after a reign of ${years(e.n ?? 0)}. ${e.y} took the seat.`,
        `The reign of ${e.x} ended after ${years(e.n ?? 0)}; ${e.y} rose in their place.`,
        `${Pc(e.a)} mourned ${e.x}, who had ruled for ${years(e.n ?? 0)}. ${e.y} now led them.`,
      );
      break;
    case 'innovation':
      text = pick(`${cap1(e.x ?? '')} came to ${P(e.a)}.`, `${Pc(e.a)} adopted ${e.x}.`, `${Pc(e.a)} now had ${e.x}.`);
      break;
    case 'monument':
    {
      const x = e.x ?? 'a monument';
      const place = x.endsWith(` of ${T(e.s)}`) ? '' : ` at ${T(e.s)}`;
      // "the Seven Pillars" stand; "the Spire" stands.
      const it = /(Steps|Pillars|Terraces|Gardens) of/.test(x) ? 'They will' : 'It will';
      text = e.y && x.endsWith(` of ${e.y}`)
        ? pick(`${Pc(e.a)} raised ${x}${place} in honour of their ruler.`, `${Pc(e.a)} finished ${x}${place}. ${it} stand for ages.`)
        : pick(`${Pc(e.a)} finished ${x}${place}, the work of ${e.y}.`, `${Pc(e.a)} raised ${x}${place}. ${it} stand for ages.`);
      break;
    }
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
      text = `${plague(e.x)} broke out in ${T(e.s)}.`;
      break;
    case 'plague_reach':
      text = `${plague(e.x)} reached ${T(e.s)}.`;
      break;
    case 'plague_end':
      text = `${plague(e.x)} finally passed, after taking ${fmt(e.n ?? 0)} lives.`;
      break;
    // ---- Milestone 6: founders ----
    case 'omen':
      text = e.x === 'claim'
        ? `${Pc(e.a)} awaited a sign: who should rule them?`
        : e.x === 'war' ? `${Pc(e.a)} awaited a sign on how to meet the war with ${P(e.b)}.`
          : e.x === 'pact' ? `${Pc(e.b)} offered an alliance, and ${P(e.a)} awaited a sign.`
            : pick(`A comet crossed the sky above ${P(e.a)}. What could it mean?`, `Strange lights burned over the lands of ${P(e.a)}, and the people awaited a sign.`);
      break;
    case 'omen_claim':
      text = e.n === 0
        ? `The sign was read: ${e.x} was the rightful ruler, and the claim of ${e.y} was forgotten. ${Pc(e.a)} took heart.`
        : e.n === 1 ? `The sign favoured ${e.y} of House ${e.z}, who took the throne of ${P(e.a)} from ${e.x} without a drop of blood.`
          : `No sign came, and the claim of ${e.y} faded away. ${e.x} kept the throne of ${P(e.a)}.`;
      break;
    case 'claim_war':
    {
      const others = (e.n ?? 1) - 1;
      const who = others < 1 ? T(e.s) : `${T(e.s)} and ${others === 1 ? 'one other town' : `${others} other towns`}`;
      text = `No sign came. ${e.y} of House ${e.z} pressed their claim against ${e.x}, and ${who} broke away as ${P(e.a)}.`;
    }
      break;
    case 'omen_war':
      text = e.n === 0
        ? `${Pc(e.a)} took the sign as a call to arms and rallied their levies for ${e.x}.`
        : e.n === 2
          ? `${Pc(e.a)} read the sign as a counsel of humility and bowed to ${P(e.b)}.`
          : `${Pc(e.a)} read the sign as a warning and bought peace from ${P(e.b)}.`;
      break;
    case 'omen_sign':
      text = [
        `${Pc(e.a)} read the sign as a promise of plenty, and the harvests swelled.`,
        `The sign was read as wisdom, and the scholars of ${P(e.a)} worked with new fire.`,
        `The sign was read as strength. ${Pc(e.a)} took up arms and stood taller.`,
      ][e.n ?? 0] ?? '';
      break;
    case 'edict': {
      const what: Record<string, string> = {
        grow: 'to tend their fields and families', expand: 'to settle new land', fortify: 'to raise walls and stand guard',
        worship: 'to honour the gods', build: 'to build great works', trade: 'to trade far and wide', research: 'to seek knowledge',
      };
      text = `By decree, ${P(e.a)} set themselves ${what[e.x ?? ''] ?? e.x} for a generation.`;
      break;
    }
    case 'renamed':
      text = `${Pc(e.a)} renamed ${e.x}: from now on it was called ${e.y}.`;
      break;
    case 'great_named':
      text = `The ${GREAT_WORD[e.z ?? ''] ?? 'hero'} ${e.x} of ${P(e.a)} would be remembered as ${e.y}.`;
      break;
    case 'wonder_named':
      text = `${Pc(e.a)} gave ${e.x} at ${T(e.s)} a name of their own: ${e.y}.`;
      break;
    case 'gift':
      text = pick(`${Pc(e.a)} sent a caravan of gifts to ${P(e.b)}.`, `Gifts from ${P(e.a)} reached ${P(e.b)}, and old wrongs seemed smaller.`);
      break;
    case 'proposal':
      text = `${Pc(e.a)} proposed an alliance to ${P(e.b)}.`;
      break;
    case 'proposal_refused':
      text = `${Pc(e.b)} turned down the alliance offered by ${P(e.a)}.`;
      break;
    case 'pilgrims':
      text = `Pilgrims had left ${fmt(e.n ?? 0)} offerings at ${T(e.s)}.`;
      break;
    // ---- Milestone 7: faith, wonders, disasters, fate ----
    case 'faith_found':
      text = pick(
        `In ${T(e.s)}, ${e.y} began to preach ${e.x}. ${Pc(e.a)} were the first to keep it.`,
        `${e.x} was born in ${T(e.s)}, from the words of ${e.y}.`,
      );
      break;
    case 'convert':
      text = e.y ? `${Pc(e.a)} turned from ${e.y} to ${e.x}.` : `${Pc(e.a)} took up ${e.x}.`;
      break;
    case 'schism':
      text = `${Pc(e.a)} broke with ${e.y}. In ${T(e.s)}, ${e.z} proclaimed ${e.x}.`;
      break;
    case 'faith_end':
      text = `The last keepers of ${e.x} were gone.`;
      break;
    case 'wonder_start':
      text = `${Pc(e.a)} began work on ${e.x} at ${T(e.s)}.`;
      break;
    case 'wonder':
      text = pick(
        `${Pc(e.a)} completed ${e.x ?? 'a wonder'}${at(e)}: a wonder of the world, raised under ${e.y}.`,
        `After years of labour, ${P(e.a)} completed ${e.x}${at(e)}. The whole world spoke of it.`,
      );
      break;
    case 'wonder_beaten':
      text = `${Pc(e.b)} finished ${e.x} first, and the half-built work of ${P(e.a)} at ${T(e.s)} was left to the weeds.`;
      break;
    case 'wonder_abandoned':
      text = `Work on ${e.x} at ${T(e.s)} was abandoned.`;
      break;
    case 'quake':
      text = `The earth shook beneath ${T(e.s)}. ${fmt(e.n ?? 0)} died in the ruins.`;
      break;
    case 'eruption':
      text = `The mountain above ${T(e.s)} burst into fire. ${fmt(e.n ?? 0)} died under the ash.`;
      break;
    case 'fire':
      text = pick(`A great fire swept through ${T(e.s)}. ${fmt(e.n ?? 0)} died.`, `${T(e.s)} burned for three days. ${fmt(e.n ?? 0)} were lost.`);
      break;
    case 'locusts':
      text = `Locusts darkened the sky over ${P(e.a)} and ate the fields bare.`;
      break;
    case 'tsunami':
      text = `A great wave struck the coast at ${T(e.s)}. ${fmt(e.n ?? 0)} were taken by the sea.`;
      break;
    case 'collapse':
      text = `The realm of ${P(e.a)} could no longer hold together and broke into ${e.n ?? 2} pieces.`;
      break;
    case 'revival':
      text = e.a !== undefined && w.civs[e.a]?.name === e.x
        ? `${T(e.s)} rose against ${P(e.b)}, and the ${e.x}, long fallen, lived again.`
        : `Remembering the fallen ${e.x}, ${T(e.s)} rose against ${P(e.b)} and became ${P(e.a)}.`;
      break;
    case 'defect':
      text = `Dazzled by the splendour of ${P(e.a)}, ${T(e.s)} left ${P(e.b)} and joined them.`;
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
