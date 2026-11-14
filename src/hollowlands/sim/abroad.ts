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

/** Slights between neighbours (the text is in text.ts, by index). */
export const INCIDENTS = ['poachers', 'cheat', 'road', 'herd', 'insult', 'stolen'];

/** Once a day: grudges cool or harden into war; war bands go out; the weary sue for peace. */
export function dailyAbroad(c: Colony): void {
  const near = c.near;
  const day = dayOf(c.tick);
  if (!near?.length) return;
  const ruler = pawnById(c, c.gov.ruler);
  const g = (c.grudge ??= {});
  const wars = (c.wars ??= {});
  for (const k in g) { g[k] = Math.max(0, g[k] - 0.25); if (g[k] < 0.5) delete g[k]; }
  if (!ruler || c.foes.length || c.alarm) return;
  const r = new Rand(c.seed, S.EVENT, day, 91);
  let fighters = 0;
  for (const p of c.pawns) if (canFight(c, p)) fighters++;
  const fierce = c.gov.k === 'chief' || c.gov.k === 'tyrant' || per(ruler, AX.KIND) < -0.8 || has(ruler, 'bloodlust');

  // trouble on the borders: small slights that add up
  if (day % 6 === 3 && r.chance(0.3)) {
    // bad blood finds the same neighbour again more often than not
    const worst = near.slice(0, 3).sort((a, b) => (g[b.id] ?? 0) - (g[a.id] ?? 0))[0];
    const n = worst && (g[worst.id] ?? 0) > 3 && r.chance(0.6) ? worst : near[r.int(Math.min(3, near.length))];
    const k = r.int(INCIDENTS.length);
    g[n.id] = (g[n.id] ?? 0) + 5 + r.int(7);
    log(c, 'incident', undefined, undefined, n.name, k);
  }

  // a grudge deep enough becomes a war
  if (day % 3 === 1) {
    for (const n of near) {
      if (wars[n.id] || (g[n.id] ?? 0) < 18 || fighters < 4) continue;
      const temper = per(ruler, AX.TEMPER) + (fierce ? 1 : 0) - per(ruler, AX.KIND) * 0.6;
      if (!r.chance(Math.min(0.8, 0.2 + temper * 0.2 + (g[n.id] - 20) / 60))) continue;
      wars[n.id] = { name: n.name, since: c.tick, sent: 0, came: 0, lost: 0, slain: 0, ours: true };
      c.out.push({ k: 'war', to: n.id, fromId: c.id, fromName: c.name });
      log(c, 'war_declared', ruler.id, undefined, n.name);
      bump(c, 'wars');
      for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, has(p, 'bloodlust') || p.race === 'orc' ? 'warjoy' : 'wardread');
      break;
    }
  }

  // the weary sue for peace, and pay for it
  for (const id of Object.keys(wars)) {
    const w = wars[id];
    const days = (c.tick - w.since) / TICKS_PER_DAY;
    if (days < 15 || day % 4 !== 2) continue;
    const weary = days / 30 + w.lost * 1.2 + (foodDays(c) < 6 ? 2 : 0) + (fighters < 4 ? 3 : 0) - (has(ruler, 'bloodlust') ? 2 : 0) - (fierce ? 1 : 0) + per(ruler, AX.KIND);
    // a long war that nobody is fighting simply ends
    if (days > 120 || r.chance(Math.max(0, Math.min(0.6, weary * 0.06)))) {
      const tribute = days > 120 ? 0 : Math.round(Math.min(c.stock.silver * 0.3, 20 + w.lost * 8));
      c.stock.silver -= tribute;
      delete wars[id];
      g[id] = 0;
      c.out.push({ k: 'peace', to: id, fromId: c.id, fromName: c.name, tribute });
      log(c, 'peace_sued', ruler.id, undefined, w.name, tribute);
      for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'peace');
    }
  }

  // war bands, or a hard ruler's raid
  if (seasonOf(c.tick) === 3 || fighters < 5) return;
  const enemy = Object.keys(wars).find((id) => near.some((n) => n.id === id));
  const gap = enemy ? 9 : 25;
  if (c.tick - (c.story.raid ?? -99999) < TICKS_PER_DAY * gap || day % (enemy ? 3 : 5) !== 0) return;
  let target: { id: string; name: string } | undefined;
  if (enemy) {
    if (!r.chance(0.6)) return;
    target = near.find((n) => n.id === enemy);
  } else {
    const hungry = foodDays(c) < 6;
    if (!fierce && !(hungry && per(ruler, AX.KIND) < 0.3)) return;
    if (fighters < 6 || !r.chance(hungry ? 0.5 : per(ruler, AX.GREED) > 0.8 ? 0.25 : 0.1)) return;
    target = near[r.int(Math.min(2, near.length))];
  }
  if (!target) return;
  const n = Math.min(enemy ? 8 : 7, Math.max(3, fighters - 3));
  // the marshal leads, else the champion, else the best fighter
  const captain = pawnById(c, c.gov.titles.marshal ?? 0) ?? pawnById(c, c.gov.titles.champion ?? 0) ?? c.pawns.filter((p) => canFight(c, p) && !p.owner).sort((a, b) => b.sk[0] - a.sk[0])[0];
  c.story.raid = c.tick;
  c.out.push({ k: 'raid', to: target.id, kind: 'raider', n, fromId: c.id, fromName: c.name });
  if (enemy) {
    wars[enemy].sent++;
    log(c, 'warband', captain?.id ?? ruler.id, undefined, target.name, n);
    if (captain) think(c, captain, 'ledwarband');
  } else log(c, 'raidout', ruler.id, undefined, target.name, n);
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
  if (e.k === 'war') {
    // they have declared war on us
    const id = String(e.fromId);
    const wars = (c.wars ??= {});
    if (!wars[id]) wars[id] = { name: String(e.fromName), since: c.tick, sent: 0, came: 0, lost: 0, slain: 0, ours: false };
    (c.grudge ??= {})[id] = Math.max(c.grudge[id] ?? 0, 25);
    log(c, 'war_on_us', undefined, undefined, String(e.fromName));
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, has(p, 'bloodlust') || p.race === 'orc' ? 'warjoy' : 'wardread');
    return true;
  }
  if (e.k === 'peace') {
    const id = String(e.fromId);
    const tribute = Number(e.tribute) || 0;
    if (c.wars?.[id]) delete c.wars[id];
    if (c.grudge) c.grudge[id] = 0;
    c.stock.silver += tribute;
    log(c, 'peace_made', undefined, undefined, String(e.fromName), tribute);
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'peace');
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
    const war = c.wars ? Object.values(c.wars).find((w) => w.name === String(e.name)) : undefined;
    if (war) { war.lost += lost; war.slain += Number(e.slain) || 0; }
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, loot > 20 && !lost ? 'plunder' : lost ? 'raidlost' : 'raidnothing');
    return true;
  }
  return false;
}
