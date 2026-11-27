// Household planner: things to go and do, from the Ticketmaster Discovery API.
//   GET /api/homeevents?zip=98101&radius=50&teams=Seahawks|Anaheim%20Ducks&music=1&food=1
//     -> { area, events: [{ id, name, url, date, time, venue, city, kind, tag, miles, local }] }
// Teams are searched everywhere, so games near home and away games (trip ideas) both come back;
// music and food are searched within the radius only. Same sign-in as /api/home.
// Needs the Pages secret TICKETMASTER_KEY (a free key from developer.ticketmaster.com).

import { json } from '../../src/net/db';
import { whoIs, type AccessEnv } from '../../src/home/access';

interface Env extends AccessEnv { TICKETMASTER_KEY?: string }
interface Ctx { request: Request; env: Env }

export interface Idea {
  id: string; name: string; url: string; date: string; time: string; venue: string; city: string;
  kind: 'team' | 'music' | 'food'; tag: string; miles: number | null; local: boolean;
}
interface TmEvent {
  id: string; name: string; url?: string;
  dates?: { start?: { localDate?: string; localTime?: string } };
  _embedded?: { venues?: { name?: string; city?: { name?: string }; state?: { stateCode?: string }; country?: { countryCode?: string };
    location?: { latitude?: string; longitude?: string } }[] };
}

const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 30 * 60_000;

const miles = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const rad = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(x));
};

async function locate(zip: string) {
  const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { places?: { 'place name': string; 'state abbreviation': string; latitude: string; longitude: string }[] };
  const p = j.places?.[0];
  return p ? { lat: Number(p.latitude), lon: Number(p.longitude), name: `${p['place name']}, ${p['state abbreviation']}` } : null;
}

async function search(key: string, params: Record<string, string>): Promise<TmEvent[]> {
  const q = new URLSearchParams({ apikey: key, sort: 'date,asc', size: '40', ...params });
  const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
  if (!r.ok) throw new Error(`ticketmaster ${r.status}`);
  const j = (await r.json()) as { _embedded?: { events?: TmEvent[] } };
  return j._embedded?.events ?? [];
}

/** Stand-in results for `npm run dev`, where there is no key. */
function sample(teams: string[]): Idea[] {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const mk = (i: number, name: string, kind: Idea['kind'], tag: string, venue: string, city: string, n: number, away = false): Idea =>
    ({ id: `sample${i}`, name, url: 'https://www.ticketmaster.com/', date: day(n), time: '19:00', venue, city, kind, tag, miles: away ? 900 : 6, local: !away });
  const t = teams[0] ?? 'Home team';
  return [
    mk(1, `${t} vs. Visitors`, 'team', t, 'Home Stadium', 'Hometown, ST', 3),
    mk(2, `${t} at Rivals`, 'team', t, 'Rival Arena', 'Faraway, ST', 16, true),
    mk(3, 'Sample band live', 'music', 'Music', 'The Local Theatre', 'Hometown, ST', 5),
    mk(4, 'Sample night market', 'food', 'Food', 'Waterfront Park', 'Hometown, ST', 9),
  ];
}

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  if (!(await whoIs(request, env))) return json({ error: 'sign in' }, 401);
  const url = new URL(request.url);
  const zip = url.searchParams.get('zip') ?? '';
  const radius = Math.max(5, Math.min(200, Number(url.searchParams.get('radius')) || 50));
  const teams = (url.searchParams.get('teams') ?? '').split('|').map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 4);
  const music = url.searchParams.get('music') === '1';
  const food = url.searchParams.get('food') === '1';
  if (!/^\d{5}$/.test(zip)) return json({ error: 'Enter a 5-digit ZIP code.' }, 400);

  const key = env.TICKETMASTER_KEY;
  if (!key) {
    if (url.hostname === 'localhost') return json({ area: 'Sample data', events: sample(teams) });
    return json({ error: 'Event suggestions are not set up yet: the site needs a Ticketmaster key.' }, 503);
  }
  const cacheKey = JSON.stringify([zip, radius, teams, music, food]);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

  try {
    const home = await locate(zip);
    if (!home) return json({ error: 'That ZIP code was not found.' }, 400);
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z';
    const from = iso(now);
    const near = { latlong: `${home.lat},${home.lon}`, radius: String(radius), unit: 'miles', startDateTime: from, endDateTime: iso(new Date(now.getTime() + 75 * 86_400_000)) };
    // Ticketmaster allows about five calls a second, so the searches go one after another.
    const jobs: { kind: Idea['kind']; tag: string; params: Record<string, string> }[] = [
      ...teams.map((t) => ({ kind: 'team' as const, tag: t, params: { keyword: t, classificationName: 'sports', startDateTime: from } })),
      ...(music ? [{ kind: 'music' as const, tag: 'Music', params: { ...near, classificationName: 'music' } }] : []),
      ...(food ? [{ kind: 'food' as const, tag: 'Food', params: { ...near, classificationName: 'Food & Drink,Fairs & Festivals' } }] : []),
    ];
    const events: Idea[] = [];
    const seen = new Set<string>();
    for (const job of jobs) {
      for (const e of await search(key, job.params)) {
        const date = e.dates?.start?.localDate;
        if (!date || seen.has(e.id)) continue;
        seen.add(e.id);
        const v = e._embedded?.venues?.[0];
        const lat = Number(v?.location?.latitude);
        const lon = Number(v?.location?.longitude);
        const far = Number.isFinite(lat) && Number.isFinite(lon) && v?.location?.latitude ? Math.round(miles(home.lat, home.lon, lat, lon)) : null;
        events.push({
          id: e.id, name: e.name, url: e.url ?? '', date, time: e.dates?.start?.localTime?.slice(0, 5) ?? '',
          venue: v?.name ?? '', city: [v?.city?.name, v?.state?.stateCode ?? v?.country?.countryCode].filter(Boolean).join(', '),
          kind: job.kind, tag: job.tag, miles: far, local: job.kind !== 'team' || (far !== null && far <= radius),
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const body = { area: home.name, events };
    cache.set(cacheKey, { at: Date.now(), body });
    return json(body);
  } catch (e) {
    return json({ error: `Couldn't load events (${(e as Error).message}).` }, 502);
  }
}
