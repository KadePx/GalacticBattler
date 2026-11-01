// Roguelike event cards. One may turn up each morning; every choice has a cost or a risk.
import { BUILD, BuildKind, DAY_LEN, JOBS, MAP_W, OMENS, RELICS, ROCK_STONE, T_BUSH, T_GRASS, T_ROCK, BUSH_BERRIES, UPGRADES } from './defs';
import { refillCharters } from './goals';
import { bldGrid, computeFlow, keepCenter } from './map';
import {
  addMem, addMemAll, addRelic, arrive, grantRelic, makeMerchant, makeWave, newName, rollTraits, season, toast,
} from './sim';
import { Game, hasBuff, hasRelic, idx, inMap, pick, rand, randInt, Settler } from './state';

export interface Choice { label: string; hint?: string; ok?: boolean; act: () => string; }
export interface EventDef {
  id: string;
  title: string;
  icon: string; // short glyph shown on the card
  weight: (g: Game) => number;
  setup?: (g: Game) => Record<string, number | string>;
  text: (g: Game, d: Record<string, number | string>) => string;
  choices: (g: Game, d: Record<string, number | string>) => Choice[];
  chainOnly?: boolean; // only appears as a follow-up
}

const S = (g: Game, id: number | string) => g.settlers.find((s) => s.id === Number(id));
const fighters = (g: Game) => g.settlers.filter((s) => JOBS[s.job].combat && !s.inside && s.away <= 0);
const workers = (g: Game) => g.settlers.filter((s) => !JOBS[s.job].combat && s.away <= 0 && s.sick <= 0);
function hurt(s: Settler, f: number) { s.hp = Math.max(1, Math.round(s.hp - s.maxHp * f)); addMem(s, 'hurt'); }

function placeNear(g: Game, terr: number, n: number, amount: number, minD: number, maxD: number) {
  const kc = keepCenter(g);
  let placed = 0;
  for (let t = 0; t < 400 && placed < n; t++) {
    const x = randInt(g, MAP_W), y = randInt(g, g.terrain.length / MAP_W);
    const i = idx(x, y);
    const d = Math.hypot(x - kc.x, y - kc.y);
    if (!inMap(x, y) || g.terrain[i] !== T_GRASS || bldGrid[i] || d < minD || d > maxD) continue;
    if (g.entries.some((e) => Math.abs(e.x - x) < 2 && Math.abs(e.y - y) < 2)) continue;
    g.terrain[i] = terr;
    g.amount[i] = amount;
    placed++;
  }
  computeFlow(g);
  return placed;
}

export const EVENTS: EventDef[] = [
  {
    id: 'merchant', title: 'A merchant caravan', icon: '$',
    weight: (g) => (g.blds.some((b) => b.kind === 'market' && b.done) ? 1 : 3),
    text: () => 'Three wagons creak up the road, flying a guild pennant. The merchant offers to set up shop for the day: trade goods, curiosities, maybe even a sellsword or two.',
    choices: (g) => [
      { label: 'Open the gates', hint: 'Trade with them today', act: () => { g.merchant = makeMerchant(g); return 'The caravan sets up beside the keep. Open the market panel to see their wares.'; } },
      { label: 'Wave them on', act: () => 'The wagons roll on toward the next town.' },
    ],
  },
  {
    id: 'wounded', title: 'A wounded traveller', icon: '+',
    weight: () => 2,
    setup: (g) => ({ name: newName(g) }),
    text: (_, d) => `A traveller named ${d.name} staggers out of the treeline, an arrow in their shoulder. Goblins, they say, two valleys over.`,
    choices: (g, d) => [
      { label: 'Take them in', hint: '8 food', ok: g.res.food >= 8, act: () => { g.res.food -= 8; const s = arrive(g, String(d.name), rollTraits(g), 'idle'); hurt(s, 0.6); addMemAll(g, 'generous'); return `${d.name} is bandaged and given a cot. They'd like to stay, once they can stand.`; } },
      { label: 'Bread and directions', hint: '3 food', ok: g.res.food >= 3, act: () => { g.res.food -= 3; addMemAll(g, 'generous'); if (rand(g) < 0.4) { g.res.gold += 12; return `${d.name} presses a few coins into your hand before limping on. (+12 gold)`; } return `${d.name} thanks you and limps on toward the coast.`; } },
      { label: 'Turn them away', act: () => { addMemAll(g, 'callous'); return 'The gate stays shut. Nobody looks anyone in the eye at supper.'; } },
    ],
  },
  {
    id: 'wolves', title: 'Wolves in the woods', icon: 'W',
    weight: (g) => (season(g) === 'winter' || season(g) === 'autumn' ? 3 : 1),
    text: () => 'Something has been taking the woodcutters\' lunches, and last night it howled. A pack has moved into the forest.',
    choices: (g) => {
      const f = fighters(g)[0];
      return [
        { label: f ? `Send ${f.name} to hunt them` : 'Hunt them (needs a fighter)', ok: !!f, hint: 'Risky', act: () => {
          if (rand(g) < 0.7) { g.res.food += 15; g.res.gold += 8; f!.xp += 2; return `${f!.name} comes back at noon dragging pelts and venison. (+15 food, +8 gold)`; }
          hurt(f!, 0.6); g.buffs.push({ id: 'wolves', days: 1 }); return `${f!.name} limps home badly mauled. The wolves are still out there; woodcutting is slow today.`;
        } },
        { label: 'Keep clear of the trees', hint: 'Woodcutting halved today', act: () => { g.buffs.push({ id: 'wolves', days: 1 }); return 'The woodcutters stick close to the hold today.'; } },
      ];
    },
  },
  {
    id: 'orchard', title: 'A wild orchard', icon: '*',
    weight: (g) => (season(g) === 'winter' ? 0 : 2),
    text: () => 'A forager stumbles on an overgrown orchard on the far ridge, branches sagging with fruit.',
    choices: (g) => [
      { label: 'Strip it bare', hint: '+20 food', act: () => { g.res.food += 20; return 'Baskets of apples and plums fill the keep. (+20 food)'; } },
      { label: 'Take cuttings home', hint: 'New berry bushes', act: () => { const n = placeNear(g, T_BUSH, 4, BUSH_BERRIES, 5, 10); return `The cuttings take root near the hold: ${n} new berry bushes.`; } },
    ],
  },
  {
    id: 'storm', title: 'Storm clouds', icon: '~',
    weight: (g) => (season(g) === 'summer' || season(g) === 'autumn' ? 2 : 1),
    text: () => 'The sky to the west has gone the colour of a bruise. A big storm will hit by midday.',
    choices: (g) => [
      { label: 'Batten everything down', hint: '10 wood', ok: g.res.wood >= 10, act: () => { g.res.wood -= 10; return 'Shutters nailed, roofs roped. The storm howls past without doing much harm.'; } },
      { label: 'Ride it out', hint: 'Risky', act: () => {
        const list = g.blds.filter((b) => b.kind !== 'keep' && b.done && b.kind !== 'flag').sort(() => rand(g) - 0.5).slice(0, 3);
        for (const b of list) b.hp = Math.max(1, b.hp - b.maxHp * 0.45);
        g.res.wood += 12;
        return `The storm tears at ${list.length} structures; your builders have repairs to do. At least it brought down some deadwood. (+12 wood)`;
      } },
    ],
  },
  {
    id: 'defector', title: 'A goblin under a white rag', icon: 'g',
    weight: (g) => (g.day >= 4 ? 1.5 : 0),
    text: () => 'A scrawny goblin waves a filthy rag from the trail. He says his warband kicked him out, and for a warm meal he\'ll tell you where they plan to strike.',
    choices: (g) => [
      { label: 'Feed him and listen', hint: 'Weaker raids for 3 nights; the settlers won\'t like it', act: () => { g.buffs.push({ id: 'defector', days: 3 }); addMemAll(g, 'distrust'); chain(g, 'grubnik', 4); return 'Grubnik eats like a wolf and draws maps in the dirt. Raids will be smaller for a while, but nobody sleeps easy with him in the stable.'; } },
      { label: 'Pay him off', hint: '10 gold', ok: g.res.gold >= 10, act: () => { g.res.gold -= 10; g.buffs.push({ id: 'defector', days: 1 }); return 'He bites the coins, mutters something about the north trail, and scurries off. Tonight should be lighter.'; } },
      { label: 'Run him off', act: () => 'He flees into the bracken, shouting rude things in goblin.' },
    ],
  },
  {
    id: 'fever', title: 'Fever', icon: '!',
    weight: (g) => (g.settlers.length >= 4 && !g.settlers.some((s) => s.sick > 0) ? 1.5 : 0),
    setup: (g) => ({ sid: pick(g, g.settlers).id }),
    text: (g, d) => `${S(g, d.sid)?.name ?? 'Someone'} woke up shivering and flushed. If it spreads through the huts it could lay half the hold low.`,
    choices: (g, d) => [
      { label: 'Buy herbs', hint: '15 gold', ok: g.res.gold >= 15, act: () => { g.res.gold -= 15; return `A bitter tea and a day in bed. ${S(g, d.sid)?.name ?? 'They'} will be fine.`; } },
      { label: 'Let it run its course', hint: 'Might spread', act: () => { const s = S(g, d.sid); if (s) { s.sick = 160; addMem(s, 'sick'); } return `${s?.name ?? 'They'} will work at half pace until the fever breaks. A healer would help.`; } },
    ],
  },
  {
    id: 'tax', title: "The crown's tax collector", icon: 'T',
    weight: (g) => (g.res.gold >= 150 ? 3 : g.res.gold >= 25 ? 1.5 : 0),
    setup: (g) => ({ due: Math.max(10, Math.round(g.res.gold * 0.3)) }),
    text: (_, d) => `A man in a feathered hat rides in with two bored soldiers and a ledger. The crown requires ${d.due} gold for "road maintenance".`,
    choices: (g, d) => [
      { label: 'Pay up', hint: `${d.due} gold`, act: () => { g.res.gold -= Number(d.due); addMemAll(g, 'taxed'); return 'He counts it twice and rides off. The roads remain terrible.'; } },
      { label: 'Wine and dine him', hint: '15 food', ok: g.res.food >= 15, act: () => { g.res.food -= 15; return 'After the third roast chicken he decides the hold is "exempt this season".'; } },
      { label: 'Refuse', hint: 'Markets will shun you', act: () => { g.buffs.push({ id: 'embargo', days: 4 }); return 'He promises the guilds will hear of this. Expect worse prices for a few days.'; } },
    ],
  },
  {
    id: 'cart', title: 'An abandoned cart', icon: 'C',
    weight: () => 2,
    text: () => 'A cart sits overturned on the east road, one wheel snapped, no driver in sight. Crates of goods are scattered in the mud.',
    choices: (g) => [
      { label: 'Haul it all in', hint: 'Whoever ambushed it may still be about', act: () => { const w = 10 + randInt(g, 15), s = 5 + randInt(g, 12), gold = 5 + randInt(g, 10); g.res.wood += w; g.res.stone += s; g.res.gold += gold; if (rand(g) < 0.35) { g.buffs.push({ id: 'ambush', days: 1 }); return `Timber, cut stone and a strongbox (+${w} wood, +${s} stone, +${gold} gold)... and goblin tracks all around it. Expect company tonight.`; } return `Timber, cut stone and a strongbox. (+${w} wood, +${s} stone, +${gold} gold)`; } },
      { label: 'Look for the owner', act: () => { addMemAll(g, 'generous'); if (rand(g) < 0.6) { g.res.gold += 20; return 'A grateful merchant turns up by noon and pays a finder\'s fee. (+20 gold)'; } return 'Nobody comes for it. Odd. You leave it be.'; } },
    ],
  },
  {
    id: 'feast', title: 'Feast day', icon: 'F',
    weight: (g) => (season(g) === 'autumn' ? 3 : g.res.food >= 40 ? 1 : 0),
    text: () => 'The settlers want to mark the season with a proper feast: long tables, roast meat, a barrel or two.',
    choices: (g) => [
      { label: 'Hold the feast', hint: '20 food', ok: g.res.food >= 20, act: () => { g.res.food -= 20; addMemAll(g, 'feast'); for (const s of g.settlers) s.needs.hunger = 100; return 'Songs, speeches and a lot of gravy. Spirits are high.'; } },
      { label: 'Not this year', act: () => 'The tables stay stacked in the barn.' },
    ],
  },
  {
    id: 'map', title: 'A tattered map', icon: 'X',
    weight: (g) => (workers(g).length >= 2 ? 1.5 : 0),
    setup: (g) => ({ sid: pick(g, workers(g)).id }),
    text: (g, d) => `${S(g, d.sid)?.name ?? 'A settler'} found a scrap of map in an old boot. It marks a spot in the hills with a crude X.`,
    choices: (g, d) => [
      { label: `Send ${S(g, d.sid)?.name ?? 'them'} to dig`, hint: 'Gone all day', act: () => {
        const s = S(g, d.sid);
        if (!s) return 'Never mind.';
        s.away = DAY_LEN * 0.8; s.task = null; s.path = []; s.x = -10; s.y = -10;
        const r = rand(g);
        if (r < 0.45) { g.res.gold += 40; return `${s.name} sets off with a shovel... and will be back at dusk with a pot of old coins. (+40 gold)`; }
        if (r < 0.7) { const rel = grantRelic(g); return rel ? `${s.name} will come back with something strange: ${RELICS[rel].name}!` : `${s.name} digs up a rusty helmet. Nothing more.`; }
        hurt(s, 0.5); return `${s.name} finds only a wasp nest. They'll be back at dusk, swollen and grumpy.`;
      } },
      { label: 'Use it to light the fire', act: () => 'It burns nicely.' },
    ],
  },
  {
    id: 'refugees', title: 'Refugees on the road', icon: 'R',
    weight: (g) => (g.day >= 3 ? 1.5 : 0),
    setup: (g) => ({ a: newName(g), b: newName(g) }),
    text: (_, d) => `Two families' worth of survivors from a burned village: ${d.a}, ${d.b} and some children who'll go on to kin. ${d.a} and ${d.b} would stay and work.`,
    choices: (g, d) => [
      { label: 'Take both in', hint: '16 food', ok: g.res.food >= 16, act: () => { g.res.food -= 16; arrive(g, String(d.a), rollTraits(g), 'idle'); arrive(g, String(d.b), rollTraits(g), 'idle'); addMemAll(g, 'generous'); return `${d.a} and ${d.b} join the hold. Find them beds and jobs.`; } },
      { label: `Take ${d.a} only`, hint: '8 food', ok: g.res.food >= 8, act: () => { g.res.food -= 8; arrive(g, String(d.a), rollTraits(g), 'idle'); return `${d.a} joins the hold.`; } },
      { label: 'Point them down the road', act: () => { addMemAll(g, 'callous'); return 'They trudge on. The children wave.'; } },
    ],
  },
  {
    id: 'smith', title: 'A travelling smith', icon: 'S',
    weight: (g) => (!hasRelic(g, 'warhorn') || !hasRelic(g, 'axeheads') ? 1.2 : 0),
    text: () => 'A smith with a cart-mounted forge offers her services for the day, for a price.',
    choices: (g) => [
      { label: 'Re-temper the weapons', hint: '30 gold: guards +25% damage', ok: g.res.gold >= 30 && !hasRelic(g, 'warhorn'), act: () => { g.res.gold -= 30; addRelic(g, 'warhorn'); return 'Every blade and arrowhead in the hold gets a wicked new edge. (Old war horn relic)'; } },
      { label: 'Fit iron axe heads', hint: '25 gold: gathering +30%', ok: g.res.gold >= 25 && !hasRelic(g, 'axeheads'), act: () => { g.res.gold -= 25; addRelic(g, 'axeheads'); return 'The woodcutters and quarriers are delighted. (Iron axe heads relic)'; } },
      { label: 'No thanks', act: () => 'She shrugs and rattles off.' },
    ],
  },
  {
    id: 'shrine', title: 'A mossy shrine', icon: '^',
    weight: () => 1.2,
    text: () => 'Clearing brush, someone uncovers a little stone shrine. The carved face is worn smooth, but the offering bowl looks used.',
    choices: (g) => [
      { label: 'Leave an offering', hint: '10 gold', ok: g.res.gold >= 10, act: () => { g.res.gold -= 10; addMemAll(g, 'shrine'); if (rand(g) < 0.3) { const r = grantRelic(g); if (r) return `A warm wind, and something glints in the bowl: ${RELICS[r].name}!`; } return 'The air feels lighter. Everyone walks a little taller today.'; } },
      { label: 'Pray for free', act: () => { if (rand(g) < 0.55) { addMemAll(g, 'shrine'); return 'A sense of peace settles over the hold.'; } addMemAll(g, 'cursed'); return 'A cold draught, and the crows won\'t stop staring. Nobody feels right.'; } },
      { label: 'Leave it alone', act: () => 'You cover it back up with moss.' },
    ],
  },
  {
    id: 'rats', title: 'Rats in the stores', icon: 'r',
    weight: (g) => (g.res.food >= 25 ? 1.5 : 0),
    text: (g) => `Something has been gnawing at the grain sacks. If nothing is done you could lose a third of your ${Math.floor(g.res.food)} food.`,
    choices: (g) => [
      { label: 'Adopt a mouser', hint: '6 gold', ok: g.res.gold >= 6, act: () => { g.res.gold -= 6; return 'A scarred tomcat named Sir Whiskers takes up residence. Problem solved.'; } },
      { label: 'Set traps', hint: 'Lose a little', act: () => { const l = Math.floor(g.res.food * 0.1); g.res.food -= l; return `The traps catch most of them. (-${l} food)`; } },
      { label: 'Ignore it', act: () => { const l = Math.floor(g.res.food * 0.33); g.res.food -= l; return `The rats feast. (-${l} food)`; } },
    ],
  },
  {
    id: 'drums', title: 'War drums in the hills', icon: 'D',
    weight: (g) => (g.day >= 5 ? 1.2 : 0),
    text: () => 'Drums have been booming in the hills since dawn. The goblins are gathering a bigger warband for tonight.',
    choices: (g) => {
      const a = g.settlers.find((s) => s.job === 'archer' && s.away <= 0);
      return [
        { label: 'Brace for it', hint: 'Tonight +40% goblins, double gold', act: () => { g.buffs.push({ id: 'drums', days: 1 }); return 'Walls checked, arrows counted. If they come in force, they\'ll pay for it.'; } },
        { label: a ? `Send ${a.name} to scatter them` : 'Scatter them (needs an archer)', ok: !!a, hint: 'Risky', act: () => {
          if (rand(g) < 0.6) { a!.xp += 2; return `${a!.name} puts a fire arrow through the big drum. The warband scatters; tonight is a normal raid.`; }
          hurt(a!, 0.5); g.buffs.push({ id: 'drums', days: 1 }); return `${a!.name} is spotted and barely makes it back. The drums keep booming.`;
        } },
      ];
    },
  },
  {
    id: 'bard', title: 'A wandering bard', icon: 'B',
    weight: () => 1.3,
    text: () => 'A bard with a battered lute asks for a hearth and an audience. They know three songs about goblins, two of them rude.',
    choices: (g) => [
      { label: 'Pay for a show', hint: '10 gold', ok: g.res.gold >= 10, act: () => { g.res.gold -= 10; addMemAll(g, 'music'); return 'The whole hold sings along to "The Goblin Who Ate His Own Boot".'; } },
      { label: 'Supper for a song', hint: '5 food', ok: g.res.food >= 5, act: () => { g.res.food -= 5; addMemAll(g, 'music'); return 'A fine evening of songs by the hearth.'; } },
      { label: 'No thank you', act: () => 'The bard sighs theatrically and moves on.' },
    ],
  },
  {
    id: 'rockslide', title: 'Rockslide', icon: 'o',
    weight: (g) => (g.res.stone < 30 ? 1.5 : 0.6),
    text: () => 'A rumble in the night: part of the ridge came down. Good building stone is lying everywhere.',
    choices: (g) => [
      { label: 'Quarry it', act: () => { const n = placeNear(g, T_ROCK, 5, ROCK_STONE, 6, 14); return `${n} fresh boulders ready for the quarriers.`; } },
      { label: 'Sell the rubble to a mason', hint: '+15 gold', act: () => { g.res.gold += 15; return 'A mason from the valley hauls it off and pays well. (+15 gold)'; } },
    ],
  },
  {
    id: 'coldsnap', title: 'A bitter cold snap', icon: '#',
    weight: (g) => (season(g) === 'winter' ? 3 : season(g) === 'autumn' ? 1 : 0),
    text: () => 'Frost on the inside of the shutters. Today will be brutally cold, and tonight worse.',
    choices: (g) => [
      { label: 'Stoke every hearth', hint: '15 wood', ok: g.res.wood >= 15, act: () => { g.res.wood -= 15; return 'Chimneys roar all day. Everyone keeps their fingers.'; } },
      { label: 'Bundle up', hint: 'Settlers lose warmth twice as fast', act: () => { g.buffs.push({ id: 'coldsnap', days: 1 }); return 'Extra scarves all round. It\'s going to be a hard one.'; } },
    ],
  },
  {
    id: 'scouts', title: 'Goblin scouts', icon: '?',
    weight: (g) => (g.day >= 3 && fighters(g).length >= 2 ? 1.2 : 0),
    text: () => 'Your lookouts spot three goblin scouts sketching your walls from the treeline.',
    choices: (g) => [
      { label: 'Ambush them', hint: 'Fighters may get hurt', act: () => {
        const fs = fighters(g).slice(0, 2);
        if (rand(g) < 0.65) { g.res.gold += 10; for (const f of fs) f.xp += 1; return 'The scouts never make it home. Their purses do. (+10 gold)'; }
        hurt(fs[0], 0.4); return `One gets away and ${fs[0].name} takes a knife in the arm.`;
      } },
      { label: 'Let them look', act: () => { g.buffs.push({ id: 'drums', days: 1 }); return 'They slink off. Tonight\'s raid will be bigger, but so will the spoils.'; } },
    ],
  },
  {
    id: 'blueprint', title: 'An old engineer', icon: 'E',
    weight: (g) => ((Object.keys(BUILD) as (keyof typeof BUILD)[]).some((k) => BUILD[k].blueprint && !g.blueprints.includes(k)) ? 1 : 0),
    text: () => 'A retired siege engineer passing through offers to sketch you some plans, for the price of a good dinner and some coin.',
    choices: (g) => [
      { label: 'Buy plans', hint: '20 gold + 6 food', ok: g.res.gold >= 20 && g.res.food >= 6, act: () => {
        g.res.gold -= 20; g.res.food -= 6;
        const missing = (Object.keys(BUILD) as (keyof typeof BUILD)[]).filter((k) => BUILD[k].blueprint && !g.blueprints.includes(k));
        const bp = pick(g, missing); g.blueprints.push(bp); return `By candlelight, the plans for a ${BUILD[bp].name.toLowerCase()} take shape. (Blueprint learned)`;
      } },
      { label: 'Just dinner', hint: '6 food', ok: g.res.food >= 6, act: () => { g.res.food -= 6; addMemAll(g, 'music'); return 'He tells war stories until midnight. Everyone enjoys it.'; } },
      { label: 'Send him on', act: () => 'He tips his hat and goes.' },
    ],
  },
];

const unpromoted = (g: Game) => fighters(g).filter((s) => !s.promo);
const peekOmen = (g: Game) => (g.nextOmen ??= pick(g, Object.keys(OMENS)));

EVENTS.push(
  {
    id: 'drillmaster', title: 'A retired drillmaster', icon: 'M',
    weight: (g) => (unpromoted(g).length ? 1.2 : 0),
    setup: (g) => ({ sid: pick(g, unpromoted(g)).id }),
    text: (g, d) => `A one-eyed sergeant offers to whip ${S(g, d.sid)?.name ?? 'one of your fighters'} into shape. "Give me a day and some coin."`,
    choices: (g, d) => [
      { label: 'Hire him', hint: '20 gold: +6 experience, but they\'ll be exhausted', ok: g.res.gold >= 20, act: () => { g.res.gold -= 20; const s = S(g, d.sid); if (!s) return 'Never mind.'; s.xp += 6; s.needs.rest = 20; return `${s.name} is a wreck by nightfall, but ready for promotion.`; } },
      { label: 'Drill everyone', hint: '10 food: +2 experience for every fighter; sore all round', ok: g.res.food >= 10, act: () => { g.res.food -= 10; for (const f of fighters(g)) { f.xp += 2; addMem(f, 'hurt'); } return 'Blisters all round, but they move like soldiers now.'; } },
      { label: 'Send him off', act: () => 'He spits and limps on.' },
    ],
  },
  {
    id: 'surveyor', title: 'A guild surveyor', icon: 'U',
    weight: (g) => (g.blds.some((b) => UPGRADES[b.kind] && b.done && (b.level ?? 0) < UPGRADES[b.kind]!.length) ? 1 : 0),
    text: () => 'A surveyor with brass instruments offers to oversee your upgrades today, cheaply, if you let her sketch the hold for the guild.',
    choices: (g) => [
      { label: 'Accept', hint: 'Upgrades half price today; raids 20% larger for 2 nights (her maps leak)', act: () => { g.buffs.push({ id: 'survey', days: 1 }, { id: 'leak', days: 2 }); return 'She works fast. Her maps will sell well, too.'; } },
      { label: 'Pay for discretion', hint: '25 gold: half-price upgrades, no maps', ok: g.res.gold >= 25, act: () => { g.res.gold -= 25; g.buffs.push({ id: 'survey', days: 1 }); return 'Her notebook goes in the fire.'; } },
      { label: 'No thanks', act: () => 'She packs up her brass.' },
    ],
  },
  {
    id: 'seer', title: 'The hedge-seer', icon: 'O',
    weight: (g) => (g.day > 18 ? 1.3 : 0),
    text: () => 'An old woman reads goblin bones by the gate. "I can see the next blood night. Or turn it aside, for a price."',
    choices: (g) => [
      { label: 'Read the bones', hint: '5 food: learn the next omen', ok: g.res.food >= 5, act: () => { g.res.food -= 5; const o = OMENS[peekOmen(g)]; return `"${o.name}," she croaks. ${o.desc}`; } },
      { label: 'Turn the omen aside', hint: '40 gold: no omens for a while; settlers uneasy', ok: g.res.gold >= 40, act: () => { g.res.gold -= 40; g.buffs.push({ id: 'noomen', days: 6 }); addMemAll(g, 'cursed'); return 'She burns something that screams. The sky feels lighter.'; } },
      { label: 'Chase her off', act: () => 'She cackles all the way down the road.' },
    ],
  },
  {
    id: 'envoy', title: "The crown's envoy", icon: 'K',
    weight: (g) => ((g.charters?.active.length ?? 0) > 0 && g.day >= 6 && !hasBuff(g, 'oath') ? 1.2 : 0),
    text: () => 'A herald reads a proclamation: holds that meet their charters will be remembered. He offers to press yours forward.',
    choices: (g) => [
      { label: 'Swear an oath', hint: 'Next charter pays double; fail within 5 days and pay a fine', act: () => { g.buffs.push({ id: 'oath', days: 5 }); g.stats.oathKept = false; chain(g, 'envoy_back', 5); return 'Your mark goes on the scroll.'; } },
      { label: 'Swap a charter', hint: '10 gold: replace the hardest active charter', ok: g.res.gold >= 10, act: () => { g.res.gold -= 10; const c = g.charters!; const gone = c.active.pop(); if (gone) { c.done.push(gone); refillCharters(g); c.done = c.done.filter((x) => x !== gone); } return 'He crosses one out and writes another.'; } },
      { label: 'Decline', act: () => 'He sniffs and rides on.' },
    ],
  },
  {
    id: 'grubnik', chainOnly: true, title: 'Grubnik comes back', icon: 'g', weight: () => 1,
    text: () => 'Grubnik is back with three cousins, all very hungry. "Good goblins. Work hard. Fight warband."',
    choices: (g) => [
      { label: 'Hire the cousins', hint: '30 food: 3 goblin militia; the settlers will be furious', ok: g.res.food >= 30, act: () => { g.res.food -= 30; for (const n of ['Snik', 'Mog', 'Bilge']) arrive(g, n, ['brave'], 'militia'); addMemAll(g, 'distrust'); addMemAll(g, 'callous'); return 'Three grinning goblins take up spears. Nobody else will eat at their table.'; } },
      { label: 'Just Grubnik', hint: '10 food: raids stay weaker 3 more nights', ok: g.res.food >= 10, act: () => { g.res.food -= 10; g.buffs.push({ id: 'defector', days: 3 }); return 'The cousins sulk off. Grubnik draws more maps.'; } },
      { label: 'Throw them all out', hint: 'They\'ll be back tonight, angry', act: () => { g.buffs.push({ id: 'ambush', days: 1 }); return 'Grubnik swears revenge, loudly and at length.'; } },
    ],
  },
  {
    id: 'envoy_back', chainOnly: true, title: 'The herald returns', icon: 'K', weight: () => 1,
    text: (g) => (g.stats.oathKept ? 'The herald is back, beaming. The crown is pleased with your hold.' : 'The herald is back. Your oath scroll is still blank.'),
    choices: (g) => (g.stats.oathKept
      ? [
        { label: 'Accept the honour', hint: '+20 gold and a proud hold', act: () => { g.res.gold += 20; addMemAll(g, 'victory'); return 'Bunting everywhere.'; } },
        { label: 'Ask for plans instead', hint: 'A blueprint (or 25 gold)', act: () => { const m = (Object.keys(BUILD) as BuildKind[]).filter((k) => BUILD[k].blueprint && !g.blueprints.includes(k)); if (m.length) { const bp = pick(g, m); g.blueprints.push(bp); return `He unrolls the plans for a ${BUILD[bp].name.toLowerCase()}.`; } g.res.gold += 25; return 'You already have every plan he carries. He pays you instead. (+25 gold)'; } },
      ]
      : [
        { label: 'Pay the fine', hint: '30 gold', act: () => { g.res.gold = Math.max(0, g.res.gold - 30); g.buffs = g.buffs.filter((b) => b.id !== 'oath'); return 'Paid. He writes "disappointing" in neat letters.'; } },
        { label: 'Ask for more time', hint: '2 more days; the fine will stand', act: () => { g.buffs = g.buffs.filter((b) => b.id !== 'oath'); g.buffs.push({ id: 'oath', days: 2 }); chain(g, 'envoy_back', 2); return 'He taps the scroll meaningfully.'; } },
      ]),
  },
);

export function eventDef(id: string) { return EVENTS.find((e) => e.id === id)!; }

/** Maybe queue an event card for this morning. */
/** Queue a follow-up event for a later morning. */
export function chain(g: Game, id: string, inDays: number, data: Record<string, number | string> = {}) {
  (g.pending ??= []).push({ id, day: g.day + inDays, data });
}

export function rollEvent(g: Game) {
  g.event = null;
  if (g.day < 2) return;
  const due = (g.pending ?? []).findIndex((p) => p.day <= g.day);
  if (due >= 0) {
    const p = g.pending!.splice(due, 1)[0];
    const def = EVENTS.find((e) => e.id === p.id);
    if (def) { g.event = { id: p.id, data: { ...(def.setup ? def.setup(g) : {}), ...(p.data ?? {}) } }; return; }
  }
  const chance = g.day === 2 ? 1 : 0.65;
  if (rand(g) > chance) return;
  const recent = g.eventsSeen.slice(-8);
  let pool = EVENTS.filter((e) => !e.chainOnly).map((e) => ({ e, w: recent.includes(e.id) ? 0 : e.weight(g) })).filter((p) => p.w > 0);
  if (g.day === 2) pool = pool.filter((p) => p.e.id === 'merchant'); // introduce trading early
  const total = pool.reduce((a, p) => a + p.w, 0);
  if (!total) return;
  let r = rand(g) * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) {
      g.event = { id: p.e.id, data: p.e.setup ? p.e.setup(g) : {} };
      g.eventsSeen.push(p.e.id);
      return;
    }
  }
}

export function resolveEvent(g: Game, choice: number): string {
  if (!g.event) return '';
  const def = eventDef(g.event.id);
  const ch = def.choices(g, g.event.data)[choice];
  if (!ch || ch.ok === false) return '';
  const out = ch.act();
  if (g.phase === 'day') g.wave = makeWave(g, g.day);
  g.event = null;
  g.stats.events++;
  void toast;
  return out;
}
