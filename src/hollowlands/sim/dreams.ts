// Life goals that can come true. Each colonist dreams of something; when they get there the
// colony hears of it, and they carry a quiet contentment for the rest of their days.

import { dayOf } from '../config';
import { bump, log, note } from './events';
import { think } from './mood';
import { STAGE, pawnById, stage } from './pawn';
import { opinion } from './social';
import type { Colony, Pawn } from './types';

export interface Dream { k: string; done: string; check: (c: Colony, p: Pawn) => boolean; progress?: (c: Colony, p: Pawn) => string }

const kids = (c: Colony, p: Pawn): Pawn[] => c.pawns.filter((o) => !o.gone && (o.mo === p.id || o.fa === p.id));

/** What counts as each dream coming true, and how far along they are (for the card). */
export const DREAMS: Record<string, Dream> = {
  love: {
    k: 'love', done: 'married for love',
    check: (c, p) => { const o = p.sp ? pawnById(c, p.sp) : undefined; return !!o && p.rel[o.id]?.k === 'spouse' && opinion(c, p, o) >= 40; },
    progress: (c, p) => { const o = p.sp ? pawnById(c, p.sp) : undefined; return !o ? 'still looking' : p.rel[o.id]?.k === 'spouse' ? `married to ${o.first}, but is it love?` : `with ${o.first}, not yet wed`; },
  },
  dynasty: {
    k: 'dynasty', done: 'founded a family that will outlive them',
    check: (c, p) => kids(c, p).length >= 3 || c.pawns.some((o) => !o.gone && kids(c, p).some((k) => o.mo === k.id || o.fa === k.id)),
    progress: (c, p) => `${kids(c, p).length} of 3 children`,
  },
  rule: {
    k: 'rule', done: 'came to rule the colony',
    check: (c, p) => c.gov.ruler === p.id,
    progress: (c, p) => (Object.values(c.gov.titles).includes(p.id) ? 'holds an office; the seat itself is another matter' : 'far from the seat'),
  },
  craft: {
    k: 'craft', done: 'mastered a craft',
    check: (_c, p) => !!p.mastered?.length,
    progress: (_c, p) => `best skill ${Math.floor(Math.max(...p.sk))} of 12`,
  },
  faith: {
    k: 'faith', done: 'found their faith',
    check: (_c, p) => p.dev >= 2 && !!p.faith,
    progress: (_c, p) => (p.dev >= 1 ? 'believing, but not yet devout' : 'still doubting'),
  },
  rich: {
    k: 'rich', done: 'got rich',
    check: (_c, p) => p.coin >= 60,
    progress: (_c, p) => `${Math.floor(p.coin)} of 60 silver`,
  },
  wander: {
    k: 'wander', done: 'seen the world beyond their first home',
    check: (_c, p) => p.bio.some((b) => b.k === 'migrated' || b.k === 'settled' || b.k === 'founded'),
    progress: () => 'still here',
  },
  protect: {
    k: 'protect', done: 'stood between the colony and harm',
    check: (c, p) => c.facts.some((f) => f.k === 'hero' && f.a === p.id) || p.bio.some((b) => b.k === 'rescued_someone'),
    progress: () => 'waiting for the day they are needed',
  },
  build: {
    k: 'build', done: 'built something that will last',
    check: (_c, p) => (p.built ?? 0) >= 3,
    progress: (_c, p) => `${p.built ?? 0} of 3 buildings finished`,
  },
  remembered: {
    k: 'remembered', done: 'made a name for themselves',
    check: (c, p) => !!p.epi || !!p.mastered?.length || c.gov.ruler === p.id || c.facts.some((f) => f.k === 'hero' && f.a === p.id),
    progress: () => 'nobody sings of them yet',
  },
};

/** Once a day: whose dream has come true? */
export function dailyDreams(c: Colony): void {
  if (dayOf(c.tick) % 2) return;
  // the first time: dreams already met are counted quietly, without a flood of news
  const quiet = !c.stats.dreamsSeen;
  c.stats.dreamsSeen = 1;
  for (const p of c.pawns) {
    if (p.gone || p.dreamT || stage(c, p) < STAGE.TEEN) continue;
    const d = DREAMS[p.goal];
    if (!d || !d.check(c, p)) continue;
    p.dreamT = c.tick;
    if (quiet) continue;
    think(c, p, 'dreamcometrue');
    log(c, 'dream', p.id, undefined, d.done);
    note(c, p, 'dream', undefined, d.done);
    bump(c, 'dreams');
    // those who love them are glad for them
    for (const o of c.pawns) if (o !== p && (o.id === p.sp || o.mo === p.id || o.fa === p.id || p.mo === o.id || p.fa === o.id || o.rel[p.id]?.f === 1)) think(c, o, 'gladfor', p.id);
  }
}
