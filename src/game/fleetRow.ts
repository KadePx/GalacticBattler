import Phaser from 'phaser';
import { SHIP_RES, shipKey } from './art';
import { levelStars } from './ui';

/**
 * A fleet drawn as a row of ships centred on `cx`, front ship nearest the enemy:
 * on the right for your side (0), on the left for theirs (1). Shrinks to fit `maxW`.
 * With `levels` (same order as `defs`), each ship gets its level as gold stars underneath.
 * Returns every object drawn.
 */
export function fleetRow(
  scene: Phaser.Scene, defs: string[], cx: number, y: number, side: 0 | 1, maxW = 300, zoom = 2,
  levels?: number[],
) {
  const ims = defs.map((d) => scene.add.image(0, y, shipKey(d, side)).setScale(zoom / SHIP_RES));
  const gap = 6;
  const total = () => ims.reduce((s, im) => s + im.displayWidth, 0) + gap * Math.max(0, ims.length - 1);
  if (total() > maxW) {
    const k = maxW / total();
    ims.forEach((im) => im.setScale(im.scaleX * k));
  }
  let x = side === 0 ? cx + total() / 2 : cx - total() / 2;
  for (const im of ims) {
    im.x = Math.round(side === 0 ? x - im.displayWidth / 2 : x + im.displayWidth / 2);
    x += (side === 0 ? -1 : 1) * (im.displayWidth + gap);
  }
  const out: Phaser.GameObjects.Image[] = [...ims];
  if (levels) {
    // Stars sit on one line under the tallest ship, centred under each ship.
    const below = Math.round(y + Math.max(0, ...ims.map((im) => im.displayHeight)) / 2 + 5);
    ims.forEach((im, i) => {
      const lv = Math.max(1, levels[i] ?? 1);
      out.push(...levelStars(scene, Math.round(im.x + ((lv - 1) * 7) / 2), below, lv));
    });
  }
  return out;
}
