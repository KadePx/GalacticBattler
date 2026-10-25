import Phaser from 'phaser';
import { addStarfield } from '../game/art';
import { chooseRelic, type Run } from '../game/run';
import { getRun, saveRun } from '../game/storage';
import { C, panel, relicChip, txt } from '../game/ui';
import { RELIC_MAP, count } from '../sim/relics';

export class RelicScene extends Phaser.Scene {
  constructor() {
    super('relic');
  }

  create() {
    const run = getRun();
    if (!run || run.phase !== 'relic') {
      this.scene.start('menu');
      return;
    }
    addStarfield(this);
    const last = run.history[run.history.length - 1];
    const head = last === 'W' ? 'VICTORY SALVAGE' : last === 'L' ? 'EMERGENCY REFIT' : 'FIELD UPGRADE';
    txt(this, 240, 34, head, { size: 16, origin: 0.5, color: last === 'L' ? C.bad : C.gold }).setStroke('#05060f', 4);
    txt(this, 240, 58, 'Choose one relic. It lasts for the rest of the run.', { origin: 0.5, color: C.dim });

    run.relicOffer.forEach((id, i) => this.card(run, id, 90 + i * 150, 146));
  }

  private card(run: Run, id: string, cx: number, cy: number) {
    const r = RELIC_MAP[id];
    const owned = count(run.relics, id);
    panel(this, cx - 66, cy - 66, 132, 132);
    const hit = this.add.rectangle(cx, cy, 132, 132, 0xffffff, 0).setInteractive({ useHandCursor: true });
    const frame = this.add.rectangle(cx, cy, 132, 132).setStrokeStyle(2, 0x3a4a7a);
    const chip = relicChip(this, cx, cy - 38, id, 24);
    chip.t.setFontSize(16);
    txt(this, cx, cy - 10, r.name, { origin: 0.5, color: C.gold, wrap: 120, align: 'center' });
    txt(this, cx, cy + 22, r.desc, { origin: 0.5, wrap: 116, align: 'center' });
    if (owned) txt(this, cx, cy + 52, `OWNED x${owned}`, { origin: 0.5, color: C.dim });

    hit.on('pointerover', () => frame.setStrokeStyle(2, C.highlight));
    hit.on('pointerout', () => frame.setStrokeStyle(2, 0x3a4a7a));
    hit.on('pointerup', () => {
      chooseRelic(run, id);
      saveRun(run);
      this.scene.start('shop');
    });
  }
}
