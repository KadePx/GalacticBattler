// A colony's dealings with its neighbours: knowing who they are, raiding them when the ruler
// is hard or the larder is bare, and living with what comes back.

import { TICKS_PER_DAY, dayOf, seasonOf } from '../config';
import { canFight } from './combat';
import { foodDays } from './econ';
import { bump, log } from './events';
import { die } from './life';
import { think } from './mood';
import { STAGE, has, pawnById, per, stage } from './pawn';
import { Rand, S } from './rng';
import { AX, type Colony, type Input } from './types';

/** Once a day: does the ruler send a raiding party down the road? */
export function dailyAbroad(c: Colony): void {
  const near = c.near;
  const day = dayOf(c.tick);
  if (!near?.length || day % 5 !== 0) return;
  if (c.foes.length || c.alarm || seasonOf(c.tick) === 3) return;
  if (c.tick - (c.story.raid ?? -99999) < TICKS_PER_DAY * 25) return;
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler) return;
  const hard = c.gov.k === 'chief' || c.gov.k === 'tyrant' || per(ruler, AX.KIND) < -0.8 || has(ruler, 'bloodlust');
  const hungry = foodDays(c) < 6;
  if (!hard && !(hungry && per(ruler, AX.KIND) < 0.3)) return;
  let fighters = 0;
  for (const p of c.pawns) if (canFight(c, p)) fighters++;
  if (fighters < 6) return;
  const r = new Rand(c.seed, S.EVENT, day, 91);
  if (!r.chance(hungry ? 0.5 : per(ruler, AX.GREED) > 0.8 ? 0.25 : 0.1)) return;
  const target = near[r.int(Math.min(2, near.length))];
  const n = Math.min(7, Math.max(3, fighters - 3));
  c.story.raid = c.tick;
  c.out.push({ k: 'raid', to: target.id, kind: 'raider', n, fromId: c.id, fromName: c.name });
  log(c, 'raidout', ruler.id, undefined, target.name, n);
  bump(c, 'raidsSent');
}

/** Things that arrive from the wider world. Returns true if it was one of ours. */
export function abroadInput(c: Colony, e: Input): boolean {
  if (e.k === 'near') {
    c.near = (e.list as { id: string; name: string }[]) ?? [];
    return true;
  }
  if (e.k === 'mod') {
    c.mods.push([String(e.mod), c.tick + Number(e.days) * TICKS_PER_DAY]);
    log(c, String(e.mod));
    return true;
  }
  if (e.k === 'spoils') {
    // our raiders come home, with what they took and without those who fell
    const loot = Number(e.loot) || 0;
    const slain = Math.min(2, Math.round((Number(e.slain) || 0) / 2));
    c.stock.grain += loot * 0.45;
    c.stock.meal += loot * 0.25;
    c.stock.ale += loot * 0.1;
    c.stock.silver += loot * 0.05;
    const r = new Rand(c.seed, S.FIGHT, c.tick, 17);
    let lost = 0;
    for (let k = 0; k < slain; k++) {
      const pool = c.pawns.filter((p) => !p.gone && !p.owner && p.id !== c.gov.ruler && canFight(c, p));
      if (pool.length < 3) break;
      die(c, r.pick(pool), 'raiding');
      lost++;
    }
    log(c, 'raidback', undefined, undefined, `${String(e.name)}:${lost}`, Math.round(loot));
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, loot > 20 && !lost ? 'plunder' : lost ? 'raidlost' : 'raidnothing');
    return true;
  }
  return false;
}
