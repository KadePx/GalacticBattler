// Milestone 8: the world page. The whole world at a glance: its Ages, the great peoples of the
// day, wonders, faiths, memorials to the fallen, and what happened lately.

import { line, yearOf } from '../chronicle';
import { WONDERS, wonderHolder } from '../sim/wonders';
import { AGES } from '../sim/techs';
import { TICKS_PER_YEAR, type Civ } from '../sim/types';
import { civColor } from './map';
import { banner, esc, fmt, type Ctx } from './panels';
import { CLIMATES, climateNow } from '../sim/realm';
import { root, type Concept } from '../sim/names';

const WORLD_NEWS = new Set(['age', 'civ_fall', 'found_civ', 'wonder', 'faith_found', 'schism', 'collapse', 'revival', 'war', 'plague_start', 'eruption', 'tsunami', 'climate', 'climate_end', 'era', 'tribute']);

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
  // Every Age up to now, with its start year where the chronicle still remembers it.
  const began = new Map<number, number>([[0, 0]]);
  for (const e of w.log) if (e.k === 'age' && e.n !== undefined) began.set(e.n, yearOf(e.t));
  const yr = (a: number) => (began.has(a) ? `${began.get(a)} AW` : '?');
  const ageRows = AGES.slice(0, w.age + 1).map((name, a) => `<div class="nrow"><div><b>${name} Age</b></div><span class="legend">${yr(a)} – ${a === w.age ? 'now' : yr(a + 1)}</span></div>`).reverse().join('');

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

  // The climate now and before.
  const cl = climateNow(w);
  const curCl = cl ? w.climates[w.climates.length - 1] : null;
  const climate = `<div class="nrow"><div><b>${curCl ? esc(curCl.name) : 'Ordinary seasons'}</b><div class="legend">${curCl ? `${CLIMATES[cl as keyof typeof CLIMATES].text} Since ${yearOf(curCl.start)} AW, until about ${yearOf(curCl.end)} AW.` : 'No long swing of weather grips the world.'}</div></div></div>`
    + w.climates.filter((x) => x !== curCl).reverse().slice(0, 6).map((x) => `<div class="nrow"><div>${esc(x.name)}</div><span class="legend">${yearOf(x.start)}–${yearOf(x.end)} AW</span></div>`).join('');

  // Golden ages, now and remembered; dark ages now.
  const goldNow = alive.filter((c) => c.era === 'golden');
  const darkNow = alive.filter((c) => c.era === 'dark');
  const pastGold = w.eras.filter((e) => e.k === 'golden' && e.end >= 0).sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 6);
  const eras = [
    ...goldNow.map((c) => `<div class="nrow"><div><span class="gold-t">☀</span> ${esc(c.eraName)}<div class="legend">${civLink(c)}, since ${yearOf(c.eraSince)} AW</div></div><span class="legend r">now</span></div>`),
    ...darkNow.map((c) => `<div class="nrow"><div><span class="dark-t">☾</span> ${esc(c.eraName)}<div class="legend">${civLink(c)}, since ${yearOf(c.eraSince)} AW</div></div><span class="legend r">now</span></div>`),
    ...pastGold.map((e) => `<div class="nrow"><div><span class="gold-t">☀</span> ${esc(e.name)}<div class="legend">${civLink(w.civs[e.civ])}</div></div><span class="legend r">${yearOf(e.start)}–${yearOf(e.end)} AW</span></div>`),
  ].join('');

  // Overlords and their tributaries.
  const lords = new Map<number, Civ[]>();
  for (const c of alive) if (c.lord >= 0) (lords.get(c.lord) ?? lords.set(c.lord, []).get(c.lord)!).push(c);
  const tribute = [...lords].sort((a, b) => b[1].length - a[1].length).map(([l, vs]) => `<div class="nrow"><div>${banner(w.civs[l], 16)} ${civLink(w.civs[l])}</div><span class="legend r">tribute from ${vs.map(civLink).join(', ')}</span></div>`).join('');

  // Tongues: peoples who share a way of speaking (daughters keep their parents' words).
  const tongues = new Map<number, Civ[]>();
  for (const c of alive) (tongues.get(c.phon) ?? tongues.set(c.phon, []).get(c.phon)!).push(c);
  const SAMPLE: Concept[] = ['water', 'high', 'ford', 'sun', 'new', 'stone'];
  const tongueRows = [...tongues].filter(([, cs]) => cs.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([phon, cs]) => {
    const eldest = w.civs.filter((c) => c.phon === phon).sort((a, b) => a.born - b.born || a.id - b.id)[0];
    const words = SAMPLE.map((k) => `<span class="wd">${esc(root(phon, k))}</span> ${k}`).join(' · ');
    return `<div class="nrow"><div><b>The ${esc(eldest.name)} tongue</b><div class="legend">${words}</div><div class="legend">Spoken by ${cs.slice(0, 6).map(civLink).join(', ')}${cs.length > 6 ? ` and ${cs.length - 6} more` : ''}</div></div></div>`;
  }).join('');

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
    <h3>Climate <span class="legend">long swings of weather that change harvests everywhere</span></h3>${climate}
    ${eras ? `<h3>Golden and dark ages</h3>${eras}` : ''}
    ${tribute ? `<h3>Overlords <span class="legend">peoples paid tribute by others they beat</span></h3>${tribute}` : ''}
    <h3>Wonders of the world</h3>
    ${wonders || '<p class="legend">No wonder stands yet.</p>'}
    ${building.length ? `<p class="legend">Being built: ${building.join(', ')}.</p>` : ''}
    <h3>Faiths</h3>
    ${faiths || '<p class="legend">No faith has been founded yet.</p>'}
    ${goneFaiths ? `<p class="legend">${goneFaiths} older ${goneFaiths === 1 ? 'faith is' : 'faiths are'} no longer kept.</p>` : ''}
    ${tongueRows ? `<h3>Tongues <span class="legend">peoples who broke away keep their parents' words; most place names mean something in them</span></h3>${tongueRows}` : ''}
    <h3>Ages</h3>${ageRows}
    <h3>Lately</h3>${news.join('') || '<p class="legend">Quiet times.</p>'}
    <h3>Memorials</h3>
    ${memorials || '<p class="legend">No people has fallen yet.</p>'}`;
}
