// Goblin Hold offline support. The page itself is network-first (so updates land at once);
// hashed build files are cache-first, since a new build always gets new file names.
const CACHE = 'goblinhold-v2';
const PAGE = '/goblin-hold/';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const res = await fetch(PAGE, { cache: 'no-store' });
    const html = await res.clone().text();
    await c.put(PAGE, res);
    // pre-cache the scripts and styles the page loads
    const urls = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) || [])];
    await Promise.all(urls.map((u) => c.add(u).catch(() => {})));
    await c.addAll(['/goblin-hold/icon-192.png', '/goblin-hold/manifest.webmanifest']).catch(() => {});
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Keep the fresh page, and drop build files that it no longer uses. */
async function refresh(res) {
  const c = await caches.open(CACHE);
  const html = await res.clone().text();
  await c.put(PAGE, res);
  const keep = new Set(html.match(/\/assets\/[^"'\s)]+/g) || []);
  for (const r of await c.keys()) {
    const p = new URL(r.url).pathname;
    if (p.startsWith('/assets/') && !keep.has(p) && !p.endsWith('.woff2')) await c.delete(r);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  if (req.mode === 'navigate' && url.pathname.startsWith(PAGE)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) e.waitUntil(refresh(res.clone()));
        return res;
      } catch {
        return (await caches.match(PAGE, { ignoreVary: true, ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  if (fonts || url.pathname.startsWith('/assets/') || url.pathname.startsWith(PAGE)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true }); // module scripts send Origin; some servers add Vary: Origin
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
