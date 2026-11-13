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

/** A ruling house sends a grown, unwed child to marry into a neighbour's. */
export function dailyMatch(c: Colony): void {
  const near = c.near;
  const day = dayOf(c.tick);
  if (!near?.length || day % 15 !== 4 || c.gov.k !== 'lord' || c.foes.length) return;
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler) return;
  const kids = c.pawns.filter((p) => !p.gone && !p.owner && (p.mo === ruler.id || p.fa === ruler.id) && stage(c, p) === STAGE.ADULT && !p.sp && !has(p, 'chaste')).sort((a, b) => b.born - a.born);
  // the heir stays home
  const heir = c.pawns.filter((p) => p.mo === ruler.id || p.fa === ruler.id).sort((a, b) => a.born - b.born)[0];
  const child = kids.find((p) => p !== heir);
  const r = new Rand(c.seed, S.LOVE, day, 61);
  if (!child || !r.chance(0.25)) return;
  const to = r.pick(near);
  log(c, 'match_sent', child.id, ruler.id, to.name);
  for (const p of c.pawns) if (p.id === child.mo || p.id === child.fa) think(c, p, 'missing', child.id);
  child.gone = true;
  c.dead.push({
    id: child.id, first: child.first, fam: child.fam, epi: child.epi, race: child.race, sex: child.sex, born: child.born, died: c.tick, cause: 'match', look: child.look, traits: child.traits,
    bc: child.bc, ba: child.ba, prof: child.prof, mo: child.mo, fa: child.fa, sp: 0, bio: child.bio, grave: -1, left: true, faith: child.faith, rank: child.rank,
  });
  for (const b of c.blds) for (let i = 0; i < b.beds.length; i++) if (b.beds[i] === child.id) b.beds[i] = 0;
  c.out.push({ k: 'migrant', to: to.id, why: 'match', fromName: c.name, pawn: JSON.parse(JSON.stringify({ ...child, gone: undefined })) });
  bump(c, 'matches');
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
