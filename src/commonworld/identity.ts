// The visitor's private founder id. Kept in localStorage and a long-lived cookie, each able to
// restore the other, so clearing one doesn't lose your people. Only its hash is ever public.

import { founderHash } from './shared/text';

const KEY = 'cw.founder';
const COOKIE = 'cw_founder';

function readCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)cw_founder=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}

function save(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  document.cookie = `${COOKIE}=${id}; max-age=${60 * 60 * 24 * 3650}; path=/; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
}

let cached: string | null = null;
export function founderId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* private mode */ }
  id ??= readCookie();
  if (!id || !/^[A-Za-z0-9-]{20,64}$/.test(id)) id = crypto.randomUUID();
  save(id);
  return (cached = id);
}

let hash: Promise<string> | null = null;
export function myHash(): Promise<string> {
  return (hash ??= founderHash(founderId()));
}
