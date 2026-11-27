// Household planner page (/home/): shared week and month calendar, meal plan, recipes, groceries.

import * as store from './store';
import { PETS, love, petsPanel, tummy, type PetId } from './pets';
import {
  CATS, DAY_LABEL, DAY_TYPES, DEFAULT_DAYS, DOW, MONTHS, SLOTS, addDays, dayType, dow, eventsOn, groceriesFor, ingredientLine,
  DEFAULT_PREFS, mondayOf, need, niceDate, niceQty, niceTime, parseIngredient, toDate, today, tripsOn, weekDays, wholeFoodsUrl, worksOn, ymd,
  type Cat, type DayMark, type DayType, type Ev, type Grocery, type Meal, type Person, type Prefs, type Recipe, type Slot, type Tick, type Trip, type World,
} from './model';

type Child = Node | string | number | null | undefined | false;
type Kids = Child | Kids[];
type Attrs = Record<string, unknown>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Kids[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Attrs)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const kid of (kids as unknown[]).flat(4) as Child[]) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const COLORS = ['#c2553d', '#2f7f79', '#b7832f', '#6a5acd', '#3f7fbf', '#b0457f'];
const SLOT_LABEL: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

type View = 'week' | 'month' | 'recipes' | 'groceries' | 'out' | 'trips';
const ui = {
  view: 'week' as View,
  week: mondayOf(today()),
  month: today().slice(0, 7),
  paint: null as { email: string; type: DayType } | null,
  loaded: false,
};

// ---- reading the store ----

const people = () => store.all<Person>('person').map((i) => i.data)
  .sort((a, b) => Number(b.email === store.me) - Number(a.email === store.me) || a.name.localeCompare(b.name));
const world = (): World => ({
  people: people(),
  events: store.all<Ev>('event').map((i) => ({ id: i.id, ev: i.data })),
  trips: store.all<Trip>('trip').map((i) => ({ id: i.id, trip: i.data })),
  dayMark: (email, date) => store.get<DayMark>(`d:${email}:${date}`),
});
const recipes = () => store.all<Recipe>('recipe').sort((a, b) => a.data.name.localeCompare(b.data.name));
const mealId = (date: string, slot: Slot) => `m:${date}:${slot}`;
const mealAt = (date: string, slot: Slot) => store.get<Meal>(mealId(date, slot));
const mealName = (m: Meal | undefined) => (m?.recipe ? store.get<Recipe>(m.recipe)?.name : undefined) ?? m?.text ?? '';
const colorOf = (who: string) => people().find((p) => p.email === who)?.color ?? 'var(--both)';
const names = (ps: Person[]) => ps.map((p) => p.name).join(' & ');

// ---- dialog ----

const dlg = document.getElementById('dlg') as HTMLDialogElement;
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function openDialog(title: string, ...body: Kids[]) {
  dlg.replaceChildren(h('div', { class: 'sheet' },
    h('header', null, h('h2', null, title), h('button', { class: 'ghost', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
    ...body));
  if (!dlg.open) dlg.showModal();
}
// A group of controls (day buttons, checkboxes) can't sit inside a <label>, so it gets a plain wrapper.
const field = (label: string, control: HTMLElement) =>
  h(control instanceof HTMLDivElement ? 'div' : 'label', { class: 'field', role: control instanceof HTMLDivElement ? 'group' : null, 'aria-label': control instanceof HTMLDivElement ? label : null },
    h('span', null, label), control);
const select = (value: string, options: [string, string][], attrs: Attrs = {}) =>
  h('select', attrs, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
const checkbox = (label: string, checked: boolean, attrs: Attrs = {}) =>
  h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, ...attrs }), h('span', null, label));

// ---- theme: kept on this device, so each phone can have its own ----

const THEMES: [string, string][] = [['', 'Match this device'], ['light', 'Light'], ['dark', 'Dark'], ['pink', 'Pink']];
const savedTheme = () => { try { return localStorage.getItem('home-theme') ?? ''; } catch { return ''; } };
function setTheme(t: string) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem('home-theme', t); else localStorage.removeItem('home-theme'); } catch { /* private window */ }
}

// ---- profile ----

function profileDialog(first: boolean) {
  const mine = people().find((p) => p.email === store.me);
  const p: Person = mine ? { ...mine } : { email: store.me, name: '', color: COLORS[people().length % COLORS.length], schedule: 'fixed' };
  let defaults = [...(p.defaults ?? DEFAULT_DAYS)];
  const name = h('input', { value: p.name, placeholder: 'Your name', required: true, maxLength: 30 });
  const swatches = h('div', { class: 'swatches' });
  const drawSwatches = () => swatches.replaceChildren(...COLORS.map((c) => h('button', {
    type: 'button', class: c === p.color ? 'on' : '', style: `background:${c}`, 'aria-label': `Colour ${c}`,
    onclick: () => { p.color = c; drawSwatches(); },
  })));
  drawSwatches();
  const usual = h('div', { class: 'usual' });
  const drawUsual = () => {
    usual.hidden = p.schedule !== 'varies';
    usual.replaceChildren(h('p', { class: 'hint' }, 'Your usual week. Change any single day later from the calendar.'),
      h('div', { class: 'usual-row' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('label', null, DOW[d],
        select(defaults[d], DAY_TYPES.map((t) => [t, DAY_LABEL[t]]), { onchange: (e: Event) => { defaults[d] = (e.target as HTMLSelectElement).value as DayType; } })))));
  };
  drawUsual();
  const sched = select(p.schedule, [['fixed', 'Fixed hours: the same work days each week'], ['varies', 'Varies: office days, shifts and days off']],
    { onchange: (e: Event) => { p.schedule = (e.target as HTMLSelectElement).value as Person['schedule']; drawUsual(); } });
  openDialog(first ? 'Welcome. Set up your side' : 'Your profile',
    h('form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        p.name = name.value.trim();
        if (!p.name) return;
        if (p.schedule === 'varies') p.defaults = defaults; else delete p.defaults;
        if (first && !recipes().length) seedRecipes();
        store.put('person', `p:${store.me}`, p);
        dlg.close();
      },
    },
    h('p', { class: 'hint' }, `Signed in as ${store.me}`),
    field('Name', name), field('Your colour', swatches),
    field('Theme on this device', select(savedTheme(), THEMES, { onchange: (e: Event) => setTheme((e.target as HTMLSelectElement).value) })),
    field('Work schedule', sched), usual,
    h('p', { class: 'hint' }, 'On shift days meals count as provided at work, so nothing is planned for you. On office days a packed lunch is counted.'),
    h('footer', null, h('button', { class: 'primary' }, 'Save'))));
}

function seedRecipes() {
  const base = { quick: true, batch: false, servings: 1, ingredients: [], slots: ['breakfast'] as Slot[] };
  store.put('recipe', 'seed-smoothie', { ...base, name: 'Smoothie', minutes: 5 } satisfies Recipe);
  store.put('recipe', 'seed-oats', { ...base, name: 'Oats', minutes: 5 } satisfies Recipe);
}

// ---- events ----

const linkIn = (text?: string) => {
  const url = text?.match(/https:\/\/\S+/)?.[0];
  return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open link ↗') : null;
};

function eventDialog(id: string | null, date: string) {
  const old = id ? store.get<Ev>(id) : undefined;
  const ev: Ev = old ? structuredClone(old) : { title: '', who: store.me, cat: 'other', date };
  const title = h('input', { value: ev.title, placeholder: 'What is it?', required: true, maxLength: 80 });
  const who = select(ev.who, [...people().map((p) => [p.email, p.name] as [string, string]), ['both', 'Both of us']]);
  const cat = select(ev.cat, Object.entries(CATS) as [string, string][]);
  const day = h('input', { type: 'date', value: ev.date, required: true });
  const start = h('input', { type: 'time', value: ev.start ?? '' });
  const end = h('input', { type: 'time', value: ev.end ?? '' });
  const until = h('input', { type: 'date', value: ev.repeat?.until ?? '' });
  const notes = h('textarea', { rows: 2, maxLength: 500 }, ev.notes ?? '');
  const days = new Set(ev.repeat?.days ?? []);
  const dayBtns = h('div', { class: 'daypick' });
  const untilField = field('Repeat until (optional)', until);
  const drawDays = () => {
    untilField.hidden = !days.size;
    dayBtns.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', {
      type: 'button', class: days.has(d) ? 'on' : '', onclick: () => { if (!days.delete(d)) days.add(d); drawDays(); },
    }, DOW[d])));
  };
  drawDays();
  const save = (e: Event) => {
    e.preventDefault();
    const out: Ev = { title: title.value.trim(), who: who.value, cat: cat.value as Cat, date: day.value };
    if (!out.title || !out.date) return;
    if (start.value) { out.start = start.value; if (end.value) out.end = end.value; }
    if (notes.value.trim()) out.notes = notes.value.trim();
    if (days.size) {
      out.repeat = { days: [...days].sort() };
      if (until.value) out.repeat.until = until.value;
      if (ev.skip?.length) out.skip = ev.skip;
    }
    store.put('event', id ?? store.newId(), out);
    dlg.close();
  };
  openDialog(id ? 'Edit event' : 'New event', h('form', { onsubmit: save },
    field('Title', title),
    h('div', { class: 'row' }, field('Who', who), field('Type', cat)),
    h('div', { class: 'row' }, field(days.size ? 'Starts' : 'Date', day), field('From', start), field('To', end)),
    h('p', { class: 'hint' }, 'Leave the times empty for an all-day event.'),
    field('Repeats every', dayBtns), untilField,
    field('Notes', notes),
    linkIn(ev.notes),
    h('footer', null,
      id && h('button', { type: 'button', class: 'danger', onclick: () => { store.del(id); dlg.close(); } }, old?.repeat ? 'Delete all' : 'Delete'),
      id && old?.repeat && h('button', {
        type: 'button', onclick: () => { store.put('event', id, { ...old, skip: [...(old.skip ?? []), date] }); dlg.close(); },
      }, `Skip ${niceDate(date)} only`),
      h('button', { class: 'primary' }, 'Save'))));
  if (!id) title.focus();
}

// ---- meals ----

function mealDialog(date: string, slot: Slot) {
  const current = mealAt(date, slot);
  const w = world();
  const week = weekDays(mondayOf(date));
  // Lunches are prepped for work days, so spreading one across the week leaves at-home days alone.
  const wanted = (d: string) => (slot === 'lunch' ? need(w, d, slot).pack.length > 0 : need(w, d, slot).portions > 0);
  const spread = h('input', { type: 'checkbox' });
  const set = (meal: Meal | null) => {
    const targets = spread.checked
      ? week.filter((d) => d === date || (!mealAt(d, slot) && wanted(d)))
      : [date];
    for (const d of targets) { if (meal) store.put('meal', mealId(d, slot), meal); else store.del(mealId(d, slot)); }
    dlg.close();
  };
  const fits = recipes().filter((r) => r.data.slots.includes(slot));
  // Lunches are prepped ahead, so batch recipes lead; dinners should be easy, so quick ones lead.
  const lead = (r: Recipe) => Number(slot === 'lunch' ? r.batch : r.quick);
  fits.sort((a, b) => lead(b.data) - lead(a.data) || a.data.name.localeCompare(b.data.name));
  const text = h('input', { placeholder: 'Or type anything: leftovers, eating out…', value: current?.text ?? '', maxLength: 80 });
  openDialog(`${SLOT_LABEL[slot]}, ${niceDate(date)}`,
    h('label', { class: 'check' }, spread, h('span', null, slot === 'lunch' ? 'Also use for every unplanned packed lunch this week' : `Also use for every empty ${slot} this week`)),
    h('div', { class: 'picklist' }, fits.length ? fits.map((r) => h('button', {
      class: current?.recipe === r.id ? 'on' : '', onclick: () => set({ recipe: r.id }),
    }, h('b', null, r.data.name), h('small', null, recipeTags(r.data)))) : h('p', { class: 'hint' }, `No ${slot} recipes yet. Add some under Recipes, or type one below.`)),
    h('form', { class: 'row', onsubmit: (e: Event) => { e.preventDefault(); if (text.value.trim()) set({ text: text.value.trim() }); } },
      text, h('button', { class: 'primary' }, 'Use')),
    h('footer', null, current && h('button', { class: 'danger', onclick: () => set(null) }, 'Clear this meal')));
}

const recipeTags = (r: Recipe) => [r.quick && 'quick', r.batch && 'batch prep', r.minutes && `${r.minutes} min`, `serves ${r.servings}`].filter(Boolean).join(' · ');

function recipeDialog(id: string | null) {
  const old = id ? store.get<Recipe>(id) : undefined;
  const r: Recipe = old ? structuredClone(old) : { name: '', slots: ['dinner'], quick: false, batch: false, minutes: null, servings: 2, ingredients: [] };
  const name = h('input', { value: r.name, required: true, maxLength: 80, placeholder: 'Recipe name' });
  const slots = new Set(r.slots);
  const slotBox = h('div', { class: 'row' }, SLOTS.map((s) => checkbox(SLOT_LABEL[s], slots.has(s), { onchange: () => { if (!slots.delete(s)) slots.add(s); } })));
  const quick = h('input', { type: 'checkbox', checked: r.quick });
  const batch = h('input', { type: 'checkbox', checked: r.batch });
  const minutes = h('input', { type: 'number', min: 0, max: 600, value: r.minutes ?? '' });
  const servings = h('input', { type: 'number', min: 1, max: 40, value: r.servings, required: true });
  const ings = h('textarea', { rows: 6, placeholder: 'One per line, amount first:\n2 cups rolled oats\n1 banana\nsalt' }, r.ingredients.map(ingredientLine).join('\n'));
  const link = h('input', { type: 'url', value: r.link ?? '', placeholder: 'https://…' });
  const notes = h('textarea', { rows: 3, maxLength: 2000 }, r.notes ?? '');
  openDialog(id ? 'Edit recipe' : 'New recipe', h('form', {
    onsubmit: (e: Event) => {
      e.preventDefault();
      const out: Recipe = {
        name: name.value.trim(), slots: SLOTS.filter((s) => slots.has(s)), quick: quick.checked, batch: batch.checked,
        minutes: minutes.value ? Number(minutes.value) : null, servings: Math.max(1, Number(servings.value) || 1),
        ingredients: ings.value.split('\n').map(parseIngredient).filter((i) => i !== null),
      };
      if (!out.name) return;
      if (!out.slots.length) out.slots = ['dinner'];
      if (link.value.trim()) out.link = link.value.trim();
      if (notes.value.trim()) out.notes = notes.value.trim();
      store.put('recipe', id ?? store.newId(), out);
      dlg.close();
    },
  },
  field('Name', name), field('Good for', slotBox),
  h('div', { class: 'row' },
    h('label', { class: 'check' }, quick, h('span', null, 'Quick and easy')),
    h('label', { class: 'check' }, batch, h('span', null, 'Batch prep ahead'))),
  h('div', { class: 'row' }, field('Minutes', minutes), field('Serves', servings)),
  field('Ingredients', ings),
  h('p', { class: 'hint' }, 'Amounts are for the number it serves. The grocery list scales them to who is eating.'),
  field('Link', link), field('Notes', notes),
  h('footer', null,
    id && h('button', { type: 'button', class: 'danger', onclick: () => { store.del(id); dlg.close(); } }, 'Delete'),
    h('button', { class: 'primary' }, 'Save'))));
  if (!id) name.focus();
}

// ---- week view ----

function setDay(p: Person, date: string, type: DayType) {
  const id = `d:${p.email}:${date}`;
  if ((p.defaults ?? DEFAULT_DAYS)[dow(date)] === type) store.del(id); else store.put('day', id, { type } satisfies DayMark);
}

function needNote(w: World, date: string, slot: Slot): string {
  const n = need(w, date, slot);
  const bits: string[] = [];
  if (n.pack.length) bits.push(`pack ${n.pack.length}${n.pack.length < w.people.length ? ` (${names(n.pack)})` : ''}`);
  if (n.home.length && n.pack.length) bits.push(`${names(n.home)} at home`);
  else if (n.home.length && (n.comped.length || n.away.length)) bits.push(`just ${names(n.home)}`);
  if (n.comped.length) bits.push(`${names(n.comped)} fed at work`);
  if (n.away.length) bits.push(`${names(n.away)} away`);
  return bits.join(' · ');
}

function dayCard(w: World, date: string) {
  const d = toDate(date);
  const evs = eventsOn(w, date);
  return h('section', { class: `day${date === today() ? ' today' : ''}` },
    h('header', null,
      h('h3', null, h('span', null, DOW[d.getDay()]), ` ${d.getDate()}`),
      w.people.filter((p) => p.schedule === 'varies').map((p) => {
        const t = dayType(w, p, date);
        return h('button', {
          class: `chip t-${t}`, title: `${p.name}: tap to change`,
          onclick: () => setDay(p, date, DAY_TYPES[(DAY_TYPES.indexOf(t) + 1) % DAY_TYPES.length]),
        }, w.people.length > 1 ? `${p.name}: ` : '', DAY_LABEL[t]);
      })),
    h('div', { class: 'events' },
      tripsOn(w, date).map(({ trip }) => h('button', { class: 'ev trip', style: `--c:${colorOf(trip.who)}`, onclick: () => { ui.view = 'trips'; render(); } },
        h('time', null, 'trip'), h('span', null, trip.name), h('small', null, trip.where))),
      evs.map(({ id, ev }) => h('button', { class: `ev c-${ev.cat}`, style: `--c:${colorOf(ev.who)}`, onclick: () => eventDialog(id, date) },
        h('time', null, ev.start ? `${niceTime(ev.start)}${ev.end ? '–' + niceTime(ev.end) : ''}` : 'all day'),
        h('span', null, ev.title), ev.who === 'both' && h('small', null, 'both'))),
      h('button', { class: 'add', onclick: () => eventDialog(null, date) }, '+ event')),
    h('div', { class: 'meals' }, SLOTS.map((slot) => {
      const n = need(w, date, slot);
      const name = mealName(mealAt(date, slot));
      const skip = w.people.length > 0 && n.portions === 0;
      return h('button', { class: `meal${name ? '' : ' empty'}${skip ? ' skip' : ''}`, onclick: () => mealDialog(date, slot) },
        h('i', null, SLOT_LABEL[slot]),
        h('span', null, name || (skip ? 'not needed' : 'choose…')),
        h('small', null, needNote(w, date, slot)));
    })));
}

function weekSummary(w: World, days: string[]) {
  const lines: Kids[] = [];
  const packs = w.people.map((p) => ({ p, n: days.filter((d) => need(w, d, 'lunch').pack.includes(p)).length })).filter((x) => x.n);
  const total = packs.reduce((s, x) => s + x.n, 0);
  const unplanned = days.reduce((s, d) => s + (mealAt(d, 'lunch') ? 0 : need(w, d, 'lunch').pack.length), 0);
  lines.push(h('p', null, h('b', null, `${total} lunch${total === 1 ? '' : 'es'} to prep`),
    total ? ` (${packs.map((x) => `${x.p.name} ${x.n}`).join(', ')})` : '',
    unplanned ? h('em', null, ` · ${unplanned} not planned yet`) : total ? ' · all planned' : ''));
  for (const p of w.people.filter((x) => x.schedule === 'varies')) {
    const shifts = days.filter((d) => dayType(w, p, d) === 'shift');
    if (shifts.length) lines.push(h('p', null, `${p.name} on shift ${shifts.map((d) => DOW[dow(d)]).join(', ')}: meals covered at work, so those days are planned for ${w.people.length > 1 ? 'one' : 'no one'}.`));
  }
  for (const p of w.people.filter((x) => x.schedule === 'fixed')) {
    if (!w.events.some((e) => e.ev.cat === 'work' && (e.ev.who === p.email || e.ev.who === 'both'))) {
      lines.push(h('p', { class: 'hint' }, `Tip: add ${p.name}'s work hours as a repeating event of type Work, so their packed lunches are counted.`));
    }
  }
  const dinners = days.filter((d) => !mealAt(d, 'dinner') && need(w, d, 'dinner').portions > 0).length;
  if (dinners) lines.push(h('p', null, `${dinners} dinner${dinners === 1 ? '' : 's'} still open.`));
  return h('aside', { class: 'summary' }, lines,
    h('button', { onclick: () => buildGroceries(w) }, 'Build grocery list for this week'));
}

function buildGroceries(w: World) {
  const fresh = groceriesFor(w, ui.week, mealAt, (id) => store.get<Recipe>(id));
  const old = store.all<Grocery>('grocery').filter((g) => g.data.week === ui.week);
  const ticked = new Set(old.filter((g) => g.data.done).map((g) => g.data.name.toLowerCase()));
  for (const g of old) store.del(g.id);
  for (const g of fresh) store.put('grocery', store.newId(), { ...g, done: ticked.has(g.name.toLowerCase()) });
  ui.view = 'groceries';
  render();
}

/** What each cat is up to today. Korra runs the kitchen, so she follows the meal plan; Kaia designs, so she follows the house. */
function petLines(w: World): Record<PetId, string> {
  const day = Math.floor(toDate(today()).getTime() / 86_400_000);
  const pick = (list: string[], salt: number) => list[(day + salt) % list.length];
  const dinner = mealName(mealAt(today(), 'dinner'));
  const trip = w.trips.map((t) => t.trip).filter((t) => t.end >= today() && t.start <= addDays(today(), 7)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const packs = need(w, today(), 'lunch').pack.length;
  const lines: Record<PetId, string> = {
    korra: dinner ? `Tonight\u2019s special at Korra\u2019s Kitchen: ${dinner}.`
      : pick([
        'No special on the board tonight. The owner is not impressed.',
        packs ? `Inspected today\u2019s ${packs} packed lunch${packs === 1 ? '' : 'es'}. Passed, barely.` : 'Kitchen closed for a private nap.',
        'Reviewing suppliers. Requests more tuna.',
        'Tonight\u2019s menu is blank. Considering firing the staff.',
      ], 0),
    kaia: trip ? `Designing the suitcase layout for ${trip.name}. Step one: sit in it.`
      : pick([
        'Moved one sock to the hallway. Calls it an accent piece.',
        'Client review of the blanket layout: needs more blanket.',
        'Rearranged the desk by pushing a pen off it.',
        'Sourcing textures. The couch arm has been sampled.',
        'Feng shui audit complete: the sunny spot stays hers.',
      ], 3),
  };
  for (const id of ['korra', 'kaia'] as PetId[]) {
    if (tummy(id) < 0.25) lines[id] = id === 'korra' ? 'Hungry. The kitchen is closed until the owner is fed.' : 'Hungry. All design work is paused until further notice.';
    else if (love(id) < 0.25) lines[id] += ` ${PETS[id].name} would accept pets.`;
  }
  return lines;
}

function weekView() {
  const w = world();
  const days = weekDays(ui.week);
  const a = toDate(days[0]);
  const b = toDate(days[6]);
  const label = `${a.getDate()}${a.getMonth() === b.getMonth() ? '' : ' ' + MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)}`;
  return [
    h('div', { class: 'bar' },
      h('button', { 'aria-label': 'Previous week', onclick: () => { ui.week = addDays(ui.week, -7); render(); } }, '‹'),
      h('h2', null, label),
      h('button', { 'aria-label': 'Next week', onclick: () => { ui.week = addDays(ui.week, 7); render(); } }, '›'),
      ui.week !== mondayOf(today()) && h('button', { onclick: () => { ui.week = mondayOf(today()); render(); } }, 'This week')),
    petsPanel(people().find((p) => p.email === store.me)?.name ?? '', petLines(w)),
    weekSummary(w, days),
    h('div', { class: 'week' }, days.map((d) => dayCard(w, d))),
  ];
}

// ---- month view ----

function monthView() {
  const w = world();
  const [y, m] = ui.month.split('-').map(Number);
  const first = ymd(new Date(y, m - 1, 1));
  const start = mondayOf(first);
  const shift = (n: number) => { ui.month = ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); render(); };
  const varies = w.people.filter((p) => p.schedule === 'varies');
  const cells: Child[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    if (i >= 35 && date.slice(0, 7) !== ui.month) break;
    const evs = eventsOn(w, date);
    cells.push(h('button', {
      class: `cell${date.slice(0, 7) === ui.month ? '' : ' out'}${date === today() ? ' today' : ''}`,
      onclick: () => {
        const p = ui.paint && w.people.find((x) => x.email === ui.paint!.email);
        if (p) setDay(p, date, ui.paint!.type);
        else { ui.week = mondayOf(date); ui.view = 'week'; render(); }
      },
    },
    h('b', null, toDate(date).getDate()),
    varies.map((p) => { const t = dayType(w, p, date); return h('span', { class: `tag t-${t}` }, DAY_LABEL[t]); }),
    w.people.filter((p) => p.schedule === 'fixed' && worksOn(w, p, date)).map((p) => h('span', { class: 'tag', style: `--c:${p.color}` }, `${p.name} work`)),
    tripsOn(w, date).map(({ trip }) => h('span', { class: 'tag t-trip' }, trip.name)),
    h('span', { class: 'dots' }, evs.filter((e) => e.ev.cat !== 'work').slice(0, 5).map((e) => h('i', { style: `background:${colorOf(e.ev.who)}`, title: e.ev.title })))));
  }
  return [
    h('div', { class: 'bar' },
      h('button', { 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h('h2', null, `${MONTHS[m - 1]} ${y}`),
      h('button', { 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
    varies.map((p) => h('div', { class: 'paint' },
      h('span', null, `Set ${p.name}'s days:`),
      DAY_TYPES.map((t) => {
        const on = ui.paint?.email === p.email && ui.paint.type === t;
        return h('button', { class: `chip t-${t}${on ? ' on' : ''}`, onclick: () => { ui.paint = on ? null : { email: p.email, type: t }; render(); } }, DAY_LABEL[t]);
      }),
      h('small', null, ui.paint?.email === p.email ? 'Now tap days. Tap the button again when done.' : 'Pick one, then tap days.'))),
    h('div', { class: 'month' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('div', { class: 'dow' }, DOW[d])), cells),
  ];
}

// ---- recipes and groceries ----

function recipesView() {
  const list = recipes();
  return [
    h('div', { class: 'bar' }, h('h2', null, 'Recipes'), h('button', { class: 'primary', onclick: () => recipeDialog(null) }, '+ Recipe')),
    !list.length && h('p', { class: 'hint' }, 'Nothing here yet. Add the lunches you batch prep and a few easy dinners.'),
    SLOTS.map((slot) => {
      const fits = list.filter((r) => r.data.slots.includes(slot));
      return fits.length ? h('section', { class: 'group' }, h('h3', null, SLOT_LABEL[slot]),
        h('div', { class: 'cards' }, fits.map((r) => h('button', { class: 'card', onclick: () => recipeDialog(r.id) },
          h('b', null, r.data.name), h('small', null, recipeTags(r.data)),
          h('small', null, r.data.ingredients.length ? `${r.data.ingredients.length} ingredients` : 'no ingredients listed'))))) : null;
    }),
  ];
}

function groceriesView() {
  const list = store.all<Grocery>('grocery').sort((a, b) => Number(a.data.done) - Number(b.data.done) || a.data.name.localeCompare(b.data.name));
  const input = h('input', { id: 'gadd', placeholder: 'Add an item, like "2 cans chickpeas"', maxLength: 80 });
  return [
    h('div', { class: 'bar' }, h('h2', null, 'Groceries'),
      list.some((g) => g.data.done) && h('button', { onclick: () => list.filter((g) => g.data.done).forEach((g) => store.del(g.id)) }, 'Clear ticked')),
    h('form', {
      class: 'row', onsubmit: (e: Event) => {
        e.preventDefault();
        const ing = parseIngredient(input.value);
        if (ing) store.put('grocery', store.newId(), { ...ing, done: false } satisfies Grocery);
        (document.getElementById('gadd') as HTMLInputElement | null)?.focus();
      },
    }, input, h('button', { class: 'primary' }, 'Add')),
    list.some((g) => !g.data.done) && h('p', { class: 'hint wfhint' }, 'Whole Foods ↗ opens that item in your Amazon Whole Foods store, where you add it to the delivery cart. The item is then marked In cart here so you can both see what is left.'),
    !list.length && h('p', { class: 'hint' }, 'Empty. Build it from a week’s meals on the Week tab, or add items here.'),
    h('ul', { class: 'groceries' }, list.map((g) => h('li', { class: g.data.done ? 'done' : '' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: g.data.done, onchange: () => store.put('grocery', g.id, { ...g.data, done: !g.data.done }) }),
        h('span', null, g.data.name), h('small', null, niceQty(g.data.qty, g.data.unit) === '0' ? '' : niceQty(g.data.qty, g.data.unit))),
      !g.data.done && h('a', {
        class: `wf${g.data.cart ? ' in' : ''}`, href: wholeFoodsUrl(g.data.name), target: '_blank', rel: 'noopener noreferrer',
        title: 'Find this at Whole Foods on Amazon', onclick: () => store.put('grocery', g.id, { ...g.data, cart: true }),
      }, g.data.cart ? 'In cart ✓' : 'Whole Foods ↗'),
      h('button', { class: 'ghost', 'aria-label': `Remove ${g.data.name}`, onclick: () => store.del(g.id) }, '✕')))),
  ];
}

// ---- going out: suggested events near home, and away games worth a trip ----

interface Idea { id: string; name: string; url: string; date: string; time: string; venue: string; city: string; kind: 'team' | 'music' | 'food'; tag: string; miles: number | null; local: boolean }
const prefs = (): Prefs => ({ ...DEFAULT_PREFS, ...store.get<Prefs>('prefs') });
const ideas = { key: '', loading: false, error: '', area: '', events: [] as Idea[] };

async function loadIdeas(force = false) {
  const p = prefs();
  const key = JSON.stringify(p);
  if (!p.zip || (ideas.key === key && !force) || ideas.loading) return;
  Object.assign(ideas, { key, loading: true, error: '' });
  render();
  try {
    const q = new URLSearchParams({ zip: p.zip, radius: String(p.radius), teams: p.teams.join('|'), music: p.music ? '1' : '0', food: p.food ? '1' : '0' });
    const r = await fetch(`/api/homeevents?${q}`, { credentials: 'same-origin' });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error ?? 'Could not load events.');
    Object.assign(ideas, { area: out.area, events: out.events });
  } catch (e) {
    Object.assign(ideas, { error: (e as Error).message, events: [] });
  }
  ideas.loading = false;
  render();
}

function prefsDialog() {
  const p = prefs();
  const zip = h('input', { value: p.zip, placeholder: '98101', inputMode: 'numeric', pattern: '\\d{5}', required: true, maxLength: 5 });
  const radius = select(String(p.radius), [['25', '25 miles'], ['50', '50 miles'], ['100', '100 miles']]);
  const teams = h('input', { value: p.teams.join(', '), placeholder: 'Seahawks, Anaheim Ducks', maxLength: 160 });
  const music = h('input', { type: 'checkbox', checked: p.music });
  const food = h('input', { type: 'checkbox', checked: p.food });
  openDialog('What to look for', h('form', {
    onsubmit: (e: Event) => {
      e.preventDefault();
      store.put('prefs', 'prefs', {
        zip: zip.value.trim(), radius: Number(radius.value), music: music.checked, food: food.checked,
        teams: teams.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4),
      } satisfies Prefs);
      dlg.close();
      void loadIdeas();
    },
  },
  h('div', { class: 'row' }, field('Home ZIP code', zip), field('How far', radius)),
  field('Teams and artists to follow (up to 4, commas between)', teams),
  h('p', { class: 'hint' }, 'Teams are found everywhere they play: games near home go under suggestions, the rest under trip ideas.'),
  h('div', { class: 'row' }, h('label', { class: 'check' }, music, h('span', null, 'Live music nearby')), h('label', { class: 'check' }, food, h('span', null, 'Food events and festivals nearby'))),
  h('footer', null, h('button', { class: 'primary' }, 'Save'))));
}

/** What the day already holds, so a suggestion can be judged at a glance. */
function dayClash(w: World, date: string, self: string): string {
  const bits = w.people.filter((p) => p.schedule === 'varies' && dayType(w, p, date) === 'shift').map((p) => `${p.name} on shift`);
  const n = eventsOn(w, date).filter((e) => e.ev.cat !== 'work' && e.id !== `tm:${self}`).length + tripsOn(w, date).filter((t) => t.id !== `trip:${self}`).length;
  if (n) bits.push(`${n} other plan${n === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function ideaRow(w: World, e: Idea) {
  const evId = `tm:${e.id}`;
  const tripId = `trip:${e.id}`;
  const added = store.get(evId) !== undefined;
  const clash = dayClash(w, e.date, e.id);
  const where = [e.venue, e.city].filter(Boolean).join(', ');
  const addEvent = () => store.put('event', evId, {
    title: e.name, who: 'both', cat: 'activity', date: e.date, ...(e.time ? { start: e.time } : {}), notes: `${where}\n${e.url}`.trim(),
  } satisfies Ev);
  return h('li', { class: 'idea' },
    h('div', { class: 'when' }, h('b', null, niceDate(e.date)), e.time && h('small', null, niceTime(e.time))),
    h('div', { class: 'what' },
      h('b', null, e.name),
      h('small', null, where, !e.local && e.miles !== null ? ` · ${e.miles} mi away` : ''),
      clash && h('small', { class: 'clash' }, clash)),
    h('div', { class: 'acts' },
      e.url && h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer' }, 'Tickets ↗'),
      e.local
        ? h('button', { disabled: added, onclick: addEvent }, added ? 'On calendar ✓' : '+ Calendar')
        : h('button', {
          disabled: store.get(tripId) !== undefined,
          onclick: () => {
            store.put('trip', tripId, {
              name: e.name, where: e.city || e.venue, who: 'both', start: addDays(e.date, -1), end: addDays(e.date, 1), notes: e.url,
              todo: ['Game tickets', 'Flights', 'Place to stay'].map((text) => ({ text, done: false })), pack: [],
            } satisfies Trip);
            if (!added) addEvent();
            ui.view = 'trips';
            render();
          },
        }, store.get(tripId) !== undefined ? 'Trip planned ✓' : 'Plan a trip')));
}

function outView() {
  const p = prefs();
  const w = world();
  void loadIdeas();
  const part = (title: string, list: Idea[], empty: string) => h('section', { class: 'group' }, h('h3', null, title),
    list.length ? h('ul', { class: 'ideas' }, list.map((e) => ideaRow(w, e))) : h('p', { class: 'hint' }, empty));
  const local = ideas.events.filter((e) => e.local);
  return [
    h('div', { class: 'bar' }, h('h2', null, 'Going out'),
      p.zip && h('button', { onclick: () => void loadIdeas(true) }, 'Refresh'),
      h('button', { onclick: prefsDialog }, 'Settings')),
    !p.zip ? h('aside', { class: 'summary' }, h('p', null, 'Set your ZIP code and what you follow, and this page lists games, shows and food events worth going to.'),
      h('button', { class: 'primary', onclick: prefsDialog }, 'Set it up'))
      : ideas.loading ? h('p', { class: 'hint' }, 'Looking for events…')
        : ideas.error ? h('p', { class: 'trouble' }, ideas.error)
          : [
            h('p', { class: 'hint' }, `Within ${p.radius} miles of ${ideas.area || p.zip}. Following ${p.teams.join(', ') || 'no teams'}.`),
            p.teams.length > 0 && part('Your teams, near home', local.filter((e) => e.kind === 'team'), 'No games near home coming up.'),
            p.music && part('Live music', local.filter((e) => e.kind === 'music'), 'Nothing found nearby.'),
            p.food && part('Food and festivals', local.filter((e) => e.kind === 'food'), 'Nothing found nearby.'),
            p.teams.length > 0 && part('Trip ideas: away games', ideas.events.filter((e) => !e.local).slice(0, 25), 'No away games listed.'),
          ],
  ];
}

// ---- trips ----

function tripDialog(id: string | null) {
  const old = id ? store.get<Trip>(id) : undefined;
  const t: Trip = old ? structuredClone(old) : { name: '', where: '', who: 'both', start: today(), end: addDays(today(), 2), todo: [], pack: [] };
  const name = h('input', { value: t.name, required: true, maxLength: 80, placeholder: 'Seahawks at 49ers weekend' });
  const where = h('input', { value: t.where, maxLength: 80, placeholder: 'City or place' });
  const who = select(t.who, [['both', 'Both of us'], ...people().map((p) => [p.email, `Just ${p.name}`] as [string, string])]);
  const start = h('input', { type: 'date', value: t.start, required: true });
  const end = h('input', { type: 'date', value: t.end, required: true });
  const notes = h('textarea', { rows: 3, maxLength: 2000, placeholder: 'Confirmation numbers, addresses, links…' }, t.notes ?? '');
  openDialog(id ? 'Edit trip' : 'New trip', h('form', {
    onsubmit: (e: Event) => {
      e.preventDefault();
      if (!name.value.trim() || !start.value || !end.value) return;
      const out: Trip = { ...t, name: name.value.trim(), where: where.value.trim(), who: who.value, start: start.value, end: end.value < start.value ? start.value : end.value };
      if (notes.value.trim()) out.notes = notes.value.trim(); else delete out.notes;
      if (!id) out.todo = ['Transport', 'Place to stay'].map((text) => ({ text, done: false }));
      store.put('trip', id ?? store.newId(), out);
      dlg.close();
    },
  },
  field('Trip', name), h('div', { class: 'row' }, field('Where', where), field('Who is going', who)),
  h('div', { class: 'row' }, field('Leave', start), field('Back', end)),
  h('p', { class: 'hint' }, 'No meals are planned for whoever is away on these days.'),
  field('Notes', notes),
  h('footer', null,
    id && h('button', { type: 'button', class: 'danger', onclick: () => { store.del(id); dlg.close(); } }, 'Delete trip'),
    h('button', { class: 'primary' }, 'Save'))));
  if (!id) name.focus();
}

function checklist(id: string, trip: Trip, key: 'todo' | 'pack', title: string, hint: string) {
  const list = trip[key];
  const save = (next: Tick[]) => store.put('trip', id, { ...trip, [key]: next });
  const input = h('input', { id: `add-${key}-${id}`, placeholder: hint, maxLength: 80 });
  return h('div', { class: 'list' },
    h('h4', null, title, list.length ? h('small', null, ` ${list.filter((x) => x.done).length}/${list.length}`) : null),
    h('ul', null, list.map((item, i) => h('li', { class: item.done ? 'done' : '' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: item.done, onchange: () => save(list.map((x, j) => (j === i ? { ...x, done: !x.done } : x))) }),
        h('span', null, item.text)),
      h('button', { class: 'ghost', 'aria-label': `Remove ${item.text}`, onclick: () => save(list.filter((_, j) => j !== i)) }, '✕')))),
    h('form', { class: 'row', onsubmit: (e: Event) => { e.preventDefault(); if (input.value.trim()) save([...list, { text: input.value.trim(), done: false }]); } },
      input, h('button', null, 'Add')));
}

function tripsView() {
  const all = store.all<Trip>('trip').sort((a, b) => a.data.start.localeCompare(b.data.start));
  const ahead = all.filter((t) => t.data.end >= today());
  const past = all.filter((t) => t.data.end < today()).reverse();
  const card = ({ id, data: t }: { id: string; data: Trip }, open: boolean) => {
    const days = Math.round((toDate(t.start).getTime() - toDate(today()).getTime()) / 86_400_000);
    return h('section', { class: 'day tripcard' },
      h('header', null,
        h('h3', null, t.name),
        open && h('span', { class: 'chip t-office' }, days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : 'now'),
        h('button', { onclick: () => tripDialog(id) }, 'Edit')),
      h('p', { class: 'hint' }, [t.where, `${niceDate(t.start)} – ${niceDate(t.end)}`, t.who === 'both' ? 'both of us' : names(people().filter((p) => p.email === t.who))].filter(Boolean).join(' · ')),
      t.notes && h('p', { class: 'notes' }, t.notes), linkIn(t.notes),
      open && h('div', { class: 'lists' },
        checklist(id, t, 'todo', 'To book and do', 'Add a task'),
        checklist(id, t, 'pack', 'Packing', 'Add something to pack')));
  };
  return [
    h('div', { class: 'bar' }, h('h2', null, 'Trips'), h('button', { class: 'primary', onclick: () => tripDialog(null) }, '+ Trip')),
    !all.length && h('p', { class: 'hint' }, 'No trips yet. Add one here, or start from an away game under Going out.'),
    h('div', { class: 'trips' }, ahead.map((t) => card(t, true))),
    past.length > 0 && h('section', { class: 'group' }, h('h3', null, 'Past trips'), h('div', { class: 'trips' }, past.map((t) => card(t, false)))),
  ];
}

// ---- shell ----

const app = document.getElementById('app')!;
const TABS: [View, string][] = [['week', 'Week'], ['month', 'Month'], ['recipes', 'Recipes'], ['groceries', 'Groceries'], ['out', 'Going out'], ['trips', 'Trips']];
const VIEWS: Record<View, () => Kids[]> = { week: weekView, month: monthView, recipes: recipesView, groceries: groceriesView, out: outView, trips: tripsView };

function render() {
  if (!ui.loaded) {
    app.replaceChildren(h('p', { class: 'hint center' }, store.trouble || 'Loading…'));
    return;
  }
  const meP = people().find((p) => p.email === store.me);
  const body = VIEWS[ui.view]();
  // Keep whatever is being typed in an add box when the page redraws under it.
  const active = document.activeElement instanceof HTMLInputElement && app.contains(document.activeElement) && document.activeElement.id ? document.activeElement : null;
  const typing = active ? { id: active.id, value: active.value } : null;
  app.replaceChildren(
    h('nav', null,
      h('h1', null, 'Home'),
      h('div', { class: 'tabs' }, TABS.map(([v, t]) => h('button', { class: ui.view === v ? 'on' : '', onclick: () => { ui.view = v; ui.paint = null; render(); } }, t))),
      h('button', { class: 'me', style: `--c:${meP?.color ?? 'var(--both)'}`, onclick: () => profileDialog(false) }, meP?.name ?? 'Profile')),
    store.trouble && h('p', { class: 'trouble' }, store.trouble),
    h('main', { class: `v-${ui.view}` }, body));
  const back = typing && (document.getElementById(typing.id) as HTMLInputElement | null);
  if (typing && back) { back.value = typing.value; back.focus(); }
}

store.onChange(render);
render();
void store.sync().then(() => {
  if (!store.me) return;
  ui.loaded = true;
  render();
  if (!people().some((p) => p.email === store.me)) profileDialog(true);
});
setInterval(() => { if (document.visibilityState === 'visible') void store.sync(); }, 20_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void store.sync(); });
