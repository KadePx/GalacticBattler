// Deterministic battle simulator. Same two snapshots in -> same result out,
// on any machine. No randomness, no rendering. The game plays back the event log.

import { SHIPS, levelOf } from './ships';
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
}

export type BEvent =
  | { t: number; k: 'shot'; s: number; d: number; dmg: number; blocked: boolean; hp: number; sh: number; ram?: boolean; zap?: boolean }
  | { t: number; k: 'heal'; s: number; d: number; amt: number; hp: number }
  | { t: number; k: 'jam'; s: number; d: number }
  | { t: number; k: 'buff'; u: number; atk: number; hp: number; label: string }
  | { t: number; k: 'cloak'; u: number; on: boolean }
  | { t: number; k: 'revive'; u: number; hp: number }
  | { t: number; k: 'spawn'; s: number; unit: BUnit }
  | { t: number; k: 'die'; u: number };

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
      timer: Math.max(1, Math.min(cd, timer)), shield: 0, cloak: false, alive: true, revives: 0, attacks: 0,
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

function buildSide(snap: Snapshot, side: 0 | 1, make: UnitFactory): BUnit[] {
  const r = (id: string) => count(snap.relics, id);
  const counts = traitCounts(snap.fleet);
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
    if (has('strike')) atk += [0, 1, 3][tl('strike')];
    if (has('artillery') && tl('artillery') >= 1) atk += 2;
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
    if (cp === 'vance.a' && L >= 2) hp += 1;
    if (cp === 'kael.b' && has('guard')) hp += 4;
    if (cp === 'juno.b' && has('tech')) hp += 2;

    // Overclock can't push a ship below 3 ticks; on the fastest ships a tick is too big a share.
    let cd = r('overclock') ? Math.max(Math.min(d.cd, 3), d.cd - r('overclock')) : d.cd;
    if (has('tech') && tl('tech') >= 1) cd -= 1;
    if (has('strike') && tl('strike') >= 2) cd -= 1;
    if (s.def === 'scout') cd -= L - 1;
    if (s.def === 'siege' && L >= 2) cd -= 2;

    let timer = Math.max(2, cd) - 2 * r('alpha');
    if (has('artillery') && tl('artillery') >= 2) timer -= 3;
    if (cp === 'nyx.b' && has('strike')) timer -= 3;
    if (cp === 'orin.a' && has('artillery')) timer -= 2;
    if ((s.def === 'torpedo' && L >= 2) || (s.def === 'siege' && L >= 3)) timer = 1;

    const u = make(side, s.def, L, atk, hp, cd, timer);
    if (s.def === 'bulwark') u.shield += L >= 2 ? 2 : 1;
    if (s.def === 'reflector' && L >= 3) u.shield += 1;
    if (has('guard') && tl('guard') >= 2) u.shield += 1;
    if (s.def === 'phantom') u.cloak = true;
    if (s.def === 'revenant') u.revives = L >= 3 ? 2 : 1;
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
}

export function simulate(a: Snapshot, b: Snapshot): BattleResult {
  const next = { uid: 1 };
  const make = factory(next, hullScale(Math.max(a.round, b.round)));
  const snaps = [a, b];
  const units = [...buildSide(a, 0, make), ...buildSide(b, 1, make)];
  // Juno's Jamming Field delays the whole enemy line.
  snaps.forEach((snap, side) => {
    if (passiveId(snap.cmd) !== 'juno.a') return;
    for (const u of units) if (u.side !== side) u.timer += 1;
  });
  const initial = units.map((u) => ({ ...u }));
  const events: BEvent[] = [];
  const line = (side: number) => units.filter((u) => u.alive && u.side === side);
  // Cloaked ships can't be picked unless nothing else is left.
  const targets = (side: number) => {
    const l = line(side);
    const visible = l.filter((u) => !u.cloak);
    return visible.length ? visible : l;
  };
  const lowest = (l: BUnit[]) => l.reduce((m, x) => (x.hp < m.hp ? x : m), l[0]);
  /** Real ships only (no fighters), unless fighters are all that's left. */
  const ships = (l: BUnit[]) => {
    const real = l.filter((x) => x.def !== 'fighter');
    return real.length ? real : l;
  };

  const outcome = (): 0 | 1 | -1 | null => {
    const p = line(0).length;
    const e = line(1).length;
    if (p && e) return null;
    return !p && !e ? -1 : e === 0 ? 0 : 1;
  };

  let t = 0;

  const hit = (sh: Shot, bonus: number) => {
    const { s, d } = sh;
    const before = d.hp;
    const dmg = sh.dmg + bonus;
    let blocked = false;
    if (d.shield > 0 && !sh.pierce) {
      d.shield--;
      blocked = true;
    } else {
      d.hp -= dmg;
    }
    events.push({ t, k: 'shot', s: s.uid, d: d.uid, dmg, blocked, hp: Math.max(0, d.hp), sh: d.shield, ram: sh.ram, zap: sh.zap });
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
    // Reflectors punish hits that bounce off their side's shields. Zaps pierce, so they never chain.
    if (blocked && s.alive && !sh.zap) {
      for (const ref of line(d.side)) {
        if (ref.def !== 'reflector') continue;
        hit({ s: ref, d: s, dmg: [0, 3, 5, 8][ref.level], pierce: true, zap: true }, 0);
      }
    }
    if (before > 0 && d.hp <= 0 && s.alive) {
      if (sh.onKill === 'reload') s.timer = 1;
      if (sh.onKill === 'recloak' && !s.cloak) {
        s.cloak = true;
        events.push({ t, k: 'cloak', u: s.uid, on: true });
      }
    }
  };

  const buff = (u: BUnit, atk: number, heal: number, label: string) => {
    u.atk += atk;
    if (heal) u.hp = Math.min(u.maxHp, u.hp + heal);
    events.push({ t, k: 'buff', u: u.uid, atk: u.atk, hp: u.hp, label });
  };

  /** Everything that reacts to a ship going down (also fires when a Revenant rebuilds). */
  const onLoss = (u: BUnit) => {
    if (u.def === 'interceptor') {
      const foes = targets(1 - u.side);
      const dmg = u.atk * (u.level >= 2 ? 2 : 1);
      for (const f of u.level >= 3 ? foes : foes.slice(0, 1)) hit({ s: u, d: f, dmg, ram: true }, 0);
    }
    // Fighters are disposable: losing one doesn't feed Salvagers or Vengeance
    // (otherwise swarms of 1-HP fighters snowball those effects).
    if (u.def === 'fighter') return;
    const vengeance = count(snaps[u.side].relics, 'vengeance');
    for (const x of line(u.side)) {
      if (x === u) continue;
      if (x.def === 'salvager') {
        const gain = (x.level >= 2 ? 3 : 2) + vengeance;
        buff(x, gain, x.level >= 3 ? 3 : 0, `+${gain} ATK`);
      } else if (vengeance) {
        buff(x, vengeance, 0, `+${vengeance}`);
      }
    }
  };

  let winner = outcome();
  while (winner === null && t < MAX_TICKS) {
    t++;
    const acting: BUnit[] = [];
    for (const u of units) {
      if (!u.alive) continue;
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
          const hurt = line(u.side).filter((x) => x.hp < x.maxHp).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
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
          for (const f of foes.slice(0, L + 1)) shots.push({ s: u, d: f, dmg: u.atk });
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
        case 'phantom':
          // Ambush: striking from cloak deals double damage.
          shots.push({ s: u, d: L >= 2 ? lowest(foes) : foes[0], dmg: u.cloak ? 2 * u.atk : u.atk, onKill: L >= 3 ? 'recloak' : undefined });
          break;
        default:
          shots.push({ s: u, d: foes[0], dmg: u.atk });
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
      h.d.hp = Math.min(h.d.maxHp, h.d.hp + h.amt);
      events.push({ t, k: 'heal', s: h.s.uid, d: h.d.uid, amt: h.amt, hp: h.d.hp });
    }
    const bonus = overloadBonus(t);
    for (const sh of shots) hit(sh, bonus);
    for (const u of acting) {
      if (!u.alive) continue;
      if (u.def === 'raider') buff(u, u.level, 0, `+${u.level} ATK`);
      // Swarm Queen launches fighters mid-battle.
      if (u.def === 'queen' && (u.level >= 2 || u.attacks % 2 === 0) && line(u.side).length < MAX_LINE) {
        const strong = u.level >= 3 ? 2 : 1;
        const f = fighter(make, u.side, snaps[u.side], u.level, strong, 2 * strong);
        units.push(f);
        events.push({ t, k: 'spawn', s: u.uid, unit: { ...f } });
      }
    }

    // Deaths, with on-death triggers that can chain into more deaths.
    let dying = units.filter((u) => u.alive && u.hp <= 0);
    while (dying.length) {
      for (const u of dying) {
        if (u.revives > 0) {
          u.revives--;
          u.hp = u.level >= 2 ? u.maxHp : Math.ceil(u.maxHp / 2);
          events.push({ t, k: 'revive', u: u.uid, hp: u.hp });
        } else {
          u.alive = false;
          events.push({ t, k: 'die', u: u.uid });
        }
      }
      for (const u of dying) onLoss(u);
      dying = units.filter((u) => u.alive && u.hp <= 0);
    }
    winner = outcome();
  }

  return { units: initial, events, winner: winner ?? -1, ticks: t };
}
