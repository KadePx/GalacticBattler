// The faiths of the Hollow Lands, the people who speak for them, and the dead who are
// remembered as more than dead. Whether any god is listening, the sim does not say.

import { DAYS_PER_SEASON, TICKS_PER_HOUR, dayOf } from '../config';
import { bump, log, note } from './events';
import { think } from './mood';
import { STAGE, pawnById, stage, stat } from './pawn';
import { Rand, S } from './rng';
import type { Colony, Dead, Pawn } from './types';

export interface FaithDef { k: string; name: string; short: string; blurb: string; priest: string; holy: number; cult?: boolean }

export const FAITHS: Record<string, FaithDef> = {
  hearth: { k: 'hearth', name: 'The Hearth', short: 'Hearth', blurb: 'Family, bread and an open door. The fire must never go out.', priest: 'Hearthkeeper', holy: 0 },
  iron: { k: 'iron', name: 'The Iron Ancestors', short: 'Ancestors', blurb: 'The dead are watching, and they remember every oath.', priest: 'Oathwarden', holy: 3 },
  pale: { k: 'pale', name: 'The Pale Lady', short: 'Pale Lady', blurb: 'She takes everyone in the end, and gently. Bury the dead well.', priest: 'Gravewarden', holy: 7 },
  green: { k: 'green', name: 'The Green Choir', short: 'Green Choir', blurb: 'Every tree is a voice. Take only what will grow back.', priest: 'Leafsinger', holy: 10 },
  teeth: { k: 'teeth', name: 'The Old Teeth', short: 'Old Teeth', blurb: 'The strong eat. Scars are prayers.', priest: 'Bone-caller', holy: 12 },
  hollow: { k: 'hollow', name: 'The Hollow Mother', short: 'Hollow Mother', blurb: 'She is empty, and she asks to be filled.', priest: 'Mouth', holy: 14, cult: true },
};

export const faithName = (k: string): string => FAITHS[k]?.name ?? k;

/** The faith most of the colony holds. */
export function mainFaith(c: Colony): string {
  const n: Record<string, number> = {};
  let best = 'hearth';
  for (const p of c.pawns) {
    if (stage(c, p) < STAGE.TEEN) continue;
    n[p.faith] = (n[p.faith] ?? 0) + 1 + p.dev * 0.2;
    if (n[p.faith] > (n[best] ?? 0)) best = p.faith;
  }
  return best;
}

/** Once a day: on a faith's holy day, its priest calls the faithful together. */
export function dailyFaith(c: Colony): void {
  if (c.gath) return;
  const dos = dayOf(c.tick) % DAYS_PER_SEASON;
  const priests = c.pawns.filter((p) => p.prof === 'priest' && !p.gone);
  for (const priest of priests) {
    const def = FAITHS[priest.faith];
    if (!def || def.holy !== dos) continue;
    const shrine = c.blds.find((b) => b.k === 'shrine' && b.built) ?? c.blds.find((b) => b.k === 'hall' && b.built);
    if (!shrine) return;
    const start = c.tick + 10 * TICKS_PER_HOUR;
    c.gath = { k: 'sermon', t0: start, t1: start + 15, b: shrine.id, a: priest.id, x: shrine.x + Math.floor(shrine.w / 2), y: shrine.y + Math.floor(shrine.h / 2) };
    return;
  }
}

/** The sermon is over. A good one lifts the faithful and may win a few of the others. */
export function sermonEnd(c: Colony, priestId: number, there: Pawn[]): void {
  const priest = pawnById(c, priestId);
  if (!priest || !there.includes(priest)) return;
  const r = new Rand(c.seed, S.FAITH, c.tick);
  const skill = priest.sk[10] * 0.6 + priest.sk[11] * 0.4 + stat(priest, 'charm') * 0.3;
  let moved = 0;
  let won = 0;
  for (const p of there) {
    if (p === priest) continue;
    const good = r.chance(0.25 + skill * 0.05);
    if (p.faith === priest.faith) {
      think(c, p, good ? 'sermon' : 'dullsermon', priest.id);
      if (good) { moved++; if (p.dev < 3 && r.chance(0.12)) p.dev++; }
    } else if (good && p.dev <= 1 && r.chance(0.12) && stage(c, p) >= STAGE.ADULT) {
      const old = p.faith;
      p.faith = priest.faith;
      p.dev = 1;
      won++;
      log(c, 'convert', p.id, priest.id, old);
      note(c, p, 'convert', priest.id, priest.faith);
      bump(c, 'conversions');
    }
  }
  think(c, priest, moved >= 3 ? 'performed' : 'prayed');
  priest.sk[10] = Math.min(20, priest.sk[10] + 0.03);
  log(c, 'sermon', priest.id, undefined, priest.faith, there.length - 1);
  bump(c, 'sermons');
  void won;
}

/** Was this one of the dead that people will pray to? Loved, devout, and known for great good. */
export function maybeSaint(c: Colony, d: Dead, p: Pawn): void {
  if (p.dev < 2) return;
  let known = 0;
  let adults = 0;
  const deeds = c.facts.filter((f) => f.a === p.id && (f.k === 'hero' || f.k === 'kind') && f.real).map((f) => f.id);
  if (!deeds.length) return;
  let love = 0;
  for (const o of c.pawns) {
    if (o === p || o.gone || stage(c, o) < STAGE.ADULT) continue;
    adults++;
    if (deeds.some((id) => o.know.includes(id))) known++;
    if (o.rel[p.id]?.f === 1 || o.sp === p.id) love++;
  }
  if (adults < 4 || known < adults * 0.5 || love < 2) return;
  d.saint = 1;
  log(c, 'saint', p.id, undefined, p.faith);
  bump(c, 'saints');
  for (const o of c.pawns) if (!o.gone && o.faith === p.faith && o.dev >= 2) think(c, o, 'saintmade', p.id);
}
