// Shared rules for the online features (daily challenge, run logs), used by both the game
// and the server (functions/api). Pure data checks only: no Phaser, no browser APIs.

import { SHIPS } from '../sim/ships';
import { RELIC_MAP } from '../sim/relics';
import { CMD_MAP } from '../sim/commanders';

export const DAILY_WIN_TARGET = 10;
const MAX_LIVES = 5;
const MAX_BATTLES = 120;

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** The daily challenge's day, in UTC, as YYYY-MM-DD. Everyone shares the same day. */
export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A finished run's fleet in short form: [ship id, level] pairs, front first. */
export type ShortFleet = [string, number][];

function cleanShortFleet(raw: unknown): ShortFleet | null {
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: ShortFleet = [];
  for (const f of raw) {
    if (!Array.isArray(f) || typeof f[0] !== 'string' || !SHIPS[f[0]] || SHIPS[f[0]].tier < 1 || !isInt(f[1], 1, 3)) return null;
    out.push([f[0], f[1]]);
  }
  return out;
}

const cleanHistory = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length >= 1 && raw.length <= MAX_BATTLES && /^[WLD]+$/.test(raw) ? raw : null;

/** One finished run, logged for balance stats. */
export interface RunLog {
  runId: string;
  mode: 'normal' | 'daily';
  cmd: string | null;
  passive: 'a' | 'b' | null;
  wins: number;
  lives: number;
  history: string; // W / L / D per battle
  endless: boolean;
  fleet: ShortFleet;
  relics: string[];
}

export function cleanRunLog(raw: unknown): RunLog | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.runId !== 'string' || !/^[\w-]{1,40}$/.test(r.runId)) return 'bad run id';
  if (r.mode !== 'normal' && r.mode !== 'daily') return 'bad mode';
  const cmd = r.cmd === null ? null : typeof r.cmd === 'string' && CMD_MAP[r.cmd] ? r.cmd : undefined;
  if (cmd === undefined) return 'bad commander';
  const passive = r.passive === null ? null : r.passive === 'a' || r.passive === 'b' ? r.passive : undefined;
  if (passive === undefined) return 'bad passive';
  const history = cleanHistory(r.history);
  if (!history) return 'bad history';
  const wins = [...history].filter((c) => c === 'W').length;
  if (r.wins !== wins) return 'bad wins';
  if (!isInt(r.lives, 0, MAX_LIVES)) return 'bad lives';
  const fleet = cleanShortFleet(r.fleet);
  if (!fleet) return 'bad fleet';
  if (!Array.isArray(r.relics) || r.relics.length > MAX_BATTLES || r.relics.some((x) => typeof x !== 'string' || !RELIC_MAP[x])) return 'bad relics';
  return {
    runId: r.runId, mode: r.mode, cmd, passive, wins, lives: r.lives, history,
    endless: r.endless === true, fleet, relics: r.relics as string[],
  };
}

/** A daily challenge score. Ranked by wins, then hull left, then fewer battles. */
export interface DailyScore {
  day: string;
  wins: number;
  lives: number;
  battles: number;
  cmd: string;
  fleet: ShortFleet;
}

export function cleanDailyScore(raw: unknown): DailyScore | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const r = raw as Record<string, unknown>;
  if (!isDayKey(r.day)) return 'bad day';
  const history = cleanHistory(r.history);
  if (!history) return 'bad history';
  const wins = [...history].filter((c) => c === 'W').length;
  const losses = [...history].filter((c) => c === 'L').length;
  if (wins > DAILY_WIN_TARGET) return 'bad wins';
  if (!isInt(r.lives, 0, MAX_LIVES) || r.lives !== MAX_LIVES - losses) return 'bad lives';
  // The run has to have ended: 10 wins, or out of hull.
  if (wins < DAILY_WIN_TARGET && r.lives > 0) return 'run not over';
  if (typeof r.cmd !== 'string' || !CMD_MAP[r.cmd]) return 'bad commander';
  const fleet = cleanShortFleet(r.fleet);
  if (!fleet) return 'bad fleet';
  return { day: r.day, wins, lives: r.lives, battles: history.length, cmd: r.cmd, fleet };
}
