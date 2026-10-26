// Plain data types shared by the simulator, the game and (later) a PvP server.

/** One ship in a player's fleet. Stats already include merge bonuses. */
export interface FleetShip {
  def: string;
  atk: number;
  hp: number;
  xp: number;
}

/**
 * A frozen copy of a fleet at the moment it went into battle.
 * This is the unit of "snapshot PvP": players fight each other's snapshots.
 */
export interface Snapshot {
  v: 1;
  id: string;
  runId: string;
  name: string;
  round: number;
  wins: number;
  lives: number;
  fleet: (FleetShip | null)[]; // index 0 is the front of the line
  relics: string[];
  createdAt: number;
  style?: string; // bot archetype label, e.g. 'SWARM FLEET'
  cmd?: { id: string; p: 'a' | 'b' }; // commander and chosen passive
  bench?: number; // ships waiting on the bench (Tess's Spare Parts)
}
