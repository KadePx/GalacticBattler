// All the tuning numbers for Rotwave in one place.

export type UnitKind = 'rifle' | 'gunner' | 'sniper' | 'grenadier' | 'flamer' | 'medic' | 'engineer' | 'jeep' | 'tank';
export type BuildKind = 'wall' | 'turret' | 'cannon' | 'flame' | 'mortar' | 'tower' | 'spikes';
export type CallKind = 'airstrike' | 'artillery' | 'supply' | 'para';

/** How a weapon delivers damage. */
export type Weapon = 'bullet' | 'lob' | 'shell' | 'flame';
/** Which gunshot sound to play. */
export type Gun = 'rifle' | 'mg' | 'sniper' | 'pistol' | 'cannon' | 'launcher' | 'flame';

export interface GunDef {
  range: number;
  minRange?: number;
  dmg: number;
  rate: number; // shots per second
  weapon: Weapon;
  splash?: number; // explosion radius for lob/shell, cone length for flame
  gun: Gun;
  tracer: number;
}

export interface UnitDef extends GunDef {
  name: string;
  cost: number;
  hp: number;
  r: number;
  speed: number;
  pop: number;
  desc: string;
  vehicle?: boolean;
  heal?: number; // hp per second to soldiers nearby
  repair?: number; // hp per second to buildings nearby
  nades?: boolean; // tosses a grenade into tight crowds
  crush?: boolean; // runs zombies over
}

export const UNITS: Record<UnitKind, UnitDef> = {
  rifle: { name: 'Rifleman', cost: 75, hp: 70, r: 0.42, speed: 4.2, pop: 1, range: 9, dmg: 13, rate: 1.6, weapon: 'bullet', gun: 'rifle', tracer: 0xffd27a, nades: true, desc: 'Steady all-rounder. Throws a grenade into tight crowds.' },
  gunner: { name: 'Gunner', cost: 150, hp: 120, r: 0.45, speed: 3.3, pop: 1, range: 7.5, dmg: 6, rate: 7, weapon: 'bullet', gun: 'mg', tracer: 0xffc060, desc: 'Tough machine gunner. Shreds crowds up close.' },
  sniper: { name: 'Sniper', cost: 200, hp: 45, r: 0.4, speed: 3.8, pop: 1, range: 17, dmg: 75, rate: 0.55, weapon: 'bullet', gun: 'sniper', tracer: 0xffffff, desc: 'Fragile, huge range. Deletes brutes.' },
  grenadier: { name: 'Grenadier', cost: 175, hp: 65, r: 0.42, speed: 3.9, pop: 1, range: 11, minRange: 2.5, dmg: 45, rate: 0.55, weapon: 'lob', splash: 2.4, gun: 'launcher', tracer: 0, desc: 'Lobs grenades that blow up whole groups.' },
  flamer: { name: 'Flamer', cost: 175, hp: 110, r: 0.45, speed: 3.6, pop: 1, range: 4.8, dmg: 5, rate: 10, weapon: 'flame', splash: 4.8, gun: 'flame', tracer: 0, desc: 'Short-range fire cone. Sets zombies burning.' },
  medic: { name: 'Medic', cost: 125, hp: 60, r: 0.4, speed: 4.4, pop: 1, range: 7, dmg: 6, rate: 1.2, weapon: 'bullet', gun: 'pistol', tracer: 0xffe6a0, heal: 9, desc: 'Heals nearby soldiers and vehicles.' },
  engineer: { name: 'Engineer', cost: 125, hp: 70, r: 0.42, speed: 4, pop: 1, range: 7, dmg: 6, rate: 1.2, weapon: 'bullet', gun: 'pistol', tracer: 0xffe6a0, repair: 30, desc: 'Repairs nearby walls, turrets and the HQ.' },
  jeep: { name: 'Gun Jeep', cost: 275, hp: 320, r: 0.95, speed: 7.5, pop: 2, range: 9.5, dmg: 7, rate: 8, weapon: 'bullet', gun: 'mg', tracer: 0xffc060, vehicle: true, desc: 'Fast truck with a mounted machine gun. 2 squad slots.' },
  tank: { name: 'Tank', cost: 650, hp: 1100, r: 1.35, speed: 3, pop: 4, range: 13, dmg: 110, rate: 0.45, weapon: 'shell', splash: 2.6, gun: 'cannon', tracer: 0xffa040, vehicle: true, crush: true, desc: 'Armored cannon that runs zombies over. 4 squad slots.' },
};
export const SQUAD_ORDER: UnitKind[] = ['rifle', 'gunner', 'sniper', 'grenadier', 'flamer', 'medic', 'engineer', 'jeep', 'tank'];

export interface BuildDef extends Partial<GunDef> {
  name: string;
  cost: number;
  hp: number;
  r: number; // collision radius (0 = walk-over trap)
  gunY?: number;
  desc: string;
}
export const BUILDS: Record<BuildKind, BuildDef> = {
  wall: { name: 'Barricade', cost: 25, hp: 320, r: 1, desc: 'Blocks zombies. R rotates, drag to lay a line.' },
  turret: { name: 'MG Turret', cost: 175, hp: 260, r: 0.95, range: 11, dmg: 8, rate: 4.5, weapon: 'bullet', gun: 'mg', tracer: 0xffb85a, gunY: 1.4, desc: 'Automatic machine-gun nest.' },
  cannon: { name: 'Cannon', cost: 300, hp: 450, r: 1.1, range: 13, dmg: 80, rate: 0.6, weapon: 'shell', splash: 2.2, gun: 'cannon', tracer: 0xffa040, gunY: 1.4, desc: 'Heavy shells with splash damage.' },
  flame: { name: 'Flame Turret', cost: 225, hp: 320, r: 0.95, range: 5.5, dmg: 6, rate: 10, weapon: 'flame', splash: 5.5, gun: 'flame', tracer: 0, gunY: 1.3, desc: 'Hoses down anything that gets close.' },
  mortar: { name: 'Mortar Pit', cost: 350, hp: 250, r: 1.3, range: 26, minRange: 7, dmg: 70, rate: 0.3, weapon: 'lob', splash: 3, gun: 'launcher', tracer: 0, gunY: 0.8, desc: 'Very long range shells. Can’t hit things too close.' },
  tower: { name: 'Watchtower', cost: 275, hp: 380, r: 1.2, range: 18, dmg: 45, rate: 1.1, weapon: 'bullet', gun: 'sniper', tracer: 0xffffff, gunY: 4.3, desc: 'Tall sniper post with long sight lines.' },
  spikes: { name: 'Spike Trap', cost: 60, hp: 240, r: 0, desc: 'Zombies walking over it are slowed and shredded. Wears out.' },
};
export const BASE_ORDER: BuildKind[] = ['wall', 'turret', 'tower', 'cannon', 'flame', 'mortar', 'spikes'];

export interface CallDef {
  name: string;
  key: string;
  cost: number;
  cooldown: number;
  radius: number; // targeting circle
  desc: string;
}
export const CALLS: Record<CallKind, CallDef> = {
  airstrike: { name: 'Airstrike', key: 'Z', cost: 200, cooldown: 50, radius: 1.5, desc: 'A jet bombs a line through the target, across the screen.' },
  artillery: { name: 'Artillery', key: 'X', cost: 150, cooldown: 35, radius: 6, desc: 'A barrage of shells pounds the area.' },
  supply: { name: 'Supply Drop', key: 'C', cost: 100, cooldown: 40, radius: 7, desc: 'Crate heals soldiers and repairs buildings around it.' },
  para: { name: 'Paratroopers', key: 'V', cost: 175, cooldown: 60, radius: 2.5, desc: 'Four riflemen parachute in.' },
};
export const CALL_ORDER: CallKind[] = ['airstrike', 'artillery', 'supply', 'para'];

export interface ZType {
  name: string;
  hp: number;
  speed: number;
  r: number;
  scale: number;
  dps: number;
  bounty: number;
}
export const ZTYPES: ZType[] = [
  { name: 'walker', hp: 34, speed: 2.0, r: 0.42, scale: 1, dps: 10, bounty: 3 },
  { name: 'runner', hp: 22, speed: 3.7, r: 0.36, scale: 0.88, dps: 7, bounty: 4 },
  { name: 'brute', hp: 320, speed: 1.15, r: 0.85, scale: 1.75, dps: 45, bounty: 25 },
];

export const HQ = { hp: 1500, range: 9, dmg: 9, rate: 2, weapon: 'bullet' as Weapon, gun: 'rifle' as Gun, tracer: 0xffb85a };
export const UNIT_CAP = 40;
export const AGGRO = 9;
