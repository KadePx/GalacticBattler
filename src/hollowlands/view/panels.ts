// Everything on the page that is not the map: the top bar, the feed / people / colony panel
// and the card drawer. Plain DOM. Each part is rebuilt as HTML text a couple of times a
// second and only written to the page when the text actually changed. Read-only: nothing
// here touches the colony.

import { TICKS_PER_DAY } from '../config';
import { CROPS, TPL } from '../sim/data/buildings';
import { PROFS, PROF_LIST } from '../sim/data/professions';
import { RACES } from '../sim/data/races';
import { foodDays } from '../sim/econ';
import { FAITHS, mainFaith } from '../sim/faith';
import { GOVS, approval, rulerTitle } from '../sim/gov';
import { fullName, pawnById, person, stage } from '../sim/pawn';
import type { Colony, Dead, Id, Pawn } from '../sim/types';
import { WEIGHT, dateText, evText, raceName } from '../text';
import { bldCard, deadCard, face, linkNames, pawnCard, shortDate, type CardUi } from './card';
import { RES_NAMES, WEATHER, actText, causeText, esc, moodColor } from './words';

export type Sel = { k: 'pawn'; id: Id } | { k: 'dead'; id: Id } | { k: 'bld'; id: number } | null;
export type Tab = 'feed' | 'people' | 'colony';

/** What the controller tells the panels about the current view. */
export interface ViewState { sel: Sel; follow: Id; speed: number; /** my own colonist (living, or the last one lost), 0 for none */ me: Id }

/** What the panels ask the controller to do. */
export interface Hooks {
  speed(s: number): void;
  /** Open someone's card: a colonist, or a memorial if they are dead or gone. */
  person(id: Id): void;
  building(id: number): void;
  /** Centre the map on a tile. */
  tile(i: number): void;
  /** Toggle following the selected colonist. */
  follow(): void;
  /** Centre the map on the selected colonist. */
  find(): void;
  close(): void;
  /** Panels opened, closed or resized: the visible part of the map changed. */
  layout(): void;
  /** Lean on my colonist: a kind of nudge and who or what it is about. */
  nudge(k: string, v: number): void;
  /** Answer the question my colonist has been asked. */
  answer(v: string): void;
  /** Copy a link to the person whose card is open. */
  share(): void;
  /** Show what has happened to my colonist lately. */
  recap(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// Event kinds whose number is a person (elsewhere it is a count of guests or listeners).
const N_IS_ID = new Set(['birth', 'bastard_plain', 'found_out', 'defend', 'gossip']);

/** My colonist and the people closest to them: partner, parents and children, living or dead. */
function myCircle(c: Colony, me: Id): Set<Id> {
  const out = new Set<Id>([me]);
  const p = person(c, me);
  if (p) for (const id of [p.sp, p.mo, p.fa]) if (id) out.add(id);
  for (const o of c.pawns) if (o.mo === me || o.fa === me) out.add(o.id);
  for (const o of c.dead) if (o.mo === me || o.fa === me) out.add(o.id);
  return out;
}

const clock = (tick: number): string => {
  const t = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  return `${String(Math.floor(t / 10)).padStart(2, '0')}:${String((t % 10) * 6).padStart(2, '0')}`;
};

export class Panels {
  tab: Tab = 'feed';
  shut = false;
  private filter: 'all' | 'notable' | 'mine' = 'all';
  private sort: 'mood' | 'name' = 'mood';
  private ui: CardUi = { open: new Set(), allRel: false, following: false };
  private last = new Map<HTMLElement, string>();
  private holding = false;
  private dirty = true;
  private nextTop = 0;
  private nextBody = 0;
  private selKey = '';
  private feedKey = '';
  private feedHtml = '';
  private side = $('side');
  private sbody = $('sbody');
  private card = $('card');
  private cbody = $('cbody');

  constructor(private hooks: Hooks) {
    this.shut = this.phone(); // on a phone, start with the map in full view
    document.body.addEventListener('click', (e) => this.click(e));
    // While a finger or the mouse is down on a panel, hold off redrawing it: replacing the
    // element under the pointer would swallow the click.
    for (const el of [this.side, this.card]) el.addEventListener('pointerdown', () => { this.holding = true; });
    const release = (): void => { if (this.holding) { this.holding = false; this.dirty = true; } };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    $('sfold').addEventListener('click', () => this.fold(!this.shut));
    $('cclose').addEventListener('click', () => this.hooks.close());
    // The panels start below the top bar, however many lines it wraps to.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top', `${Math.round($('top').getBoundingClientRect().bottom + 8)}px`);
      this.hooks.layout();
    }).observe($('top'));
    this.syncTabs();
  }

  phone(): boolean {
    return window.innerWidth <= 760;
  }

  /** Show one of the left-hand panels by name. */
  open(name: string, toggle = false): void {
    if (name !== 'feed' && name !== 'people' && name !== 'colony') return;
    if (toggle && this.tab === name && !this.shut) { this.fold(true); return; }
    this.tab = name;
    this.shut = false;
    this.sbody.scrollTop = 0;
    this.syncTabs();
  }

  private fold(shut: boolean): void {
    this.shut = shut;
    this.syncTabs();
  }

  private syncTabs(): void {
    this.side.classList.toggle('shut', this.shut);
    document.querySelectorAll<HTMLElement>('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', !this.shut && b.dataset.tab === this.tab));
    $('sfold').textContent = this.shut ? '+' : '–';
    this.dirty = true;
    this.hooks.layout();
  }

  /** Screen space the panels cover, so the map can centre things in what is left. */
  insets(): { left: number; right: number; top: number; bottom: number } {
    const top = $('top').getBoundingClientRect().bottom;
    const cardOn = !this.card.classList.contains('hidden');
    if (this.phone()) {
      const a = this.side.getBoundingClientRect().top;
      const b = cardOn ? this.card.getBoundingClientRect().top : window.innerHeight;
      return { left: 0, right: 0, top, bottom: Math.max(0, window.innerHeight - Math.min(a, b)) };
    }
    return { left: this.shut ? 0 : this.side.getBoundingClientRect().right, right: cardOn ? window.innerWidth - this.card.getBoundingClientRect().left : 0, top, bottom: 0 };
  }

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-speed],[data-tab],[data-p],[data-b],[data-open],[data-act],[data-tile],[data-filter],[data-sort]');
    if (!t) return;
    const d = t.dataset;
    if (d.speed !== undefined) this.hooks.speed(Number(d.speed));
    else if (d.tab) this.open(d.tab, true);
    else if (d.p) this.hooks.person(Number(d.p));
    else if (d.b) this.hooks.building(Number(d.b));
    else if (d.tile) this.hooks.tile(Number(d.tile));
    else if (d.open) { if (!this.ui.open.delete(d.open)) this.ui.open.add(d.open); }
    else if (d.act === 'follow') this.hooks.follow();
    else if (d.act === 'find') this.hooks.find();
    else if (d.act === 'allrel') this.ui.allRel = !this.ui.allRel;
    else if (d.act === 'nudge' && d.k) this.hooks.nudge(d.k, Number(d.v));
    else if (d.act === 'answer' && d.v) this.hooks.answer(d.v);
    else if (d.act === 'share') this.hooks.share();
    else if (d.act === 'recap') this.hooks.recap();
    else if (d.filter === 'all' || d.filter === 'notable' || d.filter === 'mine') { this.filter = d.filter; this.feedKey = ''; }
    else if (d.sort === 'mood' || d.sort === 'name') this.sort = d.sort;
    this.dirty = true;
  }

  /** Write HTML into an element only if it differs from what is there. */
  private put(el: HTMLElement, html: string): void {
    if (this.last.get(el) === html) return;
    this.last.set(el, html);
    el.innerHTML = html;
  }

  /** Ask for a redraw on the next frame (selection changed, time jumped). */
  touch(): void {
    this.dirty = true;
    this.feedKey = '';
  }

  /** Called every frame; does real work a few times a second. `now` is real milliseconds. */
  update(c: Colony, v: ViewState, now: number): void {
    if (this.dirty || now >= this.nextTop) {
      this.nextTop = now + 200;
      this.top(c, v);
    }
    if (this.holding) return;
    if (this.dirty || now >= this.nextBody) {
      this.nextBody = now + 500;
      this.dirty = false;
      if (!this.shut) this.put(this.sbody, this.tab === 'feed' ? this.feed(c, v.me) : this.tab === 'people' ? this.people(c, v) : this.colony(c));
      this.drawCard(c, v);
    }
  }

  // ---------- Top bar ----------

  private top(c: Colony, v: ViewState): void {
    const fd = foodDays(c);
    this.put($('cname'), esc(c.name));
    this.put($('cdate'), dateText(c.tick, true));
    // `alarm` is newer than this bar: set while raiders or beasts are in the colony
    const alarm = (c as unknown as { alarm?: number }).alarm;
    this.put($('cstats'),
      (alarm ? '<span class="down"><b>Under attack</b></span>' : '') +
      `<span><b>${WEATHER[c.weather] ?? ''}</b> ${Math.round(c.temp)}°</span>` +
      `<span><b>${c.pawns.length}</b> ${c.pawns.length === 1 ? 'person' : 'people'}</span>` +
      `<span class="${fd < 3 ? 'down' : ''}"><b>${fd < 10 ? fd.toFixed(1) : Math.round(fd)}</b> days of food</span>`);
    document.querySelectorAll<HTMLElement>('#speed [data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === v.speed));
  }

  // ---------- Feed ----------

  private feed(c: Colony, me: Id): string {
    if (this.filter === 'mine' && !me) this.filter = 'all';
    const circle = this.filter === 'mine' ? myCircle(c, me) : null;
    const key = `${c.log.length}|${c.logBase}|${this.filter}|${me}|${circle ? circle.size : 0}`;
    if (key === this.feedKey) return this.feedHtml;
    this.feedKey = key;
    const chip = (k: string, label: string): string => `<button class="chip${this.filter === k ? ' on' : ''}" data-filter="${k}">${label}</button>`;
    let h = `<div class="filters">${chip('all', 'All')}${chip('notable', 'Notable')}${me ? chip('mine', 'My colonist') : '<button class="chip" disabled title="Make a colonist first">My colonist</button>'}</div>`;
    let n = 0;
    let day = -1;
    for (let i = c.log.length - 1; i >= 0 && n < 250; i--) {
      const e = c.log[i];
      const w = WEIGHT[e.k] ?? 1;
      if (this.filter === 'notable' && w < 2) continue;
      if (circle && !circle.has(e.a ?? 0) && !circle.has(e.b ?? 0) && !(N_IS_ID.has(e.k) && circle.has(e.n ?? 0))) continue;
      const d = Math.floor(e.t / TICKS_PER_DAY);
      if (d !== day) { day = d; h += `<div class="cen">${dateText(e.t)}</div>`; }
      h += `<div class="ln w${w}" title="${dateText(e.t, true)}"><span class="y">${clock(e.t)}</span><span class="t">${linkNames(c, evText(c, e), [e.a, e.b, N_IS_ID.has(e.k) ? e.n : undefined])}</span></div>`;
      n++;
    }
    if (!n) h += `<div class="hint">${this.filter === 'mine' ? 'Nothing has happened to them or theirs yet.' : this.filter === 'notable' ? 'Nothing of note yet. Give them time.' : 'Nothing has happened yet.'}</div>`;
    return (this.feedHtml = h);
  }

  // ---------- People ----------

  private people(c: Colony, v: ViewState): string {
    const chip = (k: string, label: string): string => `<button class="chip${this.sort === k ? ' on' : ''}" data-sort="${k}">${label}</button>`;
    let h = `<div class="filters"><span class="hint" style="margin:0 4px 0 0">Sort by</span>${chip('mood', 'Mood, lowest first')}${chip('name', 'Name')}</div>`;
    const list = c.pawns.slice().sort(this.sort === 'mood' ? (a, b) => a.mood - b.mood || a.id - b.id : (a, b) => a.first.localeCompare(b.first) || a.id - b.id);
    const selId = v.sel && v.sel.k === 'pawn' ? v.sel.id : 0;
    for (const p of list) h += this.personRow(c, p, p.id === selId, p.id === v.me);
    return h;
  }

  private personRow(c: Colony, p: Pawn, sel: boolean, mine: boolean): string {
    const trade = PROFS[p.prof]?.name ?? (stage(c, p) < 2 ? 'Child' : '');
    return `<div class="row${sel ? ' sel' : ''}" data-p="${p.id}">${face(c, p, 38)}<div class="n"><b>${esc(fullName(p))}${mine ? '<span class="tie kin">Yours</span>' : ''}</b><small>${esc(raceName(p.race))}${trade ? ' · ' + esc(trade) : ''}</small><small class="plain">${esc(actText(c, p))}</small></div>` +
      `<div class="v" title="Mood"><i class="dot" style="background:${moodColor(p)}"></i>${Math.round(p.mood)}</div></div>`;
  }

  // ---------- Colony ----------

  private colony(c: Colony): string {
    const fd = foodDays(c);
    let mood = 0;
    for (const p of c.pawns) mood += p.mood;
    let h = `<div class="stats"><div class="stat"><b>${c.pawns.length}</b><span>people</span></div><div class="stat"><b class="${fd < 3 ? 'down' : ''}">${fd < 10 ? fd.toFixed(1) : Math.round(fd)}</b><span>days of food</span></div><div class="stat"><b>${c.pawns.length ? Math.round(mood / c.pawns.length) : 0}</b><span>average mood</span></div></div>`;
    if (c.gath) {
      const a = person(c, c.gath.a ?? 0);
      const o = person(c, c.gath.o ?? 0);
      const what = c.gath.k === 'wedding' ? `The wedding of ${a?.first ?? 'someone'} and ${o?.first ?? 'someone'}` : c.gath.k === 'funeral' ? `The funeral of ${a ? fullName(a) : 'someone'}` : c.gath.k === 'trial' ? `The trial of ${a ? fullName(a) : 'someone'}` : c.gath.k === 'sermon' ? `${a?.first ?? 'The priest'} will preach` : c.gath.k === 'feast' ? 'A feast in the hall' : c.gath.k === 'audience' ? `${a?.first ?? 'The ruler'} will hear petitions` : 'A gathering';
      h += `<div class="note">${linkNames(c, what, [c.gath.a, c.gath.o])}: ${dateText(c.gath.t0, true)}.</div>`;
    }

    // who rules, and how
    const ruler = pawnById(c, c.gov.ruler);
    const gov = GOVS[c.gov.k];
    h += `<h3>Rule <span class="legend">${esc(gov?.name ?? '')}</span></h3>`;
    if (ruler) {
      const app = Math.round(approval(c));
      const years = Math.max(0, Math.floor((c.tick - c.gov.since) / (TICKS_PER_DAY * 60)));
      h += `<div class="th"><span>${esc(rulerTitle(c, ruler))}</span><b><a class="who" data-p="${ruler.id}">${esc(fullName(ruler))}</a></b></div>`;
      h += `<div class="th"><span>Has ruled</span><b>${years < 1 ? 'under a year' : years + (years === 1 ? ' year' : ' years')}</b></div>`;
      h += `<div class="th"><span title="Average opinion of the ruler among adults">Standing with the colony</span><b class="${app > 5 ? 'up' : app < -5 ? 'down' : ''}">${app > 0 ? '+' : ''}${app}</b></div>`;
      const regent = pawnById(c, c.gov.regent);
      if (regent) h += `<div class="th"><span>Regent</span><b><a class="who" data-p="${regent.id}">${esc(fullName(regent))}</a></b></div>`;
      if (c.gov.k === 'lord') {
        const heir = c.pawns.filter((p) => p.mo === ruler.id || p.fa === ruler.id).sort((a, b) => a.born - b.born)[0];
        h += `<div class="th"><span>Heir</span><b>${heir ? `<a class="who" data-p="${heir.id}">${esc(heir.first)}</a>` : 'None'}</b></div>`;
      }
      if (c.gov.k === 'council') h += `<div class="th"><span>Next vote</span><b>${dateText(c.gov.next)}</b></div>`;
      for (const [title, id] of Object.entries(c.gov.titles)) {
        const who = pawnById(c, id);
        if (who) h += `<div class="th"><span>${esc(title[0].toUpperCase() + title.slice(1))}</span><b><a class="who" data-p="${who.id}">${esc(fullName(who))}</a></b></div>`;
      }
      const laws: string[] = [c.gov.laws.harsh >= 2 ? 'Harsh justice' : c.gov.laws.harsh === 0 ? 'Lenient justice' : 'Even-handed justice'];
      if (c.gov.laws.ration) laws.push('Food is rationed');
      if (c.gov.laws.tax) laws.push('The ruler takes a cut of all wages');
      h += `<div class="hint">${laws.join(' · ')}. ${esc(gov?.blurb ?? '')}</div>`;
    } else h += '<div class="hint">Nobody rules here.</div>';
    if (c.plot) {
      const lead = pawnById(c, c.plot.lead);
      if (lead) h += `<div class="note">Unknown to the ruler, <a class="who" data-p="${lead.id}">${esc(lead.first)}</a> is gathering people against them: ${c.plot.mem.length} so far.</div>`;
    }
    let chained = 0;
    let sworn = 0;
    for (const p of c.pawns) { if (p.thrall) chained++; if (p.cult) sworn++; }
    const bits: string[] = [];
    if (chained) bits.push(`${chained} held in thrall`);
    if (sworn) bits.push(`${sworn} secretly sworn to the Hollow Mother`);
    if (c.ruins) bits.push(`built over the ruins of ${esc(c.ruins)}`);
    if (c.near?.length) bits.push(`neighbours: ${c.near.map((n) => esc(n.name)).join(', ')}`);
    if (bits.length) h += `<div class="hint">${bits.join(' · ')}.</div>`;
    if (c.trials.length) {
      const tr = c.trials[0];
      const acc = pawnById(c, tr.a);
      if (acc) h += `<div class="note"><a class="who" data-p="${acc.id}">${esc(acc.first)}</a> stands accused of ${tr.k === 'assault' ? 'attempted murder' : tr.k}${c.trials.length > 1 ? ` (and ${c.trials.length - 1} more waiting)` : ''}.</div>`;
    }
    const mf = FAITHS[mainFaith(c)];
    if (mf) {
      const faiths = new Map<string, number>();
      for (const p of c.pawns) if (stage(c, p) >= 2) faiths.set(p.faith, (faiths.get(p.faith) ?? 0) + 1);
      h += `<h3>Faith <span class="legend">${esc(mf.name)}</span></h3>`;
      for (const [k, n] of [...faiths].sort((a, b) => b[1] - a[1])) h += `<div class="th"><span title="${esc(FAITHS[k]?.blurb ?? '')}">${esc(FAITHS[k]?.name ?? k)}</span><b>${n}</b></div>`;
      const saints = c.dead.filter((d) => d.saint);
      if (saints.length) h += `<div class="hint">Prayed to here: ${saints.map((d) => `<a class="who" data-p="${d.id}">${esc(d.first + ' ' + d.fam)}</a>`).join(', ')}.</div>`;
    }

    // who lives here, by people and by age
    const byRace = new Map<string, number>();
    const ages = [0, 0, 0];
    for (const p of c.pawns) {
      byRace.set(p.race, (byRace.get(p.race) ?? 0) + 1);
      const st = stage(c, p);
      ages[st < 3 ? 0 : st === 3 ? 1 : 2]++;
    }
    h += `<h3>Peoples <span class="legend">${ages[0]} young · ${ages[1]} grown · ${ages[2]} old</span></h3>`;
    for (const [k, n] of [...byRace].sort((a, b) => b[1] - a[1])) {
      const R = RACES[k as keyof typeof RACES];
      h += `<div class="th"><span title="${esc(R?.blurb ?? '')}">${esc(n === 1 ? R?.name ?? k : R?.plural ?? k)}</span><b>${n}</b></div>`;
    }

    h += '<h3>Trades</h3>';
    let trades = '';
    for (const def of PROF_LIST) {
      const who = c.pawns.filter((p) => p.prof === def.k);
      if (who.length) trades += `<div class="th"><span title="${esc(def.blurb)}">${esc(def.name)}</span><b>${who.map((p) => `<a class="who" data-p="${p.id}">${esc(p.first)}</a>`).join(', ')}</b></div>`;
    }
    h += trades || '<div class="hint">Nobody holds a trade yet.</div>';

    h += '<h3>Stores</h3><div class="store">';
    for (const k in c.stock) {
      const n = c.stock[k as keyof typeof c.stock];
      if (n >= 0.5) h += `<div class="th"><span>${esc(RES_NAMES[k] ?? k)}</span><b>${Math.round(n)}</b></div>`;
    }
    h += '</div>';

    h += `<h3>Buildings <span class="legend">${c.blds.length}</span></h3>`;
    for (const b of c.blds) {
      const name = b.name ?? TPL[b.k]?.name ?? b.k;
      const living = b.beds.filter((x) => x).length;
      const sub = !b.built ? `Being built, ${Math.round(b.prog * 100)}%` : b.k === 'field' ? CROPS[b.crop ?? '']?.name ?? 'Fallow' : b.beds.length ? `${living} of ${b.beds.length} beds taken` : b.dmg > 25 ? 'Needs repair' : '';
      h += `<div class="row" data-b="${b.id}"><div class="n"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="v">${b.built ? '' : '<span class="tie kin">building</span>'}</div></div>`;
    }

    h += `<h3>The dead and departed <span class="legend">${c.dead.length}</span></h3>`;
    if (!c.dead.length) h += '<div class="hint">Nobody yet.</div>';
    for (let i = c.dead.length - 1; i >= 0; i--) h += this.deadRow(c, c.dead[i]);
    return h;
  }

  private deadRow(c: Colony, d: Dead): string {
    return `<div class="row gone" data-p="${d.id}">${face(c, d, 34)}<div class="n"><b>${esc(fullName(d))}</b><small class="plain">${esc(causeText(c, d))}</small></div><div class="v"><small>${shortDate(d.died)}</small></div></div>`;
  }

  // ---------- Card drawer ----------

  private drawCard(c: Colony, v: ViewState): void {
    const s = v.sel;
    let title = '';
    let body = '';
    if (s?.k === 'pawn') {
      const p = pawnById(c, s.id);
      if (p) { this.ui.following = v.follow === p.id; this.ui.mine = v.me === p.id; title = p.first; body = pawnCard(c, p, this.ui); }
    } else if (s?.k === 'dead') {
      const d = c.dead.find((x) => x.id === s.id);
      if (d) { title = d.left ? 'Gone from the colony' : 'In memory'; body = deadCard(c, d); }
    } else if (s?.k === 'bld') {
      const b = c.blds.find((x) => x.id === s.id);
      if (b) { title = b.name ?? TPL[b.k]?.name ?? 'Building'; body = bldCard(c, b); }
    }
    const was = this.card.classList.contains('hidden');
    this.card.classList.toggle('hidden', !body);
    if (!body) { if (!was) this.hooks.layout(); return; }
    const key = s ? s.k + s.id : '';
    if (key !== this.selKey) {
      // a different subject: start at the top with everything folded
      this.selKey = key;
      this.ui.open.clear();
      this.ui.allRel = false;
      if (s?.k === 'pawn') { const p = pawnById(c, s.id); if (p) body = pawnCard(c, p, this.ui); }
      this.cbody.scrollTop = 0;
    }
    this.put($('ctitle'), esc(title));
    this.put(this.cbody, body);
    if (was) this.hooks.layout();
  }
}
