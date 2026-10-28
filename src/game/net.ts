// Online ghosts: upload your fleet after each battle, and fetch another player's fleet
// (same battle-code version, same round) to fight next. Everything here fails quietly:
// offline or on a slow connection the game falls back to local ghosts and bots.

import type { Snapshot } from '../sim/types';
import { getRun, read, saveRun, write } from './storage';
import type { Run } from './run';

// A short hash of the battle code (src/sim), set at build time in vite.config.ts.
declare const __SIM_VERSION__: string;
export const SIM_VERSION = typeof __SIM_VERSION__ !== 'undefined' ? __SIM_VERSION__ : 'dev';

const API = '/api/ghosts';
const PILOT_KEY = 'starbrawl.pilot';
const FETCH_TIMEOUT_MS = 4000;

export interface Pilot { id: string; name: string }

const ADJ = ['RED', 'IRON', 'SWIFT', 'VOID', 'NOVA', 'SOLAR', 'GHOST', 'STORM', 'ROGUE', 'STEEL', 'NEON', 'LUNAR'];
const NOUN = ['FALCON', 'VIPER', 'COMET', 'RAVEN', 'LANCE', 'WARDEN', 'KESTREL', 'SPECTRE', 'NOMAD', 'TALON', 'HORNET', 'PULSAR'];

const randomId = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** This browser's pilot: a random id plus a callsign other players see. */
export function getPilot(): Pilot {
  const saved = read<Pilot>(PILOT_KEY);
  if (saved?.id && saved.name) return saved;
  const pilot = { id: randomId(), name: `${pickOne(ADJ)} ${pickOne(NOUN)} ${10 + Math.floor(Math.random() * 90)}` };
  write(PILOT_KEY, pilot);
  return pilot;
}

export function setCallsign(name: string) {
  write(PILOT_KEY, { ...getPilot(), name });
}

/** Send your fleet to the shared pool. Fire and forget. */
export function uploadGhost(snap: Snapshot) {
  const pilot = getPilot();
  try {
    void fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ver: SIM_VERSION, player: pilot.id, name: pilot.name, snapshot: snap }),
      keepalive: true,
    }).catch(() => { /* offline: the local ghost pool still has it */ });
  } catch { /* fetch unavailable */ }
}

async function fetchGhost(round: number): Promise<Snapshot | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const q = new URLSearchParams({ ver: SIM_VERSION, round: String(round), player: getPilot().id });
    const res = await fetch(`${API}?${q}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { ghost?: Snapshot | null };
    return body.ghost ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * While you shop, look for a real player's fleet to fight this round. It's saved on the
 * run, so reloading the page can't swap in a different opponent.
 */
export async function prefetchOpponent(run: Run) {
  if (run.nextOpp?.round === run.round) return;
  const round = run.round;
  const ghost = await fetchGhost(round);
  const live = getRun();
  if (!ghost || !live || live.runId !== run.runId || live.round !== round || live.phase !== 'shop') return;
  live.nextOpp = { ...ghost, name: `Ghost of ${ghost.name}` };
  saveRun(live);
}
