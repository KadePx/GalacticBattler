// Household planner page (/home/): shared week and month calendar, meal plan, recipes, groceries.

import * as store from './store';
import {
  CATS, DAY_LABEL, DAY_TYPES, DEFAULT_DAYS, DOW, MONTHS, SLOTS, addDays, dayType, dow, eventsOn, groceriesFor, ingredientLine,
  mondayOf, need, niceDate, niceQty, niceTime, parseIngredient, toDate, today, weekDays, worksOn, ymd,
  type Cat, type DayMark, type DayType, type Ev, type Grocery, type Meal, type Person, type Recipe, type Slot, type World,
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

type View = 'week' | 'month' | 'recipes' | 'groceries';
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
  else if (n.home.length && n.comped.length) bits.push(`just ${names(n.home)}`);
  if (n.comped.length) bits.push(`${names(n.comped)} fed at work`);
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
    !list.length && h('p', { class: 'hint' }, 'Empty. Build it from a week’s meals on the Week tab, or add items here.'),
    h('ul', { class: 'groceries' }, list.map((g) => h('li', { class: g.data.done ? 'done' : '' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: g.data.done, onchange: () => store.put('grocery', g.id, { ...g.data, done: !g.data.done }) }),
        h('span', null, g.data.name), h('small', null, niceQty(g.data.qty, g.data.unit) === '0' ? '' : niceQty(g.data.qty, g.data.unit))),
      h('button', { class: 'ghost', 'aria-label': `Remove ${g.data.name}`, onclick: () => store.del(g.id) }, '✕')))),
  ];
}

// ---- shell ----

const app = document.getElementById('app')!;
const TABS: [View, string][] = [['week', 'Week'], ['month', 'Month'], ['recipes', 'Recipes'], ['groceries', 'Groceries']];

function render() {
  if (!ui.loaded) {
    app.replaceChildren(h('p', { class: 'hint center' }, store.trouble || 'Loading…'));
    return;
  }
  const meP = people().find((p) => p.email === store.me);
  const body = ui.view === 'week' ? weekView() : ui.view === 'month' ? monthView() : ui.view === 'recipes' ? recipesView() : groceriesView();
  const typing = document.activeElement?.id === 'gadd' ? (document.activeElement as HTMLInputElement).value : null;
  app.replaceChildren(
    h('nav', null,
      h('h1', null, 'Home'),
      h('div', { class: 'tabs' }, TABS.map(([v, t]) => h('button', { class: ui.view === v ? 'on' : '', onclick: () => { ui.view = v; ui.paint = null; render(); } }, t))),
      h('button', { class: 'me', style: `--c:${meP?.color ?? 'var(--both)'}`, onclick: () => profileDialog(false) }, meP?.name ?? 'Profile')),
    store.trouble && h('p', { class: 'trouble' }, store.trouble),
    h('main', { class: `v-${ui.view}` }, body));
  const gadd = document.getElementById('gadd') as HTMLInputElement | null;
  if (typing !== null && gadd) { gadd.value = typing; gadd.focus(); }
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
