// Bodies: wounds that bleed, fester, heal and scar; sickness that spreads; the slow damage
// of age and drink.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { RACES } from './data/races';
import { bump, log, note } from './events';
import { die } from './life';
import { think } from './mood';
import { STAGE, ageYears, has, posAt, stage, stat } from './pawn';
import { Rand, S } from './rng';
import type { Colony, Pawn } from './types';

const PARTS: [string, number][] = [['head', 8], ['eyeL', 1.2], ['eyeR', 1.2], ['jaw', 2], ['torso', 38], ['armL', 9], ['armR', 9], ['handL', 4], ['handR', 4], ['legL', 10], ['legR', 10], ['footL', 3], ['footR', 3]];
const BLEED: Record<string, number> = { cut: 0.9, bite: 0.7, arrow: 0.7, crush: 0.25, burn: 0, bruise: 0, frost: 0 };

export const PART_NAMES: Record<string, string> = {
  head: 'head', eyeL: 'left eye', eyeR: 'right eye', jaw: 'jaw', torso: 'chest', armL: 'left arm', armR: 'right arm', handL: 'left hand', handR: 'right hand',
  legL: 'left leg', legR: 'right leg', footL: 'left foot', footR: 'right foot',
};

export interface IllDef { k: string; name: string; sev: number; imm: number; spread: number; start: number }
export const ILLS: Record<string, IllDef> = {
  flux: { k: 'flux', name: 'the flux', sev: 1.05, imm: 1.5, spread: 0.01, start: 8 },
  fever: { k: 'fever', name: 'rot fever', sev: 1.45, imm: 1.25, spread: 0, start: 12 },
  plague: { k: 'plague', name: 'the grey plague', sev: 1.45, imm: 0.9, spread: 0.03, start: 5 },
  cough: { k: 'cough', name: 'lung-cough', sev: 0.5, imm: 0.75, spread: 0.012, start: 6 },
  pox: { k: 'pox', name: 'goblin pox', sev: 0.8, imm: 1.3, spread: 0.02, start: 6 },
};

export function pain(p: Pawn): number {
  let v = 0;
  for (const i of p.inj) v += i.sev;
  return v * 0.8 * Math.max(0.3, stat(p, 'pain')) + (p.ill ? p.ill.sev * 0.25 : 0);
}

/** Too hurt or too sick to do anything but lie down. */
export function isDown(p: Pawn): boolean {
  return p.hp < 22 || pain(p) > 80 || (!!p.ill && p.ill.sev > 55);
}

export function needsRest(p: Pawn): boolean {
  return isDown(p) || p.hp < 45 || pain(p) > 40 || (!!p.ill && p.ill.sev > 30);
}

export const needsTending = (p: Pawn, tick: number): boolean => p.inj.some((i) => !i.tend) || (!!p.ill && tick - p.ill.tend > TICKS_PER_DAY);

/** Hurt someone. Severity is before toughness. */
export function wound(c: Colony, p: Pawn, k: string, sev: number, r: Rand): void {
  if (p.gone) return;
  sev = sev / Math.max(0.4, stat(p, 'tough'));
  let total = 0;
  for (const x of PARTS) total += x[1];
  let roll = r.float() * total;
  let part = 'torso';
  for (const x of PARTS) {
    roll -= x[1];
    if (roll <= 0) { part = x[0]; break; }
  }
  if (p.perm.includes('lost_' + part) || p.perm.includes('peg_' + part) || p.perm.includes('hook_' + part)) part = 'torso';
  const cur = p.inj.find((i) => i.p === part && i.k === k);
  if (cur) {
    cur.sev = Math.min(90, cur.sev + sev * 0.8);
    cur.pk = Math.max(cur.pk, cur.sev);
    cur.bleed += (BLEED[k] ?? 0) * (sev / 25);
    cur.tend = 0;
  } else {
    p.inj.push({ p: part, k, sev, pk: sev, bleed: (BLEED[k] ?? 0) * (sev / 25), inf: 0, tend: 0, t: c.tick });
    if (p.inj.length > 8) p.inj.shift();
  }
  p.hp -= sev * 0.7;
  bump(c, 'wounds');
  // A bad enough blow takes the part with it
  const limb = part !== 'torso' && part !== 'head' && part !== 'jaw';
  const eye = part.startsWith('eye');
  if (limb && k !== 'bruise' && sev >= (eye ? 16 : 34) && r.chance(eye ? 0.5 : (sev - 26) / 70)) {
    p.perm.push('lost_' + part);
    p.look.marks.push(part.startsWith('eye') ? 7 : 8);
    think(c, p, p.race === 'orc' ? 'maimedproud' : 'maimed');
    log(c, 'maimed', p.id, undefined, part);
    note(c, p, 'maimed', undefined, part);
    bump(c, 'maimings');
  } else if (part === 'head' && sev >= 40 && r.chance(0.2) && !p.perm.includes('addled')) {
    p.perm.push('addled');
    note(c, p, 'addled');
  }
}

export function infect(c: Colony, p: Pawn, k: string): boolean {
  if (p.ill || p.gone) return false;
  if (k === 'pox' && p.race === 'goblin') return false;
  if (p.perm.includes('had_' + k)) return false;
  p.ill = { k, sev: ILLS[k].start, imm: 0, t: c.tick, tend: -99999 };
  log(c, 'sick', p.id, undefined, k);
  note(c, p, 'sick', undefined, k);
  bump(c, 'sick_' + k);
  return true;
}

/** Once an hour for each colonist: bleeding, festering, mending, sickness. */
export function hourlyHealth(c: Colony, p: Pawn): void {
  const t = c.tick;
  const resting = (p.act.k === 'sleep' || p.act.k === 'rest') && t >= p.act.ta;
  const tough = Math.max(0.4, stat(p, 'tough'));
  const immune = Math.max(0.3, stat(p, 'immune'));
  let hurt = 0;
  let bled = false;
  if (p.inj.length) {
    for (const i of p.inj) {
      if (i.bleed > 0) {
        if (i.tend) i.bleed = 0;
        else {
          p.hp -= i.bleed;
          bled = true;
          i.bleed *= 0.86;
          if (i.bleed < 0.06) i.bleed = 0;
        }
      }
      if (!i.tend && i.k !== 'bruise' && i.k !== 'frost' && t - i.t > TICKS_PER_HOUR * 10) {
        i.inf += 1.5 / immune;
        if (i.inf >= 100) { i.inf = 0; i.tend = 1; infect(c, p, 'fever'); }
      }
      i.sev -= (i.tend ? 0.45 : 0.2) * (resting ? 1.5 : 1) * Math.sqrt(tough);
      hurt += Math.max(0, i.sev);
    }
    if (p.inj.some((i) => i.sev <= 0)) {
      const r = new Rand(c.seed, S.HEALTH, t, p.id);
      for (const i of p.inj) {
        if (i.sev > 0) continue;
        if (i.pk >= 20 && i.k !== 'bruise' && r.chance(0.35)) {
          p.look.marks.push(1 + r.int(6));
          if ((i.p === 'head' || i.p === 'jaw') && !p.perm.includes('scar_face')) { p.perm.push('scar_face'); note(c, p, 'scarred'); }
        }
      }
      p.inj = p.inj.filter((i) => i.sev > 0);
    }
  }
  const cap = 100 - hurt * 0.4;
  if (p.food > 25 && p.hp < cap) p.hp = Math.min(cap, p.hp + 0.5 * tough * (resting ? 2 : 1));

  const ill = p.ill;
  if (ill) {
    const def = ILLS[ill.k];
    const st = stage(c, p);
    const age = st === STAGE.ELDER ? 0.72 : st <= STAGE.CHILD ? 0.85 : 1;
    const tended = t - ill.tend < TICKS_PER_DAY ? 1.3 : 1;
    ill.imm += def.imm * immune * age * (resting ? 1.25 : 1) * tended * (p.food < 15 ? 0.7 : 1);
    ill.sev += def.sev * (ill.imm > 65 ? 0.35 : 1);
    if (ill.imm >= 100) {
      p.ill = undefined;
      if (ill.k === 'plague' || ill.k === 'pox') p.perm.push('had_' + ill.k);
      if (ill.k === 'pox' && !p.perm.includes('scar_face')) { p.perm.push('scar_face'); p.look.marks.push(9); }
      think(c, p, 'recovered');
      log(c, 'recovered', p.id, undefined, ill.k);
    } else if (ill.sev >= 100) {
      die(c, p, 'sick_' + ill.k);
      return;
    } else if (def.spread > 0) {
      const r = new Rand(c.seed, S.HEALTH, t, p.id, 3);
      const pi = posAt(c, p, t);
      const px = pi % c.w;
      const py = Math.floor(pi / c.w);
      for (const o of c.pawns) {
        if (o === p || o.ill || o.gone) continue;
        const oi = posAt(c, o, t);
        const near = Math.abs((oi % c.w) - px) <= 2 && Math.abs(Math.floor(oi / c.w) - py) <= 2;
        if (!near) continue;
        if (r.chance(def.spread / Math.max(0.3, stat(o, 'immune')))) infect(c, o, ill.k);
      }
    }
  }
  if (p.hp <= 0 && !p.gone) die(c, p, bled ? 'bled' : 'wounds');
}

/** Once a day: the body keeps its own slow accounts. */
export function dailyHealth(c: Colony, p: Pawn): void {
  const st = stage(c, p);
  const r = new Rand(c.seed, S.HEALTH, c.tick, p.id, 5);
  // Drink catches up with people
  p.booze = Math.max(0, p.booze * 0.9 - 0.3);
  if (p.booze > 16 && !has(p, 'drunkard') && !has(p, 'teetotal') && r.chance(0.04)) {
    p.traits = p.traits.filter((x) => x !== 'ascetic');
    p.traits.push('drunkard');
    log(c, 'drunkard', p.id);
    note(c, p, 'drunkard');
  }
  if (st === STAGE.ELDER) {
    const R = RACES[p.race];
    const f = (ageYears(c, p) - R.old) / (R.max - R.old);
    if (r.chance(0.002 + f * 0.012)) {
      const k = r.pick(['bad_back', 'frail_bones', 'cataracts', 'cough']);
      if (!p.perm.includes(k)) { p.perm.push(k); note(c, p, 'ailment', undefined, k); }
    }
  }
  // Winter air gets into the chest
  if (c.temp < 0 && !p.ill && r.chance((st === STAGE.ELDER ? 0.006 : 0.0015) / Math.max(0.3, stat(p, 'immune')) * (p.cloth < 25 ? 2.5 : 1))) infect(c, p, 'cough');
}

/** A healer (or whoever is willing) sees to a patient. */
export function tend(c: Colony, healer: Pawn, patient: Pawn, r: Rand): void {
  const lv = healer.sk[8];
  let aid = 0;
  if (c.stock.medicine >= 1) { c.stock.medicine -= 1; aid = 2; }
  else if (c.stock.herbs >= 1) { c.stock.herbs -= 1; aid = 1; }
  for (const i of patient.inj) {
    if (i.tend) continue;
    i.tend = 1;
    i.bleed = 0;
    i.inf = Math.max(0, i.inf - 25 - lv * 5 - aid * 15);
    if (lv < 3 && !aid && r.chance(0.25)) i.inf += 30; // dirty hands
  }
  if (patient.ill) {
    patient.ill.tend = c.tick;
    patient.ill.imm += 2 + lv * 0.5 + aid * 3;
  }
  if (patient !== healer) {
    think(c, patient, 'tended', healer.id);
    think(c, healer, 'gavecomfort', patient.id);
  }
  bump(c, 'tendings');
}
