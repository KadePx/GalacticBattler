// The map key: what the current map view shows and what its colours mean.
// Colours here mirror view/map.ts (STANCE_COLOR, the stability/fertility formulas, route colours).

import { BIOMES } from '../sim/worldgen';
import type { Mode } from './map';

const sw = (color: string, label: string) => `<span class="lg"><i style="background:${color}"></i>${label}</span>`;
const line = (color: string, label: string) => `<span class="lg"><i class="ln" style="background:${color}"></i>${label}</span>`;
const bar = (stops: string[], lo: string, hi: string) =>
  `<div class="lbar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="lends"><span>${lo}</span><span>${hi}</span></div>`;

const stab = (s: number) => `hsl(${Math.round(s * 1.2)},75%,48%)`;
const fert = (f: number) => `hsl(${60 + f * 14},80%,${22 + f * 6}%)`;

const SYMBOLS = `<div class="lsym">
  <span class="lg"><svg viewBox="0 0 16 16"><path d="M8 1.5l1.9 4.2 4.6.4-3.5 3 1.1 4.5L8 11.2 3.9 13.6 5 9.1 1.5 6.1l4.6-.4z" fill="#fff" stroke="#0a0d14"/></svg>Capital</span>
  <span class="lg"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="#f6f8fc" stroke="#7c8cff" stroke-width="1.6"/></svg>Town</span>
  <span class="lg"><svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="#ff6a4d" stroke-width="2"/></svg>Battle</span>
  <span class="lg"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="#e5483a" stroke-width="2"/></svg>Siege</span>
  <span class="lg"><svg viewBox="0 0 16 16"><path d="M8 3l5 9H3z" fill="#f5c451" stroke="#0a0d14"/></svg>Great work</span>
  <span class="lg"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="#9aa4b8" stroke-width="1.6"/></svg>Ruin</span>
</div>`;

export function legendHtml(mode: Mode, selName: string | null): { title: string; body: string } {
  switch (mode) {
    case 'political':
      return { title: 'Peoples', body: `<p>Who holds the land. Each people has its own colour, and the lines are borders. Click land to select its people and see where they reach.</p>` };
    case 'diplomacy':
      return selName
        ? { title: 'Diplomacy', body: `<p>How everyone stands with the <b>${selName}</b>.</p><div class="lrow">${sw('rgba(124,140,255,0.8)', selName)}${sw('rgba(110,200,110,0.8)', 'Ally')}${sw('rgba(90,190,200,0.8)', 'Pact')}${sw('rgba(170,170,190,0.55)', 'At peace')}${sw('rgba(225,70,55,0.85)', 'At war')}${sw('rgba(30,32,44,0.9)', 'Never met')}</div>` }
        : { title: 'Diplomacy', body: `<p>Who is fighting right now. Select a people to see their allies, pacts and enemies.</p><div class="lrow">${sw('rgba(225,70,55,0.85)', 'At war')}${sw('rgba(170,170,190,0.55)', 'At peace')}</div>` };
    case 'trade':
      return { title: 'Trade', body: `<p>Trade routes between towns. Trade brings coin and luxuries to both ends.</p><div class="lrow">${line('#f2c766', 'Land route')}${line('#8fd0ff', 'Sea route')}</div>` };
    case 'population':
      return { title: 'Population', body: `<p>Where people live. Each town glows, and bigger, brighter glows mean more people.</p>${bar(['rgba(120,20,40,0.6)', 'rgb(230,90,40)', 'rgb(255,190,90)'], 'Few', 'Many')}` };
    case 'stability':
      return { title: 'Stability', body: `<p>How content each town is, shown over the land it works. Unhappy towns may revolt or break away. Famine, plague, war and recent conquest lower it. Temples, walls and good rulers raise it.</p>${bar([stab(0), stab(25), stab(50), stab(75), stab(100)], 'Restless', 'Content')}` };
    case 'fertility':
      return { title: 'Fertility', body: `<p>How much food each tile gives. Rivers, grassland and some resources are best. Towns grow fastest on rich land.</p><div class="lrow">${sw('rgba(90,40,30,0.8)', 'None')}</div>${bar([fert(1), fert(3), fert(5), fert(7)], 'Poor', 'Rich')}` };
    case 'terrain':
      return { title: 'Terrain', body: `<p>The land itself, with no overlay.</p><div class="lrow">${BIOMES.filter((b) => b.n !== 'Lake').map((b) => sw(b.c, b.n)).join('')}</div>` };
  }
}

export function legendFull(mode: Mode, selName: string | null): string {
  const { title, body } = legendHtml(mode, selName);
  return `<button class="lhead" data-lg="toggle"><b>${title}</b><span class="legend">Key</span><span class="lcar">▾</span></button><div class="lbody">${body}<div class="lsub">Symbols</div>${SYMBOLS}</div>`;
}
