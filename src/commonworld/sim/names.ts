// Made-up languages. Each people speaks a tongue with its own sounds, its own way of ending
// town names, and a small vocabulary of real words ("ford", "high", "sun"), so most place
// names mean something. The sound and the vocabulary come from `phon`, which daughter peoples
// inherit: a people that breaks away still says "river" the way its parents did. Which words
// get combined comes from `lex`, which is each people's own.
//
// Naming conventions used across the world (keep new names in these shapes):
//   peoples     plural demonym in their tongue       the Gykari
//   towns       a word in their tongue, often meaning something   Velmar ("ford hold")
//   rivers      "the" + a word in the tongue of whoever first settled it   the Senvadu ("slow water")
//   rulers      a given name; after death a deed-based epithet       Gina the Builder
//   houses      a family name in the tongue, sometimes a town's name   House Tulmar
//   great folk  a given name and their calling                         Wou the merchant
//   faiths      English frame + prophet, holy city or idea            the Way of Lotulash
//   wonders     English kind + the town (or people) that raised it    the Great Library of Thoi
//   great works English kind + its builder or town                     the Painted Steps of Thoi
//   wars        cause-based English frame, ordinals when repeated     the Second Gurite–Khar War
//   plagues     colour + illness, its first town when the name recurs the Red Cough of Lanyil

import { Rand } from './rng';
import { isClean } from '../shared/text';

const SIMPLE = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'y', 'w', 'j'];
const SPECIAL = ['th', 'sh', 'kh', 'ch', 'dr', 'tr', 'gr', 'br', 'kr', 'st', 'bl', 'fr'];
const VOWS = ['a', 'e', 'i', 'o', 'u'];
const DIPH = ['ae', 'ai', 'ei', 'ou', 'au', 'ia'];
const MEDIAL = ['n', 'r', 'l', 'm', 's'];
const FINAL = ['n', 'r', 's', 'l', 'm', 'k', 't', 'd', 'th', 'sh', 'nd', 'rn', 'st', 'x'];
const DEMONYM = ['i', 'ari', 'ans', 'ese', 'ites', 'oi', 'en', 'ul', 'ai', 'ar', 'im', 'osi', 'ani', 'ene', 'ir', 'eth', 'iri', 'avi', 'ok', 'uns', 'ae', 'ori'];
const PLACE_GLOSS = ['hold', 'town', 'home', 'gate', 'watch', 'stead', 'rest', 'well'];

interface Lang {
  on: string[]; // ordinary onsets
  sp: string[]; // rarer onsets: digraphs and clusters
  v: string[];
  dip: string | null;
  med: string[]; // consonants that may close a syllable inside a word
  fin: string[]; // consonants that may end a word
  pMed: number;
  pFin: number;
  pV0: number; // chance a word starts with a vowel
  link: string; // vowel used to join two consonants in a compound
  place: { w: string; g: string }[]; // town endings and what they mean
  people: string[]; // demonym endings
  house: 0 | 1 | 2; // family names: plain, with an ending, with a beginning
  hAff: string;
}

const langs = new Map<number, Lang>();

function language(phon: number): Lang {
  const hit = langs.get(phon);
  if (hit) return hit;
  const r = new Rand(phon, 0x4c414e47);
  const fin = r.shuffle(FINAL).slice(0, 2 + r.int(3));
  // At most one heavy ending, so words don't pile up consonants.
  const heavy = fin.filter((f) => f.length > 1);
  const L: Lang = {
    on: r.shuffle(SIMPLE).slice(0, 7 + r.int(5)),
    sp: r.shuffle(SPECIAL).slice(0, r.int(4)),
    v: r.shuffle(VOWS).slice(0, 3 + r.int(3)),
    dip: r.chance(0.4) ? r.pick(DIPH) : null,
    med: r.shuffle(MEDIAL).slice(0, 1 + r.int(3)),
    fin: [...fin.filter((f) => f.length === 1), ...heavy.slice(0, 1)],
    pMed: 0.1 + r.float() * 0.3,
    pFin: 0.25 + r.float() * 0.45,
    pV0: 0.08 + r.float() * 0.12,
    link: '',
    place: [],
    people: [],
    house: r.int(3) as 0 | 1 | 2,
    hAff: '',
  };
  if (!L.fin.length) L.fin.push('n');
  L.link = r.pick(L.v);
  const glosses = r.shuffle(PLACE_GLOSS);
  for (let i = 0; i < 4; i++) {
    let m = '';
    for (let k = 0; k < 6 && (m.length < 2 || L.place.some((p) => p.w === m)); k++) m = morpheme(L, r, i === 0);
    L.place.push({ w: m, g: glosses[i] });
  }
  L.people = r.shuffle(DEMONYM).slice(0, 2);
  // A family marker is short: an ending like "-ax", a beginning like "Ve-".
  L.hAff = L.house === 1 ? r.pick(L.v) + r.pick(L.fin.filter((f) => f.length === 1).concat(L.med)) : r.pick(L.on) + r.pick(L.v);
  langs.set(phon, L);
  return L;
}

/** A short bound syllable: an ending starts with a vowel or a soft consonant. */
function morpheme(L: Lang, r: Rand, vowelFirst: boolean): string {
  const v = r.pick(L.v);
  if (vowelFirst) return v + r.pick([...L.med, ...L.fin.filter((f) => f.length === 1)]) + (r.chance(0.4) ? r.pick(L.v) : '');
  return r.pick(L.on) + v + (r.chance(0.5) ? r.pick(L.fin) : '');
}

const VOWEL = /[aeiouy]/;
const isV = (ch: string) => VOWEL.test(ch);

function fine(w: string, minLen: number, maxLen: number): boolean {
  if (w.length < minLen || w.length > maxLen) return false;
  if (/(.)\1\1/.test(w) || /[^aeiouy]{4,}/.test(w) || /[aeiouy]{3,}/.test(w) || /(..+)\1/.test(w)) return false;
  if (/yi|wu|ji|wo$|yy|hh|^h[^aeiouy]/.test(w)) return false;
  return isClean(w);
}

/** A word in a language: syllables of onset + vowel (+ a soft closing consonant), maybe a final. */
function gen(L: Lang, r: Rand, minSyl: number, maxSyl: number, minLen = 4, maxLen = 10): string {
  for (let tries = 0; tries < 14; tries++) {
    const n = r.range(minSyl, maxSyl);
    const syl: string[] = [];
    let closed = false;
    for (let i = 0; i < n; i++) {
      let s = '';
      if (!(i === 0 && r.chance(L.pV0))) s += closed || !L.sp.length || !r.chance(0.2) ? r.pick(L.on) : r.pick(L.sp);
      s += L.dip && r.chance(0.12) ? L.dip : r.pick(L.v);
      closed = false;
      if (i < n - 1) {
        if (r.chance(L.pMed)) { s += r.pick(L.med); closed = true; }
      } else if (r.chance(L.pFin)) s += r.pick(L.fin);
      syl.push(s);
    }
    if (syl.some((s, i) => i > 0 && s === syl[i - 1])) continue;
    const w = syl.join('');
    if (fine(w, minLen, maxLen)) return w;
  }
  return r.pick(L.on) + r.pick(L.v) + r.pick(L.med) + r.pick(L.v);
}

/** Join two parts of a compound so the seam stays sayable. */
function glue(L: Lang, a: string, b: string): string {
  if (isV(a[a.length - 1]) && isV(b[0])) return a + b.slice(1);
  if (!isV(a[a.length - 1]) && !isV(b[0])) {
    const tail = a.match(/[^aeiouy]+$/)![0];
    const head = b.match(/^[^aeiouy]+/)![0];
    if (tail.length + head.length > 2 || tail === head) return a + L.link + b;
  }
  return a + b;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Vocabulary ----

/** Things a word exists for in every tongue. The index is part of each word's key: append only. */
export const CONCEPTS = [
  'ford', 'brook', 'shore', 'haven', 'hill', 'stone', 'wood', 'pine', 'sand', 'frost', 'field', 'mere', 'horse', 'gold',
  'new', 'high', 'red', 'white', 'black', 'green', 'far', 'little', 'north', 'south', 'east', 'west', 'old', 'bright',
  'deep', 'slow', 'cold', 'long', 'water', 'sun', 'moon', 'sky', 'flame', 'star', 'sea', 'earth', 'light', 'tree',
  'marsh', 'spring', 'salt', 'iron', 'wild', 'fish',
] as const;
export type Concept = (typeof CONCEPTS)[number];

const roots = new Map<number, Map<Concept, string>>();

/** The word for a thing in a tongue (one syllable, sometimes two). Shared by a whole language family. */
export function root(phon: number, c: Concept): string {
  let m = roots.get(phon);
  if (!m) {
    m = new Map();
    const L = language(phon);
    const used = new Set<string>();
    CONCEPTS.forEach((k, i) => {
      let w = '';
      for (let t = 0; t < 8 && (!w || used.has(w)); t++) w = gen(L, new Rand(phon, 0x2007, i, t), 1, t > 3 ? 2 : 1, 2, 6);
      used.add(w);
      m!.set(k, w);
    });
    roots.set(phon, m);
  }
  return m.get(c)!;
}

// ---- Names ----

/** Name of a people, like "Ashkari". */
export function peopleName(phon: number, lex: number): string {
  const L = language(phon);
  const r = new Rand(lex, 0x0c1f);
  const end = r.pick(L.people);
  let rootW = gen(L, r, 1, 2, 3, 7);
  if (isV(rootW[rootW.length - 1]) && isV(end[0])) rootW = rootW.slice(0, -1);
  const name = cap(rootW + end);
  return isClean(name) && name.length <= 12 ? name : cap(rootW + 'ar');
}

export const NAME_KEY = { SETT: 1, RULER: 2, RIVER: 3, HOUSE: 4, GREAT: 5, FAITH: 6 } as const;

/** A person's given name (rulers, great people, prophets). */
export function personName(phon: number, lex: number, key: number, n: number): string {
  return cap(gen(language(phon), new Rand(lex, key, n, 0x9e7), 2, 3, 4, 9));
}

/** Kept for old callers: a plain word in a tongue. */
export function word(phon: number, lex: number, ...key: number[]): string {
  return cap(gen(language(phon), new Rand(lex, ...key), 2, 3, 4, 10));
}

/** Where a town stands, as the words its founders might use for it. */
export interface PlaceCtx { feat: Concept | null; adj: Concept[] }
export interface Named { name: string; gloss: string | null }

/** A town name, usually meaning something about the place ("ford hold", "high wood"). */
export function townName(phon: number, lex: number, n: number, ctx: PlaceCtx, taken: (s: string) => boolean = () => false): Named {
  const L = language(phon);
  for (let t = 0; t < 6; t++) {
    const r = new Rand(lex, NAME_KEY.SETT, n, t, 0x70);
    const end = r.pick(L.place);
    const x = r.float();
    let out: Named;
    if (ctx.feat && x < 0.26) out = { name: glue(L, root(phon, ctx.feat), end.w), gloss: `${ctx.feat} ${end.g}` };
    else if (ctx.adj.length && x < 0.56) {
      const a = r.pick(ctx.adj);
      out = ctx.feat && r.chance(0.7)
        ? { name: glue(L, root(phon, a), root(phon, ctx.feat)), gloss: `${a} ${ctx.feat}` }
        : { name: glue(L, root(phon, a), end.w), gloss: `${a} ${end.g}` };
    } else if (x < 0.64) out = { name: glue(L, gen(L, r, 1, 2, 2, 6), end.w), gloss: null };
    else out = { name: gen(L, r, 2, 3, 4, 10), gloss: null };
    out.name = cap(out.name);
    if (fine(out.name.toLowerCase(), 4, 12) && !taken(out.name)) return out;
  }
  return { name: cap(gen(L, new Rand(lex, NAME_KEY.SETT, n, 0x71), 2, 3, 5, 10)), gloss: null };
}

/** A few town names a tongue might give, for the founding screen (no place in mind). */
export function sampleTowns(phon: number, lex: number, n: number): Named[] {
  const feats: Concept[] = ['ford', 'hill', 'wood', 'shore', 'field'];
  const adjs: Concept[] = ['new', 'high', 'old', 'green'];
  return Array.from({ length: n }, (_, i) => townName(phon, lex, 1 + i, { feat: feats[i % feats.length], adj: [adjs[i % adjs.length]] }));
}

const RIVER_ADJ: Concept[] = ['slow', 'deep', 'cold', 'long', 'bright', 'white', 'black', 'red', 'green', 'wild', 'salt'];
/** A river's name: often "slow water" or "bright water" in the tongue of its first settlers. */
export function riverName(phon: number, lex: number, rid: number, taken: (s: string) => boolean = () => false): Named {
  const L = language(phon);
  const r = new Rand(lex, NAME_KEY.RIVER, rid, 0x41);
  for (const a of r.shuffle(RIVER_ADJ).slice(0, 3)) {
    const name = cap(glue(L, root(phon, a), root(phon, 'water')));
    if (r.chance(0.6) && fine(name.toLowerCase(), 4, 11) && !taken(name)) return { name, gloss: `${a} water` };
  }
  for (let t = 0; t < 4; t++) {
    const name = cap(gen(L, r, 2, 2, 4, 8));
    if (!taken(name)) return { name, gloss: null };
  }
  return { name: cap(gen(L, r, 3, 3, 5, 10)), gloss: null };
}

/** A family name. Some tongues mark families with a fixed ending or beginning; some houses take a town's name. */
export function houseName(phon: number, lex: number, n: number, town?: string): string {
  const L = language(phon);
  const r = new Rand(lex, NAME_KEY.HOUSE, n, 0x405);
  if (town && town.length <= 9 && r.chance(0.25)) return town;
  const base = gen(L, r, 1, 2, 3, 7);
  const w = L.house === 1 ? glue(L, base, L.hAff) : L.house === 2 ? glue(L, L.hAff, base) : gen(L, r, 2, 3, 4, 9);
  return cap(fine(w, 4, 10) ? w : base);
}

const ORD = ['', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
/** "the Winter War" -> "the Second Winter War" for the second of that name. */
export function ordinal(base: string, earlier: number): string {
  if (earlier <= 0) return base;
  const rest = base.replace(/^the /, '');
  return earlier < ORD.length ? `the ${ORD[earlier]} ${rest}` : `${base} (${earlier + 1})`;
}

const PLAGUE_A = ['Grey', 'Red', 'Black', 'Pale', 'Weeping', 'Burning', 'Sweating', 'Silent', 'Yellow', 'Shaking'];
const PLAGUE_B = ['Cough', 'Fever', 'Pox', 'Rot', 'Sickness', 'Blight', 'Flux', 'Wasting', 'Death', 'Chill'];
/** A plague's name; if the world has seen one by that name, it is known by the town it began in. */
export function plagueName(r: Rand, origin: string, used: (s: string) => number): string {
  const base = `the ${r.pick(PLAGUE_A)} ${r.pick(PLAGUE_B)}`;
  if (!used(base)) return base;
  const local = `${base} of ${origin}`;
  return ordinal(local, used(local));
}

// Great works: each kind with the words that suit it.
const WORKS: [string, string[]][] = [
  ['Steps', ['Painted', 'Thousand', 'Sunken', 'High']],
  ['Spire', ['White', 'High', 'Black', 'Lonely']],
  ['Gate', ['Lion', 'Bronze', 'Red', 'Sun']],
  ['Tomb', ['Painted', 'Sleeping', 'Stone']],
  ['Terraces', ['Hanging', 'Sunken', 'Green']],
  ['Arch', ['Triumphal', 'Moon', 'Great']],
  ['Obelisk', ['Black', 'Red', 'Sun']],
  ['Hall', ['Long', 'Golden', 'Painted']],
  ['Pillars', ['Seven', 'Twin', 'Thousand']],
  ['Barrow', ['Great', 'Kings\'', 'Green']],
  ['Stele', ['Graven', 'Black', 'Great']],
  ['Pool', ['Mirror', 'Sacred', 'Long']],
];
/** A town's great work: "the Spire of Gina" (after the ruler) or "the Painted Steps of Thoi". */
export function monumentName(r: Rand, place: string, ruler: string): string {
  const [noun, adjs] = r.pick(WORKS);
  if (r.chance(0.35)) return `the ${noun} of ${ruler}`;
  return `the ${r.pick(adjs)} ${noun} of ${place}`;
}

const EPITHETS = ['the Wise', 'the Quiet', 'the Bold', 'the Just', 'the Stern', 'the Fair', 'the Patient', 'the Proud', 'the Gentle', 'the Grim', 'the Lucky', 'the Watchful'];
const TRAIT_EPITHET: Record<string, string> = { bold: 'the Bold', cautious: 'the Wary', pious: 'the Pious', greedy: 'the Grasping', wise: 'the Wise', cruel: 'the Cruel', builder: 'the Mason', just: 'the Just' };
/** What a ruler is remembered as, from what their reign did, else their nature. */
export function epithet(r: Rand, reignYears: number, founded: number, built: number, famines: number, won = 0, trait = ''): string {
  if (reignYears < 3) return 'the Brief';
  if (famines >= 4 && famines * 6 > reignYears) return 'the Lean';
  if (won >= 12) return 'the Conqueror';
  if (founded >= 3) return 'the Wayfinder';
  if (built >= 8) return 'the Builder';
  if (reignYears >= 40) return 'the Old';
  if (won >= 5) return 'the Victorious';
  if (trait && r.chance(0.5)) return TRAIT_EPITHET[trait] ?? r.pick(EPITHETS);
  return r.pick(EPITHETS);
}

const FAITH_IDEA = ['Sun', 'Moon', 'Open Sky', 'Flame', 'Seven Stars', 'Deep Sea', 'Mother Earth', 'Inner Light', 'World Tree', 'Turning Wheel', 'Silent Stone', 'Morning Star'];
const IDEA_FORM = [(x: string) => `the Order of the ${x}`, (x: string) => `the Children of the ${x}`, (x: string) => `the Faith of the ${x}`, (x: string) => `the Covenant of the ${x}`];
const SCHISM = ['Reformed', 'Old', 'True', 'Free', 'Inner', 'Pure'];

/**
 * A faith's name: after its prophet, its holy city or what it worships. A schism either takes a
 * new prophet's name or calls itself the "true" or "reformed" form of the faith it left.
 */
export function faithName(phon: number, lex: number, n: number, prophet: string, holy: string, parent: string | null, taken: (s: string) => boolean): string {
  const r = new Rand(lex, NAME_KEY.FAITH, n, 0xfa17);
  const tries: string[] = [];
  if (parent && !SCHISM.some((p) => parent.startsWith(`the ${p} `)) && r.chance(0.6)) tries.push(`the ${r.pick(SCHISM)} ${parent.replace(/^the /, '')}`);
  const x = r.float();
  if (x < 0.4) tries.push(r.pick([`the Way of ${prophet}`, `the Teachings of ${prophet}`, `the Word of ${prophet}`]));
  else if (x < 0.65) tries.push(r.pick([`the Mysteries of ${holy}`, `the ${holy} Rite`]));
  else tries.push(r.pick(IDEA_FORM)(r.pick(FAITH_IDEA)));
  tries.push(`the Way of ${prophet}`, `the Teachings of ${prophet}`, `the Mysteries of ${holy}`);
  for (const t of tries) if (!taken(t)) return t;
  return ordinal(tries[0], 1);
}
