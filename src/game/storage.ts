// Local persistence: the current run, and a pool of ghost snapshots.
// The ghost pool is where a server would plug in for real snapshot PvP:
// swap saveGhost/findGhost for API calls and nothing else needs to change.

import type { Run } from './run';
import type { Snapshot } from '../sim/types';

// Keys keep the game's original working name so existing saves survive renames.
const RUN_KEY = 'starbrawl.run';
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

let current: Run | null = null;

export function getRun(): Run | null {
  if (!current) current = read<Run>(RUN_KEY);
  return current;
}

export function saveRun(run: Run) {
  current = run;
  write(RUN_KEY, run);
}

export function clearRun() {
  current = null;
  try { localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
}

export function loadGhosts(): Snapshot[] {
  return read<Snapshot[]>(GHOST_KEY) ?? [];
}

export function saveGhost(snap: Snapshot) {
  const all = loadGhosts().filter((g) => g.id !== snap.id);
  all.push(snap);
  write(GHOST_KEY, all.slice(-MAX_GHOSTS));
}
