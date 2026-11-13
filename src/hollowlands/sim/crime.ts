// Crime and punishment. Thefts need a witness to become an accusation, accusations can be
// false, and a trial turns on the evidence, the judge's feelings and the accused's tongue.

import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../config';
import { takeMeal } from './econ';
import { bump, factById, log, note } from './events';
import { wound } from './health';
import { depart, die } from './life';
import { ask } from './ask';
import { think } from './mood';
import { STAGE, has, pawnById, per, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { addFact, learn, opinion } from './social';
import { AX, type Colony, type Fact, type Pawn } from './types';

const isClose = (a: Pawn, b: Pawn): boolean => a.sp === b.id || a.mo === b.id || a.fa === b.id || b.mo === a.id || b.fa === a.id || (!!a.mo && a.mo === b.mo) || a.rel[b.id]?.f === 1;

export function accuse(c: Colony, by: Pawn, a: Pawn, k: string, f: Fact): void {
  if (c.trials.some((t) => t.a === a.id && t.k === k)) return;
  c.trials.push({ a: a.id, k, f: f.id, by: by.id });
  think(c, a, 'accusedme', by.id);
  log(c, 'accused', by.id, a.id, k);
  bump(c, 'accusations');
}

function steal(c: Colony, p: Pawn, what: string, r: Rand): void {
  if (what === 'food') {
    if (!takeMeal(c, true)) return;
    takeMeal(c, true);
    p.food = Math.min(100, p.food + 70);
  } else if (what === 'ale') {
    c.stock.ale -= 2;
    p.drunk += 40;
    p.booze += 2;
  } else {
    let n = 3 + r.int(6);
    const s = Math.min(c.stock.silver, n);
    c.stock.silver -= s;
    const g = Math.min(c.stock.goods, n - s);
    c.stock.goods -= g;
    n = s + g;
    if (n < 1) return;
    p.coin += n;
  }
  const f = addFact(c, 'theft', p.id, undefined, true, what);
  p.know.push(f.id);
  bump(c, 'thefts');
  const guard = c.pawns.find((o) => o.prof === 'guard' && o !== p && !o.gone);
  const seen = 0.22 + (guard ? 0.2 : 0) + (has(p, 'nimble') ? -0.12 : 0) + (has(p, 'clumsy') ? 0.15 : 0);
  if (!r.chance(seen)) {
    if (per(p, AX.HONEST) > 0.3) think(c, p, 'guilt');
    return;
  }
  const others = c.pawns.filter((o) => o !== p && !o.gone && stage(c, o) >= STAGE.TEEN);
  if (!others.length) return;
  const witness = guard && r.chance(0.5) ? guard : r.pick(others);
  learn(c, witness, f);
  // a player's colonist decides for themselves what to do about it
  if (witness.owner && ask(c, witness, 'report', p.id, f.id, 1)) return;
  if (isClose(witness, p) && per(witness, AX.HONEST) < 1) {
    // family and friends look the other way, and now they share a secret
    think(c, p, 'toldsecret', witness.id);
    log(c, 'theft_hushed', p.id, witness.id, what);
    return;
  }
  log(c, 'theft', p.id, witness.id, what);
  note(c, p, 'caught', witness.id, what);
  accuse(c, witness, p, 'theft', f);
}

/** Once a day: temptation, malice, and the next trial. */
export function dailyCrime(c: Colony): void {
  const day = dayOf(c.tick);
  const r = new Rand(c.seed, S.CRIME, day);
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT);
  for (const p of adults) {
    if (p.brk || p.id === c.gov.ruler) continue;
    let ch = 0;
    let what = 'goods';
    if (has(p, 'klepto')) ch = 0.05;
    if (per(p, AX.GREED) > 1 && p.coin < 6 && per(p, AX.HONEST) < 0) ch = Math.max(ch, 0.012);
    if (c.gov.laws.ration && p.food < 32 && per(p, AX.HONEST) < 0.8) { ch = Math.max(ch, 0.07); what = 'food'; }
    else if (has(p, 'drunkard') && c.stock.ale >= 2 && p.coin < 1) { ch = Math.max(ch, 0.03); what = 'ale'; }
    if (ch && r.chance(ch)) steal(c, p, what, r);
  }

  // a liar with an enemy and a quiet word in the right ear
  for (const p of adults) {
    if (!(has(p, 'liar') || has(p, 'schemer') || has(p, 'cruel')) || !r.chance(0.006)) continue;
    let worst: Pawn | undefined;
    let low = -45;
    for (const o of adults) {
      if (o === p || o.id === c.gov.ruler) continue;
      const op = opinion(c, p, o);
      if (op < low) { low = op; worst = o; }
    }
    if (!worst) continue;
    const f = addFact(c, 'theft', worst.id, p.id, false, 'goods');
    p.know.push(f.id);
    bump(c, 'falseAccusations');
    accuse(c, p, worst, 'theft', f);
  }

  // hold the next trial
  while (c.trials.length && !pawnById(c, c.trials[0].a)) c.trials.shift();
  if (!c.gath && c.trials.length) {
    const tr = c.trials[0];
    const hall = c.blds.find((b) => b.k === 'hall' && b.built);
    const start = c.tick + 12 * TICKS_PER_HOUR;
    c.gath = { k: 'trial', t0: start, t1: start + 2 * TICKS_PER_HOUR, b: hall?.id ?? 0, a: tr.a, o: tr.by, x: hall ? hall.x + Math.floor(hall.w / 2) : c.cx, y: hall ? hall.y + Math.floor(hall.h / 2) : c.cy };
    log(c, 'trial_set', tr.a, tr.by, tr.k);
  }
  void TICKS_PER_DAY;
}

const SENTENCE = { FREE: 0, FINE: 1, STOCKS: 2, FLOGGED: 3, BRANDED: 4, MAIMED: 5, EXILED: 6, HANGED: 7 } as const;

/** The trial gathering ends: guilty or not, and what is done about it. */
export function verdict(c: Colony, there: Pawn[]): void {
  const tr = c.trials.shift();
  if (!tr) return;
  const accused = pawnById(c, tr.a);
  if (!accused || accused.gone) return;
  const r = new Rand(c.seed, S.CRIME, c.tick, accused.id);
  const fact = factById(c, tr.f);
  const real = fact ? fact.real : true;
  let judge = pawnById(c, c.gov.regent || c.gov.ruler);
  if (judge === accused) judge = undefined;
  let witnesses = 0;
  if (fact) for (const p of c.pawns) if (p !== accused && p.know.includes(fact.id)) witnesses++;
  let feeling = 0;
  if (judge) feeling = opinion(c, judge, accused);
  else if (there.length) { for (const p of there) if (p !== accused) feeling += opinion(c, p, accused); feeling /= there.length; }
  const harsh = c.gov.laws.harsh ?? 1;
  let pg = (real ? 0.72 : 0.22) + Math.min(0.15, Math.max(0, witnesses - 1) * 0.05) - feeling / 180 - stat(accused, 'charm') * 0.015 + (harsh >= 2 ? 0.1 : 0);
  pg = pg < 0.05 ? 0.05 : pg > 0.95 ? 0.95 : pg;
  bump(c, 'trials');
  if (!r.chance(pg)) {
    think(c, accused, 'acquitted');
    log(c, 'trial', accused.id, judge?.id, tr.k, SENTENCE.FREE);
    note(c, accused, 'acquitted', undefined, tr.k);
    return;
  }
  let prior = 0;
  for (const b of accused.bio) if (b.k === 'punished') prior++;
  let s: number;
  if (tr.k === 'murder' || tr.k === 'treason') s = harsh === 0 ? SENTENCE.EXILED : harsh === 1 ? (r.chance(0.5) ? SENTENCE.HANGED : SENTENCE.EXILED) : SENTENCE.HANGED;
  else if (tr.k === 'heresy') s = harsh === 0 ? SENTENCE.STOCKS : harsh === 1 ? SENTENCE.FLOGGED : r.chance(0.5) ? SENTENCE.EXILED : SENTENCE.HANGED;
  else if (tr.k === 'assault') s = harsh === 0 ? SENTENCE.STOCKS : harsh === 1 ? SENTENCE.FLOGGED : prior ? SENTENCE.BRANDED : SENTENCE.FLOGGED;
  else s = harsh === 0 ? SENTENCE.FINE : harsh === 1 ? (prior ? SENTENCE.FLOGGED : SENTENCE.STOCKS) : prior ? SENTENCE.MAIMED : SENTENCE.BRANDED;
  bump(c, 'convictions');
  if (!real) bump(c, 'wrongful');
  log(c, 'trial', accused.id, judge?.id, tr.k, s);
  note(c, accused, 'punished', undefined, String(s));

  // how everyone takes it
  for (const o of c.pawns) {
    if (o === accused || o === judge || o.gone || stage(c, o) < STAGE.TEEN) continue;
    const op = opinion(c, o, accused);
    if (op > 25) { if (judge) think(c, o, s >= SENTENCE.MAIMED ? 'tyranny' : 'injustice', judge.id); }
    else if (op < -15) think(c, o, 'justice');
    else if (s >= SENTENCE.MAIMED && per(o, AX.KIND) > 0.6 && judge) think(c, o, 'crueljustice', judge.id);
  }
  if (judge) think(c, accused, 'condemnedby', judge.id);

  switch (s) {
    case SENTENCE.FINE: { const fine = Math.min(accused.coin, 10); accused.coin -= fine; c.stock.silver += fine; think(c, accused, 'ashamed'); break; }
    case SENTENCE.STOCKS: think(c, accused, 'stocks'); break;
    case SENTENCE.FLOGGED: wound(c, accused, 'cut', 14 + r.int(10), r); think(c, accused, 'flogged'); break;
    case SENTENCE.BRANDED: accused.perm.push('brand'); accused.look.marks.push(10); wound(c, accused, 'burn', 8, r); think(c, accused, 'branded'); break;
    case SENTENCE.MAIMED: {
      const hand = accused.perm.includes('lost_handR') ? 'handL' : 'handR';
      if (!accused.perm.includes('lost_' + hand)) accused.perm.push('lost_' + hand);
      accused.look.marks.push(8);
      wound(c, accused, 'cut', 22, r);
      think(c, accused, 'maimed');
      break;
    }
    case SENTENCE.EXILED: depart(c, accused, 'exiled'); break;
    case SENTENCE.HANGED: die(c, accused, 'executed', judge?.id); break;
    default: break;
  }
}

/** A killing in cold blood. Whoever is suspected stands trial, and it may not be the right person. */
export function murder(c: Colony, p: Pawn, o: Pawn, r: Rand): void {
  const near = c.pawns.filter((x) => x !== p && x !== o && !x.gone && x.act.k !== 'sleep' && Math.abs(x.x - p.x) <= 5 && Math.abs(x.y - p.y) <= 5 && stage(c, x) >= STAGE.CHILD);
  wound(c, o, 'cut', 38 + r.int(34), r);
  if (has(p, 'bloodlust') || r.chance(0.4)) wound(c, o, 'cut', 20 + r.int(25), r);
  bump(c, 'murderAttempts');
  const dead = o.hp <= 0;
  const f = addFact(c, dead ? 'killing' : 'attack', p.id, o.id, true);
  p.know.push(f.id);
  for (const x of near) learn(c, x, f);
  if (dead) {
    die(c, o, 'murder', near.length ? p.id : undefined);
    think(c, p, per(p, AX.KIND) > 0 ? 'killedsomeone' : 'slewfoe');
    note(c, p, 'murdered', o.id);
    bump(c, 'murders');
    log(c, 'murder', o.id, near.length ? p.id : undefined);
    if (near.length) accuse(c, near[0], p, 'murder', f);
    else {
      // nobody saw. Suspicion falls on whoever was known to hate the dead
      let suspect: Pawn | undefined;
      let low = -20;
      for (const x of c.pawns) {
        if (x.gone || x === o || stage(c, x) < STAGE.ADULT) continue;
        const known = x.rel[o.id]?.f === -1 ? -60 : 0;
        const op = Math.min(known, x === p ? opinion(c, x, o) : 0) + r.float() * 10;
        if (x.rel[o.id]?.f === -1 && op < low) { low = op; suspect = x; }
      }
      const kin = c.pawns.find((x) => !x.gone && x !== suspect && stage(c, x) >= STAGE.ADULT && (x.sp === o.id || x.mo === o.id || x.fa === o.id || o.mo === x.id || o.fa === x.id || x.rel[o.id]?.f === 1));
      if (suspect && kin) {
        const guess = suspect === p ? f : addFact(c, 'killing', suspect.id, o.id, false);
        accuse(c, kin, suspect, 'murder', guess);
      }
    }
  } else {
    log(c, 'attack', p.id, o.id);
    think(c, o, 'triedtokillme', p.id);
    accuse(c, o, p, 'assault', f);
  }
}
