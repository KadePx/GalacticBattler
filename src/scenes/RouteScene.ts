// Boss Gauntlet: pick the route for the next battle, with the sector's progress and its boss.

import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin } from '../game/art';
import { audio } from '../game/audio';
import { BOSS_INFO, NODE_INFO, SECTOR_BATTLES, SECTORS, currentBoss } from '../game/gauntlet';
import { fleetRow } from '../game/fleetRow';
import { START_LIVES, chooseRoute, type Run } from '../game/run';
import { getRun, saveRun } from '../game/storage';
import { C, panel, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';

export class RouteScene extends Phaser.Scene {
  constructor() {
    super('route');
  }

  create() {
    const run = getRun();
    const g = run?.gauntlet;
    if (!run || !g?.choices) {
      this.scene.start(run ? 'shop' : 'menu');
      return;
    }
    setPlayerSkin(run.skin ? run.cmd ?? null : null);
    audio.setMood('shop');
    addStarfield(this);

    // Top bar
    panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52);
    for (let i = 0; i < START_LIVES; i++) this.add.image(12 + i * 10, 10, i < run.lives ? 'heart' : 'heart_empty');
    txt(this, 70, 7, `SECTOR ${g.sector}/${SECTORS}`, { color: C.gold });
    txt(this, 190, 7, `ROUND ${run.round}`);
    txt(this, 472, 7, `BOSSES ${g.beaten}/${SECTORS}`, { origin: [1, 0], color: C.bad });

    txt(this, 240, 32, 'CHOOSE YOUR ROUTE', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);

    // Sector track: 4 battles, then the boss.
    const y = 54;
    for (let i = 0; i <= SECTOR_BATTLES; i++) {
      const x = 240 + (i - SECTOR_BATTLES / 2) * 40;
      const done = i < g.step;
      const now = i === g.step;
      const boss = i === SECTOR_BATTLES;
      if (i > 0) this.add.rectangle(x - 20, y, 24, 2, done || now ? 0x6a7cc0 : 0x262e50);
      this.add.rectangle(x, y, boss ? 16 : 10, boss ? 16 : 10, done ? 0x6a7cc0 : boss ? 0x3a0a14 : 0x10142c)
        .setStrokeStyle(now ? 2 : 1, now ? 0xffd166 : boss ? 0xff5e7e : 0x3a4a7a);
      if (boss) txt(this, x, y + 14, 'BOSS', { origin: [0.5, 0], color: C.bad });
    }

    // The two routes
    g.choices.forEach((kind, i) => {
      const info = NODE_INFO[kind];
      const x = 128 + i * 224;
      const card = this.add.rectangle(x, 128, 200, 76, 0x10142c).setStrokeStyle(2, 0x3a4a7a).setInteractive({ useHandCursor: true });
      txt(this, x, 102, info.name, { size: 12, origin: [0.5, 0], color: info.color });
      txt(this, x, 122, info.desc, { origin: [0.5, 0], color: C.text, wrap: 184, align: 'center' });
      card.on('pointerover', () => card.setStrokeStyle(2, C.highlight));
      card.on('pointerout', () => card.setStrokeStyle(2, 0x3a4a7a));
      card.on('pointerup', () => this.pick(run, i));
    });

    // The sector boss waiting at the end.
    const boss = currentBoss(g);
    panel(this, 40, 176, 400, 70, 0x0a0e22, 0x5a2030);
    fleetRow(this, [boss], 92, 211, 1, 90, 2);
    txt(this, 148, 186, `SECTOR BOSS: ${BOSS_INFO[boss].title}`, { color: C.bad });
    txt(this, 148, 200, BOSS_INFO[boss].tip, { color: C.dim, wrap: 284 });

    const c = run.cmd ? CMD_MAP[run.cmd] : null;
    if (c) this.add.image(460, 258, portraitKey(c.id)).setScale(1);
    txt(this, 240, 258, 'Tap a route. Then shop as usual.', { origin: 0.5, color: C.faint });
  }

  private pick(run: Run, i: number) {
    chooseRoute(run, i);
    saveRun(run);
    audio.play('click');
    this.scene.start('shop');
  }
}
