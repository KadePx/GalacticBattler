// Daily challenge: today's commander, start or continue your run, and the leaderboard.

import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin } from '../game/art';
import { audio } from '../game/audio';
import { dailyCommander, dailyState, dayKey, newDailyRun } from '../game/daily';
import { fetchDaily, submitDaily, type DailyEntry } from '../game/net';
import { WIN_TARGET } from '../game/run';
import { peekRun, saveRun, saveRunTo, useSlot } from '../game/storage';
import { C, button, panel, relicChip, txt } from '../game/ui';
import { fleetRow } from '../game/fleetRow';
import { SHIPS } from '../sim/ships';
import { CMD_MAP } from '../sim/commanders';
import { sceneFor } from './MenuScene';
import { STYLE_LABEL } from './CommanderScene';

/** The first daily challenge; the board can be browsed back to here. */
const FIRST_DAY = '2026-10-29';
const DAY_MS = 86_400_000;
/** The day before or after a YYYY-MM-DD key. */
const shiftDay = (d: string, by: number) => dayKey(Date.parse(`${d}T12:00:00Z`) + by * DAY_MS);
/** Board columns: rank and wins are right-aligned so 1- to 3-digit numbers line up. */
const ROW = { rank: 228, name: 232, wins: 372, heart: 383, cmd: 462 };

export class DailyScene extends Phaser.Scene {
  private preview: Phaser.GameObjects.GameObject[] = [];
  /** The build preview was opened by a tap: it stays until tapped again (hover can't close it). */
  private pinned = false;

  constructor() {
    super('daily');
  }

  create(data?: { boardDay?: string }) {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
    this.preview = [];
    this.pinned = false;
    const day = dayKey();
    const yesterday = dayKey(Date.now() - 86_400_000);
    const cmd = dailyCommander(day);
    const state = dailyState();
    const run = peekRun('daily');
    // Your last finished daily, if it can still be scored (today's, or yesterday's).
    const finished = run?.phase === 'over' && (run.daily === day || run.daily === yesterday) ? run : null;
    // The day rolls over at midnight UTC (evening in the Americas), so right after a late run
    // the board you just played on is yesterday's: show that one until today's is started.
    // Any past day's board can be viewed; only today's challenge can be played.
    const asked = data?.boardDay;
    const boardDay = asked && asked >= FIRST_DAY && asked <= day ? asked
      : state === 'new' && finished?.daily === yesterday ? yesterday : day;

    txt(this, 240, 14, 'DAILY CHALLENGE', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);
    txt(this, 240, 32, `${day}  (NEW CHALLENGE AT MIDNIGHT UTC)`, { origin: 0.5, color: C.dim });

    // Left: today's setup and your status.
    panel(this, 12, 44, 176, 196);
    this.add.rectangle(46, 78, 52, 52, 0x05060f).setStrokeStyle(1, C.border);
    this.add.image(46, 78, portraitKey(cmd.id)).setScale(3);
    // Three short blocks beside the portrait; the play style may wrap to 2 lines.
    txt(this, 78, 54, "TODAY'S", { color: C.dim });
    txt(this, 78, 66, cmd.name.toUpperCase(), { color: cmd.color });
    txt(this, 78, 80, STYLE_LABEL[cmd.style] ?? '', { color: C.faint, wrap: 104 });
    txt(this, 20, 110, 'Same commander, shops and rivals for all. First finished run counts.', { color: C.text, wrap: 164 });
    txt(this, 20, 156, 'RANKED BY WINS, THEN HULL LEFT, THEN FEWEST BATTLES.', { color: C.faint, wrap: 164 });

    const status = txt(this, 20, 190, '', { color: C.dim, wrap: 164 });
    if (state === 'playing' && run) {
      status.setText(`IN PROGRESS: ${run.wins} WINS, ${run.lives} HULL${run.daily !== day ? ' (YESTERDAY)' : ''}`);
      button(this, 100, 226, 156, 20, 'CONTINUE', () => {
        useSlot('daily');
        this.scene.start(sceneFor(run.phase));
      }, { fill: 0x3a2a10, color: C.gold });
    } else if (state === 'done' && run) {
      const result = run.wins >= WIN_TARGET ? 'CLEARED!' : `${run.wins} WIN${run.wins === 1 ? '' : 'S'}`;
      status.setText(`DONE: ${result}\nCome back tomorrow.`);
    } else {
      if (finished) {
        const result = finished.wins >= WIN_TARGET ? 'CLEARED' : `${finished.wins} WINS`;
        status.setText(`YESTERDAY: ${result}${finished.dailyRank ? `, RANK ${finished.dailyRank}` : ''}`);
      }
      button(this, 100, 226, 156, 20, 'START', () => {
        useSlot('daily');
        saveRun(newDailyRun(day));
        audio.play('launch');
        this.scene.start('shop');
      }, { fill: 0x3a2a10, color: C.gold });
    }

    // A score that didn't reach the server yet (offline, or rejected by an older server).
    if (finished && finished.dailyRank === undefined) void this.resend(boardDay);

    // Right: the board.
    panel(this, 196, 44, 272, 196);
    const label = boardDay === day ? 'TODAY' : boardDay === yesterday ? 'YESTERDAY' : boardDay;
    if (boardDay > FIRST_DAY) button(this, 212, 57, 24, 18, '<', () => this.scene.restart({ boardDay: shiftDay(boardDay, -1) }));
    txt(this, 230, 53, label, { color: C.gold });
    if (boardDay < day) button(this, 230 + label.length * 8 + 16, 57, 24, 18, '>', () => this.scene.restart({ boardDay: shiftDay(boardDay, 1) }));
    if (boardDay < yesterday) txt(this, 332, 222, 'PAST CHALLENGE: VIEW ONLY', { origin: 0.5, color: C.faint });
    const loading = txt(this, 332, 140, 'LOADING...', { origin: 0.5, color: C.dim });
    void fetchDaily(boardDay).then((board) => {
      if (!this.scene.isActive()) return;
      if (!board) return void loading.setText('OFFLINE: board unavailable');
      loading.destroy();
      txt(this, 458, 53, `${board.total} PILOT${board.total === 1 ? '' : 'S'}`, { origin: [1, 0], color: C.dim });
      if (!board.top.length) return void txt(this, 332, 140, boardDay === day ? 'No scores yet.\nBe the first!' : 'No scores that day.', { origin: 0.5, color: C.dim, align: 'center' });
      txt(this, 332, 233, 'TAP A PILOT TO SEE THEIR BUILD', { origin: 0.5, color: C.faint });
      // Column headers.
      txt(this, ROW.rank, 69, '#', { origin: [1, 0], color: C.faint });
      txt(this, ROW.name, 69, 'PILOT', { color: C.faint });
      txt(this, ROW.wins, 69, 'WINS', { origin: [1, 0], color: C.faint });
      this.add.image(ROW.heart, 72, 'heart').setAlpha(0.5);
      txt(this, ROW.cmd, 69, 'CMDR', { origin: [1, 0], color: C.faint });
      const rows = board.top.slice(0, board.me && board.me.rank > 10 ? 9 : 10);
      rows.forEach((e, i) => this.row(e, 82 + i * 14, board.me?.rank === e.rank));
      if (board.me && board.me.rank > rows.length) this.row(board.me, 82 + 9 * 14, true);
    });

    button(this, 60, 256, 88, 16, 'MENU', () => this.scene.start('menu'));
  }

  private row(e: DailyEntry, y: number, mine: boolean) {
    const color = mine ? C.gold : C.text;
    if (mine) this.add.rectangle(332, y + 4, 266, 13, 0x3a2a10, 0.6);
    txt(this, ROW.rank, y, `${e.rank}`, { origin: [1, 0], color: C.dim });
    txt(this, ROW.name, y, e.name, { color });
    txt(this, ROW.wins, y, e.wins >= WIN_TARGET ? 'WIN' : `${e.wins}`, { origin: [1, 0], color: e.wins >= WIN_TARGET ? C.gold : color });
    this.add.image(ROW.heart, y + 3, 'heart');
    txt(this, ROW.heart + 6, y, `${e.lives}`, { color: C.text });
    const c = CMD_MAP[e.cmd];
    txt(this, ROW.cmd, y, c ? c.name.toUpperCase() : '', { origin: [1, 0], color: c?.color ?? C.dim });
    const hit = this.add.rectangle(332, y + 4, 266, 14, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { if (!this.pinned) this.showBuild(e); });
    hit.on('pointerup', () => this.showBuild(e, true));
    hit.on('pointerout', () => { if (!this.pinned) this.hideBuild(); });
  }

  /** A pilot's final build, drawn over the left panel: commander, fleet and relics. */
  private showBuild(e: DailyEntry, pin = false) {
    this.hideBuild();
    this.pinned = pin;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(20);
      this.preview.push(o);
      return o;
    };
    if (pin) {
      // Opened by a tap: swallow every tap (START/CONTINUE sit under the preview) and close on one.
      const blocker = add(this.add.rectangle(240, 135, 480, 270, 0x000000, 0.001).setInteractive()).setDepth(19);
      let down = false;
      blocker.on('pointerdown', () => { down = true; });
      blocker.on('pointerup', () => { if (down) this.hideBuild(); });
    }
    add(panel(this, 12, 44, 176, 196, 0x0a0e22, 0x6a7cc0));
    add(txt(this, 20, 50, `#${e.rank} ${e.name}`, { color: C.gold }));
    const c = CMD_MAP[e.cmd];
    add(txt(this, 20, 62, c?.name.toUpperCase() ?? '', { color: c?.color ?? C.dim }));
    add(txt(this, 20, 74, e.wins >= WIN_TARGET ? 'CLEARED' : `${e.wins} WIN${e.wins === 1 ? '' : 'S'}`, { color: e.wins >= WIN_TARGET ? C.gold : C.text }));
    add(this.add.image(176, 65, 'heart'));
    add(txt(this, 168, 62, `${e.lives}`, { origin: [1, 0] }));
    add(txt(this, 180, 74, `${e.battles} BATTLES`, { origin: [1, 0], color: C.faint }));
    fleetRow(this, e.fleet.map((f) => f[0]), 100, 98, 0, 160, 2, e.fleet.map((f) => f[1])).forEach(add);
    add(txt(this, 20, 124, 'FLEET (FRONT FIRST)', { color: C.faint }));
    e.fleet.forEach(([def, lv], i) => {
      add(txt(this, 20, 136 + i * 10, `LV${lv} ${(SHIPS[def]?.name ?? def).toUpperCase()}`, { color: lv >= 3 ? C.gold : lv === 2 ? C.cyan : C.text }));
    });
    const relics = e.relics ?? [];
    const ry = 136 + Math.max(1, e.fleet.length) * 10 + 4;
    add(txt(this, 20, ry, relics.length ? `RELICS (${relics.length})` : 'NO RELICS RECORDED', { color: C.faint }));
    // Chips fill the rows that fit above the close hint; any extra become "+N".
    const perRow = 10;
    const rowsFit = Math.max(1, Math.floor((206 - ry) / 14) + 1);
    const cap = perRow * rowsFit;
    const shown = relics.length > cap ? relics.slice(0, cap - 1) : relics;
    shown.forEach((id, i) => {
      const chip = relicChip(this, 26 + (i % perRow) * 16, ry + 17 + Math.floor(i / perRow) * 14, id);
      add(chip.bg);
      add(chip.t);
    });
    if (shown.length < relics.length) {
      const i = shown.length;
      add(txt(this, 20 + (i % perRow) * 16, ry + 13 + Math.floor(i / perRow) * 14, `+${relics.length - i}`, { color: C.dim }));
    }
    if (pin) add(txt(this, 100, 230, 'TAP TO CLOSE', { origin: [0.5, 0], color: C.faint }));
  }

  private hideBuild() {
    this.preview.forEach((o) => o.destroy());
    this.preview = [];
    this.pinned = false;
  }

  /** A finished daily whose score didn't reach the server yet (offline at the time). */
  private async resend(boardDay: string) {
    const run = peekRun('daily');
    if (!run || run.phase !== 'over' || run.dailyRank !== undefined) return;
    const rank = await submitDaily(run);
    if (rank === null) return;
    run.dailyRank = rank;
    saveRunTo('daily', run);
    if (this.scene.isActive()) this.scene.restart({ boardDay });
  }
}
