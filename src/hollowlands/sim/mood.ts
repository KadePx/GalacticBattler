// Needs, thoughts and mood: the hourly inner life of a colonist, and what happens when it
// all gets too much (or goes wonderfully well).

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, hourOf, seasonOf, DAYS_PER_SEASON } from '../config';
import { RACES } from './data/races';
import { TH } from './data/thoughts';
import { foodDays, hasFood } from './econ';
import { bump, log, note } from './events';
import { hourlyHealth, pain } from './health';
import { die } from './life';
import { STAGE, has, idleAct, pawnById, per, posAt, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { maybeTalk, opinion } from './social';
import { AX, type Colony, type Id, type Pawn, type Rel } from './types';

export function getRel(p: Pawn, o: Id): Rel {
  return p.rel[o] ?? (p.rel[o] = { m: [] });
}

/** Give someone a thought. Thoughts about another person also shape their opinion of them. */
export function think(c: Colony, p: Pawn, k: string, o?: Id): void {
  const def = TH[k];
  if (!def || def.d <= 0) return;
  let dur = def.d * TICKS_PER_HOUR;
  if (def.op && def.op < 0) dur = Math.round(dur * (has(p, 'vengeful') ? 2 : has(p, 'forgiving') ? 0.5 : 1));
  const x = c.tick + dur;
  if (def.m !== 0) {
    if (def.m < 0 && k.startsWith('died_') && has(p, 'morbid')) return;
    const cur = p.th.find((t) => t.k === k && t.o === o);
    if (cur) {
      cur.x = x;
      cur.n = Math.min(def.st ?? 1, (cur.n ?? 1) + 1);
    } else {
      p.th.push(o ? { k, x, o } : { k, x });
      if (p.th.length > 60) p.th.shift();
    }
  }
  if (def.op && o) {
    const rel = getRel(p, o);
    const cur = rel.m.find((m) => m[0] === k);
    if (cur) {
      cur[1] = x;
      cur[2] = Math.min(def.st ?? 1, cur[2] + 1);
    } else {
      rel.m.push([k, x, 1]);
      if (rel.m.length > 14) {
        let worst = 0;
        for (let i = 1; i < rel.m.length; i++) if (rel.m[i][1] < rel.m[worst][1]) worst = i;
        rel.m.splice(worst, 1);
      }
    }
  }
}

export function forget(p: Pawn, k: string, o?: Id): void {
  p.th = p.th.filter((t) => !(t.k === k && (o === undefined || t.o === o)));
  if (o !== undefined && p.rel[o]) p.rel[o].m = p.rel[o].m.filter((m) => m[0] !== k);
}

export const hasThought = (c: Colony, p: Pawn, k: string): boolean => p.th.some((t) => t.k === k && t.x > c.tick);

/** Stop what they are doing, wherever they have got to. */
export function endNow(c: Colony, p: Pawn): void {
  const a = p.act;
  if (c.tick < a.ta) {
    const i = posAt(c, p, c.tick);
    p.x = i % c.w;
    p.y = Math.floor(i / c.w);
    p.act = idleAct(c, p, 0, 'stopped');
  } else {
    a.t1 = c.tick;
  }
}

/** Is this colonist under a roof right now? */
export function indoors(c: Colony, p: Pawn): boolean {
  const b = c.sb[posAt(c, p, c.tick)];
  if (!b) return false;
  const bld = c.blds.find((x) => x.id === b);
  return !!bld && bld.built && bld.k !== 'field' && bld.k !== 'well' && bld.k !== 'graveyard';
}

export function feltTemp(c: Colony, p: Pawn, inside: boolean): number {
  const h = hourOf(c.tick);
  let t = c.temp + (h < 6 || h >= 21 ? -4 : h >= 11 && h < 16 ? 2 : 0);
  if (inside) t = c.stock.wood > 0 ? Math.max(t + 14, 14) : t + 5;
  else if (c.weather === 3 || c.weather === 4) t -= 3;
  return t + RACES[p.race].cold + (p.cloth > 25 ? 6 : 0);
}

const JOY_ACTS = new Set(['drink', 'relax', 'walk', 'pray', 'dice', 'hobby', 'play', 'visit', 'court', 'perform', 'listen', 'stargaze', 'bathe', 'wed']);

function situ(c: Colony, p: Pawn, st: number, asleep: boolean): void {
  const out: [string, number, number?][] = [];
  const add = (k: string, o?: number): void => {
    const d = TH[k];
    if (d) out.push(o ? [k, d.m, o] : [k, d.m]);
  };
  if (st <= STAGE.CHILD) add('child');
  if (p.food <= 0) add('starving');
  else if (p.food < 10) add('ravenous');
  else if (p.food < 25) add('hungry');
  if (p.rest < 10) add('exhausted');
  else if (p.rest < 25) add('tired');
  if (!has(p, 'ascetic')) {
    if (p.joy < 8) add('joyless');
    else if (p.joy < 25) add('bored');
  }
  if (p.joy > 85) add('merry');
  if (p.soc < 5) add('isolated');
  else if (p.soc < 20 && !has(p, 'loner')) add('lonely');
  else if (p.soc > 80 && !has(p, 'loner')) add('goodcompany');

  if (st >= STAGE.TEEN) {
    if (!p.home) add('nobed');
    else {
      const b = c.blds.find((x) => x.id === p.home);
      if (b) {
        if (p.race !== 'orc' && p.race !== 'goblin' && !has(p, 'gregarious')) {
          for (const id of b.beds) {
            if (!id || id === p.id || id === p.sp) continue;
            const o = pawnById(c, id);
            if (o && o.mo !== p.id && o.fa !== p.id && p.mo !== o.id && p.fa !== o.id && !(p.mo && p.mo === o.mo)) { add('crowded'); break; }
          }
        }
        if (b.q - b.dmg >= 70) add('finehome');
        else if (b.q - b.dmg < 30) add('shabbyhome');
      }
    }
    const days = foodDays(c);
    if (days < 2) add('larderlow');
    else if (days > 15) add('larderfull');
    if (p.race === 'dwarf' && c.stock.ale < 1) add('noale');
    if (p.race === 'halfling' && !hasThought(c, p, 'atefeast') && c.tick > TICKS_PER_DAY * 4) add('nofinefood');
    if (st === STAGE.ELDER) add('oldbones');
    if (p.coin >= 40) add('rich');
    if (c.gov.laws.ration && p.rank < 5) add('rationed');
    if (p.rank >= 5) add('highborn');
    else if (p.rank <= 1) add('outcast');
    else if (p.rank === 2 && per(p, AX.AMBITION) > 1) add('lowly');

    if (p.sp) {
      const o = pawnById(c, p.sp);
      if (o) {
        const op = opinion(c, p, o);
        const k = p.rel[o.id]?.k;
        if (k === 'spouse') {
          if (op >= 25) add('married');
          else if (op < -15) add('badmarriage');
        } else if (op >= 40) add('inlove');
      }
    }
    let friends = 0;
    let rival = 0;
    for (const key in p.rel) {
      const f = p.rel[key].f;
      if (!f) continue;
      if (!pawnById(c, +key)) continue;
      if (f === 1) friends++;
      else if (!rival) rival = +key;
    }
    if (friends >= 2) add('friends');
    else if (!friends && !p.sp && c.pawns.length >= 6 && !has(p, 'loner')) add('alone');
    if (rival) add('rivalnear', rival);
  }
  if (p.phobia) {
    const i = posAt(c, p, c.tick);
    const h = hourOf(c.tick);
    if (p.phobia === 'dark') { if (!asleep && (h >= 21 || h < 5) && !c.sb[i]) add('fear_dark'); }
    else if (p.phobia === 'dead') { const b = c.blds.find((x) => x.id === c.sb[i]); if (b?.k === 'graveyard' || (c.gath?.k === 'funeral' && p.act.k === 'attend')) add('fear_dead'); }
    else if (p.phobia === 'fire') { const b = c.blds.find((x) => x.id === c.sb[i]); if (b?.k === 'smithy' || (p.act.k === 'work' && p.act.w === 'cook')) add('fear_fire'); }
    else if (p.phobia === 'water') { const t = c.ter[i]; if (t === 5 || t === 6 || (p.act.k === 'work' && p.act.w === 'fish') || p.act.k === 'bathe') add('fear_water'); }
    else if (p.phobia === 'birds' && !asleep && !c.sb[i] && (c.tick + p.id * 7) % 170 < 10) think(c, p, 'fear_birds');
  }
  if (p.preg) add('pregnant');
  if (p.cloth < 25) add('ragged');
  if (p.drunk > 30) add('tipsy');
  if (p.insp) add('inspired');
  const ache = pain(p);
  if (ache > 60) add('agony');
  else if (ache > 22) add('hurting');
  if (p.ill) add(p.ill.k === 'pox' ? 'pox' : 'sick');
  else if (st >= STAGE.TEEN && c.pawns.some((o) => o.ill?.k === 'plague')) add('plaguefear');
  if (has(p, 'drunkard') && c.stock.ale < 1 && p.drunk <= 0) add('craving');

  const inside = indoors(c, p);
  const felt = feltTemp(c, p, inside);
  if (felt < -6) add('freezing');
  else if (felt < 3) add('chilly');
  if (!asleep && !inside) {
    const season = seasonOf(c.tick);
    const h = hourOf(c.tick);
    if ((c.weather === 2 || c.weather === 3) && p.race !== 'goblin') add('rain');
    else if (c.weather === 0 && h >= 8 && h < 18 && season < 2) add('sunshine');
  }
  if (st >= STAGE.TEEN) {
    const season = seasonOf(c.tick);
    if (season === 3 && p.race !== 'orc' && p.race !== 'dwarf') add('darkwinter');
    else if (season === 0 && dayOf(c.tick) % DAYS_PER_SEASON < 4) add('springair');
  }
  p.sit = out;
}

export function moodTarget(c: Colony, p: Pawn): number {
  let m = 38 + stat(p, 'moodBase');
  // The same kind of thought about many people only counts for so much
  const byKey: Record<string, number> = {};
  for (const t of p.th) {
    if (t.x <= c.tick) continue;
    const d = TH[t.k];
    if (!d) continue;
    const v = d.m * (1 + 0.5 * Math.min(3, (t.n ?? 1) - 1));
    if (!t.o) { m += v; continue; }
    byKey[t.k] = (byKey[t.k] ?? 0) + v;
  }
  for (const k in byKey) {
    const cap = Math.abs(TH[k].m) * 2;
    const v = byKey[k];
    m += v > cap ? cap : v < -cap ? -cap : v;
  }
  for (const s of p.sit) m += s[1];
  return m < 0 ? 0 : m > 100 ? 100 : m;
}

export function breakLine(p: Pawn): { minor: number; major: number; extreme: number } {
  const s = stat(p, 'breakTh');
  return { minor: 32 + s, major: 18 + s * 0.7, extreme: 6 + s * 0.4 };
}

/** Once an hour for each colonist: needs tick down, thoughts fade, mood shifts, and they may talk. */
export function hourly(c: Colony, p: Pawn): void {
  const t = c.tick;
  const st = stage(c, p);
  const a = p.act;
  const arrived = t >= a.ta;
  const asleep = a.k === 'sleep' && arrived;

  p.food = Math.max(0, p.food - 4.2 * stat(p, 'appetite') * (asleep ? 0.55 : 1) * (st <= STAGE.CHILD ? 0.8 : 1));
  const sl = stat(p, 'sleep');
  if (asleep) {
    const inBed = p.home && c.sb[a.ty * c.w + a.tx] === p.home;
    p.rest = Math.min(100, p.rest + (11.5 / sl) * (inBed ? 1 : 0.72));
  } else p.rest = Math.max(0, p.rest - 5 * sl);
  if (!asleep) {
    if (arrived && JOY_ACTS.has(a.k)) p.joy = Math.min(100, p.joy + 16);
    else if (arrived && a.k === 'attend') p.joy = Math.min(100, p.joy + 8);
    else {
      const loving = a.k === 'work' && arrived ? p.pas[workSkillOf(a.w)] : 0;
      p.joy = Math.max(0, Math.min(100, p.joy + (loving === 2 ? 1.5 : loving === 1 ? 0 : -2.6 * Math.max(0.2, stat(p, 'joyNeed')))));
    }
    p.soc = Math.max(0, p.soc - 2.2 * Math.max(0.15, stat(p, 'socNeed')));
  }
  if (p.drunk > 0) p.drunk = Math.max(0, p.drunk - 12);
  if (p.food <= 0) {
    p.hp -= 1.4;
    bump(c, 'starveHours');
    if (p.hp <= 0) { die(c, p, 'starved'); return; }
  }
  hourlyHealth(c, p);
  if (p.gone) return;

  let stale = false;
  for (const th of p.th) if (th.x <= t) { stale = true; break; }
  if (stale) p.th = p.th.filter((th) => th.x > t);
  if (p.insp && p.insp[1] <= t) p.insp = undefined;

  situ(c, p, st, asleep);
  const target = moodTarget(c, p);
  const d = target - p.mood;
  p.mood += d > 7 ? 7 : d < -7 ? -7 : d;

  if (p.brk && t >= p.brk.x) endBreak(c, p);

  if (st >= STAGE.TEEN && !p.brk) {
    const line = breakLine(p);
    if (p.mood < line.minor) {
      p.low++;
      p.high = 0;
      if (t - p.lastBrk > TICKS_PER_DAY * 2 && !asleep) {
        const r = new Rand(c.seed, S.MOOD, t, p.id);
        const level = p.mood < line.extreme ? 2 : p.mood < line.major ? 1 : 0;
        if (r.chance(level === 2 ? 0.1 : level === 1 ? 0.05 : 0.028)) startBreak(c, p, level, r);
      }
    } else {
      p.low = 0;
      if (p.mood > 84) {
        p.high++;
        if (p.high > 30 && !p.insp && st >= STAGE.ADULT) {
          const r = new Rand(c.seed, S.MOOD, t, p.id, 7);
          if (r.chance(0.004)) {
            const k = r.pick(['frenzy', 'insight', 'muse']);
            p.insp = [k, t + TICKS_PER_DAY * 2];
            p.high = 0;
            log(c, 'inspired', p.id, undefined, k);
            note(c, p, 'inspired', undefined, k);
            bump(c, 'inspirations');
          }
        }
      } else p.high = 0;
    }
  }

  if (!asleep && !p.gone) {
    if (p.food < 10 && a.k !== 'eat' && a.k !== 'binge' && hasFood(c)) endNow(c, p);
    else if (p.rest < 4 && a.k !== 'sleep') endNow(c, p);
    if (st >= STAGE.CHILD) maybeTalk(c, p);
  } else if (asleep && p.rest >= 100) a.t1 = t;
}

const WORK_SKILL: Record<string, number> = { farm: 4, forage: 4, hunt: 1, fish: 9, wood: 2, mine: 3, cook: 5, build: 2, craft: 6, smith: 7, brew: 5, heal: 8, teach: 11, preach: 10, guard: 0, herbs: 8 };
export function workSkillOf(w: string | undefined): number {
  return w ? WORK_SKILL[w] ?? 2 : 2;
}

const BREAKS: { k: string; level: number; hours: number; w: (p: Pawn, c: Colony) => number }[] = [
  { k: 'sulk', level: 0, hours: 8, w: (p) => 3 - per(p, AX.SOCIABLE) },
  { k: 'bingefood', level: 0, hours: 3, w: (p, c) => (hasFood(c) ? (has(p, 'glutton') ? 6 : 1.5) : 0) },
  { k: 'bingedrink', level: 0, hours: 5, w: (p, c) => (c.stock.ale >= 3 && !has(p, 'teetotal') ? (has(p, 'drunkard') ? 8 : 2) : 0) },
  { k: 'wander', level: 0, hours: 10, w: () => 2 },
  { k: 'rave', level: 0, hours: 5, w: (p) => Math.max(0, 1 + per(p, AX.TEMPER) * 2 - per(p, AX.KIND)) },
  { k: 'tantrum', level: 1, hours: 2, w: (p) => Math.max(0.3, 2 + per(p, AX.TEMPER) * 2) },
  { k: 'rave', level: 1, hours: 8, w: (p) => Math.max(0, 1.5 + per(p, AX.TEMPER) * 2 - per(p, AX.KIND)) },
  { k: 'bingedrink', level: 1, hours: 12, w: (p, c) => (c.stock.ale >= 5 && !has(p, 'teetotal') ? 3 : 0) },
  { k: 'wander', level: 1, hours: 30, w: (p) => 2 - per(p, AX.SOCIABLE) * 0.5 },
  { k: 'sulk', level: 1, hours: 20, w: () => 2 },
  { k: 'tantrum', level: 2, hours: 4, w: (p) => Math.max(0.5, 3 + per(p, AX.TEMPER) * 2) },
  { k: 'wander', level: 2, hours: 48, w: () => 3 },
  { k: 'sulk', level: 2, hours: 40, w: () => 3 },
  { k: 'murder', level: 2, hours: 8, w: (p, c) => (hatesSomeone(c, p) ? 1.5 + (has(p, 'vengeful') ? 3 : 0) + (has(p, 'cruel') ? 2 : 0) + (has(p, 'bloodlust') ? 2 : 0) - per(p, AX.KIND) : 0) },
  { k: 'murder', level: 1, hours: 8, w: (p, c) => (has(p, 'vengeful') || has(p, 'bloodlust') || has(p, 'cruel')) && hatesSomeone(c, p) ? 0.8 : 0 },
];

function hatesSomeone(c: Colony, p: Pawn): boolean {
  for (const key in p.rel) {
    const o = pawnById(c, +key);
    if (o && !o.gone && opinion(c, p, o) <= -55) return true;
  }
  return false;
}

export function startBreak(c: Colony, p: Pawn, level: number, r: Rand): void {
  const opts = BREAKS.filter((b) => b.level === level);
  let total = 0;
  const ws = opts.map((b) => { const w = Math.max(0, b.w(p, c)); total += w; return w; });
  if (total <= 0) return;
  let roll = r.float() * total;
  let pick = opts[0];
  for (let i = 0; i < opts.length; i++) {
    roll -= ws[i];
    if (roll <= 0) { pick = opts[i]; break; }
  }
  p.brk = { k: pick.k, x: c.tick + pick.hours * TICKS_PER_HOUR };
  p.lastBrk = c.tick;
  p.low = 0;
  endNow(c, p);
  log(c, 'break', p.id, undefined, pick.k, level);
  note(c, p, 'break', undefined, pick.k);
  bump(c, 'breaks');
  bump(c, 'break_' + pick.k);
}

export function endBreak(c: Colony, p: Pawn): void {
  const k = p.brk?.k;
  p.brk = undefined;
  think(c, p, 'catharsis');
  if (k === 'murder') { forget(p, 'catharsis'); endNow(c, p); return; }
  if ((k === 'tantrum' || k === 'rave') && per(p, AX.KIND) > 0.2) think(c, p, 'ashamed');
  endNow(c, p);
}
