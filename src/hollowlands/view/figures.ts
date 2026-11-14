// Colonists on the map: small top-down figures built from layered parts (shadow, clothes,
// hair behind, ears, head, beard, tusks, hair on top), plus the little speech bubbles and
// state marks that float over them. Everything is drawn once and reused; nothing here is
// rebuilt per frame.

import type { Graphics } from 'pixi.js';
import type { Look, RaceK } from '../sim/types';
import { HAIR, SHAPE, darken, garbOf, hairIndex, lighten, skinOf } from './look';

/** How big each life stage is drawn next to an adult (baby, child, youth, adult, elder). */
export const STAGE_SIZE = [0.5, 0.66, 0.88, 1, 0.97];

export interface FigureSpec { race: RaceK; look: Look; sex: 0 | 1; stage: number; years: number }

/** Changes when the figure needs redrawing. */
export function figureKey(f: FigureSpec): string {
  const l = f.look;
  return `${f.race}${f.sex}${f.stage}${hairIndex(f.race, l, f.years)}|${l.skin},${l.hair},${l.body},${l.beard},${l.garb},${l.marks.length}`;
}

/** Draw a figure centred on (0,0), feet slightly below. Sized for a 24 px tile. */
export function drawFigure(g: Graphics, f: FigureSpec): void {
  g.clear();
  const sh = SHAPE[f.race];
  const l = f.look;
  const skin = skinOf(f.race, l);
  const skinD = darken(skin, 0.18);
  const hair = HAIR[hairIndex(f.race, l, f.years)];
  const garb = garbOf(l);
  const w = sh.wide * (0.92 + l.body * 0.04);
  const kid = f.stage <= 1;
  const hr = kid ? 4.7 : 4.3; // head radius: children have big heads
  const hy = -3.4;

  // shadow, then the body seen from above: shoulders with a darker lower edge and two hands
  g.ellipse(0.8, 5.4, 6.6 * w, 3).fill({ color: 0x0b1220, alpha: 0.28 });
  // a dark outline round body and head, so a colonist stands out on any ground
  g.ellipse(0, 2.9, 5.7 * w + 1.3, 5.6).fill({ color: 0x120c08, alpha: 0.85 });
  g.circle(0, hy, hr + 1.3).fill({ color: 0x120c08, alpha: 0.85 });
  g.ellipse(0, 3.4, 5.7 * w, 4.5).fill(darken(garb, 0.3));
  g.ellipse(0, 2.5, 5.7 * w, 4.3).fill(garb);
  g.ellipse(0, 1.6, 3.6 * w, 2.2).fill(lighten(garb, 0.12));
  g.circle(-5.5 * w, 3.6, 1.4).circle(5.5 * w, 3.6, 1.4).fill(skinD);

  // hair that hangs behind
  const hs = l.hair % 10;
  if (hs === 3) g.ellipse(0, hy + 1.6, hr + 0.9, hr + 2.4).fill(darken(hair, 0.15));
  else if (hs === 8) g.circle(0, hy, hr + 1.3).fill(darken(hair, 0.15));
  else if (hs === 6) g.ellipse(hr + 0.4, hy + 3.4, 1.6, 3.2).fill(darken(hair, 0.15));
  else if (hs === 7) g.ellipse(-hr - 0.2, hy + 3.6, 1.4, 3).ellipse(hr + 0.2, hy + 3.6, 1.4, 3).fill(darken(hair, 0.15));

  // ears tell the peoples apart even at this size
  for (const s of [-1, 1]) {
    if (sh.ears === 0) g.circle(s * hr, hy + 0.4, 1.1).fill(skinD);
    else if (sh.ears === 1) g.poly([s * (hr - 0.8), hy - 1.2, s * (hr + 2.2), hy - 2, s * (hr - 0.8), hy + 1.6]).fill(skinD);
    else if (sh.ears === 2) g.poly([s * (hr - 0.8), hy - 1, s * (hr + 4), hy - 4.2, s * (hr - 0.8), hy + 1.8]).fill(skinD);
    else g.poly([s * (hr - 1), hy - 1.8, s * (hr + 5.2), hy - 3, s * (hr + 3.6), hy + 0.8, s * (hr - 1), hy + 2]).fill(skinD);
  }

  // head (orcs get a heavier jaw)
  g.circle(0, hy, hr).fill(skin);
  if (sh.tusks && !kid) g.roundRect(-hr * 0.82, hy, hr * 1.64, hr * 1.02, 2).fill(skin);
  g.circle(-1.6, hy + 1.1, 0.62).circle(1.6, hy + 1.1, 0.62).fill(0x1d1a1c);

  // beard
  const beard = f.sex === 1 && f.stage >= 3 ? l.beard : 0;
  if (beard === 1) g.ellipse(0, hy + 3.2, 2.6, 1.3).fill({ color: hair, alpha: 0.55 });
  else if (beard === 2) g.ellipse(0, hy + 3.4, 3.3, 2).fill(hair);
  else if (beard >= 3) g.poly([-3.6, hy + 2, 3.6, hy + 2, 2.2, hy + (beard === 3 ? 6 : 8), 0, hy + (beard === 3 ? 7.4 : 10), -2.2, hy + (beard === 3 ? 6 : 8)]).fill(hair);

  if (sh.tusks && !kid) {
    const th = sh.tusks === 2 ? 2 : 1.3;
    g.poly([-2.4, hy + 3.2, -1.7, hy + 3.2 - th, -1.1, hy + 3.2]).poly([2.4, hy + 3.2, 1.7, hy + 3.2 - th, 1.1, hy + 3.2]).fill(0xf3efe2);
  }

  // hair on top
  if (hs === 1 || hs === 9) g.ellipse(0, hy - 2.5, hr * 0.98, hr * 0.56).fill(hair);
  else if (hs === 2) g.ellipse(0, hy - 2.1, hr * 1.02, hr * 0.62).fill(hair);
  else if (hs === 3 || hs === 6 || hs === 7) g.ellipse(0, hy - 2.4, hr * 1.02, hr * 0.58).fill(hair);
  else if (hs === 4) { g.ellipse(0, hy - 2.5, hr, hr * 0.56).fill(hair); g.circle(0, hy - hr - 0.4, 1.9).fill(hair); }
  else if (hs === 5) g.roundRect(-1.2, hy - hr - 1.4, 2.4, hr + 1.6, 1.2).fill(hair);
  else if (hs === 8) { g.ellipse(0, hy - 2.3, hr * 1.14, hr * 0.66).fill(hair); g.circle(-2.6, hy - 3.4, 1.5).circle(2.4, hy - 3.6, 1.6).fill(lighten(hair, 0.08)); }
  if (hs === 9) g.circle(0, hy - hr - 0.2, 1.4).fill(hair);

  if (l.marks.length) g.moveTo(-2.6, hy - 1).lineTo(-1, hy + 2.2).stroke({ width: 0.6, color: darken(skin, 0.4) });
}

// ---------- Speech bubbles ----------

const INK = 0x2a2f3d;

/** A small white bubble with a glyph for the kind of exchange. Drawn with its tail tip at (0,0). */
export function drawBubble(g: Graphics, kind: string, ok: boolean): void {
  g.clear();
  g.poly([-2.4, -4.6, 2.4, -4.6, 0, 0]).fill(0xffffff);
  g.roundRect(-9, -19, 18, 15, 5).fill(0xffffff);
  const y = -11.5; // glyph centre
  const heart = (col: number): void => {
    g.circle(-2.3, y - 1.4, 2.6).circle(2.3, y - 1.4, 2.6).fill(col);
    g.poly([-4.7, y - 0.4, 4.7, y - 0.4, 0, y + 4.8]).fill(col);
  };
  const dots = (col: number): void => { g.circle(-4, y, 1.4).circle(0, y, 1.4).circle(4, y, 1.4).fill(col); };
  switch (kind) {
    case 'flirt':
      heart(ok ? 0xe8527a : 0x9aa4b8);
      if (!ok) g.moveTo(-0.6, y - 3.6).lineTo(1, y - 0.6).lineTo(-1, y + 1).lineTo(0.4, y + 4).stroke({ width: 1.1, color: 0xffffff });
      break;
    case 'propose':
      g.circle(0, y + 1.2, 3.4).stroke({ width: 1.6, color: 0xd9a93a });
      g.poly([0, y - 5.4, 2.2, y - 3.2, 0, y - 1, -2.2, y - 3.2]).fill(ok ? 0x7cc4f2 : 0x9aa4b8);
      break;
    case 'insult':
    case 'argue':
      g.poly([1.6, y - 5.6, -3.4, y + 0.8, -0.4, y + 0.8, -1.8, y + 5.6, 3.6, y - 1.4, 0.6, y - 1.4]).fill(kind === 'insult' ? 0xe8662a : 0xd93a3a);
      break;
    case 'brawl':
      g.circle(0, y - 1, 4.2).fill(INK);
      g.roundRect(-2.4, y + 1.6, 4.8, 3.2, 1).fill(INK);
      g.circle(-1.6, y - 1.2, 1.2).circle(1.6, y - 1.2, 1.2).fill(0xffffff);
      g.rect(-0.3, y + 2.6, 0.6, 2.2).fill(0xffffff);
      break;
    case 'mock':
      g.moveTo(-5.5, y - 2).lineTo(-3, y + 2.5).lineTo(-1, y - 2).lineTo(1, y + 2.5).lineTo(3, y - 2).lineTo(5.5, y + 2.5).stroke({ width: 1.5, color: 0x9a5ad9, join: 'round', cap: 'round' });
      break;
    case 'joke':
      // a wide grin (or a flat line when it falls flat)
      if (ok) { g.arc(0, y - 2.2, 5, Math.PI * 0.12, Math.PI * 0.88).stroke({ width: 1.7, color: 0xe2933a, cap: 'round' }); g.circle(-2.6, y - 3, 0.9).circle(2.6, y - 3, 0.9).fill(0xe2933a); }
      else { g.moveTo(-4, y + 1.5).lineTo(4, y + 1.5).stroke({ width: 1.6, color: 0x9aa4b8, cap: 'round' }); g.circle(-2.6, y - 2.4, 0.9).circle(2.6, y - 2.4, 0.9).fill(0x9aa4b8); }
      break;
    case 'gossip':
      // whisper lines spreading from a mouth
      g.circle(-5, y, 1.3).fill(0x6a5a9a);
      for (let k = 0; k < 3; k++) g.arc(-5, y, 3.6 + k * 2.8, -0.7, 0.7).stroke({ width: 1.2, color: 0x6a5a9a, cap: 'round' });
      break;
    case 'comfort':
      heart(0x6fa8e8);
      break;
    case 'deeptalk':
      dots(0x7c8cff);
      g.star(5, y - 4.6, 4, 2.4, 1, 0).fill(0x7c8cff);
      break;
    case 'story':
    case 'teach':
      // an open book
      g.roundRect(-6.5, y - 4, 6.2, 8, 1).roundRect(0.3, y - 4, 6.2, 8, 1).fill(kind === 'story' ? 0x8a6f3f : 0x4f6fa8);
      g.rect(-5.4, y - 2.6, 4, 0.9).rect(-5.4, y - 0.4, 4, 0.9).rect(1.4, y - 2.6, 4, 0.9).rect(1.4, y - 0.4, 4, 0.9).fill(0xffffff);
      break;
    case 'praise':
      g.star(0, y, 5, 5.4, 2.4, 0).fill(0xe9b93a);
      break;
    case 'brag':
      // a crown
      g.poly([-5.5, y + 3.6, -5.5, y - 3.4, -2.6, y - 0.2, 0, y - 4.4, 2.6, y - 0.2, 5.5, y - 3.4, 5.5, y + 3.6]).fill(0xe9b93a);
      break;
    case 'complain':
      // a little rain cloud
      g.circle(-3, y - 1, 2.8).circle(0.4, y - 2.4, 3.3).circle(3.6, y - 0.8, 2.6).fill(0x8a93a6);
      g.rect(-3.4, y + 2.6, 1, 2.4).rect(0, y + 2.6, 1, 2.4).rect(3.2, y + 2.6, 1, 2.4).fill(0x6fa8e8);
      break;
    case 'preach':
      // a sun with rays
      g.circle(0, y, 2.6).fill(0x7c8cff);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.moveTo(Math.cos(a) * 3.8, y + Math.sin(a) * 3.8).lineTo(Math.cos(a) * 5.8, y + Math.sin(a) * 5.8);
      }
      g.stroke({ width: 1.2, color: 0x7c8cff, cap: 'round' });
      break;
    case 'apologise':
      // a teardrop
      g.circle(0, y + 1.4, 3.2).fill(0x6fa8e8);
      g.poly([-2.8, y, 2.8, y, 0, y - 5.4]).fill(0x6fa8e8);
      break;
    case 'gift':
      g.rect(-4.6, y - 2, 9.2, 6.4).fill(0xd9527a);
      g.rect(-1, y - 2, 2, 6.4).rect(-4.6, y - 3.4, 9.2, 1.8).fill(0xe9b93a);
      g.circle(-1.8, y - 4.4, 1.5).circle(1.8, y - 4.4, 1.5).fill(0xe9b93a);
      break;
    case 'slight':
      dots(0x9aa4b8);
      g.moveTo(-5.5, y + 3.4).lineTo(5.5, y - 3.4).stroke({ width: 1.5, color: 0xd93a3a, cap: 'round' });
      break;
    case 'playing':
      g.circle(0, y, 4.6).fill(0x4fa8a0);
      g.arc(-4, y, 5, -0.9, 0.9).stroke({ width: 1.2, color: 0xffffff });
      break;
    default:
      dots(INK);
  }
}

// ---------- State marks ----------

/** Marks drawn above the head: 'z' asleep, 'break' mental break, 'star' inspired. */
export function drawMark(g: Graphics, kind: string): void {
  g.clear();
  if (kind === 'z') {
    g.moveTo(-2.2, -2.4).lineTo(2.2, -2.4).lineTo(-2.2, 2.4).lineTo(2.2, 2.4).stroke({ width: 1.3, color: 0xdfe6ff, cap: 'round', join: 'round' });
    g.moveTo(3.4, -6.6).lineTo(6, -6.6).lineTo(3.4, -3.8).lineTo(6, -3.8).stroke({ width: 1, color: 0xdfe6ff, alpha: 0.8, cap: 'round', join: 'round' });
  } else if (kind === 'break') {
    g.star(0, 0, 8, 6, 2.6, 0).fill(0xef4444);
    g.rect(-0.7, -3, 1.4, 3.6).fill(0xffffff);
    g.circle(0, 2, 0.8).fill(0xffffff);
  } else if (kind === 'star') {
    g.star(0, 0, 5, 5, 2.1, 0).fill(0xffd95e).stroke({ width: 0.8, color: 0xffffff, alpha: 0.8 });
  }
}

// ---------- Raiders and beasts ----------

const BEASTS = new Set(['wolf', 'boar']);
/** How big each kind of foe is drawn next to a human. */
export const FOE_SIZE: Record<string, number> = { troll: 1.7, orc: 1.2, wolf: 0.95, boar: 1, ghoul: 1, bandit: 1, slaver: 1 };

/** A hostile figure: darker and plainer than a colonist, with red eyes and a red marker overhead. */
export function drawFoe(g: Graphics, k: string): void {
  g.clear();
  if (BEASTS.has(k)) {
    const col = k === 'wolf' ? 0x6b7280 : 0x5a4636;
    g.ellipse(0.8, 4.6, 8.4, 3).fill({ color: 0x0b1220, alpha: 0.28 });
    g.poly([-7, 0, -10.5, -2.4, -7.4, 2]).fill(col);
    g.ellipse(0, 1, 7.6, 4.3).fill(col);
    g.poly([4.4, -3.2, 5.2, -6.2, 6.6, -3.6, 7.8, -6, 8.6, -2.8]).fill(col);
    g.circle(6.2, -1, 3.3).fill(lighten(col, 0.1));
    g.circle(7.2, -1.6, 0.7).fill(0xff5a4a);
    if (k === 'boar') g.poly([8, 0.4, 10.4, -1.6, 9, 1.2]).fill(0xf3efe2);
  } else {
    const skin = k === 'ghoul' ? 0xb9c4b0 : k === 'troll' ? 0x6f7f6a : k === 'orc' ? 0x6c8160 : 0xc9a27a;
    const cloak = k === 'troll' ? 0x55604f : k === 'ghoul' ? 0x4a4f4a : 0x2a2630;
    g.ellipse(0.8, 5.4, 7, 3).fill({ color: 0x0b1220, alpha: 0.3 });
    g.ellipse(0, 3.2, 6.2, 4.6).fill(darken(cloak, 0.3));
    g.ellipse(0, 2.4, 6.2, 4.3).fill(cloak);
    g.circle(-5.8, 3.4, 1.5).circle(5.8, 3.4, 1.5).fill(darken(skin, 0.18));
    g.circle(0, -3.4, 4.4).fill(skin);
    if (k === 'bandit' || k === 'slaver') g.ellipse(0, -5.2, 4.8, 3).fill(cloak);
    if (k === 'orc') g.poly([-2.4, -0.2, -1.7, -2.2, -1.1, -0.2]).poly([2.4, -0.2, 1.7, -2.2, 1.1, -0.2]).fill(0xf3efe2);
    g.circle(-1.6, -2.6, 0.75).circle(1.6, -2.6, 0.75).fill(0xff5a4a);
    g.moveTo(6.4, 4.6).lineTo(9.6, -3.4).stroke({ width: 1.2, color: 0xc9ccd4, cap: 'round' });
  }
  g.poly([-2.6, -13.5, 2.6, -13.5, 0, -10]).fill(0xef4444);
}
