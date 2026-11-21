// What the land is doing, drawn over the map: scorched ground, flood water, cracks and rubble, a
// fallen star's crater, flames and smoke in the woods, a locust swarm, ghost lights over the graves,
// a dragon's shadow, and in the night sky falling stars and the northern lights. The earth shaking
// moves the whole view for a moment. Display only: nothing here feeds back into the colony.

import type { Graphics } from 'pixi.js';
import { TICKS_PER_HOUR, dayOf, seasonOf } from '../config';
import { cells } from '../sim/data/buildings';
import { dragonAt, floodLevel } from '../sim/nature';
import type { Colony } from '../sim/types';
import type { Bounds } from './fx';
import { TS, hash2 } from './tiles';

export class NatureView {
  private gKey = '';
  /** the quake the view last shook for, and how long the shaking has left (ms) */
  private shook = -1;
  private shakeMs = 0;

  /** A new colony: everything is drawn afresh. */
  reset(ground: Graphics): void {
    this.gKey = '';
    ground.clear();
  }

  /**
   * Draw this frame. `ground` lies on the land under the people, `sky` above the trees, `glow` above
   * the night's shade (things that give light), `screen` over everything in screen space. Returns
   * how far to shake the view this frame, in pixels.
   */
  draw(ground: Graphics, sky: Graphics, glow: Graphics, screen: Graphics, c: Colony, tf: number, time: number, dt: number, view: Bounds, zoom: number, sw: number, sh: number, dark: number): [number, number] {
    const n = c.nat;
    sky.clear();
    glow.clear();
    screen.clear();
    if (!n) { if (this.gKey) { ground.clear(); this.gKey = ''; } return [0, 0]; }
    const W = c.w;
    const seen = (x: number, y: number, pad = 1): boolean => x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad;

    // ---- the ground: redrawn only when it changes ----
    const lvl = floodLevel(n, tf);
    const key = `${n.ash.length}|${Math.floor(lvl * 3)}|${n.fl?.t0 ?? 0}|${n.cr?.t ?? 0}|${n.rub.length}|${n.cra?.i ?? -1}|${dayOf(Math.floor(tf))}`;
    if (key !== this.gKey) {
      this.gKey = key;
      ground.clear();
      const day = dayOf(Math.floor(tf));
      // scorched ground, fading as it greens
      const ash = new Set<number>();
      for (let j = 0; j < n.ash.length; j += 2) ash.add(n.ash[j]);
      const done = new Set<number>();
      for (let j = n.ash.length - 2; j >= 0; j -= 2) {
        const i = n.ash[j];
        if (done.has(i)) continue;
        done.add(i);
        const age = day - n.ash[j + 1];
        const x = (i % W) * TS;
        const y = Math.floor(i / W) * TS;
        const a = Math.max(0.12, 0.62 - age * 0.012);
        // the edge of a burn is ragged; inside it the black runs on unbroken
        const inner = ash.has(i - 1) && ash.has(i + 1) && ash.has(i - W) && ash.has(i + W);
        if (inner) ground.rect(x, y, TS, TS).fill({ color: 0x2b2420, alpha: a });
        else ground.roundRect(x + 1 + hash2(i, 8, 40) * 3, y + 1 + hash2(i, 9, 40) * 3, TS - 4, TS - 4, 8).fill({ color: 0x2b2420, alpha: a * 0.85 });
        if (age < 3) ground.circle(x + hash2(i, 1, 40) * TS, y + hash2(i, 2, 40) * TS, 1.6).fill({ color: 0xff7a2a, alpha: 0.5 });
        else ground.circle(x + hash2(i, 3, 40) * TS, y + hash2(i, 4, 40) * TS, 2.2).fill({ color: 0x5b6b3a, alpha: Math.min(0.6, age * 0.02) });
      }
      // the water over the low ground
      if (lvl > 0 && n.fl) {
        const l = n.fl.l;
        for (let j = 0; j < l.length; j += 2) {
          const d = l[j + 1];
          if (d > lvl) continue;
          const i = l[j];
          const deep = Math.min(1, (lvl - d + 1) / 2);
          ground.rect((i % W) * TS, Math.floor(i / W) * TS, TS, TS).fill({ color: deep > 0.6 ? 0x3d6f9a : 0x5b8db5, alpha: 0.45 + deep * 0.3 });
        }
      }
      // cracks in the ground
      if (n.cr) {
        for (const i of n.cr.l) {
          const x = (i % W) * TS;
          const y = Math.floor(i / W) * TS;
          const h1 = hash2(i, 5, 41);
          const h2 = hash2(i, 6, 41);
          ground.moveTo(x + 2, y + TS * h1).lineTo(x + TS * 0.35, y + TS * h2).lineTo(x + TS * 0.65, y + TS * (1 - h1)).lineTo(x + TS - 2, y + TS * h2)
            .stroke({ width: 2.4, color: 0x1d1a17, alpha: 0.85, cap: 'round', join: 'round' });
          ground.moveTo(x + TS * 0.35, y + TS * h2).lineTo(x + TS * 0.3, y + TS * (h2 > 0.5 ? h2 - 0.3 : h2 + 0.3)).stroke({ width: 1.2, color: 0x1d1a17, alpha: 0.7 });
        }
      }
      // heaps of rubble
      for (const i of n.rub) {
        const x = (i % W) * TS;
        const y = Math.floor(i / W) * TS;
        for (let k = 0; k < 5; k++) {
          const px = x + 4 + hash2(i, k, 42) * (TS - 8);
          const py = y + 6 + hash2(i, k, 43) * (TS - 10);
          const r = 2.4 + hash2(i, k, 44) * 3;
          ground.poly([px - r, py, px - r * 0.4, py - r, px + r * 0.6, py - r * 0.8, px + r, py + r * 0.3, px, py + r * 0.8]).fill(k % 2 ? 0x8d8a84 : 0x6e6a64).stroke({ width: 0.8, color: 0x3b3833 });
        }
      }
      // where the star came down
      if (n.cra) {
        const x = (n.cra.i % W + 0.5) * TS;
        const y = (Math.floor(n.cra.i / W) + 0.5) * TS;
        ground.ellipse(x, y, TS * 1.6, TS * 1.2).fill({ color: 0x3a2e26, alpha: 0.55 });
        ground.ellipse(x, y, TS * 0.9, TS * 0.65).fill({ color: 0x1f1a17, alpha: 0.85 }).stroke({ width: 2, color: 0x6b5847, alpha: 0.7 });
      }
    }
    if (zoom < 0.3) return this.shake(c, tf, time, dt);

    // ---- above the trees ----
    // the fire: flames over each burning tile and smoke drifting off
    const wf = n.wf;
    if (n.fire.length && (!wf || tf >= wf.t0)) {
      let drawn = 0;
      for (let j = 0; j < n.fire.length && drawn < 90; j += 2) {
        const i = n.fire[j];
        const tx = i % W;
        const ty = Math.floor(i / W);
        if (!seen(tx, ty, 3)) continue;
        drawn++;
        const x = (tx + 0.5) * TS;
        const y = (ty + 0.5) * TS;
        const f = 0.75 + 0.25 * Math.sin(time * 0.02 + i);
        glow.circle(x, y + 2, TS * 0.62).fill({ color: 0xff6a1a, alpha: 0.22 + dark * 0.15 });
        for (let k = 0; k < 3; k++) {
          const ox = (k - 1) * 6 + Math.sin(time * 0.013 + i + k) * 1.5;
          const hgt = (10 + hash2(i, k, 45) * 8) * f;
          glow.poly([x + ox - 4, y + 4, x + ox + Math.sin(time * 0.017 + k + i) * 2.5, y + 4 - hgt, x + ox + 4, y + 4]).fill({ color: k === 1 ? 0xffd04a : 0xff7b22, alpha: 0.9 });
        }
        for (let k = 0; k < 2; k++) {
          const ph = (time * 0.00045 + k * 0.5 + hash2(i, k, 46)) % 1;
          sky.circle(x + ph * 18 + Math.sin(ph * 5 + i) * 3, y - 10 - ph * 46, 4 + ph * 10).fill({ color: 0x4a4a4e, alpha: (1 - ph) * 0.4 });
        }
      }
    }
    // the swarm: a humming cloud
    const L = n.loc;
    if (L && tf >= L.t0) {
      const u = (tf % 2) / 2;
      const cx = (L.px + (L.x - L.px) * u + 0.5) * TS;
      const cy = (L.py + (L.y - L.py) * u + 0.5) * TS;
      if (seen(cx / TS, cy / TS, 6)) {
        // a haze over the cloud, its shadow on the crops, and the insects themselves catching the light
        sky.ellipse(cx + 12, cy + 30, TS * 3.2, TS * 1.7).fill({ color: 0x000000, alpha: 0.16 });
        for (let k = 0; k < 5; k++) sky.circle(cx + Math.sin(time * 0.0011 + k * 1.9) * TS * 1.6, cy + Math.cos(time * 0.0013 + k * 2.3) * TS * 0.8, TS * (1.1 + hash2(k, 4, 47) * 0.6)).fill({ color: 0x6b6430, alpha: 0.1 });
        for (let k = 0; k < 240; k++) {
          const a = hash2(k, 1, 47) * 6.283 + time * (0.0007 + hash2(k, 2, 47) * 0.0012) * (k % 2 ? 1 : -1);
          const rr = (0.2 + hash2(k, 3, 47) * 0.8) * TS * 3;
          const bob = Math.sin(time * 0.006 + k) * 3;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr * 0.62 + bob;
          const flick = Math.sin(time * 0.03 + k * 1.3) > 0;
          sky.rect(x, y, flick ? 3 : 2.2, flick ? 1.4 : 2.4).fill({ color: k % 3 === 0 ? 0xd8cf6a : k % 3 === 1 ? 0x9c9440 : 0x3b3818, alpha: 0.95 });
        }
      }
    }
    // the dragon: a great shadow sweeping the ground, and its shape above
    const dp = dragonAt(n, tf);
    if (dp) {
      const d = n.dr!;
      const ang = Math.atan2(d.y1 - d.y0, d.x1 - d.x0);
      const x = (dp[0] + 0.5) * TS;
      const y = (dp[1] + 0.5) * TS;
      const flap = Math.sin(time * 0.006);
      const shape = (g: Graphics, ox: number, oy: number, s: number, col: number, alpha: number): void => {
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const P = (px: number, py: number): number[] => [ox + (px * ca - py * sa) * s, oy + (px * sa + py * ca) * s];
        const wing = 1 + flap * 0.25;
        // body and neck, tail, and two great wings
        g.poly([...P(60, 0), ...P(44, -6), ...P(20, -8), ...P(-30, -6), ...P(-90, 0), ...P(-30, 6), ...P(20, 8), ...P(44, 6)]).fill({ color: col, alpha });
        g.poly([...P(20, -6), ...P(-4, -80 * wing), ...P(-22, -66 * wing), ...P(-30, -40 * wing), ...P(-40, -50 * wing), ...P(-34, -6)]).fill({ color: col, alpha });
        g.poly([...P(20, 6), ...P(-4, 80 * wing), ...P(-22, 66 * wing), ...P(-30, 40 * wing), ...P(-40, 50 * wing), ...P(-34, 6)]).fill({ color: col, alpha });
        g.poly([...P(62, -3), ...P(74, -9), ...P(68, 0), ...P(74, 9), ...P(62, 3)]).fill({ color: col, alpha });
      };
      shape(sky, x + 70, y + 110, 1.9, 0x000000, 0.26);
      shape(sky, x, y, 1.15, 0x2b1d24, 0.92);
    }
    // ghost lights over the graves, by night
    const h = n.haunt;
    if (h && dark > 0.35) {
      const yard = c.blds.find((b) => b.id === h.b);
      if (yard && seen(yard.x + yard.w / 2, yard.y + yard.h / 2, 8)) {
        const list = cells('graveyard');
        for (let k = 0; k < 6; k++) {
          const cell = list[Math.floor(hash2(k, 7, 48) * list.length) % list.length];
          const t = time * 0.0006 + k * 1.3;
          const x = (yard.x + cell.dx + 0.5) * TS + Math.sin(t) * 14;
          const y = (yard.y + cell.dy + 0.5) * TS + Math.cos(t * 0.8) * 8 - 10;
          const p = 0.5 + 0.5 * Math.sin(time * 0.004 + k * 2);
          glow.circle(x, y, 11).fill({ color: 0x9fe8e0, alpha: 0.18 * p * dark });
          glow.circle(x, y, 3.4).fill({ color: 0xd8fff8, alpha: 0.85 * p * dark });
        }
      }
    }
    // the fallen star, still glowing
    if (n.cra && n.cra.a >= 0) {
      const x = (n.cra.i % W + 0.5) * TS;
      const y = (Math.floor(n.cra.i / W) + 0.5) * TS;
      const p = 0.6 + 0.4 * Math.sin(time * 0.005);
      glow.circle(x, y, 12 * p).fill({ color: 0xff9a3a, alpha: 0.25 });
      glow.circle(x, y, 4).fill({ color: 0xffe2a0, alpha: 0.9 * p });
    }

    // ---- the night sky, over everything ----
    const s = n.sky;
    if (s && tf >= s.t0 && tf < s.t1 && dark > 0.25) {
      const lit = Math.min(1, dark * 1.6);
      if (s.k === 'meteors') {
        for (let k = 0; k < 11; k++) {
          const span = 900 + hash2(k, 1, 49) * 900;
          const cyc = Math.floor((time + k * 333) / span);
          const ph = ((time + k * 333) % span) / span;
          if (ph > 0.55) continue;
          const sx = sw * (0.3 + hash2(k, cyc, 50) * 0.8);
          const sy = hash2(k, cyc, 51) * sh * 0.5;
          const len = 90 + hash2(k, cyc, 52) * 120;
          const u = ph / 0.55;
          const hx = sx - u * len * 2.2;
          const hy = sy + u * len * 1.1;
          for (let q = 0; q < 6; q++) {
            const a = (1 - q / 6) * (1 - u * 0.5) * lit;
            screen.moveTo(hx + q * 22, hy - q * 11).lineTo(hx + (q + 1) * 22, hy - (q + 1) * 11).stroke({ width: 3.2 - q * 0.45, color: q < 2 ? 0xfffbe8 : 0xffd9a0, alpha: a });
          }
          screen.circle(hx, hy, 7).fill({ color: 0xfff1c8, alpha: 0.3 * lit });
          screen.circle(hx, hy, 3).fill({ color: 0xffffff, alpha: lit });
        }
      } else {
        // curtains of light, swaying: soft layered bands, brightest at the hem, with fine rays through them
        const cols = [0x52ffa8, 0x3fd0ff, 0xb489ff];
        const N = 40;
        for (let band = 0; band < 3; band++) {
          const top: number[] = [];
          const hem: number[] = [];
          for (let k = 0; k <= N; k++) {
            const x = (k / N) * sw;
            const t = sh * (0.03 + band * 0.08) + Math.sin(time * 0.0009 + k * 0.35 + band * 2) * 24 + Math.sin(time * 0.0004 + k * 0.11) * 30;
            top.push(x, t);
            hem.push(x, t + sh * (0.15 + 0.07 * Math.sin(time * 0.0007 + k * 0.25 + band)));
          }
          const a = (0.13 + 0.05 * Math.sin(time * 0.001 + band)) * lit;
          for (let q = 0; q < 4; q++) {
            const pts: number[] = [];
            for (let k = 0; k <= N; k++) { const y0 = top[k * 2 + 1]; const y1 = hem[k * 2 + 1]; pts.push(top[k * 2], y0 + ((y1 - y0) * q) / 4); }
            for (let k = N; k >= 0; k--) pts.push(hem[k * 2], hem[k * 2 + 1]);
            screen.poly(pts).fill({ color: cols[band], alpha: a * 0.45 });
          }
          for (let k = 0; k < N; k += 1) {
            const ra = a * (0.4 + 0.6 * Math.abs(Math.sin(time * 0.0015 + k * 1.7 + band)));
            screen.moveTo(top[k * 2] + 6, top[k * 2 + 1] + 4).lineTo(hem[k * 2] + 6, hem[k * 2 + 1]).stroke({ width: 2, color: 0xd8ffe8, alpha: ra * 0.5 });
          }
        }
      }
    }
    // a hard winter: frost creeping in from the edges
    if (seasonOf(Math.floor(tf)) === 3 && c.mods.some((m) => m[0] === 'hardwinter' && m[1] > tf)) {
      for (let k = 0; k < 6; k++) {
        const w = 10 + k * 10;
        screen.rect(0, 0, sw, sh).stroke({ width: w, color: 0xe4f2ff, alpha: 0.05, alignment: 1 });
      }
    }
    return this.shake(c, tf, time, dt);
  }

  /** The ground shaking: a moment of it in real time, the first time the view sees the quake. */
  private shake(c: Colony, tf: number, time: number, dt: number): [number, number] {
    const qk = c.nat?.qk;
    if (qk !== undefined && tf >= qk && tf - qk < TICKS_PER_HOUR * 3 && qk !== this.shook) { this.shook = qk; this.shakeMs = 1800; }
    if (this.shakeMs <= 0) return [0, 0];
    this.shakeMs = Math.max(0, this.shakeMs - dt);
    const amp = 9 * (this.shakeMs / 1800);
    return [Math.sin(time * 0.09) * amp, Math.cos(time * 0.13) * amp * 0.7];
  }
}

