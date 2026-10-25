// Small pixel-UI helpers: text, panels, buttons, toasts, relic chips.
import Phaser from 'phaser';
import { RELIC_MAP } from '../sim/relics';

export const FONT = '"Press Start 2P", monospace';

export const C = {
  text: '#e8ecff',
  dim: '#7c86ad',
  gold: '#ffd166',
  atk: '#ff9f43',
  hp: '#7dff8a',
  bad: '#ff5e7e',
  cyan: '#7fe7ff',
  panel: 0x0e1430,
  border: 0x3a4a7a,
  highlight: 0xffd166,
};

export interface TextOpts {
  color?: string;
  size?: number;
  origin?: number | [number, number];
  wrap?: number;
  align?: 'left' | 'center' | 'right';
}

export function txt(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOpts = {}) {
  const t = scene.add.text(Math.round(x), Math.round(y), str, {
    fontFamily: FONT,
    fontSize: `${o.size ?? 8}px`,
    color: o.color ?? C.text,
    align: o.align ?? 'left',
    lineSpacing: 3,
    wordWrap: o.wrap ? { width: o.wrap } : undefined,
  });
  const origin = o.origin ?? 0;
  if (Array.isArray(origin)) t.setOrigin(origin[0], origin[1]);
  else t.setOrigin(origin);
  return t;
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill = C.panel, border = C.border) {
  const g = scene.add.graphics();
  g.fillStyle(border, 1).fillRect(x, y, w, h);
  g.fillStyle(fill, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
  return g;
}

export interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  objects: Phaser.GameObjects.GameObject[];
}

export function button(
  scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, label: string,
  onClick: () => void, opts: { fill?: number; disabled?: boolean; color?: string } = {},
): Button {
  const fill = opts.disabled ? 0x1a1f36 : opts.fill ?? 0x24305e;
  const bg = scene.add.rectangle(cx, cy, w, h, fill).setStrokeStyle(2, opts.disabled ? 0x2a3150 : 0x6a7cc0);
  const t = txt(scene, cx, cy + 1, label, { origin: 0.5, color: opts.disabled ? C.dim : opts.color ?? C.text });
  if (!opts.disabled) {
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setStrokeStyle(2, C.highlight));
    bg.on('pointerout', () => bg.setStrokeStyle(2, 0x6a7cc0));
    bg.on('pointerup', onClick);
  }
  return { bg, label: t, objects: [bg, t] };
}

export function toast(scene: Phaser.Scene, msg: string, color = C.bad) {
  const t = txt(scene, 240, 136, msg, { origin: 0.5, color }).setDepth(1000);
  t.setStroke('#05060f', 4);
  scene.tweens.add({ targets: t, y: 120, alpha: 0, delay: 700, duration: 500, onComplete: () => t.destroy() });
}

export function relicChip(scene: Phaser.Scene, x: number, y: number, id: string, size = 12) {
  const r = RELIC_MAP[id];
  const bg = scene.add.rectangle(x, y, size, size, 0x0b0f22).setStrokeStyle(1, r?.color ?? 0xffffff);
  const t = txt(scene, x + 1, y + 1, r?.glyph ?? '?', {
    origin: 0.5, color: `#${(r?.color ?? 0xffffff).toString(16).padStart(6, '0')}`,
  });
  return { bg, t };
}

/** A thin progress bar; frac is clamped to 0..1. */
export function bar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, frac: number, color: number) {
  const f = Math.max(0, Math.min(1, frac));
  const bg = scene.add.rectangle(x, y, w, h, 0x0b0f22).setOrigin(0).setStrokeStyle(1, 0x3a4a7a);
  const fill = scene.add.rectangle(x + 1, y + 1, Math.max(0, Math.round((w - 2) * f)), h - 2, color).setOrigin(0);
  return [bg, fill];
}

/** Floating number / label that drifts up and fades. */
export function popup(scene: Phaser.Scene, x: number, y: number, str: string, color: string) {
  const t = txt(scene, x, y, str, { origin: 0.5, color }).setDepth(500);
  t.setStroke('#05060f', 3);
  scene.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
}
