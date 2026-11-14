// A player makes a colonist. The same rules run in the creator screen (to show the budget and
// what is allowed) and on the server (to refuse anything that breaks them).

import { TICKS_PER_YEAR } from '../config';
import { ADULTHOODS, BACKS, CHILDHOODS } from './data/backstories';
import { PLAYABLE, RACES } from './data/races';
import { TRAITS, traitsClash } from './data/traits';
import { FAITHS } from './faith';
import { mkAct, normPawn } from './pawn';
import { AX_N, SKILLS, type Colony, type Look, type Pawn, type RaceK } from './types';

/** How many choices each part of a face has. */
export const LOOK_RANGE = { skin: 6, hair: 10, hairCol: 8, body: 5, face: 6, eyes: 6, beard: 5, garb: 8 } as const;

export const GOALS: Record<string, string> = {
  love: 'Marry for love', dynasty: 'Found a dynasty', rule: 'Rule the colony', craft: 'Master a craft', faith: 'Find faith', rich: 'Get rich',
  wander: 'See the world', protect: 'Protect the weak', build: 'Build something that lasts', remembered: 'Be remembered',
};

export const PHOBIAS: Record<string, string> = { fire: 'Fire', water: 'Deep water', dark: 'The dark', dead: 'The dead', birds: 'Birds' };

export const SECRETS: Record<string, { name: string; blurb: string }> = {
  deserter: { name: 'Deserter', blurb: 'Walked away from an army. There is a price on their head somewhere.' },
  killer: { name: 'Blood on their hands', blurb: 'Killed someone back home, and nobody here knows.' },
  cultist: { name: 'Secret cultist', blurb: 'Prays to the Hollow Mother when nobody is looking.' },
  noble: { name: 'Hidden birth', blurb: 'Born to a great house, and hiding from it.' },
  thief: { name: 'Wanted thief', blurb: 'Robbed the wrong person and ran.' },
  bigamist: { name: 'Left a family', blurb: 'There is a spouse and children somewhere who think they are dead.' },
};

/**
 * One pool of points for every new colonist. Good traits and rich backstories cost; flaws, a
 * fear and a secret give points back; skill points past the free ones cost one each.
 */
export const BUDGET = 15;
/** Each unit of a trait's or backstory's listed price is worth this many points. */
export const PT = 3;
/** Skill points that cost nothing. */
export const FREE_SKILL = 6;
export const MAX_TRAITS = 4;
export const MIN_TRAITS = 2;

export interface PawnSpec {
  first: string; fam: string; epi?: string;
  race: RaceK; sex: 0 | 1;
  /** age in game years; must be an adult who is not yet old */
  age: number;
  look: Look;
  bc: string; ba: string;
  traits: string[];
  /** points added to each skill */
  sk: number[];
  /** up to three passions: 0 none, 1 interested, 2 burning (one burning at most) */
  pas: number[];
  faith: string;
  /** devotion 0..3 */
  dev: number;
  goal: string;
  /** 0 the other sex, 1 both, 2 the same sex */
  orient: 0 | 1 | 2;
  phobia?: string;
  secret?: string;
  /** a short name for a keepsake, e.g. "grandmother's dagger" */
  heirloom?: string;
}

export interface SpecCheck { ok: boolean; errors: string[]; spent: number; budget: number; skillSpent: number }

/** Starting skill levels before the player's own points: people, backstories and years lived. */
export function baseSkills(spec: Pick<PawnSpec, 'race' | 'age' | 'bc' | 'ba'>): number[] {
  const R = RACES[spec.race];
  const span = Math.max(0, Math.min(1, (spec.age - R.adult) / (R.old - R.adult)));
  return SKILLS.map((name) => {
    const fromLife = (BACKS[spec.bc]?.sk[name] ?? 0) + (BACKS[spec.ba]?.sk[name] ?? 0);
    const v = 1 + (R.sk[name] ?? 0) + fromLife + (fromLife > 0 ? Math.round(span * 3) : Math.round(span));
    return Math.max(0, Math.min(14, v));
  });
}

export function checkSpec(spec: PawnSpec): SpecCheck {
  const errors: string[] = [];
  const R = RACES[spec.race];
  if (!R || !PLAYABLE.includes(spec.race)) errors.push('Pick one of the six peoples.');
  else if (!(spec.age >= R.adult && spec.age <= R.old * 0.9)) errors.push(`A new arrival must be a grown ${R.name.toLowerCase()} (${R.adult} to ${Math.floor(R.old * 0.9)}).`);
  const child = CHILDHOODS.find((b) => b.k === spec.bc);
  const adult = ADULTHOODS.find((b) => b.k === spec.ba);
  if (!child || (child.races && !child.races.includes(spec.race))) errors.push('Pick a childhood.');
  if (!adult || (adult.races && !adult.races.includes(spec.race))) errors.push('Pick an adult life.');
  const traits = spec.traits ?? [];
  if (traits.length < MIN_TRAITS || traits.length > MAX_TRAITS) errors.push(`Pick ${MIN_TRAITS} to ${MAX_TRAITS} traits.`);
  let spent = ((child?.pts ?? 0) + (adult?.pts ?? 0)) * PT;
  traits.forEach((k, i) => {
    const t = TRAITS[k];
    if (!t) { errors.push('Unknown trait.'); return; }
    spent += t.pts * PT;
    for (let j = 0; j < i; j++) if (traitsClash(k, traits[j])) errors.push(`${t.name} cannot go with ${TRAITS[traits[j]]?.name ?? traits[j]}.`);
    for (const b of [child, adult]) if (b?.trait && b.trait !== k && traitsClash(k, b.trait)) errors.push(`${t.name} does not fit a ${b.name.toLowerCase()}.`);
  });
  let skillSpent = 0;
  const base = R && child && adult ? baseSkills(spec) : SKILLS.map(() => 0);
  if (!Array.isArray(spec.sk) || spec.sk.length !== SKILLS.length) errors.push('Bad skills.');
  else spec.sk.forEach((v, i) => {
    if (!(v >= 0 && v <= 4) || Math.floor(v) !== v) errors.push('Bad skills.');
    else { skillSpent += v; if (base[i] + v > 14) errors.push('No skill can start above 14.'); }
  });
  if (skillSpent > FREE_SKILL) spent += skillSpent - FREE_SKILL;
  let pasN = 0;
  let burning = 0;
  if (!Array.isArray(spec.pas) || spec.pas.length !== SKILLS.length) errors.push('Bad passions.');
  else for (const v of spec.pas) { if (v === 1 || v === 2) pasN++; else if (v !== 0) errors.push('Bad passions.'); if (v === 2) burning++; }
  if (pasN > 3) errors.push('Pick up to three passions.');
  if (burning > 1) errors.push('Only one passion can burn.');
  if (!FAITHS[spec.faith] || FAITHS[spec.faith].cult) errors.push('Pick a faith.');
  if (!(spec.dev >= 0 && spec.dev <= 3)) errors.push('Bad devotion.');
  if (!GOALS[spec.goal]) errors.push('Pick a life goal.');
  if (spec.phobia) { if (!PHOBIAS[spec.phobia]) errors.push('Unknown fear.'); else spent -= PT; }
  if (spec.secret) { if (!SECRETS[spec.secret]) errors.push('Unknown secret.'); else spent -= PT; }
  const L = spec.look;
  if (!L) errors.push('Bad looks.');
  else for (const k of Object.keys(LOOK_RANGE) as (keyof typeof LOOK_RANGE)[]) if (!(L[k] >= 0 && L[k] < LOOK_RANGE[k]) || Math.floor(L[k]) !== L[k]) errors.push('Bad looks.');
  if (L && (!Array.isArray(L.marks) || L.marks.length > 3 || L.marks.some((m) => !(m >= 1 && m <= 6)))) errors.push('Bad looks.');
  const name = /^[\p{L}][\p{L}'-]{1,15}$/u;
  if (!name.test(spec.first ?? '')) errors.push('Give them a first name (2 to 16 letters).');
  if (!name.test(spec.fam ?? '')) errors.push('Give them a family name (2 to 16 letters).');
  if (spec.epi && !/^[\p{L}][\p{L}' -]{2,23}$/u.test(spec.epi)) errors.push('The epithet must be 3 to 24 letters.');
  if (spec.heirloom && !/^[\p{L}][\p{L}' -]{2,31}$/u.test(spec.heirloom)) errors.push('The keepsake must be 3 to 32 letters.');
  if (spent > BUDGET) errors.push(`${spent - BUDGET} ${spent - BUDGET === 1 ? 'point' : 'points'} over. Drop a strength or a skill point, or take a flaw.`);
  return { ok: errors.length === 0, errors: [...new Set(errors)], spent, budget: BUDGET, skillSpent };
}

/** Build the colonist a (valid) spec describes. Call checkSpec first. */
export function pawnFromSpec(c: Colony, spec: PawnSpec, owner: string): Pawn {
  const base = baseSkills(spec);
  let traits = spec.traits.slice();
  for (const key of [spec.bc, spec.ba]) {
    const forced = BACKS[key]?.trait;
    if (forced && !traits.includes(forced)) traits = [forced, ...traits.filter((t) => !traitsClash(t, forced))];
  }
  // Personality axes start level: for a player's colonist, traits and backstory say it all
  const per: number[] = [];
  for (let k = 0; k < AX_N; k++) per.push(0);
  const p: Pawn = {
    id: c.nextId++, first: spec.first, fam: spec.fam, epi: spec.epi || undefined, race: spec.race, sex: spec.sex,
    born: c.tick - Math.round(spec.age * TICKS_PER_YEAR),
    look: { skin: spec.look.skin, hair: spec.look.hair, hairCol: spec.look.hairCol, body: spec.look.body, face: spec.look.face, eyes: spec.look.eyes, beard: spec.look.beard, marks: spec.look.marks.slice(), garb: spec.look.garb },
    traits, bc: spec.bc, ba: spec.ba,
    sk: base.map((v, i) => Math.min(14, v + spec.sk[i])), pas: spec.pas.slice(), per,
    orient: spec.orient, x: c.gx, y: c.gy, act: mkAct('idle', c.tick, c.gx, c.gy, 1, 'new'),
    food: 70, rest: 70, joy: 60, soc: 50, mood: 55, th: [], sit: [], rel: {}, mo: 0, fa: 0, sp: 0, crush: 0, home: 0, prof: '', rank: 2,
    faith: spec.faith, dev: spec.dev, goal: spec.goal, hp: 100, low: 0, high: 0, drunk: 0, cloth: 100, lastBrk: -99999,
    know: [], bio: [], coin: 8, inj: [], perm: [], booze: 0,
    owner, res: 2, resT: c.tick, phobia: spec.phobia || undefined, secret: spec.secret || undefined, heirloom: spec.heirloom || undefined,
  };
  return normPawn(p);
}
