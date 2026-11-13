// Dilemmas: at a turning point the sim asks the player what their colonist does. If no
// answer comes in time, the colonist decides for themselves, the way anyone else would.
// Not answering never costs anything.

import { TICKS_PER_DAY } from '../config';
import { accuse } from './crime';
import { factById, log, note } from './events';
import { think, getRel } from './mood';
import { pawnById, per } from './pawn';
import { opinion } from './social';
import { exposeCultist, exposePlot, joinCult, joinPlot } from './intrigue';
import { AX, type Colony, type Id, type Input, type Pawn } from './types';

export interface AskDef { k: string; title: string; text: string; opts: [string, string][] }

/** {o} in the text is the other person's name. */
export const ASKS: Record<string, AskDef> = {
  propose: { k: 'propose', title: 'A proposal', text: '{o} has asked for their hand in marriage.', opts: [['yes', 'Say yes'], ['no', 'Refuse']] },
  report: { k: 'report', title: 'Caught in the act', text: 'They saw {o} stealing from the stores. Nobody else did.', opts: [['report', 'Turn them in'], ['hush', 'Say nothing'], ['blackmail', 'Make them pay for silence']] },
  plot: { k: 'plot', title: 'A quiet word', text: '{o} says the ruler has to go, and asks if they are in.', opts: [['join', 'Join the plot'], ['no', 'Want no part of it'], ['warn', 'Warn the ruler']] },
  cult: { k: 'cult', title: 'After dark', text: '{o} speaks of the Hollow Mother, who fills what is empty, and asks them to come and see.', opts: [['join', 'Go with them'], ['no', 'Refuse'], ['report', 'Tell the ruler']] },
  settle: { k: 'settle', title: 'Talk of leaving', text: 'People are talking about setting out to found a new colony.', opts: [['go', 'Go with them'], ['stay', 'Stay here'], ['see', 'Let them decide']] },
};

/** Put a question to the player (if this colonist has one and is not already being asked something). */
export function ask(c: Colony, p: Pawn, k: string, o?: Id, n?: number, days = 2): boolean {
  if (!p.owner || p.ask || p.gone) return false;
  p.ask = { k, o, n, x: c.tick + TICKS_PER_DAY * days };
  log(c, 'asked', p.id, o, k);
  return true;
}

function betroth(c: Colony, p: Pawn, o: Pawn): void {
  getRel(p, o.id).k = 'betrothed';
  getRel(o, p.id).k = 'betrothed';
  think(c, p, 'proposed', o.id);
  think(c, o, 'proposed', p.id);
  log(c, 'betrothed', p.id, o.id);
  note(c, p, 'betrothed', o.id);
  note(c, o, 'betrothed', p.id);
}

/** Settle a question with the given answer, or the colonist's own choice when v is ''. */
export function settleAsk(c: Colony, p: Pawn, v: string): void {
  const a = p.ask;
  if (!a) return;
  p.ask = undefined;
  const o = a.o ? pawnById(c, a.o) : undefined;
  if (a.k === 'propose') {
    if (!o || o.gone || p.sp !== o.id || p.rel[o.id]?.k !== 'lover') return;
    const yes = v ? v === 'yes' : opinion(c, p, o) >= 45;
    if (yes) betroth(c, o, p);
    else { think(c, o, 'proposalno', p.id); log(c, 'refused', o.id, p.id); }
  } else if (a.k === 'report') {
    if (!o || o.gone) return;
    const close = p.sp === o.id || p.rel[o.id]?.f === 1 || o.mo === p.id || o.fa === p.id || p.mo === o.id || p.fa === o.id;
    const choice = v || (close && per(p, AX.HONEST) < 1 ? 'hush' : per(p, AX.GREED) > 1.2 && per(p, AX.HONEST) < -0.5 ? 'blackmail' : 'report');
    const f = factById(c, a.n ?? -1);
    if (choice === 'report' && f) {
      log(c, 'theft', o.id, p.id, f.s);
      note(c, o, 'caught', p.id, f.s);
      accuse(c, p, o, 'theft', f);
    } else if (choice === 'blackmail') {
      const pay = Math.min(o.coin, 8);
      o.coin -= pay;
      p.coin += pay;
      think(c, o, 'threatened', p.id);
      log(c, 'blackmail', p.id, o.id, undefined, Math.round(pay));
      note(c, p, 'blackmail', o.id);
    } else {
      think(c, o, 'toldsecret', p.id);
      log(c, 'theft_hushed', o.id, p.id, f?.s);
    }
  } else if (a.k === 'plot') {
    const ruler = pawnById(c, c.gov.ruler);
    const choice = v || (ruler && opinion(c, p, ruler) < 5 ? 'join' : ruler && opinion(c, p, ruler) > 25 && per(p, AX.LOYAL) > 0.3 ? 'warn' : 'no');
    if (choice === 'join') joinPlot(c, p);
    else if (choice === 'warn') exposePlot(c, p);
  } else if (a.k === 'cult') {
    const choice = v || (p.dev >= 2 ? 'no' : p.mood < 40 ? 'join' : 'no');
    if (choice === 'join') joinCult(c, p, o);
    else if (choice === 'report' && o && !o.gone) exposeCultist(c, p, o);
  } else if (a.k === 'settle') {
    if (v === 'go') p.roots = -1;
    else if (v === 'stay') p.roots = 1;
  }
}

/** The player's answer arrives. */
export function answer(c: Colony, e: Input): void {
  const p = c.pawns.find((x) => x.owner === e.owner && !x.gone);
  if (!p || !p.ask) return;
  const v = String(e.v ?? '');
  if (!ASKS[p.ask.k]?.opts.some((o) => o[0] === v)) return;
  settleAsk(c, p, v);
}
