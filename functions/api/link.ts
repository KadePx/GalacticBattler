// Link another device to the same pilot with a short code.
//   POST /api/link { action: 'create', player, name, profile } -> { code, expires }
//   POST /api/link { action: 'claim', code }                  -> { player, name, profile }
// The first device makes a 5-digit code; the second device enters it and becomes the same
// pilot (same id, callsign and progress at that moment). After that each device keeps its own
// progress. Codes work once and expire after LINK_TTL_MS. Wrong guesses are limited per address.

import { cleanCallsign, isPlayerId } from '../../src/net/ghostRules';
import { ensureSchema, json, readBody, type Ctx } from '../../src/net/db';

const LINK_TTL_MS = 10 * 60_000;
const TRY_WINDOW_MS = 10 * 60_000;
const MAX_TRIES = 10; // claims per address per window: 10 guesses out of 90,000 codes
const MAX_PROFILE = 12_000; // characters of profile JSON (real ones are well under 2 KB)

const isCode = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{4}$/.test(v);
const newCode = () => String(10000 + Math.floor(Math.random() * 90000));

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  await ensureSchema(env.DB);
  const now = Date.now();
  // Expired codes and old attempts are cleared on every call; the tables stay tiny.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM links WHERE created < ?1').bind(now - LINK_TTL_MS),
    env.DB.prepare('DELETE FROM link_tries WHERE created < ?1').bind(now - TRY_WINDOW_MS),
  ]);

  if (body.action === 'create') {
    if (!isPlayerId(body.player)) return json({ error: 'bad player' }, 400);
    const name = cleanCallsign(body.name);
    if (!name) return json({ error: 'bad callsign' }, 400);
    const profile = JSON.stringify(body.profile ?? null);
    if (!body.profile || typeof body.profile !== 'object' || profile.length > MAX_PROFILE) return json({ error: 'bad profile' }, 400);
    // One live code per pilot: making a new one replaces the old.
    await env.DB.prepare('DELETE FROM links WHERE player = ?1').bind(body.player).run();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newCode();
      const taken = await env.DB.prepare('SELECT 1 AS x FROM links WHERE code = ?1').bind(code).first();
      if (taken) continue;
      await env.DB.prepare('INSERT INTO links (code, player, name, profile, created) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(code, body.player, name, profile, now).run();
      return json({ code, expires: now + LINK_TTL_MS });
    }
    return json({ error: 'busy, try again' }, 503);
  }

  if (body.action === 'claim') {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const tries = await env.DB.prepare('SELECT COUNT(*) AS n FROM link_tries WHERE ip = ?1').bind(ip).first<{ n: number }>();
    if ((tries?.n ?? 0) >= MAX_TRIES) return json({ error: 'too many tries, wait 10 minutes' }, 429);
    await env.DB.prepare('INSERT INTO link_tries (ip, created) VALUES (?1, ?2)').bind(ip, now).run();
    if (!isCode(body.code)) return json({ error: 'bad code' }, 400);
    const row = await env.DB.prepare('SELECT player, name, profile FROM links WHERE code = ?1')
      .bind(body.code).first<{ player: string; name: string; profile: string }>();
    if (!row) return json({ error: 'code not found or expired' }, 404);
    await env.DB.prepare('DELETE FROM links WHERE code = ?1').bind(body.code).run(); // single use
    return json({ player: row.player, name: row.name, profile: JSON.parse(row.profile) });
  }

  return json({ error: 'bad action' }, 400);
}
