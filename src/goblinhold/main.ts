// Goblin Hold: game loop, input, and the DOM HUD.
import { ambience, isMusicOn, isMuted, sfx, toggleMusic, toggleMute, unlock } from './audio';
import {
  BUILD, BUILD_ORDER, BuildKind, DAY_LEN, DUSK_LEN, GOBS, GobKind, Job, JOB_ORDER, JOBS, LINE_KINDS, MAP_H, MAP_W, MAX_SPEED, MEMORIES, RELICS, RES_ORDER,
  KEEP_LEVELS, OMENS, UPGRADES, PROMO_GOLD, PROMO_MOOD, PROMO_XP, PROMOS, SEASON_DAYS, SEASONS, TILE, TRADE_LOT, TRAITS,
} from './defs';
import { eventDef, resolveEvent } from './events';
import { CHARTERS, checkCharters, refillCharters, rewardText } from './goals';
import { applyUnlocks, bankRun, buyUnlock, loadMeta, UNLOCKS } from './meta';
import { bld, bldAtTile, rebuild } from './map';
import { buildingIcon, clampCam, draw, invalidateTerrain, screenToTile, Sel, spawnFx, Tool, View } from './render';
import {
  activity, applicantText, dayLen, assignPost, avgMood, bedCount, beginDay, buildCost, buyOffer, callDusk, canAfford, canTrade, costText, demolish, efficiency,
  bedsOf, canPromote, events, fortify, upgrade, GOODS, promoOf, promote, hasMarket, mood, moodParts, newGame, place, placeWalls, price, season, seasonDay, setJob, soundHorn, step, toasts, trade, unlocked,
  wallLine, year,
} from './sim';
import { icon, iconOf, settlerSprites, toDataURL, goblinSprites } from './sprites';
import { clearSave, Game, getBest, loadGame, saveGame, Settler } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>('game');
const ctx = cv.getContext('2d')!;

let g: Game | null = null;
let speed = 1;
let lastSpeed = 1;
let postMode = 0; // settler id waiting for a post
let barTab: 'build' | 'defend' = 'build';
const view: View = { cam: { x: 0, y: 0, z: 2 }, sel: null, tool: null, hover: null, drag: null, w: 0, h: 0, dpr: 1 };

// ---------- sizing ----------
function resize() {
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  cv.width = Math.round(view.w * view.dpr);
  cv.height = Math.round(view.h * view.dpr);
  clampCam(view);
}
window.addEventListener('resize', resize);
resize();

function centerOnKeep() {
  if (!g) return;
  const k = bld(g, g.keepId)!;
  view.cam.x = (k.x + 1.5) * TILE;
  view.cam.y = (k.y + 2) * TILE;
  view.cam.z = view.w < 760 ? 2 : 3;
  clampCam(view);
}

// ---------- icons ----------
const IMG: Record<string, string> = {};
function setupIcons() {
  for (const r of RES_ORDER) IMG[r] = toDataURL(icon(r), 2);
  for (const k of BUILD_ORDER) IMG[k] = iconOf(buildingIcon(k), 36);
  IMG.keep = iconOf(buildingIcon('keep'), 36);
  IMG.demolish = toDataURL(icon('hammer'), 4);
  IMG.settlers = iconOf(settlerSprites('builder', 3)[0], 36);
  IMG.people = toDataURL(icon('people'), 2);
  IMG.trade = toDataURL(icon('gold'), 4);
  IMG.scroll = toDataURL(icon('scroll'), 3);
  for (const [id, r] of Object.entries(RELICS)) IMG['relic_' + id] = toDataURL(icon(r.icon), 3);
  for (const k of Object.keys(GOBS) as GobKind[]) IMG['gob_' + k] = iconOf(goblinSprites(k)[0], 20);
  for (const r of RES_ORDER) { const el = document.getElementById('i-' + r) as HTMLImageElement | null; if (el) el.src = IMG[r]; }
  ($('i-pop') as HTMLImageElement).src = IMG.people;
  ($('i-roster') as HTMLImageElement).src = IMG.people;
}
const resIcon = (r: string) => `<img class="ico" src="${IMG[r]}" alt="${r}">`;
function costHTML(c: Partial<Record<string, number>>) {
  const parts = RES_ORDER.filter((r) => c[r]).map((r) => `${c[r]}${resIcon(r)}`);
  return parts.join(' ') || 'free';
}

// ---------- build bar ----------
function buildBar() {
  if (!g) return;
  const bar = $('bar');
  const tools = BUILD_ORDER.filter((k) => BUILD[k].cat === barTab);
  const tabs = `<div class="tabs"><button data-tab="build" class="${barTab === 'build' ? 'on' : ''}">Build</button><button data-tab="defend" class="${barTab === 'defend' ? 'on' : ''}">Defend</button></div>`;
  const items = tools.map((t) => {
    const d = BUILD[t];
    const locked = !unlocked(g!, t);
    return `<button class="tool${locked ? ' locked' : ''}" data-tool="${t}" data-tip="<b>${d.name}</b> · ${locked ? 'blueprint needed' : costText(d.cost)}<br>${d.desc}${locked ? '<br><i>Find the blueprint in goblin loot, at merchant caravans, from events or charters.</i>' : ''}"><span class="key">${d.key.toUpperCase()}</span><img src="${IMG[t]}" alt=""><span class="nm">${d.name.replace('Arrow tower', 'Tower').replace('Guard post', 'Post').replace("Healer's hut", 'Healer')}</span><span class="cost">${locked ? 'blueprint' : costHTML(d.cost)}</span></button>`;
  }).join('');
  const extra = `<span class="sep"></span>
    <button class="tool util" data-tool="demolish" data-tip="<b>Demolish</b><br>Tear down a structure for half its cost back (Q)."><span class="key">Q</span><img src="${IMG.demolish}" alt=""><span class="nm">Demolish</span></button>
    <button class="tool util" data-act="trade" data-tip="<b>Market</b><br>Buy and sell goods. Needs a market building or a visiting caravan (U)."><span class="key">U</span><img src="${IMG.trade}" alt=""><span class="nm">Market</span><span class="cost" id="bar-trade"></span></button>
    <button class="tool util" data-act="roster" data-tip="<b>Settlers</b><br>Everyone in the hold, their jobs and moods (R)."><span class="key">R</span><img src="${IMG.settlers}" alt=""><span class="nm">Settlers</span><span class="cost" id="bar-pop"></span></button>`;
  bar.innerHTML = tabs + `<div class="tools">${items}${extra}</div>`;
  refreshBar();
}

function clearTool() { view.tool = null; view.drag = null; pendingPlace = null; refreshChip(); refreshBar(); }

function setTool(t: Tool) {
  if (t && t !== 'demolish' && g && !unlocked(g, t)) { showToast(`${BUILD[t].name}: you need the blueprint first. Look for it in goblin loot, merchant caravans and events.`, 'warn'); return; }
  view.tool = view.tool === t ? null : t;
  view.drag = null;
  postMode = 0;
  $('postHint').classList.remove('show');
  if (view.tool) { view.sel = null; renderCard(true); }
  if (t && t !== 'demolish' && BUILD[t].cat !== barTab) { barTab = BUILD[t].cat; buildBar(); }
  pendingPlace = null;
  sfx('click');
  refreshBar();
  refreshChip();
}

let pendingPlace: { x: number; y: number } | null = null;
function refreshChip() {
  const c = $('toolChip');
  document.body.classList.toggle('tooling', !!view.tool);
  if (!view.tool) { c.classList.remove('show'); return; }
  const name = view.tool === 'demolish' ? 'Demolish' : BUILD[view.tool].name;
  const line = view.tool !== 'demolish' && LINE_KINDS.includes(view.tool);
  const hint = coarse() ? (line ? 'drag to lay a line' : pendingPlace ? 'tap again to confirm' : 'tap to place') : line ? 'drag to lay a line' : 'click to place, right-click to stop';
  $('chipText').innerHTML = `<b>${name}</b> <span class="dim">${hint}</span>`;
  c.classList.add('show');
}
const coarse = () => matchMedia('(pointer: coarse)').matches;

function refreshBar() {
  if (!g) return;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tool[data-tool]'))) {
    const t = el.dataset.tool as BuildKind | 'demolish';
    el.classList.toggle('on', view.tool === t);
    el.classList.toggle('poor', t !== 'demolish' && unlocked(g, t) && !canAfford(g, t));
  }
  const p = document.getElementById('bar-pop');
  const idle = idleSettlers().length;
  if (p) p.textContent = idle ? `${idle} idle` : `${g.settlers.length}/${bedCount(g)} beds`;
  const badge = $('idleBadge');
  badge.textContent = String(idle);
  badge.style.display = idle ? '' : 'none';
  const tr = document.getElementById('bar-trade');
  if (tr) tr.textContent = g.merchant ? 'caravan!' : hasMarket(g) ? 'open' : 'no market';
  const tb = document.querySelector<HTMLElement>('.tool[data-act="trade"]');
  if (tb) tb.classList.toggle('glow', !!g.merchant);
}

$('bar').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const tab = el.closest('[data-tab]') as HTMLElement | null;
  if (tab) { barTab = tab.dataset.tab as 'build' | 'defend'; buildBar(); sfx('click'); return; }
  const b = el.closest('button') as HTMLElement | null;
  if (!b) return;
  if (coarse() && b.dataset.tip) showTip(b, b.dataset.tip, 3500);
  if (b.dataset.act === 'roster') { toggleRoster(); return; }
  if (b.dataset.act === 'trade') { toggleTrade(); return; }
  setTool(b.dataset.tool as Tool);
});
$('chipDone').addEventListener('click', () => { setTool(null); pendingPlace = null; refreshChip(); });

// ---------- tips (hover on desktop, tap on touch) ----------
let tipTimer = 0, tipHide = 0;
function showTip(el: Element, html: string, ms = 0) {
  const tip = $('tip');
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
  let y = r.top < 140 ? r.bottom + 8 : r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  clearTimeout(tipHide);
  if (ms) tipHide = window.setTimeout(hideTip, ms);
}
function hideTip() { $('tip').classList.remove('show'); }
document.addEventListener('pointerover', (e) => {
  if ((e as PointerEvent).pointerType !== 'mouse') return;
  const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
  clearTimeout(tipTimer);
  if (!el) { hideTip(); return; }
  tipTimer = window.setTimeout(() => showTip(el, el.dataset.tip!), 300);
});
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
  if (coarse() && el && !el.closest('#bar')) showTip(el, el.dataset.tip!, 3500);
  else if (!el) hideTip();
}, true);
// static titles in the page become tips too
for (const el of Array.from(document.querySelectorAll<HTMLElement>('#top [title]'))) { el.dataset.tip = el.title; el.removeAttribute('title'); }

// ---------- top bar ----------
const BUFF_NAME: Record<string, string> = { survey: 'Surveyor', leak: 'Leaked maps', noomen: 'Omens turned', oath: 'Oath sworn', ambush: 'Ambushers', wolves: 'Wolves', drums: 'War drums', defector: 'Defector', embargo: 'Embargo', coldsnap: 'Cold snap' };
const BUFF_TEXT: Record<string, string> = {
  survey: 'Upgrades cost half today.', leak: 'Raids are 20% larger: the guild\u2019s maps leaked.', noomen: 'No omens on the next blood nights.', oath: 'Your next charter pays double. Fail and the herald fines you.',
  ambush: 'The goblins who robbed the cart join tonight’s raid.',
  wolves: 'Woodcutting is halved today.', drums: 'Tonight: 40% more goblins, double gold per kill.', defector: 'Raids are 20% smaller.',
  embargo: 'The guilds shun you: market prices are worse.', coldsnap: 'Settlers lose warmth twice as fast.',
};
let confirmEnd = false;
let confirmTimer = 0;
const nudged: { dusk: number; food: number; beds: number; build: number } = { dusk: 0, food: 0, beds: 0, build: 0 };
/** Rough days of food left: each settler eats about 1.7 food a day. */
function foodDays(g: Game) { return g.settlers.length ? g.res.food / (g.settlers.length * 2.5) : 99; }
function idleSettlers() {
  if (!g) return [];
  return g.settlers.filter((s) => s.away <= 0 && (s.job === 'idle' || (JOBS[s.job].needs && !g!.blds.some((b) => b.kind === JOBS[s.job].needs && b.done))));
}
let idleIdx = 0;
function cycleIdle() {
  const list = idleSettlers();
  if (!list.length) { toggleRoster(); return; }
  const s = list[idleIdx++ % list.length];
  view.sel = { t: 's', id: s.id }; clearTool();
  view.cam.x = s.x * TILE; view.cam.y = s.y * TILE; clampCam(view);
  if (coarse()) { $('roster').classList.remove('show'); $('trade').classList.remove('show'); }
  renderCard(true);
}
function totalWave(g: Game) { return g.wave.groups.reduce((a, gr) => a + gr.count, 0); }

function refreshTop() {
  if (!g) return;
  const topB = $('top').getBoundingClientRect().bottom, fcB = $('forecast').getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--topB', `${Math.round(topB)}px`);
  document.documentElement.style.setProperty('--fcB', `${Math.round(Math.max(topB, fcB))}px`);
  const sea = season(g);
  $('day').textContent = `DAY ${g.day}`;
  $('season').textContent = `${SEASONS[sea].name} ${seasonDay(g)}/${SEASON_DAYS}${year(g) > 1 ? ` · Y${year(g)}` : ''}`;
  $('season').className = 'season ' + sea;
  const ph = g.phase;
  const left = Math.max(0, Math.ceil(dayLen(g) - g.phaseT));
  $('phase').textContent = ph === 'day' ? `Dusk in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ph === 'dusk' ? 'Dusk' : ph === 'night' ? 'Night' : 'Dawn';
  $('progbox').classList.toggle('late', ph === 'day' && left <= 20);
  const f = ph === 'day' ? g.phaseT / dayLen(g) : ph === 'dusk' ? g.phaseT / DUSK_LEN : ph === 'night' ? 1 - (g.spawn.length + g.goblins.length) / Math.max(1, totalWave(g)) : 1;
  $('prog').style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  $('progbox').classList.toggle('night', ph === 'night' || ph === 'dusk');
  for (const k of RES_ORDER) {
    const el = $('r-' + k);
    const v = Math.floor(g.res[k]);
    el.querySelector('b')!.textContent = String(v);
    if (k === 'food') {
      const days = foodDays(g);
      el.classList.toggle('low', days < 1.5);
      el.dataset.tip = `<b>Food</b> · lasts about ${days > 30 ? 'many' : days.toFixed(1)} days<br>Settlers eat at the keep. Farms (not in winter), foragers, fishers and the market bring more.`;
    }
  }
  $('pop').textContent = `${g.settlers.length}/${bedCount(g)}`;
  $('pop').parentElement!.classList.toggle('low', g.settlers.length > bedCount(g));
  const m = avgMood(g);
  const mv = $('moodv');
  mv.textContent = String(m);
  mv.className = m >= 65 ? 'good' : m >= 40 ? '' : 'bad';
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('#speed button'))) b.classList.toggle('on', Number(b.dataset.speed) === speed);
  $('speedCycle').textContent = `${speed || lastSpeed}x`;
  $('speedCycle').classList.toggle('on', speed > 0);
  // relics and effects
  const relics = g.relics.map((r) => `<img src="${IMG['relic_' + r]}" alt="" data-tip="<b>${RELICS[r].name}</b><br>${RELICS[r].desc}">`).join('');
  const buffs = g.buffs.map((b) => `<span class="buff" data-tip="${BUFF_TEXT[b.id] ?? b.id}">${BUFF_NAME[b.id] ?? b.id}</span>`).join('');
  const shelf = relics + buffs;
  const rel = $('relics');
  if (rel.dataset.html !== shelf) { rel.dataset.html = shelf; rel.innerHTML = shelf; rel.style.display = shelf ? '' : 'none'; }
  // forecast
  const w = g.wave;
  const counts: Partial<Record<GobKind, number>> = {};
  for (const gr of w.groups) counts[gr.kind] = (counts[gr.kind] ?? 0) + gr.count;
  const comp = (Object.keys(counts) as GobKind[]).map((k) => `<span class="gob" data-tip="<b>${GOBS[k].name}</b><br>${GOBS[k].desc}"><img src="${IMG['gob_' + k]}" alt="">${counts[k]}</span>`).join('');
  const from = [...new Set(w.groups.map((gr) => g!.entries[gr.entry].name))].join(' + ');
  const omen = w.omen ? ` <span class="buff" data-tip="<b>Omen: ${OMENS[w.omen].name}</b><br>${OMENS[w.omen].desc}">${OMENS[w.omen].name}</span>` : '';
  const label = (w.kind === 'boss' ? `<b class="boss">${w.groups.some((x) => x.kind === 'warchief') ? 'BOSS NIGHT' : 'WARBAND'}</b>` : w.kind === 'assault' ? '<b class="assault">Assault</b>' : '<b>Raid</b>') + omen;
  const btn = $<HTMLButtonElement>('phaseBtn');
  const fc = $('fc-text');
  let html = '';
  if (ph === 'day' || ph === 'dusk') html = `${ph === 'day' ? '<span class="dim">Tonight</span> ' : ''}${label} ${comp} <span class="dim">from the ${from}</span>`;
  else if (ph === 'night') { const left = g.spawn.length + g.goblins.length; html = `${label} <span class="dim">${left} goblin${left === 1 ? '' : 's'} left</span>`; }
  else html = 'Dawn breaks.';
  if (fc.dataset.html !== html) { fc.dataset.html = html; fc.innerHTML = html; }
  if (ph === 'day') { btn.textContent = confirmEnd ? 'Sure? Tap again' : 'End day ▸'; btn.className = 'act' + (confirmEnd ? ' warnbtn' : ''); btn.disabled = false; btn.dataset.tip = 'End the day early: guards go to their posts and the night starts after dusk.'; }
  else if (ph === 'dusk') { btn.textContent = `Start night (${Math.ceil(DUSK_LEN - g.phaseT)})`; btn.className = 'act horn'; btn.disabled = false; btn.dataset.tip = 'Skip the rest of dusk and bring on the raid.'; }
  else if (ph === 'night') { btn.textContent = 'Defend!'; btn.className = 'act horn'; btn.disabled = true; }
  else { btn.textContent = ''; btn.disabled = true; }
  btn.style.display = ph === 'dawn' ? 'none' : '';
}

$('phaseBtn').addEventListener('click', () => {
  if (!g) return;
  if (g.phase === 'day') {
    const early = g.day <= 2 || g.phaseT < dayLen(g) * 0.5;
    const tutPointing = (g.tut ?? -1) >= 0 && STEPS[g.tut!]?.glow === 'phaseBtn';
    if (early && !confirmEnd && !tutPointing) { confirmEnd = true; clearTimeout(confirmTimer); confirmTimer = window.setTimeout(() => { confirmEnd = false; refreshTop(); }, 4000); refreshTop(); return; }
    clearTimeout(confirmTimer);
    confirmEnd = false;
    callDusk(g);
  } else if (g.phase === 'dusk') soundHorn(g);
  if (speed === 0) setSpeed(1);
});
$('speed').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (b) setSpeed(b.dataset.speed === 'cycle' ? (speed >= 3 || speed === 0 ? 1 : speed + 1) : Number(b.dataset.speed));
});
function setSpeed(s: number) {
  if (s > 0) lastSpeed = s;
  speed = Math.max(0, Math.min(MAX_SPEED, s));
  refreshTop();
}

// ---------- in-place DOM patching ----------
// Panels refresh several times a second; patching keeps buttons alive so clicks never get lost.
function patchChildren(target: Node, source: Node) {
  const a = Array.from(target.childNodes), b = Array.from(source.childNodes);
  for (let i = 0; i < b.length; i++) {
    const o = a[i], n = b[i];
    if (!o) { target.appendChild(n.cloneNode(true)); continue; }
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { target.replaceChild(n.cloneNode(true), o); continue; }
    if (o.nodeType === Node.TEXT_NODE) { if (o.textContent !== n.textContent) o.textContent = n.textContent; continue; }
    const oe = o as Element, ne = n as Element;
    for (const at of Array.from(oe.attributes)) if (!ne.hasAttribute(at.name)) oe.removeAttribute(at.name);
    for (const at of Array.from(ne.attributes)) if (oe.getAttribute(at.name) !== at.value) oe.setAttribute(at.name, at.value);
    if (oe.tagName === 'SELECT') { (oe as HTMLSelectElement).value = (ne.querySelector('option[selected]') as HTMLOptionElement | null)?.value ?? (oe as HTMLSelectElement).value; }
    patchChildren(oe, ne);
  }
  for (let i = a.length - 1; i >= b.length; i--) target.removeChild(a[i]);
}
function patch(el: HTMLElement, html: string) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchChildren(el, t.content);
}

// ---------- selection card ----------
let cardHTML = '';
function needBar(label: string, v: number) {
  const c = v < 25 ? 'var(--red)' : v < 50 ? 'var(--gold)' : 'var(--green)';
  return `<span>${label}</span><div class="nb"><i style="width:${Math.round(v)}%;background:${c}"></i></div>`;
}

function settlerCard(s: Settler): string {
  const m = mood(g!, s);
  const parts = moodParts(g!, s).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
  const traits = s.traits.map((t) => `<span class="trait" title="${TRAITS[t]?.desc ?? ''}">${TRAITS[t]?.name ?? t}</span>`).join('');
  const jobs = JOB_ORDER.map((j) => {
    const jd = JOBS[j];
    const cost = jd.gold && !s.gear.includes(j) ? `<small>${jd.gold}g gear</small>` : '';
    const missing = jd.needs && !g!.blds.some((b) => b.kind === jd.needs && b.done) ? ' warn' : '';
    return `<button data-job="${j}" class="${s.job === j ? 'on' : ''}${missing}" title="${jd.desc}">${jd.name}${cost}</button>`;
  }).join('');
  const home = s.home ? (bld(g!, s.home)?.kind === 'barracks' ? 'Bunks in the barracks' : 'Has a bed') : 'No bed';
  const post = JOBS[s.job].combat
    ? `<div class="row"><span class="desc" style="flex:1">Post: ${s.post && bld(g!, s.post) ? BUILD[bld(g!, s.post)!.kind].name : 'automatic'}</span><button class="small" data-act="post">Assign post</button>${s.post ? '<button class="small" data-act="autopost">Auto</button>' : ''}</div>`
    : '';
  let promo = '';
  if (JOBS[s.job].combat) {
    const p = promoOf(s);
    if (p) promo = `<div class="promo"><b>${PROMOS[p].name}</b> · ${PROMOS[p].desc}</div>`;
    else if (canPromote(g!, s)) {
      const paths = Object.entries(PROMOS).filter(([, d]) => d.job === s.job);
      promo = `<div class="promo ready"><b>Ready for promotion!</b> ${PROMO_GOLD}${resIcon('gold')}${mood(g!, s) < PROMO_MOOD ? ` · needs mood ${PROMO_MOOD}` : ''}<div class="row">${paths.map(([id, d]) => `<button class="small" data-promo="${id}" title="${d.desc}"><b>${d.name}</b></button>`).join('')}</div><div class="desc">${paths.map(([, d]) => `${d.name}: ${d.desc}`).join('<br>')}</div></div>`;
    } else promo = `<div class="xp"><span>Experience</span><div class="nb"><i style="width:${Math.min(100, Math.round((s.xp / PROMO_XP) * 100))}%;background:var(--blue)"></i></div></div>`;
  }
  const eff = Math.round(efficiency(g!, s) * 100);
  const sick = s.sick > 0 ? '<span class="trait bad">Feverish</span>' : '';
  return `<h3><span><img class="portrait" src="${iconOf(settlerSprites(s.job, s.look)[0], 22)}" alt="">${s.name}</span><button class="x" data-act="close">&times;</button></h3>
    <div class="sub">${JOBS[s.job].name} · ${activity(g!, s)} · ${home}</div>
    <div>${traits}${sick}</div>
    ${promo}
    <div class="jobs">${jobs}</div>
    ${post}
    <div class="needs">
      <span>Health</span><div class="nb"><i style="width:${Math.round((s.hp / s.maxHp) * 100)}%;background:${s.hp < s.maxHp * 0.5 ? 'var(--red)' : 'var(--green)'}"></i></div>
      ${needBar('Hunger', s.needs.hunger)}${needBar('Rest', s.needs.rest)}${needBar('Warmth', s.needs.warmth)}${needBar('Safety', s.needs.safety)}
    </div>
    <div class="moodline"><span>Mood <b>${m}</b> · works at <b>${eff}%</b></span><span>${m >= 76 ? 'Inspired' : m < 15 ? 'Breaking down' : m < 30 ? 'Miserable' : ''}</span></div>
    <div class="mems">${parts.map((p) => `<div class="moodline"><span>${p.label}</span><span class="${p.v >= 0 ? 'pos' : 'neg'}">${p.v > 0 ? '+' : ''}${p.v}</span></div>`).join('') || '<span class="desc">Nothing much on their mind.</span>'}</div>
`;
}

function buildingCard(id: number): string {
  const b = bld(g!, id);
  if (!b) return '';
  const d = BUILD[b.kind];
  let extra = '';
  const who = (pred: (s: Settler) => boolean) => g!.settlers.filter(pred).map((s) => s.name);
  if (b.kind === 'tower' || b.kind === 'ballista') {
    const occ = g!.settlers.find((s) => s.id === b.occupant);
    const posted = g!.settlers.find((s) => s.post === b.id);
    extra = `<div class="desc">${occ ? `Manned by <b>${occ.name}</b>` : b.kind === 'tower' ? 'Unmanned: fires a slow crossbow.' : 'No crew: it will not fire.'}${posted && !occ ? ` ${posted.name} will man it at dusk.` : ''}</div>
      <div class="row"><button class="small" data-act="garrison">Post an archer</button></div>`;
  } else if (b.kind === 'hut' || b.kind === 'barracks') {
    const res = who((s) => s.home === b.id);
    extra = `<div class="desc">Beds: ${res.length}/${bedsOf(b)}${res.length ? ' · ' + res.join(', ') : ''}</div>`;
  } else if (b.kind === 'healer') {
    const pts = who((s) => s.inside === b.id);
    const healers = who((s) => s.job === 'healer');
    extra = `<div class="desc">Patients: ${pts.length ? pts.join(', ') : 'none'} · Healers: ${healers.length ? healers.join(', ') : 'none (make someone a healer)'}</div>`;
  } else if (b.kind === 'flag') {
    const ms = [...new Set(who((s) => s.post === b.id || (s.task?.k === 'guard' && s.task.id === b.id)))];
    extra = `<div class="desc">${ms.length ? 'Guarded by ' + ms.join(', ') : 'Militia will muster here at dusk.'}</div>`;
  } else if (b.kind === 'farm') {
    const f = g!.settlers.find((s) => s.task?.k === 'farm' && s.task.id === b.id);
    extra = `<div class="desc">${season(g!) === 'winter' ? 'Frozen until spring.' : f ? `${f.name} is working it.` : 'No farmer working it right now.'}</div>`;
  } else if (b.kind === 'market') {
    const t = who((s) => s.job === 'trader');
    extra = `<div class="desc">Trader: ${t.length ? t.join(', ') : 'none (prices are worse without one)'}</div><div class="row"><button class="small" data-act="trade">Open market</button></div>`;
  } else if (b.kind === 'brazier') {
    extra = `<div class="desc">${g!.phase === 'night' ? (b.lit ? 'Burning.' : 'Unlit: there was no wood for it.') : 'Will burn 2 wood at nightfall.'}</div>`;
  } else if (b.kind === 'keep') {
    const lv = b.level ?? 0;
    const L = KEEP_LEVELS[lv], N = KEEP_LEVELS[lv + 1];
    extra = `<div class="desc">${RES_ORDER.map((r) => `${resIcon(r)} ${Math.floor(g!.res[r])}`).join(' &nbsp; ')}</div>
      <div class="desc">${L.name}: arrow slits hit for ${L.dmg} at range ${L.range}.</div>
      ${N ? `<div class="row"><button class="small" data-act="fortify">Fortify into ${N.name.toLowerCase()} · ${costHTML(N.cost)}</button></div><div class="desc">${N.hp} health, slits hit for ${N.dmg} at range ${N.range}.</div>` : ''}`;
  }
  const status = b.done ? (b.kind === 'flag' ? '' : b.kind === 'trap' ? (b.sprung ? 'Sprung: re-dug at dawn for 2 wood' : 'Armed') : `Health ${Math.ceil(b.hp)}/${b.maxHp}`) : `Under construction ${Math.floor((b.progress / d.work) * 100)}% · needs a builder`;
  return `<h3><span><img class="portrait" src="${IMG[b.kind] ?? ''}" alt="">${b.kind === 'keep' ? KEEP_LEVELS[b.level ?? 0].name : d.name}</span><button class="x" data-act="close">&times;</button></h3>
    <div class="sub">${status}</div>
    <div class="desc">${d.desc}</div>
    ${extra}
    ${upgradeHTML(b)}
    ${b.kind !== 'keep' ? `<div class="row"><button class="small danger" data-act="demolish">${b.done ? 'Demolish (50% back)' : 'Cancel (full refund)'}</button></div>` : ''}`;
}

function upgradeHTML(b: NonNullable<ReturnType<typeof bld>>) {
  const ups = UPGRADES[b.kind];
  if (!ups || !b.done) return '';
  const lv = b.level ?? 0;
  const have = ups.slice(0, lv).map((u) => `<span class="trait">${u.name}</span>`).join('');
  const next = ups[lv];
  return `<div class="upg">${have}${next ? `<div class="row"><button class="small" data-act="upgrade"><b>Upgrade:</b>&nbsp;${next.name} · ${costHTML(g!.buffs.some((x) => x.id === 'survey') ? Object.fromEntries(Object.entries(next.cost).map(([k, v]) => [k, Math.ceil((v ?? 0) / 2)])) : next.cost)}</button></div><div class="desc">${next.desc}</div>` : '<div class="desc">Fully upgraded.</div>'}</div>`;
}

function renderCard(force = false) {
  const card = $('card');
  let html = '';
  if (g && view.sel) {
    if (view.sel.t === 's') { const s = g.settlers.find((q) => q.id === view.sel!.id); html = s ? settlerCard(s) : ''; }
    else if (view.sel.t === 'b') html = buildingCard(view.sel.id);
    else {
      const gb = g.goblins.find((q) => q.id === view.sel!.id);
      if (gb) { const d = GOBS[gb.kind]; html = `<h3><span><img class="portrait" src="${IMG['gob_' + gb.kind]}" alt="">${d.name}</span><button class="x" data-act="close">&times;</button></h3><div class="sub">Goblin · Health ${Math.ceil(gb.hp)}/${gb.maxHp}</div><div class="desc">${d.desc}</div>`; }
    }
    if (!html) view.sel = null;
  }
  if (html === cardHTML && !force) return;
  if (html && !cardHTML && coarse()) { $('roster').classList.remove('show'); $('trade').classList.remove('show'); }
  cardHTML = html;
  patch(card, html);
  card.classList.toggle('show', !!html);
  document.body.classList.toggle('carded', !!html);
}

$('card').addEventListener('click', (e) => {
  if (!g) return;
  const el = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!el) return;
  const s = view.sel?.t === 's' ? g.settlers.find((q) => q.id === view.sel!.id) : undefined;
  if (el.dataset.job && s) {
    const err = setJob(g, s, el.dataset.job as Job);
    if (err) showToast(err, 'warn');
    else if (JOBS[s.job].needs && !g.blds.some((b) => b.kind === JOBS[s.job].needs && b.done)) showToast(`${JOBS[s.job].name}s need a ${BUILD[JOBS[s.job].needs!].name.toLowerCase()} to work.`, 'warn');
  }
  if (el.dataset.promo && s) { const err = promote(g, s, el.dataset.promo); if (err) showToast(err, 'warn'); }
  const act = el.dataset.act;
  if (act === 'close') view.sel = null;
  if (act === 'post' && s) { clearTool(); postMode = s.id; $('postHint').classList.add('show'); }
  if (act === 'autopost' && s) s.post = 0;
  if (act === 'trade') toggleTrade(true);
  if (act === 'fortify') { const err = fortify(g); if (err) showToast(err, 'warn'); }
  if (act === 'upgrade' && view.sel?.t === 'b') { const b = bld(g, view.sel.id); if (b) { const err = upgrade(g, b); if (err) showToast(err, 'warn'); } }
  if (act === 'demolish' && view.sel?.t === 'b') { const err = demolish(g, view.sel.id); if (err) showToast(err, 'warn'); else view.sel = null; }
  if (act === 'garrison' && view.sel?.t === 'b') {
    const b = bld(g, view.sel.id)!;
    const archers = g.settlers.filter((q) => q.job === 'archer');
    if (!archers.length) showToast('No archers. Make a settler an archer first (12 gold of gear).', 'warn');
    else {
      archers.sort((a, c) => (a.post ? 1 : 0) - (c.post ? 1 : 0) || Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
      assignPost(g, archers[0], b);
      showToast(`${archers[0].name} will man this ${BUILD[b.kind].name.toLowerCase()}.`, 'good');
    }
  }
  sfx('click');
  renderCard(true);
  refreshRoster(true);
});
$('postCancel').addEventListener('click', () => { postMode = 0; $('postHint').classList.remove('show'); });

// ---------- roster ----------
let rosterHTML = '';
function toggleRoster(force?: boolean) {
  const r = $('roster');
  const show = force ?? !r.classList.contains('show');
  r.classList.toggle('show', show);
  if (show) { $('trade').classList.remove('show'); if (coarse()) { view.sel = null; renderCard(true); } }
  refreshRoster(true);
  sfx('click');
}
function refreshRoster(force = false) {
  const r = $('roster');
  if (!g || !r.classList.contains('show')) return;
  if (!force && r.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return;
  const count: Partial<Record<Job, number>> = {};
  for (const s of g.settlers) count[s.job] = (count[s.job] ?? 0) + 1;
  const sum = JOB_ORDER.filter((j) => count[j]).map((j) => `${JOBS[j].name} ${count[j]}`).join(' · ');
  const rows = g.settlers.map((s) => {
    const m = mood(g!, s);
    const worst = (['hunger', 'rest', 'warmth', 'safety'] as const).reduce((a, k) => (s.needs[k] < s.needs[a] ? k : a), 'hunger' as 'hunger' | 'rest' | 'warmth' | 'safety');
    const warn = s.needs[worst] < 25 ? `<span class="neg" title="Low ${worst}">!</span>` : s.sick > 0 ? '<span class="neg" title="Feverish">+</span>' : '<span></span>';
    const opts = JOB_ORDER.map((j) => `<option value="${j}" ${s.job === j ? 'selected' : ''}>${JOBS[j].name}${JOBS[j].gold && !s.gear.includes(j) ? ` (${JOBS[j].gold}g)` : ''}</option>`).join('');
    return `<div class="rrow"><span class="nm" data-sid="${s.id}">${s.name}<small>${activity(g!, s)}</small></span><select data-sid="${s.id}">${opts}</select><span class="md" style="color:${m >= 60 ? 'var(--green)' : m >= 35 ? 'var(--ink)' : 'var(--red)'}">${m}</span>${warn}</div>`;
  }).join('');
  const html = `<h3>Settlers (${g.settlers.length})<button class="x" data-act="close">&times;</button></h3><div class="jobsum">${sum}</div><div class="rrow rhead"><span>Name · doing</span><span>Job</span><span>Mood</span><span></span></div>${rows}`;
  if (html === rosterHTML && !force) return;
  rosterHTML = html;
  patch(r, html);
}
$('roster').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('[data-act="close"]')) { toggleRoster(false); return; }
  const nm = el.closest('.nm') as HTMLElement | null;
  if (nm && g) {
    const s = g.settlers.find((q) => q.id === Number(nm.dataset.sid));
    if (s) {
      view.sel = { t: 's', id: s.id };
      clearTool();
      const b = s.inside ? bld(g, s.inside) : undefined;
      if (s.away <= 0) { view.cam.x = (b ? b.x + 1 : s.x) * TILE; view.cam.y = (b ? b.y + 1 : s.y) * TILE; clampCam(view); }
      renderCard(true);
    }
  }
});
$('roster').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (!g || el.tagName !== 'SELECT') return;
  const s = g.settlers.find((q) => q.id === Number(el.dataset.sid));
  if (!s) return;
  const err = setJob(g, s, el.value as Job);
  if (err) showToast(err, 'warn');
  el.blur();
  refreshRoster(true);
  renderCard(true);
});
$('rosterBtn').addEventListener('click', () => { if (idleSettlers().length) cycleIdle(); else toggleRoster(); });

// ---------- market ----------
let tradeHTML = '';
function toggleTrade(force?: boolean) {
  const t = $('trade');
  const show = force ?? !t.classList.contains('show');
  t.classList.toggle('show', show);
  if (show) { $('roster').classList.remove('show'); if (coarse()) { view.sel = null; renderCard(true); } }
  refreshTrade(true);
  sfx('click');
}
function refreshTrade(force = false) {
  const el = $('trade');
  if (!g || !el.classList.contains('show')) return;
  const open = canTrade(g);
  let html = `<h3>Market<button class="x" data-act="close">&times;</button></h3>`;
  if (!open) {
    html += `<p class="desc">${g.phase === 'night' ? 'The stalls are shut during a raid.' : 'Build a market to trade every day. Merchant caravans also pass through now and then.'}</p>`;
  } else {
    const trader = g.settlers.some((s) => s.job === 'trader' && s.task?.k === 'trade');
    html += `<div class="desc">${hasMarket(g) ? (trader ? 'Your trader is haggling for you.' : 'No trader at the stall: prices are worse. Make someone a trader.') : 'Trading with the caravan today.'} Prices move with the season and with how much you trade.</div>`;
    html += '<div class="trows">';
    for (const r of GOODS) {
      const b = price(g, r, 'buy'), s = price(g, r, 'sell');
      html += `<div class="trow"><span class="tres">${resIcon(r)} <b>${r[0].toUpperCase() + r.slice(1)}</b><small>have ${Math.floor(g.res[r])}</small></span>
        <button class="small" data-buy="${r}" ${g.res.gold < b ? 'disabled' : ''}>Buy ${TRADE_LOT} · ${b}${resIcon('gold')}</button>
        <button class="small" data-sell="${r}" ${g.res[r] < TRADE_LOT ? 'disabled' : ''}>Sell ${TRADE_LOT} · ${s}${resIcon('gold')}</button></div>`;
    }
    html += '</div>';
  }
  if (g.merchant) {
    html += '<h4>The caravan\'s wares</h4><div class="offers">';
    g.merchant.forEach((o, i) => {
      let name = '', desc = '', img = '';
      if (o.kind === 'relic') { name = RELICS[o.id].name; desc = RELICS[o.id].desc; img = IMG['relic_' + o.id]; }
      else if (o.kind === 'blueprint') { name = `Blueprint: ${BUILD[o.id as BuildKind].name}`; desc = BUILD[o.id as BuildKind].desc; img = IMG.scroll; }
      else if (o.kind === 'merc') { name = `Sellsword (${JOBS[o.id as Job].name})`; desc = 'A brave, geared fighter joins the hold.'; img = iconOf(settlerSprites(o.id as Job, 11)[0], 22); }
      else { name = `${o.amount} ${o.id}`; desc = 'A wagonload of goods.'; img = IMG[o.id]; }
      html += `<div class="offer${o.sold ? ' sold' : ''}"><img src="${img}" alt=""><span><b>${name}</b><small>${desc}</small></span><button class="small" data-offer="${i}" ${o.sold || g!.res.gold < o.price ? 'disabled' : ''}>${o.sold ? 'Sold' : `${o.price}${resIcon('gold')}`}</button></div>`;
    });
    html += '</div>';
  }
  if (html === tradeHTML && !force) return;
  tradeHTML = html;
  patch(el, html);
}
$('trade').addEventListener('click', (e) => {
  if (!g) return;
  const el = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!el) return;
  if (el.dataset.act === 'close') { toggleTrade(false); return; }
  let err: string | null = null;
  if (el.dataset.buy) err = trade(g, el.dataset.buy as 'food', 'buy');
  if (el.dataset.sell) err = trade(g, el.dataset.sell as 'food', 'sell');
  if (el.dataset.offer && g.merchant) err = buyOffer(g, g.merchant[Number(el.dataset.offer)]);
  if (err) showToast(err, 'warn');
  if (el.dataset.offer) buildBar();
  refreshTrade(true);
  refreshTop();
});

// ---------- events ----------
let eventResult = '';
function showEvent() {
  if (!g) return;
  const box = $('event');
  if (!g.event && !eventResult) { box.classList.remove('show'); return; }
  let html = '';
  if (g.event) {
    const def = eventDef(g.event.id);
    if (!def) { g.event = null; box.classList.remove('show'); return; }
    const ch = def.choices(g, g.event.data);
    const ic = EVENT_ICON[g.event.id];
    html = `<div class="evicon">${ic ? `<img src="${toDataURL(icon(ic), 4)}" alt="">` : def.icon}</div><h2>${def.title}</h2><p>${def.text(g, g.event.data)}</p><div class="choices">${ch.map((c, i) => `<button class="choice" data-choice="${i}" ${c.ok === false ? 'disabled' : ''}><b>${c.label}</b>${c.hint ? `<small>${c.hint}</small>` : ''}</button>`).join('')}</div>`;
  } else html = `<p class="result">${eventResult}</p><button class="big" data-choice="done">Carry on</button>`;
  $('event-body').innerHTML = html;
  box.classList.add('show');
}
$('event').addEventListener('click', (e) => {
  if (!g) return;
  const el = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!el || el.hasAttribute('disabled')) return;
  if (el.dataset.choice === 'done') { eventResult = ''; showEvent(); refreshTop(); buildBar(); if (g.merchant) toggleTrade(true); saveGame(g); return; }
  eventResult = resolveEvent(g, Number(el.dataset.choice));
  sfx('click');
  showEvent();
  refreshTop();
});

// ---------- goals: steward's notes (first-run tutorial) and charters ----------
interface Step { text: (g: Game) => string; done: (g: Game) => boolean; glow?: string; }
const entryName = (g: Game) => g.entries[g.wave.groups[0]?.entry ?? 0]?.name.toLowerCase() ?? 'west';
const nb = (g: Game, k: BuildKind) => g.blds.filter((b) => b.kind === k).length;
let tutShownAt = 0;
const STEPS: Step[] = [
  { text: () => 'Tap a settler to see what they need and change their job.', done: () => view.sel?.t === 's' },
  { text: () => 'Two settlers have no bed. Pick <b>Build ▸ Hut</b> and place it near the keep.', done: (g) => nb(g, 'hut') >= 2, glow: 'hut' },
  { text: (g) => `Goblins come from the ${entryName(g)} tonight along the red dashed trail. Pick <b>Defend ▸ Palisade</b> and drag a line across it near the keep (${Math.min(3, nb(g, 'wall') + nb(g, 'stonewall'))}/3). Goblins walk around short walls, so close the gap to the trees.`, done: (g) => nb(g, 'wall') + nb(g, 'stonewall') >= 3, glow: 'wall' },
  { text: () => 'When you’re ready, tap <b>End day</b> (or wait for sunset). Your archer mans the tower and militia hold the blue flag.', done: (g) => g.phase !== 'day', glow: 'phaseBtn' },
  { text: (g) => (g.phase === 'dusk' ? 'Dusk: guards are heading to their posts. The goblins arrive at nightfall.' : 'Towers and guards fight on their own; you can still lay walls. Try <b>2x</b> or <b>3x</b> speed.'), done: (g) => g.day >= 2 || g.phase === 'dawn' },
  { text: (g) => `Food lasts about ${foodDays(g).toFixed(0)} days. Make someone a <b>Forager</b> or <b>Fisher</b>, or build a second <b>Farm</b>.`, done: (g) => nb(g, 'farm') >= 2 || g.settlers.some((s) => s.job === 'forager' || s.job === 'fisher'), glow: 'farm' },
  { text: () => 'Stone builds markets, gardens, stone walls and keep upgrades. Make a newcomer or a woodcutter a <b>Quarrier</b> (keep your builder building!).', done: (g) => g.settlers.some((s) => s.job === 'quarrier') },
  { text: () => 'Last tip: charters (goals with rewards) appear here next. Every 3rd night is an assault and every 5th a boss night. The hold is yours!', done: () => performance.now() - tutShownAt > 14000 },
];
let goalHTML = '';
let tabSetFor = -1;
let goalOpen = true;
function refreshGoal() {
  const el = $('goal');
  if (!g) return;
  let html = '';
  const tut = g.tut ?? -1;
  if (tut >= 0 && tut < STEPS.length) {
    const st = STEPS[tut];
    if (st.done(g)) { g.tut = tut + 1 >= STEPS.length ? -1 : tut + 1; tutShownAt = performance.now(); sfx('built'); return refreshGoal(); }
    html += `<div class="gstep"><span class="gk">◆</span><span>${st.text(g)}</span></div><div class="gfoot"><span class="dim">Tip ${tut + 1}/${STEPS.length}</span><button class="link" data-act="skiptips">skip tips</button></div>`;
    for (const t of Array.from(document.querySelectorAll('.tutglow'))) t.classList.remove('tutglow');
    if (st.glow === 'phaseBtn') $('phaseBtn').classList.add('tutglow');
    else if (st.glow) document.querySelector(`.tool[data-tool="${st.glow}"]`)?.classList.add('tutglow');
    if (tabSetFor !== tut && st.glow && st.glow !== 'phaseBtn' && BUILD[st.glow as BuildKind]) { tabSetFor = tut; if (BUILD[st.glow as BuildKind].cat !== barTab) { barTab = BUILD[st.glow as BuildKind].cat; buildBar(); } }
  } else {
    for (const t of Array.from(document.querySelectorAll('.tutglow'))) t.classList.remove('tutglow');
    refillCharters(g);
    const rows = g.charters!.active.map((id) => {
      const c = CHARTERS.find((x) => x.id === id)!;
      return `<div class="crow"><span class="ck">◇</span><span>${c.text}${c.prog ? ` <span class="dim">(${c.prog(g!)})</span>` : ''}<small>Reward: ${rewardText(c.reward)}</small></span></div>`;
    }).join('');
    html = `<div class="ghead" data-act="togglegoal"><b>Charters</b><span class="dim">${g.charters!.done.length} done ${goalOpen ? '▴' : '▾'}</span></div>${goalOpen ? rows : ''}`;
  }
  if (html !== goalHTML) { goalHTML = html; patch(el, html); }
  el.classList.add('show');
}
$('goal').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el || !g) return;
  if (el.dataset.act === 'skiptips') { g.tut = -1; try { localStorage.setItem('goblinhold.tips', '0'); } catch { /* ignore */ } }
  if (el.dataset.act === 'togglegoal') goalOpen = !goalOpen;
  refreshGoal();
});

const EVENT_ICON: Record<string, string> = {
  merchant: 'gold', wounded: 'satchel', wolves: 'skull', orchard: 'food', storm: 'banner', defector: 'idol', fever: 'satchel', tax: 'ledger',
  cart: 'wood', feast: 'food', map: 'scroll', refugees: 'people', smith: 'hammer', shrine: 'spyglass', rats: 'food', drums: 'horn', bard: 'horn',
  rockslide: 'stone', coldsnap: 'hearth', scouts: 'spyglass', blueprint: 'scroll', drillmaster: 'sword', surveyor: 'spyglass', seer: 'idol',
  envoy: 'banner', grubnik: 'idol', envoy_back: 'banner',
};

// ---------- toasts & banner ----------
function showToast(text: string, kind = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild!.remove();
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}
let bannerT = 0;
function banner(t: string, s: string, danger = false) {
  $('banner-t').textContent = t;
  $('banner-s').textContent = s;
  $('banner').className = 'hud show' + (danger ? ' danger' : '');
  bannerT = 2.6;
}

// ---------- overlays ----------
let appChoice: boolean | null = null;
function showDawn() {
  if (!g) return;
  $('dawn-t').textContent = g.wave.kind === 'boss' ? 'The warband is broken' : g.night.lost.length ? `Night ${g.day}: the hold stands` : `Night ${g.day} is held`;
  $('dawn-list').innerHTML = g.report.map((r) => `<li>${r}</li>`).join('');
  const a = g.applicant;
  $('dawn-app').innerHTML = a
    ? `<div class="applicant"><b>${a.name}</b> (${applicantText(a)}) wanders up and asks to join the hold.${g.settlers.length >= bedCount(g) ? '<br><span class="desc">There is no free bed: they would sleep on the keep floor.</span>' : ''}<div class="row center"><button class="small" id="appYes">Welcome them</button><button class="small" id="appNo">Turn them away</button></div></div>`
    : '';
  appChoice = a ? null : false;
  $('dawn-app').style.minHeight = '';
  const go = $<HTMLButtonElement>('dawnGo');
  const next = g.day + 1;
  const nextSeason = season(g, next) !== season(g) ? ` · ${SEASONS[season(g, next)].name} begins` : '';
  go.textContent = `Begin day ${next}${nextSeason}`;
  go.disabled = !!a;
  $('dawn').classList.add('show');
  const choose = (v: boolean) => {
    appChoice = v;
    $('dawn-app').style.minHeight = `${$('dawn-app').offsetHeight}px`;
    $('dawn-app').innerHTML = `<div class="applicant">${v ? `<b>${a!.name}</b> will join at sunrise.` : `${a!.name} heads off down the road.`}</div>`;
    go.disabled = false;
    sfx('click');
  };
  document.getElementById('appYes')?.addEventListener('click', () => choose(true));
  document.getElementById('appNo')?.addEventListener('click', () => choose(false));
}
$('dawnGo').addEventListener('click', () => {
  if (!g || g.phase !== 'dawn') return;
  beginDay(g, !!appChoice);
  { const k = bld(g, g.keepId); if (k) { view.cam.x = (k.x + 1.5) * TILE; view.cam.y = (k.y + 2) * TILE; clampCam(view); } }
  $('dawn').classList.remove('show');
  saveGame(g);
  const sd = seasonDay(g);
  banner(sd === 1 ? SEASONS[season(g)].name.toUpperCase() : `DAY ${g.day}`, g.wave.kind === 'boss' ? 'Scouts report a warband. Boss night!' : g.wave.kind === 'assault' ? 'Scouts warn of an assault tonight.' : sd === 1 ? SEASONS[season(g)].desc : 'Build up before nightfall.', g.wave.kind !== 'raid');
  buildBar();
  refreshTop();
  showEvent();
  if (foodDays(g) < 1.5) showToast(`Food runs out in about ${Math.max(0, foodDays(g)).toFixed(1)} days. Add a Forager, Fisher or Farm, or buy at the Market.`, 'bad');
  const homeless = g.settlers.length - bedCount(g);
  if (homeless > 0) showToast(`${homeless} settler${homeless > 1 ? 's sleep' : ' sleeps'} on the keep floor (bad mood). Build a Hut.`, 'warn');
});

function showOver() {
  if (!g) return;
  const earned = bankRun(g);
  $('over-list').innerHTML = g.report.map((r) => `<li>${r}</li>`).join('') + `<li>Best: day ${getBest()}</li><li class="renown">+${earned} renown (you have ${loadMeta().renown}). Spend it on head starts from the title screen.</li>`;
  $('over').classList.add('show');
  clearSave();
}
$('again').addEventListener('click', () => { $('over').classList.remove('show'); startNew(); });

function showTitle() {
  const saved = loadGame();
  const btns = $('titleBtns');
  btns.innerHTML = saved
    ? `<button class="big" id="cont">Continue · Day ${saved.day}</button><button class="big alt" id="fresh">New settlement</button>`
    : '<button class="big" id="fresh">Found a settlement</button>';
  const best = getBest();
  const meta = loadMeta();
  $('best').innerHTML = (best ? `Longest hold: day ${best}` : '') + (meta.total ? `${best ? ' · ' : ''}<button class="link gold" id="openMeta">Renown ${meta.renown} ✦ head starts</button>` : '');
  document.getElementById('openMeta')?.addEventListener('click', showMeta);
  document.getElementById('cont')?.addEventListener('click', () => { unlock(); start(saved!); });
  document.getElementById('fresh')!.addEventListener('click', () => {
    unlock();
    if (saved && !confirm('Start over? Your current settlement will be lost.')) return;
    startNew();
  });
  $('title').classList.add('show');
  document.body.classList.add('intitle');
  $('backLink').style.display = '';
}

function showMeta() {
  const m = loadMeta();
  $('meta-body').innerHTML = `<h2>Head starts</h2><p>Renown is earned each time a hold falls: days survived, warchiefs slain, goblins killed and charters fulfilled. Head starts are permanent and apply to every new settlement.</p>
    <div class="renownbig">✦ ${m.renown} renown</div>
    <div class="offers">${UNLOCKS.map((u) => {
      const own = m.unlocks.includes(u.id);
      return `<div class="offer${own ? ' owned' : ''}"><span class="ustar">✦</span><span><b>${u.name}</b><small>${u.desc}</small></span><button class="small" data-unlock="${u.id}" ${own || m.renown < u.cost ? 'disabled' : ''}>${own ? 'Owned' : `${u.cost} ✦`}</button></div>`;
    }).join('')}</div>
    <button class="big alt" id="metaClose">Back</button>`;
  $('meta').classList.add('show');
  $('backLink').style.display = 'none';
  $('title').classList.remove('show');
  $('metaClose').addEventListener('click', () => { $('meta').classList.remove('show'); showTitle(); });
}
$('meta').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-unlock]') as HTMLElement | null;
  if (!el) return;
  const err = buyUnlock(el.dataset.unlock!);
  if (err) showToast(err, 'warn'); else sfx('built');
  showMeta();
});

function startNew() {
  clearSave();
  const game = newGame((Math.random() * 2 ** 31) | 0);
  let tips = true;
  try { tips = localStorage.getItem('goblinhold.tips') !== '0'; } catch { /* ignore */ }
  game.tut = tips ? 0 : -1;
  applyUnlocks(game);
  start(game);
  banner('SPRING', 'Gather wood and get ready for the first raid.');
}

function start(game: Game) {
  g = game;
  rebuild(g);
  invalidateTerrain();
  view.sel = null; postMode = 0; eventResult = '';
  view.tool = null; pendingPlace = null; document.body.classList.remove('tooling'); $('toolChip').classList.remove('show');
  barTab = 'build';
  centerOnKeep();
  for (const id of ['title', 'dawn', 'over', 'pause', 'trade', 'roster']) $(id).classList.remove('show');
  g.floaters = [];
  document.body.classList.remove('intitle');
  demo = null;
  goalHTML = ''; tutShownAt = performance.now();
  $('backLink').style.display = 'none';
  setSpeed(1);
  buildBar(); refreshTop(); renderCard(true);
  if (g.phase === 'dawn') showDawn();
  showEvent();
  saveGame(g);
}

function openPause() { if (!g) return; $('pause').classList.add('show'); $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`; $('musicBtn').textContent = `Music: ${isMusicOn() ? 'on' : 'off'}`; }
$('musicBtn').addEventListener('click', () => { toggleMusic(); $('musicBtn').textContent = `Music: ${isMusicOn() ? 'on' : 'off'}`; });
$('menuBtn').addEventListener('click', openPause);
$('resume').addEventListener('click', () => $('pause').classList.remove('show'));
$('muteBtn').addEventListener('click', () => { toggleMute(); $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`; });
$('restart').addEventListener('click', () => {
  if (!confirm('Abandon this settlement for good?')) return;
  for (const id of ['pause', 'dawn', 'event', 'over', 'trade', 'roster', 'card']) $(id).classList.remove('show');
  eventResult = '';
  clearSave();
  g = null;
  showTitle();
});

// ---------- world input ----------
const pointers = new Map<number, { x: number; y: number }>();
let gesture: { mode: 'tap' | 'pan' | 'line' | 'pinch'; sx: number; sy: number; d0?: number; z0?: number; mx?: number; my?: number } | null = null;

function tileAt(sx: number, sy: number) {
  const t = screenToTile(view, sx, sy);
  return { x: Math.floor(t.x), y: Math.floor(t.y), fx: t.x, fy: t.y };
}

cv.addEventListener('pointerdown', (e) => {
  unlock();
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    if (gesture?.mode === 'pinch') return;
    const [a, b] = [...pointers.values()];
    gesture = { mode: 'pinch', sx: 0, sy: 0, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: view.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    view.drag = null;
    return;
  }
  if (e.button === 2) { setTool(null); return; }
  if (e.button === 1) { gesture = { mode: 'pan', sx: e.clientX, sy: e.clientY }; return; }
  const t = tileAt(e.clientX, e.clientY);
  if (view.tool && view.tool !== 'demolish' && LINE_KINDS.includes(view.tool)) {
    gesture = { mode: 'line', sx: e.clientX, sy: e.clientY };
    view.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
    view.hover = { x: t.x, y: t.y };
  } else gesture = { mode: 'tap', sx: e.clientX, sy: e.clientY };
});

cv.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (e.pointerType === 'mouse') { const t = tileAt(e.clientX, e.clientY); view.hover = { x: t.x, y: t.y }; }
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.mode === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    view.cam.x -= (mx - gesture.mx!) / view.cam.z;
    view.cam.y -= (my - gesture.my!) / view.cam.z;
    gesture.mx = mx; gesture.my = my;
    zoomAt(mx, my, (gesture.z0! * d) / gesture.d0! / view.cam.z);
    return;
  }
  if (gesture.mode === 'line') {
    const t = tileAt(e.clientX, e.clientY);
    view.drag!.x1 = t.x; view.drag!.y1 = t.y;
    return;
  }
  if (gesture.mode === 'tap' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 7) gesture.mode = 'pan';
  if (gesture.mode === 'pan') {
    view.cam.x -= (e.clientX - prev.x) / view.cam.z;
    view.cam.y -= (e.clientY - prev.y) / view.cam.z;
    clampCam(view);
  }
});

function endPointer(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.mode === 'pinch') { if (pointers.size === 0) gesture = null; return; }
  if (gesture.mode === 'tap' && e.type === 'pointerup') tap(e.clientX, e.clientY, e.pointerType !== 'mouse');
  if (gesture.mode === 'line' && view.drag && g && e.type === 'pointerup' && g.phase !== 'dawn' && view.tool && view.tool !== 'demolish') {
    const tiles = wallLine(view.drag.x0, view.drag.y0, view.drag.x1, view.drag.y1);
    const n = placeWalls(g, view.tool, tiles);
    if (!n) showToast(!canAfford(g, view.tool) ? `Not enough: needs ${costText(buildCost(g, view.tool))} per tile.` : "Can't build there.", 'warn');
    view.drag = null;
  }
  gesture = null;
  if (e.pointerType !== 'mouse' && !view.tool) view.hover = null;
  if (e.pointerType !== 'mouse' && view.tool && pendingPlace) view.hover = { ...pendingPlace };
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) view.hover = null; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

function zoomAt(sx: number, sy: number, f: number) {
  const before = screenToTile(view, sx, sy);
  view.cam.z *= f;
  clampCam(view);
  const after = screenToTile(view, sx, sy);
  view.cam.x += (before.x - after.x) * TILE;
  view.cam.y += (before.y - after.y) * TILE;
  clampCam(view);
}
cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

function tap(sx: number, sy: number, touch = false) {
  if (!g || g.phase === 'dawn' || g.event) return;
  const t = tileAt(sx, sy);
  if (postMode) {
    const s = g.settlers.find((q) => q.id === postMode);
    const b = bldAtTile(g, t.x, t.y) ?? bldAtTile(g, t.x, t.y + 1);
    if (s && b) {
      const err = assignPost(g, s, b);
      if (err) showToast(err, 'warn'); else { showToast(`${s.name} posted to the ${BUILD[b.kind].name.toLowerCase()}.`, 'good'); postMode = 0; $('postHint').classList.remove('show'); }
    }
    renderCard(true);
    return;
  }
  if (view.tool) {
    // on touch, the first tap previews and a second tap on the same spot confirms
    if (touch && !(pendingPlace && pendingPlace.x === t.x && pendingPlace.y === t.y)) {
      pendingPlace = { x: t.x, y: t.y };
      view.hover = { x: t.x, y: t.y };
      refreshChip();
      return;
    }
    pendingPlace = null;
    if (view.tool === 'demolish') {
      const b = bldAtTile(g, t.x, t.y);
      if (b) { const err = demolish(g, b.id); if (err) showToast(err, 'warn'); }
    } else {
      const d = BUILD[view.tool];
      const err = place(g, view.tool, t.x - Math.floor((d.w - 1) / 2), t.y - Math.floor((d.h - 1) / 2));
      if (err) showToast(err, 'warn');
    }
    refreshBar();
    refreshChip();
    return;
  }
  // select: settlers, then goblins, then buildings (tall ones can be tapped on their roofs)
  let sel: Sel | null = null;
  let bd = 0.75;
  for (const s of g.settlers) { if (s.inside || s.away > 0) continue; const d = Math.hypot(s.x - t.fx, s.y - 0.4 - t.fy); if (d < bd) { bd = d; sel = { t: 's', id: s.id }; } }
  for (const gb of g.goblins) { const d = Math.hypot(gb.x - t.fx, gb.y - 0.4 - t.fy); if (d < bd) { bd = d; sel = { t: 'g', id: gb.id }; } }
  if (!sel) {
    let b = bldAtTile(g, t.x, t.y);
    if (!b) for (const dy of [1, 2]) { const c = bldAtTile(g, t.x, t.y + dy); if (c && c.kind !== 'wall' && c.kind !== 'farm' && c.kind !== 'trap' && c.kind !== 'flag') { b = c; break; } }
    if (b) {
      if ((b.kind === 'tower' || b.kind === 'ballista') && b.occupant && view.sel?.t === 'b' && view.sel.id === b.id) sel = { t: 's', id: b.occupant };
      else sel = { t: 'b', id: b.id };
    }
  }
  view.sel = sel;
  if (sel) sfx('click');
  renderCard(true);
}

// ---------- keyboard ----------
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!g || $('title').classList.contains('show')) return;
  if (k === 'escape') {
    if (view.tool || postMode) { setTool(null); postMode = 0; $('postHint').classList.remove('show'); }
    else if (view.sel) { view.sel = null; renderCard(true); }
    else if ($('trade').classList.contains('show')) toggleTrade(false);
    else if ($('roster').classList.contains('show')) toggleRoster(false);
    else if ($('pause').classList.contains('show')) $('pause').classList.remove('show');
    else openPause();
    return;
  }
  if (g.event || eventResult || $('dawn').classList.contains('show')) {
    if (k === 'enter' && !$<HTMLButtonElement>('dawnGo').disabled && $('dawn').classList.contains('show')) $('dawnGo').click();
    return;
  }
  if (k === ' ') { e.preventDefault(); setSpeed(speed === 0 ? lastSpeed : 0); return; }
  if (k === '1' || k === '2' || k === '3') { setSpeed(Number(k)); return; }
  if (k === 'r') { toggleRoster(); return; }
  if (k === 'u') { toggleTrade(); return; }
  if (k === 'q') { setTool('demolish'); return; }
  if (k === 'tab') { e.preventDefault(); barTab = barTab === 'build' ? 'defend' : 'build'; buildBar(); return; }
  for (const b of BUILD_ORDER) if (BUILD[b].key === k) { setTool(b); return; }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// ---------- events from the sim ----------
function handleEvents() {
  if (!g) return;
  for (const e of events.splice(0)) {
    sfx(e.k);
    spawnFx(e);
    if (e.k === 'dusk' || e.k === 'dawn') hideTip();
    if (e.k === 'dusk') banner('DUSK', 'Guards to their posts.');
    if (e.k === 'horn') {
      hideTip();
      if (g.day <= 2 && g.wave.groups.length) { const en = g.entries[g.wave.groups[0].entry]; const kp = bld(g, g.keepId)!; view.cam.x = ((en.x + kp.x + 1.5) / 2) * TILE; view.cam.y = ((en.y + kp.y + 1.5) / 2) * TILE; clampCam(view); }
      const total = totalWave(g);
      banner(g.wave.kind === 'boss' ? 'BOSS NIGHT' : g.wave.kind === 'assault' ? 'ASSAULT!' : 'NIGHTFALL', `${total} goblins are coming.`, true);
      if (view.tool && !['wall', 'stonewall', 'trap', 'flag'].includes(view.tool)) clearTool();
      refreshBar();
      $('trade').classList.remove('show');
    }
    if (e.k === 'dawn') { saveGame(g); showDawn(); }
    if (e.k === 'over') showOver();
    if (e.k === 'relic') buildBar();
  }
  for (const t of toasts.splice(0)) showToast(t.text, t.kind);
}

// ---------- loop ----------
const STEP = 1 / 30;
let acc = 0;
let last = performance.now();
let uiT = 0;
let demo: Game | null = null;
const demoView: View = { cam: { x: 0, y: 0, z: 2.5 }, sel: null, tool: null, hover: null, drag: null, w: 0, h: 0, dpr: 1 };
let saveT = 0;
function frame(now: number) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!g) {
    // a living backdrop behind the title: a demo hold going about its day
    if (!demo) { demo = newGame(1234567); demo.tut = -1; demoView.cam = { x: 23.5 * TILE, y: 17 * TILE, z: 2.5 }; }
    demoView.w = view.w; demoView.h = view.h; demoView.dpr = view.dpr;
    demoView.cam.z = Math.max(2, Math.min(3, view.w / 420));
    // keep the hold visible beside the title card on wide screens
    demoView.cam.x = 23.5 * TILE - (view.w > 900 ? view.w * 0.3 / demoView.cam.z : 0);
    demoView.cam.y = 17 * TILE;
    clampCam(demoView);
    step(demo, real);
    if (demo.phase !== 'day') { demo = null; }
    events.length = 0; toasts.length = 0;
    if (demo) draw(ctx, demo, demoView, real, now / 1000);
  }
  if (g) {
    const paused = speed === 0 || $('pause').classList.contains('show') || g.phase === 'dawn' || g.over || !!g.event || !!eventResult;
    if (!paused) {
      acc += real * speed;
      let n = 0;
      while (acc >= STEP && n < 12) { step(g, STEP); acc -= STEP; n++; }
      if (n >= 12) acc = 0;
    }
    const pan = 360 * real / view.cam.z;
    if (keys.has('w') || keys.has('arrowup')) view.cam.y -= pan;
    if (keys.has('s') || keys.has('arrowdown')) view.cam.y += pan;
    if (keys.has('a') || keys.has('arrowleft')) view.cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) view.cam.x += pan;
    clampCam(view);
    handleEvents();
    ambience(g.phase, real * (paused ? 0 : 1), paused ? 0 : speed);
    draw(ctx, g, view, paused ? 0 : real * speed, now / 1000);
    uiT -= real;
    if (uiT <= 0) {
      uiT = 0.2; refreshTop(); refreshBar(); renderCard(); refreshRoster(); refreshTrade(); refreshGoal();
      if (g.phase !== 'dawn' && !g.over) { if (checkCharters(g).length) { buildBar(); refreshTop(); } }
      // gentle nudges
      if (g.phase === 'day' && nudged.build !== g.day && g.blds.some((b) => !b.done) && !g.settlers.some((s) => s.job === 'builder')) { nudged.build = g.day; showToast('Nobody is building! Make someone a Builder or your sites will sit unfinished.', 'bad'); }
      if (g.phase === 'day' && dayLen(g) - g.phaseT <= 20 && nudged.dusk !== g.day) { nudged.dusk = g.day; showToast('The sun is setting. Last chance to lay walls.', 'warn'); sfx('dusk'); }
    }
    saveT += real;
    if (saveT > 30 && !paused) { saveT = 0; saveGame(g); }
    if (bannerT > 0) { bannerT -= real; if (bannerT <= 0) $('banner').classList.remove('show'); }
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => { if (document.hidden && g) saveGame(g); });
window.addEventListener('pagehide', () => { if (g) saveGame(g); });

setupIcons();
showTitle();
requestAnimationFrame(frame);

// dev hooks for testing from the console
(window as unknown as Record<string, unknown>).__gh = {
  get g() { return g; },
  view,
  step(frames: number) { for (let i = 0; i < frames && g; i++) { step(g, STEP); if (i % 30 === 29) handleEvents(); } handleEvents(); },
  render() { if (g) { draw(ctx, g, view, 0.016, performance.now() / 1000); refreshTop(); refreshBar(); renderCard(); refreshTrade(); } },
  setSpeed,
  startNew,
  beginDay: (accept = true) => { if (g) { beginDay(g, accept); $('dawn').classList.remove('show'); buildBar(); showEvent(); } },
  showEvent,
  pickEvent: (choice: number) => { if (g?.event) { eventResult = resolveEvent(g, choice); showEvent(); } },
  closeEvent: () => { eventResult = ''; showEvent(); },
  toggleTrade,
  MEMORIES, MAP_W, MAP_H,
};
