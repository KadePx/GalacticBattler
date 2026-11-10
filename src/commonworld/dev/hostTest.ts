// End-to-end test of the world host with a fake clock, an in-memory key-value store and SQLite
// standing in for D1. Run: npm run world:host
//
// Checks: the world advances with time; a client built from static + snapshot stays in step
// by replaying synced inputs (same state hash); a restarted host resumes identically from
// storage; history endpoints return data; the admin wipe archives and starts a new world.

import { canFoundAt, foundingSpots } from '../sim/civ';
import { forWithin, hexDist } from '../sim/hex';
import { founderHash } from '../shared/text';
import { assemble, createWorld, stateHash, step, type Input, type World } from '../sim/index';
import { influence, nameable } from '../sim/player';
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

  // Founder actions (milestone 6).
  const staticText = await gunzip(await get(host, 'static'));
  const live = async () => assemble(staticText, await gunzip(await get(host, 'snapshot')));
  const act = (a: Record<string, unknown>, id = myId) => get(host, 'act', { method: 'POST', body: JSON.stringify({ id, act: a }), headers: { 'content-type': 'application/json' } });
  const month = async () => { clock += MS; await host.advance(); };
  let lw = await live();
  let mineNow = lw.civs.find((c) => c.founder === me)!;
  const inf0 = influence(lw, mineNow);
  check((await act({ k: 'edict', edict: 'conquer' })).status === 400, 'an unknown edict is refused');
  check((await act({ k: 'edict', edict: 'research' })).status === 200, `edict accepted (influence ${inf0.toFixed(2)})`);
  check((await act({ k: 'edict', edict: 'grow' })).status === 409, 'a second edict without the influence is refused');
  check((await act({ k: 'edict', edict: 'grow' }, 'nobody-has-this-id-0123')).status === 403, 'someone without a people cannot act');
  await month();
  lw = await live();
  mineNow = lw.civs.find((c) => c.founder === me)!;
  check(mineNow.edict === 'research' && influence(lw, mineNow) < inf0 - 1.9, `edict applied, influence now ${influence(lw, mineNow).toFixed(2)}`);
  const pilgrim = 'pilgrim-0123456789abcdef';
  const offer = (s: number, id = pilgrim) => get(host, 'offer', { method: 'POST', body: JSON.stringify({ id, s }), headers: { 'content-type': 'application/json' } });
  check((await offer(mineNow.capital)).status === 200, 'a pilgrim leaves an offering');
  check((await offer(mineNow.capital)).status === 429, 'one offering a day');
  check((await offer(mineNow.capital, myId)).status === 403, 'founders cannot leave offerings');
  await month();
  lw = await live();
  check(lw.setts[lw.civs.find((c) => c.founder === me)!.capital].offers === 1, 'the offering is counted at the town');
  // Time passes: influence refills, and sooner or later the people await a sign.
  for (let y = 0; y < 300 && !lw.omens.some((o) => o.civ === mineNow.id); y += 10) {
    await passYears(host, 10);
    lw = await live();
  }
  mineNow = lw.civs.find((c) => c.founder === me)!;
  const om = lw.omens.find((o) => o.civ === mineNow.id);
  check(!!om, `an omen came for the founder (${om?.k})`);
  if (om) {
    check((await act({ k: 'omen', id: om.id, pick: 9 })).status === 409, 'an impossible answer is refused');
    check((await act({ k: 'omen', id: om.id, pick: 0 })).status === 200, 'the founder answers the omen');
    await month();
    lw = await live();
    check(!lw.omens.some((o) => o.id === om.id), 'the omen is settled');
  }
  mineNow = lw.civs.find((c) => c.founder === me)!;
  const young = lw.setts.find((s) => nameable(lw, mineNow, 'sett', s.id));
  if (young) {
    check((await act({ k: 'name', what: 'sett', id: young.id, name: 'Shitville' })).status === 400, 'a rude name is refused');
    check((await act({ k: 'name', what: 'sett', id: young.id, name: 'new haven' })).status === 200, `naming ${young.name}`);
    await month();
    lw = await live();
    check(lw.setts[young.id].name === 'New Haven' && lw.setts[young.id].pn === 1, 'the town has its new name');
  } else {
    check((await act({ k: 'name', what: 'sett', id: mineNow.capital, name: 'Old Haven' })).status === 409, 'an old town cannot be renamed');
  }
  const friend = mineNow.contacts.find((k) => lw.civs[k].died < 0 && lw.rels.find((r) => (r.a === k || r.b === k) && (r.a === mineNow.id || r.b === mineNow.id))?.st !== 'war');
  if (friend !== undefined && influence(lw, mineNow) >= 2) {
    const before = lw.rels.find((r) => (r.a === friend || r.b === friend) && (r.a === mineNow.id || r.b === mineNow.id))!.op;
    check((await act({ k: 'gift', to: friend })).status === 200, 'a gift caravan sets out');
    await month();
    lw = await live();
    const after = lw.rels.find((r) => (r.a === friend || r.b === friend) && (r.a === mineNow.id || r.b === mineNow.id))!.op;
    check(after > before, `the gift warmed relations (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  }
  // The client replays every founder action identically.
  const sync2 = await (await get(host, `sync?world=${st.world}&tick=${client.tick}`)).json() as { tick: number; hash: string; inputs: [number, Input][] };
  while (client.tick < sync2.tick) step(client, sync2.inputs.filter(([t]) => t === client.tick).map(([, i]) => i));
  check(stateHash(client) === sync2.hash, `client replay of founder actions matches the server (${sync2.inputs.length} inputs)`);

  // History endpoints.
  const ev = await (await get(host, 'events?limit=50')).json() as { events: { id: number }[] };
  check(ev.events.length === 50 && ev.events[0].id > ev.events[1].id, `events endpoint pages newest first (top id ${ev.events[0]?.id})`);
  const yrs = await (await get(host, 'years?from=0&to=100')).json() as { years: { year: number; frame: string | null }[] };
  const nowYear = Math.floor(((await (await get(host, 'state')).json()) as { tick: number }).tick / 12);
  const want = Math.min(100, nowYear) + 1;
  check(yrs.years.length === want && yrs.years.filter((y) => y.frame).length === Math.ceil(want / 2), `years endpoint: ${yrs.years.length} years, ${yrs.years.filter((y) => y.frame).length} frames`);
  const civEv = await (await get(host, 'events?civ=0&limit=20')).json() as { events: { a?: number; b?: number }[] };
  check(civEv.events.every((e) => e.a === 0 || e.b === 0), 'events can be filtered by civ');

  // Restart: a new host on the same storage resumes the same world.
  const hashBefore = ((await (await get(host, 'state')).json()) as { hash: string }).hash;
  const host2 = new WorldHost(kv, db, opts);
  const st2 = await (await get(host2, 'state')).json() as { tick: number; hash: string; world: string };
  check(st2.world === st.world && st2.hash === hashBefore, 'restarted host resumed the same world');
  await passYears(host2, 10);
  await passYears(host, 0);
  const sync3 = await (await get(host2, `sync?world=${st.world}&tick=${client.tick}`)).json() as { tick: number; inputs: [number, Input][] };
  while (client.tick < sync3.tick) step(client, sync3.inputs.filter(([t]) => t === client.tick).map(([, i]) => i));
  const st3 = await (await get(host2, 'state')).json() as { hash: string };
  check(st3.hash === stateHash(client), 'restarted host keeps stepping identically');

  // Catch-up after downtime: 100 years pass with no requests, then one alarm.
  clock += 100 * 12 * MS;
  let calls = 0;
  while ((await host2.advance()) > 0) calls++;
  const st4 = await (await get(host2, 'state')).json() as { tick: number };
  check(st4.tick === client.tick + 100 * 12, `caught up 100 years of downtime in ${calls} steps`);
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

  // The next world: a ballot, a pre-founding period, then a scheduled start.
  const adm = (cmd: string, b: unknown = {}) => get(fast, `admin/next/${cmd}`, { method: 'POST', headers: { 'x-admin-key': 'secret' }, body: JSON.stringify(b) });
  const postAs = (path: string, b: unknown) => get(fast, path, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });
  const ids = ['voter-a-0123456789abcdef', 'voter-b-0123456789abcdef', 'voter-c-0123456789abcdef', 'voter-d-0123456789abcdef'];
  check((await postAs('vote', { id: ids[0], first: 0, second: 1 })).status === 409, 'no voting before a round opens');
  check((await get(fast, 'admin/next/open', { method: 'POST' })).status === 403, 'opening a round needs the key');
  const opened = await (await adm('open')).json() as { next: { seeds: number[] } };
  check(opened.next.seeds.length === 6 && new Set(opened.next.seeds).size === 6, 'a ballot of six maps opened');
  check((await postAs('vote', { id: ids[0], first: 2, second: 2 })).status === 400, 'a second pick must differ from the first');
  await postAs('vote', { id: ids[0], first: 1, second: 4 });
  await postAs('vote', { id: ids[0], first: 2, second: 4 }); // changed their mind
  await postAs('vote', { id: ids[1], first: 4, second: 2 });
  await postAs('vote', { id: ids[2], first: 4, second: -1 });
  check((await postAs('vote', { id: ids[3], first: 0, second: 1 })).status === 429, 'a fourth ballot from one network is refused');
  const nv = await (await get(fast, `next?f=${await founderHash(ids[0])}`)).json() as { phase: string; points: number[]; voters: number; mine: { first: number } };
  check(nv.phase === 'vote' && nv.voters === 3 && nv.points.join() === '0,0,3,0,5,0' && nv.mine.first === 2, `ballots tallied (${nv.points.join(' ')})`);
  const closed = await (await adm('close')).json() as { pick: number; seed: number };
  check(closed.pick === 4 && closed.seed === opened.next.seeds[4], 'closing the vote picks the map with most points');
  check((await postAs('vote', { id: ids[0], first: 1, second: 2 })).status === 409, 'no voting after it closes');

  const pw = createWorld({ seed: closed.seed, civs: 20 });
  const homes = foundingSpots(pw, 14);
  const pf = (id: string, tile: number, name: string) => postAs('prefound', { id, tile, values: ['curious', 'devout', 'seafaring'], name, capital: 'Firsthome', banner: [200, 0, 1, 3, 2] });
  check((await pf(ids[0], homes[0], 'Earlyfolk')).status === 200, 'founding ahead of the start is accepted');
  let near = -1;
  forWithin(pw.W, pw.H, homes[0], 5, (i) => { if (near < 0 && i !== homes[0] && canFoundAt(pw, i)) near = i; });
  if (near >= 0) check((await pf(ids[1], near, 'Crowders')).status === 409, 'a second homeland too close to the first is refused');
  const far = homes.find((t) => hexDist(pw.W, t, homes[0]) >= 6)!;
  check((await pf(ids[1], far, 'Farfolk')).status === 200, 'a second people founds further away');
  check((await pf(ids[0], homes[0], 'Laterfolk')).status === 200, 'a pre-founding can be changed');
  await pf(ids[2], homes.find((t) => hexDist(pw.W, t, homes[0]) >= 6 && hexDist(pw.W, t, far) >= 6)!, 'Quitters');
  await postAs('prefound/cancel', { id: ids[2] });
  const np = await (await get(fast, `next?f=${await founderHash(ids[1])}`)).json() as { phase: string; peoples: { name: string; mine: boolean }[]; startAt: number | null };
  check(np.phase === 'prep' && np.peoples.length === 2 && np.peoples.filter((x) => x.mine).length === 1 && np.startAt === null, 'two peoples wait for the new world');

  const startAt = clock + 3 * 3_600_000;
  await adm('schedule', { at: startAt });
  check(fast.nextWakeAt() <= startAt, 'the host will wake for the start');
  clock += 3_600_000;
  await fast.advance();
  const pre = await (await get(fast, 'state')).json() as { world: string; hash: string; tick: number };
  check(pre.tick > before.tick, 'the old world runs on until the start');
  const oldId = pre.world;
  clock = startAt + 5 * (MS / 5) + 10;
  while ((await fast.advance()) > 0) { /* catch up */ }
  const nw = await (await get(fast, 'state')).json() as { world: string; tick: number };
  check(nw.world !== oldId && nw.tick === 5, `the new world began at the start time (${nw.world}, month ${nw.tick})`);
  const nwWorld = assemble(await gunzip(await get(fast, 'static')), await gunzip(await get(fast, 'snapshot')));
  const fA = await founderHash(ids[0]);
  const fB = await founderHash(ids[1]);
  const ca = nwWorld.civs.find((c) => c.founder === fA);
  check(!!ca && ca.name === 'Laterfolk' && nwWorld.civs.some((c) => c.founder === fB) && !nwWorld.civs.some((c) => c.founder === (founderHash(ids[2]) as unknown)), 'pre-founded peoples arrived in the first month');
  check(nwWorld.civs.filter((c) => c.founder).every((c) => c.born === 0), 'they arrived in month zero');
  const meA = await (await get(fast, `me?f=${fA}`)).json() as { status: string };
  check(meA.status === 'founded', 'a pre-founder is told their people was founded');
  check(((await (await get(fast, 'next')).json()) as { phase: string }).phase === 'none', 'the round is over');
  const archs = await (await get(fast, 'archives')).json() as { archives: { id: string; year: number }[] };
  check(archs.archives.length === 1 && archs.archives[0].id === oldId, 'the old world is listed as an earlier world');
  const oldW = assemble(await gunzip(await get(fast, `archive/static?world=${oldId}`)), await gunzip(await get(fast, `archive/snapshot?world=${oldId}`)));
  check(stateHash(oldW) === pre.hash, 'the earlier world can be loaded as it ended');
  const oev = await (await get(fast, `events?world=${oldId}&limit=50`)).json() as { events: unknown[] };
  const oyr = await (await get(fast, `years?world=${oldId}&from=0&to=20`)).json() as { years: unknown[] };
  check(oev.events.length === 50 && oyr.years.length > 10, 'its chronicle and history are still served');
  check((await get(fast, 'archive/static?world=nope')).status === 404, 'unknown worlds are not served');

  // Admin.
  const denied = await get(fast, 'admin/wipe', { method: 'POST' });
  check(denied.status === 403, 'wipe without key is refused');
  const wipe = await (await get(fast, 'admin/wipe', { method: 'POST', headers: { 'x-admin-key': 'secret' }, body: JSON.stringify({ seed: 77 }) })).json() as { ok: boolean; world: string };
  const st5 = await (await get(fast, 'state')).json() as { world: string; tick: number };
  check(wipe.ok && st5.world !== st.world && st5.tick === 0, `wipe started a new world (${st5.world})`);
  const arch = await db.prepare("SELECT COUNT(*) AS n FROM cw_snaps WHERE kind = 'archive'").first<{ n: number }>();
  check((arch?.n ?? 0) === 2, 'old world archived before the wipe');

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  if (fails) process.exit(1);
}

main();
