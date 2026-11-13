// How colonists see each other and what passes between them: talk, jokes, insults, comfort,
// gossip, flirting, brawls. Every exchange leaves memories on both sides, and those memories
// are what opinions are made of.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { RACES, raceView } from './data/races';
import { TH } from './data/thoughts';
import { bump, factById, log, note } from './events';
import { becomeLovers, closeKin, die, propose, tryConceive } from './life';
import { getRel, think } from './mood';
import { STAGE, ageYears, has, pawnById, per, posAt, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { AX, SKILLS, type Colony, type Fact, type Id, type Pawn } from './types';

/** What p thinks of o, -100..100. Pass parts to get the breakdown for the UI. */
export function opinion(c: Colony, p: Pawn, o: Pawn, parts?: [string, number][]): number {
  let v = 0;
  const add = (k: string, n: number): void => {
    if (!n) return;
    v += n;
    if (parts) parts.push([k, Math.round(n)]);
  };
  let rv = raceView(p.race, o.race);
  if (has(p, 'bigot')) rv = p.race === o.race ? 10 : Math.min(-10, rv * 2.2 - 6);
  else if (has(p, 'openminded')) rv = rv < 0 ? rv * 0.15 : rv;
  add(p.race === o.race ? 'Same people' : 'Their kind', rv);
  if (o.mo === p.id || o.fa === p.id) add('My child', 32);
  else if (p.mo === o.id || p.fa === o.id) add('My parent', 24);
  else if ((p.mo && p.mo === o.mo) || (p.fa && p.fa === o.fa)) add('My sibling', 16);
  add('Looks', stat(o, 'beauty') * 5);
  add('Charm', Math.min(8, stat(o, 'charm') * 1.3));
  add('Kindness', per(o, AX.KIND) * 3);
  add('Temper', -Math.max(0, per(o, AX.TEMPER)) * 2.5);
  if (p.faith === o.faith) add('Shared faith', p.dev >= 2 ? 7 : 3);
  else if (p.dev >= 2) add('Different faith', p.dev === 3 ? -10 : -4);
  const rel = p.rel[o.id];
  if (rel) {
    if (rel.k === 'spouse') add('My spouse', 28);
    else if (rel.k === 'lover' || rel.k === 'betrothed') add('My love', 32);
    else if (rel.k === 'ex') add('Old flame', -8);
    for (const m of rel.m) {
      if (m[1] <= c.tick) continue;
      const d = TH[m[0]];
      if (!d || !d.op) continue;
      const left = (m[1] - c.tick) / (d.d * TICKS_PER_HOUR);
      const fade = left > 0.5 ? 1 : left * 2;
      add(d.t.replace('{o}', o.first), d.op * (1 + 0.6 * (m[2] - 1)) * fade);
    }
  }
  return v < -100 ? -100 : v > 100 ? 100 : v;
}

// ---------- Facts and gossip ----------

export function addFact(c: Colony, k: string, a: Id, b: Id | undefined, real: boolean, s?: string): Fact {
  const f: Fact = { id: c.nextFact++, k, a, b, t: c.tick, real, s };
  c.facts.push(f);
  if (c.facts.length > 300) c.facts.splice(0, 60);
  return f;
}

export function findFact(c: Colony, k: string, a: Id, b?: Id): Fact | undefined {
  for (let i = c.facts.length - 1; i >= 0; i--) {
    const f = c.facts[i];
    if (f.k !== k) continue;
    if ((f.a === a && f.b === b) || (b !== undefined && f.a === b && f.b === a)) return f;
  }
  return undefined;
}

/** A colonist comes to know something, and reacts to it. */
export function learn(c: Colony, p: Pawn, f: Fact, from?: Pawn): void {
  if (p.know.includes(f.id)) return;
  p.know.push(f.id);
  if (p.know.length > 50) p.know.shift();
  if (p.id === f.a || p.id === f.b) {
    if (f.k === 'slander' && p.id === f.a && f.b) think(c, p, 'slandered', f.b);
    return;
  }
  switch (f.k) {
    case 'affair': {
      const mine = p.sp === f.a ? f.a : p.sp === f.b ? f.b : 0;
      if (mine) {
        const other = mine === f.a ? f.b! : f.a;
        think(c, p, 'cheatedon', mine);
        think(c, p, 'homewrecker', other);
        log(c, 'found_out', p.id, mine, undefined, other);
        note(c, p, 'found_out', mine);
        bump(c, 'affairsFound');
      } else if (per(p, AX.PIETY) + per(p, AX.LOYAL) > -0.6) {
        think(c, p, 'adulterer', f.a);
        if (f.b) think(c, p, 'adulterer', f.b);
      }
      break;
    }
    case 'scene': think(c, p, 'scenemaker', f.a); break;
    case 'drunk': think(c, p, 'drunkfool', f.a); break;
    case 'kind': think(c, p, 'kinddeed', f.a); break;
    case 'hero': think(c, p, 'herodeed', f.a); break;
    case 'coward': think(c, p, 'cowarddeed', f.a); break;
    case 'theft': think(c, p, 'thief', f.a); break;
    case 'killing': think(c, p, 'killer', f.a); break;
    case 'secret': {
      const s = f.s;
      if (s === 'killer') think(c, p, 'killer', f.a);
      else if (s === 'deserter') think(c, p, 'cowarddeed', f.a);
      else if (s === 'cultist') think(c, p, 'heretic', f.a);
      else if (s === 'thief') think(c, p, 'thief', f.a);
      else if (s === 'bigamist') think(c, p, 'adulterer', f.a);
      else if (s === 'noble') think(c, p, 'heardwell', f.a);
      break;
    }
    case 'bastard': {
      const mother = pawnById(c, Number(f.s));
      if (!mother) break;
      if (p.sp === mother.id && p.id !== f.b) {
        think(c, p, 'cheatedon', mother.id);
        if (f.b) think(c, p, 'homewrecker', f.b);
        log(c, 'found_out', p.id, mother.id, 'child', f.b);
        note(c, p, 'found_out', mother.id);
        bump(c, 'affairsFound');
      } else if (p.id !== mother.id && per(p, AX.PIETY) + per(p, AX.LOYAL) > -0.6) think(c, p, 'adulterer', mother.id);
      break;
    }
    case 'slander': {
      const subject = pawnById(c, f.a);
      if (subject && opinion(c, p, subject) > 35) {
        if (from) think(c, p, 'liedto', from.id);
        if (f.b) learn(c, subject, f);
      } else think(c, p, 'heardill', f.a);
      break;
    }
    default: break;
  }
}

function pickGossip(c: Colony, p: Pawn, o: Pawn, r: Rand): Fact | undefined {
  for (let i = p.know.length - 1; i >= 0 && i >= p.know.length - 12; i--) {
    const f = factById(c, p.know[i]);
    if (!f || o.know.includes(f.id)) continue;
    if (f.a === o.id || f.b === o.id) continue;
    if (f.a === p.id || f.b === p.id) continue;
    if (c.tick - f.t > TICKS_PER_DAY * 40) continue;
    // friends of the subject keep quiet about their shames
    const subject = pawnById(c, f.a);
    if (subject && f.k !== 'kind' && f.k !== 'hero' && p.rel[subject.id]?.f === 1 && per(p, AX.GOSSIP) < 1) continue;
    return f;
  }
  if (per(p, AX.HONEST) < -0.8 || has(p, 'schemer') || has(p, 'cruel')) {
    let worst: Pawn | undefined;
    let low = -25;
    for (const x of c.pawns) {
      if (x === p || x === o || stage(c, x) < STAGE.ADULT) continue;
      const op = opinion(c, p, x);
      if (op < low) { low = op; worst = x; }
    }
    if (worst && r.chance(0.5) && !findFact(c, 'slander', worst.id, p.id)) {
      const f = addFact(c, 'slander', worst.id, p.id, false);
      p.know.push(f.id);
      bump(c, 'slanders');
      return f;
    }
  }
  return undefined;
}

// ---------- Love ----------

const lifeFrac = (c: Colony, p: Pawn): number => {
  const R = RACES[p.race];
  return (ageYears(c, p) - R.adult) / (R.old - R.adult);
};

export function attracted(c: Colony, p: Pawn, o: Pawn, op: number): boolean {
  if (stage(c, p) < STAGE.ADULT || stage(c, o) < STAGE.ADULT) return false;
  if (has(p, 'chaste')) return false;
  if (p.orient === 0 && o.sex === p.sex) return false;
  if (p.orient === 2 && o.sex !== p.sex) return false;
  if (closeKin(c, p, o)) return false;
  if (Math.abs(lifeFrac(c, p) - lifeFrac(c, o)) > 0.55) return false;
  if (op < 40 && p.race !== o.race) {
    if (has(p, 'bigot')) return false;
    if (raceView(p.race, o.race) <= -12 && !has(p, 'openminded')) return false;
  }
  return true;
}

/** How likely someone with a partner is to look elsewhere, 0..0.7. */
export function strays(c: Colony, p: Pawn): number {
  if (has(p, 'devoted')) return 0;
  let v = 0.05 - per(p, AX.LOYAL) * 0.07 + (has(p, 'lecher') ? 0.3 : 0);
  const partner = pawnById(c, p.sp);
  if (partner) {
    const op = opinion(c, p, partner);
    if (op < 0) v += 0.2;
    else if (op > 60) v -= 0.06;
  }
  return v < 0 ? 0 : v > 0.7 ? 0.7 : v;
}

// ---------- Talking ----------

function say(p: Pawn, k: string, o: Pawn, t: number, ok: boolean): void {
  p.say = [k, o.id, t, ok ? 1 : 0];
}

/** Friends and rivals are declared when feeling runs strong both ways. */
export function checkBond(c: Colony, p: Pawn, o: Pawn): void {
  if (stage(c, p) < STAGE.TEEN || stage(c, o) < STAGE.TEEN) return;
  const a = opinion(c, p, o);
  const b = opinion(c, o, p);
  const rp = getRel(p, o.id);
  const ro = getRel(o, p.id);
  if (a >= 30 && b >= 30 && rp.f !== 1 && !rp.k) {
    rp.f = 1;
    ro.f = 1;
    log(c, 'friends', p.id, o.id);
    note(c, p, 'friends', o.id);
    note(c, o, 'friends', p.id);
    bump(c, 'friendships');
  } else if (a <= -30 && b <= -30 && rp.f !== -1) {
    rp.f = -1;
    ro.f = -1;
    log(c, 'rivals', p.id, o.id);
    note(c, p, 'rivals', o.id);
    note(c, o, 'rivals', p.id);
    bump(c, 'rivalries');
  } else if (rp.f === 1 && (a < 12 || b < 12)) {
    rp.f = undefined;
    ro.f = undefined;
    log(c, 'unfriend', p.id, o.id);
  } else if (rp.f === -1 && a > -8 && b > -8) {
    rp.f = undefined;
    ro.f = undefined;
    log(c, 'reconciled', p.id, o.id);
  }
}

function nearby(c: Colony, p: Pawn, range: number): Pawn[] {
  const pi = posAt(c, p, c.tick);
  const px = pi % c.w;
  const py = Math.floor(pi / c.w);
  const out: Pawn[] = [];
  for (const o of c.pawns) {
    if (o === p || o.gone) continue;
    if (o.act.k === 'sleep' && c.tick >= o.act.ta) continue;
    const oi = posAt(c, o, c.tick);
    const dx = (oi % c.w) - px;
    const dy = Math.floor(oi / c.w) - py;
    if (dx >= -range && dx <= range && dy >= -range && dy <= range) out.push(o);
  }
  return out;
}

const LEISURE = new Set(['drink', 'relax', 'dice', 'eat', 'idle', 'wander', 'visit', 'court', 'attend', 'play', 'listen', 'perform']);

/** Called hourly for everyone awake: maybe strike up something with whoever is near. */
export function maybeTalk(c: Colony, p: Pawn): void {
  const a = p.act;
  if (c.tick < a.ta) return;
  const brk = p.brk?.k;
  if (brk === 'sulk' || brk === 'wander') return;
  const r = new Rand(c.seed, S.SOC, c.tick, p.id);
  let chance = 0.3 + per(p, AX.SOCIABLE) * 0.1 + (LEISURE.has(a.k) ? 0.25 : 0) + (p.drunk > 30 ? 0.15 : 0);
  if (brk === 'rave') chance = 1;
  if (!r.chance(chance)) return;
  const near = nearby(c, p, 4).filter((o) => stage(c, o) >= STAGE.CHILD && o.brk?.k !== 'sulk');
  if (!near.length) return;
  const ws: number[] = [];
  let total = 0;
  for (const o of near) {
    const op = opinion(c, p, o);
    let w = 1 + Math.max(0, op + 30) / 40;
    if (o.id === p.sp) w += 2;
    if (p.urge && p.urge[1] === o.id && p.urge[2] > c.tick) w += 3;
    if (p.rel[o.id]?.f === 1) w += 1;
    if (op < -25) w += 0.6 + Math.max(0, per(p, AX.TEMPER));
    if (brk === 'rave') w = 1;
    ws.push(w);
    total += w;
  }
  let roll = r.float() * total;
  let o = near[0];
  for (let i = 0; i < near.length; i++) {
    roll -= ws[i];
    if (roll <= 0) { o = near[i]; break; }
  }
  interact(c, p, o, r, near.filter((x) => x !== o), brk === 'rave' ? 'insult' : undefined);
}

/** One exchange between two colonists. force picks the kind (a visit, a rant). */
export function interact(c: Colony, p: Pawn, o: Pawn, r: Rand, near: Pawn[], force?: string): void {
  const t = c.tick;
  const op = opinion(c, p, o);
  const opB = opinion(c, o, p);
  const sp = stage(c, p);
  const so = stage(c, o);
  const adults = sp >= STAGE.ADULT && so >= STAGE.ADULT;
  const grown = sp >= STAGE.TEEN && so >= STAGE.TEEN;
  const kind = per(p, AX.KIND);
  const temper = per(p, AX.TEMPER);
  const relP = getRel(p, o.id);
  const relO = getRel(o, p.id);
  relP.last = t;
  relO.last = t;

  const opts: [string, number][] = [];
  const w = (k: string, n: number): void => { if (n > 0) opts.push([k, n]); };
  w('chat', 9);
  w('joke', 1.6 + per(p, AX.HUMOR) * 1.6);
  if (sp === STAGE.CHILD && so === STAGE.CHILD) w('playing', 8);
  if (grown) {
    w('deeptalk', op > 20 ? 0.8 + op / 30 : 0);
    w('insult', Math.max(0, (-op - 8) / 11) + temper * 0.8 + (p.drunk > 40 ? 1 : 0) + (p.mood < 30 ? 0.9 : 0) - kind * 0.8 - 0.5);
    w('slight', Math.max(0, -op / 22) + Math.max(0, per(p, AX.AMBITION)) * 0.15 - kind * 0.3);
    w('comfort', o.mood < 34 && op > -10 ? 2.2 + kind * 2.4 : 0);
    w('praise', 0.6 + kind * 0.6 + (op > 20 ? 0.7 : 0));
    w('complain', p.mood < 40 ? 2 : 0.15);
    w('brag', 0.25 + per(p, AX.AMBITION) * 0.5);
    w('gossip', 0.8 + per(p, AX.GOSSIP) * 1.6);
    w('argue', (p.faith !== o.faith && p.dev >= 2 ? 0.45 : 0.04) + Math.max(0, -op / 45) + temper * 0.25);
    if (near.length >= 2) w('mock', (has(p, 'cruel') ? 1.2 : 0) + (op < -35 ? 0.5 + temper * 0.4 : 0));
    if (near.length >= 2 && (has(p, 'storyteller') || p.sk[10] >= 9 || p.sk[11] >= 9)) w('story', has(p, 'storyteller') ? 2.2 : 0.7);
    if (p.dev >= 3 && (o.faith !== p.faith || o.dev < 2)) w('preach', 1.1);
    if (o.rel[p.id]?.m.some((m) => m[0] === 'insulted' && m[1] > t) && !has(p, 'vengeful')) w('apologise', 0.5 + kind * 0.9 + per(p, AX.HONEST) * 0.3);
    if (p.coin >= 4 && op > 30) w('gift', 0.15 + Math.max(0, -per(p, AX.GREED)) * 0.4);
  }
  if (sp >= STAGE.ADULT && so >= STAGE.CHILD) {
    let best = 0;
    for (let s = 0; s < SKILLS.length; s++) best = Math.max(best, p.sk[s] - o.sk[s]);
    if (best >= 4) w('teach', so < STAGE.ADULT ? (o.mo === p.id || o.fa === p.id ? 3 : 1.4) : op > 10 ? 0.5 : 0);
  }
  if (adults) {
    const drawn = attracted(c, p, o, op);
    if (drawn) {
      const partner = o.id === p.sp;
      let f = (p.sp ? 0.22 : 0.7) + per(p, AX.FLIRT) * 0.45 + op / 25 + stat(o, 'beauty') * 0.3 + (p.drunk > 30 ? 0.3 : 0);
      if (partner) f = 1.6 + op / 40;
      else {
        if (p.sp) f *= strays(c, p) * 1.6;
        if (o.sp && !has(p, 'lecher')) f *= 0.12;
        if (o.id === p.crush) f = f * 2.5 + 1.2;
        if (relP.m.some((m) => (m[0] === 'rebuffed' || m[0] === 'proposalno') && m[1] > t)) f *= 0.15;
      }
      w('flirt', f);
      if (partner && relP.k === 'lover' && relO.k === 'lover' && t - (relP.s ?? t) > TICKS_PER_DAY * 6 && op >= 55 && o.ask?.k !== 'propose') w('propose', 1.6 + per(p, AX.LOYAL) * 0.5);
    }
  }

  let k = force ?? 'chat';
  if (!force) {
    let total = 0;
    for (const x of opts) total += x[1];
    let roll = r.float() * total;
    for (const x of opts) {
      roll -= x[1];
      if (roll <= 0) { k = x[0]; break; }
    }
  }

  let ok = true;
  switch (k) {
    case 'chat':
    case 'playing': {
      think(c, p, 'chat', o.id);
      think(c, o, 'chat', p.id);
      p.soc = Math.min(100, p.soc + 7);
      o.soc = Math.min(100, o.soc + 7);
      if (k === 'playing') { p.joy = Math.min(100, p.joy + 6); o.joy = Math.min(100, o.joy + 6); }
      break;
    }
    case 'deeptalk': {
      think(c, p, 'deeptalk', o.id);
      think(c, o, 'deeptalk', p.id);
      p.soc = Math.min(100, p.soc + 14);
      o.soc = Math.min(100, o.soc + 14);
      log(c, 'deeptalk', p.id, o.id);
      break;
    }
    case 'joke': {
      ok = r.chance(0.55 + per(p, AX.HUMOR) * 0.12 + stat(p, 'charm') * 0.03 + per(o, AX.HUMOR) * 0.1 - (o.mood < 35 ? 0.15 : 0) + opB / 250);
      if (ok) { think(c, o, 'laughed', p.id); think(c, p, 'chat', o.id); }
      else { think(c, o, 'badjoke', p.id); think(c, p, 'jokefell'); }
      p.soc = Math.min(100, p.soc + 6);
      o.soc = Math.min(100, o.soc + 6);
      break;
    }
    case 'insult': insult(c, p, o, r, near); ok = false; break;
    case 'slight': {
      think(c, o, 'slighted', p.id);
      ok = false;
      p.soc = Math.min(100, p.soc + 2);
      break;
    }
    case 'comfort': {
      think(c, o, 'comforted', p.id);
      think(c, p, 'gavecomfort', o.id);
      p.soc = Math.min(100, p.soc + 8);
      o.soc = Math.min(100, o.soc + 12);
      log(c, 'comfort', p.id, o.id);
      if (near.length && r.chance(0.3)) {
        const f = addFact(c, 'kind', p.id, o.id, true);
        learn(c, o, f);
        for (const x of near) learn(c, x, f);
      }
      break;
    }
    case 'praise': {
      think(c, o, stat(p, 'charm') < -1 && r.chance(0.5) ? 'flattered' : 'praised', p.id);
      p.soc = Math.min(100, p.soc + 5);
      o.soc = Math.min(100, o.soc + 6);
      break;
    }
    case 'complain': {
      if (per(o, AX.KIND) > 0.4) { think(c, p, 'comforted', o.id); think(c, o, 'gavecomfort', p.id); }
      else { think(c, o, 'complainedto', p.id); ok = false; }
      p.soc = Math.min(100, p.soc + 8);
      break;
    }
    case 'brag': {
      if (opB < 30) { think(c, o, 'bragged', p.id); ok = false; } else think(c, o, 'chat', p.id);
      p.soc = Math.min(100, p.soc + 5);
      break;
    }
    case 'gossip': {
      const f = pickGossip(c, p, o, r);
      think(c, p, 'gossiped', o.id);
      think(c, o, 'gossiped', p.id);
      p.soc = Math.min(100, p.soc + 8);
      o.soc = Math.min(100, o.soc + 8);
      if (f) {
        learn(c, o, f, p);
        log(c, 'gossip', p.id, o.id, f.k, f.a);
        bump(c, 'gossip');
      }
      break;
    }
    case 'argue': {
      think(c, p, 'argued', o.id);
      think(c, o, 'argued', p.id);
      const win = p.sk[10] + r.float() * 8 > o.sk[10] + r.float() * 8;
      think(c, win ? p : o, 'wonargument', win ? o.id : p.id);
      ok = false;
      log(c, 'argue', p.id, o.id);
      if (r.chance(0.015 + Math.max(0, temper) * 0.03 + Math.max(0, per(o, AX.TEMPER)) * 0.03) && sp >= STAGE.ADULT && so >= STAGE.ADULT) brawl(c, p, o, r, near);
      break;
    }
    case 'mock': {
      think(c, o, 'mocked', p.id);
      ok = false;
      log(c, 'mock', p.id, o.id);
      let defender: Pawn | undefined;
      for (const x of near) {
        const xo = opinion(c, x, o);
        if (xo > 25) {
          think(c, x, 'scenemaker', p.id);
          if (!defender && stage(c, x) >= STAGE.ADULT && per(x, AX.BRAVE) + per(x, AX.KIND) > 0 && r.chance(0.4)) defender = x;
        } else if (xo < -10) think(c, x, 'laughed', p.id);
      }
      if (defender) {
        think(c, o, 'defended', defender.id);
        think(c, p, 'argued', defender.id);
        think(c, defender, 'argued', p.id);
        log(c, 'defend', defender.id, o.id, undefined, p.id);
      }
      break;
    }
    case 'story': {
      think(c, p, 'performed');
      for (const x of [o, ...near]) { think(c, x, 'heardtale', p.id); x.joy = Math.min(100, x.joy + 8); }
      p.soc = Math.min(100, p.soc + 12);
      log(c, 'story', p.id, undefined, undefined, near.length + 1);
      break;
    }
    case 'preach': {
      if (o.faith === p.faith) think(c, o, 'faithtalk', p.id);
      else if (o.dev <= 1 && r.chance(0.06 + stat(p, 'charm') * 0.01) && so >= STAGE.ADULT) {
        const old = o.faith;
        o.faith = p.faith;
        o.dev = 1;
        think(c, o, 'faithtalk', p.id);
        log(c, 'convert', o.id, p.id, old);
        note(c, o, 'convert', p.id, p.faith);
        bump(c, 'conversions');
      } else { think(c, o, 'preachedat', p.id); ok = false; }
      break;
    }
    case 'apologise': {
      think(c, o, has(o, 'vengeful') ? 'flattered' : 'apology', p.id);
      if (!has(o, 'vengeful')) {
        const m = relO.m.find((x) => x[0] === 'insulted');
        if (m) m[1] = Math.min(m[1], t + TICKS_PER_DAY);
        think(c, p, 'forgave', o.id);
        log(c, 'apology', p.id, o.id);
      } else ok = false;
      break;
    }
    case 'gift': {
      const n = Math.min(p.coin, 2 + r.int(4));
      p.coin -= n;
      o.coin += n;
      think(c, o, 'gift', p.id);
      think(c, p, 'gavegift', o.id);
      log(c, 'gift', p.id, o.id, undefined, n);
      break;
    }
    case 'teach': {
      let best = 0;
      let bs = 0;
      for (let s = 0; s < SKILLS.length; s++) if (p.sk[s] - o.sk[s] > best) { best = p.sk[s] - o.sk[s]; bs = s; }
      o.sk[bs] = Math.min(20, o.sk[bs] + 0.035 * stat(o, 'learn') * (so < STAGE.ADULT ? 1.6 : 1));
      think(c, o, 'taught', p.id);
      if (so < STAGE.ADULT) think(c, p, 'taughtchild', o.id);
      p.soc = Math.min(100, p.soc + 5);
      o.soc = Math.min(100, o.soc + 5);
      break;
    }
    case 'flirt': ok = flirt(c, p, o, r, near, op, opB); break;
    case 'propose': ok = propose(c, p, o, opB); break;
    default: break;
  }
  say(p, k, o, t, ok);
  say(o, k, p, t, ok);
  if (p.gone || o.gone) return;
  checkBond(c, p, o);
}

export function insult(c: Colony, p: Pawn, o: Pawn, r: Rand, near: Pawn[]): void {
  think(c, o, 'insulted', p.id);
  think(c, p, 'ventedat', o.id);
  p.soc = Math.min(100, p.soc + 3);
  log(c, 'insult', p.id, o.id);
  bump(c, 'insults');
  if (stage(c, p) < STAGE.ADULT || stage(c, o) < STAGE.ADULT) return;
  let esc = 0.015 + (per(o, AX.TEMPER) + 1) * 0.035 + (o.drunk > 40 ? 0.08 : 0) + (per(o, AX.BRAVE) > 0.5 ? 0.02 : 0);
  if (has(o, 'pacifist') || has(o, 'gentle') || has(o, 'coward')) esc -= 0.3;
  if (r.chance(esc)) brawl(c, o, p, r, near);
  else if (r.chance(0.3)) {
    think(c, p, 'argued', o.id);
    think(c, o, 'argued', p.id);
  }
}

/** a swings at b. Someone ends up on the floor. */
export function brawl(c: Colony, a: Pawn, b: Pawn, r: Rand, near: Pawn[]): void {
  const power = (x: Pawn): number => x.sk[0] + RACES[x.race].size * 5 + stat(x, 'tough') * 3 + r.float() * 8 - (x.drunk > 60 ? 2 : 0);
  const pa = power(a);
  const pb = power(b);
  const win = pa >= pb ? a : b;
  const lose = win === a ? b : a;
  lose.hp -= (9 + r.int(14)) / stat(lose, 'tough');
  win.hp -= (2 + r.int(7)) / stat(win, 'tough');
  think(c, a, 'brawl', b.id);
  think(c, b, 'brawl', a.id);
  think(c, win, 'wonbrawl', lose.id);
  if (r.chance(0.25)) lose.look.marks.push(1 + r.int(6));
  const f = addFact(c, 'brawl', win.id, lose.id, true);
  for (const x of near) {
    think(c, x, has(x, 'bloodlust') || x.race === 'orc' ? 'enjoyedbrawl' : 'sawbrawl');
    learn(c, x, f);
  }
  a.say = ['brawl', b.id, c.tick, 0];
  b.say = ['brawl', a.id, c.tick, 0];
  log(c, 'brawl', win.id, lose.id);
  note(c, win, 'brawl_won', lose.id);
  note(c, lose, 'brawl_lost', win.id);
  bump(c, 'brawls');
  if (lose.hp <= 0) {
    die(c, lose, 'brawl', win.id);
    const k = addFact(c, 'killing', win.id, lose.id, true);
    for (const x of near) learn(c, x, k);
    note(c, win, 'killed', lose.id);
  }
}

function flirt(c: Colony, p: Pawn, o: Pawn, r: Rand, near: Pawn[], op: number, opB: number): boolean {
  const t = c.tick;
  const relP = getRel(p, o.id);
  const relO = getRel(o, p.id);
  const pSide = p.sp && p.sp !== o.id;
  const oSide = o.sp && o.sp !== p.id;
  if (o.id === p.sp) {
    think(c, p, 'flirted', o.id);
    think(c, o, 'wasflirted', p.id);
    p.soc = Math.min(100, p.soc + 8);
    o.soc = Math.min(100, o.soc + 8);
    return true;
  }
  let accept = attracted(c, o, p, opB) ? 0.4 + opB / 60 + (o.crush === p.id ? 0.3 : 0) + stat(p, 'beauty') * 0.1 + stat(p, 'charm') * 0.03 + per(o, AX.FLIRT) * 0.1 + (o.drunk > 30 ? 0.1 : 0) : 0;
  if (oSide) accept *= Math.min(1, strays(c, o) * 1.8);
  const ok = r.chance(accept);
  bump(c, ok ? 'flirtsOk' : 'flirtsNo');
  if (!ok) {
    think(c, p, 'rebuffed', o.id);
    if (opB < 10 || oSide) think(c, o, 'unwanted', p.id);
    if (p.crush === o.id && (relP.m.find((m) => m[0] === 'rebuffed')?.[2] ?? 0) >= 2) { p.crush = 0; note(c, p, 'heartbroken', o.id); }
    log(c, 'rebuff', p.id, o.id);
  } else {
    think(c, p, 'flirted', o.id);
    think(c, o, 'wasflirted', p.id);
    p.soc = Math.min(100, p.soc + 8);
    o.soc = Math.min(100, o.soc + 8);
    const heat = (rel: typeof relP): number => {
      let n = 0;
      for (const m of rel.m) if ((m[0] === 'flirted' || m[0] === 'wasflirted') && m[1] > t) n += m[2];
      return n;
    };
    const warm = heat(relP) + heat(relO) >= 4 && opinion(c, p, o) >= 26 && opinion(c, o, p) >= 26;
    if (pSide || oSide) {
      // a stolen look is nothing; it becomes an affair when it keeps happening
      if (warm && relP.k !== 'lover') {
        relP.k = 'lover'; relO.k = 'lover'; relP.s = t; relO.s = t;
        think(c, p, 'newlove', o.id);
        think(c, o, 'newlove', p.id);
      }
      if (relP.k === 'lover') {
        let f = findFact(c, 'affair', p.id, o.id);
        if (!f) { f = addFact(c, 'affair', p.id, o.id, true); bump(c, 'affairs'); log(c, 'affair', p.id, o.id); note(c, p, 'affair', o.id); note(c, o, 'affair', p.id); }
        learn(c, p, f);
        learn(c, o, f);
        if (pSide && per(p, AX.LOYAL) > -0.3) think(c, p, 'guilt');
        if (oSide && per(o, AX.LOYAL) > -0.3) think(c, o, 'guilt');
        for (const x of near) if (r.chance(x.id === p.sp || x.id === o.sp ? 0.9 : 0.3)) learn(c, x, f);
        if (r.chance(0.3)) {
          think(c, p, 'lovin', o.id);
          think(c, o, 'lovin', p.id);
          tryConceive(c, p, o, r);
        }
      } else log(c, 'flirt', p.id, o.id);
    } else if (warm && relP.k !== 'lover') becomeLovers(c, p, o);
    else log(c, 'flirt', p.id, o.id);
  }
  // anyone watching whose partner this is will not be pleased
  for (const x of near) {
    const mine = x.sp === p.id ? p : x.sp === o.id ? o : undefined;
    if (!mine) continue;
    const other = mine === p ? o : p;
    if (!ok && mine === o) continue; // partner turned them down: nothing to resent but the cheek
    think(c, x, 'jealousy', other.id);
    if ((has(x, 'jealous') || per(x, AX.TEMPER) > 0.8) && stage(c, x) >= STAGE.ADULT) insult(c, x, other, r, near.filter((n) => n !== x));
  }
  return ok;
}

/** People this colonist would go out of their way to see. */
export function favourite(c: Colony, p: Pawn, r: Rand): Pawn | undefined {
  let best: Pawn | undefined;
  let score = 18;
  for (const o of c.pawns) {
    if (o === p || o.gone || (o.act.k === 'sleep')) continue;
    if (stage(c, o) < STAGE.CHILD) continue;
    const s = opinion(c, p, o) + (o.id === p.sp ? 25 : 0) + r.float() * 25;
    if (s > score) { score = s; best = o; }
  }
  return best;
}

