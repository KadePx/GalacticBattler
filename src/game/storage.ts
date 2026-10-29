// Local persistence: the current run, and a pool of ghost snapshots.
// The ghost pool is where a server would plug in for real snapshot PvP:
// swap saveGhost/findGhost for API calls and nothing else needs to change.

import type { Run } from './run';
import type { Snapshot } from '../sim/types';

// Keys keep the game's original working name so existing saves survive renames.
// Two run slots: your normal run, and today's daily challenge, so one never overwrites the other.
export type Slot = 'main' | 'daily';
const RUN_KEYS: Record<Slot, string> = { main: 'starbrawl.run', daily: 'starbrawl.dailyrun' };
const GHOST_KEY = 'starbrawl.ghosts';
const MAX_GHOSTS = 300;

export function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; the game still works for this session */
  }
}

let slot: Slot = 'main';
let current: Run | null = null;

/** Pick which run the shop, battle and result screens work on. */
export function useSlot(s: Slot) {
  if (s === slot) return;
  slot = s;
  current = null;
}
export const activeSlot = () => slot;

/** Look at a slot's saved run without switching to it. */
export const peekRun = (s: Slot): Run | null => (s === slot && current ? current : read<Run>(RUN_KEYS[s]));

/** Save a run into a slot without switching to it. */
export function saveRunTo(s: Slot, run: Run) {
  if (s === slot) current = run;
  write(RUN_KEYS[s], run);
}

export function getRun(): Run | null {
  if (!current) current = read<Run>(RUN_KEYS[slot]);
  return current;
}

export function saveRun(run: Run) {
  current = run;
  write(RUN_KEYS[slot], run);
}

export function clearRun() {
  current = null;
  try { localStorage.removeItem(RUN_KEYS[slot]); } catch { /* ignore */ }
}

export function loadGhosts(): Snapshot[] {
  return read<Snapshot[]>(GHOST_KEY) ?? [];
}

export function saveGhost(snap: Snapshot) {
  const all = loadGhosts().filter((g) => g.id !== snap.id);
  all.push(snap);
  write(GHOST_KEY, all.slice(-MAX_GHOSTS));
}
