// Special rewards: one-time bonuses that sometimes replace a relic on the post-battle pick.
// Their ids start with "x:" so they can sit in the same offer list as relics.

import { RELICS } from '../sim/relics';
import { rand, type RngState } from '../sim/rng';

export interface RewardDef {
  id: string;
  name: string;
  desc: string;
  color: number;
  glyph: string;
  note: string; // short line for the card's footer
}

export const REWARDS: RewardDef[] = [
  { id: 'x:recruit', name: 'Recruit Contract', desc: 'A free ship of the top tier you can buy.', color: 0x4aa3ff, glyph: '+', note: 'Matches your fleet if it can' },
  { id: 'x:drill', name: 'Combat Drills', desc: '3 fleet ships gain 1 XP and +1/+1.', color: 0xffd166, glyph: '^', note: 'Picks ships closest to a level' },
  { id: 'x:cache', name: 'Scrap Cache', desc: '+7 scrap next round.', color: 0xffe066, glyph: '&', note: 'Two extra ships next round' },
  { id: 'x:market', name: 'Black Market', desc: 'Next round: higher-tier shop and 2 free rerolls.', color: 0xc58cff, glyph: '?', note: 'Rerolls stay higher-tier' },
  { id: 'x:proto', name: 'Prototype', desc: 'An experimental tier 4 ship. Never sold in the shipyard.', color: 0xffb030, glyph: '4', note: 'Rare: only from rewards' },
  { id: 'x:repair', name: 'Hull Repair', desc: 'Repair 1 hull point.', color: 0xff5e7e, glyph: '#', note: 'Survive one more loss' },
];

export const REWARD_MAP: Record<string, RewardDef> = Object.fromEntries(REWARDS.map((r) => [r.id, r]));
export const isReward = (id: string) => id.startsWith('x:');

export interface OfferContext {
  round: number; // the round just played
  lostLast: boolean;
  canRecruit: boolean; // room on the bench or fleet
  canDrill: boolean; // a ship below max level
  canRepair: boolean; // hull below full
}

/** Relic ids the player does not own yet (stacking is allowed once the pool runs dry). */
function relicPool(owned: string[], n: number) {
  const fresh = RELICS.filter((r) => !owned.includes(r.id)).map((r) => r.id);
  return fresh.length >= n ? fresh : RELICS.map((r) => r.id);
}

/**
 * Three cards after a battle: usually three relics, but often one is a special reward.
 * After a loss a special is more likely, which gives a struggling run a way back.
 */
export function rollRewardOffer(s: RngState, owned: string[], ctx: OfferContext, n = 3): string[] {
  const pool = relicPool(owned, n);
  const out: string[] = [];
  while (out.length < n && out.length < pool.length) {
    const id = pool[Math.floor(rand(s) * pool.length)];
    if (!out.includes(id)) out.push(id);
  }
  const chance = ctx.round < 2 ? 0 : ctx.lostLast ? 0.6 : 0.35;
  if (rand(s) < chance) {
    const specials = REWARDS.filter((r) =>
      (r.id !== 'x:recruit' || ctx.canRecruit) &&
      (r.id !== 'x:proto' || (ctx.canRecruit && ctx.round >= 5)) &&
      (r.id !== 'x:drill' || ctx.canDrill) &&
      (r.id !== 'x:repair' || (ctx.canRepair && ctx.lostLast)));
    if (specials.length) out[n - 1] = specials[Math.floor(rand(s) * specials.length)].id;
  }
  return out;
}
