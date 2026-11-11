// Hollow Lands viewer: the controller. For now the colony runs right here in the browser
// (the shared server comes later). This file owns the clock: it is the only place that
// steps the sim. The map and the panels only ever read the colony.
//
//   /hollow-lands/?seed=1&pop=16&race=dwarf&pre=30
//     seed  world seed (default 1)        pop  starting colonists (default 16)
//     race  main people (optional)        pre  game days to fast-forward before showing

import { DEFAULT_MS_PER_DAY, TICKS_PER_DAY } from './config';
import { RACES } from './sim/data/races';
import { connect, liveAvailable, myHash, type Live } from './net';
import { createColony, step, type Colony, type Id, type RaceK } from './sim/index';
import { checkSpec, type PawnSpec } from './sim/create';
import { fullName, pawnById } from './sim/pawn';
import type { Dead, Pawn } from './sim/types';
import { dateText } from './text';
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
    syncMine();
    void live.join(spec).then((err) => {
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
  const d = p ? null : myDead();
  meId = p?.id ?? d?.id ?? 0;
  map.mineId = p?.id ?? 0;
  const label = pending && !p ? 'On the road…' : p ? 'My colonist' : d ? 'Make a new colonist' : 'Make your colonist';
  const banner = !p && !pending && d && dismissed !== d.id
    ? `<span class="t"><b>${esc(fullName(d))}</b> ${d.left ? 'was lost to the colony' : 'died'} on ${dateText(d.died)}: ${esc(causeText(c, d).toLowerCase())}.</span><button class="btn sm" data-m="view">Remember them</button><button class="btn sm go" data-m="new">Make a new colonist</button><button class="icon" data-m="x" title="Close" aria-label="Close">&times;</button>`
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

function bindMine(): void {
  document.getElementById('mine')?.addEventListener('click', () => {
    if (myPawn()) goToMine();
    else if (!pending) creator.open(c.name);
  });
  document.getElementById('memorial')?.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
    const d = myDead();
    if (k === 'view' && d) setSel({ k: 'dead', id: d.id });
    else if (k === 'new') creator.open(c.name);
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
  map.render(c, c.tick - 1 + acc, dt);
  const now = performance.now();
  watchMine(now);
  ui?.update(c, { sel, follow, speed, me: meId }, now);
}

async function boot(): Promise<void> {
  await map.init(document.getElementById('map') as HTMLElement);
  if (!wantLocal && (await liveAvailable())) {
    if (loadMsg) loadMsg.textContent = 'Finding the colony';
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
  creator: (): void => creator.open(c.name),
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
