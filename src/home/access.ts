// Server only (functions/api/home*.ts): who is signed in, from the Cloudflare Access token.

export interface AccessEnv { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let keys: { at: number; domain: string; byKid: Map<string, CryptoKey> } | null = null;

const b64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function accessKeys(domain: string, refresh: boolean) {
  if (keys && keys.domain === domain && !refresh && Date.now() - keys.at < 3_600_000) return keys.byKid;
  const r = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs');
  const body = (await r.json()) as { keys: Jwk[] };
  const byKid = new Map<string, CryptoKey>();
  for (const k of body.keys) {
    byKid.set(k.kid, await crypto.subtle.importKey('jwk', { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keys = { at: Date.now(), domain, byKid };
  return byKid;
}

/** The signed-in email, or null. */
export async function whoIs(request: Request, env: AccessEnv): Promise<string | null> {
  const host = new URL(request.url).hostname;
  // `npm run dev` only: Cloudflare never routes a request here under these names.
  if (host === 'localhost' || host === '127.0.0.1') return request.headers.get('x-dev-user') || 'dev@localhost';
  const domain = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = env.ACCESS_AUD;
  if (!domain || !aud) return null;
  const token = request.headers.get('cf-access-jwt-assertion')
    ?? request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const head = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid?: string; alg?: string };
    if (head.alg !== 'RS256' || !head.kid) return null;
    let key = (await accessKeys(domain, false)).get(head.kid);
    key ??= (await accessKeys(domain, true)).get(head.kid); // keys rotate
    if (!key) return null;
    const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!good) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
    if (claims.iss !== `https://${domain}`) return null;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return typeof claims.email === 'string' && claims.email ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
