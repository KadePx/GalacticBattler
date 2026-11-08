// The live world's keeper. One instance runs inside a Cloudflare Durable Object (and one in the
// Vite dev server locally). It advances the world in real time, stores the live state in a
// small key-value store, writes history (events, yearly records, inputs, backups) to D1, and
// answers the /api/cw/* requests. It has no Cloudflare-specific code, so it can be tested anywhere.

import {
  createWorld, serializeDynamic, serializeStatic, assemble, stateHash, step, SIM_V, TICKS_PER_YEAR,
  type Input, type World,
} from '../sim/index';
import { frameToWire, yearRecord, type YearRecord } from '../history';
import type { D1, D1Stmt } from '../../net/db';

export interface KV {
  get(key: string): Promise<string | undefined | null>;
  put(key: string, value: string): Promise<void>;
}

export interface HostOpts {
  msPerTick: number; // real milliseconds per game month (300000 = 1 game year per real hour)
  maxStep: number; // most ticks to simulate in one call (catching up after downtime)
  civs: number; // ancient civs in a brand-new world
  adminKey?: string;
  now: () => number;
}

interface Meta { id: string; seed: number; epoch: number; created: number }

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
    db.prepare(`CREATE TABLE IF NOT EXISTS cw_snaps (
      world TEXT NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, v INTEGER NOT NULL,
      data TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (world, tick, kind)
    )`),
  ]);
  schemaReady = true;
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
    const meta = await this.kv.get('meta');
    if (!meta) return this.create(this.o.now() % 1_000_000_007, this.o.civs);
    this.meta = JSON.parse(meta);
    const [st, dyn, pending, seq] = await Promise.all([this.kv.get('static'), this.kv.get('dyn'), this.kv.get('pending'), this.kv.get('seq')]);
    const w = assemble(st!, dyn!);
    this.w = w;
    this.pending = JSON.parse(pending ?? '[]');
    this.seq = Number(seq ?? 0);
    this.flushed = w.logBase + w.log.length;
    return w;
  }

  private async create(seed: number, civs: number): Promise<World> {
    const now = this.o.now();
    const w = createWorld({ seed, civs });
    this.w = w;
    this.meta = { id: `w${seed.toString(36)}${now.toString(36)}`, seed, epoch: now, created: now };
    this.pending = [];
    this.seq = 0;
    this.flushed = 0;
    this.staticGz = null;
    this.gzCache = null;
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
      const w = await this.load();
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
      const w = await this.serial(() => this.load());
      const q = url.searchParams;
      switch (path) {
        case 'state':
          return json({
            world: this.meta.id, simV: SIM_V, tick: w.tick, epoch: this.meta.epoch, msPerTick: this.o.msPerTick,
            now: this.o.now(), next: this.nextTickAt(), hash: stateHash(w), logBase: w.logBase,
          });
        case 'static': {
          this.staticGz ??= await gzip(serializeStatic(w));
          return new Response(this.staticGz, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-world': this.meta.id } });
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
          const before = Math.min(Number(q.get('before') ?? this.flushed) || this.flushed, this.flushed);
          const limit = Math.max(1, Math.min(2000, Number(q.get('limit') ?? 500) || 500));
          const civ = q.get('civ');
          const sql = civ !== null
            ? 'SELECT id,t,k,a,b,s,n,x,y,z FROM cw_events WHERE world = ?1 AND id < ?2 AND (a = ?4 OR b = ?4) ORDER BY id DESC LIMIT ?3'
            : 'SELECT id,t,k,a,b,s,n,x,y,z FROM cw_events WHERE world = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3';
          const st = this.db.prepare(sql);
          const res = await (civ !== null ? st.bind(this.meta.id, before, limit, Number(civ)) : st.bind(this.meta.id, before, limit)).all<Record<string, unknown>>();
          // Drop empty columns to keep the payload small.
          const events = res.results.map((r) => {
            const e: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) if (v !== null) e[k] = v;
            return e;
          });
          return json({ world: this.meta.id, events }, 200, 'public, max-age=30');
        }
        case 'years': {
          const from = Math.max(0, Number(q.get('from') ?? 0) || 0);
          const to = Math.max(from, Number(q.get('to') ?? from + 500) || from + 500);
          const res = await this.db.prepare('SELECT year, stats, frame FROM cw_years WHERE world = ?1 AND year >= ?2 AND year <= ?3 ORDER BY year LIMIT 500')
            .bind(this.meta.id, from, to).all<{ year: number; stats: string; frame: string | null }>();
          return json({ world: this.meta.id, years: res.results }, 200, 'public, max-age=30');
        }
        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  private async admin(cmd: string, req: Request): Promise<Response> {
    if (!this.o.adminKey || req.headers.get('x-admin-key') !== this.o.adminKey) return json({ error: 'forbidden' }, 403);
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as { seed?: number; civs?: number }) : {};
    if (cmd === 'status') {
      const w = await this.serial(() => this.load());
      return json({ world: this.meta.id, seed: this.meta.seed, epoch: this.meta.epoch, tick: w.tick, year: Math.floor(w.tick / 12), civs: w.civs.filter((c) => c.died < 0).length, events: this.flushed, pending: this.pending.length });
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
        ]);
        const seed = Number.isFinite(body.seed) ? Number(body.seed) : this.o.now() % 1_000_000_007;
        await this.create(seed, Number(body.civs) || this.o.civs);
        return json({ ok: true, archived: old, world: this.meta.id, seed });
      });
    }
    return json({ error: 'unknown admin command' }, 404);
  }
}
