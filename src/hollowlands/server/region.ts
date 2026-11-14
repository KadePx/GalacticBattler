// The keeper of the land between colonies. It knows where every colony is, starts the first
// few, and when a settler party walks out of one it finds them a place and starts a new one.
// Each colony has its own keeper (host.ts); this one only passes things between them.

import { colonySeed, pickSpot, type Site } from '../sim/world';
import type { SettlerMsg } from '../sim/settle';
import type { KV } from './host';
import { landThreat, nearLists, routeMsg, ruinFor, type Delivery } from '../sim/routes';

export interface RegionOpts { seed?: number; colonies: number; pop: number; preDays: number; now: () => number }

/** What the region knows about a colony at a glance (kept fresh by the colony's own reports). */
export interface SiteInfo extends Site { pop: number; ruler?: string; tick?: number; owners?: string[] }
interface WorldRec { seed: number; count: number; sites: SiteInfo[]; created: number; day?: number; lastThreat?: number }

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
  private async deliver(body: { from: string; msgs: { k: string }[]; pop: number; ruler?: string; tick: number; name?: string; owners?: string[] }): Promise<void> {
    const w = this.w!;
    const site = w.sites.find((s) => s.id === body.from);
    if (site) {
      site.pop = body.pop;
      site.ruler = body.ruler;
      site.tick = body.tick;
      site.owners = body.owners ?? [];
      if (!body.pop && !site.dead) site.dead = body.tick;
    }
    const send = async (list: Delivery[]): Promise<void> => {
      for (const d of list) await this.link(d.to, 'input', d.input).catch(() => undefined);
    };
    for (const m of body.msgs ?? []) {
      if (m.k !== 'settlers') { await send(routeMsg(w.sites, body.from, body.name ?? site?.name ?? '', m as unknown as Record<string, unknown>)); continue; }
      const msg = m as unknown as SettlerMsg;
      const id = (w.seed % 46656).toString(36) + 'c' + w.count; // unique to this world, so archives never mix
      const ruin = ruinFor(w.seed, w.sites, site, w.count);
      const cs = ruin?.seed ?? colonySeed(w.seed, w.count);
      const [x, y] = ruin ? [ruin.x, ruin.y] : pickSpot(w.seed, w.sites, site, w.count);
      const made = await this.link(id, 'init', { seed: cs, id, settlers: msg, avoid: w.sites.map((s) => s.name), ruinsOf: ruin?.name });
      const name = String(made.name ?? id);
      w.sites.push({ id, name, x, y, founded: msg.t, from: msg.from, seed: cs, pop: msg.pawns.length, ruins: ruin?.name });
      w.count++;
      await this.save();
      await this.link(msg.from, 'input', { k: 'news', what: 'founded', name });
    }
    // once a game day (by whichever colony reports first): neighbours, and the wider land
    const day = Math.floor(body.tick / 240);
    if (day > (w.day ?? 0)) {
      w.day = day;
      await send(nearLists(w.sites));
      await send(landThreat(w.seed, day, w.sites, w));
    }
    await this.save();
  }

  async handle(req: Request, internal: boolean): Promise<Response> {
    await this.load();
    const path = new URL(req.url).pathname.replace(/^.*\/api\/hl\/region\/?/, '');
    if (req.method === 'GET' && path === '') {
      // with ?me=<public hash>, also say which colony that player's colonist lives in
      const me = new URL(req.url).searchParams.get('me') ?? '';
      const mine = me ? this.w!.sites.find((s) => !s.dead && s.owners?.includes(me))?.id : undefined;
      return json({ seed: this.w!.seed, sites: this.w!.sites.map((s) => ({ ...s, owners: undefined, nearSent: undefined })), mine, now: this.o.now() });
    }
    if (req.method === 'POST' && path === 'claim') {
      // one living colonist per player in the whole land
      if (!internal) return json({ error: 'forbidden' }, 403);
      const b = (await req.json()) as { owner: string; colony: string };
      const other = this.w!.sites.find((s) => s.id !== b.colony && !s.dead && s.owners?.includes(b.owner));
      if (other) return json({ where: other.name });
      const mine = this.w!.sites.find((s) => s.id === b.colony);
      if (mine) { (mine.owners ??= []).push(b.owner); await this.save(); }
      return json({ where: '' });
    }
    if (req.method === 'POST' && path === 'deliver') {
      if (!internal) return json({ error: 'forbidden' }, 403);
      await this.deliver((await req.json()) as never);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}
