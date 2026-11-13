// The keeper of the land between colonies. It knows where every colony is, starts the first
// few, and when a settler party walks out of one it finds them a place and starts a new one.
// Each colony has its own keeper (host.ts); this one only passes things between them.

import { colonySeed, pickSpot, type Site } from '../sim/world';
import type { SettlerMsg } from '../sim/settle';
import type { KV } from './host';

export interface RegionOpts { seed?: number; colonies: number; pop: number; preDays: number; now: () => number }

/** What the region knows about a colony at a glance (kept fresh by the colony's own reports). */
export interface SiteInfo extends Site { pop: number; ruler?: string; tick?: number }
interface WorldRec { seed: number; count: number; sites: SiteInfo[]; created: number }

/** Call a colony's keeper: path under its own API, optional JSON body (POST). */
export type Link = (id: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class RegionHost {
  private w: WorldRec | null = null;
  private loading: Promise<void> | null = null;

  constructor(private kv: KV, private o: RegionOpts, private link: Link) {}

  private async save(): Promise<void> {
    await this.kv.put('world', JSON.stringify(this.w));
  }

  async load(): Promise<void> {
    if (this.w) return;
    this.loading ??= (async () => {
      const saved = await this.kv.get('world');
      if (saved) { this.w = JSON.parse(saved) as WorldRec; return; }
      const now = this.o.now();
      const seed = this.o.seed ?? ((now % 2147483647) | 1);
      const w: WorldRec = { seed, count: 0, sites: [], created: now };
      this.w = w;
      for (let k = 0; k < this.o.colonies; k++) {
        const id = (w.seed % 46656).toString(36) + 'c' + w.count; // unique to this world, so archives never mix
        const cs = colonySeed(seed, w.count);
        const [x, y] = pickSpot(seed, w.sites, undefined, w.count);
        const made = await this.link(id, 'init', { seed: cs, id, pop: this.o.pop + (cs % 5), preDays: this.o.preDays, avoid: w.sites.map((s) => s.name) });
        w.sites.push({ id, name: String(made.name ?? id), x, y, founded: 0, seed: cs, pop: Number(made.pop) || 0 });
        w.count++;
        await this.save();
      }
    })();
    await this.loading;
  }

  /** A colony reports in, and hands over anything it has sent out into the world. */
  private async deliver(body: { from: string; msgs: { k: string }[]; pop: number; ruler?: string; tick: number; name?: string }): Promise<void> {
    const w = this.w!;
    const site = w.sites.find((s) => s.id === body.from);
    if (site) {
      site.pop = body.pop;
      site.ruler = body.ruler;
      site.tick = body.tick;
      if (!body.pop && !site.dead) site.dead = body.tick;
    }
    const near = w.sites.filter((s) => s.id !== body.from && !s.dead && s.pop > 0)
      .sort((a, b) => (site ? Math.abs(a.x - site.x) + Math.abs(a.y - site.y) - Math.abs(b.x - site.x) - Math.abs(b.y - site.y) : 0));
    for (const m of body.msgs ?? []) {
      const raw = m as unknown as Record<string, unknown>;
      if (m.k === 'migrant' && near[0]) await this.link(near[0].id, 'input', { k: 'migrant', pawn: raw.pawn, fromName: raw.fromName, why: raw.why });
      if (m.k === 'news') for (const s of near.slice(0, 3)) await this.link(s.id, 'input', { k: 'news', what: raw.what, name: body.name ?? site?.name ?? '', who: raw.who });
      if (m.k !== 'settlers') continue;
      const msg = m as unknown as SettlerMsg;
      const id = (w.seed % 46656).toString(36) + 'c' + w.count; // unique to this world, so archives never mix
      const cs = colonySeed(w.seed, w.count);
      const [x, y] = pickSpot(w.seed, w.sites, site, w.count);
      const made = await this.link(id, 'init', { seed: cs, id, settlers: msg, avoid: w.sites.map((s) => s.name) });
      const name = String(made.name ?? id);
      w.sites.push({ id, name, x, y, founded: msg.t, from: msg.from, seed: cs, pop: msg.pawns.length });
      w.count++;
      await this.save();
      await this.link(msg.from, 'input', { k: 'news', what: 'founded', name });
    }
    await this.save();
  }

  async handle(req: Request, internal: boolean): Promise<Response> {
    await this.load();
    const path = new URL(req.url).pathname.replace(/^.*\/api\/hl\/region\/?/, '');
    if (req.method === 'GET' && path === '') return json({ seed: this.w!.seed, sites: this.w!.sites, now: this.o.now() });
    if (req.method === 'POST' && path === 'deliver') {
      if (!internal) return json({ error: 'forbidden' }, 403);
      await this.deliver((await req.json()) as never);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}
