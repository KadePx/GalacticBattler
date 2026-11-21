// The colony's own dramas, sparked now and then by the land's events director (nature.ts):
// lovers who run off to marry against a parent's word, feuds between families, a child lost in
// the woods and the search party that goes out after them, duels over love, and a match brought
// by a noble house from beyond the hills.

import { HARD_CAP, TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../config';
import { cacheOf, featList } from './cache';
import { bump, log, note } from './events';
import { wound } from './health';
import { becomeLovers, breakup } from './life';
import { getRel, think } from './mood';
import { familyName } from './names';
import { AID, aidCount, openNear, type Go } from './nature';
import { RACES } from './data/races';
import { STAGE, ageYears, has, makePawn, mkAct, pawnById, per, posAt, stage } from './pawn';
import { Rand, S } from './rng';
import { brawl, insult, opinion } from './social';
import { reach } from './town';
import { AX, F, type Colony, type Nat, type Pawn } from './types';

const H = TICKS_PER_HOUR;
const D = TICKS_PER_DAY;

const able = (c: Colony, p: Pawn | undefined): p is Pawn => !!p && !p.gone && !p.thrall && !p.brk && p.hp > 60 && stage(c, p) >= STAGE.ADULT && !c.foes.some((f) => f.held === p.id);
const inGath = (c: Colony, id: number): boolean => !!c.gath && (c.gath.a === id || c.gath.o === id);

// ------------------------------------------------------------------ finding the people

function findElope(c: Colony): { a: Pawn; b: Pawn; by?: Pawn } | undefined {
  for (const p of c.pawns) {
    if (!p.sp || p.id > p.sp || p.owner || !able(c, p) || stage(c, p) !== STAGE.ADULT) continue;
    const o = pawnById(c, p.sp);
    const k = p.rel[p.sp]?.k;
    if (!o || o.owner || !able(c, o) || stage(c, o) !== STAGE.ADULT || (k !== 'lover' && k !== 'betrothed') || inGath(c, p.id) || inGath(c, o.id)) continue;
    if (c.nat?.nw && (c.nat.nw.a === p.id || c.nat.nw.b === p.id)) continue;
    // a parent set against the match: a grudge against the other, or a match far beneath the family
    for (const [x, y] of [[p, o], [o, p]] as [Pawn, Pawn][]) {
      for (const pid of [x.mo, x.fa]) {
        const par = pid ? pawnById(c, pid) : undefined;
        if (!par || par.gone || stage(c, par) < STAGE.ADULT) continue;
        if (opinion(c, par, y) < -5 || (has(par, 'bigot') && par.race !== y.race) || (par.rank >= 4 && y.rank <= 2 && par.rank - y.rank >= 2)) return { a: x, b: y, by: par };
      }
    }
    // or lovers a long while, with no wedding in sight, and tired of waiting
    if (k === 'lover' && c.tick - (p.rel[o.id]?.s ?? c.tick) > TICKS_PER_DAY * 30) return { a: p, b: o };
  }
  return undefined;
}

function families(c: Colony): Map<string, Pawn[]> {
  const m = new Map<string, Pawn[]>();
  for (const p of c.pawns) {
    if (p.gone || p.thrall || stage(c, p) < STAGE.ADULT) continue;
    const l = m.get(p.fam);
    if (l) l.push(p); else m.set(p.fam, [p]);
  }
  return m;
}

function findFeud(c: Colony): { a: Pawn; b: Pawn } | undefined {
  const fams = families(c);
  for (const p of c.pawns) {
    if ((fams.get(p.fam)?.length ?? 0) < 2 || stage(c, p) < STAGE.ADULT) continue;
    for (const key in p.rel) {
      if (p.rel[key].f !== -1) continue;
      const o = pawnById(c, +key);
      if (!o || o.gone || o.fam === p.fam || (fams.get(o.fam)?.length ?? 0) < 2) continue;
      return p.id < o.id ? { a: p, b: o } : { a: o, b: p };
    }
  }
  return undefined;
}

function findLost(c: Colony, r: Rand): { a: Pawn; i: number } | undefined {
  const kids = c.pawns.filter((p) => !p.gone && !p.owner && stage(c, p) === STAGE.CHILD && p.hp > 70 && !p.ill && !p.inj.length && [p.mo, p.fa].some((id) => { const q = id ? pawnById(c, id) : undefined; return !!q && !q.gone; }));
  if (!kids.length) return undefined;
  const trees = featList(c, F.TREE);
  const lo = reach(c) + 4;
  const hi = reach(c) + 20;
  const near: number[] = [];
  for (const i of trees) {
    const x = i % c.w;
    const d = Math.max(Math.abs(x - c.cx), Math.abs((i - x) / c.w - c.cy));
    if (d >= lo && d <= hi) near.push(i);
    if (near.length >= 300) break;
  }
  if (!near.length) return undefined;
  const k = cacheOf(c);
  for (let tries = 0; tries < 10; tries++) {
    const i = near[r.int(near.length)];
    if (k.reach[i]) return { a: r.pick(kids), i };
  }
  return undefined;
}

function findDuel(c: Colony): { a: Pawn; b: Pawn; o: Pawn } | undefined {
  for (const a of c.pawns) {
    if (!a.crush || a.owner || !able(c, a) || stage(c, a) !== STAGE.ADULT || a.hp < 75) continue;
    if (per(a, AX.TEMPER) < 0.2 && per(a, AX.BRAVE) < 0.4) continue;
    const o = pawnById(c, a.crush);
    if (!o || o.gone || o.sp === a.id) continue;
    // the one they want is spoken for, or someone else is after them too
    let b: Pawn | undefined;
    if (o.sp) {
      const k = o.rel[o.sp]?.k;
      if (k !== 'lover' && k !== 'betrothed') continue;
      b = pawnById(c, o.sp);
    } else b = c.pawns.find((q) => q !== a && q.crush === o.id && !q.sp);
    if (!b || b.owner || !able(c, b) || stage(c, b) !== STAGE.ADULT || b.hp < 75 || inGath(c, b.id)) continue;
    return { a, b, o };
  }
  return undefined;
}

function findSuitor(c: Colony): Pawn | undefined {
  if (c.pawns.length >= HARD_CAP - 2 || c.nat?.nw) return undefined;
  const ruler = c.gov.ruler;
  return c.pawns.filter((p) => !p.sp && !p.owner && able(c, p) && stage(c, p) === STAGE.ADULT && !has(p, 'chaste') && (p.rank >= 3 || p.mo === ruler || p.fa === ruler))
    .sort((a, b) => b.rank - a.rank || b.born - a.born || a.id - b.id)[0];
}

/** The dramas that could happen today, and how likely each is. */
export function dramaCan(c: Colony, n: Nat, r: Rand, season: number): [string, number][] {
  return [
    ['elope', findElope(c) ? 0.9 : 0],
    ['feud', !n.feud && findFeud(c) ? 0.7 : 0],
    ['lost', season !== 3 && findLost(c, r) ? 0.8 : 0],
    ['duel', findDuel(c) ? 0.8 : 0],
    ['suitor', findSuitor(c) ? 0.5 : 0],
  ];
}

/** Set one of them going. False if it came to nothing. */
export function dramaRun(c: Colony, n: Nat, k: string, r: Rand): boolean {
  const d0 = dayOf(c.tick) * D;
  switch (k) {
    case 'elope': {
      const e = findElope(c);
      if (!e) return false;
      const i = openNear(c, r, c.cx, c.cy, reach(c) + 6, reach(c) + 16, 24);
      if (i < 0) return false;
      n.el = { a: e.a.id, b: e.b.id, x: i % c.w, y: Math.floor(i / c.w), t0: d0 + 22 * H, t1: d0 + D + 6 * H, by: e.by?.id ?? 0, told: 0 };
      return true;
    }
    case 'feud': {
      const f = findFeud(c);
      if (!f) return false;
      startFeud(c, n, f.a, f.b, 'grudge', r);
      return true;
    }
    case 'lost': {
      const l = findLost(c, r);
      if (!l) return false;
      const t0 = d0 + (10 + r.int(4)) * H;
      n.lost = { a: l.a.id, x: l.i % c.w, y: Math.floor(l.i / c.w), t0, s: t0 + 3 * H, t1: t0 + 22 * H, told: 0 };
      return true;
    }
    case 'duel': {
      const f = findDuel(c);
      if (!f) return false;
      const i = openNear(c, r, c.cx, c.cy, 2, 6, 24);
      if (i < 0) return false;
      n.duel = { a: f.a.id, b: f.b.id, o: f.o.id, t: d0 + D + 7 * H, x: i % c.w, y: Math.floor(i / c.w) };
      log(c, 'n_challenge', f.a.id, f.b.id, undefined, f.o.id);
      return true;
    }
    case 'suitor': return suitor(c, n, r);
    default: return false;
  }
}

function startFeud(c: Colony, n: Nat, a: Pawn, b: Pawn, why: string, r: Rand): void {
  n.feud = { a: a.fam, b: b.fam, t1: c.tick + (20 + r.int(16)) * D, n: 0 };
  log(c, 'n_feud', a.id, b.id, `${why}|${a.fam}|${b.fam}`);
  note(c, a, 'n_feud', b.id, b.fam);
  note(c, b, 'n_feud', a.id, a.fam);
  bump(c, 'feuds');
}

/** A rider from a noble house brings a match: someone of theirs for someone of ours. */
function suitor(c: Colony, n: Nat, r: Rand): boolean {
  const o = findSuitor(c);
  if (!o) return false;
  const house = c.near?.length ? r.pick(c.near).name : '';
  const fam = familyName(r, o.race);
  // someone near their intended's age (an adult, not yet old)
  const R = RACES[o.race];
  const age = Math.max(R.adult + 1, Math.min(R.old * 0.8, ageYears(c, o) - 3 + r.float() * 6));
  const p = makePawn(c, r, { race: o.race, sex: o.orient === 2 ? o.sex : o.sex === 1 ? 0 : 1, fam, age });
  if (stage(c, p) !== STAGE.ADULT) return false;
  p.rank = 5;
  if (p.orient === 2 && o.orient !== 2) p.orient = 1;
  p.x = c.gx;
  p.y = Math.max(1, Math.min(c.h - 2, c.gy));
  p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
  c.pawns.push(p);
  think(c, p, 'arrived');
  p.sp = o.id;
  o.sp = p.id;
  o.crush = 0;
  p.rel[o.id] = { m: [], k: 'betrothed', s: c.tick };
  getRel(o, p.id).k = 'betrothed';
  getRel(o, p.id).s = c.tick;
  n.nw = { a: p.id, b: o.id, h: house };
  log(c, 'n_suitor', p.id, o.id, house);
  note(c, p, 'n_suitor', o.id, house || c.name);
  note(c, o, 'n_suitor_got', p.id, p.fam);
  bump(c, 'joined');
  return true;
}

// ------------------------------------------------------------------ day by day

/** Each midnight: the feud smoulders (or ends), the noble match is checked on. */
export function dramaDaily(c: Colony, n: Nat, day: number): void {
  const nw = n.nw;
  if (nw) {
    const a = pawnById(c, nw.a);
    const b = pawnById(c, nw.b);
    const k = a?.rel[nw.b]?.k;
    if (!a || !b || (k !== 'betrothed' && k !== 'spouse') || k === 'spouse') delete n.nw;
  }
  const f = n.feud;
  if (!f) return;
  const fams = families(c);
  const A = fams.get(f.a) ?? [];
  const B = fams.get(f.b) ?? [];
  const r = new Rand(c.seed, S.NATURE, day, 41);
  if (!A.length || !B.length) { delete n.feud; return; }
  // a marriage across the line ends it
  const wed = A.find((p) => p.sp && B.some((q) => q.id === p.sp) && p.rel[p.sp]?.k === 'spouse');
  if (wed || c.tick >= f.t1) {
    const ruler = pawnById(c, c.gov.ruler);
    const maker = !wed && ruler && ruler.fam !== f.a && ruler.fam !== f.b ? ruler : undefined;
    log(c, wed ? 'n_feud_wed' : 'n_feud_end', wed ? wed.id : maker?.id, wed ? wed.sp : undefined, `${f.a}|${f.b}`);
    for (const p of [...A, ...B]) think(c, p, 'feudover');
    if (maker) note(c, maker, 'n_feud_peace', undefined, `${f.a}|${f.b}`);
    delete n.feud;
    return;
  }
  for (let k = 0; k < 2; k++) {
    const a = r.pick(A);
    const b = r.pick(B);
    think(c, a, 'feud', b.id);
    think(c, b, 'feud', a.id);
  }
  if (f.n >= 4 || !r.chance(0.22)) return;
  const a = r.pick(A);
  const b = r.pick(B);
  if (!able(c, a) || !able(c, b) || stage(c, a) === STAGE.ELDER || stage(c, b) === STAGE.ELDER) return;
  const roll = r.float();
  let kind = 'words';
  if (roll < 0.3 && per(a, AX.TEMPER) > 0.2 && a.hp > 75 && b.hp > 75) { kind = 'fists'; brawl(c, a, b, r, []); }
  else if (roll < 0.55 && b.home) {
    const home = c.blds.find((x) => x.id === b.home);
    if (home && home.built) { kind = 'fence'; home.dmg = Math.min(80, home.dmg + 6); think(c, b, 'feud', a.id); }
    else insult(c, a, b, r, []);
  } else insult(c, a, b, r, []);
  f.n++;
  log(c, 'n_feud_clash', a.id, b.id, kind);
}

// ------------------------------------------------------------------ tick by tick

export function dramaStep(c: Colony, n: Nat): void {
  const t = c.tick;
  const l = n.lost;
  if (l) {
    const kid = pawnById(c, l.a);
    if (!kid || kid.gone) delete n.lost;
    else if (t >= l.t1) {
      // only a child the colony knew was missing comes home to a welcome; otherwise nobody noticed
      if (l.told) {
        log(c, 'n_lost_home', kid.id);
        note(c, kid, 'n_lost_home');
        think(c, kid, 'lostwoods');
      }
      delete n.lost;
    } else if (t >= l.s && !l.told) {
      l.told = 1;
      const par = pawnById(c, kid.mo) ?? pawnById(c, kid.fa);
      log(c, 'n_lost', kid.id, par?.id);
      for (const p of c.pawns) if (p.id === kid.mo || p.id === kid.fa) think(c, p, 'childlost', kid.id);
    }
  }
  const e = n.el;
  if (e) {
    const a = pawnById(c, e.a);
    const b = pawnById(c, e.b);
    if (!a || !b || a.gone || b.gone || a.sp !== b.id) delete n.el;
    else if (t >= e.t1) eloped(c, n, a, b);
    else if (t >= e.t0 && !e.told) { e.told = 1; log(c, 'n_elope', a.id, b.id, undefined, e.by); }
  }
  const d = n.duel;
  if (d && t >= d.t + 12) duelOut(c, n);
}

function eloped(c: Colony, n: Nat, a: Pawn, b: Pawn): void {
  const e = n.el!;
  delete n.el;
  getRel(a, b.id).k = 'spouse';
  getRel(b, a.id).k = 'spouse';
  const keep = a.sex !== b.sex ? (a.sex === 1 ? a : b) : a.id < b.id ? a : b;
  const take = keep === a ? b : a;
  const old = take.fam;
  take.fam = keep.fam;
  think(c, a, 'eloped', b.id);
  think(c, b, 'eloped', a.id);
  log(c, 'n_eloped', a.id, b.id, old, e.by);
  note(c, a, 'n_eloped', b.id);
  note(c, b, 'n_eloped', a.id);
  bump(c, 'weddings');
  const by = e.by ? pawnById(c, e.by) : undefined;
  for (const x of [a, b]) for (const pid of [x.mo, x.fa]) {
    const par = pid ? pawnById(c, pid) : undefined;
    if (par && !par.gone && stage(c, par) >= STAGE.ADULT) think(c, par, par === by ? 'elopedchild' : 'weddingguest', x === a ? b.id : a.id);
  }
  // the parent who forbade it does not forgive the other family
  if (by && !by.gone && !n.feud && per(by, AX.TEMPER) > 0) {
    const child = a.mo === by.id || a.fa === by.id ? a : b;
    const partner = child === a ? b : a;
    const theirs = partner === take ? old : partner.fam;
    const fams = families(c);
    if (theirs !== by.fam && (fams.get(by.fam)?.length ?? 0) >= 2 && (fams.get(theirs)?.length ?? 0) >= 2) {
      const r = new Rand(c.seed, S.NATURE, c.tick, 43);
      const foe = (fams.get(theirs) ?? []).find((p) => p !== partner) ?? (fams.get(theirs) ?? [])[0];
      if (foe && r.chance(0.6)) startFeud(c, n, by, foe, 'elope', r);
    }
  }
  for (const x of [a, b]) if (c.tick >= x.act.ta) x.act.t1 = Math.min(x.act.t1, c.tick + 1);
}

function duelOut(c: Colony, n: Nat): void {
  const d = n.duel!;
  delete n.duel;
  const A = pawnById(c, d.a);
  const B = pawnById(c, d.b);
  const X = pawnById(c, d.o);
  if (!A || !B || A.gone || B.gone) return;
  const t = c.tick;
  const here = (p: Pawn): boolean => p.act.k === 'duel' && t >= p.act.ta;
  if (!here(A) || !here(B)) {
    const shy = !here(A) ? A : B;
    const other = shy === A ? B : A;
    log(c, 'n_duel_off', shy.id, other.id);
    think(c, shy, 'duelshy');
    return;
  }
  const r = new Rand(c.seed, S.NATURE, t, 44);
  const power = (p: Pawn): number => p.sk[0] + per(p, AX.BRAVE) * 2 + p.hp / 50 + r.float() * 6;
  const win = power(A) >= power(B) ? A : B;
  const lose = win === A ? B : A;
  wound(c, lose, 'cut', 5 + r.int(5), r);
  let how = 'won';
  if (X && !X.gone) {
    if (win === A && X.sp === B.id) {
      const lean = 0.35 + (opinion(c, X, A) - opinion(c, X, B)) / 120;
      if (r.chance(Math.max(0.1, Math.min(0.8, lean)))) {
        breakup(c, X, B);
        if (!X.sp && !A.sp) { becomeLovers(c, X, A); how = 'heart'; }
      }
    } else if (X.sp === win.id) how = 'kept';
    else if (!X.sp && !win.sp && r.chance(Math.max(0.15, Math.min(0.7, 0.4 + opinion(c, X, win) / 150)))) { becomeLovers(c, X, win); how = 'heart'; }
    if (lose.crush === X.id) lose.crush = 0;
  }
  think(c, win, 'duelwon', lose.id);
  think(c, lose, 'duellost', win.id);
  if (X && !X.gone) {
    if (per(X, AX.KIND) > 0.4) { think(c, X, 'duelfools', A.id); think(c, X, 'duelfools', B.id); } else think(c, X, 'dueledover');
  }
  for (const p of c.pawns) if (p !== A && p !== B && stage(c, p) >= STAGE.CHILD && Math.max(Math.abs(p.x - d.x), Math.abs(p.y - d.y)) <= 12) think(c, p, 'sawduel');
  log(c, 'n_duel', win.id, lose.id, how, X?.id);
  note(c, win, 'n_duel_won', lose.id, X ? String(X.id) : '');
  note(c, lose, 'n_duel_lost', win.id, X ? String(X.id) : '');
  bump(c, 'duels');
  for (const x of [A, B]) if (t >= x.act.ta) x.act.t1 = Math.min(x.act.t1, t + 1);
}

/** For decide(): the lost child, the search party, the lovers slipping away, the duellists. */
export function dramaAct(c: Colony, n: Nat, p: Pawn, r: Rand, st: number, hour: number, go: Go): boolean {
  const t = c.tick;
  const l = n.lost;
  if (l && t >= l.t0 && t < l.t1) {
    if (p.id === l.a) {
      // off after a stray goat, and then nothing looks familiar
      if (p.x === l.x && p.y === l.y) { if (go('hide', l.x, l.y, 20, 'lost')) return true; }
      else if (go('wander', l.x, l.y, 20, 'lost')) return true;
      l.t1 = t;
      return false;
    }
    if (t >= l.s && st >= STAGE.ADULT && st !== STAGE.ELDER && !p.brk && !p.thrall && p.hp > 55 && p.food >= 15) {
      const kid = pawnById(c, l.a);
      const kin = kid && (p.id === kid.mo || p.id === kid.fa);
      const busy = aidCount(c);
      if (kid && busy[AID.SEARCH] < 9 && (kin || p.prof === 'hunter' || p.prof === 'scout' || p.prof === 'guard' || r.chance(0.3))) {
        const at = posAt(c, kid, t);
        const kx = at % c.w;
        const ky = Math.floor(at / c.w);
        const R = Math.max(4, 16 - Math.floor((t - l.s) / (3 * H)));
        const i = openNear(c, r, kx, ky, 0, R, 12);
        if (i >= 0 && go('aid', i % c.w, Math.floor(i / c.w), 6, 'search', { d: AID.SEARCH, o: kid.id })) { busy[AID.SEARCH]++; return true; }
      }
    }
  }
  const e = n.el;
  if (e && (p.id === e.a || p.id === e.b) && t >= e.t0 && t < e.t1) {
    const other = p.id === e.a ? e.b : e.a;
    if (go('court', e.x + (p.id === e.b ? 1 : 0), e.y, e.t1 - t, 'elope', { o: other })) return true;
  }
  const d = n.duel;
  if (d && (p.id === d.a || p.id === d.b) && t >= d.t - 20 && t < d.t + 12) {
    const other = p.id === d.a ? d.b : d.a;
    if (go('duel', d.x + (p.id === d.b ? 1 : 0), d.y, d.t + 12 - t, 'duel', { o: other })) return true;
  }
  void hour;
  return false;
}

/** A searcher finishes a sweep of the woods: close enough, and the child is found. */
export function dramaDone(c: Colony, n: Nat, p: Pawn, r: Rand): void {
  const l = n.lost;
  if (!l) return;
  const kid = pawnById(c, l.a);
  if (!kid) return;
  const at = posAt(c, kid, c.tick);
  if (Math.max(Math.abs((at % c.w) - p.x), Math.abs(Math.floor(at / c.w) - p.y)) > 3 || !r.chance(0.7)) return;
  delete n.lost;
  log(c, 'n_found', p.id, kid.id);
  note(c, p, 'n_found', kid.id);
  note(c, kid, 'n_lost_found', p.id);
  think(c, p, 'foundchild', kid.id);
  think(c, kid, 'wasfound', p.id);
  for (const q of c.pawns) if (q.id === kid.mo || q.id === kid.fa) { if (q !== p) think(c, q, 'childfound', p.id); else think(c, q, 'childback', kid.id); }
  if (c.tick >= kid.act.ta) kid.act.t1 = Math.min(kid.act.t1, c.tick + 1);
}

/** Called at the end of a wedding: two noble houses joined is a grander thing. */
export function nobleWedding(c: Colony, a: Pawn, b: Pawn, old: string, there: Pawn[]): void {
  const nw = c.nat?.nw;
  const match = !!nw && ((nw.a === a.id && nw.b === b.id) || (nw.a === b.id && nw.b === a.id));
  if (!match && !(a.rank >= 5 && b.rank >= 5 && old !== a.fam)) return;
  const house = match ? nw!.h : '';
  if (c.nat && match) delete c.nat.nw;
  const cost = Math.min(c.stock.silver, 15);
  c.stock.silver -= cost;
  for (const p of there) if (p !== a && p !== b) { think(c, p, 'noblefeast'); p.joy = Math.min(100, p.joy + 15); }
  log(c, 'n_noble_wed', a.id, b.id, `${old}|${a.fam}|${house}`, Math.max(0, there.length - 2));
  bump(c, 'nobleWeddings');
}
