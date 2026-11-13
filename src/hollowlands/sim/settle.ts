// How the world grows: when a colony is crowded or divided, a party gathers round someone
// restless and walks out to found a new one. They take their families, their grudges and a
// share of the stores with them.

import { HARD_CAP, SOFT_CAP, TICKS_PER_DAY, dayOf, seasonOf } from '../config';
import { bump, log, note } from './events';
import { approval } from './gov';
import { ask } from './ask';
import { isDown } from './health';
import { depart } from './life';
import { think } from './mood';
import { STAGE, has, mkAct, normPawn, pawnById, per, stage } from './pawn';
import { Rand, S } from './rng';
import { opinion } from './social';
import { AX, RES, type Colony, type Id, type Pawn, type ResK } from './types';

/** A party that has left: everything the new colony needs to begin. */
export interface SettlerMsg {
  k: 'settlers';
  t: number;
  from: string;
  fromName: string;
  leader: Id;
  pawns: Pawn[];
  stock: Partial<Record<ResK, number>>;
}

const SHARE: ResK[] = ['grain', 'veg', 'meal', 'meat', 'wood', 'stone', 'tools', 'clothes', 'weapons', 'medicine', 'ale', 'silver', 'leather', 'cloth'];

/** How much each colonist wants to go, given who is leading. */
function restless(c: Colony, p: Pawn, leader: Pawn | null): number {
  let s = per(p, AX.CURIOUS) * 4 + (has(p, 'wanderlust') ? 14 : 0) - (has(p, 'homebody') ? 18 : 0) + (p.goal === 'wander' ? 10 : 0);
  s += (p.roots ?? 0) * -40; // the player's own wish: 1 stay, -1 go
  if (!p.home) s += 8;
  if (p.rank <= 1) s += 10;
  else if (p.rank >= 4) s -= 10;
  const ruler = pawnById(c, c.gov.ruler);
  if (ruler && ruler !== p) s -= opinion(c, p, ruler) / 6;
  if (leader && leader !== p) s += opinion(c, p, leader) / 2.5;
  if (stage(c, p) === STAGE.ELDER) s -= 12;
  return s;
}

/** Once a day: pressure to leave builds while a colony is crowded or unhappy with its ruler. */
export function dailySettle(c: Colony): void {
  const pop = c.pawns.length;
  let push = 0;
  if (pop > 26) push += (pop - 26) * 0.15;
  if (pop >= SOFT_CAP) push += 1.2;
  if (pop >= 18 && approval(c) < -12) push += 0.5;
  if (pop < 20) push -= 0.6;
  c.settle = Math.max(0, (c.settle ?? 0) + push);
  // the talk starts well before anyone packs: time to ask the players what theirs will do
  if (c.settle > 28) for (const p of c.pawns) if (p.owner && !p.roots && stage(c, p) >= STAGE.ADULT && c.settle < 30) ask(c, p, 'settle', undefined, undefined, 3);
  if (pop >= 8 && dayOf(c.tick) % 3 === 0) {
    const rr = new Rand(c.seed, S.EVENT, dayOf(c.tick), 78);
    for (const p of c.pawns) {
      if (p.gone || p.owner || p.sp || stage(c, p) !== STAGE.ADULT || p.id === c.gov.ruler || p.brk || isDown(p)) continue;
      if (c.pawns.some((k) => k.mo === p.id || k.fa === p.id)) continue;
      let friends = 0;
      for (const key in p.rel) if (p.rel[key].f === 1) friends++;
      const wants = (p.rank <= 1 ? 0.05 : 0) + (p.mood < 30 && !friends ? 0.04 : 0) + (has(p, 'wanderlust') && !friends ? 0.01 : 0);
      if (wants && rr.chance(wants)) { note(c, p, 'moved'); depart(c, p, 'moved'); break; }
    }
  }
  const forced = pop >= HARD_CAP - 1;
  if (!forced && (c.settle < 45 || pop < 24)) return;
  // nobody sets out in the snow, in the middle of a fight, or on the day of a wedding
  if (c.foes.length || c.alarm || c.gath || (seasonOf(c.tick) === 3 && !forced)) return;
  const r = new Rand(c.seed, S.EVENT, dayOf(c.tick), 77);

  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT && !isDown(p) && !p.brk && !p.preg);
  let leader: Pawn | null = null;
  let best = -1e9;
  for (const p of adults) {
    if (p.id === c.gov.ruler || p.id === c.gov.regent || stage(c, p) === STAGE.ELDER) continue;
    const s = restless(c, p, null) + per(p, AX.AMBITION) * 8 + p.sk[10] + per(p, AX.BRAVE) * 3 + r.float() * 6;
    if (s > best) { best = s; leader = p; }
  }
  if (!leader) return;
  const want = Math.max(7, Math.min(11, Math.round(pop * 0.33)));
  const going = new Set<Pawn>();
  const take = (p: Pawn): void => {
    if (going.has(p) || p.id === c.gov.ruler) return;
    going.add(p);
    // nobody leaves a partner or small children behind
    const sp = pawnById(c, p.sp);
    if (sp && !sp.gone && sp.id !== c.gov.ruler && p.rel[sp.id]?.k === 'spouse') going.add(sp);
    for (const k of c.pawns) if (!k.gone && (k.mo === p.id || k.fa === p.id) && stage(c, k) < STAGE.ADULT) going.add(k);
  };
  take(leader);
  const rest = adults.filter((p) => p !== leader && !going.has(p)).map((p) => ({ p, s: restless(c, p, leader) + r.float() * 6 })).sort((a, b) => b.s - a.s || a.p.id - b.p.id);
  for (const x of rest) {
    if (going.size >= want) break;
    if (x.s < 4 && !forced) break;
    take(x.p);
  }
  let grown = 0;
  for (const p of going) if (stage(c, p) >= STAGE.ADULT) grown++;
  if (grown < 5) { c.settle = Math.max(0, c.settle - 6); return; }

  // a fair share of the stores goes with them
  const frac = Math.min(0.4, (going.size / pop) * 0.9);
  const stock: Partial<Record<ResK, number>> = {};
  for (const k of SHARE) {
    const n = Math.floor(c.stock[k] * frac);
    if (n > 0) { stock[k] = n; c.stock[k] -= n; }
  }
  const list = [...going].sort((a, b) => a.id - b.id);
  const pawns = list.map((p) => normPawn(JSON.parse(JSON.stringify({ ...p, gone: undefined })) as Pawn));
  for (const p of c.pawns) if (!going.has(p) && stage(c, p) >= STAGE.CHILD && (p.rel[leader.id]?.f === 1 || list.some((g) => p.rel[g.id]?.f === 1))) think(c, p, 'friendleft');
  log(c, 'settlers', leader.id, undefined, undefined, list.length);
  for (const p of list) { note(c, p, 'settled'); depart(c, p, 'settled'); }
  c.out.push({ k: 'settlers', t: c.tick, from: c.id, fromName: c.name, leader: leader.id, pawns, stock } satisfies SettlerMsg);
  c.settle = 0;
  bump(c, 'parties');
  void TICKS_PER_DAY;
  void RES;
}

/** Bring a party's people into a brand-new colony: new ids, and only the ties that came with them. */
export function importPawns(c: Colony, msg: SettlerMsg, r: Rand): Id {
  const map = new Map<Id, Id>();
  for (const p of msg.pawns) map.set(p.id, c.nextId++);
  const m = (id: Id): Id => map.get(id) ?? 0;
  for (const old of msg.pawns) {
    const p = normPawn(old);
    p.id = m(old.id);
    p.mo = m(p.mo); p.fa = m(p.fa); p.sp = m(p.sp); p.crush = m(p.crush);
    const rel: Pawn['rel'] = {};
    for (const key in p.rel) { const id = m(+key); if (id) rel[id] = p.rel[key]; }
    p.rel = rel;
    p.th = p.th.filter((t) => !t.o || m(t.o)).map((t) => (t.o ? { ...t, o: m(t.o) } : t));
    p.sit = [];
    p.bio = p.bio.map((b) => (b.o ? { ...b, o: m(b.o) || undefined } : b));
    p.know = [];
    p.home = 0;
    p.prof = '';
    p.rank = 2;
    p.urge = undefined;
    p.say = undefined;
    p.brk = undefined;
    p.prev = undefined;
    p.gone = undefined;
    p.x = c.cx + r.range(-2, 2);
    p.y = c.cy + r.range(0, 2);
    p.act = mkAct('idle', c.tick, p.x, p.y, 1 + r.int(6), 'new');
    p.bio.push({ t: c.tick, k: 'founded', s: c.name });
    c.pawns.push(p);
    think(c, p, 'arrived');
  }
  return m(msg.leader);
}
