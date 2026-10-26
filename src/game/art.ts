// Builds every texture at startup from pixel maps, so there are no image files yet.
import Phaser from 'phaser';
import { SHIPS } from '../sim/ships';

type Palette = Record<string, string>;

// Faction hull palettes. Player: clean steel blue with cyan glass and blue engines.
// Enemy: crimson and gunmetal with amber glass and orange engines.
const FACTION: Palette[] = [
  {
    o: '#0a0f1e', s: '#2b3f63', b: '#4d6fa3', l: '#86aee0', h: '#d8ecff',
    w: '#8ff8ff', e: '#2f8cff', E: '#e6f8ff', m: '#a7b0c4', g: '#4a5268',
  },
  {
    o: '#1a0507', s: '#4d1519', b: '#8c2a2e', l: '#c9584f', h: '#ffc2a6',
    w: '#ffd25e', e: '#ff6a1f', E: '#fff2c4', m: '#ad9e98', g: '#4f3d3b',
  },
];

const FLAME: Palette[] = [
  { a: '#1f4fd0', b: '#5fb0ff', c: '#e0f6ff' },
  { a: '#b03000', b: '#ff8a2a', c: '#fff2c4' },
];

// Commander hull colours (unlocked at commander level 2). They replace the
// player's steel blue; the enemy always stays crimson so sides never get confused.
const SKINS: Record<string, { hull: Palette; flame: Palette }> = {
  vance: {
    hull: { s: '#5a4520', b: '#9a7a3a', l: '#d8b870', h: '#fff0c8', w: '#fff3a0', e: '#ffb02f' },
    flame: { a: '#b06a00', b: '#ffc23a', c: '#fff6d0' },
  },
  kael: {
    hull: { s: '#3a5560', b: '#7a9aa8', l: '#c0dce6', h: '#f2fbff', w: '#8ff8ff', e: '#2fd8ff' },
    flame: { a: '#0f7fb0', b: '#4fe0ff', c: '#e8fdff' },
  },
  nyx: {
    hull: { s: '#22222b', b: '#3e3f52', l: '#72748e', h: '#e0e2f0', w: '#ffd23f', e: '#ffd23f' },
    flame: { a: '#b08000', b: '#ffd23f', c: '#fff8d8' },
  },
  ryx: {
    hull: { s: '#3a2560', b: '#6a48a0', l: '#a888e0', h: '#eadcff', w: '#ff9cf0', e: '#c56bff' },
    flame: { a: '#6a1fb0', b: '#c56bff', c: '#f4e0ff' },
  },
  orin: {
    hull: { s: '#353c24', b: '#5e683c', l: '#98a468', h: '#e4ecc0', w: '#ffd166', e: '#ff9f43' },
    flame: { a: '#a04a00', b: '#ff9f43', c: '#fff0c8' },
  },
  juno: {
    hull: { s: '#1f4a40', b: '#3a8070', l: '#6cc0a8', h: '#d0fff0', w: '#b8fff0', e: '#3dffb0' },
    flame: { a: '#0a8a5a', b: '#3dffb0', c: '#e0fff4' },
  },
  sera: {
    hull: { s: '#5a6a8a', b: '#a8b8d8', l: '#e0e8ff', h: '#ffffff', w: '#8ff8ff', e: '#5a8cff' },
    flame: { a: '#2a4aa0', b: '#7aa8ff', c: '#f0f6ff' },
  },
  grisk: {
    hull: { s: '#4a2a1a', b: '#7a4a2a', l: '#b0784a', h: '#f0c890', w: '#ffb050', e: '#ff7a2a' },
    flame: { a: '#a03000', b: '#ff7a2a', c: '#fff0c8' },
  },
};

let playerSkin: string | null = null;

/** Which commander colours your own ships use (null = standard steel blue). */
export function setPlayerSkin(id: string | null | undefined) {
  playerSkin = id && SKINS[id] ? id : null;
}

export const skinShipKey = (def: string, skin: string | null) => (skin && SKINS[skin] ? `ship_${def}_0_${skin}` : `ship_${def}_0`);
export const shipKey = (def: string, side: 0 | 1) => (side === 0 ? skinShipKey(def, playerSkin) : `ship_${def}_1`);
const flameKey = (side: 0 | 1) => (side === 0 && playerSkin ? `flame_0_${playerSkin}` : `flame_${side}`);

function drawMap(scene: Phaser.Scene, key: string, rows: string[], pal: Palette, mirror = false) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(mirror ? w - 1 - x : x, y, 1, 1);
    }
  });
  tex.refresh();
}

function starLayer(scene: Phaser.Scene, key: string, n: number, colors: string[], big = false) {
  const tex = scene.textures.createCanvas(key, 480, 270);
  if (!tex) return;
  const ctx = tex.getContext();
  for (let i = 0; i < n; i++) {
    const x = Math.floor(Math.random() * 480);
    const y = Math.floor(Math.random() * 270);
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.fillRect(x, y, 1, 1);
    if (big && Math.random() < 0.25) {
      // a few plus-shaped bright stars
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.globalAlpha = 1;
    }
  }
  tex.refresh();
}

/** Chunky pixel nebula: soft blobs drawn at 1/4 resolution, colour-banded, then scaled up. */
function nebula(scene: Phaser.Scene, key: string, blobs: [number, number, number, string][]) {
  const W = 120;
  const H = 68;
  const tex = scene.textures.createCanvas(key, W, H);
  if (!tex) return;
  const ctx = tex.getContext();
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Band the colours into a few steps for a pixel-art look.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 4; c++) img.data[i + c] = Math.round(img.data[i + c] / 24) * 24;
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

function planet(scene: Phaser.Scene) {
  const R = 22;
  const tex = scene.textures.createCanvas('planet', R * 2 + 2, R * 2 + 2);
  if (!tex) return;
  const ctx = tex.getContext();
  const tones = ['#1b1440', '#2e2370', '#4a3aa0', '#7a5fd0', '#b39cf0'];
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > R) continue;
      // light from the top-right, plus horizontal bands
      const light = (x * 0.55 - y * 0.45) / R + 0.35 + Math.sin(y * 0.7) * 0.08;
      const idx = Math.max(0, Math.min(tones.length - 1, Math.floor((light + 0.6) * 2.6)));
      ctx.fillStyle = d > R - 1 ? '#120c2c' : tones[idx];
      ctx.fillRect(x + R + 1, y + R + 1, 1, 1);
    }
  }
  tex.refresh();
}

/** Blend two #rrggbb colours: k=0 gives a, k=1 gives b. */
function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * k);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Each ship's hull is the faction tone pulled toward its own accent colour, so
 * every ship has its own colour family while factions stay recognisable
 * (blue engines and cyan glass vs orange engines and amber glass).
 */
function shipPalette(side: 0 | 1, accent: [string, string], skin?: Palette): Palette {
  const f = skin ? { ...FACTION[0], ...skin } : FACTION[side];
  const k = skin ? 0.22 : side === 0 ? 0.42 : 0.3;
  return {
    ...f,
    o: mix(f.o, accent[0], 0.12),
    s: mix(f.s, accent[0], k * 0.8),
    b: mix(f.b, accent[0], k),
    l: mix(f.l, accent[1], k),
    a: accent[0],
    A: accent[1],
  };
}

export function makeTextures(scene: Phaser.Scene) {
  for (const def of Object.values(SHIPS)) {
    for (const side of [0, 1] as const) {
      const pal = shipPalette(side, def.accent);
      drawMap(scene, side === 0 ? skinShipKey(def.id, null) : `ship_${def.id}_1`, def.sprite, pal, side === 1);
    }
    for (const [id, skin] of Object.entries(SKINS)) {
      drawMap(scene, skinShipKey(def.id, id), def.sprite, shipPalette(0, def.accent, skin.hull));
    }
  }
  // Engine flame, tip pointing left (mirrored for the enemy).
  const FLAME_MAP = ['..abc', 'abbcc', '..abc'];
  for (const side of [0, 1] as const) {
    drawMap(scene, `flame_${side}`, FLAME_MAP, FLAME[side], side === 1);
  }
  for (const [id, skin] of Object.entries(SKINS)) drawMap(scene, `flame_0_${id}`, FLAME_MAP, skin.flame);
  makePortraits(scene);
  drawMap(scene, 'heart', ['.aa.aa.', 'abbabba', 'abhbbba', '.abbba.', '..aba..', '...a...'],
    { a: '#3a0812', b: '#ff4d6d', h: '#ffc2cc' });
  drawMap(scene, 'heart_empty', ['.aa.aa.', 'a..a..a', 'a.....a', '.a...a.', '..a.a..', '...a...'],
    { a: '#6a76a0' });
  drawMap(scene, 'coin', ['..aaa..', '.abbba.', 'abbcbba', 'abcccba', 'abbcbba', '.abbba.', '..aaa..'],
    { a: '#5a3a00', b: '#ffc93c', c: '#fff1a8' });
  drawMap(scene, 'star', ['..a..', '.aba.', 'abbba', '.aba.', '.a.a.'], { a: '#c88a10', b: '#ffe066' });
  drawMap(scene, 'bolt', ['aabbbb'], { a: '#ffffff', b: '#ffffff' }); // tinted per ship
  drawMap(scene, 'torp_0', ['.aab.', 'eaaab', '.aab.'], { a: '#ff5e7e', b: '#ffffff', e: '#ffcf5a' });
  drawMap(scene, 'torp_1', ['.baa.', 'baaae', '.baa.'], { a: '#ff5e7e', b: '#ffffff', e: '#7fe7ff' });
  drawMap(scene, 'px', ['aa', 'aa'], { a: '#ffffff' });
  // Speaker icons for the sound button.
  drawMap(scene, 'spk_on', ['...a.....a.', '..aa...a..a', 'aaaa..a.a.a', 'aaaa..a.a.a', 'aaaa..a.a.a', '..aa...a..a', '...a.....a.'], { a: '#e8ecff' });
  drawMap(scene, 'spk_off', ['...a.......', '..aa..b...b', 'aaaa...b.b.', 'aaaa....b..', 'aaaa...b.b.', '..aa..b...b', '...a.......'], { a: '#8a94bc', b: '#ff5e7e' });
  drawMap(scene, 'snow', ['a..a..a', '.a.a.a.', '..aaa..', 'aaaaaaa', '..aaa..', '.a.a.a.', 'a..a..a'], { a: '#ffffff' });
  starLayer(scene, 'stars_far', 260, ['#2a3360', '#3a4580', '#1d2448', '#3a2a5a']);
  starLayer(scene, 'stars_near', 70, ['#ffffff', '#9fc4ff', '#ffe9a8', '#ffb8e0'], true);
  nebula(scene, 'nebula', [
    [24, 18, 34, 'rgba(110,40,160,0.55)'],
    [96, 52, 40, 'rgba(20,90,140,0.5)'],
    [70, 10, 22, 'rgba(160,40,90,0.35)'],
    [10, 60, 26, 'rgba(30,60,140,0.4)'],
  ]);
  planet(scene);
}

/** Nebula + two drifting star layers behind every scene. */
export function addStarfield(scene: Phaser.Scene, withPlanet = false) {
  scene.add.image(0, 0, 'nebula').setOrigin(0).setScale(4).setAlpha(0.9);
  if (withPlanet) scene.add.image(452, 60, 'planet').setScale(2);
  const far = scene.add.tileSprite(0, 0, 480, 270, 'stars_far').setOrigin(0);
  const near = scene.add.tileSprite(0, 0, 480, 270, 'stars_near').setOrigin(0);
  scene.tweens.add({ targets: far, tilePositionX: 480, duration: 90000, repeat: -1 });
  scene.tweens.add({ targets: near, tilePositionX: 480, duration: 30000, repeat: -1 });
}

/**
 * A ship sprite with a flickering engine flame attached at its stern.
 * Returns both; move them together (the flame follows via `syncFlame`).
 */
export function addShip(scene: Phaser.Scene, x: number, y: number, def: string, side: 0 | 1, scale = 2, flameScale = scale) {
  // Flame first so it draws behind the hull.
  const flame = scene.add.image(x, y, flameKey(side)).setOrigin(side === 0 ? 1 : 0, 0.5).setScale(flameScale);
  const spr = scene.add.image(x, y, shipKey(def, side)).setScale(scale);
  syncFlame(spr, flame, side);
  scene.tweens.add({
    targets: flame, scaleX: flameScale * 1.6, duration: 90 + Math.random() * 80, yoyo: true, repeat: -1,
    ease: 'Sine.easeInOut', delay: Math.random() * 100,
  });
  return { spr, flame };
}

export function syncFlame(spr: Phaser.GameObjects.Image, flame: Phaser.GameObjects.Image, side: 0 | 1) {
  const half = (spr.width * spr.scaleX) / 2;
  flame.setPosition(spr.x + (side === 0 ? -half + 1 : half - 1), spr.y);
  flame.setAlpha(spr.alpha);
}

// ---------- commander portraits ----------
// 16x16 busts. o outline  k skin  K skin shadow  h hair/helmet  H helmet light
// v eyes/visor  a uniform  A uniform light / trim  w white/grey
const PORTRAITS: Record<string, { map: string[]; pal: Palette }> = {
  vance: {
    map: [
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '..ohhhhAAhhhho..',
      '..oAAAAAAAAAAo..',
      '...oooooooooo...',
      '...okkkkkkkko...',
      '...okvkkkkvko...',
      '...okkkkkkkko...',
      '...okkkKKkkko...',
      '...okwwwwwwko...',
      '....okkkkkko....',
      '.....oKKKKo.....',
      '..ooaaoooaaoo...',
      '.oaaaAaaaAaaao..',
      '.oaaaaaaaaaaao..',
    ],
    pal: { o: '#0a0f1e', k: '#e8b98f', K: '#b98a66', h: '#1d2a50', H: '#33467a', v: '#1a1a2a', a: '#1d2a50', A: '#ffd166', w: '#c8ccd8' },
  },
  kael: {
    map: [
      '................',
      '.....oooooo.....',
      '...oohhhhhhoo...',
      '..ohHHhhhhhhho..',
      '..ohHhhhhhhhho..',
      '.ohhhhhhhhhhhho.',
      '.ohhoooooooohho.',
      '.ohhovvvvvvohho.',
      '.ohhoooooooohho.',
      '.ohhhhhhhhhhhho.',
      '..ohhhAAAAhhho..',
      '..oohhhhhhhhoo..',
      '...oohhhhhhoo...',
      '.ooaaoooooooaao.',
      'oaaaahhhhhhaaaao',
      'oaaaahhhhhhaaaao',
    ],
    pal: { o: '#0a0f1e', h: '#8aa8b8', H: '#e2f4ff', v: '#7fe7ff', a: '#3a5560', A: '#2fc6ff' },
  },
  nyx: {
    map: [
      '....o..o..o.....',
      '...ohoohhoho....',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhhho.',
      '.ohhhkkkkkkhhho.',
      '.ohhkkkkkkkkhho.',
      '..ohkoookvkkho..',
      '..ohkoookkkkho..',
      '...okkkkkkkko...',
      '...okkkKKkkko...',
      '...okkkwwkkko...',
      '....okkkkkko....',
      '.....oKKKKo.....',
      '...ooaaooooaaoo.',
      '..oaaaaAAAAaaaao',
      '..oaaaaAAAAaaaao',
    ],
    pal: { o: '#120a08', k: '#d9a27a', K: '#a8744f', h: '#ff7a2f', v: '#2a1a10', a: '#2a2a33', A: '#ffd23f', w: '#ff5e7e' },
  },
  ryx: {
    map: [
      '..o.........o...',
      '...o.......o....',
      '....o.....o.....',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '..ohhHhhhhHhho..',
      '..ohvvvhhvvvho..',
      '..ohvAvhhvAvho..',
      '..ohvvvhhvvvho..',
      '...ohhhhhhhho...',
      '...ohhoaaohho...',
      '....ohhaahho....',
      '.....ohhhho.....',
      '...oohhhhhhoo...',
      '..ohhaahhaahhho.',
      '..ohhhhhhhhhhho.',
    ],
    pal: { o: '#120a20', h: '#6a48a0', H: '#a888e0', v: '#1a0a2a', A: '#ff9cf0', a: '#c56bff' },
  },
  orin: {
    map: [
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '..ohhhhhhhhhho..',
      '..oooooooooooo..',
      '..oAvAooooAvAo..',
      '..ooooookkoooo..',
      '...okkkkkkkko...',
      '...okvkkkkvko...',
      '...okkkKKkkko...',
      '...owwkkkkwwo...',
      '...owwwwwwwwo...',
      '....owwwwwwo....',
      '...ooaooooaoo...',
      '..oaaaAAAAaaao..',
      '..oaaaAAAAaaao..',
    ],
    pal: { o: '#0e0c08', k: '#c98f68', K: '#9a6a4a', h: '#5e683c', v: '#ff5e7e', A: '#ffd166', a: '#4a5230', w: '#d8d0c0' },
  },
  juno: {
    map: [
      '...........o....',
      '..........oAo...',
      '....ooooooooo...',
      '...ohhhhhhhhho..',
      '..ohhhhhhhhhhho.',
      '..ohkkkkkkkkhho.',
      '.oaohkkkkkkkoao.',
      '.oAokvkkkkvkoAo.',
      '.oaokkkkkkkkoao.',
      '..ohkkkKKkkkho..',
      '..ohkkkkkkkkho..',
      '..oh.okkkko.ho..',
      '.....oKKKKo.....',
      '...ooaaooaaoo...',
      '..oaaawwwwaaao..',
      '..oaaawwwwaaao..',
    ],
    pal: { o: '#06120e', k: '#8a5a3c', K: '#68412a', h: '#e8ecff', v: '#3dffb0', a: '#1f4a40', A: '#3dffb0', w: '#d0fff0' },
  },
  sera: {
    map: [
      '................',
      '.....oooooo.....',
      '...oohhhhhhoo...',
      '..ohhhhhhhhhho..',
      '..ohhkkkkkkhho..',
      '.ohhkkkkkkkkhho.',
      '.ohkkvkkkkvkkho.',
      '.ohkkkkkkkkkkho.',
      '..ohkkkKKkkkho..',
      '..ohkkkkkkkkho..',
      '..ohhokkkkohho..',
      '...oh.oKKo.ho...',
      '..ooaaoooaaoo...',
      '.oaAawwwwwaAao..',
      '.oaaawwAwwaaao..',
      '.oaaawwwwwaaao..',
    ],
    pal: { o: '#080c1a', k: '#f0c8a8', K: '#c09878', h: '#f0e6c8', v: '#3a7bff', a: '#d8e4ff', A: '#ffd166', w: '#5a8cff' },
  },
  grisk: {
    map: [
      '.o............o.',
      '.oAo........oAo.',
      '..oAooooooooAo..',
      '...ohhhhhhhho...',
      '..ohhhhhhhhhho..',
      '..oooooooooooo..',
      '..okvkkkkkkvko..',
      '..okkkkkkkkkko..',
      '..okkwkKKkkkko..',
      '..okkkwkkkkkko..',
      '..okkoooooookko.',
      '...okkkkkkkko...',
      '....oKKKKKKo....',
      '..ooaaooooaaoo..',
      '.oaaaAAAAAAaaao.',
      '.oaaaaaaaaaaaao.',
    ],
    pal: { o: '#140806', k: '#9a6a50', K: '#6e4a36', h: '#4a4a52', A: '#ff8a4a', v: '#ff3b3b', a: '#5a3a2a', w: '#e8d0b0' },
  },
};

export const portraitKey = (id: string, locked = false) => (locked ? `portrait_${id}_locked` : `portrait_${id}`);

function makePortraits(scene: Phaser.Scene) {
  for (const [id, { map, pal }] of Object.entries(PORTRAITS)) {
    drawMap(scene, portraitKey(id), map, pal);
    // Locked: a flat silhouette.
    const shadow = Object.fromEntries(Object.keys(pal).map((k) => [k, k === 'o' ? '#0b0f22' : '#1d2444']));
    drawMap(scene, portraitKey(id, true), map, shadow);
  }
}
