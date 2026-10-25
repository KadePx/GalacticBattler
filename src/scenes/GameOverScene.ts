import Phaser from 'phaser';
import { addStarfield, shipKey } from '../game/art';
import { WIN_TARGET, newRun } from '../game/run';
import { clearRun, getRun, saveRun } from '../game/storage';
import { C, button, relicChip, txt } from '../game/ui';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('gameover');
  }

  create() {
    const run = getRun();
    if (!run) {
      this.scene.start('menu');
      return;
    }
    addStarfield(this);
    const won = run.wins >= WIN_TARGET;
    txt(this, 240, 40, won ? 'FLEET TRIUMPHANT' : 'FLEET DESTROYED', {
      size: 16, origin: 0.5, color: won ? C.gold : C.bad,
    }).setStroke('#05060f', 4);
    txt(this, 240, 66, `${run.wins} WINS IN ${run.history.length} BATTLES`, { origin: 0.5 });
    txt(this, 240, 82, run.history.join(' '), { origin: 0.5, color: C.dim, wrap: 440, align: 'center' });

    const ships = run.fleet.filter(Boolean);
    ships.forEach((s, i) => {
      this.add.image(240 + (i - (ships.length - 1) / 2) * 44, 120, shipKey(s!.def, 0)).setScale(2);
    });
    run.relics.forEach((id, i) => {
      relicChip(this, 240 + (i - (run.relics.length - 1) / 2) * 16, 152, id);
    });

    button(this, 240, 196, 150, 20, 'NEW RUN', () => {
      clearRun();
      saveRun(newRun());
      this.scene.start('shop');
    }, { fill: 0x3a2a10, color: C.gold });
    button(this, 240, 224, 150, 20, 'MENU', () => {
      clearRun();
      this.scene.start('menu');
    });
  }
}
