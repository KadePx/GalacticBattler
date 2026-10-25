import Phaser from 'phaser';
import { addShip, addStarfield, syncFlame } from '../game/art';
import { newRun } from '../game/run';
import { clearRun, getRun, saveRun } from '../game/storage';
import { C, button, txt } from '../game/ui';

interface Flyer {
  spr: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  side: 0 | 1;
  speed: number;
  baseY: number;
  phase: number;
}

export class MenuScene extends Phaser.Scene {
  private flyers: Flyer[] = [];

  constructor() {
    super('menu');
  }

  create() {
    addStarfield(this, true);
    this.flyers = [];

    // Flyby: a player squadron heading right, a raider pack heading left behind it.
    const squad: [string, 0 | 1, number, number][] = [
      ['dread', 0, 112, 0], ['gunboat', 0, 98, 60], ['scout', 0, 126, 90], ['carrier', 0, 134, 170],
      ['queen', 1, 196, 40], ['raider', 1, 210, 120], ['phantom', 1, 188, 200],
    ];
    for (const [def, side, y, offset] of squad) {
      const x = side === 0 ? -40 - offset : 520 + offset;
      const { spr, flame } = addShip(this, x, y, def, side, 2);
      if (side === 1) { spr.setAlpha(0.8); }
      this.flyers.push({ spr, flame, side, speed: side === 0 ? 0.035 : 0.05, baseY: y, phase: Math.random() * 6 });
    }

    const title = txt(this, 240, 46, 'STARBRAWL', { size: 24, origin: 0.5, color: C.gold });
    title.setStroke('#3a1d00', 6);
    txt(this, 240, 72, 'SPACE AUTO-BATTLER', { origin: 0.5, color: C.cyan }).setStroke('#05060f', 3);

    const saved = getRun();
    let y = 160;
    if (saved && saved.phase !== 'over') {
      button(this, 240, y, 150, 20, 'CONTINUE', () => this.scene.start(sceneFor(saved.phase)));
      y += 28;
    }
    button(this, 240, y, 150, 20, 'NEW RUN', () => {
      clearRun();
      saveRun(newRun());
      this.scene.start('shop');
    }, { fill: 0x3a2a10, color: C.gold });

    txt(this, 240, 246, 'Build a fleet. Win 10 battles before your 5 hull points run out.',
      { origin: 0.5, color: C.dim, wrap: 440, align: 'center' }).setStroke('#05060f', 3);
  }

  update(time: number, delta: number) {
    for (const f of this.flyers) {
      f.spr.x += (f.side === 0 ? 1 : -1) * f.speed * delta;
      if (f.side === 0 && f.spr.x > 540) f.spr.x = -60;
      if (f.side === 1 && f.spr.x < -60) f.spr.x = 540;
      f.spr.y = Math.round(f.baseY + Math.sin(time * 0.002 + f.phase) * 2);
      syncFlame(f.spr, f.flame, f.side);
    }
  }
}

export const sceneFor = (phase: string) => (phase === 'relic' ? 'relic' : phase === 'over' ? 'gameover' : 'shop');
