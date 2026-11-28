// Scenes set going by hand so they can be looked at (the __hl.scene test hook). Local test colonies
// only: nothing here is reached by a live colony, and it is kept out of the sim's own files so that
// stays true.

import { TICKS_PER_HOUR } from '../config';
import { cropsChanged } from '../sim/cache';
import { cells } from '../sim/data/buildings';
import { bury, die } from '../sim/life';
import { STAGE, pawnById, stage } from '../sim/pawn';
import { planProcession } from '../sim/street';
import { B, type Colony, type Pawn } from '../sim/types';

/**
 * For local test colonies only: set a scene going now so it can be looked at. 'wedding' betroths two
 * free adults if nobody is betrothed and holds the wedding three hours from now; 'funeral' holds one
 * for the last of the dead to be buried (or, if the graves are empty, for the oldest of the living,
 * who dies of age on the spot); 'harvest' ripens the two fields nearest the granary and reaps half of
 * each. Returns the tile to look at and how many ticks until there is something to see, or null.
 */
export function forceScene(c: Colony, what: string): { x: number; y: number; wait: number } | null {
  const t = c.tick;
  if (what === 'wedding' || what === 'funeral') {
    const temple = c.blds.find((b) => b.built && b.k === 'shrine') ?? c.blds.find((b) => b.built && b.k === 'hall');
    let g: NonNullable<Colony['gath']> | null = null;
    if (what === 'wedding') {
      const free = (p: Pawn): boolean => !p.gone && !p.brk && stage(c, p) === STAGE.ADULT && !!p.home;
      let a = c.pawns.find((p) => free(p) && !!p.sp && p.rel[p.sp]?.k === 'betrothed' && !!pawnById(c, p.sp));
      let b = a ? pawnById(c, a.sp) : undefined;
      if (!a || !b) {
        a = c.pawns.find((p) => free(p) && !p.sp);
        b = a ? c.pawns.find((p) => p !== a && free(p) && !p.sp && p.fam !== a!.fam && p.home !== a!.home) : undefined;
        if (!a || !b) return null;
        a.sp = b.id;
        b.sp = a.id;
        (a.rel[b.id] ??= { m: [] }).k = 'betrothed';
        (b.rel[a.id] ??= { m: [] }).k = 'betrothed';
      }
      const x = temple ? temple.x + Math.floor(temple.w / 2) : c.cx;
      const y = temple ? temple.y + Math.floor(temple.h / 2) : c.cy;
      g = { k: 'wedding', t0: t + 3 * TICKS_PER_HOUR, t1: t + 6 * TICKS_PER_HOUR, b: temple?.id ?? 0, a: Math.min(a.id, b.id), o: Math.max(a.id, b.id), x, y };
    } else {
      let d = [...c.dead].reverse().find((x) => x.grave >= 0 && !x.left);
      if (!d) {
        const old = c.pawns.filter((p) => !p.gone && !p.owner).sort((x, y) => x.born - y.born || x.id - y.id)[0];
        if (!old) return null;
        die(c, old, 'age');
        bury(c);
        d = c.dead[c.dead.length - 1];
      }
      const yard = c.blds.find((b) => b.k === 'graveyard' && b.built);
      const at = yard ?? temple;
      const x = d.grave >= 0 ? d.grave % c.w : at ? at.x + Math.floor(at.w / 2) : c.cx;
      const y = d.grave >= 0 ? Math.floor(d.grave / c.w) : at ? at.y + Math.floor(at.h / 2) : c.cy;
      d.fun = 1;
      g = { k: 'funeral', t0: t + 3 * TICKS_PER_HOUR, t1: t + 5 * TICKS_PER_HOUR, b: at?.id ?? 0, a: d.id, x, y };
    }
    c.gath = g;
    const pr = (g.pr = planProcession(c, g));
    if (pr.t < 0) return { x: g.x, y: g.y, wait: g.t0 - t };
    return { x: pr.x, y: pr.y, wait: Math.max(0, pr.t - 2 - t) };
  }
  if (what === 'harvest') {
    const gran = c.blds.find((b) => b.built && b.k === 'granary') ?? c.blds.find((b) => b.built && b.k === 'store');
    const fields = c.blds.filter((b) => b.built && b.k === 'field').sort((a, b) => (gran ? Math.abs(a.x - gran.x) + Math.abs(a.y - gran.y) - Math.abs(b.x - gran.x) - Math.abs(b.y - gran.y) : 0) || a.id - b.id).slice(0, 2);
    if (!fields.length) return null;
    for (const f of fields) {
      f.crop ??= 'grain';
      let n = 0;
      for (const q of cells('field')) {
        const i = (f.y + q.dy) * c.w + f.x + q.dx;
        if (c.st[i] === B.TILLED) c.crop[i] = n++ % 2 ? 255 : 0;
      }
    }
    cropsChanged(c);
    return { x: fields[0].x + (fields[0].w >> 1), y: fields[0].y + (fields[0].h >> 1), wait: 0 };
  }
  return null;
}
