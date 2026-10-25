// Picks who you fight this round: a ghost (a real fleet snapshot from another
// run at the same round) or a bot. Later: ask a server for a ghost instead.

import { hashStr, rand } from '../sim/rng';
import type { Snapshot } from '../sim/types';
import { botFor } from './bot';
import type { Run } from './run';
import { loadGhosts } from './storage';

const GHOST_CHANCE = 0.6;

export function getOpponent(run: Run): Snapshot {
  const s = { rng: hashStr(`${run.runId}:${run.round}`) };
  const ghosts = loadGhosts().filter((g) => g.round === run.round && g.runId !== run.runId);
  if (ghosts.length && rand(s) < GHOST_CHANCE) {
    const g = ghosts[Math.floor(rand(s) * ghosts.length)];
    return { ...g, name: `Ghost of ${g.name === 'You' ? 'a past you' : g.name}` };
  }
  return botFor(run.runId, run.round);
}
