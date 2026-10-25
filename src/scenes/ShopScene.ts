import Phaser from 'phaser';
import { addShip, addStarfield, portraitKey, setPlayerSkin, syncFlame } from '../game/art';
import {
  FLEET_SIZE, REROLL_COST, SHIP_COST, WIN_TARGET, START_LIVES, TOTAL_SLOTS, isBench, slotGet,
  buy, canMerge, move, quickBuy, reroll, sell, sellValue, toggleFreeze, usePower, type Run,
} from '../game/run';
import { CMD_MAP } from '../sim/commanders';
import { getRun, saveRun } from '../game/storage';
import { C, button, panel, relicChip, toast, txt } from '../game/ui';
import { RELIC_MAP } from '../sim/relics';
import { SHIPS, levelOf, xpForNext, type ShipClass, type ShipDef } from '../sim/ships';
import { TRAITS, TRAIT_MAP, traitCounts, traitLevel } from '../sim/traits';
import type { FleetShip } from '../sim/types';
import { hullScale } from '../sim/battle';

type Src = { kind: 'shop' | 'fleet'; i: number };
type Tgt = { kind: 'slot'; i: number } | { kind: 'sell' };
type Info = { def: ShipDef; ship?: FleetShip } | { relic: string } | { trait: ShipClass } | { cmd: string } | null;

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
const TIER_COLORS = [0x3a4a7a, 0x8a94b8, 0x4aa3ff, 0xc58cff];
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class ShopScene extends Phaser.Scene {
  private run!: Run;
  private layer!: Phaser.GameObjects.Container;
  private infoLayer!: Phaser.GameObjects.Container;
  private sel: Src | null = null;
  private hover: Info = null;
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
    this.dragging = false;
    setPlayerSkin(run.skin ? run.cmd : null);
    addStarfield(this);
    this.layer = this.add.container();
    this.infoLayer = this.add.container();
    this.input.dragDistanceThreshold = 4;

    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      this.dragging = true;
      this.sel = obj.getData('src');
      this.layer.bringToTop(obj);
      obj.setScale(2.4);
      this.updateInfo();
    });
    this.input.on('drag', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image, x: number, y: number) => {
      obj.setPosition(x, y);
      const flame = obj.getData('flame') as Phaser.GameObjects.Image | undefined;
      if (flame) syncFlame(obj, flame, 0);
    });
    this.input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      const src: Src = obj.getData('src');
      const tgt = this.hitTest(p.x, p.y);
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
    else this.announceLevelUps(levelsBefore);
    this.sel = null;
    this.hover = null;
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

  private announceLevelUps(before: Map<FleetShip, number>) {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = slotGet(this.run, i);
      if (!s || !before.has(s)) continue;
      const lvl = levelOf(s.xp);
      if (lvl > before.get(s)!) {
        toast(this, `LEVEL ${lvl}! ${SHIPS[s.def].perks[lvl - 2]}`, C.gold);
        this.sparkle(SLOT_X(i), SLOT_Y);
      }
    }
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
    const same = this.sel && this.sel.kind === src.kind && this.sel.i === src.i;
    if (same) {
      if (src.kind === 'shop') {
        const before = this.levels();
        const err = quickBuy(this.run, src.i);
        if (err) toast(this, err);
        else this.announceLevelUps(before);
        saveRun(this.run);
      }
      this.sel = null;
    } else if (this.sel && src.kind === 'fleet') {
      this.perform(this.sel, { kind: 'slot', i: src.i });
      return;
    } else {
      this.sel = src;
    }
    this.refresh();
  }

  private clickSlot(i: number) {
    if (this.dragging || !this.sel) return;
    this.perform(this.sel, { kind: 'slot', i });
  }

  private clickSell() {
    if (this.sel?.kind === 'fleet') this.perform(this.sel, { kind: 'sell' });
    else toast(this, 'Pick a fleet ship to sell', C.dim);
  }

  private clickReroll() {
    const err = reroll(this.run);
    if (err) toast(this, err);
    this.sel = null;
    saveRun(this.run);
    this.refresh();
  }

  private clickPower() {
    if (this.dragging) return;
    const cmd = this.run.cmd ? CMD_MAP[this.run.cmd] : null;
    if (!cmd) return;
    const slot = this.sel?.kind === 'fleet' ? this.sel.i : null;
    const before = this.levels();
    const err = usePower(this.run, slot);
    if (err) {
      toast(this, err, err.startsWith('Select') ? C.dim : C.bad);
    } else {
      toast(this, `${cmd.power.name}!`, C.gold);
      if (slot !== null) this.sparkle(SLOT_X(slot), SLOT_Y);
      this.announceLevelUps(before);
      if (!cmd.power.target) this.sel = null;
    }
    saveRun(this.run);
    this.refresh();
  }

  private clickFreeze(i: number) {
    toggleFreeze(this.run, i);
    saveRun(this.run);
    this.refresh();
  }

  private clickBattle() {
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
    this.tweens.killTweensOf(this.flames);
    this.flames = [];
    this.layer.removeAll(true);
    const run = this.run;

    // Top bar
    this.add2(panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52));
    for (let i = 0; i < START_LIVES; i++) {
      this.add2(this.add.image(12 + i * 10, 10, i < run.lives ? 'heart' : 'heart_empty'));
    }
    this.add2(txt(this, 70, 7, `WINS ${run.wins}/${WIN_TARGET}`, { color: C.gold }));
    this.add2(txt(this, 190, 7, `ROUND ${run.round}`));
    this.add2(this.add.image(300, 10, 'coin'));
    this.add2(txt(this, 308, 7, `${run.scrap} SCRAP`, { color: C.gold }));
    this.add2(txt(this, 472, 7, run.history.slice(-8).join(''), { origin: [1, 0], color: C.dim }));

    // Relics
    this.add2(txt(this, 8, 26, 'RELICS', { color: C.dim }));
    if (!run.relics.length) this.add2(txt(this, 62, 26, 'none yet', { color: '#4a5578' }));
    run.relics.forEach((id, i) => {
      const chip = relicChip(this, 68 + i * 15, 29, id);
      this.add2(chip.bg);
      this.add2(chip.t);
      chip.bg.setInteractive();
      chip.bg.on('pointerover', () => this.setHover({ relic: id }));
      chip.bg.on('pointerout', () => this.setHover(null));
    });

    // Bench (left) and fleet (right)
    this.add2(txt(this, 6, 38, 'BENCH', { color: C.dim }));
    this.add2(txt(this, 134, 38, 'YOUR FLEET', { color: C.cyan }));
    this.add2(txt(this, 352, 38, 'FRONT>', { origin: [1, 0], color: C.dim }));
    this.add2(this.add.rectangle(131, SLOT_Y, 1, BOX + 8, 0x232c52));
    const selDef = this.selectedDef();
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const ship = slotGet(run, i);
      const x = SLOT_X(i);
      const bench = isBench(i);
      const isSel = this.sel?.kind === 'fleet' && this.sel.i === i;
      const mergeHint = !!selDef && !isSel && canMerge(ship, selDef);
      const border = isSel ? C.highlight : mergeHint ? 0x7dff8a : bench ? 0x262e50 : C.border;
      const box = this.add2(this.add.rectangle(x, SLOT_Y, BOX, BOX, bench ? 0x080b1c : 0x0b1026)
        .setStrokeStyle(isSel || mergeHint ? 2 : 1, border));
      box.setInteractive();
      box.on('pointerup', () => this.clickSlot(i));
      if (!ship) continue;
      const def = SHIPS[ship.def];
      this.shipSprite(x, SLOT_Y, def, { kind: 'fleet', i }, ship);
      const lvl = levelOf(ship.xp);
      for (let s = 0; s < lvl; s++) this.add2(this.add.image(x - (lvl - 1) * 4 + s * 8, SLOT_Y - 15, 'star'));
      this.classPips(x, SLOT_Y + 16, def);
      this.add2(txt(this, x - 4, SLOT_Y + 23, `${ship.atk}`, { origin: [1, 0], color: C.atk }));
      this.add2(txt(this, x + 4, SLOT_Y + 23, `${ship.hp}`, { color: C.hp }));
    }

    // Shipyard
    this.add2(txt(this, 24, 114, `SHIPYARD  ${SHIP_COST} SCRAP EACH`, { color: C.cyan }));
    run.shop.forEach((defId, i) => {
      const x = SHOP_X(i);
      const def = defId ? SHIPS[defId] : null;
      const isSel = this.sel?.kind === 'shop' && this.sel.i === i;
      const frozen = !!run.frozen?.[i];
      const stroke = isSel ? C.highlight : frozen ? 0x7fe7ff : def ? TIER_COLORS[def.tier] : 0x1d2444;
      this.add2(this.add.rectangle(x, SHOP_Y, 48, 48, frozen ? 0x10263a : 0x0b1026).setStrokeStyle(isSel || frozen ? 2 : 1, stroke));
      if (!def) {
        this.add2(txt(this, x, SHOP_Y, 'SOLD', { origin: 0.5, color: '#3a4570' }));
        return;
      }
      this.add2(txt(this, x - 21, SHOP_Y - 21, `T${def.tier}`, { color: hex(TIER_COLORS[def.tier]) }));
      this.shipSprite(x, SHOP_Y, def, { kind: 'shop', i });
      this.classPips(x, SHOP_Y + 20, def);
      this.add2(txt(this, x - 6, SHOP_Y + 27, `${def.atk}`, { origin: [1, 0], color: C.atk }));
      this.add2(txt(this, x + 6, SHOP_Y + 27, `${def.hp}`, { color: C.hp }));

      // Freeze toggle
      const fb = this.add2(this.add.rectangle(x, SHOP_Y + 42, 22, 11, frozen ? 0x2a6a8a : 0x141a33)
        .setStrokeStyle(1, frozen ? 0x7fe7ff : 0x3a4a7a));
      this.add2(this.add.image(x, SHOP_Y + 42, 'snow').setTint(frozen ? 0xffffff : 0x6a7cc0));
      fb.setInteractive({ useHandCursor: true });
      fb.on('pointerup', () => this.clickFreeze(i));
      fb.on('pointerover', () => fb.setStrokeStyle(1, C.highlight));
      fb.on('pointerout', () => fb.setStrokeStyle(1, frozen ? 0x7fe7ff : 0x3a4a7a));
    });

    // Buttons
    const b1 = button(this, 418, 190, 100, 18, `REROLL ${REROLL_COST}`, () => this.clickReroll(),
      { disabled: run.scrap < REROLL_COST });
    const selShip = this.sel?.kind === 'fleet' ? slotGet(run, this.sel.i) : null;
    const sellLabel = selShip ? `SELL +${sellValue(run, selShip)}` : 'SELL';
    const b2 = button(this, SELL.x, SELL.y, SELL.w, SELL.h, sellLabel, () => this.clickSell(), { fill: 0x3a1420 });
    const b3 = button(this, 418, 244, 100, 24, 'BATTLE!', () => this.clickBattle(), { fill: 0x3a2a10, color: C.gold });
    [...b1.objects, ...b2.objects, ...b3.objects].forEach((o) => this.add2(o));

    // Commander badge and shop power (top right, above the synergy panel)
    const cmd = run.cmd ? CMD_MAP[run.cmd] : null;
    if (cmd) {
      const badge = this.add2(this.add.image(354, 29, portraitKey(cmd.id)));
      badge.setInteractive();
      badge.on('pointerover', () => this.setHover({ cmd: cmd.id }));
      badge.on('pointerout', () => this.setHover(null));
      const used = !!run.powerUsed;
      const pb = button(this, 418, 29, 100, 14, used ? 'USED' : `${cmd.power.name} ${cmd.power.cost}`, () => this.clickPower(), {
        fill: 0x1d2a50, color: cmd.color, disabled: used || run.scrap < cmd.power.cost,
      });
      pb.objects.forEach((o) => this.add2(o));
      // Hover works even when the button is disabled, so the power can always be read.
      const hov = this.add2(this.add.rectangle(418, 29, 100, 14, 0xffffff, 0.001).setInteractive());
      hov.on('pointerover', () => this.setHover({ cmd: cmd.id }));
      hov.on('pointerout', () => this.setHover(null));
      hov.on('pointerup', () => this.clickPower());
    }

    this.updateInfo();
  }

  /** Small colored dashes under a ship showing its classes. */
  private classPips(x: number, y: number, def: ShipDef) {
    def.classes.forEach((c, k) => {
      const px = x + (k - (def.classes.length - 1) / 2) * 10;
      this.add2(this.add.rectangle(px, y, 8, 2, Phaser.Display.Color.HexStringToColor(TRAIT_MAP[c].color).color));
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
    this.hover = info;
    this.updateInfo();
  }

  private currentInfo(): Info {
    if (this.hover) return this.hover;
    if (!this.sel) return null;
    const defId = this.selectedDef();
    if (!defId) return null;
    const ship = this.sel.kind === 'fleet' ? slotGet(this.run, this.sel.i) ?? undefined : undefined;
    return { def: SHIPS[defId], ship };
  }

  private updateInfo() {
    this.infoLayer.removeAll(true);
    const info = this.currentInfo();
    // Preview synergy gains for shop ships and benched ships (not ones already fighting).
    const fighting = info && 'def' in info && info.ship && this.run.fleet.includes(info.ship);
    this.drawSynergy(info && 'def' in info && !fighting ? info.def : null);
    this.drawStrip(info);
  }

  /** Right-hand panel: class counts and thresholds; previews what a shop ship would add. */
  private drawSynergy(preview: ShipDef | null) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.infoLayer.add(o); return o; };
    add(panel(this, 362, 38, 112, 140));
    add(txt(this, 368, 44, 'SYNERGY', { color: C.dim }));
    const counts = traitCounts(this.run.fleet);
    const adds = preview && !this.run.fleet.some((s) => s?.def === preview.id) ? preview.classes : [];

    TRAITS.forEach((tr, i) => {
      const y = 60 + i * 29;
      const n = counts[tr.id];
      const lvl = traitLevel(tr.id, n);
      const row = add(this.add.rectangle(418, y + 8, 108, 26, 0xffffff, 0.001));
      row.setInteractive();
      row.on('pointerover', () => this.setHover({ trait: tr.id }));
      row.on('pointerout', () => this.setHover(null));
      if (lvl > 0) add(this.add.rectangle(365, y + 8, 2, 22, Phaser.Display.Color.HexStringToColor(tr.color).color));
      add(txt(this, 369, y, tr.name, { color: lvl > 0 ? tr.color : C.dim }));
      add(txt(this, 470, y, `${n}`, { origin: [1, 0], color: lvl > 0 ? C.text : C.dim }));
      if (adds.includes(tr.id)) add(txt(this, 458, y, '+1', { origin: [1, 0], color: C.hp }));
      tr.tiers.forEach((tier, k) => {
        add(txt(this, 369 + k * 24, y + 11, `(${tier.n})`, { color: n >= tier.n ? C.gold : '#4a5578' }));
      });
    });
  }

  private drawStrip(info: Info) {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.infoLayer.add(o); return o; };
    const { x, y, w, h } = STRIP;
    add(panel(this, x, y, w, h));
    const L = x + 6;
    const R = x + w - 6;
    const row = (i: number) => y + 6 + i * 12;

    if (!info) {
      add(txt(this, L, row(0), 'Drag ships to fleet or bench to buy them.', { color: C.dim }));
      add(txt(this, L, row(1), 'Same ship on same ship = merge + level up.', { color: C.dim }));
      add(txt(this, L, row(2), 'Different ships of a class unlock SYNERGY.', { color: C.dim }));
      add(txt(this, L, row(3), 'Freeze a shop ship to keep it for later.', { color: C.dim }));
      const hull = hullScale(this.run.round);
      add(hull > 1
        ? txt(this, L, row(4), `Round ${this.run.round}: all hulls x${hull.toFixed(1)} HP in battle.`, { color: C.hp })
        : txt(this, L, row(4), 'Hover anything for details.', { color: '#4a5578' }));
      return;
    }
    if ('cmd' in info) {
      const c = CMD_MAP[info.cmd];
      const ps = c.passives[this.run.passive ?? 'a'];
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
      add(txt(this, L, row(1), r.desc));
      return;
    }
    if ('trait' in info) {
      const tr = TRAIT_MAP[info.trait];
      const n = traitCounts(this.run.fleet)[info.trait];
      add(txt(this, L, row(0), `${tr.name} SYNERGY`, { color: tr.color }));
      add(txt(this, R, row(0), `${n} DIFFERENT SHIPS`, { origin: [1, 0], color: C.dim }));
      tr.tiers.forEach((tier, k) => {
        add(txt(this, L, row(1 + k), `(${tier.n}) ${tier.desc}`, { color: n >= tier.n ? C.gold : C.dim }));
      });
      const members = Object.values(SHIPS).filter((s) => s.tier > 0 && s.classes.includes(info.trait)).map((s) => s.name);
      add(txt(this, L, row(3), members.join(', '), { color: '#4a5578', wrap: w - 12 }));
      return;
    }

    const { def, ship } = info;
    add(txt(this, L, row(0), def.name.toUpperCase(), { color: def.accent[1] }));
    if (ship) {
      const next = xpForNext(ship.xp);
      const benched = !this.run.fleet.includes(ship) ? 'BENCHED  ' : '';
      add(txt(this, R, row(0), `${benched}LV ${levelOf(ship.xp)}  ${next ? `XP ${ship.xp}/${next}` : 'MAX'}`, { origin: [1, 0], color: C.gold }));
    } else {
      add(txt(this, R, row(0), `TIER ${def.tier}`, { origin: [1, 0], color: hex(TIER_COLORS[def.tier]) }));
    }
    const atk = add(txt(this, L, row(1), `ATK ${ship?.atk ?? def.atk}`, { color: C.atk }));
    const hp = add(txt(this, atk.x + atk.width + 10, row(1), `HP ${ship?.hp ?? def.hp}`, { color: C.hp }));
    add(txt(this, hp.x + hp.width + 10, row(1), `EVERY ${def.cd}T`, { color: C.dim }));
    let cx = R;
    [...def.classes].reverse().forEach((c) => {
      const t = add(txt(this, cx, row(1), TRAIT_MAP[c].name, { origin: [1, 0], color: TRAIT_MAP[c].color }));
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
