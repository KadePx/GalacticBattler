// Paints the terrain once per world into a canvas: shaded hexes, ocean depth, coastlines,
// little glyphs for mountains, hills, forests and dunes, and smooth rivers.

import { neighbors, tileCenter } from '../sim/hex';
import { hash32 } from '../sim/rng';
import type { World } from '../sim/types';
import { B, BIOMES, isLand } from '../sim/worldgen';

export const HEX = 14; // hex radius in map pixels

export function mapSize(w: World): [number, number] {
  const hw = Math.sqrt(3) * HEX;
  return [Math.ceil(hw * (w.W + 0.5)), Math.ceil(HEX * 1.5 * w.H + HEX * 0.5)];
}

export const CORNERS: [number, number][] = [];
for (let k = 0; k < 6; k++) {
  const a = ((60 * k - 30) * Math.PI) / 180;
  CORNERS.push([Math.cos(a), Math.sin(a)]);
}
/** Corner pair for the edge facing neighbour direction k (E, NE, NW, W, SW, SE). */
export const EDGE: [number, number][] = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
export const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
export const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function neighborInDir(w: World, i: number, k: number): number {
  const x = i % w.W;
  const y = (i - x) / w.W;
  const d = (y & 1 ? DIRS_ODD : DIRS_EVEN)[k];
  const nx = x + d[0];
  const ny = y + d[1];
  return nx >= 0 && ny >= 0 && nx < w.W && ny < w.H ? ny * w.W + nx : -1;
}

export function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const x = cx + CORNERS[k][0] * r;
    const y = cy + CORNERS[k][1] * r;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export function paintTerrain(w: World): HTMLCanvasElement {
  const [cw, ch] = mapSize(w);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d')!;
  const t = w.t;
  const n = w.W * w.H;
  const nb: number[] = [];

  // Distance from land, for ocean depth.
  const dist = new Int16Array(n).fill(99);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (isLand(t, i)) { dist[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    for (const j of neighbors(w.W, w.H, q[k], nb)) {
      if (dist[j] > dist[q[k]] + 1) { dist[j] = dist[q[k]] + 1; q.push(j); }
    }
  }

  g.fillStyle = '#132a44';
  g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = tileCenter(w.W, i, HEX);
    const b = t.biome[i];
    const jitter = ((hash32(w.seed, i, 77) % 1000) / 1000 - 0.5) * 0.08;
    let color: string;
    if (b === B.OCEAN || b === B.SHALLOW) {
      const d = Math.min(8, dist[i]);
      color = shade('#2f6a96', -0.07 * d + jitter * 0.5);
    } else if (b === B.LAKE) {
      color = shade('#3d7fae', jitter * 0.5);
    } else {
      // Light from the north-west: brighter when higher than the tile up-left.
      const up = neighborInDir(w, i, 2);
      const dh = up >= 0 ? (t.h[i] - Math.max(0, t.h[up])) / 1000 : 0;
      color = shade(BIOMES[b].c, jitter + Math.max(-0.25, Math.min(0.25, dh * 2.2)));
    }
    hexPath(g, cx, cy, HEX * 1.04);
    g.fillStyle = color;
    g.fill();
  }

  // Coastlines: a soft light rim on the water side, a dark line on the land edge.
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    if (!isLand(t, i)) continue;
    const [cx, cy] = tileCenter(w.W, i, HEX);
    for (let k = 0; k < 6; k++) {
      const j = neighborInDir(w, i, k);
      if (j < 0 || isLand(t, j)) continue;
      const [a, b] = EDGE[k];
      g.strokeStyle = 'rgba(200,225,240,0.25)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx + CORNERS[a][0] * HEX, cy + CORNERS[a][1] * HEX);
      g.lineTo(cx + CORNERS[b][0] * HEX, cy + CORNERS[b][1] * HEX);
      g.stroke();
      g.strokeStyle = 'rgba(40,30,20,0.55)';
      g.lineWidth = 1.2;
      g.stroke();
    }
  }

  // Glyphs.
  for (let i = 0; i < n; i++) {
    const b = t.biome[i];
    const [cx, cy] = tileCenter(w.W, i, HEX);
    const r = hash32(w.seed, i, 99);
    const ox = ((r & 255) / 255 - 0.5) * 4;
    const oy = (((r >> 8) & 255) / 255 - 0.5) * 3;
    if (b === B.MOUNTAIN) {
      const s = HEX * 0.75;
      g.fillStyle = '#5d5651';
      g.beginPath();
      g.moveTo(cx - s + ox, cy + s * 0.55 + oy);
      g.lineTo(cx + ox, cy - s * 0.7 + oy);
      g.lineTo(cx + s + ox, cy + s * 0.55 + oy);
      g.closePath();
      g.fill();
      g.fillStyle = '#8d8580';
      g.beginPath();
      g.moveTo(cx - s + ox, cy + s * 0.55 + oy);
      g.lineTo(cx + ox, cy - s * 0.7 + oy);
      g.lineTo(cx + ox - s * 0.15, cy + s * 0.55 + oy);
      g.closePath();
      g.fill();
      if (t.temp[i] < 8) {
        g.fillStyle = '#f2f5f7';
        g.beginPath();
        g.moveTo(cx + ox - s * 0.32, cy - s * 0.18 + oy);
        g.lineTo(cx + ox, cy - s * 0.7 + oy);
        g.lineTo(cx + ox + s * 0.32, cy - s * 0.18 + oy);
        g.closePath();
        g.fill();
      }
    } else if (b === B.HILLS) {
      g.strokeStyle = 'rgba(70,55,35,0.55)';
      g.lineWidth = 1.3;
      for (const dx of [-4, 4]) {
        g.beginPath();
        g.arc(cx + dx + ox, cy + 3 + oy + (dx > 0 ? -2 : 0), 4.5, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
    } else if (b === B.FOREST || b === B.TAIGA || b === B.JUNGLE) {
      const dark = b === B.TAIGA ? '#23422f' : b === B.JUNGLE ? '#164a24' : '#24562b';
      const pts = [[-5, 2], [4, 3], [0, -3]];
      for (const [px, py] of pts) {
        const x = cx + px + ox * 0.5;
        const y = cy + py + oy * 0.5;
        g.fillStyle = dark;
        if (b === B.TAIGA) {
          g.beginPath();
          g.moveTo(x - 3, y + 3);
          g.lineTo(x, y - 4);
          g.lineTo(x + 3, y + 3);
          g.closePath();
          g.fill();
        } else {
          g.beginPath();
          g.arc(x, y, b === B.JUNGLE ? 3.4 : 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (b === B.DESERT) {
      g.strokeStyle = 'rgba(150,120,70,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx + ox, cy + 4 + oy, 6, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    } else if (b === B.MARSH) {
      g.strokeStyle = 'rgba(30,60,50,0.6)';
      g.lineWidth = 1;
      for (const dx of [-4, 1, 5]) {
        g.beginPath();
        g.moveTo(cx + dx + ox, cy + 3);
        g.lineTo(cx + dx + ox, cy - 2);
        g.stroke();
      }
    } else if (b === B.SNOW || b === B.TUNDRA) {
      if ((r >> 16) % 3 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(cx + ox, cy + oy, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Rivers: smooth curves through tile midpoints, wider downstream.
  for (let i = 0; i < n; i++) {
    if (!t.river[i]) continue;
    const d = t.down[i];
    if (d < 0) continue;
    const [ax, ay] = tileCenter(w.W, i, HEX);
    const [bx, by] = tileCenter(w.W, d, HEX);
    // One curve from each incoming edge midpoint (or the source centre) to the outgoing one.
    const starts: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const j = neighborInDir(w, i, k);
      if (j >= 0 && t.down[j] === i && t.river[j]) {
        const [px, py] = tileCenter(w.W, j, HEX);
        starts.push([(ax + px) / 2, (ay + py) / 2]);
      }
    }
    if (!starts.length) starts.push([ax, ay]);
    const ex = (ax + bx) / 2;
    const ey = (ay + by) / 2;
    const width = Math.min(5, 1.4 + t.flow[i] * 0.7);
    g.beginPath();
    for (const [sx, sy] of starts) {
      g.moveTo(sx, sy);
      g.quadraticCurveTo(ax, ay, ex, ey);
    }
    if (!isLand(t, d)) {
      g.moveTo(ex, ey);
      g.lineTo(bx, by);
    }
    g.strokeStyle = 'rgba(25,55,85,0.5)';
    g.lineWidth = width + 1.6;
    g.stroke();
    g.strokeStyle = '#5a9fd0';
    g.lineWidth = width;
    g.stroke();
  }
  return cv;
}
