import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin, shipKey } from '../game/art';
import { CMD_LEVEL_XP, CMD_MAX_LEVEL, UNLOCKS, awardRun, cmdLevel, pilotRank, rankXp } from '../game/profile';
import { WIN_TARGET, endlessWins, goEndless } from '../game/run';
import { clearRun, getRun, saveRun } from '../game/storage';
import { C, bar, button, historyPips, panel, relicChip, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';

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
    const won = run.wins >= WIN_TARGET;
    const title = run.endless ? 'ENDLESS RUN OVER' : won ? 'FLEET TRIUMPHANT' : 'FLEET DESTROYED';
    txt(this, 240, 22, title, { size: 16, origin: 0.5, color: run.endless ? '#c58cff' : won ? C.gold : C.bad }).setStroke('#05060f', 4);
    const sub = run.endless
      ? `${run.wins} WINS (${WIN_TARGET} + ${endlessWins(run)} ENDLESS) IN ${run.history.length} BATTLES`
      : `${run.wins} WINS IN ${run.history.length} BATTLES`;
    txt(this, 240, 42, sub, { origin: 0.5 });
    const hist = run.history.slice(-24);
    historyPips(this, 240 + ((hist.length - 1) * 9) / 2, 56, hist, 24);

    // Front ship on the right, matching the shop and battle. Spacing follows sprite widths.
    const ships = run.fleet.filter(Boolean).map((s) => this.add.image(0, 82, shipKey(s!.def, 0)).setScale(2));
    const gap = 8;
    const total = ships.reduce((sum, im) => sum + im.displayWidth, 0) + gap * Math.max(0, ships.length - 1);
    let x = 240 + total / 2;
    for (const im of ships) {
      im.x = Math.round(x - im.displayWidth / 2);
      x -= im.displayWidth + gap;
    }
    const step = Math.min(16, 440 / Math.max(1, run.relics.length));
    run.relics.forEach((id, i) => {
      relicChip(this, 240 + (i - (run.relics.length - 1) / 2) * step, 106, id);
    });

    // Rewards (paid once; the run remembers it was paid so refreshing is safe).
    const award = awardRun(run);
    saveRun(run);
    if (award) {
      this.rewards(award);
      // Celebrate progress a moment after the screen appears.
      const ranked = pilotRank(award.pilotAfter) > pilotRank(award.pilotBefore);
      const leveled = !!award.cmd && cmdLevel(award.cmdAfter) > cmdLevel(award.cmdBefore);
      if (ranked || leveled) this.time.delayedCall(500, () => audio.play(ranked ? 'rankup' : 'levelup'));
    }

    // After a win, the same fleet can keep going in endless mode.
    const canGoOn = won && !run.endless;
    const bx = canGoOn ? [95, 240, 385] : [170, 310];
    if (canGoOn) {
      button(this, bx[0], 252, 130, 18, 'KEEP GOING', () => {
        goEndless(run);
        saveRun(run);
        audio.play('launch');
        this.scene.start('relic');
      }, { fill: 0x2a1a4a, color: '#c58cff' });
      txt(this, 240, 228, 'KEEP GOING = ENDLESS: +2 hull, more XP.', { origin: 0.5, color: '#c58cff' });
    }
    button(this, bx[canGoOn ? 1 : 0], 252, 130, 18, 'NEW RUN', () => {
      clearRun();
      this.scene.start('commanders');
    }, { fill: 0x3a2a10, color: C.gold });
    button(this, bx[canGoOn ? 2 : 1], 252, 130, 18, 'MENU', () => {
      clearRun();
      this.scene.start('menu');
    });
  }

  private rewards(a: NonNullable<ReturnType<typeof awardRun>>) {
    panel(this, 40, 118, 400, 120);
    txt(this, 50, 124, `+${a.gained} XP`, { color: C.gold, size: 8 });
    const line1 = [`BATTLES +${a.xp.battles}`, `WINS +${a.xp.wins}`];
    const line2: string[] = [];
    if (a.xp.clear) line2.push(`CLEAR +${a.xp.clear}`);
    if (a.xp.endless) line2.push(`ENDLESS +${a.xp.endless}`);
    if (a.gained < a.xp.total) {
      // Second payout of an endless run: say what was already paid instead of the full breakdown.
      txt(this, 430, 124, `${a.xp.total} TOTAL, ${a.xp.total - a.gained} PAID AT WIN`, { origin: [1, 0], color: C.dim });
    } else {
      txt(this, 430, 124, line1.join('  '), { origin: [1, 0], color: C.dim });
      if (line2.length) txt(this, 430, 134, line2.join('  '), { origin: [1, 0], color: C.dim });
    }
    if (a.bestEndless) {
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
      txt(this, 160, 142, `LV ${after}`, { color: C.gold });
      const next = after < CMD_MAX_LEVEL ? CMD_LEVEL_XP[after] : null;
      const base = CMD_LEVEL_XP[after - 1];
      bar(this, 92, 156, 200, 6, next ? (a.cmdAfter - base) / (next - base) : 1, Phaser.Display.Color.HexStringToColor(c.color).color)
        .forEach((o) => o.setDepth(1));
      txt(this, 300, 155, next ? `${a.cmdAfter}/${next}` : 'MAX', { color: C.dim });
      if (after > before) {
        const got = UNLOCKS.filter((u) => u.level > before && u.level <= after).map((u) => u.text);
        txt(this, 92, 166, `LEVEL UP! ${got.join(', ')}`, { color: C.hp, wrap: 340 });
      }
    } else {
      txt(this, 50, 150, 'No commander this run (started before commanders existed).', { color: C.dim, wrap: 380 });
    }

    // Pilot rank
    const rBefore = pilotRank(a.pilotBefore);
    const rAfter = pilotRank(a.pilotAfter);
    const lo = rankXp(rAfter);
    const hi = rankXp(rAfter + 1);
    txt(this, 50, 192, `PILOT RANK ${rAfter}`, { color: C.cyan });
    bar(this, 170, 193, 180, 6, (a.pilotAfter - lo) / (hi - lo), 0x7fe7ff);
    txt(this, 358, 192, `${a.pilotAfter}/${hi}`, { color: C.dim });
    if (rAfter > rBefore) {
      const names = a.newCommanders.map((id) => CMD_MAP[id].name.toUpperCase());
      txt(this, 50, 208, names.length ? `RANK UP! NEW COMMANDER: ${names.join(', ')}` : 'RANK UP!', { color: C.gold, wrap: 380 });
    }
  }
}
