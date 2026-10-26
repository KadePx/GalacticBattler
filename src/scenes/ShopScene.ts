import Phaser from 'phaser';
import { addShip, addStarfield, portraitKey, setPlayerSkin, syncFlame } from '../game/art';
import {
  EVENT_INFO, FLEET_SIZE, REROLL_COST, SALE_COST, SHIP_COST, START_LIVES, VETERAN_COST, TOTAL_SLOTS, isBench, slotGet, winsLabel,
  buy, canMerge, move, powerProblem, quickBuy, reroll, sell, sellValue, toggleFreeze, usePower, type Run,
} from '../game/run';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { openDetails, type Detail } from '../game/details';
import { getRun, saveRun } from '../game/storage';
import { C, TIER_COLORS, tierTag, button, historyPips, panel, popup, relicChip, toast, txt } from '../game/ui';
import { RELIC_MAP } from '../sim/relics';
import { SHIPS, levelOf, xpForNext, type ShipClass, type ShipDef } from '../sim/ships';
import { TRAITS, TRAIT_MAP, traitCounts, traitLevel } from '../sim/traits';
import type { FleetShip } from '../sim/types';
import { hullScale } from '../sim/battle';

type Src = { kind: 'shop' | 'fleet'; i: number };
type Tgt = { kind: 'slot'; i: number } | { kind: 'sell' };
type Info = { def: ShipDef; ship?: FleetShip } | { relic: string } | { trait: ShipClass } | { cmd: string } | { freeze: number } | null;
const hexInt = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;
/** One short tip at a time in the empty info strip, changing each round. */
const SHOP_TIPS = [
  'Drop a ship on its twin to merge',
  'Different ships of a class: SYNERGY',
  'FREEZE keeps a ship for next round',
  'Front of the line is on the right',
  'Bench ships sit out the battle',
  'Every ship has a class AND a faction',
];

// Layout. Fleet slot 0 is the front of the line, drawn on the right
// because your fleet faces right in battle.
// Slots 0-4 are the fleet (right), 5-7 the bench (left).
const BOX = 40;
const SLOT_X = (i: number) => (i < FLEET_SIZE ? 330 - i * 44 : 24 + (i - FLEET_SIZE) * 42);
const SLOT_Y = 76;
const SHOP_X = (i: number) => 48 + i * 56;
const SHOP_Y = 150;
const STRIP = { x: 4, y: 199, w: 350, h: 66 };
const SELL = { x: 418, y: 214, w: 100, h: 18 };
const SYN = { x: 362, y: 38, w: 112, h: 104 };
const POWER = { x: 362, y: 144, w: 112, h: 36 };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class ShopScene extends Phaser.Scene {
  private run!: Run;
  private layer!: Phaser.GameObjects.Container;
  private infoLayer!: Phaser.GameObjects.Container;
  private synLayer!: Phaser.GameObjects.Container;
  private synKey: string | null = null; // what the synergy panel currently shows
  private dropMarker!: Phaser.GameObjects.Rectangle;
  private sel: Src | null = null;
  private hover: Info = null;
  private pinned: Info = null; // info tapped on a touch screen (no hover there)
  private armed = false; // commander power waiting for a target / confirmation
  private touch = false; // last input was a finger
  private dragging = false;
  private flames: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('shop');
  }

  create() {
    const run = getRun();
    if (!run) {
      this.scene.start('menu');
      return;
    }
    this.run = run;
    this.sel = null;
    this.hover = null;
    this.pinned = null;
    this.armed = false;
    this.dragging = false;
    setPlayerSkin(run.skin ? run.cmd : null);
    audio.setMood('shop');
    addStarfield(this);
    this.layer = this.add.container();
    this.synLayer = this.add.container();
    this.infoLayer = this.add.container();
    this.synKey = null;
    // Shows where a dragged ship will land.
    this.dropMarker = this.add.rectangle(0, 0, BOX + 6, BOX + 6).setStrokeStyle(2, C.highlight).setVisible(false).setDepth(800);
    this.input.dragDistanceThreshold = 4;
    if (run.notice) {
      const note = run.notice;
      run.notice = undefined;
      saveRun(run);
      this.time.delayedCall(300, () => toast(this, note, C.gold));
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.touch = p.wasTouch;
      // Fingers wobble: need a longer move before a tap turns into a drag.
      this.input.dragDistanceThreshold = p.wasTouch ? 10 : 4;
    });
    // Tapping empty space cancels an armed power and clears pinned info.
    this.input.on('pointerup', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || this.dragging || (!this.armed && !this.pinned && !this.sel)) return;
      this.armed = false;
      this.pinned = null;
      this.sel = null;
      this.refresh();
    });

    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      this.dragging = true;
      this.armed = false;
      this.sel = obj.getData('src');
      this.layer.bringToTop(obj);
      obj.setScale(2.4);
      this.updateInfo();
    });
    // On touch the ship is drawn above the finger so you can see where it goes.
    const lift = () => (this.touch ? 20 : 0);
    this.input.on('drag', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image, x: number, y: number) => {
      obj.setPosition(x, y - lift());
      const flame = obj.getData('flame') as Phaser.GameObjects.Image | undefined;
      if (flame) syncFlame(obj, flame, 0);
      const t = this.hitTest(obj.x, obj.y);
      if (t?.kind === 'slot') this.dropMarker.setPosition(SLOT_X(t.i), SLOT_Y).setSize(BOX + 6, BOX + 6);
      else if (t?.kind === 'sell') this.dropMarker.setPosition(SELL.x, SELL.y).setSize(SELL.w + 6, SELL.h + 6);
      this.dropMarker.setVisible(!!t);
    });
    this.input.on('dragend', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      const src: Src = obj.getData('src');
      const tgt = this.hitTest(obj.x, obj.y);
      this.dropMarker.setVisible(false);
      // Defer so we never destroy the dragged object inside Phaser's input handler.
      this.time.delayedCall(0, () => {
        this.dragging = false;
        if (tgt) this.perform(src, tgt);
        else { this.sel = null; this.refresh(); }
      });
    });

    this.refresh();
  }

  // ---------- actions ----------

  private hitTest(x: number, y: number): Tgt | null {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (Math.abs(x - SLOT_X(i)) <= 22 && Math.abs(y - SLOT_Y) <= 28) return { kind: 'slot', i };
    }
    if (Math.abs(x - SELL.x) <= SELL.w / 2 && Math.abs(y - SELL.y) <= SELL.h / 2 + 2) return { kind: 'sell' };
    return null;
  }

  private perform(src: Src, tgt: Tgt) {
    const levelsBefore = this.levels();
    let err: string | null = null;
    if (src.kind === 'shop') {
      if (tgt.kind === 'slot') err = buy(this.run, src.i, tgt.i);
    } else if (tgt.kind === 'slot') {
      err = move(this.run, src.i, tgt.i);
    } else {
      err = sell(this.run, src.i);
    }
    if (err) toast(this, err);
    else this.feedback(levelsBefore, tgt.kind === 'sell' ? 'sell' : src.kind === 'shop' ? 'buy' : 'move');
    this.sel = null;
    this.hover = null;
    this.pinned = null; // the ship it described may have moved, merged or been sold
    saveRun(this.run);
    this.refresh();
  }

  /** Level of every ship, keyed by the ship object itself (moves and swaps keep the object). */
  private levels(): Map<FleetShip, number> {
    const m = new Map<FleetShip, number>();
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = slotGet(this.run, i);
      if (s) m.set(s, levelOf(s.xp));
    }
    return m;
  }

  /** Toast and sparkle for ships that levelled up. Returns true if any did. */
  private announceLevelUps(before: Map<FleetShip, number>) {
    let any = false;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = slotGet(this.run, i);
      if (!s || !before.has(s)) continue;
      const lvl = levelOf(s.xp);
      if (lvl > before.get(s)!) {
        toast(this, `LEVEL ${lvl}! ${SHIPS[s.def].perks[lvl - 2]}`, C.gold);
        this.sparkle(SLOT_X(i), SLOT_Y);
        any = true;
      }
    }
    return any;
  }

  /**
   * Feedback after a successful buy/move/sell: a level-up beats a merge, which
   * beats a plain buy. Merges are spotted by the ship count going down.
   */
  private feedback(before: Map<FleetShip, number>, kind: 'buy' | 'move' | 'sell') {
    const leveled = this.announceLevelUps(before);
    if (leveled) return audio.play('levelup');
    if (kind === 'sell') return audio.play('sell');
    const after = this.levels().size;
    // Buying into an empty slot adds a ship; buying onto a copy doesn't. A merge by moving removes one.
    const merged = kind === 'buy' ? after <= before.size : after < before.size;
    audio.play(merged ? 'merge' : kind === 'buy' ? 'buy' : 'click');
  }

  private sparkle(x: number, y: number) {
    for (let k = 0; k < 14; k++) {
      const p = this.add.image(x, y, 'px').setTint(0xffd166).setDepth(900);
      const a = (k / 14) * Math.PI * 2;
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * 30, y: y + Math.sin(a) * 30, alpha: 0, duration: 500,
        onComplete: () => p.destroy(),
      });
    }
  }

  private clickShip(src: Src) {
    if (this.dragging) return;
    this.pinned = null;
    if (this.armed && src.kind === 'fleet' && this.powerTargets()) {
      this.applyPower(src.i);
      return;
    }
    this.armed = false;
    const same = this.sel && this.sel.kind === src.kind && this.sel.i === src.i;
    if (same) {
      if (src.kind === 'shop') {
        const before = this.levels();
        const err = quickBuy(this.run, src.i);
        if (err) toast(this, err);
        else this.feedback(before, 'buy');
        saveRun(this.run);
      }
      this.sel = null;
    } else if (this.sel && src.kind === 'fleet') {
      this.perform(this.sel, { kind: 'slot', i: src.i });
      return;
    } else {
      this.sel = src;
      audio.play('select');
    }
    this.refresh();
  }

  private clickSlot(i: number) {
    if (this.dragging) return;
    this.pinned = null;
    if (this.armed && this.powerTargets()) {
      if (slotGet(this.run, i)) this.applyPower(i);
      return;
    }
    this.armed = false;
    if (!this.sel) {
      this.refresh();
      return;
    }
    this.perform(this.sel, { kind: 'slot', i });
  }

  private clickSell() {
    if (this.dragging) return;
    this.armed = false;
    if (this.sel?.kind === 'fleet') this.perform(this.sel, { kind: 'sell' });
    else toast(this, 'Pick a fleet ship to sell', C.dim);
  }

  private clickReroll() {
    if (this.dragging) return;
    this.armed = false;
    const err = reroll(this.run);
    if (err) toast(this, err);
    else audio.play('reroll');
    this.sel = null;
    saveRun(this.run);
    this.refresh();
  }

  /**
   * Power card tapped. First tap arms the power (and explains it); a targeted
   * power then waits for you to tap one of your ships, an untargeted one for a
   * second tap on the card. Tapping an armed targeted power cancels it.
   */
  private clickPower() {
    if (this.dragging) return;
    const cmd = this.run.cmd ? CMD_MAP[this.run.cmd] : null;
    if (!cmd) return;
    this.pinned = null;
    if (this.armed) {
      if (cmd.power.target) {
        this.armed = false;
        this.refresh();
      } else {
        this.applyPower(null);
      }
      return;
    }
    if (this.run.powerUsed) return void toast(this, 'Power already used this round', C.dim);
    if (this.run.scrap < cmd.power.cost) return void toast(this, `Needs ${cmd.power.cost} scrap`);
    // A ship is already selected: use it straight away.
    if (cmd.power.target && this.sel?.kind === 'fleet' && slotGet(this.run, this.sel.i)) {
      this.applyPower(this.sel.i);
      return;
    }
    this.armed = true;
    this.sel = null;
    audio.play('arm');
    this.refresh();
  }

  private powerTargets() {
    return !!this.run.cmd && CMD_MAP[this.run.cmd].power.target;
  }

  private applyPower(slot: number | null) {
    const cmd = CMD_MAP[this.run.cmd!];
    const before = this.levels();
    const err = usePower(this.run, slot);
    this.armed = false;
    if (err) {
      toast(this, err);
    } else {
      if (slot !== null) {
        this.sparkle(SLOT_X(slot), SLOT_Y);
        popup(this, SLOT_X(slot), SLOT_Y - 26, `${cmd.power.name}!`, cmd.color);
      } else {
        toast(this, `${cmd.power.name}!`, C.gold);
      }
      audio.play(this.announceLevelUps(before) ? 'levelup' : 'power');
    }
    this.sel = null;
    saveRun(this.run);
    this.refresh();
  }

  private clickFreeze(i: number) {
    if (this.dragging) return;
    this.armed = false;
    this.pinned = null;
    toggleFreeze(this.run, i);
    audio.play(this.run.frozen?.[i] ? 'freeze' : 'unfreeze');
    saveRun(this.run);
    this.refresh();
  }

  private clickBattle() {
    // A touch drag toward SELL can end with the finger over BATTLE!; never start a battle mid-drag.
    if (this.dragging) return;
    if (!this.run.fleet.some(Boolean)) {
      toast(this, 'Your fleet is empty!');
      return;
    }
    saveRun(this.run);
    this.scene.start('battle');
  }

  // ---------- drawing ----------

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private refresh() {
    // Phaser keeps looping tweens alive after their targets are destroyed, so kill them first.
    this.tweens.killTweensOf(this.flames);
    this.tweens.killTweensOf(this.layer.list);
    this.flames = [];
    this.layer.removeAll(true);
    this.synKey = null; // fleet may have changed: redraw synergy too
    this.hover = null; // the pointer may not be over the same thing after a redraw
    const run = this.run;

    // Top bar
    this.add2(panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52));
    for (let i = 0; i < START_LIVES; i++) {
      this.add2(this.add.image(12 + i * 10, 10, i < run.lives ? 'heart' : 'heart_empty'));
    }
    this.add2(txt(this, 70, 7, winsLabel(run), { color: run.endless ? '#c58cff' : C.gold }));
    this.add2(txt(this, 190, 7, `ROUND ${run.round}`));
    soundButton(this, 176, 10).forEach((o) => this.add2(o));
    this.add2(this.add.image(300, 10, 'coin'));
    this.add2(txt(this, 308, 7, `${run.scrap} SCRAP`, { color: C.gold }));
    historyPips(this, 470, 10, run.history).forEach((o) => this.add2(o));

    // Relics (tap or hover a chip to read it)
    this.add2(txt(this, 8, 25, 'RELICS', { color: C.dim }));
    if (!run.relics.length) this.add2(txt(this, 62, 25, 'none yet', { color: C.faint }));
    // Long (endless) runs collect many relics: show what fits, then a count.
    const maxChips = 16;
    run.relics.slice(0, maxChips).forEach((id, i) => {
      const chip = relicChip(this, 66 + i * 17, 28, id, 14);
      this.add2(chip.bg);
      this.add2(chip.t);
      this.infoTarget(chip.bg, { relic: id });
    });
    if (run.relics.length > maxChips) this.add2(txt(this, 66 + maxChips * 17 - 6, 25, `+${run.relics.length - maxChips}`, { color: C.dim }));

    // Bench (left) and fleet (right)
    this.add2(txt(this, 6, 38, 'BENCH', { color: C.dim }));
    this.add2(txt(this, 134, 38, 'YOUR FLEET', { color: C.cyan }));
    this.add2(txt(this, 352, 38, 'FRONT>', { origin: [1, 0], color: C.dim }));
    this.add2(this.add.rectangle(131, SLOT_Y, 1, BOX + 8, 0x232c52));
    const selDef = this.selectedDef();
    const cmdColor = run.cmd ? hexInt(CMD_MAP[run.cmd].color) : C.highlight;
    const targeting = this.armed && !!run.cmd && CMD_MAP[run.cmd].power.target;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const ship = slotGet(run, i);
      const x = SLOT_X(i);
      const bench = isBench(i);
      const isSel = this.sel?.kind === 'fleet' && this.sel.i === i;
      const mergeHint = !!selDef && !isSel && canMerge(ship, selDef);
      const powerHint = targeting && !!ship;
      // Owned ships keep their shipyard tier colour on the slot border, so tier is visible after buying.
      const tierCol = ship ? TIER_COLORS[SHIPS[ship.def].tier] : bench ? 0x262e50 : C.border;
      const border = powerHint ? cmdColor : isSel ? C.highlight : mergeHint ? 0x7dff8a : tierCol;
      const box = this.add2(this.add.rectangle(x, SLOT_Y, BOX, BOX, bench ? 0x080b1c : 0x0b1026)
        .setStrokeStyle(isSel || mergeHint || powerHint ? 2 : 1, border));
      if (powerHint) this.tweens.add({ targets: box, alpha: 0.55, duration: 380, yoyo: true, repeat: -1 });
      box.setInteractive();
      box.on('pointerup', () => this.clickSlot(i));
      if (!ship) continue;
      const def = SHIPS[ship.def];
      this.shipSprite(x, SLOT_Y, def, { kind: 'fleet', i }, ship);
      // Tier label top-left (same as the shipyard), level stars top-right.
      this.add2(txt(this, x - 19, SLOT_Y - 18, tierTag(def.tier), { color: hex(TIER_COLORS[def.tier]) }).setStroke('#05060f', 2));
      const lvl = levelOf(ship.xp);
      for (let s = 0; s < lvl; s++) this.add2(this.add.image(x + 15 - (lvl - 1 - s) * 7, SLOT_Y - 15, 'star'));
      this.classPips(x, SLOT_Y + 16, def);
      this.add2(txt(this, x - 4, SLOT_Y + 23, `${ship.atk}`, { origin: [1, 0], color: C.atk }));
      this.add2(txt(this, x + 4, SLOT_Y + 23, `${ship.hp}`, { color: C.hp }));
    }

    // Shipyard
    const sale = run.event === 'sale';
    const vetNote = run.vetSlot !== undefined && run.shop[run.vetSlot] ? `  (LV2: ${VETERAN_COST})` : '';
    this.add2(txt(this, 24, 114, `SHIPYARD  ${sale ? SALE_COST : SHIP_COST} SCRAP EACH${vetNote}`, { color: sale ? C.gold : C.cyan }));
    const owned: FleetShip[] = [];
    for (let k = 0; k < TOTAL_SLOTS; k++) {
      const f = slotGet(run, k);
      if (f) owned.push(f);
    }
    run.shop.forEach((defId, i) => {
      const x = SHOP_X(i);
      const def = defId ? SHIPS[defId] : null;
      const isSel = this.sel?.kind === 'shop' && this.sel.i === i;
      const frozen = !!run.frozen?.[i];
      // A copy of a ship you own: buying it merges (levels up) your ship, so call it out.
      const mergeable = !!def && owned.some((f) => canMerge(f, def.id));
      const maxed = !!def && !mergeable && owned.some((f) => f.def === def.id);
      const stroke = isSel ? C.highlight : frozen ? 0x7fe7ff : mergeable ? 0x7dff8a : def ? TIER_COLORS[def.tier] : 0x1d2444;
      const card = this.add2(this.add.rectangle(x, SHOP_Y, 48, 48, frozen ? 0x10263a : mergeable ? 0x0f2a1a : 0x0b1026)
        .setStrokeStyle(isSel || frozen || mergeable ? 2 : 1, stroke));
      if (mergeable && !isSel && !frozen) this.tweens.add({ targets: card, alpha: 0.7, duration: 600, yoyo: true, repeat: -1 });
      if (!def) {
        this.add2(txt(this, x, SHOP_Y, 'SOLD', { origin: 0.5, color: '#3a4570' }));
        return;
      }
      this.add2(txt(this, x - 21, SHOP_Y - 21, tierTag(def.tier), { color: hex(TIER_COLORS[def.tier]) }));
      this.shipSprite(x, SHOP_Y, def, { kind: 'shop', i }, run.vetSlot === i ? this.veteran(def) : undefined);
      this.classPips(x, SHOP_Y + 20, def);
      const vet = run.vetSlot === i;
      this.add2(txt(this, x - 6, SHOP_Y + 27, `${def.atk + (vet ? 3 : 0)}`, { origin: [1, 0], color: C.atk }));
      this.add2(txt(this, x + 6, SHOP_Y + 27, `${def.hp + (vet ? 3 : 0)}`, { color: C.hp }));
      if (vet) {
        // Level 2 ship for hire: gold tag and its price.
        this.add2(this.add.rectangle(x + 9, SHOP_Y - 19, 28, 9, 0x3a2a10).setStrokeStyle(1, C.highlight));
        this.add2(txt(this, x + 9, SHOP_Y - 18, 'LV2', { origin: 0.5, color: C.gold }));
        this.add2(txt(this, x - 21, SHOP_Y + 12, `$${VETERAN_COST}`, { color: C.gold }).setStroke('#05060f', 2));
      } else if (mergeable || maxed) {
        const tag = mergeable ? 'OWN' : 'MAX';
        this.add2(this.add.rectangle(x + 23 - (tag.length * 7 + 4) / 2, SHOP_Y - 19, tag.length * 7 + 4, 9, mergeable ? 0x1d5a32 : 0x1d2444)
          .setStrokeStyle(1, mergeable ? 0x7dff8a : 0x3a4a7a));
        this.add2(txt(this, x + 23 - (tag.length * 7 + 4) / 2, SHOP_Y - 18, tag, { origin: 0.5, color: mergeable ? '#b8ffc4' : C.dim }));
      }

      // Freeze toggle: a labelled button, with a taller invisible hit area for fingers.
      const fy = SHOP_Y + 41;
      const fb = this.add2(this.add.rectangle(x, fy, 50, 12, frozen ? 0x2a6a8a : 0x141a33)
        .setStrokeStyle(1, frozen ? 0x7fe7ff : 0x3a4a7a));
      this.add2(txt(this, x, fy + 1, frozen ? 'FROZEN' : 'FREEZE', { origin: 0.5, color: frozen ? '#ffffff' : C.cyan }));
      const fhit = this.add2(this.add.rectangle(x, fy, 52, 18, 0xffffff, 0.001).setInteractive({ useHandCursor: true }));
      fhit.on('pointerup', () => this.clickFreeze(i));
      fhit.on('pointerover', () => { fb.setStrokeStyle(1, C.highlight); this.setHover({ freeze: i }); });
      fhit.on('pointerout', () => { fb.setStrokeStyle(1, frozen ? 0x7fe7ff : 0x3a4a7a); this.setHover(null); });
    });

    // Buttons
    const b1 = button(this, 418, 190, 100, 18, run.market ? `FREE ROLL x${run.market}` : run.freeRolls ? `FREE ROLL x${run.freeRolls}` : `REROLL ${REROLL_COST}`, () => this.clickReroll(),
      { disabled: !run.market && !run.freeRolls && run.scrap < REROLL_COST, fill: run.market ? 0x2a1a40 : undefined, color: run.market ? "#e0c8ff" : undefined });
    const selShip = this.sel?.kind === 'fleet' ? slotGet(run, this.sel.i) : null;
    const sellLabel = selShip ? `SELL +${sellValue(run, selShip)}` : 'SELL';
    const b2 = button(this, SELL.x, SELL.y, SELL.w, SELL.h, sellLabel, () => this.clickSell(), { fill: 0x3a1420 });
    const b3 = button(this, 418, 244, 100, 24, 'BATTLE!', () => this.clickBattle(), { fill: 0x3a2a10, color: C.gold });
    [...b1.objects, ...b2.objects, ...b3.objects].forEach((o) => this.add2(o));

    this.drawPowerCard();
    this.updateInfo();
  }

  /** Commander card under the synergy panel: portrait, power name, cost and state. Tap to use. */
  private drawPowerCard() {
    const run = this.run;
    const cmd = run.cmd ? CMD_MAP[run.cmd] : null;
    if (!cmd) return;
    const { x, y, w, h } = POWER;
    const used = !!run.powerUsed;
    const broke = run.scrap < cmd.power.cost;
    const blocked = powerProblem(run);
    const ready = !used && !broke && !blocked;
    const col = hexInt(cmd.color);
    const card = this.add2(this.add.rectangle(x + w / 2, y + h / 2, w, h, this.armed ? 0x1d2a50 : 0x0e1430)
      .setStrokeStyle(this.armed ? 2 : 1, ready ? col : 0x2a3150));
    this.add2(this.add.image(x + 12, y + h / 2, portraitKey(cmd.id)).setAlpha(ready ? 1 : 0.5));
    // Three short lines: power name, cost, state.
    this.add2(txt(this, x + 24, y + 3, cmd.power.name, { color: ready ? cmd.color : C.dim }));
    this.add2(txt(this, x + 24, y + 14, `${cmd.power.cost} SCRAP`, { color: broke && !used ? C.bad : C.gold }));
    const state = used ? 'USED' : this.armed ? (cmd.power.target ? 'PICK SHIP' : 'TAP AGAIN') : broke ? 'NOT ENOUGH' : blocked ?? 'READY';
    this.add2(txt(this, x + 24, y + 25, state, { color: used || broke || blocked ? C.dim : this.armed ? C.gold : C.hp }));
    // A slow glow while the power is ready, so it's easy to spot.
    if (ready && !this.armed) this.tweens.add({ targets: card, alpha: 0.7, duration: 900, yoyo: true, repeat: -1 });
    card.setInteractive({ useHandCursor: true });
    card.on('pointerup', () => this.clickPower());
    card.on('pointerover', () => this.setHover({ cmd: cmd.id }));
    card.on('pointerout', () => this.setHover(null));
  }

  /** Something you can hover (mouse) or tap (touch) to read in the bottom strip. */
  private infoTarget(obj: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image, info: NonNullable<Info>) {
    obj.setInteractive({ useHandCursor: true });
    obj.on('pointerover', () => this.setHover(info));
    obj.on('pointerout', () => this.setHover(null));
    obj.on('pointerup', () => {
      if (this.dragging) return;
      this.pinned = info;
      this.updateInfo();
    });
  }

  /** Small colored dashes under a ship showing its classes. */
  private classPips(x: number, y: number, def: ShipDef) {
    def.classes.forEach((c, k) => {
      const px = x + (k - (def.classes.length - 1) / 2) * 10;
      const col = Phaser.Display.Color.HexStringToColor(TRAIT_MAP[c].color).color;
      // Factions get a small diamond; classes a dash.
      if (TRAIT_MAP[c].faction) this.add2(this.add.rectangle(px, y, 4, 4, col).setAngle(45));
      else this.add2(this.add.rectangle(px, y, 8, 2, col));
    });
  }

  private shipSprite(x: number, y: number, def: ShipDef, src: Src, ship?: FleetShip) {
    const { spr, flame } = addShip(this, x, y, def.id, 0, 2, 1);
    this.add2(flame);
    const img = this.add2(spr);
    this.flames.push(flame);
    img.setData('flame', flame);
    const fw = img.frame.width;
    const fh = img.frame.height;
    img.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(fw / 2 - 12, fh / 2 - 10, 24, 20),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      draggable: true,
      useHandCursor: true,
    });
    img.setData('src', src);
    img.on('pointerup', () => this.clickShip(src));
    img.on('pointerover', () => this.setHover({ def, ship }));
    img.on('pointerout', () => this.setHover(null));
    return img;
  }

  private selectedDef(): string | null {
    if (!this.sel) return null;
    return this.sel.kind === 'shop' ? this.run.shop[this.sel.i] : slotGet(this.run, this.sel.i)?.def ?? null;
  }

  private setHover(info: Info) {
    if (this.dragging) return;
    // The last thing hovered stays in the strip (so its MORE button can be reached),
    // until something else is hovered, tapped, or the shop changes.
    if (!info && this.hover && !('freeze' in this.hover)) this.pinned = this.hover;
    this.hover = info;
    this.updateInfo();
  }

  /** What a Veteran-for-hire ship will be once bought: level 2, +3/+3. */
  private veteran(def: ShipDef): FleetShip {
    return { def: def.id, atk: def.atk + 3, hp: def.hp + 3, xp: 2 };
  }

  private currentInfo(): Info {
    if (this.hover) return this.hover;
    if (this.armed && this.run.cmd) return { cmd: this.run.cmd };
    if (this.pinned) return this.pinned;
    if (!this.sel) return null;
    const defId = this.selectedDef();
    if (!defId) return null;
    const ship = this.sel.kind === 'fleet' ? slotGet(this.run, this.sel.i) ?? undefined
      : this.run.vetSlot === this.sel.i ? this.veteran(SHIPS[defId]) : undefined;
    return { def: SHIPS[defId], ship };
  }

  private updateInfo() {
    this.infoLayer.removeAll(true);
    const info = this.currentInfo();
    // Preview synergy gains for shop ships and benched ships (not ones already fighting).
    const fighting = info && 'def' in info && info.ship && this.run.fleet.includes(info.ship);
    const preview = info && 'def' in info && !fighting ? info.def : null;
    // Only rebuild the synergy panel when its content changes. Rebuilding it while the
    // pointer is over a row would destroy that row, and its pointerout would never fire.
    const key = preview?.id ?? '';
    if (key !== this.synKey) {
      this.synKey = key;
      this.synLayer.removeAll(true);
      this.drawSynergy(preview);
    }
    this.drawStrip(info);
    this.drawMoreButton(info);
  }

  /** "MORE" opens a full card with every detail and definitions of the terms used. */
  private drawMoreButton(info: Info) {
    const d = this.toDetail(info);
    if (!d) return;
    const b = button(this, 332, 192, 40, 12, 'MORE', () => {
      if (this.dragging) return;
      openDetails(this, d);
    }, { fill: 0x1d2a50, color: C.cyan });
    b.objects.forEach((o) => this.infoLayer.add(o));
  }

  private toDetail(info: Info): Detail | null {
    if (!info || 'freeze' in info) return null;
    if ('def' in info) return { def: info.def, ship: info.ship };
    if ('relic' in info) return { relic: info.relic };
    if ('trait' in info) return { trait: info.trait, count: traitCounts(this.run.fleet, this.run.relics)[info.trait] };
    if (this.armed) return null;
    return { cmd: info.cmd, passive: this.run.passive ?? 'a' };
  }

  /** Right-hand panel: class counts and thresholds; previews what a shop ship would add. */
  private drawSynergy(preview: ShipDef | null) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.synLayer.add(o); return o; };
    add(panel(this, SYN.x, SYN.y, SYN.w, SYN.h));
    add(txt(this, SYN.x + 6, SYN.y + 4, 'SYNERGY', { color: C.dim }));
    const counts = traitCounts(this.run.fleet, this.run.relics);
    const adds = preview && !this.run.fleet.some((s) => s?.def === preview.id) ? preview.classes : [];

    // One line per synergy: name, then "have/next" (gold when maxed). Factions sit under a divider.
    TRAITS.forEach((tr, i) => {
      const y = SYN.y + 14 + i * 12 + (tr.faction ? 3 : 0);
      const n = counts[tr.id];
      const lvl = traitLevel(tr.id, n);
      const next = tr.tiers.find((t) => n < t.n)?.n;
      const row = add(this.add.rectangle(SYN.x + SYN.w / 2, y + 4, SYN.w - 4, 12, 0xffffff, 0.001));
      this.infoTarget(row, { trait: tr.id });
      if (lvl > 0) add(this.add.rectangle(SYN.x + 3, y + 4, 2, 10, hexInt(tr.color)));
      const name = add(txt(this, SYN.x + 7, y, tr.short, { color: lvl > 0 ? tr.color : C.dim }));
      if (adds.includes(tr.id)) add(txt(this, name.x + name.width + 3, y, '+1', { color: C.hp }));
      add(txt(this, SYN.x + SYN.w - 4, y, next ? `${n}/${next}` : `${n} MAX`, {
        origin: [1, 0], color: !next ? C.gold : lvl > 0 ? C.text : C.faint,
      }));
    });
    const fy = SYN.y + 14 + TRAITS.filter((t) => !t.faction).length * 12 + 1;
    add(this.add.rectangle(SYN.x + SYN.w / 2, fy, SYN.w - 10, 1, 0x262e50));
  }

  private drawStrip(info: Info) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.infoLayer.add(o); return o; };
    const { x, y, w, h } = STRIP;
    add(panel(this, x, y, w, h));
    const L = x + 6;
    const R = x + w - 6;
    const row = (i: number) => y + 6 + i * 12;

    if (!info) {
      // Kept short and quiet on purpose: one prompt plus one rotating tip.
      const cy = y + h / 2;
      const ev = this.run.event ? EVENT_INFO[this.run.event] : null;
      if (ev) {
        // This round's shipyard event takes the prompt's place.
        add(txt(this, x + w / 2, cy - 7, `${ev.name}: ${ev.desc}`, { origin: 0.5, color: C.gold }));
      } else add(txt(this, x + w / 2, cy - 7, `${this.touch ? 'Tap' : 'Hover'} anything for details`, { origin: 0.5, color: C.faint }));
      const hull = hullScale(this.run.round);
      const tip = hull > 1 ? `Hulls x${hull.toFixed(1)} HP this round` : SHOP_TIPS[(this.run.round - 1) % SHOP_TIPS.length];
      add(txt(this, x + w / 2, cy + 7, tip, { origin: 0.5, color: hull > 1 ? C.hp : '#4f5a80' }));
      return;
    }
    if ('freeze' in info) {
      const frozen = !!this.run.frozen?.[info.freeze];
      add(txt(this, L, row(0), frozen ? 'FROZEN' : 'FREEZE', { color: C.cyan }));
      add(txt(this, L, row(1), 'A frozen ship stays in the shipyard when'));
      add(txt(this, L, row(2), 'you reroll and into the next round, so'));
      add(txt(this, L, row(3), 'you can buy it later. Freezing is free.'));
      add(txt(this, L, row(4), frozen ? 'Tap again to unfreeze.' : 'Tap to freeze.', { color: C.dim }));
      return;
    }
    if ('cmd' in info) {
      const c = CMD_MAP[info.cmd];
      const ps = c.passives[this.run.passive ?? 'a'];
      if (this.armed) {
        add(txt(this, L, row(0), `${c.power.name}: ${c.power.desc}`, { color: c.color, wrap: w - 12 }));
        add(txt(this, L, row(2), c.power.target
          ? `${this.touch ? 'Tap' : 'Click'} one of your ships to use it.`
          : `${this.touch ? 'Tap' : 'Click'} the power card again to use it.`, { color: C.gold }));
        add(txt(this, L, row(3), `Costs ${c.power.cost} scrap. Once per round.`, { color: C.dim }));
        add(txt(this, L, row(4), c.power.target ? 'Tap the card again to cancel.' : 'Tap anything else to cancel.', { color: C.faint }));
        return;
      }
      add(txt(this, L, row(0), `COMMANDER ${c.name.toUpperCase()}`, { color: c.color }));
      add(txt(this, R, row(0), this.run.powerUsed ? 'POWER USED' : 'POWER READY', { origin: [1, 0], color: this.run.powerUsed ? C.dim : C.hp }));
      add(txt(this, L, row(1), `PASSIVE: ${ps.name}`, { color: C.gold }));
      add(txt(this, L, row(2), ps.desc));
      add(txt(this, L, row(3), `POWER: ${c.power.name} (${c.power.cost} SCRAP, 1/ROUND)`, { color: C.gold }));
      add(txt(this, L, row(4), c.power.desc, { color: C.text }));
      return;
    }
    if ('relic' in info) {
      const r = RELIC_MAP[info.relic];
      add(txt(this, L, row(0), `RELIC: ${r.name}`, { color: C.gold }));
      add(txt(this, L, row(1), r.desc, { wrap: w - 12 }));
      const n = this.run.relics.filter((x) => x === info.relic).length;
      if (n > 1) add(txt(this, L, row(3), `You own ${n}. Effects stack.`, { color: C.dim }));
      return;
    }
    if ('trait' in info) {
      const tr = TRAIT_MAP[info.trait];
      const n = traitCounts(this.run.fleet, this.run.relics)[info.trait];
      add(txt(this, L, row(0), `${tr.name} SYNERGY`, { color: tr.color }));
      add(txt(this, R, row(0), `${n} COUNTED`, { origin: [1, 0], color: C.dim }));
      tr.tiers.forEach((tier, k) => {
        add(txt(this, L, row(1 + k), `(${tier.n}) ${tier.desc}`, { color: n >= tier.n ? C.gold : C.dim }));
      });
      // Only the ships you own here (the full list is behind MORE).
      const mine = [...new Set(this.run.fleet.filter((s) => s && SHIPS[s.def].classes.includes(info.trait)).map((s) => SHIPS[s!.def].name))];
      add(txt(this, L, row(3), mine.length ? `YOURS: ${mine.join(', ')}` : 'None in your fleet yet. MORE lists them.', { color: C.faint, wrap: w - 12 }));
      return;
    }

    const { def, ship } = info;
    add(txt(this, L, row(0), def.name.toUpperCase(), { color: def.accent[1] }));
    if (ship) {
      const next = xpForNext(ship.xp);
      const benched = !this.run.fleet.includes(ship) ? 'BENCHED  ' : '';
      const lv = add(txt(this, R, row(0), `LV ${levelOf(ship.xp)}  ${next ? `XP ${ship.xp}/${next}` : 'MAX'}`, { origin: [1, 0], color: C.gold }));
      add(txt(this, lv.x - lv.width - 12, row(0), `${benched}T${def.tier}`, { origin: [1, 0], color: hex(TIER_COLORS[def.tier]) }));
    } else {
      add(txt(this, R, row(0), `TIER ${def.tier}`, { origin: [1, 0], color: hex(TIER_COLORS[def.tier]) }));
    }
    const atk = add(txt(this, L, row(1), `ATK ${ship?.atk ?? def.atk}`, { color: C.atk }));
    const hp = add(txt(this, atk.x + atk.width + 10, row(1), `HP ${ship?.hp ?? def.hp}`, { color: C.hp }));
    add(txt(this, hp.x + hp.width + 10, row(1), `EVERY ${def.cd}T`, { color: C.dim }));
    let cx = R;
    [...def.classes].reverse().forEach((c) => {
      const t = add(txt(this, cx, row(1), TRAIT_MAP[c].short, { origin: [1, 0], color: TRAIT_MAP[c].color }));
      cx -= t.width + 8;
    });
    add(txt(this, L, row(2), def.desc));
    const lvl = ship ? levelOf(ship.xp) : 1;
    def.perks.forEach((p, k) => {
      const unlocked = lvl >= k + 2;
      add(txt(this, L, row(3 + k), `LV${k + 2} ${p}`, { color: unlocked ? C.gold : C.dim }));
    });
  }
}
