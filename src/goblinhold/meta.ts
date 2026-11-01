// Renown: earned when a hold falls, spent on permanent head starts for later runs.
import { BUILD, BuildKind, RELIC_IDS } from './defs';
import { addRelic, arrive, assignHomes, newName, place, rollTraits } from './sim';
import { Game, pick } from './state';
import { keepCenter, rebuild } from './map';

export interface Unlock { id: string; name: string; desc: string; cost: number; }
export const UNLOCKS: Unlock[] = [
  { id: 'stores', name: 'Full larders', desc: 'Start with +20 food, +20 wood and +10 stone.', cost: 15 },
  { id: 'settler', name: 'Another pair of hands', desc: 'Start with a sixth settler.', cost: 40 },
  { id: 'blueprint', name: 'Old plans', desc: 'Start with a random blueprint.', cost: 30 },
  { id: 'veterans', name: 'Seasoned guard', desc: 'Your starting militia and archer are ready for promotion.', cost: 30 },
  { id: 'market', name: 'Trade charter', desc: 'Start with a market already built.', cost: 55 },
  { id: 'relic', name: 'Heirloom', desc: 'Start with a random relic.', cost: 75 },
  { id: 'hut', name: 'Second hut', desc: 'Start with a second hut, so nobody sleeps on the floor.', cost: 20 },
];

export interface Meta { renown: number; total: number; unlocks: string[]; runs: number; }
const KEY = 'goblinhold.meta';

export function loadMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (m && typeof m.renown === 'number') return { renown: m.renown, total: m.total ?? m.renown, unlocks: m.unlocks ?? [], runs: m.runs ?? 0 };
  } catch { /* ignore */ }
  return { renown: 0, total: 0, unlocks: [], runs: 0 };
}
export function saveMeta(m: Meta) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ } }

/** Renown earned by a finished run. */
export function renownFor(g: Game) {
  return g.day + g.stats.bosses * 5 + Math.floor(g.stats.kills / 25) + (g.charters?.done.length ?? 0) * 3 + (g.stats.cleanAssaults ?? 0);
}

export function bankRun(g: Game): number {
  const m = loadMeta();
  const r = renownFor(g);
  m.renown += r; m.total += r; m.runs++;
  saveMeta(m);
  return r;
}

export function buyUnlock(id: string): string | null {
  const m = loadMeta();
  const u = UNLOCKS.find((x) => x.id === id);
  if (!u) return 'Unknown.';
  if (m.unlocks.includes(id)) return 'Already yours.';
  if (m.renown < u.cost) return `Needs ${u.cost} renown.`;
  m.renown -= u.cost;
  m.unlocks.push(id);
  saveMeta(m);
  return null;
}

/** Apply bought head starts to a freshly made game. */
export function applyUnlocks(g: Game) {
  const m = loadMeta();
  const has = (id: string) => m.unlocks.includes(id);
  if (has('stores')) { g.res.food += 20; g.res.wood += 20; g.res.stone += 10; }
  if (has('settler')) { const s = arrive(g, newName(g), rollTraits(g), 'woodcutter'); s.mem = []; }
  if (has('blueprint')) { const bps = (Object.keys(BUILD) as BuildKind[]).filter((k) => BUILD[k].blueprint); g.blueprints.push(pick(g, bps)); }
  if (has('veterans')) for (const s of g.settlers) if (s.job === 'militia' || s.job === 'archer') s.xp = Math.max(s.xp, 6);
  if (has('relic')) addRelic(g, pick(g, RELIC_IDS));
  const kc = keepCenter(g);
  const free = (kind: BuildKind, spots: [number, number][]) => {
    const save = { ...g.res };
    g.res.wood += 999; g.res.stone += 999; g.res.gold += 999;
    for (const [dx, dy] of spots) if (!place(g, kind, Math.round(kc.x + dx), Math.round(kc.y + dy))) break;
    g.res = save;
    for (const b of g.blds) if (!b.done && b.kind === kind) { b.done = true; b.progress = BUILD[kind].work; b.hp = b.maxHp; }
  };
  if (has('hut')) free('hut', [[3, -4], [-5, -4], [4, 3], [-6, 2], [5, -2]]);
  if (has('market')) free('market', [[3, 2], [4, 3], [-6, 3], [3, -5]]);
  rebuild(g);
  assignHomes(g);
}
