// The colony map, drawn with PixiJS. Ground is one baked texture; built things and natural
// features are vector Graphics per 8x8 chunk, redrawn only when that chunk changes; colonists
// are small reusable figures moved every frame. The view only ever reads the colony.

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { cellCode, cells } from '../sim/data/buildings';
import { stage } from '../sim/pawn';
import { B, F, type Bld, type Colony, type Id, type Pawn } from '../sim/types';
import { FOE_SIZE, STAGE_SIZE, drawBubble, drawFigure, drawFoe, drawMark, figureKey } from './figures';
import { SHAPE, yearsAt } from './look';
import { TS, bakeTerrain, blanketColor, drawFeatures, drawStructs, lightOf, paletteAt, type Pal } from './tiles';

/** Chunk size in tiles. */
const CH = 8;
/** People are drawn a little larger than life so they stand out against the furniture. */
const FIG = 1.3;

/** A raider or beast, as far as the view needs to know (the sim's Foe has more). */
interface FoeLike { id: number; k: string; x: number; y: number; px: number; py: number }
const OPEN_AIR = new Set(['well', 'field', 'graveyard']);

interface Chunk { x0: number; y0: number; x1: number; y1: number; st: Graphics; ground: Graphics; canopy: Graphics; sigS: number; sigF: number }

interface PawnView {
  id: Id;
  root: Container;
  fig: Graphics;
  blanket: Graphics;
  over: Container;
  bubble: Graphics;
  mark: Graphics;
  label: Text;
  key: string;
  keyTick: number;
  bubbleKey: string;
  markKey: string;
  blanketKey: number;
  /** world pixels */
  x: number; y: number;
  tile: number;
  size: number;
  asleep: boolean;
  stamp: number;
}

/** What a click on the map landed on. */
export interface Pick { pawn?: Id; bld?: number; grave?: number; tile: number }

// Sky colour through the day: [hour, r, g, b, darkness]. Night is a dark blue you can still read.
const SKY: number[][] = [
  [0, 0.42, 0.48, 0.8, 1], [4.6, 0.42, 0.48, 0.8, 1], [5.6, 0.62, 0.58, 0.78, 0.7], [6.5, 1, 0.84, 0.74, 0.25], [7.5, 1, 1, 1, 0],
  [17.5, 1, 1, 1, 0], [18.6, 1, 0.86, 0.7, 0.15], [19.6, 0.86, 0.62, 0.66, 0.5], [21, 0.42, 0.48, 0.8, 1], [24, 0.42, 0.48, 0.8, 1],
];
// How each kind of weather dims and colours the light: [r, g, b, extra darkness, veil]
const WX: number[][] = [[1, 1, 1, 0, 0], [0.93, 0.94, 0.96, 0.03, 0.02], [0.82, 0.86, 0.92, 0.1, 0.06], [0.64, 0.68, 0.78, 0.28, 0.1], [0.95, 0.97, 1, 0.03, 0.1], [0.92, 0.94, 0.95, 0.06, 0.28]];

export class MapView {
  app = new Application();
  cam = new Container();
  /** Screen space covered by panels, so focusing centres in the part of the map you can see. */
  inset = { left: 0, right: 0, top: 0, bottom: 0 };
  onPick: (hit: Pick) => void = () => {};
  /** The user dragged or zoomed the map by hand. */
  onUserMove: () => void = () => {};
  selected: Id = 0;
  followId: Id = 0;
  /** The colonist this browser made: always marked and named, 0 for none. */
  mineId: Id = 0;

  private c!: Colony;
  private mw = 0;
  private mh = 0;
  private terCv = document.createElement('canvas');
  private terTex!: Texture;
  private structLayer = new Container();
  private groundLayer = new Container();
  private pawnLayer = new Container();
  private canopyLayer = new Container();
  private night = new Graphics();
  private lightLayer = new Container();
  private overLayer = new Container();
  private bldSel = new Graphics();
  private ring = new Graphics();
  private mineMark = new Graphics();
  private wxLayer = new Container();
  private fog = new Graphics();
  private flashG = new Graphics();
  private labelLayer = new Container();
  private chunks: Chunk[] = [];
  private views = new Map<Id, PawnView>();
  private foeViews = new Map<number, { g: Graphics; stamp: number }>();
  private blds = new Map<number, Bld>();
  private plan = new Uint8Array(0);
  private fires: { x: number; y: number; r: number }[] = [];
  private lights: Sprite[] = [];
  private glowTex!: Texture;
  private drops: { s: Sprite; x: number; y: number; v: number }[] = [];
  private rainTex!: Texture;
  private snowTex!: Texture;
  private wxKind = -1;
  private pal: Pal | null = null;
  private terSig = 0;
  private lastTick = -1;
  private lastCheck = -1e9;
  private time = 0;
  private stamp = 0;
  private fitScale = 1;
  private sky = [1, 1, 1, 0, 0];
  private flash = 0;
  private selBld = 0;
  private ovW = 0;
  private ovH = 0;
  private anim: { x: number; y: number; s: number; fx: number; fy: number; fs: number; t: number } | null = null;
  private pos = { x: 0, y: 0, moving: false };

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      antialias: true,
      background: '#0a0d14',
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    parent.appendChild(this.app.canvas);
    this.glowTex = Texture.from(glowCanvas());
    this.rainTex = Texture.from(rainCanvas());
    this.snowTex = Texture.from(glowCanvas(12, 0.9));
    this.pawnLayer.sortableChildren = true;
    this.canopyLayer.alpha = 0.9;
    this.night.blendMode = 'multiply';
    // the ring under the selected colonist is drawn once and moved around
    this.ring.ellipse(0, 0, 10, 7).stroke({ width: 2, color: 0x7c8cff });
    this.ring.ellipse(0, 0, 13, 9.4).stroke({ width: 1, color: 0x7c8cff, alpha: 0.4 });
    this.ring.visible = false;
    // my own colonist wears a small accent marker overhead that never hides
    this.mineMark.poly([-5, -7, 5, -7, 0, 0]).fill(0x7c8cff).stroke({ width: 1.5, color: 0xffffff });
    this.mineMark.visible = false;
    this.fog.visible = false;
    this.wxLayer.addChild(this.fog, this.flashG);
    this.app.stage.addChild(this.cam, this.wxLayer, this.labelLayer);
    this.bindInput();
    new ResizeObserver(() => { this.sizeOverlays(); if (this.c) this.clamp(); }).observe(parent);
  }

  /** Point the view at a colony (a new one, or the same one after a big jump in time). */
  setColony(c: Colony): void {
    this.c = c;
    this.mw = c.w * TS;
    this.mh = c.h * TS;
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    for (const f of this.foeViews.values()) f.g.destroy();
    this.foeViews.clear();
    this.cam.removeChildren();
    for (const l of [this.structLayer, this.groundLayer, this.canopyLayer]) for (const ch of l.removeChildren()) ch.destroy();
    this.terCv.width = this.mw;
    this.terCv.height = this.mh;
    this.terTex?.destroy(true);
    this.terTex = Texture.from(this.terCv);
    this.plan = new Uint8Array(c.w * c.h);
    this.chunks = [];
    for (let y = 0; y < c.h; y += CH) {
      for (let x = 0; x < c.w; x += CH) {
        const ch: Chunk = { x0: x, y0: y, x1: Math.min(c.w, x + CH), y1: Math.min(c.h, y + CH), st: new Graphics(), ground: new Graphics(), canopy: new Graphics(), sigS: -1, sigF: -1 };
        this.structLayer.addChild(ch.st);
        this.groundLayer.addChild(ch.ground);
        this.canopyLayer.addChild(ch.canopy);
        this.chunks.push(ch);
      }
    }
    this.night.clear().rect(0, 0, this.mw, this.mh).fill(0xffffff);
    this.overLayer.addChild(this.ring, this.mineMark);
    this.cam.addChild(new Sprite(this.terTex), this.structLayer, this.groundLayer, this.bldSel, this.pawnLayer, this.canopyLayer, this.night, this.lightLayer, this.overLayer);
    this.pal = null;
    this.selectBld(this.selBld);
    this.refreshStatic(true);
    this.sizeOverlays();
    this.home();
  }

  /** Redraw everything static now (after a fast-forward, say). */
  refresh(): void {
    if (this.c) this.refreshStatic(true);
  }

  // ---------- Per frame ----------

  /** Draw the colony as it stands at fractional tick `tf`. `dt` is real milliseconds since last frame. */
  render(c: Colony, tf: number, dt: number): void {
    if (c !== this.c) this.setColony(c);
    this.time += dt;
    this.refreshStatic(false);
    this.syncPawns(tf);
    this.syncFoes(tf);
    this.stepCamera(dt);
    this.cull();
    this.lighting(tf, dt);
    this.weather(dt);
  }

  /** Check what changed on the map and redraw only that. Cheap enough to run several times a second. */
  private refreshStatic(force: boolean): void {
    const c = this.c;
    if (!force && (c.tick === this.lastTick || this.time - this.lastCheck < 140)) return;
    this.lastTick = c.tick;
    this.lastCheck = this.time;
    const pal = paletteAt(c.tick);
    const palChanged = !this.pal || this.pal.key !== pal.key;
    this.pal = pal;

    let h = 2166136261;
    for (let i = 0; i < c.ter.length; i++) h = Math.imul(h ^ c.ter[i], 16777619);
    if (force || palChanged || h !== this.terSig) {
      this.terSig = h;
      bakeTerrain(c, this.terCv, pal);
      this.terTex.source.update();
    }

    // What is planned but not yet built: the cells of unfinished buildings past their progress.
    this.plan.fill(0);
    this.blds.clear();
    for (const b of c.blds) {
      this.blds.set(b.id, b);
      if (b.built) continue;
      const list = cells(b.k);
      for (let k = Math.floor(b.prog * list.length); k < list.length; k++) {
        const code = cellCode(b.k, list[k].ch, b.mat);
        if (code) this.plan[(b.y + list[k].dy) * c.w + b.x + list[k].dx] = code;
      }
    }

    let fireDirty = force;
    for (const ch of this.chunks) {
      let s = pal.key + 7;
      let f = pal.key + 7;
      // walls join up with their neighbours, so the signature looks one tile past the chunk edge
      for (let y = Math.max(0, ch.y0 - 1); y < Math.min(c.h, ch.y1 + 1); y++) {
        for (let x = Math.max(0, ch.x0 - 1); x < Math.min(c.w, ch.x1 + 1); x++) {
          const i = y * c.w + x;
          const v = c.crop[i];
          s = Math.imul(s ^ (c.st[i] | ((v === 0 ? 0 : v >= 200 ? 6 : 1 + Math.floor(v / 40)) << 8) | (this.plan[i] << 12)), 16777619);
        }
      }
      for (let y = ch.y0; y < ch.y1; y++) {
        for (let x = ch.x0; x < ch.x1; x++) {
          const i = y * c.w + x;
          const ft = c.feat[i];
          const fb = ft === F.BUSH ? (c.fg[i] >= 60 ? 1 : 0) : ft === F.TREE || ft === F.PINE || ft === F.SAPLING ? Math.floor(c.fg[i] / 20) : 0;
          f = Math.imul(f ^ (ft | (fb << 4)), 16777619);
        }
      }
      if (force || s !== ch.sigS) { ch.sigS = s; drawStructs(c, ch.st, ch.x0, ch.y0, ch.x1, ch.y1, this.plan, this.blds, pal); fireDirty = true; }
      if (force || f !== ch.sigF) { ch.sigF = f; drawFeatures(c, ch.ground, ch.canopy, ch.x0, ch.y0, ch.x1, ch.y1, pal); }
    }
    if (fireDirty) {
      this.fires = [];
      for (let i = 0; i < c.st.length; i++) {
        const r = lightOf(c.st[i]);
        if (r) this.fires.push({ x: ((i % c.w) + 0.5) * TS, y: (Math.floor(i / c.w) + 0.5) * TS, r });
      }
    }
  }

  /** Where a colonist is at fractional tick tf, part-way between tiles while walking. */
  private place(p: Pawn, tf: number): void {
    const a = p.act;
    const W = this.c.w;
    const o = this.pos;
    if (a.path && a.path.length > 1 && tf < a.ta && a.ta > a.t0) {
      const f = Math.max(0, (tf - a.t0) / (a.ta - a.t0)) * (a.path.length - 1);
      const i = Math.min(a.path.length - 2, Math.floor(f));
      const u = f - i;
      const x0 = a.path[i] % W;
      const y0 = (a.path[i] - x0) / W;
      const x1 = a.path[i + 1] % W;
      const y1 = (a.path[i + 1] - x1) / W;
      o.x = (x0 + (x1 - x0) * u + 0.5) * TS;
      o.y = (y0 + (y1 - y0) * u + 0.5) * TS;
      o.moving = true;
    } else {
      o.x = (a.tx + 0.5) * TS;
      o.y = (a.ty + 0.5) * TS;
      o.moving = false;
    }
  }

  private makeView(p: Pawn): PawnView {
    const root = new Container();
    const fig = new Graphics();
    const blanket = new Graphics();
    blanket.visible = false;
    root.addChild(fig, blanket);
    const over = new Container();
    const bubble = new Graphics();
    const mark = new Graphics();
    bubble.visible = false;
    mark.visible = false;
    over.addChild(mark, bubble);
    const label = new Text({
      text: p.first,
      resolution: 2,
      style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, fontWeight: '600', fill: 0xeef1f7, stroke: { color: 0x0a0d14, width: 3, join: 'round' } },
    });
    label.anchor.set(0.5, 0);
    this.pawnLayer.addChild(root);
    this.overLayer.addChild(over);
    this.labelLayer.addChild(label);
    const v: PawnView = { id: p.id, root, fig, blanket, over, bubble, mark, label, key: '', keyTick: -1, bubbleKey: '', markKey: '', blanketKey: -1, x: 0, y: 0, tile: 0, size: 1, asleep: false, stamp: 0 };
    this.views.set(p.id, v);
    return v;
  }

  private dropView(v: PawnView): void {
    v.root.destroy({ children: true });
    v.over.destroy({ children: true });
    v.label.destroy();
  }

  private syncPawns(tf: number): void {
    const c = this.c;
    const stamp = ++this.stamp;
    const s = this.cam.scale.x;
    const overScale = Math.max(0.7, Math.min(2.2, 0.95 / s));
    const showNames = s >= 1.15;
    let sel: PawnView | undefined;
    let mine: PawnView | undefined;
    for (const p of c.pawns) {
      const v = this.views.get(p.id) ?? this.makeView(p);
      v.stamp = stamp;

      // Appearance changes rarely (growing up, going grey): check once per tick, redraw on change.
      if (v.keyTick !== c.tick) {
        v.keyTick = c.tick;
        const st = stage(c, p);
        const spec = { race: p.race, look: p.look, sex: p.sex, stage: st, years: yearsAt(p.born, c.tick) };
        const key = figureKey(spec);
        if (key !== v.key) {
          v.key = key;
          v.size = Math.max(0.55, (SHAPE[p.race]?.size ?? 1) * STAGE_SIZE[st] * FIG);
          drawFigure(v.fig, spec);
          v.fig.scale.set(v.size);
        }
      }

      this.place(p, tf);
      const moving = this.pos.moving;
      const tx = Math.floor(this.pos.x / TS);
      const ty = Math.floor(this.pos.y / TS);
      v.tile = ty * c.w + tx;
      const asleep = !moving && p.act.k === 'sleep';
      const st = c.st[v.tile];
      const inBed = asleep && (st === B.BED || st === B.COT);
      v.asleep = asleep;
      // A small steady offset per person so people sharing a tile do not hide each other.
      v.x = this.pos.x + (inBed ? 0 : (((p.id * 37) % 9) - 4) * 0.9);
      v.y = this.pos.y + (inBed ? 0 : (((p.id * 53) % 7) - 3) * 0.8);
      v.root.position.set(v.x, v.y);
      v.root.zIndex = v.y;

      if (inBed) {
        // lying in bed, head on the pillow, under that bed's blanket
        v.fig.rotation = 0;
        v.fig.position.set(0, -2);
        if (v.blanketKey !== v.tile) {
          v.blanketKey = v.tile;
          v.blanket.clear().roundRect(-7.5, -1.5, 15, 11, 1.5).fill(blanketColor(v.tile)).rect(-7.5, -1.5, 15, 2).fill({ color: 0xffffff, alpha: 0.25 });
        }
      } else if (asleep) {
        v.fig.rotation = Math.PI / 2; // asleep on the ground
        v.fig.position.set(0, 2);
      } else {
        v.fig.rotation = 0;
        const bob = moving ? -Math.abs(Math.sin(this.time * 0.011 + p.id)) * 1.7 : p.act.k === 'work' ? Math.sin(this.time * 0.007 + p.id) * 0.6 : 0;
        v.fig.position.set(0, bob * v.size);
      }
      v.blanket.visible = inBed;

      // Marks and speech bubbles float above the head, on top of the night shading.
      const markKey = asleep ? 'z' : p.brk ? 'break' : p.insp && p.insp[1] > c.tick ? 'star' : '';
      if (markKey !== v.markKey) {
        v.markKey = markKey;
        v.mark.visible = !!markKey;
        if (markKey) drawMark(v.mark, markKey);
      }
      if (markKey === 'z') v.mark.position.set(6, -3 + Math.sin(this.time * 0.003 + p.id) * 1.6);
      else v.mark.position.set(0, -5);
      const say = p.say;
      const age = say ? tf - say[2] : 99;
      const talking = !!say && age > -1.5 && age < TICKS_PER_HOUR;
      if (talking && say) {
        const bk = say[0] + say[3];
        if (bk !== v.bubbleKey) { v.bubbleKey = bk; drawBubble(v.bubble, say[0], !!say[3]); }
        v.bubble.alpha = age > TICKS_PER_HOUR - 2 ? Math.max(0, (TICKS_PER_HOUR - age) / 2) : 1;
        v.bubble.position.set(0, markKey && markKey !== 'z' ? -12 : 0);
      }
      v.bubble.visible = talking;
      v.over.position.set(v.x, v.y - (asleep ? 6 : 10 * v.size + 2));
      v.over.scale.set(overScale);

      const isSel = p.id === this.selected;
      if (isSel) sel = v;
      if (p.id === this.mineId) mine = v;
      v.label.visible = showNames || isSel || p.id === this.followId || p.id === this.mineId;
    }
    for (const [id, v] of this.views) {
      if (v.stamp !== stamp) { this.dropView(v); this.views.delete(id); }
    }
    this.mineMark.visible = !!mine;
    if (mine) {
      this.mineMark.position.set(mine.x, mine.y - (mine.asleep ? 12 : 12 * mine.size + 4) - Math.abs(Math.sin(this.time * 0.004)) * 2 - (mine.bubble.visible ? 18 * overScale : 0));
      this.mineMark.scale.set(Math.max(0.8, overScale));
    }
    this.ring.visible = !!sel;
    if (sel) {
      this.ring.position.set(sel.x, sel.y + 4 * sel.size);
      this.ring.scale.set(Math.max(0.6, sel.size) * (1 + Math.sin(this.time * 0.005) * 0.06));
    }
  }

  /** Raiders and beasts, if any are about. They glide from where they were a tick ago. */
  private syncFoes(tf: number): void {
    const foes = (this.c as unknown as { foes?: FoeLike[] }).foes;
    if (!foes?.length && !this.foeViews.size) return;
    const stamp = this.stamp;
    const u = Math.max(0, Math.min(1, tf - Math.floor(tf)));
    for (const f of foes ?? []) {
      let v = this.foeViews.get(f.id);
      if (!v) {
        v = { g: new Graphics(), stamp };
        drawFoe(v.g, f.k);
        v.g.scale.set((FOE_SIZE[f.k] ?? 1) * FIG);
        this.pawnLayer.addChild(v.g);
        this.foeViews.set(f.id, v);
      }
      v.stamp = stamp;
      const x = (f.px + (f.x - f.px) * u + 0.5) * TS;
      const y = (f.py + (f.y - f.py) * u + 0.5) * TS;
      v.g.position.set(x, y - Math.abs(Math.sin(this.time * 0.011 + f.id)) * 1.5);
      v.g.zIndex = y;
    }
    for (const [id, v] of this.foeViews) {
      if (v.stamp !== stamp) { v.g.destroy(); this.foeViews.delete(id); }
    }
  }

  private placeLabels(): void {
    const s = this.cam.scale.x;
    for (const v of this.views.values()) {
      if (!v.label.visible) continue;
      v.label.position.set(this.cam.x + v.x * s, this.cam.y + (v.y + 7 * v.size) * s + 2);
    }
  }

  /** Hide chunks that are off screen. */
  private cull(): void {
    const s = this.cam.scale.x;
    const x0 = -this.cam.x / s / TS - 1;
    const y0 = -this.cam.y / s / TS - 1;
    const x1 = x0 + this.app.screen.width / s / TS + 2;
    const y1 = y0 + this.app.screen.height / s / TS + 2;
    for (const ch of this.chunks) {
      const on = ch.x1 > x0 && ch.x0 < x1 && ch.y1 > y0 && ch.y0 < y1;
      ch.st.visible = on;
      ch.ground.visible = on;
      ch.canopy.visible = on;
    }
    this.placeLabels();
  }

  /** Day and night, weather gloom, and warm light from fires and lived-in rooms after dark. */
  private lighting(tf: number, dt: number): void {
    const c = this.c;
    const hour = ((((tf % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY) / TICKS_PER_HOUR);
    let k = 0;
    while (k < SKY.length - 2 && SKY[k + 1][0] <= hour) k++;
    const a = SKY[k];
    const b = SKY[k + 1];
    const u = Math.max(0, Math.min(1, (hour - a[0]) / (b[0] - a[0])));
    const wx = WX[c.weather] ?? WX[0];
    const ease = Math.min(1, dt * 0.004);
    const sky = this.sky;
    for (let i = 0; i < 3; i++) sky[i] += ((a[i + 1] + (b[i + 1] - a[i + 1]) * u) * wx[i] - sky[i]) * ease;
    sky[3] += (Math.min(1, a[4] + (b[4] - a[4]) * u + wx[3]) - sky[3]) * ease;
    sky[4] += (wx[4] - sky[4]) * ease;
    this.night.tint = (Math.round(sky[0] * 255) << 16) | (Math.round(sky[1] * 255) << 8) | Math.round(sky[2] * 255);

    const dark = sky[3];
    let n = 0;
    if (dark > 0.04) {
      for (let i = 0; i < this.fires.length; i++) {
        const f = this.fires[i];
        this.light(n++, f.x, f.y, f.r, dark * 0.5 * (0.9 + 0.1 * Math.sin(this.time * 0.009 + i * 1.7)));
      }
      // rooms with someone awake inside glow from within
      const seen = new Set<number>();
      for (const v of this.views.values()) {
        if (v.asleep) continue;
        const id = c.sb[v.tile];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const bl = this.blds.get(id);
        if (!bl || !bl.built || OPEN_AIR.has(bl.k)) continue;
        this.light(n++, (bl.x + bl.w / 2) * TS, (bl.y + bl.h / 2) * TS, Math.max(bl.w, bl.h) * 0.75, dark * 0.3);
      }
    }
    for (let i = n; i < this.lights.length; i++) this.lights[i].visible = false;
  }

  private light(i: number, x: number, y: number, tiles: number, alpha: number): void {
    let s = this.lights[i];
    if (!s) {
      s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = 0xffb35c;
      this.lightLayer.addChild(s);
      this.lights[i] = s;
    }
    s.visible = true;
    s.position.set(x, y);
    s.scale.set((tiles * TS * 2) / 128);
    s.alpha = alpha;
  }

  /** Rain, snow, fog and the odd flash of lightning, drawn over the map in screen space. */
  private weather(dt: number): void {
    const w = this.c.weather;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    if (sw !== this.ovW || sh !== this.ovH) this.sizeOverlays();
    const want = w === 2 ? 90 : w === 3 ? 170 : w === 4 ? 120 : 0;
    if (w !== this.wxKind) {
      this.wxKind = w;
      while (this.drops.length < want) {
        const s = new Sprite(this.rainTex);
        s.anchor.set(0.5);
        this.wxLayer.addChild(s);
        this.drops.push({ s, x: Math.random() * sw, y: Math.random() * sh, v: 0.6 + Math.random() * 0.6 });
      }
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        d.s.visible = i < want;
        d.s.texture = w === 4 ? this.snowTex : this.rainTex;
        d.s.rotation = w === 4 ? 0 : 0.22;
        d.s.alpha = w === 4 ? 0.85 : 0.4;
        d.s.scale.set(w === 4 ? 0.3 + d.v * 0.35 : 1);
      }
    }
    for (let i = 0; i < want && i < this.drops.length; i++) {
      const d = this.drops[i];
      if (w === 4) {
        d.y += d.v * 0.07 * dt;
        d.x += Math.sin(this.time * 0.0012 + i) * 0.02 * dt;
      } else {
        d.y += d.v * (w === 3 ? 1.5 : 1.1) * dt;
        d.x -= d.v * 0.26 * dt;
      }
      if (d.y > sh + 12) { d.y = -12; d.x = Math.random() * (sw + 80); }
      if (d.x < -12) d.x += sw + 24;
      d.s.position.set(d.x, d.y);
    }
    this.fog.visible = this.sky[4] > 0.01;
    this.fog.alpha = this.sky[4];
    if (w === 3 && Math.random() < dt * 0.00012) this.flash = 1;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 0.004);
    this.flashG.visible = this.flash > 0;
    this.flashG.alpha = this.flash * 0.3;
  }

  private sizeOverlays(): void {
    const sw = (this.ovW = this.app.screen.width);
    const sh = (this.ovH = this.app.screen.height);
    this.fog.clear().rect(0, 0, sw, sh).fill(0xc7d0da);
    this.flashG.clear().rect(0, 0, sw, sh).fill(0xffffff);
  }

  // ---------- Selection and camera ----------

  /** Outline a building (0 clears it). */
  selectBld(id: number): void {
    this.selBld = id;
    this.bldSel.clear();
    const b = id && this.c ? this.c.blds.find((x) => x.id === id) : undefined;
    if (b) this.bldSel.roundRect(b.x * TS - 2, b.y * TS - 2, b.w * TS + 4, b.h * TS + 4, 5).stroke({ width: 2, color: 0x7c8cff, alpha: 0.9 });
  }

  /** Screen position of a colonist, or null if they are not on the map. */
  screenOf(id: Id): { x: number; y: number } | null {
    const v = this.views.get(id);
    const s = this.cam.scale.x;
    return v ? { x: this.cam.x + v.x * s, y: this.cam.y + v.y * s } : null;
  }

  private centre(): [number, number] {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const i = this.inset;
    return [i.left + Math.max(40, sw - i.left - i.right) / 2, i.top + Math.max(40, sh - i.top - i.bottom) / 2];
  }

  /** Jump to the middle of the colony at a comfortable zoom. */
  home(): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.fitScale = Math.min(sw / this.mw, sh / this.mh);
    const s = Math.max(this.fitScale, sw < 700 ? 0.8 : 1.1);
    const [cx, cy] = this.centre();
    this.anim = null;
    this.cam.scale.set(s);
    this.cam.position.set(cx - (this.c.cx + 0.5) * TS * s, cy - (this.c.cy + 0.5) * TS * s);
    this.clamp();
  }

  /** Smoothly centre on a tile, zooming in if far out. */
  focusTile(x: number, y: number, minZoom = 1.3): void {
    const s = Math.max(this.cam.scale.x, minZoom);
    const [cx, cy] = this.centre();
    this.anim = { x: this.cam.x, y: this.cam.y, s: this.cam.scale.x, fx: cx - (x + 0.5) * TS * s, fy: cy - (y + 0.5) * TS * s, fs: s, t: 0 };
  }

  focusPawn(id: Id, minZoom = 1.5): void {
    const v = this.views.get(id);
    if (v) this.focusTile(v.x / TS - 0.5, v.y / TS - 0.5, minZoom);
  }

  private stepCamera(dt: number): void {
    const a = this.anim;
    if (a) {
      a.t = Math.min(1, a.t + dt / 450);
      const e = 1 - (1 - a.t) * (1 - a.t) * (1 - a.t);
      this.cam.scale.set(a.s + (a.fs - a.s) * e);
      this.cam.x = a.x + (a.fx - a.x) * e;
      this.cam.y = a.y + (a.fy - a.y) * e;
      if (a.t >= 1) this.anim = null;
      this.clamp();
    } else if (this.followId) {
      // follow mode: ease the camera after the colonist
      const v = this.views.get(this.followId);
      if (v) {
        const s = this.cam.scale.x;
        const [cx, cy] = this.centre();
        const k = Math.min(1, dt * 0.008);
        this.cam.x += (cx - v.x * s - this.cam.x) * k;
        this.cam.y += (cy - v.y * s - this.cam.y) * k;
        this.clamp();
      }
    }
  }

  private clamp(): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.fitScale = Math.min(sw / this.mw, sh / this.mh);
    const s = Math.max(this.fitScale * 0.9, Math.min(4, this.cam.scale.x));
    this.cam.scale.set(s);
    // keep some of the map under the middle of the screen
    this.cam.x = Math.min(sw / 2, Math.max(sw / 2 - this.mw * s, this.cam.x));
    this.cam.y = Math.min(sh / 2, Math.max(sh / 2 - this.mh * s, this.cam.y));
  }

  private zoomAt(px: number, py: number, f: number): void {
    const s0 = this.cam.scale.x;
    const s1 = Math.max(this.fitScale * 0.9, Math.min(4, s0 * f));
    this.cam.x = px - ((px - this.cam.x) * s1) / s0;
    this.cam.y = py - ((py - this.cam.y) * s1) / s0;
    this.cam.scale.set(s1);
    this.clamp();
  }

  /** Work out what a tap landed on: the nearest colonist first, then a grave or building. */
  private pick(px: number, py: number): void {
    const c = this.c;
    const s = this.cam.scale.x;
    const wx = (px - this.cam.x) / s;
    const wy = (py - this.cam.y) / s;
    let best: PawnView | undefined;
    let bd = Math.max(11, 20 / s) ** 2;
    for (const v of this.views.values()) {
      const dx = v.x - wx;
      const dy = v.y - 2 * v.size - wy;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = v; }
    }
    const tx = Math.floor(wx / TS);
    const ty = Math.floor(wy / TS);
    const inside = tx >= 0 && ty >= 0 && tx < c.w && ty < c.h;
    const tile = inside ? ty * c.w + tx : -1;
    if (best) this.onPick({ pawn: best.id, tile });
    else if (inside) this.onPick({ bld: c.sb[tile] || undefined, grave: c.st[tile] === B.GRAVE ? tile : undefined, tile });
    else this.onPick({ tile });
  }

  private bindInput(): void {
    const el = this.app.canvas;
    el.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    let pinch: { d: number; mx: number; my: number } | null = null;
    const pos = (e: PointerEvent): { x: number; y: number } => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = pos(e);
      pts.set(e.pointerId, p);
      this.anim = null;
      if (pts.size === 1) start = { x: p.x, y: p.y, cx: this.cam.x, cy: this.cam.y, moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        if (start) start.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Two fingers pan and zoom at once: follow the midpoint, then scale around it.
        this.cam.x += mx - pinch.mx;
        this.cam.y += my - pinch.my;
        this.zoomAt(mx, my, pinch.d > 0 ? d / pinch.d : 1);
        pinch = { d, mx, my };
        this.onUserMove();
        return;
      }
      if (start && pts.size === 1) {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (!start.moved && Math.abs(dx) + Math.abs(dy) > 6) { start.moved = true; this.onUserMove(); }
        if (start.moved) {
          this.cam.x = start.cx + dx;
          this.cam.y = start.cy + dy;
          this.clamp();
        }
      }
    });
    const up = (e: PointerEvent): void => {
      const p = pos(e);
      if (e.type === 'pointerup' && start && !start.moved && pts.size === 1) this.pick(p.x, p.y);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) start = null;
      // Lifting one finger of a pinch: keep panning from here instead of jumping back.
      if (pts.size === 1) {
        const [q] = [...pts.values()];
        start = { x: q.x, y: q.y, cx: this.cam.x, cy: this.cam.y, moved: true };
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.anim = null;
      // zooming keeps follow mode on: the camera stays with the colonist at the new zoom
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }
}

/** A soft round glow, used for firelight (tinted warm) and for snowflakes. */
function glowCanvas(size = 128, core = 0.0): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(Math.max(0.01, core * 0.5), 'rgba(255,255,255,1)');
    grad.addColorStop(0.5 + core * 0.3, `rgba(255,255,255,${0.35 + core * 0.5})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return cv;
}

function rainCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 3;
  cv.height = 20;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 20);
    grad.addColorStop(0, 'rgba(200,220,255,0)');
    grad.addColorStop(1, 'rgba(200,220,255,0.9)');
    g.fillStyle = grad;
    g.fillRect(1, 0, 1.4, 20);
  }
  return cv;
}
