// Saved worlds outlive the code that made them. Each entry upgrades a save from version v to
// v + 1; load() runs them in order until the save matches SIM_V. Never edit an old step:
// add a new one and bump SIM_V in types.ts.

import { SIM_V } from './types';

type Raw = Record<string, unknown> & { v: number };

const STEPS: Record<number, (o: Raw) => void> = {
  // v2 -> v3: events can be moved out of the world; logBase is the id of the first one kept.
  2: (o) => {
    o.logBase = 0;
  },
  // v3 -> v4: founding. Civs gain banner/byName/protection; the world keeps frontier reserves.
  3: (o) => {
    for (const c of o.civs as Record<string, unknown>[]) {
      c.byName = '';
      c.banner = null;
      c.protectedUntil = -1;
    }
    o.reserves = [];
  },
  // v4 -> v5: four more Ages (Enlightenment to Modern). New techs only; saves are unchanged.
  4: () => {},
};

export function migrate(o: Raw): Raw {
  if (o.v > SIM_V) throw new Error(`save is from a newer sim (v${o.v}, this code is v${SIM_V})`);
  while (o.v < SIM_V) {
    const fn = STEPS[o.v];
    if (!fn) throw new Error(`no migration from v${o.v}`);
    fn(o);
    o.v++;
  }
  return o;
}
