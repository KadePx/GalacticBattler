// Household planner: Kaia and Korra, the two cats, living in a strip on the Week page.
// They wander on their own; feeding and petting are shared, so each of us sees what the other did.
// The sprites were made with PixelLab (sheets in public/home/pets, layout in petSheets.ts).

import * as store from './store';
import { SHEETS, type Anim } from './petSheets';

export type PetId = 'korra' | 'kaia';
export interface PetState { fed: number; loved: number; fedBy?: string; meals: number; pets: number }

export const PETS: Record<PetId, { name: string; job: string; home: number }> = {
  // home = where their bowl sits along the room, 0 (left) to 1 (right)
  korra: { name: 'Korra', job: 'Owner, Korra’s Kitchen', home: 0.02 },
  kaia: { name: 'Kaia', job: 'Interior designer, Studio Kaia', home: 0.98 },
};
const IDS: PetId[] = ['korra', 'kaia'];
const FULL_HOURS = 12; // a meal lasts this long
const LOVE_HOURS = 8;
const SCALE = 2;
const TICK = 110; // ms per animation frame

const blank: PetState = { fed: 0, loved: 0, meals: 0, pets: 0 };
export const petState = (id: PetId): PetState => ({ ...blank, ...store.get<PetState>(`pet:${id}`) });
const level = (since: number, hours: number) => Math.max(0, Math.min(1, 1 - (Date.now() - since) / (hours * 3_600_000)));
export const tummy = (id: PetId) => level(petState(id).fed, FULL_HOURS);
export const love = (id: PetId) => level(petState(id).loved, LOVE_HOURS);

interface Actor {
  id: PetId; x: number; flip: boolean; anim: Anim; frame: number; left: number; // left = ticks until the next decision
  goal: number | null; then: Anim | null; el: HTMLElement;
}

const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const night = () => { const h = new Date().getHours(); return h >= 22 || h < 6; };
const secs = (s: number) => Math.round((s * 1000) / TICK);

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

function draw(a: Actor) {
  const sheet = SHEETS[a.id];
  const size = sheet.cell * SCALE;
  const row = sheet.rows.findIndex((r) => r.anim === a.anim);
  a.el.style.backgroundPosition = `-${(a.frame % sheet.rows[row].frames) * size}px -${row * size}px`;
  a.el.style.left = `calc(${a.x} * (100% - ${size}px))`;
  a.el.style.transform = a.flip ? 'scaleX(-1)' : '';
}

function decide(a: Actor) {
  a.frame = 0;
  if (a.then) { // arrived somewhere with something to do
    a.anim = a.then;
    a.then = null;
    a.left = secs(a.anim === 'eat' ? 5 : 3);
    return;
  }
  if (night()) { a.anim = 'loaf'; a.left = secs(20); return; }
  const hungry = tummy(a.id) < 0.25;
  const r = Math.random();
  if (r < (hungry ? 0.25 : 0.45)) {
    a.goal = Math.random();
    a.anim = 'walk';
  } else {
    a.anim = r < 0.65 ? 'idle' : r < 0.78 ? 'lick' : r < 0.92 ? 'loaf' : 'yawn';
    a.left = secs(a.anim === 'loaf' ? 6 + Math.random() * 6 : a.anim === 'yawn' ? 1.6 : 2.5 + Math.random() * 3);
  }
}

function tick() {
  if (!root?.isConnected || document.visibilityState !== 'visible') return;
  for (const a of actors) {
    if (a.goal !== null) {
      const step = 0.012 * (360 / Math.max(240, room.clientWidth)) * 2;
      a.flip = a.goal < a.x;
      a.x += Math.sign(a.goal - a.x) * Math.min(step, Math.abs(a.goal - a.x));
      if (Math.abs(a.goal - a.x) < 0.001) { a.goal = null; decide(a); }
    } else if (--a.left <= 0) decide(a);
    a.frame++;
    draw(a);
  }
}

function hearts(a: Actor, glyph = '♥') {
  const size = SHEETS[a.id].cell * SCALE;
  for (let i = 0; i < 3; i++) {
    const h = el('span', 'heart', glyph);
    h.style.left = `calc(${a.x} * (100% - ${size}px) + ${size / 2 - 14 + i * 12}px)`;
    h.style.animationDelay = `${i * 120}ms`;
    room.append(h);
    setTimeout(() => h.remove(), 1400);
  }
}

function pet(id: PetId) {
  const a = actors.find((x) => x.id === id)!;
  hearts(a);
  if (a.goal === null && a.anim !== 'eat') { a.anim = 'idle'; a.frame = 0; a.left = secs(2); }
  const s = petState(id);
  // one stored pet a minute is plenty; the hearts are free
  if (Date.now() - s.loved > 60_000) store.put('pet', `pet:${id}`, { ...s, loved: Date.now(), pets: s.pets + 1 });
}

function feed(id: PetId) {
  const a = actors.find((x) => x.id === id)!;
  const s = petState(id);
  store.put('pet', `pet:${id}`, { ...s, fed: Date.now(), fedBy: me, meals: s.meals + 1 });
  if (still) { hearts(a, '\u{1F35A}'); return; }
  a.goal = PETS[id].home;
  a.anim = 'walk';
  a.then = 'eat';
}

function build() {
  root = el('section', 'pets');
  room = el('div', 'room');
  room.append(el('span', 'sign left', 'Korra’s Kitchen'), el('span', 'sign right', 'Studio Kaia'), el('i', 'bowl left'), el('i', 'bowl right'));
  actors = IDS.map((id, i) => {
    const sheet = SHEETS[id];
    const size = sheet.cell * SCALE;
    const cat = el('button', 'cat');
    cat.setAttribute('aria-label', `Pet ${PETS[id].name}`);
    cat.title = `Pet ${PETS[id].name}`;
    Object.assign(cat.style, {
      width: `${size}px`, height: `${size}px`, backgroundImage: `url(/home/pets/${id}.png)`,
      backgroundSize: `${Math.max(...sheet.rows.map((r) => r.frames)) * size}px ${sheet.rows.length * size}px`,
    });
    cat.addEventListener('click', () => pet(id));
    room.append(cat);
    const a: Actor = { id, x: i ? 0.7 : 0.3, flip: !!i, anim: 'idle', frame: 0, left: secs(1 + i), goal: null, then: null, el: cat };
    draw(a);
    return a;
  });
  room.style.height = `${Math.max(...IDS.map((id) => SHEETS[id].cell)) * SCALE + 18}px`;
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
  root.append(room, list);
  if (!still) setInterval(tick, TICK);
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
