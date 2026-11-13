// The things a colony does not say out loud: people kept in thrall, plots against the ruler
// that grow one whispered conversation at a time, and a cult that meets after dark.

import { TICKS_PER_DAY, dayOf } from '../config';
import { ask } from './ask';
import { accuse } from './crime';
import { bump, log, note } from './events';
import { approval } from './gov';
import { depart } from './life';
import { think } from './mood';
import { STAGE, has, makePawn, mkAct, pawnById, per, stage } from './pawn';
import { Rand, S } from './rng';
import { addFact, findFact, learn, opinion } from './social';
import { AX, type Colony, type Pawn } from './types';

const adultsOf = (c: Colony): Pawn[] => c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT);

// ---------- Thralls ----------

/** A raider is taken alive. What becomes of them depends on who rules. */
export function capture(c: Colony, kind: string, r: Rand): void {
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler || c.pawns.length >= 36) return;
  if (c.gov.laws.thrall) {
    const p = makePawn(c, r, { race: kind === 'orc' ? 'orc' : r.pick(['human', 'human', 'orc', 'goblin', 'dwarf', 'halfling'] as const) });
    p.thrall = true;
    p.rank = 0;
    p.x = c.cx; p.y = c.cy;
    p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
    c.pawns.push(p);
    note(c, p, 'enthralled', undefined, c.name);
    log(c, 'captured', p.id, undefined, kind);
    bump(c, 'thralls');
  } else {
    c.stock.silver += 8;
    log(c, 'ransomed', undefined, undefined, kind);
  }
}

function free(c: Colony, p: Pawn, why: string): void {
  p.thrall = undefined;
  p.rank = 2;
  think(c, p, 'freed');
  note(c, p, 'freed');
  log(c, 'freed', p.id, undefined, why);
}

function thralls(c: Colony, r: Rand): void {
  const ruler = pawnById(c, c.gov.ruler);
  const guards = c.pawns.some((p) => p.prof === 'guard');
  for (const p of c.pawns.slice()) {
    if (!p.thrall || p.gone) continue;
    if (!c.gov.laws.thrall) { free(c, p, 'law'); continue; }
    if (ruler && opinion(c, ruler, p) > 40 && r.chance(0.02)) { free(c, p, 'earned'); continue; }
    if (!p.brk && r.chance((guards ? 0.006 : 0.014) + (p.mood < 30 ? 0.01 : 0))) {
      log(c, 'escaped', p.id);
      depart(c, p, 'escaped');
    }
  }
}

// ---------- Plots ----------

function endPlot(c: Colony): void {
  c.plot = undefined;
}

/** Someone tells the ruler. The leader stands trial; the rest are marked. */
export function exposePlot(c: Colony, by: Pawn | undefined): void {
  const plot = c.plot;
  const ruler = pawnById(c, c.gov.ruler);
  if (!plot || !ruler) return;
  const lead = pawnById(c, plot.lead);
  for (const id of plot.mem) {
    const m = pawnById(c, id);
    if (m && m !== ruler) think(c, ruler, 'betrayedby', m.id);
    if (m && by && m !== by) think(c, m, 'betrayedsecret', by.id);
  }
  log(c, 'plot_failed', plot.lead, ruler.id, undefined, plot.mem.length);
  bump(c, 'plotsExposed');
  if (lead && !lead.gone) {
    note(c, lead, 'plot_failed', ruler.id);
    const f = findFact(c, 'plot', lead.id) ?? addFact(c, 'plot', lead.id, undefined, true);
    learn(c, ruler, f);
    accuse(c, ruler, lead, 'treason', f);
  }
  endPlot(c);
}

export function joinPlot(c: Colony, p: Pawn): void {
  if (!c.plot || c.plot.mem.includes(p.id)) return;
  c.plot.mem.push(p.id);
  const lead = pawnById(c, c.plot.lead);
  if (lead) think(c, lead, 'toldsecret', p.id);
  note(c, p, 'plotter', c.plot.lead);
}

function plots(c: Colony, r: Rand): void {
  const adults = adultsOf(c).filter((p) => !p.thrall);
  const ruler = pawnById(c, c.gov.ruler);
  if (!ruler || adults.length < 6) { endPlot(c); return; }
  const t = c.tick;
  if (!c.plot) {
    if (dayOf(t) % 4 !== 0 || t - c.gov.since < TICKS_PER_DAY * 30 || approval(c) > -4) return;
    const lead = adults.filter((p) => p !== ruler && per(p, AX.AMBITION) > 0.8 && opinion(c, p, ruler) < -10 && !p.brk).sort((a, b) => per(b, AX.AMBITION) - per(a, AX.AMBITION) || a.id - b.id)[0];
    if (!lead || !r.chance(0.35)) return;
    c.plot = { lead: lead.id, mem: [lead.id], t };
    note(c, lead, 'plotter');
    log(c, 'plot', lead.id, ruler.id);
    bump(c, 'plots');
    return;
  }
  const plot = c.plot;
  const lead = pawnById(c, plot.lead);
  plot.mem = plot.mem.filter((id) => { const m = pawnById(c, id); return !!m && !m.gone; });
  if (!lead || lead.gone || plot.ruler !== undefined && plot.ruler !== ruler.id) { endPlot(c); return; }
  plot.ruler = ruler.id;
  // the day comes
  if (plot.mem.length >= Math.max(3, adults.length * 0.34)) { plot.go = true; return; }
  if (t - plot.t > TICKS_PER_DAY * 45) { log(c, 'plot_fades', lead.id); endPlot(c); return; }
  // a quiet word with someone who might listen
  const teller = pawnById(c, r.pick(plot.mem)) ?? lead;
  const pool = adults.filter((p) => p !== ruler && !plot.mem.includes(p.id) && !p.brk && opinion(c, p, teller) > 12);
  if (pool.length) {
    const o = r.pick(pool);
    const loyal = opinion(c, o, ruler);
    if (o.owner) ask(c, o, 'plot', teller.id, undefined, 2);
    else if (loyal < 5 && r.chance(0.5 + per(o, AX.AMBITION) * 0.1)) joinPlot(c, o);
    else if (loyal > 25 && per(o, AX.LOYAL) > 0.3 && r.chance(0.5)) { exposePlot(c, o); return; }
  }
  // walls have ears
  if (r.chance(0.012 * plot.mem.length)) exposePlot(c, undefined);
}

// ---------- The cult of the Hollow Mother ----------

export function joinCult(c: Colony, p: Pawn, by?: Pawn): void {
  if (p.cult) return;
  p.cult = true;
  think(c, p, 'hollowfound');
  note(c, p, 'cult', by?.id);
  bump(c, 'cultists');
  if (!findFact(c, 'secret', p.id)) p.know.push(addFact(c, 'secret', p.id, undefined, true, 'cultist').id);
}

/** Someone who knows goes to the ruler: a trial for heresy, if the ruler cares about such things. */
export function exposeCultist(c: Colony, by: Pawn, who: Pawn): void {
  const f = findFact(c, 'secret', who.id) ?? addFact(c, 'secret', who.id, undefined, true, 'cultist');
  learn(c, by, f);
  const ruler = pawnById(c, c.gov.ruler);
  log(c, 'cult_found', who.id, by.id);
  if (ruler && !ruler.cult && ruler.dev >= 1) { learn(c, ruler, f); accuse(c, by, who, 'heresy', f); }
}

function cult(c: Colony, r: Rand): void {
  const adults = adultsOf(c);
  const cultists = adults.filter((p) => p.cult);
  const day = dayOf(c.tick);
  // the desperate find her on their own
  if (day % 3 === 0) {
    for (const p of adults) {
      if (p.cult || p.owner || p.dev >= 2 && !has(p, 'superstitious')) continue;
      if (p.mood < 32 && p.low > 6 && r.chance(cultists.length ? 0.02 : 0.008)) { joinCult(c, p); log(c, 'cult_whisper', p.id); break; }
    }
  }
  if (!cultists.length) return;
  // and those who have found her bring their friends
  if (day % 2 === 0) {
    const teller = r.pick(cultists);
    const pool = adults.filter((p) => !p.cult && !p.brk && opinion(c, p, teller) > 22);
    if (pool.length) {
      const o = r.pick(pool);
      if (o.owner) ask(c, o, 'cult', teller.id, undefined, 2);
      else if (o.dev >= 2 && per(o, AX.PIETY) > 0.5) { if (r.chance(0.4)) exposeCultist(c, o, teller); else think(c, o, 'heretic', teller.id); }
      else if (r.chance(o.mood < 45 ? 0.4 : 0.15)) joinCult(c, o, teller);
    }
  }
  // the rite, on the dark of the moon
  if (day % 15 === 14 && cultists.length >= 3) {
    for (const p of cultists) think(c, p, 'rite');
    log(c, 'rite', undefined, undefined, undefined, cultists.length);
    const others = adults.filter((p) => !p.cult && (has(p, 'nightowl') || p.prof === 'guard' || has(p, 'insomniac')));
    if (others.length && r.chance(0.35)) exposeCultist(c, r.pick(others), r.pick(cultists));
  }
  // enough of them, and she no longer needs to hide
  if (cultists.length >= 5 && cultists.length >= adults.length * 0.45 && !c.stats.cultRisen) {
    c.stats.cultRisen = 1;
    for (const p of cultists) { p.faith = 'hollow'; p.dev = Math.max(p.dev, 2); }
    for (const p of adults) if (!p.cult) think(c, p, 'omen_bad');
    log(c, 'cult_rises', undefined, undefined, undefined, cultists.length);
  }
}

/** Once a day. */
export function dailyIntrigue(c: Colony): void {
  const r = new Rand(c.seed, S.GOV, dayOf(c.tick), 55);
  thralls(c, r);
  plots(c, r);
  cult(c, r);
}
