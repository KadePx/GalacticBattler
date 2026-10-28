import Phaser from 'phaser';
import { addShip, addStarfield, setPlayerSkin, syncFlame } from '../game/art';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { getOpponent } from '../game/opponents';
import { WIN_TARGET, applyResult, makeSnapshot, type Run } from '../game/run';
import { getRun, saveGhost, saveRun } from '../game/storage';
import { uploadGhost } from '../game/net';
import { C, button, panel, popup, txt } from '../game/ui';
import { OVERLOAD_TICK, hullScale, simulate, type BEvent, type BUnit, type BattleResult, kills } from '../sim/battle';
import { SHIPS } from '../sim/ships';
import { TRAITS, traitCounts, traitLevel } from '../sim/traits';
import type { Snapshot } from '../sim/types';

const TICK_MS = 150;

// Battle speed is a per-device preference, so it stays the same from battle to battle.
const SPEEDS = [1, 2, 4, 8];
const SPEED_KEY = 'starbrawl.speed';
function savedSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}
function rememberSpeed(v: number) {
  try { localStorage.setItem(SPEED_KEY, String(v)); } catch { /* ignore */ }
}
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
  popT?: number; // when its last label popped (labels stack upward)
  popN?: number;
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
  private speedObjs: Phaser.GameObjects.GameObject[] = [];

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
    this.speedObjs = [];
    this.setSpeed(savedSpeed());
    setPlayerSkin(run.skin ? run.cmd : null);
    audio.setMood('battle');
    addStarfield(this);

    // Freeze the fleet into a snapshot (this is what other players would fight),
    // find an opponent, and simulate the whole fight up front.
    const me = makeSnapshot(run);
    saveGhost(me);
    uploadGhost(me);
    this.opp = getOpponent(run);
    this.res = simulate(me, this.opp);
    for (const e of this.res.events) {
      if (!this.byTick.has(e.t)) this.byTick.set(e.t, []);
      this.byTick.get(e.t)!.push(e);
    }

    // Lock in the result now so refreshing the page can't undo a loss.
    run.lastOpponent = this.opp.name;
    applyResult(run, this.res.winner, kills(this.res, 0));
    saveRun(run);

    // Header
    panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52);
    txt(this, 8, 7, 'YOUR FLEET', { color: C.cyan });
    txt(this, 240, 7, `ROUND ${me.round}`, { origin: [0.5, 0] });
    const hull = hullScale(Math.max(me.round, this.opp.round));
    if (hull > 1) txt(this, 240, 44, `HULLS x${hull.toFixed(1)}`, { origin: [0.5, 0], color: C.hp });
    txt(this, 472, 7, this.opp.name.toUpperCase(), { origin: [1, 0], color: C.bad });
    const tag = this.opp.runId === 'bot' ? this.opp.style ?? 'RAIDER' : 'GHOST FLEET';
    txt(this, 472, 24, `${tag}  ${this.opp.wins} WIN${this.opp.wins === 1 ? '' : 'S'}`, { origin: [1, 0], color: C.dim });
    this.commanderLine(this.opp, 472, 34, 1);
    if (this.opp.relics.length) txt(this, 472, 44, `${this.opp.relics.length} RELICS`, { origin: [1, 0], color: C.dim });
    this.traitLine(me, 8, 24, 0);
    this.commanderLine(me, 8, 34, 0);
    this.traitLine(this.opp, 472, 54, 1);

    for (const u of this.res.units) this.makeView(u);
    this.layout(0, false);
    this.layout(1, false);

    // One big button that cycles speed: 1X, 2X, 4X, 8X.
    const sb = button(this, 440, 256, 64, 20, `${this.speed}X`, () => {
      const next = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length] ?? 1;
      this.setSpeed(next);
      rememberSpeed(next);
    });
    this.speedBtn = sb.label;
    this.speedObjs = sb.objects;
    txt(this, 404, 253, 'SPEED', { origin: [1, 0], color: C.faint });
    soundButton(this, 16, 256);

    const banner = txt(this, 240, 70, 'ENGAGE!', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);
    this.tweens.add({ targets: banner, alpha: 0, delay: 500, duration: 400, onComplete: () => banner.destroy() });
    this.startDelay = 700;
    audio.play('engage');
  }

  /** Commander and passive, e.g. "KAEL: SHIELD WALL". */
  private commanderLine(snap: Snapshot, x: number, y: number, side: 0 | 1) {
    const c = snap.cmd ? CMD_MAP[snap.cmd.id] : null;
    if (!c) return;
    txt(this, x, y, `${c.name}: ${c.passives[snap.cmd!.p].name}`.toUpperCase(), { origin: [side, 0], color: c.color });
  }

  /** Active synergies for a fleet, e.g. "STRIKE 2  TECH 4". */
  private traitLine(snap: Snapshot, x: number, y: number, side: 0 | 1) {
    const counts = traitCounts(snap.fleet, snap.relics);
    const active = TRAITS.filter((tr) => traitLevel(tr.id, counts[tr.id]) > 0);
    let cx = x;
    // Stay on this side of the screen: stop before reaching the middle.
    for (const tr of side === 0 ? active : [...active].reverse()) {
      const label = `${tr.short} ${counts[tr.id]}`;
      const w = label.length * 8;
      if (side === 0 ? cx + w > 228 : cx - w < 252) break;
      txt(this, cx, y, label, { origin: [side, 0], color: tr.color });
      cx += side === 0 ? w + 8 : -(w + 8);
    }
  }

  private setSpeed(s: number) {
    this.speed = s;
    this.tweens.timeScale = s;
    this.time.timeScale = s;
    if (this.speedBtn?.active) this.speedBtn.setText(`${s}X`);
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

  /** A label over a ship; several at once stack upward instead of overlapping. */
  private label(v: View, text: string, color: string) {
    const now = this.time.now;
    if (now - (v.popT ?? -1e9) > 450) v.popN = 0;
    const k = v.popN ?? 0;
    v.popN = k + 1;
    v.popT = now;
    popup(this, v.spr.x, v.spr.y - 24 - 9 * Math.min(k, 3), text, color);
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
      audio.play('overload');
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
          // A shield gained mid-battle (Architect): draw or thicken the bubble.
          if (e.sh !== undefined && e.sh > 0) {
            if (v.shield) v.shield.setStrokeStyle(e.sh > 1 ? 2 : 1, 0x7fe7ff);
            else v.shield = this.makeShield(e.sh).setPosition(v.spr.x, v.spr.y);
          }
          audio.play(e.label.startsWith('-') ? 'debuff' : 'buff');
          // Small team-wide buffs (Vengeance) just flash; named buffs get a label.
          if (/^\+\d+$/.test(e.label)) this.flash(v, 0xffd166);
          else this.label(v, e.label, e.label.startsWith('-') ? '#b8d4ff' : e.label === 'CURSED' ? '#d090ff' : C.gold);
        });
        return;
      }
      case 'cloak': {
        const v = this.views.get(e.u);
        if (!v) return;
        this.time.delayedCall(e.on ? SHOT_MS + 60 : 0, () => {
          if (!v.alive) return;
          this.tweens.add({ targets: v.spr, alpha: e.on ? 0.3 : 1, duration: 150 });
          if (e.on) {
            popup(this, v.spr.x, v.spr.y - 24, 'CLOAK', '#dcc0ff');
            audio.play('cloak');
          }
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
          audio.play('revive');
        });
        return;
      }
      case 'drag': {
        const g = this.views.get(e.s);
        const v = this.views.get(e.u);
        const before = this.views.get(e.before);
        if (!g || !v || !before) return;
        // Reorder the view list so layout() puts the dragged ship up front.
        const all = [...this.views.entries()].filter(([id]) => id !== e.u);
        const at = all.findIndex(([id]) => id === e.before);
        all.splice(at, 0, [e.u, v]);
        this.views = new Map(all);
        const hook = this.add.graphics().lineStyle(1, 0xffb347, 1).lineBetween(g.spr.x, g.spr.y, v.spr.x, v.spr.y);
        this.tweens.add({ targets: hook, alpha: 0, duration: 420, onComplete: () => hook.destroy() });
        popup(this, v.spr.x, v.spr.y - 24, 'DRAG', '#ffb347');
        audio.play('debuff');
        this.layout(v.u.side);
        return;
      }
      case 'spawn': {
        const q = this.views.get(e.s);
        const v = this.makeView(e.unit, q ? { ...q.pos } : undefined);
        const full = v.spr.scaleX;
        v.spr.setScale(full / 4);
        this.tweens.add({ targets: v.spr, scale: full, duration: 200 });
        if (e.reserve) {
          // Reserve Wing: a ship warping in from the bench.
          this.time.delayedCall(260, () => {
            if (!v.alive) return;
            this.ring(v.spr.x, v.spr.y, 0x7fe7ff);
            this.label(v, 'RESERVE!', C.cyan);
          });
        }
        audio.play('spawn', e.unit.side === 0 ? 1 : 0.8);
        this.layout(e.unit.side);
        return;
      }
      default:
        break;
    }

    const s = this.views.get(e.s);
    const d = this.views.get(e.d);
    if (!s || !d) return;

    if (e.k === 'heal' && e.s === e.d) {
      // Life-steal: green number above the ship itself.
      this.time.delayedCall(SHOT_MS, () => {
        if (!d.alive) return;
        this.setHp(d, e.hp);
        popup(this, d.spr.x, d.spr.y - 26, `+${e.amt}`, C.hp);
        this.flash(d, 0x7dff8a);
      });
      return;
    }
    if (e.k === 'heal') {
      const g = this.add.graphics().lineStyle(1, 0x7dff8a, 1).lineBetween(s.spr.x, s.spr.y, d.spr.x, d.spr.y);
      this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
      this.time.delayedCall(SHOT_MS / 2, () => {
        this.setHp(d, e.hp);
        popup(this, d.spr.x, d.spr.y - 14, `+${e.amt}`, C.hp);
        audio.play('heal');
      });
      return;
    }
    if (e.k === 'jam') {
      this.time.delayedCall(SHOT_MS, () => {
        if (!d.alive) return;
        popup(this, d.spr.x, d.spr.y - 24, 'JAM', '#b8d4ff');
        audio.play('jam');
      });
      return;
    }
    if (e.k !== 'shot') return;

    if (e.burn) {
      // After this tick's shots have landed (torpedoes are slowest), before any explosion.
      this.time.delayedCall(SHOT_MS * 1.4 + 20, () => {
        if (!d.alive) return;
        this.setHp(d, e.hp);
        popup(this, d.spr.x + 10, d.spr.y - 4, `-${e.dmg}`, '#ff8a3a');
        this.sparks(d.spr.x, d.spr.y, 2, 0xff6a00);
      });
      return;
    }
    if (e.zap) {
      // Reflector: a jagged lightning arc straight to the attacker.
      this.time.delayedCall(SHOT_MS + 20, () => {
        if (!d.alive) return;
        this.lightning(s.spr.x, s.spr.y, d.spr.x, d.spr.y, 0x3dffa8);
        audio.play('zap');
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
    const nose = { x: s.spr.x + (s.spr.displayWidth / 2) * dir, y: s.spr.y };
    if (e.ram) popup(this, s.spr.x, s.spr.y - 24, s.u.def === 'interceptor' ? 'RAM!' : 'BOOM!', C.atk);
    else {
      this.tweens.add({ targets: s.pos, x: s.pos.x - 3 * dir, duration: 50, yoyo: true });
      const m = this.add.image(nose.x, nose.y, 'px').setScale(2).setTint(0xffffff);
      this.tweens.add({ targets: m, scale: 4, alpha: 0, duration: 90, onComplete: () => m.destroy() });
    }
    const isTorp = s.u.def === 'torpedo' || s.u.def === 'siege' || !!e.ram;
    // Enemy guns sound a little lower than yours.
    audio.play(e.ram ? 'ram' : isTorp ? 'torpedo' : 'laser', side === 0 ? 1 : 0.78);
    const proj = isTorp
      ? this.add.image(nose.x, nose.y, `torp_${side}`).setScale(2)
      : this.add.image(nose.x, nose.y, 'bolt').setScale(2).setTint(accent);
    proj.setRotation(Phaser.Math.Angle.Between(nose.x, nose.y, d.spr.x, d.spr.y) - (side === 1 && isTorp ? Math.PI : 0));
    this.tweens.add({
      targets: proj, x: d.spr.x, y: d.spr.y, duration: isTorp ? SHOT_MS * 1.4 : SHOT_MS,
      onComplete: () => {
        proj.destroy();
        if (!d.alive) return;
        if (e.miss) {
          popup(this, d.spr.x, d.spr.y - 14, 'MISS', '#ffffff');
          return;
        }
        if (e.blocked) {
          popup(this, d.spr.x, d.spr.y - 14, 'BLOCK', C.cyan);
          audio.play('block');
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
        audio.play('hit', d.u.side === 0 ? 0.85 : 1);
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
    const big = v.spr.displayWidth > 32;
    this.sparks(x, y, big ? 22 : 12, 0xffcf5a);
    this.sparks(x, y, big ? 12 : 6, 0xff5e3a);
    this.sparks(x, y, 6, hexInt(SHIPS[v.u.def].accent[0]));
    this.ring(x, y, 0xffcf5a);
    this.cameras.main.shake(big ? 140 : 80, big ? 0.007 : 0.004);
    audio.play(big ? 'boom' : 'explode');
    for (const o of [v.spr, v.flame, v.barBg, v.bar, v.hpT, v.shield]) o?.destroy();
    this.layout(v.u.side);
  }

  private showResult() {
    this.setSpeed(1);
    const w = this.res.winner;
    const run = this.run;
    const title = w === 0 ? 'VICTORY' : w === 1 ? 'DEFEAT' : 'STALEMATE';
    const color = w === 0 ? C.gold : w === 1 ? C.bad : C.cyan;
    audio.play(w === 0 ? 'victory' : w === 1 ? 'defeat' : 'draw');
    const sub = w === 0 ? (run.endless ? `+1 WIN  (${run.wins} TOTAL)` : `+1 WIN  (${run.wins}/${WIN_TARGET})`)
      : w === 1 ? `-1 HULL  (${run.lives} LEFT)` : 'NO WIN, NO DAMAGE';

    // Result bar along the bottom, so the surviving ships stay visible.
    this.speedBtn?.destroy();
    this.speedObjs.forEach((o) => o.destroy());
    panel(this, 60, 206, 360, 56, 0x0a0e22, 0x3a4a7a).setDepth(50);
    txt(this, 72, 216, title, { size: 16, color }).setStroke('#05060f', 4).setDepth(51);
    txt(this, 72, 240, sub, { color: C.text }).setDepth(51);
    button(this, 352, 234, 112, 22, 'CONTINUE', () => {
      this.scene.start(run.phase === 'over' ? 'gameover' : 'relic');
    }, { fill: 0x3a2a10, color: C.gold }).objects.forEach((o) => (o as Phaser.GameObjects.Rectangle).setDepth(51));
  }
}
