import Phaser from 'phaser';
import { addStarfield, addShip, portraitKey, setPlayerSkin } from '../game/art';
import {
  CMD_LEVEL_XP, CMD_MAX_LEVEL, UNLOCKS, cmdLevel, getProfile, isUnlocked, pilotRank, progress, rankXp, saveProfile,
} from '../game/profile';
import { newRun } from '../game/run';
import { clearRun, saveRun } from '../game/storage';
import { C, bar, button, panel, txt } from '../game/ui';
import { COMMANDERS, CMD_MAP, type PassiveSlot } from '../sim/commanders';
import { SHIPS } from '../sim/ships';
import { audio } from '../game/audio';

const STYLE_LABEL: Record<string, string> = {
  balanced: 'ALL-ROUNDER', fortress: 'GUARD / DEFENSE', blitz: 'STRIKE / SPEED',
  swarm: 'FIGHTERS / SWARM', artillery: 'ARTILLERY', control: 'TECH / CONTROL',
  concord: 'SHIELDS / CONCORD', reaver: 'KILLS / REAVERS',
};

const hexInt = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;

export class CommanderScene extends Phaser.Scene {
  private sel = 'vance';
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('commanders');
  }

  create() {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
    const p = getProfile();
    this.sel = CMD_MAP[p.last] && isUnlocked(p, p.last) ? p.last : 'vance';
    this.layer = this.add.container();
    this.refresh();
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private refresh() {
    this.layer.removeAll(true);
    const p = getProfile();
    const rank = pilotRank(p.xp);

    // Top bar: pilot rank
    this.add2(panel(this, 0, 0, 480, 22, 0x0a0e22, 0x232c52));
    this.add2(txt(this, 8, 8, 'CHOOSE YOUR COMMANDER', { color: C.gold }));
    this.add2(txt(this, 300, 8, `PILOT RANK ${rank}`, { color: C.cyan }));
    const lo = rankXp(rank);
    const hi = rankXp(rank + 1);
    this.add2s(bar(this, 410, 8, 62, 6, (p.xp - lo) / (hi - lo), 0x7fe7ff));

    COMMANDERS.forEach((c, i) => this.card(c.id, 8 + (i % 2) * 86, 26 + Math.floor(i / 2) * 60));
    this.detail(this.sel);
  }

  private add2s(objs: Phaser.GameObjects.GameObject[]) {
    objs.forEach((o) => this.add2(o));
  }

  private card(id: string, x: number, y: number) {
    const c = CMD_MAP[id];
    const p = getProfile();
    const unlocked = isUnlocked(p, id);
    const lvl = cmdLevel(progress(p, id).xp);
    const isSel = this.sel === id;
    const w = 82;
    const h = 57;
    this.add2(panel(this, x, y, w, h, isSel ? 0x162050 : C.panel, isSel ? C.highlight : C.border));
    if (unlocked && lvl >= CMD_MAX_LEVEL) this.add2(this.add.rectangle(x + w / 2, y + 16, 28, 28).setStrokeStyle(1, C.highlight));
    this.add2(this.add.image(x + w / 2, y + 16, portraitKey(id, !unlocked)).setScale(1.5));
    this.add2(txt(this, x + w / 2, y + 31, c.name.toUpperCase(), { origin: [0.5, 0], color: unlocked ? c.color : C.dim }));
    this.add2(txt(this, x + w / 2, y + 43, unlocked ? `LV ${lvl}` : `RANK ${c.rank}`, {
      origin: [0.5, 0], color: unlocked ? C.gold : '#6a76a0',
    }));
    const hit = this.add2(this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
    hit.on('pointerup', () => {
      audio.play('select');
      this.sel = id;
      this.refresh();
    });
  }

  private detail(id: string) {
    const c = CMD_MAP[id];
    const p = getProfile();
    const prog = progress(p, id);
    const unlocked = isUnlocked(p, id);
    const lvl = cmdLevel(prog.xp);
    const X = 182;
    const W = 292;
    this.add2(panel(this, X, 28, W, 236));

    // Portrait, name, level
    const gold = unlocked && lvl >= CMD_MAX_LEVEL;
    this.add2(this.add.rectangle(X + 30, 60, 54, 54, 0x05060f).setStrokeStyle(gold ? 2 : 1, gold ? C.highlight : C.border));
    this.add2(this.add.image(X + 30, 60, portraitKey(id, !unlocked)).setScale(3));
    const name = gold ? `${c.title} ${c.name}` : c.name;
    this.add2(txt(this, X + 64, 36, name.toUpperCase(), { color: c.color }));
    this.add2(txt(this, X + 64, 50, STYLE_LABEL[c.style] ?? '', { color: C.dim }));
    if (unlocked) {
      const next = lvl < CMD_MAX_LEVEL ? CMD_LEVEL_XP[lvl] : null;
      const base = CMD_LEVEL_XP[lvl - 1];
      this.add2(txt(this, X + 64, 66, `LV ${lvl}`, { color: C.gold }));
      this.add2s(bar(this, X + 104, 67, 100, 6, next ? (prog.xp - base) / (next - base) : 1, hexInt(c.color)));
      this.add2(txt(this, X + 212, 66, next ? `${prog.xp}/${next} XP` : 'MAX', { color: C.dim }));
    } else {
      this.add2(txt(this, X + 64, 66, `UNLOCKS AT PILOT RANK ${c.rank}`, { color: C.bad }));
    }

    // Passives
    this.add2(txt(this, X + 8, 94, 'PASSIVE', { color: C.dim }));
    (['a', 'b'] as PassiveSlot[]).forEach((slot, k) => {
      const ps = c.passives[slot];
      const bx = X + 6 + k * 142;
      const by = 106;
      const available = unlocked && (slot === 'a' || lvl >= 3);
      const chosen = available && prog.p === slot;
      this.add2(panel(this, bx, by, 138, 54, chosen ? 0x162050 : 0x0b1026, chosen ? C.highlight : 0x262e50));
      this.add2(txt(this, bx + 5, by + 5, ps.name.toUpperCase(), { color: available ? c.color : C.dim, wrap: 128 }));
      this.add2(txt(this, bx + 5, by + 18, ps.desc, { color: available ? C.text : '#6a76a0', wrap: 130 }));
      if (slot === 'b' && lvl < 3) this.add2(txt(this, bx + 133, by + 5, 'LV3', { origin: [1, 0], color: C.bad }));
      if (available) {
        const hit = this.add2(this.add.rectangle(bx + 69, by + 27, 138, 54, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
        hit.on('pointerup', () => {
          prog.p = slot;
          saveProfile(p);
          this.refresh();
        });
      }
    });

    // Shop power
    this.add2(txt(this, X + 8, 168, 'SHOP POWER', { color: C.dim }));
    this.add2(txt(this, X + 98, 168, `${c.power.name} (${c.power.cost} SCRAP)`, { color: C.gold }));
    this.add2(txt(this, X + 8, 180, c.power.desc, { wrap: W - 16 }));

    // Level options
    const starter = SHIPS[c.starter];
    this.toggle(X + 8, 198, 'COMMANDER COLOURS', 2, lvl, unlocked && prog.skin, () => { prog.skin = !prog.skin; });
    this.toggle(X + 8, 212, `START WITH A ${starter.name.toUpperCase()}`, 4, lvl, unlocked && prog.starter, () => { prog.starter = !prog.starter; });
    if (unlocked && lvl >= 2) {
      setPlayerSkin(prog.skin ? id : null);
      const { spr, flame } = addShip(this, X + 262, 205, c.starter, 0, 2);
      this.add2(flame);
      this.add2(spr);
      setPlayerSkin(null);
    }

    const nextUnlock = UNLOCKS.find((u) => u.level > lvl);
    if (unlocked && nextUnlock) {
      this.add2(txt(this, X + 8, 228, `NEXT, LV${nextUnlock.level}: ${nextUnlock.text}`, { color: '#6a76a0' }));
    }

    // Buttons
    this.add2s(button(this, X + 46, 250, 76, 18, 'BACK', () => this.scene.start('menu')).objects);
    this.add2s(button(this, X + W - 62, 250, 112, 18, unlocked ? 'LAUNCH' : 'LOCKED', () => this.launch(id), {
      fill: 0x3a2a10, color: C.gold, disabled: !unlocked,
    }).objects);
  }

  /** A checkbox row that only works once the commander reaches `need`. */
  private toggle(x: number, y: number, label: string, need: number, lvl: number, on: boolean, flip: () => void) {
    const ok = lvl >= need && isUnlocked(getProfile(), this.sel);
    const box = this.add2(this.add.rectangle(x + 4, y + 3, 8, 8, on && ok ? 0xffd166 : 0x0b1026).setStrokeStyle(1, ok ? 0x6a7cc0 : 0x262e50));
    this.add2(txt(this, x + 14, y, label, { color: ok ? C.text : '#6a76a0' }));
    if (!ok) {
      this.add2(txt(this, x + 14 + label.length * 8 + 8, y, `LV${need}`, { color: C.bad }));
      return;
    }
    const hit = this.add2(this.add.rectangle(x + 100, y + 3, 210, 12, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
    hit.on('pointerup', () => {
      flip();
      saveProfile(getProfile());
      this.refresh();
    });
    void box;
  }

  private launch(id: string) {
    const p = getProfile();
    if (!isUnlocked(p, id)) return;
    const prog = progress(p, id);
    const lvl = cmdLevel(prog.xp);
    p.last = id;
    saveProfile(p);
    clearRun();
    saveRun(newRun({
      cmd: id,
      passive: lvl >= 3 ? prog.p : 'a',
      starter: lvl >= 4 && prog.starter,
      skin: lvl >= 2 && prog.skin,
    }));
    audio.play('launch');
    this.scene.start('shop');
  }
}
