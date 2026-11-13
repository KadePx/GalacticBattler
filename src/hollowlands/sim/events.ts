// The colony's event log and each colonist's own life record.

import type { Colony, Fact, Id, Pawn } from './types';

const LOG_KEEP = 800;

export function log(c: Colony, k: string, a?: Id, b?: Id, s?: string, n?: number): void {
  c.log.push({ t: c.tick, k, a, b, s, n });
  // some things are worth telling the neighbours
  if (k === 'ruler' || k === 'outbreak' || k === 'saint' || k === 'coup') {
    const p = a ? c.pawns.find((x) => x.id === a) : undefined;
    c.out.push({ k: 'news', what: k, who: k === 'outbreak' ? s ?? '' : p ? `${p.first} ${p.fam}` : '' });
  }
  if (c.log.length > LOG_KEEP) {
    const drop = c.log.length - LOG_KEEP + 100;
    c.log.splice(0, drop);
    c.logBase += drop;
  }
}

/** Write a line in someone's life story. */
export function note(c: Colony, p: Pawn, k: string, o?: Id, s?: string): void {
  p.bio.push({ t: c.tick, k, o, s });
  if (p.bio.length > 80) p.bio.splice(8, 1); // keep the earliest and the latest
}

export function bump(c: Colony, k: string, n = 1): void {
  c.stats[k] = (c.stats[k] ?? 0) + n;
}

export function factById(c: Colony, id: number): Fact | undefined {
  for (let i = c.facts.length - 1; i >= 0; i--) if (c.facts[i].id === id) return c.facts[i];
  return undefined;
}
