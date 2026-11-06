import Phaser from 'phaser';
import { modNames } from '../game/modifiers';
import { SHIP_RES, addStarfield, portraitKey, setPlayerSkin, shipKey } from '../game/art';
import { CMD_LEVEL_XP, CMD_MAX_LEVEL, UNLOCKS, awardRun, cmdLevel, pilotRank, rankXp, stepProgress } from '../game/profile';
import { WIN_TARGET, endlessWins, goEndless, makeSnapshot, type Run } from '../game/run';
import { activeSlot, clearRun, getRun, saveRun, saveRunTo } from '../game/storage';
import { getPilot, logRun, submitDaily } from '../game/net';
import { shareFleet } from '../game/share';
import { gauntletCleared } from '../game/gauntlet';
import { C, bar, button, historyPips, panel, relicChip, toast, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { relicTips } from './RelicScene';

/** Right edge for the XP numbers, inside the rewards panel (which ends at x 440). */
const NUM_R = 432;
/** Progress bars end here, leaving room for "9999/9999" right-aligned at NUM_R. */
const BAR_R = 356;

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
    setPlayerSkin(run.skin ? run.cmd : null);
    audio.setMood('menu');
    addStarfield(this);
    const won = run.gauntlet ? gauntletCleared(run.gauntlet) : run.wins >= WIN_TARGET;
    const title = run.gauntlet ? (won ? 'GAUNTLET CONQUERED!' : `FELL IN SECTOR ${run.gauntlet.sector}`) : run.daily ? (won ? 'DAILY CLEARED!' : 'DAILY OVER') : run.endless ? 'ENDLESS RUN OVER' : won ? 'FLEET TRIUMPHANT' : 'FLEET DESTROYED';
    txt(this, 240, 22, title, { size: 16, origin: 0.5, color: run.endless ? '#c58cff' : won ? C.gold : C.bad }).setStroke('#05060f', 4);
    const sub = run.gauntlet
      ? `${run.gauntlet.beaten} OF 3 BOSSES BEATEN IN ${run.history.length} BATTLES`
      : run.endless
      ? `${run.wins} WINS (${WIN_TARGET} + ${endlessWins(run)} ENDLESS) IN ${run.history.length} BATTLES`
      : `${run.wins} WINS IN ${run.history.length} BATTLES`;
    const mods = run.mods?.length ? `  +${run.mods.length} MOD${run.mods.length > 1 ? 'S' : ''}` : '';
    txt(this, 240, 42, sub + mods, { origin: 0.5 });
    const hist = run.history.slice(-24);
    historyPips(this, 240 + ((hist.length - 1) * 9) / 2, 56, hist, 24);

    // Front ship on the right, matching the shop and battle. Spacing follows sprite widths.
    const ships = run.fleet.filter(Boolean).map((s) => this.add.image(0, 82, shipKey(s!.def, 0)).setScale(2 / SHIP_RES));
    const gap = 8;
    const total = ships.reduce((sum, im) => sum + im.displayWidth, 0) + gap * Math.max(0, ships.length - 1);
    let x = 240 + total / 2;
    for (const im of ships) {
      im.x = Math.round(x - im.displayWidth / 2);
      x -= im.displayWidth + gap;
    }
    const step = Math.min(16, 440 / Math.max(1, run.relics.length));
    const chips = run.relics.map((id, i) => ({ id, x: 240 + (i - (run.relics.length - 1) / 2) * step, y: 106, size: 12 }));
    chips.forEach((ch) => relicChip(this, ch.x, ch.y, ch.id));
    if (chips.length) {
      // Tap/hover a chip for its name and effect (the box opens over the rewards panel).
      const left = chips[0].x - 8;
      const right = chips[chips.length - 1].x + 8;
      relicTips(this, chips, { x: left, y: 96, w: right - left, h: 20 }, { x: 90, w: 300, top: 120 });
    }

    // Rewards (paid once; the run remembers it was paid so refreshing is safe).
    const award = awardRun(run);
    saveRun(run);
    if (award) {
      this.rewards({ ...award, endlessRun: !!run.endless });
      // Celebrate progress a moment after the screen appears.
      const ranked = pilotRank(award.pilotAfter) > pilotRank(award.pilotBefore);
      const leveled = !!award.cmd && cmdLevel(award.cmdAfter) > cmdLevel(award.cmdBefore);
      if (ranked || leveled) this.time.delayedCall(500, () => audio.play(ranked ? 'rankup' : 'levelup'));
    }

    // Log the finished run online (balance data); endless runs log again when they end.
    if (run.loggedAt !== run.history.length) {
      logRun(run);
      run.loggedAt = run.history.length;
      saveRun(run);
    }

    if (run.daily) return this.dailyButtons(run);

    // After a win, the same fleet can keep going in endless mode.
    const canGoOn = won && !run.endless && !run.gauntlet;
    const bx = canGoOn ? [66, 182, 298, 414] : [124, 240, 356];
    const w = 108;
    button(this, bx[canGoOn ? 2 : 1], 252, w, 20, 'SHARE FLEET', () => void this.share(run), { fill: 0x2a1a4a, color: '#c58cff' });
    if (canGoOn) {
      button(this, bx[0], 252, w, 20, 'KEEP GOING', () => {
        goEndless(run);
        saveRun(run);
        audio.play('launch');
        this.scene.start('relic');
      }, { fill: 0x2a1a4a, color: '#c58cff' });
      txt(this, 240, 228, 'KEEP GOING = ENDLESS: +2 HULL, MORE XP.', { origin: 0.5, color: '#c58cff' });
    }
    button(this, bx[canGoOn ? 1 : 0], 252, w, 20, 'NEW RUN', () => {
      clearRun();
      this.scene.start('commanders');
    }, { fill: 0x3a2a10, color: C.gold });
    button(this, bx[canGoOn ? 3 : 2], 252, w, 20, 'MENU', () => {
      clearRun();
      this.scene.start('menu');
    });
  }

  /** Daily runs: send the score, then the board. The run is kept (it marks today as played). */
  private dailyButtons(run: Run) {
    const rankT = txt(this, 240, 228, run.dailyRank !== undefined ? this.rankText(run.dailyRank) : 'SENDING SCORE...', { origin: 0.5, color: C.gold });
    if (run.dailyRank === undefined) {
      const slot = activeSlot();
      void submitDaily(run).then((rank) => {
        if (rank === null) return void (rankT.active && rankT.setText('OFFLINE: SCORE WILL SEND LATER'));
        run.dailyRank = rank;
        saveRunTo(slot, run);
        if (rankT.active) rankT.setText(this.rankText(rank));
      });
    }
    button(this, 124, 252, 108, 20, 'DAILY BOARD', () => this.scene.start('daily'), { fill: 0x3a2a10, color: C.gold });
    button(this, 240, 252, 108, 20, 'SHARE FLEET', () => void this.share(run), { fill: 0x2a1a4a, color: '#c58cff' });
    button(this, 356, 252, 108, 20, 'MENU', () => this.scene.start('menu'));
  }

  private rankText(rank: number) {
    return rank > 0 ? `DAILY RANK #${rank}` : 'SCORE SENT';
  }

  private async share(run: Run) {
    const how = await shareFleet(makeSnapshot(run, getPilot().name));
    if (how === 'copied') toast(this, 'Fleet link copied! Send it to a friend.', C.gold);
  }

  private rewards(a: NonNullable<ReturnType<typeof awardRun>> & { endlessRun: boolean }) {
    panel(this, 40, 118, 400, 120);
    txt(this, 50, 124, `+${a.gained} XP`, { color: C.gold, size: 8 });
    const line1 = [`BATTLES +${a.xp.battles}`, `WINS +${a.xp.wins}`];
    const line2: string[] = [];
    if (a.xp.clear) line2.push(`CLEAR +${a.xp.clear}`);
    if (a.xp.endless) line2.push(`ENDLESS +${a.xp.endless}`);
    if (a.xp.mods) line2.push(`MODS +${a.xp.mods}`);
    if (a.gained < a.xp.total) {
      // Second payout of an endless run: say what was already paid instead of the full breakdown.
      txt(this, 430, 124, `${a.xp.total} TOTAL, ${a.xp.total - a.gained} PAID AT WIN`, { origin: [1, 0], color: C.dim });
    } else {
      txt(this, 430, 124, line1.join('  '), { origin: [1, 0], color: C.dim });
      if (line2.length) txt(this, 430, 134, line2.join('  '), { origin: [1, 0], color: C.dim });
    }
    // Only on endless runs: elsewhere the KEEP GOING note or daily rank uses that line.
    if (a.bestEndless && a.endlessRun) {
      txt(this, 430, 222, a.newBest ? `NEW ENDLESS BEST: ${a.bestEndless} WINS!` : `ENDLESS BEST: ${a.bestEndless} WINS`, {
        origin: [1, 0], color: a.newBest ? C.gold : '#c58cff',
      });
    }

    // Commander progress
    const c = a.cmd ? CMD_MAP[a.cmd] : null;
    if (c) {
      const before = cmdLevel(a.cmdBefore);
      const after = cmdLevel(a.cmdAfter);
      this.add.rectangle(66, 158, 36, 36, 0x05060f).setStrokeStyle(after >= CMD_MAX_LEVEL ? 2 : 1, after >= CMD_MAX_LEVEL ? C.highlight : C.border);
      this.add.image(66, 158, portraitKey(c.id)).setScale(2);
      txt(this, 92, 142, c.name.toUpperCase(), { color: c.color });
      txt(this, BAR_R, 142, `CMDR LV ${after}`, { origin: [1, 0], color: C.gold });
      const next = after < CMD_MAX_LEVEL ? CMD_LEVEL_XP[after] : null;
      const base = CMD_LEVEL_XP[after - 1];
      const [have, need] = stepProgress(a.cmdAfter, base, next);
      const had = after > before ? 0 : a.cmdBefore - base; // levelled up: all of this level is new
      this.gainBar(92, 156, BAR_R - 92, had / need, have / need, Phaser.Display.Color.HexStringToColor(c.color).color);
      txt(this, NUM_R, 155, next ? `${have}/${need}` : 'MAX', { origin: [1, 0], color: C.dim });
      if (after > before) {
        // Say what unlocked and where to switch it on.
        const got = UNLOCKS.filter((u) => u.level > before && u.level <= after);
        const long = `CMDR ${got.map((u) => `LV${u.level}: ${u.text.toUpperCase()}`).join(', ')} (COMMANDER SCREEN)`;
        const t = txt(this, 92, 166, long, { color: C.hp, wrap: NUM_R - 92 });
        // Three or more unlocks at once would run into the pilot rank: summarise instead.
        if (t.height > 24) t.setText(`CMDR LV${after}! ${got.length} UNLOCKS (COMMANDER SCREEN)`);
      }
    } else {
      txt(this, 50, 150, 'NO COMMANDER THIS RUN (STARTED BEFORE COMMANDERS EXISTED).', { color: C.dim, wrap: 380 });
    }

    // Pilot rank: progress within the current rank, so the numbers stay short.
    const rBefore = pilotRank(a.pilotBefore);
    const rAfter = pilotRank(a.pilotAfter);
    const lo = rankXp(rAfter);
    const [have, need] = stepProgress(a.pilotAfter, lo, rankXp(rAfter + 1));
    const had = rAfter > rBefore ? 0 : a.pilotBefore - lo;
    const label = txt(this, 50, 192, `PILOT RANK ${rAfter}`, { color: C.cyan });
    const bx = Math.max(170, label.x + label.width + 8);
    this.gainBar(bx, 193, BAR_R - bx, had / need, have / need, 0x7fe7ff);
    txt(this, NUM_R, 192, `${have}/${need}`, { origin: [1, 0], color: C.dim });
    if (rAfter > rBefore) {
      const names = a.newCommanders.map((id) => CMD_MAP[id].name.toUpperCase());
      const unlock = names.length === 1 ? `: NEW COMMANDER ${names[0]}` : names.length > 1 ? `: ${names.length} NEW COMMANDERS` : '';
      txt(this, 50, 206, `RANK UP! ${rBefore} > ${rAfter}${unlock}`, { color: C.gold });
    }
    // New modifier badges for this commander (the collection is on the commander screen).
    if (a.newBadges.length && c) {
      const names = modNames(a.newBadges);
      const long = `BADGE${names.length > 1 ? 'S' : ''}: ${names.join(', ')} (${c.name.toUpperCase()})`;
      const t = txt(this, 50, 215, long, { color: '#ff8ad8', wrap: 380 });
      if (t.height > 12) t.setText(`${names.length} NEW BADGES FOR ${c.name.toUpperCase()}!`);
    }
  }

  /** A progress bar where this run's gain shows as a lighter stretch after what you had. */
  private gainBar(x: number, y: number, w: number, had: number, now: number, color: number) {
    const [bg, fill] = bar(this, x, y, w, 6, now, color) as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle];
    bg.setDepth(1);
    fill.setAlpha(0.45).setDepth(1);
    const f = Math.max(0, Math.min(1, had, now));
    if (f > 0) this.add.rectangle(x + 1, y + 1, Math.round((w - 2) * f), 4, color).setOrigin(0).setDepth(1);
  }
}
