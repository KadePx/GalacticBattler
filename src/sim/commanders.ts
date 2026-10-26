// Commanders: picked before a run. Each has two battle passives (the second
// unlocks at commander level 3) and a shop power usable once per round.
// The chosen passive is stored in the snapshot, so ghosts fight with it.
// Passive effects live in battle.ts; shop powers live in game/run.ts.

export type PassiveSlot = 'a' | 'b';

export interface CommanderPassive {
  name: string;
  desc: string; // keep under ~44 chars
}

export interface CommanderDef {
  id: string;
  name: string;
  title: string; // shown at level 5
  style: string; // matching bot archetype
  rank: number; // pilot rank that unlocks this commander
  color: string;
  passives: Record<PassiveSlot, CommanderPassive>;
  power: { name: string; desc: string; cost: number; target: boolean };
  starter: string; // ship id offered at level 4
}

export const COMMANDERS: CommanderDef[] = [
  {
    id: 'vance', name: 'Vance', title: 'Grand Admiral', style: 'balanced', rank: 1, color: '#ffd166',
    passives: {
      a: { name: 'Veteran Crews', desc: 'Level 2+ ships get +1 ATK and +2 HP.' },
      b: { name: 'Supply Lines', desc: '+1 scrap every round.' },
    },
    power: { name: 'PROMOTE', desc: 'Selected ship gains 1 XP.', cost: 2, target: true },
    starter: 'gunboat',
  },
  {
    id: 'kael', name: 'Kael', title: 'High Warden', style: 'fortress', rank: 1, color: '#7fe7ff',
    passives: {
      a: { name: 'Shield Wall', desc: 'Your front ship starts with a shield.' },
      b: { name: 'Reinforced Hulls', desc: 'Guard ships +4 HP.' },
    },
    power: { name: 'FORTIFY', desc: 'Selected ship: +3 HP for the run.', cost: 2, target: true },
    starter: 'bulwark',
  },
  {
    id: 'nyx', name: 'Nyx', title: 'Pirate Queen', style: 'blitz', rank: 2, color: '#ff9f43',
    passives: {
      a: { name: 'Hit and Run', desc: 'Strike ships +1 ATK and +1 HP.' },
      b: { name: 'Afterburners', desc: 'Strike ships open fire 3 ticks sooner.' },
    },
    power: { name: 'PLUNDER', desc: 'Take a random shipyard ship free.', cost: 1, target: false },
    starter: 'scout',
  },
  {
    id: 'ryx', name: 'Ryx', title: 'Hive Empress', style: 'swarm', rank: 3, color: '#c58cff',
    passives: {
      a: { name: 'Brood Nest', desc: 'Launch a 1/1 fighter per 3 fleet ships.' },
      b: { name: 'Hive Mind', desc: 'Fighters get +1 ATK and +2 HP.' },
    },
    power: { name: 'FEED', desc: 'A random fleet ship gets +1/+1.', cost: 2, target: false },
    starter: 'salvager',
  },
  {
    id: 'orin', name: 'Orin', title: 'Lord Gunner', style: 'artillery', rank: 4, color: '#ff5e7e',
    passives: {
      a: { name: 'Opening Barrage', desc: 'Artillery ships fire 2 ticks sooner.' },
      b: { name: 'Big Guns', desc: 'Your top-ATK ship gets +3 ATK.' },
    },
    power: { name: 'OVERCHARGE', desc: 'Selected ship: +1 ATK for the run.', cost: 2, target: true },
    starter: 'interceptor',
  },
  {
    id: 'juno', name: 'Juno', title: 'Spymaster', style: 'control', rank: 5, color: '#3dffb0',
    passives: {
      a: { name: 'Jamming Field', desc: 'Enemies fire 1 tick late. Tech ships +1 ATK.' },
      b: { name: 'Repair Protocols', desc: 'Drones heal +2. Tech ships +3 HP.' },
    },
    power: { name: 'DEEP SCAN', desc: 'Reroll with no tier 1 ships.', cost: 1, target: false },
    starter: 'drone',
  },
  {
    id: 'sera', name: 'Sera', title: 'Fleet Marshal', style: 'concord', rank: 6, color: '#a8c8ff',
    passives: {
      a: { name: 'Phalanx', desc: 'Front Concord ship starts with 2 shields.' },
      b: { name: 'Spotter Net', desc: 'Each ship\'s first shot marks its target.' },
    },
    power: { name: 'RECRUIT', desc: 'Shop ship becomes a Concord ship.', cost: 1, target: false },
    starter: 'picket',
  },
  {
    id: 'grisk', name: 'Grisk', title: 'Reaver King', style: 'reaver', rank: 7, color: '#ff8a4a',
    passives: {
      a: { name: 'Boarding Crews', desc: 'Kills give the killer +1 ATK, repair 3.' },
      b: { name: 'Last Stand', desc: 'First ship you lose explodes for 5.' },
    },
    power: { name: 'SCRAP RAID', desc: '+1 scrap if you have 2+ Reavers.', cost: 0, target: false },
    starter: 'scrapper',
  },
  {
    id: 'nihl', name: 'Nihl', title: 'Void Oracle', style: 'void', rank: 8, color: '#c070ff',
    passives: {
      a: { name: 'Hunger', desc: 'Void ships +1 ATK, heal +3 per hit.' },
      b: { name: 'Echo Chamber', desc: 'First ship lost leaves a 2/2 Echo.' },
    },
    power: { name: 'RIFT', desc: 'Shop ship becomes a Void ship.', cost: 1, target: false },
    starter: 'wraith',
  },
  {
    id: 'tess', name: 'Tess', title: 'Chief Engineer', style: 'engineer', rank: 9, color: '#ff8a3a',
    passives: {
      a: { name: 'Spare Parts', desc: 'Each benched ship: your fleet +1 HP.' },
      b: { name: 'Hot Start', desc: 'Each ship\'s first shot deals +2.' },
    },
    power: { name: 'REFIT', desc: 'Reroll a ship within its tier.', cost: 2, target: true },
    starter: 'gunboat',
  },
];

export const CMD_MAP: Record<string, CommanderDef> = Object.fromEntries(COMMANDERS.map((c) => [c.id, c]));

/** e.g. 'kael.a', or '' when a snapshot has no commander (old saves). */
export const passiveId = (cmd?: { id: string; p: PassiveSlot }) => (cmd && CMD_MAP[cmd.id] ? `${cmd.id}.${cmd.p}` : '');
