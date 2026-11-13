// Making colonists and reading them: age, life stage, stats, personality.

import { TICKS_PER_YEAR } from '../config';
import { ADULTHOODS, BACKS, CHILDHOODS } from './data/backstories';
import { RACES } from './data/races';
import { TRAITS, TRAIT_LIST, traitsClash, type StatK } from './data/traits';
import { familyName, givenName } from './names';
import type { Rand } from './rng';
import { AX, AX_N, SKILLS, type Act, type ActK, type Colony, type Dead, type Id, type Pawn, type RaceK } from './types';

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

// The parts of stats and personality that come from traits, people, backstory and lasting
// marks only change when those do, so they are worked out once and kept (never saved).
interface Fixed { traits: string[]; tn: number; pn: number; bc: string; ba: string; base: number[]; st: Partial<Record<StatK, number>>; ax: number[] }
const fixed = new WeakMap<Pawn, Fixed>();
const STAT_KEYS = Object.keys(BASE) as StatK[];

function fixedOf(p: Pawn): Fixed {
  let f = fixed.get(p);
  if (f && f.traits === p.traits && f.tn === p.traits.length && f.pn === p.perm.length && f.base === p.per && f.bc === p.bc && f.ba === p.ba) return f;
  const R = RACES[p.race];
  const st: Partial<Record<StatK, number>> = {};
  for (const k of STAT_KEYS) {
    let v = BASE[k];
    if (k === 'move') v = R.speed;
    else if (k === 'appetite') v = R.appetite;
    else if (k === 'sleep') v = R.sleep;
    else if (k === 'tough') v = R.tough;
    for (const t of p.traits) {
      const m = TRAITS[t]?.st?.[k];
      if (m) v += m;
    }
    for (const m of p.perm) {
      const e = PERM[m.replace(/[LR]$/, '')];
      if (e && e[k]) v += e[k]!;
    }
    st[k] = v;
  }
  const ax: number[] = [];
  for (let a = 0; a < AX_N; a++) {
    let v = p.per[a];
    for (const t of p.traits) {
      const list = TRAITS[t]?.per;
      if (list) for (const [x, d] of list) if (x === a) v += d;
    }
    for (const [x, d] of R.per) if (x === a) v += d;
    for (const key of [p.bc, p.ba]) {
      const list = BACKS[key]?.per;
      if (list) for (const [x, d] of list) if (x === a) v += d;
    }
    ax.push(v < -2 ? -2 : v > 2 ? 2 : v);
  }
  f = { traits: p.traits, tn: p.traits.length, pn: p.perm.length, bc: p.bc, ba: p.ba, base: p.per, st, ax };
  fixed.set(p, f);
  return f;
}

export function stat(p: Pawn, k: StatK): number {
  let v = fixedOf(p).st[k]!;
  if (k === 'charm') v += p.sk[10] * 0.25;
  if (k === 'work' || k === 'move') {
    if (p.ill) v *= 1 - Math.min(0.6, p.ill.sev / 140);
    let pain = 0;
    for (const i of p.inj) pain += i.sev;
    if (pain > 15) v *= 1 - Math.min(0.6, (pain - 15) / 120);
    if (v < 0.15) v = 0.15;
  }
  return v;
}

/** Personality on one axis, roughly -2..2. */
export function per(p: Pawn, ax: number): number {
  return fixedOf(p).ax[ax];
}

/** What lasting marks do to a body. */
export const PERM: Record<string, Partial<Record<StatK, number>>> = {
  lost_hand: { work: -0.25 }, hook_hand: { work: -0.1 }, lost_arm: { work: -0.4 },
  lost_leg: { move: -0.45, work: -0.1 }, peg_leg: { move: -0.18 }, lost_foot: { move: -0.3 }, peg_foot: { move: -0.1 },
  lost_eye: { beauty: -0.5 }, scar_face: { beauty: -0.5 }, lost_jaw: { beauty: -1, charm: -2 },
  bad_back: { work: -0.15, move: -0.05 }, frail_bones: { tough: -0.25 }, addled: { learn: -0.35 }, cough: { work: -0.08 }, cataracts: { work: -0.08 },
};

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

/** An action on the spot. Every action is made with the same set of fields, in the same order, which keeps the engine fast. */
export function mkAct(k: ActK, t: number, x: number, y: number, dur: number, why: string): Act {
  return { k, t0: t, ta: t, t1: t + dur, sx: x, sy: y, tx: x, ty: y, path: undefined, w: undefined, b: undefined, o: undefined, d: undefined, why };
}

export function idleAct(c: Colony, p: { x: number; y: number }, ticks = 1, why = 'idle'): Act {
  return mkAct('idle', c.tick, p.x, p.y, ticks, why);
}

/** Rebuild a colonist with every field present in a fixed order (after loading, or when first made). */
export function normPawn(p: Pawn): Pawn {
  const a = p.act;
  return {
    id: p.id, first: p.first, fam: p.fam, epi: p.epi, race: p.race, sex: p.sex, born: p.born, look: p.look, traits: p.traits, bc: p.bc, ba: p.ba, sk: p.sk, pas: p.pas, per: p.per,
    orient: p.orient, x: p.x, y: p.y,
    act: { k: a.k, t0: a.t0, ta: a.ta, t1: a.t1, sx: a.sx, sy: a.sy, tx: a.tx, ty: a.ty, path: a.path, w: a.w, b: a.b, o: a.o, d: a.d, why: a.why },
    food: p.food, rest: p.rest, joy: p.joy, soc: p.soc, mood: p.mood, th: p.th, sit: p.sit, rel: p.rel, mo: p.mo, fa: p.fa, sp: p.sp, crush: p.crush, home: p.home, prof: p.prof, rank: p.rank,
    faith: p.faith, dev: p.dev, goal: p.goal, hp: p.hp, brk: p.brk, low: p.low, high: p.high, drunk: p.drunk, cloth: p.cloth, lastBrk: p.lastBrk, preg: p.preg, know: p.know, bio: p.bio,
    owner: p.owner, coin: p.coin, insp: p.insp, say: p.say, inj: p.inj, perm: p.perm, ill: p.ill, booze: p.booze, phobia: p.phobia, secret: p.secret, heirloom: p.heirloom, res: p.res, resT: p.resT, urge: p.urge, focus: p.focus, prev: p.prev, gone: p.gone,
  };
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
    act: mkAct('idle', c.tick, c.cx, c.cy, 1 + r.int(8), 'new'),
    food: 60 + r.int(35), rest: 60 + r.int(35), joy: 50 + r.int(30), soc: 50 + r.int(30),
    mood: 55,
    th: [], sit: [], rel: {},
    mo: o.mo ?? 0, fa: o.fa ?? 0, sp: 0, crush: 0, home: 0,
    prof: '', rank: 2,
    faith: r.pick(R.faiths),
    dev: piety > 1 ? 3 : piety > 0.2 ? 2 : piety > -0.8 ? 1 : 0,
    goal: r.pick(GOALS),
    hp: 100, low: 0, high: 0, drunk: 0, cloth: 60 + r.int(40), lastBrk: -99999,
    know: [], bio: [], coin: adult ? r.int(12) : 0, inj: [], perm: [], booze: 0,
  };
  if (r.chance(0.12) && adult) p.look.marks.push(1 + r.int(6));
  return normPawn(p);
}

/** Turn a living colonist into a record of the dead (or departed). */
export function toDead(c: Colony, p: Pawn, cause: string, by?: Id, left = false): Dead {
  return {
    id: p.id, first: p.first, fam: p.fam, epi: p.epi, race: p.race, sex: p.sex, born: p.born, died: c.tick, cause, by,
    look: p.look, traits: p.traits, bc: p.bc, ba: p.ba, prof: p.prof, mo: p.mo, fa: p.fa, sp: p.sp, bio: p.bio, grave: -1, left: left || undefined, owner: p.owner, faith: p.faith, rank: p.rank, prev: p.prev,
  };
}
