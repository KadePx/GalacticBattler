import Phaser from 'phaser';
import { addShip, addStarfield, syncFlame } from '../game/art';
import { getOpponent } from '../game/opponents';
import { WIN_TARGET, applyResult, makeSnapshot, type Run } from '../game/run';
import { getRun, saveGhost, saveRun } from '../game/storage';
import { C, button, panel, popup, txt } from '../game/ui';
import { OVERLOAD_TICK, hullScale, simulate, type BEvent, type BUnit, type BattleResult } from '../sim/battle';
import { SHIPS } from '../sim/ships';
import { TRAITS, traitCounts, traitLevel } from '../sim/traits';
import type { Snapshot } from '../sim/types';

const TICK_MS = 150;
const SHOT_MS = 160;
const hexInt = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;

interface View {
  u: BUnit;
  pos: { x: number; y: number }; // tweened base position; sprites follow it each frame
  phase: number; // idle bob offset
  spr: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  barBg: Phaser.GameObjects.Rectangle;
  bar: Phaser.GameObjects.Rectangle;
  hpT: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Ellipse | null;
  alive: boolean;
}

export class BattleScene extends Phaser.Scene {
  private run!: Run;
  private res!: BattleResult;
  private opp!: Snapshot;
  private views = new Map<number, View>();
  private byTick = new Map<number, BEvent[]>();
  private t = 0;
  private acc = 0;
  private speed = 1;
  private started = false;
  private startDelay = 0;
  private done = false;
  private speedBtn?: Phaser.GameObjects.Text;

  constructor() {
    super('battle');
  }

  create() {
    const run = getRun();
    if (!run) {
      this.scene.start('menu');
      return;
    }
    this.run = run;
    this.views.clear();
    this.byTick.clear();
    this.t = 0;
    this.acc = 0;
    this.started = false;
    this.done = false;
    this.speedBtn = undefined; // the old button was destroyed with the previous battle
    this.setSpeed(1);
    addStarfield(this);

    // Freeze the fleet into a snapshot (this is what other players would fight),
    // find an opponent, and simulate the whole fight up front.
    const me = makeSnapshot(run);
    saveGhost(me);
    this.opp = getOpponent(run);
    this.res = simulate(me, this.opp);
    for (const e of this.res.events) {
      if (!this.byTick.has(e.t)) this.byTick.set(e.t, []);
      this.byTick.get(e.t)!.push(e);
    }

    // Lock in the result now so refreshing the page can't undo a loss.
    run.lastOpponent = this.opp.name;
    applyResult(run, this.res.winner);
    saveRun(run);

    // Header
    panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52);
    txt(this, 8, 7, 'YOUR FLEET', { color: C.cyan });
    txt(this, 240, 7, `ROUND ${me.round}`, { origin: [0.5, 0] });
    const hull = hullScale(Math.max(me.round, this.opp.round));
    if (hull > 1) txt(this, 240, 24, `HULLS x${hull.toFixed(1)}`, { origin: [0.5, 0], color: C.hp });
    txt(this, 472, 7, this.opp.name.toUpperCase(), { origin: [1, 0], color: C.bad });
    const tag = this.opp.runId === 'bot' ? this.opp.style ?? 'RAIDER' : 'GHOST FLEET';
    txt(this, 472, 24, `${tag}  ${this.opp.wins}W`, { origin: [1, 0], color: C.dim });
    if (this.opp.relics.length) txt(this, 472, 34, `${this.opp.relics.length} RELICS`, { origin: [1, 0], color: C.dim });
    this.traitLine(me, 8, 24, 0);
    this.traitLine(this.opp, 472, 44, 1);

    for (const u of this.res.units) this.makeView(u);
    this.layout(0, false);
    this.layout(1, false);

    this.speedBtn = button(this, 420, 256, 44, 16, '1X', () => this.setSpeed(this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1)).label;
    button(this, 466, 256, 20, 16, '>>', () => this.setSpeed(12));

    const banner = txt(this, 240, 70, 'ENGAGE!', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);
    this.tweens.add({ targets: banner, alpha: 0, delay: 500, duration: 400, onComplete: () => banner.destroy() });
    this.startDelay = 700;
  }

  /** Active synergies for a fleet, e.g. "STRIKE 2  TECH 4". */
  private traitLine(snap: Snapshot, x: number, y: number, side: 0 | 1) {
    const counts = traitCounts(snap.fleet);
    const active = TRAITS.filter((tr) => traitLevel(tr.id, counts[tr.id]) > 0);
    let cx = x;
    for (const tr of side === 0 ? active : [...active].reverse()) {
      const t = txt(this, cx, y, `${tr.name} ${counts[tr.id]}`, { origin: [side, 0], color: tr.color });
      cx += side === 0 ? t.width + 8 : -(t.width + 8);
    }
  }

  private setSpeed(s: number) {
    this.speed = s;
    this.tweens.timeScale = s;
    this.time.timeScale = s;
    if (this.speedBtn?.active) this.speedBtn.setText(s > 4 ? 'SKIP' : `${s}X`);
  }

  update(time: number, delta: number) {
    this.syncViews(time);
    if (!this.started) {
      this.startDelay -= delta * this.speed;
      this.started = this.startDelay <= 0;
    }
    if (!this.started || this.done) return;
    this.acc += delta * this.speed;
    while (this.acc >= TICK_MS && !this.done) {
      this.acc -= TICK_MS;
      this.step();
    }
  }

  // ---------- views ----------

  /** Line positions; squeezes spacing and uses three rows when a side gets crowded. */
  private pos(side: number, idx: number, n: number) {
    const spacing = n <= 6 ? 34 : Math.max(20, Math.floor(200 / (n - 1)));
    const x = side === 0 ? 212 - idx * spacing : 268 + idx * spacing;
    const rows = n <= 6 ? [-22, 22] : [-32, 0, 32];
    return { x, y: 140 + rows[idx % rows.length] };
  }

  private makeView(u: BUnit, from?: { x: number; y: number }) {
    const { spr, flame } = addShip(this, 0, 0, u.def, u.side);
    const barBg = this.add.rectangle(0, 0, 26, 4, 0x1a0a10).setOrigin(0, 0.5);
    const bar = this.add.rectangle(0, 0, 24, 2, u.side === 0 ? 0x7dff8a : 0xff5e7e).setOrigin(0, 0.5);
    const hpT = txt(this, 0, 0, `${u.hp}`, { origin: 0.5, color: C.text });
    const shield = u.shield > 0 ? this.makeShield(u.shield) : null;
    if (u.cloak) spr.setAlpha(0.3);
    const v: View = {
      u: { ...u }, pos: { x: from?.x ?? 0, y: from?.y ?? 0 }, phase: Math.random() * Math.PI * 2,
      spr, flame, barBg, bar, hpT, shield, alive: true,
    };
    this.views.set(u.uid, v);
    return v;
  }

  private makeShield(n: number) {
    return this.add.ellipse(0, 0, 44, 32).setStrokeStyle(n > 1 ? 2 : 1, 0x7fe7ff).setFillStyle(0x7fe7ff, 0.1);
  }

  /** Every frame: move sprites to their tweened base position plus a gentle idle bob. */
  private syncViews(time: number) {
    for (const v of this.views.values()) {
      if (!v.alive) continue;
      const { x, y } = v.pos;
      v.spr.setPosition(Math.round(x), Math.round(y + Math.sin(time * 0.003 + v.phase) * 1.5));
      syncFlame(v.spr, v.flame, v.u.side);
      v.barBg.setPosition(x - 13, y + 20);
      v.bar.setPosition(x - 12, y + 20);
      v.hpT.setPosition(x, y + 28);
      v.shield?.setPosition(v.spr.x, v.spr.y);
    }
  }

  private layout(side: number, animate = true) {
    const line = [...this.views.values()].filter((v) => v.alive && v.u.side === side);
    line.forEach((v, i) => {
      const p = this.pos(side, i, line.length);
      if (animate) this.tweens.add({ targets: v.pos, x: p.x, y: p.y, duration: 260, ease: 'Quad.easeOut' });
      else { v.pos.x = p.x; v.pos.y = p.y; }
    });
  }

  private setHp(v: View, hp: number) {
    if (!v.alive || !v.hpT.active) return;
    v.u.hp = hp;
    v.bar.width = Math.max(0, Math.round((24 * hp) / v.u.maxHp));
    v.hpT.setText(`${hp}`);
  }

  private flash(v: View, color: number) {
    v.spr.setTintFill(color);
    this.time.delayedCall(70, () => v.spr.active && v.spr.clearTint());
  }

  // ---------- playback ----------

  private step() {
    this.t++;
    if (this.t === OVERLOAD_TICK + 1) {
      const b = txt(this, 240, 60, 'REACTOR OVERLOAD', { size: 16, origin: 0.5, color: C.bad }).setStroke('#05060f', 4);
      this.tweens.add({ targets: b, alpha: 0, delay: 900, duration: 500, onComplete: () => b.destroy() });
      this.cameras.main.flash(200, 120, 20, 30);
    }
    for (const e of this.byTick.get(this.t) ?? []) this.play(e);
    if (this.t >= this.res.ticks) {
      this.done = true;
      this.time.delayedCall(900, () => this.showResult());
    }
  }

  private play(e: BEvent) {
    switch (e.k) {
      case 'die':
        // Wait for the slowest projectile (torpedoes) to land before exploding.
        this.time.delayedCall(SHOT_MS * 1.4 + 40, () => this.explode(e.u));
        return;
      case 'buff': {
        const v = this.views.get(e.u);
        if (!v) return;
        this.time.delayedCall(SHOT_MS, () => {
          if (!v.alive) return;
          this.setHp(v, e.hp);
          // Small team-wide buffs (Vengeance) just flash; named buffs get a label.
          if (/^\+\d+$/.test(e.label)) this.flash(v, 0xffd166);
          else popup(this, v.spr.x, v.spr.y - 24, e.label, e.label.startsWith('-') ? '#b8d4ff' : C.gold);
        });
        return;
      }
      case 'cloak': {
        const v = this.views.get(e.u);
        if (!v) return;
        this.time.delayedCall(e.on ? SHOT_MS + 60 : 0, () => {
          if (!v.alive) return;
          this.tweens.add({ targets: v.spr, alpha: e.on ? 0.3 : 1, duration: 150 });
          if (e.on) popup(this, v.spr.x, v.spr.y - 24, 'CLOAK', '#dcc0ff');
        });
        return;
      }
      case 'revive': {
        const v = this.views.get(e.u);
        if (!v) return;
        this.time.delayedCall(SHOT_MS * 1.4 + 20, () => {
          if (!v.alive) return;
          this.sparks(v.spr.x, v.spr.y, 10, 0x9cff3a);
          this.ring(v.spr.x, v.spr.y, 0x9cff3a);
          this.flash(v, 0xe8ffb0);
          this.setHp(v, e.hp);
          popup(this, v.spr.x, v.spr.y - 24, 'REBUILT', '#9cff3a');
        });
        return;
      }
      case 'spawn': {
        const q = this.views.get(e.s);
        const v = this.makeView(e.unit, q ? { ...q.pos } : undefined);
        v.spr.setScale(0.5);
        this.tweens.add({ targets: v.spr, scale: 2, duration: 200 });
        this.layout(e.unit.side);
        return;
      }
      default:
        break;
    }

    const s = this.views.get(e.s);
    const d = this.views.get(e.d);
    if (!s || !d) return;

    if (e.k === 'heal') {
      const g = this.add.graphics().lineStyle(1, 0x7dff8a, 1).lineBetween(s.spr.x, s.spr.y, d.spr.x, d.spr.y);
      this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
      this.time.delayedCall(SHOT_MS / 2, () => {
        this.setHp(d, e.hp);
        popup(this, d.spr.x, d.spr.y - 14, `+${e.amt}`, C.hp);
      });
      return;
    }
    if (e.k === 'jam') {
      this.time.delayedCall(SHOT_MS, () => d.alive && popup(this, d.spr.x, d.spr.y - 24, 'JAM', '#b8d4ff'));
      return;
    }
    if (e.k !== 'shot') return;

    if (e.zap) {
      // Reflector: a jagged lightning arc straight to the attacker.
      this.time.delayedCall(SHOT_MS + 20, () => {
        if (!d.alive) return;
        this.lightning(s.spr.x, s.spr.y, d.spr.x, d.spr.y, 0x3dffa8);
        this.setHp(d, e.hp);
        popup(this, d.spr.x, d.spr.y - 14, `-${e.dmg}`, '#3dffa8');
        this.flash(d, 0xd0fff0);
      });
      return;
    }

    // Shot: recoil, muzzle flash, projectile, then impact.
    const side = s.u.side;
    const dir = side === 0 ? 1 : -1;
    const accent = hexInt(SHIPS[s.u.def].accent[1]);
    const nose = { x: s.spr.x + (s.spr.width) * dir, y: s.spr.y };
    if (e.ram) popup(this, s.spr.x, s.spr.y - 24, 'RAM!', C.atk);
    else {
      this.tweens.add({ targets: s.pos, x: s.pos.x - 3 * dir, duration: 50, yoyo: true });
      const m = this.add.image(nose.x, nose.y, 'px').setScale(2).setTint(0xffffff);
      this.tweens.add({ targets: m, scale: 4, alpha: 0, duration: 90, onComplete: () => m.destroy() });
    }
    const isTorp = s.u.def === 'torpedo' || s.u.def === 'siege' || !!e.ram;
    const proj = isTorp
      ? this.add.image(nose.x, nose.y, `torp_${side}`).setScale(2)
      : this.add.image(nose.x, nose.y, 'bolt').setScale(2).setTint(accent);
    proj.setRotation(Phaser.Math.Angle.Between(nose.x, nose.y, d.spr.x, d.spr.y) - (side === 1 && isTorp ? Math.PI : 0));
    this.tweens.add({
      targets: proj, x: d.spr.x, y: d.spr.y, duration: isTorp ? SHOT_MS * 1.4 : SHOT_MS,
      onComplete: () => {
        proj.destroy();
        if (!d.alive) return;
        if (e.blocked) {
          popup(this, d.spr.x, d.spr.y - 14, 'BLOCK', C.cyan);
          if (d.shield && e.sh > 0) d.shield.setStrokeStyle(e.sh > 1 ? 2 : 1, 0x7fe7ff);
          else if (d.shield) {
            const sh = d.shield;
            d.shield = null;
            this.tweens.add({ targets: sh, scale: 1.6, alpha: 0, duration: 250, onComplete: () => sh.destroy() });
          }
          return;
        }
        this.setHp(d, e.hp);
        popup(this, d.spr.x, d.spr.y - 14, `-${e.dmg}`, C.bad);
        this.flash(d, 0xffffff);
        this.sparks(d.spr.x, d.spr.y, 4, accent);
      },
    });
  }

  private sparks(x: number, y: number, n: number, color: number) {
    for (let i = 0; i < n; i++) {
      const p = this.add.image(x, y, 'px').setTint(color);
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 16;
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, alpha: 0,
        duration: 250 + Math.random() * 250, onComplete: () => p.destroy(),
      });
    }
  }

  private ring(x: number, y: number, color: number) {
    const c = this.add.circle(x, y, 5).setStrokeStyle(2, color).setFillStyle(0, 0);
    this.tweens.add({ targets: c, scale: 5, alpha: 0, duration: 380, ease: 'Quad.easeOut', onComplete: () => c.destroy() });
  }

  private lightning(x1: number, y1: number, x2: number, y2: number, color: number) {
    const g = this.add.graphics().lineStyle(2, color, 1);
    const n = 6;
    g.beginPath();
    g.moveTo(x1, y1);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      g.lineTo(x1 + (x2 - x1) * k + (Math.random() - 0.5) * 10, y1 + (y2 - y1) * k + (Math.random() - 0.5) * 10);
    }
    g.lineTo(x2, y2);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
  }

  private explode(uid: number) {
    const v = this.views.get(uid);
    if (!v || !v.alive) return;
    v.alive = false;
    const { x, y } = v.spr;
    const big = v.spr.width > 16;
    this.sparks(x, y, big ? 22 : 12, 0xffcf5a);
    this.sparks(x, y, big ? 12 : 6, 0xff5e3a);
    this.sparks(x, y, 6, hexInt(SHIPS[v.u.def].accent[0]));
    this.ring(x, y, 0xffcf5a);
    this.cameras.main.shake(big ? 140 : 80, big ? 0.007 : 0.004);
    for (const o of [v.spr, v.flame, v.barBg, v.bar, v.hpT, v.shield]) o?.destroy();
    this.layout(v.u.side);
  }

  private showResult() {
    this.setSpeed(1);
    const w = this.res.winner;
    const run = this.run;
    const title = w === 0 ? 'VICTORY' : w === 1 ? 'DEFEAT' : 'STALEMATE';
    const color = w === 0 ? C.gold : w === 1 ? C.bad : C.cyan;
    const sub = w === 0 ? `+1 WIN  (${run.wins}/${WIN_TARGET})`
      : w === 1 ? `-1 HULL  (${run.lives} LEFT)` : 'NO WIN, NO DAMAGE';

    this.add.rectangle(240, 135, 480, 270, 0x05060f, 0.55);
    panel(this, 140, 88, 200, 96);
    txt(this, 240, 104, title, { size: 16, origin: 0.5, color }).setStroke('#05060f', 4);
    txt(this, 240, 128, sub, { origin: 0.5 });
    button(this, 240, 160, 120, 20, 'CONTINUE', () => {
      this.scene.start(run.phase === 'over' ? 'gameover' : 'relic');
    }, { fill: 0x3a2a10, color: C.gold });
  }
}
