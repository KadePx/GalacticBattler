import Phaser from 'phaser';
import { addShip, addStarfield, setPlayerSkin } from '../game/art';
import { relicFit, type RelicFit } from '../game/relicFit';
import { START_LIVES, chooseRelic, winsLabel, type Run } from '../game/run';
import { getRun, saveRun } from '../game/storage';
import { C, TIER_COLORS, tierTag, button, historyPips, panel, relicChip, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { RELIC_MAP, count } from '../sim/relics';
import { REWARD_MAP, isReward } from '../game/rewards';
import { SHIPS, levelOf } from '../sim/ships';
import { TRAITS, traitCounts, traitLevel } from '../sim/traits';
import { sceneFor } from './MenuScene';

const CARD = { w: 140, h: 122, y: 59 };
const CARD_X = (i: number) => 86 + i * 154; // centres
const FLEET_Y = 222;
const SHIP_X = (i: number) => 296 - i * 46; // front (slot 0) on the right, like the shop

const FIT_COLOR: Record<RelicFit['kind'], string> = { combo: C.hp, all: C.cyan, econ: C.gold, none: C.bad };

export class RelicScene extends Phaser.Scene {
  private run!: Run;
  private picked: string | null = null;
  private focus: string | null = null; // hovered card (mouse)
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('relic');
  }

  create() {
    const run = getRun();
    if (!run || run.phase !== 'relic') {
      this.scene.start('menu');
      return;
    }
    this.run = run;
    this.picked = null;
    this.focus = null;
    setPlayerSkin(run.skin ? run.cmd : null);
    audio.setMood('shop');
    addStarfield(this);
    this.layer = this.add.container();
    this.refresh();
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private refresh() {
    this.tweens.killTweensOf(this.layer.list); // engine flames loop forever otherwise
    this.layer.removeAll(true);
    const run = this.run;

    // Top bar: same facts as the shop, so you know where the run stands.
    this.add2(panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52));
    for (let i = 0; i < START_LIVES; i++) this.add2(this.add.image(12 + i * 10, 10, i < run.lives ? 'heart' : 'heart_empty'));
    this.add2(txt(this, 70, 7, winsLabel(run), { color: run.endless ? '#c58cff' : C.gold }));
    this.add2(txt(this, 190, 7, `ROUND ${run.round}`));
    historyPips(this, 470, 10, run.history).forEach((o) => this.add2(o));

    const last = run.history[run.history.length - 1];
    const bossReward = !!run.gauntlet?.bossReward;
    const head = bossReward ? 'BOSS DEFEATED!' : last === 'W' ? 'VICTORY SALVAGE' : last === 'L' ? 'EMERGENCY REFIT' : 'FIELD UPGRADE';
    this.add2(txt(this, 240, 32, head, { size: 16, origin: 0.5, color: bossReward ? '#ff8a8a' : last === 'L' ? C.bad : C.gold }).setStroke('#05060f', 4));
    const anySpecial = run.relicOffer.some(isReward);
    this.add2(txt(this, 240, 45, bossReward ? 'Pick a BOSS RELIC. Only bosses drop these.' : anySpecial ? 'Pick a relic (lasts all run) or a one-time BONUS.' : 'Pick a relic. It lasts for the rest of the run.', { origin: 0.5, color: bossReward ? '#ffb0b0' : C.dim }));

    run.relicOffer.forEach((id, i) => this.card(id, CARD_X(i)));
    this.fleetStrip();

    const pickedName = this.picked ? (RELIC_MAP[this.picked] ?? REWARD_MAP[this.picked]).name.toUpperCase() : '';
    const b = button(this, 240, 257, 220, 18, this.picked ? `TAKE ${pickedName}` : anySpecial ? 'CHOOSE A REWARD' : 'CHOOSE A RELIC', () => this.confirm(), {
      fill: 0x3a2a10, color: C.gold, disabled: !this.picked,
    });
    b.objects.forEach((o) => this.add2(o));
  }

  private card(id: string, cx: number) {
    const r = RELIC_MAP[id] ?? REWARD_MAP[id];
    const special = isReward(id);
    const fit = relicFit(id, this.run);
    const owned = count(this.run.relics, id);
    const sel = this.picked === id;
    const { w, h, y } = CARD;
    const x = cx - w / 2;
    this.add2(panel(this, x, y, w, h, sel ? 0x1f2c66 : special ? 0x1a1430 : C.panel, sel ? C.highlight : special ? r.color : C.border));
    if (special) {
      this.add2(this.add.rectangle(x + 26, y + 10, 44, 11, 0x2a1a40).setStrokeStyle(1, r.color));
      this.add2(txt(this, x + 26, y + 11, 'BONUS', { origin: 0.5, color: '#e0c8ff' }));
    }
    if (fit.kind === 'combo') {
      this.add2(this.add.rectangle(x + 24, y + 22, 42, 11, 0x14402a).setStrokeStyle(1, 0x7dff8a));
      this.add2(txt(this, x + 24, y + 23, 'COMBO', { origin: 0.5, color: C.hp }));
    }
    if (owned) this.add2(txt(this, x + w - 5, y + 5, `OWN x${owned}`, { origin: [1, 0], color: C.dim }));
    const chip = relicChip(this, cx, y + 22, id, 22);
    chip.t.setFontSize(16);
    this.add2(chip.bg);
    this.add2(chip.t);
    // Long names wrap to two lines, so the description goes under whatever height the name took.
    const name = this.add2(txt(this, cx, y + 37, r.name.toUpperCase(), { origin: [0.5, 0], color: C.gold, wrap: w - 10, align: 'center' }));
    this.add2(txt(this, cx, name.y + name.height + 3, r.desc, { origin: [0.5, 0], wrap: w - 12, align: 'center' }));
    // Fit note pinned to the bottom of the card (at most two lines).
    this.add2(this.add.rectangle(cx, y + h - 27, w - 12, 1, 0x262e50));
    this.add2(txt(this, cx, y + h - 4, fit.note, { origin: [0.5, 1], color: FIT_COLOR[fit.kind], wrap: w - 10, align: 'center' }));
    if (sel) {
      this.add2(this.add.rectangle(cx, y + h / 2, w + 2, h + 2).setStrokeStyle(2, C.highlight));
      this.add2(this.add.rectangle(cx, y - 1, 70, 11, 0x3a2a10).setStrokeStyle(1, C.highlight));
      this.add2(txt(this, cx, y, 'SELECTED', { origin: 0.5, color: C.gold }));
    }

    const hit = this.add2(this.add.rectangle(cx, y + h / 2, w, h, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
    hit.on('pointerover', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch || this.focus === id) return; // touch uses tap-to-pick instead
      this.focus = id;
      this.refresh();
    });
    hit.on('pointerout', () => { if (this.focus === id) { this.focus = null; this.refresh(); } });
    hit.on('pointerup', () => {
      // First tap picks, a second tap on the same card takes it.
      if (this.picked === id) this.confirm();
      else { this.picked = id; audio.play('select'); this.refresh(); }
    });
  }

  /** Your current fleet, with the ships the focused relic would affect highlighted. */
  private fleetStrip() {
    const run = this.run;
    const shown = this.focus ?? this.picked;
    const fit = shown ? relicFit(shown, run) : null;
    const lit = new Set(fit?.slots ?? []);
    this.add2(panel(this, 4, 184, 472, 60, 0x0a0e22, 0x232c52));
    this.add2(txt(this, 10, 190, 'YOUR FLEET', { color: C.cyan }));
    this.add2(txt(this, 316, 190, 'FRONT>', { origin: [1, 0], color: C.faint }));

    // Owned relics and commander on the left.
    this.add2(txt(this, 10, 204, run.relics.length ? 'RELICS' : 'NONE YET', { color: C.faint }));
    run.relics.slice(0, 12).forEach((id, i) => {
      const c = relicChip(this, 15 + (i % 6) * 13, 223 + Math.floor(i / 6) * 13, id, 11);
      this.add2(c.bg);
      this.add2(c.t);
    });

    run.fleet.forEach((s, i) => {
      const x = SHIP_X(i);
      const on = lit.has(i);
      const tierCol = s ? TIER_COLORS[SHIPS[s.def].tier] : 0x262e50;
      this.add2(this.add.rectangle(x, FLEET_Y, 40, 36, on ? 0x1a3a2a : 0x0b1026).setStrokeStyle(on ? 2 : 1, on ? 0x7dff8a : tierCol));
      if (!s) return;
      const tier = SHIPS[s.def].tier;
      const { spr, flame } = addShip(this, x, FLEET_Y - 3, s.def, 0, 2, 1);
      const dim = fit && fit.slots.length > 0 && !on;
      spr.setAlpha(dim ? 0.35 : 1);
      flame.setAlpha(dim ? 0.35 : 1);
      this.add2(flame);
      this.add2(spr);
      this.add2(txt(this, x - 18, FLEET_Y - 16, tierTag(tier), { color: `#${TIER_COLORS[tier].toString(16).padStart(6, '0')}` }).setStroke('#05060f', 2));
      const lvl = levelOf(s.xp);
      if (lvl > 1) this.add2(txt(this, x + 18, FLEET_Y - 17, `${lvl}`, { origin: [1, 0], color: C.gold }));
      this.add2(txt(this, x - 3, FLEET_Y + 9, `${s.atk}`, { origin: [1, 0], color: C.atk }));
      this.add2(txt(this, x + 3, FLEET_Y + 9, `${s.hp}`, { color: C.hp }));
    });

    // Right side: commander passive and active synergies.
    const cmd = run.cmd ? CMD_MAP[run.cmd] : null;
    let ry = 190;
    if (cmd) {
      this.add2(txt(this, 470, ry, cmd.name.toUpperCase(), { origin: [1, 0], color: cmd.color }));
      ry += 12;
    }
    const counts = traitCounts(run.fleet, run.relics);
    const active = TRAITS.filter((t) => traitLevel(t.id, counts[t.id]) > 0);
    if (!active.length) this.add2(txt(this, 470, ry, 'no synergy', { origin: [1, 0], color: C.faint }));
    active.slice(0, 3).forEach((t, k) => {
      this.add2(txt(this, 470, ry + k * 11, `${t.short} ${counts[t.id]}`, { origin: [1, 0], color: t.color }));
    });
  }

  private confirm() {
    if (!this.picked) return;
    chooseRelic(this.run, this.picked);
    audio.play('relic');
    saveRun(this.run);
    this.scene.start(sceneFor(this.run.phase)); // the shop, or a Gauntlet route pick first
  }
}
