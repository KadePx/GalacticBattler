// Household planner: the data shapes and the rules that turn a week's schedule into meals to make.

export type Slot = 'breakfast' | 'lunch' | 'dinner';
export type DayType = 'office' | 'shift' | 'off';
export type Cat = 'work' | 'activity' | 'appt' | 'prep' | 'other';

export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner'];
export const DAY_TYPES: DayType[] = ['office', 'shift', 'off'];
export const CATS: Record<Cat, string> = { work: 'Work', activity: 'Activity', appt: 'Appointment', prep: 'Meal prep', other: 'Other' };
export const DAY_LABEL: Record<DayType, string> = { office: 'Office', shift: 'Shift', off: 'Off' };
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface Person {
  email: string; name: string; color: string;
  /** fixed: work days come from their repeating Work events. varies: each day is office, shift or off. */
  schedule: 'fixed' | 'varies';
  /** For varies: the usual day type per weekday (Sun..Sat), used until a day is set by hand. */
  defaults?: DayType[];
}
export interface Ev {
  title: string; who: string; cat: Cat; date: string; start?: string; end?: string; notes?: string;
  repeat?: { days: number[]; until?: string }; skip?: string[];
}
export interface DayMark { type: DayType }
export interface Ingredient { qty: number | null; unit: string; name: string }
export interface Recipe {
  name: string; slots: Slot[]; quick: boolean; batch: boolean; minutes: number | null; servings: number;
  ingredients: Ingredient[]; notes?: string; link?: string;
}
export interface Meal { recipe?: string; text?: string }
export interface Grocery { name: string; qty: number | null; unit: string; done: boolean; week?: string; cart?: boolean }
export interface Tick { text: string; done: boolean }
export interface Trip { name: string; where: string; who: string; start: string; end: string; notes?: string; todo: Tick[]; pack: Tick[] }
/** Shared settings for the Going out tab. */
export interface Prefs { zip: string; radius: number; teams: string[]; music: boolean; food: boolean }
export const DEFAULT_PREFS: Prefs = { zip: '', radius: 50, teams: ['Seahawks', 'Anaheim Ducks'], music: true, food: true };

// ---- dates are local 'YYYY-MM-DD' strings ----

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => ymd(new Date());
export const addDays = (s: string, n: number) => { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); };
export const dow = (s: string) => toDate(s).getDay();
/** The Monday of the week holding this date. */
export const mondayOf = (s: string) => addDays(s, -((dow(s) + 6) % 7));
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const niceTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + pad(m) : ''}${h < 12 ? 'am' : 'pm'}`;
};
export const niceDate = (s: string) => { const d = toDate(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

export function occursOn(ev: Ev, date: string): boolean {
  if (!ev.repeat) return ev.date === date;
  if (date < ev.date || (ev.repeat.until && date > ev.repeat.until)) return false;
  return ev.repeat.days.includes(dow(date)) && !ev.skip?.includes(date);
}

export const DEFAULT_DAYS: DayType[] = ['off', 'office', 'office', 'office', 'office', 'office', 'off'];

// ---- who eats what ----

export interface World {
  people: Person[];
  events: { id: string; ev: Ev }[];
  trips: { id: string; trip: Trip }[];
  dayMark(email: string, date: string): DayMark | undefined;
}

export function dayType(w: World, p: Person, date: string): DayType {
  return w.dayMark(p.email, date)?.type ?? (p.defaults ?? DEFAULT_DAYS)[dow(date)];
}

export const eventsOn = (w: World, date: string) =>
  w.events.filter((e) => occursOn(e.ev, date)).sort((a, b) => (a.ev.start ?? '').localeCompare(b.ev.start ?? ''));

/** Does this person go to work that day? Shifts count for the varies person. */
export function worksOn(w: World, p: Person, date: string): boolean {
  if (p.schedule === 'varies') return dayType(w, p, date) !== 'off';
  return w.events.some((e) => e.ev.cat === 'work' && (e.ev.who === p.email || e.ev.who === 'both') && occursOn(e.ev, date));
}

/** How one person eats one meal: 'pack' = prepped and taken to work, 'home' = eaten at home, 'comped' = fed on shift, 'away' = on a trip. */
export const tripsOn = (w: World, date: string) => w.trips.filter((t) => t.trip.start <= date && date <= t.trip.end);
/** Away on a trip that day (every day of the trip counts, travel days included). */
export const awayOn = (w: World, p: Person, date: string) => tripsOn(w, date).some((t) => t.trip.who === 'both' || t.trip.who === p.email);

export type Eat = 'pack' | 'home' | 'comped' | 'away';
export function eats(w: World, p: Person, date: string, slot: Slot): Eat {
  if (awayOn(w, p, date)) return 'away';
  if (p.schedule === 'varies') {
    const t = dayType(w, p, date);
    if (t === 'shift') return 'comped';
    return t === 'office' && slot === 'lunch' ? 'pack' : 'home';
  }
  return slot === 'lunch' && worksOn(w, p, date) ? 'pack' : 'home';
}

export interface Need { portions: number; pack: Person[]; home: Person[]; comped: Person[]; away: Person[] }
export function need(w: World, date: string, slot: Slot): Need {
  const n: Need = { portions: 0, pack: [], home: [], comped: [], away: [] };
  for (const p of w.people) n[eats(w, p, date, slot)].push(p);
  n.portions = n.pack.length + n.home.length;
  return n;
}

// ---- grocery list from a week's meals ----

export function groceriesFor(w: World, monday: string, mealAt: (date: string, slot: Slot) => Meal | undefined,
  recipeOf: (id: string) => Recipe | undefined): Grocery[] {
  const sums = new Map<string, Grocery>();
  for (const date of weekDays(monday)) {
    for (const slot of SLOTS) {
      const meal = mealAt(date, slot);
      const r = meal?.recipe ? recipeOf(meal.recipe) : undefined;
      if (!r) continue;
      const factor = need(w, date, slot).portions / Math.max(1, r.servings);
      if (!factor) continue;
      for (const ing of r.ingredients) {
        const name = ing.name.trim();
        if (!name) continue;
        const key = `${name.toLowerCase()}|${ing.unit.trim().toLowerCase()}`;
        const g = sums.get(key) ?? { name, qty: ing.qty === null ? null : 0, unit: ing.unit.trim(), done: false, week: monday };
        if (ing.qty !== null) g.qty = (g.qty ?? 0) + ing.qty * factor;
        sums.set(key, g);
      }
    }
  }
  return [...sums.values()].map((g) => ({ ...g, qty: g.qty === null ? null : Math.ceil(g.qty * 4 - 1e-9) / 4 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const niceQty = (q: number | null, unit: string) => {
  if (q === null) return unit;
  const whole = Math.floor(q);
  const frac = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[q - whole] ?? '';
  return `${whole || !frac ? whole : ''}${frac}${unit ? ' ' + unit : ''}`;
};

/** "2 cups rolled oats" -> { qty: 2, unit: 'cups', name: 'rolled oats' }. Anything it can't read stays as the name. */
const UNITS = new Set(['cup', 'cups', 'tbsp', 'tsp', 'g', 'kg', 'ml', 'l', 'oz', 'lb', 'lbs', 'can', 'cans', 'clove', 'cloves',
  'slice', 'slices', 'bag', 'bags', 'bunch', 'pack', 'packs', 'scoop', 'scoops', 'pinch', 'handful', 'jar', 'jars', 'piece', 'pieces']);
export function parseIngredient(line: string): Ingredient | null {
  const s = line.trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*(.*)$/);
  if (!m) return { qty: null, unit: '', name: s };
  let qty = Number(m[1]);
  if (m[2]) qty /= Number(m[2]);
  const rest = m[3].trim();
  const [first, ...more] = rest.split(/\s+/);
  if (more.length && UNITS.has(first.toLowerCase())) return { qty, unit: first, name: more.join(' ') };
  return { qty, unit: '', name: rest || s };
}
export const ingredientLine = (i: Ingredient) => `${i.qty === null ? '' : i.qty + ' '}${i.unit ? i.unit + ' ' : ''}${i.name}`;

/** Whole Foods on Amazon has no way to fill a cart from outside, so each item opens its search there. */
export const wholeFoodsUrl = (name: string) => `https://www.amazon.com/s?k=${encodeURIComponent(name)}&i=wholefoods`;
