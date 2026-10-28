// Rules for ghost snapshots shared by the game and the server (functions/api/ghosts.ts).
// Pure data checks only: no Phaser, no browser APIs, so the server can import it.

import { SHIPS, MAX_XP } from '../sim/ships';
import { RELIC_MAP } from '../sim/relics';
import { CMD_MAP } from '../sim/commanders';
import type { FleetShip, Snapshot } from '../sim/types';

export const MAX_ROUND = 80;
const FLEET_SIZE = 5;
const BENCH_SIZE = 3;
const MAX_LIVES = 5;

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Callsigns: 3-14 characters, letters, digits and single spaces, shown upper-case. */
export function cleanCallsign(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 3 && s.length <= 14 ? s : null;
}

/** Player ids are random strings the game makes once per browser. */
export const isPlayerId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{8,40}$/.test(v);

/**
 * A ship has to exist, be a real fleet ship (not a fighter/mine/echo), and have stats a
 * real run could reach. The stat limits are generous on purpose: commander powers and
 * rewards add permanent stats every round, so this only stops obviously forged fleets.
 */
function cleanShip(raw: unknown, round: number): FleetShip | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const def = typeof s.def === 'string' ? SHIPS[s.def] : undefined;
  if (!def || def.tier < 1) return null;
  if (!isInt(s.xp, 0, MAX_XP)) return null;
  if (!isInt(s.atk, 0, def.atk + 12 + 3 * round)) return null;
  if (!isInt(s.hp, 1, def.hp + 20 + 6 * round)) return null;
  return { def: def.id, atk: s.atk, hp: s.hp, xp: s.xp };
}

/**
 * Validate an uploaded snapshot and rebuild it from known fields only (anything else is
 * dropped). Returns the clean snapshot, or a short reason it was rejected.
 */
export function cleanSnapshot(raw: unknown, name: string): Snapshot | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const s = raw as Record<string, unknown>;
  if (s.v !== 1) return 'bad version';
  if (typeof s.id !== 'string' || !/^[\w-]{1,60}$/.test(s.id)) return 'bad id';
  if (typeof s.runId !== 'string' || !/^[\w-]{1,40}$/.test(s.runId) || s.runId === 'bot') return 'bad run id';
  if (!isInt(s.round, 1, MAX_ROUND)) return 'bad round';
  const round = s.round;
  if (!isInt(s.wins, 0, round)) return 'bad wins';
  if (!isInt(s.lives, 0, MAX_LIVES)) return 'bad lives';

  if (!Array.isArray(s.fleet) || s.fleet.length > FLEET_SIZE) return 'bad fleet';
  const fleet: (FleetShip | null)[] = [];
  for (const f of s.fleet) {
    if (f === null) { fleet.push(null); continue; }
    const ship = cleanShip(f, round);
    if (!ship) return 'bad ship';
    fleet.push(ship);
  }
  if (!fleet.some(Boolean)) return 'empty fleet';
  while (fleet.length < FLEET_SIZE) fleet.push(null);

  // One relic per round played (endless runs keep going, so allow a little slack).
  if (!Array.isArray(s.relics) || s.relics.length > round + 2) return 'bad relics';
  const relics: string[] = [];
  for (const r of s.relics) {
    if (typeof r !== 'string' || !RELIC_MAP[r]) return 'bad relic';
    relics.push(r);
  }

  let cmd: Snapshot['cmd'];
  if (s.cmd !== undefined && s.cmd !== null) {
    const c = s.cmd as Record<string, unknown>;
    if (typeof c.id !== 'string' || !CMD_MAP[c.id] || (c.p !== 'a' && c.p !== 'b')) return 'bad commander';
    cmd = { id: c.id, p: c.p };
  }

  let bench: number | undefined;
  if (s.bench !== undefined) {
    if (!isInt(s.bench, 0, BENCH_SIZE)) return 'bad bench';
    bench = s.bench;
  }
  let reserve: FleetShip | undefined;
  if (s.reserve !== undefined && s.reserve !== null) {
    const r = cleanShip(s.reserve, round);
    if (!r) return 'bad reserve';
    reserve = r;
  }

  return {
    v: 1, id: s.id, runId: s.runId, name, round, wins: s.wins, lives: s.lives,
    fleet, relics, createdAt: Date.now(), cmd, bench, reserve,
  };
}
