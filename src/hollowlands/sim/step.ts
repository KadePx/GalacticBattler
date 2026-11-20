// One tick of a colony.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { decide, finish } from './ai';
import { dailyLand } from './econ';
import { dailyLife, endGathering } from './life';
import { hourly } from './mood';
import { plan } from './planner';
import { dailyCastle } from './castle';
import { dailySiege } from './siege';
import { dailyWalls, tickGates, unstick } from './walls';
import { aftermath, combatTick } from './combat';
import { applyInputs, dailyStory } from './story';
import { dailyGov } from './gov';
import { dailyCrime } from './crime';
import { dailyFaith } from './faith';
import { dailySettle } from './settle';
import { dailyAbroad, dailyMatch } from './abroad';
import { dailyIntrigue } from './intrigue';
import { dailyWild, stepWild } from './wild';
import { dailyHerd, stepHerd } from './herd';
import { dailyGuild } from './guild';
import { dailyDreams } from './dreams';
import type { Colony } from './types';

function daily(c: Colony): void {
  dailyLand(c);
  dailyWild(c);
  dailyHerd(c);
  dailyGuild(c);
  dailyDreams(c);
  dailyLife(c);
  plan(c);
  dailyCastle(c);
  dailyWalls(c);
  dailyStory(c);
  dailyGov(c);
  dailyCrime(c);
  dailyFaith(c);
  dailySettle(c);
  dailyAbroad(c);
  dailyMatch(c);
  dailyIntrigue(c);
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
  if (c.inq.length) applyInputs(c);
  if (c.walls) tickGates(c);
  if (c.siege) dailySiege(c);
  if (c.gath && t >= c.gath.t1) endGathering(c);
  if (c.beasts?.length) stepWild(c);
  if (c.herd?.length) stepHerd(c);
  if (c.foes.length) combatTick(c);
  else if (c.alarm) aftermath(c);
  const list = c.pawns;
  let gone = false;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.gone) { gone = true; continue; }
    if ((t + p.id) % TICKS_PER_HOUR === 0) { hourly(c, p); unstick(c, p); }
    if (!p.gone && t >= p.act.t1) {
      finish(c, p);
      if (!p.gone) decide(c, p);
    }
    if (p.gone) gone = true;
  }
  if (gone) {
    // a plot dies with the one who led it
    if (c.plot && c.pawns.some((p) => p.gone && p.id === c.plot!.lead)) c.plot = undefined;
    c.pawns = c.pawns.filter((p) => !p.gone);
  }
  c.tick = t + 1;
}
