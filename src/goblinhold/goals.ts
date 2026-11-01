// Hold charters: three standing goals at a time, each with a reward. They give every day something to aim for.
import { BUILD, BuildKind, Cost, RELICS, RES_ORDER, UPGRADES } from './defs';
import { addRelic, bedCount, costText, emit, grantRelic, mood, season, toast } from './sim';
import { hasBuff } from './state';
import { Game, pick, rand } from './state';

export interface Charter {
  id: string;
  text: string;
  check: (g: Game) => boolean;
  reward: Cost | 'relic' | 'blueprint';
  /** progress text like "3/8" */
  prog?: (g: Game) => string;
}

const count = (g: Game, k: BuildKind | BuildKind[]) => g.blds.filter((b) => b.done && (Array.isArray(k) ? k.includes(b.kind) : b.kind === k)).length;

export const CHARTERS: Charter[] = [
  { id: 'beds', text: 'Give everyone a bed', check: (g) => g.settlers.length <= bedCount(g), reward: { wood: 15, food: 10 }, prog: (g) => `${bedCount(g)}/${g.settlers.length} beds` },
  { id: 'quarry', text: 'Stockpile 30 stone', check: (g) => g.res.stone >= 30, reward: { gold: 15 }, prog: (g) => `${Math.floor(g.res.stone)}/30` },
  { id: 'market', text: 'Build a market', check: (g) => count(g, 'market') > 0, reward: { gold: 15 } },
  { id: 'walls', text: 'Raise 12 tiles of wall', check: (g) => count(g, ['wall', 'stonewall']) >= 12, reward: { wood: 25 }, prog: (g) => `${count(g, ['wall', 'stonewall'])}/12` },
  { id: 'pop8', text: 'Grow the hold to 8 settlers', check: (g) => g.settlers.length >= 8, reward: { food: 25 }, prog: (g) => `${g.settlers.length}/8` },
  { id: 'promote', text: 'Promote a fighter', check: (g) => g.settlers.some((s) => !!s.promo), reward: { gold: 15 } },
  { id: 'towers', text: 'Man 3 towers or ballistas', check: (g) => g.phase === 'night' && g.blds.filter((b) => (b.kind === 'tower' || b.kind === 'ballista') && b.done && b.occupant).length >= 3, reward: { stone: 15, gold: 10 }, prog: (g) => `${count(g, ['tower', 'ballista'])}/3 built` },
  { id: 'assault', text: 'Hold an assault night with nobody lost', check: (g) => (g.stats.cleanAssaults ?? 0) > 0, reward: 'blueprint' },
  { id: 'fortify', text: 'Fortify the keep', check: (g) => (g.blds.find((b) => b.kind === 'keep')?.level ?? 0) > 0, reward: 'relic' },
  { id: 'kills50', text: 'Slay 50 goblins', check: (g) => g.stats.kills >= 50, reward: { gold: 25 }, prog: (g) => `${g.stats.kills}/50` },
  { id: 'winter', text: 'Enter winter with 80 food stored', check: (g) => season(g) === 'winter' && g.res.food >= 80 && g.phase === 'day', reward: 'relic', prog: (g) => `${Math.floor(g.res.food)}/80` },
  { id: 'mood', text: 'Reach an average mood of 70', check: (g) => g.settlers.length > 0 && g.settlers.reduce((a, s) => a + mood(g, s), 0) / g.settlers.length >= 70, reward: { gold: 20 } },
  { id: 'trader', text: 'Make 8 trades', check: (g) => g.stats.traded >= 8, reward: { gold: 10, food: 15 }, prog: (g) => `${g.stats.traded}/8` },
  { id: 'gardens', text: 'Plant 2 gardens', check: (g) => count(g, 'garden') >= 2, reward: { food: 15 }, prog: (g) => `${count(g, 'garden')}/2` },
  { id: 'boss', text: 'Slay a warchief', check: (g) => g.stats.bosses > 0, reward: 'relic' },
  { id: 'pop14', text: 'Grow the hold to 14 settlers', check: (g) => g.settlers.length >= 14, reward: 'blueprint', prog: (g) => `${g.settlers.length}/14` },
  { id: 'fortress', text: 'Raise the keep into a fortress', check: (g) => (g.blds.find((b) => b.kind === 'keep')?.level ?? 0) >= 2, reward: { gold: 50 } },
  { id: 'year', text: 'Survive a whole year', check: (g) => g.day > 20, reward: { gold: 40, stone: 30 } },
  { id: 'upgrades', text: 'Fully upgrade 4 defenses', check: (g) => g.blds.filter((b) => UPGRADES[b.kind] && (b.level ?? 0) >= UPGRADES[b.kind]!.length && b.kind !== 'hut' && b.kind !== 'farm').length >= 4, reward: { gold: 40 } },
  { id: 'omen', text: 'Survive an omen night without losing a structure', check: (g) => (g.stats.omenClean ?? 0) > 0, reward: 'blueprint' },
  { id: 'promoted3', text: 'Have 3 promoted fighters', check: (g) => g.settlers.filter((s) => !!s.promo).length >= 3, reward: { gold: 30, food: 20 } },
];


export function rewardText(r: Charter['reward']) {
  if (r === 'relic') return 'a relic';
  if (r === 'blueprint') return 'a blueprint';
  return costText(r);
}

/** Keep three charters on offer, easiest first. */
export function refillCharters(g: Game) {
  if (!g.charters) g.charters = { active: [], done: [] };
  const c = g.charters;
  c.active = c.active.filter((id) => !c.done.includes(id));
  const order = CHARTERS.map((x) => x.id).filter((id) => !c.done.includes(id) && !c.active.includes(id));
  while (c.active.length < 3 && order.length) {
    // mostly in list order (roughly easy to hard), with a little shuffle
    const i = order.length > 1 && rand(g) < 0.3 ? 1 : 0;
    c.active.push(order.splice(i, 1)[0]);
  }
}

/** Award any finished charters. Returns the ones completed this call. */
export function checkCharters(g: Game): Charter[] {
  refillCharters(g);
  const done: Charter[] = [];
  for (const id of [...g.charters!.active]) {
    const ch = CHARTERS.find((x) => x.id === id);
    if (!ch || !ch.check(g)) continue;
    g.charters!.done.push(id);
    let got = rewardText(ch.reward);
    if (ch.reward === 'relic') { const r = grantRelic(g); got = r ? RELICS[r].name : '20 gold'; if (!r) g.res.gold += 20; }
    else if (ch.reward === 'blueprint') {
      const missing = (Object.keys(BUILD) as BuildKind[]).filter((k) => BUILD[k].blueprint && !g.blueprints.includes(k));
      if (missing.length) { const bp = pick(g, missing); g.blueprints.push(bp); got = `${BUILD[bp].name} blueprint`; } else { g.res.gold += 25; got = '25 gold'; }
    } else for (const r of RES_ORDER) g.res[r] += (ch.reward[r] ?? 0) * (hasBuff(g, 'oath') ? 2 : 1);
    if (hasBuff(g, 'oath') && typeof ch.reward === 'object') { g.buffs = g.buffs.filter((b) => b.id !== 'oath'); got += ' (doubled by your oath)'; g.stats.oathKept = true; }
    toast(`Charter fulfilled: ${ch.text}. Reward: ${got}.`, 'good');
    emit('charter');
    done.push(ch);
  }
  if (done.length) refillCharters(g);
  return done;
}

export { addRelic };
