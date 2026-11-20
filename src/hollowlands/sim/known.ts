// What the colony knows how to do, asked from all over the sim (the fields, the kitchen, the
// hearths, the forge). Kept apart from tech.ts so the parts that only ask need not pull it in.

import { TECH_BLDS } from './data/tech';
import type { Bld, Colony } from './types';

/** Does the colony know this? */
export function knows(c: Colony, k: string): boolean {
  const t = c.tech;
  if (!t) return false;
  for (const g of t.got) if (g.k === k) return true;
  return false;
}

interface Memo { t: number; n: number; blds: Map<string, Bld>; glazed: Set<number> }
const memo = new WeakMap<Colony, Memo>();

/** The colony's discovered trades' buildings that stand finished (first of each kind), and its glazed homes; worked out once a tick. */
export function techScan(c: Colony): Memo {
  const got = memo.get(c);
  if (got && got.t === c.tick && got.n === c.blds.length) return got;
  const blds = new Map<string, Bld>();
  const glazed = new Set<number>();
  if (c.tech && c.tech.got.length) {
    for (const b of c.blds) {
      if (!b.built) continue;
      if (b.gl) glazed.add(b.id);
      if (TECH_BLDS.has(b.k) && !blds.has(b.k)) blds.set(b.k, b);
    }
  }
  const m: Memo = { t: c.tick, n: c.blds.length, blds, glazed };
  memo.set(c, m);
  return m;
}

/** A finished building of this discovered kind, if the colony has one. */
export const techBld = (c: Colony, k: string): Bld | undefined => techScan(c).blds.get(k);

/** Bigger harvests from rested and watered fields. */
export const harvestMult = (c: Colony): number => (knows(c, 'rotation') ? 1.12 : 1) * (knows(c, 'irrigation') ? 1.12 : 1);

/** Steel tools and blades: known, and a steelworks to make them. */
export const steel = (c: Colony): boolean => !!techBld(c, 'steelworks');

/** Something the scan counts has changed (a building finished, a home glazed): look again. */
export const techDirty = (c: Colony): void => { memo.delete(c); };
