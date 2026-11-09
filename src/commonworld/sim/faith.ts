// Milestone 7: faiths. A devout people with temples (and often a prophet) founds a faith; it
// spreads to neighbours through temples, trade, alliances and prestige; big faiths split in
// schisms. A shared faith warms relations, a rival one cools them, and the devout may go to
// war over it. Holy cities are steadier for the faithful who hold them.

import { ev, has, tally } from './civ';
import { relOf } from './diplo';
import { hash32, Rand, S } from './rng';
import { faithName } from './names';
import { greatCount } from './people';
import { civAge } from './techs';
import type { Civ, Faith, World } from './types';

function templesOf(w: World, c: Civ): number {
  let n = 0;
  for (const id of tally.list[c.id] ?? []) n += w.setts[id].b.temple;
  return n;
}

function newFaith(w: World, c: Civ, holy: number, parent: number, prophet: string): Faith {
  const id = w.faiths.length;
  const f: Faith = {
    id, name: faithName(c.phon, c.lex, id), civ: c.id, holy, born: w.tick, died: -1,
    hue: hash32(w.seed, S.FAITH, id) % 360, parent, prophet,
  };
  w.faiths.push(f);
  return f;
}

/** Where the faithful look: the biggest town with the most temples. */
function holySite(w: World, c: Civ): number {
  let best = c.capital;
  let bw = -1;
  for (const id of tally.list[c.id] ?? []) {
    const s = w.setts[id];
    const v = s.b.temple * 1000 + s.pop / 100;
    if (v > bw) { bw = v; best = id; }
  }
  return best;
}

/** True if the people holds the holy city of the faith they keep. */
export function holdsHoly(w: World, c: Civ): boolean {
  if (c.faith < 0) return false;
  const s = w.setts[w.faiths[c.faith].holy];
  return !!s && s.died < 0 && s.civ === c.id;
}

/** How two peoples' faiths colour their opinion of each other. */
export function faithOpinion(a: Civ, b: Civ): number {
  if (a.faith < 0 || b.faith < 0) return 0;
  if (a.faith === b.faith) return 10;
  return has(a, 'devout') || has(b, 'devout') ? -10 : -4;
}

export function yearlyFaith(w: World): void {
  const keepers = new Array<number>(w.faiths.length).fill(0);
  for (const c of w.civs) if (c.died < 0 && c.faith >= 0) keepers[c.faith]++;
  for (const f of w.faiths) {
    if (f.died < 0 && keepers[f.id] === 0) {
      f.died = w.tick;
      ev(w, { k: 'faith_end', a: f.civ, x: f.name });
    }
  }

  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const r = new Rand(w.seed, S.FAITH, w.tick, c.id);
    const temples = templesOf(w, c);

    // A people without a faith may found one.
    if (c.faith < 0 && temples >= 1 && civAge(c) >= 1) {
      const prophets = greatCount(c, 'prophet');
      const p = (0.004 + (has(c, 'devout') ? 0.02 : 0) + prophets * 0.05 + (c.ruler.trait === 'pious' ? 0.01 : 0)) * Math.min(1, temples / 3);
      if (r.chance(p)) {
        const pr = c.greats.find((g) => g.kind === 'prophet');
        if (pr) pr.deeds++;
        const f = newFaith(w, c, holySite(w, c), -1, pr?.name ?? c.ruler.name);
        c.faith = f.id;
        keepers.push(1);
        ev(w, { k: 'faith_found', a: c.id, s: f.holy, x: f.name, y: f.prophet });
        continue;
      }
    }

    // Neighbours' faiths press in, through temples, trade, friendship and prestige.
    const press = new Map<number, number>();
    for (const k of c.contacts) {
      const o = w.civs[k];
      if (o.died >= 0 || o.faith < 0 || o.faith === c.faith) continue;
      const rl = relOf(w, c.id, k);
      if (rl?.st === 'war') continue;
      const p = 0.5 + 0.12 * Math.min(8, templesOf(w, o)) + (rl?.st === 'ally' ? 0.6 : rl?.st === 'pact' ? 0.3 : 0) +
        (has(o, 'devout') ? 0.4 : 0) + Math.min(1, o.culture / 500) + (holdsHoly(w, o) ? 0.3 : 0);
      press.set(o.faith, Math.max(press.get(o.faith) ?? 0, p) + 0.1);
    }
    let pick = -1;
    let most = 0;
    for (const [f, p] of press) if (p > most || (p === most && f < pick)) { most = p; pick = f; }
    if (pick >= 0) {
      let chance = 0.012 * Math.min(4, most);
      if (c.faith >= 0) chance *= 0.15 * (has(c, 'devout') ? 0.5 : 1) * (holdsHoly(w, c) ? 0.3 : 1);
      if (has(c, 'stubborn') || has(c, 'ancestral')) chance *= 0.6;
      if (r.chance(Math.min(0.5, chance))) {
        const old = c.faith;
        c.faith = pick;
        keepers[pick]++;
        if (old >= 0) keepers[old]--;
        ev(w, { k: 'convert', a: c.id, x: w.faiths[pick].name, y: old >= 0 ? w.faiths[old].name : undefined });
        continue;
      }
    }

    // A great faith can split: a far, restless or zealous people breaks with the holy city.
    const kept = c.faith >= 0 ? w.faiths[c.faith] : null;
    const lastSplit = kept ? Math.max(kept.born, ...w.faiths.filter((f) => f.parent === kept.id).map((f) => f.born)) : 0;
    if (kept && keepers[kept.id] >= 4 && !holdsHoly(w, c) && w.tick - lastSplit > 150 * 12) {
      const ids = tally.list[c.id] ?? [];
      let stab = 0;
      for (const id of ids) stab += w.setts[id].stab;
      stab /= Math.max(1, ids.length);
      const p = 0.002 * (has(c, 'devout') ? 2 : 1) * (stab < 40 ? 2 : 1) * (greatCount(c, 'prophet') ? 2 : 1);
      if (r.chance(p)) {
        const old = w.faiths[c.faith];
        const pr = c.greats.find((g) => g.kind === 'prophet');
        const f = newFaith(w, c, holySite(w, c), old.id, pr?.name ?? c.ruler.name);
        keepers[old.id]--;
        keepers.push(1);
        c.faith = f.id;
        ev(w, { k: 'schism', a: c.id, s: f.holy, x: f.name, y: old.name, z: f.prophet });
      }
    }
  }
}
