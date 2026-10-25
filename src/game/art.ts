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

export const shipKey = (def: string, side: 0 | 1) => `ship_${def}_${side}`;

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
function shipPalette(side: 0 | 1, accent: [string, string]): Palette {
  const f = FACTION[side];
  const k = side === 0 ? 0.42 : 0.3;
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
      drawMap(scene, shipKey(def.id, side), def.sprite, pal, side === 1);
    }
  }
  // Engine flame, tip pointing left (mirrored for the enemy).
  for (const side of [0, 1] as const) {
    drawMap(scene, `flame_${side}`, ['..abc', 'abbcc', '..abc'], FLAME[side], side === 1);
  }
  drawMap(scene, 'heart', ['.aa.aa.', 'abbabba', 'abhbbba', '.abbba.', '..aba..', '...a...'],
    { a: '#3a0812', b: '#ff4d6d', h: '#ffc2cc' });
  drawMap(scene, 'heart_empty', ['.aa.aa.', 'a..a..a', 'a.....a', '.a...a.', '..a.a..', '...a...'],
    { a: '#4a5578' });
  drawMap(scene, 'coin', ['..aaa..', '.abbba.', 'abbcbba', 'abcccba', 'abbcbba', '.abbba.', '..aaa..'],
    { a: '#5a3a00', b: '#ffc93c', c: '#fff1a8' });
  drawMap(scene, 'star', ['..a..', '.aba.', 'abbba', '.aba.', '.a.a.'], { a: '#c88a10', b: '#ffe066' });
  drawMap(scene, 'bolt', ['aabbbb'], { a: '#ffffff', b: '#ffffff' }); // tinted per ship
  drawMap(scene, 'torp_0', ['.aab.', 'eaaab', '.aab.'], { a: '#ff5e7e', b: '#ffffff', e: '#ffcf5a' });
  drawMap(scene, 'torp_1', ['.baa.', 'baaae', '.baa.'], { a: '#ff5e7e', b: '#ffffff', e: '#7fe7ff' });
  drawMap(scene, 'px', ['aa', 'aa'], { a: '#ffffff' });
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
  const flame = scene.add.image(x, y, `flame_${side}`).setOrigin(side === 0 ? 1 : 0, 0.5).setScale(flameScale);
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
