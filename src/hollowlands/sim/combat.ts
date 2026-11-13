// Trouble arrives: bandits, slavers, warbands, wolves, worse. Each tick is one exchange of
// blows. Colonists who can fight do; the rest run for the hall.

import { cacheOf } from './cache';
import { RACES } from './data/races';
import { bump, log, note } from './events';
import { isDown, wound } from './health';
import { capture } from './intrigue';
import { depart, die } from './life';
import { endNow, think } from './mood';
import { findPath } from './path';
import { STAGE, has, idleAct, pawnById, per, posAt, stage } from './pawn';
import { Rand, S } from './rng';
import { addFact, learn } from './social';
import { AX, type Colony, type Foe, type Pawn } from './types';

export interface FoeDef {
  k: string; name: string; plural: string;
  hp: number; atk: number; dmg: number; wound: string; spd: number;
  /** what they came for */
  goal: 'loot' | 'slave' | 'kill' | 'feed' | 'smash';
  /** fraction of the band that must fall before the rest run */
  nerve: number;
  beast?: boolean;
}

export const FOES: Record<string, FoeDef> = {
  raider: { k: 'raider', name: 'raider', plural: 'raiders', hp: 62, atk: 7, dmg: 14, wound: 'cut', spd: 10, goal: 'loot', nerve: 0.45 },
  bandit: { k: 'bandit', name: 'bandit', plural: 'bandits', hp: 55, atk: 6, dmg: 13, wound: 'cut', spd: 10, goal: 'loot', nerve: 0.5 },
  slaver: { k: 'slaver', name: 'slaver', plural: 'slavers', hp: 60, atk: 7, dmg: 10, wound: 'bruise', spd: 10, goal: 'slave', nerve: 0.5 },
  orc: { k: 'orc', name: 'orc raider', plural: 'orc raiders', hp: 80, atk: 9, dmg: 16, wound: 'cut', spd: 10, goal: 'kill', nerve: 0.67 },
  wolf: { k: 'wolf', name: 'wolf', plural: 'wolves', hp: 34, atk: 6, dmg: 10, wound: 'bite', spd: 15, goal: 'feed', nerve: 0.34, beast: true },
  ghoul: { k: 'ghoul', name: 'ghoul', plural: 'ghouls', hp: 48, atk: 6, dmg: 12, wound: 'bite', spd: 9, goal: 'kill', nerve: 1, beast: true },
  troll: { k: 'troll', name: 'troll', plural: 'trolls', hp: 240, atk: 8, dmg: 30, wound: 'crush', spd: 7, goal: 'smash', nerve: 1, beast: true },
  boar: { k: 'boar', name: 'maddened boar', plural: 'maddened boars', hp: 60, atk: 5, dmg: 14, wound: 'crush', spd: 13, goal: 'kill', nerve: 1, beast: true },
};

function edgeSpot(c: Colony, r: Rand, gate: boolean): [number, number] {
  if (gate) return [c.gx, c.gy];
  const k = cacheOf(c);
  for (let tries = 0; tries < 60; tries++) {
    const side = r.int(4);
    const x = side === 0 ? 1 : side === 1 ? c.w - 2 : 1 + r.int(c.w - 2);
    const y = side === 2 ? 1 : side === 3 ? c.h - 2 : 1 + r.int(c.h - 2);
    if (k.reach[y * c.w + x]) return [x, y];
  }
  return [c.gx, c.gy];
}

/** A band of something hostile enters the map. */
export function spawnRaid(c: Colony, kind: string, n: number, r: Rand): void {
  const def = FOES[kind];
  if (!def) return;
  const [ex, ey] = edgeSpot(c, r, !def.beast);
  const band = ++c.story.band;
  const k = cacheOf(c);
  // they gather at the edge before coming on, which is the colony's chance to see them
  const wait = c.tick + (def.beast ? 3 + r.int(4) : 8 + r.int(9));
  for (let i = 0; i < n; i++) {
    let x = ex;
    let y = ey;
    for (let tries = 0; tries < 10; tries++) {
      const nx = Math.max(0, Math.min(c.w - 1, ex + r.range(-2, 2)));
      const ny = Math.max(0, Math.min(c.h - 1, ey + r.range(-2, 2)));
      if (k.walk[ny * c.w + nx] && k.reach[ny * c.w + nx]) { x = nx; y = ny; break; }
    }
    c.foes.push({ id: c.nextFoe++, k: kind, name: def.name, x, y, px: x, py: y, hp: def.hp, max: def.hp, target: 0, mode: 0, loot: 0, held: 0, band, wait });
  }
  c.stats['band' + band] = n;
  log(c, 'raid', undefined, undefined, kind, n);
  bump(c, 'raids');
  bump(c, 'raid_' + kind);
}

export function canFight(c: Colony, p: Pawn): boolean {
  const st = stage(c, p);
  if (st < STAGE.TEEN || (st === STAGE.TEEN && p.race !== 'orc')) return false;
  if (has(p, 'pacifist') || isDown(p) || p.brk?.k === 'seized') return false;
  if (has(p, 'coward') || per(p, AX.BRAVE) < -1) return false;
  return p.sk[0] >= 4 || p.sk[1] >= 4 || per(p, AX.BRAVE) > 0.3 || p.prof === 'hunter' || p.prof === 'guard' || has(p, 'bloodlust');
}

function raise(c: Colony): void {
  if (c.alarm) return;
  c.alarm = c.tick;
  log(c, 'alarm');
  for (const p of c.pawns) if (!p.gone && p.brk?.k !== 'seized') endNow(c, p);
}

function stepToward(c: Colony, f: Foe, tx: number, ty: number, adj: boolean, spd: number): boolean {
  const path = findPath(c, f.x, f.y, tx, ty, adj);
  if (!path) return false;
  const n = Math.min(path.path.length - 1, spd);
  const i = path.path[n];
  f.x = i % c.w;
  f.y = Math.floor(i / c.w);
  return n >= path.path.length - 1;
}

function defense(c: Colony, p: Pawn): number {
  return p.sk[0] * 0.6 + (c.stock.weapons >= 1 ? 1.5 : 0) + (p.act.k === 'fight' ? 1.5 : 0) + (p.act.k === 'hide' ? 2 : 0) - (isDown(p) ? 4 : 0);
}

function rout(c: Colony, band: number): void {
  let any = false;
  for (const f of c.foes) if (f.band === band && f.mode !== 2) { f.mode = 2; any = true; }
  if (any) { log(c, 'rout', undefined, undefined, c.foes.find((f) => f.band === band)?.k); bump(c, 'routs'); }
}

/** Hit a foe. Returns true if it dies. */
export function strike(c: Colony, p: Pawn, f: Foe, dmg: number): boolean {
  f.hp -= dmg;
  if (f.mode === 1) f.mode = 0;
  if (f.mode === 0 && f.target !== p.id && !f.held) f.target = p.id;
  if (f.hp > 0) return false;
  const def = FOES[f.k];
  c.foes = c.foes.filter((x) => x !== f);
  bump(c, 'foesSlain');
  think(c, p, has(p, 'pacifist') || per(p, AX.KIND) > 1 ? 'killedsomeone' : 'slewfoe');
  note(c, p, 'slew', undefined, f.k);
  log(c, 'slew', p.id, undefined, f.k);
  c.stats['kills_' + p.id] = (c.stats['kills_' + p.id] ?? 0) + 1;
  if (!def.beast) {
    c.stock.weapons += 0.5;
    c.stock.silver += 2;
    // some are taken alive
    const cr = new Rand(c.seed, S.FIGHT, c.tick, f.id, 4);
    if (cr.chance(0.18)) capture(c, f.k, cr);
  }
  else if (f.k === 'wolf' || f.k === 'boar') { c.stock.meat += 6; c.stock.leather += 1; }
  if (f.held) {
    const cap = pawnById(c, f.held);
    if (cap) {
      cap.brk = undefined;
      cap.act = idleAct(c, cap, 1, 'freed');
      think(c, cap, 'rescued', p.id);
      log(c, 'rescued', p.id, cap.id);
      note(c, cap, 'rescued', p.id);
    }
  }
  // the rest lose heart when enough have fallen
  const start = c.stats['band' + f.band] ?? 1;
  let left = 0;
  for (const x of c.foes) if (x.band === f.band) left++;
  if (left > 0 && 1 - left / start >= def.nerve) rout(c, f.band);
  return true;
}

/** One exchange: every foe moves and strikes. Colonists act through their own decisions. */
export function combatTick(c: Colony): void {
  const t = c.tick;
  const r = new Rand(c.seed, S.FIGHT, t);
  const awake = c.pawns.filter((p) => !p.gone && !(p.act.k === 'sleep' && t >= p.act.ta));
  for (const f of c.foes.slice()) {
    if (!c.foes.includes(f)) continue;
    const def = FOES[f.k];
    f.px = f.x;
    f.py = f.y;

    // spotted?
    if (!c.alarm) {
      for (const p of c.pawns) {
        if (p.gone) continue;
        const i = posAt(c, p, t);
        const d = Math.max(Math.abs((i % c.w) - f.x), Math.abs(Math.floor(i / c.w) - f.y));
        const sees = awake.includes(p) ? (p.prof === 'guard' ? 22 : 13) : 3;
        if (d <= sees) { raise(c); break; }
      }
    }

    if (f.wait > t && !c.alarm) continue;
    // nobody stays for ever: after a few hours they give up, and a little later they are simply gone
    const stayed = t - f.wait;
    if (stayed > 70 && f.mode !== 2) f.mode = 2;
    if (f.mode === 2) {
      const [ex, ey] = def.beast ? [f.x < c.w / 2 ? 1 : c.w - 2, f.y] : [c.gx, c.gy];
      const moved = stepToward(c, f, ex, ey, true, def.spd);
      const stuck = f.x === f.px && f.y === f.py && !moved;
      const there = moved || stuck || stayed > 110;
      const held = f.held ? pawnById(c, f.held) : undefined;
      if (held) { held.x = f.x; held.y = f.y; held.act = idleAct(c, held, 3, 'seized'); }
      if (there || f.x <= 1 || f.y <= 1 || f.x >= c.w - 2 || f.y >= c.h - 2) {
        c.foes = c.foes.filter((x) => x !== f);
        if (held) { depart(c, held, 'taken'); bump(c, 'taken'); }
      }
      continue;
    }

    if (def.goal === 'loot' && f.mode === 0 && !f.target) f.mode = 1;
    if (f.mode === 1) {
      const store = c.blds.find((b) => b.k === 'store' && b.built) ?? c.blds.find((b) => b.k === 'hall' && b.built);
      if (!store) { f.mode = 2; continue; }
      const there = stepToward(c, f, store.x + Math.floor(store.w / 2), store.y + store.h, true, def.spd);
      if (there) {
        // ransacking takes a while, which gives the colony time to do something about it
        if (!c.foes.some((x) => x.band === f.band && x.loot > 0)) log(c, 'looted', undefined, undefined, f.k);
        let took = 0;
        for (const k of ['grain', 'veg', 'meat', 'meal', 'ale', 'goods', 'silver', 'tools', 'leather', 'cloth'] as const) {
          const n = c.stock[k] * 0.022;
          c.stock[k] -= n;
          took += n;
        }
        f.loot += 1;
        bump(c, 'looted', took);
        if (f.loot >= 6) f.mode = 2;
        raise(c);
      }
      continue;
    }

    if (def.goal === 'kill' && !def.beast && !c.pawns.some((p) => !p.gone && canFight(c, p))) { f.mode = 1; continue; }
    // pick someone to go for
    let target = f.target ? pawnById(c, f.target) : undefined;
    if (target && (target.gone || target.brk?.k === 'seized')) target = undefined;
    if (target && def.goal === 'loot' && (isDown(target) || target.act.k === 'hide')) { target = undefined; f.target = 0; f.mode = 1; continue; }
    if (!target) {
      let bd = 1e9;
      for (const p of c.pawns) {
        if (p.gone || p.brk?.k === 'seized') continue;
        const st = stage(c, p);
        if (st === STAGE.BABY) continue;
        const i = posAt(c, p, t);
        let d = Math.max(Math.abs((i % c.w) - f.x), Math.abs(Math.floor(i / c.w) - f.y));
        if (def.goal === 'slave') d += isDown(p) ? -8 : st === STAGE.ELDER ? 12 : 0;
        else if (isDown(p)) d += def.goal === 'feed' ? -4 : 14;
        if (def.goal === 'feed' && RACES[p.race].size < 0.7) d -= 5;
        if (p.act.k === 'fight') d -= 6;
        else if (p.act.k === 'hide' && t >= p.act.ta) d += 8;
        if (d < bd) { bd = d; target = p; }
      }
      f.target = target?.id ?? 0;
    }
    if (def.goal === 'smash' && r.chance(0.5)) {
      // trolls would as soon break a house as a head
      let near: (typeof c.blds)[number] | undefined;
      for (const b of c.blds) {
        if (!b.built || b.k === 'field') continue;
        if (f.x >= b.x - 1 && f.x <= b.x + b.w && f.y >= b.y - 1 && f.y <= b.y + b.h) { near = b; break; }
      }
      if (near) { near.dmg = Math.min(80, near.dmg + 12); bump(c, 'smashed'); continue; }
    }
    if (!target) { f.mode = 2; continue; }
    const ti = posAt(c, target, t);
    const tx = ti % c.w;
    const ty = Math.floor(ti / c.w);
    const adj = Math.abs(tx - f.x) <= 1 && Math.abs(ty - f.y) <= 1;
    if (!adj) {
      if (!stepToward(c, f, tx, ty, true, def.spd)) { f.target = 0; if (r.chance(0.3)) f.mode = 2; }
      continue;
    }
    raise(c);
    const bagged = def.goal === 'slave' && !isDown(target) && target.sk[0] < 6 && r.chance(0.16);
    if (def.goal === 'slave' && (isDown(target) || bagged) && c.foes.filter((x) => x.band === f.band && x.held).length < 2) {
      f.held = target.id;
      f.mode = 2;
      target.brk = { k: 'seized', x: t + 99999 };
      target.act = idleAct(c, target, 3, 'seized');
      log(c, 'seized', target.id, undefined, f.k);
      note(c, target, 'seized');
      continue;
    }
    if (r.chance(0.6 + (def.atk - defense(c, target)) * 0.035)) {
      wound(c, target, def.wound, def.dmg * (0.6 + r.float() * 0.8), r);
      if (f.k === 'ghoul' && target.inj.length) target.inj[target.inj.length - 1].inf += 30;
      if (target.hp <= 0 && !target.gone) {
        if (def.goal === 'slave') { target.hp = 5; }
        else {
          die(c, target, 'foe_' + f.k);
          f.target = 0;
          // a pack that has made its kill drags it off
          if (def.goal === 'feed') for (const x of c.foes) if (x.band === f.band && r.chance(0.7)) x.mode = 2;
        }
      }
    }
  }
  if (!c.foes.length) aftermath(c);
}

/** The last of them is dead or gone: count the cost. */
export function aftermath(c: Colony): void {
  const began = c.alarm;
  c.alarm = 0;
  for (const k of Object.keys(c.stats)) if (k.startsWith('band')) delete c.stats[k];
  if (c.raidFrom) {
    // word goes back to whoever sent them: what they took, and how many will not be coming home
    c.out.push({ k: 'spoils', to: c.raidFrom.id, name: c.name, loot: Math.max(0, (c.stats.looted ?? 0) - c.raidFrom.loot0), slain: Math.max(0, (c.stats.foesSlain ?? 0) - c.raidFrom.slain0) });
    c.raidFrom = undefined;
  }
  if (!began) return;
  log(c, 'allclear');
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.TEEN);
  for (const p of c.pawns) {
    if (p.gone) continue;
    const kills = c.stats['kills_' + p.id] ?? 0;
    if (kills > 0) {
      delete c.stats['kills_' + p.id];
      const f = addFact(c, 'hero', p.id, undefined, true);
      for (const o of adults) if (o !== p) learn(c, o, f);
      if (kills >= 2) log(c, 'hero', p.id, undefined, undefined, kills);
    } else if (p.act.k === 'hide' && stage(c, p) === STAGE.ADULT && (p.sk[0] >= 7 || p.sk[1] >= 7) && !isDown(p)) {
      const f = addFact(c, 'coward', p.id, undefined, true);
      for (const o of adults) if (o !== p && o.act.k === 'hide') learn(c, o, f);
    }
    if (stage(c, p) >= STAGE.CHILD) think(c, p, 'raidover');
    if (p.act.k === 'fight' || p.act.k === 'hide' || p.act.k === 'flee') endNow(c, p);
  }
}

/** What a colonist does while the alarm is up. Returns the foe to engage, or null to hide. */
export function pickFoe(c: Colony, p: Pawn): Foe | null {
  let best: Foe | null = null;
  let bd = 1e9;
  for (const f of c.foes) {
    let d = Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y));
    const out = Math.max(Math.abs(f.x - c.cx), Math.abs(f.y - c.cy));
    // nobody chases a beaten enemy into the woods, unless they are carrying someone off
    if (f.mode === 2 && !f.held && out > 16) continue;
    if (f.mode === 2 && !f.held) d += 20;
    if (f.held) d -= 6;
    if (f.target === p.id) d -= 4;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** A colonist's blow (or arrow) lands, or does not. */
export function attack(c: Colony, p: Pawn, foeId: number, ranged: boolean): void {
  const f = c.foes.find((x) => x.id === foeId);
  if (!f) return;
  const r = new Rand(c.seed, S.FIGHT, c.tick, p.id);
  const def = FOES[f.k];
  const dist = Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y));
  let fighters = 0;
  for (const o of c.pawns) if (o.act.k === 'fight') fighters++;
  const armed = Math.min(1, c.stock.weapons / Math.max(1, fighters));
  const lucky = has(p, 'lucky') ? 0.08 : has(p, 'jinxed') ? -0.08 : 0;
  if (ranged) {
    if (dist > 10) return;
    p.sk[1] = Math.min(20, p.sk[1] + 0.01);
    if (r.chance(0.3 + p.sk[1] * 0.04 - dist * 0.02 + lucky)) strike(c, p, f, 9 + r.int(8));
    return;
  }
  if (dist > 1) return;
  p.sk[0] = Math.min(20, p.sk[0] + 0.012);
  if (r.chance(0.5 + (p.sk[0] - def.atk) * 0.035 + lucky + (p.drunk > 50 ? -0.1 : 0))) {
    strike(c, p, f, (8 + 9 * armed) * RACES[p.race].size * (0.6 + r.float() * 0.8) * (has(p, 'bloodlust') ? 1.15 : 1));
  }
}
