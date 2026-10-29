// Battle report: who did the damage, who healed, what shields stopped, and what went down
// first. Built from the battle's event log after the fight; drawing only, no rules.

import type { BattleResult, BUnit } from '../sim/battle';
import { SHIPS } from '../sim/ships';

export interface SideReport {
  damage: number; // HP actually removed from the other side
  healed: number;
  blocked: number; // enemy hits this side's shields stopped
  dodged: number; // enemy hits that missed this side
  lost: number; // ships this side lost
  top: { name: string; dmg: number }[]; // best damage dealers, most first
  firstLoss?: { name: string; tick: number; by: string };
}

export interface BattleReport {
  sides: [SideReport, SideReport];
  headline: string; // one line on why the fight went the way it did, from your side
}

const nameOf = (u: BUnit | undefined) => (u ? SHIPS[u.def]?.name ?? u.def : 'Unknown');

export function buildReport(res: BattleResult): BattleReport {
  const units = new Map<number, BUnit>(res.units.map((u) => [u.uid, u]));
  const hp = new Map<number, number>(res.units.map((u) => [u.uid, u.hp]));
  const dealt = new Map<number, number>(); // by unit uid
  const burnDealt = [0, 0]; // burn damage credited to the side that set the fire
  const lastHitBy = new Map<number, string>();
  const blank = (): SideReport => ({ damage: 0, healed: 0, blocked: 0, dodged: 0, lost: 0, top: [] });
  const sides: [SideReport, SideReport] = [blank(), blank()];

  for (const e of res.events) {
    switch (e.k) {
      case 'spawn':
        units.set(e.unit.uid, e.unit);
        hp.set(e.unit.uid, e.unit.hp);
        break;
      case 'shot': {
        const d = units.get(e.d);
        if (!d) break;
        if (e.miss) { sides[d.side].dodged++; break; }
        if (e.blocked) { sides[d.side].blocked++; break; }
        const loss = Math.max(0, (hp.get(e.d) ?? 0) - e.hp);
        hp.set(e.d, e.hp);
        sides[1 - d.side].damage += loss;
        if (e.burn) {
          burnDealt[1 - d.side] += loss;
          lastHitBy.set(e.d, 'burning');
        } else {
          dealt.set(e.s, (dealt.get(e.s) ?? 0) + loss);
          lastHitBy.set(e.d, nameOf(units.get(e.s)));
        }
        break;
      }
      case 'heal': {
        const d = units.get(e.d);
        const gain = Math.max(0, e.hp - (hp.get(e.d) ?? 0));
        hp.set(e.d, e.hp);
        if (d) sides[d.side].healed += gain;
        break;
      }
      case 'buff':
        hp.set(e.u, e.hp);
        break;
      case 'revive':
        hp.set(e.u, e.hp);
        break;
      case 'die': {
        const u = units.get(e.u);
        if (!u) break;
        const s = sides[u.side];
        s.lost++;
        if (!s.firstLoss) s.firstLoss = { name: nameOf(u), tick: e.t, by: lastHitBy.get(e.u) ?? 'unknown' };
        break;
      }
    }
  }

  // Top damage per side, by ship name (copies and their fighters are listed separately by name).
  for (const side of [0, 1] as const) {
    const byName = new Map<string, number>();
    for (const [uid, dmg] of dealt) {
      const u = units.get(uid);
      if (u?.side === side && dmg > 0) byName.set(nameOf(u), (byName.get(nameOf(u)) ?? 0) + dmg);
    }
    if (burnDealt[side] > 0) byName.set('Burning', burnDealt[side]);
    sides[side].top = [...byName.entries()].map(([name, dmg]) => ({ name, dmg })).sort((a, b) => b.dmg - a.dmg).slice(0, 3);
  }

  return { sides, headline: headline(sides, res.winner) };
}

function headline([me, them]: [SideReport, SideReport], winner: 0 | 1 | -1): string {
  const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
  if (winner === 0) {
    const star = me.top[0];
    return star ? `${star.name} led with ${star.dmg} damage.` : 'Clean win.';
  }
  if (winner === -1) return `Even fight: you dealt ${me.damage}, took ${them.damage}.`;
  // A loss: find the clearest reason.
  const ace = them.top[0];
  if (ace && pct(ace.dmg, them.damage) >= 45) return `Their ${ace.name} did ${pct(ace.dmg, them.damage)}% of their damage.`;
  if (them.healed >= Math.max(10, me.damage * 0.3)) return `They healed ${them.healed}, outlasting your ${me.damage} damage.`;
  if (them.blocked >= 3 && them.blocked > me.blocked) return `Their shields blocked ${them.blocked} of your hits.`;
  if (me.firstLoss && me.firstLoss.tick <= 12) return `Your ${me.firstLoss.name} fell early (to ${me.firstLoss.by}).`;
  return `You dealt ${me.damage} damage but took ${them.damage}.`;
}
