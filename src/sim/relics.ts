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
  { id: 'banner_v', name: 'Void Sigil', desc: 'Counts as one more Void ship.', color: 0xc070ff, glyph: 'X' },
  { id: 'minefield', name: 'Minefield', desc: 'Lay 1 mine in front of your line.', color: 0xe0b030, glyph: '*' },
  { id: 'trophy', name: 'Trophy Rack', desc: 'Your ships gain +3 ATK per kill.', color: 0xd87830, glyph: 'K' },
  { id: 'phase', name: 'Phase Coils', desc: 'Your front ship blinks: the first hit misses.', color: 0xd050ff, glyph: 'P' },
  { id: 'thorns', name: 'Thorn Plating', desc: 'Guard ships deal 1 back when hit by ships.', color: 0xa04020, glyph: 'T' },
  { id: 'magnet', name: 'Scrap Magnet', desc: 'Selling ships gives +1 scrap.', color: 0xb0b8d0, glyph: 'M' },
  { id: 'napalm', name: 'Napalm Rounds', desc: 'Artillery attacks burn their main target.', color: 0xff6a00, glyph: '~' },
  { id: 'ablative', name: 'Ablative Armor', desc: 'Your starting front ship takes 2 less per hit.', color: 0x9aa8c8, glyph: '=' },
  { id: 'gyro', name: 'Veteran Gyros', desc: 'Level 3 ships +3 ATK and +6 HP.', color: 0xffc040, glyph: 'G' },
  { id: 'beacon', name: 'Rally Beacon', desc: 'First ship lost: the rest attack 1 tick faster.', color: 0xff9f43, glyph: '!' },
  { id: 'reserves', name: 'Reserve Wing', desc: 'Down to 1 ship: your first benched ship warps in.', color: 0x7fe7ff, glyph: '>' },
  { id: 'bounty', name: 'Bounty Board', desc: '+1 scrap next round per enemy ship destroyed (max 3).', color: 0xe0b030, glyph: 'B' },
  { id: 'insurance', name: 'War Insurance', desc: 'After a loss: +4 scrap next round.', color: 0x8ad0ff, glyph: 'I' },
  { id: 'dice', name: 'Loaded Dice', desc: 'Your first 2 rerolls each round are free.', color: 0xf0f0f0, glyph: 'D' },
];

/** Boss relics: only offered for beating a Gauntlet boss. Never in normal reward offers. */
export const BOSS_RELICS: RelicDef[] = [
  { id: 'b_crown', name: "Admiral's Crown", desc: 'All ships +2 ATK and +3 HP.', color: 0xffb030, glyph: 'W' },
  { id: 'b_hive', name: 'Hive Core', desc: 'Launch 2 extra 3/3 fighters each battle.', color: 0xff4fb0, glyph: 'H' },
  { id: 'b_aegis', name: 'Citadel Grid', desc: 'All ships start with a shield.', color: 0x3dffd0, glyph: 'G' },
  { id: 'b_maw', name: 'Void Heart', desc: 'All ships heal for a third of the damage they deal.', color: 0xb040ff, glyph: 'V' },
  { id: 'b_warp', name: 'Warp Core', desc: 'All ships attack 1 tick faster (min 2).', color: 0x7fe7ff, glyph: 'Z' },
];

export const RELIC_MAP: Record<string, RelicDef> = Object.fromEntries([...RELICS, ...BOSS_RELICS].map((r) => [r.id, r]));

export const count = (relics: readonly string[], id: string) => relics.filter((r) => r === id).length;
