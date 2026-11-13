// Sanity sweep: run whole worlds for years and check, every game day, that nothing has gone
// quietly wrong (bad numbers, people stuck, dangling references, words missing for events).
//   npm run hl:sweep -- [years] [worlds]

import { TICKS_PER_DAY } from '../config';
import { TH } from '../sim/data/thoughts';
import { TRAITS } from '../sim/data/traits';
import { createWorld, stepWorld } from '../sim/world';
import { evText } from '../text';
import { bioText, pretty } from '../view/words';
import { RES } from '../sim/types';

declare const process: { argv: string[]; exit(code: number): never };
const years = Number(process.argv[2]) || 6;
const worlds = Number(process.argv[3]) || 3;
const seen = new Map<string, number>();
const flag = (k: string): void => { seen.set(k, (seen.get(k) ?? 0) + 1); };

for (let s = 1; s <= worlds; s++) {
  const w = createWorld({ seed: s * 7 + 1, colonies: 3 });
  const stuck = new Map<string, number>();
  for (let d = 0; d < years * 60; d++) {
    for (let k = 0; k < TICKS_PER_DAY; k++) stepWorld(w);
    for (const c of w.colonies) {
      const ids = new Set(c.pawns.map((p) => p.id));
      const known = new Set([...ids, ...c.dead.map((x) => x.id)]);
      for (const k of RES) { const v = c.stock[k]; if (!Number.isFinite(v)) flag(`stock ${k} not a number`); else if (v < -0.01) flag(`stock ${k} negative`); }
      if (c.alarm && c.tick - c.alarm > 400) flag('alarm stuck');
      if (c.gath && c.tick > c.gath.t1 + 5) flag('gathering stuck');
      if (c.trials.length > 6) flag('trials piling up');
      if (c.inq.length > 30) flag('inputs piling up');

      if (c.plot && !ids.has(c.plot.lead)) flag('plot leader gone');
      for (const p of c.pawns) {
        for (const [n, v] of [['food', p.food], ['rest', p.rest], ['joy', p.joy], ['soc', p.soc], ['mood', p.mood], ['hp', p.hp], ['coin', p.coin]] as const) {
          if (!Number.isFinite(v)) flag(`${n} not a number`);
          else if (n !== 'hp' && n !== 'coin' && (v < -0.01 || v > 100.01)) flag(`${n} out of range`);
        }
        if (p.coin < -0.5) flag('coin negative');
        if (p.gone) flag('gone colonist still listed');
        if (p.act.t1 < c.tick - 2) { const key = c.id + ':' + p.id; stuck.set(key, (stuck.get(key) ?? 0) + 1); if (stuck.get(key)! > 2) flag(`stuck in ${p.act.k}`); }
        if (p.sp) { const o = c.pawns.find((x) => x.id === p.sp); if (!o) flag('partner not here'); else if (o.sp !== p.id) flag('partner not mutual'); }
        if (p.home && !c.blds.some((b) => b.id === p.home && b.beds.includes(p.id))) flag('home without bed');
        if (p.brk && p.brk.k !== 'seized' && c.tick - p.brk.x > 20) flag(`break ${p.brk.k} never ended`);
        if (p.brk?.k === 'seized' && !c.foes.some((f) => f.held === p.id)) flag('seized with no captor');
        if (p.ask && c.tick - p.ask.x > 20) flag('question never lapsed');
        for (const t of p.traits) if (!TRAITS[t]) flag(`unknown trait ${t}`);
        for (const t of p.th) { if (!TH[t.k]) flag(`unknown thought ${t.k}`); if (t.o && !known.has(t.o)) flag('thought about nobody'); }
        for (const s2 of p.sit) if (!TH[s2[0]]) flag(`unknown thought ${s2[0]}`);
        for (const key in p.rel) for (const m of p.rel[key].m) if (!TH[m[0]]) flag(`unknown memory ${m[0]}`);
        for (const b of p.bio) { const txt = bioText(c, b); if (txt === pretty(b.k) + '.' || txt.startsWith(pretty(b.k) + ' (')) flag(`no words for life event ${b.k}`); }
        for (const sk of p.sk) if (!Number.isFinite(sk)) flag('skill not a number');
      }
      for (const e of c.log) if (evText(c, e).startsWith(e.k + ':')) flag(`no words for event ${e.k}`);
      for (const b of c.blds) { if (!Number.isFinite(b.q) || !Number.isFinite(b.prog)) flag('building number bad'); for (const id of b.beds) if (id && !ids.has(id)) flag('bed owned by nobody'); }
      for (const f of c.foes) if (!Number.isFinite(f.hp) || f.x < 0 || f.y < 0 || f.x >= c.w || f.y >= c.h) flag('foe off the map');
    }
  }
  console.log(`world ${s}: ${w.colonies.length} colonies, ${w.colonies.reduce((a, c) => a + c.pawns.length, 0)} people after ${years} years`);
}
if (!seen.size) console.log('nothing wrong found');
else { for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`); process.exit(1); }
