// Public face of the sim: make a world, advance it, save/load it, fingerprint it.

import { foundCiv, suggestSpots } from './civ';
import { Rand, S, hashStr } from './rng';
import { step } from './step';
import { VALUES, type Tiles, type ValueId, type World } from './types';
import { migrate } from './migrate';
import { generateWorld, makeTiles } from './worldgen';

export { step } from './step';
export { AGES, TECHS } from './techs';
export * from './types';

export interface CreateOpts { seed: number; civs?: number; W?: number; H?: number; fill?: number }

/** A new world with a handful of ancient AI civs, so it is never empty. */
export function createWorld(o: CreateOpts): World {
  const w = generateWorld(o.seed, o.W, o.H);
  const n = o.civs ?? 20;
  if (o.fill) w.fill = o.fill;
  const spots = suggestSpots(w, n, Math.max(8, Math.floor(Math.sqrt((w.W * w.H * 0.4) / n) * 0.9)));
  for (let k = 0; k < spots.length; k++) {
    const r = new Rand(o.seed, S.FOUND, 0xa1, k);
    foundCiv(w, { tile: spots[k], values: randomValues(r), founder: null, pop: 100 });
  }
  return w;
}

export function randomValues(r: Rand): ValueId[] {
  const out: ValueId[] = [];
  while (out.length < 3) {
    const v = r.pick(VALUES);
    if (out.includes(v)) continue;
    if ((v === 'expansionist' && out.includes('isolationist')) || (v === 'isolationist' && out.includes('expansionist'))) continue;
    out.push(v);
  }
  return out;
}

export function runYears(w: World, years: number): void {
  for (let k = 0; k < years * 12; k++) step(w);
}

const TILE_KEYS = ['h', 'temp', 'moist', 'biome', 'river', 'flow', 'down', 'res', 'owner', 'work', 'city'] as const;
/** Tile layers that never change after the world is made. */
export const STATIC_KEYS = ['h', 'temp', 'moist', 'biome', 'river', 'flow', 'down', 'res'] as const;
const DYN_KEYS = ['owner', 'work', 'city'] as const;

type RawWorld = Omit<World, 't'> & { t: Record<string, number[]> };

export function serialize(w: World): string {
  const t: Record<string, number[]> = {};
  for (const k of TILE_KEYS) t[k] = Array.from(w.t[k]);
  return JSON.stringify({ ...w, t });
}

export function deserialize(json: string): World {
  return fromRaw(migrate(JSON.parse(json)) as unknown as RawWorld);
}

function fromRaw(o: RawWorld): World {
  const t = makeTiles(o.W * o.H);
  for (const k of TILE_KEYS) (t[k] as Tiles[typeof k]).set(o.t[k]);
  return { ...o, t };
}

/** The fixed terrain, sent once per world. */
export function serializeStatic(w: World): string {
  const t: Record<string, number[]> = {};
  for (const k of STATIC_KEYS) t[k] = Array.from(w.t[k]);
  return JSON.stringify({ W: w.W, H: w.H, seed: w.seed, t });
}

/** Everything that changes, without the fixed terrain. */
export function serializeDynamic(w: World): string {
  const t: Record<string, number[]> = {};
  for (const k of DYN_KEYS) t[k] = Array.from(w.t[k]);
  return JSON.stringify({ ...w, t });
}

export function assemble(staticJson: string, dynJson: string): World {
  const st = JSON.parse(staticJson) as { t: Record<string, number[]> };
  const dyn = migrate(JSON.parse(dynJson)) as unknown as RawWorld;
  return fromRaw({ ...dyn, t: { ...st.t, ...dyn.t } });
}

/** A short fingerprint of the whole world state, for golden tests. */
export function worldHash(w: World): string {
  return hashStr(serialize(w)).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of the simulated state only (not the event log, which the server trims).
 * Client and server compare this to prove they are in step.
 */
export function stateHash(w: World): string {
  const t: Record<string, number[]> = {};
  for (const k of DYN_KEYS) t[k] = Array.from(w.t[k]);
  return hashStr(JSON.stringify({ ...w, t, log: null, logBase: null })).toString(16).padStart(8, '0');
}
