// Relics: permanent run upgrades picked after every battle (the roguelike layer).
// They are part of a snapshot, so ghosts fight with the relics they had.

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  color: number;
  glyph: string;
}

export const RELICS: RelicDef[] = [
  { id: 'targeting', name: 'Targeting AI', desc: 'All ships +1 ATK.', color: 0xff9f43, glyph: 'T' },
  { id: 'plating', name: 'Hull Plating', desc: 'All ships +3 HP in battle.', color: 0x7dff8a, glyph: 'H' },
  { id: 'overclock', name: 'Overclock', desc: 'All ships attack 1 tick faster.', color: 0xffe066, glyph: 'O' },
  { id: 'alpha', name: 'Alpha Strike', desc: 'First shots fire 2 ticks sooner.', color: 0xff5e7e, glyph: 'A' },
  { id: 'matrix', name: 'Shield Matrix', desc: 'Your front ship starts shielded.', color: 0x7fe7ff, glyph: 'S' },
  { id: 'hangar', name: 'Hangar Bay', desc: 'Launch a 2/2 fighter each battle.', color: 0xc58cff, glyph: 'F' },
  { id: 'warheads', name: 'Heavy Warheads', desc: 'Torpedo, Lance and Siege +2 ATK.', color: 0xff6b6b, glyph: 'W' },
  { id: 'nanites', name: 'Nanite Swarm', desc: 'Repair Drones heal +2.', color: 0x2ee59d, glyph: 'N' },
  { id: 'squadron', name: 'Squadron Doctrine', desc: 'Fighters get +1 ATK and +1 HP.', color: 0xd4b8ff, glyph: 'Q' },
  { id: 'vengeance', name: 'Vengeance Protocol', desc: 'When a ship goes down, allies +1 ATK.', color: 0xff3b3b, glyph: 'V' },
  { id: 'jammer', name: 'Jammer Array', desc: 'Ion jams last 2 ticks longer.', color: 0x3a7bff, glyph: 'J' },
  { id: 'salvage', name: 'Salvage Rights', desc: '+2 scrap every round.', color: 0xffd166, glyph: '$' },
  { id: 'magnet', name: 'Scrap Magnet', desc: 'Selling ships gives +1 scrap.', color: 0xb0b8d0, glyph: 'M' },
];

export const RELIC_MAP: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export const count = (relics: readonly string[], id: string) => relics.filter((r) => r === id).length;
