// Online features: the ghost pool (upload your fleet after each battle, fetch another
// player's fleet to fight next), ghost fight results, the daily challenge board and run
// logs. Everything here fails quietly: offline, the game falls back to local ghosts and bots.

import type { FleetShip, Snapshot } from '../sim/types';
import { levelOf } from '../sim/ships';
import type { RunLog, ShortFleet } from '../net/apiRules';
import { cleanCallsign } from '../net/ghostRules';
import { getRun, read, saveRun, write } from './storage';
import type { Run } from './run';

// A short hash of the battle code (src/sim), set at build time in vite.config.ts.
declare const __SIM_VERSION__: string;
export const SIM_VERSION = typeof __SIM_VERSION__ !== 'undefined' ? __SIM_VERSION__ : 'dev';

const API = '/api/ghosts';
const PILOT_KEY = 'starbrawl.pilot';
const NEWS_KEY = 'starbrawl.newsSeen';
const FETCH_TIMEOUT_MS = 4000;

export interface Pilot { id: string; name: string }

const ADJ = ['RED', 'IRON', 'SWIFT', 'VOID', 'NOVA', 'SOLAR', 'GHOST', 'STORM', 'ROGUE', 'STEEL', 'NEON', 'LUNAR'];
const NOUN = ['FALCON', 'VIPER', 'COMET', 'RAVEN', 'LANCE', 'WARDEN', 'KESTREL', 'SPECTRE', 'NOMAD', 'TALON', 'HORNET', 'PULSAR'];

const randomId = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** This browser's pilot: a random id plus a callsign other players see. */
/** A random callsign the server accepts (3-14 characters). */
function randomCallsign(): string {
  for (;;) {
    const name = `${pickOne(ADJ)} ${pickOne(NOUN)} ${10 + Math.floor(Math.random() * 90)}`;
    if (cleanCallsign(name) === name) return name;
  }
}

export function getPilot(): Pilot {
  const saved = read<Pilot>(PILOT_KEY);
  if (saved?.id && saved.name) {
    // Older builds could generate names over 14 characters, which the server rejects.
    // Those were never accepted online, so swap in a valid one.
    if (cleanCallsign(saved.name)) return saved;
    const fixed = { ...saved, name: randomCallsign() };
    write(PILOT_KEY, fixed);
    return fixed;
  }
  const pilot = { id: randomId(), name: randomCallsign() };
  write(PILOT_KEY, pilot);
  return pilot;
}

export function setCallsign(name: string) {
  const pilot = { ...getPilot(), name };
  write(PILOT_KEY, pilot);
  // Daily scores keep their place on the board under the new name.
  void postJson('/api/daily', { player: pilot.id, name, rename: true }, true);
}

/** GET some JSON with a timeout; null on any failure. */
async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST some JSON; the parsed reply, or null when offline or refused. */
async function postJson<T>(url: string, body: unknown, keepalive = false): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS * 2);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
      signal: ctrl.signal,
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- ghost pool ----------

/** Send your fleet to the shared pool. Fire and forget. */
export function uploadGhost(snap: Snapshot) {
  const pilot = getPilot();
  void postJson(API, { ver: SIM_VERSION, player: pilot.id, name: pilot.name, snapshot: snap }, true);
}

async function fetchGhost(round: number): Promise<{ ghost: Snapshot; gid?: number } | null> {
  const q = new URLSearchParams({ ver: SIM_VERSION, round: String(round), player: getPilot().id });
  const body = await getJson<{ ghost?: Snapshot | null; gid?: number }>(`${API}?${q}`);
  return body?.ghost ? { ghost: body.ghost, gid: body.gid } : null;
}

/**
 * While you shop, look for a real player's fleet to fight this round. It's saved on the
 * run, so reloading the page can't swap in a different opponent.
 */
export async function prefetchOpponent(run: Run) {
  if (run.daily || run.nextOpp?.round === run.round) return; // daily runs fight the day's fixed fleets
  const round = run.round;
  const found = await fetchGhost(round);
  const live = getRun();
  if (!found || !live || live.runId !== run.runId || live.round !== round || live.phase !== 'shop') return;
  live.nextOpp = { ...found.ghost, name: `Ghost of ${found.ghost.name}` };
  live.nextOppGid = found.gid;
  saveRun(live);
}

/** Tell the server how a fight against someone's ghost went, so its owner can see it. */
export function reportGhostFight(gid: number, winner: 0 | 1 | -1) {
  const pilot = getPilot();
  const won = winner === 0 ? true : winner === 1 ? false : null;
  void postJson('/api/results', { player: pilot.id, name: pilot.name, gid, won }, true);
}

export interface GhostNews {
  fights: number;
  ghostWins: number;
  recent: { opp: string; round: number; ghostWon: boolean; t: number }[];
}

/** Fights your ghosts had since you last looked (null if none). Marks them as seen. */
export async function fetchGhostNews(): Promise<GhostNews | null> {
  const since = read<number>(NEWS_KEY) ?? Date.now() - 7 * 86_400_000;
  const q = new URLSearchParams({ player: getPilot().id, since: String(since) });
  const news = await getJson<GhostNews>(`/api/results?${q}`);
  if (!news || news.fights <= 0) return null;
  write(NEWS_KEY, Math.max(since, ...news.recent.map((r) => r.t)));
  return news;
}

// ---------- daily challenge ----------

export interface DailyEntry { rank: number; name: string; wins: number; lives: number; battles: number; cmd: string; fleet: ShortFleet; relics?: string[] }
export interface DailyBoard { day: string; total: number; top: DailyEntry[]; me: DailyEntry | null }

export const fetchDaily = (day: string) =>
  getJson<DailyBoard>(`/api/daily?${new URLSearchParams({ day, player: getPilot().id })}`);

export const shortFleet = (run: Run): ShortFleet =>
  run.fleet.filter((s): s is FleetShip => !!s).map((s) => [s.def, levelOf(s.xp)]);

/** Send a finished daily run's score. Returns its rank, or null if it couldn't be sent. */
export async function submitDaily(run: Run): Promise<number | null> {
  if (!run.daily || !run.cmd) return null;
  const pilot = getPilot();
  const res = await postJson<{ ok?: boolean; rank?: number | null }>('/api/daily', {
    player: pilot.id, name: pilot.name, day: run.daily, history: run.history.join(''), lives: run.lives,
    cmd: run.cmd, fleet: shortFleet(run), relics: run.relics,
  });
  return res?.ok ? res.rank ?? 0 : null;
}

// ---------- run logs (balance data from real players) ----------

/** Log a finished run. Fire and forget; endless runs log again when they end. */
export function logRun(run: Run) {
  if (!run.history.length) return;
  const log: RunLog = {
    runId: run.runId,
    mode: run.daily ? 'daily' : run.gauntlet ? 'gauntlet' : 'normal',
    cmd: run.cmd ?? null,
    passive: run.cmd ? run.passive ?? 'a' : null,
    wins: run.wins,
    lives: run.lives,
    history: run.history.join(''),
    endless: !!run.endless,
    fleet: shortFleet(run),
    relics: [...run.relics],
  };
  void postJson('/api/runs', { ver: SIM_VERSION, player: getPilot().id, run: log }, true);
}
