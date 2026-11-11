// What a colonist does next, and what comes of what they just did. Every choice carries a
// short reason so the UI can explain it.

import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOf, seasonOf } from '../config';
import { SHORE, cacheOf, featList } from './cache';
import { spots } from './data/buildings';
import { RACES } from './data/races';
import { foodDays, hasFood, takeMeal } from './econ';
import { bump, log } from './events';
import { attack, canFight, pickFoe } from './combat';
import { isDown, needsRest } from './health';
import { bedFor, findJob, finishWork } from './jobs';
import { feltTemp, hasThought, think } from './mood';
import { findPath, walkTicks } from './path';
import { STAGE, gainXp, has, idleAct, mkAct, pawnById, per, posAt, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { addFact, attracted, favourite, insult, interact, learn, opinion } from './social';
import { AX, type ActK, type Bld, type Colony, type Pawn, type WorkK } from './types';

interface ActOpts { adj?: boolean; b?: number; o?: number; w?: WorkK; d?: number }

/** On the night watch: sleeps by day. */
const nightShift = (p: Pawn): boolean => p.prof === 'guard' && p.id % 2 === 0;

function moveMult(c: Colony, p: Pawn, st: number): number {
  let v = stat(p, 'move');
  if (st === STAGE.CHILD || st === STAGE.ELDER) v *= 0.8;
  else if (st === STAGE.BABY) v *= 0.4;
  if (p.hp < 50) v *= 0.7;
  if (p.drunk > 60) v *= 0.8;
  return v;
}

/** Walk to (x,y) and do something there for dur ticks. False if there is no way to get there. */
export function setAct(c: Colony, p: Pawn, k: ActK, x: number, y: number, dur: number, why: string, o: ActOpts = {}): boolean {
  const found = findPath(c, p.x, p.y, x, y, !!o.adj);
  if (!found) return false;
  const t = c.tick;
  const walk = walkTicks(found.cost, moveMult(c, p, stage(c, p)));
  const end = found.path[found.path.length - 1];
  p.act = { k, t0: t, ta: t + walk, t1: t + walk + Math.max(1, dur), sx: p.x, sy: p.y, tx: end % c.w, ty: Math.floor(end / c.w), path: undefined, w: o.w, b: o.b, o: o.o, d: o.d, why };
  if (found.path.length > 1) {
    p.act.path = found.path;
    for (const i of found.path) if (c.wear[i] < 250) c.wear[i] += 2;
  }
  return true;
}

const bldOf = (c: Colony, k: string): Bld | undefined => c.blds.find((b) => b.k === k && b.built);

function taken(c: Colony, self: Pawn, x: number, y: number): boolean {
  for (const o of c.pawns) if (o !== self && o.act.tx === x && o.act.ty === y) return true;
  return false;
}

/** A free seat (or other furniture) in a building, else any floor tile inside. */
function seat(c: Colony, p: Pawn, b: Bld, chars: string, r: Rand): [number, number] {
  const list = spots(b.k, chars);
  const start = list.length ? r.int(list.length) : 0;
  for (let k = 0; k < list.length; k++) {
    const cell = list[(start + k) % list.length];
    if (!taken(c, p, b.x + cell.dx, b.y + cell.dy)) return [b.x + cell.dx, b.y + cell.dy];
  }
  const floor = spots(b.k, '.');
  if (floor.length) {
    const cell = r.pick(floor);
    return [b.x + cell.dx, b.y + cell.dy];
  }
  return [b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2)];
}

function randomSpot(c: Colony, r: Rand, cx: number, cy: number, min: number, max: number): [number, number] | null {
  const k = cacheOf(c);
  for (let tries = 0; tries < 14; tries++) {
    const x = cx + r.range(-max, max);
    const y = cy + r.range(-max, max);
    if (x < 1 || y < 1 || x >= c.w - 1 || y >= c.h - 1) continue;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < min * min) continue;
    const i = y * c.w + x;
    if (!k.reach[i] || k.walk[i] > 20 || c.st[i]) continue;
    return [x, y];
  }
  return null;
}

function isNight(p: Pawn, hour: number): boolean {
  if (nightShift(p)) return hour >= 8 && hour < 16;
  if (has(p, 'nightowl')) return hour >= 2 && hour < 10;
  if (has(p, 'earlybird')) return hour >= 20 || hour < 4;
  return hour >= 22 || hour < 5;
}

function goEat(c: Colony, p: Pawn, r: Rand, why: string): boolean {
  const hall = bldOf(c, 'hall') ?? bldOf(c, 'tavern');
  if (hall && stage(c, p) > STAGE.BABY) {
    const [x, y] = seat(c, p, hall, 'c', r);
    if (setAct(c, p, 'eat', x, y, 3, why, { b: hall.id })) return true;
  }
  return setAct(c, p, 'eat', p.x, p.y, 3, why);
}

function goSleep(c: Colony, p: Pawn, why: string): boolean {
  const sl = stat(p, 'sleep');
  const dur = Math.max(20, Math.min(120, Math.ceil(((100 - p.rest) / (11.5 / sl)) * TICKS_PER_HOUR) + 4));
  const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
  if (home) {
    const cell = spots(home.k, 'b')[home.beds.indexOf(p.id)];
    if (cell && setAct(c, p, 'sleep', home.x + cell.dx, home.y + cell.dy, dur, why, { b: home.id })) return true;
  }
  const hall = bldOf(c, 'hall');
  if (hall && p.rest > 6) {
    const cell = spots(hall.k, '.');
    const pick = cell[(p.id * 7) % cell.length];
    if (setAct(c, p, 'sleep', hall.x + pick.dx, hall.y + pick.dy, dur, why)) return true;
  }
  return setAct(c, p, 'sleep', p.x, p.y, dur, why);
}

function attend(c: Colony, p: Pawn, r: Rand): boolean {
  const g = c.gath!;
  const k = cacheOf(c);
  for (let tries = 0; tries < 8; tries++) {
    const x = g.x + r.range(-2, 2);
    const y = g.y + r.range(-2, 2);
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
    const i = y * c.w + x;
    if (!k.walk[i] || !k.reach[i]) continue;
    if (setAct(c, p, 'attend', x, y, Math.max(1, g.t1 - c.tick), g.k)) { p.act.t1 = g.t1 + 1; return true; }
  }
  return false;
}

function wantsToAttend(c: Colony, p: Pawn, st: number): boolean {
  const g = c.gath!;
  if (st < STAGE.CHILD || p.brk || p.food < 12) return false;
  if (g.k === 'wedding') {
    if (p.id === g.a || p.id === g.o) return true;
    const a = pawnById(c, g.a ?? 0);
    const b = pawnById(c, g.o ?? 0);
    if (!a || !b) return false;
    return opinion(c, p, a) > -25 && opinion(c, p, b) > -25;
  }
  if (g.k === 'funeral') return p.rel[g.a ?? 0]?.f !== -1;
  return true;
}

function leisure(c: Colony, p: Pawn, r: Rand, st: number, hour: number, why: string): boolean {
  const hall = bldOf(c, 'hall');
  const tavern = bldOf(c, 'tavern');
  const shrine = bldOf(c, 'shrine');
  const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
  const pub = tavern ?? hall;
  const adult = st >= STAGE.ADULT;
  const evening = hour >= 17 || hour < 2;
  const fair = c.weather < 2 && c.temp > 2;
  const opts: [string, number][] = [];
  const w = (k: string, n: number): void => { if (n > 0) opts.push([k, n]); };

  if (p.soc < 50 || r.chance(0.2)) w('visit', 2.2 + per(p, AX.SOCIABLE) + (p.sp ? 1 : 0));
  if (p.crush && adult) w('woo', 2.4 + per(p, AX.FLIRT) * 0.6);
  if (pub && adult && c.stock.ale >= 1 && !has(p, 'teetotal') && p.drunk < (has(p, 'drunkard') ? 80 : 35)) w('drink', (has(p, 'drunkard') ? 5 : 1.1) * (p.race === 'dwarf' ? 1.6 : 1) * (evening ? 1.6 : 0.25));
  if (pub || home) w('relax', 2);
  if (fair && hour >= 6 && hour < 21) w('walk', 1 + (p.race === 'elf' ? 1.2 : 0) + (has(p, 'wanderlust') ? 1 : 0) + (has(p, 'loner') ? 0.8 : 0));
  if (p.dev >= 1) w('pray', p.dev * 0.7 + (has(p, 'pious') ? 1.5 : 0) + (p.mood < 35 ? 0.8 : 0));
  if (pub && adult && evening) w('dice', 0.9 + (p.ba === 'gambler' ? 2.5 : 0) + Math.max(0, per(p, AX.GREED)) * 0.5);
  if (adult && p.pas.some((x) => x > 0)) w('hobby', 1.3 + per(p, AX.DILIGENT) * 0.4);
  if ((hour >= 20 || hour < 4) && c.weather === 0) w('stargaze', 0.5 + Math.max(0, per(p, AX.CURIOUS)) + (p.race === 'elf' ? 0.8 : 0));
  if (fair && seasonOf(c.tick) === 1 && hour >= 8 && hour < 19 && featList(c, SHORE).length) w('bathe', 0.6);
  if (pub && adult && evening && (has(p, 'storyteller') || p.sk[10] >= 9)) w('perform', 1.6);
  const grief = p.th.find((t) => t.o && t.x > c.tick && (t.k === 'died_spouse' || t.k === 'died_child' || t.k === 'died_parent' || t.k === 'died_friend' || t.k === 'died_sibling'));
  const grave = grief ? c.dead.find((d) => d.id === grief.o && d.grave >= 0) : undefined;
  if (grave && hour >= 6 && hour < 21) w('mourn', 1.6);

  let total = 0;
  for (const o of opts) total += o[1];
  for (let tries = 0; tries < 3 && total > 0; tries++) {
    let roll = r.float() * total;
    let k = opts[0][0];
    for (const o of opts) {
      roll -= o[1];
      if (roll <= 0) { k = o[0]; break; }
    }
    const dur = 10 + r.int(10);
    switch (k) {
      case 'visit': {
        const o = favourite(c, p, r);
        if (!o) break;
        const oi = posAt(c, o, c.tick + 2);
        const love = o.id === p.sp || attracted(c, p, o, opinion(c, p, o));
        if (setAct(c, p, love && adult ? 'court' : 'visit', oi % c.w, Math.floor(oi / c.w), 6, o.id === p.sp ? 'love' : 'friend', { adj: true, o: o.id })) return true;
        break;
      }
      case 'woo': {
        const o = pawnById(c, p.crush);
        if (!o || o.gone || o.act.k === 'sleep') break;
        const oi = posAt(c, o, c.tick + 2);
        if (setAct(c, p, 'court', oi % c.w, Math.floor(oi / c.w), 6, 'crush', { adj: true, o: o.id })) return true;
        break;
      }
      case 'drink': {
        const [x, y] = seat(c, p, pub!, 'c', r);
        if (setAct(c, p, 'drink', x, y, dur + 4, why === 'bored' ? 'drinkbored' : 'drink', { b: pub!.id })) return true;
        break;
      }
      case 'relax': {
        const b = pub && (!home || r.chance(0.6)) ? pub : home!;
        const [x, y] = seat(c, p, b, 'c', r);
        if (setAct(c, p, 'relax', x, y, dur, 'relax', { b: b.id })) return true;
        break;
      }
      case 'walk': {
        const s = randomSpot(c, r, c.cx, c.cy, 9, 20);
        if (s && setAct(c, p, 'walk', s[0], s[1], 6, 'walk')) return true;
        break;
      }
      case 'pray': {
        if (shrine) {
          const [x, y] = seat(c, p, shrine, 'p', r);
          if (setAct(c, p, 'pray', x, y, dur, 'pray', { b: shrine.id })) return true;
        } else if (setAct(c, p, 'pray', p.x, p.y, 8, 'pray')) return true;
        break;
      }
      case 'dice': {
        const [x, y] = seat(c, p, pub!, 'c', r);
        if (setAct(c, p, 'dice', x, y, dur, 'dice', { b: pub!.id })) return true;
        break;
      }
      case 'hobby': {
        const mine: number[] = [];
        for (let s = 0; s < p.pas.length; s++) if (p.pas[s] > 0) mine.push(s);
        const s = r.pick(mine);
        const shop = s === 7 ? bldOf(c, 'smithy') : s === 6 ? bldOf(c, 'workshop') : s === 5 ? hall : undefined;
        const b = shop ?? home ?? hall;
        if (b) {
          const [x, y] = seat(c, p, b, 'cwlat', r);
          if (setAct(c, p, 'hobby', x, y, dur, 'hobby', { b: b.id, d: s })) return true;
        } else if (setAct(c, p, 'hobby', p.x, p.y, dur, 'hobby', { d: s })) return true;
        break;
      }
      case 'stargaze': {
        const s = randomSpot(c, r, c.cx, c.cy, 4, 12);
        if (s && setAct(c, p, 'stargaze', s[0], s[1], dur, 'stargaze')) return true;
        break;
      }
      case 'bathe': {
        const shore = featList(c, SHORE);
        const i = shore[r.int(Math.min(8, shore.length))];
        if (setAct(c, p, 'bathe', i % c.w, Math.floor(i / c.w), 8, 'bathe', { adj: true })) return true;
        break;
      }
      case 'perform': {
        let crowd = 0;
        for (const o of c.pawns) if (o !== p && o.act.b === pub!.id && c.tick >= o.act.ta && o.act.k !== 'sleep') crowd++;
        if (crowd < 3) break;
        const [x, y] = seat(c, p, pub!, '.', r);
        if (setAct(c, p, 'perform', x, y, 10, 'perform', { b: pub!.id })) return true;
        break;
      }
      case 'mourn': {
        if (grave && setAct(c, p, 'mourn', grave.grave % c.w, Math.floor(grave.grave / c.w), 8, 'grief', { adj: true, o: grave.id })) return true;
        break;
      }
      default: break;
    }
  }
  return false;
}

function breakAct(c: Colony, p: Pawn, r: Rand): boolean {
  const k = p.brk!.k;
  const left = Math.max(2, p.brk!.x - c.tick);
  switch (k) {
    case 'sulk': {
      const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
      if (home) {
        const cell = spots(home.k, 'b')[home.beds.indexOf(p.id)];
        if (cell && setAct(c, p, 'sulk', home.x + cell.dx, home.y + cell.dy, Math.min(left, 20), 'break')) return true;
      }
      const s = randomSpot(c, r, c.cx, c.cy, 10, 18);
      return !!s && setAct(c, p, 'sulk', s[0], s[1], Math.min(left, 20), 'break');
    }
    case 'bingefood': {
      const hall = bldOf(c, 'hall');
      if (hall) {
        const [x, y] = seat(c, p, hall, 'c', r);
        if (setAct(c, p, 'binge', x, y, 6, 'break', { b: hall.id })) return true;
      }
      return setAct(c, p, 'binge', p.x, p.y, 6, 'break');
    }
    case 'bingedrink': {
      const pub = bldOf(c, 'tavern') ?? bldOf(c, 'hall');
      if (pub && c.stock.ale >= 1) {
        const [x, y] = seat(c, p, pub, 'c', r);
        if (setAct(c, p, 'drink', x, y, 20, 'break', { b: pub.id })) return true;
      }
      return false;
    }
    case 'wander': {
      const s = randomSpot(c, r, c.cx, c.cy, 14, 30);
      return !!s && setAct(c, p, 'wander', s[0], s[1], Math.min(left, 15), 'break');
    }
    case 'tantrum': {
      const list = c.blds.filter((b) => b.built && b.k !== 'field' && b.k !== 'graveyard');
      if (!list.length) return false;
      const b = r.pick(list);
      return setAct(c, p, 'tantrum', b.x + Math.floor(b.w / 2), b.y + b.h, 6, 'break', { b: b.id });
    }
    case 'rave': {
      let best: Pawn | undefined;
      let bd = 1e9;
      for (const o of c.pawns) {
        if (o === p || o.act.k === 'sleep' || stage(c, o) < STAGE.TEEN) continue;
        const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y) + r.int(6);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return false;
      const oi = posAt(c, best, c.tick + 2);
      return setAct(c, p, 'rave', oi % c.w, Math.floor(oi / c.w), 4, 'break', { adj: true, o: best.id });
    }
    default: return false;
  }
}

/** Pick the next thing to do. */
export function decide(c: Colony, p: Pawn): void {
  const t = c.tick;
  const r = new Rand(c.seed, S.AI, t, p.id);
  const st = stage(c, p);
  const hour = hourOf(t);
  const night = isNight(p, hour);

  if (st === STAGE.BABY) {
    if (p.food < 45 && hasFood(c)) { if (setAct(c, p, 'eat', p.x, p.y, 3, 'hungry')) return; }
    if (p.rest < 35 || (night && p.rest < 85)) { if (goSleep(c, p, 'tired')) return; }
    const mo = pawnById(c, p.mo);
    const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
    if (home) {
      const cell = spots(home.k, '.');
      const pick = r.pick(cell);
      if (setAct(c, p, 'play', home.x + pick.dx, home.y + pick.dy, 20 + r.int(10), 'baby')) return;
    }
    if (mo && setAct(c, p, 'play', mo.x, mo.y, 15, 'baby', { adj: true })) return;
    p.act = idleAct(c, p, 20, 'baby');
    return;
  }

  if (p.brk?.k === 'seized') { p.act = idleAct(c, p, 4, 'seized'); return; }

  // Under attack: fight or hide (but nobody starves at their post)
  if (c.alarm && c.foes.length && st >= STAGE.CHILD && !(p.food < 12 && hasFood(c)) && c.tick - c.alarm < 150) {
    const able = canFight(c, p) && !p.brk;
    const f = able ? pickFoe(c, p) : null;
    if (f && !f.held && Math.max(Math.abs(f.x - c.cx), Math.abs(f.y - c.cy)) > 19) {
      // they have not come on yet: stand together in the middle of the colony rather than run out one by one
      const s = randomSpot(c, r, c.cx, c.cy, 0, 3);
      if (s && setAct(c, p, 'fight', s[0], s[1], 2, 'muster')) return;
    } else if (f) {
      const dist = Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y));
      const archer = p.sk[1] >= 4 && p.sk[1] > p.sk[0] + 1;
      if (archer && dist >= 2 && dist <= 9) {
        p.act = mkAct('fight', t, p.x, p.y, 1, 'alarm');
        p.act.d = f.id;
        p.act.b = 1;
        return;
      }
      if (setAct(c, p, 'fight', f.x, f.y, 1, 'alarm', { adj: true, d: f.id, b: 0 })) {
        const a = p.act;
        if (archer && a.path) {
          // archers stop as soon as they have a shot
          for (let k = 0; k < a.path.length; k++) {
            const i = a.path[k];
            if (Math.max(Math.abs((i % c.w) - f.x), Math.abs(Math.floor(i / c.w) - f.y)) <= 8) {
              const cut = (k + 1) / a.path.length;
              a.path = a.path.slice(0, k + 1);
              a.tx = i % c.w;
              a.ty = Math.floor(i / c.w);
              a.ta = a.t0 + Math.max(k ? 1 : 0, Math.round((a.ta - a.t0) * cut));
              a.t1 = a.ta + 1;
              a.b = 1;
              break;
            }
          }
        }
        return;
      }
    }
    if (able && !f) {
      const s = randomSpot(c, r, c.cx, c.cy, 0, 3);
      if (s && setAct(c, p, 'fight', s[0], s[1], 2, 'muster')) return;
    }
    if (!isDown(p)) {
      const hall = bldOf(c, 'hall');
      const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
      const b = hall ?? home;
      if (b) {
        const [x, y] = seat(c, p, b, '.', r);
        if (setAct(c, p, 'hide', x, y, 6, 'alarm', { b: b.id })) return;
      }
    }
    p.act = idleAct(c, p, 4, 'alarm');
    p.act.k = isDown(p) ? 'rest' : 'hide';
    return;
  }

  // Too hurt or sick for anything but bed
  if (needsRest(p)) {
    if (p.food < 30 && hasFood(c) && setAct(c, p, 'eat', p.x, p.y, 3, 'hungry')) return;
    if (isDown(p)) { p.act = idleAct(c, p, 20, 'hurt'); p.act.k = 'rest'; return; }
    const bed = bedFor(c, p);
    if (bed >= 0 && setAct(c, p, 'rest', bed % c.w, Math.floor(bed / c.w), 30, 'hurt', { b: c.sb[bed] })) return;
    p.act = idleAct(c, p, 20, 'hurt');
    p.act.k = 'rest';
    return;
  }

  if (p.brk && breakAct(c, p, r)) return;
  if (p.food < 18 && hasFood(c) && goEat(c, p, r, 'starving')) return;
  if (p.rest < 8 && goSleep(c, p, 'exhausted')) return;
  if (c.gath && t >= c.gath.t0 - 12 && t < c.gath.t1 - 4 && wantsToAttend(c, p, st) && attend(c, p, r)) return;
  if (((night && p.rest < 80) || p.rest < 22) && !p.brk && goSleep(c, p, night ? 'night' : 'tired')) return;
  if (p.food < 42 && hasFood(c) && goEat(c, p, r, 'hungry')) return;

  if (st === STAGE.CHILD) {
    const roll = r.float();
    if (roll < 0.6) {
      const s = randomSpot(c, r, c.cx, c.cy, 2, 9);
      if (s && setAct(c, p, 'play', s[0], s[1], 10 + r.int(10), 'child')) return;
    } else if (roll < 0.85) {
      const kin = pawnById(c, r.chance(0.5) ? p.mo : p.fa) ?? favourite(c, p, r);
      if (kin) {
        const oi = posAt(c, kin, t + 2);
        if (setAct(c, p, 'visit', oi % c.w, Math.floor(oi / c.w), 8, 'family', { adj: true, o: kin.id })) return;
      }
    }
    const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
    if (home) {
      const [x, y] = seat(c, p, home, '.', r);
      if (setAct(c, p, 'play', x, y, 12, 'child')) return;
    }
    p.act = idleAct(c, p, 6, 'child');
    return;
  }

  if (!p.brk) {
    const diligent = per(p, AX.DILIGENT);
    let ws = 6;
    let we = 18;
    if (has(p, 'earlybird')) { ws = 5; we = 17; }
    else if (has(p, 'nightowl')) { ws = 10; we = 22; }
    if (has(p, 'industrious')) we += 2;
    if (has(p, 'lazy') || has(p, 'slothful')) { ws += 1; we -= 1; }
    if (st !== STAGE.ADULT) we -= 2;
    if (nightShift(p)) { ws = 18; we = 6; }
    const famine = foodDays(c) < 1.5 && !night;
    if ((ws < we ? hour >= ws && hour < we : hour >= ws || hour < we) || famine) {
      if (!famine && p.joy < 16 - diligent * 5 && leisure(c, p, r, st, hour, 'bored')) return;
      const job = findJob(c, p, r);
      if (job && setAct(c, p, 'work', job.x, job.y, job.dur, job.why, { adj: job.adj, b: job.b, w: job.w, d: job.d, o: job.o })) return;
      if (leisure(c, p, r, st, hour, 'idle')) return;
    } else if (leisure(c, p, r, st, hour, 'free')) return;
  }

  const s = randomSpot(c, r, c.cx, c.cy, 0, 7);
  if (s && setAct(c, p, 'wander', s[0], s[1], 4 + r.int(6), 'idle')) return;
  p.act = idleAct(c, p, 5 + r.int(5));
}

/** The action is over: apply what it did. */
export function finish(c: Colony, p: Pawn): void {
  const a = p.act;
  const t = c.tick;
  if (t < a.ta) return;
  p.x = a.tx;
  p.y = a.ty;
  const spent = Math.min(t, a.t1) - a.ta;
  const r = new Rand(c.seed, S.AI, t, p.id, 1);
  switch (a.k) {
    case 'eat': {
      const st = stage(c, p);
      const kind = takeMeal(c, has(p, 'ironstomach') || p.race === 'goblin');
      if (!kind) { bump(c, 'missedMeals'); break; }
      bump(c, 'meals');
      p.food = Math.min(100, p.food + 62);
      if (has(p, 'glutton') && p.food < 90 && takeMeal(c, true)) p.food = 100;
      if (st <= STAGE.BABY) break;
      if (kind === 'feast') think(c, p, 'atefeast');
      else if (kind === 'raw') think(c, p, 'ateraw');
      if (!a.b) think(c, p, 'atenotable');
      else {
        for (const o of c.pawns) {
          if (o === p || o.act.k !== 'eat' || o.act.b !== a.b || t < o.act.ta) continue;
          if (r.chance(0.5)) { think(c, p, 'atetogether', o.id); think(c, o, 'atetogether', p.id); p.soc = Math.min(100, p.soc + 5); o.soc = Math.min(100, o.soc + 5); }
          break;
        }
      }
      break;
    }
    case 'sleep': {
      if (spent < 15 || stage(c, p) <= STAGE.BABY) break;
      const inBed = !!p.home && c.sb[a.ty * c.w + a.tx] === p.home;
      if (!inBed) think(c, p, 'sleptground');
      if (feltTemp(c, p, inBed || !!c.sb[a.ty * c.w + a.tx]) < 3) think(c, p, 'sleptcold');
      if (has(p, 'nightmares') && r.chance(0.4)) {
        think(c, p, 'nightmare');
        if (inBed) for (const o of c.pawns) if (o !== p && o.home === p.home && o.act.k === 'sleep') think(c, o, 'disturbed');
      } else if (inBed && p.rest >= 90 && r.chance(0.4)) think(c, p, 'sleptwell');
      break;
    }
    case 'work': finishWork(c, p, a); break;
    case 'fight': if (a.d !== undefined) attack(c, p, a.d, a.b === 1); break;
    case 'drink': {
      const rounds = Math.max(1, Math.round(spent / 16));
      let had = 0;
      for (let k = 0; k < rounds && c.stock.ale >= 1; k++) {
        c.stock.ale -= 1;
        p.drunk += 30 / RACES[p.race].size;
        had++;
      }
      p.booze += had;
      if (!had) break;
      think(c, p, 'hadale');
      bump(c, 'ales', had);
      for (const o of c.pawns) {
        if (o === p || o.act.k !== 'drink' || o.act.b !== a.b || t < o.act.ta) continue;
        think(c, p, 'drankwith', o.id);
        think(c, o, 'drankwith', p.id);
        break;
      }
      if (p.drunk > 85) {
        think(c, p, 'hungover');
        if (r.chance(0.3)) {
          const f = addFact(c, 'drunk', p.id, undefined, true);
          for (const o of c.pawns) if (o !== p && o.act.b === a.b && o.act.k !== 'sleep') learn(c, o, f);
          log(c, 'drunk', p.id);
        }
      }
      break;
    }
    case 'walk': think(c, p, 'goodwalk'); break;
    case 'pray': if (spent >= 6) think(c, p, 'prayed'); break;
    case 'stargaze': think(c, p, 'stargazed'); break;
    case 'bathe': think(c, p, 'bathed'); break;
    case 'play': if (stage(c, p) === STAGE.CHILD && r.chance(0.3)) think(c, p, 'playedgames'); break;
    case 'dice': {
      const win = r.chance(has(p, 'lucky') ? 0.68 : has(p, 'jinxed') ? 0.3 : 0.48);
      const stake = Math.min(p.coin, 1 + r.int(3));
      think(c, p, win ? 'wondice' : 'lostdice');
      p.coin += win ? stake + 1 : -stake;
      break;
    }
    case 'hobby': {
      const s = a.d ?? 6;
      gainXp(p, s, spent / TICKS_PER_HOUR);
      if (r.chance(0.5)) think(c, p, 'lovework');
      break;
    }
    case 'perform': {
      let n = 0;
      for (const o of c.pawns) {
        if (o === p || o.act.b !== a.b || t < o.act.ta || o.act.k === 'sleep') continue;
        think(c, o, 'heardtale', p.id);
        o.joy = Math.min(100, o.joy + 10);
        n++;
      }
      if (n) { think(c, p, 'performed'); log(c, 'story', p.id, undefined, undefined, n); }
      break;
    }
    case 'visit':
    case 'court': {
      const o = pawnById(c, a.o ?? 0);
      if (!o || o.gone || o.act.k === 'sleep') break;
      const oi = posAt(c, o, t);
      if (Math.abs((oi % c.w) - p.x) > 3 || Math.abs(Math.floor(oi / c.w) - p.y) > 3) break;
      const near = c.pawns.filter((x) => x !== p && x !== o && x.act.k !== 'sleep' && Math.abs(x.x - p.x) <= 4 && Math.abs(x.y - p.y) <= 4 && t >= x.act.ta);
      const flirt = a.k === 'court' && r.chance(0.6) && attracted(c, p, o, opinion(c, p, o));
      interact(c, p, o, new Rand(c.seed, S.SOC, t, p.id, 2), near, flirt ? 'flirt' : undefined);
      break;
    }
    case 'rave': {
      const o = pawnById(c, a.o ?? 0);
      if (!o || o.gone) break;
      const near = c.pawns.filter((x) => x !== p && x !== o && x.act.k !== 'sleep' && Math.abs(x.x - p.x) <= 4 && Math.abs(x.y - p.y) <= 4);
      insult(c, p, o, r, near);
      p.say = ['insult', o.id, t, 0];
      o.say = ['insult', p.id, t, 0];
      break;
    }
    case 'tantrum': {
      const b = c.blds.find((x) => x.id === a.b);
      if (b) b.dmg = Math.min(60, b.dmg + 8 + r.int(10));
      const res = r.pick(['meal', 'ale', 'grain', 'veg', 'wood', 'tools'] as const);
      const lost = Math.min(c.stock[res], 1 + c.stock[res] * 0.08);
      c.stock[res] -= lost;
      const f = addFact(c, 'scene', p.id, undefined, true);
      for (const o of c.pawns) {
        if (o === p || o.act.k === 'sleep' || Math.abs(o.x - p.x) > 6 || Math.abs(o.y - p.y) > 6) continue;
        think(c, o, 'sawtantrum', p.id);
        learn(c, o, f);
      }
      log(c, 'tantrum', p.id, undefined, b?.k, Math.round(lost));
      break;
    }
    case 'binge': {
      let n = 0;
      while (n < 3 && takeMeal(c, true)) n++;
      if (n) p.food = 100;
      bump(c, 'binged', n);
      break;
    }
    case 'mourn': if (a.o) think(c, p, 'visitedgrave', a.o); break;
    default: break;
  }
  void hasThought;
  void TICKS_PER_DAY;
}
