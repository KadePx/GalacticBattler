// The long arcs of a life: love, marriage, children, growing up, growing old, dying, and the
// gatherings (weddings, funerals) that mark them.

import { HARD_CAP, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR } from '../config';
import { touch } from './cache';
import { cells } from './data/buildings';
import { RACES, childRace } from './data/races';
import { TRAITS } from './data/traits';
import { bump, log, note } from './events';
import { dailyHealth } from './health';
import { maybeSaint, sermonEnd } from './faith';
import { verdict } from './crime';
import { passHeirloom } from './player';
import { ask } from './ask';
import { getRel, think } from './mood';
import { STAGE, ageYears, has, makePawn, mkAct, pawnById, per, person, posAt, rollPassions, rollTraits, stage, stat, toDead } from './pawn';
import { Rand, S } from './rng';
import { addFact, attracted, learn, opinion } from './social';
import { AX, B, type Bld, type Colony, type Id, type Pawn } from './types';

export function closeKin(c: Colony, a: Pawn, b: Pawn): boolean {
  if (a.mo === b.id || a.fa === b.id || b.mo === a.id || b.fa === a.id) return true;
  if ((a.mo && a.mo === b.mo) || (a.fa && a.fa === b.fa)) return true;
  const up = (x: Pawn, y: Pawn): boolean => {
    for (const id of [x.mo, x.fa]) {
      const g = person(c, id);
      if (!g) continue;
      if (g.mo === y.id || g.fa === y.id) return true; // y is x's grandparent
      if ((g.mo && g.mo === y.mo) || (g.fa && g.fa === y.fa)) return true; // y is x's aunt or uncle
    }
    return false;
  };
  return up(a, b) || up(b, a);
}

export function becomeLovers(c: Colony, p: Pawn, o: Pawn): void {
  const rp = getRel(p, o.id);
  const ro = getRel(o, p.id);
  rp.k = 'lover'; ro.k = 'lover';
  rp.s = c.tick; ro.s = c.tick;
  rp.f = undefined; ro.f = undefined;
  p.sp = o.id;
  o.sp = p.id;
  think(c, p, 'newlove', o.id);
  think(c, o, 'newlove', p.id);
  log(c, 'lovers', p.id, o.id);
  note(c, p, 'lovers', o.id);
  note(c, o, 'lovers', p.id);
  bump(c, 'romances');
}

export function propose(c: Colony, p: Pawn, o: Pawn, opB: number): boolean {
  // a player's colonist gets to think it over
  if (o.owner) { if (!o.ask) ask(c, o, 'propose', p.id); return true; }
  if (opB >= 45) {
    getRel(p, o.id).k = 'betrothed';
    getRel(o, p.id).k = 'betrothed';
    think(c, p, 'proposed', o.id);
    think(c, o, 'proposed', p.id);
    log(c, 'betrothed', p.id, o.id);
    note(c, p, 'betrothed', o.id);
    note(c, o, 'betrothed', p.id);
    return true;
  }
  think(c, p, 'proposalno', o.id);
  log(c, 'refused', p.id, o.id);
  return false;
}

export function breakup(c: Colony, leaver: Pawn, other: Pawn): void {
  const rl = getRel(leaver, other.id);
  const ro = getRel(other, leaver.id);
  const wed = rl.k === 'spouse';
  rl.k = 'ex'; ro.k = 'ex';
  if (leaver.sp === other.id) leaver.sp = 0;
  if (other.sp === leaver.id) other.sp = 0;
  think(c, leaver, 'brokeup', other.id);
  think(c, other, 'dumped', leaver.id);
  log(c, wed ? 'divorce' : 'breakup', leaver.id, other.id);
  note(c, leaver, wed ? 'divorce' : 'breakup', other.id);
  note(c, other, wed ? 'divorced' : 'dumped', leaver.id);
  bump(c, wed ? 'divorces' : 'breakups');
  // someone waiting in the wings?
  for (const x of [leaver, other]) {
    if (x.sp) continue;
    for (const key in x.rel) {
      if (x.rel[key].k !== 'lover') continue;
      const l = pawnById(c, +key);
      if (l && !l.sp) {
        x.sp = l.id;
        l.sp = x.id;
        log(c, 'lovers', x.id, l.id);
        break;
      }
    }
  }
}

export function tryConceive(c: Colony, a: Pawn, b: Pawn, r: Rand): void {
  if (a.sex === b.sex) return;
  const f = a.sex === 0 ? a : b;
  const m = f === a ? b : a;
  if (f.preg || stage(c, f) !== STAGE.ADULT || stage(c, m) < STAGE.ADULT) return;
  if (!childRace(f.race, m.race)) return;
  if (c.pawns.length >= HARD_CAP) return;
  if (ageYears(c, f) > RACES[f.race].old * 0.85) return;
  let kids = 0;
  let young = 0;
  for (const p of c.pawns) if (p.mo === f.id) { kids++; if (stage(c, p) === STAGE.BABY) young++; }
  if (kids >= 6 || young >= 1) return;
  const crowd = c.pawns.length >= 30 ? 0.4 : 1;
  if (!r.chance(0.2 * RACES[f.race].fert * crowd)) return;
  f.preg = { x: c.tick + RACES[f.race].preg * TICKS_PER_DAY, fa: m.id };
  log(c, 'pregnant', f.id, m.id);
}

function birth(c: Colony, mo: Pawn, r: Rand): void {
  const preg = mo.preg!;
  mo.preg = undefined;
  const fa = person(c, preg.fa);
  if (r.chance(has(mo, 'frail') ? 0.12 : 0.05)) {
    think(c, mo, 'stillbirth');
    const dad = pawnById(c, preg.fa);
    if (dad && dad.sp === mo.id) think(c, dad, 'stillbirth');
    log(c, 'stillbirth', mo.id);
    note(c, mo, 'stillbirth');
    bump(c, 'stillbirths');
    return;
  }
  const race = (fa && childRace(mo.race, fa.race)) || mo.race;
  const baby = makePawn(c, r, { race, age: 0, fam: mo.fam, mo: mo.id, fa: preg.fa });
  baby.born = c.tick;
  const mi = posAt(c, mo, c.tick);
  baby.x = mi % c.w;
  baby.y = Math.floor(mi / c.w);
  baby.act = mkAct('idle', c.tick, baby.x, baby.y, 1, 'born');
  baby.food = 80; baby.rest = 80; baby.joy = 80; baby.soc = 80; baby.cloth = 100;
  const src = fa && r.chance(0.5) ? fa : mo;
  baby.look.skin = src.look.skin;
  baby.look.hairCol = (fa && r.chance(0.5) ? fa : mo).look.hairCol;
  baby.look.eyes = (fa && r.chance(0.5) ? fa : mo).look.eyes;
  baby.faith = mo.faith;
  const pool = [...mo.traits, ...(fa ? fa.traits : [])].filter((k) => { const g = TRAITS[k]?.group; return g === 'body' || g === 'temper' || g === 'mind'; });
  baby.traits = pool.length && r.chance(0.6) ? [r.pick(pool)] : rollTraits(r, 1);
  for (let k = 0; k < baby.per.length; k++) {
    const mid = (mo.per[k] + ((fa as Pawn | undefined)?.per?.[k] ?? mo.per[k])) / 2;
    baby.per[k] = Math.round((mid * 0.6 + (r.float() + r.float() - 1) * 0.6) * 100) / 100;
  }
  c.pawns.push(baby);
  think(c, mo, 'gavebirth');
  note(c, mo, 'birth', baby.id);
  const dad = pawnById(c, preg.fa);
  const husband = mo.sp && mo.rel[mo.sp]?.k === 'spouse' ? pawnById(c, mo.sp) : undefined;
  if (dad && (dad.sp === mo.id || !husband)) { think(c, dad, 'childborn'); note(c, dad, 'birth', baby.id); }
  for (const p of c.pawns) if (p !== mo && p !== dad && p !== baby && stage(c, p) >= STAGE.CHILD) think(c, p, 'birthincolony');
  log(c, 'birth', baby.id, mo.id, undefined, preg.fa);
  bump(c, 'births');
  if (husband && husband.id !== preg.fa) {
    const f = addFact(c, 'bastard', baby.id, preg.fa, true, String(mo.id));
    learn(c, mo, f);
    bump(c, 'bastards');
    const plain = childRace(mo.race, husband.race) !== race;
    if (plain) {
      // nobody could miss it
      for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) learn(c, p, f);
      log(c, 'bastard_plain', baby.id, mo.id, undefined, husband.id);
    }
  }
  const midwife = c.pawns.some((p) => p !== mo && p.sk[8] >= 6 && stage(c, p) >= STAGE.ADULT);
  if (r.chance((midwife ? 0.012 : 0.04) / stat(mo, 'tough'))) die(c, mo, 'childbirth');
}

function comeOfAge(c: Colony, p: Pawn, r: Rand): void {
  if (!p.bc) p.bc = 'colonyborn';
  p.ba = 'homegrown';
  p.traits = rollTraits(r, r.chance(0.5) ? 3 : 2, p.traits);
  p.pas = rollPassions(r, p.sk, 2 + r.int(3));
  think(c, p, 'comingofage');
  log(c, 'adult', p.id);
  note(c, p, 'adult');
}

/** Someone dies. Everyone who knew them feels it. */
export function die(c: Colony, p: Pawn, cause: string, by?: Id): void {
  if (p.gone) return;
  p.gone = true;
  const d = toDead(c, p, cause, by);
  c.dead.push(d);
  log(c, 'death', p.id, by, cause);
  bump(c, 'deaths');
  bump(c, 'death_' + cause);
  maybeSaint(c, d, p);
  passHeirloom(c, p);
  const pi = posAt(c, p, c.tick);
  const px = pi % c.w;
  const py = Math.floor(pi / c.w);
  for (const o of c.pawns) {
    if (o === p || o.gone) continue;
    const so = stage(c, o);
    if (so < STAGE.CHILD) { if (o.sp === p.id) o.sp = 0; continue; }
    const rel = o.rel[p.id];
    let k = '';
    if (o.sp === p.id || rel?.k === 'lover' || rel?.k === 'spouse' || rel?.k === 'betrothed') k = 'died_spouse';
    else if (p.mo === o.id || p.fa === o.id) k = 'died_child';
    else if (o.mo === p.id || o.fa === p.id) k = 'died_parent';
    else if ((o.mo && o.mo === p.mo) || (o.fa && o.fa === p.fa)) k = 'died_sibling';
    else if (rel?.f === 1) k = 'died_friend';
    else if (rel?.f === -1) k = 'died_rival';
    else if (opinion(c, o, p) > -20) k = 'died_colonist';
    if (k) think(c, o, k, p.id);
    if (k && k !== 'died_colonist' && k !== 'died_rival') note(c, o, 'lost', p.id, k.slice(5));
    if (o.sp === p.id) o.sp = 0;
    if (rel?.k && rel.k !== 'ex') rel.k = undefined;
    const oi = posAt(c, o, c.tick);
    if (!(o.act.k === 'sleep') && Math.abs((oi % c.w) - px) <= 4 && Math.abs(Math.floor(oi / c.w) - py) <= 4 && cause !== 'age') think(c, o, 'sawdeath', p.id);
  }
  for (const b of c.blds) for (let i = 0; i < b.beds.length; i++) if (b.beds[i] === p.id) b.beds[i] = 0;
  bury(c);
}

/** Someone leaves the colony alive (runs off, or goes with settlers). */
export function depart(c: Colony, p: Pawn, cause: string): void {
  if (p.gone) return;
  p.gone = true;
  c.dead.push(toDead(c, p, cause, undefined, true));
  log(c, 'left', p.id, undefined, cause);
  if (cause === 'exiled' || cause === 'moved' || cause === 'escaped') c.out.push({ k: 'migrant', t: c.tick, from: c.id, fromName: c.name, why: cause, pawn: JSON.parse(JSON.stringify({ ...p, gone: undefined })) });
  bump(c, 'departures');
  for (const o of c.pawns) {
    if (o === p || o.gone) continue;
    if (o.sp === p.id) { o.sp = 0; think(c, o, 'dumped', p.id); }
    const rel = o.rel[p.id];
    if (rel?.k && rel.k !== 'ex') rel.k = 'ex';
  }
  for (const b of c.blds) for (let i = 0; i < b.beds.length; i++) if (b.beds[i] === p.id) b.beds[i] = 0;
}

/** Give the unburied dead a grave if there is a graveyard with room. */
export function bury(c: Colony): void {
  const yards = c.blds.filter((b) => b.k === 'graveyard' && b.built);
  if (!yards.length) return;
  for (const d of c.dead) {
    if (d.grave >= 0 || d.left || c.tick - d.died > TICKS_PER_DAY * 30) continue;
    for (const y of yards) {
      let placed = false;
      for (const cell of cells(y.k)) {
        if (cell.ch !== ',') continue;
        // leave every other row and column free so mourners can walk between the graves
        if (cell.dx % 2 === 0 || cell.dy % 2 === 0) continue;
        const i = (y.y + cell.dy) * c.w + y.x + cell.dx;
        if (c.st[i] !== B.NONE) continue;
        c.st[i] = B.GRAVE;
        d.grave = i;
        placed = true;
        touch(c);
        break;
      }
      if (placed) break;
    }
  }
}

function spotIn(c: Colony, b: Bld | undefined): [number, number] {
  if (!b) return [c.cx, c.cy];
  return [b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2)];
}

/** Once a day: age, births, deaths of old age, couples drifting together or apart, gatherings. */
export function dailyLife(c: Colony): void {
  const t = c.tick;
  const dayYears = TICKS_PER_DAY / TICKS_PER_YEAR;
  for (const p of c.pawns.slice()) {
    if (p.gone) continue;
    const R = RACES[p.race];
    const age = ageYears(c, p);
    if (age >= R.adult && age - dayYears < R.adult) comeOfAge(c, p, new Rand(c.seed, S.PAWN, t, p.id));
    else if (!p.bc && age >= R.adult * 0.5) p.bc = 'colonyborn';
    if (p.preg && p.preg.x <= t) birth(c, p, new Rand(c.seed, S.BIRTH, t, p.id));
    if (p.gone) continue;
    if (age > R.old) {
      const f = (age - R.old) / (R.max - R.old);
      const chance = age >= R.max ? 0.2 : (0.0005 + f * f * 0.03) / stat(p, 'tough');
      if (new Rand(c.seed, S.DEATH, t, p.id).chance(chance)) { die(c, p, 'age'); continue; }
    }
    dailyHealth(c, p);
    p.cloth = Math.max(0, p.cloth - (stage(c, p) <= STAGE.CHILD ? 0.2 : 0.4));
    if (p.cloth < 30 && c.stock.clothes >= 1) { c.stock.clothes -= 1; p.cloth = 100; }
  }

  // Hearts: the unattached settle on someone, wisely or not
  for (const p of c.pawns) {
    if (p.gone || stage(c, p) < STAGE.ADULT) continue;
    if (p.crush) {
      const o = pawnById(c, p.crush);
      if (!o || o.gone || p.sp === o.id || (p.sp && !has(p, 'lecher')) || (o.sp && o.sp !== p.id && !has(p, 'lecher') && !has(p, 'jealous'))) p.crush = 0;
    }
    if (p.crush || p.sp || has(p, 'chaste') || (t / TICKS_PER_DAY + p.id) % 4 !== 0) continue;
    const rr = new Rand(c.seed, S.LOVE, t, p.id, 9);
    let best: Pawn | undefined;
    let score = 8;
    for (const o of c.pawns) {
      if (o === p || o.gone || o.sp) continue;
      const op = opinion(c, p, o);
      if (!attracted(c, p, o, op)) continue;
      const s = op + stat(o, 'beauty') * 8 + (o.crush === p.id ? 12 : 0) + rr.float() * 22;
      if (s > score) { score = s; best = o; }
    }
    if (best) p.crush = best.id;
  }

  // Couples
  for (const p of c.pawns) {
    if (p.gone || !p.sp || p.id > p.sp) continue;
    const o = pawnById(c, p.sp);
    if (!o || o.gone) { p.sp = 0; continue; }
    if (o.sp !== p.id) { p.sp = 0; continue; }
    const a = opinion(c, p, o);
    const b = opinion(c, o, p);
    const wed = p.rel[o.id]?.k === 'spouse';
    if (a < -12 || b < -12) {
      const rr = new Rand(c.seed, S.LOVE, t, p.id);
      if (rr.chance(wed ? 0.05 : 0.22)) { breakup(c, a < b ? p : o, a < b ? o : p); continue; }
    }
    // a night together, if they share a roof
    if (p.home && p.home === o.home && p.act.k === 'sleep' && o.act.k === 'sleep') {
      const rr = new Rand(c.seed, S.LOVE, t, p.id, 3);
      if (rr.chance(0.3)) {
        think(c, p, 'lovin', o.id);
        think(c, o, 'lovin', p.id);
        tryConceive(c, p, o, rr);
      }
    }
  }

  bury(c);

  // Plan the next gathering
  if (!c.gath) {
    const start = t + TICKS_PER_DAY;
    for (const d of c.dead) {
      if (d.fun || d.left || t - d.died > TICKS_PER_DAY * 4) continue;
      d.fun = 1;
      const yard = c.blds.find((b) => b.k === 'graveyard' && b.built);
      const hall = yard ?? c.blds.find((b) => b.k === 'shrine' && b.built) ?? c.blds.find((b) => b.k === 'hall' && b.built);
      const [x, y] = d.grave >= 0 ? [d.grave % c.w, Math.floor(d.grave / c.w)] : spotIn(c, hall);
      c.gath = { k: 'funeral', t0: start + 10 * TICKS_PER_HOUR, t1: start + 12 * TICKS_PER_HOUR, b: hall?.id ?? 0, a: d.id, x, y };
      break;
    }
    if (!c.gath) {
      for (const p of c.pawns) {
        if (!p.sp || p.id > p.sp || p.rel[p.sp]?.k !== 'betrothed') continue;
        const hall = c.blds.find((b) => b.k === 'shrine' && b.built) ?? c.blds.find((b) => b.k === 'hall' && b.built);
        const [x, y] = spotIn(c, hall);
        c.gath = { k: 'wedding', t0: start + 15 * TICKS_PER_HOUR, t1: start + 18 * TICKS_PER_HOUR, b: hall?.id ?? 0, a: p.id, o: p.sp, x, y };
        log(c, 'wedding_set', p.id, p.sp);
        break;
      }
    }
  }
}

/** A gathering ends: the vows are said, the grave is filled. */
export function endGathering(c: Colony): void {
  const g = c.gath;
  if (!g) return;
  c.gath = undefined;
  const there = c.pawns.filter((p) => !p.gone && p.act.k === 'attend' && c.tick >= p.act.ta);
  if (g.k === 'wedding') {
    const a = pawnById(c, g.a ?? 0);
    const b = pawnById(c, g.o ?? 0);
    if (!a || !b || a.rel[b.id]?.k !== 'betrothed' || !there.includes(a) || !there.includes(b)) {
      if (a && b && a.rel[b.id]?.k === 'betrothed') log(c, 'wedding_off', a.id, b.id);
      return;
    }
    getRel(a, b.id).k = 'spouse';
    getRel(b, a.id).k = 'spouse';
    think(c, a, 'wedding', b.id);
    think(c, b, 'wedding', a.id);
    // one name for the new household
    const keep = a.sex !== b.sex ? (a.sex === 1 ? a : b) : a.id < b.id ? a : b;
    const take = keep === a ? b : a;
    const old = take.fam;
    take.fam = keep.fam;
    let ale = 0;
    for (const p of there) {
      if (p === a || p === b) continue;
      think(c, p, 'weddingguest');
      if (c.stock.ale >= 1 && !has(p, 'teetotal') && stage(c, p) >= STAGE.ADULT) { c.stock.ale -= 1; p.drunk += 35; ale++; }
    }
    log(c, 'wedding', a.id, b.id, old, there.length - 2);
    note(c, a, 'wedding', b.id);
    note(c, b, 'wedding', a.id);
    bump(c, 'weddings');
    void ale;
  } else if (g.k === 'funeral') {
    for (const p of there) think(c, p, 'funeral');
    log(c, 'funeral', g.a, undefined, undefined, there.length);
  } else if (g.k === 'trial') {
    verdict(c, there);
  } else if (g.k === 'sermon') {
    sermonEnd(c, g.a ?? 0, there);
  } else if (g.k === 'feast') {
    // the best of the larder, and as much ale as will go round
    let ale = 0;
    for (const p of there) {
      think(c, p, 'festival');
      p.food = Math.min(100, p.food + 40);
      p.joy = Math.min(100, p.joy + 30);
      c.stock.meal = Math.max(0, c.stock.meal - 0.6);
      if (c.stock.ale >= 1 && !has(p, 'teetotal') && stage(c, p) >= STAGE.ADULT) { c.stock.ale -= 1; p.drunk += 35; p.booze += 1; ale++; }
    }
    log(c, 'feast', undefined, undefined, undefined, there.length);
    void ale;
  } else if (g.k === 'audience') {
    // those with a grievance or a need come before the seat
    const ruler = pawnById(c, g.a ?? 0);
    if (!ruler || !there.includes(ruler)) return;
    const askers = there.filter((p) => p !== ruler && stage(c, p) >= STAGE.ADULT).sort((a, b) => a.coin - b.coin || a.id - b.id);
    const p = askers[0];
    if (!p) return;
    const kind = opinion(c, ruler, p) + per(ruler, AX.KIND) * 20 - per(ruler, AX.GREED) * 10;
    if (kind > 5 && ruler.coin >= 4) {
      ruler.coin -= 4;
      p.coin += 4;
      think(c, p, 'gift', ruler.id);
      for (const o of there) if (o !== p && o !== ruler) think(c, o, 'goodrule', ruler.id);
      log(c, 'audience', ruler.id, p.id, 'granted');
    } else {
      think(c, p, 'slighted', ruler.id);
      if (kind < -20) for (const o of there) if (o !== ruler && opinion(c, o, p) > 20) think(c, o, 'badrule', ruler.id);
      log(c, 'audience', ruler.id, p.id, 'refused');
    }
  }
}

