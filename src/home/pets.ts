// Household planner: Kaia and Korra, the two cats, living in a room on the Week page.
// They wander on their own, nap in their beds and sit on the cat tree; feeding and petting are
// shared, so each of us sees what the other did.
// The sprites were made with PixelLab (sheets in public/home/pets, layout in petSheets.ts).

import * as store from './store';
import { PROPS, SHEETS, SLEEP, type Anim, type PropId } from './petSheets';

export type PetId = 'korra' | 'kaia';
export interface PetState { fed: number; loved: number; fedBy?: string; meals: number; pets: number }

export const PETS: Record<PetId, { name: string; job: string; bowl: PropId; bed: PropId }> = {
  korra: { name: 'Korra', job: 'Owner, Korra’s Kitchen', bowl: 'bowlpink', bed: 'basket' },
  kaia: { name: 'Kaia', job: 'Interior designer, Studio Kaia', bowl: 'bowlteal', bed: 'bedteal' },
};
const IDS: PetId[] = ['korra', 'kaia'];
const FULL_HOURS = 12; // a meal lasts this long
const LOVE_HOURS = 8;
const SCALE = 2;
const TICK = 110; // ms per animation frame
const FLOOR = 6; // px from the bottom of the room to where feet stand
const CAT = SHEETS.korra.cell * SCALE;

// Where each thing stands along the room, 0 (left wall) to 1 (right wall). Korra's kitchen is on
// the left, Kaia's studio on the right. Small things (bowls, yarn) are drawn at half the cats'
// scale so they stay smaller than a cat.
// `rim` marks something a cat can get into: the sprite row where its front wall starts. From that
// row down it is drawn again in front of a cat that is inside, so she lies in it and not on it.
const LAYOUT: { id: PropId; x: number; rim?: number; scale?: number }[] = [
  { id: 'menu', x: 0 }, { id: 'basket', x: 0.1, rim: 9 }, { id: 'bowlpink', x: 0.235, scale: 1 }, { id: 'plant', x: 0.29 },
  { id: 'tree', x: 0.43 }, { id: 'yarn', x: 0.52, scale: 1 }, { id: 'box', x: 0.6, rim: 16 },
  { id: 'shelf', x: 0.8 }, { id: 'swatch', x: 0.74, scale: 1 }, { id: 'bowlteal', x: 0.84, scale: 1 }, { id: 'bedteal', x: 0.98, rim: 8 },
];
// The low platform of the cat tree: how far along the tree it is, and how high (sprite pixels).
const PERCH = { at: 55 / 74, up: 38 };

const blank: PetState = { fed: 0, loved: 0, meals: 0, pets: 0 };
export const petState = (id: PetId): PetState => ({ ...blank, ...store.get<PetState>(`pet:${id}`) });
const level = (since: number, hours: number) => Math.max(0, Math.min(1, 1 - (Date.now() - since) / (hours * 3_600_000)));
export const tummy = (id: PetId) => level(petState(id).fed, FULL_HOURS);
export const love = (id: PetId) => level(petState(id).loved, LOVE_HOURS);

/** Something to do once the cat has walked to its spot. */
interface Plan { anim: Anim | 'sleep'; secs: number; lift?: number; face?: 'left' | 'right'; inside?: boolean; spot?: 'box' | 'tree' }
interface Actor {
  id: PetId; x: number; flip: boolean; anim: Anim | 'sleep'; frame: number; left: number; // left = ticks until the next decision
  goal: number | null; plan: Plan | null; lift: number; inside: boolean; sheet: string; spot: string; el: HTMLElement; // spot = the shared place she is using or heading for
}

const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const night = () => { const h = new Date().getHours(); return h >= 22 || h < 6; };
const secs = (s: number) => Math.round((s * 1000) / TICK);
const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

let root: HTMLElement | null = null;
let room: HTMLElement;
let actors: Actor[] = [];
const cards = {} as Record<PetId, { line: HTMLElement; tummy: HTMLElement; love: HTMLElement; feed: HTMLButtonElement; note: HTMLElement }>;
let me = '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Where a cat must stand (0..1) for its middle to be `offset` px from the middle of a prop. */
function beside(prop: PropId, offset = 0, along = 0.5): number {
  const spot = LAYOUT.find((p) => p.id === prop)!;
  const w = PROPS[prop].w * (spot.scale ?? SCALE);
  const wide = room.clientWidth;
  const px = spot.x * (wide - w) + w * along + offset;
  return Math.max(0, Math.min(1, (px - CAT / 2) / (wide - CAT)));
}

function draw(a: Actor) {
  const asleep = a.anim === 'sleep';
  const main = SHEETS[a.id];
  const size = (asleep ? SLEEP.cell : main.cell) * SCALE;
  const st = a.el.style;
  if (a.sheet !== (asleep ? 'sleep' : 'main')) { // swap between the two sprite sheets
    a.sheet = asleep ? 'sleep' : 'main';
    st.width = st.height = `${size}px`;
    st.backgroundImage = `url(/home/pets/${a.id}${asleep ? '-sleep' : ''}.png)`;
    st.backgroundSize = asleep ? `${SLEEP.frames * size}px ${size}px`
      : `${Math.max(...main.rows.map((r) => r.frames)) * size}px ${main.rows.length * size}px`;
  }
  if (asleep) {
    // lie down once, then breathe slowly on the last two frames
    const f = a.frame < SLEEP.frames ? a.frame : SLEEP.frames - 2 + (Math.floor((a.frame - SLEEP.frames) / 10) % 2);
    st.backgroundPosition = `-${f * size}px 0`;
  } else {
    const row = main.rows.findIndex((r) => r.anim === a.anim);
    st.backgroundPosition = `-${(a.frame % main.rows[row].frames) * size}px -${row * size}px`;
  }
  st.left = `calc(${a.x} * (100% - ${CAT}px) - ${(size - CAT) / 2}px)`;
  st.bottom = `${FLOOR + a.lift}px`;
  st.zIndex = a.inside ? '2' : '4'; // walking cats pass in front of the furniture
  st.transform = a.flip ? 'scaleX(-1)' : '';
}

function go(a: Actor, x: number, plan: Plan | null) {
  a.lift = 0;
  a.inside = false;
  a.spot = plan?.spot ?? '';
  a.goal = x;
  a.plan = plan;
  a.anim = 'walk';
  a.frame = 0;
}

function decide(a: Actor) {
  a.frame = 0;
  if (a.plan) { // arrived somewhere with something to do
    const p = a.plan;
    a.plan = null;
    a.anim = p.anim;
    a.left = secs(p.secs);
    a.lift = p.lift ?? 0;
    a.inside = p.inside ?? false;
    if (p.face) a.flip = p.face === 'left';
    return;
  }
  if (a.lift || a.inside) { a.lift = 0; a.inside = false; a.spot = ''; a.anim = 'idle'; a.left = secs(1); return; } // get up or hop down first
  const bed = (): Plan => ({ anim: 'sleep', secs: night() ? 900 : 12 + Math.random() * 14, lift: 26, inside: true });
  if (night()) { go(a, beside(PETS[a.id].bed), bed()); return; }
  const hungry = tummy(a.id) < 0.25;
  const free = (spot: string) => !actors.some((o) => o !== a && o.spot === spot); // the box and the tree fit one cat
  const r = Math.random();
  if (r < 0.3) go(a, Math.random(), null);
  else if (r < 0.42 && !hungry) {
    if (Math.random() < 0.65) go(a, beside(PETS[a.id].bed), bed());
    else if (free('box')) go(a, beside('box'), { spot: 'box', anim: Math.random() < 0.5 ? 'idle' : 'lick', secs: 7 + Math.random() * 8, lift: 18, inside: true }); // if it fits, she sits
    else go(a, Math.random(), null);
  }
  else if (r < 0.54 && !hungry && free('tree')) {
    go(a, beside('tree', 0, PERCH.at), { spot: 'tree', anim: Math.random() < 0.5 ? 'loaf' : 'lick', secs: 7 + Math.random() * 8, lift: PERCH.up * SCALE - FLOOR - 12, face: 'left' });
  } else if (r < 0.62) go(a, beside('yarn', a.x < 0.52 ? -56 : 56), { anim: 'idle', secs: 3 });
  else if (hungry && r < 0.85) go(a, bowlSpot(a.id), { anim: 'idle', secs: 4, face: a.id === 'korra' ? 'left' : 'right' }); // waits by the empty bowl
  else {
    a.anim = r < 0.8 ? 'idle' : r < 0.92 ? 'lick' : 'yawn';
    a.left = secs(a.anim === 'yawn' ? 1.6 : 2.5 + Math.random() * 3);
  }
}

// Korra eats facing left at her bowl, Kaia facing right at hers, heads over the food.
const bowlSpot = (id: PetId) => beside(PETS[id].bowl, id === 'korra' ? 52 : -52);

function tick() {
  if (!root?.isConnected || root.classList.contains('folded') || document.visibilityState !== 'visible') return;
  for (const a of actors) {
    if (a.goal !== null) {
      const step = 5 / Math.max(240, room.clientWidth - CAT); // about 5 px a frame
      a.flip = a.goal < a.x;
      a.x += Math.sign(a.goal - a.x) * Math.min(step, Math.abs(a.goal - a.x));
      if (Math.abs(a.goal - a.x) < 0.0005) { a.goal = null; decide(a); }
    } else if (--a.left <= 0) decide(a);
    a.frame++;
    draw(a);
  }
}

function hearts(a: Actor, glyph = '♥') {
  for (let i = 0; i < 3; i++) {
    const h = el('span', 'heart', glyph);
    h.style.left = `calc(${a.x} * (100% - ${CAT}px) + ${CAT / 2 - 14 + i * 12}px)`;
    h.style.bottom = `${FLOOR + a.lift + 70}px`;
    h.style.animationDelay = `${i * 120}ms`;
    room.append(h);
    setTimeout(() => h.remove(), 1400);
  }
}

function pet(id: PetId) {
  const a = actors.find((x) => x.id === id)!;
  hearts(a);
  const s = petState(id);
  // one stored pet a minute is plenty; the hearts are free
  if (Date.now() - s.loved > 60_000) store.put('pet', `pet:${id}`, { ...s, loved: Date.now(), pets: s.pets + 1 });
}

function feed(id: PetId) {
  const a = actors.find((x) => x.id === id)!;
  const s = petState(id);
  store.put('pet', `pet:${id}`, { ...s, fed: Date.now(), fedBy: me, meals: s.meals + 1 });
  if (still) { hearts(a, '\u{1F35A}'); return; }
  go(a, bowlSpot(id), { anim: 'eat', secs: 5, face: id === 'korra' ? 'left' : 'right' });
  a.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function build() {
  root = el('section', 'pets');
  const scroller = el('div', 'roomscroll');
  room = el('div', 'room');
  scroller.append(room);
  room.style.height = `${Math.max(...LAYOUT.map((p) => PROPS[p.id].h * (p.scale ?? SCALE))) + FLOOR + 14}px`;
  room.append(el('span', 'sign left', 'Korra’s Kitchen'), el('span', 'sign right', 'Studio Kaia'));
  for (const p of LAYOUT) {
    const k = p.scale ?? SCALE;
    const w = PROPS[p.id].w * k;
    const h = PROPS[p.id].h * k;
    const place = (cls: string) => {
      const img = el('img', cls);
      img.src = `/home/pets/props/${p.id}.png`;
      img.alt = '';
      Object.assign(img.style, { width: `${w}px`, height: `${h}px`, left: `calc(${p.x} * (100% - ${w}px))`, bottom: `${FLOOR - 2}px` });
      room.append(img);
      return img;
    };
    place(p.scale === 1 ? 'prop near' : 'prop'); // bowls and yarn sit nearest, so a cat walks behind them
    if (p.rim !== undefined) place('prop front').style.clipPath = `inset(${p.rim * k}px 0 0 0)`;
  }
  actors = IDS.map((id, i) => {
    const cat = el('button', 'cat');
    cat.setAttribute('aria-label', `Pet ${PETS[id].name}`);
    cat.title = `Pet ${PETS[id].name}`;
    cat.addEventListener('click', () => pet(id));
    room.append(cat);
    const a: Actor = { id, x: i ? 0.7 : 0.36, flip: !!i, anim: 'idle', frame: 0, left: secs(1 + i), goal: null, plan: null, lift: 0, inside: false, sheet: '', spot: '', el: cat };
    new Image().src = `/home/pets/${id}-sleep.png`; // ready before the first nap
    draw(a);
    return a;
  });
  const list = el('div', 'petcards');
  for (const id of IDS) {
    const card = el('div', 'petcard');
    const head = el('div', 'pethead');
    head.append(el('b', '', PETS[id].name), el('small', '', PETS[id].job));
    const line = el('p', 'petline');
    const meters = el('div', 'meters');
    const meter = (label: string) => {
      const wrap = el('label', 'meter');
      const bar = el('i', '');
      const fill = el('b', '');
      bar.append(fill);
      wrap.append(el('span', '', label), bar);
      meters.append(wrap);
      return fill;
    };
    const t = meter('Tummy');
    const l = meter('Love');
    const acts = el('div', 'petacts');
    const feedBtn = el('button', '', 'Feed');
    feedBtn.addEventListener('click', () => feed(id));
    const petBtn = el('button', '', 'Pet');
    petBtn.addEventListener('click', () => pet(id));
    const note = el('small', 'petnote');
    acts.append(feedBtn, petBtn, note);
    card.append(head, line, meters, acts);
    list.append(card);
    cards[id] = { line, tummy: t, love: l, feed: feedBtn, note };
  }
  // The room takes a fair bit of space on a phone, so it can be folded away (remembered on this device).
  const fold = el('button', 'fold');
  const setFold = (hide: boolean) => {
    root!.classList.toggle('folded', hide);
    fold.textContent = hide ? 'Show Korra and Kaia' : 'Hide the cats';
    try { if (hide) localStorage.setItem('home-cats', 'hide'); else localStorage.removeItem('home-cats'); } catch { /* private window */ }
  };
  fold.addEventListener('click', () => setFold(!root!.classList.contains('folded')));
  root.append(scroller, list, fold);
  setFold(recall('home-cats') === 'hide');
  // On a narrow screen the room is wider than the page: start looking at its middle.
  requestAnimationFrame(() => { scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2; });
  if (still) {
    // No wandering: each cat rests in her own bed.
    for (const a of actors) { a.x = beside(PETS[a.id].bed); a.anim = 'sleep'; a.frame = SLEEP.frames - 1; a.lift = 26; a.inside = true; draw(a); }
  } else setInterval(tick, TICK);
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** The pets strip: one lasting element, so the cats keep walking while the page redraws around them. */
export function petsPanel(who: string, lines: Record<PetId, string>): HTMLElement {
  if (!root) build();
  me = who;
  for (const id of IDS) {
    const c = cards[id];
    const s = petState(id);
    const full = tummy(id);
    c.line.textContent = lines[id];
    c.tummy.style.width = `${Math.round(full * 100)}%`;
    c.tummy.className = full < 0.25 ? 'low' : '';
    c.love.style.width = `${Math.round(love(id) * 100)}%`;
    c.love.className = love(id) < 0.25 ? 'low' : '';
    c.feed.disabled = full > 0.8;
    c.feed.textContent = full > 0.8 ? 'Full' : 'Feed';
    c.note.textContent = s.fed ? `Fed ${ago(s.fed)}${s.fedBy ? ` by ${s.fedBy}` : ''}` : 'Not fed yet';
  }
  return root!;
}
