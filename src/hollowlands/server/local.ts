// The whole world in one process: the region keeper and every colony keeper wired together
// directly. Used by the dev server and the tests; on Cloudflare each keeper is its own
// Durable Object and the wiring is in workers/hollowlands.

import type { D1 } from '../../net/db';
import { ColonyHost, type HostOpts, type KV } from './host';
import { RegionHost, type RegionOpts } from './region';

export interface LocalOpts { host: Omit<HostOpts, 'managed' | 'deliver'>; region: RegionOpts }

export class LocalWorld {
  private hosts = new Map<string, ColonyHost>();
  private region: RegionHost;

  constructor(private kvFor: (name: string) => KV, private db: D1 | null, private o: LocalOpts) {
    this.region = new RegionHost(kvFor('region'), o.region, async (id, path, body) => {
      const r = await this.colony(id).handle(new Request(`http://local/api/hl/c/${id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }), true);
      return (await r.json()) as Record<string, unknown>;
    });
  }

  private colony(id: string): ColonyHost {
    let h = this.hosts.get(id);
    if (!h) {
      h = new ColonyHost(this.kvFor('c_' + id), this.db, {
        ...this.o.host, managed: true,
        claim: async (owner, colony) => String(((await (await this.region.handle(new Request('http://local/api/hl/region/claim', { method: 'POST', body: JSON.stringify({ owner, colony }) }), true)).json()) as { where?: string }).where ?? ''),
        deliver: async (body) => { await this.region.handle(new Request('http://local/api/hl/region/deliver', { method: 'POST', body: JSON.stringify(body) }), true); },
      });
      this.hosts.set(id, h);
    }
    return h;
  }

  /** Advance every colony that exists. Returns ticks still owed by the furthest behind. */
  async advance(): Promise<number> {
    await this.region.load();
    const list = (await (await this.region.handle(new Request('http://local/api/hl/region'), false)).json()) as { sites: { id: string }[] };
    let owed = 0;
    for (const s of list.sites) owed = Math.max(owed, await this.colony(s.id).advance());
    return owed;
  }

  async handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    await this.region.load();
    if (/\/api\/hl\/region(\/|$)/.test(path)) return this.region.handle(req, false);
    const m = path.match(/\/api\/hl\/c\/([a-z0-9]+)\//);
    if (!m) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const h = this.colony(m[1]);
    await h.advance();
    return h.handle(req, false);
  }
}
