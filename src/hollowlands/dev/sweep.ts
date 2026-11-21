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
  const w = createWorld({ seed: s * 7 + 1 });
  console.log(`world ${s}: starts with ${w.colonies.length} colonies of ${w.colonies.map((c) => c.pawns.length).join(', ')}`);
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
      // visitors: on the map, few at a time, and never staying on long past their leaving day
      for (const v of c.vis?.l ?? []) {
        if (v.x < 0 || v.y < 0 || v.x >= c.w || v.y >= c.h) flag('visitor off the map');
        if (c.tick > v.dep + TICKS_PER_DAY * 4) flag(`visitor ${v.k} overstayed`);
        if (v.g !== v.id && !c.vis!.l.some((x) => x.id === v.g)) flag('visitor party without a leader');
      }
      if ((c.vis?.l.length ?? 0) > 8) flag('too many visitors');
      // the land's events: their marks on the map stay in bounds and clear up, and nothing outstays its end
      const n = c.nat;
      if (n) {
        const N = c.w * c.h;
        const D = TICKS_PER_DAY;
        if (n.fire.length > 280) flag('fire too big');
        for (let j = 0; j < n.fire.length; j += 2) if (n.fire[j] < 0 || n.fire[j] >= N) flag('fire off the map');
        if (n.fire.length && n.wf && c.tick > n.wf.t0 + D * 6) flag('fire burning for days');
        if (n.ash.length > 5000) flag('ash piling up');
        if (n.fl && c.tick > n.fl.t1 + 1) flag('flood never went down');
        if (n.cr && c.tick > n.cr.t + D) flag('cracks never cleared');
        if (n.rub.length && !n.cr) flag('rubble left after the cracks healed');
        if (n.loc && c.tick > n.loc.t1 + D * 2) flag('locusts never left');
        if (n.dr && c.tick > n.dr.t1 + 40) flag('dragon never left');
        if (n.sky && c.tick > n.sky.t1 + D) flag('night sky stuck');
        if (n.cra && c.tick > n.cra.t1 + D) flag('crater never cleared');
        if (n.haunt && c.tick > n.haunt.t1 + D) flag('haunting never ended');
        if (n.curse && (c.tick > n.curse.t1 + D || !ids.has(n.curse.a))) flag('curse stuck');
        if (n.feud && c.tick > n.feud.t1 + D) flag('feud never ended');
        if (n.lost && (c.tick > n.lost.t1 + 1 || !ids.has(n.lost.a))) flag('lost child never came home');
        if (n.el && c.tick > n.el.t1 + 1) flag('elopement stuck');
        if (n.duel && c.tick > n.duel.t + 20) flag('duel never fought');
        if (n.nw && (!ids.has(n.nw.a) || !ids.has(n.nw.b))) flag('noble match with someone gone');
        for (const k of Object.keys(n)) if ((n as unknown as Record<string, unknown>)[k] === undefined) flag(`nature field ${k} left undefined`);
      }
      for (const f of c.foes) if (!Number.isFinite(f.hp) || f.x < 0 || f.y < 0 || f.x >= c.w || f.y >= c.h) flag('foe off the map');
    }
  }
  console.log(`world ${s}: ${w.colonies.length} colonies, ${w.colonies.reduce((a, c) => a + c.pawns.length, 0)} people after ${years} years`);
}
if (!seen.size) console.log('nothing wrong found');
else { for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`); process.exit(1); }
