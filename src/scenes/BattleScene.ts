import Phaser from 'phaser';
import { addShip, addStarfield, setPlayerSkin, syncFlame } from '../game/art';
import { CMD_MAP } from '../sim/commanders';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { getOpponent } from '../game/opponents';
import { WIN_TARGET, applyResult, makeSnapshot, type Run } from '../game/run';
import { getRun, saveGhost, saveRun } from '../game/storage';
import { reportGhostFight, uploadGhost } from '../game/net';
import { buildReport, type BattleReport } from '../game/report';
import { saveLastFleet } from '../game/share';
import { sceneFor } from './MenuScene';
import { C, button, panel, popup, txt } from '../game/ui';
import { OVERLOAD_TICK, hullScale, simulate, type BEvent, type BUnit, type BattleResult, kills } from '../sim/battle';
import { SHIPS, isBoss } from '../sim/ships';
import { BOSS_INFO } from '../game/gauntlet';
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
  barW: number; // HP bar width (bosses get a long one)
}

/** A friendly fight against a shared fleet: no run, no rewards, no ghost upload. */
export interface Duel { me: Snapshot; opp: Snapshot }

export class BattleScene extends Phaser.Scene {
  private run: Run | null = null;
  private duel: Duel | null = null;
  private report!: BattleReport;
  private reportObjs: Phaser.GameObjects.GameObject[] = [];
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
  private skipObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('battle');
  }

  create(data?: { duel?: Duel }) {
    this.duel = data?.duel ?? null;
    const run = this.duel ? null : getRun();
    if (!run && !this.duel) {
      this.scene.start('menu');
      return;
    }
    this.run = run;
    this.reportObjs = [];
    this.skipObjs = [];
    this.views.clear();
    this.byTick.clear();
    this.t = 0;
    this.acc = 0;
    this.started = false;
    this.done = false;
    this.speedBtn = undefined; // the old button was destroyed with the previous battle
    this.speedObjs = [];
    this.setSpeed(savedSpeed());
    setPlayerSkin(run?.skin ? run.cmd ?? null : null);
    audio.setMood('battle');
    addStarfield(this);

    // Freeze the fleet into a snapshot (this is what other players would fight),
    // find an opponent, and simulate the whole fight up front.
    let me: Snapshot;
    let gid: number | undefined;
    if (run) {
      me = makeSnapshot(run);
      // Gauntlet fleets carry boss relics, so they stay out of the normal ghost pools.
      if (!run.gauntlet) {
        saveGhost(me);
        uploadGhost(me);
      }
      saveLastFleet(me);
      this.opp = getOpponent(run);
      // An online player's fleet: report how it went, so its owner sees it.
      if (!run.daily && run.nextOpp && run.nextOpp.round === run.round) gid = run.nextOppGid;
    } else {
      me = this.duel!.me;
      this.opp = this.duel!.opp;
    }
    this.res = simulate(me, this.opp);
    this.report = buildReport(this.res);
    if (gid) reportGhostFight(gid, this.res.winner);
    for (const e of this.res.events) {
      if (!this.byTick.has(e.t)) this.byTick.set(e.t, []);
      this.byTick.get(e.t)!.push(e);
    }

    // Lock in the result now so refreshing the page can't undo a loss.
    if (run) {
      run.lastOpponent = this.opp.name;
      applyResult(run, this.res.winner, kills(this.res, 0));
      saveRun(run);
    }

    // Header
    panel(this, 0, 0, 480, 20, 0x0a0e22, 0x232c52);
    txt(this, 8, 7, 'YOUR FLEET', { color: C.cyan });
    txt(this, 240, 7, this.duel ? 'FRIENDLY DUEL' : run?.daily ? `DAILY  ROUND ${me.round}` : run?.gauntlet ? `GAUNTLET  ROUND ${me.round}` : `ROUND ${me.round}`, { origin: [0.5, 0] });
    const hull = hullScale(Math.max(me.round, this.opp.round));
    if (hull > 1) txt(this, 240, 44, `HULLS x${hull.toFixed(1)}`, { origin: [0.5, 0], color: C.hp });
    txt(this, 472, 7, this.opp.name.toUpperCase(), { origin: [1, 0], color: C.bad });
    const tag = this.opp.runId === 'bot' ? this.opp.style ?? 'RAIDER' : this.opp.runId === 'shared' ? 'SHARED FLEET' : 'GHOST FLEET';
    const wasBoss = !!run?.gauntlet && this.opp.style === 'BOSS';
    txt(this, 472, 24, wasBoss ? 'SECTOR BOSS' : `${tag}  ${this.opp.wins} WIN${this.opp.wins === 1 ? '' : 'S'}`, { origin: [1, 0], color: wasBoss ? C.bad : C.dim });
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
    // Skip: play out the rest of the fight very fast (doesn't change your saved speed).
    const skip = button(this, 320, 256, 56, 20, 'SKIP', () => {
      this.setSpeed(32);
      this.skipObjs.forEach((o) => o.destroy());
    });
    this.skipObjs = skip.objects;
    soundButton(this, 16, 256);

    // (The result is already applied, so read the boss from the opponent, not the run.)
    const bossDef = this.opp.style === 'BOSS' ? this.opp.fleet.find((f) => f && isBoss(f.def))?.def : undefined;
    const bossFight = !!bossDef;
    const banner = txt(this, 240, 70, bossDef ? `BOSS: ${BOSS_INFO[bossDef].title}` : 'ENGAGE!',
      { size: bossFight ? 12 : 16, origin: 0.5, color: bossFight ? C.bad : C.gold }).setStroke('#05060f', 4);
    if (bossFight) {
      const tip = txt(this, 240, 86, BOSS_INFO[bossDef!].tip, { origin: 0.5, color: C.text, wrap: 400, align: 'center' }).setStroke('#05060f', 3);
      this.tweens.add({ targets: tip, alpha: 0, delay: 2200, duration: 500, onComplete: () => tip.destroy() });
    }
    this.tweens.add({ targets: banner, alpha: 0, delay: bossFight ? 1600 : 500, duration: 400, onComplete: () => banner.destroy() });
    this.startDelay = bossFight ? 1800 : 700;
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
    const counts = traitCounts(snap.fleet, snap.relics, snap.salute);
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
    const barW = isBoss(u.def) ? 70 : 24;
    const barBg = this.add.rectangle(0, 0, barW + 2, isBoss(u.def) ? 5 : 4, 0x1a0a10).setOrigin(0, 0.5);
    const bar = this.add.rectangle(0, 0, barW, isBoss(u.def) ? 3 : 2, u.side === 0 ? 0x7dff8a : 0xff5e7e).setOrigin(0, 0.5);
    const hpT = txt(this, 0, 0, `${u.hp}`, { origin: 0.5, color: C.text });
    const shield = u.shield > 0 ? this.makeShield(u.shield, u.def) : null;
    if (u.cloak) spr.setAlpha(0.3);
    const v: View = {
      u: { ...u }, pos: { x: from?.x ?? 0, y: from?.y ?? 0 }, phase: Math.random() * Math.PI * 2,
      spr, flame, barBg, bar, hpT, shield, alive: true, barW,
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
    popup(this, v.spr.x, v.spr.y - v.spr.displayHeight / 2 - 14 - 9 * Math.min(k, 3), text, color);
  }

  private makeShield(n: number, def = '') {
    const big = isBoss(def);
    return this.add.ellipse(0, 0, big ? 90 : 44, big ? 60 : 32).setStrokeStyle(n > 1 ? 2 : 1, 0x7fe7ff).setFillStyle(0x7fe7ff, 0.1);
  }

  /** Every frame: move sprites to their tweened base position plus a gentle idle bob. */
  private syncViews(time: number) {
    for (const v of this.views.values()) {
      if (!v.alive) continue;
      const { x, y } = v.pos;
      v.spr.setPosition(Math.round(x), Math.round(y + Math.sin(time * 0.003 + v.phase) * 1.5));
      syncFlame(v.spr, v.flame, v.u.side);
      const below = isBoss(v.u.def) ? v.spr.displayHeight / 2 + 6 : 20;
      v.barBg.setPosition(x - v.barW / 2 - 1, y + below);
      v.bar.setPosition(x - v.barW / 2, y + below);
      v.hpT.setPosition(x, y + below + 8);
      v.shield?.setPosition(v.spr.x, v.spr.y);
    }
  }

  private layout(side: number, animate = true) {
    const line = [...this.views.values()].filter((v) => v.alive && v.u.side === side);
    // A boss holds the middle of its side; everything else flies in rows above and below it.
    const boss = line.find((v) => isBoss(v.u.def));
    const others = line.filter((v) => v !== boss);
    const place = (v: View, p: { x: number; y: number }) => {
      if (animate) this.tweens.add({ targets: v.pos, x: p.x, y: p.y, duration: 260, ease: 'Quad.easeOut' });
      else { v.pos.x = p.x; v.pos.y = p.y; }
    };
    if (boss) {
      const dir = side === 0 ? -1 : 1;
      place(boss, { x: 240 + dir * 128, y: 142 });
      const cols = Math.max(1, Math.ceil(others.length / 2));
      const step = Math.min(36, Math.floor(196 / cols));
      others.forEach((v, i) => place(v, { x: 240 + dir * (30 + Math.floor(i / 2) * step), y: 142 + (i % 2 ? 50 : -50) }));
      return;
    }
    line.forEach((v, i) => {
      const p = this.pos(side, i, line.length);
      if (animate) this.tweens.add({ targets: v.pos, x: p.x, y: p.y, duration: 260, ease: 'Quad.easeOut' });
      else { v.pos.x = p.x; v.pos.y = p.y; }
    });
  }

  private setHp(v: View, hp: number) {
    if (!v.alive || !v.hpT.active) return;
    v.u.hp = hp;
    v.bar.width = Math.max(0, Math.round((v.barW * hp) / v.u.maxHp));
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
    let sub: string;
    const g = run?.gauntlet;
    const bossFight = this.opp.style === 'BOSS';
    if (!run) sub = w === 0 ? 'YOUR FLEET WINS THE DUEL' : w === 1 ? 'THEIR FLEET WINS THE DUEL' : 'NOBODY WINS';
    else if (g && bossFight) sub = w === 0 ? `BOSS DESTROYED  (${g.beaten}/3)` : `-2 HULL (${run.lives} LEFT), REMATCH NEXT`;
    else if (g) sub = w === 0 ? 'SECTOR BATTLE WON' : w === 1 ? `-1 HULL  (${run.lives} LEFT)` : 'NO WIN, NO DAMAGE';
    else sub = w === 0 ? (run.endless ? `+1 WIN  (${run.wins} TOTAL)` : `+1 WIN  (${run.wins}/${WIN_TARGET})`)
      : w === 1 ? `-1 HULL  (${run.lives} LEFT)` : 'NO WIN, NO DAMAGE';

    // Result bar along the bottom, so the surviving ships stay visible.
    this.speedBtn?.destroy();
    this.speedObjs.forEach((o) => o.destroy());
    this.skipObjs.forEach((o) => o.destroy());
    const depth = (o: Phaser.GameObjects.GameObject) => (o as Phaser.GameObjects.Rectangle).setDepth(51);
    panel(this, 40, 196, 400, 68, 0x0a0e22, 0x3a4a7a).setDepth(50);
    txt(this, 52, 204, title, { size: 16, color }).setStroke('#05060f', 4).setDepth(51);
    txt(this, 52, 226, sub, { color: C.text }).setDepth(51);
    txt(this, 52, 240, this.report.headline, { color: w === 1 ? '#ffb0a0' : C.dim, wrap: 250 }).setDepth(51);
    button(this, 372, 212, 112, 18, 'REPORT', () => this.toggleReport()).objects.forEach(depth);
    button(this, 372, 240, 112, 22, 'CONTINUE', () => {
      if (!run) this.scene.start('challenge');
      else this.scene.start(sceneFor(run.phase));
    }, { fill: 0x3a2a10, color: C.gold }).objects.forEach(depth);
  }

  /** Damage, healing and shields for both sides, over the battlefield. */
  private toggleReport() {
    if (this.reportObjs.length) {
      this.reportObjs.forEach((o) => o.destroy());
      this.reportObjs = [];
      return;
    }
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(60);
      this.reportObjs.push(o);
      return o;
    };
    add(this.add.rectangle(240, 98, 480, 196, 0x05060f, 0.6).setInteractive().on('pointerup', () => this.toggleReport()));
    add(panel(this, 40, 22, 400, 170, 0x0a0e22, 0x3a4a7a));
    add(txt(this, 52, 30, 'BATTLE REPORT', { color: C.gold }));
    add(txt(this, 428, 30, 'TAP TO CLOSE', { origin: [1, 0], color: C.faint }));
    const [me, them] = this.report.sides;
    const cols = [250, 370];
    add(txt(this, cols[0], 46, 'YOU', { origin: [1, 0], color: C.cyan }));
    add(txt(this, cols[1], 46, 'THEM', { origin: [1, 0], color: C.bad }));
    const rows: [string, number, number][] = [
      ['DAMAGE DEALT', me.damage, them.damage],
      ['HEALING', me.healed, them.healed],
      ['HITS SHIELDED', me.blocked, them.blocked],
      ['HITS DODGED', me.dodged, them.dodged],
      ['SHIPS LOST', me.lost, them.lost],
    ];
    rows.forEach(([label, a, b], i) => {
      const y = 58 + i * 12;
      add(txt(this, 52, y, label, { color: C.dim }));
      add(txt(this, cols[0], y, String(a), { origin: [1, 0] }));
      add(txt(this, cols[1], y, String(b), { origin: [1, 0] }));
    });
    add(txt(this, 52, 122, 'TOP GUNS', { color: C.gold }));
    for (const [side, x] of [[0, 52], [1, 248]] as const) {
      const s = this.report.sides[side];
      s.top.forEach((t, i) => add(txt(this, x, 134 + i * 11, `${t.name.toUpperCase()} ${t.dmg}`, { color: side === 0 ? C.cyan : '#ffb0a0' })));
      if (!s.top.length) add(txt(this, x, 134, 'NO DAMAGE', { color: C.faint }));
    }
    const fl = me.firstLoss;
    add(txt(this, 52, 172, fl ? `FIRST LOSS: YOUR ${fl.name.toUpperCase()} AT TICK ${fl.tick}, BY ${fl.by.toUpperCase()}` : 'YOU LOST NO SHIPS',
      { color: fl ? C.dim : C.hp, wrap: 380 }));
  }
}
