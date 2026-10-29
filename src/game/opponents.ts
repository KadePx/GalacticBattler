// Picks who you fight this round: an online player's fleet if one was fetched,
// else a local ghost (a fleet from another of your runs at the same round) or a bot.

import { hashStr, rand } from '../sim/rng';
import type { Snapshot } from '../sim/types';
import { botFor, botSnapshot } from './bot';
import { NODE_INFO, bossNext, bossSnapshot, currentBoss, type GauntletState } from './gauntlet';
import type { Run } from './run';
import { loadGhosts } from './storage';

const GHOST_CHANCE = 0.6;

/** Who you fight next in a Gauntlet run: the sector boss, or a fleet for the route you picked. */
export function gauntletOpponent(runId: string, round: number, g: GauntletState): Snapshot {
  const seed = hashStr(`${runId}:${round}:g`);
  if (bossNext(g)) {
    const escorts = botSnapshot(seed, round).fleet.filter((s): s is NonNullable<typeof s> => !!s);
    return bossSnapshot(currentBoss(g), g.sector, round, escorts);
  }
  const r = g.node === 'elite' ? round + 2 : g.node === 'salvage' || g.node === 'dock' ? Math.max(1, round - 2) : round;
  const foe = botSnapshot(seed, r);
  return { ...foe, round, name: g.node === 'elite' ? `Elite ${foe.name}` : foe.name, style: `${NODE_INFO[g.node].name} FLEET` };
}

export function getOpponent(run: Run): Snapshot {
  if (run.gauntlet) return gauntletOpponent(run.runId, run.round, run.gauntlet);
  // An online player's fleet, fetched while you shopped (see net.ts).
  // Daily challenge: everyone meets the same fleets that day.
  if (run.daily) return botFor(`daily:${run.daily}`, run.round);
  if (run.nextOpp && run.nextOpp.round === run.round) return run.nextOpp;
  const s = { rng: hashStr(`${run.runId}:${run.round}`) };
  const ghosts = loadGhosts().filter((g) => g.round === run.round && g.runId !== run.runId);
  if (ghosts.length && rand(s) < GHOST_CHANCE) {
    const g = ghosts[Math.floor(rand(s) * ghosts.length)];
    return { ...g, name: `Ghost of ${g.name === 'You' ? 'a past you' : g.name}` };
  }
  return botFor(run.runId, run.round);
}
