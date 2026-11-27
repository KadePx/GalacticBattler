// End-to-end checks for the colony keeper, with a fake clock and in-memory storage.
//   npm run hl:host

import { TICKS_PER_DAY } from '../config';
import { ColonyHost, LEAD, type KV } from '../server/host';
import { LocalWorld } from '../server/local';
import { RegionHost } from '../server/region';
import type { D1, D1Stmt } from '../../net/db';
import type { PawnSpec } from '../sim/create';
import { colonyHash, deserialize, step, type Colony, type Input } from '../sim/index';

declare const process: { exit(code: number): never };

let now = 1_800_000_000_000;
const MS_PER_DAY = 240_000; // one tick per second
const mem = new Map<string, string>();
const kv: KV = { get: async (k) => mem.get(k), put: async (k, v) => void mem.set(k, v) };
const opts = { msPerDay: MS_PER_DAY, maxStep: 5000, pop: 14, preDays: 3, seed: 11, adminKey: 'key', now: () => now };

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

async function get<T>(host: ColonyHost, path: string, headers: Record<string, string> = {}): Promise<T> {
  await host.advance();
  const r = await host.handle(new Request('http://x/api/hl/' + path, { headers }));
  if (r.headers.get('x-gz') === '1') {
    const text = await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text) as T;
  }
  return (await r.json()) as T;
}
async function post<T>(host: ColonyHost, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  await host.advance();
  const r = await host.handle(new Request('http://x/api/hl/' + path, { method: 'POST', body: JSON.stringify(body), headers }));
  return { status: r.status, body: (await r.json()) as T };
}

interface State { id: string; tick: number; seq: number; pop: number; checks: [number, string][]; msPerTick: number; inputs?: (Input & { seq: number })[] }

const spec: PawnSpec = {
  first: 'Brannoc', fam: 'Ashdown', race: 'dwarf', sex: 1, age: 48, look: { skin: 2, hair: 3, hairCol: 1, body: 3, face: 2, eyes: 1, beard: 3, marks: [], garb: 4 },
  bc: 'mineorphan', ba: 'blacksmith', traits: ['industrious', 'vengeful'], sk: [0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 2, 0], pas: [0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0], faith: 'iron', dev: 2, goal: 'craft', orient: 0,
};
const ME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const host = new ColonyHost(kv, null, opts);
const s0 = await get<State>(host, 'state');
check('a new colony exists and has lived its first days', s0.tick >= 3 * TICKS_PER_DAY && s0.pop >= 10, `tick ${s0.tick}, ${s0.pop} colonists`);

now += 1000 * 300;
const s1 = await get<State>(host, 'state');
check('time passing advances the colony', s1.tick === s0.tick + 300, `${s0.tick} -> ${s1.tick}`);

// A browser: load the snapshot, then run the sim itself
const snap = await get<State & { colony: string }>(host, 'snapshot');
let mine: Colony = deserialize(snap.colony);
let seq = snap.seq;
check('the snapshot matches the live colony', mine.tick === s1.tick && colonyHash(mine) === colonyHash(deserialize((await get<{ colony: string }>(host, 'snapshot')).colony)));

async function follow(h: ColonyHost = host): Promise<State> {
  const st = await get<State>(h, 'sync?seq=' + seq);
  for (const i of st.inputs ?? []) { mine.inq.push({ ...i }); seq = Math.max(seq, i.seq); }
  while (mine.tick < st.tick) step(mine);
  return st;
}

now += 1000 * 700;
await follow();
const live1 = deserialize((await get<{ colony: string }>(host, 'snapshot')).colony);
check('a browser that replays the sim stays identical', colonyHash(mine) === colonyHash(live1), `tick ${mine.tick}`);

// A player sends in a colonist
const none = await get<{ status: string }>(host, 'me?f=' + ME);
check('a newcomer has no colonist yet', none.status === 'none');
const bad = await post<{ error: string }>(host, 'join', { f: ME, spec: { ...spec, traits: ['industrious', 'lazy', 'tough', 'sharp', 'brave'] } });
check('a colonist that breaks the rules is refused', bad.status === 400, bad.body.error);
const rude = await post<{ error: string }>(host, 'join', { f: ME, spec: { ...spec, first: 'Shithead' } });
check('rude names are refused', rude.status === 400);
const j = await post<{ ok: boolean; at: number; hash: string }>(host, 'join', { f: ME, spec });
check('a valid colonist is accepted', j.status === 200 && j.body.ok && j.body.at === mine.tick + LEAD, `arrives at tick ${j.body.at}`);
const pending = await get<{ status: string }>(host, 'me?f=' + ME);
check('they are on their way', pending.status === 'pending');
const twice = await post<{ error: string }>(host, 'join', { f: ME, spec });
check('one colonist per player', twice.status === 409, twice.body.error);

now += 1000 * (LEAD + 40);
await follow();
const me = await get<{ status: string; id: number; hash: string }>(host, 'me?f=' + ME);
const arrived = mine.pawns.find((p) => p.owner === me.hash);
check('the colonist arrived, in the live colony and in the browser copy', me.status === 'alive' && !!arrived && arrived.id === me.id && arrived.first === 'Brannoc', arrived ? `${arrived.first} ${arrived.fam}, id ${arrived.id}` : '');
const live2 = deserialize((await get<{ colony: string }>(host, 'snapshot')).colony);
check('the browser copy still matches after the arrival', colonyHash(mine) === colonyHash(live2));

// The keeper restarts (the Durable Object was evicted): a fresh one picks up from storage
now += 1000 * 50;
await host.advance();
now += 1000 * 600;
const host2 = new ColonyHost(kv, null, opts);
const st2 = await get<State>(host2, 'state');
await follow(host2);
const live3 = deserialize((await get<{ colony: string }>(host2, 'snapshot')).colony);
check('a restarted keeper carries on from storage and catches up', st2.tick === mine.tick && colonyHash(mine) === colonyHash(live3), `tick ${st2.tick}`);
check('drift checks are published', st2.checks.length > 0 && st2.checks.every(([t]) => t % 100 === 0));

// A long sleep is caught up in pieces
now += 1000 * 12_000;
const owed = await host2.advance();
check('a long sleep is caught up in pieces', owed > 0, `${owed} ticks still owed after one call`);
await host2.advance();
await host2.advance();
await follow(host2);
check('and the browser copy still matches after a long catch-up', colonyHash(mine) === colonyHash(deserialize((await get<{ colony: string }>(host2, 'snapshot')).colony)), `tick ${mine.tick}`);

// Owner tools
const no = await post<{ error: string }>(host2, 'admin/raid', { kind: 'wolf', n: 3 });
check('owner tools need the key', no.status === 403);
const raid = await post<{ ok: boolean; at: number }>(host2, 'admin/raid', { kind: 'wolf', n: 3 }, { 'x-admin-key': 'key' });
now += 1000 * (LEAD + 5);
await follow(host2);
check('an owner event reaches the browser copy too', raid.status === 200 && mine.log.some((e) => e.k === 'raid' && e.t === raid.body.at) && colonyHash(mine) === colonyHash(deserialize((await get<{ colony: string }>(host2, 'snapshot')).colony)));
const before = await get<State>(host2, 'state');
const pace = await post<State & { ok: boolean }>(host2, 'admin/pace', { msPerDay: 24_000 }, { 'x-admin-key': 'key' });
check('changing the pace does not move the clock', pace.body.ok && pace.body.tick === before.tick && pace.body.msPerTick === 100);
now += 1000;
const after = await get<State>(host2, 'state');
check('and the new pace applies from then on', after.tick === before.tick + 10, `${before.tick} -> ${after.tick}`);
const wipe = await post<State & { ok: boolean }>(host2, 'admin/wipe', { confirm: 'wipe', seed: 5 }, { 'x-admin-key': 'key' });
check('wiping starts a new colony', wipe.body.ok && wipe.body.id !== before.id);
mine = deserialize((await get<{ colony: string }>(host2, 'snapshot')).colony);

// ---------- Several colonies and the region between them ----------
{
  const stores = new Map<string, Map<string, string>>();
  const kvFor = (name: string): KV => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    const mm = m;
    return { get: async (k) => mm.get(k), put: async (k, v) => void mm.set(k, v) };
  };
  const mk = (): LocalWorld => new LocalWorld(kvFor, null, {
    host: { msPerDay: 240, maxStep: 4000, pop: 66, preDays: 2, adminKey: 'key', now: () => now },
    region: { seed: 21, colonies: 2, pop: 66, preDays: 2, now: () => now },
  });
  let world = mk();
  const call = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
    await world.advance();
    const r = await world.handle(new Request('http://x/api/hl/' + path, init));
    const text = r.headers.get('x-gz') === '1' ? await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : await r.text();
    return { status: r.status, body: JSON.parse(text) as T };
  };
  interface Region { sites: { id: string; name: string; pop: number; from?: string; founded: number }[] }
  const r0 = await call<Region>('region');
  check('the region starts with its first colonies', r0.body.sites.length === 2 && r0.body.sites.every((s) => s.name && s.pop > 0), r0.body.sites.map((s) => `${s.name} ${s.pop}`).join(', '));
  const st = await call<State & { name: string }>(`c/${r0.body.sites[1].id}/state`);
  check('each colony answers under its own path', st.status === 200 && st.body.name === r0.body.sites[1].name);
  check('a colony that does not exist says so', (await call('c/zz/state')).status === 404);
  const sneak = await call('region/deliver', { method: 'POST', body: JSON.stringify({ from: r0.body.sites[0].id, msgs: [], pop: 0, tick: 0 }) });
  check('outsiders cannot speak for a colony', sneak.status === 403);

  const j1 = await call<{ ok?: boolean; error?: string }>(`c/${r0.body.sites[0].id}/join`, { method: 'POST', body: JSON.stringify({ f: ME, spec }) });
  const j2 = await call<{ ok?: boolean; error?: string }>(`c/${r0.body.sites[1].id}/join`, { method: 'POST', body: JSON.stringify({ f: ME, spec }) });
  check('one colonist per player in the whole land', j1.status === 200 && j2.status === 409, j2.body.error);

  // let the years pass until someone leads a party out
  let sites = r0.body.sites;
  for (let k = 0; k < 150 && sites.length === 2; k++) {
    now += 4000;
    sites = (await call<Region>('region')).body.sites;
  }
  const made = sites[2];
  check('a crowded colony sends out settlers who found a new one', !!made && !!made.from && made.pop >= 5, made ? `${made.name}, ${made.pop} settlers from ${sites.find((s) => s.id === made.from)?.name}` : `nobody left in 600 days (${sites.map((s) => `${s.name} ${s.pop}`).join(', ')})`);
  if (made) {
    const snap = await call<{ colony: string; tick: number }>(`c/${made.id}/snapshot`);
    const child = deserialize(snap.body.colony);
    check('the new colony is a real place with a ruler and a first roof', child.pawns.length >= 5 && child.blds.length >= 3 && child.pawns.some((p) => p.id === child.gov.ruler) && child.from === made.from);
    const parent = deserialize((await call<{ colony: string }>(`c/${made.from}/snapshot`)).body.colony);
    // look in on the old home every couple of seconds: a big colony's log is long, and older
    // entries drop off the front of it, so one look much later might miss the news
    const seen = [...parent.log];
    for (let k = 0; k < 10; k++) {
      now += 2 * 1000;
      seen.push(...deserialize((await call<{ colony: string }>(`c/${made.from}/snapshot`)).body.colony).log);
    }
    check('and word of it reaches the old home', seen.some((e) => e.k === 'news') && parent.dead.some((d) => d.cause === 'settled'));
    // everything survives a restart
    world = mk();
    const again = (await call<Region>('region')).body.sites;
    const child2 = (await call<State>(`c/${made.id}/state`)).body;
    check('the whole world carries on after a restart', again.length >= sites.length && again.some((x) => x.id === made.id) && child2.tick >= snap.body.tick, `${again.length} colonies, tick ${child2.tick} (was ${snap.body.tick})`);
  }
}

// ---------- Starting the whole world over ----------
{
  const stores = new Map<string, Map<string, string>>();
  const kvFor = (name: string): KV => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    const mm = m;
    return { get: async (k) => mm.get(k), put: async (k, v) => void mm.set(k, v) };
  };
  const world = new LocalWorld(kvFor, null, {
    host: { msPerDay: 240_000, maxStep: 4000, pop: 14, preDays: 1, adminKey: 'key', now: () => now },
    region: { seed: 31, colonies: 2, pop: 14, preDays: 1, now: () => now, adminKey: 'key' },
  });
  const call = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
    await world.advance();
    const r = await world.handle(new Request('http://x/api/hl/' + path, init));
    return { status: r.status, body: (await r.json()) as T };
  };
  interface Region { seed: number; sites: { id: string; name: string }[] }
  const before = (await call<Region>('region')).body;
  const deny = await call('region/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'wipe' }) });
  check('only the owner can start the world over', deny.status === 403);
  const wipe = await call<{ ok: boolean; retired: number }>('region/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'wipe', seed: 99 }), headers: { 'x-admin-key': 'key' } });
  const after = (await call<Region>('region')).body;
  const gone = await call(`c/${before.sites[0].id}/state`);
  check('starting over retires the old colonies and makes new ones', wipe.body.ok && wipe.body.retired === 2 && after.seed === 99 && after.sites.length === 2 && !after.sites.some((s) => before.sites.some((b) => b.id === s.id)) && gone.status === 404, after.sites.map((s) => s.name).join(', '));
}

// ---------- A world whose creation is cut short ----------
{
  const stores = new Map<string, Map<string, string>>();
  const kvFor = (name: string): KV => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    const mm = m;
    return { get: async (k) => mm.get(k), put: async (k, v) => void mm.set(k, v) };
  };
  const hosts = new Map<string, ColonyHost>();
  const hostOpts = { msPerDay: 240_000, maxStep: 4000, pop: 12, preDays: 1, managed: true, now: () => now };
  let failOn = '';
  // the region's line to each colony; it breaks once, after the colony has been made but before
  // the region hears back (as when the worker runs out of time part way)
  const link = async (id: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    let h = hosts.get(id);
    if (!h) { h = new ColonyHost(kvFor('c_' + id), null, hostOpts); hosts.set(id, h); }
    const r = (await (await h.handle(new Request(`http://x/api/hl/c/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }), true)).json()) as Record<string, unknown>;
    if (failOn && id.endsWith(failOn)) { failOn = ''; throw new Error('out of time'); }
    return r;
  };
  const ropts = { seed: 41, colonies: 4, pop: 12, preDays: 1, now: () => now };
  interface Region { sites: { id: string; name: string }[] }
  const look = async (r: RegionHost): Promise<Region> => (await (await r.handle(new Request('http://x/api/hl/region'), false)).json()) as Region;

  // the same keeper is asked again
  failOn = 'c2';
  const r1 = new RegionHost(kvFor('region'), ropts, link);
  const first = await look(r1).then(() => 'answered', (e) => String(e));
  const part = JSON.parse(stores.get('region')!.get('world')!) as { sites: unknown[]; n: number };
  check('a world cut short keeps what it made and how many it meant to make', first.includes('out of time') && part.sites.length === 2 && part.n === 4, `${part.sites.length} of ${part.n}`);
  const [a, b] = await Promise.all([look(r1), look(r1)]);
  const names = a.sites.map((s) => s.name);
  check('the next request finishes the world, and nobody sees half of it', a.sites.length === 4 && b.sites.length === 4 && new Set(names).size === 4 && new Set(a.sites.map((s) => s.id)).size === 4, names.join(', '));

  // a fresh keeper (the Durable Object restarted) finishes a world left half made
  stores.clear();
  hosts.clear();
  failOn = 'c1';
  const r2 = new RegionHost(kvFor('region'), ropts, link);
  await look(r2).catch(() => undefined);
  const r3 = new RegionHost(kvFor('region'), ropts, link);
  const done = await look(r3);
  check('a restarted keeper finishes a world left half made', done.sites.length === 4 && new Set(done.sites.map((s) => s.name)).size === 4 && done.sites.every((s, k) => s.id.endsWith('c' + k)), done.sites.map((s) => s.name).join(', '));
}

// ---------- Neighbours: pacts kept by the region, lived by the colonies, replayed by a browser ----------
{
  const stores = new Map<string, Map<string, string>>();
  const kvFor = (name: string): KV => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    const mm = m;
    return { get: async (k) => mm.get(k), put: async (k, v) => void mm.set(k, v) };
  };
  const t00 = now;
  const world = new LocalWorld(kvFor, null, {
    host: { msPerDay: 240_000, maxStep: 4000, pop: 30, preDays: 2, now: () => now },
    region: { seed: 53, colonies: 3, pop: 30, preDays: 2, now: () => now },
  });
  const call = async <T>(path: string): Promise<T> => {
    await world.advance();
    const r = await world.handle(new Request('http://x/api/hl/' + path));
    const text = r.headers.get('x-gz') === '1' ? await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : await r.text();
    return JSON.parse(text) as T;
  };
  interface Tie { trade?: number; ally?: number; kin?: number; trib?: string }
  interface Region { sites: { id: string; name: string; st?: unknown }[]; ties: Record<string, Tie>; trips: { a: string; b: string; k: string }[] }
  const r0 = await call<Region>('region');
  const ids = r0.sites.map((s) => s.id);
  // a browser watching one colony from the start
  const snap0 = await call<State & { colony: string }>(`c/${ids[1]}/snapshot`);
  const copy = deserialize(snap0.colony);
  let cseq = snap0.seq;
  let trips = 0;
  let pactInputs = 0;
  let drift = 0;
  for (let k = 0; k < 135; k++) {
    now += 1000 * 80;
    const st = await call<State>(`c/${ids[1]}/sync?seq=${cseq}`);
    for (const i of st.inputs ?? []) { const { seq: _s, ...input } = i; void _s; copy.inq.push(input as Input); cseq = Math.max(cseq, i.seq); if (i.k === 'pact' || i.k === 'caravan' || i.k === 'envoy') pactInputs++; }
    while (copy.tick < st.tick) step(copy);
    for (const [t, h] of st.checks) if (t === copy.tick && h !== colonyHash(copy)) drift++;
    if (k % 10 === 9) trips = Math.max(trips, (await call<Region>('region')).trips.length);
  }
  const r1 = await call<Region>('region');
  const keys = Object.keys(r1.ties);
  check('the region keeps how neighbours stand, and does not tell the world what colonies report of themselves', keys.length > 0 && r1.sites.every((s) => s.st === undefined), `${keys.length} ties: ${keys.map((key) => key + ' ' + Object.keys(r1.ties[key]).filter((f) => f === 'trade' || f === 'ally' || f === 'kin' || f === 'trib').join('+')).join(', ')}`);
  check('travellers between colonies are on the map', trips > 0, `${trips} on the roads at once`);
  const live = new Map<string, Colony>();
  for (const id of ids) live.set(id, deserialize((await call<{ colony: string }>(`c/${id}/snapshot`)).colony));
  let agree = true;
  for (const key of keys) {
    const [a, b] = key.split('|');
    const ta = live.get(a)?.nb?.ties[b];
    const tb = live.get(b)?.nb?.ties[a];
    for (const f of ['trade', 'ally', 'kin'] as const) if ((r1.ties[key][f] !== undefined) !== (ta?.[f] !== undefined) || (ta?.[f] !== undefined) !== (tb?.[f] !== undefined)) agree = false;
  }
  check('both ends of every tie agree with the region', agree);
  const st = await call<State>(`c/${ids[1]}/sync?seq=${cseq}`);
  for (const i of st.inputs ?? []) { const { seq: _s, ...input } = i; void _s; copy.inq.push(input as Input); }
  while (copy.tick < st.tick) step(copy);
  const now0 = deserialize((await call<{ colony: string }>(`c/${ids[1]}/snapshot`)).colony);
  check('a browser replaying a colony with neighbours stays identical', drift === 0 && colonyHash(copy) === colonyHash(now0) && pactInputs > 0, `tick ${copy.tick}, ${pactInputs} inputs from neighbours, ${drift} drifts, ${Math.round((now - t00) / 240_000)} days`);
}

// ---------- A long sleep archives every event ----------
{
  const events = new Map<number, string>();
  let biggest = 0;
  const stmt = (sql: string, vals: unknown[] = []): D1Stmt => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T>() => ({ n: 0 }) as T,
    all: async <T>() => ({ results: [] as T[] }),
    run: async () => undefined,
    sql, vals,
  } as D1Stmt);
  const db: D1 = {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      for (const st of list as (D1Stmt & { sql: string; vals: unknown[] })[]) if (st.sql.includes('INTO hl_events')) events.set(Number(st.vals[1]), String(st.vals[3]));
      return [];
    },
  };
  const m2 = new Map<string, string>();
  const h = new ColonyHost({ get: async (k) => m2.get(k), put: async (k, v) => void m2.set(k, v) }, db, { ...opts, maxStep: 3000, pop: 40, preDays: 1, seed: 7 });
  await h.advance();
  const start = deserialize((await get<{ colony: string }>(h, 'snapshot')).colony);
  const from = start.logBase + start.log.length;
  for (let k = 0; k < 4; k++) {
    now += 1000 * 3000;
    const had = events.size;
    await h.advance();
    biggest = Math.max(biggest, events.size - had);
  }
  const live = deserialize((await get<{ colony: string }>(h, 'snapshot')).colony);
  const end = live.logBase + live.log.length;
  let missing = 0;
  for (let id = from; id < end; id++) if (!events.has(id)) missing++;
  check('a long catch-up archives every event', missing === 0 && end - from > 0, `${end - from} events, ${missing} missing, up to ${biggest} in one catch-up`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
if (failed) process.exit(1);
