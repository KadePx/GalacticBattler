// Cloudflare Worker hosting the live Commonworld. All the logic is in WorldHost
// (src/commonworld/server/host.ts); this file only connects it to Durable Object storage,
// alarms and the D1 binding.

import { DurableObject } from 'cloudflare:workers';
import { WorldHost } from '../../src/commonworld/server/host';
import type { D1 } from '../../src/net/db';

interface Env {
  WORLD: DurableObjectNamespace;
  DB: D1;
  CW_MS_PER_TICK?: string;
  CW_ADMIN_KEY?: string;
}
// Minimal shapes of the runtime types we use (avoids a types dependency).
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void> }

export class WorldDO extends DurableObject<Env> {
  private host: WorldHost;

  constructor(ctx: { storage: Storage }, env: Env) {
    super(ctx as never, env);
    const storage = ctx.storage;
    this.host = new WorldHost(
      { get: (k) => storage.get<string>(k), put: (k, v) => storage.put(k, v) },
      env.DB,
      { msPerTick: Number(env.CW_MS_PER_TICK) || 300_000, maxStep: 240, civs: 20, adminKey: env.CW_ADMIN_KEY, now: Date.now },
    );
  }

  private get store(): Storage {
    return (this as unknown as { ctx: { storage: Storage } }).ctx.storage;
  }

  /** Catch up, then make sure an alarm will wake us for the next month. */
  private async tick(): Promise<void> {
    await this.host.advance();
    const next = this.host.nextTickAt();
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
    return env.WORLD.get(env.WORLD.idFromName('main')).fetch(req);
  },
};
