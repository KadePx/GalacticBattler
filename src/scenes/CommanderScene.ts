import Phaser from 'phaser';
import { addStarfield, addShip, portraitKey, setPlayerSkin } from '../game/art';
import {
  CMD_LEVEL_XP, CMD_MAX_LEVEL, UNLOCKS, cmdLevel, getProfile, isUnlocked, pilotRank, progress, rankXp, saveProfile,
} from '../game/profile';
import { newRun } from '../game/run';
import { clearRun, saveRun, useSlot } from '../game/storage';
import { C, bar, button, panel, tapZone, txt } from '../game/ui';
import { COMMANDERS, CMD_MAP, type PassiveSlot } from '../sim/commanders';
import { SHIPS } from '../sim/ships';
import { audio } from '../game/audio';

/** Play style per commander (their bot archetype), shown under the name. */
export const STYLE_LABEL: Record<string, string> = {
  balanced: 'ALL-ROUNDER', engineer: 'REFITS / BENCH', fortress: 'GUARD / DEFENSE', blitz: 'STRIKE / SPEED',
  swarm: 'FIGHTERS / SWARM', artillery: 'ARTILLERY', control: 'TECH / CONTROL',
  concord: 'SHIELDS / CONCORD', reaver: 'KILLS / REAVERS', void: 'LIFE-STEAL / VOID',
  formation: 'FORMATION / VETERANS',
};

const hexInt = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;

export class CommanderScene extends Phaser.Scene {
  private sel = 'vance';
  private gauntlet = false;
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('commanders');
  }

  create(data?: { gauntlet?: boolean }) {
    this.gauntlet = !!data?.gauntlet;
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
    this.add2(txt(this, 8, 8, this.gauntlet ? 'BOSS GAUNTLET: CHOOSE COMMANDER' : 'CHOOSE YOUR COMMANDER', { color: this.gauntlet ? '#ff8a8a' : C.gold }));
    this.add2(txt(this, 404, 8, `PILOT RANK ${rank}`, { origin: [1, 0], color: C.cyan }));
    const lo = rankXp(rank);
    const hi = rankXp(rank + 1);
    this.add2s(bar(this, 410, 8, 62, 6, (p.xp - lo) / (hi - lo), 0x7fe7ff));

    // Two columns; rows shrink to fit as commanders are added (5 rows = 48px, 6 rows = 40px).
    const rows = Math.ceil(COMMANDERS.length / 2);
    const pitch = Math.min(48, Math.floor(240 / rows));
    COMMANDERS.forEach((c, i) => this.card(c.id, 8 + (i % 2) * 86, 26 + Math.floor(i / 2) * pitch, pitch - 2));
    this.detail(this.sel);
  }

  private add2s(objs: Phaser.GameObjects.GameObject[]) {
    objs.forEach((o) => this.add2(o));
  }

  private card(id: string, x: number, y: number, h = 46) {
    const c = CMD_MAP[id];
    const p = getProfile();
    const unlocked = isUnlocked(p, id);
    const lvl = cmdLevel(progress(p, id).xp);
    const isSel = this.sel === id;
    const w = 84;
    const mid = Math.round(h / 2);
    this.add2(panel(this, x, y, w, h, isSel ? 0x162050 : C.panel, isSel ? C.highlight : C.border));
    if (unlocked && lvl >= CMD_MAX_LEVEL) this.add2(this.add.rectangle(x + 13, y + mid, 23, 23).setStrokeStyle(1, C.highlight));
    this.add2(this.add.image(x + 13, y + mid, portraitKey(id, !unlocked)).setScale(1.25));
    this.add2(txt(this, x + 25, y + mid - 12, c.name.toUpperCase(), { color: unlocked ? c.color : C.faint }));
    // Locked: the name is faint, only the requirement is red (same as the archive).
    this.add2(txt(this, x + 25, y + mid + 2, unlocked ? `LV ${lvl}` : `RANK ${c.rank}`, {
      color: unlocked ? C.gold : C.bad,
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
      // "CMDR LV 5" | bar | "450/700 XP" right-aligned inside the panel.
      this.add2(txt(this, X + 64, 66, `CMDR LV ${lvl}`, { color: C.gold }));
      this.add2s(bar(this, X + 140, 67, 58, 6, next ? (prog.xp - base) / (next - base) : 1, hexInt(c.color)));
      this.add2(txt(this, X + W - 8, 66, next ? `${prog.xp}/${next} XP` : 'MAX', { origin: [1, 0], color: C.dim }));
      if (next) this.add2(txt(this, X + 64, 78, 'PLAY RUNS TO LEVEL UP', { color: C.faint }));
    } else {
      this.add2(txt(this, X + 64, 66, `UNLOCKS AT PILOT RANK ${c.rank}`, { color: C.bad }));
    }

    // Passives
    this.add2(txt(this, X + 8, 92, 'PASSIVE', { color: C.dim }));
    if (unlocked && lvl >= 3) this.add2(txt(this, X + 72, 92, '(TAP TO SWITCH)', { color: C.faint }));
    (['a', 'b'] as PassiveSlot[]).forEach((slot, k) => {
      const ps = c.passives[slot];
      const bx = X + 6 + k * 142;
      const by = 106;
      const available = unlocked && (slot === 'a' || lvl >= 3);
      const chosen = available && prog.p === slot;
      this.add2(panel(this, bx, by, 138, 54, chosen ? 0x162050 : 0x0b1026, chosen ? C.highlight : 0x262e50));
      this.add2(txt(this, bx + 5, by + 5, ps.name.toUpperCase(), { color: available ? c.color : C.dim, wrap: 128 }));
      this.add2(txt(this, bx + 5, by + 18, ps.desc, { color: available ? C.text : '#6a76a0', wrap: 130 }));
      if (slot === 'b' && lvl < 3) this.add2(txt(this, bx + 136, by - 14, unlocked ? 'UNLOCKS AT CMDR LV3' : 'CMDR LV3', { origin: [1, 0], color: C.bad }));
      // A tag on the chosen panel's bottom border (the top one has the passive's name).
      if (chosen) {
        this.add2(this.add.rectangle(bx + 108, by + 52, 52, 10, 0x3a2a10).setStrokeStyle(1, C.highlight));
        this.add2(txt(this, bx + 108, by + 53, 'IN USE', { origin: 0.5, color: C.gold }));
      }
      if (available) {
        const hit = this.add2(this.add.rectangle(bx + 69, by + 27, 138, 54, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
        hit.on('pointerup', () => {
          if (prog.p !== slot) audio.play('select');
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
    this.toggle(X + 8, 196, 'COMMANDER COLOURS', 2, lvl, unlocked && prog.skin, () => { prog.skin = !prog.skin; });
    this.toggle(X + 8, 214, `START WITH ${/^[AEIOU]/i.test(starter.name) ? 'AN' : 'A'} ${starter.name.toUpperCase()}`, 4, lvl, unlocked && prog.starter, () => { prog.starter = !prog.starter; });
    if (unlocked && lvl >= 2) {
      setPlayerSkin(prog.skin ? id : null);
      const { spr, flame } = addShip(this, X + 262, 205, c.starter, 0, 2);
      this.add2(flame);
      this.add2(spr);
      setPlayerSkin(null);
    }

    const nextUnlock = UNLOCKS.find((u) => u.level > lvl);
    if (this.gauntlet) {
      this.add2(txt(this, X + 8, 230, 'BEAT 3 BOSSES. BOSSES DROP RELICS.', { color: '#ff8a8a' }));
    } else if (unlocked && nextUnlock) {
      this.add2(txt(this, X + 8, 230, `NEXT: ${nextUnlock.text.toUpperCase()} AT LV${nextUnlock.level}`, { color: C.faint }));
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
    // A finger-sized row (18 tall, rows 18 apart) rather than just the 8px box.
    const hit = this.add2(tapZone(this, x + 120, y + 3, 250, 18));
    hit.on('pointerup', () => {
      audio.play('select');
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
    useSlot('main');
    clearRun();
    saveRun(newRun({
      cmd: id,
      passive: lvl >= 3 ? prog.p : 'a',
      starter: lvl >= 4 && prog.starter,
      skin: lvl >= 2 && prog.skin,
      gauntlet: this.gauntlet,
    }));
    audio.play('launch');
    this.scene.start('shop');
  }
}
