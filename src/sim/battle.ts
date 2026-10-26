// Deterministic battle simulator. Same two snapshots in -> same result out,
// on any machine. No randomness, no rendering. The game plays back the event log.

import { SHIPS, isSummon, levelOf } from './ships';
import { count } from './relics';
import { passiveId } from './commanders';
import { traitCounts, traitLevel } from './traits';
import type { Snapshot } from './types';

export interface BUnit {
  uid: number;
  side: 0 | 1;
  def: string;
  level: number;
  atk: number;
  hp: number;
  maxHp: number;
  cd: number;
  timer: number;
  shield: number; // each shield blocks one hit
  cloak: boolean;
  alive: boolean;
  revives: number; // Revenant rebuilds left
  attacks: number; // attacks made so far (Swarm Queen)
  mark: number; // extra damage this ship takes (Spotter / Sera marks)
  evade: number; // hits that will miss it (Rift Skimmer's Blink)
  burn: number; // damage per tick while burning
  burnT: number; // burning ticks left
  curse: boolean; // can't heal or rebuild (Hexer)
  armor: number; // damage taken per hit is reduced by this (min 1)
}

export type BEvent =
  | { t: number; k: 'shot'; s: number; d: number; dmg: number; blocked: boolean; hp: number; sh: number; ram?: boolean; zap?: boolean; miss?: boolean; burn?: boolean }
  | { t: number; k: 'heal'; s: number; d: number; amt: number; hp: number }
  | { t: number; k: 'jam'; s: number; d: number }
  | { t: number; k: 'buff'; u: number; atk: number; hp: number; label: string; sh?: number }
  | { t: number; k: 'cloak'; u: number; on: boolean }
  | { t: number; k: 'revive'; u: number; hp: number }
  | { t: number; k: 'spawn'; s: number; unit: BUnit; reserve?: boolean }
  | { t: number; k: 'die'; u: number }
  | { t: number; k: 'drag'; s: number; u: number; before: number };

export interface BattleResult {
  units: BUnit[]; // starting state, in line order per side
  events: BEvent[];
  winner: 0 | 1 | -1; // -1 = draw
  ticks: number;
}

export const MAX_TICKS = 300;
/** After this tick, every shot deals +1 damage per 10 ticks so stalemates can't last forever. */
export const OVERLOAD_TICK = 80;
const overloadBonus = (t: number) => (t > OVERLOAD_TICK ? Math.floor((t - OVERLOAD_TICK) / 10) + 1 : 0);
const MAX_LINE = 10; // spawns stop when a side has this many ships alive

/**
 * Hull scaling: ATK grows faster than HP over a run, so late fights would end
 * in a couple of ticks. From round HULL_START on, all battle HP is multiplied
 * by a growing factor. Both fleets use the higher of the two rounds.
 * Tuned so bot-vs-bot fights average roughly 16-18 ticks in every round.
 */
const HULL_START = 4;
const HULL_STEP = 0.2;
export const hullScale = (round: number) => 1 + HULL_STEP * Math.max(0, round - HULL_START);

// ---------- setup ----------

type UnitFactory = (side: 0 | 1, def: string, level: number, atk: number, hp: number, cd: number, timer: number) => BUnit;

function factory(next: { uid: number }, scale: number): UnitFactory {
  return (side, def, level, atk, hp, cd, timer) => {
    cd = Math.max(2, cd);
    hp = Math.max(1, Math.round(hp * scale));
    return {
      uid: next.uid++, side, def, level, atk, hp, maxHp: hp, cd,
      timer: Math.max(1, Math.min(cd, timer)), shield: 0, cloak: false, alive: true, revives: 0, attacks: 0, mark: 0, evade: 0, burn: 0, burnT: 0, curse: false, armor: 0,
    };
  };
}

/** Fighter stats: carriers, hangars, queens and Ryx all launch these. */
function fighter(make: UnitFactory, side: 0 | 1, snap: Snapshot, level: number, atk: number, hp: number): BUnit {
  const relics = snap.relics;
  const sq = count(relics, 'squadron');
  const hive = passiveId(snap.cmd) === 'ryx.b' ? 1 : 0;
  const cd = SHIPS.fighter.cd - count(relics, 'overclock');
  return make(side, 'fighter', level, atk + sq + hive + count(relics, 'targeting'), hp + sq + 2 * hive, cd, cd);
}

function buildSide(snap: Snapshot, side: 0 | 1, make: UnitFactory, scale = 1): BUnit[] {
  const r = (id: string) => count(snap.relics, id);
  const counts = traitCounts(snap.fleet, snap.relics);
  const tl = (id: keyof typeof counts) => traitLevel(id, counts[id]);
  const cp = passiveId(snap.cmd);
  const out: BUnit[] = [];

  for (const s of snap.fleet) {
    if (!s || !SHIPS[s.def]) continue;
    const d = SHIPS[s.def];
    const L = levelOf(s.xp);
    const has = (c: string) => d.classes.includes(c as never);

    let atk = s.atk + r('targeting');
    if (s.def === 'torpedo' || s.def === 'lance' || s.def === 'siege') atk += 2 * r('warheads');
    if (s.def === 'drone') atk += 2 * r('nanites'); // drones heal 2x ATK, so this is +4 healing
    if (has('strike')) atk += [0, 1, 2][tl('strike')];
    if (has('artillery') && tl('artillery') >= 1) atk += 1;
    if (cp === 'vance.a' && L >= 2) atk += 1;
    if (cp === 'nyx.a' && has('strike')) atk += 1;
    if (cp === 'juno.b' && s.def === 'drone') atk += 1; // drones heal 2x ATK, so +2 healing

    let hp = s.hp + 3 * r('plating') - 2 * r('overclock'); // Overclock trades hull for speed
    if (has('guard')) hp += [0, 5, 9][tl('guard')];
    if (has('strike')) hp += [0, 2, 2][tl('strike')];
    if (has('tech') && tl('tech') >= 1) hp += 2;
    if (tl('tech') >= 2) hp += 3;
    if (cp === 'nyx.a' && has('strike')) hp += 1;
    if (s.def === 'gunboat' && L >= 2) hp += 3;
    if (s.def === 'dread' && L >= 2) atk += 2;
    if ((s.def === 'nova' || s.def === 'eclipse') && L >= 2) atk += 2;
    if (s.def === 'leviathan' && L >= 2) hp += 10;
    if (L >= 3) {
      atk += 3 * r('gyro');
      hp += 6 * r('gyro');
    }
    if (cp === 'vance.a') hp += L >= 2 ? 2 : 1;
    if (cp === 'kael.b' && has('guard')) hp += 4;
    if (cp === 'juno.b' && has('tech')) hp += 3;
    if (cp === 'juno.a' && has('tech')) atk += 1;
    if (has('concord')) hp += [0, 2, 2][tl('concord')];
    if (has('reaver')) {
      atk += [0, 0, 1][tl('reaver')];
      hp += [0, 2, 2][tl('reaver')];
    }
    if (s.def === 'picket' && L >= 3) hp += 2;
    if (cp === 'tess.a') hp += snap.bench ?? 0;
    if (has('void') && tl('void') >= 2) atk += 1;
    if (has('void') && cp === 'nihl.a') atk += 1;

    // Overclock can't push a ship below 3 ticks; on the fastest ships a tick is too big a share.
    let cd = r('overclock') ? Math.max(Math.min(d.cd, 3), d.cd - r('overclock')) : d.cd;
    if (has('tech') && tl('tech') >= 1) cd -= 1;
    if (has('strike') && tl('strike') >= 2) cd -= 1;
    if (s.def === 'scout') cd -= L - 1;
    if (s.def === 'siege' && L >= 2) cd -= 2;
    if (s.def === 'railgun' && L >= 2) cd -= 1;
    if (s.def === 'nova' && L >= 3) cd -= 2;

    let timer = Math.max(2, cd) - 2 * r('alpha');
    if (has('artillery') && tl('artillery') >= 2) timer -= 1;
    if (cp === 'nyx.b' && has('strike')) timer -= 3;
    if (cp === 'orin.a' && has('artillery')) timer -= 2;
    if ((s.def === 'torpedo' && L >= 2) || (s.def === 'siege' && L >= 3)) timer = 1;

    const u = make(side, s.def, L, atk, hp, cd, timer);
    if (s.def === 'bulwark') u.shield += L >= 2 ? 2 : 1;
    if (s.def === 'reflector' && L >= 3) u.shield += 1;
    if (has('guard') && tl('guard') >= 2) u.shield += 1;
    if (s.def === 'phantom' || s.def === 'eclipse') u.cloak = true;
    if (s.def === 'leviathan') u.armor += L >= 3 ? 3 : 2;
    if (s.def === 'revenant') u.revives = L >= 3 ? 2 : 1;
    if (s.def === 'picket' && L >= 2) u.shield += L >= 3 ? 2 : 1;
    if (s.def === 'bastion') u.shield += 1;
    if (s.def === 'skimmer') u.evade = L >= 2 ? 2 : 1;
    out.push(u);
  }

  if (cp === 'orin.b' && out.length) {
    const top = out.reduce((m, x) => (x.atk > m.atk ? x : m), out[0]);
    top.atk += 3;
  }

  // Launch fighters behind the line.
  for (const u of [...out]) {
    if (u.def !== 'carrier') continue;
    // LV1: 2 fighters 1/1. LV2: 2 fighters 1/2. LV3: 3 fighters 2/2.
    const n = u.level >= 3 ? 3 : 2;
    const fa = u.level >= 3 ? 2 : 1;
    const fh = u.level >= 2 ? 2 : 1;
    for (let k = 0; k < n; k++) out.push(fighter(make, side, snap, u.level, fa, fh));
  }
  for (const u of [...out]) {
    if (u.def !== 'brood') continue;
    const f = u.level >= 2 ? 3 : 2;
    for (let k = 0; k < 2; k++) out.push(fighter(make, side, snap, u.level, f, f));
  }
  for (let k = 0; k < r('hangar'); k++) out.push(fighter(make, side, snap, 1, 2, 2));
  if (cp === 'ryx.a') {
    const n = Math.floor(snap.fleet.filter(Boolean).length / 3);
    // Plain 1/1 fighters: they don't get relic bonuses, or swarm builds snowball.
    const cd = SHIPS.fighter.cd - r('overclock');
    for (let k = 0; k < n; k++) out.push(make(side, 'fighter', 1, 1, 1, cd, cd));
  }

  // Battle-start auras, based on line position.
  const ships = [...out];
  ships.forEach((u, i) => {
    if (u.def === 'aegis') {
      const behind = u.level >= 3 ? ships.filter((x) => x !== u) : ships.slice(i + 1, i + 2 + u.level);
      for (const x of behind) x.shield += 1;
    }
    if (u.def === 'bulwark' && u.level >= 3 && ships[i + 1]) ships[i + 1].shield += 1;
    if (u.def === 'command') {
      const bonus = u.level >= 2 ? 4 : 3;
      const near = u.level >= 3 ? ships.filter((x) => x !== u) : [ships[i - 1], ships[i + 1]].filter(Boolean);
      for (const x of near) {
        x.atk += bonus;
        x.hp += bonus;
        x.maxHp += bonus;
      }
    }
  });
  if (out[0] && r('matrix') > 0) out[0].shield += 1;
  if (out[0] && cp === 'kael.a') out[0].shield += 1;
  // Sera's Phalanx: the front Concord ship starts with 2 shields.
  if (cp === 'sera.a') {
    const lead = out.find((x) => SHIPS[x.def].classes.includes('concord'));
    if (lead) lead.shield += 2;
  }
  for (const f of out.filter((x) => x.def === 'flagship')) {
    for (const x of out) {
      if (!SHIPS[x.def].classes.includes('concord')) continue;
      x.atk += f.level >= 2 ? 4 : 3;
      if (f.level >= 3) {
        x.hp += 3;
        x.maxHp += 3;
      }
    }
  }
  if (out[0] && r('phase')) out[0].evade += r('phase');
  if (out[0]) out[0].armor += 2 * r('ablative');
  if (tl('concord') >= 2) {
    for (const u of out.filter((x) => SHIPS[x.def].classes.includes('concord')).slice(0, 2)) u.shield += 1;
  }

  // Mines go in FRONT of the line (after front-ship effects, so those still land on a real ship).
  const mines: BUnit[] = [];
  const mine = (dmg: number) => {
    const m = make(side, 'mine', 1, Math.round(dmg * scale), 1, SHIPS.mine.cd, SHIPS.mine.cd);
    m.hp = m.maxHp = 1;
    mines.push(m);
  };
  for (const u of out) {
    if (u.def !== 'minelayer') continue;
    // LV1: 1 mine. LV2: mines hit 2 harder. LV3: 2 mines. Explosions grow with the Mine Layer's ATK.
    for (let k = 0; k < (u.level >= 3 ? 2 : 1); k++) mine(u.atk + 2 + (u.level >= 2 ? 2 : 0));
  }
  for (let k = 0; k < r('minefield'); k++) mine(2);
  out.unshift(...mines);
  return out;
}

// ---------- simulation ----------

interface Shot {
  s: BUnit;
  d: BUnit;
  dmg: number;
  pierce?: boolean;
  jam?: number;
  drain?: boolean; // Ion: the jam also saps ATK
  onKill?: 'reload' | 'recloak';
  ram?: boolean;
  zap?: boolean;
  first?: boolean; // the shooter's opening shot (Sera's Spotter Net)
  burn?: number; // sets the target burning for this much per tick
  curse?: boolean; // the target can't heal or rebuild
}

export function simulate(a: Snapshot, b: Snapshot): BattleResult {
  const next = { uid: 1 };
  const scale = hullScale(Math.max(a.round, b.round));
  const make = factory(next, scale);
  const snaps = [a, b];
  const units = [...buildSide(a, 0, make, scale), ...buildSide(b, 1, make, scale)];
  // Juno's Jamming Field delays the whole enemy line.
  snaps.forEach((snap, side) => {
    if (passiveId(snap.cmd) !== 'juno.a') return;
    for (const u of units) if (u.side !== side) u.timer += 1;
  });
  // Per-side synergy levels and passives, for effects that fire mid-battle.
  const sideTl = snaps.map((snap) => {
    const c = traitCounts(snap.fleet, snap.relics);
    return (id: keyof typeof c) => traitLevel(id, c[id]);
  });
  const sideCp = snaps.map((snap) => passiveId(snap.cmd));
  const initial = units.map((u) => ({ ...u }));
  const events: BEvent[] = [];
  for (const side of [0, 1] as const) {
    const dragged = new Set<BUnit>();
    for (const g of units.filter((u) => u.side === side && u.def === 'grappler')) {
      for (let k = 0; k < (g.level >= 3 ? 2 : 1); k++) {
        const foesReal = units.filter((u) => u.side !== side && !isSummon(u.def));
        const free = foesReal.filter((u) => !dragged.has(u));
        const victim = free[free.length - 1];
        if (free.length < 2 || victim === foesReal[0]) continue;
        dragged.add(victim);
        units.splice(units.indexOf(victim), 1);
        units.splice(units.indexOf(foesReal[0]), 0, victim);
        if (g.level >= 2) victim.timer += 3;
        events.push({ t: 1, k: 'drag', s: g.uid, u: victim.uid, before: foesReal[0].uid });
      }
    }
  }
  for (const o of units.filter((u) => u.def === 'overseer' && u.level >= 2)) {
    for (const x of units) if (x.side === o.side && x.def !== 'overseer') x.timer = Math.max(1, x.timer - 2);
  }
  const line = (side: number) => units.filter((u) => u.alive && u.side === side);
  // Cloaked ships can't be picked unless nothing else is left.
  const targets = (side: number) => {
    const l = line(side);
    const visible = l.filter((u) => !u.cloak);
    return visible.length ? visible : l;
  };
  const lowest = (l: BUnit[]) => l.reduce((m, x) => (x.hp < m.hp ? x : m), l[0]);
  /** Real ships only (no fighters or mines), unless those are all that's left. */
  const ships = (l: BUnit[]) => {
    const real = l.filter((x) => !isSummon(x.def));
    return real.length ? real : l;
  };

  const lastStand = [false, false];
  const rallied = [false, false];
  const reserveIn = [false, false];
  const echoChamber = [false, false];
  /** Leave a Void Echo on that side (a battle-only unit at the back of the line). */
  const spawnEcho = (side: 0 | 1, atk: number, hp: number, src: BUnit) => {
    if (line(side).length >= MAX_LINE) return;
    const e = make(side, 'echo', 1, atk, hp, SHIPS.echo.cd, SHIPS.echo.cd);
    units.push(e);
    events.push({ t, k: 'spawn', s: src.uid, unit: { ...e } });
  };
  /** A visible Picket on that side, which pulls snipes onto itself. */
  const picket = (side: number) => line(side).find((u) => u.def === 'picket' && !u.cloak);

  const outcome = (): 0 | 1 | -1 | null => {
    const p = line(0).filter((u) => u.def !== 'mine').length;
    const e = line(1).filter((u) => u.def !== 'mine').length;
    if (p && e) return null;
    return !p && !e ? -1 : e === 0 ? 0 : 1;
  };

  let t = 0;

  function buff(u: BUnit, atk: number, heal: number, label: string) {
    u.atk += atk;
    if (heal && u.hp > 0 && !u.curse) u.hp = Math.min(u.maxHp, u.hp + heal);
    events.push({ t, k: 'buff', u: u.uid, atk: u.atk, hp: u.hp, label });
  }

  const hit = (sh: Shot, bonus: number) => {
    const { s, d } = sh;
    const before = d.hp;
    const raw = sh.dmg + bonus + d.mark + (sh.first && sideCp[s.side] === 'tess.b' ? 2 : 0);
    const dmg = d.armor && !sh.zap && raw > 0 ? Math.max(1, raw - d.armor) : raw;
    // Blink: the hit misses entirely (zaps and explosions can't be dodged).
    if (d.evade > 0 && !sh.zap && !sh.ram && d.hp > 0) {
      d.evade--;
      events.push({ t, k: 'shot', s: s.uid, d: d.uid, dmg: 0, blocked: true, hp: d.hp, sh: d.shield, miss: true });
      if (d.def === 'skimmer' && d.level >= 3) buff(d, 2, 0, '+2 ATK');
      return;
    }
    let blocked = false;
    if (d.shield > 0 && !sh.pierce) {
      d.shield--;
      blocked = true;
    } else {
      d.hp -= dmg;
    }
    events.push({ t, k: 'shot', s: s.uid, d: d.uid, dmg, blocked, hp: Math.max(0, d.hp), sh: d.shield, ram: sh.ram, zap: sh.zap });
    // Thorns: Ironmaw (and Guard ships with Thorn Plating) hit back. Thorns can't be dodged and never chain.
    if (!blocked && !sh.zap && s.alive) {
      let thorns = d.def === 'ironmaw' ? 2 * d.level : d.def === 'leviathan' ? (d.level >= 3 ? 5 : 3) : 0;
      if (SHIPS[d.def]?.classes.includes('guard') && !isSummon(s.def)) thorns += count(snaps[d.side].relics, 'thorns');
      if (thorns) hit({ s: d, d: s, dmg: thorns, pierce: true, zap: true }, 0);
    }
    if (!blocked && !sh.zap && before > 0 && s.alive && s.hp > 0) {
      const dealt = Math.max(0, Math.min(dmg - bonus, before));
      // Void life-steal: Wraith and Oblivion heal from damage; Void ships heal per hit with the faction bonus.
      let heal = 0;
      let gain = 0;
      if (s.def === 'wraith') {
        heal += s.level >= 2 ? dealt : Math.ceil(dealt / 2);
        if (s.level >= 3) gain += 1;
      }
      if (s.def === 'oblivion') heal += s.level >= 3 ? dealt : Math.ceil(dealt / 2);
      if (s.def === 'eclipse') heal += dealt;
      if (SHIPS[s.def]?.classes.includes('void')) {
        const vl = sideTl[s.side]('void');
        heal += vl >= 2 ? Math.ceil(dealt * 0.7) : vl >= 1 ? Math.ceil(dealt * 0.5) : 0;
        if (sideCp[s.side] === 'nihl.a') heal += 3;
      }
      heal = Math.min(heal, dealt + (sideCp[s.side] === 'nihl.a' ? 3 : 0)); // never more than the hit took (plus Hunger)
      if (gain) buff(s, gain, 0, `+${gain} ATK`);
      const healed = s.curse ? 0 : Math.min(heal, s.maxHp - s.hp);
      if (healed > 0) {
        s.hp += healed;
        events.push({ t, k: 'heal', s: s.uid, d: s.uid, amt: healed, hp: s.hp });
      }
      // Siphon drains ATK; at LV2 it hands the stolen ATK to your front ship.
      if (s.def === 'siphon' && d.hp > 0 && d.atk > 0) {
        const drain = Math.min(d.atk, s.level >= 3 ? 2 : 1);
        d.atk -= drain;
        events.push({ t, k: 'buff', u: d.uid, atk: d.atk, hp: d.hp, label: `-${drain} ATK` });
        const front = ships(line(s.side))[0];
        if (s.level >= 2 && front) buff(front, drain, 0, `+${drain}`);
      }
    }
    if (!blocked && d.hp > 0 && sh.burn) {
      d.burn = Math.max(d.burn, sh.burn);
      d.burnT = 3;
    }
    if (!blocked && d.hp > 0 && sh.curse && !d.curse) {
      d.curse = true;
      if (s.def === 'hexer' && s.level >= 2 && d.atk > 0) d.atk -= 1;
      events.push({ t, k: 'buff', u: d.uid, atk: d.atk, hp: d.hp, label: 'CURSED' });
    }
    if (sh.jam && !blocked) {
      const jammer = count(snaps[s.side].relics, 'jammer');
      d.timer += sh.jam + (sh.drain ? 2 * jammer : 0);
      events.push({ t, k: 'jam', s: s.uid, d: d.uid });
      // Ion drain: each jam also saps ATK (more with Jammer Array), which counters builds that scale up mid-fight.
      const drain = sh.drain ? Math.min(d.atk, 1 + jammer) : 0;
      if (drain > 0 && d.hp > 0) {
        d.atk -= drain;
        events.push({ t, k: 'buff', u: d.uid, atk: d.atk, hp: d.hp, label: `-${drain} ATK` });
      }
    }
    // Marks: Spotter shots, and Sera's Spotter Net on each ship's opening shot.
    const markBy = s.def === 'spotter' ? (s.level >= 2 ? 3 : 2) : sh.first && sideCp[s.side] === 'sera.b' ? 1 : 0;
    if (markBy > d.mark && d.hp > 0) {
      d.mark = markBy;
      events.push({ t, k: 'buff', u: d.uid, atk: d.atk, hp: Math.max(0, d.hp), label: 'MARKED' });
    }
    if (blocked && d.alive) {
      // Bastions grow on every block; Sera's Phalanx patches up the blocker.
      for (const b of line(d.side)) {
        if (b.def !== 'bastion') continue;
        buff(b, b.level >= 2 ? 3 : 2, 0, `+${b.level >= 2 ? 3 : 2} ATK`);
        if (b.level >= 3 && d.hp < d.maxHp) buff(d, 0, 3, '+3');
      }
    }
    // Reflectors punish hits that bounce off their side's shields. Zaps pierce, so they never chain.
    if (blocked && s.alive && !sh.zap) {
      for (const ref of line(d.side)) {
        if (ref.def !== 'reflector') continue;
        hit({ s: ref, d: s, dmg: [0, 3, 5, 8][ref.level], pierce: true, zap: true }, 0);
      }
    }
    if (before > 0 && d.hp <= 0 && s.alive) {
      // Kill rewards (only for real ships, not fighters or mines).
      if (!isSummon(d.def)) {
        let gain = 3 * count(snaps[s.side].relics, 'trophy') + (sideCp[s.side] === 'grisk.a' ? 1 : 0);
        let heal = sideCp[s.side] === 'grisk.a' ? 3 : 0;
        if (s.def === 'scrapper') {
          gain += s.level >= 2 ? 3 : 2;
          if (s.level >= 3) heal += 4;
        }
        if (s.def === 'ravager' && s.level >= 3) gain += 2;
        if (s.def === 'corsair' && s.level >= 2 && (d.revives === 0 || d.curse)) gain += 1;
        if (gain || heal) buff(s, gain, heal, gain ? `+${gain} ATK` : `+${heal}`);
      }
      const realKill = !isSummon(d.def) && (d.revives === 0 || d.curse);
      if (sh.onKill === 'reload' && (s.def !== 'corsair' || realKill)) s.timer = 1;
      if (sh.onKill === 'recloak' && !s.cloak) {
        s.cloak = true;
        events.push({ t, k: 'cloak', u: s.uid, on: true });
      }
    }
  };


  /** Everything that reacts to a ship going down (also fires when a Revenant rebuilds). */
  const onLoss = (u: BUnit, rebuilt = false) => {
    if (u.def === 'interceptor') {
      const foes = targets(1 - u.side);
      const dmg = u.atk * (u.level >= 2 ? 2 : 1);
      for (const f of u.level >= 3 ? foes : foes.slice(0, 1)) hit({ s: u, d: f, dmg, ram: true }, 0);
    }
    // Mines explode at the front enemy.
    if (u.def === 'mine') {
      const front = targets(1 - u.side)[0];
      if (front) hit({ s: u, d: front, dmg: u.atk, ram: true }, 0);
    }
    // Void Herald leaves Echoes; Nihl's Echo Chamber gives the first real loss an Echo.
    if (u.def === 'herald' && !rebuilt) {
      if (u.level >= 3) {
        spawnEcho(u.side, 4, 4, u);
        spawnEcho(u.side, 4, 4, u);
      } else spawnEcho(u.side, u.level >= 2 ? 5 : 3, u.level >= 2 ? 5 : 3, u);
    }
    if (!rebuilt && !isSummon(u.def) && sideCp[u.side] === 'nihl.b' && !echoChamber[u.side]) {
      echoChamber[u.side] = true;
      spawnEcho(u.side, 2, 2, u);
    }
    // Fighters and mines are disposable: losing one doesn't feed Salvagers,
    // Vengeance or Reavers (otherwise swarms of 1-HP units snowball those effects).
    if (isSummon(u.def)) return;
    // Reavers feed on enemy losses.
    const foeSide = 1 - u.side;
    const rl = sideTl[foeSide]('reaver');
    if (rl > 0) {
      for (const x of line(foeSide)) {
        if (!SHIPS[x.def]?.classes.includes('reaver')) continue;
        buff(x, rl >= 2 ? 2 : 1, rl >= 2 ? 2 : 1, `+${rl >= 2 ? 2 : 1}`);
      }
    }
    // Grisk's Last Stand: the first real ship you lose blows up at the front enemy.
    if (!rebuilt && sideCp[u.side] === 'grisk.b' && !lastStand[u.side]) {
      lastStand[u.side] = true;
      const front = targets(1 - u.side)[0];
      if (front) hit({ s: u, d: front, dmg: 5, ram: true }, 0);
    }
    // Rally Beacon: the first real loss speeds up everyone left.
    if (!rebuilt && !rallied[u.side] && count(snaps[u.side].relics, 'beacon')) {
      rallied[u.side] = true;
      for (const x of line(u.side)) {
        if (x === u) continue;
        x.cd = Math.max(2, x.cd - 1);
        x.timer = Math.max(1, x.timer - 1);
        events.push({ t, k: 'buff', u: x.uid, atk: x.atk, hp: x.hp, label: 'RALLY' });
      }
    }
    const vengeance = count(snaps[u.side].relics, 'vengeance');
    for (const x of line(u.side)) {
      if (x === u || x.def === 'salvager') continue;
      if (vengeance) buff(x, vengeance, 0, `+${vengeance}`);
    }
    for (const x of [...line(0), ...line(1)]) {
      if (x === u || x.def !== 'salvager') continue;
      const gain = (x.level >= 2 ? 3 : 2) + (x.side === u.side ? vengeance : 0);
      buff(x, gain, x.level >= 3 ? 3 : 0, `+${gain} ATK`);
    }
  };

  let winner = outcome();
  while (winner === null && t < MAX_TICKS) {
    t++;
    const acting: BUnit[] = [];
    for (const u of units) {
      if (!u.alive || u.def === 'mine') continue;
      if (--u.timer <= 0) {
        u.timer = u.cd;
        acting.push(u);
      }
    }

    // Every ship picks targets from the state at the start of the tick,
    // so who acts "first" never matters. Both sides are treated the same.
    const shots: Shot[] = [];
    const heals: { s: BUnit; d: BUnit; amt: number }[] = [];
    for (const u of acting) {
      const foes = targets(1 - u.side);
      if (!foes.length) continue;
      const L = u.level;
      switch (u.def) {
        case 'drone': {
          const hurt = line(u.side).filter((x) => x.hp < x.maxHp && !x.curse).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
          if (hurt.length) for (const x of hurt.slice(0, L >= 3 ? hurt.length : L)) heals.push({ s: u, d: x, amt: 2 * u.atk });
          else shots.push({ s: u, d: foes[0], dmg: 1 });
          break;
        }
        case 'torpedo':
          for (const f of ships(foes).slice(L >= 3 ? -2 : -1)) shots.push({ s: u, d: f, dmg: u.atk });
          break;
        case 'lance':
          shots.push({ s: u, d: lowest(ships(foes)), dmg: u.atk, pierce: L >= 2, onKill: L >= 3 ? 'reload' : undefined });
          break;
        case 'dread':
          for (const f of foes.slice(0, L >= 3 ? 3 : 2)) shots.push({ s: u, d: f, dmg: u.atk });
          break;
        case 'gunboat':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk });
          break;
        case 'ion':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk, jam: L >= 2 ? 7 : 5, drain: true, pierce: true }); // ion bolts go through shields
          break;
        case 'siege':
          for (const f of foes) shots.push({ s: u, d: f, dmg: u.atk });
          break;
        case 'railgun':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk, pierce: true });
          break;
        case 'oblivion':
          for (const f of foes.slice(0, L >= 2 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk, pierce: true });
          break;
        case 'incinerator':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk, burn: Math.max(1, Math.round((L >= 2 ? 2 : 1) * scale)) });
          break;
        case 'hexer':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk, curse: true });
          break;
        case 'corsair':
          shots.push({ s: u, d: L >= 3 ? lowest(ships(foes)) : foes[0], dmg: u.atk, onKill: 'reload' });
          break;
        case 'bomber':
          shots.push({ s: u, d: foes[0], dmg: u.atk });
          for (const f of foes.slice(1, L >= 3 ? 3 : 2)) shots.push({ s: u, d: f, dmg: L >= 2 ? u.atk : Math.ceil(u.atk / 2) });
          break;
        case 'spotter':
          for (const f of foes.slice(0, L >= 3 ? 2 : 1)) shots.push({ s: u, d: f, dmg: u.atk });
          break;
        case 'ravager':
          shots.push({ s: u, d: foes[0], dmg: u.atk });
          if (foes[1]) shots.push({ s: u, d: foes[1], dmg: L >= 2 ? u.atk : Math.ceil(u.atk / 2) });
          break;
        case 'nova':
          for (const f of foes) shots.push({ s: u, d: f, dmg: u.atk, pierce: true });
          break;
        case 'eclipse':
          shots.push({ s: u, d: lowest(ships(foes)), dmg: u.cloak ? 2 * u.atk : u.atk, onKill: L >= 3 ? 'recloak' : undefined });
          break;
        case 'phantom':
          // Ambush: striking from cloak deals double damage.
          shots.push({ s: u, d: L >= 2 ? lowest(ships(foes)) : foes[0], dmg: u.cloak ? 2 * u.atk : u.atk, onKill: L >= 3 ? 'recloak' : undefined });
          break;
        default:
          shots.push({ s: u, d: foes[0], dmg: u.atk });
      }
      // Pickets pull snipes (Lance, hunting Phantom) onto themselves.
      if (u.def === 'lance' || u.def === 'eclipse' || (u.def === 'phantom' && L >= 2)) {
        const pk = picket(1 - u.side);
        if (pk) for (const sh of shots) if (sh.s === u) sh.d = pk;
      }
      if (u.attacks === 0) for (const sh of shots) if (sh.s === u) sh.first = true;
      // Napalm Rounds: artillery shots set targets burning.
      if (count(snaps[u.side].relics, 'napalm') && SHIPS[u.def]?.classes.includes('artillery')) {
        const main = shots.find((sh) => sh.s === u);
        if (main && !main.burn) main.burn = Math.max(1, Math.round(scale * 0.6));
      }
      // Jammer Array: every ship's opening shot also jams its target for 2 ticks.
      if (u.attacks === 0 && count(snaps[u.side].relics, 'jammer')) {
        for (const sh of shots) if (sh.s === u && !sh.jam) sh.jam = 2;
      }
      u.attacks++;
    }

    // Attacking reveals cloaked ships.
    for (const u of acting) {
      if (u.cloak && shots.some((s) => s.s === u)) {
        u.cloak = false;
        events.push({ t, k: 'cloak', u: u.uid, on: false });
      }
    }

    for (const h of heals) {
      if (h.d.curse) continue;
      h.d.hp = Math.min(h.d.maxHp, h.d.hp + h.amt);
      events.push({ t, k: 'heal', s: h.s.uid, d: h.d.uid, amt: h.amt, hp: h.d.hp });
    }
    const bonus = overloadBonus(t);
    for (const sh of shots) hit(sh, bonus);
    for (const u of acting) {
      if (!u.alive) continue;
      if (u.def === 'raider') buff(u, u.level, 0, `+${u.level} ATK`);
      // Overseer: every attack speeds up the rest of the line.
      if (u.def === 'overseer') {
        for (const x of line(u.side)) if (x.def !== 'overseer') x.timer = Math.max(1, x.timer - (u.level >= 3 ? 2 : 1));
        events.push({ t, k: 'buff', u: u.uid, atk: u.atk, hp: u.hp, label: 'HASTE' });
      }
      // Voidmother spawns Echoes every few attacks.
      if (u.def === 'voidmother' && (u.level >= 3 || u.attacks % 2 === 0)) {
        const n = u.level >= 2 ? 5 : 3;
        spawnEcho(u.side, n, n, u);
      }
      // Architect: builds up the most-hurt allies.
      if (u.def === 'architect') {
        const hurt = ships(line(u.side)).filter((x) => x !== u && x.hp > 0).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
        const gain = u.level >= 3 ? 2 : 1;
        for (const x of hurt.slice(0, u.level >= 2 ? 2 : 1)) {
          x.shield += 1;
          x.atk += gain;
          events.push({ t, k: 'buff', u: x.uid, atk: x.atk, hp: x.hp, label: `+${gain} +SHIELD`, sh: x.shield });
        }
      }
      // Brood Ark launches a fighter every 2nd attack (every attack at LV3).
      if (u.def === 'brood' && (u.level >= 3 || u.attacks % 2 === 0) && line(u.side).length < MAX_LINE) {
        const f = u.level >= 2 ? 3 : 2;
        const fi = fighter(make, u.side, snaps[u.side], u.level, f, f);
        units.push(fi);
        events.push({ t, k: 'spawn', s: u.uid, unit: { ...fi } });
      }
      // Swarm Queen launches fighters mid-battle.
      if (u.def === 'queen' && (u.level >= 2 || u.attacks % 2 === 0) && line(u.side).length < MAX_LINE) {
        const strong = u.level >= 3 ? 2 : 1;
        const f = fighter(make, u.side, snaps[u.side], u.level, strong, 2 * strong);
        units.push(f);
        events.push({ t, k: 'spawn', s: u.uid, unit: { ...f } });
      }
    }

    // Burning ships take damage every tick (it ignores shields and can't miss).
    for (const u of units) {
      if (!u.alive || u.hp <= 0 || u.burnT <= 0) continue;
      u.burnT--;
      u.hp -= u.burn;
      events.push({ t, k: 'shot', s: u.uid, d: u.uid, dmg: u.burn, blocked: false, hp: Math.max(0, u.hp), sh: u.shield, burn: true });
    }

    // Deaths, with on-death triggers that can chain into more deaths.
    let dying = units.filter((u) => u.alive && u.hp <= 0);
    while (dying.length) {
      for (const u of dying) {
        if (u.revives > 0 && !u.curse) {
          u.revives--;
          u.hp = u.level >= 2 ? u.maxHp : Math.ceil(u.maxHp / 2);
          u.burnT = 0;
          events.push({ t, k: 'revive', u: u.uid, hp: u.hp });
        } else {
          u.alive = false;
          events.push({ t, k: 'die', u: u.uid });
        }
      }
      for (const u of dying) onLoss(u, u.alive);
      dying = units.filter((u) => u.alive && u.hp <= 0);
    }
    // Reserve Wing: when a side is down to its last real ship, its first benched ship warps in.
    for (const side of [0, 1] as const) {
      const snap = snaps[side];
      const res = snap.reserve;
      if (reserveIn[side] || !res || !SHIPS[res.def] || !count(snap.relics, 'reserves')) continue;
      const real = line(side).filter((x) => !isSummon(x.def));
      if (real.length > 1 || !line(1 - side).some((x) => x.def !== 'mine') || line(side).length >= MAX_LINE) continue;
      reserveIn[side] = true;
      // Built like a fleet ship (relics, synergies, passives), then it joins at the back.
      const built = buildSide({ ...snap, fleet: [...snap.fleet, res] }, side, make, scale);
      const r = [...built].reverse().find((x) => x.def === res.def && !isSummon(x.def))!;
      r.timer = r.cd;
      units.push(r);
      const src = real[0] ?? units.find((x) => x.side === side)!;
      events.push({ t, k: 'spawn', s: src.uid, unit: { ...r }, reserve: true });
    }
    winner = outcome();
  }

  return { units: initial, events, winner: winner ?? -1, ticks: t };
}

/** Real enemy ships (not fighters, mines or echoes) that `side` destroyed. Used by Bounty Board. */
export function kills(res: BattleResult, side: 0 | 1): number {
  const who = new Map<number, BUnit>(res.units.map((u) => [u.uid, u]));
  for (const e of res.events) if (e.k === 'spawn') who.set(e.unit.uid, e.unit);
  return res.events.filter((e) => e.k === 'die' && who.get(e.u)?.side === 1 - side && !isSummon(who.get(e.u)!.def)).length;
}
