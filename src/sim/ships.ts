// Ship roster. Abilities and level perks are implemented in battle.ts, keyed by ship id.
//
// Sprites are pixel maps facing right (nose on the right). Hull tones come from the
// faction palette (player = steel blue, enemy = crimson); accents are per ship.
//   o outline   s hull shadow   b hull   l hull light   h highlight
//   a accent    A accent light  w window (cockpit glass)
//   e engine    E engine core   m gun metal   g gun shadow

export type ShipClass = 'strike' | 'guard' | 'artillery' | 'tech';

export interface ShipDef {
  id: string;
  name: string;
  tier: number; // 0 = not sold in the shop
  atk: number;
  hp: number;
  cd: number; // ticks between attacks
  classes: ShipClass[];
  desc: string; // keep under ~42 chars
  perks: [string, string]; // level 2 and level 3 perks, keep under ~38 chars
  accent: [string, string]; // accent, accent light
  sprite: string[];
}

export const SHIPS: Record<string, ShipDef> = {
  // ---------- Tier 1 ----------
  scout: {
    id: 'scout', name: 'Scout', tier: 1, atk: 2, hp: 3, cd: 3, classes: ['strike'],
    desc: 'Light and fast. Fires very often.',
    perks: ['Fires 1 tick faster.', 'Fires 2 ticks faster.'], accent: ['#f5c400', '#fff27a'],
    sprite: [
      '...oo.......',
      '..oaAo......',
      '..oaaoooo...',
      'eoohllllhoo.',
      'Eobbbbbbbwwo',
      'eoosssssboo.',
      '..oaaoooo...',
      '..oaAo......',
      '...oo.......',
    ],
  },
  gunboat: {
    id: 'gunboat', name: 'Gunboat', tier: 1, atk: 3, hp: 8, cd: 5, classes: ['strike'],
    desc: 'Reliable guns. Shoots the front enemy.',
    perks: ['+3 HP in battle.', 'Shoots the front 2 enemies.'], accent: ['#ff8a1f', '#ffc27a'],
    sprite: [
      '..oooooo.oooo...',
      '.ohllllloaAAaoo.',
      'eohlaaaalooooo..',
      'Eobbbbbbbbbwwho.',
      'Eobbbbbbbbbbbbbo',
      'Eosbbbbbbbbbsso.',
      'eosaaaasooooo...',
      '.ossssssoaAAaoo.',
      '..oooooo.oooo...',
    ],
  },
  interceptor: {
    id: 'interceptor', name: 'Interceptor', tier: 1, atk: 2, hp: 3, cd: 4, classes: ['strike'],
    desc: 'On death, rams the front enemy (its ATK).',
    perks: ['Ram deals double damage.', 'Ram hits every enemy.'], accent: ['#ff3b3b', '#ff9a8a'],
    sprite: [
      'oo...........',
      'oAao.........',
      '.oaao........',
      '..oaloooo....',
      'eoohhhllhoo..',
      'Eobbbbbbbbwwo',
      'eoossssssoo..',
      '..oasoooo....',
      '.oaao........',
      'oAao.........',
      'oo...........',
    ],
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', tier: 1, atk: 1, hp: 9, cd: 6, classes: ['guard'],
    desc: 'Starts with a shield that blocks a hit.',
    perks: ['Starts with 2 shields.', 'Also shields the ship behind it.'], accent: ['#2fc6ff', '#a8ecff'],
    sprite: [
      '...oooooo.ooo.',
      '..ohllllloaAAo',
      '.ohlllllloaAAo',
      'eoblllllbboaAo',
      'Eobbbbbbbbboao',
      'Eobbbwwbbbboao',
      'Eobbbbbbbbboao',
      'eossbbbbbsoaao',
      '.osssssssoaaAo',
      '..ossssssoaaAo',
      '...oooooo.ooo.',
    ],
  },
  drone: {
    id: 'drone', name: 'Repair Drone', tier: 1, atk: 3, hp: 6, cd: 5, classes: ['tech'],
    desc: 'Repairs the most damaged ally by 2x ATK.',
    perks: ['Repairs 2 allies at once.', 'Repairs every damaged ally.'], accent: ['#33d16a', '#a8ffbe'],
    sprite: [
      '.oo.....oo.',
      'oaAo...oAao',
      '.oaoooooao.',
      '..ohhlllo..',
      '.ohlaAalbo.',
      'eoblAwAlbo.',
      '.obbaAabbo.',
      '..ossssso..',
      '.oaoooooao.',
      'oaAo...oAao',
      '.oo.....oo.',
    ],
  },
  salvager: {
    id: 'salvager', name: 'Salvager', tier: 1, atk: 1, hp: 5, cd: 5, classes: ['tech'],
    desc: 'Gains +2 ATK when an ally ship goes down.',
    perks: ['Gains +3 ATK per ally lost.', 'Also repairs 3 HP per ally lost.'], accent: ['#c98a1a', '#ffd27a'],
    sprite: [
      '..oooo.....ooo',
      '.ohlllooooaAAo',
      'eohlllbbbboaao',
      'Eobbbbwwbbbmo.',
      'Eobbbbwwbbbgo.',
      'Eosbbbbbbbsso.',
      'eossssssssoaao',
      '.ossoooooaaAAo',
      '..oooo.....ooo',
    ],
  },

  // ---------- Tier 2 ----------
  torpedo: {
    id: 'torpedo', name: 'Torpedo Frigate', tier: 2, atk: 7, hp: 6, cd: 7, classes: ['artillery'],
    desc: 'Torpedoes hit the rearmost enemy ship.',
    perks: ['First torpedo fires at once.', 'Fires 2 torpedoes per volley.'], accent: ['#e0309a', '#ff9ad6'],
    sprite: [
      '....oooo..........',
      '...ohlllooooooo...',
      'eeohlllllllllhoo..',
      'EeobaaabbbbbbbwwAo',
      'EeobbbbbbbbbbbbbAA',
      'EeobaaabbbbbbbssAo',
      'eeossssssssssoo...',
      '...osssoooooooo...',
      '....oooo..........',
    ],
  },
  lance: {
    id: 'lance', name: 'Lance', tier: 2, atk: 7, hp: 6, cd: 5, classes: ['artillery'],
    desc: 'Snipes the lowest-HP enemy ship.',
    perks: ['Shots pierce shields.', 'A kill reloads it instantly.'], accent: ['#b8c4dc', '#ffffff'],
    sprite: [
      '..ooo...............',
      '.ohllooooooooooooo..',
      'eohllllllllllllhhAo.',
      'EobbwwbbmmmmmmmmmmAA',
      'eosbbbsggggggggggao.',
      '.ossoooooooooooooo..',
      '..ooo...............',
    ],
  },
  raider: {
    id: 'raider', name: 'Raider', tier: 2, atk: 4, hp: 9, cd: 4, classes: ['strike'],
    desc: 'Gains +1 ATK every time it attacks.',
    perks: ['Gains +2 ATK per attack.', 'Gains +3 ATK per attack.'], accent: ['#ff5a1f', '#ffb08a'],
    sprite: [
      'o..o..o........',
      'oAoaoAoo.......',
      'eohllllloo.....',
      'Eobbaaabbbooo..',
      'Eobbbbbbbbbwwho',
      'Eobbaaabbbooo..',
      'eossssssoo.....',
      'oAoaoAoo.......',
      'o..o..o........',
    ],
  },
  aegis: {
    id: 'aegis', name: 'Aegis', tier: 2, atk: 3, hp: 10, cd: 6, classes: ['guard'],
    desc: 'Battle start: shields the 2 ships behind.',
    perks: ['Shields the 3 ships behind.', 'Shields every other ally.'], accent: ['#1fd1c1', '#a0fff4'],
    sprite: [
      '....oooo...ooo.',
      '...ohlllo.oAAAo',
      '..ohllllloaaaAo',
      'eohllllllboaaao',
      'Eobbbbbbbbbowao',
      'EobbbwwbbbbowAo',
      'Eobbbbbbbbbowao',
      'eosbbbbbbssoaao',
      '..osssssssoaaAo',
      '...ossssso.oAAo',
      '....oooo...ooo.',
    ],
  },
  reflector: {
    id: 'reflector', name: 'Reflector', tier: 2, atk: 2, hp: 9, cd: 6, classes: ['guard'],
    desc: 'Ally shield blocks zap the attacker for 3.',
    perks: ['Zaps for 5.', 'Zaps for 8 and starts shielded.'], accent: ['#3dffa8', '#d0fff0'],
    sprite: [
      '......ooo......',
      '.....oAAAo.....',
      '....oaAhAao....',
      'eoooohlllllhoo.',
      'Eohllllllllllwo',
      'EobbaAAAAAabbwo',
      'Eosbbbbbbbbbsso',
      'eooossssssssoo.',
      '....oaaaaao....',
      '.....oaaao.....',
      '......ooo......',
    ],
  },
  carrier: {
    id: 'carrier', name: 'Carrier', tier: 2, atk: 1, hp: 8, cd: 7, classes: ['tech'],
    desc: 'Launches 2 fighters at battle start.',
    perks: ['Its fighters get +1 HP.', 'Launches 3 fighters with +1 ATK.'], accent: ['#9b5cff', '#d4b8ff'],
    sprite: [
      '...oooooooooooo.....',
      '..ohhllllllllllhoo..',
      'eohllllllllllllllloo',
      'Eobbbbbbbbbbbbbbbwho',
      'EoAaAaAaAaAaAaAabbbo',
      'Eobbbbbbbbbbbbbbbbbo',
      'Eosbbbbbbbbbbbbbbsso',
      'eossssssssssssssoo..',
      '..oossssssssssso....',
      '...oooooooooooo.....',
    ],
  },
  command: {
    id: 'command', name: 'Command Ship', tier: 2, atk: 3, hp: 11, cd: 7, classes: ['tech'],
    desc: 'Battle start: neighbors get +3 ATK +3 HP.',
    perks: ['Gives +4 ATK +4 HP instead.', 'Buffs every ally, not just neighbors.'], accent: ['#ffcc33', '#fff0a8'],
    sprite: [
      '.......o........',
      '.......A........',
      '......oao.......',
      '.....ohwho......',
      '..oooolbbloooo..',
      'eohllllllllllhoo',
      'EobbbaaAAaabbwwo',
      'Eobbbbbbbbbbbbbo',
      'eossssssssssssoo',
      '..oooooooooooo..',
    ],
  },

  // ---------- Tier 3 ----------
  dread: {
    id: 'dread', name: 'Dreadnought', tier: 3, atk: 5, hp: 18, cd: 7, classes: ['guard', 'artillery'],
    desc: 'Broadsides hit the 2 front enemies.',
    perks: ['Broadsides hit 3 enemies.', 'Broadsides hit 4 enemies.'], accent: ['#e8a020', '#ffe08a'],
    sprite: [
      '.......oooooooo.........',
      '.....oohhllllllhoo......',
      '...oohllllllllllllooo...',
      'eeohlllmmolllmmollllhoo.',
      'EEobbbbggobbbggobbbbbwwo',
      'EEobaaaaaaaaaaaaaaaaabho',
      'EEobbbbbbbbbbbbbbbbbbbbo',
      'EEobaaaaaaaaaaaaaaaaabso',
      'EEobbbbmmobbbmmobbbbbsso',
      'eeosssggosssggossssooo..',
      '...oossssssssssssoo.....',
      '.....oossssssssoo.......',
      '.......oooooooo.........',
    ],
  },
  ion: {
    id: 'ion', name: 'Ion Cruiser', tier: 3, atk: 7, hp: 18, cd: 5, classes: ['tech'],
    desc: 'Piercing shots jam and drain 1 ATK.',
    perks: ['Jams last longer.', 'Jams the front 2 enemies.'], accent: ['#3a7bff', '#b8d4ff'],
    sprite: [
      '..ooo.............',
      '.ohlloooooooooo...',
      'eohllllllllllloo..',
      'Eobbbbbbbbbbbbooo.',
      'EobbbwwbbbbbboAAo.',
      'EobbbbbbbbbbbaEEAo',
      'EobbbbbbbbbbboAAo.',
      'Eosssssssssssooo..',
      'eossssssssssoo....',
      '.ossoooooooooo....',
      '..ooo.............',
    ],
  },
  siege: {
    id: 'siege', name: 'Siege Platform', tier: 3, atk: 4, hp: 10, cd: 11, classes: ['artillery'],
    desc: 'Slow, but every shot hits ALL enemies.',
    perks: ['Fires 2 ticks faster.', 'First volley fires at once.'], accent: ['#ff2a4a', '#ff9aa8'],
    sprite: [
      '..oooooo..............',
      '.ohlllllo.............',
      'eohllllllooooooooooo..',
      'Eobbaabbbommmmmmmmmmoo',
      'EobbaabbbomhhhhhhhhmaA',
      'EobbwwbbbommmmmmmmmmAA',
      'EobbaabbbogggggggggoaA',
      'Eosaassssooooooooooo..',
      'eossssssso............',
      '.osssssso.............',
      '..oooooo..............',
    ],
  },
  phantom: {
    id: 'phantom', name: 'Phantom', tier: 3, atk: 7, hp: 11, cd: 4, classes: ['strike'],
    desc: 'Cloaked; its ambush from cloak deals x2.',
    perks: ['Hunts the lowest-HP enemy.', 'Re-cloaks after every kill.'], accent: ['#9a4dff', '#dcc0ff'],
    sprite: [
      'ooo.............',
      'ohhoo...........',
      'eolllhoo........',
      'Eobllllhooo.....',
      'Eobbbbbblllhoo..',
      'EobaaaaaaAAbwwAo',
      'Eosbbbbbbsssoo..',
      'Eossssssooo.....',
      'eossssoo........',
      'ossoo...........',
      'ooo.............',
    ],
  },
  queen: {
    id: 'queen', name: 'Swarm Queen', tier: 3, atk: 2, hp: 12, cd: 5, classes: ['tech'],
    desc: 'Every 2nd attack launches a fighter.',
    perks: ['Launches a fighter every attack.', 'Its fighters are twice as strong.'], accent: ['#ff4fb0', '#ffb0e0'],
    sprite: [
      '......oooooo........',
      '....oohhllllhoo.....',
      '..oohllaAllAallooo..',
      'eeohllaAAllAAalllhoo',
      'EEobbbbaabbaabbbbbwo',
      'EEobbaaAAaaAAaabbbwo',
      'EEobbbbbbbbbbbbbbbbo',
      'EEobbaaAAaaAAaabbbso',
      'EEosbbbaassaasbbbsso',
      'eeossssaAssAassssoo.',
      '..oosssaasssassoo...',
      '....oossssssoo......',
      '......oooooo........',
    ],
  },
  revenant: {
    id: 'revenant', name: 'Revenant', tier: 3, atk: 4, hp: 11, cd: 5, classes: ['guard'],
    desc: 'First time it dies, it rebuilds at half HP.',
    perks: ['Rebuilds with full HP.', 'Rebuilds twice.'], accent: ['#9cff3a', '#e8ffb0'],
    sprite: [
      '...o.o.o.........',
      '..oAoAoAoo.......',
      '.ohlllllllhoo....',
      'eohaohaohaollhoo.',
      'Eobbbbbbbbbbbbwwo',
      'EobaobaobaobbbbAo',
      'Eobbbbbbbbbbbbsso',
      'eosaosaosaosoo...',
      '.ossssssssoo.....',
      '..oAoAoAoo.......',
      '...o.o.o.........',
    ],
  },

  // ---------- Summons ----------
  fighter: {
    id: 'fighter', name: 'Fighter', tier: 0, atk: 1, hp: 2, cd: 4, classes: [],
    desc: 'Launched from a carrier, hangar or queen.', perks: ['', ''], accent: ['#9b5cff', '#d4b8ff'],
    sprite: ['oo......', 'oaoo....', 'EobbwwAo', 'oaoo....', 'oo......'],
  },
};

export const SHOP_SHIPS = Object.values(SHIPS).filter((s) => s.tier > 0);

export const MAX_XP = 5;
export const levelOf = (xp: number) => (xp >= 5 ? 3 : xp >= 2 ? 2 : 1);
export const xpForNext = (xp: number) => (xp >= 5 ? null : xp >= 2 ? 5 : 2);

export const tierCap = (round: number) => (round >= 5 ? 3 : round >= 3 ? 2 : 1);
export const shopSize = (round: number) => (round >= 5 ? 5 : round >= 3 ? 4 : 3);
