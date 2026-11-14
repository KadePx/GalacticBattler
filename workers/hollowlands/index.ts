// Cloudflare Worker hosting the live Hollow Lands world: one Durable Object per colony and
// one for the region between them. The logic is in src/hollowlands/server (host.ts, region.ts);
// this file only connects it to Durable Object storage, alarms and the D1 binding.

import { DurableObject } from 'cloudflare:workers';
import { ColonyHost } from '../../src/hollowlands/server/host';
import { RegionHost } from '../../src/hollowlands/server/region';
import type { D1 } from '../../src/net/db';

interface Env {
  COLONY: DurableObjectNamespace;
  REGION: DurableObjectNamespace;
  DB: D1;
  HL_MS_PER_DAY?: string;
  HL_ADMIN_KEY?: string;
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_SECRET?: string;
}

async function turnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip !== 'local') body.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  return ((await r.json()) as { success?: boolean }).success === true;
}

// Minimal shapes of the runtime types we use (avoids a types dependency).
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void> }

/** Marks a request as coming from another keeper. The public entry strips it from outside requests. */
const INTERNAL = 'x-hl-internal';
const inside = (url: string, body: unknown): Request => new Request(url, { method: 'POST', body: JSON.stringify(body ?? {}), headers: { [INTERNAL]: '1' } });

export class ColonyDO extends DurableObject<Env> {
  private host: ColonyHost;

  constructor(ctx: { storage: Storage }, env: Env) {
    super(ctx as never, env);
    const storage = ctx.storage;
    this.host = new ColonyHost(
      { get: (k) => storage.get<string>(k), put: (k, v) => storage.put(k, v) },
      env.DB,
      {
        msPerDay: Number(env.HL_MS_PER_DAY) || 1_440_000, maxStep: 3000, pop: 16, preDays: 120, adminKey: env.HL_ADMIN_KEY, now: Date.now, managed: true,
        claim: async (owner, colony) => String(((await (await env.REGION.get(env.REGION.idFromName('region')).fetch(inside('https://hl/api/hl/region/claim', { owner, colony }))).json()) as { where?: string }).where ?? ''),
        humanKey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY : undefined,
        verifyHuman: env.TURNSTILE_SECRET ? (t, ip) => turnstile(env.TURNSTILE_SECRET!, t, ip) : undefined,
        deliver: async (body) => { await env.REGION.get(env.REGION.idFromName('region')).fetch(inside('https://hl/api/hl/region/deliver', body)); },
      },
    );
  }

  private get store(): Storage {
    return (this as unknown as { ctx: { storage: Storage } }).ctx.storage;
  }

  /** Catch up, then make sure an alarm will wake us again. */
  private async tick(): Promise<void> {
    const owed = await this.host.advance();
    if (!this.host.active()) return; // retired, or never started: sleep until spoken to
    const next = owed > 0 ? Date.now() + 1000 : this.host.nextWakeAt();
    const cur = await this.store.getAlarm();
    if (cur === null || cur > next || cur < Date.now()) await this.store.setAlarm(next);
  }

  async fetch(req: Request): Promise<Response> {
    await this.tick();
    const res = await this.host.handle(req, req.headers.get(INTERNAL) === '1');
    // a colony that has just been started needs its first alarm
    if (req.headers.get(INTERNAL) === '1') await this.tick();
    return res;
  }

  async alarm(): Promise<void> {
    await this.tick();
  }
}

export class RegionDO extends DurableObject<Env> {
  private host: RegionHost;

  constructor(ctx: { storage: Storage }, env: Env) {
    super(ctx as never, env);
    const storage = ctx.storage;
    this.host = new RegionHost(
      { get: (k) => storage.get<string>(k), put: (k, v) => storage.put(k, v) },
      { colonies: 4, pop: 14, preDays: 120, now: Date.now, adminKey: env.HL_ADMIN_KEY },
      async (id, path, body) => (await (await env.COLONY.get(env.COLONY.idFromName(id)).fetch(inside(`https://hl/api/hl/c/${id}/${path}`, body))).json()) as Record<string, unknown>,
    );
  }

  fetch(req: Request): Promise<Response> {
    return this.host.handle(req, req.headers.get(INTERNAL) === '1');
  }
}

/** Send a public request to the right keeper. Also used by the site's Pages function. */
export function route(req: Request, env: { COLONY: DurableObjectNamespace; REGION: DurableObjectNamespace }): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete(INTERNAL);
  const clean = new Request(req, { headers });
  const path = new URL(req.url).pathname;
  const m = path.match(/\/api\/hl\/c\/([a-z0-9]{1,12})\//);
  if (m) return env.COLONY.get(env.COLONY.idFromName(m[1])).fetch(clean);
  if (/\/api\/hl\/region(\/[a-z]+)?\/?$/.test(path)) return env.REGION.get(env.REGION.idFromName('region')).fetch(clean);
  return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return route(req, env);
  },
};
