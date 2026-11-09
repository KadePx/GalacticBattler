// Milestone 6 views: the founder's council (influence, omens, edicts, naming rights, envoys) and
// the "while you were away" digest. Each returns HTML; main.ts wires the buttons.

import { line, yearOf } from '../chronicle';
import type { History } from '../history';
import { relOf } from '../sim/diplo';
import { COST, EDICT_YEARS, INF_CAP, INF_TICKS, edictOn, influence, nameable } from '../sim/player';
import { EDICTS, TICKS_PER_YEAR, type Civ, type Edict, type Omen, type World } from '../sim/types';
import { banner, esc, fmt } from './panels';
import { civColor } from './map';

/** An action sent to the server but not yet applied (it lands when the month turns). */
export interface Queued { label: string; cost: number; omen?: number; tick: number }

export const EDICT_TEXT: Record<Edict, [string, string]> = {
  grow: ['Grow', 'Fields, granaries and families come first.'],
  expand: ['Expand', 'Send settlers out to claim new land.'],
  fortify: ['Fortify', 'Raise walls and keep the levies ready.'],
  worship: ['Worship', 'Build temples and keep the towns calm.'],
  build: ['Build', 'Raise great works and wonders.'],
  trade: ['Trade', 'Markets, roads and merchant wealth.'],
  research: ['Research', 'Scholars work 35% faster. Goals are left to the people.'],
};

/** Real time for a number of months, like "3h 12m" or "40m". */
export function realTime(ticks: number, msPerTick: number): string {
  const min = Math.max(0, Math.round((ticks * msPerTick) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h ${min % 60}m` : `${Math.round(h / 24)} days`;
}

function infMeter(w: World, c: Civ, msPerTick: number): string {
  const inf = influence(w, c);
  const pips = Array.from({ length: INF_CAP }, (_, i) => {
    const f = Math.max(0, Math.min(1, inf - i));
    return `<i style="--f:${(f * 100).toFixed(0)}%"></i>`;
  }).join('');
  const next = inf >= INF_CAP ? 'full: spend some, or it goes to waste' : `next point in ${realTime((1 - (inf % 1)) * INF_TICKS, msPerTick)}`;
  return `<div class="infl"><div class="pips">${pips}</div><div class="legend"><b>${inf.toFixed(1)}</b> of ${INF_CAP} influence · ${next}</div></div>`;
}

function omenCard(w: World, om: Omen, c: Civ, msPerTick: number, canPay: boolean, queued: boolean): string {
  const other = om.b !== undefined ? w.civs[om.b] : null;
  const on = other ? `<a href="#" data-civ="${other.id}" style="color:${civColor(other.hue, 70)}">the ${esc(other.name)}</a>` : '';
  let title = '';
  let body = '';
  let choices: [string, string][] = [];
  let silence = '';
  if (om.k === 'claim') {
    title = 'Who should rule?';
    body = `The old ruler is dead. <b>${esc(om.x ?? '')}</b> has taken the seat, but <b>${esc(om.y ?? '')}</b> of House ${esc(om.z ?? '')} claims it too.`;
    choices = [[`Confirm ${om.x}`, 'The rival is forgotten and every town takes heart (+5 stability).'], [`Crown ${om.y}`, `House ${om.z} takes the throne, without bloodshed.`]];
    silence = 'If no sign comes, the heir keeps the throne.';
  } else if (om.k === 'war') {
    const war = w.wars[om.n ?? -1];
    title = 'War has come';
    body = `Your people are at war with ${on}${war ? ` (${esc(war.name)})` : ''}. How should they meet it?`;
    choices = [['Rally the levies', 'The army grows by 30% and war-weariness eases.'], ['Seek terms', 'Pay a quarter of the treasury and make peace.']];
    silence = 'If no sign comes, the war goes on as the rulers see fit.';
  } else if (om.k === 'sign') {
    title = 'A sign in the sky';
    body = 'A comet crossed the sky. The people ask what it means.';
    choices = [['Plenty', 'Rich harvests around the capital for three years.'], ['Wisdom', 'A burst of new learning for the scholars.'], ['Strength', 'The army swells by a quarter and towns stand prouder (+3 stability).']];
    silence = 'If no sign comes, the priests will read it as they like.';
  } else {
    title = 'An offer of alliance';
    body = `${on ? on.charAt(0).toUpperCase() + on.slice(1) : 'A people'} offer an alliance.`;
    choices = [['Accept', 'Your peoples become allies.'], ['Refuse', 'Turn them down.']];
    silence = 'If no sign comes, your rulers decide by how they feel about them.';
  }
  const left = realTime(om.due - w.tick, msPerTick);
  return `<div class="omen"><div class="ot">${title}</div><p>${body}</p>
    <div class="ochoices">${choices.map(([a, d], i) => `<button class="ochoice" data-omen="${om.id}" data-pick="${i}" ${canPay && !queued ? '' : 'disabled'}><b>${esc(a)}</b><small>${d}</small></button>`).join('')}</div>
    <div class="legend">${queued ? 'Your answer is on its way; it is heard when the month turns.' : `Costs ${COST.omen} influence. ${silence} ${left} left.`}</div></div>`;
}

/** Rivers that cross a people's land. */
function riversOf(w: World, civ: number): number[] {
  const out = new Set<number>();
  const t = w.t;
  for (let i = 0; i < t.river.length; i++) if (t.river[i] && t.owner[i] === civ) out.add(t.river[i] - 1);
  return [...out];
}

export function councilHtml(w: World, civ: number, msPerTick: number, queued: Queued[], naming: string): string {
  const c = w.civs[civ];
  if (c.died >= 0) {
    return `<div class="civhead">${banner(c, 56)}<div><div class="nm">The ${esc(c.name)}</div><div class="sub" style="color:var(--red)">Fell in ${yearOf(c.died)} AW</div></div></div>
      <p>Your people are gone, but they live on in the chronicle${w.civs.some((x) => x.parent === c.id) ? ' and in the peoples who came after them' : ''}. Each day you can still leave a pilgrim's offering at any town or wonder: select it on the map.</p>
      <button class="btn" data-civ="${c.id}">Their history</button>`;
  }
  const inf = influence(w, c);
  const owed = queued.reduce((n, q) => n + q.cost, 0);
  const can = (n: number) => inf - owed >= n;
  const qOmens = new Set(queued.filter((q) => q.omen !== undefined).map((q) => q.omen));
  const omens = w.omens.filter((o) => o.civ === civ);
  const ed = edictOn(w, c);

  const edicts = EDICTS.map((e) => {
    const [name, desc] = EDICT_TEXT[e];
    return `<button class="ochoice ${ed === e ? 'on' : ''}" data-edict="${e}" ${can(COST.edict) && ed !== e ? '' : 'disabled'}><b>${name}</b><small>${desc}</small></button>`;
  }).join('');

  // Naming rights.
  const names: string[] = [];
  const nameRow = (what: string, id: number, label: string, kind: string) => {
    const key = `${what}:${id}`;
    const form = naming === key
      ? `<span class="nameform"><input id="nameinp" maxlength="24" placeholder="A new name" autocomplete="off"><button class="btn sm" data-dosname="${key}">Name it</button></span>`
      : `<button class="btn sm" data-askname="${key}" ${can(COST.name) ? '' : 'disabled'}>Name</button>`;
    names.push(`<div class="nrow"><div><b>${esc(label)}</b><span class="legend"> · ${kind}</span></div>${form}</div>`);
  };
  for (const s of w.setts) if (nameable(w, c, 'sett', s.id)) nameRow('sett', s.id, s.name, `town, founded ${yearOf(s.born)} AW`);
  c.greats.forEach((g, i) => { if (nameable(w, c, 'great', i)) nameRow('great', i, g.name, `${g.kind}, risen ${yearOf(g.born)} AW`); });
  w.wonders.forEach((x, i) => { if (nameable(w, c, 'wonder', i)) nameRow('wonder', i, x.name, 'wonder'); });
  for (const r of riversOf(w, civ)) if (nameable(w, c, 'river', r)) nameRow('river', r, w.rivers[r].name ? `the ${w.rivers[r].name}` : 'An unnamed river', 'river');

  // Envoys.
  const known = c.contacts.map((k) => w.civs[k]).filter((o) => o.died < 0);
  const envoys = known.map((o) => {
    const rl = relOf(w, civ, o.id);
    const st = rl?.st ?? 'peace';
    const op = Math.round(rl?.op ?? 0);
    const stLabel = st === 'ally' ? 'allies' : st === 'pact' ? 'trade pact' : st === 'war' ? '<span style="color:var(--red)">at war</span>' : 'at peace';
    return `<div class="nrow"><div>${banner(o, 14)} <a href="#" data-civ="${o.id}" style="color:${civColor(o.hue, 70)}">${esc(o.name)}</a><span class="legend"> · ${stLabel} · feeling ${op > 0 ? '+' : ''}${op}${o.founder ? ' · a founder\'s people' : ''}</span></div>
      <span>${st !== 'war' ? `<button class="btn sm" data-gift="${o.id}" ${can(COST.gift) ? '' : 'disabled'} title="Send ${COST.gift} influence and a tenth of the treasury">Gifts</button>` : ''}
      ${st !== 'war' && st !== 'ally' ? `<button class="btn sm" data-propose="${o.id}" ${can(COST.propose) ? '' : 'disabled'}>Ally?</button>` : ''}</span></div>`;
  }).join('');

  return `<div class="civhead">${banner(c, 56)}<div><div class="nm">The ${esc(c.name)}</div><div class="sub">Your people · ${yearOf(w.tick) - yearOf(c.born)} years old${c.protectedUntil > w.tick ? ' · under protection' : ''}</div></div></div>
    ${infMeter(w, c, msPerTick)}
    ${queued.length ? `<div class="queued">Waiting for the month to turn: ${queued.map((q) => esc(q.label)).join(', ')}</div>` : ''}
    ${omens.length ? `<h3>Your people await a sign</h3>${omens.map((o) => omenCard(w, o, c, msPerTick, can(COST.omen), qOmens.has(o.id))).join('')}` : ''}
    <h3>Edict <span class="legend">${COST.edict} influence · lasts ${EDICT_YEARS} years</span></h3>
    <p class="legend">${ed ? `Now: <b>${EDICT_TEXT[ed as Edict][0]}</b>, for ${Math.ceil((c.edictUntil - w.tick) / TICKS_PER_YEAR)} more years. An edict weighs heavily on your rulers, but it is not an order.` : 'No edict. Your rulers choose for themselves each year.'}</p>
    <div class="ochoices grid">${edicts}</div>
    <h3>Naming rights <span class="legend">${COST.name} influence each</span></h3>
    ${names.join('') || '<p class="legend">Nothing to name right now. New towns, great people, wonders and rivers in your land can be named while they are young.</p>'}
    <h3>Envoys <span class="legend">gifts ${COST.gift} · alliance ${COST.propose}</span></h3>
    ${envoys || '<p class="legend">Your people have not met anyone yet.</p>'}`;
}

// ---- While you were away ----

const DIGEST_KINDS = new Set([
  'found_sett', 'tier_up', 'famine', 'revolt', 'secede', 'abandon', 'capital_move', 'civ_fall', 'tech', 'war', 'conquest', 'peace', 'crisis', 'claim_war',
  'new_dynasty', 'succession', 'great_born', 'monument', 'plague_reach', 'ally', 'pact', 'gift', 'proposal', 'proposal_refused', 'omen_claim', 'omen_war',
  'omen_sign', 'faith_found', 'convert', 'schism', 'wonder', 'wonder_beaten', 'quake', 'eruption', 'fire', 'tsunami', 'collapse', 'revival', 'defect', 'contact',
  'pilgrims', 'omen',
]);
const WORLD_KINDS = new Set(['age', 'civ_fall', 'found_civ', 'wonder', 'faith_found', 'schism', 'collapse', 'revival', 'war', 'plague_start', 'eruption']);

export function digestHtml(w: World, hist: History, civ: number, fromTick: number, msPerTick: number): string | null {
  const span = w.tick - fromTick;
  if (span < 24) return null;
  const fromYear = yearOf(fromTick);
  const nowYear = yearOf(w.tick);
  const lines: { year: number; html: string }[] = [];
  for (let i = 0; i < w.log.length; i++) {
    const e = w.log[i];
    if (e.t < fromTick) continue;
    const mine = civ >= 0 && (e.a === civ || e.b === civ);
    if (civ >= 0 ? !mine || !DIGEST_KINDS.has(e.k) : !WORLD_KINDS.has(e.k)) continue;
    if (e.k === 'found_civ' && civ < 0 && !(e.a !== undefined && w.civs[e.a].founder)) continue;
    const l = line(w, e, w.logBase + i);
    const tile = e.s !== undefined ? w.setts[e.s]?.tile : undefined;
    lines.push({ year: l.year, html: `<div class="dline${tile !== undefined ? ' click' : ''}"${tile !== undefined ? ` data-tile="${tile}" data-year="${l.year}"` : ''}>${esc(l.text)}</div>` });
  }
  // Long absences read by decade.
  const byDecade = nowYear - fromYear > 40;
  const groups = new Map<number, string[]>();
  for (const l of lines) {
    const k = byDecade ? Math.floor(l.year / 10) * 10 : l.year;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l.html);
  }
  const body = [...groups].map(([k, hs]) => `<div class="dgroup"><div class="dyear">${byDecade ? `${k}s` : `${k} AW`}</div>${hs.slice(-12).join('')}${hs.length > 12 ? `<div class="legend">and ${hs.length - 12} more</div>` : ''}</div>`).join('');
  let head = '';
  if (civ >= 0) {
    const c = w.civs[civ];
    const p0 = hist.civPopAt(civ, fromYear);
    const p1 = hist.civPopAt(civ, nowYear) || (c.died < 0 ? w.setts.filter((s) => s.civ === civ && s.died < 0).reduce((a, s) => a + s.pop, 0) : 0);
    const ser = hist.civs.get(civ);
    const s0 = ser?.setts[fromYear - ser.from] ?? 0;
    const s1 = ser?.setts[nowYear - ser.from] ?? 0;
    const techs = lines.length ? w.log.filter((e) => e.t >= fromTick && e.a === civ && e.k === 'tech').length : 0;
    const delta = (a: number, b: number) => `${fmt(a)} → <b>${fmt(b)}</b>${b > a ? ' <span class="up">▲</span>' : b < a ? ' <span class="down">▼</span>' : ''}`;
    head = `<div class="civhead">${banner(c, 44)}<div><div class="nm">The ${esc(c.name)}</div><div class="sub">${c.died >= 0 ? `<span style="color:var(--red)">fell in ${yearOf(c.died)} AW</span>` : 'your people'}</div></div></div>
      <div class="kv"><div>People</div><div>${delta(p0, p1)}</div><div>Settlements</div><div>${delta(s0, s1)}</div><div>New knowledge</div><div>${techs} ${techs === 1 ? 'tech' : 'techs'}</div></div>
      ${w.omens.some((o) => o.civ === civ) ? '<button class="btn gold" data-open="mine" style="margin-top:10px">Your people await a sign</button>' : ''}`;
  }
  return `<div class="dhead"><div class="dt">While you were away</div><div class="legend">${nowYear - fromYear} years passed (${realTime(span, msPerTick)}) · ${fromYear}–${nowYear} AW</div></div>
    ${head}<div class="dbody">${body || '<p class="legend">A quiet time. Nothing much happened.</p>'}</div>
    <div class="row2"><button class="btn" data-digest="close">Back to the world</button></div>`;
}
