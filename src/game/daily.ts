// Daily challenge: one shared run a day (UTC). Everyone gets the same commander, the
// same starting shop and the same opponents, and the first finished attempt is ranked.

import { COMMANDERS } from '../sim/commanders';
import { hashStr } from '../sim/rng';
import { dayKey } from '../net/apiRules';
import { newRun, type Run } from './run';
import { peekRun } from './storage';

export { dayKey };

/** The day's commander, any of them (locked ones too, so the daily is a way to try them). */
export const dailyCommander = (day: string) => COMMANDERS[hashStr(`daily-cmd:${day}`) % COMMANDERS.length];

export const newDailyRun = (day: string): Run =>
  newRun({ cmd: dailyCommander(day).id, passive: 'a', starter: true, skin: false, daily: day });

/**
 * Where you stand on the daily: not started, in progress, or done for today. A run
 * started yesterday can still be finished (and scored) today.
 */
export function dailyState(): 'new' | 'playing' | 'done' {
  const run = peekRun('daily');
  if (!run?.daily) return 'new';
  const today = dayKey();
  const yesterday = dayKey(Date.now() - 86_400_000);
  if (run.phase !== 'over' && (run.daily === today || run.daily === yesterday)) return 'playing';
  return run.daily === today ? 'done' : 'new';
}
