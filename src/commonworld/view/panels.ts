// Side panels: the peoples list, a civ's page, the chronicle reader, the tech tree and the tile inspector.
// Each returns HTML for the year being shown (live or a past year on the timeline).

import { WORLD_QUIET, line, yearOf, type Line } from '../chronicle';
import { TIER_R } from '../sim/civ';
import { AGES, TECHS, civAge, mods, techCost } from '../sim/techs';
import { opinionParts, relOf } from '../sim/diplo';
import { recount } from '../sim/civ';
import { neighbors } from '../sim/hex';
import { stabParts } from '../sim/step';
import { activeWars } from '../sim/war';
import { eraFx, vassalsOf } from '../sim/realm';
import { strength } from '../sim/war';
import { TICKS_PER_YEAR, TIER_NAMES, type Civ, type World } from '../sim/types';
import { BIOMES, RES_NAMES } from '../sim/worldgen';
import type { History, SettView } from '../history';
import { bannerSpec, bannerSvg } from './banner';
import { civColor } from './map';
import { RULER_TIP, VALUE_TIP } from './traits';
import { WONDERS, wonderCost, wonderHolder } from '../sim/wonders';
import { EDICT_TEXT } from './council';

export interface Ctx {
  w: World;
  hist: History;
  year: number; // the year on screen
  live: boolean;
  setts: SettView[]; // living settlements in that year
  owner: Int16Array; // tile owners in that year
  selCiv: number;
  chron: { major: boolean; scope: 'world' | 'civ'; q: string; limit: number };
  me: number; // this visitor's people, -1
}

/** A value chip that explains itself on hover or tap. */
export const valueChip = (v: keyof typeof VALUE_TIP) => `<span class="chip tip" tabindex="0" data-tip="${esc(VALUE_TIP[v])}">${v}</span>`;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 10000 ? Math.round(n / 1000) + 'k' : Math.round(n).toLocaleString('en-US'));
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

const bannerCache = new Map<number, string>();
export function banner(c: Civ, px: number): string {
  const key = c.id * 1000 + px;
  let s = bannerCache.get(key);
  if (!s) bannerCache.set(key, (s = bannerSvg(bannerSpec(c), px)));
  return s;
}

function aliveAt(c: Civ, year: number): boolean {
  return c.born <= year * TICKS_PER_YEAR + TICKS_PER_YEAR - 1 && (c.died < 0 || c.died > year * TICKS_PER_YEAR);
}

function popOf(ctx: Ctx, civ: number): { pop: number; n: number } {
  let pop = 0;
  let n = 0;
  for (const s of ctx.setts) if (s.civ === civ) { pop += s.pop; n++; }
  return { pop, n };
}

const endTick = (ctx: Ctx) => ctx.year * TICKS_PER_YEAR + TICKS_PER_YEAR - 1;

// ---- Peoples ----

export function peoplesHtml(ctx: Ctx, q: string): string {
  const { w, year } = ctx;
  const alive = w.civs.filter((c) => aliveAt(c, year));
  const stats = new Map(alive.map((c) => [c.id, popOf(ctx, c.id)]));
  alive.sort((a, b) => stats.get(b.id)!.pop - stats.get(a.id)!.pop);
  const ql = q.trim().toLowerCase();
  const rows = alive.filter((c) => !ql || c.name.toLowerCase().includes(ql)).map((c) => {
    const st = stats.get(c.id)!;
    const before = ctx.hist.civPopAt(c.id, year - 25);
    const trend = before > 0 ? (st.pop - before) / before : 0;
    const arrow = Math.abs(trend) < 0.03 ? '' : trend > 0 ? `<span class="up">▲</span>` : `<span class="down">▼</span>`;
    return `<div class="row ${ctx.selCiv === c.id ? 'sel' : ''}" data-civ="${c.id}">${banner(c, 26)}
      <span class="n"><b>${esc(c.name)}</b>${c.founder ? ' <span title="Founded by a player">★</span>' : ''}${ctx.live && w.wars.some((x) => x.end < 0 && (x.atk === c.id || x.def === c.id || x.atkAllies.includes(c.id) || x.defAllies.includes(c.id))) ? ' <span class="down" title="At war">⚔</span>' : ''}${ctx.live ? civTags(w, c) : ''}<small>${c.values.join(' · ')}</small></span>
      <span class="v">${fmt(st.pop)} ${arrow}<br><small>${st.n} ${st.n === 1 ? 'town' : 'towns'}</small></span></div>`;
  });
  const allFallen = w.civs.filter((c) => c.died >= 0 && c.died <= year * TICKS_PER_YEAR);
  const brief = (c: Civ) => c.died - c.born < 5 * TICKS_PER_YEAR && !c.founder;
  const fallen = allFallen.filter((c) => !brief(c) || (ql && c.name.toLowerCase().includes(ql)));
  const briefN = allFallen.length - fallen.length;
  return `<input class="search" id="psearch" placeholder="Search peoples…" value="${esc(q)}">
    ${rows.join('') || '<p class="legend">No one matches.</p>'}
    ${fallen.length ? `<h3>Fallen</h3>${fallen.map((c) => `<div class="row fallen" data-civ="${c.id}">${banner(c, 22)}<span class="n"><b>${esc(c.name)}</b><small>${yearOf(c.born)}–${yearOf(c.died)} AW</small></span></div>`).join('')}${briefN ? `<p class="legend">…and ${briefN} short-lived ${briefN === 1 ? 'breakaway' : 'breakaways'} that lasted under five years. Search by name to find them.</p>` : ''}` : ''}`;
}

/** Small markers for a people's era and tribute ties. */
function civTags(w: World, c: Civ): string {
  let t = '';
  if (c.era === 'golden') t += ' <span class="tag gold-t" title="In a golden age">☀ golden age</span>';
  else if (c.era === 'dark') t += ' <span class="tag dark-t" title="In a dark age">☾ dark age</span>';
  if (c.lord >= 0) t += ` <span class="tag" title="Pays tribute to the ${esc(w.civs[c.lord].name)}">tributary</span>`;
  return t;
}

// ---- Civ page ----

interface RulerRow { name: string; from: number; to: number | null }
function rulers(w: World, civ: number, untilTick: number): RulerRow[] {
  const out: RulerRow[] = [];
  for (const e of w.log) {
    if (e.t > untilTick) break;
    if (e.a !== civ) continue;
    if ((e.k === 'found_civ' || e.k === 'secede') && e.x) out.push({ name: e.x, from: yearOf(e.t), to: null });
    else if (e.k === 'succession' || e.k === 'new_dynasty') {
      const last = out[out.length - 1];
      if (last) { last.name = e.x ?? last.name; last.to = yearOf(e.t); }
      out.push({ name: e.y ?? '?', from: yearOf(e.t), to: null });
    } else if ((e.k === 'crisis' || e.k === 'claim_war') && e.b === civ) {
      // The old realm's ruler died in the crisis; a new one (not named in the event) took over.
      const last = out[out.length - 1];
      if (last && last.to === null) { last.name = e.x ?? last.name; last.to = yearOf(e.t); }
    }
  }
  return out;
}

function chart(ctx: Ctx, civ: number): string {
  const ser = ctx.hist.civs.get(civ);
  if (!ser || ser.pop.length < 2) return '<p class="legend">History will appear here as the years pass.</p>';
  const W = 372;
  const H = 120;
  const n = ser.pop.length;
  const maxP = Math.max(...ser.pop, 1);
  const maxT = Math.max(...ser.tiles, 1);
  const x = (i: number) => (i / (n - 1)) * (W - 8) + 4;
  const yP = (v: number) => H - 14 - (v / maxP) * (H - 26);
  const path = (arr: number[], y: (v: number) => number) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const hue = ctx.w.civs[civ].hue;
  const vi = Math.max(0, Math.min(n - 1, ctx.year - ser.from));
  const area = `${path(ser.pop, yP)} L${x(n - 1)} ${H - 14} L${x(0)} ${H - 14} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${area}" fill="${civColor(hue, 50, 0.18)}"/>
    <path d="${path(ser.pop, yP)}" fill="none" stroke="${civColor(hue, 62)}" stroke-width="2"/>
    <path d="${path(ser.tiles, (v) => H - 14 - (v / maxT) * (H - 26))}" fill="none" stroke="#9aa4b8" stroke-width="1.2" stroke-dasharray="4 3"/>
    <line x1="${x(vi)}" x2="${x(vi)}" y1="4" y2="${H - 14}" stroke="#7c8cff" stroke-width="1.2"/>
    <text x="4" y="${H - 2}" fill="#636c80" font-size="11">${ser.from} AW</text>
    <text x="${W - 4}" y="${H - 2}" fill="#636c80" font-size="11" text-anchor="end">${ser.from + n - 1} AW</text>
    <text x="4" y="12" fill="#636c80" font-size="11">peak ${fmt(maxP)}</text>
  </svg><div class="legend"><i style="background:${civColor(hue, 62)}"></i>people<i style="background:#9aa4b8"></i>land held</div>`;
}

export function civHtml(ctx: Ctx, id: number): string {
  const { w, year } = ctx;
  const c = w.civs[id];
  const st = popOf(ctx, id);
  let tiles = 0;
  for (let i = 0; i < ctx.owner.length; i++) if (ctx.owner[i] === id) tiles++;
  const until = endTick(ctx);
  const alive = aliveAt(c, year);
  const sub = c.parent >= 0
    ? `Broke away from the <a href="#" data-civ="${c.parent}">${esc(w.civs[c.parent].name)}</a> in ${yearOf(c.born)} AW`
    : c.founder ? `Founded ${yearOf(c.born)} AW${c.byName ? ` by ${esc(c.byName)}` : ' by a visitor'}` : `An ancient people, settled ${yearOf(c.born)} AW`;
  const capital = w.setts[c.capital];
  // Techs known by the shown year: everything, minus what was learned later (starting
  // knowledge has no event, so count back from the end).
  let later = 0;
  for (let i = w.log.length - 1; i >= 0 && w.log[i].t > until; i--) {
    const e = w.log[i];
    if (e.a === id && e.k === 'tech') later++;
  }
  const innos = c.techs.slice(0, Math.max(0, c.techs.length - later));

  const rs = rulers(w, id, until);
  const lastR = rs[rs.length - 1];
  if (ctx.live && alive && (!lastR || lastR.to !== null || !lastR.name.startsWith(c.ruler.name))) {
    if (lastR && lastR.to === null) lastR.to = yearOf(c.ruler.since);
    rs.push({ name: c.ruler.name, from: yearOf(c.ruler.since), to: null });
  }
  const rulerRows = rs.slice().reverse().map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.from}–${r.to ?? (alive ? 'now' : '')}</td><td class="r">${(r.to ?? year) - r.from} yrs</td></tr>`).join('');

  const mine = ctx.setts.filter((s) => s.civ === id).sort((a, b) => b.pop - a.pop);
  const settRows = mine.map((s) => {
    const full = w.setts[s.id];
    const isCap = s.id === c.capital && ctx.live;
    const wonder = ctx.live ? w.wonders.find((x) => x.s === s.id) : undefined;
    return `<tr class="click" data-tile="${s.tile}"><td>${isCap ? '★ ' : ''}${esc(full.name)}${full.monument && ctx.live ? ' <span title="' + esc(full.monument) + '">◆</span>' : ''}${wonder ? ' <span title="' + esc(wonder.name) + '" style="color:#ffe08a">✦</span>' : ''}</td>
      <td class="r">${TIER_NAMES[s.tier]}</td><td class="r">${fmt(s.pop)}</td><td class="r"><span style="color:${stabColor(s.stab)}">${s.stab}</span></td><td class="r legend">${yearOf(full.born)}</td></tr>`;
  }).join('');
  const ruins = w.setts.filter((s) => s.civ === id && s.died >= 0 && s.died <= until);

  const notable: string[] = [];
  for (let i = w.log.length - 1; i >= 0 && notable.length < 14; i--) {
    const e = w.log[i];
    if (e.t > until || (e.a !== id && e.b !== id)) continue;
    const l = line(w, e, w.logBase + i);
    if (!l.major) continue;
    notable.push(lineHtml(l, i, e.s !== undefined ? w.setts[e.s]?.tile : undefined, false));
  }
  const contacts = new Set<number>();
  for (const e of w.log) {
    if (e.t > until) break;
    if (e.k === 'contact' || e.k === 'secede') {
      if (e.a === id && e.b !== undefined) contacts.add(e.b);
      if (e.b === id && e.a !== undefined) contacts.add(e.a);
    }
  }

  return `<div class="civhead">${banner(c, 64)}<div><div class="nm">The ${esc(c.name)}</div><div class="sub">${sub}</div>
      ${!alive ? `<div class="sub" style="color:var(--red)">Fell in ${yearOf(c.died)} AW</div>` : ''}</div></div>
    ${c.motto ? `<div class="motto">“${esc(c.motto)}”</div>` : ''}
    <div style="margin-top:8px">${c.values.map((v) => valueChip(v)).join('')}</div>
    <div class="stats">
      <div class="stat"><b>${fmt(st.pop)}</b><span>people</span></div>
      <div class="stat"><b>${st.n}</b><span>towns</span></div>
      <div class="stat"><b>${tiles}</b><span>tiles of land</span></div>
      <div class="stat"><b>${innos.length}</b><span>techs · ${AGES[innos.reduce((a, k) => Math.max(a, TECHS[k].age), 0)]}</span></div>
      <div class="stat"><b>${alive ? year - yearOf(c.born) : yearOf(c.died) - yearOf(c.born)}</b><span>years old</span></div>
      <div class="stat"><b>${rs.length}</b><span>rulers</span></div>
    </div>
    ${chart(ctx, id)}
    ${ctx.live && alive ? `<div class="kv" style="margin-top:10px"><div>Capital</div><div><a href="#" data-tile="${capital?.tile}">${esc(capital?.name ?? '-')}</a></div><div>Ruler</div><div>${esc(c.ruler.name)} of House ${esc(c.ruler.house)}, ${Math.floor((w.tick - c.ruler.born) / 12)} years old, <span class="tipw" tabindex="0" data-tip="${esc(RULER_TIP[c.ruler.trait])}">${c.ruler.trait}</span>${c.ruler.regent ? `<br><span class="legend">a child; ${esc(c.ruler.regent)} rules as regent</span>` : ''}${c.ruler.wed !== undefined && c.ruler.wed >= 0 && w.civs[c.ruler.wed] ? `<br><span class="legend">married into the <a href="#" data-civ="${c.ruler.wed}">${esc(w.civs[c.ruler.wed].name)}</a></span>` : ''}</div><div>This year</div><div>${goalText(c.goal)}</div><div>Army</div><div>${fmt(c.army)} under arms</div><div>Treasury</div><div><span class="tipw" tabindex="0" data-tip="Coin comes from people, markets and trade. It pays the army, is spent each year on building materials for the towns, hires extra soldiers in wartime and buys calm in the most restless towns. Losing a war costs half of it.">${fmt(c.wealth)} coin</span></div>${c.research >= 0 ? `<div>Studying</div><div>${TECHS[c.research].name}</div>` : ''}</div>` : ''}
    ${ctx.live && alive ? spiritHtml(ctx, c) : ''}
    ${greatsHtml(ctx, id)}
    ${warsHtml(ctx, id)}
    ${ctx.live && alive ? relationsHtml(ctx, id) : ''}
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${ctx.me === id && alive ? '<button class="btn gold" data-open="mine">Your council</button>' : ''}<button class="btn" data-chron="${id}">✎ Read their chronicle</button><button class="btn" data-share="${id}">Share</button></div>
    <h3>Notable moments</h3>${notable.join('') || '<p class="legend">Nothing yet.</p>'}
    <h3>Towns</h3>${settRows ? `<table><tr class="th"><th>Name</th><th class="r">Size</th><th class="r">People</th><th class="r">Stability</th><th class="r">Founded</th></tr>${settRows}</table>` : '<p class="legend">None.</p>'}
    ${ruins.length ? `<p class="legend">Ruins: ${ruins.map((s) => `<a href="#" data-tile="${s.tile}">${esc(s.name)}</a>`).join(', ')}</p>` : ''}
    <h3>Rulers</h3><table>${rulerRows}</table>
    <h3>Known peoples</h3><div>${[...contacts].map((k) => `<a href="#" class="chip" data-civ="${k}" style="border-color:${civColor(w.civs[k].hue, 50)}">${esc(w.civs[k].name)}</a>`).join('') || '<span class="legend">They believe they are alone.</span>'}</div>
    <h3>Knowledge <a href="#" data-techs="${id}" style="font-size:12px;font-weight:500;margin-left:6px">See their tech tree</a></h3>${AGES.map((a, age) => {
      const ts = innos.filter((k) => TECHS[k].age === age);
      return ts.length ? `<div class="legend" style="margin-top:4px">${a}</div><div>${ts.map((k) => `<span class="chip">${TECHS[k].name}</span>`).join('')}</div>` : '';
    }).join('') || '<span class="legend">Nothing learned yet.</span>'}`;
}

/** Faith, renown, wonders and the founder's edict (live only). */
function spiritHtml(ctx: Ctx, c: Civ): string {
  const { w } = ctx;
  const f = c.faith >= 0 ? w.faiths[c.faith] : null;
  const held = w.wonders.map((x, i) => [x, i] as const).filter(([, i]) => wonderHolder(w, i) === c.id);
  const ranked = w.civs.filter((x) => x.died < 0).sort((a, b) => b.culture - a.culture);
  const rank = ranked.indexOf(c) + 1;
  const ed = c.edict && c.edictUntil > w.tick ? c.edict : '';
  const rows: string[] = [];
  rows.push(`<div>Faith</div><div>${f ? `<i class="dot" style="background:hsl(${f.hue},65%,58%)"></i>${esc(f.name)}${f.civ === c.id ? ' <span class="legend">(they founded it)</span>' : ''}` : '<span class="legend">none yet</span>'}</div>`);
  rows.push(`<div>Renown</div><div>${Math.round(c.culture)} culture <span class="legend">· ${ord(rank)} of ${ranked.length}</span></div>`);
  if (held.length) rows.push(`<div>Wonders</div><div>${held.map(([x]) => `<span style="color:#ffe08a">✦</span> <a href="#" data-tile="${w.setts[x.s].tile}">${esc(x.name)}</a>`).join('<br>')}</div>`);
  if (c.work) rows.push(`<div>Building</div><div>${esc(WONDERS[c.work.id].name)} at ${esc(w.setts[c.work.s].name)} <span class="legend">· ${Math.min(99, Math.floor((100 * c.work.prog) / wonderCost(c.work.id)))}%</span></div>`);
  if (c.era) {
    const fx = eraFx(c);
    const tip = c.era === 'golden'
      ? `A golden age: research +${Math.round((fx.lore - 1) * 100)}%, culture +${Math.round((fx.culture - 1) * 100)}%, growth +${Math.round((fx.grow - 1) * 100)}%, stability +${fx.stab}. It lasts while their towns stay content.`
      : `A dark age: research ${Math.round((fx.lore - 1) * 100)}%, culture ${Math.round((fx.culture - 1) * 100)}%, growth ${Math.round((fx.grow - 1) * 100)}%, stability ${fx.stab}. It lifts once their towns are calm again.`;
    rows.push(`<div>Era</div><div><span class="tipw ${c.era === 'golden' ? 'gold-t' : 'dark-t'}" tabindex="0" data-tip="${esc(tip)}">${c.era === 'golden' ? '☀' : '☾'} ${esc(c.eraName)}</span> <span class="legend">· since ${yearOf(c.eraSince)} AW</span></div>`);
  }
  if (c.lord >= 0) rows.push(`<div>Tribute</div><div><span class="tipw" tabindex="0" data-tip="Tributaries send an eighth of their treasury to their overlord each year, follow them to war and start no wars of their own. Every town is a little less content (-3). They break free when the overlord looks weak.">Pays tribute to</span> <a href="#" data-civ="${c.lord}">the ${esc(w.civs[c.lord].name)}</a> <span class="legend">· since ${yearOf(c.lordSince)} AW</span></div>`);
  const vs = vassalsOf(w, c.id);
  if (vs.length) rows.push(`<div>Tributaries</div><div>${vs.map((v) => `<a href="#" data-civ="${v.id}">the ${esc(v.name)}</a>`).join(', ')}</div>`);
  if (ed) rows.push(`<div>Edict</div><div>${EDICT_TEXT[ed as keyof typeof EDICT_TEXT][0]} <span class="legend">· ${Math.ceil((c.edictUntil - w.tick) / TICKS_PER_YEAR)} more years</span></div>`);
  return `<div class="kv" style="margin-top:4px">${rows.join('')}</div>`;
}

const GREAT_ICON: Record<string, string> = { general: '⚔', scholar: '✒', builder: '⌂', merchant: '⚖', prophet: '☀' };

function greatsHtml(ctx: Ctx, id: number): string {
  const { w } = ctx;
  const until = endTick(ctx);
  // Great people alive in the shown year, from the log.
  const alive = new Map<string, { kind: string; from: number }>();
  for (const e of w.log) {
    if (e.t > until) break;
    if (e.a !== id) continue;
    if (e.k === 'great_born' && e.x) alive.set(e.x, { kind: e.y ?? '', from: yearOf(e.t) });
    if (e.k === 'great_died' && e.x) alive.delete(e.x);
  }
  if (!alive.size) return '';
  return `<h3>Great people</h3>${[...alive].map(([name, g]) => `<div class="row" style="cursor:default"><span style="width:20px;text-align:center">${GREAT_ICON[g.kind] ?? '•'}</span><span class="n"><b>${esc(name)}</b><small class="nocap">${g.kind}, renowned since ${g.from} AW</small></span></div>`).join('')}`;
}

function warsHtml(ctx: Ctx, id: number): string {
  const { w } = ctx;
  const until = endTick(ctx);
  const wars = w.wars.filter((x) => x.start <= until && (x.atk === id || x.def === id || x.atkAllies.includes(id) || x.defAllies.includes(id))).reverse();
  if (!wars.length) return '';
  const rows = wars.slice(0, 12).map((x) => {
    const onA = x.atk === id || x.atkAllies.includes(id);
    const foe = onA ? x.def : x.atk;
    const ongoing = x.end < 0 || x.end > until;
    const won = x.result === 'victory' || x.result === 'submitted' ? onA : x.result === 'defeat' ? !onA : null;
    const res = ongoing ? '<span class="down">at war</span>' : x.result === 'submitted' ? (onA ? '<span class="up">made tributary</span>' : '<span class="down">submitted</span>') : x.result === 'conquered' ? (w.civs[foe].died >= 0 && w.civs[foe].died <= until ? '<span class="up">conquered them</span>' : '<span class="down">fell</span>') : won === null ? 'stalemate' : won ? '<span class="up">won</span>' : '<span class="down">lost</span>';
    const tile = w.setts[w.civs[foe].capital]?.tile;
    return `<tr class="click" data-tile="${tile}"><td>${esc(x.name)}<br><small class="legend">vs the ${esc(w.civs[foe].name)}</small></td><td class="r">${yearOf(x.start)}–${ongoing ? '' : yearOf(x.end)}</td><td class="r">${res}</td></tr>`;
  });
  return `<h3>Wars</h3><table>${rows.join('')}</table>${wars.length > 12 ? `<p class="legend">…and ${wars.length - 12} older wars.</p>` : ''}`;
}

const STANCE_LABEL: Record<string, string> = { ally: '<span class="up">allies</span>', pact: 'trade pact', peace: 'at peace', war: '<span class="down">at war</span>' };

function relationsHtml(ctx: Ctx, id: number): string {
  const { w } = ctx;
  const c = w.civs[id];
  const rows = c.contacts.map((k) => ({ k, r: relOf(w, id, k) })).filter((x) => x.r && w.civs[x.k].died < 0)
    .sort((a, b) => (a.r!.st === 'war' ? -1 : 0) - (b.r!.st === 'war' ? -1 : 0) || b.r!.op - a.r!.op);
  if (!rows.length) return '';
  const my = strength(c);
  const edges = borderEdges(w, id);
  const nRoutes = new Map<number, number>();
  for (const rt of w.routes) {
    const a = w.setts[rt.a].civ;
    const b = w.setts[rt.b].civ;
    if (a === id) nRoutes.set(b, (nRoutes.get(b) ?? 0) + 1);
    else if (b === id) nRoutes.set(a, (nRoutes.get(a) ?? 0) + 1);
  }
  return `<h3>Neighbours <span class="legend">tap one to see how they feel, and why</span></h3>${rows.map(({ k, r }) => {
    const o = w.civs[k];
    const op = Math.round(r!.op);
    const ratio = my / Math.max(1, strength(o));
    const might = ratio > 1.5 ? 'weaker' : ratio < 0.67 ? 'stronger' : 'evenly matched';
    const parts = opinionParts(c, o, r!, edges.get(k) ?? 0, nRoutes.get(k) ?? 0);
    const target = Math.round(parts.reduce((a, [, v]) => a + v, 0));
    const tie = o.lord === id ? '<small class="legend">their tributary</small>' : c.lord === k ? '<small class="legend">their overlord</small>' : '';
    return `<details class="whyd nb" data-k="op${k}"><summary><span class="nbn"><span class="sw" style="background:${civColor(o.hue, 55)}"></span><a href="#" data-civ="${k}">${esc(o.name)}</a><small class="legend">${might}, ${AGES[civAge(o)]} age</small></span>
      <span class="nbs">${STANCE_LABEL[r!.st]}${tie}</span><span class="nbo ${op >= 0 ? 'up' : 'down'}">${op > 0 ? '+' : ''}${op}</span></summary>
      <div class="whybox">${partsList(parts)}<div class="legend" style="margin-top:4px">How the ${esc(c.name)} feel about the ${esc(o.name)}. It moves a fifth of the way toward ${target > 0 ? '+' : ''}${target} each year.</div></div></details>`;
  }).join('')}`;
}

export const stabColor = (s: number) => `hsl(${Math.round(s * 1.2)},70%,62%)`;

/** A breakdown list: each reason with its amount, biggest first. */
function partsList(parts: [string, number][]): string {
  return parts.filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([why, v]) => `<div class="why"><span>${esc(why)}</span><b class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`).join('');
}

/** A town's stability, with a tap-open list of what pushes it up and down. */
function stabWhy(ctx: Ctx, sid: number): string {
  const { w } = ctx;
  const s = w.setts[sid];
  const c = w.civs[s.civ];
  recount(w);
  const parts = stabParts(w, s, c, activeWars(w, c.id).length > 0);
  const target = Math.max(5, Math.min(95, Math.round(parts.reduce((a, [, v]) => a + v, 0))));
  const dir = target > s.stab + 1 ? `<span class="up">rising toward ${target}</span>` : target < s.stab - 1 ? `<span class="down">falling toward ${target}</span>` : 'steady';
  const mood = s.stab < 20 ? 'close to revolt' : s.stab < 35 ? 'restless' : s.stab < 55 ? 'uneasy' : s.stab < 75 ? 'content' : 'loyal';
  return `<details class="whyd" data-k="stab"><summary><b style="color:${stabColor(s.stab)}">${s.stab}</b> ${mood} · ${dir}</summary><div class="whybox">${partsList(parts)}
    <div class="legend" style="margin-top:4px">Stability drifts a point or two each month toward the total (kept between 5 and 95). Below 20 a town may revolt; far-off towns below 12 may break away.</div></div></details>`;
}

/** Tiles of shared border between a people and each neighbour. */
function borderEdges(w: World, id: number): Map<number, number> {
  const out = new Map<number, number>();
  const nb: number[] = [];
  const own = w.t.owner;
  for (let i = 0; i < own.length; i++) {
    if (own[i] !== id) continue;
    for (const j of neighbors(w.W, w.H, i, nb)) {
      const p = own[j];
      if (p >= 0 && p !== id) out.set(p, (out.get(p) ?? 0) + 1);
    }
  }
  return out;
}

const BUILD_TIP: Record<string, string> = {
  fields: 'Fields: +12% food from the land each',
  granary: 'Granaries: two more months of stores each',
  walls: 'Walls: much harder to take, and +1.5 stability each',
  temple: 'Temples: +3 stability each (+5 for the devout)',
  market: 'Markets: +30% coin and richer trade',
  workshop: 'Workshops: +20% materials for building',
  monument: 'A great work: +5 stability and culture every year',
};

/** Food, buildings, trade and siege for a living town. */
function townLife(ctx: Ctx, sid: number): string {
  const { w } = ctx;
  const s = w.setts[sid];
  const months = s.pop > 0 ? s.food / s.pop : 0;
  const crowd = s.cap > 0 ? s.pop / s.cap : 0;
  const food = s.lastFamine >= 0 && w.tick - s.lastFamine < 2 * TICKS_PER_YEAR ? '<span class="down">famine lately</span>'
    : months < 1 ? '<span class="down">almost empty</span>' : `${months.toFixed(1)} months stored`;
  const room = crowd > 0.95 ? 'the land is full' : crowd > 0.75 ? 'little room to grow' : 'room to grow';
  const blds = (Object.entries(s.b) as [string, number][]).filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="chip tip" tabindex="0" data-tip="${esc(BUILD_TIP[k] ?? k)}">${k === 'monument' ? 'great work' : k}${n > 1 ? ` ${n}` : ''}</span>`).join('') || '<span class="legend">none yet</span>';
  const partners = w.routes.filter((r) => r.a === sid || r.b === sid).map((r) => w.setts[r.a === sid ? r.b : r.a]);
  const siege = s.siege > 0 && s.siegeBy >= 0 ? `<div>Siege</div><div class="down">Besieged by the ${esc(w.civs[s.siegeBy].name)}</div>` : '';
  return `<div>Food</div><div>${food} · <span class="legend">${room}</span></div>
    <div>Buildings</div><div>${blds}</div>
    ${partners.length ? `<div>Trade</div><div>${partners.slice(0, 4).map((p) => `<a href="#" data-tile="${p.tile}">${esc(p.name)}</a>`).join(', ')}${partners.length > 4 ? ` and ${partners.length - 4} more` : ''}</div>` : ''}
    ${s.offers ? `<div>Offerings</div><div>${s.offers} from pilgrims</div>` : ''}
    ${siege}`;
}

function goalText(g: string): string {
  return ({ grow: 'tending fields and stores', expand: 'sending out settlers', fortify: 'raising walls', worship: 'building temples', build: 'raising great works', trade: 'building markets' } as Record<string, string>)[g] ?? g;
}

// ---- Chronicle ----

function lineHtml(l: Line, idx: number, tile: number | undefined, now: boolean): string {
  return `<div class="ln ${l.major ? 'major' : ''} ${now ? 'now' : ''}" data-ev="${idx}" ${tile !== undefined ? `data-tile="${tile}"` : ''} data-year="${l.year}"><span class="y">${l.year}</span><span class="t">${esc(l.text)}</span></div>`;
}

export function chronHtml(ctx: Ctx): string {
  const { w } = ctx;
  const civ = ctx.chron.scope === 'civ' ? ctx.selCiv : -1;
  const q = ctx.chron.q.trim().toLowerCase();
  const until = endTick(ctx);
  const picked: string[] = [];
  let lastCen = -1;
  let shown = 0;
  let more = false;
  for (let i = w.log.length - 1; i >= 0; i--) {
    const e = w.log[i];
    if (e.t > until) continue;
    if (civ >= 0 && e.a !== civ && e.b !== civ) continue;
    const l = line(w, e, w.logBase + i);
    if (ctx.chron.major && civ < 0 && (!l.major || WORLD_QUIET.has(e.k))) continue;
    if (q && !l.text.toLowerCase().includes(q)) continue;
    if (shown >= ctx.chron.limit) { more = true; break; }
    const cen = Math.floor(l.year / 100);
    if (cen !== lastCen) {
      picked.push(`<div class="cen">The ${ord(cen + 1)} century</div>`);
      lastCen = cen;
    }
    const tile = e.s !== undefined ? w.setts[e.s]?.tile : e.a !== undefined ? w.setts[w.civs[e.a].capital]?.tile : undefined;
    picked.push(lineHtml(l, i, tile, l.year === ctx.year && !ctx.live));
    shown++;
  }
  const scopeBtns = ctx.selCiv >= 0
    ? `<button class="btn ${civ < 0 ? 'on' : ''}" data-scope="world">World</button><button class="btn ${civ >= 0 ? 'on' : ''}" data-scope="civ">The ${esc(w.civs[ctx.selCiv].name)}</button>`
    : '';
  return `<div class="filters">${scopeBtns}${civ < 0 ? `<button class="btn ${ctx.chron.major ? 'on' : ''}" id="cmajor">Great events only</button>` : ''}</div>
    <input class="search" id="csearch" placeholder="Search the chronicle…" value="${esc(ctx.chron.q)}">
    ${picked.join('') || '<p class="legend">Nothing has been written yet.</p>'}
    ${more ? '<button class="btn more" id="cmore">Older entries…</button>' : ''}`;
}

// ---- Inspector ----

export function inspectHtml(ctx: Ctx, tile: number): string {
  const { w } = ctx;
  const t = w.t;
  const river = t.river[tile] ? w.rivers[t.river[tile] - 1] : null;
  const o = ctx.owner[tile];
  const s = ctx.setts.find((x) => x.tile === tile);
  const ruin = !s ? w.setts.find((x) => x.tile === tile && x.died >= 0 && x.died <= endTick(ctx)) : undefined;
  let html = `<button class="x" id="ix">✕</button>`;
  if (s) {
    const full = w.setts[s.id];
    const owner = w.civs[s.civ];
    html += `<div class="h">${esc(full.name)}</div><div class="legend">${TIER_NAMES[s.tier]} of the ${esc(owner.name)}${full.g ? ` · “${esc(full.g)}” in the tongue of the ${esc(full.was ? owner.name : w.civs[full.o].name)}` : ''}${full.was ? ` · once called ${esc(full.was)}` : ''}</div>
      <div class="kv"><div>People</div><div>${fmt(s.pop)}</div><div>Stability</div><div>${ctx.live ? stabWhy(ctx, full.id) : s.stab}</div>
      <div>Founded</div><div>${yearOf(full.born)} AW${full.parent >= 0 ? ` from ${esc(w.setts[full.parent].name)}` : ''}${full.o !== s.civ ? ` by the ${esc(w.civs[full.o].name)}` : ''}</div>
      ${ctx.live ? townLife(ctx, full.id) : ''}
      ${full.monument && ctx.live ? `<div>Great work</div><div>${esc(full.monument)}</div>` : ''}
      ${ctx.live ? `<div>Land feeds</div><div>~${fmt(full.cap * mods(owner).food * (1 + 0.12 * full.b.fields))} <span class="legend">· reach ${TIER_R[s.tier]} tiles</span></div>` : ''}
      ${ctx.live && full.plague > 0 ? `<div>Sickness</div><div>${esc(w.plagues[full.plagueId].name)}</div>` : ''}
      ${ctx.live && w.wonders.some((x) => x.s === s.id) ? `<div>Wonder</div><div style="color:#ffe08a">✦ ${esc(w.wonders.find((x) => x.s === s.id)!.name)}</div>` : ''}
      ${ctx.live && w.faiths.some((f) => f.holy === s.id && f.died < 0) ? `<div>Holy city</div><div>of ${esc(w.faiths.find((f) => f.holy === s.id && f.died < 0)!.name)}</div>` : ''}</div>`;
  } else if (ruin) {
    html += `<div class="h">Ruins of ${esc(ruin.name)}</div><div class="legend">Abandoned ${yearOf(ruin.died)} AW, once of the ${esc(w.civs[ruin.civ].name)}</div>`;
  } else {
    html += `<div class="h">${BIOMES[t.biome[tile]].n}</div>`;
  }
  html += `<div class="kv">${s || ruin ? `<div>Land</div><div>${BIOMES[t.biome[tile]].n}</div>` : ''}
    ${river ? `<div>River</div><div>${river.name ? 'the ' + esc(river.name) + (river.g ? ` <span class="legend">· “${esc(river.g)}”</span>` : '') : 'unnamed'}</div>` : ''}
    ${t.res[tile] ? `<div>Resource</div><div>${RES_NAMES[t.res[tile]]}</div>` : ''}
    <div>Climate</div><div>${t.temp[tile]} °C, ${t.moist[tile] > 66 ? 'wet' : t.moist[tile] > 33 ? 'mild' : 'dry'}</div>
    ${o >= 0 && !s ? `<div>Held by</div><div>the ${esc(w.civs[o].name)}</div>` : ''}</div>`;
  if (o >= 0) html += `<div style="margin-top:8px"><button class="btn" data-civ="${o}">${banner(w.civs[o], 14)} The ${esc(w.civs[o].name)}</button></div>`;
  return html;
}

// ---- Tech tree ----

const FX_WORD: Record<string, [string, boolean]> = {
  food: ['food', true], mat: ['materials', true], stab: ['stability', false], grow: ['growth', true], lore: ['research', true],
  wealth: ['wealth', true], mil: ['military', true], def: ['defence', true], trade: ['trade', false], range: ['reach', false],
  sail: ['seafaring', false], sizePen: ['less strain from size', true], plagueRes: ['plague resistance', true],
};

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fxText(fx: Record<string, number | undefined>): string {
  return cap1(Object.entries(fx).map(([k, v]) => {
    const [word, pct] = FX_WORD[k] ?? [k, false];
    return k === 'sizePen' ? `${word} (${Math.round((v ?? 0) * 100)}%)` : `${word} +${pct ? Math.round((v ?? 0) * 100) + '%' : v}`;
  }).join(', '));
}

/** Everything a tech needs, directly or through earlier techs. */
function techUp(id: number): Set<number> {
  const s = new Set<number>();
  const q = [...TECHS[id].req];
  while (q.length) { const x = q.pop()!; if (!s.has(x)) { s.add(x); q.push(...TECHS[x].req); } }
  return s;
}
/** Everything that becomes reachable because of a tech. */
function techDown(id: number): Set<number> {
  const s = new Set<number>();
  const q = [id];
  while (q.length) { const x = q.pop()!; for (const t of TECHS) if (t.req.includes(x) && !s.has(t.id)) { s.add(t.id); q.push(t.id); } }
  return s;
}

/**
 * The whole tree, one Age per section. With a people chosen it shows what they know, what
 * they could study next and what they are studying; otherwise how many peoples know each tech.
 */
export function techHtml(ctx: Ctx, sel: number, scope: 'world' | 'civ'): string {
  const w = ctx.w;
  const alive = w.civs.filter((c) => c.died < 0);
  const knownBy = new Int32Array(TECHS.length);
  for (const c of alive) for (const k of c.techs) knownBy[k]++;
  const civ = scope === 'civ' && ctx.selCiv >= 0 ? w.civs[ctx.selCiv] : null;
  const has = civ ? new Set(civ.techs) : null;
  const up = sel >= 0 ? techUp(sel) : null;
  const down = sel >= 0 ? techDown(sel) : null;

  const scopeBtns = ctx.selCiv >= 0
    ? `<div class="filters"><button class="btn ${civ ? '' : 'on'}" data-tscope="world">Whole world</button><button class="btn ${civ ? 'on' : ''}" data-tscope="civ">The ${esc(w.civs[ctx.selCiv].name)}</button></div>`
    : '';

  let detail = '<p class="legend" style="margin:0">Tap a tech to see what it does, what it needs and what it leads to.</p>';
  if (sel >= 0) {
    const t = TECHS[sel];
    const reqs = t.req.map((r) => `<a href="#" data-tech="${r}">${TECHS[r].name}</a>`).join(', ') || 'nothing';
    const next = TECHS.filter((x) => x.req.includes(sel)).map((x) => `<a href="#" data-tech="${x.id}">${x.name}</a>`).join(', ') || 'nothing yet';
    const status = civ ? (has!.has(sel) ? 'Known to them.' : civ.research === sel ? 'They are studying this now.' : t.req.every((r) => has!.has(r)) ? 'They could study this next.' : 'Out of their reach for now.') : '';
    detail = `<div class="tdetail"><b>${cap1(t.name)}</b> <span class="legend">${AGES[t.age]} Age · ${fmt(techCost(t))} research</span>
      <div>${fxText(t.fx as Record<string, number>)}${t.needs !== undefined ? `. Only works with ${RES_NAMES[t.needs]} in reach` : ''}.</div>
      <div class="legend">Needs ${reqs}. Opens ${next}. Leads to ${down!.size} later ${down!.size === 1 ? 'tech' : 'techs'}.</div>
      <div class="legend">Known to ${knownBy[sel]} of ${alive.length} living peoples. ${status}</div></div>`;
  }

  const sections = AGES.map((a, age) => {
    const chips = TECHS.filter((t) => t.age === age).map((t) => {
      const cls = ['tchip'];
      if (sel >= 0) cls.push(t.id === sel ? 'sel' : up!.has(t.id) ? 'req' : down!.has(t.id) ? 'unl' : 'dim');
      if (has) {
        if (has.has(t.id)) cls.push('known');
        else if (civ!.research === t.id) cls.push('study');
        else if (t.req.every((r) => has.has(r))) cls.push('next');
      }
      const tag = has ? (civ!.research === t.id ? '<small>studying</small>' : '') : `<small>${knownBy[t.id] || ''}</small>`;
      return `<button class="${cls.join(' ')}" data-tech="${t.id}">${cap1(t.name)}${t.needs !== undefined ? ' <span class="res" title="Needs ' + RES_NAMES[t.needs] + '">◆</span>' : ''}${tag}</button>`;
    }).join('');
    const now = age === w.age;
    return `<div class="tage${now ? ' now' : ''}"><div class="tah"><span>${a} Age</span><span class="legend">${now ? 'the world is here · ' : ''}${fmt(techCost(TECHS.find((t) => t.age === age)!))} each</span></div><div class="tgrid">${chips}</div></div>`;
  }).join('');

  const key = civ
    ? '<div class="tkey legend"><span class="k known"></span>known <span class="k study"></span>studying <span class="k next"></span>could study next</div>'
    : '<div class="tkey legend">Numbers show how many living peoples know each tech. ◆ needs a resource.</div>';
  return `${scopeBtns}${key}${detail}${sections}`;
}
