// Daily challenge: today's commander, start or continue your run, and the leaderboard.

import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin } from '../game/art';
import { audio } from '../game/audio';
import { dailyCommander, dailyState, dayKey, newDailyRun } from '../game/daily';
import { fetchDaily, getPilot, submitDaily, type DailyEntry } from '../game/net';
import { WIN_TARGET } from '../game/run';
import { peekRun, saveRun, saveRunTo, useSlot } from '../game/storage';
import { C, button, panel, relicChip, txt } from '../game/ui';
import { fleetRow } from '../game/fleetRow';
import { SHIPS } from '../sim/ships';
import { CMD_MAP } from '../sim/commanders';
import { sceneFor } from './MenuScene';

export class DailyScene extends Phaser.Scene {
  private preview: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('daily');
  }

  create() {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
    this.preview = [];
    const day = dayKey();
    const cmd = dailyCommander(day);
    const state = dailyState();

    txt(this, 240, 14, 'DAILY CHALLENGE', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);
    txt(this, 240, 32, `${day}  (NEW CHALLENGE AT MIDNIGHT UTC)`, { origin: 0.5, color: C.dim });

    // Left: today's setup and your status.
    panel(this, 12, 44, 176, 196);
    this.add.rectangle(46, 78, 52, 52, 0x05060f).setStrokeStyle(1, C.border);
    this.add.image(46, 78, portraitKey(cmd.id)).setScale(3);
    txt(this, 78, 56, "TODAY'S\nCOMMANDER", { color: C.dim });
    txt(this, 78, 82, cmd.name.toUpperCase(), { color: cmd.color });
    txt(this, 78, 94, cmd.title.toUpperCase(), { color: C.faint, wrap: 104 });
    txt(this, 22, 112, 'Same commander, starting shop and rivals for everyone. Only your first finished run counts.',
      { color: C.text, wrap: 158 });

    const run = peekRun('daily');
    const status = txt(this, 22, 186, '', { color: C.dim, wrap: 158 });
    if (state === 'playing' && run) {
      status.setText(`IN PROGRESS: ${run.wins} WINS, ${run.lives} HULL${run.daily !== day ? ' (YESTERDAY)' : ''}`);
      button(this, 100, 226, 156, 20, 'CONTINUE', () => {
        useSlot('daily');
        this.scene.start(sceneFor(run.phase));
      }, { fill: 0x3a2a10, color: C.gold });
    } else if (state === 'done' && run) {
      const result = run.wins >= WIN_TARGET ? 'CLEARED!' : `${run.wins} WIN${run.wins === 1 ? '' : 'S'}`;
      status.setText(`DONE: ${result}\nCome back tomorrow.`);
      if (run.dailyRank === undefined) void this.resend();
    } else {
      button(this, 100, 226, 156, 20, 'START', () => {
        useSlot('daily');
        saveRun(newDailyRun(day));
        audio.play('launch');
        this.scene.start('shop');
      }, { fill: 0x3a2a10, color: C.gold });
    }

    // Right: the board.
    panel(this, 196, 44, 272, 196);
    txt(this, 206, 50, 'LEADERBOARD', { color: C.gold });
    const loading = txt(this, 332, 140, 'LOADING...', { origin: 0.5, color: C.dim });
    void fetchDaily(day).then((board) => {
      if (!this.scene.isActive()) return;
      if (!board) return void loading.setText('OFFLINE: board unavailable');
      loading.destroy();
      txt(this, 458, 50, `${board.total} PILOT${board.total === 1 ? '' : 'S'}`, { origin: [1, 0], color: C.dim });
      if (!board.top.length) txt(this, 332, 140, 'No scores yet.\nBe the first!', { origin: 0.5, color: C.dim, align: 'center' });
      else txt(this, 332, 232, 'TAP A PILOT TO SEE THEIR BUILD', { origin: 0.5, color: C.faint });
      const rows = board.top.slice(0, board.me && board.me.rank > 11 ? 10 : 11);
      rows.forEach((e, i) => this.row(e, 66 + i * 13, e.name === getPilot().name && board.me?.rank === e.rank));
      if (board.me && board.me.rank > rows.length) this.row(board.me, 66 + 11 * 13, true);
    });

    button(this, 60, 256, 88, 16, 'MENU', () => this.scene.start('menu'));
  }

  private row(e: DailyEntry, y: number, mine: boolean) {
    const color = mine ? C.gold : C.text;
    if (mine) this.add.rectangle(332, y + 4, 266, 12, 0x3a2a10, 0.6);
    txt(this, 206, y, `${e.rank}.`, { color: C.dim });
    txt(this, 230, y, e.name, { color });
    txt(this, 372, y, e.wins >= WIN_TARGET ? 'WIN' : `${e.wins}W`, { origin: [1, 0], color: e.wins >= WIN_TARGET ? C.gold : color });
    txt(this, 408, y, `${e.lives}HP`, { origin: [1, 0], color: C.hp });
    const c = CMD_MAP[e.cmd];
    txt(this, 458, y, c ? c.name.slice(0, 4).toUpperCase() : '', { origin: [1, 0], color: c?.color ?? C.dim });
    const hit = this.add.rectangle(332, y + 4, 266, 13, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => this.showBuild(e));
    hit.on('pointerup', () => this.showBuild(e));
    hit.on('pointerout', () => this.hideBuild());
  }

  /** A pilot's final build, drawn over the left panel: commander, fleet and relics. */
  private showBuild(e: DailyEntry) {
    this.hideBuild();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(20);
      this.preview.push(o);
      return o;
    };
    add(panel(this, 12, 44, 176, 196, 0x0a0e22, 0x6a7cc0));
    add(txt(this, 22, 50, `#${e.rank} ${e.name}`, { color: C.gold, wrap: 160 }));
    const c = CMD_MAP[e.cmd];
    add(txt(this, 22, 62, `${c?.name.toUpperCase() ?? ''}  ${e.wins >= WIN_TARGET ? 'CLEARED' : `${e.wins} WINS`}  ${e.lives} HULL`, { color: c?.color ?? C.dim, wrap: 160 }));
    fleetRow(this, e.fleet.map((f) => f[0]), 100, 90, 0, 160).forEach(add);
    add(txt(this, 22, 106, 'FLEET (FRONT FIRST)', { color: C.faint }));
    e.fleet.forEach(([def, lv], i) => {
      add(txt(this, 22, 118 + i * 11, `LV${lv} ${(SHIPS[def]?.name ?? def).toUpperCase()}`, { color: lv >= 3 ? C.gold : lv === 2 ? C.cyan : C.text }));
    });
    const relics = e.relics ?? [];
    const ry = 118 + Math.max(1, e.fleet.length) * 11 + 6;
    add(txt(this, 22, ry, relics.length ? 'RELICS' : 'NO RELICS RECORDED', { color: C.faint }));
    const perRow = 10;
    relics.slice(0, 20).forEach((id, i) => {
      const chip = relicChip(this, 28 + (i % perRow) * 16, ry + 18 + Math.floor(i / perRow) * 16, id);
      add(chip.bg);
      add(chip.t);
    });
  }

  private hideBuild() {
    this.preview.forEach((o) => o.destroy());
    this.preview = [];
  }

  /** A finished daily whose score didn't reach the server yet (offline at the time). */
  private async resend() {
    const run = peekRun('daily');
    if (!run || run.phase !== 'over' || run.dailyRank !== undefined) return;
    const rank = await submitDaily(run);
    if (rank === null) return;
    run.dailyRank = rank;
    saveRunTo('daily', run);
    if (this.scene.isActive()) this.scene.restart();
  }
}
