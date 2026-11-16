// Festivals of spring and summer. Each colony names its own, holds contests, and after a few
// years running they become traditions people feel they belong to.

import { hash32, Rand, S } from './rng';
import { bump, log, note } from './events';
import { think } from './mood';
import { RACES } from './data/races';
import { STAGE, has, pawnById, stage, stat } from './pawn';
import type { Colony, Pawn } from './types';

export type Season = 'spring' | 'summer';

/** The day of the year each is held, and the names a colony may give it. */
export const FESTIVALS: Record<Season, { day: number; names: string[] }> = {
  spring: { day: 3, names: ['the Sowing Fair', 'the Green Walk', 'the Burning of the Straw Goat', 'the Blessing of the Ploughs', 'Lambing Day', 'the Lantern Walk'] },
  summer: { day: 22, names: ['the Midsummer Games', 'the Stone Toss', 'the Long Day Games', 'the Bonfire Night', 'the Hill Race', 'the Wrestling Fair'] },
};

interface Contest { k: string; name: string; score: (p: Pawn) => number }

const CONTESTS: Record<Season, Contest[]> = {
  summer: [
    { k: 'wrestling', name: 'wrestling', score: (p) => p.sk[0] + RACES[p.race].size * 5 + stat(p, 'tough') * 3 },
    { k: 'archery', name: 'archery contest', score: (p) => p.sk[1] * 1.3 },
    { k: 'race', name: 'footrace', score: (p) => stat(p, 'move') * 12 - (p.hp < 70 ? 4 : 0) },
    { k: 'stone', name: 'stone toss', score: (p) => RACES[p.race].size * 7 + p.sk[0] * 0.5 + p.sk[3] * 0.4 },
  ],
  spring: [
    { k: 'story', name: 'storytelling', score: (p) => p.sk[10] + p.sk[11] * 0.6 + (has(p, 'storyteller') ? 4 : 0) },
    { k: 'plough', name: 'ploughing match', score: (p) => p.sk[4] * 1.2 + stat(p, 'work') * 3 },
    { k: 'bake', name: 'baking contest', score: (p) => p.sk[5] * 1.3 },
    { k: 'song', name: 'singing', score: (p) => p.sk[10] * 0.8 + (p.prof === 'bard' ? 5 : 0) },
  ],
};

/** This colony's name for a festival (chosen once, from its seed). */
export function festivalName(c: Colony, f: Season): string {
  const t = c.trad?.[f];
  if (t) return t.name;
  const names = FESTIVALS[f].names;
  return names[hash32(c.seed, S.STORY, 515, f === 'spring' ? 1 : 2) % names.length];
}

/** Is today the day? Called by the ruler's calendar when no other gathering is set. */
export function festivalToday(doy: number): Season | null {
  if (doy === FESTIVALS.spring.day) return 'spring';
  if (doy === FESTIVALS.summer.day) return 'summer';
  return null;
}

/** The festival is over: contests, prizes, and the slow making of a tradition. */
export function endFestival(c: Colony, f: Season, there: Pawn[]): void {
  const trad = ((c.trad ??= {})[f] ??= { name: festivalName(c, f), n: 0 });
  trad.n++;
  const old = trad.n >= 3;
  const r = new Rand(c.seed, S.STORY, c.tick, 516);
  for (const p of there) {
    think(c, p, 'festival');
    if (old) think(c, p, 'tradition');
    p.joy = Math.min(100, p.joy + 30);
    p.food = Math.min(100, p.food + 20);
    c.stock.meal = Math.max(0, c.stock.meal - 0.4);
  }
  log(c, 'festival', undefined, undefined, trad.name, trad.n);
  // two contests a year, among those old enough
  const entrants = there.filter((p) => stage(c, p) >= STAGE.TEEN && !p.brk);
  if (entrants.length < 3) return;
  const pool = CONTESTS[f].slice();
  // a festival named for its contest always holds it, and holds it first
  const sign = /Wrestling/.test(trad.name) ? 'wrestling' : /Stone/.test(trad.name) ? 'stone' : /Race/.test(trad.name) ? 'race' : /Plough/.test(trad.name) ? 'plough' : '';
  for (let k = 0; k < 2 && pool.length; k++) {
    const own = k === 0 && sign ? pool.findIndex((x) => x.k === sign) : -1;
    const contest = pool.splice(own >= 0 ? own : r.int(pool.length), 1)[0];
    let best: Pawn | undefined;
    let bs = -1e9;
    for (const p of entrants) {
      const s = contest.score(p) + r.float() * 6;
      if (s > bs) { bs = s; best = p; }
    }
    if (!best) continue;
    best.coin += 5;
    think(c, best, 'woncontest');
    log(c, 'contest', best.id, undefined, `${contest.name}:${trad.name}`);
    note(c, best, 'contest', undefined, contest.name);
    bump(c, 'contests');
    // the first summer contest crowns the champion of the games for a year
    if (f === 'summer' && k === 0) {
      const was = trad.champ ? pawnById(c, trad.champ) : undefined;
      trad.champ = best.id;
      if (was && was !== best) think(c, was, 'losttitle');
    }
  }
}

/** Champion of this year's summer festival, if anyone. */
export function championOf(c: Colony): { id: number; name: string } | null {
  const t = c.trad?.summer;
  return t?.champ ? { id: t.champ, name: t.name } : null;
}
