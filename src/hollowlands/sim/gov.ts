// Who rules, how they came to rule, what they decree, and where everyone else stands.
// Colonies start small and free; crowns and noble houses grow out of what happens.

import { TICKS_PER_DAY, TICKS_PER_YEAR, dayOf } from '../config';
import { RACES } from './data/races';
import { foodDays } from './econ';
import { bump, log, note } from './events';
import { wound } from './health';
import { depart, die } from './life';
import { think } from './mood';
import { STAGE, ageYears, has, pawnById, per, stage, stat } from './pawn';
import { Rand, S } from './rng';
import { opinion } from './social';
import { AX, type Colony, type Pawn, type RaceK } from './types';

export const RANK = { THRALL: 0, OUTCAST: 1, COMMONER: 2, FREEHOLDER: 3, NOTABLE: 4, NOBLE: 5, RULER: 6 } as const;
export const RANK_NAMES = ['Thrall', 'Outcast', 'Commoner', 'Freeholder', 'Notable', 'Noble', 'Ruler'];

export interface GovDef { k: string; name: string; blurb: string }
export const GOVS: Record<string, GovDef> = {
  elder: { k: 'elder', name: 'Elder\'s word', blurb: 'The oldest and most respected decides.' },
  chief: { k: 'chief', name: 'Rule of the strong', blurb: 'Whoever can hold the seat keeps it, until someone takes it.' },
  council: { k: 'council', name: 'Elected speaker', blurb: 'The colony votes for a speaker every two years.' },
  lord: { k: 'lord', name: 'Hereditary rule', blurb: 'The seat passes down one family.' },
  tyrant: { k: 'tyrant', name: 'Tyranny', blurb: 'Taken by force and held by fear.' },
};

/** What the ruler is called, by the kind of rule and their people. */
export function rulerTitle(c: Colony, p: { race: RaceK; sex: 0 | 1 }): string {
  const k = c.gov.k;
  if (k === 'elder') return 'Elder';
  if (k === 'council') return 'Speaker';
  if (k === 'tyrant') return p.race === 'orc' || p.race === 'halforc' ? 'Warlord' : p.race === 'goblin' ? 'Boss' : 'Tyrant';
  if (k === 'chief') return p.race === 'goblin' ? 'Boss' : p.race === 'orc' || p.race === 'halforc' ? 'Warchief' : 'Chief';
  if (p.race === 'dwarf') return 'Thane';
  if (p.race === 'orc' || p.race === 'halforc') return 'Warlord';
  if (p.race === 'halfling') return p.sex ? 'Squire' : 'Dame';
  return p.sex ? 'Lord' : 'Lady';
}

const adultsOf = (c: Colony): Pawn[] => c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT);
const power = (p: Pawn): number => p.sk[0] + RACES[p.race].size * 5 + stat(p, 'tough') * 3 + per(p, AX.BRAVE);

/** How the colony feels about its ruler: average opinion among adults. */
export function approval(c: Colony): number {
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler) return 0;
  let sum = 0;
  let n = 0;
  for (const p of adultsOf(c)) {
    if (p === ruler) continue;
    sum += opinion(c, p, ruler);
    n++;
  }
  return n ? sum / n : 0;
}

function standing(c: Colony, p: Pawn, voters: Pawn[]): number {
  let s = 0;
  for (const v of voters) if (v !== p) s += opinion(c, v, p);
  return s;
}

function crown(c: Colony, p: Pawn, how: string, old?: Pawn): void {
  c.gov.ruler = p.id;
  c.gov.since = c.tick;
  c.gov.regent = 0;
  const cruel = per(p, AX.KIND) < -0.8 || has(p, 'cruel') || c.gov.k === 'tyrant';
  c.gov.laws.harsh = cruel ? 2 : per(p, AX.KIND) > 0.8 ? 0 : 1;
  c.gov.laws.tax = per(p, AX.GREED) > 0.8 ? 1 : 0;
  c.gov.laws.thrall = c.gov.k === 'tyrant' || per(p, AX.KIND) < -0.2 ? 1 : 0;
  p.thrall = undefined;
  p.rank = RANK.RULER;
  think(c, p, 'crowned');
  log(c, 'ruler', p.id, old?.id, how);
  note(c, p, 'ruler', undefined, how);
  bump(c, 'rulers');
}

/** Pick a first ruler and a way of ruling that suits the people who live here. */
export function initGov(c: Colony, r: Rand): void {
  const adults = adultsOf(c);
  if (!adults.length) return;
  const count: Record<string, number> = {};
  let main: RaceK = adults[0].race;
  for (const p of adults) { count[p.race] = (count[p.race] ?? 0) + 1; if (count[p.race] > (count[main] ?? 0)) main = p.race; }
  const k = main === 'orc' || main === 'goblin' ? 'chief' : main === 'dwarf' ? 'lord' : main === 'halfling' ? 'council' : main === 'elf' ? 'elder' : r.pick(['elder', 'council', 'lord', 'chief']);
  c.gov.k = k;
  let best = adults[0];
  let score = -1e9;
  for (const p of adults) {
    const R = RACES[p.race];
    const age = (ageYears(c, p) - R.adult) / (R.old - R.adult);
    const s = k === 'chief' ? power(p) : k === 'elder' ? age * 10 + p.sk[10] * 0.3 : p.sk[10] + stat(p, 'charm') + per(p, AX.AMBITION) * 2 + age * 3 + (p.race === main ? 3 : 0);
    if (s > score) { score = s; best = p; }
  }
  c.gov.ruler = best.id;
  c.gov.since = c.tick - TICKS_PER_YEAR * (1 + r.int(4));
  c.gov.next = c.tick + TICKS_PER_YEAR * 2;
  c.gov.laws.harsh = per(best, AX.KIND) < -0.8 ? 2 : per(best, AX.KIND) > 0.8 ? 0 : 1;
  c.gov.laws.tax = per(best, AX.GREED) > 0.8 ? 1 : 0;
  c.gov.laws.thrall = per(best, AX.KIND) < -0.2 ? 1 : 0;
  best.rank = RANK.RULER;
  updateRanks(c, true);
}

/** Everyone's place, worked out from who they are and what they hold. */
export function updateRanks(c: Colony, quiet: boolean): void {
  const ruler = pawnById(c, c.gov.ruler);
  const house = c.gov.k === 'lord' && ruler ? ruler : undefined;
  for (const p of c.pawns) {
    if (p.gone) continue;
    let rank: number = RANK.COMMONER;
    const st = stage(c, p);
    if (p === ruler) rank = RANK.RULER;
    else if (p.thrall) rank = RANK.THRALL;
    else if (p.perm.includes('brand')) rank = RANK.OUTCAST;
    else if (house && (p.sp === house.id || p.mo === house.id || p.fa === house.id || house.mo === p.id || house.fa === p.id || (!!house.mo && p.mo === house.mo))) rank = RANK.NOBLE;
    else if (st >= STAGE.ADULT) {
      const titled = Object.values(c.gov.titles).includes(p.id);
      let best = 0;
      for (const v of p.sk) if (v > best) best = v;
      let deeds = 0;
      for (const b of p.bio) if (b.k === 'slew') deeds++;
      if (titled || p.prof === 'priest' || best >= 13 || deeds >= 3 || (st === STAGE.ELDER && p.sk[10] >= 6)) rank = RANK.NOTABLE;
      else if (p.coin >= 30 || best >= 9) rank = RANK.FREEHOLDER;
    } else {
      // children take their parents' standing
      const mo = pawnById(c, p.mo);
      const fa = pawnById(c, p.fa);
      rank = Math.min(RANK.NOBLE, Math.max(mo?.rank ?? RANK.COMMONER, fa?.rank ?? RANK.COMMONER, RANK.COMMONER));
      if (rank === RANK.NOTABLE || rank === RANK.FREEHOLDER) rank = RANK.COMMONER;
    }
    if (rank !== p.rank) {
      const up = rank > p.rank;
      p.rank = rank;
      if (!quiet && st >= STAGE.ADULT && rank !== RANK.RULER) {
        if (up && rank >= RANK.NOTABLE) { think(c, p, 'raised'); log(c, 'raised', p.id, undefined, undefined, rank); note(c, p, 'raised', undefined, RANK_NAMES[rank]); }
        else if (!up && rank <= RANK.OUTCAST) think(c, p, 'castout');
      }
    }
  }
}

function election(c: Colony, r: Rand, old?: Pawn): void {
  const voters = adultsOf(c).filter((p) => p.rank >= RANK.COMMONER);
  if (!voters.length) return;
  const sitting = pawnById(c, c.gov.ruler);
  const pool = voters.filter((p) => p !== sitting && per(p, AX.AMBITION) > 0.2).sort((a, b) => per(b, AX.AMBITION) * 3 + b.sk[10] - (per(a, AX.AMBITION) * 3 + a.sk[10]) || a.id - b.id).slice(0, 2);
  const cands = sitting && voters.includes(sitting) ? [sitting, ...pool] : pool;
  if (!cands.length) cands.push(voters.reduce((a, b) => (standing(c, b, voters) > standing(c, a, voters) ? b : a)));
  const votes = cands.map(() => 0);
  for (const v of voters) {
    let pick = 0;
    let best = -1e9;
    cands.forEach((cand, i) => {
      const s = cand === v ? 200 : opinion(c, v, cand) + stat(cand, 'charm') * 2 + r.float() * 12;
      if (s > best) { best = s; pick = i; }
    });
    votes[pick]++;
  }
  let win = 0;
  for (let i = 1; i < cands.length; i++) if (votes[i] > votes[win]) win = i;
  const winner = cands[win];
  c.gov.next = c.tick + TICKS_PER_YEAR * 2;
  log(c, 'election', winner.id, cands.length > 1 ? cands[win === 0 ? 1 : 0].id : undefined, undefined, votes[win]);
  bump(c, 'elections');
  cands.forEach((cand, i) => { if (i !== win) { think(c, cand, 'lostvote'); think(c, cand, 'beatme', winner.id); } });
  if (winner !== sitting) {
    if (sitting) sitting.rank = RANK.COMMONER;
    crown(c, winner, 'elected', old ?? sitting);
  } else think(c, winner, 'crowned');
}

/** The seat is empty. Who takes it depends on how this colony is ruled. */
export function succession(c: Colony, old: Pawn | undefined, r: Rand): void {
  const adults = adultsOf(c);
  if (!adults.length) { c.gov.ruler = 0; return; }
  const k = c.gov.k;
  if (k === 'council') { election(c, r, old); return; }
  if (k === 'lord' && old) {
    // children first, eldest first; then spouse; then brothers and sisters
    const kids = c.pawns.filter((p) => !p.gone && (p.mo === old.id || p.fa === old.id)).sort((a, b) => a.born - b.born);
    const kin = [...kids, ...c.pawns.filter((p) => !p.gone && old.sp === p.id), ...c.pawns.filter((p) => !p.gone && ((!!old.mo && p.mo === old.mo) || (!!old.fa && p.fa === old.fa)))];
    const heir = kin[0];
    if (heir) {
      // a grown, ambitious relative with more friends than the heir may not wait their turn
      const rival = kin.slice(1).find((p) => stage(c, p) >= STAGE.ADULT && per(p, AX.AMBITION) > 0.7 && standing(c, p, adults) > standing(c, heir, adults) * 1.15 + 20);
      if (rival) {
        for (const p of adults) if (p !== rival && opinion(c, p, heir) > opinion(c, p, rival)) think(c, p, 'usurper', rival.id);
        think(c, heir, 'robbed', rival.id);
        crown(c, rival, 'usurped', old);
        log(c, 'usurped', rival.id, heir.id);
        bump(c, 'usurpations');
        if (stage(c, heir) >= STAGE.ADULT && r.chance(0.35)) depart(c, heir, 'exiled');
        return;
      }
      crown(c, heir, 'inherited', old);
      if (stage(c, heir) < STAGE.ADULT) {
        const regent = adults.filter((p) => p !== heir).sort((a, b) => (b.id === old.sp ? 100 : 0) + opinion(c, b, heir) + b.sk[10] - ((a.id === old.sp ? 100 : 0) + opinion(c, a, heir) + a.sk[10]))[0];
        if (regent) { c.gov.regent = regent.id; log(c, 'regent', regent.id, heir.id); note(c, regent, 'regent', heir.id); }
      }
      return;
    }
    log(c, 'house_ends', old.id, undefined, old.fam);
    c.gov.k = 'council';
    election(c, r, old);
    return;
  }
  if (k === 'chief' || k === 'tyrant') {
    const sorted = adults.slice().sort((a, b) => power(b) + per(b, AX.AMBITION) * 2 - (power(a) + per(a, AX.AMBITION) * 2) || a.id - b.id);
    const a = sorted[0];
    const b = sorted[1];
    if (b && per(b, AX.AMBITION) > 0 && !has(b, 'pacifist')) {
      // the two strongest settle it
      const win = power(a) + r.float() * 8 >= power(b) + r.float() * 8 ? a : b;
      const lose = win === a ? b : a;
      wound(c, lose, 'cut', 18 + r.int(20), r);
      wound(c, win, 'cut', 6 + r.int(14), r);
      think(c, lose, 'humbled', win.id);
      if (c.gov.k === 'tyrant') c.gov.k = 'chief';
      crown(c, win, 'fought', old);
      log(c, 'duel', win.id, lose.id);
      if (lose.hp <= 0 && !lose.gone) die(c, lose, 'duel', win.id);
      return;
    }
    if (c.gov.k === 'tyrant') c.gov.k = 'chief';
    crown(c, a, 'fought', old);
    return;
  }
  // elder
  let best = adults[0];
  let score = -1e9;
  for (const p of adults) {
    const R = RACES[p.race];
    const s = ((ageYears(c, p) - R.adult) / (R.old - R.adult)) * 10 + p.sk[10] * 0.3 + standing(c, p, adults) / Math.max(1, adults.length) / 10;
    if (s > score) { score = s; best = p; }
  }
  crown(c, best, 'eldest', old);
}

/** Once a day: wages, standing, the mood of the governed, and anyone who thinks they could do better. */
export function dailyGov(c: Colony): void {
  const t = c.tick;
  const day = dayOf(t);
  const r = new Rand(c.seed, S.GOV, day);
  let ruler = pawnById(c, c.gov.ruler);
  if (!ruler || ruler.gone) {
    const old = c.dead.find((d) => d.id === c.gov.ruler);
    succession(c, old as unknown as Pawn | undefined, r);
    ruler = pawnById(c, c.gov.ruler);
  }
  if (!ruler) return;
  const adults = adultsOf(c);

  // a child ruler comes of age
  if (c.gov.regent && stage(c, ruler) >= STAGE.ADULT) { log(c, 'regency_ends', ruler.id, c.gov.regent); c.gov.regent = 0; }
  if (c.gov.regent && !pawnById(c, c.gov.regent)) c.gov.regent = 0;

  // wages; a greedy ruler takes a cut
  for (const p of adults) {
    if (p.prof) p.coin += c.gov.laws.tax ? 0.35 : 0.5;
    if (p.rank >= RANK.NOBLE) p.coin += p.rank === RANK.RULER ? (c.gov.laws.tax ? 3 : 1.5) : 0.8;
    if (p.coin > 200) p.coin = 200;
  }
  if (c.gov.laws.tax && day % 10 === 0) for (const p of adults) if (p !== ruler && p.prof && per(p, AX.GREED) > -0.5) think(c, p, 'taxed', ruler.id);

  // rationing follows the larder
  const days = foodDays(c);
  if (!c.gov.laws.ration && days < 5) { c.gov.laws.ration = 1; log(c, 'law', ruler.id, undefined, 'ration_on'); }
  else if (c.gov.laws.ration && days > 12) { c.gov.laws.ration = 0; log(c, 'law', ruler.id, undefined, 'ration_off'); }

  // titles: the ruler's right hands
  const give = (title: string, score: (p: Pawn) => number, min: number): void => {
    const cur = pawnById(c, c.gov.titles[title] ?? 0);
    if (cur && !cur.gone && stage(c, cur) >= STAGE.ADULT) return;
    let best: Pawn | undefined;
    let bs = min;
    for (const p of adults) {
      if (p === ruler || Object.values(c.gov.titles).includes(p.id)) continue;
      const s = score(p) + opinion(c, ruler!, p) / 12;
      if (s > bs) { bs = s; best = p; }
    }
    if (best) { c.gov.titles[title] = best.id; think(c, best, 'titled', ruler!.id); log(c, 'title', best.id, ruler!.id, title); note(c, best, 'title', undefined, title); }
    else delete c.gov.titles[title];
  };
  if (adults.length >= 10) {
    give('marshal', (p) => p.sk[0] + p.sk[1] * 0.5 + per(p, AX.BRAVE) * 2, 9);
    give('steward', (p) => p.sk[10] + p.sk[11] * 0.5 + per(p, AX.DILIGENT) * 2, 9);
  }
  updateRanks(c, false);

  // how the ruled feel about the ruler, every few days
  if (day % 5 === 0) {
    let mood = 0;
    for (const p of adults) mood += p.mood;
    mood /= Math.max(1, adults.length);
    let deaths = 0;
    for (const d of c.dead) if (!d.left && t - d.died < TICKS_PER_DAY * 10 && d.cause !== 'age') deaths++;
    const good = (days > 12 ? 1 : days < 4 ? -2 : 0) + (mood > 62 ? 1 : mood < 42 ? -1 : 0) - Math.min(2, deaths) + per(ruler, AX.KIND) * 0.5;
    for (const p of adults) {
      if (p === ruler) continue;
      if (good >= 1.2) think(c, p, 'goodrule', ruler.id);
      else if (good <= -1 && per(p, AX.LOYAL) < 1) think(c, p, 'badrule', ruler.id);
    }
  }

  const k = c.gov.k;
  // the speaker stands for election every two years
  if (k === 'council' && t >= c.gov.next) { election(c, r); return; }

  // among the strong, anyone who thinks they can take the seat may try
  if (k === 'chief' && day % 3 === 0) {
    const rival = adults.find((p) => p !== ruler && per(p, AX.AMBITION) > 0.5 && power(p) > power(ruler!) * 1.05 && opinion(c, p, ruler!) < 15 && !has(p, 'pacifist') && p.hp > 70);
    if (rival && r.chance(0.12)) {
      const win = power(rival) + r.float() * 8 >= power(ruler) + r.float() * 8 ? rival : ruler;
      const lose = win === rival ? ruler : rival;
      wound(c, lose, 'cut', 18 + r.int(22), r);
      wound(c, win, 'cut', 6 + r.int(14), r);
      think(c, lose, 'humbled', win.id);
      log(c, 'challenge', rival.id, ruler.id, win === rival ? 'won' : 'lost');
      note(c, rival, 'challenge', ruler.id, win === rival ? 'won' : 'lost');
      bump(c, 'challenges');
      if (win === rival) { ruler.rank = RANK.COMMONER; crown(c, rival, 'fought', ruler); }
      if (lose.hp <= 0 && !lose.gone) die(c, lose, 'duel', win.id);
      return;
    }
  }

  // a hated ruler and an ambitious rival with friends: a coup
  // (the plot itself grows in intrigue.ts; here its day has come)
  if (c.plot?.go) {
    {
      const plotter = pawnById(c, c.plot.lead);
      const with_ = c.plot.mem.length;
      c.plot = undefined;
      if (plotter && !plotter.gone && plotter !== ruler) {
        bump(c, 'coups');
        if (with_ > 0) {
          const old = ruler;
          old.rank = RANK.COMMONER;
          if (k !== 'council') c.gov.k = 'tyrant';
          crown(c, plotter, 'coup', old);
          log(c, 'coup', plotter.id, old.id, undefined, with_);
          const fate = r.float();
          if (fate < 0.35) die(c, old, 'coup', plotter.id);
          else if (fate < 0.75) depart(c, old, 'exiled');
          else think(c, old, 'humbled', plotter.id);
        } else {
          log(c, 'plot_failed', plotter.id, ruler.id);
          note(c, plotter, 'plot_failed', ruler.id);
          think(c, ruler, 'betrayedby', plotter.id);
          if (c.gov.laws.harsh >= 2) die(c, plotter, 'executed', ruler.id);
          else if (c.gov.laws.harsh >= 1) depart(c, plotter, 'exiled');
          else think(c, plotter, 'humbled', ruler.id);
        }
        return;
      }
    }
  }

  // a ruler who has held the seat long and well may decide it belongs to their children
  if ((k === 'elder' || k === 'chief' || k === 'tyrant') && day % 15 === 0 && t - c.gov.since > TICKS_PER_YEAR * 3 && per(ruler, AX.AMBITION) > 0.3) {
    const kids = c.pawns.some((p) => p.mo === ruler!.id || p.fa === ruler!.id);
    if (kids && approval(c) > 12 && r.chance(0.3)) {
      c.gov.k = 'lord';
      log(c, 'house_founded', ruler.id, undefined, ruler.fam);
      note(c, ruler, 'house_founded', undefined, ruler.fam);
      bump(c, 'houses');
      updateRanks(c, false);
    }
  }
}
