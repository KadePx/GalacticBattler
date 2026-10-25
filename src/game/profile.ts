// Progression that lasts between runs: pilot XP (unlocks commanders) and
// per-commander XP (unlocks options for that commander). Stored locally.

import { COMMANDERS, CMD_MAP, type PassiveSlot } from '../sim/commanders';
import { WIN_TARGET, type Run } from './run';
import { read, write } from './storage';

const KEY = 'starbrawl.profile';

export interface CmdProgress {
  xp: number;
  p: PassiveSlot; // passive picked last time
  starter: boolean; // start runs with the commander's ship (level 4)
  skin: boolean; // use the commander's hull colours (level 2)
}

export interface Profile {
  v: 1;
  xp: number; // pilot XP, the sum of everything earned
  runs: number;
  last: string; // last commander used
  cmd: Record<string, CmdProgress>;
}

// ---------- levels ----------

/** Total commander XP needed to reach level 1..5. */
export const CMD_LEVEL_XP = [0, 100, 250, 450, 700];
export const CMD_MAX_LEVEL = CMD_LEVEL_XP.length;

export const UNLOCKS: { level: number; text: string }[] = [
  { level: 2, text: 'Hull colours' },
  { level: 3, text: 'Second passive' },
  { level: 4, text: 'Starting ship' },
  { level: 5, text: 'Gold title and frame' },
];

export function cmdLevel(xp: number) {
  let lvl = 1;
  CMD_LEVEL_XP.forEach((need, i) => { if (xp >= need) lvl = i + 1; });
  return lvl;
}

/** Total pilot XP needed to reach rank r (rank 1 = 0). Keeps going past the last unlock. */
export function rankXp(r: number) {
  const table = [0, 0, 150, 400, 750, 1200];
  return r < table.length ? table[r] : 1200 + (r - 5) * 500;
}

export function pilotRank(xp: number) {
  let r = 1;
  while (xp >= rankXp(r + 1)) r++;
  return r;
}

/** Progress toward the next level/rank as [have, need] within the current step. */
export function stepProgress(xp: number, start: number, end: number | null): [number, number] {
  if (end === null) return [1, 1];
  return [xp - start, end - start];
}

// ---------- profile storage ----------

function blank(): Profile {
  return { v: 1, xp: 0, runs: 0, last: 'vance', cmd: {} };
}

let cached: Profile | null = null;

export function getProfile(): Profile {
  if (!cached) cached = read<Profile>(KEY) ?? blank();
  return cached;
}

export function saveProfile(p: Profile) {
  cached = p;
  write(KEY, p);
}

export function progress(p: Profile, id: string): CmdProgress {
  if (!p.cmd[id]) p.cmd[id] = { xp: 0, p: 'a', starter: false, skin: false };
  return p.cmd[id];
}

export const isUnlocked = (p: Profile, id: string) => pilotRank(p.xp) >= (CMD_MAP[id]?.rank ?? 99);

// ---------- rewards ----------

export interface RunXp {
  battles: number;
  wins: number;
  clear: number;
  total: number;
}

export const XP_PER_BATTLE = 10;
export const XP_PER_WIN = 15;
export const XP_CLEAR = 50;

export function runXp(run: Run): RunXp {
  const battles = run.history.length * XP_PER_BATTLE;
  const wins = run.wins * XP_PER_WIN;
  const clear = run.wins >= WIN_TARGET ? XP_CLEAR : 0;
  return { battles, wins, clear, total: battles + wins + clear };
}

export interface Award {
  xp: RunXp;
  cmd: string | null;
  cmdBefore: number; // commander XP before
  cmdAfter: number;
  pilotBefore: number;
  pilotAfter: number;
  newCommanders: string[];
}

/** Grant XP for a finished run, once. Safe to call again on refresh. */
export function awardRun(run: Run): Award | null {
  const p = getProfile();
  const xp = runXp(run);
  const cmd = run.cmd && CMD_MAP[run.cmd] ? run.cmd : null;
  const cp = cmd ? progress(p, cmd) : null;
  const before = { pilot: p.xp, cmd: cp?.xp ?? 0 };
  if (run.xpAwarded) {
    // Already paid out: report the same numbers again.
    const pilotBefore = run.xpAwarded.pilotBefore;
    return {
      xp, cmd, cmdBefore: run.xpAwarded.cmdBefore, cmdAfter: run.xpAwarded.cmdBefore + xp.total,
      pilotBefore, pilotAfter: pilotBefore + xp.total, newCommanders: unlockedBetween(pilotBefore, pilotBefore + xp.total),
    };
  }
  p.xp += xp.total;
  p.runs++;
  if (cp) cp.xp += xp.total;
  saveProfile(p);
  run.xpAwarded = { pilotBefore: before.pilot, cmdBefore: before.cmd };
  return {
    xp, cmd, cmdBefore: before.cmd, cmdAfter: before.cmd + xp.total,
    pilotBefore: before.pilot, pilotAfter: p.xp, newCommanders: unlockedBetween(before.pilot, p.xp),
  };
}

function unlockedBetween(a: number, b: number) {
  const ra = pilotRank(a);
  const rb = pilotRank(b);
  return COMMANDERS.filter((c) => c.rank > ra && c.rank <= rb).map((c) => c.id);
}
