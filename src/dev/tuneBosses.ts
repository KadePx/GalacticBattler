// Dev tool: find Gauntlet boss stats that hit a target player win rate per sector.
//   npx esbuild src/dev/tuneBosses.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/tune.mjs && node node_modules/.cache/tune.mjs
// Prints a BOSS_TUNING table to paste into src/game/gauntlet.ts.

import { botSnapshot } from '../game/bot';
import { BOSS_ROUND, BOSS_TUNING, bossSnapshot } from '../game/gauntlet';
import { simulate } from '../sim/battle';
import { BOSS_RELICS } from '../sim/relics';
import { hashStr } from '../sim/rng';

const N = 300;
const TARGET = [60, 52, 45]; // player win % against the sector 1 / 2 / 3 boss
const TICKS = 32; // aim for boss fights about this long
const RATIOS = [0.5, 0.8, 1.2, 1.8, 2.7, 4]; // ATK-to-HP scale tried, to set fight length

function winRate(id: string, sector: number, m: number, ratio = 1) {
  const t = BOSS_TUNING[id];
  const k = sector - 1;
  const base = { atk: [...t.atk], hp: [...t.hp], pAtk: t.pAtk && [...t.pAtk], pHp: t.pHp && [...t.pHp] };
  t.hp[k] = Math.round(base.hp[k] * m);
  t.atk[k] = Math.max(1, Math.round(base.atk[k] * m * ratio));
  if (t.pHp && base.pHp) t.pHp[k] = Math.round(base.pHp[k] * m);
  if (t.pAtk && base.pAtk) t.pAtk[k] = Math.max(1, Math.round(base.pAtk[k] * m * ratio));
  const round = BOSS_ROUND(sector);
  let w = 0;
  let ticks = 0;
  for (let i = 0; i < N; i++) {
    const me = botSnapshot(910000 + i * 31 + round, round, undefined, false);
    for (let j = 1; j < sector; j++) me.relics.push(BOSS_RELICS[(i + j) % BOSS_RELICS.length].id);
    const escorts = botSnapshot(hashStr(`t${i}:${round}`), round).fleet.filter((s): s is NonNullable<typeof s> => !!s);
    const r = simulate(me, bossSnapshot(id, sector, round, escorts));
    if (r.winner === 0) w++;
    ticks += r.ticks;
  }
  const out = { win: Math.round((100 * w) / N), ticks: +(ticks / N).toFixed(1), atk: t.atk[k], hp: t.hp[k], pAtk: t.pAtk?.[k], pHp: t.pHp?.[k] };
  // restore
  t.hp = base.hp; t.atk = base.atk;
  if (base.pHp) t.pHp = base.pHp;
  if (base.pAtk) t.pAtk = base.pAtk;
  return out;
}

const result: Record<string, { atk: number[]; hp: number[]; pAtk?: number[]; pHp?: number[] }> = {};
for (const id of Object.keys(BOSS_TUNING)) {
  result[id] = { atk: [], hp: [], ...(BOSS_TUNING[id].pAtk ? { pAtk: [], pHp: [] } : {}) };
  for (const sector of [1, 2, 3]) {
    // For each ATK:HP ratio, binary search the size (m) that hits the target win rate;
    // keep the ratio whose fights are closest to TICKS long.
    let best: ReturnType<typeof winRate> | null = null;
    for (const ratio of RATIOS) {
      let lo = 0.2;
      let hi = 60;
      let here = winRate(id, sector, 1, ratio);
      for (let it = 0; it < 14; it++) {
        const m = Math.sqrt(lo * hi);
        const r = winRate(id, sector, m, ratio);
        if (Math.abs(r.win - TARGET[sector - 1]) < Math.abs(here.win - TARGET[sector - 1])) here = r;
        if (r.win > TARGET[sector - 1]) lo = m;
        else hi = m;
      }
      if (Math.abs(here.win - TARGET[sector - 1]) > 4) continue;
      if (!best || Math.abs(here.ticks - TICKS) < Math.abs(best.ticks - TICKS)) best = here;
    }
    if (!best) { console.log(`${id} S${sector}: no ratio hit the target`); continue; }
    result[id].atk.push(best.atk);
    result[id].hp.push(best.hp);
    if (best.pAtk !== undefined) { result[id].pAtk!.push(best.pAtk); result[id].pHp!.push(best.pHp!); }
    console.log(`${id} S${sector}: win ${best.win}% ticks ${best.ticks} atk ${best.atk} hp ${best.hp}${best.pAtk !== undefined ? ` pylon ${best.pAtk}/${best.pHp}` : ''}`);
  }
}
console.log(JSON.stringify(result));
