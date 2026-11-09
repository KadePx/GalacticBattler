// Cleaning and checking the few words players write into the world (people and capital names,
// mottos, display names). Used by both the founding screen and the server.

// Kept short on purpose: the obvious slurs and profanity, matched after undoing common
// letter swaps. Anything that slips through can be renamed with the admin tools.
const BANNED = [
  'fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'retard', 'whore', 'slut', 'rapist', 'nazi', 'hitler',
  'kike', 'chink', 'tranny', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'porn', 'jizz',
];
const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function squash(s: string): string {
  return s.toLowerCase().replace(/[013457@$!]/g, (c) => SWAPS[c]).replace(/[^a-z]/g, '');
}

export function isClean(s: string): boolean {
  const q = squash(s);
  return !BANNED.some((b) => q.includes(b));
}

/** Trim, collapse spaces, drop control and markup characters, cap the length. */
export function tidy(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f<>{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A proper name: letters (any script), apostrophes and hyphens, 3-16 long, capitalised. */
export function properName(s: unknown): string | null {
  const t = tidy(s, 16);
  if (!/^[\p{L}][\p{L}'-]{2,15}$/u.test(t)) return null;
  if (!isClean(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A name given with naming rights (a town, river, wonder or great person): 1-3 words, 3-24 long. */
export function placeName(s: unknown): string | null {
  const t = tidy(s, 24).replace(/^the\s+/i, '');
  if (!/^[\p{L}][\p{L}'-]*( [\p{L}][\p{L}'-]*){0,2}$/u.test(t) || t.length < 3) return null;
  if (!isClean(t)) return null;
  return t.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const MOTTO_MAX = 60;
export const BYNAME_MAX = 20;

export function cleanMotto(s: unknown): string | null {
  const t = tidy(s, MOTTO_MAX);
  return isClean(t) ? t : null;
}

export function cleanByName(s: unknown): string | null {
  const t = tidy(s, BYNAME_MAX);
  if (t && !/^[\p{L}\p{N} '_.-]+$/u.test(t)) return null;
  return isClean(t) ? t : null;
}

/** Banner: [hue 0-359, second 0-1, metal 0-2, division 0-7, charge 0-8]. */
export function cleanBanner(b: unknown): number[] | null {
  if (!Array.isArray(b) || b.length !== 5 || !b.every((x) => Number.isInteger(x))) return null;
  const [h, s, m, d, c] = b as number[];
  if (h < 0 || h > 359 || s < 0 || s > 1 || m < 0 || m > 2 || d < 0 || d > 7 || c < 0 || c > 8) return null;
  return [h, s, m, d, c];
}

/** The public id of a founder: a hash of their private browser id. */
export async function founderHash(id: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`commonworld:${id}`));
  return 'f' + Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isFounderId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9-]{20,64}$/.test(s);
