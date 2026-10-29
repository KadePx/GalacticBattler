// Server-side helpers shared by the API functions (functions/api/*). Never bundled into the game.

// Just the parts of the D1 API the functions use (avoids a types dependency).
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown>;
}
export interface Env { DB: D1 }
export interface Ctx { request: Request; env: Env }

export const MAX_BODY = 16_000; // bytes; real payloads are 1-2 KB

let schemaReady = false;
/** Create every table on first use. Cheap after the first call in each worker. */
export async function ensureSchema(db: D1) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ghosts (
      id TEXT PRIMARY KEY, ver TEXT NOT NULL, round INTEGER NOT NULL, wins INTEGER NOT NULL,
      player TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS ghosts_pick ON ghosts (ver, round, created)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ghosts_player ON ghosts (player, created)'),
    // One row per fight against someone's ghost, so its owner can see how it did.
    db.prepare(`CREATE TABLE IF NOT EXISTS ghost_fights (
      gid INTEGER NOT NULL, owner TEXT NOT NULL, reporter TEXT NOT NULL, opp TEXT NOT NULL,
      round INTEGER NOT NULL, ghost_won INTEGER NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY (gid, reporter)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS ghost_fights_owner ON ghost_fights (owner, created)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ghost_fights_reporter ON ghost_fights (reporter, created)'),
    // Daily challenge: one score per pilot per day (the first finished attempt).
    db.prepare(`CREATE TABLE IF NOT EXISTS daily (
      day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, wins INTEGER NOT NULL,
      lives INTEGER NOT NULL, battles INTEGER NOT NULL, cmd TEXT NOT NULL, fleet TEXT NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (day, player)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS daily_rank ON daily (day, wins, lives, battles, created)'),
    // Finished runs, for balance stats from real players.
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, ver TEXT NOT NULL, player TEXT NOT NULL, mode TEXT NOT NULL,
      cmd TEXT, passive TEXT, wins INTEGER NOT NULL, lives INTEGER NOT NULL, battles INTEGER NOT NULL,
      history TEXT NOT NULL, endless INTEGER NOT NULL, fleet TEXT NOT NULL, relics TEXT NOT NULL,
      created INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS runs_ver ON runs (ver, created)'),
    db.prepare('CREATE INDEX IF NOT EXISTS runs_player ON runs (player, created)'),
  ]);
  // Columns added after launch (fails harmlessly once they exist).
  try { await db.prepare('ALTER TABLE daily ADD COLUMN relics TEXT').run(); } catch { /* already there */ }
  schemaReady = true;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const isVersion = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{4,40}$/.test(v);

/** Parse a small JSON body, or return an error response. */
export async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json({ error: 'too large' }, 413);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : json({ error: 'bad json' }, 400);
  } catch {
    return json({ error: 'bad json' }, 400);
  }
}

/** True when this pilot already wrote `limit` rows to `table` in the last minute. */
export async function tooFast(db: D1, table: 'ghosts' | 'ghost_fights' | 'daily' | 'runs', column: string, player: string, limit: number) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1 AND created > ?2`)
    .bind(player, Date.now() - 60_000).first<{ n: number }>();
  return (row?.n ?? 0) >= limit;
}
