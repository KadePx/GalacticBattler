// Household planner: every item lives in memory, edits show at once and are sent to /api/home,
// and a poll picks up what the other person changed.

export interface Item<T = unknown> { id: string; kind: string; data: T }
type Op = { id: string; kind: string; data: unknown } | { id: string; del: true };

const items = new Map<string, Item>();
const queue: Op[] = [];
let since = 0;
let sending = false;
let listener: () => void = () => {};

export let me = '';
/** '' = fine, otherwise a line to show the user. */
export let trouble = '';

export const onChange = (fn: () => void) => { listener = fn; };
export const all = <T>(kind: string) => [...items.values()].filter((i) => i.kind === kind) as Item<T>[];
export const get = <T>(id: string) => items.get(id)?.data as T | undefined;
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function put(kind: string, id: string, data: unknown) {
  items.set(id, { id, kind, data });
  queue.push({ id, kind, data });
  listener();
  void flush();
}
export function del(id: string) {
  if (!items.delete(id)) return;
  queue.push({ id, del: true });
  listener();
  void flush();
}

async function call(init?: RequestInit, query = ''): Promise<any> {
  const r = await fetch(`/api/home${query}`, { ...init, credentials: 'same-origin', redirect: 'manual' });
  // An expired sign-in comes back as a redirect to the login page.
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new Error('signin');
  if (!r.ok) throw new Error('server');
  return r.json();
}

function fail(e: unknown) {
  trouble = (e as Error).message === 'signin'
    ? 'Your sign-in has expired. Reload the page to sign in again.'
    : 'Can’t reach the server. Changes will be sent when it’s back.';
  listener();
}

async function flush() {
  if (sending || !queue.length) return;
  sending = true;
  const batch = queue.slice(0, 200);
  try {
    await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: batch }) });
    queue.splice(0, batch.length);
    if (trouble) { trouble = ''; listener(); }
  } catch (e) {
    fail(e);
  }
  sending = false;
  if (queue.length && !trouble) void flush();
}

export async function sync() {
  try {
    const out = await call(undefined, `?since=${since}`);
    me = out.me;
    const waiting = new Set(queue.map((o) => o.id));
    let changed = since === 0;
    for (const it of out.items as (Item & { updated: number; deleted: boolean })[]) {
      since = Math.max(since, it.updated);
      if (waiting.has(it.id)) continue; // our own newer edit is still on its way
      if (it.deleted) { changed = items.delete(it.id) || changed; continue; }
      const old = items.get(it.id);
      if (!old || JSON.stringify(old.data) !== JSON.stringify(it.data)) { items.set(it.id, { id: it.id, kind: it.kind, data: it.data }); changed = true; }
    }
    if (trouble) { trouble = ''; changed = true; }
    if (changed) listener();
    void flush();
  } catch (e) {
    fail(e);
  }
}

export const unsent = () => queue.length;
