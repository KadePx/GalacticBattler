// Dev only: serve the Pages Functions in functions/api/ from the Vite dev server, with a
// local SQLite file standing in for the D1 database, so the online features (ghosts, daily
// board, run logs) work in `npm run dev`. The live site uses Cloudflare instead.

import type { Plugin, ViteDevServer } from 'vite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = Record<string, unknown>;

/**
 * The small slice of the D1 API the functions use, on top of node:sqlite. Loaded lazily so
 * production builds (which may run on an older Node) never touch node:sqlite.
 */
async function fakeD1(file: string) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  class Stmt {
    constructor(private sql: string, private params: unknown[] = []) {}
    bind(...values: unknown[]) { return new Stmt(this.sql, values); }
    private args() { return this.params as (string | number | null)[]; }
    async first<T>() { return (db.prepare(this.sql).get(...this.args()) as T | undefined) ?? null; }
    async all<T>() { return { results: db.prepare(this.sql).all(...this.args()) as T[] }; }
    async run() { return db.prepare(this.sql).run(...this.args()); }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    batch: async (stmts: Stmt[]) => Promise.all(stmts.map((s) => s.run())),
  };
}

export function localApi(): Plugin {
  let db: Awaited<ReturnType<typeof fakeD1>> | null = null;
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const m = url.pathname.match(/^\/api\/([a-z]+)$/);
        if (!m || !existsSync(resolve(server.config.root, `functions/api/${m[1]}.ts`))) return next();
        try {
          if (!db) {
            const dir = resolve(server.config.root, '.vite');
            mkdirSync(dir, { recursive: true });
            db = await fakeD1(resolve(dir, 'local-api.sqlite'));
          }
          const mod = (await server.ssrLoadModule(`/functions/api/${m[1]}.ts`)) as Row;
          const handler = mod[req.method === 'POST' ? 'onRequestPost' : 'onRequestGet'] as
            | ((ctx: { request: Request; env: { DB: unknown } }) => Promise<Response>)
            | undefined;
          if (!handler) { res.statusCode = 405; return res.end(); }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const out = await handler({ request, env: { DB: db } });
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (e) {
          console.error('[local-api]', e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}
