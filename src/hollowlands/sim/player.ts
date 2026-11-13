// The player's hand: a little Resolve that builds up over real time, spent on nudges that
// lean their colonist one way or another, and the choice of who to carry on as when the
// colonist dies. Nothing here is control. An unspent nudge never costs anything.

import { TICKS_PER_DAY } from '../config';
import { log, note } from './events';
import { think } from './mood';
import { STAGE, pawnById, stage } from './pawn';
import { SKILLS, type Colony, type Dead, type Input, type Pawn } from './types';

export const RESOLVE_CAP = 6;
/** Ticks for one point of Resolve: 1800 is three real hours at the usual pace. */
export const RESOLVE_TICKS = 1800;
export const RESOLVE_START = 2;

export interface NudgeDef { k: string; name: string; blurb: string; cost: number; needs: 'person' | 'skill' }
export const NUDGES: Record<string, NudgeDef> = {
  befriend: { k: 'befriend', name: 'Reach out', blurb: 'Seek them out and try to get closer.', cost: 1, needs: 'person' },
  court: { k: 'court', name: 'Court', blurb: 'Let them know how you feel.', cost: 1, needs: 'person' },
  peace: { k: 'peace', name: 'Make peace', blurb: 'Swallow your pride and try to mend things.', cost: 1, needs: 'person' },
  confront: { k: 'confront', name: 'Confront', blurb: 'Have it out with them.', cost: 1, needs: 'person' },
  focus: { k: 'focus', name: 'Focus', blurb: 'Throw yourself into this work for a few days.', cost: 1, needs: 'skill' },
};

/** Resolve a colonist has right now. */
export function resolveOf(c: Colony, p: Pawn): number {
  if (!p.owner) return 0;
  return Math.min(RESOLVE_CAP, (p.res ?? 0) + Math.floor(Math.max(0, c.tick - (p.resT ?? c.tick)) / RESOLVE_TICKS));
}

/** Ticks until the next point arrives (0 when full). */
export function resolveWait(c: Colony, p: Pawn): number {
  if (resolveOf(c, p) >= RESOLVE_CAP) return 0;
  return RESOLVE_TICKS - (Math.max(0, c.tick - (p.resT ?? c.tick)) % RESOLVE_TICKS);
}

function spend(c: Colony, p: Pawn, n: number): boolean {
  const have = resolveOf(c, p);
  if (have < n) return false;
  // settle what has built up, keeping the part of the next point already earned
  const part = have >= RESOLVE_CAP ? 0 : Math.max(0, c.tick - (p.resT ?? c.tick)) % RESOLVE_TICKS;
  p.res = have - n;
  p.resT = c.tick - part;
  return true;
}

export function grantResolve(c: Colony, p: Pawn): void {
  p.res = RESOLVE_START;
  p.resT = c.tick;
}

/** A nudge arrives. Anything that does not make sense is quietly ignored. */
export function nudge(c: Colony, e: Input): void {
  const p = c.pawns.find((x) => x.owner === e.owner && !x.gone);
  const def = NUDGES[String(e.kind)];
  if (!p || !def || stage(c, p) < STAGE.TEEN) return;
  if (def.needs === 'person') {
    const o = pawnById(c, Number(e.o));
    if (!o || o === p || o.gone) return;
    if (!spend(c, p, def.cost)) return;
    p.urge = [def.k, o.id, c.tick + TICKS_PER_DAY * 3, 3];
    log(c, 'nudge', p.id, o.id, def.k);
  } else {
    const s = Number(e.v);
    if (!(s >= 0 && s < SKILLS.length) || Math.floor(s) !== s) return;
    if (!spend(c, p, def.cost)) return;
    p.focus = [s, c.tick + TICKS_PER_DAY * 6];
    log(c, 'nudge', p.id, undefined, 'focus', s);
  }
}

/** The player's last colonist, if they have no living one. */
export function lastLife(c: Colony, owner: string): Dead | null {
  if (!owner || c.pawns.some((p) => p.owner === owner && !p.gone)) return null;
  for (let i = c.dead.length - 1; i >= 0; i--) if (c.dead[i].owner === owner) return c.dead[i];
  return null;
}

/** Who the player could carry on as: living children and grandchildren of their last colonist, then a widowed partner. */
export function heirsOf(c: Colony, owner: string): Pawn[] {
  const d = lastLife(c, owner);
  if (!d) return [];
  const out: Pawn[] = [];
  const kids = c.pawns.filter((p) => !p.gone && !p.owner && (p.mo === d.id || p.fa === d.id));
  out.push(...kids.sort((a, b) => a.born - b.born));
  // grandchildren, through children living or dead
  const childIds = new Set<number>([...c.pawns, ...c.dead].filter((x) => x.mo === d.id || x.fa === d.id).map((x) => x.id));
  for (const p of c.pawns) if (!p.gone && !p.owner && !out.includes(p) && (childIds.has(p.mo) || childIds.has(p.fa))) out.push(p);
  const partner = c.pawns.find((p) => !p.gone && !p.owner && p.id === d.sp);
  if (partner && !out.includes(partner)) out.push(partner);
  return out;
}

/** The player takes up the life of an heir. */
export function takeHeir(c: Colony, e: Input): void {
  const owner = String(e.owner ?? '');
  const d = lastLife(c, owner);
  const heir = heirsOf(c, owner).find((p) => p.id === Number(e.id));
  if (!d || !heir) return;
  heir.owner = owner;
  heir.prev = d.id;
  grantResolve(c, heir);
  log(c, 'heir', heir.id, d.id);
  note(c, heir, 'heir', d.id);
}

/** A keepsake passes on when its keeper dies: to the eldest child, else the partner, else a friend. */
export function passHeirloom(c: Colony, p: Pawn): void {
  if (!p.heirloom) return;
  const kids = c.pawns.filter((o) => !o.gone && (o.mo === p.id || o.fa === p.id)).sort((a, b) => a.born - b.born);
  const to = kids.find((o) => !o.heirloom) ?? c.pawns.find((o) => !o.gone && o.id === p.sp && !o.heirloom) ?? c.pawns.find((o) => !o.gone && !o.heirloom && o.rel[p.id]?.f === 1);
  if (!to) return;
  to.heirloom = p.heirloom;
  think(c, to, 'heirloom', p.id);
  note(c, to, 'heirloom', p.id, p.heirloom);
  log(c, 'heirloom', to.id, p.id, p.heirloom);
}
