// The browser's link to the live colony. It loads a snapshot, then runs the same sim as the
// server, asking every few seconds for anything new that has entered the colony (a player's
// colonist, an owner's event). If its copy ever drifts from the server's, it reloads.

import { founderHash } from '../commonworld/shared/text';
import type { PawnSpec } from './sim/create';
import { colonyHash, deserialize, type Colony, type Input } from './sim/index';

const ROOT = '/api/hl/';
/** The colony being viewed: its API lives under /api/hl/c/<id>/. */
let API = ROOT;
export function useColony(id: string): void {
  API = `${ROOT}c/${id}/`;
}

export interface RegionSite { id: string; name: string; x: number; y: number; founded: number; from?: string; pop: number; ruler?: string; dead?: number }

/** The colonies of the live world, or null when there is no live world (a static preview, or the server is down). */
export async function fetchRegion(): Promise<RegionSite[] | null> {
  try {
    const r = await fetch(ROOT + 'region', { cache: 'no-store' });
    if (!r.ok) return null;
    const body = (await r.json()) as { sites?: RegionSite[] };
    return Array.isArray(body.sites) ? body.sites : null;
  } catch {
    return null;
  }
}
const KEY = 'hl.me';
const COOKIE = 'hl_me';

// ---------- Who I am: a private id kept in this browser; only its hash is ever public ----------

function saveId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  document.cookie = `${COOKIE}=${id}; max-age=${60 * 60 * 24 * 3650}; path=/; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
}

let cachedId: string | null = null;
export function myId(): string {
  if (cachedId) return cachedId;
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* private mode */ }
  id ??= document.cookie.match(/(?:^|;\s*)hl_me=([A-Za-z0-9-]+)/)?.[1] ?? null;
  if (!id || !/^[A-Za-z0-9-]{20,64}$/.test(id)) id = crypto.randomUUID();
  saveId(id);
  return (cachedId = id);
}

let hash: Promise<string> | null = null;
/** The public mark my colonists carry (`pawn.owner`). */
export function myHash(): Promise<string> {
  return (hash ??= founderHash(myId()));
}

// ---------- The live colony ----------

interface State { id: string; tick: number; epoch: number; msPerTick: number; simV: number; seq: number; now: number; checks: [number, string][]; inputs?: (Input & { seq: number })[] }

export interface Live {
  c: Colony;
  /** the tick the colony should be at right now, by the server's clock (with the fraction of the tick under way) */
  target(): number;
  msPerTick: number;
  /** called after each of my own sim steps, to check for drift at the agreed ticks */
  stepped(): void;
  /** true while a reload is under way (stop stepping) */
  busy: boolean;
  /** send in a colonist; resolves with an error message, or '' when accepted */
  join(spec: PawnSpec): Promise<string>;
  /** nudge my colonist ('act') or carry on as an heir ('heir'); resolves with an error message or '' */
  send(path: 'act' | 'heir', body: Record<string, unknown>): Promise<string>;
  stop(): void;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

/** Connect to the live colony. onReload is called whenever the colony object is replaced. */
export async function connect(onReload: (c: Colony) => void): Promise<Live> {
  let state: State;
  let skew = 0; // server clock minus ours
  let seq = 0;
  let stopped = false;
  const mine = new Map<number, string>(); // my hashes at check ticks

  const live: Live = {
    c: null as unknown as Colony,
    msPerTick: 6000,
    busy: true,
    target: () => (Date.now() + skew - state.epoch) / state.msPerTick,
    stepped: () => {
      if (live.c.out.length) live.c.out = []; // only the server delivers these
      const t = live.c.tick;
      if (t % 100 === 0) {
        mine.set(t, colonyHash(live.c));
        if (mine.size > 20) mine.delete(mine.keys().next().value as number);
      }
    },
    join: async (spec) => {
      try {
        const r = await fetch(API + 'join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ f: myId(), spec }) });
        const body = (await r.json()) as { ok?: boolean; error?: string };
        if (!r.ok || !body.ok) return body.error ?? 'The colony would not take them.';
        void poll();
        return '';
      } catch {
        return 'Could not reach the colony. Try again in a moment.';
      }
    },
    send: async (path, body) => {
      try {
        const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ f: myId(), ...body }) });
        const out = (await r.json()) as { ok?: boolean; error?: string };
        if (!r.ok || !out.ok) return out.error ?? 'That did not work.';
        void poll();
        return '';
      } catch {
        return 'Could not reach the colony. Try again in a moment.';
      }
    },
    stop: () => { stopped = true; },
  };

  async function load(): Promise<void> {
    live.busy = true;
    const snap = await getJson<State & { colony: string }>('snapshot');
    state = snap;
    skew = snap.now - Date.now();
    seq = snap.seq;
    mine.clear();
    live.c = deserialize(snap.colony);
    live.msPerTick = snap.msPerTick;
    live.busy = false;
    onReload(live.c);
  }

  async function poll(): Promise<void> {
    if (stopped || live.busy) return;
    try {
      const s = await getJson<State>('sync?seq=' + seq);
      if (s.id !== state.id || s.simV !== state.simV) { await load(); return; }
      state = { ...state, epoch: s.epoch, msPerTick: s.msPerTick };
      live.msPerTick = s.msPerTick;
      skew = s.now - Date.now();
      let late = false;
      for (const i of s.inputs ?? []) {
        seq = Math.max(seq, i.seq);
        if (i.t <= live.c.tick) late = true; // we have already lived past it: start again from the server's copy
        else { const { seq: _drop, ...input } = i; void _drop; live.c.inq.push(input as Input); }
      }
      // drift check: wherever both of us have a fingerprint for the same tick, they must agree
      for (const [t, h] of s.checks) if (mine.has(t) && mine.get(t) !== h) late = true;
      if (late) await load();
    } catch {
      /* offline for a moment: keep running our copy and try again */
    }
  }

  await load();
  const timer = setInterval(() => { if (stopped) clearInterval(timer); else void poll(); }, 8000);
  return live;
}
