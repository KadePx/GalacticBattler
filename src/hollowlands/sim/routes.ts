// What passes between colonies, and what the wider land does to all of them. Pure functions,
// used by both the one-process world (world.ts) and the server's region keeper.

import { hash32, S } from './rng';

export interface Place { id: string; name: string; x: number; y: number; dead?: number; nearSent?: string; ruins?: string }
export interface Delivery { to: string; input: Record<string, unknown> }

const gap = (a: Place, b: Place): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Living colonies other than this one, nearest first. */
export function nearest<T extends Place>(sites: T[], fromId: string): T[] {
  const me = sites.find((s) => s.id === fromId);
  return sites.filter((s) => s.id !== fromId && !s.dead).sort((a, b) => (me ? gap(a, me) - gap(b, me) : 0) || (a.id < b.id ? -1 : 1));
}

/** Where one outgoing message goes. Settler parties are handled by the caller. */
export function routeMsg(sites: Place[], fromId: string, fromName: string, m: Record<string, unknown>): Delivery[] {
  const near = nearest(sites, fromId);
  if (typeof m.to === 'string') {
    if (!sites.some((s) => s.id === m.to && !s.dead)) return [];
    return [{ to: m.to, input: m.k === 'migrant' ? { k: 'migrant', pawn: m.pawn, fromName: m.fromName, why: m.why } : { ...m, to: undefined } }];
  }
  if (m.k === 'migrant') return near[0] ? [{ to: near[0].id, input: { k: 'migrant', pawn: m.pawn, fromName: m.fromName, why: m.why } }] : [];
  if (m.k === 'news') return near.slice(0, 3).map((s) => ({ to: s.id, input: { k: 'news', what: m.what, name: fromName, who: m.who } }));
  return [];
}

/** Tell each colony who its neighbours are, whenever that has changed. */
export function nearLists(sites: Place[]): Delivery[] {
  const out: Delivery[] = [];
  for (const s of sites) {
    if (s.dead) continue;
    const list = nearest(sites, s.id).slice(0, 4).map((n) => ({ id: n.id, name: n.name }));
    const key = list.map((n) => n.id).join(',');
    if (key === (s.nearSent ?? '')) continue;
    s.nearSent = key;
    out.push({ to: s.id, input: { k: 'near', list } });
  }
  return out;
}

const WARLORDS = ['Gorgath the Flayer', 'Old Mother Tusk', 'Urzag Nine-Fingers', 'the Red Thane', 'Skarn of the Pit', 'Queen Vessa the Pale'];

/**
 * Now and then something bigger than any one colony moves across the land: a warlord's host,
 * a plague, a winter that will not end. Returns what each colony receives, or nothing.
 */
export function landThreat(seed: number, day: number, sites: Place[], state: { lastThreat?: number }): Delivery[] {
  const alive = sites.filter((s) => !s.dead);
  if (alive.length < 2 || day < 60 || day - (state.lastThreat ?? 0) < 45) return [];
  if (hash32(seed, S.STORY, 700, day) % 100 >= 3) return [];
  state.lastThreat = day;
  const roll = hash32(seed, S.STORY, 701, day) % 10;
  const out: Delivery[] = [];
  if (roll < 5) {
    const who = WARLORDS[hash32(seed, S.STORY, 702, day) % WARLORDS.length];
    for (const s of alive) {
      out.push({ to: s.id, input: { k: 'news', what: 'warlord', name: who, who: '' } });
      out.push({ to: s.id, input: { k: 'raid', kind: 'orc', n: 3 + (hash32(seed, S.STORY, 703, day, s.x, s.y) % 3), delay: 240 + (hash32(seed, S.STORY, 704, day, s.x) % 1200) } });
    }
  } else if (roll < 8) {
    for (const s of alive) out.push({ to: s.id, input: { k: 'news', what: 'outbreak', name: 'the road', who: 'plague' } });
  } else {
    for (const s of alive) out.push({ to: s.id, input: { k: 'mod', mod: 'coldsnap', days: 8 } });
  }
  return out;
}

/** An abandoned colony close enough for settlers to move into, if they are so minded. */
export function ruinFor<T extends Place>(seed: number, sites: T[], parent: Place | undefined, n: number): T | undefined {
  if (!parent || hash32(seed, S.GEN, 950, n) % 100 >= 40) return undefined;
  return sites.filter((s) => s.dead && gap(s, parent) <= 14 && !sites.some((o) => !o.dead && o.x === s.x && o.y === s.y)).sort((a, b) => gap(a, parent) - gap(b, parent))[0];
}
