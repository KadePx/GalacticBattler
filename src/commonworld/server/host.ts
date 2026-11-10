// The live world's keeper. One instance runs inside a Cloudflare Durable Object (and one in the
// Vite dev server locally). It advances the world in real time, stores the live state in a
// small key-value store, writes history (events, yearly records, inputs, backups) to D1, and
// answers the /api/cw/* requests. It has no Cloudflare-specific code, so it can be tested anywhere.

import {
  createWorld, serializeDynamic, serializeStatic, assemble, stateHash, step, SIM_V, TICKS_PER_YEAR, VALUES,
  EDICTS, type ActInput, type Edict, type FoundInput, type Input, type ValueId, type World,
} from '../sim/index';
import { COST, OMEN_CHOICES, influence, nameable } from '../sim/player';
import { AGES, civAge } from '../sim/techs';
import { ogImage } from './og';
import { canFoundAt } from '../sim/civ';
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
  private ogCache = new Map<string, Uint8Array>();

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

  private async create(seed: number, civs: number): Promise<World> {
    const now = this.o.now();
    const w = createWorld({ seed, civs });
    this.w = w;
    this.meta = { id: `w${seed.toString(36)}${now.toString(36)}`, seed, epoch: now, created: now, msPerTick: this.o.msPerTick };
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
      const w = await this.serial(() => this.load());
      const q = url.searchParams;
      switch (path) {
        case 'state':
          return json({
            world: this.meta.id, simV: SIM_V, tick: w.tick, epoch: this.meta.epoch, msPerTick: this.o.msPerTick,
            now: this.o.now(), next: this.nextTickAt(), hash: stateHash(w), logBase: w.logBase,
            turnstile: this.o.turnstileSiteKey ?? null, pendingFoundings: this.pending.length,
          });
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

  /** POST /found: a player founds their one people. Applied at the next tick. */
  private async found(req: Request): Promise<Response> {
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

    return this.serial(async () => {
      const w = await this.load();
      if (w.civs.some((c) => c.founder === f) || this.pending.some((p) => p.k === 'found' && p.founder === f)) return json({ error: 'you have already founded a people' }, 409);
      const prev = await this.db.prepare('SELECT status FROM cw_foundings WHERE world = ?1 AND founder = ?2').bind(this.meta.id, f).first<{ status: string }>();
      if (prev && prev.status !== 'failed') return json({ error: 'you have already founded a people' }, 409);
      const recent = await this.db.prepare('SELECT COUNT(*) AS n FROM cw_foundings WHERE world = ?1 AND ip = ?2 AND created > ?3')
        .bind(this.meta.id, ipKey, this.o.now() - 86_400_000).first<{ n: number }>();
      if ((recent?.n ?? 0) >= FOUNDINGS_PER_IP_PER_DAY) return json({ error: 'too many foundings from this network today' }, 429);
      const tile = Number(b.tile);
      if (!Number.isInteger(tile) || !canFoundAt(w, tile)) return json({ error: 'that land is no longer free; choose another' }, 409);
      if (this.pending.some((p) => p.k === 'found' && p.tile === tile)) return json({ error: 'another people is already heading there; choose another' }, 409);
      const inp: FoundInput = {
        k: 'found', founder: f, tile, values: values as ValueId[], name, capital, motto: motto || undefined,
        byName: byName || undefined, banner, phon: u32(b.phon), lex: u32(b.lex),
      };
      this.pending.push(inp);
      await this.kv.put('pending', JSON.stringify(this.pending));
      await this.db.prepare('INSERT OR REPLACE INTO cw_foundings (world, founder, ip, tile, status, civ, created) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)')
        .bind(this.meta.id, f, ipKey, tile, 'pending', this.o.now()).run();
      return json({ ok: true, founder: f, eta: this.nextTickAt(), now: this.o.now() });
    });
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
      const c = w.civs.find((x) => x.founder === f && x.died < 0);
      if (!c) return json({ error: 'you have no living people' }, 403);
      const queued = this.pending.filter((p) => p.k !== 'found' && p.k !== 'offer' && p.founder === f) as ActInput[];
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
}
