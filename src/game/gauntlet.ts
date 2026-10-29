// Boss Gauntlet: a run of 3 sectors. Each sector is 4 battles (you pick the route before
// each one) and then a boss. Beat the third boss to win. Losing to a boss costs 2 hull
// and you face it again next round.

import { BOSS_RELICS } from '../sim/relics';
import { rand, type RngState } from '../sim/rng';
import { SHIPS } from '../sim/ships';
import type { FleetShip, Snapshot } from '../sim/types';

export const SECTORS = 3;
export const SECTOR_BATTLES = 4; // regular battles before each boss
export const BOSS_HULL_LOSS = 2;

export type NodeKind = 'raid' | 'elite' | 'salvage' | 'dock';

export interface GauntletState {
  sector: number; // 1..3
  step: number; // battles done this sector; SECTOR_BATTLES = the boss is next
  node: NodeKind; // the route picked for the next regular battle
  choices?: NodeKind[]; // the two routes on offer
  bosses: string[]; // the three bosses of this run, in order
  beaten: number; // bosses beaten
  bossReward?: boolean; // the current reward screen is a boss reward
}

export const NODE_INFO: Record<NodeKind, { name: string; desc: string; color: string }> = {
  raid: { name: 'RAID', desc: 'A normal fight. Win for a reward pick.', color: '#a8c8ff' },
  elite: { name: 'ELITE', desc: 'A much tougher fleet. Win for a reward pick and +5 scrap.', color: '#ff5e7e' },
  salvage: { name: 'SALVAGE', desc: 'An easier fleet. Win for +6 scrap, but no reward pick.', color: '#ffd166' },
  dock: { name: 'REPAIR DOCK', desc: 'An easier fleet. Win to repair 1 hull, but no reward pick.', color: '#7dff8a' },
};

export const BOSS_INFO: Record<string, { title: string; tip: string }> = {
  mothership: { title: 'HIVE MOTHERSHIP', tip: 'Hits 2 ships and launches a fighter every attack. Burst it down fast.' },
  citadel: { title: 'THE CITADEL', tip: 'Takes 1 damage per hit while a Pylon stands. Hits your whole fleet.' },
  warlord: { title: "ADMIRAL'S DREADNOUGHT", tip: 'Broadsides hit 3. At half HP it enrages: twice as fast, hits all.' },
  voidmaw: { title: 'VOID LEVIATHAN', tip: 'Hits 3. Curses your fleet: no healing. Splits into Echoes at half HP.' },
};

export function newGauntlet(s: RngState): GauntletState {
  const pool = ['mothership', 'citadel', 'warlord', 'voidmaw'];
  const bosses: string[] = [];
  while (bosses.length < SECTORS) bosses.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
  return { sector: 1, step: 0, node: 'raid', bosses, beaten: 0 };
}

export const bossNext = (g: GauntletState) => g.step >= SECTOR_BATTLES;
export const currentBoss = (g: GauntletState) => g.bosses[g.sector - 1];
export const gauntletCleared = (g: GauntletState | undefined) => !!g && g.beaten >= SECTORS;

/** Short top-bar label: fight number in the sector, the boss being fight 5. "SEC 2 · 3/5". */
export const gauntletLabel = (g: GauntletState) => `SEC ${g.sector} · ${Math.min(g.step, SECTOR_BATTLES) + 1}/${SECTOR_BATTLES + 1}`;

/** Two different routes for the next battle. The Dock only shows up when you're hurt. */
export function rollRoute(s: RngState, hurt: boolean): NodeKind[] {
  const pool: NodeKind[] = ['raid', 'elite', 'salvage', ...(hurt ? (['dock'] as NodeKind[]) : [])];
  const a = pool.splice(Math.floor(rand(s) * pool.length), 1)[0];
  const b = pool[Math.floor(rand(s) * pool.length)];
  return [a, b];
}

/** Three boss relics you don't have yet (any three if you somehow have them all). */
export function bossRelicOffer(s: RngState, owned: string[]): string[] {
  const fresh = BOSS_RELICS.map((r) => r.id).filter((id) => !owned.includes(id));
  const pool = fresh.length >= 3 ? fresh : BOSS_RELICS.map((r) => r.id);
  const out: string[] = [];
  while (out.length < 3) {
    const id = pool[Math.floor(rand(s) * pool.length)];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ---------- opponents ----------

/**
 * Boss strength by sector (index 0-2): boss ATK/HP, and for the Citadel its Pylons.
 * HP is before hull scaling (x1.2 / x2.2 / x3.2 at rounds 5 / 10 / 15). Stats grow a little
 * for each extra round a boss is retried. Found with src/dev/tuneBosses.ts: a bot-skill
 * player wins about 60% / 52% / 45% of the time, in fights of about 30 ticks.
 */
export const BOSS_TUNING: Record<string, { atk: number[]; hp: number[]; escorts: number; pAtk?: number[]; pHp?: number[] }> = {
  mothership: { atk: [7, 27, 67], hp: [133, 153, 176], escorts: 0 },
  citadel: { atk: [4, 12, 25], hp: [59, 62, 83], escorts: 0, pAtk: [2, 10, 19], pHp: [18, 19, 27] },
  warlord: { atk: [7, 13, 18], hp: [49, 95, 148], escorts: 2 },
  voidmaw: { atk: [6, 27, 47], hp: [104, 86, 112], escorts: 1 },
};
export const BOSS_ROUND = (sector: number) => sector * (SECTOR_BATTLES + 1);

const xpFor = (level: number) => (level >= 3 ? 5 : level >= 2 ? 2 : 0);

/** A boss fleet. `escorts` are ordinary ships to fly with it (the tuning says how many). */
export function bossSnapshot(id: string, sector: number, round: number, escortPool: FleetShip[]): Snapshot {
  const tune = BOSS_TUNING[id];
  const k = sector - 1;
  const grow = 1 + 0.08 * Math.max(0, round - BOSS_ROUND(sector)); // retries get a bit tougher
  const boss: FleetShip = { def: id, atk: Math.round(tune.atk[k] * grow), hp: Math.round(tune.hp[k] * grow), xp: xpFor(sector) };
  const escorts = escortPool.slice(0, tune.escorts);
  let fleet: (FleetShip | null)[];
  if (id === 'citadel') {
    const pylon = (): FleetShip => ({ def: 'pylon', atk: Math.round(tune.pAtk![k] * grow), hp: Math.round(tune.pHp![k] * grow), xp: xpFor(sector) });
    fleet = [pylon(), boss, pylon()];
  } else if (id === 'warlord') {
    fleet = [...escorts, boss]; // escorts screen the Dreadnought
  } else {
    fleet = [boss, ...escorts];
  }
  return {
    v: 1, id: `boss-${id}-${sector}-${round}`, runId: 'bot', name: SHIPS[id].name, round, wins: 0, lives: 5,
    fleet, relics: [], createdAt: 0, style: 'BOSS',
  };
}

