// Run modifiers: optional handicaps picked before a run (normal runs and the Gauntlet, not
// the daily). Each adds bonus XP, and clearing a run with one earns that modifier's badge
// for the commander you flew. Harder ones unlock at higher pilot ranks.
//
// They only change the run around the battles (scrap, shop, hull, rewards) and the enemy
// fleet you face, never the battle rules, so ghost fleets stay comparable for everyone.
// Keep this file free of game imports: the server's snapshot check uses it too.

export interface ModDef {
  id: string;
  name: string;
  desc: string;
  xp: number; // bonus XP, % of the run's XP
  rank: number; // pilot rank needed
  color: string;
}

// XP bonus follows how much each one cuts a bot player's clear rate (src/dev/modTest.ts):
// Scarce ~0%, Small Shipyard ~-30%, Tight Budget ~-35%, Pricey Rerolls ~-40%,
// Fragile / Slow Tech / Deadly ~-60%, Hardened ~-70%.
export const MODS: ModDef[] = [
  { id: 'scarce', name: 'SCARCE REWARDS', desc: 'Reward picks offer 2 choices instead of 3.', xp: 5, rank: 1, color: '#9cff3a' },
  { id: 'yard', name: 'SMALL SHIPYARD', desc: 'One fewer ship in the shipyard.', xp: 15, rank: 1, color: '#7fe7ff' },
  { id: 'budget', name: 'TIGHT BUDGET', desc: '9 scrap a round instead of 10.', xp: 20, rank: 2, color: '#ffd166' },
  { id: 'rerolls', name: 'PRICEY REROLLS', desc: 'Rerolls cost 2 scrap instead of 1.', xp: 15, rank: 2, color: '#ffb347' },
  { id: 'fragile', name: 'FRAGILE HULL', desc: 'You have 3 hull instead of 5.', xp: 35, rank: 3, color: '#ff6b6b' },
  { id: 'slowtech', name: 'SLOW TECH', desc: 'Tier 2 and 3 ships arrive 2 rounds later.', xp: 35, rank: 4, color: '#8ab4ff' },
  { id: 'deadly', name: 'DEADLY FOES', desc: 'Enemy ships have +20% ATK.', xp: 35, rank: 5, color: '#ff8ad8' },
  { id: 'tough', name: 'HARDENED FOES', desc: 'Enemy ships have +20% HP.', xp: 40, rank: 6, color: '#c58cff' },
];

export const MOD_MAP: Record<string, ModDef> = Object.fromEntries(MODS.map((m) => [m.id, m]));

/** Known modifier ids only, in list order, no repeats. */
export const cleanMods = (raw: unknown): string[] =>
  Array.isArray(raw) ? MODS.map((m) => m.id).filter((id) => raw.includes(id)) : [];

export const hasMod = (run: { mods?: string[] }, id: string) => !!run.mods?.includes(id);

/** Bonus XP for a set of modifiers, as a fraction (0.4 = +40%). */
export const modXpBonus = (mods: string[] | undefined) =>
  (mods ?? []).reduce((n, id) => n + (MOD_MAP[id]?.xp ?? 0), 0) / 100;

/** Short tags for a header line, e.g. "FRAGILE HULL + TIGHT BUDGET". */
export const modNames = (mods: string[] | undefined) => (mods ?? []).map((id) => MOD_MAP[id]?.name ?? id);

/** Enemy stat boost from HARDENED / DEADLY FOES, applied to a copy of the enemy fleet. */
export function toughenShip<T extends { atk: number; hp: number }>(s: T, mods: string[] | undefined): T {
  const hp = mods?.includes('tough') ? Math.ceil(s.hp * 1.2) : s.hp;
  const atk = mods?.includes('deadly') && s.atk > 0 ? Math.max(s.atk + 1, Math.round(s.atk * 1.2)) : s.atk;
  return { ...s, atk, hp };
}
