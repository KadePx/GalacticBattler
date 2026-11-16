// Masters and apprentices: the skilled earn a title, and take on a young one who learns at
// their side until they can stand on their own.

import { TICKS_PER_DAY, dayOf } from '../config';
import { bump, log, note } from './events';
import { think } from './mood';
import { STAGE, ageYears, gainXp, pawnById, stage } from './pawn';
import { RACES } from './data/races';
import { Rand, S } from './rng';
import { opinion } from './social';
import type { Colony, Pawn } from './types';

/** The title someone earns at level 12 in a skill. */
export const MASTER_TITLES = ['Master-at-arms', 'Master archer', 'Master builder', 'Master miner', 'Master farmer', 'Master cook', 'Master crafter', 'Master smith', 'Master healer', 'Master of beasts', 'Silver tongue', 'Loremaster'];
export const MASTER_LEVEL = 12;
const MENTOR_LEVEL = 7;
/** An apprentice stands on their own at this level, or after this many days. */
const DONE_LEVEL = 9;
const DONE_DAYS = 90;

/** What someone is keenest on, best first: burning passions, then interests, then what they do best. */
function callings(p: Pawn): number[] {
  return p.sk.map((_, s) => s).sort((a, b) => (p.pas[b] * 10 + p.sk[b]) - (p.pas[a] * 10 + p.sk[a]) || a - b).slice(0, 3);
}

/** Young enough to learn a trade: a teen, or in their first few years as an adult. */
function young(c: Colony, p: Pawn): boolean {
  const st = stage(c, p);
  if (st === STAGE.TEEN) return true;
  if (st !== STAGE.ADULT) return false;
  return ageYears(c, p) - RACES[p.race].adult < 4;
}

export function dailyGuild(c: Colony): void {
  const day = dayOf(c.tick);
  const r = new Rand(c.seed, S.SOC, day, 31);

  // the first time: those already masters keep the title without a fanfare
  if (!c.stats.guildSeen) {
    c.stats.guildSeen = 1;
    for (const p of c.pawns) for (let s = 0; s < p.sk.length; s++) if (p.sk[s] >= MASTER_LEVEL && !p.mastered?.includes(s)) (p.mastered ??= []).push(s);
  }
  // titles: once earned, kept
  for (const p of c.pawns) {
    if (p.gone || stage(c, p) < STAGE.TEEN) continue;
    for (let s = 0; s < p.sk.length; s++) {
      if (p.sk[s] < MASTER_LEVEL || p.mastered?.includes(s)) continue;
      (p.mastered ??= []).push(s);
      think(c, p, 'becamemaster');
      log(c, 'master', p.id, undefined, MASTER_TITLES[s], s);
      note(c, p, 'master', undefined, MASTER_TITLES[s]);
      bump(c, 'masters');
    }
  }

  // apprenticeships that end: the master is gone, or the apprentice is ready
  for (const p of c.pawns) {
    if (!p.appr) continue;
    const [mid, s, since] = p.appr;
    const m = pawnById(c, mid);
    if (!m || m.gone) { p.appr = undefined; continue; }
    if (p.sk[s] >= DONE_LEVEL || c.tick - since > DONE_DAYS * TICKS_PER_DAY) {
      p.appr = undefined;
      p.graduated = true;
      think(c, p, 'finishedappr', m.id);
      think(c, m, 'proudmentor', p.id);
      log(c, 'graduated', p.id, m.id, MASTER_TITLES[s].replace(/^Master( of)? ?/, '').toLowerCase() || 'trade', s);
      note(c, p, 'graduated', m.id);
      bump(c, 'graduated');
      continue;
    }
    // a day at the master's side
    const good = 0.6 + m.sk[s] * 0.05;
    gainXp(p, s, 3 * good);
    if (r.chance(0.08)) { think(c, p, 'learnedfrom', m.id); think(c, m, 'taught', p.id); }
  }

  // new apprentices, every few days
  if (day % 3 !== 0) return;
  const mentoring = new Set(c.pawns.filter((p) => p.appr).map((p) => p.appr![0]));
  for (const p of c.pawns) {
    if (p.gone || p.appr || p.brk || !young(c, p) || p.mastered?.length || p.graduated) continue;
    // their first choice if someone can teach it, else the next
    let best: Pawn | undefined;
    let s = -1;
    for (const want of callings(p)) {
      if (p.sk[want] >= DONE_LEVEL) continue;
      for (const m of c.pawns) {
        if (m === p || m.gone || m.brk || mentoring.has(m.id) || stage(c, m) < STAGE.ADULT || m.sk[want] < Math.max(MENTOR_LEVEL, p.sk[want] + 3)) continue;
        if (opinion(c, m, p) < -20 || opinion(c, p, m) < -20) continue;
        if (!best || m.sk[want] > best.sk[want]) best = m;
      }
      if (best) { s = want; break; }
    }
    if (!best || s < 0 || !r.chance(0.6)) continue;
    p.appr = [best.id, s, c.tick];
    mentoring.add(best.id);
    think(c, p, 'newapprentice', best.id);
    think(c, best, 'tookapprentice', p.id);
    log(c, 'apprenticed', p.id, best.id, MASTER_TITLES[s], s);
    note(c, p, 'apprenticed', best.id);
    bump(c, 'apprenticeships');
  }
}

