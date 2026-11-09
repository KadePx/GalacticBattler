// Milestone 8: the world page. The whole world at a glance: its Ages, the great peoples of the
// day, wonders, faiths, memorials to the fallen, and what happened lately.

import { line, yearOf } from '../chronicle';
import { WONDERS, wonderHolder } from '../sim/wonders';
import { AGES } from '../sim/techs';
import { TICKS_PER_YEAR, type Civ } from '../sim/types';
import { civColor } from './map';
import { banner, esc, fmt, type Ctx } from './panels';

const WORLD_NEWS = new Set(['age', 'civ_fall', 'found_civ', 'wonder', 'faith_found', 'schism', 'collapse', 'revival', 'war', 'plague_start', 'eruption', 'tsunami']);

const civLink = (c: Civ) => `<a href="#" data-civ="${c.id}" style="color:${civColor(c.hue, 70)}">the ${esc(c.name)}</a>`;

export function worldHtml(ctx: Ctx): string {
  const { w } = ctx;
  const year = yearOf(w.tick);
  const pop = new Map<number, number>();
  let total = 0;
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    pop.set(s.civ, (pop.get(s.civ) ?? 0) + s.pop);
    total += s.pop;
  }
  const alive = w.civs.filter((c) => c.died < 0);
  const fallen = w.civs.filter((c) => c.died >= 0);
  const founders = w.civs.filter((c) => c.founder);

  // Ages, from the chronicle (as far back as it is loaded).
  const ages: [number, number][] = [[0, 0]];
  for (const e of w.log) if (e.k === 'age' && e.n !== undefined) ages.push([e.n, yearOf(e.t)]);
  const ageRows = ages.map(([a, y], i) => {
    const to = ages[i + 1]?.[1];
    return `<div class="nrow"><div><b>${AGES[a]} Age</b></div><span class="legend">${y} AW – ${to !== undefined ? `${to} AW` : 'now'}</span></div>`;
  }).join('');

  const largest = alive.slice().sort((a, b) => (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0)).slice(0, 5);
  const oldest = alive.slice().sort((a, b) => a.born - b.born || a.id - b.id)[0];
  const cultured = alive.slice().sort((a, b) => b.culture - a.culture)[0];

  const wonders = w.wonders.map((x, i) => {
    const h = wonderHolder(w, i);
    const s = w.setts[x.s];
    const holder = h >= 0 ? civLink(w.civs[h]) : '<span style="color:var(--red)">lost in ruins</span>';
    return `<div class="nrow click" data-tile="${s.tile}"><div><b>${esc(x.name)}</b>${x.by ? `<span class="legend"> · named by ${esc(x.by)}</span>` : ''}<div class="legend">${WONDERS[x.id].text}</div></div><span class="legend r">${esc(s.name)}, ${holder}<br>${yearOf(x.t)} AW</span></div>`;
  }).join('');
  const building = alive.filter((c) => c.work).map((c) => `${civLink(c)} (${esc(WONDERS[c.work!.id].name)})`);

  const keepers = new Map<number, number>();
  for (const c of alive) if (c.faith >= 0) keepers.set(c.faith, (keepers.get(c.faith) ?? 0) + 1);
  const faiths = w.faiths.filter((f) => f.died < 0).sort((a, b) => (keepers.get(b.id) ?? 0) - (keepers.get(a.id) ?? 0)).map((f) => {
    const holy = w.setts[f.holy];
    return `<div class="nrow"><div><i class="dot" style="background:hsl(${f.hue},65%,58%)"></i><b>${esc(f.name)}</b><div class="legend">from ${f.prophet ? `the words of ${esc(f.prophet)}, ` : ''}${yearOf(f.born)} AW · holy city ${holy ? `<a href="#" data-tile="${holy.tile}">${esc(holy.name)}</a>${holy.died >= 0 ? ' (ruined)' : ''}` : '—'}${f.parent >= 0 ? ` · split from ${esc(w.faiths[f.parent].name)}` : ''}</div></div><span class="legend r">${keepers.get(f.id) ?? 0} ${keepers.get(f.id) === 1 ? 'people' : 'peoples'}</span></div>`;
  }).join('');
  const goneFaiths = w.faiths.filter((f) => f.died >= 0).length;

  // Memorials: the fallen, greatest first.
  const killer = new Map<number, number>();
  for (const e of w.log) if (e.k === 'civ_fall' && e.a !== undefined && e.b !== undefined) killer.set(e.a, e.b);
  const memorials = fallen.slice().sort((a, b) => b.peakPop - a.peakPop).slice(0, 30).map((c) => {
    const heirs = w.civs.filter((x) => x.parent === c.id);
    const by = killer.get(c.id);
    return `<div class="nrow memorial"><div>${banner(c, 18)} <a href="#" data-civ="${c.id}">The ${esc(c.name)}</a>
      <div class="legend">${yearOf(c.born)}–${yearOf(c.died)} AW · ${Math.round((c.died - c.born) / TICKS_PER_YEAR)} years · at their height ${fmt(c.peakPop)} people${c.founder ? ` · founded by ${esc(c.byName || 'a visitor')}` : ''}</div>
      <div class="legend">${by !== undefined ? `Conquered by ${civLink(w.civs[by])}.` : 'They faded away.'}${heirs.length ? ` Remembered by ${heirs.slice(0, 3).map(civLink).join(', ')}${heirs.length > 3 ? ' and others' : ''}.` : ''}</div></div></div>`;
  }).join('');

  const news: string[] = [];
  for (let i = w.log.length - 1; i >= 0 && news.length < 12; i--) {
    const e = w.log[i];
    if (!WORLD_NEWS.has(e.k)) continue;
    if (e.k === 'found_civ' && !(e.a !== undefined && w.civs[e.a].founder)) continue;
    const l = line(w, e, w.logBase + i);
    const tile = e.s !== undefined ? w.setts[e.s]?.tile : undefined;
    news.push(`<div class="line${tile !== undefined ? ' click' : ''}"${tile !== undefined ? ` data-tile="${tile}" data-year="${l.year}"` : ''}><span class="y">${l.year}</span><span>${esc(l.text)}</span></div>`);
  }

  return `<div class="stats">
      <div class="stat"><b>${year}</b><span>years old · ${AGES[w.age]} Age</span></div>
      <div class="stat"><b>${alive.length}</b><span>living peoples</span></div>
      <div class="stat"><b>${fmt(total)}</b><span>souls</span></div>
      <div class="stat"><b>${founders.length}</b><span>founded by visitors</span></div>
      <div class="stat"><b>${w.wonders.length}</b><span>wonders</span></div>
      <div class="stat"><b>${fallen.length}</b><span>fallen peoples</span></div>
    </div>
    <h3>Great peoples of the day</h3>
    ${largest.map((c, i) => `<div class="nrow"><div>${banner(c, 16)} ${civLink(c)}</div><span class="legend">${i === 0 ? 'the largest · ' : ''}${fmt(pop.get(c.id) ?? 0)} people</span></div>`).join('')}
    ${oldest ? `<div class="nrow"><div>${banner(oldest, 16)} ${civLink(oldest)}</div><span class="legend">the oldest · since ${yearOf(oldest.born)} AW</span></div>` : ''}
    ${cultured && cultured.culture > 1 ? `<div class="nrow"><div>${banner(cultured, 16)} ${civLink(cultured)}</div><span class="legend">the most renowned · culture ${Math.round(cultured.culture)}</span></div>` : ''}
    <h3>Wonders of the world</h3>
    ${wonders || '<p class="legend">No wonder stands yet.</p>'}
    ${building.length ? `<p class="legend">Being built: ${building.join(', ')}.</p>` : ''}
    <h3>Faiths</h3>
    ${faiths || '<p class="legend">No faith has been founded yet.</p>'}
    ${goneFaiths ? `<p class="legend">${goneFaiths} older ${goneFaiths === 1 ? 'faith is' : 'faiths are'} no longer kept.</p>` : ''}
    <h3>Ages</h3>${ageRows}
    <h3>Lately</h3>${news.join('') || '<p class="legend">Quiet times.</p>'}
    <h3>Memorials</h3>
    ${memorials || '<p class="legend">No people has fallen yet.</p>'}`;
}
