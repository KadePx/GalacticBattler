// A siege. A warlord's host (or a neighbour at war, grown strong enough) does not throw itself at
// a walled town: it makes camp outside, out of bowshot, and waits. The gates stay shut, the fields
// outside go untended, the colony eats short rations. In camp the host makes ladders and a ram.
// Each morning it is weighed up: the colony may ride out against it (a sally), buy it off, or sit
// tight; the host may storm the walls with its ram and ladders, or, when its supplies run out, give
// up and go home. Every beat is written in the chronicle.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { foeMap } from './cache';
import { FOES, canFight, raise } from './combat';
import { foodDays } from './econ';
import { bump, log } from './events';
import { campLeft } from './exped';
import { think } from './mood';
import { STAGE, pawnById, per, stage } from './pawn';
import { Rand, S } from './rng';
import { insideWall } from './town';
import { wallR } from './walls';
import { AX, type Colony } from './types';

/** Can this colony be besieged: is its wall up (the palisade finished, at least)? */
export const siegeable = (c: Colony): boolean => !!c.walls && c.walls.done >= 1 && c.foes.length === 0 && !c.siege;

/** Where the host makes camp: out along the road, beyond bowshot of the wall, on open ground outside. */
function campSpot(c: Colony): [number, number] | null {
  const fm = foeMap(c);
  const W = c.w;
  const out = fm.comp[c.gy * W + c.gx];
  if (!out) return null;
  let vx = c.gx - c.cx;
  let vy = c.gy - c.cy;
  const l = Math.sqrt(vx * vx + vy * vy) || 1;
  vx /= l;
  vy /= l;
  const d = wallR(c) + 15;
  // beside the road, not on it
  const bx = Math.round(c.cx + vx * d - vy * 6);
  const by = Math.round(c.cy + vy * d + vx * 6);
  for (let r = 0; r <= 12; r++) {
    for (let y = by - r; y <= by + r; y++) {
      for (let x = bx - r; x <= bx + r; x++) {
        if (Math.max(Math.abs(x - bx), Math.abs(y - by)) !== r) continue;
        if (x < 4 || y < 4 || x >= W - 4 || y >= c.h - 4) continue;
        let open = 0;
        for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (fm.comp[yy * W + xx] === out) open++;
        if (open >= 20 && fm.comp[y * W + x] === out) return [x, y];
      }
    }
  }
  return null;
}

/** A host comes and lays siege. Returns false if there is no room to camp (it attacks as a raid instead). */
export function startSiege(c: Colony, kind: string, n: number, name: string, r: Rand, from?: { id: string; name: string }): boolean {
  const def = FOES[kind];
  if (!def) return false;
  const at = campSpot(c);
  if (!at) return false;
  const [ex, ey] = at;
  const band = ++c.story.band;
  const fm = foeMap(c);
  const W = c.w;
  for (let i = 0; i < n; i++) {
    let x = ex;
    let y = ey;
    for (let tries = 0; tries < 12; tries++) {
      const nx = ex + r.range(-3, 3);
      const ny = ey + r.range(-3, 3);
      if (fm.walk[ny * W + nx] && fm.comp[ny * W + nx] === fm.comp[ey * W + ex]) { x = nx; y = ny; break; }
    }
    c.foes.push({ id: c.nextFoe++, k: kind, name: def.name, x, y, px: x, py: y, hp: def.hp, max: def.hp, target: 0, mode: 3, loot: 0, held: 0, band, wait: c.tick + 99999 });
  }
  c.stats['band' + band] = n;
  c.siege = { name, band, t0: c.tick, x: ex, y: ey, sup: 5 + r.int(5) + (n >= 10 ? 2 : 0), ladders: 0, ram: 0, phase: 0, hr: 3 + r.int(5), n, s0: c.stats.foesSlain ?? 0, from: from?.name, fromId: from?.id };
  log(c, 'siege', undefined, undefined, 'begin:' + name + ':' + kind, n);
  bump(c, 'raids');
  bump(c, 'raid_' + kind);
  bump(c, 'sieges');
  c.stats.lastRaid = c.tick;
  return true;
}

/** The host breaks camp and comes on: against the walls (an assault), or the colony rides out at it (a sally). */
function attackNow(c: Colony, sally: boolean): void {
  const sg = c.siege!;
  sg.phase = sally ? 3 : 1;
  for (const f of c.foes) if (f.band === sg.band) { f.mode = 0; f.wait = c.tick; f.target = 0; f.wt = 0; }
  raise(c);
}

/** Everyone in the host turns for home. */
function leave(c: Colony): void {
  const sg = c.siege!;
  sg.phase = 2;
  for (const f of c.foes) if (f.band === sg.band) { f.mode = 2; f.wait = c.tick; }
}

/** Once a day while a host is camped outside (in the small hours, at its own hour): supplies run down, siege engines are made, and both sides weigh their chances. */
export function dailySiege(c: Colony): void {
  const sg = c.siege;
  if (!sg || c.tick % TICKS_PER_DAY !== (sg.hr ?? 0) * TICKS_PER_HOUR) return;
  const band = c.foes.filter((f) => f.band === sg.band);
  if (!band.length) { endSiege(c); return; }
  if (sg.phase === 2) return;
  const r = new Rand(c.seed, S.FIGHT, c.tick, 700);
  const days = Math.floor((c.tick - sg.t0) / TICKS_PER_DAY);
  sg.sup -= 1;
  if (days >= 1 && !sg.ladders) {
    sg.ladders = 2 + r.int(3);
    log(c, 'siege', undefined, undefined, 'ladders:' + sg.name, sg.ladders);
  } else if (days >= 2 && !sg.ram) {
    sg.ram = 1;
    log(c, 'siege', undefined, undefined, 'ram:' + sg.name);
  }
  if (days === 1) log(c, 'siege', c.gov.ruler || undefined, undefined, 'rations:' + sg.name, Math.round(foodDays(c)));
  if (sg.phase !== 0 || days < 1) return;
  let fighters = 0;
  for (const p of c.pawns) if (canFight(c, p) && insideWall(c, p.x, p.y)) fighters++;
  const them = band.length;
  const ruler = pawnById(c, c.gov.ruler);
  const price = Math.round(25 + them * 7);
  const hungry = foodDays(c) < 2.5;
  const bold = ruler ? per(ruler, AX.BRAVE) : 0;
  // (never against a host about to starve out of its own accord)
  if (sg.sup > 2 && ((fighters >= them * 3 && r.chance(0.35 + bold * 0.15)) || (hungry && fighters >= them * 0.8))) {
    // the gates open and the colony rides out
    const lead = pawnById(c, c.gov.titles.marshal ?? 0) ?? pawnById(c, c.gov.titles.champion ?? 0) ?? ruler;
    log(c, 'siege', lead?.id, undefined, (hungry ? 'sallyhungry:' : 'sally:') + sg.name, fighters);
    for (const p of c.pawns) if (canFight(c, p)) think(c, p, 'sallied');
    attackNow(c, true);
    return;
  }
  if (days >= 2 && ruler && c.stock.silver >= price && (fighters < them * 0.7 || bold < -0.6) && r.chance(0.55)) {
    c.stock.silver -= price;
    sg.paid = price;
    log(c, 'siege', ruler.id, undefined, 'paid:' + sg.name, price);
    for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'siegepaid');
    leave(c);
    return;
  }
  if (sg.sup <= 0) {
    log(c, 'siege', undefined, undefined, 'gaveup:' + sg.name, days);
    leave(c);
    return;
  }
  if (sg.ram && (r.chance(0.4) || sg.sup <= 1)) {
    log(c, 'siege', undefined, undefined, 'assault:' + sg.name, them);
    attackNow(c, false);
  }
}

/** The last of the host is dead or gone: the siege is over. */
export function endSiege(c: Colony): void {
  const sg = c.siege;
  if (!sg) return;
  // broken if at least half of them fell; otherwise they simply went
  const slain = (c.stats.foesSlain ?? 0) - (sg.s0 ?? 0);
  const how = sg.paid ? 'bought' : sg.n && slain * 2 >= sg.n ? 'won' : 'left';
  const days = Math.max(1, Math.round((c.tick - sg.t0) / TICKS_PER_DAY));
  log(c, 'siege', undefined, undefined, 'end:' + sg.name + ':' + how, days);
  if (how !== 'bought') for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'siegelifted');
  if (how !== 'bought') campLeft(c, sg.name);
  c.siege = undefined;
}

/** A camped foe idles about the fires: now and then it moves a step or two within the camp. */
export function campIdle(c: Colony, f: { x: number; y: number; id: number }): void {
  const sg = c.siege;
  if (!sg || (c.tick + f.id) % 9) return;
  const r = new Rand(c.seed, S.FIGHT, c.tick, f.id, 701);
  const nx = Math.max(sg.x - 4, Math.min(sg.x + 4, f.x + r.range(-1, 1)));
  const ny = Math.max(sg.y - 3, Math.min(sg.y + 3, f.y + r.range(-1, 1)));
  const fm = foeMap(c);
  if (fm.walk[ny * c.w + nx] && fm.comp[ny * c.w + nx] === fm.comp[f.y * c.w + f.x]) { f.x = nx; f.y = ny; }
}
