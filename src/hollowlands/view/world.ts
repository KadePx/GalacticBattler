// The world overlay: the land itself (drawn from the world's seed, so everyone sees the same
// hills and woods), roads between colonies and the colonies they connect, and a list to go
// and look at any of them.

import { TICKS_PER_DAY } from '../config';
import { hash32 } from '../sim/rng';
import { esc } from './words';

export interface WorldSite { id: string; name: string; x: number; y: number; founded: number; from?: string; pop: number; ruler?: string; dead?: number; ruins?: string }

// Region size in cells (must match sim/world.ts), and canvas pixels per cell.
const W = 48;
const H = 36;
const CELL = 20;

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

/** What covers a point of the region (in cell units). Colonies always sit on open, dry ground. */
function landAt(seed: number, sites: WorldSite[], x: number, y: number): Land {
  const coast = (seed % 4 === 0 ? x : seed % 4 === 1 ? W - 1 - x : seed % 4 === 2 ? y * 1.33 : (H - 1 - y) * 1.33) / 6;
  const e = noise(seed, 1, x, y, 11) * 0.65 + noise(seed, 2, x, y, 4) * 0.35;
  const m = noise(seed, 3, x, y, 9) * 0.8 + noise(seed, 6, x, y, 3) * 0.2;
  let near = 99;
  for (const s of sites) near = Math.min(near, Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y));
  if (near < 1.4) return 'plain';
  if (coast + e * 0.6 < 0.55) return 'sea';
  if (e > 0.74 && near > 2) return 'mount';
  if (e > 0.63) return 'hills';
  if (m > 0.72 && e < 0.38 && near > 2) return 'lake';
  if (m > 0.6 && e < 0.46) return 'marsh';
  if (m > 0.47 || noise(seed, 4, x, y, 3) > 0.72) return 'forest';
  return 'plain';
}

/** What covers each cell (sampled at its middle), for the things drawn on top. */
function lands(seed: number, sites: WorldSite[]): Land[] {
  const out: Land[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(landAt(seed, sites, x + 0.5, y + 0.5));
  return out;
}

const FILL: Record<Land, string> = { sea: '#2b4a63', lake: '#3b6687', marsh: '#66775a', plain: '#93a066', forest: '#5f7c46', hills: '#a0915f', mount: '#8a8478' };

function drawLand(ctx: CanvasRenderingContext2D, seed: number, land: Land[], sites: WorldSite[]): void {
  // the ground, sampled finer than the cells so coasts and woods have soft edges
  const SUB = 5;
  const px = CELL / SUB;
  for (let y = 0; y < H * SUB; y++) {
    for (let x = 0; x < W * SUB; x++) {
      const k = landAt(seed, sites, (x + 0.5) / SUB, (y + 0.5) / SUB);
      ctx.fillStyle = FILL[k];
      ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
    }
  }
  // soft light and shade across the land
  for (let y = 0; y < H * 2; y++) {
    for (let x = 0; x < W * 2; x++) {
      const v = noise(seed, 5, x, y, 5);
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${((v - 0.5) * 0.1).toFixed(3)})` : `rgba(0,0,0,${((0.5 - v) * 0.12).toFixed(3)})`;
      ctx.fillRect(x * CELL / 2, y * CELL / 2, CELL / 2, CELL / 2);
    }
  }
  // what grows and stands on each cell
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = land[y * W + x];
      const r = (n: number): number => hash32(seed, 778, x, y, n) / 4294967296;
      const px = x * CELL;
      const py = y * CELL;
      if (k === 'forest') {
        for (let t = 0; t < 3; t++) {
          const tx = px + 4 + r(t) * 12;
          const ty = py + 5 + r(t + 9) * 11;
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath(); ctx.ellipse(tx + 1.5, ty + 2.5, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = r(t + 20) > 0.5 ? '#3f6a37' : '#4b7a3e';
          ctx.beginPath(); ctx.arc(tx, ty, 4.2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (k === 'hills') {
        ctx.strokeStyle = 'rgba(70,55,35,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px + 7 + r(1) * 4, py + 14, 5, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else if (k === 'mount') {
        const mx = px + CELL / 2 + (r(2) - 0.5) * 4;
        ctx.fillStyle = '#6e6a63';
        ctx.beginPath(); ctx.moveTo(mx - 9, py + 17); ctx.lineTo(mx, py + 2); ctx.lineTo(mx + 9, py + 17); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a7a39a';
        ctx.beginPath(); ctx.moveTo(mx, py + 2); ctx.lineTo(mx + 9, py + 17); ctx.lineTo(mx + 2, py + 17); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#eef0f2';
        ctx.beginPath(); ctx.moveTo(mx - 3, py + 7); ctx.lineTo(mx, py + 2); ctx.lineTo(mx + 3, py + 7); ctx.closePath(); ctx.fill();
      } else if (k === 'marsh') {
        ctx.strokeStyle = 'rgba(40,60,45,0.6)';
        ctx.lineWidth = 1;
        for (let t = 0; t < 3; t++) {
          const tx = px + 4 + r(t) * 12;
          const ty = py + 8 + r(t + 4) * 8;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 1, ty - 5); ctx.moveTo(tx + 2, ty); ctx.lineTo(tx + 3, ty - 4); ctx.stroke();
        }
      } else if (k === 'sea' && r(3) > 0.82) {
        ctx.strokeStyle = 'rgba(200,225,240,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px + 10, py + 12, 4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }
  }
}

/** A dirt road that wanders a little between two places. */
function road(ctx: CanvasRenderingContext2D, seed: number, a: WorldSite, b: WorldSite): void {
  const ax = a.x * CELL + CELL / 2;
  const ay = a.y * CELL + CELL / 2;
  const bx = b.x * CELL + CELL / 2;
  const by = b.y * CELL + CELL / 2;
  const bend = ((hash32(seed, 779, a.x, a.y, b.x * 64 + b.y) / 4294967296) - 0.5) * 60;
  const mx = (ax + bx) / 2 - (by - ay) * (bend / 200);
  const my = (ay + by) / 2 + (bx - ax) * (bend / 200);
  ctx.strokeStyle = 'rgba(60,45,30,0.55)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.strokeStyle = '#c8b48a';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.setLineDash([]);
}

/** A colony: a cluster of roofs that grows with its people, or a broken ring of stones if abandoned. */
function settlement(ctx: CanvasRenderingContext2D, s: WorldSite, here: boolean, mine: boolean): void {
  const cx = s.x * CELL + CELL / 2;
  const cy = s.y * CELL + CELL / 2;
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
      const sub = s.dead ? 'Abandoned' : `${s.pop} people${s.ruler ? ' · ruled by ' + esc(s.ruler) : ''}`;
      const origin = p ? `Founded from ${esc(p.name)} in year ${year(s.founded)}${s.ruins ? `, on the ruins of ${esc(s.ruins)}` : ''}` : 'One of the first colonies';
      return `<button class="wrow${s.id === here ? ' here' : ''}" data-c="${s.id}"><b>${esc(s.name)}${s.id === mine ? ' <span class="tie kin">Yours</span>' : ''}${s.id === here ? ' <span class="tie dim">Viewing</span>' : ''}</b><span>${sub}</span><span>${origin}</span></button>`;
    }).join('');
    // names over the map, as links, placed where the canvas puts the colonies
    const labels = sites.map((s) => `<button class="wlabel${s.id === here ? ' here' : ''}${s.dead ? ' dead' : ''}" data-c="${s.id}" style="left:${(((s.x + 0.5) / W) * 100).toFixed(2)}%;top:${(((s.y + 0.5) / H) * 100 + 5.2).toFixed(2)}%">${esc(s.name)}</button>`).join('');
    this.el.innerHTML = `<div class="wbox panel"><div class="whead"><b>The Hollow Lands</b><span>${sites.filter((s) => !s.dead).length} colonies</span><button class="icon" data-x title="Close" aria-label="Close">&times;</button></div><div class="wmapbox"><canvas class="wmap" width="${W * CELL}" height="${H * CELL}"></canvas>${labels}</div><div class="wlist">${rows}</div></div>`;
    const canvas = this.el.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawLand(ctx, seed, lands(seed, sites), sites);
      for (const s of sites) { const p = s.from ? by.get(s.from) : undefined; if (p) road(ctx, seed, p, s); }
      // the old roads between the first colonies, nearest neighbours
      const first = sites.filter((s) => !s.from);
      for (const a of first) {
        const b = first.filter((o) => o !== a).sort((x, y) => Math.abs(x.x - a.x) + Math.abs(x.y - a.y) - Math.abs(y.x - a.x) - Math.abs(y.y - a.y))[0];
        if (b && a.id < b.id) road(ctx, seed, a, b);
      }
      for (const s of sites) settlement(ctx, s, s.id === here, s.id === mine);
      // a dark edge, like an old map
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, canvas.width * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,8,5,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.el.classList.remove('hidden');
  }
}
