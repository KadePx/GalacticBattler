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
  { id: 'overclock', name: 'Overclock', desc: 'Ships attack 1 tick faster (min 3), -2 HP.', color: 0xffe066, glyph: 'O' },
  { id: 'alpha', name: 'Alpha Strike', desc: 'First shots fire 2 ticks sooner.', color: 0xff5e7e, glyph: 'A' },
  { id: 'matrix', name: 'Shield Matrix', desc: 'Your front ship starts shielded.', color: 0x7fe7ff, glyph: 'S' },
  { id: 'hangar', name: 'Hangar Bay', desc: 'Launch an extra 2/2 fighter each battle.', color: 0xc58cff, glyph: 'F' },
  { id: 'warheads', name: 'Heavy Warheads', desc: 'Torpedo, Lance and Siege +2 ATK.', color: 0xff6b6b, glyph: 'W' },
  { id: 'nanites', name: 'Nanite Swarm', desc: 'Repair Drones heal +4.', color: 0x2ee59d, glyph: 'N' },
  { id: 'squadron', name: 'Squadron Doctrine', desc: 'Fighters get +1 ATK and +1 HP.', color: 0xd4b8ff, glyph: 'Q' },
  { id: 'vengeance', name: 'Vengeance Protocol', desc: 'When a ship goes down, allies +1 ATK.', color: 0xff3b3b, glyph: 'V' },
  { id: 'jammer', name: 'Jammer Array', desc: 'Opening shots jam. Ion stun +2T, drain +1.', color: 0x3a7bff, glyph: 'J' },
  { id: 'salvage', name: 'Salvage Rights', desc: '+2 scrap every round.', color: 0xffd166, glyph: '$' },
  { id: 'banner_c', name: 'Concord Banner', desc: 'Counts as one more Concord ship.', color: 0xa8c8ff, glyph: 'C' },
  { id: 'banner_r', name: 'Reaver Flag', desc: 'Counts as one more Reaver ship.', color: 0xff8a4a, glyph: 'R' },
  { id: 'minefield', name: 'Minefield', desc: 'Lay 1 mine in front of your line.', color: 0xe0b030, glyph: '*' },
  { id: 'trophy', name: 'Trophy Rack', desc: 'Your ships gain +3 ATK per kill.', color: 0xd87830, glyph: 'K' },
  { id: 'magnet', name: 'Scrap Magnet', desc: 'Selling ships gives +1 scrap.', color: 0xb0b8d0, glyph: 'M' },
];

export const RELIC_MAP: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export const count = (relics: readonly string[], id: string) => relics.filter((r) => r === id).length;
