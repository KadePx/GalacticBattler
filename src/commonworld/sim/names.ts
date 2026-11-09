// Made-up languages. A phonology (which sounds a people use) is picked from one seed and a
// lexicon (the actual words) from another, so a civ that breaks away keeps its parent's
// sound but gets new words.

import { Rand } from './rng';
import { isClean } from '../shared/text';

const CONS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'sh', 'kh', 'ch', 'q', 'y', 'w', 'j', 'dr', 'tr', 'gr'];
const VOWS = ['a', 'e', 'i', 'o', 'u'];
const RARE_V = ['ae', 'ai', 'ou', 'ei', 'aa', 'y'];
const FINS = ['n', 'r', 's', 'l', 'm', 'k', 'th', 'sh', 'x', 'nd', 'rn', 'sk', 't'];
const PATS = [
  ['CV', 'CVC'],
  ['CV', 'CV', 'V', 'CVC'],
  ['CVC', 'CV'],
  ['V', 'CV', 'CVC', 'CV'],
  ['CV', 'CVC', 'CVC'],
];
const PEOPLE = ['i', 'ari', 'ans', 'ese', 'ites', 'oi', 'en', 'ul', 'ai', 'ar', 'im', 'osi'];

interface Phon {
  c: string[];
  v: string[];
  fin: string[];
  pat: string[];
  end: string;
}

const cache = new Map<number, Phon>();

function phonology(seed: number): Phon {
  const hit = cache.get(seed);
  if (hit) return hit;
  const r = new Rand(seed, 0x50484f4e);
  const c = r.shuffle(CONS).slice(0, 7 + r.int(6));
  const v = r.shuffle(VOWS).slice(0, 3 + r.int(3));
  if (r.chance(0.5)) v.push(r.pick(RARE_V));
  const fin = r.shuffle(FINS).slice(0, 2 + r.int(4));
  const p: Phon = { c, v, fin, pat: r.pick(PATS), end: r.pick(PEOPLE) };
  cache.set(seed, p);
  return p;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rawWord(p: Phon, r: Rand, minSyl: number, maxSyl: number): string {
  for (let tries = 0; tries < 8; tries++) {
    const n = r.range(minSyl, maxSyl);
    let w = '';
    for (let i = 0; i < n; i++) {
      const pat = r.pick(p.pat);
      for (let k = 0; k < pat.length; k++) {
        const ch = pat[k];
        // A syllable's closing consonant comes from the smaller "final" set.
        if (ch === 'C') w += k > 0 ? r.pick(p.fin) : r.pick(p.c);
        else w += r.pick(p.v);
      }
    }
    if (w.length >= 3 && w.length <= 10 && !/(.)\1\1/.test(w) && isClean(w)) return w;
  }
  return 'ama';
}

/** A word in a language, keyed so the same key always gives the same word. */
export function word(phon: number, lex: number, ...key: number[]): string {
  return cap(rawWord(phonology(phon), new Rand(lex, ...key), 1, 3));
}

/** Name of a people, like "Ashkari". */
export function peopleName(phon: number, lex: number): string {
  const p = phonology(phon);
  let root = rawWord(p, new Rand(lex, 0x0c1f), 1, 2);
  if (/[aeiouy]$/.test(root) && /^[aeiou]/.test(p.end)) root = root.slice(0, -1);
  const name = cap(root + p.end);
  return isClean(name) ? name : cap(root + 'ar');
}

export const NAME_KEY = { SETT: 1, RULER: 2, RIVER: 3, HOUSE: 4, GREAT: 5, FAITH: 6 } as const;

const PLAGUE_A = ['Grey', 'Red', 'Black', 'Pale', 'Weeping', 'Burning', 'Sweating', 'Silent', 'Yellow', 'Shaking'];
const PLAGUE_B = ['Cough', 'Fever', 'Pox', 'Rot', 'Sickness', 'Blight', 'Flux', 'Wasting', 'Death', 'Chill'];
export function plagueName(r: Rand): string {
  return `the ${r.pick(PLAGUE_A)} ${r.pick(PLAGUE_B)}`;
}

const MON_A = ['Great', 'High', 'Golden', 'Silent', 'Red', 'Sky', 'Eternal', 'Thousand', 'White', 'Sunken', 'Painted', 'Hollow'];
const MON_B = ['Steps', 'Spire', 'Gate', 'Tomb', 'Colossus', 'Gardens', 'Ziggurat', 'Arch', 'Obelisk', 'Hall', 'Pillars', 'Mound'];
export function monumentName(r: Rand, place: string, ruler: string): string {
  if (r.chance(0.35)) return `the ${r.pick(MON_B)} of ${ruler}`;
  return `the ${r.pick(MON_A)} ${r.pick(MON_B)} of ${place}`;
}

const EPITHETS = ['the Wise', 'the Quiet', 'the Bold', 'the Just', 'the Stern', 'the Fair', 'the Patient', 'the Proud', 'the Gentle', 'the Grim', 'the Lucky', 'the Watchful'];
export function epithet(r: Rand, reignYears: number, founded: number, built: number, famines: number): string {
  if (reignYears < 3) return 'the Brief';
  if (famines >= 2) return 'the Lean';
  if (founded >= 3) return 'the Wayfinder';
  if (built >= 8) return 'the Builder';
  if (reignYears >= 40) return 'the Old';
  return r.pick(EPITHETS);
}

const FAITH_FORM = [(w: string) => `the Way of ${w}`, (w: string) => `the ${w} Faith`, (w: string) => `the Path of ${w}`, (w: string) => `the Light of ${w}`, (w: string) => `the ${w} Covenant`, (w: string) => `the Church of ${w}`, (w: string) => `the Mysteries of ${w}`];
/** A faith's name, in the language of the people who founded it. */
export function faithName(phon: number, lex: number, n: number): string {
  const r = new Rand(lex, NAME_KEY.FAITH, n, 0xfa17);
  return r.pick(FAITH_FORM)(word(phon, lex, NAME_KEY.FAITH, n));
}
