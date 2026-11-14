// The keeper of one live colony. An instance runs inside a Cloudflare Durable Object (and one
// in the Vite dev server locally). It advances the colony in real time, saves it, archives
// its history to D1, and answers the /api/hl/* requests. No Cloudflare-specific code here, so
// it can be tested anywhere.
//
// Browsers do not stream the colony: they load a snapshot and run the same sim themselves,
// tick for tick. Anything that enters the colony from outside (a player's colonist, an
// owner's event) is an input stamped with a tick a little in the future, so every copy applies
// it at the same moment.

import { founderHash, isClean, isFounderId } from '../../commonworld/shared/text';
import type { D1 } from '../../net/db';
import { DEFAULT_MS_PER_DAY, HARD_CAP, SIM_V, TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { checkSpec, type PawnSpec } from '../sim/create';
import { NUDGES, heirsOf, resolveOf } from '../sim/player';
import type { SettlerMsg } from '../sim/settle';
import { colonyHash, createColony, deserialize, serialize, step, type Colony, type Input } from '../sim/index';

export interface KV {
  get(key: string): Promise<string | undefined | null>;
  put(key: string, value: string): Promise<void>;
}

export interface HostOpts {
  /** real milliseconds per game day (1,440,000 = one game year per real day) */
  msPerDay: number;
  /** most ticks to simulate in one call when catching up */
  maxStep: number;
  /** colonists in a brand-new colony, and game days it has already lived when it opens */
  pop: number;
  preDays: number;
  seed?: number;
  adminKey?: string;
  /** part of a region: wait to be started by it rather than making a colony unasked */
  managed?: boolean;
  /** hand the region this colony's news and anything it has sent out (settler parties) */
  deliver?: (body: { from: string; msgs: { k: string }[]; pop: number; ruler?: string; tick: number; name: string; owners: string[]; wars?: string[] }) => Promise<void>;
  /** ask the region whether this player already has a colonist somewhere else: returns that colony's name, or '' */
  claim?: (owner: string, colony: string) => Promise<string>;
  /** a check that the one joining is a person (Cloudflare Turnstile); off when not given */
  verifyHuman?: (token: string, ip: string) => Promise<boolean>;
  humanKey?: string;
  now: () => number;
}

interface Meta { id: string; seed: number; epoch: number; created: number; msPerTick: number; simV: number; archived: number; buried: number }
interface SeqInput extends Input { seq: number }

/** Ticks between an input being accepted and taking effect, so every browser hears of it in time. */
export const LEAD = 12;
const SAVE_EVERY = TICKS_PER_HOUR * 2;
const CHECK_EVERY = 100;
const JOINS_PER_IP_PER_DAY = 5;
/** Real milliseconds a player waits after a death before sending in someone new. */
const REJOIN_MS = 30 * 60_000;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let schemaReady = false;
async function schema(db: D1): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hl_events (
      colony TEXT NOT NULL, id INTEGER NOT NULL, t INTEGER NOT NULL, k TEXT NOT NULL, a INTEGER, b INTEGER, s TEXT, n REAL, PRIMARY KEY (colony, id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS hl_events_a ON hl_events (colony, a, id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS hl_people (
      colony TEXT NOT NULL, id INTEGER NOT NULL, owner TEXT, name TEXT NOT NULL, born INTEGER NOT NULL, died INTEGER NOT NULL, cause TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (colony, id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS hl_people_owner ON hl_people (owner, died)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS hl_joins (
      colony TEXT NOT NULL, owner TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS hl_joins_ip ON hl_joins (ip, created)'),
  ]);
  schemaReady = true;
}

export class ColonyHost {
  private c: Colony | null = null;
  private meta: Meta | null = null;
  private seq = 0;
  /** recent inputs, for browsers catching up */
  private inputs: SeqInput[] = [];
  /** [tick, hash] at regular ticks, so browsers can check they have not drifted */
  private checks: [number, string][] = [];
  private savedTick = -1;
  private loading: Promise<void> | null = null;
  private snap: { tick: number; seq: number; body: Uint8Array } | null = null;

  constructor(private kv: KV, private db: D1 | null, private o: HostOpts) {}

  private get msPerTick(): number {
    return this.meta?.msPerTick ?? this.o.msPerDay / TICKS_PER_DAY;
  }

  private async load(): Promise<void> {
    if (this.c) return;
    this.loading ??= (async () => {
      if (this.db) await schema(this.db);
      const meta = await this.kv.get('meta');
      const state = meta ? await this.kv.get('state') : null;
      if (meta && state) {
        this.meta = JSON.parse(meta) as Meta;
        this.c = deserialize(state);
        // a colony saved by older rules carries on under the new ones (deserialize fills in what is new)
        if (this.meta.simV !== SIM_V) this.meta.simV = SIM_V;
        const extra = JSON.parse((await this.kv.get('extra')) ?? '{}') as { seq?: number; inputs?: SeqInput[] };
        this.seq = extra.seq ?? 0;
        this.inputs = extra.inputs ?? [];
        this.savedTick = this.c.tick;
        // the configured pace changed while we were away: keep the colony's clock where it is
        const want = this.o.msPerDay / TICKS_PER_DAY;
        if (this.meta.msPerTick !== want) this.retime(want);
      } else if (!this.o.managed) await this.create(this.o.seed);
    })();
    await this.loading;
  }

  private async create(seed?: number, x: { id?: string; pop?: number; preDays?: number; settlers?: SettlerMsg; avoid?: string[]; ruinsOf?: string } = {}): Promise<void> {
    const now = this.o.now();
    const s = seed ?? ((now % 2147483647) | 1);
    const c = createColony({ seed: s, pop: x.pop ?? this.o.pop, settlers: x.settlers, avoid: x.avoid, ruinsOf: x.ruinsOf });
    if (!x.settlers) for (let k = 0; k < (x.preDays ?? this.o.preDays) * TICKS_PER_DAY; k++) step(c);
    c.id = x.id ?? 'h' + now.toString(36) + (s % 1296).toString(36);
    c.out = [];
    const msPerTick = this.o.msPerDay / TICKS_PER_DAY;
    this.c = c;
    this.meta = { id: c.id, seed: s, epoch: now - c.tick * msPerTick, created: now, msPerTick, simV: SIM_V, archived: c.logBase + c.log.length, buried: c.dead.length };
    this.seq = 0;
    this.inputs = [];
    this.checks = [];
    this.snap = null;
    await this.save();
  }

  /** Change the pace without the colony's clock jumping. */
  private retime(msPerTick: number): void {
    if (!this.meta || !this.c) return;
    const now = this.o.now();
    this.meta.epoch = now - this.c.tick * msPerTick;
    this.meta.msPerTick = msPerTick;
  }

  private async save(): Promise<void> {
    if (!this.c || !this.meta) return;
    await this.kv.put('state', serialize(this.c));
    await this.kv.put('extra', JSON.stringify({ seq: this.seq, inputs: this.inputs }));
    await this.kv.put('meta', JSON.stringify(this.meta));
    this.savedTick = this.c.tick;
  }

  private target(): number {
    return Math.floor((this.o.now() - this.meta!.epoch) / this.msPerTick);
  }

  /** Bring the colony up to the present (or part of the way, after a long sleep). Returns ticks still owed. */
  async advance(): Promise<number> {
    await this.load();
    if (!this.c) return 0;
    const c = this.c;
    const want = this.target();
    const n = Math.min(this.o.maxStep, want - c.tick);
    if (n <= 0) return 0;
    for (let k = 0; k < n; k++) {
      step(c);
      if (c.tick % CHECK_EVERY === 0) {
        this.checks.push([c.tick, colonyHash(c)]);
        if (this.checks.length > 12) this.checks.shift();
      }
    }
    this.inputs = this.inputs.filter((i) => i.t > c.tick - TICKS_PER_DAY);
    await this.archive();
    const sent = c.out.length > 0;
    if (sent || c.tick - this.savedTick >= SAVE_EVERY) await this.report();
    if (sent || c.tick - this.savedTick >= SAVE_EVERY) await this.save();
    return want - c.tick;
  }

  /** Tell the region how this colony is doing, and hand over anything it has sent out. */
  private async report(): Promise<void> {
    const c = this.c!;
    if (!this.o.deliver) { c.out = []; return; }
    const ruler = c.pawns.find((p) => p.id === c.gov.ruler);
    const msgs = c.out;
    try {
      const owners = [...c.pawns.filter((p) => p.owner).map((p) => p.owner!), ...c.inq.filter((i) => i.k === 'join').map((i) => String(i.owner))];
      await this.o.deliver({ from: c.id, msgs, pop: c.pawns.length, ruler: ruler ? `${ruler.first} ${ruler.fam}` : undefined, tick: c.tick, name: c.name, owners, wars: Object.keys(c.wars ?? {}) });
      c.out = [];
    } catch {
      /* the region is busy: keep the messages and try again next time */
    }
  }

  /** Copy new events and newly dead colonists to D1, where they outlive the colony's short memory. */
  private async archive(): Promise<void> {
    const c = this.c!;
    const m = this.meta!;
    if (!this.db) { m.archived = c.logBase + c.log.length; m.buried = c.dead.length; return; }
    const stmts = [];
    const end = c.logBase + c.log.length;
    for (let id = Math.max(m.archived, c.logBase); id < end && stmts.length < 80; id++) {
      const e = c.log[id - c.logBase];
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO hl_events (colony, id, t, k, a, b, s, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(m.id, id, e.t, e.k, e.a ?? null, e.b ?? null, e.s ?? null, e.n ?? null));
      m.archived = id + 1;
    }
    if (m.archived < c.logBase) m.archived = c.logBase;
    for (; m.buried < c.dead.length && stmts.length < 90; m.buried++) {
      const d = c.dead[m.buried];
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO hl_people (colony, id, owner, name, born, died, cause, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(m.id, d.id, d.owner ?? null, `${d.first} ${d.fam}`, d.born, d.died, d.cause, JSON.stringify(d)));
    }
    if (stmts.length) await this.db.batch(stmts);
  }

  /** When the Durable Object should next wake: no need to wake every tick when nobody is asking. */
  /** Is there a colony here to keep running? A retired or never-started one needs no alarms. */
  active(): boolean {
    return !!this.c;
  }

  nextWakeAt(): number {
    return this.o.now() + Math.max(this.msPerTick, 60_000);
  }

  private async queue(input: Input): Promise<SeqInput> {
    const c = this.c!;
    const e: SeqInput = { ...input, t: c.tick + LEAD, seq: ++this.seq };
    c.inq.push({ ...input, t: e.t });
    this.inputs.push(e);
    this.snap = null;
    await this.save();
    return e;
  }

  private state(): Record<string, unknown> {
    const c = this.c!;
    const m = this.meta!;
    return { id: m.id, seed: m.seed, name: c.name, tick: c.tick, epoch: m.epoch, msPerTick: m.msPerTick, simV: m.simV, seq: this.seq, pop: c.pawns.length, humanKey: this.o.humanKey, now: this.o.now(), checks: this.checks.slice(-3) };
  }

  async handle(req: Request, internal = false): Promise<Response> {
    await this.load();
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/api\/hl\/(c\/[^/]+\/)?/, '');
    if (internal && req.method === 'POST' && path === 'retire') {
      // the world is starting over: this colony is gone for good
      this.c = null;
      this.meta = null;
      this.snap = null;
      this.inputs = [];
      this.checks = [];
      await this.kv.put('meta', '');
      await this.kv.put('state', '');
      await this.kv.put('extra', '');
      return json({ ok: true });
    }
    if (internal && req.method === 'POST' && path === 'init') {
      if (!this.c) {
        const b = (await req.json()) as { seed: number; id: string; pop?: number; preDays?: number; settlers?: SettlerMsg; avoid?: string[]; ruinsOf?: string };
        await this.create(b.seed, b);
      }
      return json(this.state());
    }
    if (!this.c) return json({ error: 'no such colony' }, 404);
    if (internal && req.method === 'POST' && path === 'input') {
      const e = await this.queue({ ...((await req.json()) as Input), t: 0 });
      return json({ ok: true, at: e.t });
    }
    const c = this.c;
    const m = this.meta!;
    try {
      if (req.method === 'GET') {
        if (path === 'state') return json(this.state());
        if (path === 'snapshot') {
          if (!this.snap || this.snap.tick !== c.tick || this.snap.seq !== this.seq) {
            this.snap = { tick: c.tick, seq: this.seq, body: await gzip(JSON.stringify({ ...this.state(), colony: serialize(c) })) };
          }
          return new Response(this.snap.body, { headers: { 'content-type': 'application/octet-stream', 'x-gz': '1', 'cache-control': 'no-store' } });
        }
        if (path === 'sync') {
          const since = Number(url.searchParams.get('seq')) || 0;
          return json({ ...this.state(), inputs: this.inputs.filter((i) => i.seq > since) });
        }
        if (path === 'me') {
          const f = url.searchParams.get('f');
          if (!isFounderId(f)) return json({ error: 'bad id' }, 400);
          const h = await founderHash(f);
          const alive = c.pawns.find((p) => p.owner === h);
          if (alive) return json({ status: 'alive', id: alive.id, hash: h });
          if (c.inq.some((i) => i.k === 'join' && i.owner === h)) return json({ status: 'pending', hash: h });
          const dead = [...c.dead].reverse().find((d) => d.owner === h);
          if (dead) return json({ status: 'dead', id: dead.id, hash: h, name: `${dead.first} ${dead.fam}`, cause: dead.cause, left: !!dead.left });
          return json({ status: 'none', hash: h });
        }
        if (path === 'events' && this.db) {
          const before = Number(url.searchParams.get('before')) || c.logBase;
          const who = Number(url.searchParams.get('who')) || 0;
          const rows = who
            ? await this.db.prepare('SELECT id, t, k, a, b, s, n FROM hl_events WHERE colony = ? AND (a = ? OR b = ?) AND id < ? ORDER BY id DESC LIMIT 200').bind(m.id, who, who, before).all()
            : await this.db.prepare('SELECT id, t, k, a, b, s, n FROM hl_events WHERE colony = ? AND id < ? ORDER BY id DESC LIMIT 200').bind(m.id, before).all();
          return json({ events: rows.results });
        }
        if (path === 'admin/status') {
          if (!this.admin(req)) return json({ error: 'forbidden' }, 403);
          return json({ ...this.state(), behind: this.target() - c.tick, dead: c.dead.length, foes: c.foes.length, owners: c.pawns.filter((p) => p.owner).length });
        }
      }
      if (req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) return json({ error: 'bad request' }, 400);
        if (path === 'join') return await this.join(req, body);
        if (path === 'act' || path === 'heir') {
          if (!isFounderId(body.f)) return json({ error: 'bad id' }, 400);
          const h = await founderHash(body.f);
          if (path === 'heir') {
            const heir = heirsOf(c, h).find((p) => p.id === Number(body.id));
            if (!heir) return json({ error: 'They cannot carry on for you.' }, 409);
            const e = await this.queue({ t: 0, k: 'heir', owner: h, id: heir.id });
            return json({ ok: true, at: e.t });
          }
          if (path === 'act' && body.k === 'answer') {
            const mine = c.pawns.find((x) => x.owner === h);
            if (!mine?.ask) return json({ error: 'There is nothing to answer.' }, 409);
            const e = await this.queue({ t: 0, k: 'answer', owner: h, v: String(body.v ?? '') });
            return json({ ok: true, at: e.t });
          }
          const p = c.pawns.find((x) => x.owner === h);
          const def = NUDGES[String(body.k)];
          if (!p || !def) return json({ error: 'You have no colonist to nudge.' }, 409);
          // count nudges already on their way, so a quick double press cannot overspend
          const waiting = c.inq.filter((i) => i.k === 'nudge' && i.owner === h).length;
          if (resolveOf(c, p) - waiting < def.cost) return json({ error: 'Not enough Resolve yet.' }, 409);
          const e = await this.queue({ t: 0, k: 'nudge', owner: h, kind: def.k, o: Number(body.o) || 0, v: Number(body.v) || 0 });
          return json({ ok: true, at: e.t });
        }
        if (path.startsWith('admin/')) {
          if (!this.admin(req)) return json({ error: 'forbidden' }, 403);
          if (path === 'admin/wipe') {
            if (body.confirm !== 'wipe') return json({ error: 'confirm with {"confirm":"wipe"}' }, 400);
            this.c = null;
            await this.create(typeof body.seed === 'number' ? body.seed : undefined);
            return json({ ok: true, ...this.state() });
          }
          if (path === 'admin/pace') {
            const ms = Number(body.msPerDay);
            if (!(ms >= 1000)) return json({ error: 'msPerDay must be at least 1000' }, 400);
            this.retime(ms / TICKS_PER_DAY);
            await this.save();
            return json({ ok: true, ...this.state() });
          }
          if (path === 'admin/raid') {
            const e = await this.queue({ t: 0, k: 'raid', kind: String(body.kind ?? 'bandit'), n: Math.max(1, Math.min(12, Number(body.n) || 3)) });
            return json({ ok: true, at: e.t });
          }
        }
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  private admin(req: Request): boolean {
    return !!this.o.adminKey && req.headers.get('x-admin-key') === this.o.adminKey;
  }

  /** A player sends in a colonist. One living colonist per player; the sim's own rules decide what is allowed. */
  private async join(req: Request, body: Record<string, unknown>): Promise<Response> {
    const c = this.c!;
    const m = this.meta!;
    if (!isFounderId(body.f)) return json({ error: 'bad id' }, 400);
    const spec = body.spec as PawnSpec;
    if (!spec || typeof spec !== 'object') return json({ error: 'bad colonist' }, 400);
    const check = checkSpec(spec);
    if (!check.ok) return json({ error: check.errors[0] ?? 'That colonist breaks the rules.', errors: check.errors }, 400);
    for (const s of [spec.first, spec.fam, spec.epi, spec.heirloom]) if (s && !isClean(s)) return json({ error: 'Please choose different words.' }, 400);
    const h = await founderHash(body.f);
    if (c.pawns.some((p) => p.owner === h) || c.inq.some((i) => i.k === 'join' && i.owner === h)) return json({ error: 'You already have a colonist here.' }, 409);
    const last = [...c.dead].reverse().find((d) => d.owner === h);
    if (last) {
      const since = (c.tick - last.died) * m.msPerTick;
      if (since < REJOIN_MS) return json({ error: 'Give it a little while before sending someone new.', wait: Math.ceil((REJOIN_MS - since) / 60_000) }, 429);
    }
    const ip0 = req.headers.get('cf-connecting-ip') ?? 'local';
    if (this.o.verifyHuman && !(typeof body.token === 'string' && (await this.o.verifyHuman(body.token, ip0)))) return json({ error: 'Please complete the check that you are a person.' }, 403);
    if (this.o.claim) {
      const where = await this.o.claim(h, c.id).catch(() => '');
      if (where) return json({ error: `You already have a colonist in ${where}.` }, 409);
    }
    const queued = c.inq.filter((i) => i.k === 'join').length;
    if (c.pawns.length + queued >= HARD_CAP) return json({ error: 'This colony is full.' }, 409);
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const now = this.o.now();
    if (this.db) {
      const row = await this.db.prepare('SELECT COUNT(*) AS n FROM hl_joins WHERE ip = ? AND created > ?').bind(ip, now - 86_400_000).first<{ n: number }>();
      if ((row?.n ?? 0) >= JOINS_PER_IP_PER_DAY) return json({ error: 'Too many new colonists from this network today.' }, 429);
      await this.db.prepare('INSERT INTO hl_joins (colony, owner, ip, created) VALUES (?, ?, ?, ?)').bind(m.id, h, ip, now).run();
    }
    const clean: PawnSpec = {
      first: spec.first, fam: spec.fam, epi: spec.epi || undefined, race: spec.race, sex: spec.sex ? 1 : 0, age: Math.round(spec.age * 10) / 10,
      look: { skin: spec.look.skin, hair: spec.look.hair, hairCol: spec.look.hairCol, body: spec.look.body, face: spec.look.face, eyes: spec.look.eyes, beard: spec.look.beard, marks: spec.look.marks.slice(0, 3), garb: spec.look.garb },
      bc: spec.bc, ba: spec.ba, traits: spec.traits.slice(), sk: spec.sk.slice(), pas: spec.pas.slice(), faith: spec.faith, dev: spec.dev, goal: spec.goal,
      orient: spec.orient === 1 ? 1 : spec.orient === 2 ? 2 : 0, phobia: spec.phobia || undefined, secret: spec.secret || undefined, heirloom: spec.heirloom || undefined,
    };
    const e = await this.queue({ t: 0, k: 'join', spec: clean, owner: h });
    return json({ ok: true, at: e.t, hash: h });
  }
}

export { DEFAULT_MS_PER_DAY };
