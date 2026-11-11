// One tick of a colony.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { decide, finish } from './ai';
import { dailyLand } from './econ';
import { dailyLife, endGathering } from './life';
import { hourly } from './mood';
import { plan } from './planner';
import type { Colony } from './types';

function daily(c: Colony): void {
  dailyLand(c);
  dailyLife(c);
  plan(c);
  // let go of faded memories and of people long forgotten
  for (const p of c.pawns) {
    for (const key in p.rel) {
      const rel = p.rel[key];
      let stale = false;
      for (const m of rel.m) if (m[1] <= c.tick) { stale = true; break; }
      if (stale) rel.m = rel.m.filter((m) => m[1] > c.tick);
      if (!rel.m.length && !rel.k && !rel.f) delete p.rel[key];
    }
  }
}

export function step(c: Colony): void {
  const t = c.tick;
  if (t % TICKS_PER_DAY === 0) daily(c);
  if (c.gath && t >= c.gath.t1) endGathering(c);
  const list = c.pawns;
  let gone = false;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.gone) { gone = true; continue; }
    if ((t + p.id) % TICKS_PER_HOUR === 0) hourly(c, p);
    if (!p.gone && t >= p.act.t1) {
      finish(c, p);
      if (!p.gone) decide(c, p);
    }
    if (p.gone) gone = true;
  }
  if (gone) c.pawns = c.pawns.filter((p) => !p.gone);
  c.tick = t + 1;
}
