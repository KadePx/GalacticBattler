// Hollow Lands viewer: the controller. For now the colony runs right here in the browser
// (the shared server comes later). This file owns the clock: it is the only place that
// steps the sim. The map and the panels only ever read the colony.
//
//   /hollow-lands/?seed=1&pop=16&race=dwarf&pre=30
//     seed  world seed (default 1)        pop  starting colonists (default 16)
//     race  main people (optional)        pre  game days to fast-forward before showing

import { HARD_CAP, DEFAULT_MS_PER_DAY, TICKS_PER_DAY } from './config';
import { RACES } from './sim/data/races';
import { heirsOf } from './sim/player';
import { connect, fetchRegion, myHash, myId, regionSeed, useColony, type Live, type RegionSite } from './net';
import { WorldView } from './view/world';
import { createColony, step, type Colony, type Ev, type Id, type RaceK } from './sim/index';
import { checkSpec, type PawnSpec } from './sim/create';
import { fullName, pawnById } from './sim/pawn';
import type { Dead, Pawn } from './sim/types';
import { WEIGHT, dateText, evText } from './text';
import { Creator, randomSpec } from './view/creator';
import { MapView } from './view/map';
import { Panels, type Sel } from './view/panels';
import { causeText, esc } from './view/words';

/** Real milliseconds per tick at 1x: the pace the shared world will run at. */
const TICK_MS = DEFAULT_MS_PER_DAY / TICKS_PER_DAY;
const SPEEDS = [0, 1, 6, 60, 600];
/** Most real milliseconds a frame may spend stepping the sim, so the page stays smooth. */
const BUDGET_MS = 12;

const q = new URLSearchParams(location.search);
const num = (k: string, d: number, lo: number, hi: number): number => {
  const v = Number(q.get(k));
  return q.has(k) && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d;
};
const raceQ = q.get('race') ?? '';
const opts = { seed: num('seed', 1, 0, 4294967295), pop: num('pop', 16, 2, 40), race: raceQ in RACES ? (raceQ as RaceK) : undefined };

/** Local play: a colony made in this browser from a seed. Otherwise the shared live colony, if there is one. */
const wantLocal = q.has('seed') || q.has('local') || q.has('pre');
let live: Live | null = null;
/** when a join was sent, and whether we are already asking the server about it */
let pendingAt = 0;
let asking = false;
let region: RegionSite[] = [];
/** id of the colony on screen (live play) */
let here = '';
let c: Colony = createColony(wantLocal ? opts : { seed: 1, pop: 2 });
let speed = 1;
/** Part of a tick already played, 0..1. The map draws at tick (c.tick - 1 + acc). */
let acc = 0;
let sel: Sel = null;
let follow: Id = 0;
let ui: Panels | null = null;

const map = new MapView();
const loading = document.getElementById('loading');
const loadMsg = document.getElementById('loadmsg');

function setSpeed(s: number): void {
  if (live) return;
  speed = SPEEDS.includes(s) ? s : 1;
  ui?.touch();
}

function setSel(next: Sel): void {
  sel = next;
  map.selected = next?.k === 'pawn' ? next.id : 0;
  map.selectBld(next?.k === 'bld' ? next.id : 0);
  if (!next || next.k !== 'pawn' || next.id !== follow) setFollow(0);
  ui?.touch();
}

function setFollow(id: Id): void {
  follow = id;
  map.followId = id;
  ui?.touch();
}

/** Open the card for anyone the colony has known. The dead get a memorial. */
function openPerson(id: Id, focus = true): void {
  if (pawnById(c, id)) {
    setSel({ k: 'pawn', id });
    if (focus && follow !== id) map.focusPawn(id, 1.2);
  } else if (c.dead.some((d) => d.id === id)) {
    setSel({ k: 'dead', id });
  }
}

function layout(): void {
  if (ui) map.inset = ui.insets();
}

// ---------- My colonist ----------
// Each browser may have one colonist of its own in a colony. Until there is a server, this
// page stands in for it: it queues the "join" input (the one write the page makes to the
// colony) and remembers who is ours in localStorage.

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode: live without it */ } },
  del(k: string): void { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
};
/** This browser's public id: colonists it makes carry it as `owner`. */
let me: string = store.get('hl_me') ?? ((): string => {
  const id = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set('hl_me', id);
  return id;
})();
/** Where the colonist made for this colony seed is remembered (spec, join tick, id). */
const mineKey = `hl_mine_${opts.seed}`;
/** A join is queued and the colonist has not walked in yet. */
let pending = false;
/** My colonist's id (living, or else the last one dead or gone), 0 for none. */
let meId: Id = 0;
/** The memorial banner the player has closed. */
let dismissed: Id = 0;
let mineHtml = '';
let nextMine = 0;
let toastTimer = 0;

const myPawn = (): Pawn | null => c.pawns.find((p) => p.owner === me) ?? null;
function myDead(): Dead | null {
  for (let i = c.dead.length - 1; i >= 0; i--) if (c.dead[i].owner === me) return c.dead[i];
  return null;
}

const creator = new Creator({ send: (spec) => join(spec) });

/** Send a colonist in: they walk in off the road on the tick given (the next one by default). */
function join(spec: PawnSpec, at = c.tick + 1, remember = true): void {
  if (live) {
    // the server decides; the colonist reaches every browser through the sync
    pending = true;
    pendingAt = performance.now();
    syncMine();
    const lv = live;
    void (lv.humanKey ? humanCheck(lv.humanKey) : Promise.resolve(undefined)).then((token) => lv.join(spec, token)).then((err) => {
      if (!err) return;
      pending = false;
      toast(err);
      syncMine();
    });
    return;
  }
  c.inq.push({ t: at, k: 'join', spec, owner: me });
  pending = true;
  if (remember) store.set(mineKey, JSON.stringify({ spec, t: at }));
  syncMine();
}

function goToMine(): void {
  const p = myPawn();
  if (!p) return;
  openPerson(p.id, false);
  setFollow(p.id);
  map.focusPawn(p.id, 1.6);
}

function toast(text: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('off');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('off'), 4500);
}

/** Keep the button, the banner and the map marker in step with what has become of my colonist. */
function syncMine(): void {
  const p = myPawn();
  if (p && live && here && store.get('hl.col') !== here) store.set('hl.col', here);
  const d = p ? null : myDead();
  meId = p?.id ?? d?.id ?? 0;
  map.mineId = p?.id ?? 0;
  const away = !p && !d && live && here && store.get('hl.col') && store.get('hl.col') !== here;
  const label = away ? 'Go to my colonist' : pending && !p ? 'On the road…' : p?.ask ? 'A choice awaits' : p ? 'My colonist' : d ? 'Make a new colonist' : 'Make your colonist';
  const banner = !p && !pending && d && dismissed !== d.id
    ? `<span class="t"><b>${esc(fullName(d))}</b> ${d.left ? 'was lost to the colony' : 'died'} on ${dateText(d.died)}: ${esc(causeText(c, d).toLowerCase())}.</span><button class="btn sm" data-m="view">Remember them</button>${heirsOf(c, me).slice(0, 3).map((x) => `<button class="btn sm go" data-m="heir" data-id="${x.id}">Carry on as ${esc(x.first)}</button>`).join('')}<button class="btn sm" data-m="new">Make a new colonist</button><button class="icon" data-m="x" title="Close" aria-label="Close">&times;</button>`
    : '';
  const html = label + '|' + (p ? 'has' : '') + '|' + banner;
  if (html === mineHtml) return;
  mineHtml = html;
  const btn = document.getElementById('mine');
  if (btn) {
    btn.textContent = label;
    btn.className = p ? 'has' : pending ? 'wait' : '';
  }
  const mem = document.getElementById('memorial');
  if (mem) {
    mem.innerHTML = banner;
    mem.classList.toggle('hidden', !banner);
  }
  ui?.touch();
}

/** After each frame: has the colonist we sent arrived (or been turned away)? */
function watchMine(now: number): void {
  if (pending) {
    const p = myPawn();
    if (p) {
      pending = false;
      const saved = store.get(mineKey);
      if (saved) { try { store.set(mineKey, JSON.stringify({ ...JSON.parse(saved), id: p.id })); } catch { /* keep the old record */ } }
      syncMine();
      goToMine();
      toast(`${p.first} walks in from the road`);
    } else if (live) {
      // the server accepted them; they reach this browser with the next sync. Only if they are
      // long overdue, ask the server what became of them.
      if (now - pendingAt > 90_000 && !asking) {
        asking = true;
        void fetch(`/api/hl/c/${here}/me?f=${myId()}`, { cache: 'no-store' }).then((r) => r.json()).then((s: { status?: string }) => {
          asking = false;
          if (s.status === 'none') { pending = false; syncMine(); toast('They never arrived. Please try again.'); }
          else pendingAt = now;
        }, () => { asking = false; pendingAt = now; });
      }
    } else if (!c.inq.some((e) => e.k === 'join' && e.owner === me)) {
      // the sim took the input and made nobody: the colony is full
      pending = false;
      store.del(mineKey);
      syncMine();
      toast('The colony had no room for them. Try again later.');
    }
  }
  if (now >= nextMine) { nextMine = now + 400; syncMine(); }
}

/**
 * The colony is rebuilt from its seed on every load, so a colonist made earlier is gone.
 * Send the remembered one in again, on the tick they first arrived if that is still ahead.
 */
function rejoin(): void {
  if (live || myPawn() || myDead()) return;
  try {
    const saved = JSON.parse(store.get(mineKey) ?? 'null') as { spec: PawnSpec; t: number } | null;
    if (saved && checkSpec(saved.spec).ok) join(saved.spec, Math.max(c.tick + 1, saved.t || 0), false);
  } catch { store.del(mineKey); }
}

/**
 * While you were away: what happened to my colonist since this browser last looked.
 * The colony itself only remembers a few days, so older events come from the server's archive.
 */
async function digest(): Promise<void> {
  const mine = myPawn();
  if (!live || !here || !mine) return;
  const key = 'hl.seen.' + here;
  const seen = Number(store.get(key)) || 0;
  store.set(key, String(c.tick));
  if (!seen || c.tick - seen < TICKS_PER_DAY) return;
  let events: Ev[] = c.log.filter((e) => e.a === mine.id || e.b === mine.id);
  try {
    const r = await fetch(`/api/hl/c/${here}/events?who=${mine.id}`, { cache: 'no-store' });
    if (r.ok) {
      const old = ((await r.json()) as { events?: Ev[] }).events ?? [];
      const have = new Set(events.map((e) => e.t + e.k + (e.a ?? '') + (e.b ?? '')));
      events = [...old.filter((e) => !have.has(e.t + e.k + (e.a ?? '') + (e.b ?? ''))), ...events];
    }
  } catch { /* the archive is a bonus */ }
  const list = events.filter((e) => e.t > seen && (WEIGHT[e.k] ?? 0) >= 1).sort((x, y) => x.t - y.t);
  if (!list.length) return;
  const big = list.filter((e) => (WEIGHT[e.k] ?? 0) >= 2);
  const show = (big.length >= 6 ? big : list).slice(-40);
  const days = Math.round((c.tick - seen) / TICKS_PER_DAY);
  const el = document.createElement('div');
  el.id = 'world';
  el.innerHTML = `<div class="wbox panel"><div class="whead"><b>While you were away</b><span>${days} game ${days === 1 ? 'day' : 'days'} in the life of ${esc(mine.first)}</span><button class="icon" data-x title="Close" aria-label="Close">&times;</button></div><div class="wlist">${show.map((e) => `<div class="wrow"><span>${esc(dateText(e.t))}</span><b style="font-weight:500">${esc(evText(c, e))}</b></div>`).join('')}</div></div>`;
  el.addEventListener('click', (e) => { if (e.target === el || (e.target as HTMLElement).closest('[data-x]')) el.remove(); });
  document.body.appendChild(el);
}

/** Cloudflare's are-you-a-person check, shown only when the server asks for it. Resolves with the token. */
function humanCheck(siteKey: string): Promise<string> {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.id = 'world';
    el.innerHTML = '<div class="wbox panel" style="width:auto"><div class="whead"><b>One moment</b><span>Checking you are a person</span></div><div id="human"></div></div>';
    document.body.appendChild(el);
    const show = (): void => {
      (window as unknown as { turnstile: { render(sel: string, o: object): void } }).turnstile.render('#human', { sitekey: siteKey, theme: 'dark', callback: (t: string) => { el.remove(); done(t); } });
    };
    if ((window as unknown as { turnstile?: unknown }).turnstile) { show(); return; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = show;
    s.onerror = () => { el.remove(); done(''); };
    document.head.appendChild(s);
  });
}

/** Open the creator, saying how much room the colony has and where else there is room if it is full. */
function openCreator(): void {
  const cap = HARD_CAP;
  const n = c.pawns.length + c.inq.filter((e) => e.k === 'join').length;
  let room = '';
  if (live) {
    const others = region.filter((s) => s.id !== here && !s.dead && s.pop < cap - 2).sort((a, b) => a.pop - b.pop).slice(0, 3);
    const links = others.map((s) => `<a href="?c=${s.id}">${esc(s.name)}</a> (${s.pop} of ${cap})`).join(', ');
    room = n >= cap
      ? `<b>${esc(c.name)} is full.</b> ${links ? 'Colonies with room: ' + links + '.' : 'Every colony is full right now. Try again later.'}`
      : `Joining <b>${esc(c.name)}</b>: ${n} of ${cap} places taken.${others.length ? ` Elsewhere: ${links}.` : ''}`;
  }
  creator.open(c.name, room, live ? n >= cap : false);
}

function bindMine(): void {
  document.getElementById('mine')?.addEventListener('click', () => {
    const home = store.get('hl.col');
    if (!myPawn() && !myDead() && live && home && home !== here) { location.search = '?c=' + home; return; }
    if (myPawn()) goToMine();
    else if (!pending) openCreator();
  });
  document.getElementById('memorial')?.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
    const d = myDead();
    if (k === 'view' && d) setSel({ k: 'dead', id: d.id });
    else if (k === 'new') openCreator();
    else if (k === 'heir') {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id);
      if (live) void live.send('heir', { id }).then((err) => { if (err) toast(err); });
      else c.inq.push({ t: c.tick + 1, k: 'heir', owner: me, id });
      mineHtml = '';
    }
    else if (k === 'x' && d) { dismissed = d.id; syncMine(); }
  });
}

/** Run the colony forward n game days at once (test hook, and the pre= option). */
function days(n: number): void {
  if (live) return;
  const end = c.tick + Math.max(0, Math.round(n * TICKS_PER_DAY));
  while (c.tick < end) step(c);
  acc = 0;
  map.refresh();
  ui?.touch();
}

/** Fast-forward before showing anything, in slices so the tab does not freeze. */
async function prerun(n: number): Promise<void> {
  const start = c.tick;
  const end = c.tick + n * TICKS_PER_DAY;
  while (c.tick < end) {
    const t0 = performance.now();
    while (c.tick < end && performance.now() - t0 < 40) step(c);
    if (loadMsg) loadMsg.textContent = `Living through day ${Math.floor((c.tick - start) / TICKS_PER_DAY)} of ${n}`;
    await new Promise((r) => setTimeout(r, 0));
  }
}

function frame(dt: number): void {
  // Advance the clock. At high speeds this is many ticks a frame, cut off by a time budget.
  if (live) {
    // the shared colony keeps the server's time: catch up to it, then glide through the tick under way
    if (!live.busy) {
      const tf = live.target();
      const t0 = performance.now();
      while (c.tick < Math.floor(tf)) {
        step(c);
        live.stepped();
        if (performance.now() - t0 > BUDGET_MS) break;
      }
      acc = c.tick >= Math.floor(tf) ? tf - Math.floor(tf) : 0;
    }
  } else if (speed > 0) {
    acc += (Math.min(250, dt) / TICK_MS) * speed;
    if (acc >= 1) {
      const t0 = performance.now();
      while (acc >= 1) {
        step(c);
        acc -= 1;
        if (performance.now() - t0 > BUDGET_MS) { acc %= 1; break; }
      }
    }
  }
  // Someone we were looking at has died or left: show their memorial instead.
  if (sel?.k === 'pawn' && !pawnById(c, sel.id)) {
    const id = sel.id;
    setSel(c.dead.some((d) => d.id === id) ? { k: 'dead', id } : null);
  }
  if (c.out.length) c.out = []; // a lone colony has nobody to send to
  map.render(c, c.tick - 1 + acc, dt);
  const now = performance.now();
  watchMine(now);
  ui?.update(c, { sel, follow, speed, me: meId }, now);
}

async function boot(): Promise<void> {
  await map.init(document.getElementById('map') as HTMLElement);
  const sites = wantLocal ? null : await fetchRegion();
  const alive = sites?.filter((s) => !s.dead) ?? [];
  if (sites && alive.length) {
    if (loadMsg) loadMsg.textContent = 'Finding the colony';
    // which colony: the one asked for, else the one my colonist lives in, else the biggest
    // a remembered home from an earlier world means nothing in this one
    const home = store.get('hl.col');
    if (home && !sites.some((x) => x.id === home)) store.del('hl.col');
    const want = q.get('c') ?? store.get('hl.col');
    const site = alive.find((s) => s.id === want) ?? alive.slice().sort((a, b) => b.pop - a.pop)[0];
    here = site.id;
    useColony(site.id);
    region = sites;
    const world = new WorldView((id) => { location.search = '?c=' + id; });
    const wb = document.getElementById('worldbtn');
    wb?.classList.remove('hidden');
    wb?.addEventListener('click', () => { void fetchRegion().then((fresh) => world.open(fresh ?? region, here, store.get('hl.col') ?? '', regionSeed)); });
    me = await myHash();
    live = await connect((fresh) => {
      c = fresh;
      acc = 0;
      map.setColony(c);
      if (sel?.k === 'pawn' && !pawnById(c, sel.id)) setSel(null);
      ui?.touch();
    });
    document.body.classList.add('live');
  } else if (!wantLocal) c = createColony(opts);
  const pre = live ? 0 : num('pre', 0, 0, 6000);
  if (pre > 0) await prerun(pre);

  ui = new Panels({
    speed: setSpeed,
    person: (id) => openPerson(id),
    building: (id) => {
      const b = c.blds.find((x) => x.id === id);
      if (!b) return;
      setSel({ k: 'bld', id });
      map.focusTile(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5, 1);
    },
    tile: (i) => map.focusTile(i % c.w, Math.floor(i / c.w), 1.6),
    follow: () => {
      if (sel?.k !== 'pawn') return;
      setFollow(follow === sel.id ? 0 : sel.id);
      if (follow) map.focusPawn(follow, 1.6);
    },
    find: () => { if (sel?.k === 'pawn') map.focusPawn(sel.id, 1.6); },
    close: () => setSel(null),
    layout,
    share: () => {
      if (!sel || sel.k === 'bld') return;
      const u = new URL(location.href);
      u.search = live && here ? `?c=${here}&who=${sel.id}` : `${location.search.replace(/[?&]who=\d+/, '')}${location.search ? '&' : '?'}who=${sel.id}`;
      void navigator.clipboard?.writeText(u.toString()).then(() => toast('Link copied'), () => toast(u.toString()));
    },
    answer: (v) => {
      if (live) void live.send('act', { k: 'answer', v }).then((err) => { if (err) toast(err); });
      else c.inq.push({ t: c.tick + 1, k: 'answer', owner: me, v });
      ui?.touch();
    },
    nudge: (k, v) => {
      if (live) void live.send('act', { k, o: v, v }).then((err) => toast(err || 'They will get to it soon.'));
      else c.inq.push({ t: c.tick + 1, k: 'nudge', owner: me, kind: k, o: v, v });
      ui?.touch();
    },
  });
  layout();
  map.setColony(c);

  map.onPick = (hit) => {
    if (hit.pawn) { openPerson(hit.pawn, false); return; }
    if (hit.grave !== undefined) {
      const d = c.dead.find((x) => x.grave === hit.grave);
      if (d) { setSel({ k: 'dead', id: d.id }); return; }
    }
    if (hit.bld && c.blds.some((b) => b.id === hit.bld)) setSel({ k: 'bld', id: hit.bld });
    else if (ui?.phone()) setSel(null); // on a phone, tapping open ground puts the sheet away
  };
  map.onUserMove = () => { if (follow) setFollow(0); };

  bindMine();
  rejoin();
  syncMine();
  // a shared link opens straight onto someone's card
  const who = Number(q.get('who'));
  if (who && (pawnById(c, who) || c.dead.some((d) => d.id === who))) openPerson(who);
  else void digest();
  if (live) setInterval(() => { if (here && myPawn()) store.set('hl.seen.' + here, String(c.tick)); }, 60_000);
  document.getElementById('mine')?.classList.remove('hidden');

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (creator.isOpen) { if (e.key === 'Escape') creator.close(); return; }
    if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : 1); }
    else if (e.key >= '1' && e.key <= '4') setSpeed(SPEEDS[Number(e.key)]);
    else if (e.key === 'Escape') setSel(null);
  });
  window.addEventListener('resize', layout);

  map.app.ticker.add((tk) => frame(tk.deltaMS));
  loading?.classList.add('done');
  setTimeout(() => loading?.remove(), 600);
}

// Test hooks: drive the viewer from the console or from automated checks.
const hooks = {
  /** The live colony. Read it; do not change it. */
  get c(): Colony { return c; },
  pause: (): void => setSpeed(0),
  play: (s = 1): void => setSpeed(s),
  /** Fast-forward n game days right now. */
  days,
  select: (id: Id): void => openPerson(id),
  follow: (id: Id): void => {
    if (!id) { setFollow(0); return; }
    openPerson(id, false);
    if (pawnById(c, id)) { setFollow(id); map.focusPawn(id, 1.6); }
  },
  /** Open a left-hand panel: 'feed', 'people' or 'colony'. */
  open: (name: string): void => ui?.open(name),
  /** Start again with a different colony. */
  restart: (o: { seed: number; pop?: number; race?: RaceK }): void => {
    c = createColony(o);
    acc = 0;
    pending = false;
    setSel(null);
    map.setColony(c);
    syncMine();
  },
  /** Open the character creator. */
  creator: (): void => openCreator(),
  /** Make a random valid colonist and send them in at once. Returns the spec. */
  rollMine: (): PawnSpec => {
    const spec = randomSpec();
    join(spec);
    return spec;
  },
  /** My colonist, or null if there is none alive here. */
  me: (): Pawn | null => myPawn(),
  /** Forget the colonist remembered for this seed (they will not be sent in again on reload). */
  forgetMine: (): void => store.del(mineKey),
  map,
};
(window as unknown as { __hl: typeof hooks }).__hl = hooks;

void boot();
