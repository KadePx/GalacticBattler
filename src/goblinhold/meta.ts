// Progress that outlives a run: renown, head starts, deeds, the daily hold and the play streak.
import { BUILD, BuildKind, KEEP_LEVELS, RELIC_IDS, T_ROCK, T_TREE } from './defs';
import { addRelic, arrive, assignHomes, newName, place, rollTraits } from './sim';
import { Game, pick } from './state';
import { keepCenter, rebuild } from './map';

export interface Unlock { id: string; name: string; desc: string; cost: number; }
export const UNLOCKS: Unlock[] = [
  { id: 'stores', name: 'Full larders', desc: 'Start with +20 food, +20 wood and +10 stone.', cost: 15 },
  { id: 'hut', name: 'Second hut', desc: 'Start with a second hut, so nobody sleeps on the floor.', cost: 20 },
  { id: 'blueprint', name: 'Old plans', desc: 'Start with a random blueprint.', cost: 30 },
  { id: 'veterans', name: 'Seasoned guard', desc: 'Your starting militia and archer are ready for promotion.', cost: 30 },
  { id: 'settler', name: 'Another pair of hands', desc: 'Start with a sixth settler.', cost: 40 },
  { id: 'mason', name: "Mason's yard", desc: 'Start with 25 more stone and a quarrier.', cost: 50 },
  { id: 'market', name: 'Trade charter', desc: 'Start with a market already built.', cost: 55 },
  { id: 'tower', name: 'Second watchtower', desc: 'Start with another watchtower on the far side of the keep.', cost: 70 },
  { id: 'relic', name: 'Heirloom', desc: 'Start with a random relic.', cost: 75 },
  { id: 'barracks', name: 'Old garrison', desc: 'Start with a barracks already built.', cost: 100 },
  { id: 'relic2', name: 'Family vault', desc: 'Start with a second random relic.', cost: 160 },
];

/** Twists for the daily hold. Harder ones pay more renown. */
export interface Mod { id: string; name: string; desc: string; renown: number; }
export const MODS: Mod[] = [
  { id: 'bounty', name: 'Bounty season', desc: 'Every goblin slain pays double gold.', renown: 1 },
  { id: 'horde', name: 'The horde', desc: 'Every night brings a quarter more goblins.', renown: 1.5 },
  { id: 'wolves', name: 'Wolf country', desc: 'Wolf riders hunt from the second night, and in numbers.', renown: 1.15 },
  { id: 'lean', name: 'Lean year', desc: 'Start with half the food and wood.', renown: 1.3 },
  { id: 'family', name: 'Big family', desc: 'Two more settlers arrive with you, and only one hut stands ready.', renown: 1 },
  { id: 'coin', name: 'Old coin', desc: 'Start with 50 extra gold in the strongbox.', renown: 1 },
  { id: 'forest', name: 'Old forest', desc: 'The first trees hold double wood.', renown: 1 },
  { id: 'stone', name: 'Stony ground', desc: 'Boulders hold double stone.', renown: 1 },
];
export const modOf = (g: Game | null) => (g?.mod ? MODS.find((m) => m.id === g.mod) : undefined);

export interface Meta {
  renown: number; total: number; unlocks: string[]; runs: number;
  deeds: string[]; kills: number;
  streak: number; lastPlay: string; // date of the last first-night-of-the-day bonus
  daily: Record<string, number>; // best day reached per daily date
  history: { date: string; day: number; kills: number; bosses: number; renown: number; mod?: string; why: string }[]; // last few holds, newest first
}
const KEY = 'goblinhold.meta';

export function loadMeta(): Meta {
  const m0: Meta = { renown: 0, total: 0, unlocks: [], runs: 0, deeds: [], kills: 0, streak: 0, lastPlay: '', daily: {}, history: [] };
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (m && typeof m.renown === 'number') return { ...m0, ...m, total: m.total ?? m.renown };
  } catch { /* ignore */ }
  return m0;
}
export function saveMeta(m: Meta) {
  // only keep the last few weeks of daily records
  const keys = Object.keys(m.daily).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete m.daily[k];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// ---------- dates and the daily hold ----------
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function prevDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}
export function prettyDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Same seed and twist for everyone on the same date. */
export function dailySeed(key: string) {
  let h = 2166136261;
  for (const c of `goblinhold:${key}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h | 0;
}
export function dailyMod(key: string): Mod {
  return MODS[(dailySeed(key) >>> 0) % MODS.length];
}

/** Twists that change the starting state, applied once to a fresh game. */
export function applyMod(g: Game) {
  const m = g.mod;
  if (!m) return;
  if (m === 'lean') { g.res.food = Math.round(g.res.food / 2); g.res.wood = Math.round(g.res.wood / 2); }
  if (m === 'coin') g.res.gold += 50;
  if (m === 'family') for (let i = 0; i < 2; i++) { const s = arrive(g, newName(g), rollTraits(g), i ? 'forager' : 'woodcutter'); s.mem = []; }
  if (m === 'forest' || m === 'stone') {
    const t = m === 'forest' ? T_TREE : T_ROCK;
    for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === t) g.amount[i] *= 2;
  }
  assignHomes(g);
}

/**
 * The first night held on each calendar day pays a little renown, more on a streak.
 * Returns the bonus, or 0 if today's was already paid.
 */
export function dailyWatch(): { bonus: number; streak: number } {
  const m = loadMeta();
  const today = dateKey();
  if (m.lastPlay === today) return { bonus: 0, streak: m.streak };
  m.streak = m.lastPlay === prevDate(today) ? m.streak + 1 : 1;
  m.lastPlay = today;
  const bonus = 2 + Math.min(m.streak - 1, 5);
  m.renown += bonus; m.total += bonus;
  saveMeta(m);
  return { bonus, streak: m.streak };
}
/** The streak still counts if you played today or yesterday. */
export function liveStreak(m = loadMeta()) {
  const t = dateKey();
  return m.lastPlay === t || m.lastPlay === prevDate(t) ? m.streak : 0;
}

// ---------- renown ----------
export function renownParts(g: Game): { label: string; n: number }[] {
  const parts = [
    { label: `${g.day} days held`, n: g.day },
    { label: `${g.stats.bosses} warchief${g.stats.bosses === 1 ? '' : 's'} slain`, n: g.stats.bosses * 5 },
    { label: `${g.stats.kills} goblins slain`, n: Math.floor(g.stats.kills / 25) },
    { label: `${g.charters?.done.length ?? 0} charters`, n: (g.charters?.done.length ?? 0) * 3 },
    { label: 'Flawless assaults', n: g.stats.cleanAssaults ?? 0 },
  ];
  return parts.filter((p) => p.n > 0);
}
export function renownFor(g: Game) {
  const base = renownParts(g).reduce((a, p) => a + p.n, 0);
  return Math.round(base * (modOf(g)?.renown ?? 1));
}

export interface RunResult { earned: number; best: boolean; prevBest: number; dailyBest: boolean; deeds: Deed[] }
export function bankRun(g: Game, prevBest: number): RunResult {
  const deeds = checkDeeds(g);
  const m = loadMeta();
  const r = renownFor(g);
  m.renown += r; m.total += r; m.runs++;
  m.kills += g.stats.kills;
  let dailyBest = false;
  if (g.daily) { dailyBest = g.day > (m.daily[g.daily] ?? 0); if (dailyBest) m.daily[g.daily] = g.day; }
  m.history = [{ date: dateKey(), day: g.day, kills: g.stats.kills, bosses: g.stats.bosses, renown: r, mod: g.mod, why: g.report[0] ?? '' }, ...m.history].slice(0, 10);
  saveMeta(m);
  // kill totals can finish a deed too
  deeds.push(...checkDeeds(g));
  return { earned: r, best: g.day > prevBest, prevBest, dailyBest, deeds };
}

/** The cheapest head start not yet owned, for the "next unlock" bar. */
export function nextUnlock(m = loadMeta()) {
  return UNLOCKS.filter((u) => !m.unlocks.includes(u.id)).sort((a, b) => a.cost - b.cost)[0];
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

// ---------- deeds ----------
export interface Deed { id: string; name: string; desc: string; renown: number; check: (g: Game, m: Meta) => boolean; prog?: (g: Game | null, m: Meta) => string }
const keepLv = (g: Game) => g.blds.find((b) => b.kind === 'keep')?.level ?? 0;
const DAYS = (id: string, name: string, d: number, renown: number): Deed => ({ id, name, desc: `Reach day ${d}.`, renown, check: (g) => g.day >= d });
export const DEEDS: Deed[] = [
  DAYS('day5', 'Foothold', 5, 5),
  DAYS('day10', 'Dug in', 10, 8),
  { id: 'clean', name: 'Not one lost', desc: 'Hold an assault or boss night with nobody lost.', renown: 6, check: (g) => (g.stats.cleanAssaults ?? 0) > 0 },
  { id: 'boss1', name: 'Warchief slayer', desc: 'Slay a warchief.', renown: 8, check: (g) => g.stats.bosses > 0 },
  { id: 'pop12', name: 'Village', desc: 'Have 12 settlers at once.', renown: 8, check: (g) => g.settlers.length >= 12 },
  { id: 'kills100', name: 'Hundred-slayer', desc: 'Slay 100 goblins in one run.', renown: 10, check: (g) => g.stats.kills >= 100, prog: (g) => g ? `${Math.min(100, g.stats.kills)}/100 this run` : '' },
  { id: 'relics3', name: 'Collector', desc: 'Hold 3 relics in one run.', renown: 10, check: (g) => g.relics.length >= 3 },
  { id: 'fortress', name: 'Stone and banner', desc: `Raise the keep into a ${KEEP_LEVELS[2]?.name.toLowerCase() ?? 'fortress'}.`, renown: 12, check: (g) => keepLv(g) >= 2 },
  { id: 'charters10', name: 'Chartered', desc: 'Fulfil 10 charters in one run.', renown: 12, check: (g) => (g.charters?.done.length ?? 0) >= 10, prog: (g) => g ? `${Math.min(10, g.charters?.done.length ?? 0)}/10 this run` : '' },
  DAYS('day21', 'A whole year', 21, 15),
  { id: 'pop18', name: 'Township', desc: 'Have 18 settlers at once.', renown: 15, check: (g) => g.settlers.length >= 18 },
  { id: 'boss3', name: 'Bane of warbands', desc: 'Slay 3 warchiefs in one run.', renown: 20, check: (g) => g.stats.bosses >= 3 },
  DAYS('day30', 'Old walls', 30, 20),
  DAYS('day41', 'Two winters', 41, 30),
  { id: 'daily5', name: 'Answered the call', desc: 'Reach day 5 in a daily hold.', renown: 6, check: (g) => !!g.daily && g.day >= 5 },
  { id: 'daily15', name: 'Daily champion', desc: 'Reach day 15 in a daily hold.', renown: 15, check: (g) => !!g.daily && g.day >= 15 },
  { id: 'streak3', name: 'Regular', desc: 'Hold a night 3 days in a row.', renown: 8, check: (_g, m) => m.streak >= 3, prog: (_g, m) => `${Math.min(3, liveStreak(m))}/3 days` },
  { id: 'streak7', name: 'Devoted', desc: 'Hold a night 7 days in a row.', renown: 20, check: (_g, m) => m.streak >= 7, prog: (_g, m) => `${Math.min(7, liveStreak(m))}/7 days` },
  { id: 'kills1000', name: 'Goblin bane', desc: 'Slay 1000 goblins across all runs.', renown: 25, check: (g, m) => m.kills + (g.over ? 0 : g.stats.kills) >= 1000, prog: (g, m) => `${Math.min(1000, m.kills + (g && !g.over ? g.stats.kills : 0))}/1000` },
];

/**
 * Award any deeds this run has just earned. Renown is paid at once.
 */
export function checkDeeds(g: Game): Deed[] {
  const m = loadMeta();
  const got: Deed[] = [];
  for (const d of DEEDS) {
    if (m.deeds.includes(d.id) || !d.check(g, m)) continue;
    m.deeds.push(d.id);
    m.renown += d.renown; m.total += d.renown;
    got.push(d);
  }
  if (got.length) saveMeta(m);
  return got;
}

/** Apply bought head starts to a freshly made game. */
export function applyUnlocks(g: Game) {
  const m = loadMeta();
  const has = (id: string) => m.unlocks.includes(id);
  if (has('stores')) { g.res.food += 20; g.res.wood += 20; g.res.stone += 10; }
  if (has('settler')) { const s = arrive(g, newName(g), rollTraits(g), 'woodcutter'); s.mem = []; }
  if (has('mason')) { g.res.stone += 25; const s = arrive(g, newName(g), rollTraits(g), 'quarrier'); s.mem = []; }
  if (has('blueprint')) { const bps = (Object.keys(BUILD) as BuildKind[]).filter((k) => BUILD[k].blueprint); g.blueprints.push(pick(g, bps)); }
  if (has('veterans')) for (const s of g.settlers) if (s.job === 'militia' || s.job === 'archer') s.xp = Math.max(s.xp, 6);
  if (has('relic')) addRelic(g, pick(g, RELIC_IDS));
  if (has('relic2')) { const left = RELIC_IDS.filter((r) => !g.relics.includes(r)); if (left.length) addRelic(g, pick(g, left)); }
  const kc = keepCenter(g);
  const free = (kind: BuildKind, spots: [number, number][]) => {
    const save = { ...g.res };
    g.res.wood += 999; g.res.stone += 999; g.res.gold += 999;
    const bp = g.blueprints;
    g.blueprints = [...bp, kind];
    for (const [dx, dy] of spots) if (!place(g, kind, Math.round(kc.x + dx), Math.round(kc.y + dy))) break; // null means placed
    g.blueprints = bp;
    g.res = save;
    for (const b of g.blds) if (!b.done && b.kind === kind) { b.done = true; b.progress = BUILD[kind].work; b.hp = b.maxHp; }
  };
  // "Big family" settles in with just the one hut
  if (has('hut') && g.mod !== 'family') free('hut', [[3, -4], [-5, -4], [4, 3], [-6, 2], [5, -2]]);
  if (has('market')) free('market', [[3, 2], [4, 3], [-6, 3], [3, -5]]);
  if (has('tower')) free('tower', [[4, -1], [5, 1], [3, -3], [-6, -2]]);
  if (has('barracks')) free('barracks', [[-6, -4], [4, -5], [-7, 2], [5, 3]]);
  rebuild(g);
  assignHomes(g);
}
