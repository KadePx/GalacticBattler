// The cards in the right-hand drawer: a colonist, a memorial for someone dead or gone, and
// a building. Each function returns HTML text; panels.ts puts it on the page and handles
// clicks through data- attributes (data-p person, data-b building, data-act action).

import { SEASON_NAMES, when } from '../config';
import { BACKS } from '../sim/data/backstories';
import { CROPS, TPL } from '../sim/data/buildings';
import { PROFS } from '../sim/data/professions';
import { TH } from '../sim/data/thoughts';
import { TRAITS } from '../sim/data/traits';
import { RANK_NAMES, rulerTitle } from '../sim/gov';
import { breakLine, moodTarget } from '../sim/mood';
import { ageYears, fullName, person, posAt, stage, stat } from '../sim/pawn';
import { opinion } from '../sim/social';
import { SKILL_NAMES, type Bio, type Bld, type Colony, type Dead, type Id, type Pawn } from '../sim/types';
import { dateText, raceName, thoughtText, whyText } from '../text';
import { stageOfAge, yearsAt } from './look';
import { portraitKey, portraitSvg } from './portrait';
import { DEVOTION, ILL_NAMES, PART_NAMES, STAGE_NAMES, actText, bioText, causeText, esc, faithName, moodColor, moodWord, pretty, qualityWord } from './words';

type Who = Pawn | Dead;

/** What the card remembers between redraws (which rows are open, and so on). */
export interface CardUi { open: Set<string>; allRel: boolean; following: boolean }

// Portrait SVG text is cached per person and size; it only changes when their looks do.
const faces = new Map<string, { key: string; svg: string }>();
export function face(c: Colony, p: Who, size: number): string {
  const id = p.id + ':' + size;
  const key = portraitKey(c, p);
  const hit = faces.get(id);
  if (hit && hit.key === key) return hit.svg;
  const svg = portraitSvg(c, p, size);
  faces.set(id, { key, svg });
  return svg;
}

/** "3 Spr Y2": dates in lists stay short; the full date is in the tooltip. */
export function shortDate(tick: number): string {
  const w = when(tick);
  return `${w.day} ${SEASON_NAMES[w.season].slice(0, 3)} Y${w.year}`;
}

const sign = (v: number): string => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));
const tone = (v: number): string => (v > 0 ? 'up' : v < 0 ? 'down' : '');

function replaceWord(s: string, word: string, to: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const i = s.indexOf(word, from);
    if (i < 0) break;
    const before = i > 0 ? s[i - 1] : ' ';
    const after = i + word.length < s.length ? s[i + word.length] : ' ';
    const whole = !/[\p{L}\d\u0001]/u.test(before) && !/[\p{L}\d]/u.test(after);
    out += s.slice(from, i) + (whole ? to : word);
    from = i + word.length;
  }
  return out + s.slice(from);
}

/** Escape a sentence and turn the names of the given people into links to their cards. */
export function linkNames(c: Colony, text: string, ids: (Id | undefined)[]): string {
  let s = esc(text);
  const links: string[] = [];
  const seen = new Set<Id>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const p = person(c, id);
    if (!p) continue;
    const mark = (label: string): string => {
      links.push(`<a class="who" data-p="${id}">${label}</a>`);
      return `\u0001${links.length - 1}\u0002`;
    };
    const full = esc(`${p.first} ${p.fam}`);
    const first = esc(p.first);
    if (s.includes(full)) s = s.split(full).join(mark(full));
    s = replaceWord(s, first, mark(first));
  }
  return s.replace(/\u0001(\d+)\u0002/g, (_, n: string) => links[Number(n)]);
}

const whoLink = (c: Colony, id: Id): string => {
  const p = person(c, id);
  return p ? `<a class="who" data-p="${id}">${esc(p.first)}</a>` : 'someone';
};

function bar(v: number, color: string, marks: number[] = []): string {
  const w = Math.max(0, Math.min(100, v));
  return `<div class="bar"><i style="width:${w.toFixed(1)}%;background:${color}"></i>${marks.map((m) => `<s style="left:${Math.max(0, Math.min(100, m)).toFixed(1)}%"></s>`).join('')}</div>`;
}

const needColor = (v: number): string => (v < 20 ? 'var(--bad)' : v < 45 ? '#fbbf24' : 'var(--accent)');

function chips(keys: string[], open: Set<string>): string {
  if (!keys.length) return '<div class="hint">None of note.</div>';
  let out = '<div class="chips">';
  let desc = '';
  for (const k of keys) {
    const t = TRAITS[k];
    const on = open.has('trait:' + k);
    out += `<button class="chip${on ? ' on' : ''}" data-open="trait:${esc(k)}" title="${esc(t?.desc ?? '')}">${esc(t?.name ?? k)}</button>`;
    if (on && t) desc += `<div class="note"><b>${esc(t.name)}.</b> ${esc(t.desc)}</div>`;
  }
  return out + '</div>' + desc;
}

function backs(p: Who): string {
  let out = '';
  for (const [label, k] of [['Childhood', p.bc], ['Adult life', p.ba]] as const) {
    const b = BACKS[k];
    if (b) out += `<div class="note"><span class="lbl">${label}</span> <b>${esc(b.name)}.</b> ${esc(b.desc)}</div>`;
  }
  return out || '<div class="hint">Still too young to have one.</div>';
}

function story(c: Colony, p: Who, end?: string): string {
  let out = `<div class="ln"><span class="y">${p.born < 0 ? 'Before' : shortDate(p.born)}</span><span class="t">${p.born < 0 ? 'Born before the colony kept records.' : 'Born in the colony.'}</span></div>`;
  for (const b of p.bio as Bio[]) {
    out += `<div class="ln" title="${esc(dateText(b.t, true))}"><span class="y">${shortDate(b.t)}</span><span class="t">${linkNames(c, bioText(c, b), [b.o])}</span></div>`;
  }
  return out + (end ?? '');
}

const BREAK_NOW: Record<string, string> = { sulk: 'shut away, speaking to no one', bingefood: 'eating everything in sight', bingedrink: 'drinking without stopping', wander: 'wandering in a daze', rave: 'raging at everyone', tantrum: 'smashing things' };
const INSPIRED: Record<string, string> = { frenzy: 'working like someone possessed', insight: 'seeing everything clearly', create: 'struck by an idea for something beautiful' };
const GOALS: Record<string, string> = {
  love: 'a great love', dynasty: 'a large family', rule: 'being in charge', craft: 'mastering a craft', faith: 'serving the gods', rich: 'getting rich',
  wander: 'seeing the world', protect: 'keeping others safe', build: 'building something that lasts', remembered: 'being remembered',
};

/** What o is to p, in the words p would use. */
function ties(p: Pawn, o: Who): [string, string][] {
  const out: [string, string][] = [];
  const rel = p.rel[o.id];
  if (rel?.k === 'spouse') out.push(['Spouse', 'love']);
  else if (rel?.k === 'lover') out.push(['Lover', 'love']);
  else if (rel?.k === 'betrothed') out.push(['Betrothed', 'love']);
  else if (rel?.k === 'ex') out.push(['Ex', 'dim']);
  if (p.mo === o.id) out.push(['Mother', 'kin']);
  else if (p.fa === o.id) out.push(['Father', 'kin']);
  else if (o.mo === p.id || o.fa === p.id) out.push([o.sex ? 'Son' : 'Daughter', 'kin']);
  else if ((p.mo && p.mo === o.mo) || (p.fa && p.fa === o.fa)) out.push([o.sex ? 'Brother' : 'Sister', 'kin']);
  if (rel?.f === 1) out.push(['Friend', 'good']);
  else if (rel?.f === -1) out.push(['Rival', 'bad']);
  if (p.crush === o.id) out.push(['Crush', 'love']);
  return out;
}

const tieChips = (list: [string, string][]): string => list.map(([t, cl]) => `<span class="tie ${cl}">${t}</span>`).join('');

function relations(c: Colony, p: Pawn, ui: CardUi): string {
  const rows: { o: Pawn; op: number; t: [string, string][] }[] = [];
  let hidden = 0;
  for (const o of c.pawns) {
    if (o === p) continue;
    const t = ties(p, o);
    if (!t.length && !p.rel[o.id] && !ui.allRel) { hidden++; continue; }
    rows.push({ o, op: opinion(c, p, o), t });
  }
  rows.sort((a, b) => b.op - a.op || a.o.id - b.o.id);
  let out = '';
  for (const r of rows) {
    const key = 'rel:' + r.o.id;
    const open = ui.open.has(key);
    out += `<div class="rel${open ? ' open' : ''}"><div class="relh" data-open="${key}">${face(c, r.o, 30)}<span class="n"><a class="who" data-p="${r.o.id}">${esc(fullName(r.o))}</a>${tieChips(r.t)}</span><b class="${tone(r.op)}">${sign(r.op)}</b><span class="chev">${open ? '−' : '+'}</span></div>`;
    if (open) {
      const parts: [string, number][] = [];
      opinion(c, p, r.o, parts);
      parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      out += '<div class="relb">';
      for (const [k, v] of parts) if (v) out += `<div class="th"><span>${esc(k)}</span><b class="${tone(v)}">${sign(v)}</b></div>`;
      const back = opinion(c, r.o, p);
      out += `<div class="th dimrow"><span>What ${esc(r.o.first)} thinks of ${esc(p.first)}</span><b class="${tone(back)}">${sign(back)}</b></div></div>`;
    }
    out += '</div>';
  }
  // family and partners who are dead or gone
  for (const d of c.dead) {
    const t = ties(p, d);
    if (d.sp === p.id && !t.some((x) => x[1] === 'love')) t.unshift([d.left ? 'Left them' : 'Late partner', 'dim']);
    if (!t.length) continue;
    out += `<div class="rel gone"><div class="relh" data-p="${d.id}">${face(c, d, 30)}<span class="n"><a class="who" data-p="${d.id}">${esc(fullName(d))}</a>${tieChips(t)}</span><span class="v">${d.left ? 'gone' : 'dead'}</span></div></div>`;
  }
  if (!out) out = '<div class="hint">Has not got to know anyone yet.</div>';
  if (hidden || ui.allRel) out += `<button class="btn sm" data-act="allrel">${ui.allRel ? 'Only people they know' : `Show everyone (${hidden} more)`}</button>`;
  return out;
}

/** Wounds and sickness, if the sim tracks them (these fields are newer than this card). */
function health(p: Pawn): string {
  const x = p as unknown as { inj?: { p: string; k: string; sev: number }[]; ill?: { k: string; sev: number }; perm?: string[] };
  let out = '';
  for (const i of x.inj ?? []) out += `<div class="th"><span>${esc(pretty(i.k))}${i.p ? ', ' + esc(PART_NAMES[i.p] ?? i.p) : ''}</span><b class="down">${Math.round(i.sev)}</b></div>`;
  if (x.ill) out += `<div class="th"><span>Sick with ${esc(ILL_NAMES[x.ill.k] ?? x.ill.k)}</span><b class="down">${Math.round(x.ill.sev)}</b></div>`;
  // 'had_...' entries only record an illness survived; they are not something to show
  for (const k of x.perm ?? []) if (!k.startsWith('had_')) out += `<div class="th"><span>${esc(pretty(k))}</span><b></b></div>`;
  return out ? `<div class="hurts">${out}</div>` : '';
}

export function pawnCard(c: Colony, p: Pawn, ui: CardUi): string {
  const st = stage(c, p);
  const age = Math.floor(ageYears(c, p));
  const prof = PROFS[p.prof];
  const bl = breakLine(p);
  const target = moodTarget(c, p);
  const home = p.home ? c.blds.find((b) => b.id === p.home) : undefined;
  let h = '';

  h += `<div class="head">${face(c, p, 88)}<div class="hd"><div class="nm">${esc(fullName(p))}</div>`;
  h += `<div class="sub">${esc(raceName(p.race))} · ${p.sex ? 'Male' : 'Female'} · ${age} ${age === 1 ? 'year' : 'years'} · ${STAGE_NAMES[st]}</div>`;
  h += `<div class="sub">${prof ? `<span title="${esc(prof.blurb)}">${esc(prof.name)}</span>` : st < 3 ? 'Too young for a trade' : 'No trade'} · <span title="Faith: ${DEVOTION[p.dev] ?? ''}">${esc(faithName(p.faith))}</span></div>`;
  // standing: the ruler's title, an office held, or a rank worth mentioning
  const office = Object.entries(c.gov.titles).find(([, id]) => id === p.id)?.[0];
  const standing = p.id === c.gov.ruler ? `${rulerTitle(c, p)} of ${c.name}` : p.id === c.gov.regent ? 'Regent' : office ? office[0].toUpperCase() + office.slice(1) : p.rank !== 2 && st >= 3 ? RANK_NAMES[p.rank] : '';
  if (standing) h += `<div class="sub"><span class="tie kin">${esc(standing)}</span></div>`;
  h += `<div class="btns"><button class="btn sm${ui.following ? ' on' : ''}" data-act="follow">${ui.following ? 'Following' : 'Follow'}</button><button class="btn sm" data-act="find">Show on map</button></div></div></div>`;

  let flags = '';
  if (p.brk) flags += `<span class="tie bad">Broken: ${BREAK_NOW[p.brk.k] ?? p.brk.k}</span>`;
  if (p.insp && p.insp[1] > c.tick) flags += `<span class="tie kin">Inspired: ${INSPIRED[p.insp[0]] ?? p.insp[0]}</span>`;
  if (p.preg) flags += '<span class="tie love">Expecting a child</span>';
  if (p.drunk > 60) flags += '<span class="tie dim">Drunk</span>';
  else if (p.drunk > 30) flags += '<span class="tie dim">Tipsy</span>';
  if (p.hp < 60) flags += '<span class="tie bad">Badly hurt</span>';
  if (flags) h += `<div class="flags">${flags}</div>`;

  h += `<h3>Mood <span class="legend">${moodWord(p)}</span></h3>`;
  h += `<div class="moodrow"><b style="color:${moodColor(p)}">${Math.round(p.mood)}</b>${bar(p.mood, moodColor(p), [bl.minor, bl.major, bl.extreme])}</div>`;
  h += `<div class="hint">Heading ${target > p.mood + 0.5 ? 'up' : target < p.mood - 0.5 ? 'down' : 'steady'} towards ${Math.round(target)}. Breaks below ${Math.round(bl.minor)}, worse below ${Math.round(bl.major)} and ${Math.round(bl.extreme)}.</div>`;

  h += '<h3>Right now</h3>';
  h += `<div class="now"><b>${esc(actText(c, p))}</b><span>${esc(whyText(p.act.why))}</span></div>`;
  const facts: string[] = [];
  if (home) facts.push(`Lives in <a class="who" data-b="${home.id}">${esc((home.name ?? TPL[home.k]?.name ?? 'a home').toLowerCase())}</a>`);
  else if (st >= 2) facts.push('Has no bed of their own');
  if (GOALS[p.goal]) facts.push(`Dreams of ${GOALS[p.goal]}`);
  if (p.coin > 0) facts.push(`${Math.round(p.coin)} silver to their name`);
  if (facts.length) h += `<div class="hint">${facts.join(' · ')}</div>`;

  h += '<h3>Needs</h3><div class="needs">';
  for (const [label, v] of [['Food', p.food], ['Rest', p.rest], ['Joy', p.joy], ['Company', p.soc], ['Health', p.hp]] as const) {
    h += `<span>${label}</span>${bar(v, needColor(v))}<b>${Math.round(v)}</b>`;
  }
  h += '</div>' + health(p);

  // Thoughts: lasting memories and how things are right now, biggest first.
  const th: [string, number][] = [];
  const nature = stat(p, 'moodBase');
  if (nature) th.push(['Their nature', nature]);
  for (const t of p.th) {
    if (t.x <= c.tick) continue;
    const d = TH[t.k];
    if (!d || !d.m) continue;
    const n = t.n ?? 1;
    th.push([thoughtText(c, t.k, t.o) + (n > 1 ? ` ×${n}` : ''), d.m * (1 + 0.5 * Math.min(3, n - 1))]);
  }
  for (const s of p.sit) if (s[1]) th.push([thoughtText(c, s[0], s[2]), s[1]]);
  th.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  h += `<h3>Thoughts <span class="legend">${th.length}</span></h3>`;
  h += th.length ? th.map(([t, v]) => `<div class="th"><span>${esc(t)}</span><b class="${tone(v)}">${sign(v)}</b></div>`).join('') : '<div class="hint">Nothing much on their mind.</div>';

  h += '<h3>Traits</h3>' + chips(p.traits, ui.open);
  h += '<h3>Backstory</h3>' + backs(p);

  h += '<h3>Skills <span class="legend"><span class="pas">◆</span> interested <span class="pas">◆◆</span> burning passion</span></h3><div class="skills">';
  let any = false;
  for (let s = 0; s < SKILL_NAMES.length; s++) {
    const lv = Math.floor(p.sk[s] ?? 0);
    const pas = p.pas[s] ?? 0;
    if (!lv && !pas) continue;
    any = true;
    h += `<span>${SKILL_NAMES[s]}</span>${bar((lv / 20) * 100, pas ? 'var(--accent)' : 'var(--faint)')}<b>${lv}<span class="pas">${pas === 2 ? ' ◆◆' : pas === 1 ? ' ◆' : ''}</span></b>`;
  }
  h += '</div>';
  if (!any) h += '<div class="hint">No skills to speak of yet.</div>';

  h += '<h3>Relationships</h3>' + relations(c, p, ui);
  h += '<h3>Life story</h3>' + story(c, p);
  return h;
}

export function deadCard(c: Colony, d: Dead): string {
  const age = Math.floor(yearsAt(d.born, d.died));
  const prof = PROFS[d.prof];
  let h = `<div class="head gone">${face(c, d, 88)}<div class="hd"><div class="nm">${esc(fullName(d))}</div>`;
  h += `<div class="sub">${esc(raceName(d.race))} · ${d.sex ? 'Male' : 'Female'} · ${STAGE_NAMES[stageOfAge(d.race, age)]}</div>`;
  h += `<div class="sub">${prof ? esc(prof.name) + ' · ' : ''}${esc(faithName(d.faith))}</div></div></div>`;
  h += `<div class="epitaph"><b>${esc(causeText(c, d))}</b><span>${dateText(d.died)}, aged ${age}</span>`;
  h += `<span>${d.born < 0 ? 'Born before the colony kept records' : 'Born ' + dateText(d.born)}</span>`;
  if (d.grave >= 0) h += `<button class="btn sm" data-tile="${d.grave}">Show the grave</button>`;
  else if (!d.left) h += '<span>No grave yet</span>';
  h += '</div>';

  // the people they left behind
  let kin = '';
  const add = (id: Id, label: string): void => { if (id && person(c, id)) kin += `<div class="th"><span>${label}</span><b>${whoLink(c, id)}</b></div>`; };
  add(d.sp, 'Partner');
  add(d.mo, 'Mother');
  add(d.fa, 'Father');
  for (const o of [...c.pawns, ...c.dead]) if (o.mo === d.id || o.fa === d.id) add(o.id, o.sex ? 'Son' : 'Daughter');
  if (kin) h += '<h3>Family</h3>' + kin;

  h += '<h3>Traits</h3>' + chips(d.traits, new Set(d.traits.map((k) => 'trait:' + k)));
  h += '<h3>Backstory</h3>' + backs(d);
  const last = `<div class="ln"><span class="y">${shortDate(d.died)}</span><span class="t"><b>${esc(causeText(c, d))}.</b></span></div>`;
  h += '<h3>Life story</h3>' + story(c, d, last);
  return h;
}

export function bldCard(c: Colony, b: Bld): string {
  const t = TPL[b.k];
  let h = `<div class="head"><div class="hd"><div class="nm">${esc(b.name ?? t?.name ?? b.k)}</div>`;
  h += `<div class="sub">${b.k === 'field' ? 'Farmland' : b.mat ? 'Stone-built' : 'Timber-built'} · ${b.built ? 'Raised ' + dateText(b.made) : 'Planned ' + dateText(b.made)}</div>`;
  h += `<div class="btns"><button class="btn sm" data-tile="${(b.y + Math.floor(b.h / 2)) * c.w + b.x + Math.floor(b.w / 2)}">Show on map</button></div></div></div>`;

  if (!b.built) {
    h += `<h3>Under construction</h3><div class="needs"><span>Built</span>${bar(b.prog * 100, 'var(--accent)')}<b>${Math.round(b.prog * 100)}%</b></div>`;
    const need: string[] = [];
    if (b.need.wood > 0.01) need.push(`${Math.ceil(b.need.wood)} wood`);
    if (b.need.stone > 0.01) need.push(`${Math.ceil(b.need.stone)} stone`);
    h += `<div class="hint">${need.length ? 'Still needs ' + need.join(' and ') + '.' : 'All materials are on site.'}</div>`;
  } else if (b.k !== 'field') {
    h += '<h3>Condition</h3><div class="needs">';
    h += `<span>Quality</span>${bar(b.q, 'var(--accent)')}<b>${Math.round(b.q)}</b>`;
    h += `<span>Damage</span>${bar(b.dmg, b.dmg > 40 ? 'var(--bad)' : '#fbbf24')}<b>${Math.round(b.dmg)}</b></div>`;
    h += `<div class="hint">${qualityWord(b.q)} work${b.dmg > 60 ? ', and falling apart' : b.dmg > 25 ? ', in need of repair' : ''}.</div>`;
  }

  if (b.k === 'field') {
    const crop = CROPS[b.crop ?? ''];
    let sum = 0;
    let n = 0;
    let ripe = 0;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const v = c.crop[y * c.w + x];
        n++;
        if (v >= 200) { ripe++; sum += 1; } else sum += v / 200;
      }
    }
    h += `<h3>Crop</h3><div class="now"><b>${esc(crop?.name ?? 'Nothing sown')}</b><span>${ripe ? `${ripe} of ${n} plots ripe` : sum > 0 ? 'Growing' : 'Bare soil'}</span></div>`;
    h += '<div class="needs">';
    h += `<span>Growth</span>${bar(n ? (sum / n) * 100 : 0, '#4ade80')}<b>${Math.round(n ? (sum / n) * 100 : 0)}%</b>`;
    h += `<span>Care</span>${bar(b.tend ?? 0, needColor(b.tend ?? 0))}<b>${Math.round(b.tend ?? 0)}</b></div>`;
  }

  if (b.beds.length) {
    h += `<h3>Who lives here <span class="legend">${b.beds.filter((x) => x).length} of ${b.beds.length} beds</span></h3>`;
    for (const id of b.beds) {
      const o = id ? c.pawns.find((p) => p.id === id) : undefined;
      h += o
        ? `<div class="row" data-p="${o.id}">${face(c, o, 34)}<div class="n"><b>${esc(fullName(o))}</b><small>${esc(raceName(o.race))}${o.prof && PROFS[o.prof] ? ' · ' + esc(PROFS[o.prof].name) : ''}</small></div></div>`
        : '<div class="row empty"><div class="n"><small>A free bed</small></div></div>';
    }
  }

  // who is under this roof at the moment
  const inside = c.pawns.filter((p) => c.sb[posAt(c, p, c.tick - 1)] === b.id);
  if (inside.length) {
    h += `<h3>Here now <span class="legend">${inside.length}</span></h3>`;
    for (const o of inside) h += `<div class="row" data-p="${o.id}">${face(c, o, 34)}<div class="n"><b>${esc(fullName(o))}</b><small class="plain">${esc(actText(c, o))}</small></div></div>`;
  }
  return h;
}
