// The town at work, drawn from what is going on in it: looms clacking, bellows pumping, cauldrons
// and vats bubbling, millstones turning, loaves on the baker's rack and sacks by the mill, the
// anvil sparking under the hammer, washing out on the lines and dyed cloth drying, lamplight in
// the windows after dark, children at their games, people carrying loads to work, and carts on
// the road between the fields and the granary and between the gate and the market.
// Display only: everything here is read from the colony and the clock, and nothing is stored in
// it. Where things are is re-read every few seconds; each frame only what is on screen is drawn.

import { Container, Graphics } from 'pixi.js';
import { DAYS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { HOMES, cells, shapeOf } from '../sim/data/buildings';
import { cartSlots, marketOpen } from '../sim/market';
import { B, F, T, type Bld, type Colony } from '../sim/types';
import type { Bounds, FxPawn } from './fx';
import { TS, hash2 } from './tiles';

/** Furniture that moves when its trade is at work (or its fire is lit). */
const ANIM = new Set<number>([
  B.LOOM, B.FORGE, B.ANVIL, B.CAULDRON, B.VAT, B.HEARTH, B.STOVE, B.BRAZIER,
  B.MILLSTONE, B.OVEN, B.KILN, B.GLASSFURN, B.TANVAT, B.DYEVAT, B.BLOOMERY, B.JEWELBENCH, B.PRESS,
]);
const HOME = new Set(HOMES);
const FLOORS = new Set<number>([B.FLOOR_WOOD, B.FLOOR_STONE, B.FLOOR_BARE, B.FLOOR_FINE]);
const isWall = (s: number): boolean => s === B.WALL_WOOD || s === B.WALL_STONE || s === B.DOOR;
const DYES = [0xb83a3a, 0x2f5fa8, 0xd9b83a, 0x6a3a8a, 0x3a8a4a, 0xd97a2a];
const WASH = [0xf2ead6, 0xc9d6e3, 0xd9c08a, 0xa8b89a, 0xe3c9c9, 0x8a9ab8];

interface Spot { x: number; y: number; s: number; b: number; k: string; ax: number; ay: number }
interface Win { x: number; y: number; h: boolean; b: number; gl: boolean }
interface Line { x: number; y: number; h: boolean; n: number; b: number; dye: boolean }
interface Route { kind: 'field' | 'market'; key: string; xs: Float32Array; ys: Float32Array; cum: Float32Array; len: number; g: Container; load: Graphics; seed: number }

/** Steady 0..1 from two numbers. */
const h = (a: number, b: number, k: number): number => hash2(a, b, k);

export class Life {
  private spots: Spot[] = [];
  private wins: Win[] = [];
  private lines: Line[] = [];
  private routes: Route[] = [];
  private blds = new Map<number, Bld>();
  private scan = -1;
  private nb = -1;
  private layer: Container | null = null;

  /** Forget everything (a new colony): carts are removed from their layer. */
  reset(): void {
    for (const r of this.routes) r.g.destroy({ children: true });
    this.routes = [];
    this.spots = [];
    this.wins = [];
    this.lines = [];
    this.scan = -1;
    this.nb = -1;
    this.layer = null;
  }

  /** Re-read where the working things, windows and washing lines are, every few seconds. */
  private rescan(c: Colony, time: number, layer: Container): void {
    const key = Math.floor(time / 4000);
    if (key === this.scan && c.blds.length === this.nb && layer === this.layer) return;
    this.scan = key;
    this.nb = c.blds.length;
    this.layer = layer;
    this.spots = [];
    this.wins = [];
    this.lines = [];
    this.blds.clear();
    const W = c.w;
    const stAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= c.h ? 0 : c.st[y * W + x]);
    const open = (x: number, y: number): boolean => {
      if (x < 1 || y < 1 || x >= W - 1 || y >= c.h - 1) return false;
      const i = y * W + x;
      const t = c.ter[i];
      // any bare ground but the street itself (and not in the water)
      return c.st[i] === B.NONE && t !== T.PATH && t !== T.SHALLOW && t !== T.DEEP && t !== T.ROCK && (c.feat[i] === F.NONE || c.feat[i] === F.FLOWERS);
    };
    for (const b of c.blds) {
      this.blds.set(b.id, b);
      if (!b.built || b.k === 'field') continue;
      const home = HOME.has(b.k);
      for (const q of cells(shapeOf(b))) {
        const x = b.x + q.dx;
        const y = b.y + q.dy;
        const s = stAt(x, y);
        if (ANIM.has(s)) {
          // the baker's rack and the miller's sacks stand on a free bit of floor beside the oven or the stone
          let ax = -1;
          let ay = -1;
          if (s === B.OVEN || s === B.MILLSTONE) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
              if (FLOORS.has(stAt(x + dx, y + dy)) && c.sb[(y + dy) * W + x + dx] === b.id) { ax = x + dx; ay = y + dy; break; }
            }
          }
          this.spots.push({ x, y, s, b: b.id, k: b.k, ax, ay });
        }
        // lamplight shows in the windows of homes: every other stretch of straight wall
        if (home && (s === B.WALL_WOOD || s === B.WALL_STONE)) {
          const ew = isWall(stAt(x - 1, y)) && isWall(stAt(x + 1, y)) && !isWall(stAt(x, y - 1)) && !isWall(stAt(x, y + 1));
          const ns = isWall(stAt(x, y - 1)) && isWall(stAt(x, y + 1)) && !isWall(stAt(x - 1, y)) && !isWall(stAt(x + 1, y));
          if ((ew && x % 2 === 0) || (ns && y % 2 === 0)) this.wins.push({ x, y, h: ew, b: b.id, gl: !!b.gl });
        }
      }
      // a washing line out beside some homes, and the dyers' cloth hung up to dry
      const dye = b.k === 'dyeworks';
      if ((home && h(b.id, 3, 41) < 0.55) || dye) {
        const want = dye ? 3 : 2;
        const tries: [number, number, boolean][] = [];
        for (let x = b.x; x < b.x + b.w; x++) { tries.push([x, b.y + b.h, true], [x, b.y - 1, true]); }
        for (let y = b.y; y < b.y + b.h; y++) { tries.push([b.x + b.w, y, false], [b.x - 1, y, false]); }
        const start = Math.floor(h(b.id, 5, 42) * tries.length);
        for (let k = 0; k < tries.length; k++) {
          const [x, y, hz] = tries[(start + k) % tries.length];
          let n = 0;
          while (n < want && open(x + (hz ? n : 0), y + (hz ? 0 : n))) n++;
          if (n >= 2) { this.lines.push({ x, y, h: hz, n, b: b.id, dye }); break; }
        }
      }
    }
    this.planRoutes(c, layer);
  }

  /** Where the carts run: from a field or two to the granary, and from the gate to the market. */
  private planRoutes(c: Colony, layer: Container): void {
    const want: { kind: 'field' | 'market'; from: [number, number]; to: [number, number]; seed: number }[] = [];
    const gran = c.blds.find((b) => b.built && b.k === 'granary') ?? c.blds.find((b) => b.built && b.k === 'store');
    if (gran) {
      // the nearer fields send their crop in by cart; which ones changes with the season
      const dist = (b: Bld): number => Math.abs(b.x - gran.x) + Math.abs(b.y - gran.y);
      const fields = c.blds.filter((b) => b.built && b.k === 'field').sort((a, b) => dist(a) - dist(b) || a.id - b.id).slice(0, 5);
      if (fields.length) {
        const day = Math.floor(c.tick / TICKS_PER_DAY / DAYS_PER_SEASON);
        const n = Math.min(2, fields.length);
        const first = Math.floor(h(day, 0, 43) * fields.length);
        for (let k = 0; k < n; k++) {
          const f = fields[(first + k) % fields.length];
          want.push({ kind: 'field', from: [f.x + (f.w >> 1), f.y + (f.h >> 1)], to: this.doorOf(c, gran), seed: f.id });
        }
      }
    }
    if (c.mkt) {
      const slot = cartSlots(c)[0];
      // in from the road just outside the town gate (or from where the road leaves the land, if there is no wall)
      let from: [number, number] = [c.gx, c.gy];
      let best = 1e9;
      for (const b of c.blds) {
        if (!b.built || b.k !== 'tgate') continue;
        const gx = b.x + (b.w >> 1);
        const gy = b.y + (b.h >> 1);
        const d = Math.abs(gx - c.gx) + Math.abs(gy - c.gy);
        if (d >= best) continue;
        best = d;
        const out = Math.abs(c.gx - gx) >= Math.abs(c.gy - gy);
        const ox = out ? gx + Math.sign(c.gx - gx) * 4 : gx;
        const oy = out ? gy : gy + Math.sign(c.gy - gy) * 4;
        from = [Math.max(1, Math.min(c.w - 2, ox)), Math.max(1, Math.min(c.h - 2, oy))];
      }
      if (slot) want.push({ kind: 'market', from, to: [slot.x, slot.y], seed: 7 });
    }
    const keep: Route[] = [];
    for (const w of want) {
      const key = `${w.kind}:${w.from}:${w.to}`;
      const old = this.routes.find((r) => r.key === key && !keep.includes(r));
      if (old) { keep.push(old); continue; }
      const path = route(c, w.from[0], w.from[1], w.to[0], w.to[1]);
      if (!path || path.length < 2) continue;
      const n = path.length;
      const xs = new Float32Array(n);
      const ys = new Float32Array(n);
      const cum = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        xs[k] = ((path[k] % c.w) + 0.5) * TS;
        ys[k] = (Math.floor(path[k] / c.w) + 0.5) * TS;
        if (k) cum[k] = cum[k - 1] + Math.sqrt((xs[k] - xs[k - 1]) ** 2 + (ys[k] - ys[k - 1]) ** 2);
      }
      const g = new Container();
      const body = new Graphics();
      drawCart(body, w.kind === 'market');
      const load = new Graphics();
      drawLoad(load, w.kind === 'market');
      g.addChild(body, load);
      g.visible = false;
      layer.addChild(g);
      keep.push({ kind: w.kind, key, xs, ys, cum, len: cum[n - 1], g, load, seed: w.seed });
    }
    for (const r of this.routes) if (!keep.includes(r)) r.g.destroy({ children: true });
    this.routes = keep;
  }

  /** The open tile just outside a building's door (or beside it, if it has none). */
  private doorOf(c: Colony, b: Bld): [number, number] {
    for (const q of cells(shapeOf(b))) {
      if (q.ch !== '+' && c.st[(b.y + q.dy) * c.w + b.x + q.dx] !== B.DOOR) continue;
      const x = b.x + q.dx;
      const y = b.y + q.dy;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const i = (y + dy) * c.w + x + dx;
        if (c.sb[i] !== b.id && passable(c, i)) return [x + dx, y + dy];
      }
    }
    return [b.x + (b.w >> 1), b.y + b.h];
  }

  /**
   * Draw this frame. `floor` lies over the buildings under the people, `lit`
   * over the night's shade. `busy` holds the buildings someone is working in now, `home` those
   * with someone awake inside. `dark` is how far night has fallen (0..1).
   */
  draw(floor: Graphics, lit: Graphics, c: Colony, pawns: FxPawn[], busy: Set<number>, home: Set<number>, time: number, tf: number, view: Bounds, zoom: number, dark: number, layer: Container): void {
    floor.clear();
    lit.clear();
    if (zoom < 0.45) {
      for (const r of this.routes) r.g.visible = false;
      return;
    }
    this.rescan(c, time, layer);
    const seenT = (x: number, y: number): boolean => x >= view.x0 - 1 && x <= view.x1 + 1 && y >= view.y0 - 1 && y <= view.y1 + 1;
    const tick = Math.floor(tf);
    const hour = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_HOUR;
    const day = Math.floor(tick / TICKS_PER_DAY);
    const season = Math.floor((day % (DAYS_PER_SEASON * 4)) / DAYS_PER_SEASON);
    const wet = c.weather >= 2;
    const fine = zoom >= 0.7;
    const s = c.stock;
    const wind = c.weather === 3 ? 3 : c.weather === 2 || c.weather === 1 ? 1.5 : c.weather === 5 ? 0.4 : 1;

    // ---- the working things ----
    if (fine) {
      for (const sp of this.spots) {
        if (!seenT(sp.x, sp.y)) continue;
        const px = sp.x * TS;
        const py = sp.y * TS;
        const cx = px + TS / 2;
        const cy = py + TS / 2;
        const on = busy.has(sp.b);
        const ph = time * 0.001 + sp.x * 0.37 + sp.y * 0.61;
        switch (sp.s) {
          case B.LOOM: {
            if (!on) break;
            // the shuttle flies across the warp and the beater comes down after it
            const u = (Math.sin(ph * 5) + 1) / 2;
            const beat = Math.max(0, Math.sin(ph * 5 + 1.6));
            floor.rect(px + 4, py + 6 + beat * 6, 16, 2).fill(0x3a2716);
            floor.roundRect(px + 3 + u * 12, py + 9, 7, 3, 1.5).fill(0xd9a85a).stroke({ width: 0.8, color: 0x3a2716 });
            // the cloth grows down the loom as the day goes on
            const woven = ((time * 0.00004 + sp.x * 0.1) % 1) * 4;
            floor.rect(px + 5, py + 13 - woven, 14, woven).fill({ color: 0xb86a6a, alpha: 0.9 });
            break;
          }
          case B.FORGE:
          case B.BLOOMERY: {
            const pump = on ? (Math.sin(ph * 4) + 1) / 2 : 0;
            const fy = sp.s === B.FORGE ? cy : cy - 1;
            // the coals brighten as the bellows breathe
            floor.circle(cx, fy, 3 + pump * 2.2).fill({ color: 0xffd36a, alpha: 0.35 + pump * 0.45 });
            if (sp.s === B.FORGE) {
              // the bellows at the forge's side
              const bw = 4 + (1 - pump) * 3;
              floor.poly([px + 1, cy - bw, px + 6, cy - 1.2, px + 6, cy + 1.2, px + 1, cy + bw]).fill(0x7a5232).stroke({ width: 0.7, color: 0x2a1d12 });
            } else {
              const bw = 2 + (1 - pump) * 2.5;
              floor.poly([px + 1, py + 18 - bw, px + 7, py + 17, px + 7, py + 19, px + 1, py + 18 + bw]).fill(0x8a6244).stroke({ width: 0.7, color: 0x2a1d12 });
            }
            if (on) {
              for (let k = 0; k < 3; k++) {
                const q = (time * 0.0015 + k / 3 + sp.x * 0.13) % 1;
                floor.circle(cx + Math.sin(q * 9 + k * 2) * 4, fy - q * 14, 0.9).fill({ color: 0xffc24a, alpha: 1 - q });
              }
            }
            break;
          }
          case B.ANVIL: {
            if (!on) break;
            // sparks fly each time the hammer comes down
            const beat = (time * 0.0022 + sp.x * 0.3) % 1;
            if (beat < 0.35) {
              const q = beat / 0.35;
              for (let k = 0; k < 6; k++) {
                const a = -Math.PI * (0.15 + 0.7 * h(sp.x + k, Math.floor(time * 0.0022), 44));
                const r = 3 + q * 9;
                floor.moveTo(cx - 1 + Math.cos(a) * r * 0.6, cy - 3 + Math.sin(a) * r * 0.6).lineTo(cx - 1 + Math.cos(a) * r, cy - 3 + Math.sin(a) * r + q * 3).stroke({ width: 1, color: k % 2 ? 0xffe28a : 0xffa83a, alpha: 1 - q });
              }
            }
            break;
          }
          case B.CAULDRON: {
            // bubbles rising and bursting on the brew
            const n = on ? 4 : 2;
            for (let k = 0; k < n; k++) {
              const q = (time * (on ? 0.0016 : 0.0008) + k / n + sp.x * 0.2) % 1;
              const bx = cx - 3.5 + h(sp.x, k + Math.floor(time * 0.0016 + k / n), 45) * 7;
              floor.circle(bx, cy + 1 - q * 1.5, 0.6 + q * 1.4).stroke({ width: 0.8, color: 0xc8e08a, alpha: 1 - q });
            }
            if (on) floor.roundRect(cx - 4, cy + 8.5, 8, 2.5, 1).fill({ color: 0xffd36a, alpha: 0.4 + 0.3 * Math.sin(ph * 6) });
            break;
          }
          case B.VAT: {
            if (!on) break;
            // the brewer's paddle goes round, the wort froths
            const a = ph * 2.2;
            floor.moveTo(cx, cy).lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7).stroke({ width: 1.6, color: 0x7a5232, cap: 'round' });
            for (let k = 0; k < 3; k++) {
              const q = (time * 0.0012 + k / 3) % 1;
              floor.circle(cx + Math.cos(a + 2 + k * 2) * 4, cy + Math.sin(a + 2 + k * 2) * 4, 0.8 + q).fill({ color: 0xf6f1e4, alpha: 0.8 * (1 - q) });
            }
            break;
          }
          case B.HEARTH:
          case B.STOVE:
          case B.BRAZIER: {
            if (!burning(c, sp.y * c.w + sp.x, sp.s, busy, home, hour)) break;
            // flames licking up
            const fx = sp.s === B.STOVE ? cx : cx - 0.5;
            const fy = sp.s === B.STOVE ? cy + 5 : cy + 1;
            for (let k = 0; k < 3; k++) {
              const fl = 1.5 + Math.abs(Math.sin(time * 0.011 + k * 2.1 + sp.x)) * (sp.s === B.STOVE ? 1.6 : 3.2);
              const ox = (k - 1) * (sp.s === B.STOVE ? 2.6 : 2);
              floor.poly([fx + ox - 1.4, fy, fx + ox, fy - fl, fx + ox + 1.4, fy]).fill({ color: k === 1 ? 0xfff1a8 : 0xffa83a, alpha: 0.85 });
            }
            break;
          }
          case B.MILLSTONE: {
            // the runner stone turns as long as the sails or the wheel do
            const b = this.blds.get(sp.b);
            const turn = b?.k === 'watermill' ? 1 : c.temp < -2 && c.weather === 0 ? 0 : wind;
            const a = (time * 0.0009 * turn) % (Math.PI * 2);
            for (let n = 0; n < 3; n++) {
              const ang = a + (n * Math.PI * 2) / 3;
              floor.moveTo(cx + Math.cos(ang) * 3, cy + Math.sin(ang) * 3).lineTo(cx + Math.cos(ang + 0.4) * 8.4, cy + Math.sin(ang + 0.4) * 8.4).stroke({ width: 1.1, color: 0x5a564c });
            }
            if (on) floor.circle(cx + Math.cos(a * 3) * 9, cy + Math.sin(a * 3) * 9, 1.4).fill({ color: 0xf4efe4, alpha: 0.6 });
            // the miller's sacks of flour, as many as the stores hold
            if (sp.ax >= 0) {
              const n = Math.max(0, Math.min(4, Math.ceil(s.flour / 25)));
              for (let k = 0; k < n; k++) sack(floor, sp.ax * TS + 6 + (k % 2) * 10, sp.ay * TS + 8 + Math.floor(k / 2) * 9, 0xe9e1cc);
            }
            break;
          }
          case B.OVEN: {
            // the fire flickers in its mouth; when the baker is in, the peel slides loaves in and out
            floor.roundRect(cx - 3.5, py + 15, 7, 4, 2).fill({ color: 0xffd36a, alpha: 0.3 + 0.3 * Math.abs(Math.sin(time * 0.006 + sp.x)) });
            if (on) {
              const u = (Math.sin(ph * 1.6) + 1) / 2;
              const ey = py + 17 + u * 9;
              floor.moveTo(cx, ey).lineTo(cx, ey + 9).stroke({ width: 1.4, color: 0x8a6440 });
              floor.ellipse(cx, ey, 3.4, 2).fill(0x8a6440);
              if (u > 0.5) floor.ellipse(cx, ey, 2.6, 1.4).fill(0xc98a3a);
            }
            // bread cooling on the rack
            if (sp.ax >= 0) {
              const rx = sp.ax * TS;
              const ry = sp.ay * TS;
              floor.rect(rx + 3, ry + 3, 18, 18).stroke({ width: 1.2, color: 0x6a4426 });
              floor.rect(rx + 3, ry + 9, 18, 1).rect(rx + 3, ry + 15, 18, 1).fill(0x6a4426);
              const n = Math.max(0, Math.min(9, Math.ceil(s.bread / 6)));
              for (let k = 0; k < n; k++) floor.ellipse(rx + 6.5 + (k % 3) * 5.5, ry + 6.5 + Math.floor(k / 3) * 6, 2.4, 1.6).fill(0xc98a3a).stroke({ width: 0.5, color: 0x6a3a1a });
            }
            break;
          }
          case B.KILN:
          case B.GLASSFURN: {
            // the fire breathes; when the potter or glazier is at work, heat shimmers off it
            const glow = 0.5 + 0.5 * Math.sin(time * 0.004 + sp.x);
            const hot = sp.s === B.GLASSFURN ? 0xfff2b0 : 0xffc24a;
            floor.circle(cx, cy, 3 + glow * 1.6).fill({ color: hot, alpha: on ? 0.55 : 0.25 });
            if (on) {
              for (let k = 0; k < 3; k++) {
                const q = (time * 0.0009 + k / 3 + sp.y * 0.1) % 1;
                floor.circle(cx + Math.sin(q * 8 + k) * 3, cy - 4 - q * 12, 1.2 + q * 2).stroke({ width: 0.8, color: 0xffe9c2, alpha: (1 - q) * 0.45 });
              }
              if (sp.s === B.GLASSFURN) {
                // a gather of glass glowing on the end of the pipe
                const a = ph * 0.8;
                floor.circle(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12, 1.8).fill(0xffb35a);
              }
            }
            break;
          }
          case B.TANVAT: {
            // the bark liquor stirs; the tanner works a hide down into it
            const q = (time * 0.0006 + sp.x * 0.2) % 1;
            floor.ellipse(cx - 1, cy + 1, 2 + q * 5, 1 + q * 3).stroke({ width: 0.8, color: 0x8a6a3a, alpha: (1 - q) * 0.7 });
            if (on) {
              const a = Math.sin(ph * 2) * 0.6;
              floor.moveTo(cx + Math.sin(a) * 2, cy + 2).lineTo(cx + 6 + Math.sin(a) * 6, cy - 8).stroke({ width: 1.6, color: 0x9a7a50, cap: 'round' });
            }
            break;
          }
          case B.DYEVAT: {
            // swirls on the dye, and the dyer's paddle going round
            const a = ph * (on ? 2.4 : 0.5);
            for (let k = 0; k < 2; k++) {
              const r = 2.5 + k * 2.6;
              const a0 = a + k * 2;
              floor.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a0 + 1.8).stroke({ width: 0.8, color: 0xffffff, alpha: 0.35 });
            }
            if (on) floor.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3).lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11 - 4).stroke({ width: 1.6, color: 0x9a7a50, cap: 'round' });
            break;
          }
          case B.JEWELBENCH: {
            if (!on) break;
            // a stone catching the lamplight as it is turned
            const tw = Math.max(0, Math.sin(time * 0.006 + sp.x));
            floor.star(px + 8 + (Math.floor(time * 0.0007) % 3) * 3, py + 10 + (Math.floor(time * 0.0005) % 2) * 3, 4, 2.6 * tw + 0.3, 0.6, time * 0.002).fill({ color: 0xffffff, alpha: tw });
            break;
          }
          case B.PRESS: {
            if (!on) break;
            // the platen screwed down onto the sheet and lifted again
            const u = (Math.sin(ph * 2) + 1) / 2;
            floor.rect(px + 5, py + 5 + u * 3, 14, 3).fill(0x5a3d28).stroke({ width: 0.7, color: 0x2a1d12 });
            floor.moveTo(cx - 6 * Math.cos(ph * 2), cy).lineTo(cx + 6 * Math.cos(ph * 2), cy).stroke({ width: 1.4, color: 0x3a3d45 });
            break;
          }
          default: break;
        }
      }
    }

    // ---- washing on the lines, and the dyers' cloth ----
    if (!wet && hour >= 7 && hour < 19 && season !== 3) {
      for (const ln of this.lines) {
        if (!seenT(ln.x, ln.y)) continue;
        // not every home washes every day; the dyers always have cloth out
        if (!ln.dye && h(ln.b, day, 46) > 0.5) continue;
        const x0 = ln.x * TS + (ln.h ? 2 : TS / 2);
        const y0 = ln.y * TS + (ln.h ? TS / 2 - 4 : 2);
        const len = ln.n * TS - 4;
        const x1 = ln.h ? x0 + len : x0;
        const y1 = ln.h ? y0 : y0 + len;
        floor.circle(x0, y0, 1.2).circle(x1, y1, 1.2).fill(0x5a3d28);
        floor.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 0.7, color: 0xe9e3d5, alpha: 0.9 });
        const items = ln.dye ? ln.n * 2 : ln.n * 2 - 1;
        const step = len / (items + 0.5);
        for (let k = 0; k < items; k++) {
          const col = ln.dye ? DYES[(k + ln.b) % DYES.length] : WASH[Math.floor(h(ln.b, k + day, 47) * WASH.length)];
          const sway = Math.sin(time * 0.003 * wind + k * 1.3 + ln.b) * 1.6 * wind;
          const along = (k + 0.5) * step + 1;
          const w = ln.dye ? step * 0.85 : 4 + h(ln.b, k, 48) * 3;
          const d = ln.dye ? 10 : 5 + h(ln.b, k, 49) * 3;
          if (ln.h) floor.poly([x0 + along, y0, x0 + along + w, y0, x0 + along + w + sway, y0 + d, x0 + along + sway, y0 + d]).fill(col);
          else floor.poly([x0, y0 + along, x0, y0 + along + w, x0 + d, y0 + along + w + sway, x0 + d, y0 + along + sway]).fill(col);
        }
      }
    }

    // ---- loads carried to work, children's games ----
    for (const p of pawns) {
      if (p.x < view.x0 * TS || p.x > view.x1 * TS || p.y < view.y0 * TS || p.y > view.y1 * TS) continue;
      if (p.k === 'play' && !p.moving && tf >= p.ta) {
        // a ball tossed up and caught
        const q = (time * 0.0016 + p.id * 0.37) % 1;
        floor.circle(p.x + 6 * p.size, p.y - 4 * p.size - Math.sin(q * Math.PI) * 12, 1.8).fill(0xe86a6a).stroke({ width: 0.6, color: 0xffffff });
        continue;
      }
      if (!p.moving || p.k !== 'work' || !p.w || !fine) continue;
      const kind = p.b ? this.blds.get(p.b) : undefined;
      const lk = loadFor(p.w, kind);
      if (lk) carry(floor, lk, p.x - 3 * p.size, p.y - 7 * p.size, p.size, kind?.mat ?? 0);
    }

    // ---- lamplight in the windows ----
    if (dark > 0.15) {
      const evening = hour >= 17 && hour < 23;
      for (const w of this.wins) {
        if (!seenT(w.x, w.y)) continue;
        const b = this.blds.get(w.b);
        const lived = !!b && b.beds.some((x) => x);
        if (!home.has(w.b) && !(evening && lived && h(w.b, day, 50) < 0.8)) continue;
        const a = dark * (0.75 + 0.1 * Math.sin(time * 0.003 + w.x * 1.7 + w.y));
        const px = w.x * TS;
        const py = w.y * TS;
        if (w.gl) {
          if (w.h) lit.rect(px + 6, py + 6, 12, 6).fill({ color: 0xffd27a, alpha: a }).rect(px + 11.5, py + 6, 1, 6).fill({ color: 0x2a1d12, alpha: a });
          else lit.rect(px + 9, py + 5, 6, 12).fill({ color: 0xffd27a, alpha: a }).rect(px + 9, py + 10.5, 6, 1).fill({ color: 0x2a1d12, alpha: a });
        } else if (w.h) lit.rect(px + 9, py + 7, 6, 4).fill({ color: 0xffb35c, alpha: a * 0.8 });
        else lit.rect(px + 10, py + 9, 4, 6).fill({ color: 0xffb35c, alpha: a * 0.8 });
      }
    }

    // ---- carts on the road ----
    const day0 = hour >= 7 && hour < 18;
    const harvest = season === 1 || season === 2;
    const mkt = marketOpen(c);
    for (const r of this.routes) {
      let go = false;
      if (r.kind === 'field') go = day0 && (harvest || busy.has(r.seed)) && !(c.weather >= 3);
      else go = (mkt ? hour >= 6 && hour < 16 : day0 && h(day, 1, 51) < 0.5) && c.weather < 4;
      if (!go) { r.g.visible = false; continue; }
      // to and fro along the road, resting a little at each end
      const speed = 0.03;
      const rest = 2500 * speed;
      const loop = 2 * (r.len + rest);
      const t = (time * speed + h(r.seed, 2, 52) * loop) % loop;
      let d: number;
      let out: boolean;
      if (t < rest) { d = 0; out = true; } else if (t < rest + r.len) { d = t - rest; out = true; } else if (t < 2 * rest + r.len) { d = r.len; out = false; } else { d = r.len - (t - 2 * rest - r.len); out = false; }
      let k = 1;
      while (k < r.cum.length - 1 && r.cum[k] < d) k++;
      const seg = r.cum[k] - r.cum[k - 1] || 1;
      const u = Math.max(0, Math.min(1, (d - r.cum[k - 1]) / seg));
      const x = r.xs[k - 1] + (r.xs[k] - r.xs[k - 1]) * u;
      const y = r.ys[k - 1] + (r.ys[k] - r.ys[k - 1]) * u;
      const vis = x >= view.x0 * TS && x <= view.x1 * TS && y >= view.y0 * TS && y <= view.y1 * TS;
      r.g.visible = vis;
      if (!vis) continue;
      let dx = r.xs[k] - r.xs[k - 1];
      let dy = r.ys[k] - r.ys[k - 1];
      if (!out) { dx = -dx; dy = -dy; }
      r.g.position.set(x, y + Math.abs(Math.sin(time * 0.012)) * 0.5);
      // turn toward the way it is going, not in one snap at each bend
      const want = Math.atan2(dy, dx);
      let turn = want - r.g.rotation;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      r.g.rotation += Math.abs(turn) > 2.5 ? turn : turn * 0.12;
      r.g.zIndex = y;
      // full going in from the fields (or in at the gate), empty coming back
      r.load.visible = out;
    }
  }
}

/** Should the fire on tile i be smoking? Shared with the chimney smoke in fx. */
export function burning(c: Colony, i: number, s: number, busy: Set<number>, home: Set<number>, hour: number): boolean {
  const b = c.sb[i];
  if (s === B.BRAZIER) return true;
  if (b && (busy.has(b) || home.has(b))) return true;
  if (s === B.HEARTH || s === B.STOVE) {
    const meal = (hour >= 6 && hour < 8) || (hour >= 11 && hour < 13) || (hour >= 17 && hour < 20);
    return hour >= 6 && hour < 22 && (c.temp < 10 || meal);
  }
  // the trades' fires are kept in through the working day
  return hour >= 7 && hour < 18;
}

/** What someone walking to work carries there. */
function loadFor(w: string, b: Bld | undefined): string {
  if (w === 'build') return 'beam';
  if (w === 'farm' || w === 'herd') return 'bucket';
  if (w === 'herbs' || w === 'heal') return 'herbs';
  const k = b?.k;
  switch (k) {
    case 'windmill': case 'watermill': case 'brewery': return 'sack';
    case 'bakery': return 'flour';
    case 'kitchen': case 'hall': return w === 'cook' ? 'basket' : '';
    case 'smithy': case 'steelworks': return 'ore';
    case 'kiln': return 'clay';
    case 'glassworks': return 'sand';
    case 'tannery': return 'hide';
    case 'dyeworks': case 'workshop': return 'cloth';
    case 'printer': return 'paper';
    default: return '';
  }
}

function sack(g: Graphics, x: number, y: number, col: number): void {
  g.roundRect(x - 3.6, y - 4, 7.2, 8, 2.6).fill(col).stroke({ width: 0.7, color: 0x6a5a3a });
  g.rect(x - 2, y - 4.2, 4, 1.2).fill(0x8a7a5a);
}

/** A load on the shoulder or in the arms. */
function carry(g: Graphics, k: string, x: number, y: number, size: number, mat: number): void {
  const s = Math.max(0.8, size);
  switch (k) {
    case 'beam':
      if (mat) g.rect(x - 4 * s, y - 2.4 * s, 8 * s, 5 * s).fill(0xb8bcc6).stroke({ width: 0.7, color: 0x4b4f58 });
      else {
        g.roundRect(x - 9 * s, y - 1.6 * s, 18 * s, 3.2 * s, 1.5 * s).fill(0xa47a4c).stroke({ width: 0.7, color: 0x3a2716 });
        g.circle(x + 9 * s, y, 1.4 * s).fill(0xd9b88a);
      }
      break;
    case 'bucket':
      g.moveTo(x + 8 * s, y + 3 * s).lineTo(x + 8 * s, y + 6 * s).stroke({ width: 0.6, color: 0x3a2716 });
      g.poly([x + 5.5 * s, y + 6 * s, x + 10.5 * s, y + 6 * s, x + 10 * s, y + 11 * s, x + 6 * s, y + 11 * s]).fill(0x8a6440).stroke({ width: 0.6, color: 0x2a1d12 });
      g.rect(x + 6 * s, y + 6.4 * s, 4 * s, 1 * s).fill(0x6fa8d0);
      break;
    case 'herbs':
      for (let k = 0; k < 3; k++) g.ellipse(x + (k - 1) * 2 * s, y, 1.4 * s, 3 * s).fill(k % 2 ? 0x6f9a4a : 0x8aa85a);
      break;
    case 'basket':
      g.roundRect(x - 3.5 * s, y - 1 * s, 7 * s, 4.5 * s, 1.5 * s).fill(0xb48a54).stroke({ width: 0.6, color: 0x5a3d28 });
      g.circle(x - 1.5 * s, y - 1 * s, 1.3 * s).circle(x + 1.6 * s, y - 1.2 * s, 1.2 * s).fill(0xd9733a);
      break;
    case 'ore':
    case 'clay':
    case 'sand': {
      const col = k === 'ore' ? 0x4b4f58 : k === 'clay' ? 0xa0603a : 0xe6d29a;
      g.roundRect(x - 3.5 * s, y - 1 * s, 7 * s, 4.5 * s, 1.5 * s).fill(0x8a6440).stroke({ width: 0.6, color: 0x3a2716 });
      g.ellipse(x, y - 1 * s, 3 * s, 1.6 * s).fill(col);
      break;
    }
    case 'hide':
      g.roundRect(x - 6 * s, y - 2 * s, 12 * s, 4 * s, 2 * s).fill(0xc9a27a).stroke({ width: 0.6, color: 0x6a4a2a });
      break;
    case 'cloth':
      g.rect(x - 4 * s, y - 2.6 * s, 8 * s, 2.6 * s).fill(0x2f5fa8).rect(x - 4 * s, y, 8 * s, 2.6 * s).fill(0xb83a3a);
      break;
    case 'paper':
      g.rect(x - 3.5 * s, y - 2.5 * s, 7 * s, 5 * s).fill(0xf4efe4).stroke({ width: 0.6, color: 0x6a5a3a });
      break;
    default: {
      // a sack over the shoulder: grain, or the baker's flour
      const col = k === 'flour' ? 0xf2ede0 : 0xd9c08a;
      g.roundRect(x - 4 * s, y - 3.5 * s, 8 * s, 7 * s, 2.6 * s).fill(col).stroke({ width: 0.6, color: 0x6a5a3a });
      g.rect(x + 2.6 * s, y - 2 * s, 1.6 * s, 3 * s).fill(0x8a7a5a);
      break;
    }
  }
}

/** A cart drawn facing +x, an ox in the shafts. */
function drawCart(g: Graphics, market: boolean): void {
  g.ellipse(2, 3, 20, 8).fill({ color: 0x0b1220, alpha: 0.2 });
  // the ox
  g.ellipse(14, 0, 6.5, 4.6).fill(market ? 0x6a4a32 : 0x8a6a4a).stroke({ width: 0.8, color: 0x2a1d12 });
  g.circle(20, 0, 3).fill(market ? 0x5a3d28 : 0x7a5a3a).stroke({ width: 0.7, color: 0x2a1d12 });
  g.moveTo(19.5, -2.6).lineTo(21.5, -4.6).moveTo(19.5, 2.6).lineTo(21.5, 4.6).stroke({ width: 1, color: 0xe9e3d5 });
  // shafts and the bed of the cart
  g.moveTo(-2, -4).lineTo(10, -3).moveTo(-2, 4).lineTo(10, 3).stroke({ width: 1.2, color: 0x5a3d28 });
  g.rect(-1, -9, 3, 2.6).rect(-1, 6.4, 3, 2.6).fill(0x2a1d12);
  g.roundRect(-13, -7, 14, 14, 1.5).fill(0xa47a4c).stroke({ width: 1, color: 0x3a2716 });
  g.rect(-12, -1, 12, 1).fill({ color: 0x5a3d28, alpha: 0.7 });
}

/** What is in the cart: sacks from the fields, or barrels and crates for the market. */
function drawLoad(g: Graphics, market: boolean): void {
  if (market) {
    g.circle(-9, -3, 3).fill(0x9a6a3c).stroke({ width: 0.7, color: 0x2a1d12 });
    g.circle(-9, 3, 3).fill(0x9a6a3c).stroke({ width: 0.7, color: 0x2a1d12 });
    g.rect(-5, -4.5, 5, 9).fill(0xb48a54).stroke({ width: 0.7, color: 0x2a1d12 });
  } else {
    for (const [x, y] of [[-10, -3.5], [-10, 3.5], [-4, -3.5], [-4, 3.5], [-7, 0]] as const) sack(g, x, y, 0xd9c08a);
  }
}

/** A tile a cart can roll over: open ground, roads and paving, the gate. */
function passable(c: Colony, i: number): boolean {
  const s = c.st[i];
  if (s !== B.NONE && s !== B.PAVING && s !== B.GATE && s !== B.TILLED) return false;
  const t = c.ter[i];
  if (t === T.DEEP || t === T.ROCK) return false;
  const f = c.feat[i];
  return f === F.NONE || f === F.FLOWERS || f === F.HERB || f === F.MUSHROOM || f === F.STUMP;
}

/**
 * The way a cart goes from one tile to another, keeping to the roads where it can (the view's own
 * search, run only when a cart's ends change, so the colony's pathing is untouched).
 */
export function route(c: Colony, sx: number, sy: number, tx: number, ty: number): number[] | null {
  const W = c.w;
  const x0 = 0;
  const y0 = 0;
  const x1 = W - 1;
  const y1 = c.h - 1;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const dist = new Int32Array(n).fill(0x3fffffff);
  const prev = new Int32Array(n).fill(-1);
  // a bucket queue: steps cost 2 on a road and 5 off it
  const buckets: number[][] = [];
  const at = (x: number, y: number): number => (y - y0) * bw + (x - x0);
  const s0 = at(sx, sy);
  const goal = at(tx, ty);
  dist[s0] = 0;
  buckets[0] = [s0];
  let cur = 0;
  let left = 1;
  while (left > 0) {
    const bk = buckets[cur];
    if (!bk || !bk.length) { cur++; continue; }
    const v = bk.pop() as number;
    left--;
    if (dist[v] !== cur) continue;
    if (v === goal) break;
    const vx = (v % bw) + x0;
    const vy = Math.floor(v / bw) + y0;
    for (let k = 0; k < 4; k++) {
      const nx = vx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = vy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const gi = ny * W + nx;
      const u = at(nx, ny);
      if (u !== goal && u !== s0 && !passable(c, gi)) continue;
      const t = c.ter[gi];
      const road = t === T.PATH || t === T.STONE || c.st[gi] === B.PAVING || c.st[gi] === B.GATE;
      // (a ford through the shallows if there is no other way)
      const nd = cur + (road ? 2 : t === T.SHALLOW ? 12 : 5);
      if (nd >= dist[u]) continue;
      dist[u] = nd;
      prev[u] = v;
      (buckets[nd] ??= []).push(u);
      left++;
    }
  }
  if (prev[goal] < 0) return null;
  const out: number[] = [];
  for (let v = goal; v >= 0; v = prev[v]) {
    out.push((Math.floor(v / bw) + y0) * W + (v % bw) + x0);
    if (v === s0) break;
  }
  out.reverse();
  // drop the tiles the cart can glide past (it cuts across little jogs in the road instead of
  // turning at every step)
  const keep = new Uint8Array(out.length);
  keep[0] = 1;
  keep[out.length - 1] = 1;
  const simplify = (a: number, b: number): void => {
    const ax = out[a] % W;
    const ay = Math.floor(out[a] / W);
    const bx = out[b] % W;
    const by = Math.floor(out[b] / W);
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) || 1;
    let far = 0;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const px = out[k] % W;
      const py = Math.floor(out[k] / W);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > far) { far = d; at = k; }
    }
    if (at >= 0 && far > 0.75) {
      keep[at] = 1;
      simplify(a, at);
      simplify(at, b);
    }
  };
  simplify(0, out.length - 1);
  const pts: number[] = [];
  for (let k = 0; k < out.length; k++) if (keep[k]) pts.push(out[k]);
  return pts.length >= 2 ? pts : null;
}
