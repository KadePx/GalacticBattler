// Picks who you fight this round: an online player's fleet if one was fetched,
// else a local ghost (a fleet from another of your runs at the same round) or a bot.

import { hashStr, rand } from '../sim/rng';
import type { Snapshot } from '../sim/types';
import { botFor } from './bot';
import type { Run } from './run';
import { loadGhosts } from './storage';

const GHOST_CHANCE = 0.6;

export function getOpponent(run: Run): Snapshot {
  // An online player's fleet, fetched while you shopped (see net.ts).
  if (run.nextOpp && run.nextOpp.round === run.round) return run.nextOpp;
  const s = { rng: hashStr(`${run.runId}:${run.round}`) };
  const ghosts = loadGhosts().filter((g) => g.round === run.round && g.runId !== run.runId);
  if (ghosts.length && rand(s) < GHOST_CHANCE) {
    const g = ghosts[Math.floor(rand(s) * ghosts.length)];
    return { ...g, name: `Ghost of ${g.name === 'You' ? 'a past you' : g.name}` };
  }
  return botFor(run.runId, run.round);
}
