// Commonworld viewer (milestone 2): runs the sim locally, records history, and shows it on a
// PixiJS map with a timeline, a chronicle reader and civ pages. In milestone 4 the local sim
// is swapped for snapshots from the server; everything below the sim stays the same.

import { decodeOwner, frameRoutes, frameSetts, History, liveSetts, type SettView } from './history';
import { line } from './chronicle';
import { createWorld, serialize, step, worldHash, AGES, TICKS_PER_YEAR, TIER_NAMES, type World } from './sim/index';
import { BIOMES } from './sim/worldgen';
import { getJson, loadOlderEvents, loadWorld, loadYears, sync } from './net';
import { myHash } from './identity';
import { Founding, type Pending } from './view/founding';
import { SIM_V } from './sim/types';
import { MapView, civColor, type MapState, type Mode, type Stance } from './view/map';
import { banner, chronHtml, civHtml, esc, fmt, inspectHtml, peoplesHtml, type Ctx } from './view/panels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
// Live by default; ?local=1 runs a private world in the browser (fast-forward, for development).
const online = !q.has('local');

// ---- State ----
let w: World;
let hist: History;
let viewYear: number | null = null; // null = live
let replaying = false;
let playing = true;
let worldId = '';
let clockSkew = 0; // server time minus local time
let nextAt = 0; // server time of the next month
let turnstileKey: string | null = null;
let me = ''; // public hash of this visitor
let myCiv = -1; // the people this visitor founded
let pending: Pending | null = null; // settlers on the road
let founding: Founding | null = null;
try { pending = JSON.parse(localStorage.getItem('cw.pending') ?? 'null'); } catch { pending = null; }
let speed = 5; // years per second
let mode: Mode = 'political';
let selCiv = -1;
let selTile = -1;
type DrawerKind = { k: 'peoples' } | { k: 'civ'; civ: number } | { k: 'chron' };
let drawer: DrawerKind[] = [];
const chron: Ctx['chron'] = { major: true, scope: 'world', q: '', limit: 200 };
let peoplesQ = '';
let ownerScratch = new Int16Array(0);

const map = new MapView();

const lastYear = () => hist.lastYear;
const shownYear = () => viewYear ?? lastYear();

// ---- What the screen shows for the current year ----

interface View {
  owner: Int16Array; setts: SettView[]; ruins: number[]; monuments: number[]; capitals: Set<number>;
  routes: [number, number, boolean][]; battles: number[]; sieges: number[];
}
let viewCache: { key: string; v: View } | null = null;

function view(): View {
  const year = shownYear();
  const key = viewYear === null ? `live${w.tick}` : `y${year}`;
  if (viewCache?.key === key) return viewCache.v;
  const until = year * TICKS_PER_YEAR + TICKS_PER_YEAR - 1;
  let v: View;
  if (viewYear === null) {
    v = {
      owner: w.t.owner,
      setts: liveSetts(w),
      ruins: w.setts.filter((s) => s.died >= 0).map((s) => s.tile),
      monuments: w.setts.filter((s) => s.died < 0 && s.monument).map((s) => s.tile),
      capitals: new Set(w.civs.filter((c) => c.died < 0).map((c) => c.capital)),
      routes: frameRoutes(w, null),
      battles: recentBattles(until),
      sieges: w.setts.filter((s) => s.died < 0 && s.siege > 0).map((s) => s.tile),
    };
  } else {
    const f = hist.frameAt(year);
    if (ownerScratch.length !== w.W * w.H) ownerScratch = new Int16Array(w.W * w.H);
    const setts = f ? frameSetts(w, f) : [];
    const alive = new Set(setts.map((s) => s.id));
    const caps = new Map<number, number>();
    const mons: number[] = [];
    for (const e of w.log) {
      if (e.t > until) break;
      if ((e.k === 'found_civ' || e.k === 'secede' || e.k === 'capital_move') && e.a !== undefined && e.s !== undefined) caps.set(e.a, e.s);
      if (e.k === 'monument' && e.s !== undefined && alive.has(e.s)) mons.push(w.setts[e.s].tile);
    }
    v = {
      owner: f ? decodeOwner(f, ownerScratch) : ownerScratch.fill(-1),
      setts,
      ruins: w.setts.filter((s) => s.died >= 0 && s.died <= until).map((s) => s.tile),
      monuments: mons,
      capitals: new Set(caps.values()),
      routes: frameRoutes(w, f),
      battles: recentBattles(until),
      sieges: [],
    };
  }
  viewCache = { key, v };
  return v;
}

/** Places where blood was shed in the last two years. */
function recentBattles(until: number): number[] {
  const out = new Set<number>();
  for (let i = w.log.length - 1; i >= 0; i--) {
    const e = w.log[i];
    if (e.t > until) continue;
    if (e.t < until - 24) break;
    if ((e.k === 'battle' || e.k === 'conquest') && e.s !== undefined) out.add(w.setts[e.s].tile);
  }
  return [...out];
}

/** How every civ stood with the selected one in the shown year (or who was at war, with none selected). */
function stances(): Map<number, Stance> {
  const until = shownYear() * TICKS_PER_YEAR + TICKS_PER_YEAR - 1;
  const m = new Map<number, Stance>();
  const atWarNow = (war: (typeof w.wars)[number]) => war.start <= until && (war.end < 0 || war.end > until);
  if (selCiv < 0) {
    for (const c of w.civs) m.set(c.id, 'peace');
    for (const war of w.wars) if (atWarNow(war)) for (const c of [war.atk, war.def, ...war.atkAllies, ...war.defAllies]) m.set(c, 'war');
    return m;
  }
  m.set(selCiv, 'self');
  for (const e of w.log) {
    if (e.t > until) break;
    if (e.b === undefined || (e.a !== selCiv && e.b !== selCiv) || e.a === undefined) continue;
    const o = e.a === selCiv ? e.b : e.a;
    if (e.k === 'contact' || e.k === 'secede' || e.k === 'crisis') { if (!m.has(o)) m.set(o, 'peace'); }
    else if (e.k === 'pact') m.set(o, 'pact');
    else if (e.k === 'ally') m.set(o, 'ally');
    else if (e.k === 'ally_end' || e.k === 'pact_end') m.set(o, 'peace');
  }
  for (const war of w.wars) {
    if (!atWarNow(war)) continue;
    const A = [war.atk, ...war.atkAllies];
    const D = [war.def, ...war.defAllies];
    const enemies = A.includes(selCiv) ? D : D.includes(selCiv) ? A : [];
    for (const o of enemies) m.set(o, 'war');
  }
  return m;
}

function ctx(): Ctx {
  const v = view();
  return { w, hist, year: shownYear(), live: viewYear === null, setts: v.setts, owner: v.owner, selCiv, chron };
}

// ---- Map ----

function updateMap(): void {
  const v = view();
  const st: MapState = { ...v, stance: mode === 'diplomacy' ? stances() : new Map(), mode, selCiv, key: `${viewYear === null ? 'L' + w.tick : 'Y' + shownYear()}|${mode}|${selCiv}` };
  map.selTile = selTile;
  map.update(st);
}

// ---- Top bar ----

const SEASONS = ['deep winter', 'late winter', 'early spring', 'spring', 'late spring', 'early summer', 'high summer', 'late summer', 'early autumn', 'autumn', 'late autumn', 'early winter'];

function updateTop(): void {
  const y = shownYear();
  const yearEl = $('year');
  yearEl.innerHTML = `${online || viewYear !== null ? '<span class="live"></span> ' : ''}Year ${y} AW`;
  yearEl.classList.toggle('past', viewYear !== null);
  const v = view();
  const civs = new Set(v.setts.map((s) => s.civ));
  const pop = v.setts.reduce((a, s) => a + s.pop, 0);
  let age = 0;
  for (const e of w.log) {
    if (e.t > y * TICKS_PER_YEAR + TICKS_PER_YEAR - 1) break;
    if (e.k === 'age') age = e.n ?? age;
  }
  const wars = w.wars.filter((x) => x.start <= y * TICKS_PER_YEAR + 11 && (x.end < 0 || x.end > y * TICKS_PER_YEAR + 11)).length;
  let clock = '';
  if (online && viewYear === null && nextAt) {
    const s = Math.max(0, Math.round((nextAt - (Date.now() + clockSkew)) / 1000));
    clock = ` · ${SEASONS[w.tick % 12]} · next month in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  $('wstats').textContent = `${viewYear !== null ? 'Looking back · ' : ''}${AGES[age]} Age${clock} · ${wars ? `${wars} ${wars === 1 ? 'war' : 'wars'} · ` : ''}${civs.size} peoples · ${v.setts.length} settlements · ${fmt(pop)} souls`;
}

// ---- Timeline ----

const track = $('track');
const MARK_KINDS: Record<string, string> = { found_civ: '#7c8cff', secede: '#d68fd0', crisis: '#d68fd0', civ_fall: '#ff4a3a', war: '#e8873a', conquest: '#c0392b', plague_start: '#9fcf6a', monument: '#7fb6e8', age: '#ffffff' };
let marksFor = '';

function updateTimeline(): void {
  const max = Math.max(1, lastYear());
  const y = shownYear();
  const pct = (100 * y) / max;
  (track.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
  (track.querySelector('.knob') as HTMLElement).style.left = `${pct}%`;
  $('tyear').textContent = String(y);
  $('live').classList.toggle('on', viewYear === null);
  $('play').textContent = playing ? '❚❚' : '▶';
  // Markers only need rebuilding when the scale or the selection changes noticeably.
  const mkKey = `${Math.round(Math.log(max) * 20)}|${selCiv}|${w.log.length >> 6}`;
  if (mkKey === marksFor) return;
  marksFor = mkKey;
  const marks: string[] = [];
  for (const e of w.log) {
    const col = MARK_KINDS[e.k];
    if (!col || (e.k === 'found_civ' && e.t === 0)) continue;
    const player = e.k === 'found_civ' && e.a !== undefined && !!w.civs[e.a]?.founder;
    // With no one selected, only the turning points of the world: new ages, falls, newcomers.
    if (selCiv >= 0 ? e.a !== selCiv && e.b !== selCiv && e.k !== 'age' : !(e.k === 'age' || e.k === 'civ_fall' || player)) continue;
    const big = e.k === 'age' || player || e.k === 'civ_fall';
    marks.push(`<div class="mk ${big ? 'big' : ''}" style="left:${(100 * e.t) / TICKS_PER_YEAR / max}%;background:${col};color:${col}"></div>`);
  }
  $('marks').innerHTML = marks.slice(-400).join('');
  const room = Math.max(3, Math.floor(track.clientWidth / 56)); // labels need ~56px each
  const stepY = [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => max / s <= room) ?? 10000;
  const ticks: string[] = [];
  for (let t = 0; t <= max; t += stepY) ticks.push(`<span style="left:${(100 * t) / max}%">${t}</span>`);
  (track.querySelector('.ticks') as HTMLElement).innerHTML = ticks.join('');
}

function goYear(y: number | null): void {
  if (y !== null && y >= lastYear()) y = null;
  viewYear = y === null ? null : Math.max(0, Math.round(y));
  if (viewYear === null) replaying = false;
  refreshAll();
}

function trackYear(clientX: number): number {
  const r = track.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * lastYear());
}
track.addEventListener('pointerdown', (e) => {
  track.setPointerCapture(e.pointerId);
  replaying = false;
  goYear(trackYear(e.clientX));
  const move = (ev: PointerEvent) => goYear(trackYear(ev.clientX));
  const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up);
});
$('live').onclick = () => goYear(null);
$('replay').onclick = () => { replaying = true; viewYear = 0; refreshAll(); };
$('play').onclick = () => { playing = !playing; updateTimeline(); };
$<HTMLSelectElement>('speed').onchange = (e) => { speed = Number((e.target as HTMLSelectElement).value); };

// ---- Modes ----

const MODES: [Mode, string][] = [['political', 'Peoples'], ['diplomacy', 'Diplomacy'], ['trade', 'Trade'], ['population', 'Population'], ['stability', 'Stability'], ['fertility', 'Fertility'], ['terrain', 'Terrain']];
function renderModes(): void {
  $('modes').innerHTML = MODES.map(([m, label]) => `<button class="btn ${m === mode ? 'on' : ''}" data-mode="${m}">${label}</button>`).join('');
}
$('modes').onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode as Mode;
  renderModes();
  updateMap();
};

// ---- Drawer ----

function openDrawer(d: DrawerKind, push = true): void {
  if (d.k === 'civ') { selCiv = d.civ; chron.scope = 'civ'; }
  if (push) drawer.push(d);
  else drawer = [d];
  chron.limit = 200;
  refreshAll();
  $('dbody').scrollTop = 0;
}

function renderDrawer(): void {
  const el = $('drawer');
  const top = drawer[drawer.length - 1];
  el.classList.toggle('hidden', !top);
  if (!top) return;
  $('dback').classList.toggle('hidden', drawer.length < 2);
  const c = ctx();
  const body = $('dbody');
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active && body.contains(active) ? active.id : '';
  const caret = focusId ? active!.selectionStart : null;
  const scroll = body.scrollTop;
  if (top.k === 'peoples') {
    $('dtitle').textContent = 'Peoples of the world';
    body.innerHTML = peoplesHtml(c, peoplesQ);
  } else if (top.k === 'civ') {
    $('dtitle').innerHTML = `<span style="color:${civColor(w.civs[top.civ].hue, 70)}">The ${esc(w.civs[top.civ].name)}</span>`;
    body.innerHTML = civHtml(c, top.civ);
  } else {
    $('dtitle').textContent = 'Chronicle';
    body.innerHTML = chronHtml(c);
  }
  body.scrollTop = scroll;
  if (focusId) {
    const inp = document.getElementById(focusId) as HTMLInputElement | null;
    if (inp) { inp.focus(); if (caret !== null) inp.setSelectionRange(caret, caret); }
  }
}

$('dclose').onclick = () => { drawer = []; selCiv = -1; refreshAll(); };
$('dback').onclick = () => { drawer.pop(); const t = drawer[drawer.length - 1]; if (t?.k === 'civ') selCiv = t.civ; refreshAll(); };
for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-open]'))) {
  b.onclick = () => {
    const k = b.dataset.open as 'peoples' | 'chron';
    if (k === 'chron') chron.scope = selCiv >= 0 ? 'civ' : 'world';
    openDrawer({ k }, false);
  };
}

function handlePanelClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const el = t.closest<HTMLElement>('[data-civ],[data-tile],[data-chron],[data-scope],#cmajor,#cmore,#ix');
  if (!el) return;
  e.preventDefault();
  if (el.id === 'ix') { selTile = -1; map.selTile = -1; refreshAll(); return; }
  if (el.id === 'cmajor') { chron.major = !chron.major; renderDrawer(); return; }
  if (el.id === 'cmore') { chron.limit += 200; renderDrawer(); return; }
  if (el.dataset.scope) { chron.scope = el.dataset.scope as 'world' | 'civ'; renderDrawer(); return; }
  if (el.dataset.chron) { selCiv = Number(el.dataset.chron); chron.scope = 'civ'; openDrawer({ k: 'chron' }); return; }
  if (el.dataset.civ) { openDrawer({ k: 'civ', civ: Number(el.dataset.civ) }); return; }
  if (el.dataset.tile) {
    const tile = Number(el.dataset.tile);
    // Clicking a chronicle line shows the map as it was that year.
    if (el.dataset.year !== undefined) {
      const y = Number(el.dataset.year);
      if (y < lastYear()) { replaying = false; viewYear = y; }
    }
    selTile = tile;
    map.focus(tile, 4);
    refreshAll();
  }
}
$('dbody').addEventListener('click', handlePanelClick);
$('inspect').addEventListener('click', handlePanelClick);
$('dbody').addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'psearch') peoplesQ = t.value;
  if (t.id === 'csearch') { chron.q = t.value; chron.limit = 200; }
  renderDrawer();
});

// ---- Inspector and hover ----

function renderInspect(): void {
  const el = $('inspect');
  el.classList.toggle('hidden', selTile < 0);
  if (selTile >= 0) el.innerHTML = inspectHtml(ctx(), selTile);
}

map.onClick = (tile) => {
  if (founding?.pickTile(tile)) return;
  selTile = tile;
  const o = tile >= 0 ? view().owner[tile] : -1;
  if (o >= 0 && o !== selCiv) {
    selCiv = o;
    chron.scope = 'civ';
    const top = drawer[drawer.length - 1];
    if (top?.k === 'civ') drawer[drawer.length - 1] = { k: 'civ', civ: o };
  } else if (o < 0 && drawer[drawer.length - 1]?.k !== 'civ') selCiv = -1;
  refreshAll();
};

const tip = $('tip');
map.onHover = (tile, x, y) => {
  if (tile < 0) { tip.classList.add('hidden'); return; }
  const v = view();
  const s = v.setts.find((z) => z.tile === tile);
  const o = v.owner[tile];
  tip.innerHTML = s
    ? `<b>${esc(w.setts[s.id].name)}</b> · ${TIER_NAMES[s.tier]} · ${fmt(s.pop)} <span style="color:${civColor(w.civs[s.civ].hue, 70)}">${esc(w.civs[s.civ].name)}</span>`
    : `${BIOMES[w.t.biome[tile]].n}${o >= 0 ? ` · <span style="color:${civColor(w.civs[o].hue, 70)}">${esc(w.civs[o].name)}</span>` : ''}`;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 12}px`;
  tip.classList.remove('hidden');
};

// ---- Founding and your people ----

function savePending(p: Pending | null): void {
  pending = p;
  try {
    if (p) localStorage.setItem('cw.pending', JSON.stringify(p));
    else localStorage.removeItem('cw.pending');
  } catch { /* private mode */ }
  renderDock();
}

function openFounding(keep?: ConstructorParameters<typeof Founding>[1]): void {
  if (!online || myCiv >= 0 || pending) return;
  drawer = [];
  selTile = -1;
  refreshAll();
  $('welcome').classList.add('hidden');
  founding = new Founding({
    world: () => w,
    map,
    turnstileKey,
    onSent: (p) => {
      founding = null;
      savePending(p);
      toast(`<b>Your settlers have set out.</b><br>They reach their new home when the month turns.`, 7000);
    },
    onClose: () => { founding = null; renderDock(); },
  }, keep);
  renderDock();
}

/** After each sync: have this visitor's settlers arrived? */
function checkMine(): void {
  if (!me) return;
  const c = w.civs.find((x) => x.founder === me);
  if (c && myCiv < 0) {
    myCiv = c.id;
    const wasPending = !!pending;
    savePending(null);
    map.setMarkers([], -1);
    if (wasPending) {
      const cap = w.setts[c.capital];
      map.focus(cap.tile, 4);
      openDrawer({ k: 'civ', civ: c.id }, false);
      toast(`<b>The ${esc(c.name)} have arrived.</b><br>The first hearth is lit at ${esc(cap.name)}. Their story begins.`, 9000);
    }
  } else if (!c && pending && Date.now() + clockSkew > pending.eta + 30_000) {
    // The month turned without them: ask the server what happened.
    void getJson<{ status: string }>(`me?f=${me}`).then((r) => {
      if (r.status === 'failed') {
        savePending(null);
        map.setMarkers([], -1);
        toast('<b>Another people reached that land first.</b><br>Choose a new homeland for your settlers.', 9000);
        openFounding();
      } else if (r.status === 'none') savePending(null);
    }).catch(() => undefined);
  }
  renderDock();
}

function renderDock(): void {
  const b = $('mine');
  if (!online) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  if (myCiv >= 0) {
    b.className = 'btn mine';
    b.innerHTML = `${banner(w.civs[myCiv], 14)} The ${esc(w.civs[myCiv].name)}`;
  } else if (pending) {
    const s = Math.max(0, Math.round((pending.eta - (Date.now() + clockSkew)) / 1000));
    b.className = 'btn mine';
    b.innerHTML = s > 0 ? `<span class="live"></span>On the road · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '<span class="live"></span>Arriving…';
  } else {
    b.className = `btn gold ${founding ? 'on' : ''}`;
    b.innerHTML = 'Found your people';
  }
}

$('mine').onclick = () => {
  if (myCiv >= 0) {
    map.focus(w.setts[w.civs[myCiv].capital].tile, 3);
    openDrawer({ k: 'civ', civ: myCiv }, false);
  } else if (pending) map.focus(pending.tile, 4);
  else if (founding) founding.close();
  else openFounding();
};

let toastTimer = 0;
function toast(html: string, ms = 5000): void {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
}
$('toast').onclick = () => $('toast').classList.add('hidden');

function welcome(): void {
  let seen = false;
  try { seen = localStorage.getItem('cw.welcomed') === '1'; } catch { /* private mode */ }
  if (seen || !online || myCiv >= 0 || pending) return;
  $('welcome').classList.remove('hidden');
}
$('welcome').onclick = (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-w]')?.dataset.w;
  if (!a) return;
  try { localStorage.setItem('cw.welcomed', '1'); } catch { /* private mode */ }
  $('welcome').classList.add('hidden');
  if (a === 'found') openFounding();
};

// ---- Loop ----

function refreshAll(): void {
  updateMap();
  updateTop();
  updateTimeline();
  renderDrawer();
  renderInspect();
}

function advance(ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    step(w);
    hist.record(w);
  }
}

let acc = 0;
let replayAcc = 0;
let last = performance.now();
let lastMap = 0;
let lastPanel = 0;
let lastClock = 0;
let syncChanged = false;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  let changed = false;
  if (online && now - lastClock > 1000) {
    lastClock = now;
    updateTop();
    if (pending) renderDock();
  }
  if (playing && !online) {
    acc += dt * speed * TICKS_PER_YEAR;
    const t0 = performance.now();
    while (acc >= 1 && performance.now() - t0 < 10) {
      const y0 = lastYear();
      advance(1);
      acc--;
      if (lastYear() !== y0) changed = true;
    }
    if (acc > 24) acc = 24;
  }
  if (replaying && viewYear !== null) {
    replayAcc += dt * Math.max(8, lastYear() / 40);
    if (replayAcc >= 1) {
      const add = Math.floor(replayAcc);
      replayAcc -= add;
      viewYear = viewYear + add;
      if (viewYear >= lastYear()) { viewYear = null; replaying = false; }
      changed = true;
    }
  }
  if (syncChanged) {
    syncChanged = false;
    changed = true;
    lastMap = 0;
    lastPanel = 0;
  }
  if (changed) {
    if (now - lastMap > (viewYear === null ? 220 : 60)) {
      updateMap();
      updateTop();
      updateTimeline();
      lastMap = now;
    }
    // Live panels follow the world, but not so often that reading becomes hard.
    if ((viewYear === null || replaying) && now - lastPanel > 1500) {
      const top = drawer[drawer.length - 1];
      if ((top && top.k !== 'peoples') || selTile >= 0) { renderDrawer(); renderInspect(); }
      lastPanel = now;
    }
  }
  requestAnimationFrame(frame);
}

// ---- Live sync ----

/** Download the live world and its history. */
async function loadLive(loading: HTMLElement): Promise<void> {
  loading.textContent = 'REACHING THE WORLD…';
  const { w: lw, st } = await loadWorld();
  if (st.simV !== SIM_V) throw new Error(`version ${st.simV} vs ${SIM_V}`);
  w = lw;
  worldId = st.world;
  clockSkew = st.now - Date.now();
  nextAt = st.next;
  turnstileKey = (st as unknown as { turnstile: string | null }).turnstile;
  hist = new History(2);
  const last = Math.floor(w.tick / TICKS_PER_YEAR);
  await loadYears(hist, 0, last, (y) => { loading.textContent = `READING THE ANNALS · YEAR ${y}`; });
  await loadOlderEvents(w, 6000);
}

async function syncLoop(): Promise<void> {
  let wait = 20_000;
  try {
    const r = await sync(w, worldId, () => hist.record(w));
    if (r.ok) {
      clockSkew = r.now - Date.now();
      nextAt = r.next;
      if (r.steps) { syncChanged = true; checkMine(); }
      wait = Math.max(3000, Math.min(60_000, r.next - r.now + 1500));
    } else {
      // Out of step (or the world was reset): start again from a fresh snapshot.
      console.warn('[cw] resync:', r.reason);
      const old = worldId;
      const { w: lw, st } = await loadWorld();
      if (st.world !== old) { location.reload(); return; }
      if (w.logBase < lw.logBase) {
        // Keep the older history we already have in front of the server's recent events.
        lw.log = w.log.slice(0, lw.logBase - w.logBase).concat(lw.log);
        lw.logBase = w.logBase;
      }
      w = lw;
      await loadYears(hist, hist.lastYear + 1, Math.floor(w.tick / TICKS_PER_YEAR));
      viewCache = null;
      map.setWorld(w);
      syncChanged = true;
      wait = 5000;
    }
  } catch (e) {
    console.warn('[cw] sync failed', e);
    wait = 30_000;
  }
  setTimeout(syncLoop, wait);
}

// ---- Boot ----

async function boot(): Promise<void> {
  await Promise.race([document.fonts.load('600 14px Inter'), new Promise((r) => setTimeout(r, 2500))]);
  const loading = $('loading');
  if (online) {
    try {
      await loadLive(loading);
    } catch (e) {
      console.error('[cw]', e);
      loading.innerHTML = `<div style="text-align:center;max-width:420px;padding:20px;font-size:18px;line-height:1.5">The world is resting and can't be reached right now.<br><br><a href="?local=1&pre=300">Watch a private world instead</a></div>`;
      return;
    }
    $('speed').classList.add('hidden');
    $('play').classList.add('hidden');
  } else {
    w = createWorld({ seed: Number(q.get('seed')) || 1, civs: Number(q.get('civs')) || 20 });
    hist = new History(2);
    hist.record(w);
    const pre = Number(q.get('pre')) || 0;
    for (let y = 0; y < pre; y += 25) {
      advance(Math.min(25, pre - y) * TICKS_PER_YEAR);
      loading.textContent = `SHAPING THE WORLD · YEAR ${Math.min(pre, y + 25)}`;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await map.init($('map'));
  map.setWorld(w);
  loading.classList.add('hidden');
  renderModes();
  refreshAll();
  requestAnimationFrame(frame);
  if (online) {
    setTimeout(syncLoop, 3000);
    me = await myHash();
    const mine = w.civs.find((c) => c.founder === me);
    if (mine) { myCiv = mine.id; savePending(null); }
    else {
      const r = await getJson<{ status: string; eta?: number }>(`me?f=${me}`).catch(() => ({ status: 'none' }) as { status: string; eta?: number });
      if (r.status === 'pending' && !pending) savePending({ name: 'your people', tile: -1, eta: r.eta ?? Date.now(), skew: clockSkew });
      if (r.status !== 'pending' && pending) savePending(null);
      if (r.status === 'failed') toast('<b>Your settlers could not reach their land.</b><br>Choose a new homeland.', 8000);
    }
    renderDock();
    welcome();
  }
}

boot();

// ---- Dev hooks ----
(window as unknown as { __world: unknown }).__world = {
  get w() { return w; },
  get hist() { return hist; },
  map,
  online,
  years(n: number) { if (online) throw new Error('the live world moves with real time'); advance(n * TICKS_PER_YEAR); refreshAll(); },
  syncNow: () => syncLoop(),
  found: () => openFounding(),
  get me() { return { me, myCiv, pending }; },
  pause() { playing = false; updateTimeline(); },
  play(s?: number) { playing = true; if (s) speed = s; updateTimeline(); },
  goYear,
  select(civ: number) { selCiv = civ; refreshAll(); },
  open(k: 'peoples' | 'chron' | number) { openDrawer(typeof k === 'number' ? { k: 'civ', civ: k } : { k }, false); },
  mode(m: Mode) { mode = m; renderModes(); updateMap(); },
  hash: () => worldHash(w),
  dump: () => serialize(w),
  line: (i: number) => line(w, w.log[i], w.logBase + i).text,
};
