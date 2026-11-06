// Bug reports and ideas from the menu's FEEDBACK button.
//   POST /api/feedback { kind: 'bug' | 'idea' | 'other', text, player?, name?, context? } -> { ok }
// Stored in the feedback table. Read them with `npm run feedback` (needs `wrangler login`).

import { cleanCallsign, isPlayerId } from '../../src/net/ghostRules';
import { ensureSchema, json, readBody, type Ctx } from '../../src/net/db';

const KINDS = ['bug', 'idea', 'other'];
const MAX_TEXT = 1000;
const MAX_CONTEXT = 600;
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 8; // reports per address per hour

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (typeof body.kind !== 'string' || !KINDS.includes(body.kind)) return json({ error: 'bad kind' }, 400);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  if (text.length < 3) return json({ error: 'write a little more' }, 400);
  await ensureSchema(env.DB);
  const now = Date.now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE ip = ?1 AND created > ?2')
    .bind(ip, now - WINDOW_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_WINDOW) return json({ error: 'thanks! that is a lot of reports, try again later' }, 429);
  const player = isPlayerId(body.player) ? body.player : null;
  const name = cleanCallsign(body.name) ?? null;
  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : null;
  await env.DB.prepare('INSERT INTO feedback (kind, text, player, name, context, ip, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(body.kind, text, player, name, context, ip, now).run();
  return json({ ok: true });
}
