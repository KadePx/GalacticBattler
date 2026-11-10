// The live world's keeper. One instance runs inside a Cloudflare Durable Object (and one in the
// Vite dev server locally). It advances the world in real time, stores the live state in a
// small key-value store, writes history (events, yearly records, inputs, backups) to D1, and
// answers the /api/cw/* requests. It has no Cloudflare-specific code, so it can be tested anywhere.

import {
  createWorld, serializeDynamic, serializeStatic, assemble, stateHash, step, SIM_V, TICKS_PER_YEAR, VALUES,
  EDICTS, type ActInput, type Edict, type FoundInput, type GodInput, type Input, type ValueId, type World,
} from '../sim/index';
import { COST, OMEN_CHOICES, influence, nameable } from '../sim/player';
import { AGES, civAge } from '../sim/techs';
import { ogImage } from './og';
import { canFoundAt } from '../sim/civ';
import { hexDist } from '../sim/hex';
import { cleanBanner, cleanByName, cleanMotto, founderHash, isFounderId, placeName, properName } from '../shared/text';
import { frameToWire, yearRecord, type YearRecord } from '../history';
import type { D1, D1Stmt } from '../../net/db';

export interface KV {
  get(key: string): Promise<string | undefined | null>;
  put(key: string, value: string): Promise<void>;
}

export interface HostOpts {
  msPerTick: number; // real milliseconds per game month (12000 = 25 game years per real hour)
  maxStep: number; // most ticks to simulate in one call (catching up after downtime)
  civs: number; // ancient civs in a brand-new world
  adminKey?: string;
  now: () => number;
  turnstileSiteKey?: string; // shown to the founding screen; undefined = no human check
  verifyHuman?: (token: string, ip: string) => Promise<boolean>;
}

const FOUNDINGS_PER_IP_PER_DAY = 3;

interface Meta { id: string; seed: number; epoch: number; created: number; msPerTick?: number }

/**
 * The next world, while it is being chosen. 'vote': visitors rank the candidate maps (2 points
 * for a first pick, 1 for a second). 'prep': the winning map is fixed; visitors may found their
 * people on it ahead of time, and once the owner sets startAt the current world is archived and
 * the new one begins at that moment, with every pre-founded people arriving in its first month.
 */
export interface Next { round: string; phase: 'vote' | 'prep'; seeds: number[]; civs: number; opened: number; seed?: number; startAt?: number | null; simV?: number; fill?: number }
/** A finished world, kept read-only. */
export interface Archive { id: string; seed: number; year: number; ended: number; peoples: number; founders: number }

export const BALLOT_SIZE = 6;
const PER_IP_PER_ROUND = 3; // ballots or pre-foundings from one network in one round
const PREFOUND_GAP = 6; // hexes between pre-founded homelands, so every one of them can settle

const KEEP_EVENTS = 300; // recent events kept in the live world; older ones live in D1
const FRAME_EVERY = 2; // years between map frames
const KEYFRAME_YEARS = 100; // years between full backups in D1

let schemaReady = false;
async function schema(db: D1): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_events (
      world TEXT NOT NULL, id INTEGER NOT NULL, t INTEGER NOT NULL, k TEXT NOT NULL,
      a INTEGER, b INTEGER, s INTEGER, n REAL, x TEXT, y TEXT, z TEXT, PRIMARY KEY (world, id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS cw_events_a ON cw_events (world, a, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cw_events_b ON cw_events (world, b, id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_years (
      world TEXT NOT NULL, year INTEGER NOT NULL, stats TEXT NOT NULL, frame TEXT, PRIMARY KEY (world, year)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_inputs (
      world TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world, seq)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS cw_inputs_tick ON cw_inputs (world, tick)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_foundings (
      world TEXT NOT NULL, founder TEXT NOT NULL, ip TEXT NOT NULL, tile INTEGER NOT NULL, status TEXT NOT NULL,
      civ INTEGER, created INTEGER NOT NULL, PRIMARY KEY (world, founder)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS cw_foundings_ip ON cw_foundings (world, ip, created)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_offers (
      world TEXT NOT NULL, founder TEXT NOT NULL, day INTEGER NOT NULL, s INTEGER NOT NULL, PRIMARY KEY (world, founder, day)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_votes (
      round TEXT NOT NULL, founder TEXT NOT NULL, ip TEXT NOT NULL, first INTEGER NOT NULL, second INTEGER NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (round, founder)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_prefounds (
      round TEXT NOT NULL, founder TEXT NOT NULL, ip TEXT NOT NULL, tile INTEGER NOT NULL, body TEXT NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (round, founder)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_snaps (
      world TEXT NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, v INTEGER NOT NULL,
      data TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (world, tick, kind)
    )`),
  ]);
  schemaReady = true;
}

async function gunzip(b: Uint8Array): Promise<string> {
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

/** Ballot results: points per candidate (2 for a first pick, 1 for a second) and first picks. */
export function tally(n: number, rows: { first: number; second: number }[]): { points: number[]; firsts: number[]; winner: number } {
  const points = new Array(n).fill(0);
  const firsts = new Array(n).fill(0);
  for (const r of rows) {
    if (r.first >= 0 && r.first < n) { points[r.first] += 2; firsts[r.first]++; }
    if (r.second >= 0 && r.second < n && r.second !== r.first) points[r.second] += 1;
  }
  let winner = 0;
  for (let i = 1; i < n; i++) if (points[i] > points[winner] || (points[i] === points[winner] && firsts[i] > firsts[winner])) winner = i;
  return { points, firsts, winner };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

export class WorldHost {
  private w: World | null = null;
  private meta!: Meta;
  private pending: Input[] = [];
  private seq = 0;
  private flushed = 0; // events with a global id below this are in D1
  private lock: Promise<unknown> = Promise.resolve();
  private gzCache: { key: string; body: Uint8Array } | null = null;
  private staticGz: Uint8Array | null = null;
  private ogCache = new Map<string, Uint8Array>();
  private next: Next | null = null;
  private archives: Archive[] = [];
  private preview: { seed: number; w: World } | null = null; // the chosen map at year 0, for checking pre-foundings
  private archCache = new Map<string, { st: Uint8Array; dyn: Uint8Array }>();
  private savedV = SIM_V; // sim version the stored world was last saved under

  constructor(private kv: KV, private db: D1, private o: HostOpts) {}

  /** Run one task at a time: alarms and requests may overlap while waiting on storage. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.lock.then(fn, fn);
    this.lock = p.catch(() => undefined);
    return p;
  }

  private async load(): Promise<World> {
    if (this.w) return this.w;
    await schema(this.db);
    const [meta, next, archives] = await Promise.all([this.kv.get('meta'), this.kv.get('next'), this.kv.get('archives')]);
    this.next = next ? JSON.parse(next) : null;
    this.archives = archives ? JSON.parse(archives) : [];
    if (!meta) return this.create(this.o.now() % 1_000_000_007, this.o.civs);
    this.meta = JSON.parse(meta);
    const [st, dyn, pending, seq] = await Promise.all([this.kv.get('static'), this.kv.get('dyn'), this.kv.get('pending'), this.kv.get('seq')]);
    this.savedV = Number(/"v":(\d+)/.exec(dyn!.slice(0, 40))?.[1] ?? SIM_V);
    const w = assemble(st!, dyn!);
    this.w = w;
    this.pending = JSON.parse(pending ?? '[]');
    this.seq = Number(seq ?? 0);
    this.flushed = w.logBase + w.log.length;
    await this.retime(w);
    return w;
  }

  /**
   * The speed of time changed (msPerTick). Keep the world where it is: months already owed at
   * the old speed stay owed, and from now on time runs at the new speed. Without this, the
   * world would think all of history ran at the new speed and leap forward.
   */
  private async retime(w: World): Promise<void> {
    const old = this.meta.msPerTick ?? 300_000;
    if (old === this.o.msPerTick) return;
    const now = this.o.now();
    const owed = Math.max(0, Math.floor((now - this.meta.epoch) / old) - w.tick);
    this.meta.epoch = now - (w.tick + owed) * this.o.msPerTick;
    this.meta.msPerTick = this.o.msPerTick;
    await this.kv.put('meta', JSON.stringify(this.meta));
  }

  private async create(seed: number, civs: number, epoch = this.o.now(), fill?: number): Promise<World> {
    const now = this.o.now();
    const w = createWorld({ seed, civs, fill });
    this.w = w;
    this.meta = { id: `w${seed.toString(36)}${now.toString(36)}`, seed, epoch, created: now, msPerTick: this.o.msPerTick };
    this.pending = [];
    this.seq = 0;
    this.flushed = 0;
    this.staticGz = null;
    this.gzCache = null;
    this.ogCache.clear();
    await this.kv.put('static', serializeStatic(w));
    await this.kv.put('meta', JSON.stringify(this.meta));
    await this.flush([yearRecord(w, FRAME_EVERY)], []);
    await this.persist();
    return w;
  }

  private dueTick(): number {
    return Math.floor((this.o.now() - this.meta.epoch) / this.o.msPerTick);
  }

  /** Real time (ms) when the next month begins. */
  nextTickAt(): number {
    if (!this.w) return this.o.now() + this.o.msPerTick;
    const behind = this.dueTick() > this.w.tick;
    return behind ? this.o.now() + 1000 : this.meta.epoch + (this.w.tick + 1) * this.o.msPerTick;
  }

  /**
   * The world is held still: newer sim code is running while a next world is being prepared.
   * The old world ends under the rules it lived by, so it waits for the start instead of
   * running on (and is never saved in the new format, so a restart still sees it as old).
   */
  private held(): boolean {
    return !!this.next && this.savedV < SIM_V;
  }

  /** When the host next needs waking: the next month, or the new world's start if sooner. */
  nextWakeAt(): number {
    if (this.w && this.held()) return Math.max(this.o.now() + 1000, this.next?.startAt ?? this.o.now() + 60_000);
    const t = this.nextTickAt();
    const at = this.next?.phase === 'prep' ? this.next.startAt : null;
    return at && at > this.o.now() ? Math.min(t, at) : t;
  }

  private async saveNext(): Promise<void> {
    await this.kv.put('next', JSON.stringify(this.next));
  }

  /** The chosen map at year 0, as the new world will begin. */
  private previewWorld(seed: number, civs: number): World {
    if (this.preview?.seed !== seed) this.preview = { seed, w: createWorld({ seed, civs }) };
    return this.preview.w;
  }

  /**
   * The start time has come: keep the current world as a read-only archive, begin the new one
   * at exactly startAt, and send every pre-founded people to arrive in its first month.
   */
  private async maybeStart(): Promise<void> {
    const n = this.next;
    if (!n || n.phase !== 'prep' || n.seed === undefined || !n.startAt || this.o.now() < n.startAt) return;
    if (SIM_V < (n.simV ?? 0)) return; // wait for the sim version the new world is meant to run
    const old = this.w!;
    await this.snapshot('archive');
    this.archives.unshift({
      id: this.meta.id, seed: this.meta.seed, year: Math.floor(old.tick / TICKS_PER_YEAR), ended: n.startAt,
      peoples: old.civs.length, founders: old.civs.filter((c) => c.founder).length,
    });
    await this.kv.put('archives', JSON.stringify(this.archives));
    const rows = await this.db.prepare('SELECT founder, ip, tile, body, created FROM cw_prefounds WHERE round = ?1 ORDER BY created')
      .bind(n.round).all<{ founder: string; ip: string; tile: number; body: string; created: number }>();
    await this.create(n.seed, n.civs, n.startAt, n.fill);
    const stmts: D1Stmt[] = [];
    for (const r of rows.results) {
      this.pending.push(JSON.parse(r.body) as FoundInput);
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO cw_foundings (world, founder, ip, tile, status, civ, created) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)')
        .bind(this.meta.id, r.founder, r.ip, r.tile, 'pending', r.created));
    }
    for (let i = 0; i < stmts.length; i += 50) await this.db.batch(stmts.slice(i, i + 50));
    await this.kv.put('pending', JSON.stringify(this.pending));
    this.next = null;
    this.preview = null;
    this.savedV = SIM_V;
    await this.saveNext();
  }

  /** Queue a player's intent for the next tick (used by founding in milestone 5). */
  queue(inp: Input): Promise<void> {
    return this.serial(async () => {
      await this.load();
      this.pending.push(inp);
      await this.kv.put('pending', JSON.stringify(this.pending));
    });
  }

  /** Bring the world up to the present. Returns how many months passed. */
  advance(): Promise<number> {
    return this.serial(async () => {
      await this.load();
      await this.maybeStart();
      if (this.held()) return 0;
      const w = this.w!;
      const target = this.dueTick();
      let n = 0;
      const years: YearRecord[] = [];
      const inputs: { seq: number; tick: number; body: string }[] = [];
      const yearBefore = Math.floor(w.tick / TICKS_PER_YEAR);
      while (w.tick < target && n < this.o.maxStep) {
        const batch = n === 0 ? this.pending.splice(0) : [];
        for (const inp of batch) inputs.push({ seq: ++this.seq, tick: w.tick, body: JSON.stringify(inp) });
        step(w, batch);
        n++;
        if (w.tick % TICKS_PER_YEAR === 0) years.push(yearRecord(w, FRAME_EVERY));
      }
      if (!n) return 0;
      // Tell founders whether their people arrived (the land may have been taken meanwhile).
      for (const inp of inputs) {
        const body = JSON.parse(inp.body) as Input;
        if (body.k !== 'found') continue;
        const f = body.founder;
        const c = w.civs.find((x) => x.founder === f);
        await this.db.prepare('UPDATE cw_foundings SET status = ?1, civ = ?2 WHERE world = ?3 AND founder = ?4')
          .bind(c ? 'founded' : 'failed', c ? c.id : null, this.meta.id, f).run();
      }
      await this.flush(years, inputs);
      await this.persist();
      const yearAfter = Math.floor(w.tick / TICKS_PER_YEAR);
      if (Math.floor(yearAfter / KEYFRAME_YEARS) > Math.floor(yearBefore / KEYFRAME_YEARS)) await this.snapshot('key');
      return n;
    });
  }

  /** Write new events, yearly records and applied inputs to D1, then trim the live log. */
  private async flush(years: YearRecord[], inputs: { seq: number; tick: number; body: string }[]): Promise<void> {
    const w = this.w!;
    const id = this.meta.id;
    const stmts: D1Stmt[] = [];
    // D1 allows 100 bound values per statement: 11 per event row.
    const start = Math.max(0, this.flushed - w.logBase);
    for (let i = start; i < w.log.length; i += 9) {
      const rows = w.log.slice(i, i + 9);
      const vals: unknown[] = [];
      for (let k = 0; k < rows.length; k++) {
        const e = rows[k];
        vals.push(id, w.logBase + i + k, e.t, e.k, e.a ?? null, e.b ?? null, e.s ?? null, e.n ?? null, e.x ?? null, e.y ?? null, e.z ?? null);
      }
      const ph = rows.map((_, k) => `(${Array.from({ length: 11 }, (_, j) => `?${k * 11 + j + 1}`).join(',')})`).join(',');
      stmts.push(this.db.prepare(`INSERT OR REPLACE INTO cw_events (world,id,t,k,a,b,s,n,x,y,z) VALUES ${ph}`).bind(...vals));
    }
    for (const y of years) {
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO cw_years (world, year, stats, frame) VALUES (?1, ?2, ?3, ?4)')
        .bind(id, y.year, JSON.stringify(y.stats), y.frame ? frameToWire(y.frame) : null));
    }
    for (const inp of inputs) {
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO cw_inputs (world, seq, tick, body) VALUES (?1, ?2, ?3, ?4)').bind(id, inp.seq, inp.tick, inp.body));
    }
    for (let i = 0; i < stmts.length; i += 50) await this.db.batch(stmts.slice(i, i + 50));
    this.flushed = w.logBase + w.log.length;
    const drop = w.log.length - KEEP_EVENTS;
    if (drop > 0) {
      w.log.splice(0, drop);
      w.logBase += drop;
    }
  }

  private async persist(): Promise<void> {
    await this.kv.put('dyn', serializeDynamic(this.w!));
    await this.kv.put('pending', JSON.stringify(this.pending));
    await this.kv.put('seq', String(this.seq));
  }

  /** A gzipped full backup in D1 ('key' every 100 years, 'archive' before a wipe). */
  private async snapshot(kind: 'key' | 'archive'): Promise<void> {
    const w = this.w!;
    const data = bytesToB64(await gzip(JSON.stringify({ static: serializeStatic(w), dyn: serializeDynamic(w), meta: this.meta })));
    await this.db.prepare('INSERT OR REPLACE INTO cw_snaps (world, tick, kind, v, data, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(this.meta.id, w.tick, kind, SIM_V, data, this.o.now()).run();
  }

  // ---- HTTP ----

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/cw\/?/, '');
    try {
      if (path.startsWith('admin/')) return await this.admin(path.slice(6), req);
      if (path === 'found' && req.method === 'POST') return await this.found(req);
      if (path === 'act' && req.method === 'POST') return await this.act(req);
      if (path === 'offer' && req.method === 'POST') return await this.offer(req);
      if (path === 'vote' && req.method === 'POST') return await this.vote(req);
      if (path === 'prefound' && req.method === 'POST') return await this.prefound(req);
      if (path === 'prefound/cancel' && req.method === 'POST') return await this.unprefound(req);
      if (path.startsWith('archive/')) return await this.archived(path.slice(8), url.searchParams.get('world') ?? '');
      const w = await this.serial(() => this.load());
      const q = url.searchParams;
      switch (path) {
        case 'state':
          return json({
            world: this.meta.id, simV: SIM_V, tick: w.tick, epoch: this.meta.epoch, msPerTick: this.o.msPerTick,
            now: this.o.now(), next: this.nextTickAt(), hash: stateHash(w), logBase: w.logBase,
            turnstile: this.o.turnstileSiteKey ?? null, pendingFoundings: this.pending.length,
          });
        case 'next':
          return await this.nextInfo(q.get('f') ?? '');
        case 'archives':
          return json({ world: this.meta.id, archives: this.archives });
        case 'me': {
          // Where a founder's people stand: founded, on the road, failed to settle, or not yet.
          const f = q.get('f') ?? '';
          const civ = w.civs.find((c) => c.founder === f);
          if (civ) return json({ status: 'founded', civ: civ.id });
          if (this.pending.some((p) => p.k === 'found' && p.founder === f)) return json({ status: 'pending', eta: this.nextTickAt(), now: this.o.now() });
          const offered = await this.db.prepare('SELECT s FROM cw_offers WHERE world = ?1 AND founder = ?2 AND day = ?3').bind(this.meta.id, f, this.day()).first<{ s: number }>();
          const row = await this.db.prepare('SELECT status FROM cw_foundings WHERE world = ?1 AND founder = ?2').bind(this.meta.id, f).first<{ status: string }>();
          return json({ status: row?.status === 'failed' ? 'failed' : 'none', offered: offered?.s ?? null });
        }
        case 'static': {
          // Cacheable only when asked for by world id, so a new world never gets old terrain.
          this.staticGz ??= await gzip(serializeStatic(w));
          const cache = q.get('world') === this.meta.id ? 'public, max-age=86400, immutable' : 'no-store';
          return new Response(this.staticGz, { headers: { 'content-type': 'application/octet-stream', 'cache-control': cache, 'x-world': this.meta.id } });
        }
        case 'snapshot': {
          const key = `${this.meta.id}:${w.tick}`;
          if (this.gzCache?.key !== key) this.gzCache = { key, body: await gzip(serializeDynamic(w)) };
          return new Response(this.gzCache.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-world': this.meta.id, 'x-tick': String(w.tick) } });
        }
        case 'sync': {
          const from = Number(q.get('tick'));
          if (q.get('world') !== this.meta.id || !Number.isFinite(from) || from > w.tick || w.tick - from > 2400) {
            return json({ resync: true, world: this.meta.id, tick: w.tick });
          }
          const rows = await this.db.prepare('SELECT tick, body FROM cw_inputs WHERE world = ?1 AND tick >= ?2 ORDER BY seq').bind(this.meta.id, from).all<{ tick: number; body: string }>();
          return json({ world: this.meta.id, tick: w.tick, hash: stateHash(w), next: this.nextTickAt(), now: this.o.now(), inputs: rows.results.map((r) => [r.tick, JSON.parse(r.body)]) });
        }
        case 'events': {
          const arch = this.archives.find((a) => a.id === q.get('world'));
          const wid = arch ? arch.id : this.meta.id;
          const cap = arch ? Number.MAX_SAFE_INTEGER : this.flushed;
          const before = Math.min(Number(q.get('before') ?? cap) || cap, cap);
          const limit = Math.max(1, Math.min(2000, Number(q.get('limit') ?? 500) || 500));
          const civ = q.get('civ');
          const sql = civ !== null
            ? 'SELECT id,t,k,a,b,s,n,x,y,z FROM cw_events WHERE world = ?1 AND id < ?2 AND (a = ?4 OR b = ?4) ORDER BY id DESC LIMIT ?3'
            : 'SELECT id,t,k,a,b,s,n,x,y,z FROM cw_events WHERE world = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3';
          const st = this.db.prepare(sql);
          const res = await (civ !== null ? st.bind(wid, before, limit, Number(civ)) : st.bind(wid, before, limit)).all<Record<string, unknown>>();
          // Drop empty columns to keep the payload small.
          const events = res.results.map((r) => {
            const e: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) if (v !== null) e[k] = v;
            return e;
          });
          return json({ world: wid, events }, 200, arch ? 'public, max-age=86400' : 'public, max-age=30');
        }
        case 'years': {
          const from = Math.max(0, Number(q.get('from') ?? 0) || 0);
          const to = Math.max(from, Number(q.get('to') ?? from + 500) || from + 500);
          const arch = this.archives.find((a) => a.id === q.get('world'));
          const wid = arch ? arch.id : this.meta.id;
          const res = await this.db.prepare('SELECT year, stats, frame FROM cw_years WHERE world = ?1 AND year >= ?2 AND year <= ?3 ORDER BY year LIMIT 500')
            .bind(wid, from, to).all<{ year: number; stats: string; frame: string | null }>();
          return json({ world: wid, years: res.results }, 200, arch ? 'public, max-age=86400' : 'public, max-age=30');
        }
        case 'civ': {
          // A people's summary, for share pages.
          const c = w.civs[Number(q.get('id'))];
          if (!c) return json({ error: 'no such people' }, 404);
          let pop = 0;
          let setts = 0;
          for (const s of w.setts) if (s.civ === c.id && s.died < 0) { pop += s.pop; setts++; }
          return json({
            id: c.id, name: c.name, alive: c.died < 0, born: Math.floor(c.born / TICKS_PER_YEAR), died: c.died >= 0 ? Math.floor(c.died / TICKS_PER_YEAR) : null,
            year: Math.floor(w.tick / TICKS_PER_YEAR), pop: Math.round(pop), setts, peak: Math.round(c.peakPop), founder: !!c.founder, byName: c.byName,
            motto: c.motto, values: c.values, age: AGES[civAge(c)], faith: c.faith >= 0 ? w.faiths[c.faith].name : null,
            capital: w.setts[c.capital]?.name ?? null,
          }, 200, 'public, max-age=300');
        }
        case 'og': {
          // The map around a people, for link previews. Redrawn at most every ten game years.
          const id = Number(q.get('id'));
          if (!w.civs[id]) return json({ error: 'no such people' }, 404);
          const key = `${id}:${Math.floor(w.tick / 120)}`;
          let img = this.ogCache.get(key);
          if (!img) {
            img = await ogImage(w, id);
            if (this.ogCache.size > 50) this.ogCache.clear();
            this.ogCache.set(key, img);
          }
          return new Response(img, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } });
        }
        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  /** Check a founding form. Returns the input to queue (without its tile checked), or an error reply. */
  private async parseFound(req: Request): Promise<{ inp: FoundInput; ipKey: string } | Response> {
    const text = await req.text();
    if (text.length > 4000) return json({ error: 'too large' }, 413);
    let b: Record<string, unknown>;
    try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!isFounderId(b.id)) return json({ error: 'bad id' }, 400);
    const f = await founderHash(b.id);
    const values = Array.isArray(b.values) ? [...new Set(b.values)] : [];
    if (values.length !== 3 || !values.every((v) => (VALUES as readonly unknown[]).includes(v))) return json({ error: 'choose three values' }, 400);
    const name = b.name === undefined || b.name === '' ? undefined : properName(b.name);
    const capital = b.capital === undefined || b.capital === '' ? undefined : properName(b.capital);
    const motto = cleanMotto(b.motto ?? '');
    const byName = cleanByName(b.byName ?? '');
    const banner = cleanBanner(b.banner);
    if (name === null) return json({ error: 'that people name is not allowed' }, 400);
    if (capital === null) return json({ error: 'that capital name is not allowed' }, 400);
    if (motto === null) return json({ error: 'that motto is not allowed' }, 400);
    if (byName === null) return json({ error: 'that name is not allowed' }, 400);
    if (!banner) return json({ error: 'bad banner' }, 400);
    const u32 = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff ? (x as number) : undefined);
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const ipKey = (await founderHash(`ip:${ip}`)).slice(1);

    // Check the human first, outside the world lock (it is a network call).
    if (this.o.verifyHuman && !(await this.o.verifyHuman(String(b.token ?? ''), ip))) return json({ error: 'the human check failed; please try again' }, 403);
    const tile = Number(b.tile);
    const inp: FoundInput = {
      k: 'found', founder: f, tile: Number.isInteger(tile) ? tile : -1, values: values as ValueId[], name, capital, motto: motto || undefined,
      byName: byName || undefined, banner, phon: u32(b.phon), lex: u32(b.lex),
    };
    return { inp, ipKey };
  }

  /** POST /found: a player founds their one people. Applied at the next tick. */
  private async found(req: Request): Promise<Response> {
    const parsed = await this.parseFound(req);
    if (parsed instanceof Response) return parsed;
    const { inp, ipKey } = parsed;
    const f = inp.founder;
    const tile = inp.tile;
    return this.serial(async () => {
      const w = await this.load();
      if (this.held()) return json({ error: 'this world is ending; found your people in the new one' }, 409);
      if (w.civs.some((c) => c.founder === f) || this.pending.some((p) => p.k === 'found' && p.founder === f)) return json({ error: 'you have already founded a people' }, 409);
      const prev = await this.db.prepare('SELECT status FROM cw_foundings WHERE world = ?1 AND founder = ?2').bind(this.meta.id, f).first<{ status: string }>();
      if (prev && prev.status !== 'failed') return json({ error: 'you have already founded a people' }, 409);
      const recent = await this.db.prepare('SELECT COUNT(*) AS n FROM cw_foundings WHERE world = ?1 AND ip = ?2 AND created > ?3')
        .bind(this.meta.id, ipKey, this.o.now() - 86_400_000).first<{ n: number }>();
      if ((recent?.n ?? 0) >= FOUNDINGS_PER_IP_PER_DAY) return json({ error: 'too many foundings from this network today' }, 429);
      if (!canFoundAt(w, tile)) return json({ error: 'that land is no longer free; choose another' }, 409);
      if (this.pending.some((p) => p.k === 'found' && p.tile === tile)) return json({ error: 'another people is already heading there; choose another' }, 409);
      this.pending.push(inp);
      await this.kv.put('pending', JSON.stringify(this.pending));
      await this.db.prepare('INSERT OR REPLACE INTO cw_foundings (world, founder, ip, tile, status, civ, created) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)')
        .bind(this.meta.id, f, ipKey, tile, 'pending', this.o.now()).run();
      return json({ ok: true, founder: f, eta: this.nextTickAt(), now: this.o.now() });
    });
  }

  /** GET /next: the coming world, with this visitor's ballot and pre-founding. */
  private async nextInfo(f: string): Promise<Response> {
    const n = this.next;
    const now = this.o.now();
    if (!n) return json({ phase: 'none', now, archives: this.archives });
    const base = { phase: n.phase, round: n.round, seeds: n.seeds, civs: n.civs, fill: n.fill ?? 0, seed: n.seed ?? null, startAt: n.startAt ?? null, simV: n.simV ?? SIM_V, held: this.held(), now, archives: this.archives };
    if (n.phase === 'vote') {
      const rows = await this.db.prepare('SELECT founder, first, second FROM cw_votes WHERE round = ?1').bind(n.round).all<{ founder: string; first: number; second: number }>();
      const t = tally(n.seeds.length, rows.results);
      const mine = rows.results.find((r) => r.founder === f);
      return json({ ...base, points: t.points, firsts: t.firsts, voters: rows.results.length, mine: mine ? { first: mine.first, second: mine.second } : null });
    }
    const rows = await this.db.prepare('SELECT founder, tile, body FROM cw_prefounds WHERE round = ?1 ORDER BY created').bind(n.round).all<{ founder: string; tile: number; body: string }>();
    const peoples = rows.results.map((r) => {
      const b = JSON.parse(r.body) as FoundInput;
      return { tile: r.tile, name: b.name ?? null, banner: b.banner, byName: b.byName ?? null, values: b.values, mine: r.founder === f };
    });
    const mine = rows.results.find((r) => r.founder === f);
    return json({ ...base, peoples, mine: mine ? JSON.parse(mine.body) : null });
  }

  /** POST /vote: rank two of the candidate maps. A ballot can be changed until voting closes. */
  private async vote(req: Request): Promise<Response> {
    const b = await this.body(req);
    if (!b || !isFounderId(b.id)) return json({ error: 'bad request' }, 400);
    const f = await founderHash(b.id);
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const ipKey = (await founderHash(`ip:${ip}`)).slice(1);
    const first = Number.isInteger(b.first) ? (b.first as number) : -1;
    const second = Number.isInteger(b.second) ? (b.second as number) : -1;
    return this.serial(async () => {
      await this.load();
      const n = this.next;
      if (!n || n.phase !== 'vote') return json({ error: 'voting is closed' }, 409);
      if (first < 0 || first >= n.seeds.length || second < -1 || second >= n.seeds.length || second === first) return json({ error: 'choose a first pick and a different second pick' }, 400);
      const prev = await this.db.prepare('SELECT founder FROM cw_votes WHERE round = ?1 AND founder = ?2').bind(n.round, f).first();
      if (!prev) {
        const same = await this.db.prepare('SELECT COUNT(*) AS n FROM cw_votes WHERE round = ?1 AND ip = ?2').bind(n.round, ipKey).first<{ n: number }>();
        if ((same?.n ?? 0) >= PER_IP_PER_ROUND) return json({ error: 'too many ballots from this network' }, 429);
      }
      await this.db.prepare('INSERT OR REPLACE INTO cw_votes (round, founder, ip, first, second, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(n.round, f, ipKey, first, second, this.o.now()).run();
      return json({ ok: true });
    });
  }

  /** POST /prefound: found a people on the chosen map before the world begins. Can be redone until the start. */
  private async prefound(req: Request): Promise<Response> {
    const parsed = await this.parseFound(req);
    if (parsed instanceof Response) return parsed;
    const { inp, ipKey } = parsed;
    return this.serial(async () => {
      await this.load();
      const n = this.next;
      if (!n || n.phase !== 'prep' || n.seed === undefined) return json({ error: 'the new world is not open for founding' }, 409);
      if (n.startAt && this.o.now() >= n.startAt) return json({ error: 'the new world has begun' }, 409);
      const pw = this.previewWorld(n.seed, n.civs);
      if (!canFoundAt(pw, inp.tile)) return json({ error: 'that land cannot be settled; choose another' }, 409);
      const rows = await this.db.prepare('SELECT founder, ip, tile FROM cw_prefounds WHERE round = ?1').bind(n.round).all<{ founder: string; ip: string; tile: number }>();
      const others = rows.results.filter((r) => r.founder !== inp.founder);
      if (others.some((r) => hexDist(pw.W, r.tile, inp.tile) < PREFOUND_GAP)) return json({ error: 'another people already means to settle near there; choose another' }, 409);
      const mine = rows.results.length !== others.length;
      if (!mine && others.filter((r) => r.ip === ipKey).length >= PER_IP_PER_ROUND) return json({ error: 'too many foundings from this network' }, 429);
      await this.db.prepare('INSERT OR REPLACE INTO cw_prefounds (round, founder, ip, tile, body, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(n.round, inp.founder, ipKey, inp.tile, JSON.stringify(inp), this.o.now()).run();
      return json({ ok: true, founder: inp.founder, startAt: n.startAt ?? null, now: this.o.now() });
    });
  }

  /** POST /prefound/cancel: give up a pre-founding. */
  private async unprefound(req: Request): Promise<Response> {
    const b = await this.body(req);
    if (!b || !isFounderId(b.id)) return json({ error: 'bad request' }, 400);
    const f = await founderHash(b.id);
    return this.serial(async () => {
      await this.load();
      const n = this.next;
      if (!n || n.phase !== 'prep') return json({ error: 'the new world is not open for founding' }, 409);
      await this.db.prepare('DELETE FROM cw_prefounds WHERE round = ?1 AND founder = ?2').bind(n.round, f).run();
      return json({ ok: true });
    });
  }

  /** GET /archive/static|snapshot?world=: an earlier world, as it stood when it ended. */
  private async archived(what: string, id: string): Promise<Response> {
    await this.serial(() => this.load());
    if (!this.archives.some((a) => a.id === id) || (what !== 'static' && what !== 'snapshot')) return json({ error: 'not found' }, 404);
    let c = this.archCache.get(id);
    if (!c) {
      const row = await this.db.prepare("SELECT data FROM cw_snaps WHERE world = ?1 AND kind = 'archive' ORDER BY tick DESC LIMIT 1").bind(id).first<{ data: string }>();
      if (!row) return json({ error: 'not found' }, 404);
      const snap = JSON.parse(await gunzip(b64ToBytes(row.data))) as { static: string; dyn: string };
      c = { st: await gzip(snap.static), dyn: await gzip(snap.dyn) };
      if (this.archCache.size > 2) this.archCache.clear();
      this.archCache.set(id, c);
    }
    return new Response(what === 'static' ? c.st : c.dyn, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-world': id } });
  }

  private day(): number {
    return Math.floor(this.o.now() / 86_400_000);
  }

  private async body(req: Request): Promise<Record<string, unknown> | null> {
    const text = await req.text();
    if (text.length > 2000) return null;
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  }

  /** POST /act: a founder's nudge (edict, omen answer, name, gift, alliance offer). Applied at the next tick. */
  private async act(req: Request): Promise<Response> {
    const b = await this.body(req);
    if (!b || !isFounderId(b.id)) return json({ error: 'bad request' }, 400);
    const f = await founderHash(b.id);
    const a = (b.act ?? {}) as Record<string, unknown>;
    const int = (x: unknown) => (Number.isInteger(x) ? (x as number) : -1);
    let inp: ActInput;
    switch (a.k) {
      case 'edict':
        if (!(EDICTS as readonly unknown[]).includes(a.edict)) return json({ error: 'unknown edict' }, 400);
        inp = { k: 'edict', founder: f, edict: a.edict as Edict };
        break;
      case 'omen':
        inp = { k: 'omen', founder: f, id: int(a.id), pick: int(a.pick) };
        break;
      case 'name': {
        const name = placeName(a.name);
        if (!name) return json({ error: 'that name is not allowed' }, 400);
        if (!['sett', 'river', 'great', 'wonder'].includes(a.what as string)) return json({ error: 'bad request' }, 400);
        inp = { k: 'name', founder: f, what: a.what as 'sett', id: int(a.id), name };
        break;
      }
      case 'gift':
      case 'propose':
        inp = { k: a.k, founder: f, to: int(a.to) };
        break;
      default:
        return json({ error: 'unknown action' }, 400);
    }
    return this.serial(async () => {
      const w = await this.load();
      if (this.held()) return json({ error: 'this world is ending and holds still until the new one begins' }, 409);
      const c = w.civs.find((x) => x.founder === f && x.died < 0);
      if (!c) return json({ error: 'you have no living people' }, 403);
      const queued = this.pending.filter((p) => p.k !== 'found' && p.k !== 'offer' && p.k !== 'god' && p.founder === f) as ActInput[];
      if (queued.length >= 4) return json({ error: 'wait for the month to turn' }, 429);
      const owed = queued.reduce((n, p) => n + COST[p.k], 0);
      if (influence(w, c) < owed + COST[inp.k]) return json({ error: 'not enough influence' }, 409);
      if (inp.k === 'omen') {
        const id = inp.id;
        const om = w.omens.find((o) => o.id === id && o.civ === c.id);
        if (!om || inp.pick < 0 || inp.pick >= OMEN_CHOICES[om.k]) return json({ error: 'that omen has passed' }, 409);
        if (queued.some((p) => p.k === 'omen' && p.id === id)) return json({ error: 'already answered' }, 409);
      }
      if (inp.k === 'name' && !nameable(w, c, inp.what, inp.id)) return json({ error: 'that can no longer be named' }, 409);
      if (inp.k === 'gift' || inp.k === 'propose') {
        const o = w.civs[inp.to];
        if (!o || o.died >= 0 || !c.contacts.includes(o.id)) return json({ error: 'your people do not know them' }, 409);
      }
      this.pending.push(inp);
      await this.kv.put('pending', JSON.stringify(this.pending));
      return json({ ok: true, eta: this.nextTickAt(), now: this.o.now() });
    });
  }

  /** POST /offer: a pilgrim's offering, once a real day, for anyone without a living people. */
  private async offer(req: Request): Promise<Response> {
    const b = await this.body(req);
    if (!b || !isFounderId(b.id) || !Number.isInteger(b.s)) return json({ error: 'bad request' }, 400);
    const f = await founderHash(b.id);
    const sid = b.s as number;
    return this.serial(async () => {
      const w = await this.load();
      if (w.civs.some((c) => c.founder === f && c.died < 0)) return json({ error: 'founders tend their own people' }, 403);
      const s = w.setts[sid];
      if (!s || s.died >= 0) return json({ error: 'that place is gone' }, 409);
      const day = this.day();
      const done = await this.db.prepare('SELECT s FROM cw_offers WHERE world = ?1 AND founder = ?2 AND day = ?3').bind(this.meta.id, f, day).first();
      if (done) return json({ error: 'you have already left an offering today' }, 429);
      await this.db.prepare('INSERT INTO cw_offers (world, founder, day, s) VALUES (?1, ?2, ?3, ?4)').bind(this.meta.id, f, day, sid).run();
      this.pending.push({ k: 'offer', s: sid });
      await this.kv.put('pending', JSON.stringify(this.pending));
      return json({ ok: true, eta: this.nextTickAt(), now: this.o.now() });
    });
  }

  private async admin(cmd: string, req: Request): Promise<Response> {
    if (!this.o.adminKey || req.headers.get('x-admin-key') !== this.o.adminKey) return json({ error: 'forbidden' }, 403);
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as { seed?: number; civs?: number; seeds?: number[]; pick?: number; at?: number; force?: boolean; simV?: number; fill?: number }) : {};
    if (cmd.startsWith('next/') && req.method === 'POST') return this.serial(() => this.adminNext(cmd.slice(5), body));
    if (cmd === 'god' && req.method === 'POST') return this.serial(() => this.adminGod(body as Record<string, unknown>));
    if (cmd === 'status') {
      const w = await this.serial(() => this.load());
      let next: unknown = this.next;
      if (this.next) {
        const n = this.next;
        if (n.phase === 'vote') {
          const rows = await this.db.prepare('SELECT first, second FROM cw_votes WHERE round = ?1').bind(n.round).all<{ first: number; second: number }>();
          next = { ...n, voters: rows.results.length, ...tally(n.seeds.length, rows.results) };
        } else {
          const c = await this.db.prepare('SELECT COUNT(*) AS n FROM cw_prefounds WHERE round = ?1').bind(n.round).first<{ n: number }>();
          next = { ...n, prefounds: c?.n ?? 0, startsIn: n.startAt ? `${((n.startAt - this.o.now()) / 3_600_000).toFixed(2)} h` : 'not scheduled' };
        }
      }
      return json({ world: this.meta.id, simV: SIM_V, savedV: this.savedV, held: this.held(), seed: this.meta.seed, epoch: this.meta.epoch, tick: w.tick, year: Math.floor(w.tick / 12), civs: w.civs.filter((c) => c.died < 0).length, events: this.flushed, pending: this.pending.length, next, archives: this.archives });
    }
    if (cmd === 'wipe' && req.method === 'POST') {
      return this.serial(async () => {
        await this.load();
        const old = this.meta.id;
        await this.snapshot('archive');
        await this.db.batch([
          this.db.prepare('DELETE FROM cw_events WHERE world = ?1').bind(old),
          this.db.prepare('DELETE FROM cw_years WHERE world = ?1').bind(old),
          this.db.prepare('DELETE FROM cw_inputs WHERE world = ?1').bind(old),
          this.db.prepare('DELETE FROM cw_foundings WHERE world = ?1').bind(old),
          this.db.prepare('DELETE FROM cw_offers WHERE world = ?1').bind(old),
        ]);
        const seed = Number.isFinite(body.seed) ? Number(body.seed) : this.o.now() % 1_000_000_007;
        await this.create(seed, Number(body.civs) || this.o.civs);
        return json({ ok: true, archived: old, world: this.meta.id, seed });
      });
    }
    return json({ error: 'unknown admin command' }, 404);
  }

  /** POST admin/god: the owner's hand. Peoples and towns may be named; the event lands next month. */
  private async adminGod(b: Record<string, unknown>): Promise<Response> {
    const w = await this.load();
    const WHAT = ['say', 'plague', 'quake', 'eruption', 'fire', 'flood', 'tsunami', 'famine', 'bless', 'war', 'peace', 'revolt', 'collapse', 'horde', 'calm'];
    if (!WHAT.includes(b.what as string)) return json({ error: `what must be one of: ${WHAT.join(', ')}` }, 400);
    const lc = (x: unknown) => String(x ?? '').trim().toLowerCase();
    const civ = (x: unknown): number | undefined => {
      if (x === undefined || x === null || x === '') return undefined;
      if (Number.isInteger(x)) return x as number;
      const n = lc(x).replace(/^the /, '');
      return w.civs.find((c) => c.died < 0 && c.name.toLowerCase() === n)?.id ?? -1;
    };
    const sett = (x: unknown): number | undefined => {
      if (x === undefined || x === null || x === '') return undefined;
      if (Number.isInteger(x)) return x as number;
      return w.setts.find((s) => s.died < 0 && s.name.toLowerCase() === lc(x))?.id ?? -1;
    };
    const inp: GodInput = { k: 'god', what: b.what as GodInput['what'] };
    const a = civ(b.civ);
    const o = civ(b.other);
    const s = sett(b.town);
    if (a === -1 || o === -1 || s === -1) return json({ error: `no living ${a === -1 ? `people "${b.civ}"` : o === -1 ? `people "${b.other}"` : `town "${b.town}"`}` }, 404);
    if (a !== undefined) inp.a = a;
    if (o !== undefined) inp.b = o;
    if (s !== undefined) inp.s = s;
    if (Number.isInteger(b.tile)) inp.tile = b.tile as number;
    if (typeof b.text === 'string' && b.text.trim()) inp.text = b.text.trim().slice(0, 280);
    if (typeof b.name === 'string' && b.name.trim()) {
      const nm = properName(b.name);
      if (!nm) return json({ error: 'that name is not allowed' }, 400);
      inp.name = nm;
    }
    if (Number.isFinite(b.power)) inp.power = Number(b.power);
    const needs: Record<string, string> = { plague: 's', quake: 's', eruption: 's', fire: 's', flood: 's', tsunami: 's', revolt: 's', famine: 'a', bless: 'a', collapse: 'a', calm: 'a', war: 'ab', peace: 'ab', say: '' };
    for (const k of needs[inp.what] ?? '') if ((inp as unknown as Record<string, unknown>)[k] === undefined) return json({ error: `${inp.what} needs ${k === 's' ? '--town' : k === 'a' ? '--civ' : '--other'}` }, 400);
    if (inp.what === 'say' && !inp.text) return json({ error: 'say needs --text' }, 400);
    this.pending.push(inp);
    await this.kv.put('pending', JSON.stringify(this.pending));
    return json({ ok: true, queued: inp, eta: this.nextTickAt(), now: this.o.now() });
  }

  /** Owner commands for the next world: open (a ballot), close (pick the winner), schedule (the start), cancel. */
  private async adminNext(cmd: string, body: { seeds?: number[]; civs?: number; pick?: number; at?: number; force?: boolean; simV?: number; fill?: number }): Promise<Response> {
    await this.load();
    const now = this.o.now();
    const n = this.next;
    if (cmd === 'open') {
      if (n && !body.force) return json({ error: `a ${n.phase} round is already open (cancel it first, or pass force)` }, 409);
      const seeds = Array.isArray(body.seeds) && body.seeds.length >= 2 && body.seeds.every((s) => Number.isInteger(s) && s >= 0)
        ? body.seeds.slice(0, 12)
        : Array.from({ length: BALLOT_SIZE }, (_, i) => (Math.floor(now / 1000) * 7919 + i * 104_729 + 17) % 1_000_000_007);
      const civs = Number.isInteger(body.civs) ? Math.max(0, Math.min(40, body.civs!)) : this.o.civs;
      this.next = { round: `r${now.toString(36)}`, phase: 'vote', seeds, civs, opened: now, simV: Number(body.simV) || SIM_V, fill: Number.isInteger(body.fill) ? body.fill : undefined };
      await this.saveNext();
      return json({ ok: true, next: this.next });
    }
    if (!n) return json({ error: 'no round is open' }, 409);
    if (cmd === 'set') {
      // Change how the coming world begins: ancient peoples at the start (civs) and/or AI peoples arriving later (fill).
      if (Number.isInteger(body.civs)) n.civs = Math.max(0, Math.min(40, body.civs!));
      if (Number.isInteger(body.fill)) n.fill = Math.max(0, Math.min(60, body.fill!)) || undefined;
      if (Number.isInteger(body.simV)) n.simV = body.simV;
      this.preview = null;
      await this.saveNext();
      return json({ ok: true, next: n });
    }
    if (cmd === 'cancel') {
      this.next = null;
      this.preview = null;
      await this.saveNext();
      return json({ ok: true, cancelled: n.round });
    }
    if (cmd === 'close') {
      if (n.phase !== 'vote') return json({ error: 'voting is already closed' }, 409);
      const rows = await this.db.prepare('SELECT first, second FROM cw_votes WHERE round = ?1').bind(n.round).all<{ first: number; second: number }>();
      const t = tally(n.seeds.length, rows.results);
      const pick = Number.isInteger(body.pick) && body.pick! >= 0 && body.pick! < n.seeds.length ? body.pick! : t.winner;
      n.phase = 'prep';
      n.seed = n.seeds[pick];
      n.startAt = Number.isFinite(body.at) ? Math.max(now, Number(body.at)) : null;
      await this.saveNext();
      return json({ ok: true, pick, seed: n.seed, voters: rows.results.length, ...t, startAt: n.startAt });
    }
    if (cmd === 'schedule') {
      if (n.phase !== 'prep') return json({ error: 'close the vote first' }, 409);
      if (body.at !== null && !Number.isFinite(body.at)) return json({ error: 'give a start time (ms since epoch), or null to unschedule' }, 400);
      n.startAt = body.at === null ? null : Math.max(now, Number(body.at));
      await this.saveNext();
      return json({ ok: true, startAt: n.startAt, startsIn: n.startAt ? `${((n.startAt - now) / 3_600_000).toFixed(2)} h` : null });
    }
    return json({ error: 'unknown next command' }, 404);
  }
}
