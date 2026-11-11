// End-to-end checks for the colony keeper, with a fake clock and in-memory storage.
//   npm run hl:host

import { TICKS_PER_DAY } from '../config';
import { ColonyHost, LEAD, type KV } from '../server/host';
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
  if (r.headers.get('content-encoding') === 'gzip') {
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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
if (failed) process.exit(1);
