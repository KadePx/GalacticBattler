// The keeper of the land between colonies. It knows where every colony is, starts the first
// few, and when a settler party walks out of one it finds them a place and starts a new one.
// Each colony has its own keeper (host.ts); this one only passes things between them.

import { colonySeed, pickSpot, startColonies, type Site } from '../sim/world';
import type { SettlerMsg } from '../sim/settle';
import type { KV } from './host';
import { bounced, landThreat, nearLists, pactsDaily, routeMsg, routePact, ruinFor, type Delivery, type Pacts, type SiteStat } from '../sim/routes';

export interface RegionOpts { seed?: number; /** colonies a new world starts with (default: 6 to 8, from the seed) */ colonies?: number; pop: number; preDays: number; now: () => number; adminKey?: string }

/** What the region knows about a colony at a glance (kept fresh by the colony's own reports). */
export interface SiteInfo extends Site { pop: number; ruler?: string; tick?: number; owners?: string[]; /** colonies this one is at war with */ wars?: string[] }
interface WorldRec { seed: number; count: number; /** colonies the world starts with; creation carries on until there are this many */ n?: number; sites: SiteInfo[]; created: number; day?: number; lastThreat?: number; /** how neighbours stand with each other, and who is on the road between them (see routes.ts) */ pacts?: Pacts }

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

  /** Make sure the world exists, finishing its creation if an earlier attempt stopped part way. */
  async load(): Promise<void> {
    if (!this.loading && this.w && this.w.sites.length >= (this.w.n ?? 0)) return;
    if (!this.loading) {
      const p: Promise<void> = this.build().finally(() => { if (this.loading === p) this.loading = null; });
      this.loading = p;
    }
    await this.loading;
  }

  private async build(): Promise<void> {
    if (!this.w) {
      const saved = await this.kv.get('world');
      if (saved) this.w = JSON.parse(saved) as WorldRec;
      else {
        const now = this.o.now();
        const seed = this.o.seed ?? ((now % 2147483647) | 1);
        this.w = { seed, count: 0, sites: [], created: now, n: this.o.colonies ?? startColonies(seed) };
        await this.save();
      }
    }
    const w = this.w;
    // one at a time and in order: each new colony avoids the names of those before it
    while (w.sites.length < (w.n ?? 0)) {
      const id = (w.seed % 46656).toString(36) + 'c' + w.count; // unique to this world, so archives never mix
      const cs = colonySeed(w.seed, w.count);
      const [x, y] = pickSpot(w.seed, w.sites, undefined, w.count);
      const made = await this.link(id, 'init', { seed: cs, id, pop: this.o.pop + (cs % 11), preDays: this.o.preDays, avoid: w.sites.map((s) => s.name) });
      w.sites.push({ id, name: String(made.name ?? id), x, y, founded: 0, seed: cs, pop: Number(made.pop) || 0 });
      w.count++;
      await this.save();
    }
  }

  /** A colony reports in, and hands over anything it has sent out into the world. */
  private async deliver(body: { from: string; msgs: { k: string }[]; pop: number; ruler?: string; tick: number; name?: string; owners?: string[]; wars?: string[]; st?: SiteStat }): Promise<void> {
    const w = this.w!;
    const site = w.sites.find((s) => s.id === body.from);
    if (site) {
      site.pop = body.pop;
      site.ruler = body.ruler;
      site.tick = body.tick;
      site.owners = body.owners ?? [];
      site.wars = body.wars ?? [];
      if (body.st) site.st = body.st;
      if (!body.pop && !site.dead) site.dead = body.tick;
    }
    const send = async (list: Delivery[]): Promise<void> => {
      for (const d of list) {
        await this.link(d.to, 'input', d.input).catch(async () => {
          // someone sent to marry who could not be handed over turns back to where they came from
          const i = d.input;
          if (i.k === 'migrant' && i.why === 'royal' && !i.back && typeof i.fromId === 'string') await this.link(i.fromId, 'input', bounced(i)).catch(() => undefined);
        });
      }
    };
    for (const m of body.msgs ?? []) {
      if (m.k !== 'settlers') {
        const list = routeMsg(w.sites, body.from, body.name ?? site?.name ?? '', m as unknown as Record<string, unknown>);
        const more = routePact(w.sites, w, body.from, body.tick, m as unknown as Record<string, unknown>, list);
        await send(list);
        await send(more);
        continue;
      }
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
      await send(pactsDaily(w.seed, day, body.tick, w.sites, w));
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
      const pacts = this.w!.pacts;
      return json({ seed: this.w!.seed, sites: this.w!.sites.map((s) => ({ ...s, owners: undefined, nearSent: undefined, st: undefined })), mine, now: this.o.now(), ties: pacts?.ties ?? {}, trips: pacts?.trips ?? [], tourney: pacts?.tn });
    }
    if (req.method === 'POST' && path === 'wipe') {
      // owner only: retire every colony, then begin a new world with new colonies
      if (!this.o.adminKey || req.headers.get('x-admin-key') !== this.o.adminKey) return json({ error: 'forbidden' }, 403);
      const b = (await req.json().catch(() => ({}))) as { confirm?: string; seed?: number };
      if (b.confirm !== 'wipe') return json({ error: 'confirm with {"confirm":"wipe"}' }, 400);
      const old = this.w!.sites.map((s) => s.id);
      for (const id of old) await this.link(id, 'retire').catch(() => undefined);
      await this.kv.put('world', '');
      this.w = null;
      this.loading = null;
      if (typeof b.seed === 'number') this.o = { ...this.o, seed: b.seed };
      else this.o = { ...this.o, seed: undefined };
      await this.load();
      return json({ ok: true, retired: old.length, seed: this.w!.seed, sites: this.w!.sites.map((s) => ({ id: s.id, name: s.name, pop: s.pop })) });
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
