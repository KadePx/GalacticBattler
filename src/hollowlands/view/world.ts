// The world overlay: the land itself (drawn from the world's seed, so everyone sees the same
// hills and woods), roads between colonies and the colonies they connect, and a list to go
// and look at any of them.

import { TICKS_PER_DAY } from '../config';
import { hash32 } from '../sim/rng';
import { REGION_H, REGION_W } from '../sim/world';
import { esc } from './words';

export interface WorldSite { id: string; name: string; x: number; y: number; founded: number; from?: string; pop: number; ruler?: string; dead?: number; ruins?: string; wars?: string[] }

// Region size in cells (the same grid as sim/world.ts), and canvas pixels per cell.
const W = REGION_W;
const H = REGION_H;
const CELL = 14;
/** Drawings below were made for 20-pixel cells. */
const K = CELL / 20;

function noise(seed: number, salt: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const h = (a: number, b: number): number => hash32(seed, 777, salt, a, b) / 4294967296;
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

type Land = 'sea' | 'lake' | 'marsh' | 'plain' | 'forest' | 'hills' | 'mount';

/** Which side of the land the sea lies on: 0 west, 1 east, 2 north, 3 south. */
const seaSide = (seed: number): number => seed % 4;

/** How high the land is at a point: rolling ground with mountain ranges running through it. */
function height(seed: number, x: number, y: number): number {
  const e = noise(seed, 1, x, y, 13) * 0.6 + noise(seed, 2, x, y, 5) * 0.3 + noise(seed, 8, x, y, 2.2) * 0.1;
  const ridge = 1 - Math.abs(noise(seed, 7, x, y, 15) * 2 - 1);
  return e + Math.max(0, ridge - 0.72) * 1.1;
}

/** How far a point is in from the sea's edge, in cells. */
function inland(seed: number, x: number, y: number): number {
  const s = seaSide(seed);
  return s === 0 ? x : s === 1 ? W - 1 - x : s === 2 ? y : H - 1 - y;
}

/** What covers a point of the region (in cell units). Colonies always sit on open, dry ground. */
function landAt(seed: number, sites: WorldSite[], x: number, y: number, e = height(seed, x, y)): Land {
  const m = noise(seed, 3, x, y, 9) * 0.8 + noise(seed, 6, x, y, 3) * 0.2;
  let near = 99;
  for (const s of sites) near = Math.min(near, Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y));
  if (near < 1.4) return 'plain';
  if (inland(seed, x, y) / 6 + e * 0.6 + (noise(seed, 9, x, y, 6) - 0.5) * 0.25 < 0.55) return 'sea';
  if (e > 0.78 && near > 2) return 'mount';
  if (e > 0.66) return 'hills';
  if (m > 0.74 && e < 0.38 && near > 2) return 'lake';
  if (m > 0.62 && e < 0.46) return 'marsh';
  if (m > 0.47 || noise(seed, 4, x, y, 3) > 0.72) return 'forest';
  return 'plain';
}

/** What covers each cell (sampled at its middle), for the things drawn on top. */
function lands(seed: number, sites: WorldSite[]): Land[] {
  const out: Land[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(landAt(seed, sites, x + 0.5, y + 0.5));
  return out;
}

/** Rivers: each rises in high ground and runs downhill towards the sea, or into another river. */
function rivers(seed: number, sites: WorldSite[]): [number, number][][] {
  const out: [number, number][][] = [];
  const n = 3 + (hash32(seed, 780) % 2);
  const s = seaSide(seed);
  const sea: [number, number] = s === 0 ? [-1, 0] : s === 1 ? [1, 0] : s === 2 ? [0, -1] : [0, 1];
  for (let k = 0; k < n; k++) {
    // a spring: the highest of a few places looked at, away from the sea
    let bx = 0;
    let by = 0;
    let best = -1;
    for (let t = 0; t < 30; t++) {
      const x = 2 + (hash32(seed, 781, k, t) % (W - 4));
      const y = 2 + (hash32(seed, 782, k, t) % (H - 4));
      const v = height(seed, x, y) + inland(seed, x, y) / (s < 2 ? W : H) * 0.5;
      if (v > best && out.every((r) => r.every(([px, py]) => Math.hypot(px - x, py - y) > 8))) { best = v; bx = x; by = y; }
    }
    if (best < 0) continue;
    const line: [number, number][] = [[bx, by]];
    let x = bx;
    let y = by;
    let dx = sea[0];
    let dy = sea[1];
    for (let step = 0; step < 400; step++) {
      const gx = height(seed, x + 0.5, y) - height(seed, x - 0.5, y);
      const gy = height(seed, x, y + 0.5) - height(seed, x, y - 0.5);
      const wob = (noise(seed, 783 + k, x, y, 4) - 0.5) * 0.9;
      let vx = dx * 0.62 - gx * 2.2 + sea[0] * 0.3 - sea[1] * wob;
      let vy = dy * 0.62 - gy * 2.2 + sea[1] * 0.3 + sea[0] * wob;
      const l = Math.hypot(vx, vy) || 1;
      vx /= l;
      vy /= l;
      x += vx * 0.5;
      y += vy * 0.5;
      dx = vx;
      dy = vy;
      line.push([x, y]);
      if (x < -1 || y < -1 || x > W + 1 || y > H + 1) break;
      if (landAt(seed, sites, x, y) === 'sea' && inland(seed, x, y) < W / 3) break;
      // joining another river ends this one
      const join = out.find((r) => r.some(([px, py]) => Math.hypot(px - x, py - y) < 0.7));
      if (join && step > 4) break;
    }
    if (line.length > 12) out.push(line);
  }
  return out;
}

const FILL: Record<Land, string> = { sea: '#2b4a63', lake: '#3b6687', marsh: '#66775a', plain: '#93a066', forest: '#5f7c46', hills: '#a0915f', mount: '#8a8478' };
const KINDS: Land[] = ['sea', 'lake', 'marsh', 'plain', 'forest', 'hills', 'mount'];
/** Samples per cell side for the ground. */
const SUB = 4;

/** The ground at sub-cell samples, once, with a one-sample border so the shore pass can look at neighbours. */
function landGrid(seed: number, sites: WorldSite[]): { at: (x: number, y: number) => Land; hi: (x: number, y: number) => number } {
  const gw = W * SUB + 2;
  const gh = H * SUB + 2;
  const g = new Uint8Array(gw * gh);
  const e = new Float32Array(gw * gh);
  for (let y = -1; y <= H * SUB; y++) {
    for (let x = -1; x <= W * SUB; x++) {
      const i = (y + 1) * gw + x + 1;
      const fx = (x + 0.5) / SUB;
      const fy = (y + 0.5) / SUB;
      const h = height(seed, fx, fy);
      e[i] = h;
      g[i] = KINDS.indexOf(landAt(seed, sites, fx, fy, h));
    }
  }
  return { at: (x, y) => KINDS[g[(y + 1) * gw + x + 1]], hi: (x, y) => e[(y + 1) * gw + x + 1] };
}

function drawLand(ctx: CanvasRenderingContext2D, seed: number, land: Land[], sites: WorldSite[], flows: [number, number][][]): void {
  // the ground, sampled finer than the cells so coasts and woods have soft edges
  const px = CELL / SUB;
  const grid = landGrid(seed, sites);
  const wet = (x: number, y: number): boolean => { const k = grid.at(x, y); return k === 'sea' || k === 'lake'; };
  for (let y = 0; y < H * SUB; y++) {
    for (let x = 0; x < W * SUB; x++) {
      const k = grid.at(x, y);
      ctx.fillStyle = FILL[k];
      ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
      if (k === 'sea' || k === 'lake') continue;
      // light on slopes facing the north-west, shade on the far side
      // (neighbouring samples are a quarter cell apart: scaled to the old 0.3-cell reach)
      const sl = (grid.hi(x + 1, y + 1) - grid.hi(x - 1, y - 1)) * 3 * (0.3 * SUB);
      if (Math.abs(sl) > 0.02) {
        ctx.fillStyle = sl > 0 ? `rgba(255,250,230,${Math.min(0.22, sl * 0.5).toFixed(3)})` : `rgba(20,15,10,${Math.min(0.26, -sl * 0.6).toFixed(3)})`;
        ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
      }
    }
  }
  // the shore: a pale line where land meets the sea
  ctx.fillStyle = 'rgba(214,200,150,0.55)';
  for (let y = 0; y < H * SUB; y++) {
    for (let x = 0; x < W * SUB; x++) {
      if (wet(x, y)) continue;
      if (wet(x + 1, y) || wet(x - 1, y) || wet(x, y + 1) || wet(x, y - 1)) ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
    }
  }
  // rivers, widening as they run
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of flows) {
    for (let i = 1; i < line.length; i++) {
      const w = 2 + Math.min(3.5, i / 30);
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      ctx.strokeStyle = '#2f5878';
      ctx.lineWidth = w + 1.6;
      ctx.beginPath(); ctx.moveTo(ax * CELL, ay * CELL); ctx.lineTo(bx * CELL, by * CELL); ctx.stroke();
    }
    for (let i = 1; i < line.length; i++) {
      const w = 2 + Math.min(3.5, i / 30);
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      ctx.strokeStyle = '#5d93b5';
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(ax * CELL, ay * CELL); ctx.lineTo(bx * CELL, by * CELL); ctx.stroke();
    }
  }
  // what grows and stands on each cell, top row first so nearer things overlap further ones
  const peaks: [number, number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = land[y * W + x];
      const r = (n: number): number => hash32(seed, 778, x, y, n) / 4294967296;
      const px = x * CELL;
      const py = y * CELL;
      if (k === 'forest') {
        for (let t = 0; t < 4; t++) {
          const tx = px + 2 + r(t) * (CELL - 4);
          const ty = py + 3 + r(t + 9) * (CELL - 5);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath(); ctx.ellipse(tx + 1, ty + 2, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = r(t + 20) > 0.5 ? '#3f6a37' : '#4b7a3e';
          ctx.beginPath(); ctx.arc(tx, ty, 3.1, 0, Math.PI * 2); ctx.fill();
        }
      } else if (k === 'hills') {
        ctx.strokeStyle = 'rgba(70,55,35,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px + 5 + r(1) * 4, py + 10, 4, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else if (k === 'mount') {
        peaks.push([px + CELL / 2 + (r(2) - 0.5) * 6, py + CELL - 2, 0.8 + r(5) * 0.5]);
      } else if (k === 'marsh') {
        ctx.strokeStyle = 'rgba(40,60,45,0.6)';
        ctx.lineWidth = 1;
        for (let t = 0; t < 2; t++) {
          const tx = px + 3 + r(t) * (CELL - 6);
          const ty = py + 6 + r(t + 4) * (CELL - 8);
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 1, ty - 4); ctx.moveTo(tx + 2, ty); ctx.lineTo(tx + 3, ty - 3); ctx.stroke();
        }
      } else if (k === 'sea' && r(3) > 0.82) {
        ctx.strokeStyle = 'rgba(200,225,240,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px + 7, py + 9, 3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }
  }
  // mountain ranges: peaks drawn back to front, the snow on the tallest
  for (const [mx, base, sz] of peaks) {
    const hgt = 15 * sz;
    const half = 9 * sz;
    ctx.fillStyle = '#6e6a63';
    ctx.beginPath(); ctx.moveTo(mx - half, base); ctx.lineTo(mx, base - hgt); ctx.lineTo(mx + half, base); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a7a39a';
    ctx.beginPath(); ctx.moveTo(mx, base - hgt); ctx.lineTo(mx + half, base); ctx.lineTo(mx + 2 * sz, base); ctx.closePath(); ctx.fill();
    if (sz > 1) {
      ctx.fillStyle = '#eef0f2';
      ctx.beginPath(); ctx.moveTo(mx - 3 * sz, base - hgt + 5 * sz); ctx.lineTo(mx, base - hgt); ctx.lineTo(mx + 3 * sz, base - hgt + 5 * sz); ctx.closePath(); ctx.fill();
    }
  }
}

/** The land, rivers and what grows on them, drawn once per world shape and kept: drawing it costs a lot. */
let landCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function landLayer(seed: number, sites: WorldSite[]): HTMLCanvasElement | null {
  const key = `${seed}|${sites.length}|${sites.filter((s) => s.dead).length}`;
  if (landCache?.key === key) return landCache.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = W * CELL;
  canvas.height = H * CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawLand(ctx, seed, lands(seed, sites), sites, rivers(seed, sites));
  landCache = { key, canvas };
  return canvas;
}

/** Push apart name labels that would cover each other (measured as laid out, so it works at any width). */
function spreadLabels(box: HTMLElement): void {
  const els = Array.from(box.querySelectorAll<HTMLElement>('.wlabel'));
  if (els.length < 2) return;
  const bh = box.clientHeight;
  const r = els.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, h: b.height, dy: 0 }; });
  const top0 = box.getBoundingClientRect().top;
  const GAP = 1;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    const order = r.map((_, k) => k).sort((a, b) => r[a].t + r[a].dy - (r[b].t + r[b].dy) || a - b);
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = r[order[i]];
        const b = r[order[j]];
        if (a.r <= b.l || b.r <= a.l) continue;
        const at = a.t + a.dy;
        const bt = b.t + b.dy;
        const need = at + a.h + GAP - bt;
        if (need <= 0 || bt + b.h + GAP <= at) continue;
        // the lower one steps down, unless that would take it off the map: then the upper one steps up
        if (bt + need + b.h - top0 <= bh) b.dy += need;
        else a.dy -= need;
        moved = true;
      }
    }
    if (!moved) break;
  }
  els.forEach((e, k) => { if (r[k].dy) e.style.marginTop = `${Math.round(r[k].dy)}px`; });
}

/** Two colonies at war: a red dashed line, crossed swords at the middle. */
function warLine(ctx: CanvasRenderingContext2D, a: WorldSite, b: WorldSite): void {
  const ax = a.x * CELL + CELL / 2;
  const ay = a.y * CELL + CELL / 2;
  const bx = b.x * CELL + CELL / 2;
  const by = b.y * CELL + CELL / 2;
  ctx.strokeStyle = 'rgba(239,68,68,0.85)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([]);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  ctx.fillStyle = 'rgba(20,12,10,0.85)';
  ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f3d0c8';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(mx - 5, my + 5); ctx.lineTo(mx + 5, my - 5); ctx.moveTo(mx + 5, my + 5); ctx.lineTo(mx - 5, my - 5); ctx.stroke();
}

/** A dirt road that wanders a little between two places (faded when either end is abandoned). */
function road(ctx: CanvasRenderingContext2D, seed: number, a: WorldSite, b: WorldSite): void {
  ctx.globalAlpha = a.dead || b.dead ? 0.4 : 1;
  const ax = a.x * CELL + CELL / 2;
  const ay = a.y * CELL + CELL / 2;
  const bx = b.x * CELL + CELL / 2;
  const by = b.y * CELL + CELL / 2;
  const bend = ((hash32(seed, 779, a.x, a.y, b.x * 64 + b.y) / 4294967296) - 0.5) * 60;
  const mx = (ax + bx) / 2 - (by - ay) * (bend / 200);
  const my = (ay + by) / 2 + (bx - ax) * (bend / 200);
  ctx.strokeStyle = 'rgba(60,45,30,0.6)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.strokeStyle = '#d6c294';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** A colony: a cluster of roofs that grows with its people, or a broken ring of stones if abandoned. */
function settlement(ctx: CanvasRenderingContext2D, s: WorldSite, here: boolean, mine: boolean): void {
  ctx.save();
  // drawn for 20-pixel cells: scaled to the map's
  ctx.translate(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2);
  ctx.scale(K, K);
  const cx = 0;
  const cy = 0;
  if (here || mine) {
    ctx.fillStyle = here ? 'rgba(124,140,255,0.28)' : 'rgba(165,176,255,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = here ? '#7c8cff' : '#a5b0ff';
    ctx.lineWidth = 2;
    ctx.setLineDash(mine && !here ? [4, 3] : []);
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.dead) {
    ctx.fillStyle = '#6a6458';
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ctx.fillRect(cx + Math.cos(a) * 9 - 2, cy + Math.sin(a) * 9 - 2, 4, 4);
    }
    ctx.restore();
    return;
  }
  const n = Math.max(2, Math.min(9, Math.round(s.pop / 4)));
  const spots: [number, number][] = [[0, 0], [-9, -5], [9, -4], [-7, 7], [8, 7], [0, -11], [-13, 2], [13, 2], [0, 12]];
  ctx.fillStyle = 'rgba(80,65,40,0.45)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 2, 19, 15, 0, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < n; k++) {
    const [dx, dy] = spots[k];
    const x = cx + dx;
    const y = cy + dy;
    const big = k === 0;
    const w = big ? 12 : 8;
    const h = big ? 8 : 6;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - w / 2 + 1, y - h / 2 + 2, w, h);
    ctx.fillStyle = '#d9c9a3';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = big ? '#8a4a32' : '#9a5a3a';
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 1, y - h / 2 + 1); ctx.lineTo(x, y - h / 2 - (big ? 6 : 4)); ctx.lineTo(x + w / 2 + 1, y - h / 2 + 1); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export class WorldView {
  private el: HTMLElement;

  constructor(private go: (id: string) => void) {
    this.el = document.createElement('div');
    this.el.id = 'world';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-c],[data-x]');
      if (!t) { if (e.target === this.el) this.close(); return; }
      if (t.dataset.x !== undefined) this.close();
      else if (t.dataset.c) this.go(t.dataset.c);
    });
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  open(sites: WorldSite[], here: string, mine: string, seed = 1): void {
    const by = new Map(sites.map((s) => [s.id, s]));
    const year = (t: number): number => Math.floor(t / (TICKS_PER_DAY * 60)) + 1;
    const rows = sites.slice().sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0) || b.pop - a.pop).map((s) => {
      const p = s.from ? by.get(s.from) : undefined;
      const foes = (s.wars ?? []).map((id) => by.get(id)?.name).filter(Boolean);
      const sub = s.dead ? 'Abandoned' : `${s.pop} people${s.ruler ? ' · ruled by ' + esc(s.ruler) : ''}${foes.length ? ` · <span class="down">at war with ${foes.map((n) => esc(n!)).join(' and ')}</span>` : ''}`;
      const origin = p ? `Founded from ${esc(p.name)} in year ${year(s.founded)}${s.ruins ? `, on the ruins of ${esc(s.ruins)}` : ''}` : 'One of the first colonies';
      return `<button class="wrow${s.id === here ? ' here' : ''}" data-c="${s.id}"><b>${esc(s.name)}${s.id === mine ? ' <span class="tie kin">Yours</span>' : ''}${s.id === here ? ' <span class="tie dim">Viewing</span>' : ''}</b><span>${sub}</span><span>${origin}</span></button>`;
    }).join('');
    // names over the map, as links, placed where the canvas puts the colonies
    // a colony founded on a ruin stands on the same spot: only the living one is named
    const named = sites.filter((s) => !s.dead || !sites.some((o) => !o.dead && o.x === s.x && o.y === s.y));
    const labels = named.map((s) => `<button class="wlabel${s.id === here ? ' here' : ''}${s.dead ? ' dead' : ''}" data-c="${s.id}" style="left:${(((s.x + 0.5) / W) * 100).toFixed(2)}%;top:${((((s.y + 0.5) * CELL + 14) / (H * CELL)) * 100).toFixed(2)}%">${esc(s.name)}</button>`).join('');
    this.el.innerHTML = `<div class="wbox panel"><div class="whead"><b>The Hollow Lands</b><span>${sites.filter((s) => !s.dead).length} colonies</span><button class="icon" data-x title="Close" aria-label="Close">&times;</button></div><div class="wmapbox"><canvas class="wmap" width="${W * CELL}" height="${H * CELL}"></canvas>${labels}</div><div class="wlist">${rows}</div></div>`;
    const canvas = this.el.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    const layer = ctx ? landLayer(seed, sites) : null;
    if (ctx && layer) {
      ctx.drawImage(layer, 0, 0);
      // roads: from each colony to the one that founded it, and to its two nearest neighbours
      const done = new Set<string>();
      const link = (a: WorldSite, b: WorldSite): void => {
        const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
        if (done.has(key)) return;
        done.add(key);
        road(ctx, seed, a, b);
      };
      for (const s of sites) { const p = s.from ? by.get(s.from) : undefined; if (p) link(p, s); }
      for (const a of sites) {
        const near = sites.filter((o) => o !== a).sort((x, y) => Math.hypot(x.x - a.x, x.y - a.y) - Math.hypot(y.x - a.x, y.y - a.y) || (x.id < y.id ? -1 : 1));
        for (const b of near.slice(0, 2)) if (Math.hypot(b.x - a.x, b.y - a.y) < 30) link(a, b);
      }
      // wars: a red line of crossed blades between the two
      for (const s of sites) for (const id of s.wars ?? []) { const o = by.get(id); if (o && !o.dead && !s.dead && (s.id < o.id || !(o.wars ?? []).includes(s.id))) warLine(ctx, s, o); }
      for (const s of sites) settlement(ctx, s, s.id === here, s.id === mine);
      // a dark edge, like an old map
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, canvas.width * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,8,5,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.el.classList.remove('hidden');
    const box = this.el.querySelector<HTMLElement>('.wmapbox');
    if (box) spreadLabels(box);
  }
}
