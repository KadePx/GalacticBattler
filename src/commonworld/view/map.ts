// The world map, drawn with PixiJS. Terrain is baked once; the political/heat overlays are
// painted into a canvas texture when the world changes; icons and labels are Pixi objects.

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { foodYield, TIER_R } from '../sim/civ';
import { forWithin, tileAtPixel, tileCenter } from '../sim/hex';
import type { World } from '../sim/types';
import { isLand } from '../sim/worldgen';
import type { SettView } from '../history';
import { CORNERS, EDGE, HEX, hexPath, mapSize, neighborInDir, paintTerrain } from './terrain';

export type Mode = 'political' | 'diplomacy' | 'trade' | 'population' | 'stability' | 'fertility' | 'terrain';
export type Stance = 'self' | 'ally' | 'pact' | 'peace' | 'war';
const STANCE_COLOR: Record<Stance, string> = { self: 'rgba(124,140,255,0.6)', ally: 'rgba(110,200,110,0.5)', pact: 'rgba(90,190,200,0.45)', peace: 'rgba(170,170,190,0.28)', war: 'rgba(225,70,55,0.55)' };

export interface MapState {
  owner: Int16Array;
  setts: SettView[];
  ruins: number[]; // tiles
  monuments: number[]; // tiles
  capitals: Set<number>; // settlement ids
  routes: [number, number, boolean][]; // tile pairs, by sea
  battles: number[]; // tiles of recent battles
  sieges: number[]; // tiles under siege
  stance: Map<number, Stance>; // how each civ stands with the selected one (diplomacy mode)
  mode: Mode;
  selCiv: number;
  key: string; // changes whenever the overlay needs repainting
}

export function civColor(hue: number, l = 55, a = 1): string {
  return `hsla(${hue}, 68%, ${l}%, ${a})`;
}
function civHex(hue: number, l = 55): number {
  const s = 0.68;
  const ll = l / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

interface Label { text: Text; prio: number; kind: 'civ' | 'sett'; tier: number; x: number; y: number; a: number; base: number }

export class MapView {
  app = new Application();
  cam = new Container();
  private w!: World;
  private terrain!: Sprite;
  private overlayCv = document.createElement('canvas');
  private overlayTex!: Texture;
  private overlay!: Sprite;
  private icons = new Graphics();
  private routesG = new Graphics();
  private markG = new Graphics();
  private markText: Text[] = [];
  private markers: number[] = [];
  private markSel = -1;
  private hover = new Graphics();
  private selG = new Graphics();
  private labelLayer = new Container();
  private civLabels = new Map<number, Text>();
  private settLabels = new Map<number, Text>();
  private labels: Label[] = [];
  private state: MapState | null = null;
  private lastKey = '';
  private fitScale = 1;
  private mw = 0;
  private mh = 0;
  private anim: { x: number; y: number; s: number; fx: number; fy: number; fs: number; t: number } | null = null;
  selTile = -1;
  /** Screen space covered by panels, so focus() centres in the part of the map you can see. */
  inset = { left: 0, bottom: 0 };
  onClick: (tile: number) => void = () => {};
  onHover: (tile: number, x: number, y: number) => void = () => {};

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      antialias: true,
      background: '#0d1b2b',
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    parent.appendChild(this.app.canvas);
    this.app.stage.addChild(this.cam);
    this.app.stage.addChild(this.labelLayer);
    this.bindInput();
    this.app.ticker.add(() => this.tick());
    new ResizeObserver(() => this.clamp()).observe(parent);
  }

  setWorld(w: World): void {
    this.w = w;
    [this.mw, this.mh] = mapSize(w);
    this.cam.removeChildren();
    this.terrain = new Sprite(Texture.from(paintTerrain(w)));
    this.overlayCv.width = this.mw;
    this.overlayCv.height = this.mh;
    this.overlayTex = Texture.from(this.overlayCv);
    this.overlay = new Sprite(this.overlayTex);
    this.cam.addChild(this.terrain, this.overlay, this.routesG, this.icons, this.selG, this.hover, this.markG);
    for (const t of this.civLabels.values()) t.destroy();
    for (const t of this.settLabels.values()) t.destroy();
    this.civLabels.clear();
    this.settLabels.clear();
    this.labels = [];
    this.state = null;
    this.lastKey = '';
    this.fit();
  }

  fit(): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.fitScale = Math.min(sw / this.mw, sh / this.mh);
    // On tall phone screens start closer in, so the land fills the screen.
    const s = sh > sw * 1.2 ? Math.max(this.fitScale, (sh * 0.55) / this.mh) : this.fitScale;
    this.cam.scale.set(s);
    this.cam.position.set((sw - this.mw * s) / 2, (sh - this.mh * s) / 2);
    this.afterCamera();
  }

  /** Smoothly centre the view on a tile. */
  focus(tile: number, zoomRel = 3): void {
    const [x, y] = tileCenter(this.w.W, tile, HEX);
    const s = Math.max(this.cam.scale.x, this.fitScale * zoomRel);
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const cx = this.inset.left + (sw - this.inset.left) / 2;
    const cy = (sh - this.inset.bottom) / 2 + 20;
    this.anim = { x: this.cam.x, y: this.cam.y, s: this.cam.scale.x, fx: cx - x * s, fy: cy - y * s, fs: s, t: 0 };
  }

  update(st: MapState): void {
    this.state = st;
    if (st.key !== this.lastKey) {
      this.lastKey = st.key;
      this.paintOverlay(st);
      this.overlayTex.source.update();
    }
    this.syncLabels(st);
    this.drawRoutes();
    this.drawIcons();
    this.drawSel();
  }

  // ---- Overlay ----

  private paintOverlay(st: MapState): void {
    const g = this.overlayCv.getContext('2d')!;
    const w = this.w;
    const t = w.t;
    const own = st.owner;
    g.clearRect(0, 0, this.mw, this.mh);
    const n = w.W * w.H;
    const sel = st.selCiv;

    if (st.mode === 'political') {
      for (let i = 0; i < n; i++) {
        const o = own[i];
        if (o < 0) continue;
        const [cx, cy] = tileCenter(w.W, i, HEX);
        hexPath(g, cx, cy, HEX * 1.03);
        const a = sel < 0 ? 0.3 : sel === o ? 0.48 : 0.14;
        g.fillStyle = civColor(w.civs[o].hue, 55, a);
        g.fill();
      }
    } else if (st.mode === 'diplomacy') {
      for (let i = 0; i < n; i++) {
        const o = own[i];
        if (o < 0) continue;
        const stance = st.stance.get(o);
        const [cx, cy] = tileCenter(w.W, i, HEX);
        hexPath(g, cx, cy, HEX * 1.03);
        g.fillStyle = stance ? STANCE_COLOR[stance] : 'rgba(10,10,20,0.45)';
        g.fill();
      }
    } else if (st.mode === 'trade') {
      for (let i = 0; i < n; i++) {
        const o = own[i];
        if (o < 0) continue;
        const [cx, cy] = tileCenter(w.W, i, HEX);
        hexPath(g, cx, cy, HEX * 1.03);
        g.fillStyle = civColor(w.civs[o].hue, 45, 0.18);
        g.fill();
      }
    } else if (st.mode === 'population') {
      g.fillStyle = 'rgba(5,10,20,0.45)';
      g.fillRect(0, 0, this.mw, this.mh);
      g.globalCompositeOperation = 'lighter';
      for (const s of st.setts) {
        const [cx, cy] = tileCenter(w.W, s.tile, HEX);
        const r = 8 + Math.sqrt(s.pop) * 0.7;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(255,190,90,0.75)');
        grad.addColorStop(0.5, 'rgba(230,90,40,0.3)');
        grad.addColorStop(1, 'rgba(120,20,40,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    } else if (st.mode === 'stability') {
      for (const s of st.setts) {
        forWithin(w.W, w.H, s.tile, TIER_R[s.tier], (i) => {
          if (own[i] !== s.civ) return;
          const [cx, cy] = tileCenter(w.W, i, HEX);
          hexPath(g, cx, cy, HEX * 1.03);
          g.fillStyle = `hsla(${Math.round(s.stab * 1.2)}, 75%, 48%, 0.5)`;
          g.fill();
        });
      }
    } else if (st.mode === 'fertility') {
      for (let i = 0; i < n; i++) {
        if (!isLand(t, i)) continue;
        const f = foodYield(w, i, false);
        const [cx, cy] = tileCenter(w.W, i, HEX);
        hexPath(g, cx, cy, HEX * 1.03);
        g.fillStyle = f <= 0 ? 'rgba(90,40,30,0.55)' : `hsla(${60 + f * 14}, 80%, ${22 + f * 6}%, 0.6)`;
        g.fill();
      }
    }

    // Borders in every mode but plain terrain (faint there).
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const o = own[i];
      if (o < 0) continue;
      const [cx, cy] = tileCenter(w.W, i, HEX);
      for (let k = 0; k < 6; k++) {
        const j = neighborInDir(w, i, k);
        if (j >= 0 && own[j] === o) continue;
        const [a, b] = EDGE[k];
        const x1 = cx + CORNERS[a][0] * HEX * 0.9;
        const y1 = cy + CORNERS[a][1] * HEX * 0.9;
        const x2 = cx + CORNERS[b][0] * HEX * 0.9;
        const y2 = cy + CORNERS[b][1] * HEX * 0.9;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        if (st.mode === 'terrain') {
          g.strokeStyle = 'rgba(6,8,14,0.35)';
          g.lineWidth = 1;
          g.stroke();
          continue;
        }
        const hue = w.civs[o].hue;
        g.strokeStyle = 'rgba(6,8,14,0.55)';
        g.lineWidth = sel === o ? 5 : 3.5;
        g.stroke();
        g.strokeStyle = civColor(hue, sel === o ? 70 : 60, sel < 0 || sel === o ? 1 : 0.6);
        g.lineWidth = sel === o ? 3 : 2;
        g.stroke();
      }
    }
  }

  // ---- Homeland markers (founding) ----

  /** Numbered rings on the map; the selected one is gold. Empty list hides them. */
  setMarkers(tiles: number[], sel: number): void {
    this.markers = tiles;
    this.markSel = sel;
    while (this.markText.length < tiles.length) {
      const t = this.makeText('', 13, '#0a0d14', 0);
      t.anchor.set(0.5);
      t.style.stroke = { color: '#ffffff', width: 3, join: 'round' };
      this.cam.addChild(t);
      this.markText.push(t);
    }
    this.drawMarkers();
  }

  private drawMarkers(): void {
    const g = this.markG;
    g.clear();
    const k = this.iconScale();
    this.markText.forEach((t, i) => {
      const tile = this.markers[i];
      t.visible = tile !== undefined && this.markers.length > 1;
      if (!t.visible) return;
      const [cx, cy] = tileCenter(this.w.W, tile, HEX);
      t.text = String(i + 1);
      t.scale.set(k * 0.9);
      t.position.set(cx, cy - 26 * k);
    });
    for (const tile of this.markers) {
      const [cx, cy] = tileCenter(this.w.W, tile, HEX);
      const on = tile === this.markSel;
      g.circle(cx, cy, (on ? 22 : 17) * k).stroke({ width: (on ? 3.5 : 2.2) * k, color: on ? 0x7c8cff : 0xffffff, alpha: on ? 1 : 0.8 });
      if (on) g.circle(cx, cy, 30 * k).stroke({ width: 1.5 * k, color: 0x7c8cff, alpha: 0.5 });
      // Radius of the land they would first work.
      g.circle(cx, cy, HEX * 3.2).fill({ color: on ? 0x7c8cff : 0xffffff, alpha: on ? 0.14 : 0.06 });
    }
  }

  // ---- Trade routes ----

  private drawRoutes(): void {
    const st = this.state;
    const g = this.routesG;
    g.clear();
    if (!st || !(st.mode === 'political' || st.mode === 'trade' || st.mode === 'diplomacy')) return;
    const strong = st.mode === 'trade';
    const k = this.iconScale();
    for (const [a, b, sea] of st.routes) {
      const [ax, ay] = tileCenter(this.w.W, a, HEX);
      const [bx, by] = tileCenter(this.w.W, b, HEX);
      // Bow each route a little so overlapping ones stay readable.
      const mx = (ax + bx) / 2 - (by - ay) * 0.12;
      const my = (ay + by) / 2 + (bx - ax) * 0.12;
      g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by)
        .stroke({ width: (strong ? 2.6 : 1.4) * k, color: sea ? 0x8fd0ff : 0xf2c766, alpha: strong ? 0.95 : 0.45 });
    }
  }

  // ---- Icons ----

  private iconScale(): number {
    // Icons grow a bit when zoomed out so they stay visible, but not fully.
    const rel = this.cam.scale.x / this.fitScale;
    return Math.max(0.7, Math.min(2.2, 2.2 / Math.sqrt(rel)));
  }

  private drawIcons(): void {
    const st = this.state;
    if (!st) return;
    const g = this.icons;
    const w = this.w;
    const k = this.iconScale();
    g.clear();
    for (const tile of st.ruins) {
      const [cx, cy] = tileCenter(w.W, tile, HEX);
      const r = 2.6 * k;
      g.moveTo(cx - r, cy - r).lineTo(cx + r, cy + r).moveTo(cx + r, cy - r).lineTo(cx - r, cy + r)
        .stroke({ width: 1.4 * k, color: 0x1c2130, alpha: 0.85 });
    }
    for (const tile of st.sieges) {
      const [cx, cy] = tileCenter(w.W, tile, HEX);
      g.circle(cx, cy, 9 * k).stroke({ width: 2 * k, color: 0xe5483a, alpha: 0.9 });
    }
    for (const tile of st.battles) {
      // Crossed swords.
      const [cx, cy] = tileCenter(w.W, tile, HEX);
      const x = cx - 8 * k;
      const y = cy - 8 * k;
      const r = 3.6 * k;
      g.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r)
        .stroke({ width: 3.4 * k, color: 0x0a0d14 })
        .moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r)
        .stroke({ width: 1.8 * k, color: 0xff6a4d });
    }
    for (const tile of st.monuments) {
      const [cx, cy] = tileCenter(w.W, tile, HEX);
      const r = 3 * k;
      g.poly([cx + 6 * k, cy - 7 * k - r, cx + 6 * k + r, cy - 7 * k + r, cx + 6 * k - r, cy - 7 * k + r])
        .fill({ color: 0xf5c451 }).stroke({ width: 1, color: 0x0a0d14 });
    }
    for (const s of st.setts) {
      const [cx, cy] = tileCenter(w.W, s.tile, HEX);
      const r = (2.2 + s.tier * 1.1) * k;
      const col = civHex(w.civs[s.civ].hue, 45);
      const dim = st.selCiv >= 0 && st.selCiv !== s.civ ? 0.45 : 1;
      if (st.capitals.has(s.id)) {
        g.star(cx, cy, 5, r + 3.2 * k, (r + 3.2 * k) * 0.5).fill({ color: 0xffffff, alpha: dim }).stroke({ width: 1.2, color: 0x0a0d14, alpha: dim });
      }
      g.circle(cx, cy, r).fill({ color: 0xf6f8fc, alpha: dim }).stroke({ width: 1.6 * Math.min(1.4, k), color: col, alpha: dim });
      if (s.tier >= 3) g.circle(cx, cy, r * 0.45).fill({ color: col, alpha: dim });
    }
  }

  private drawSel(): void {
    const g = this.selG;
    g.clear();
    if (this.selTile < 0) return;
    const [cx, cy] = tileCenter(this.w.W, this.selTile, HEX);
    const pts: number[] = [];
    for (const [x, y] of CORNERS) pts.push(cx + x * HEX, cy + y * HEX);
    g.poly(pts).stroke({ width: 2.5, color: 0x7c8cff });
  }

  // ---- Labels ----

  private makeText(s: string, size: number, color: string, spacing = 0, italic = false): Text {
    return new Text({
      text: s,
      resolution: 2,
      style: {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: size,
        fontWeight: '600',
        fontStyle: italic ? 'italic' : 'normal',
        fill: color,
        letterSpacing: spacing,
        stroke: { color: '#0a0d14', width: Math.max(3, size / 5), join: 'round' },
      },
    });
  }

  private syncLabels(st: MapState): void {
    const w = this.w;
    // Civ labels at the territory tile nearest the centre of mass.
    const sx = new Map<number, [number, number, number]>();
    for (let i = 0; i < st.owner.length; i++) {
      const o = st.owner[i];
      if (o < 0) continue;
      const [cx, cy] = tileCenter(w.W, i, HEX);
      const e = sx.get(o) ?? [0, 0, 0];
      e[0] += cx;
      e[1] += cy;
      e[2]++;
      sx.set(o, e);
    }
    const labels: Label[] = [];
    for (const [civ, [ax, ay, n]] of sx) {
      let t = this.civLabels.get(civ);
      const name = (w.civs[civ].founder ? '★ ' : '') + w.civs[civ].name.toUpperCase();
      if (!t) {
        t = this.makeText(name, 20, civColor(w.civs[civ].hue, 80), 5);
        t.anchor.set(0.5);
        this.civLabels.set(civ, t);
        this.labelLayer.addChild(t);
      }
      const base = Math.max(0.5, Math.min(1, 0.4 + Math.sqrt(n) * 0.04));
      const a = st.selCiv < 0 || st.selCiv === civ ? 1 : 0.4;
      labels.push({ text: t, prio: 1e9 + n, kind: 'civ', tier: 0, x: ax / n, y: ay / n, a, base });
    }
    for (const [civ, t] of this.civLabels) if (!sx.has(civ)) { t.destroy(); this.civLabels.delete(civ); }

    const alive = new Set<number>();
    for (const s of st.setts) {
      alive.add(s.id);
      let t = this.settLabels.get(s.id);
      if (!t) {
        t = this.makeText(w.setts[s.id].name, 12, '#f1f4fa', 0.3);
        t.anchor.set(0.5, 1);
        this.settLabels.set(s.id, t);
        this.labelLayer.addChild(t);
      }
      const [cx, cy] = tileCenter(w.W, s.tile, HEX);
      const a = st.selCiv < 0 || st.selCiv === s.civ ? 1 : 0.5;
      labels.push({ text: t, prio: s.tier * 100000 + s.pop + (st.capitals.has(s.id) ? 500000 : 0), kind: 'sett', tier: s.tier + (st.capitals.has(s.id) ? 1 : 0), x: cx, y: cy, a, base: 1 });
    }
    for (const [id, t] of this.settLabels) if (!alive.has(id)) { t.destroy(); this.settLabels.delete(id); }
    labels.sort((a, b) => b.prio - a.prio);
    this.labels = labels;
    this.placeLabels();
  }

  /** Position labels on screen and hide the ones that would overlap. */
  private placeLabels(): void {
    const s = this.cam.scale.x;
    const rel = s / this.fitScale;
    const k = this.iconScale();
    const taken: [number, number, number, number][] = [];
    const civAlpha = Math.max(0, Math.min(1, (4 - rel) / 1.5));
    const minTier = rel > 6 ? 0 : rel > 4 ? 1 : rel > 2.4 ? 2 : rel > 1.5 ? 3 : 99;
    for (const l of this.labels) {
      const t = l.text;
      const px = l.x * s + this.cam.x;
      const py = l.y * s + this.cam.y;
      let show: boolean;
      if (l.kind === 'civ') {
        t.scale.set(l.base * Math.max(0.75, Math.min(1.5, Math.sqrt(rel))) * Math.min(1, this.app.screen.width / 900 + 0.25));
        t.position.set(px, py);
        show = civAlpha > 0.02;
        t.alpha = l.a * civAlpha;
      } else {
        t.scale.set(1);
        t.alpha = l.a;
        t.position.set(px, py - (6 + l.tier * 1.4) * s * k * 0.55 - 2);
        show = l.tier >= minTier;
      }
      if (show) {
        const hw = (t.width / 2) + 2;
        const hh = t.height / 2 + 1;
        const cy = l.kind === 'civ' ? t.y : t.y - t.height / 2;
        const box: [number, number, number, number] = [t.x - hw, cy - hh, t.x + hw, cy + hh];
        for (const b of taken) {
          if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) { show = false; break; }
        }
        if (show) taken.push(box);
      }
      t.visible = show;
    }
  }

  // ---- Camera ----

  private afterCamera(): void {
    this.drawIcons();
    this.drawRoutes();
    if (this.markers.length) this.drawMarkers();
    this.placeLabels();
  }

  private clamp(): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.fitScale = Math.min(sw / this.mw, sh / this.mh);
    const s = Math.max(this.fitScale * 0.9, Math.min(this.fitScale * 14, this.cam.scale.x));
    this.cam.scale.set(s);
    // Keep the map covering the centre of the screen.
    this.cam.x = Math.min(sw / 2, Math.max(sw / 2 - this.mw * s, this.cam.x));
    this.cam.y = Math.min(sh / 2, Math.max(sh / 2 - this.mh * s, this.cam.y));
    this.afterCamera();
  }

  private zoomAt(px: number, py: number, f: number): void {
    const s0 = this.cam.scale.x;
    const s1 = Math.max(this.fitScale * 0.9, Math.min(this.fitScale * 14, s0 * f));
    this.cam.x = px - ((px - this.cam.x) * s1) / s0;
    this.cam.y = py - ((py - this.cam.y) * s1) / s0;
    this.cam.scale.set(s1);
    this.clamp();
  }

  private tileAtScreen(px: number, py: number): number {
    const s = this.cam.scale.x;
    return tileAtPixel(this.w.W, this.w.H, HEX, (px - this.cam.x) / s, (py - this.cam.y) / s);
  }

  private bindInput(): void {
    const el = this.app.canvas;
    el.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    let pinch: { d: number; mx: number; my: number } | null = null;
    const pos = (e: PointerEvent) => {
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
        return;
      }
      if (start && pts.size === 1) {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) start.moved = true;
        if (start.moved) {
          this.cam.x = start.cx + dx;
          this.cam.y = start.cy + dy;
          this.clamp();
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const tile = this.tileAtScreen(p.x, p.y);
        this.drawHover(tile);
        this.onHover(tile, e.clientX, e.clientY);
      }
    });
    const up = (e: PointerEvent) => {
      const p = pos(e);
      if (start && !start.moved && pts.size === 1) {
        const tile = this.tileAtScreen(p.x, p.y);
        this.selTile = tile;
        this.drawSel();
        this.onClick(tile);
      }
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
    el.addEventListener('pointerleave', () => { this.drawHover(-1); this.onHover(-1, 0, 0); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = { x: e.offsetX, y: e.offsetY };
      this.anim = null;
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  private drawHover(tile: number): void {
    const g = this.hover;
    g.clear();
    if (tile < 0) return;
    const [cx, cy] = tileCenter(this.w.W, tile, HEX);
    const pts: number[] = [];
    for (const [x, y] of CORNERS) pts.push(cx + x * HEX, cy + y * HEX);
    g.poly(pts).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 1.5, color: 0xffffff, alpha: 0.6 });
  }

  private tick(): void {
    if (!this.anim) return;
    const a = this.anim;
    a.t = Math.min(1, a.t + this.app.ticker.deltaMS / 450);
    const e = 1 - (1 - a.t) * (1 - a.t) * (1 - a.t);
    this.cam.scale.set(a.s + (a.fs - a.s) * e);
    this.cam.x = a.x + (a.fx - a.x) * e;
    this.cam.y = a.y + (a.fy - a.y) * e;
    if (a.t >= 1) this.anim = null;
    this.clamp();
  }
}
