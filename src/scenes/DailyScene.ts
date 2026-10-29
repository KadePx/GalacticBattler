// Daily challenge: today's commander, start or continue your run, and the leaderboard.

import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin } from '../game/art';
import { audio } from '../game/audio';
import { dailyCommander, dailyState, dayKey, newDailyRun } from '../game/daily';
import { fetchDaily, getPilot, submitDaily, type DailyEntry } from '../game/net';
import { WIN_TARGET } from '../game/run';
import { peekRun, saveRun, saveRunTo, useSlot } from '../game/storage';
import { C, button, panel, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';
import { sceneFor } from './MenuScene';

export class DailyScene extends Phaser.Scene {
  constructor() {
    super('daily');
  }

  create() {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
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
      const rows = board.top.slice(0, board.me && board.me.rank > 12 ? 11 : 12);
      rows.forEach((e, i) => this.row(e, 66 + i * 13, e.name === getPilot().name && board.me?.rank === e.rank));
      if (board.me && board.me.rank > rows.length) this.row(board.me, 66 + 12 * 13, true);
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
