// Small moving things that make the colony feel alive: chips and sparks from work, dust underfoot,
// steam and smoke, birds and butterflies, falling leaves and fireflies, arrows in flight.
// Everything here is drawn from the clock and the colony as it stands; nothing is remembered.

import type { Graphics } from 'pixi.js';
import { hourOf, seasonOf } from '../config';
import { B, F, T, type Colony } from '../sim/types';
import { burning } from './life';
import { TS, hash2 } from './tiles';

export interface FxPawn { id: number; x: number; y: number; size: number; moving: boolean; k: string; w?: string; ta: number; tx: number; ty: number; d?: number; b?: number; kid?: boolean }
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Parabolic flight from (x,y): out by (vx,vy) over the phase, falling under gravity. */
function arc(ph: number, vx: number, vy: number): [number, number] {
  return [vx * ph, vy * ph + 18 * ph * ph];
}

export class Fx {
  private trees: number[] = [];
  private flowers: number[] = [];
  private fires: number[] = [];
  private scan = -1;

  /** Re-read where the trees, flowers and fires are, every so often (they change slowly). */
  private rescan(c: Colony, time: number): void {
    const key = Math.floor(time / 4000);
    if (key === this.scan) return;
    this.scan = key;
    this.trees = [];
    this.flowers = [];
    this.fires = [];
    for (let i = 0; i < c.feat.length; i++) {
      const f = c.feat[i];
      if (f === F.TREE) this.trees.push(i);
      else if (f === F.FLOWERS || f === F.BUSH) this.flowers.push(i);
      const s = c.st[i];
      if (s === B.HEARTH || s === B.FORGE || s === B.STOVE || s === B.BRAZIER || s === B.OVEN || s === B.KILN || s === B.GLASSFURN || s === B.BLOOMERY) this.fires.push(i);
    }
  }

  /** Draw this frame's effects. `work` sits just above the people; `sky` above the trees. */
  draw(work: Graphics, sky: Graphics, c: Colony, pawns: FxPawn[], time: number, tf: number, view: Bounds, zoom: number, busy: Set<number>, home: Set<number>): void {
    work.clear();
    sky.clear();
    if (zoom < 0.45) return;
    this.rescan(c, time);
    const seen = (x: number, y: number): boolean => x >= view.x0 * TS && x <= view.x1 * TS && y >= view.y0 * TS && y <= view.y1 * TS;
    const hour = hourOf(Math.floor(tf));
    const night = hour >= 21 || hour < 5;
    const season = seasonOf(Math.floor(tf));

    // ---- work ----
    for (const p of pawns) {
      if (!seen(p.x, p.y)) continue;
      if (p.moving) {
        // dust kicked up on bare ground
        const i = Math.floor(p.y / TS) * c.w + Math.floor(p.x / TS);
        const t = c.ter[i];
        if (t === T.DIRT || t === T.PATH || t === T.SAND) {
          const ph = (time * 0.0025 + p.id * 0.37) % 1;
          work.circle(p.x - 2 + ph * 1.5, p.y + 6 * p.size - ph * 2, 1.2 + ph * 2.2).fill({ color: 0xc9b48a, alpha: (1 - ph) * 0.4 });
        }
        continue;
      }
      if (p.k === 'attend' || p.k === 'wed') continue;
      if (p.k === 'fight' && p.b === 1 && p.d !== undefined) {
        // an arrow on its way
        const f = c.foes.find((x) => x.id === p.d);
        if (f) {
          const ph = (time * 0.0018 + p.id * 0.3) % 1;
          const fx = (f.x + 0.5) * TS;
          const fy = (f.y + 0.5) * TS;
          const ax = p.x + (fx - p.x) * ph;
          const ay = p.y + (fy - p.y) * ph - Math.sin(ph * Math.PI) * 10;
          const ang = Math.atan2(fy - p.y, fx - p.x);
          work.moveTo(ax - Math.cos(ang) * 5, ay - Math.sin(ang) * 5).lineTo(ax, ay).stroke({ width: 1.1, color: 0xe9e3d5 });
        }
        continue;
      }
      if (p.k !== 'work' || !p.w || tf < p.ta) continue;
      const bx = p.x + 6 * p.size;
      const by = p.y;
      const burst = (n: number, col: number, speed: number, rate: number, r = 1.1): void => {
        for (let k = 0; k < n; k++) {
          const ph = (time * rate + k / n + hash2(p.id, k, 5) * 0.3) % 1;
          const dir = hash2(p.id, k + Math.floor(time * rate + k / n), 7) * 2 - 1;
          const [ox, oy] = arc(ph, dir * speed, -speed * (0.6 + hash2(p.id, k, 9) * 0.5));
          work.circle(bx + ox, by + oy, r).fill({ color: col, alpha: 1 - ph });
        }
      };
      switch (p.w) {
        case 'wood': burst(4, 0xb9875a, 14, 0.0016, 1.2); break;
        case 'mine': burst(3, 0x9da1aa, 12, 0.0018); burst(2, 0xffd36a, 16, 0.0024, 0.8); break;
        case 'smith': burst(5, 0xffb347, 18, 0.0026, 0.8); break;
        case 'build': {
          for (let k = 0; k < 2; k++) {
            const ph = (time * 0.0012 + k * 0.5 + p.id * 0.1) % 1;
            work.circle(bx + (k ? 3 : -3), by + 4 - ph * 6, 2 + ph * 4).fill({ color: 0xd9c8a8, alpha: (1 - ph) * 0.45 });
          }
          break;
        }
        case 'farm': burst(3, 0x8a6a40, 8, 0.0014, 0.9); break;
        case 'cook':
        case 'brew': {
          for (let k = 0; k < 3; k++) {
            const ph = (time * 0.0008 + k / 3 + p.id * 0.13) % 1;
            work.circle(bx - 4 + Math.sin(ph * 7 + k) * 2, by - 6 - ph * 16, 1.6 + ph * 3).fill({ color: 0xf2f2f2, alpha: (1 - ph) * 0.45 });
          }
          break;
        }
        case 'fish': {
          // rings spread on the water beside them
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const wt = c.ter[(p.ty + dy) * c.w + p.tx + dx];
            if (wt !== T.SHALLOW && wt !== T.DEEP) continue;
            const cx = (p.tx + dx + 0.5) * TS;
            const cy = (p.ty + dy + 0.5) * TS;
            for (let k = 0; k < 2; k++) {
              const ph = (time * 0.0006 + k * 0.5 + p.id * 0.2) % 1;
              work.circle(cx, cy, 2 + ph * 8).stroke({ width: 1, color: 0xe9f2f6, alpha: (1 - ph) * 0.6 });
            }
            break;
          }
          break;
        }
        default: break;
      }
    }

    // ---- smoke from the fires that are lit: hearths and stoves when someone is home, at
    // mealtimes and in the cold; the forges, ovens, kilns and furnaces while their trade works ----
    const cold = c.temp < 8 ? 1 : 0.6;
    for (const i of this.fires) {
      const x = (i % c.w + 0.5) * TS;
      const y = (Math.floor(i / c.w) + 0.3) * TS;
      if (!seen(x, y)) continue;
      const s = c.st[i];
      if (!burning(c, i, s, busy, home, hour)) continue;
      // the kilns and furnaces send up a thicker, darker plume
      const thick = s === B.KILN || s === B.GLASSFURN || s === B.BLOOMERY;
      for (let k = 0; k < (thick ? 4 : 3); k++) {
        const ph = (time * 0.0003 + k / 3 + hash2(i, k, 3) * 0.2) % 1;
        sky.circle(x + ph * 10 + Math.sin(ph * 6 + i) * 2, y - ph * (thick ? 44 : 34), (thick ? 3.4 : 2.6) + ph * (thick ? 8 : 6)).fill({ color: thick ? 0x6f727a : 0x7d828c, alpha: (1 - ph) * (thick ? 0.5 : 0.42 * cold) });
      }
    }

    // ---- the wild ----
    if (!night && season !== 3 && c.weather < 2) {
      // a flock or two of birds crossing the sky
      for (let f = 0; f < 2; f++) {
        const span = (view.x1 - view.x0 + 8) * TS;
        const ph = ((time * 0.00004 + f * 0.47) % 1);
        const fx0 = (view.x0 - 4) * TS + ph * span;
        const fy0 = (view.y0 + (view.y1 - view.y0) * (0.25 + f * 0.4)) * TS + Math.sin(time * 0.0004 + f) * 30;
        for (let k = 0; k < 4; k++) {
          const bx = fx0 - k * 9 - (k % 2) * 4;
          const by = fy0 + (k % 2 ? 6 : -4) + k * 2;
          const flap = Math.sin(time * 0.02 + k) * 2.4;
          sky.moveTo(bx - 4, by - flap).lineTo(bx, by).lineTo(bx + 4, by - flap).stroke({ width: 1.2, color: 0x2a2a30, alpha: 0.7 });
        }
      }
    }
    if (!night && (season === 0 || season === 1) && c.weather < 2) {
      // butterflies over the flowers and bushes
      let n = 0;
      for (const i of this.flowers) {
        if (n >= 14) break;
        const x = (i % c.w + 0.5) * TS;
        const y = (Math.floor(i / c.w) + 0.5) * TS;
        if (!seen(x, y) || hash2(i, 1, 11) > 0.35) continue;
        n++;
        const t = time * 0.0012 + i;
        const bx = x + Math.sin(t) * 9 + Math.sin(t * 2.3) * 3;
        const by = y - 6 + Math.cos(t * 1.3) * 6;
        const wing = Math.abs(Math.sin(time * 0.03 + i)) * 2.2 + 0.4;
        const col = [0xf2e08a, 0xe8a8c0, 0xa8c8f0, 0xffffff][Math.floor(hash2(i, 2, 12) * 4) % 4];
        sky.ellipse(bx - wing, by, wing, 1.8).ellipse(bx + wing, by, wing, 1.8).fill(col);
      }
    }
    if (season === 2) {
      // leaves letting go of the trees
      let n = 0;
      for (const i of this.trees) {
        if (n >= 40) break;
        const x = (i % c.w + 0.5) * TS;
        const y = (Math.floor(i / c.w) + 0.5) * TS;
        if (!seen(x, y) || hash2(i, 3, 13) > 0.4) continue;
        n++;
        const ph = (time * 0.00025 + hash2(i, 4, 14)) % 1;
        const lx = x + Math.sin(ph * 9 + i) * 6 + ph * 8;
        const ly = y - 8 + ph * 22;
        sky.ellipse(lx, ly, 1.8, 1.1).fill({ color: [0xd9733a, 0xe2b84a, 0xb84a3a][i % 3], alpha: ph < 0.85 ? 0.9 : (1 - ph) * 6 });
      }
    }
    if (night && season === 1 && c.weather === 0) {
      // fireflies by the trees on summer nights
      let n = 0;
      for (const i of this.trees) {
        if (n >= 30) break;
        const x = (i % c.w + 0.5) * TS;
        const y = (Math.floor(i / c.w) + 0.5) * TS;
        if (!seen(x, y) || hash2(i, 5, 15) > 0.5) continue;
        n++;
        const t = time * 0.0008 + i * 3;
        const glow = Math.max(0, Math.sin(time * 0.004 + i * 1.7));
        sky.circle(x + Math.sin(t) * 14, y + 6 + Math.cos(t * 0.7) * 10, 1.4).fill({ color: 0xf8f0a0, alpha: glow * 0.9 });
      }
    }
  }
}
