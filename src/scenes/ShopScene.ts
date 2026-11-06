import Phaser from 'phaser';
import { SHIP_RES, addShip, addStarfield, portraitKey, setPlayerSkin, syncFlame } from '../game/art';
import {
  EVENT_INFO, FLEET_SIZE, rerollCost, maxLives, SALE_COST, SHIP_COST, VETERAN_COST, TOTAL_SLOTS, isBench, slotGet, winsLabel,
  buy, canMerge, costAt, move, powerProblem, quickBuy, reroll, sell, sellValue, toggleFreeze, usePower, type Run,
} from '../game/run';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { openDetails, type Detail } from '../game/details';
import { getRun, saveRun } from '../game/storage';
import { prefetchOpponent } from '../game/net';
import { NODE_INFO, bossNext } from '../game/gauntlet';
import { C, TIER_COLORS, tierTag, button, historyPips, levelStars, panel, popup, relicChip, shieldPips, tapZone, toast, txt, type TextOpts } from '../game/ui';
import { RELIC_MAP } from '../sim/relics';
import { MAX_XP, SHIPS, levelOf, xpForNext, type ShipClass, type ShipDef } from '../sim/ships';
import { TRAITS, TRAIT_MAP, traitCounts, traitLevel } from '../sim/traits';
import type { FleetShip } from '../sim/types';
import { hullScale } from '../sim/battle';
import { combosFor, fleetBattleStats, gainLabel, hasGain, type BattleStats, type Gain } from '../game/combos';

type Src = { kind: 'shop' | 'fleet'; i: number };
type Tgt = { kind: 'slot'; i: number } | { kind: 'sell' };
type Note = 'lives' | 'history' | 'event' | 'scale';
type Info = { def: ShipDef; ship?: FleetShip } | { relic: string } | { trait: ShipClass } | { cmd: string } | { freeze: number } | { note: Note } | null;
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
const POWER = { x: 362, y: 144, w: 112, h: 34 };
/** Top of synergy panel row `i` (factions sit a little lower, under a divider). */
const SYN_ROW_Y = (i: number) => SYN.y + 14 + i * 12 + (TRAITS[i].faction ? 3 : 0);
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
  private battle: (BattleStats | null)[] = []; // battle-start stats of each fleet slot
  private battleNagAt = -1e9; // when BATTLE! last warned about unspent scrap

  constructor() {
    super('shop');
  }

  create() {
    const run = getRun();
    if (!run) {
      this.scene.start('menu');
      return;
    }
    if (run.phase === 'route') {
      this.scene.start('route');
      return;
    }
    this.run = run;
    this.sel = null;
    this.hover = null;
    this.pinned = null;
    this.armed = false;
    this.dragging = false;
    this.battleNagAt = -1e9;
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
    void prefetchOpponent(run); // look for an online player to fight this round
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
      obj.setScale(2.4 / SHIP_RES);
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
    if (src.kind === 'shop' && tgt.kind === 'sell') {
      // A shipyard ship dropped on SELL: nothing to sell, just put it back.
      this.sel = null;
      this.refresh();
      return;
    }
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
    if (!this.run.market && !this.run.freeRolls && this.run.scrap < rerollCost(this.run)) {
      toast(this, `NEED ${rerollCost(this.run)} SCRAP`);
      return;
    }
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
    // Scrap doesn't carry over: warn once, a second tap within 3s fights anyway.
    const now = this.time.now;
    if (this.run.scrap >= rerollCost(this.run) && now - this.battleNagAt > 3000) {
      this.battleNagAt = now;
      toast(this, `${this.run.scrap} SCRAP UNSPENT. TAP AGAIN TO FIGHT`, C.gold);
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
    for (let i = 0; i < maxLives(run); i++) {
      this.add2(this.add.image(12 + i * 10, 10, i < run.lives ? 'heart' : 'heart_empty'));
    }
    this.infoTarget(this.add2(tapZone(this, 12 + (maxLives(run) - 1) * 5, 10, maxLives(run) * 10 + 2, 20)), { note: 'lives' });
    this.add2(txt(this, 70, 7, winsLabel(run), { color: run.endless ? '#c58cff' : C.gold }));
    const g = run.gauntlet;
    if (g) this.add2(txt(this, 190, 7, bossNext(g) ? 'VS BOSS!' : `VS ${NODE_INFO[g.node].name.split(' ').pop()}`, { color: bossNext(g) ? C.bad : NODE_INFO[g.node].color }));
    else this.add2(txt(this, 190, 7, `ROUND ${run.round}`));
    soundButton(this, 176, 10).forEach((o) => this.add2(o));
    this.add2(this.add.image(300, 10, 'coin'));
    this.add2(txt(this, 308, 7, `${run.scrap} SCRAP`, { color: C.gold }));
    historyPips(this, 470, 10, run.history).forEach((o) => this.add2(o));
    const pips = Math.min(10, run.history.length);
    if (pips) this.infoTarget(this.add2(tapZone(this, 470 - (pips - 1) * 4.5, 10, pips * 9 + 4, 20)), { note: 'history' });

    // Relics (tap or hover a chip to read it)
    this.add2(txt(this, 8, 25, 'RELICS', { color: C.dim }));
    if (!run.relics.length) this.add2(txt(this, 62, 25, 'none yet', { color: C.faint }));
    // Long (endless) runs collect many relics: show what fits, then a count.
    const maxChips = 16;
    run.relics.slice(0, maxChips).forEach((id, i) => {
      const chip = relicChip(this, 66 + i * 17, 28, id, 14);
      this.add2(chip.bg);
      this.add2(chip.t);
      // The chips are small: a finger-sized hit area (as wide as the chip spacing, so they don't overlap).
      this.infoTarget(this.add2(this.add.rectangle(66 + i * 17, 28, 17, 20, 0xffffff, 0.001)), { relic: id });
    });
    if (run.relics.length > maxChips) this.add2(txt(this, 66 + maxChips * 17 - 6, 25, `+${run.relics.length - maxChips}`, { color: C.dim }));

    // Bench (left) and fleet (right)
    this.add2(txt(this, 6, 38, 'BENCH', { color: C.dim }));
    // A picked-up fleet or bench ship: say how to put it down.
    const holding = this.sel?.kind === 'fleet' && !!slotGet(run, this.sel.i);
    this.add2(txt(this, 134, 38, holding ? 'TAP A SLOT TO MOVE' : 'YOUR FLEET', { color: holding ? C.gold : C.cyan }));
    this.add2(txt(this, 352, 38, 'FRONT>', { origin: [1, 0], color: C.dim }));
    this.add2(this.add.rectangle(131, SLOT_Y, 1, BOX + 8, 0x232c52));
    const selDef = this.selectedDef();
    const cmdColor = run.cmd ? hexInt(CMD_MAP[run.cmd].color) : C.highlight;
    const targeting = this.armed && !!run.cmd && CMD_MAP[run.cmd].power.target;
    this.battle = fleetBattleStats(run);
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
      levelStars(this, x + 15, SLOT_Y - 15, levelOf(ship.xp)).forEach((o) => this.add2(o));
      this.classPips(x, SLOT_Y + 16, def);
      // Juul's SALUTE: this ship counts twice for synergies this round.
      if (!bench && run.salute === ship.def) this.add2(txt(this, x - 19, SLOT_Y + 4, 'x2', { color: '#e0a060' }).setStroke('#05060f', 2));
      // Fleet ships show what they'll fight with; boosted numbers are underlined.
      const st = bench ? null : this.battle[i];
      const atk = this.add2(txt(this, x - 4, SLOT_Y + 23, `${st?.atk ?? ship.atk}`, { origin: [1, 0], color: C.atk }));
      const hp = this.add2(txt(this, x + 4, SLOT_Y + 23, `${st?.hp ?? ship.hp}`, { color: C.hp }));
      if (st && st.atk > ship.atk) this.add2(this.add.rectangle(atk.x - atk.width / 2, SLOT_Y + 32, atk.width, 1, hexInt(C.atk)));
      if (st && st.hp > ship.hp) this.add2(this.add.rectangle(hp.x + hp.width / 2, SLOT_Y + 32, hp.width, 1, hexInt(C.hp)));
      // Shields at battle start: hollow cyan bars down the right edge.
      if (st?.shield) shieldPips(this, x + 17, SLOT_Y - 6, st.shield).forEach((o) => this.add2(o));
    }

    // Shipyard
    // Header: price, this round's event (hover/tap it), and the round's ship HP scaling.
    const sale = run.event === 'sale';
    const head = this.add2(txt(this, 24, 114, `SHIPYARD ${sale ? SALE_COST : SHIP_COST} SCRAP`, { color: sale ? C.gold : C.cyan }));
    if (run.event) {
      const ev = this.add2(txt(this, head.x + head.width + 8, 114, EVENT_INFO[run.event].name, { color: C.gold }));
      this.infoTarget(this.add2(tapZone(this, ev.x + ev.width / 2, 118, ev.width + 4, 16)), { note: 'event' });
    }
    const scale = hullScale(run.round);
    if (scale > 1) {
      const sc = this.add2(txt(this, 356, 114, `SHIP HP x${scale.toFixed(1)}`, { origin: [1, 0], color: C.hp }));
      this.infoTarget(this.add2(tapZone(this, sc.x - sc.width / 2, 118, sc.width + 4, 16)), { note: 'scale' });
    }
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
        this.add2(this.add.image(x - 18, SHOP_Y + 16, 'coin'));
        this.add2(txt(this, x - 12, SHOP_Y + 12, `${VETERAN_COST}`, { color: C.gold }).setStroke('#05060f', 2));
      } else if (mergeable || maxed) {
        const tag = mergeable ? '+XP' : 'MAX';
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
    const broke = !run.market && !run.freeRolls && run.scrap < rerollCost(run);
    const b1 = button(this, 418, 190, 100, 18, run.market ? `FREE ROLL x${run.market}` : run.freeRolls ? `FREE ROLL x${run.freeRolls}` : `REROLL ${rerollCost(run)}`, () => this.clickReroll(),
      { disabled: broke, fill: run.market ? 0x2a1a40 : undefined, color: run.market ? "#e0c8ff" : undefined });
    // Dimmed when you can't afford it, but still answers a tap (with why).
    if (broke) b1.bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.clickReroll());
    const selShip = this.sel?.kind === 'fleet' ? slotGet(run, this.sel.i) : null;
    const sellLabel = selShip ? `SELL +${sellValue(run, selShip)}` : 'SELL';
    const b2 = button(this, SELL.x, SELL.y, SELL.w, SELL.h, sellLabel, () => this.clickSell(), { fill: 0x3a1420 });
    const bossUp = !!this.run.gauntlet && bossNext(this.run.gauntlet);
    const b3 = button(this, 418, 244, 100, 24, bossUp ? 'FIGHT BOSS' : 'BATTLE!', () => this.clickBattle(), { fill: bossUp ? 0x4a1420 : 0x3a2a10, color: bossUp ? '#ff8a8a' : C.gold });
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
    this.add2(txt(this, x + 24, y + 14, cmd.power.cost ? `${cmd.power.cost} SCRAP` : 'FREE', { color: broke && !used ? C.bad : C.gold }));
    const state = used ? 'USED' : this.armed ? (cmd.power.target ? 'PICK SHIP' : 'TAP AGAIN') : broke ? 'NOT ENOUGH' : blocked ?? 'READY';
    this.add2(txt(this, x + 24, y + 24, state, { color: used || broke || blocked ? C.dim : this.armed ? C.gold : C.hp }));
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
      // Hit box in texture pixels: 24x20 on screen whatever the texture resolution.
      hitArea: new Phaser.Geom.Rectangle(fw / 2 - 12 * SHIP_RES, fh / 2 - 10 * SHIP_RES, 24 * SHIP_RES, 20 * SHIP_RES),
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
    let preview = info && 'def' in info && !fighting ? info.def : null;
    // A shipyard ship bought while the fleet is full goes to the bench: it adds no synergy.
    if (preview && info && 'def' in info && this.slotOf(info.ship) < 0 && this.fleetFull()) preview = null;
    // Only rebuild the synergy panel when its content changes. Rebuilding it while the
    // pointer is over a row would destroy that row, and its pointerout would never fire.
    const key = preview?.id ?? '';
    if (key !== this.synKey) {
      this.synKey = key;
      this.synLayer.removeAll(true);
      this.drawSynergy(preview);
    }
    this.drawCombos(info);
    this.drawStrip(info);
    this.drawMoreButton(info);
  }

  /** Slot (fleet or bench) holding this exact ship, or -1 (shipyard ships aren't in one). */
  private slotOf(ship: FleetShip | undefined): number {
    if (!ship) return -1;
    for (let i = 0; i < TOTAL_SLOTS; i++) if (slotGet(this.run, i) === ship) return i;
    return -1;
  }

  private fleetFull() {
    for (let i = 0; i < FLEET_SIZE; i++) if (!slotGet(this.run, i)) return false;
    return true;
  }

  /** A gain as small stacked numbers on a dark backing: ATK orange, HP green, shield cyan. */
  private gainStack(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, x: number, y: number, g: Gain) {
    const parts = gainParts(g);
    if (!parts.length) return;
    const lh = 9;
    const h = parts.length * lh + 3;
    add(this.add.rectangle(x, y, 28, h, 0x05060f, 0.8));
    parts.forEach((p, k) => add(txt(this, x + 1, y - h / 2 + 2 + k * lh, p.text, { origin: [0.5, 0], color: p.color })));
  }

  /**
   * Show what's comboing with what. Focus a fleet ship: every ship, relic and the commander
   * that boosts it lights up, marked with what it adds, plus its active synergy rows. Focus a
   * synergy: the ships counting toward it light up. Focus a shipyard ship: the copy it would
   * merge into lights up.
   */
  private drawCombos(info: Info) {
    if (this.dragging || !info) return;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.infoLayer.add(o); return o; };
    const ring = (x: number, y: number, w: number, h: number, col: number, lw = 2) =>
      add(this.add.rectangle(x, y, w, h).setStrokeStyle(lw, col));

    if ('trait' in info) {
      const col = hexInt(TRAIT_MAP[info.trait].color);
      this.run.fleet.forEach((s, i) => {
        if (s && SHIPS[s.def].classes.includes(info.trait)) ring(SLOT_X(i), SLOT_Y, BOX + 4, BOX + 4, col);
      });
      return;
    }
    if (!('def' in info)) return;
    if (this.slotOf(info.ship) < 0) {
      for (let k = 0; k < TOTAL_SLOTS; k++) {
        if (canMerge(slotGet(this.run, k), info.def.id)) ring(SLOT_X(k), SLOT_Y, BOX + 4, BOX + 4, 0x7dff8a);
      }
      return;
    }
    if (!info.ship) return;
    const i = this.run.fleet.indexOf(info.ship);
    if (i < 0) return;
    const c = combosFor(this.run, i);
    if (!c) return;
    ring(SLOT_X(i), SLOT_Y, BOX + 4, BOX + 4, C.highlight);
    // Its synergies that are switched on.
    const counts = traitCounts(this.run.fleet, this.run.relics, this.run.salute);
    TRAITS.forEach((tr, k) => {
      if (info.def.classes.includes(tr.id) && traitLevel(tr.id, counts[tr.id]) > 0) {
        ring(SYN.x + SYN.w / 2, SYN_ROW_Y(k) + 4, SYN.w - 6, 11, hexInt(tr.color), 1);
      }
    });
    for (const p of c.partners) {
      ring(SLOT_X(p.slot), SLOT_Y, BOX + 4, BOX + 4, 0x7fe7ff);
      this.gainStack(add, SLOT_X(p.slot), SLOT_Y + 1, p.gain);
    }
    for (const r of c.relics) {
      const k = this.run.relics.indexOf(r.id);
      if (k >= 0 && k < 16) ring(66 + k * 17, 28, 17, 17, 0x7fe7ff);
    }
    if (hasGain(c.commander) && this.run.cmd) {
      ring(POWER.x + POWER.w / 2, POWER.y + POWER.h / 2, POWER.w + 2, POWER.h + 2, 0x7fe7ff);
      // Covers the card's state line while a ship is focused.
      add(this.add.rectangle(POWER.x + 23, POWER.y + 22, POWER.w - 26, 11, 0x0e1430).setOrigin(0));
      let gx = POWER.x + 24;
      const parts = gainParts(c.commander);
      for (const p of parts) {
        const t = add(txt(this, gx, POWER.y + 24, parts.length > 2 ? p.text : p.label, { color: p.color }));
        gx += t.width + 6;
      }
    }
  }

  /** "MORE" opens a full card with every detail and definitions of the terms used. */
  private drawMoreButton(info: Info) {
    const d = this.toDetail(info);
    if (!d) return;
    const open = () => {
      if (this.dragging) return;
      // The boosts list runs several battle setups, so it's only worked out when MORE is tapped.
      openDetails(this, 'def' in d ? { ...d, boosts: this.boostsOf(d.ship) } : d);
    };
    const b = button(this, 332, 192, 40, 12, 'MORE', open, { fill: 0x1d2a50, color: C.cyan });
    b.objects.forEach((o) => this.infoLayer.add(o));
    // The button is small: a finger-sized hit area over it does the work.
    const zone = tapZone(this, 332, 192, 46, 20);
    zone.on('pointerover', () => b.bg.setStrokeStyle(2, C.highlight));
    zone.on('pointerout', () => b.bg.setStrokeStyle(2, 0x6a7cc0));
    zone.on('pointerup', () => { audio.play('click'); open(); });
    this.infoLayer.add(zone);
  }

  private toDetail(info: Info): Detail | null {
    if (!info || 'freeze' in info || 'note' in info) return null;
    if ('def' in info) return { def: info.def, ship: info.ship };
    if ('relic' in info) return { relic: info.relic };
    if ('trait' in info) return { trait: info.trait, count: traitCounts(this.run.fleet, this.run.relics, this.run.salute)[info.trait] };
    if (this.armed) return null;
    return { cmd: info.cmd, passive: this.run.passive ?? 'a' };
  }

  /** What boosts a fleet ship, one short line each, for the MORE card. Undefined off the fleet. */
  private boostsOf(ship: FleetShip | undefined): string[] | undefined {
    const i = ship ? this.run.fleet.indexOf(ship) : -1;
    if (i < 0) return undefined;
    const c = combosFor(this.run, i);
    if (!c) return undefined;
    const out: string[] = [];
    for (const p of c.partners) {
      const s = slotGet(this.run, p.slot);
      if (s) out.push(`${SHIPS[s.def].name} ${gainLabel(p.gain)}`);
    }
    for (const r of c.relics) out.push(`${RELIC_MAP[r.id]?.name ?? r.id} ${gainLabel(r.gain)}`);
    if (hasGain(c.commander) && this.run.cmd) out.push(`${CMD_MAP[this.run.cmd].name} ${gainLabel(c.commander)}`);
    return out;
  }

  /** Right-hand panel: class counts and thresholds; previews what a shop ship would add. */
  private drawSynergy(preview: ShipDef | null) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.synLayer.add(o); return o; };
    add(panel(this, SYN.x, SYN.y, SYN.w, SYN.h));
    add(txt(this, SYN.x + 6, SYN.y + 4, 'SYNERGY', { color: C.dim }));
    const counts = traitCounts(this.run.fleet, this.run.relics, this.run.salute);
    const adds = preview && !this.run.fleet.some((s) => s?.def === preview.id) ? preview.classes : [];

    // One line per synergy: name, then "have/next" (gold MAX when maxed). Factions sit under a divider.
    TRAITS.forEach((tr, i) => {
      const y = SYN_ROW_Y(i);
      const n = counts[tr.id];
      const lvl = traitLevel(tr.id, n);
      const next = tr.tiers.find((t) => n < t.n)?.n;
      const row = add(this.add.rectangle(SYN.x + SYN.w / 2, y + 4, SYN.w - 4, 12, 0xffffff, 0.001));
      this.infoTarget(row, { trait: tr.id });
      if (lvl > 0) add(this.add.rectangle(SYN.x + 3, y + 4, 2, 10, hexInt(tr.color)));
      const name = add(txt(this, SYN.x + 7, y, tr.short, { color: lvl > 0 ? tr.color : C.dim }));
      if (next && adds.includes(tr.id)) add(txt(this, name.x + name.width + 3, y, '+1', { color: C.hp }));
      add(txt(this, SYN.x + SYN.w - 4, y, next ? `${n}/${next}` : 'MAX', {
        origin: [1, 0], color: !next ? C.gold : lvl > 0 ? C.text : C.faint,
      }));
    });
    const fy = SYN.y + 14 + TRAITS.filter((t) => !t.faction).length * 12 + 1;
    add(this.add.rectangle(SYN.x + SYN.w / 2, fy, SYN.w - 10, 1, 0x262e50));
  }

  /** What tapping a selected shipyard ship again will do, for the strip's top-right corner. */
  private buyHint(i: number): { text: string; color: string } {
    const run = this.run;
    const def = run.shop[i];
    if (!def) return { text: '', color: C.dim };
    const cost = costAt(run, i);
    if (run.scrap < cost) return { text: `NEED ${cost} SCRAP`, color: C.bad };
    const vet = run.vetSlot === i;
    for (let k = 0; k < TOTAL_SLOTS; k++) {
      const t = slotGet(run, k);
      if (!t || !canMerge(t, def)) continue;
      const xp = Math.min(MAX_XP, t.xp + (vet ? 2 : 0) + 1); // same rule as merging in run.ts
      const lv = levelOf(xp);
      return { text: lv > levelOf(t.xp) ? `BUY: LV${lv}!` : `BUY: +${xp - t.xp} XP`, color: C.gold };
    }
    for (let k = 0; k < TOTAL_SLOTS; k++) if (!slotGet(run, k)) return { text: 'TAP AGAIN: BUY', color: C.gold };
    return { text: 'NO ROOM', color: C.bad };
  }

  private drawStrip(info: Info) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.infoLayer.add(o); return o; };
    const { x, y, w, h } = STRIP;
    add(panel(this, x, y, w, h));
    const L = x + 6;
    const R = x + w - 6;
    const W = w - 12;

    if (!info) {
      // Kept short and quiet on purpose: one prompt plus one rotating tip.
      const cy = y + h / 2;
      const ev = this.run.event ? EVENT_INFO[this.run.event] : null;
      if (ev) {
        // This round's shipyard event takes the prompt's place.
        add(txt(this, x + w / 2, cy - 7, `${ev.name}: ${ev.desc}`, { origin: 0.5, color: C.gold }));
      } else add(txt(this, x + w / 2, cy - 7, `${this.touch ? 'Tap' : 'Hover'} anything for details`, { origin: 0.5, color: C.faint }));
      add(txt(this, x + w / 2, cy + 7, SHOP_TIPS[(this.run.round - 1) % SHOP_TIPS.length], { origin: 0.5, color: '#4f5a80' }));
      return;
    }

    // Rows are made first, then laid out from their real (wrapped) heights so nothing
    // runs past the strip. Rows that still don't fit are dropped (MORE has everything).
    const rows: Phaser.GameObjects.Text[][] = [];
    const line = (str: string, o: TextOpts = {}) => {
      const t = add(txt(this, L, 0, str, { wrap: W, ...o }));
      rows.push([t]);
      return t;
    };
    /** Same row, right-aligned. */
    const right = (str: string, o: TextOpts = {}) => {
      const t = add(txt(this, R, 0, str, { origin: [1, 0], ...o }));
      rows[rows.length - 1].push(t);
      return t;
    };
    /** Same row, just after `prev`. */
    const after = (prev: Phaser.GameObjects.Text, str: string, o: TextOpts = {}, gap = 8) => {
      const t = add(txt(this, prev.x + prev.width + gap, 0, str, o));
      rows[rows.length - 1].push(t);
      return t;
    };
    this.fillStrip(info, line, right, after);

    const top = y + 5;
    const bottom = y + h - 2;
    const hs = rows.map((r) => Math.max(...r.map((t) => t.height)));
    const total = hs.reduce((a, b) => a + b, 0);
    const gap = rows.length > 1 ? Phaser.Math.Clamp(Math.floor((bottom - top - total) / (rows.length - 1)), 0, 3) : 0;
    let cy = top;
    let full = false;
    rows.forEach((r, k) => {
      if (cy + hs[k] > bottom) full = true;
      r.forEach((t) => (full ? t.destroy() : t.setY(Math.round(cy))));
      cy += hs[k] + gap;
    });
  }

  private fillStrip(
    info: NonNullable<Info>,
    line: (str: string, o?: TextOpts) => Phaser.GameObjects.Text,
    right: (str: string, o?: TextOpts) => Phaser.GameObjects.Text,
    after: (prev: Phaser.GameObjects.Text, str: string, o?: TextOpts, gap?: number) => Phaser.GameObjects.Text,
  ) {
    const run = this.run;
    if ('note' in info) {
      if (info.note === 'lives') {
        line('HULL', { color: C.bad });
        right(`${run.lives}/${maxLives(run)}`, { color: C.bad });
        line('Each lost battle costs 1 heart (a boss: 2). Lose them all and the run ends.');
      } else if (info.note === 'history') {
        line('LAST 10 RESULTS', { color: C.gold });
        line('Newest on the right. Green square: win. Red outline: loss. Grey dash: draw.');
      } else if (info.note === 'event' && run.event) {
        const ev = EVENT_INFO[run.event];
        line(`SHIPYARD EVENT: ${ev.name}`, { color: C.gold });
        line(ev.desc.charAt(0).toUpperCase() + ev.desc.slice(1));
      } else {
        line(`SHIP HP x${hullScale(run.round).toFixed(1)}`, { color: C.hp });
        line("From round 5 every ship in battle, yours and the enemy's, gets this much extra HP so fights last longer.");
        line('Slot numbers show HP before it.', { color: C.dim });
      }
      return;
    }
    if ('freeze' in info) {
      const frozen = !!run.frozen?.[info.freeze];
      line(frozen ? 'FROZEN' : 'FREEZE', { color: C.cyan });
      line('A frozen ship stays in the shipyard when you reroll and into the next round, so you can buy it later. Freezing is free.');
      line(frozen ? 'Tap again to unfreeze.' : 'Tap to freeze.', { color: C.dim });
      return;
    }
    if ('cmd' in info) {
      const c = CMD_MAP[info.cmd];
      const ps = c.passives[run.passive ?? 'a'];
      const cost = c.power.cost ? `${c.power.cost} SCRAP` : 'FREE';
      if (this.armed) {
        line(`${c.power.name}: ${c.power.desc}`, { color: c.color });
        line(c.power.target
          ? `${this.touch ? 'Tap' : 'Click'} one of your ships to use it.`
          : `${this.touch ? 'Tap' : 'Click'} the power card again to use it.`, { color: C.gold });
        line(c.power.cost ? `Costs ${c.power.cost} scrap. Once per round.` : 'Free. Once per round.', { color: C.dim });
        line(c.power.target ? 'Tap the card again to cancel.' : 'Tap anything else to cancel.', { color: C.faint });
        return;
      }
      line(`COMMANDER ${c.name.toUpperCase()}`, { color: c.color });
      right(run.powerUsed ? 'POWER USED' : 'POWER READY', { color: run.powerUsed ? C.dim : C.hp });
      line(`PASSIVE: ${ps.name}`, { color: C.gold });
      line(ps.desc);
      line(`POWER: ${c.power.name} (${cost}, 1/ROUND)`, { color: C.gold });
      line(c.power.desc);
      return;
    }
    if ('relic' in info) {
      const r = RELIC_MAP[info.relic];
      line(`RELIC: ${r.name}`, { color: C.gold });
      line(r.desc);
      const n = run.relics.filter((x) => x === info.relic).length;
      if (n > 1) line(`You own ${n}. Effects stack.`, { color: C.dim });
      return;
    }
    if ('trait' in info) {
      const tr = TRAIT_MAP[info.trait];
      const n = traitCounts(run.fleet, run.relics, run.salute)[info.trait];
      const next = tr.tiers.find((t) => n < t.n)?.n;
      line(`${tr.name} SYNERGY`, { color: tr.color });
      right(next ? `HAVE ${n} / NEXT ${next}` : 'MAXED', { color: next ? C.dim : C.gold });
      tr.tiers.forEach((tier) => line(`(${tier.n}) ${tier.desc}`, { color: n >= tier.n ? C.gold : C.dim }));
      // Only the ships you own here (the full list is behind MORE).
      const mine = [...new Set(run.fleet.filter((s) => s && SHIPS[s.def].classes.includes(info.trait)).map((s) => SHIPS[s!.def].name))];
      line(mine.length ? `YOURS: ${mine.join(', ')}` : 'None in your fleet yet. MORE lists them.', { color: C.faint });
      return;
    }

    const { def, ship } = info;
    const R = STRIP.x + STRIP.w - 6;
    const owned = this.slotOf(ship) >= 0;
    const name = line(def.name.toUpperCase(), { color: def.accent[1] });
    after(name, tierTag(def.tier), { color: hex(TIER_COLORS[def.tier]) });
    const selShop = this.sel?.kind === 'shop' && !owned && run.shop[this.sel.i] === def.id;
    if (selShop) {
      const hint = this.buyHint(this.sel!.i);
      right(hint.text, { color: hint.color });
    } else if (ship) {
      const lvl = levelOf(ship.xp);
      const next = xpForNext(ship.xp);
      const n = next ? next - ship.xp : 0;
      right(next ? `LV${lvl}  ${n} ${n === 1 ? 'COPY' : 'COPIES'} TO LV${lvl + 1}` : `LV${lvl} MAX`, { color: C.gold });
    }
    // Fleet ships: own stats + battle bonus (the lit-up ships, relics and commander add it).
    const fi = ship ? run.fleet.indexOf(ship) : -1;
    const st = fi >= 0 ? this.battle[fi] : null;
    const own = { atk: ship?.atk ?? def.atk, hp: ship?.hp ?? def.hp };
    const plus = (n: number) => (n > 0 ? `+${n}` : '');
    const atk = line(`ATK ${own.atk}${plus((st?.atk ?? own.atk) - own.atk)}`, { color: C.atk });
    let last = after(atk, `HP ${own.hp}${plus((st?.hp ?? own.hp) - own.hp)}`, { color: C.hp }, 10);
    if (st?.shield) last = after(last, `SH ${st.shield}`, { color: C.cyan }, 10);
    last = after(last, `EVERY ${def.cd}T`, { color: C.dim }, 10);
    // Class tags on the right; on a row of their own if the stats leave no room.
    const tagW = def.classes.reduce((a, c) => a + TRAIT_MAP[c].short.length * 8, 0) + 8 * (def.classes.length - 1);
    if (last.x + last.width + 10 + tagW > R) line('');
    let cx = R;
    [...def.classes].reverse().forEach((c) => {
      const t = right(TRAIT_MAP[c].short, { color: TRAIT_MAP[c].color });
      t.setX(cx);
      cx -= t.width + 8;
    });
    line(def.desc);
    if (fi >= 0 && run.salute === def.id) line('SALUTED: COUNTS x2 FOR SYNERGY', { color: '#e0a060' });
    const lvl = ship ? levelOf(ship.xp) : 1;
    def.perks.forEach((p, k) => {
      if (p) line(`LV${k + 2} ${p}`, { color: lvl >= k + 2 ? C.gold : C.dim });
    });
  }
}

/** A gain split into short coloured parts: ATK orange, HP green, shield cyan. */
function gainParts(g: Gain): { text: string; label: string; color: string }[] {
  const out: { text: string; label: string; color: string }[] = [];
  const n = (v: number) => `+${Math.min(99, v)}`;
  if (g.atk > 0) out.push({ text: n(g.atk), label: `${n(g.atk)}ATK`, color: C.atk });
  if (g.hp > 0) out.push({ text: n(g.hp), label: `${n(g.hp)}HP`, color: C.hp });
  if (g.shield > 0) out.push({ text: n(g.shield), label: `${n(g.shield)}SH`, color: C.cyan });
  return out;
}
