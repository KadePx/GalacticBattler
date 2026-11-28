// Daily life in the streets, drawn: hens scratching in the yards, a dog by a door and a cat on a
// step, pigeons round the fountain that go up when someone walks through them, children passing a
// ball and bowling a hoop, a warden walking the wall, a wedding party with its garland and a funeral
// with its bier, sheaves standing in a reaped field, and the street lamps coming on one by one as the
// lamplighter reaches them. What is where comes from streetlife.ts (the colony and the clock, nothing
// kept); this file only draws it, and only what is on screen.

import type { Graphics } from 'pixi.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { marketOpen } from '../sim/market';
import { B, type Colony, type Pawn } from '../sim/types';
import type { Bounds, FxPawn } from './fx';
import { FLOCK, ROOKS, beatAt, hensOut, lampOn, onBeat, pigeon, rook, rooksOut, scan, yardActor, type Actor, type Scene } from './streetlife';
import { TS, hash2 } from './tiles';

const INK = 0x2a1d12;
const HEN = [[0xf4efe4, 0x8a8070], [0xb9783f, 0x5d3a1e], [0x3a3532, 0x15120f], [0xd9c7a0, 0x7a6a4a]];
const CAT = [0x8d8f96, 0xd98a3a, 0x2c2a2a, 0xe9e3d5, 0xa8845a];
const DOG = [0x9a6a3c, 0x5a4636, 0xd9c7a0, 0x3a3532];
const PETAL = [0xf2a8c0, 0xffffff, 0xf6d86a, 0xe86a8a];

export class Street {
  scene: Scene | null = null;
  /** each street lamp's place in the lamplighter's round, by tile */
  private lampIdx = new Map<number, number>();
  private key = '';
  private stamp = -1;
  private act: Actor = { k: 'hen', x: 0, y: 0, face: 1, moving: false, u: 0, id: 0 };
  private at = { x: 0, y: 0, moving: false };
  private kids: FxPawn[] = [];
  private walkers: FxPawn[] = [];

  reset(): void {
    this.scene = null;
    this.lampIdx.clear();
    this.key = '';
    this.stamp = -1;
  }

  /** Re-read the town every few seconds (and at once when something is built or the hour turns). */
  private rescan(c: Colony, time: number, ground: Graphics): Scene {
    const stamp = Math.floor(time / 4000);
    const key = `${c.blds.length}|${Math.floor(c.tick / TICKS_PER_HOUR)}`;
    if (this.scene && stamp === this.stamp && key === this.key) return this.scene;
    this.stamp = stamp;
    this.key = key;
    const s = (this.scene = scan(c));
    this.lampIdx.clear();
    for (let k = 0; k < s.lamps.length; k++) this.lampIdx.set(s.lamps[k], k);
    // the sheaves stand still: drawn once here, not every frame
    ground.clear();
    for (const f of s.reaped) {
      for (const i of f.tiles) {
        if (hash2(i, f.b, 80) > 0.62) continue;
        const x = (i % c.w + 0.5) * TS + (hash2(i, 1, 81) - 0.5) * 6;
        const y = (Math.floor(i / c.w) + 0.5) * TS + (hash2(i, 2, 81) - 0.5) * 5;
        if (f.veg) crate(ground, x, y, i);
        else stook(ground, x, y);
      }
    }
    return s;
  }

  /** Is the lamp on this tile burning? (True for a lamp the round does not know yet.) */
  lampLit(c: Colony, tf: number, tile: number): boolean {
    const n = this.lampIdx.get(tile);
    return n === undefined || lampOn(c, tf, n);
  }

  /**
   * Where the view shows someone, when that is not quite where the colony has them: a warden on
   * watch walks the wall by his tower, the pairs of a procession walk side by side, two on a bench
   * sit apart, and children at play outdoors scamper about their spot.
   */
  shift(c: Colony, p: Pawn, tf: number, time: number, pos: { x: number; y: number; moving: boolean }): void {
    const a = p.act;
    if (pos.moving) {
      if (a.why !== 'procession' || !a.path || a.path.length < 2) return;
      // which way the column is heading here
      const W = c.w;
      const f = Math.max(0, (tf - a.t0) / (a.ta - a.t0)) * (a.path.length - 1);
      const i = Math.min(a.path.length - 2, Math.floor(f));
      const dx = (a.path[i + 1] % W) - (a.path[i] % W);
      const dy = Math.floor(a.path[i + 1] / W) - Math.floor(a.path[i] / W);
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const side = (a.d ?? 0) & 1 ? 1 : -1;
      pos.x += (-dy / len) * side * 7;
      pos.y += (dx / len) * side * 7;
      return;
    }
    if (a.k === 'work') {
      if (!this.scene || !onBeat(p, tf)) return;
      const beat = this.scene.beats.get(a.b as number);
      if (beat && beatAt(beat, p, tf, this.at)) { pos.x = this.at.x; pos.y = this.at.y; pos.moving = true; }
    } else if (a.k === 'relax') {
      if (a.why === 'bench' && tf >= a.ta) { pos.x += p.id & 1 ? 5 : -5; pos.y -= 2; }
    } else if (a.k === 'play') {
      if (a.why !== 'child' || tf < a.ta || c.sb[a.ty * c.w + a.tx] !== 0) return;
      pos.x += Math.sin(time * 0.0031 + p.id * 1.7) * 5;
      pos.y += Math.cos(time * 0.0043 + p.id * 2.3) * 3.5;
    }
  }

  /**
   * Draw this frame. `ground` holds what stands still (redrawn only when the town is re-read), `low`
   * lies under the people, `top` over them, `lit` over the night's shade.
   */
  draw(ground: Graphics, low: Graphics, top: Graphics, lit: Graphics, c: Colony, pawns: FxPawn[], tf: number, time: number, view: Bounds, zoom: number, dark: number): void {
    low.clear();
    top.clear();
    lit.clear();
    const s = this.rescan(c, time, ground);
    ground.visible = zoom >= 0.45;
    if (zoom < 0.45) return;
    const seenT = (x: number, y: number, pad = 1): boolean => x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad;
    const a = this.act;
    // from far off the small creatures are drawn as a couple of dabs each: nothing finer would show
    const far = zoom < 0.85;

    // ---- the yards ----
    const hens = hensOut(c, tf);
    for (const y of s.yards) {
      if (!seenT(y.x, y.y, 3) || (y.k === 'hen' && !hens)) continue;
      for (let k = 0; k < y.n; k++) {
        yardActor(y, k, tf, a);
        if (far) dab(low, a, y.k === 'hen' ? HEN[a.id % HEN.length][0] : y.k === 'dog' ? DOG[a.id % DOG.length] : CAT[a.id % CAT.length], y.k === 'dog' ? 5.4 : 3.4, time);
        else if (y.k === 'hen') hen(low, a, time);
        else if (y.k === 'dog') dog(low, a, time, dark);
        else cat(low, a, time);
      }
    }

    // ---- pigeons round the fountain (not on market day, when the square is full of stalls) ----
    const day = Math.floor(tf / TICKS_PER_DAY);
    const winterStorm = c.weather >= 2 && c.temp < 0;
    if (hens && !winterStorm && !marketOpen(c)) {
      for (const at of s.flocks) {
        const fx = at % c.w;
        const fy = Math.floor(at / c.w);
        if (!seenT(fx, fy, 4)) continue;
        // how near is the nearest person on the move?
        let near = 1e9;
        const px = (fx + 0.5) * TS;
        const py = (fy + 0.5) * TS;
        for (const p of pawns) {
          if (!p.moving) continue;
          const d = Math.abs(p.x - px) + Math.abs(p.y - py);
          if (d < near) near = d;
        }
        for (let k = 0; k < FLOCK; k++) if (pigeon(c, at, k, tf, near, a)) { if (far) dab(a.lift ? top : low, a, 0x8d95a3, 3, time); else bird(a.lift ? top : low, a, time); }
      }
    }
    void day;

    // ---- rooks on the towers ----
    if (rooksOut(c, tf)) {
      for (let j = 0; j < s.roosts.length; j += 2) {
        if (!seenT(s.roosts[j] / TS, s.roosts[j + 1] / TS, 5)) continue;
        for (let k = 0; k < ROOKS; k++) { rook(s.roosts[j], s.roosts[j + 1], k, tf, a); if (far) dab(top, a, 0x24262c, 2.8, time); else crow(top, a, time); }
      }
    }

    // ---- children's games, the procession, the lamplighter at a lamp ----
    const kids = this.kids;
    const walkers = this.walkers;
    kids.length = 0;
    walkers.length = 0;
    for (const p of pawns) {
      if (p.why === 'procession' || p.why === 'form') { if (p.why === 'procession' ? p.moving : tf >= p.ta) walkers.push(p); continue; }
      if (p.x < view.x0 * TS || p.x > view.x1 * TS || p.y < view.y0 * TS || p.y > view.y1 * TS) continue;
      if (p.kid && !p.moving && tf >= p.ta) kids.push(p);
      else if (p.k === 'lamps' && !p.moving && tf >= p.ta && p.d !== undefined && s.lamps[p.d] !== undefined) {
        // the pole goes up, the wick catches
        const i = s.lamps[p.d];
        const lx = (i % c.w + 0.5) * TS;
        const ly = (Math.floor(i / c.w) + 0.5) * TS - 2;
        top.moveTo(p.x + 5 * p.size, p.y - 6 * p.size).lineTo(lx, ly).stroke({ width: 1.2, color: 0x6a4426, cap: 'round' });
        const u = Math.min(1, (tf - p.ta) / 0.8);
        const fl = 0.6 + 0.4 * Math.sin(time * 0.03);
        lit.circle(lx, ly, 2 + u * 3 * fl).fill({ color: 0xffe9a8, alpha: 0.5 + 0.4 * u });
        lit.circle(lx, ly, 6 + u * 6).fill({ color: 0xffc24a, alpha: 0.12 + 0.15 * u * fl });
      }
    }
    this.games(top, kids, time);
    if (walkers.length >= 2 && c.gath) this.procession(low, top, c.gath.k === 'funeral', walkers, time);

    // ---- the street lamps: dark glass until they are lit, a living flame after ----
    for (let k = 0; k < s.lamps.length; k++) {
      const i = s.lamps[k];
      const tx = i % c.w;
      const ty = Math.floor(i / c.w);
      if (!seenT(tx, ty) || c.st[i] !== B.LAMPPOST) continue;
      const cx = (tx + 0.5) * TS;
      const cy = (ty + 0.5) * TS;
      if (!lampOn(c, tf, k)) {
        low.circle(cx, cy, 11.5).fill({ color: 0x2c2f36, alpha: 0.1 });
        low.rect(cx - 2.2, cy - 4.2, 4.4, 4.4).fill(0x4a4f5a);
        low.rect(cx - 2.2, cy - 4.2, 4.4, 1.2).fill({ color: 0x9aa3b0, alpha: 0.5 });
      } else if (dark > 0.05) {
        const fl = 0.75 + 0.25 * Math.sin(time * 0.011 + i * 1.3) * Math.sin(time * 0.0037 + i);
        lit.circle(cx, cy - 2, 7).fill({ color: 0xffc24a, alpha: 0.16 * dark * fl });
        lit.rect(cx - 2.2, cy - 4.2, 4.4, 4.4).fill({ color: 0xffe9a8, alpha: 0.9 * Math.min(1, dark * 2) });
        lit.circle(cx, cy - 2, 1.2 * fl).fill({ color: 0xffffff, alpha: Math.min(1, dark * 2) });
      }
    }
  }

  /** Children at play, grouped with whoever is near: a ball passed round, or alone a hoop bowled or a ball tossed. */
  private games(g: Graphics, kids: FxPawn[], time: number): void {
    const R = TS * 3.5;
    for (let i = 0; i < kids.length; i++) USED[i] = 0;
    for (let i = 0; i < kids.length; i++) {
      const p = kids[i];
      if (USED[i]) continue;
      let n = 1;
      const grp = GRP;
      grp[0] = p;
      for (let j = i + 1; j < kids.length && n < 4; j++) {
        const o = kids[j];
        if (USED[j] || Math.abs(o.x - p.x) > R || Math.abs(o.y - p.y) > R) continue;
        USED[j] = 1;
        grp[n++] = o;
      }
      if (n === 1) {
        if (p.id % 2) {
          // a hoop bowled to and fro with a stick
          const u = Math.sin(time * 0.0022 + p.id);
          const hx = p.x + 9 * p.size + u * 7;
          const hy = p.y + 3 * p.size;
          g.ellipse(hx, hy, 2.2 + Math.abs(Math.cos(time * 0.0022 + p.id)) * 1.6, 4.2).stroke({ width: 1, color: 0x8a5a2e });
          g.moveTo(p.x + 4 * p.size, p.y - 1).lineTo(hx - 1, hy - 2).stroke({ width: 0.8, color: 0x5a3d28 });
        } else {
          // a ball tossed up and caught
          const q = (time * 0.0016 + p.id * 0.37) % 1;
          g.circle(p.x + 6 * p.size, p.y - 4 * p.size - Math.sin(q * Math.PI) * 12, 1.8).fill(0xe86a6a).stroke({ width: 0.6, color: 0xffffff });
        }
        continue;
      }
      // the ball goes round the ring: one throw every second or so
      const t = time * 0.0011 + p.id * 0.37;
      const k = Math.floor(t) % n;
      const u = t - Math.floor(t);
      const from = grp[k];
      const to = grp[(k + 1) % n];
      const bx = from.x + (to.x - from.x) * u;
      const by = from.y - 5 + (to.y - from.y) * u - Math.sin(u * Math.PI) * 13;
      g.ellipse(from.x + (to.x - from.x) * u, from.y + 5 + (to.y - from.y) * u, 2.2, 1).fill({ color: 0x0b1220, alpha: 0.18 });
      g.circle(bx, by, 2.1).fill(0xe86a6a).stroke({ width: 0.6, color: 0xffffff });
    }
  }

  /** A wedding party: the two of them under a garland, petals thrown after them. A funeral: the bier on four shoulders. */
  private procession(low: Graphics, top: Graphics, funeral: boolean, w: FxPawn[], time: number): void {
    w.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    const a = w[0];
    const b = w[1];
    if ((a.d ?? 9) > 1 || (b.d ?? 9) > 3) return;
    if (funeral) {
      // the bier rides between the first two pairs, along the way they are going
      let n = 0;
      let cx = 0;
      let cy = 0;
      let hx = 0;
      let hy = 0;
      let tx = 0;
      let ty = 0;
      let nh = 0;
      let nt = 0;
      for (const p of w) {
        const d = p.d ?? 9;
        if (d > 3) break;
        n++;
        cx += p.x;
        cy += p.y;
        if (d < 2) { hx += p.x; hy += p.y; nh++; } else { tx += p.x; ty += p.y; nt++; }
      }
      if (n < 2) return;
      cx /= n;
      cy = cy / n - 7;
      let dx = 1;
      let dy = 0;
      if (nh && nt) { dx = hx / nh - tx / nt; dy = hy / nh - ty / nt; }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;
      const P = (u: number, v: number): [number, number] => [cx + dx * u - dy * v, cy + dy * u + dx * v];
      const quad = (u0: number, v0: number, u1: number, v1: number): number[] => [...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v1)];
      low.ellipse(cx, cy + 13, 16, 6).fill({ color: 0x0b1220, alpha: 0.22 });
      for (const v of [-6, 6]) top.moveTo(...P(-17, v)).lineTo(...P(17, v)).stroke({ width: 1.8, color: 0x4a3220, cap: 'round' });
      top.poly(quad(-12, -5.6, 12, 5.6)).fill(0xf2ecdc).stroke({ width: 1.1, color: INK });
      top.poly(quad(-12, -5.6, -4, 5.6)).fill({ color: 0x8a7a5a, alpha: 0.22 });
      // the black pall laid along it, and a wreath
      top.poly(quad(-10, -2, 10, 2)).fill({ color: 0x22242b, alpha: 0.85 });
      const [wx, wy] = P(5, 0);
      top.circle(wx, wy, 3.2).stroke({ width: 1.8, color: 0x4f7a3a });
      top.circle(wx + 2.2, wy - 2, 1.1).circle(wx - 2.4, wy + 1.6, 1).fill(0xf4efe4);
      return;
    }
    // the garland the two of them carry between them, looped up over their heads, and a crown of flowers each
    const sway = Math.sin(time * 0.004) * 1.5;
    const ax = a.x;
    const ay = a.y - 9 * a.size;
    const bx = b.x;
    const by = b.y - 9 * b.size;
    const mx = (ax + bx) / 2 + sway;
    const my = Math.min(ay, by) - 13;
    top.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by).stroke({ width: 2.2, color: 0x3f6a2e, cap: 'round' });
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      const gx = (1 - u) * (1 - u) * ax + 2 * u * (1 - u) * mx + u * u * bx;
      const gy = (1 - u) * (1 - u) * ay + 2 * u * (1 - u) * my + u * u * by;
      top.circle(gx, gy, 2.3).fill(PETAL[k % PETAL.length]).stroke({ width: 0.5, color: 0x8a3a5a });
    }
    // those behind throw petals over them
    for (const p of w) {
      if ((p.d ?? 0) < 2) continue;
      for (let k = 0; k < 3; k++) {
        const q = (time * 0.0009 + k / 3 + p.id * 0.23) % 1;
        const sx = hash2(p.id, k + Math.floor(time * 0.0009 + k / 3 + p.id * 0.23), 82) - 0.5;
        top.ellipse(p.x + sx * 26 * q, p.y - 8 * p.size - Math.sin(q * Math.PI) * 15 + q * 12, 2.3, 1.4).fill({ color: PETAL[(p.id + k) % PETAL.length], alpha: q < 0.8 ? 0.95 : (1 - q) * 4.5 });
      }
    }
  }
}

const GRP: FxPawn[] = [];
const USED: number[] = [];

/** A small creature seen from far off: a body and a head, or a pair of wings if it is in the air. */
function dab(g: Graphics, a: Actor, col: number, r: number, time: number): void {
  if (a.lift) {
    const flap = Math.sin(time * 0.035 + a.id) * r;
    g.moveTo(a.x - r * 1.8, a.y - flap).lineTo(a.x, a.y).lineTo(a.x + r * 1.8, a.y - flap).stroke({ width: 1.8, color: col });
    return;
  }
  const bob = a.moving ? Math.abs(Math.sin(time * 0.02 + a.id)) * 1.2 : 0;
  g.ellipse(a.x, a.y - bob, r, r * 0.72).circle(a.x + r * 0.9 * a.face, a.y - r * 0.6 - bob, r * 0.5).fill(col);
}

/** A hen: walking with a bob, or head down pecking at the ground. */
function hen(g: Graphics, a: Actor, time: number): void {
  const [body, edge] = HEN[a.id % HEN.length];
  const f = a.face;
  const x = a.x;
  const peck = !a.moving && Math.sin(time * 0.009 + a.id * 2.1) > 0.25 ? Math.abs(Math.sin(time * 0.021 + a.id)) : 0;
  const y = a.y - (a.moving ? Math.abs(Math.sin(time * 0.024 + a.id)) * 1.2 : 0);
  g.ellipse(x + 0.4, a.y + 3, 4.2, 1.5).fill({ color: 0x0b1220, alpha: 0.2 });
  if (a.moving) {
    const st = Math.sin(time * 0.024 + a.id) * 1.4;
    g.moveTo(x - 0.8 + st, y + 2).lineTo(x - 0.8 + st, y + 3.6).moveTo(x + 0.8 - st, y + 2).lineTo(x + 0.8 - st, y + 3.6).stroke({ width: 0.7, color: 0xe2933a });
  }
  g.poly([x - 3.2 * f, y - 1.2, x - 5 * f, y - 3, x - 2.8 * f, y + 0.6]).fill(edge);
  g.ellipse(x, y + 0.6, 3.5, 2.8).fill(body).stroke({ width: 0.6, color: edge });
  const hx = x + (2.8 + peck * 1.6) * f;
  const hy = y - 2 + peck * 4;
  g.circle(hx, hy, 1.8).fill(body).stroke({ width: 0.6, color: edge });
  g.poly([hx + 1.4 * f, hy - 0.3, hx + 3 * f, hy + 0.3 + peck, hx + 1.4 * f, hy + 0.8]).fill(0xe2933a);
  g.poly([hx - 0.8 * f, hy - 1.6, hx, hy - 2.9, hx + 0.8 * f, hy - 1.6]).fill(0xd2445a);
}

/** A yard dog: trotting across the yard, or lying with its head up and its tail going. */
function dog(g: Graphics, a: Actor, time: number, dark: number): void {
  const col = DOG[a.id % DOG.length];
  const f = a.face;
  const x = a.x;
  const y = a.y;
  g.ellipse(x + 0.5, y + 4, 7, 2.2).fill({ color: 0x0b1220, alpha: 0.22 });
  const asleep = dark > 0.8;
  const wag = asleep ? 0 : Math.sin(time * 0.02 + a.id) * 1.8;
  if (a.moving) {
    const st = Math.sin(time * 0.022 + a.id) * 1.6;
    for (const lx of [-3.4, -1.6, 2.2, 3.8]) g.moveTo(x + lx * f, y + 1.4).lineTo(x + (lx + (lx < 0 ? st : -st)) * f, y + 5).stroke({ width: 1.3, color: INK, cap: 'round' });
    g.ellipse(x, y - 0.4, 5.8, 3.1).fill(col).stroke({ width: 0.6, color: INK });
    g.moveTo(x - 5 * f, y - 0.8).quadraticCurveTo(x - 7.6 * f, y - 4.6 + wag, x - 6.4 * f + wag * 0.5, y - 5.6).stroke({ width: 1.4, color: col, cap: 'round' });
    g.circle(x + 5.6 * f, y - 2.8, 2.9).fill(col).stroke({ width: 0.6, color: INK });
    g.ellipse(x + 7.8 * f, y - 2, 1.6, 1.2).fill(col);
    g.circle(x + 9 * f, y - 2.2, 0.6).fill(0x1b1b1b);
    g.ellipse(x + 4.8 * f, y - 4.8, 1.1, 2).fill(INK);
  } else {
    // lying down, paws out in front
    g.ellipse(x, y + 1.6, 6.4, 2.9).fill(col).stroke({ width: 0.6, color: INK });
    g.moveTo(x - 5.6 * f, y + 1.6).quadraticCurveTo(x - 8.6 * f, y + 1 + wag, x - 8 * f, y - 1.6 + wag).stroke({ width: 1.4, color: col, cap: 'round' });
    g.roundRect(x + (f > 0 ? 3.6 : -7.6), y + 2.6, 4, 1.4, 0.7).fill(col).stroke({ width: 0.4, color: INK });
    const hy = asleep ? y + 1.2 : y - 1.6 + Math.sin(time * 0.002 + a.id) * 0.4;
    g.circle(x + 5.6 * f, hy, 2.8).fill(col).stroke({ width: 0.6, color: INK });
    g.ellipse(x + 7.6 * f, hy + 0.8, 1.5, 1.1).fill(col);
    g.circle(x + 8.8 * f, hy + 0.6, 0.6).fill(0x1b1b1b);
    g.ellipse(x + 4.6 * f, hy - 1.6, 1.1, 1.9).fill(INK);
  }
}

/** A cat: padding along with its tail up, or sitting and washing a paw. */
function cat(g: Graphics, a: Actor, time: number): void {
  const col = CAT[a.id % CAT.length];
  const f = a.face;
  const x = a.x;
  const y = a.y;
  g.ellipse(x + 0.3, y + 3.4, 4.4, 1.5).fill({ color: 0x0b1220, alpha: 0.2 });
  const flick = Math.sin(time * 0.006 + a.id * 1.3);
  if (a.moving) {
    const st = Math.sin(time * 0.02 + a.id) * 1.2;
    for (const lx of [-2.4, 2.2]) g.moveTo(x + lx * f, y + 1).lineTo(x + (lx + (lx < 0 ? st : -st)) * f, y + 3.6).stroke({ width: 1, color: INK, cap: 'round' });
    g.ellipse(x, y, 4.2, 2.1).fill(col).stroke({ width: 0.5, color: INK });
    g.moveTo(x - 4 * f, y - 0.4).quadraticCurveTo(x - 6.4 * f, y - 3, x - 5.4 * f + flick, y - 6).stroke({ width: 1.1, color: col, cap: 'round' });
    head(g, x + 4.2 * f, y - 1.6, col);
  } else {
    // sitting upright, tail curled round
    g.ellipse(x, y + 0.6, 3, 3.3).fill(col).stroke({ width: 0.5, color: INK });
    g.moveTo(x - 2.4 * f, y + 3).quadraticCurveTo(x - 5.6 * f, y + 3.6, x - 4.6 * f + flick * 0.8, y + 0.6).stroke({ width: 1.1, color: col, cap: 'round' });
    // now and then a paw comes up to be washed
    const wash = a.u > 0.3 && a.u < 0.55 ? Math.abs(Math.sin(time * 0.012)) : 0;
    head(g, x + 0.8 * f, y - 3.4 + wash * 0.8, col);
    if (wash) g.circle(x + 2.4 * f, y - 1.8 - wash, 0.9).fill(col).stroke({ width: 0.4, color: INK });
  }
}

function head(g: Graphics, x: number, y: number, col: number): void {
  g.poly([x - 2, y - 1, x - 1.6, y - 3.4, x - 0.3, y - 1.8]).poly([x + 2, y - 1, x + 1.6, y - 3.4, x + 0.3, y - 1.8]).fill(col).stroke({ width: 0.4, color: INK });
  g.circle(x, y, 2.1).fill(col).stroke({ width: 0.5, color: INK });
  g.circle(x - 0.8, y - 0.2, 0.35).circle(x + 0.8, y - 0.2, 0.35).fill(0x1b1b1b);
}

/** A pigeon: a grey dab on the paving, bobbing as it walks; wings out when it goes up. */
function bird(g: Graphics, a: Actor, time: number): void {
  const x = a.x;
  const y = a.y;
  const lift = a.lift ?? 0;
  if (lift > 0) {
    const flap = Math.sin(time * 0.045 + a.id) * 3.2;
    g.ellipse(x + 4 * lift, y + 10 * lift + 4, 2.6, 1).fill({ color: 0x0b1220, alpha: 0.14 });
    g.moveTo(x - 6, y - flap).lineTo(x, y).lineTo(x + 6, y - flap).stroke({ width: 2, color: 0x6a7280, cap: 'round', join: 'round' });
    g.ellipse(x, y, 3, 1.8).fill(0x8d95a3).stroke({ width: 0.5, color: 0x3a3d45 });
    return;
  }
  const bob = a.moving ? Math.sin(time * 0.03 + a.id) * 0.9 : Math.sin(time * 0.008 + a.id * 1.9) > 0.5 ? 1.4 : 0;
  const f = a.face;
  g.ellipse(x + 0.4, y + 2.8, 3.8, 1.2).fill({ color: 0x0b1220, alpha: 0.22 });
  g.poly([x - 2.6 * f, y - 0.4, x - 5.8 * f, y + 1.2, x - 2.4 * f, y + 1.6]).fill(0x4a4f5a);
  g.ellipse(x, y, 3.7, 2.6).fill(a.id % 3 ? 0x8d95a3 : 0xd4d7de).stroke({ width: 0.6, color: 0x3a3d45 });
  g.moveTo(x - 1.6 * f, y - 0.4).lineTo(x + 1 * f, y + 0.8).stroke({ width: 0.8, color: 0x3a3d45 });
  g.circle(x + 3.2 * f, y - 1.8 + bob, 1.7).fill(0x5a6472).stroke({ width: 0.5, color: 0x2a2d35 });
  g.poly([x + 4.6 * f, y - 2 + bob, x + 6.2 * f, y - 1.5 + bob, x + 4.6 * f, y - 1 + bob]).fill(0xe2933a);
}

/** A rook: a black shape hunched on the stone, or wings beating as it goes round the tower. */
function crow(g: Graphics, a: Actor, time: number): void {
  const x = a.x;
  const y = a.y;
  const lift = a.lift ?? 0;
  if (lift > 0) {
    const flap = Math.sin(time * 0.03 + a.id) * 3.6;
    g.ellipse(x + 5 * lift, y + 12 * lift + 3, 3.2, 1.1).fill({ color: 0x0b1220, alpha: 0.13 });
    g.moveTo(x - 5.6, y - flap - 1).lineTo(x - 2, y).lineTo(x + 2, y).lineTo(x + 5.6, y - flap - 1).stroke({ width: 1.8, color: 0x1c1d22, cap: 'round', join: 'round' });
    g.ellipse(x, y, 2.8, 1.5).fill(0x24262c);
    g.poly([x + 2.4 * a.face, y - 0.6, x + 4.6 * a.face, y, x + 2.4 * a.face, y + 0.6]).fill(0x3a3d45);
    return;
  }
  const nod = Math.sin(time * 0.006 + a.id * 1.7) > 0.6 ? 1 : 0;
  g.ellipse(x, y + 0.4, 2.7, 2).fill(0x24262c).stroke({ width: 0.4, color: 0x0f1013 });
  g.poly([x - 2 * a.face, y + 0.6, x - 4.6 * a.face, y + 1.8, x - 2 * a.face, y + 1.8]).fill(0x1c1d22);
  g.circle(x + 2 * a.face, y - 1.3 + nod, 1.4).fill(0x24262c);
  g.poly([x + 3 * a.face, y - 1.7 + nod, x + 5 * a.face, y - 1 + nod, x + 3 * a.face, y - 0.7 + nod]).fill(0x4a4f5a);
}

/** A stook: sheaves of corn leaned together, heads up. */
function stook(g: Graphics, x: number, y: number): void {
  g.ellipse(x + 1, y + 5, 6.5, 2.2).fill({ color: 0x0b1220, alpha: 0.2 });
  g.poly([x - 5.5, y + 5, x - 1.6, y - 6, x + 0.4, y + 5]).fill(0xd9b24a).stroke({ width: 0.7, color: 0x7a5a1e });
  g.poly([x - 0.4, y + 5, x + 1.6, y - 6, x + 5.5, y + 5]).fill(0xe6c45c).stroke({ width: 0.7, color: 0x7a5a1e });
  g.poly([x - 2.6, y + 5.4, x, y - 7, x + 2.6, y + 5.4]).fill(0xf0d478).stroke({ width: 0.7, color: 0x7a5a1e });
  g.rect(x - 2.4, y - 0.6, 4.8, 1.1).fill(0x8a6a2a);
  g.moveTo(x - 1.6, y - 6).lineTo(x - 2.6, y - 8.4).moveTo(x, y - 7).lineTo(x, y - 9.4).moveTo(x + 1.6, y - 6).lineTo(x + 2.6, y - 8.4).stroke({ width: 0.8, color: 0xc99a2e, cap: 'round' });
}

/** A basket of what was pulled: roots and greens. */
function crate(g: Graphics, x: number, y: number, i: number): void {
  g.ellipse(x + 0.6, y + 4, 6, 2).fill({ color: 0x0b1220, alpha: 0.2 });
  g.roundRect(x - 5, y - 2.5, 10, 6.5, 2).fill(0xb48a54).stroke({ width: 0.8, color: 0x5a3d28 });
  g.rect(x - 5, y - 0.2, 10, 0.8).fill({ color: 0x5a3d28, alpha: 0.5 });
  const cols = [0xd9733a, 0x8aa85a, 0xc7b05a, 0x9a4a6a];
  for (let k = 0; k < 3; k++) g.circle(x - 2.8 + k * 2.8, y - 2.6 - (k === 1 ? 0.8 : 0), 1.7).fill(cols[(i + k) % cols.length]);
}
