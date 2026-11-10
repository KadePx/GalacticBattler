// Talking to the live world (/api/cw/*). The browser downloads the terrain and a snapshot, then
// keeps up by replaying the server's inputs with the same deterministic sim, checking the
// state fingerprint after each catch-up. Any mismatch means a fresh snapshot.

import { frameFromWire, type History } from './history';
import { assemble, stateHash, step, type Ev, type Input, type World } from './sim/index';

export interface ServerState {
  world: string; simV: number; tick: number; epoch: number; msPerTick: number;
  now: number; next: number; hash: string; logBase: number;
}

const API = '/api/cw/';
let wq = ''; // '&world=<id>' while looking at an earlier world

/** Look at an earlier, finished world instead of the living one. */
export async function loadArchive(id: string): Promise<World> {
  wq = `&world=${encodeURIComponent(id)}`;
  const [stat, dyn] = await Promise.all([getGz(`archive/static?world=${encodeURIComponent(id)}`), getGz(`archive/snapshot?world=${encodeURIComponent(id)}`)]);
  return assemble(stat, dyn);
}

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

/** POST JSON; returns the parsed reply even for error statuses (they carry a message). */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return (await r.json()) as T;
}

async function getGz(path: string): Promise<string> {
  // Terrain never changes within a world, so it may be cached, but only under that world's id.
  const r = await fetch(API + path, { cache: path.startsWith('static') || path.startsWith('archive') ? 'default' : 'no-store' });
  if (!r.ok || !r.body) throw new Error(`${path}: ${r.status}`);
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function loadWorld(): Promise<{ w: World; st: ServerState }> {
  const st = await getJson<ServerState>('state');
  const [stat, dyn] = await Promise.all([getGz(`static?world=${st.world}`), getGz('snapshot')]);
  return { w: assemble(stat, dyn), st };
}

/** Fill the history with the server's yearly records for [from, to]. */
export async function loadYears(hist: History, from: number, to: number, onPage?: (year: number) => void): Promise<void> {
  for (let y = from; y <= to; y += 500) {
    const r = await getJson<{ years: { year: number; stats: string; frame: string | null }[] }>(`years?from=${y}&to=${Math.min(to, y + 499)}${wq}`);
    for (const row of r.years) hist.add({ year: row.year, stats: JSON.parse(row.stats), frame: row.frame ? frameFromWire(row.year, row.frame) : null });
    onPage?.(Math.min(to, y + 499));
  }
}

/** Prepend older events to the world's log (up to `max` of them), keeping ids contiguous. */
export async function loadOlderEvents(w: World, max: number): Promise<void> {
  let got = 0;
  while (got < max && w.logBase > 0) {
    const r = await getJson<{ events: (Ev & { id: number })[] }>(`events?before=${w.logBase}&limit=${Math.min(2000, max - got)}${wq}`);
    if (!r.events.length) break;
    const older: Ev[] = [];
    for (let i = r.events.length - 1; i >= 0; i--) {
      const { id, ...e } = r.events[i];
      void id;
      older.push(e);
    }
    w.log = older.concat(w.log);
    w.logBase -= older.length;
    got += older.length;
  }
}

export type SyncResult = { ok: true; steps: number; next: number; now: number } | { ok: false; reason: 'resync' | 'mismatch' };

/** Catch the local world up to the server. onStep runs after every replayed month. */
export async function sync(w: World, world: string, onStep: () => void): Promise<SyncResult> {
  const r = await getJson<{ resync?: boolean; tick: number; hash: string; next: number; now: number; inputs: [number, Input][] }>(`sync?world=${world}&tick=${w.tick}`);
  if (r.resync) return { ok: false, reason: 'resync' };
  let steps = 0;
  while (w.tick < r.tick) {
    step(w, r.inputs.filter(([t]) => t === w.tick).map(([, i]) => i));
    onStep();
    steps++;
  }
  if (stateHash(w) !== r.hash) return { ok: false, reason: 'mismatch' };
  return { ok: true, steps, next: r.next, now: r.now };
}
