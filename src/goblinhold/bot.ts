// Dev-only balance harness: plays whole runs headlessly in the page.
// Usage from the console: (await import('/src/goblinhold/bot.ts')).runs(5, true)
import { BUILD, BuildKind, Job, JOBS } from './defs';
import { eventDef, resolveEvent } from './events';
import { canPlace, keepCenter, rebuild } from './map';
import { arrive, assignPost, beginDay, fortify, newName, upgrade, buyOffer, canAfford, newGame, place, price, season, setJob, step, trade, unlocked } from './sim';
import { Game } from './state';

function tryPlaceNear(g: Game, kind: BuildKind, cx: number, cy: number, r = 5): boolean {
  if (!unlocked(g, kind) || !canAfford(g, kind)) return false;
  for (let rad = 0; rad <= r; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (canPlace(g, kind, x, y) && !place(g, kind, x, y)) return true;
  }
  return false;
}

const count = (g: Game, j: Job) => g.settlers.filter((s) => s.job === j).length;
const nb = (g: Game, k: BuildKind) => g.blds.filter((b) => b.kind === k).length;

/** A simple player: houses, feeds and arms the colony, trades surplus, and puts towers toward tonight's entries. */
export function botDay(g: Game) {
  const kc = keepCenter(g);
  const pop = g.settlers.length;
  if (pop > nb(g, 'hut') * 3 + nb(g, 'barracks') * 4) tryPlaceNear(g, 'hut', kc.x - 1 + (nb(g, 'hut') % 2 ? 4 : -5), kc.y - 3 + nb(g, 'hut') * 2, 7);
  if (g.res.food < pop * 4 && nb(g, 'farm') <= count(g, 'farmer') && season(g) !== 'winter') tryPlaceNear(g, 'farm', kc.x - 1, kc.y + 5, 7);
  if (!nb(g, 'market') && g.day >= 3) tryPlaceNear(g, 'market', kc.x + 4, kc.y + 3, 6);
  if (!nb(g, 'healer') && unlocked(g, 'healer')) tryPlaceNear(g, 'healer', kc.x + 5, kc.y - 3, 7);
  if (!nb(g, 'barracks') && unlocked(g, 'barracks') && count(g, 'militia') + count(g, 'archer') >= 3) tryPlaceNear(g, 'barracks', kc.x - 6, kc.y - 3, 7);
  // jobs for newcomers
  for (const s of g.settlers) {
    if (s.job !== 'idle') continue;
    const fighters = count(g, 'militia') + count(g, 'archer') + count(g, 'shieldbearer');
    let want: Job = 'woodcutter';
    if (count(g, 'farmer') < nb(g, 'farm')) want = 'farmer';
    else if (count(g, 'quarrier') < 1) want = 'quarrier';
    else if (fighters < pop / 2.5 && g.res.gold >= 12) want = count(g, 'archer') <= count(g, 'militia') ? 'archer' : 'militia';
    else if (count(g, 'forager') < 1) want = 'forager';
    else if (count(g, 'builder') < 2) want = 'builder';
    else if (nb(g, 'market') && count(g, 'trader') < 1) want = 'trader';
    else if (nb(g, 'healer') && count(g, 'healer') < 1) want = 'healer';
    else if (count(g, 'fisher') < 1) want = 'fisher';
    setJob(g, s, want);
  }
  // winter prep: farmers fish in winter
  for (const s of g.settlers) if (s.job === 'farmer' && season(g) === 'winter') setJob(g, s, 'fisher');
  for (const s of g.settlers) if (s.job === 'fisher' && season(g) !== 'winter' && count(g, 'farmer') < nb(g, 'farm')) setJob(g, s, 'farmer');
  // towers toward tonight's entries
  for (const gr of g.wave.groups) {
    const e = g.entries[gr.entry];
    const tx = kc.x + (e.x - kc.x) * 0.25, ty = kc.y + (e.y - kc.y) * 0.25;
    const near = g.blds.filter((b) => (b.kind === 'tower' || b.kind === 'ballista') && Math.hypot(b.x - tx, b.y - ty) < 4).length;
    if (near < 1 + Math.floor(g.day / 5)) { if (!tryPlaceNear(g, 'ballista', tx, ty, 4)) tryPlaceNear(g, 'tower', tx, ty, 4); }
  }
  // archers to unmanned towers
  const towers = g.blds.filter((b) => b.kind === 'tower' || b.kind === 'ballista');
  for (const a of g.settlers.filter((s) => s.job === 'archer' && !s.post)) {
    const t = towers.find((t) => !g.settlers.some((s) => s.post === t.id));
    if (t) assignPost(g, a, t);
  }
  // trade: sell surplus, buy food before winter
  for (let i = 0; i < 5; i++) {
    if (g.res.wood > 120 && !trade(g, 'wood', 'sell')) continue;
    if (g.res.stone > 80 && !trade(g, 'stone', 'sell')) continue;
    if (g.res.food < pop * 3 && g.res.gold > 40 && !trade(g, 'food', 'buy')) continue;
    break;
  }
  fortify(g);
  for (const b of g.blds) if (b.kind === 'tower' || b.kind === 'ballista' || b.kind === 'hut' || b.kind === 'farm') { if (g.res.gold > 40) upgrade(g, b); }
  if (g.merchant) for (const o of g.merchant) if (o.kind === 'blueprint' || (o.kind === 'relic' && g.res.gold > o.price + 20)) buyOffer(g, o);
}

export function botEvent(g: Game) {
  while (g.event) {
    const ch = eventDef(g.event.id).choices(g, g.event.data);
    const i = ch.findIndex((c) => c.ok !== false);
    resolveEvent(g, Math.max(0, i));
  }
}

export function run(smart: boolean, maxDay = 40) {
  const g = newGame((Math.random() * 2 ** 31) | 0);
  const log: string[] = [];
  let guard = 0;
  while (!g.over && g.day <= maxDay && guard++ < 600000) {
    if (g.phase === 'dawn') {
      log.push(`D${g.day} ${season(g)[0]} pop${g.settlers.length} f${Math.floor(g.res.food)} w${Math.floor(g.res.wood)} s${Math.floor(g.res.stone)} g${Math.floor(g.res.gold)} keep${Math.round(g.blds.find((b) => b.kind === 'keep')?.hp ?? 0)} k${g.night.kills} lost${g.night.lost.length} ${g.wave.kind}`);
      beginDay(g, true);
      botEvent(g);
      if (smart) botDay(g);
    }
    if (g.event) botEvent(g);
    if (smart && g.phase === 'day' && Math.floor(g.phaseT * 30) % 900 === 0) botDay(g);
    step(g, 1 / 30);
  }
  void JOBS; void BUILD; void price;
  return { day: g.day, over: g.over, why: g.report[0], log, relics: g.relics.length, bps: g.blueprints.length };
}

export function runs(n: number, smart: boolean) {
  const res = [];
  let best: string | null = null;
  try { best = localStorage.getItem('goblinhold.best'); } catch { /* ignore */ }
  for (let i = 0; i < n; i++) res.push(run(smart));
  try { if (best === null) localStorage.removeItem('goblinhold.best'); else localStorage.setItem('goblinhold.best', best); } catch { /* ignore */ }
  return { days: res.map((r) => r.day), mean: res.reduce((a, r) => a + r.day, 0) / n, why: res.map((r) => r.why), sample: res[0].log };
}

/** Dev: a built-up settlement with every building, for eyeballing the art. */
export function showcase(g: Game) {
  g.res = { food: 200, wood: 500, stone: 300, gold: 500 };
  g.blueprints = ['barracks', 'healer', 'ballista', 'brazier', 'stonewall', 'trap'];
  const K = g.blds.find((b) => b.kind === 'keep')!;
  const kx = K.x, ky = K.y;
  const P = (k: BuildKind, x: number, y: number) => place(g, k, x, y);
  P('market', kx + 4, ky + 3); P('barracks', kx - 7, ky - 4); P('healer', kx + 7, ky); P('hut', kx + 4, ky - 3); P('ballista', kx - 3, ky - 2);
  P('brazier', kx - 4, ky + 4); P('trap', kx - 7, ky + 2);
  for (let y = ky - 1; y <= ky + 5; y++) P('stonewall', kx - 9, y);
  for (let y = ky - 1; y <= ky + 4; y++) P('wall', kx + 10, y);
  for (const b of g.blds) if (!b.done) { b.done = true; b.progress = 999; b.hp = b.maxHp; }
  rebuild(g);
  for (const j of ['quarrier', 'forager', 'fisher', 'trader', 'healer', 'shieldbearer', 'archer', 'militia'] as Job[]) { const s = arrive(g, newName(g), ['brave'], j); s.x = kx + 1 + Math.random() * 3; s.y = ky + 4; }
  return { kx, ky };
}
