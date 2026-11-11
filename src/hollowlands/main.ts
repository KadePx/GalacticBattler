// Hollow Lands viewer: the controller. For now the colony runs right here in the browser
// (the shared server comes later). This file owns the clock: it is the only place that
// steps the sim. The map and the panels only ever read the colony.
//
//   /hollow-lands/?seed=1&pop=16&race=dwarf&pre=30
//     seed  world seed (default 1)        pop  starting colonists (default 16)
//     race  main people (optional)        pre  game days to fast-forward before showing

import { DEFAULT_MS_PER_DAY, TICKS_PER_DAY } from './config';
import { RACES } from './sim/data/races';
import { createColony, step, type Colony, type Id, type RaceK } from './sim/index';
import { pawnById } from './sim/pawn';
import { MapView } from './view/map';
import { Panels, type Sel } from './view/panels';

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

let c: Colony = createColony(opts);
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

/** Run the colony forward n game days at once (test hook, and the pre= option). */
function days(n: number): void {
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
  if (speed > 0) {
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
  ui?.update(c, { sel, follow, speed }, performance.now());
}

async function boot(): Promise<void> {
  await map.init(document.getElementById('map') as HTMLElement);
  const pre = num('pre', 0, 0, 6000);
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

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
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
    setSel(null);
    map.setColony(c);
  },
  map,
};
(window as unknown as { __hl: typeof hooks }).__hl = hooks;

void boot();
