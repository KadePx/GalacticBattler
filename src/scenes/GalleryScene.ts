// Dev-only sprite sheet for reviewing ship art. Open the game with ?gallery
// (player faction) or ?gallery=1 (enemy faction). Click to swap faction.
import Phaser from 'phaser';
import { addShip, addStarfield } from '../game/art';
import { SHIPS } from '../sim/ships';
import { C, txt } from '../game/ui';

export class GalleryScene extends Phaser.Scene {
  constructor() {
    super('gallery');
  }

  create(data: { side?: 0 | 1 }) {
    const param = new URLSearchParams(location.search).get('gallery');
    const side: 0 | 1 = data.side ?? (param === '1' ? 1 : 0);
    addStarfield(this);
    txt(this, 240, 4, side === 0 ? 'PLAYER FACTION (click to swap)' : 'ENEMY FACTION (click to swap)',
      { origin: [0.5, 0], color: C.dim });
    const defs = Object.values(SHIPS);
    // 7 columns x 4 rows fits every ship (27 including summons).
    defs.forEach((d, i) => {
      const col = i % 7;
      const row = Math.floor(i / 7);
      const x = 36 + col * 68;
      const y = 34 + row * 62;
      addShip(this, x, y, d.id, side, 2);
      txt(this, x, y + 20, d.name.toUpperCase(), { origin: [0.5, 0], color: d.accent[1] }).setScale(0.6);
    });
    this.input.once('pointerup', () => this.scene.restart({ side: side === 0 ? 1 : 0 }));
  }
}
