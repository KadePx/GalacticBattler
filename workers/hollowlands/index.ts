// Cloudflare Worker hosting the live Hollow Lands colony. All the logic is in ColonyHost
// (src/hollowlands/server/host.ts); this file only connects it to Durable Object storage,
// alarms and the D1 binding.

import { DurableObject } from 'cloudflare:workers';
import { ColonyHost } from '../../src/hollowlands/server/host';
import type { D1 } from '../../src/net/db';

interface Env {
  COLONY: DurableObjectNamespace;
  DB: D1;
  HL_MS_PER_DAY?: string;
  HL_ADMIN_KEY?: string;
}

// Minimal shapes of the runtime types we use (avoids a types dependency).
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void> }

export class ColonyDO extends DurableObject<Env> {
  private host: ColonyHost;

  constructor(ctx: { storage: Storage }, env: Env) {
    super(ctx as never, env);
    const storage = ctx.storage;
    this.host = new ColonyHost(
      { get: (k) => storage.get<string>(k), put: (k, v) => storage.put(k, v) },
      env.DB,
      { msPerDay: Number(env.HL_MS_PER_DAY) || 1_440_000, maxStep: 3000, pop: 16, preDays: 120, adminKey: env.HL_ADMIN_KEY, now: Date.now },
    );
  }

  private get store(): Storage {
    return (this as unknown as { ctx: { storage: Storage } }).ctx.storage;
  }

  /** Catch up, then make sure an alarm will wake us again. */
  private async tick(): Promise<void> {
    const owed = await this.host.advance();
    const next = owed > 0 ? Date.now() + 1000 : this.host.nextWakeAt();
    const cur = await this.store.getAlarm();
    if (cur === null || cur > next || cur < Date.now()) await this.store.setAlarm(next);
  }

  async fetch(req: Request): Promise<Response> {
    await this.tick();
    return this.host.handle(req);
  }

  async alarm(): Promise<void> {
    await this.tick();
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return env.COLONY.get(env.COLONY.idFromName('main')).fetch(req);
  },
};
