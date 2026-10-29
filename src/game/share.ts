// Fleet share codes: pack a fleet into a short text code (or a link) a friend can paste
// in to fight it. Decoded fleets go through the same checks as online ghosts.

import { cleanCallsign, cleanSnapshot } from '../net/ghostRules';
import { hashStr } from '../sim/rng';
import type { Snapshot } from '../sim/types';
import { read, write } from './storage';

const LAST_KEY = 'starbrawl.lastFleet';

type Packed = { n: string; r: number; w: number; c?: [string, string]; f: ([string, number, number, number] | 0)[]; x: string[]; b?: number };

const toB64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeFleet(snap: Snapshot): string {
  const p: Packed = {
    n: snap.name, r: snap.round, w: snap.wins,
    c: snap.cmd ? [snap.cmd.id, snap.cmd.p] : undefined,
    f: snap.fleet.map((s) => (s ? [s.def, s.atk, s.hp, s.xp] : 0)),
    x: snap.relics,
    b: snap.bench || undefined,
  };
  return toB64(JSON.stringify(p));
}

/** A fleet from a share code (or a link containing one), or null if it isn't valid. */
export function decodeFleet(input: string): Snapshot | null {
  const code = (input.match(/[?&]fleet=([\w-]+)/)?.[1] ?? input).trim();
  if (!/^[\w-]{10,6000}$/.test(code)) return null;
  try {
    const p = JSON.parse(fromB64(code)) as Packed;
    const name = cleanCallsign(p.n) ?? 'A PILOT';
    const snap = cleanSnapshot({
      v: 1, id: `share-${hashStr(code).toString(36)}`, runId: 'shared', round: p.r, wins: p.w, lives: 1,
      fleet: p.f.map((s) => (s ? { def: s[0], atk: s[1], hp: s[2], xp: s[3] } : null)),
      relics: p.x, cmd: p.c ? { id: p.c[0], p: p.c[1] } : undefined, bench: p.b,
    }, name);
    return typeof snap === 'string' ? null : snap;
  } catch {
    return null;
  }
}

/** The link that opens the game straight into a fight against this fleet. */
export const shareLink = (snap: Snapshot) =>
  `${location.origin}${location.pathname}?fleet=${encodeFleet(snap)}`;

/** Copy a fleet's link (or open the phone's share sheet). Resolves to how it went. */
export async function shareFleet(snap: Snapshot): Promise<'shared' | 'copied' | 'shown'> {
  const url = shareLink(snap);
  const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
  if (nav.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ title: 'Galactic Battler', text: `Can your fleet beat ${snap.name}'s?`, url });
      return 'shared';
    } catch { /* cancelled: fall through to copying */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt('Copy this link and send it to a friend:', url);
    return 'shown';
  }
}

/** The shared fleet waiting to be fought (from a link or a pasted code). */
const CHALLENGE_KEY = 'starbrawl.challenge';
export const setChallenge = (snap: Snapshot | null) => write(CHALLENGE_KEY, snap);
export const getChallenge = () => read<Snapshot>(CHALLENGE_KEY);

/** Your most recent fleet (saved after every battle), used to fight shared fleets. */
export const saveLastFleet = (snap: Snapshot) => write(LAST_KEY, snap);
export const lastFleet = () => read<Snapshot>(LAST_KEY);
