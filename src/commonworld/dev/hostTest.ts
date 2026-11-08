// End-to-end test of the world host with a fake clock, an in-memory key-value store and SQLite
// standing in for D1. Run: npm run world:host
//
// Checks: the world advances with time; a client built from static + snapshot stays in step
// by replaying synced inputs (same state hash); a restarted host resumes identically from
// storage; history endpoints return data; the admin wipe archives and starts a new world.

import { foundingSpots } from '../sim/civ';
import { founderHash } from '../shared/text';
import { assemble, stateHash, step, type Input, type World } from '../sim/index';
import { WorldHost, type KV } from '../server/host';
import type { D1 } from '../../net/db';

declare const process: { exit(code: number): never };

async function fakeD1(): Promise<D1> {
  const { DatabaseSync } = (await import('node:' + 'sqlite')) as { DatabaseSync: new (f: string) => { prepare(s: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown } } };
  const db = new DatabaseSync(':memory:');
  class Stmt {
    constructor(private sql: string, private params: unknown[] = []) {}
    bind(...v: unknown[]) { return new Stmt(this.sql, v); }
    async first<T>() { return (db.prepare(this.sql).get(...this.params) as T) ?? null; }
    async all<T>() { return { results: db.prepare(this.sql).all(...this.params) as T[] }; }
    async run() { return db.prepare(this.sql).run(...this.params); }
  }
  return { prepare: (s: string) => new Stmt(s), batch: async (st: unknown[]) => Promise.all((st as Stmt[]).map((x) => x.run())) } as unknown as D1;
}

function memKV(): KV & { size(): number } {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, size: () => [...m.values()].reduce((a, v) => a + v.length, 0) };
}

const MS = 300_000;
let clock = Date.UTC(2026, 10, 8);
const opts = { msPerTick: MS, maxStep: 240, civs: 20, adminKey: 'secret', now: () => clock };
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};

async function get(host: WorldHost, path: string, init?: RequestInit): Promise<Response> {
  return host.handle(new Request(`http://x/api/cw/${path}`, init));
}
async function gunzip(r: Response): Promise<string> {
  const s = r.body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}
async function passYears(host: WorldHost, years: number): Promise<void> {
  for (let k = 0; k < years * 12; k += 240) {
    clock += Math.min(240, years * 12 - k) * MS;
    await host.advance();
  }
}

async function main(): Promise<void> {
  const db = await fakeD1();
  const kv = memKV();
  const host = new WorldHost(kv, db, opts);
  await host.advance(); // the world is born now

  await passYears(host, 50);
  const st = await (await get(host, 'state')).json() as { world: string; tick: number; hash: string };
  check(st.tick === 600, `world advanced 50 years with the clock (tick ${st.tick})`);

  // A client joins: terrain + snapshot.
  const client: World = assemble(await gunzip(await get(host, 'static')), await gunzip(await get(host, 'snapshot')));
  check(stateHash(client) === st.hash, 'client built from static + snapshot matches the server');

  // Founding through the public endpoint.
  const spots = foundingSpots(client, 5);
  check(spots.length >= 3, `founding screen would offer ${spots.length} homelands`);
  const myId = 'test-founder-0123456789abcdef';
  const body = (extra: Record<string, unknown>) => JSON.stringify({ id: myId, tile: spots[0], values: ['curious', 'devout', 'seafaring'], name: 'Testari', capital: 'Firsthome', motto: 'We came by sea.', byName: 'Kade', banner: [200, 0, 1, 3, 2], ...extra });
  const post = (b: string) => get(host, 'found', { method: 'POST', body: b, headers: { 'content-type': 'application/json' } });
  check((await post(body({ name: 'Fuckland' }))).status === 400, 'a rude people name is refused');
  check((await post(body({ values: ['curious', 'curious', 'devout'] }))).status === 400, 'three distinct values are required');
  check((await post(body({ tile: 0 }))).status === 409, 'founding in the sea is refused');
  const ok = await post(body({}));
  check(ok.status === 200, `founding accepted (${ok.status})`);
  check((await post(body({ tile: spots[1] }))).status === 409, 'a second founding by the same person is refused');
  const me = await founderHash(myId);
  check(((await (await get(host, `me?f=${me}`)).json()) as { status: string }).status === 'pending', 'status is pending before the next month');
  for (let k = 0; k < 2; k++) check((await post(JSON.stringify({ ...JSON.parse(body({ tile: spots[2 + k] ?? spots[2] })), id: `other-founder-${k}-0123456789` }))).status !== 429, `founding ${k + 2} from one network is allowed`);
  check((await post(JSON.stringify({ ...JSON.parse(body({ tile: spots[4] ?? spots[2] })), id: 'other-founder-9-0123456789' }))).status === 429, 'a fourth founding from one network in a day is refused');
  await passYears(host, 30);
  const meNow = (await (await get(host, `me?f=${me}`)).json()) as { status: string; civ: number };
  check(meNow.status === 'founded', `status is founded after the month turns (civ ${meNow.civ})`);

  // The client syncs: replays inputs at their ticks and steps to the server's tick.
  const sync = await (await get(host, `sync?world=${st.world}&tick=${client.tick}`)).json() as { tick: number; hash: string; inputs: [number, Input][] };
  check(sync.inputs.length >= 1, `sync returned the founding inputs (${sync.inputs.length})`);
  const t0 = Date.now();
  while (client.tick < sync.tick) step(client, sync.inputs.filter(([t]) => t === client.tick).map(([, i]) => i));
  check(stateHash(client) === sync.hash, `client replay of 30 years matches server hash (${Date.now() - t0} ms)`);
  const mine = client.civs.find((c) => c.founder === me);
  check(!!mine && mine.name === 'Testari' && client.setts[mine.capital].name === 'Firsthome' && mine.hue === 200, 'founded civ has the chosen name, capital and colour');
  check(!!mine && mine.protectedUntil > 600 && mine.byName === 'Kade' && !JSON.stringify(client).includes(myId), 'protected, credited, and the private id never enters the world');

  // History endpoints.
  const ev = await (await get(host, 'events?limit=50')).json() as { events: { id: number }[] };
  check(ev.events.length === 50 && ev.events[0].id > ev.events[1].id, `events endpoint pages newest first (top id ${ev.events[0]?.id})`);
  const yrs = await (await get(host, 'years?from=0&to=100')).json() as { years: { year: number; frame: string | null }[] };
  check(yrs.years.length === 81 && yrs.years.filter((y) => y.frame).length === 41, `years endpoint: ${yrs.years.length} years, ${yrs.years.filter((y) => y.frame).length} frames`);
  const civEv = await (await get(host, 'events?civ=0&limit=20')).json() as { events: { a?: number; b?: number }[] };
  check(civEv.events.every((e) => e.a === 0 || e.b === 0), 'events can be filtered by civ');

  // Restart: a new host on the same storage resumes the same world.
  const host2 = new WorldHost(kv, db, opts);
  const st2 = await (await get(host2, 'state')).json() as { tick: number; hash: string; world: string };
  check(st2.world === st.world && st2.hash === sync.hash, 'restarted host resumed the same world');
  await passYears(host2, 10);
  await passYears(host, 0);
  while (client.tick < 90 * 12) step(client, []);
  const st3 = await (await get(host2, 'state')).json() as { hash: string };
  check(st3.hash === stateHash(client), 'restarted host keeps stepping identically');

  // Catch-up after downtime: 100 years pass with no requests, then one alarm.
  clock += 100 * 12 * MS;
  let calls = 0;
  while ((await host2.advance()) > 0) calls++;
  const st4 = await (await get(host2, 'state')).json() as { tick: number };
  check(st4.tick === 190 * 12, `caught up 100 years of downtime in ${calls} steps`);
  console.log(`     live storage ${(kv.size() / 1024).toFixed(0)} KB`);

  // Speed change: a host with a faster clock keeps the month, then runs faster.
  const fast = new WorldHost(kv, db, { ...opts, msPerTick: MS / 5 });
  const before = (await (await get(host2, 'state')).json()) as { tick: number };
  const after = (await (await get(fast, 'state')).json()) as { tick: number; next: number; now: number };
  check(after.tick === before.tick, `changing speed keeps the month (${before.tick} -> ${after.tick})`);
  check(after.next - after.now <= MS / 5, 'the next month comes at the new speed');
  clock += 10 * (MS / 5);
  await fast.advance();
  const later = (await (await get(fast, 'state')).json()) as { tick: number };
  check(later.tick === before.tick + 10, `ten fast months later: +${later.tick - before.tick}`);

  // Admin.
  const denied = await get(fast, 'admin/wipe', { method: 'POST' });
  check(denied.status === 403, 'wipe without key is refused');
  const wipe = await (await get(fast, 'admin/wipe', { method: 'POST', headers: { 'x-admin-key': 'secret' }, body: JSON.stringify({ seed: 77 }) })).json() as { ok: boolean; world: string };
  const st5 = await (await get(fast, 'state')).json() as { world: string; tick: number };
  check(wipe.ok && st5.world !== st.world && st5.tick === 0, `wipe started a new world (${st5.world})`);
  const arch = await db.prepare("SELECT COUNT(*) AS n FROM cw_snaps WHERE kind = 'archive'").first<{ n: number }>();
  check((arch?.n ?? 0) === 1, 'old world archived before the wipe');

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  if (fails) process.exit(1);
}

main();
