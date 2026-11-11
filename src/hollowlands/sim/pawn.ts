// Making colonists and reading them: age, life stage, stats, personality.

import { TICKS_PER_YEAR } from '../config';
import { ADULTHOODS, BACKS, CHILDHOODS } from './data/backstories';
import { RACES } from './data/races';
import { TRAITS, TRAIT_LIST, traitsClash, type StatK } from './data/traits';
import { familyName, givenName } from './names';
import type { Rand } from './rng';
import { AX, AX_N, SKILLS, type Act, type Colony, type Dead, type Id, type Pawn, type RaceK } from './types';

export const STAGE = { BABY: 0, CHILD: 1, TEEN: 2, ADULT: 3, ELDER: 4 } as const;

export const ageYears = (c: Colony, p: { born: number }): number => (c.tick - p.born) / TICKS_PER_YEAR;

export function stage(c: Colony, p: Pawn): number {
  const R = RACES[p.race];
  const a = ageYears(c, p);
  if (a >= R.old) return STAGE.ELDER;
  if (a >= R.adult) return STAGE.ADULT;
  if (a >= R.adult * 0.65) return STAGE.TEEN;
  if (a >= R.adult * 0.2) return STAGE.CHILD;
  return STAGE.BABY;
}

export const has = (p: { traits: string[] }, k: string): boolean => p.traits.includes(k);

const BASE: Record<StatK, number> = { work: 1, learn: 1, move: 1, appetite: 1, sleep: 1, moodBase: 0, breakTh: 0, charm: 0, beauty: 0, tough: 1, immune: 1, joyNeed: 1, socNeed: 1, pain: 1 };

export function stat(p: Pawn, k: StatK): number {
  const R = RACES[p.race];
  let v = BASE[k];
  if (k === 'move') v = R.speed;
  else if (k === 'appetite') v = R.appetite;
  else if (k === 'sleep') v = R.sleep;
  else if (k === 'tough') v = R.tough;
  for (const t of p.traits) {
    const m = TRAITS[t]?.st?.[k];
    if (m) v += m;
  }
  if (k === 'charm') v += p.sk[10] * 0.25;
  return v;
}

/** Personality on one axis, roughly -2..2. */
export function per(p: Pawn, ax: number): number {
  let v = p.per[ax];
  for (const t of p.traits) {
    const list = TRAITS[t]?.per;
    if (list) for (const [a, d] of list) if (a === ax) v += d;
  }
  for (const [a, d] of RACES[p.race].per) if (a === ax) v += d;
  for (const key of [p.bc, p.ba]) {
    const list = BACKS[key]?.per;
    if (list) for (const [a, d] of list) if (a === ax) v += d;
  }
  return v < -2 ? -2 : v > 2 ? 2 : v;
}

export const fullName = (p: { first: string; fam: string; epi?: string }): string => (p.epi ? `${p.first} ${p.fam} ${p.epi}` : `${p.first} ${p.fam}`);

export function pawnById(c: Colony, id: Id): Pawn | undefined {
  for (const p of c.pawns) if (p.id === id) return p;
  return undefined;
}

/** Anyone the colony has known, living or dead. */
export function person(c: Colony, id: Id): Pawn | Dead | undefined {
  if (!id) return undefined;
  return pawnById(c, id) ?? c.dead.find((d) => d.id === id);
}

export function nameOf(c: Colony, id: Id | undefined): string {
  const p = id ? person(c, id) : undefined;
  return p ? p.first : 'someone';
}

/** The tile a colonist is on at tick t (part-way along their path if still walking). */
export function posAt(c: Colony, p: Pawn, t: number): number {
  const a = p.act;
  if (!a.path || a.path.length < 2 || t >= a.ta) return a.ty * c.w + a.tx;
  if (t <= a.t0) return a.path[0];
  const f = (t - a.t0) / (a.ta - a.t0);
  return a.path[Math.min(a.path.length - 1, Math.floor(f * (a.path.length - 1)))];
}

export function idleAct(c: Colony, p: { x: number; y: number }, ticks = 1, why = 'idle'): Act {
  return { k: 'idle', t0: c.tick, ta: c.tick, t1: c.tick + ticks, sx: p.x, sy: p.y, tx: p.x, ty: p.y, why };
}

export function skillLevel(p: Pawn, s: number): number {
  return Math.floor(p.sk[s]);
}

/** Learn by doing. Passion makes all the difference; high levels come slowly. */
export function gainXp(p: Pawn, s: number, hours: number): void {
  const pm = p.pas[s] === 2 ? 1.6 : p.pas[s] === 1 ? 1 : 0.3;
  let learn = stat(p, 'learn');
  if (p.insp && p.insp[0] === 'insight') learn *= 3;
  const lv = p.sk[s];
  p.sk[s] = Math.min(20, lv + (0.007 * hours * learn * pm) / (1 + lv * 0.3));
}

export interface MakeOpts { race?: RaceK; age?: number; sex?: 0 | 1; fam?: string; mo?: Id; fa?: Id; first?: string }

const GOALS = ['love', 'dynasty', 'rule', 'craft', 'faith', 'rich', 'wander', 'protect', 'build', 'remembered'];

export function rollTraits(r: Rand, n: number, have: string[] = []): string[] {
  const out = have.slice();
  let guard = 0;
  while (out.length < n && guard++ < 60) {
    let total = 0;
    for (const t of TRAIT_LIST) total += t.w ?? 1;
    let roll = r.float() * total;
    let pick = TRAIT_LIST[0];
    for (const t of TRAIT_LIST) {
      roll -= t.w ?? 1;
      if (roll <= 0) { pick = t; break; }
    }
    if (out.some((k) => traitsClash(k, pick.k))) continue;
    out.push(pick.k);
  }
  return out;
}

export function rollPassions(r: Rand, sk: number[], n: number): number[] {
  const pas = new Array<number>(SKILLS.length).fill(0);
  for (let k = 0; k < n; k++) {
    let total = 0;
    for (let s = 0; s < sk.length; s++) if (!pas[s]) total += 2 + sk[s];
    let roll = r.float() * total;
    for (let s = 0; s < sk.length; s++) {
      if (pas[s]) continue;
      roll -= 2 + sk[s];
      if (roll <= 0) { pas[s] = r.chance(0.3) ? 2 : 1; break; }
    }
  }
  return pas;
}

export function makePawn(c: Colony, r: Rand, o: MakeOpts = {}): Pawn {
  const race = o.race ?? 'human';
  const R = RACES[race];
  const sex = o.sex ?? (r.chance(0.5) ? 0 : 1);
  const u = r.float();
  const age = o.age ?? R.adult + (R.old * 0.92 - R.adult) * u * u * 0.9 + r.float() * 2;
  const adult = age >= R.adult;
  const per: number[] = [];
  for (let k = 0; k < AX_N; k++) per.push(Math.round((r.float() + r.float() - 1) * 100) / 100);

  const kids = CHILDHOODS.filter((b) => !b.races || b.races.includes(race));
  const grown = ADULTHOODS.filter((b) => !b.races || b.races.includes(race));
  const bc = adult || age >= R.adult * 0.5 ? r.pick(kids).k : '';
  const ba = adult ? r.pick(grown).k : '';

  const sk: number[] = [];
  const span = Math.min(1, Math.max(0, (age - R.adult) / (R.old - R.adult)));
  for (let s = 0; s < SKILLS.length; s++) {
    const name = SKILLS[s];
    let v = adult ? r.int(4) + r.int(3) * span * 2 : r.int(2) * (age / R.adult);
    v += (R.sk[name] ?? 0) * (adult ? 1 : 0.4);
    v += BACKS[bc]?.sk[name] ?? 0;
    v += BACKS[ba]?.sk[name] ?? 0;
    sk.push(Math.max(0, Math.min(18, Math.round(v * 10) / 10)));
  }
  let traits = rollTraits(r, adult ? (r.chance(0.45) ? 3 : 2) : 1);
  for (const key of [bc, ba]) {
    const forced = BACKS[key]?.trait;
    if (forced && !traits.includes(forced)) traits = [forced, ...traits.filter((t) => !traitsClash(t, forced))];
  }
  const piety = per[AX.PIETY] + (traits.includes('pious') ? 1.5 : traits.includes('skeptic') ? -1.6 : 0);
  const beardy = sex === 1 ? (race === 'dwarf' ? 1 + r.int(4) : race === 'elf' || race === 'goblin' ? 0 : r.int(5)) : 0;
  const p: Pawn = {
    id: c.nextId++,
    first: o.first ?? givenName(r, race, sex),
    fam: o.fam ?? familyName(r, race),
    race, sex,
    born: c.tick - Math.round(age * TICKS_PER_YEAR) - r.int(TICKS_PER_YEAR),
    look: { skin: r.int(6), hair: r.int(10), hairCol: age > R.old * 0.8 ? 7 : r.int(7), body: Math.min(4, Math.floor((r.float() + r.float()) * 2.5)), face: r.int(6), eyes: r.int(6), beard: beardy, marks: [], garb: r.int(8) },
    traits, bc, ba, sk,
    pas: adult ? rollPassions(r, sk, 2 + r.int(3)) : new Array<number>(SKILLS.length).fill(0),
    per,
    orient: r.chance(0.82) ? 0 : r.chance(0.6) ? 1 : 2,
    x: c.cx, y: c.cy,
    act: { k: 'idle', t0: c.tick, ta: c.tick, t1: c.tick + 1 + r.int(8), sx: c.cx, sy: c.cy, tx: c.cx, ty: c.cy, why: 'new' },
    food: 60 + r.int(35), rest: 60 + r.int(35), joy: 50 + r.int(30), soc: 50 + r.int(30),
    mood: 55,
    th: [], sit: [], rel: {},
    mo: o.mo ?? 0, fa: o.fa ?? 0, sp: 0, crush: 0, home: 0,
    prof: '',
    faith: r.pick(R.faiths),
    dev: piety > 1 ? 3 : piety > 0.2 ? 2 : piety > -0.8 ? 1 : 0,
    goal: r.pick(GOALS),
    hp: 100, low: 0, high: 0, drunk: 0, cloth: 60 + r.int(40), lastBrk: -99999,
    know: [], bio: [], coin: adult ? r.int(12) : 0,
  };
  if (r.chance(0.12) && adult) p.look.marks.push(1 + r.int(6));
  return p;
}

/** Turn a living colonist into a record of the dead (or departed). */
export function toDead(c: Colony, p: Pawn, cause: string, by?: Id, left = false): Dead {
  return {
    id: p.id, first: p.first, fam: p.fam, epi: p.epi, race: p.race, sex: p.sex, born: p.born, died: c.tick, cause, by,
    look: p.look, traits: p.traits, bc: p.bc, ba: p.ba, prof: p.prof, mo: p.mo, fa: p.fa, sp: p.sp, bio: p.bio, grave: -1, left: left || undefined, owner: p.owner, faith: p.faith,
  };
}
