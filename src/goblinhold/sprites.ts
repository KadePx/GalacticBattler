// Pixel art, drawn in code once at startup. One style everywhere: 3/4 top-down view, light from the
// top-left, a shared dark outline, and a small warm palette.
import { Season } from './defs';

export type Spr = HTMLCanvasElement;
export const OUTLINE = '#2b1d18';

// ---------- palette ----------
export const PAL = {
  stone: ['#d8d1c4', '#b8b0a2', '#968e82', '#726b62', '#57514b'],
  slate: ['#7d93ad', '#5f7590', '#475a72', '#344358'],
  roof: ['#d9694a', '#b8503a', '#8e3a2b', '#682a20'],
  wood: ['#d39a5e', '#b07a44', '#8a5a32', '#633f22', '#45291a'],
  thatch: ['#f0d27a', '#d9b65a', '#b89442', '#8d6e2e'],
  plaster: ['#efe3c6', '#d9c9a4', '#b9a782'],
  leaf: ['#7cc05a', '#5aa445', '#3f8436', '#2b6029', '#1d4220'],
  pine: ['#4f9a5a', '#3a7f48', '#2a6238', '#1c4428'],
  grass: ['#7db455', '#6fa64b', '#629842', '#558a3a'],
  dirt: ['#c9a774', '#b8935e', '#a17d4c', '#86663d'],
  water: ['#9ccdea', '#5b9bd0', '#477fb8', '#3a6aa0', '#2f5788'],
  sand: '#dcc58e',
  snow: ['#f6f9fb', '#e4ecf2', '#c9d6e1', '#a9bccb'],
  gold: ['#ffe58a', '#ffcf4a', '#d9a22c'],
  red: ['#e05a48', '#b73a2e', '#842820'],
  cloth: ['#f2e6c8', '#d8c8a0'],
};

/** Every sprite canvas is ART times finer than world units: a 16-unit tile is 32 real pixels. */
export const ART = 2;

function canvas(w: number, h: number): [Spr, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

const rgbCache = new Map<string, [number, number, number]>();
export function rgb(col: string): [number, number, number] {
  let v = rgbCache.get(col);
  if (!v) { v = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)]; rgbCache.set(col, v); }
  return v;
}
/** Lighten (f > 0) or darken (f < 0) a hex colour. */
export function tint(col: string, f: number): string {
  const [r, g, b] = rgb(col);
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return '#' + [m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * A small painting helper. Coordinates are in design units (world units for buildings); everything is
 * rasterised at `s` real pixels per unit, so curves and slopes come out smooth. `hp`/`hR`/`line` work in
 * real pixels for fine detail. `outline()` adds a crisp one-pixel edge plus soft rim lighting.
 */
export class Paint {
  c: Spr;
  x: CanvasRenderingContext2D;
  W: number;
  H: number;
  constructor(public w: number, public h: number, public s = ART) { [this.c, this.x] = canvas(w * s, h * s); this.W = this.c.width; this.H = this.c.height; }
  R(x: number, y: number, w: number, h: number, col: string) {
    const s = this.s, x0 = Math.round(x * s), y0 = Math.round(y * s), x1 = Math.round((x + w) * s), y1 = Math.round((y + h) * s);
    this.x.fillStyle = col; this.x.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    return this;
  }
  P(x: number, y: number, col: string) { return this.R(x, y, 1, 1, col); }
  /** one real pixel */
  hp(x: number, y: number, col: string) { this.x.fillStyle = col; this.x.fillRect(Math.round(x), Math.round(y), 1, 1); return this; }
  hR(x: number, y: number, w: number, h: number, col: string) { this.x.fillStyle = col; this.x.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); return this; }
  line(x0: number, y0: number, x1: number, y1: number, col: string) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    this.x.fillStyle = col;
    for (let i = 0; i < 400; i++) {
      this.x.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  E(cx: number, cy: number, rx: number, ry: number, col: string | ((hx: number, hy: number, nx: number, ny: number) => string | null)) {
    const s = this.s, ax = rx * rx + 0.6, ay = ry * ry + 0.6;
    const y0 = Math.floor((cy - ry - 1) * s), y1 = Math.ceil((cy + ry + 2) * s), x0 = Math.floor((cx - rx - 1) * s), x1 = Math.ceil((cx + rx + 2) * s);
    if (typeof col === 'string') this.x.fillStyle = col;
    for (let hy = y0; hy < y1; hy++) for (let hx = x0; hx < x1; hx++) {
      const dx = (hx + 0.5) / s - (cx + 0.5), dy = (hy + 0.5) / s - (cy + 0.5);
      if ((dx * dx) / ax + (dy * dy) / ay > 1) continue;
      if (typeof col !== 'string') { const c = col(hx, hy, dx / Math.sqrt(ax), dy / Math.sqrt(ay)); if (!c) continue; this.x.fillStyle = c; }
      this.x.fillRect(hx, hy, 1, 1);
    }
    return this;
  }
  /** Rows of a trapezoid/triangle: from (l0..r0) at row y0 to (l1..r1) at row y1, inclusive. */
  T(y0: number, y1: number, l0: number, r0: number, l1: number, r1: number, col: string | ((row: number, x: number, hx: number, hy: number) => string)) {
    const s = this.s;
    if (typeof col === 'string') this.x.fillStyle = col;
    for (let hy = Math.round(y0 * s); hy < Math.round((y1 + 1) * s); hy++) {
      const yy = (hy + 0.5) / s - 0.5;
      const k = y1 === y0 ? 0 : Math.max(0, Math.min(1, (yy - y0) / (y1 - y0)));
      const l = l0 + (l1 - l0) * k, r = r0 + (r1 - r0) * k;
      const hx0 = Math.round(l * s), hx1 = Math.round((r + 1) * s);
      for (let hx = hx0; hx < hx1; hx++) {
        if (typeof col !== 'string') this.x.fillStyle = col(Math.floor(hy / s) - y0, Math.floor(hx / s), hx, hy);
        this.x.fillRect(hx, hy, 1, 1);
      }
    }
    return this;
  }
  /** Run fn over every opaque real pixel in a design-unit rect; return a colour to repaint it. */
  each(x: number, y: number, w: number, h: number, fn: (hx: number, hy: number, r: number, g: number, b: number) => string | null) {
    const s = this.s, X0 = Math.max(0, Math.round(x * s)), Y0 = Math.max(0, Math.round(y * s));
    const X1 = Math.min(this.W, Math.round((x + w) * s)), Y1 = Math.min(this.H, Math.round((y + h) * s));
    if (X1 <= X0 || Y1 <= Y0) return this;
    const d = this.x.getImageData(X0, Y0, X1 - X0, Y1 - Y0);
    for (let yy = 0; yy < Y1 - Y0; yy++) for (let xx = 0; xx < X1 - X0; xx++) {
      const i = (yy * (X1 - X0) + xx) * 4;
      if (d.data[i + 3] < 40) continue;
      const c = fn(X0 + xx, Y0 + yy, d.data[i], d.data[i + 1], d.data[i + 2]);
      if (!c) continue;
      const [r, g, b] = rgb(c);
      d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = 255;
    }
    this.x.putImageData(d, X0, Y0);
    return this;
  }
  /** Dark one-pixel outline; `rim` also lightens top edges and darkens bottom edges for a little volume. */
  outline(col = OUTLINE, rim = true) {
    const W = this.W, H = this.H;
    const d = this.x.getImageData(0, 0, W, H);
    const A = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d.data[(y * W + x) * 4 + 3] > 40;
    const [or, og, ob] = rgb(col);
    const set = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (A(x, y)) {
        if (!rim) continue;
        const i = (y * W + x) * 4;
        const f = !A(x, y - 1) ? 0.22 : !A(x, y + 1) ? -0.2 : 0;
        if (!f) continue;
        for (let k = 0; k < 3; k++) { const v = d.data[i + k]; d.data[i + k] = Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)); }
        continue;
      }
      if (A(x + 1, y) || A(x - 1, y) || A(x, y + 1) || A(x, y - 1)) set[y * W + x] = 1;
    }
    for (let i = 0; i < W * H; i++) if (set[i]) { d.data[i * 4] = or; d.data[i * 4 + 1] = og; d.data[i * 4 + 2] = ob; d.data[i * 4 + 3] = 255; }
    this.x.putImageData(d, 0, 0);
    return this;
  }
  done() { return this.c; }
}

/** Character grid -> canvas with outline. Each character is one design pixel (s real pixels). */
function grid(rows: string[], pal: Record<string, string>, outline = OUTLINE, s = ART): Spr {
  const h = rows.length, w = rows[0].length;
  const p = new Paint(w + 2, h + 2, s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch !== '.' && pal[ch]) p.P(x + 1, y + 1, pal[ch]);
  }
  if (outline) p.outline(outline, false);
  return p.done();
}

export function flip(s: Spr): Spr {
  const [c, x] = canvas(s.width, s.height);
  x.translate(s.width, 0);
  x.scale(-1, 1);
  x.drawImage(s, 0, 0);
  return c;
}

function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- terrain objects ----------
const treeCache = new Map<string, Spr>();
/** Leafy clump shaded by its own normal (light from the top-left), with a few leaf speckles. */
function clump(p: Paint, cx: number, cy: number, rx: number, ry: number, lf: string[], seed: number) {
  p.E(cx, cy, rx, ry, (hx, hy, nx, ny) => {
    const l = nx * 0.6 + ny * 0.8;
    let i = l < -0.55 ? 0 : l < 0.05 ? 1 : l < 0.6 ? 2 : 3;
    const h = hash(hx, hy, seed);
    if (h < 0.1 && i > 0) i--; else if (h > 0.93 && i < 3) i++;
    return lf[i];
  });
}
/** Round oaks and pointed pines; winter adds snow, autumn turns oaks golden. */
export function treeSprite(v: number, season: Season): Spr {
  const pine = v % 3 === 0;
  const key = `${pine ? 'p' : 'o'}${v % 2}${season}`;
  let c = treeCache.get(key);
  if (c) return c;
  if (pine) {
    const p = new Paint(18, 26);
    p.R(8, 19, 3, 5, PAL.wood[3]).R(8, 19, 1, 5, PAL.wood[2]);
    const pl = PAL.pine;
    const tiers: [number, number, number][] = [[1, 7, 4], [6, 13, 6], [11, 20, 8]];
    for (const [y0, y1, half] of tiers) {
      // each tier: lit left, shaded right, serrated hem of needles
      p.T(y0, y1, 9, 9, 9 - half, 9 + half, (row, x, hx, hy) => {
        const edge = (hy + (hx % 3)) % 5 === 0;
        const lit = hx < (9.2 - row * 0.1) * ART;
        if (row >= y1 - y0 - 1) return hx % 3 === 0 ? pl[3] : pl[2];
        if (edge) return lit ? pl[0] : pl[2];
        return lit ? (hash(hx, hy, 5) < 0.12 ? pl[0] : pl[1]) : (hash(hx, hy, 6) < 0.15 ? pl[3] : pl[2]);
      });
    }
    if (season === 'winter') for (const [y0, , half] of tiers) p.T(y0, y0 + 2, 9, 9, 9 - half / 2, 9 + half / 2 - 1, PAL.snow[0]);
    c = p.outline().done();
  } else {
    const p = new Paint(20, 24);
    // trunk with bark lines and roots
    p.R(8, 14, 4, 9, PAL.wood[3]).R(8, 14, 1.5, 9, PAL.wood[2]).R(6.5, 21.5, 7, 1.5, PAL.wood[3]);
    for (let i = 0; i < 4; i++) p.hp(18 + (i % 2) * 3, 32 + i * 3, PAL.wood[4]);
    const lf = season === 'autumn' ? ['#ffd070', '#f0a640', '#d07a2e', '#9a4a22'] : season === 'winter' ? ['#a89a8a', '#8a7a6a', '#6a5a4a', '#4a3e34'] : ['#9ad46a', PAL.leaf[0], PAL.leaf[1], PAL.leaf[3]];
    if (season === 'winter') {
      p.E(10, 9, 8, 6, '#6e5a4c');
      p.E(9, 8, 7, 5, '#86705e');
      p.each(0, 0, 20, 16, (hx, hy) => { const h = hash(hx, hy, v); return h < 0.08 ? '#5a4838' : h > 0.95 ? '#9a8470' : null; });
      p.R(9, 9, 2, 7, PAL.wood[3]).R(6, 11, 4, 1, PAL.wood[3]).R(11, 10, 4, 1, PAL.wood[3]);
      p.E(9, 4, 6, 1, PAL.snow[0]).E(5, 6, 2, 1, PAL.snow[0]).E(14, 5, 2, 1, PAL.snow[0]);
    } else {
      const o = v % 2;
      clump(p, 10, 11, 8, 5, lf, 1);
      clump(p, 5 + o, 9, 4, 4, lf, 2);
      clump(p, 14, 9 - o, 4, 4, lf, 3);
      clump(p, 9, 6, 5, 4, lf, 4);
      clump(p, 12 - o, 4, 3, 3, lf, 5);
      if (season === 'summer' && o) for (const [ax2, ay2] of [[6, 10], [13, 12], [10, 7]]) p.R(ax2, ay2, 1, 1, '#d8402e');
    }
    c = p.outline().done();
  }
  treeCache.set(key, c);
  return c;
}

export function saplingSprite(): Spr {
  const p = new Paint(7, 7);
  p.R(3, 3, 1, 4, PAL.wood[3]);
  clump(p, 2, 2, 1, 1, ['#9ad46a', PAL.leaf[0], PAL.leaf[1], PAL.leaf[3]], 21);
  clump(p, 4, 3, 1, 1, ['#9ad46a', PAL.leaf[0], PAL.leaf[1], PAL.leaf[3]], 22);
  return p.outline().done();
}

const rockCache = new Map<string, Spr>();
export function rockSprite(v: number, size: number, season: Season): Spr {
  const key = `${v % 3}${size}${season === 'winter'}`;
  let c = rockCache.get(key);
  if (c) return c;
  const p = new Paint(16, 14);
  const st = PAL.stone;
  const r = size >= 2 ? 6 : size === 1 ? 5 : 3;
  const cx = 8, cy = 8;
  // faceted boulder: shade by the facet a pixel falls in
  const facet = (hx: number, hy: number, nx: number, ny: number) => {
    const a = Math.atan2(ny, nx), f = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6 + (v % 3) * 0.3) % 6;
    const lit = [2, 1, 0, 0, 1, 2][f] + (nx * nx + ny * ny < 0.2 ? -1 : 0);
    const i = Math.max(0, Math.min(3, lit + (ny > 0.35 ? 1 : 0)));
    const j = Math.min(4, i + 1);
    return hash(hx, hy, 9) < 0.06 ? st[Math.min(4, j + 1)] : st[j];
  };
  p.E(cx, cy, r + 1, r - 1, facet);
  if (v % 3 === 1 && size >= 1) p.E(cx + 4, cy + 2, 2, 2, facet);
  if (v % 3 === 2 && size >= 1) p.E(cx - 4, cy + 2, 2, 1, facet);
  // a crack
  p.line((cx - 1) * ART, (cy - 2) * ART, (cx + 1) * ART, (cy + 1) * ART, st[3]);
  if (season === 'winter') p.E(cx - 1, cy - r + 2, Math.max(1, r - 2), 1, PAL.snow[0]);
  else if (size >= 1) p.hR((cx + 2) * ART, (cy + r - 3) * ART, 3, 2, '#6a8a4a');
  c = p.outline().done();
  rockCache.set(key, c);
  return c;
}

const bushCache = new Map<string, Spr>();
export function bushSprite(berries: number, season: Season): Spr {
  const b = Math.min(3, berries);
  const key = `${b}${season}`;
  let c = bushCache.get(key);
  if (c) return c;
  const p = new Paint(16, 13);
  const lf = season === 'winter' ? ['#a8b898', '#8a9a7a', '#6a7a5a', '#4a5a3a'] : season === 'autumn' ? ['#c8c060', '#a8a848', '#86883a', '#5e622a'] : ['#9ad46a', PAL.leaf[1], PAL.leaf[2], PAL.leaf[3]];
  clump(p, 8, 8, 6, 3, lf, 11);
  clump(p, 5, 6, 3, 3, lf, 12);
  clump(p, 10, 5, 3, 3, lf, 13);
  const spots = [[4, 7], [9, 5], [11, 8], [6, 9], [8, 7], [12, 6]];
  for (let i = 0; i < b * 2 && i < spots.length; i++) {
    const X = spots[i][0] * ART, Y = spots[i][1] * ART;
    p.hR(X, Y, 2, 2, '#c82840').hp(X, Y, '#ff7a8a').hp(X + 1, Y + 2, '#8a1a2a');
  }
  if (season === 'winter') p.E(7, 3, 4, 1, PAL.snow[0]);
  c = p.outline().done();
  bushCache.set(key, c);
  return c;
}

// ---------- buildings ----------
/** Coursed stone: each block gets its own tone, a lit top-left edge and a shaded lower edge. Clipped to the rect. */
function stoneBlocks(p: Paint, x0: number, y0: number, w: number, h: number, base: string, dark: string, light: string, bw = 6, bh = 4) {
  const s = p.s, X0 = Math.round(x0 * s), Y0 = Math.round(y0 * s), X1 = Math.round((x0 + w) * s), Y1 = Math.round((y0 + h) * s);
  const BW = Math.round(bw * s), BH = Math.round(bh * s);
  const tones = [tint(base, 0.07), base, tint(base, -0.06), base];
  for (let hy = Y0; hy < Y1; hy++) {
    const row = Math.floor((hy - Y0) / BH), ly = (hy - Y0) % BH, off = row % 2 ? BW >> 1 : 0;
    for (let hx = X0; hx < X1; hx++) {
      const lx0 = hx - X0 + off, col = Math.floor(lx0 / BW), lx = lx0 % BW;
      const tone = tones[Math.floor(hash(col, row, x0 * 7 + y0) * 4)];
      let c = tone;
      if (ly === 0 || lx === 0) c = dark;
      else if (ly === 1 || lx === 1) c = light;
      else if (ly === BH - 1 || lx === BW - 1) c = tint(tone, -0.1);
      else if (hash(hx, hy, 13) < 0.035) c = tint(tone, -0.12);
      p.hp(hx, hy, c);
    }
  }
}

/** Roof callbacks for Paint.T: overlapping shingles, split into a lit and a shaded half at x = split. */
function shingles(cols: [string, string, string, string], split: number, rowH = 4, w = 5) {
  return (_r: number, _x: number, hx: number, hy: number) => {
    const row = Math.floor(hy / rowH), off = row % 2 ? Math.floor(w / 2) : 0;
    const lx = (hx + off) % w, ly = hy % rowH;
    const side = hx < split * ART ? 0 : 2;
    if (ly === rowH - 1 || lx === 0) return cols[side + 1];
    if (ly === 0 && side === 0) return tint(cols[0], 0.12);
    return hash(Math.floor((hx + off) / w), row, 77) < 0.18 ? tint(cols[side], -0.05) : cols[side];
  };
}
/** Thatch: layered bundles of straw with streaky strands. */
function thatchFill(th: string[], split: number) {
  return (_r: number, _x: number, hx: number, hy: number) => {
    const band = Math.floor(hy / 7), ly = hy % 7, side = hx < split * ART ? 0 : 1;
    if (ly === 6) return side ? th[3] : th[2];
    const st = hash(hx, band, 31);
    if (ly === 0 && !side) return th[0];
    if (st < 0.2) return side ? th[1] : th[0];
    if (st > 0.82 || ly === 5) return side ? th[3] : th[2];
    return side ? th[2] : th[1];
  };
}
/** Plank wall: vertical boards with seams and a little grain. */
function planks(p: Paint, x0: number, y0: number, w: number, h: number, cols: string[], bw = 3) {
  const s = p.s, X0 = Math.round(x0 * s), Y0 = Math.round(y0 * s), X1 = Math.round((x0 + w) * s), Y1 = Math.round((y0 + h) * s), BW = bw * s;
  for (let hy = Y0; hy < Y1; hy++) for (let hx = X0; hx < X1; hx++) {
    const lx = (hx - X0) % BW, b = Math.floor((hx - X0) / BW);
    let c = b % 2 ? cols[1] : cols[0];
    if (lx === BW - 1) c = cols[2];
    else if (hash(hx, Math.floor(hy / 3), b) < 0.06) c = cols[2];
    p.hp(hx, hy, c);
  }
}
/** Glazed window: dark panes, a mullion and a glint. */
function windowPane(p: Paint, x: number, y: number, w: number, h: number, frame: string) {
  p.R(x, y, w, h, frame).R(x + 0.5, y + 0.5, w - 1, h - 1, '#2e2a40');
  const s = p.s, X = Math.round(x * s), Y = Math.round(y * s), Wd = Math.round(w * s), Hd = Math.round(h * s);
  p.hR(X + 1, Y + 1, Wd - 2, Math.max(1, Math.floor(Hd / 2) - 1), '#3e3a58');
  p.hR(X + (Wd >> 1), Y + 1, 1, Hd - 2, frame).hR(X + 1, Y + (Hd >> 1), Wd - 2, 1, frame);
  p.hp(X + 2, Y + 2, '#9ab0d8').hp(X + 3, Y + 2, '#6a7ca8');
}

/** Keep: courtyard wall with corner turrets, a gatehouse and a slate-roofed donjon. 52x66, footprint 48x48. */
export function paintKeep(season: Season): Spr {
  const p = new Paint(52, 66);
  const st = PAL.stone, sl = PAL.slate, rf = PAL.roof;
  // back wall walkway (seen from above)
  p.R(6, 18, 40, 6, st[1]).R(6, 18, 40, 1, st[0]);
  for (let x = 7; x < 45; x += 4) p.R(x, 16, 2, 2, st[1]);
  // side walls going back
  p.R(4, 20, 5, 22, st[1]).R(4, 20, 1, 22, st[0]);
  p.R(43, 20, 5, 22, st[2]).R(47, 20, 1, 22, st[3]);
  // courtyard floor
  p.R(9, 24, 34, 16, PAL.dirt[2]);
  for (let i = 0; i < 12; i++) p.P(10 + Math.floor(hash(i, 1) * 32), 25 + Math.floor(hash(i, 2) * 14), PAL.dirt[3]);
  // donjon: square tower with a slate pyramid roof
  stoneBlocks(p, 16, 16, 20, 20, st[1], st[2], st[0], 5, 4);
  p.R(32, 16, 4, 20, st[2]);
  for (let y = 16; y < 36; y += 4) p.R(32, y, 4, 1, st[3]);
  // arrow slits and a little balcony
  for (const sx of [19, 25, 31]) { p.R(sx, 20, 1, 6, '#2b1d18'); p.R(sx, 20, 1, 1, '#4a3a2e'); }
  windowPane(p, 23, 21, 4, 4, PAL.wood[3]);
  p.R(18, 29, 16, 2, PAL.wood[2]).R(18, 31, 16, 1, PAL.wood[3]);
  for (let x = 19; x < 34; x += 3) p.R(x, 27, 1, 2, PAL.wood[3]);
  p.T(0, 15, 26, 26, 14, 38, shingles([sl[0], sl[1], sl[2], sl[3]], 26, 4, 4));
  p.R(14, 15, 25, 1, sl[3]);
  p.R(26, 0, 1, 2, '#2b1d18');
  // front wall face
  stoneBlocks(p, 4, 40, 44, 18, st[1], st[2], st[0], 6, 4);
  p.R(4, 56, 44, 2, st[3]);
  // front walkway + merlons
  p.R(4, 36, 44, 4, st[0]);
  for (let x = 5; x < 47; x += 4) { p.R(x, 33, 3, 3, st[0]); p.R(x, 35, 3, 1, st[1]); }
  // corner turrets with conical roofs
  for (const tx of [0, 39]) {
    stoneBlocks(p, tx, 30, 13, 30, st[1], st[2], st[0], 4, 4);
    p.R(tx + 9, 30, 4, 30, st[2]);
    for (let y = 30; y < 60; y += 4) p.R(tx + 9, y, 4, 1, st[3]);
    p.R(tx, 58, 13, 2, st[3]);
    p.R(tx + 5, 40, 2, 4, '#2b1d18');
    p.T(14, 30, tx + 6, tx + 6, tx - 1, tx + 13, shingles([rf[0], rf[1], rf[2], rf[3]], tx + 6, 4, 3));
    p.R(tx + 6, 12, 1, 3, '#2b1d18');
    p.R(tx + 7, 12, 3, 2, PAL.gold[1]);
  }
  // gatehouse: arched gate with wooden doors
  p.R(19, 44, 14, 14, st[3]);
  p.T(41, 44, 23, 28, 20, 31, st[3]);
  p.R(21, 46, 10, 12, PAL.wood[3]);
  p.T(43, 46, 24, 27, 21, 30, PAL.wood[3]);
  planks(p, 21, 46, 10, 12, [PAL.wood[2], PAL.wood[3], PAL.wood[4]], 2);
  p.R(21, 46, 10, 1, PAL.wood[4]).R(21, 49, 10, 0.5, '#5a5a62').R(21, 54, 10, 0.5, '#5a5a62').R(25.75, 44, 0.5, 14, PAL.wood[4]);
  p.P(24, 52, PAL.gold[1]).P(27, 52, PAL.gold[1]);
  if (season !== 'winter') for (let i = 0; i < 22; i++) { const mx = 2 + Math.floor(hash(i, 3) * 48), my = 50 + Math.floor(hash(i, 4) * 8); if (mx > 17 && mx < 34) continue; p.hR(mx * ART, my * ART + 1, 2, 1, '#6a8a4a'); }
  // banners either side of the gate
  for (const bx of [13, 35]) { p.R(bx, 41, 4, 9, rf[1]).R(bx, 41, 4, 1, rf[3]).P(bx, 50, rf[1]).P(bx + 3, 50, rf[1]).R(bx + 1, 44, 2, 2, PAL.gold[1]); }
  if (season === 'winter') {
    p.T(0, 3, 26, 26, 22, 30, PAL.snow[0]);
    for (const tx of [0, 39]) p.T(14, 17, tx + 6, tx + 6, tx + 3, tx + 9, PAL.snow[0]);
    p.R(4, 36, 44, 1, PAL.snow[0]);
  }
  return p.outline().done();
}

export function paintHut(season: Season): Spr {
  const p = new Paint(34, 42);
  const th = PAL.thatch, wd = PAL.wood, pl = PAL.plaster;
  // walls: plaster with timber frame
  p.R(3, 22, 28, 17, pl[0]).R(23, 22, 8, 17, pl[1]);
  p.each(3, 22, 28, 17, (hx, hy) => (hash(hx, hy, 17) < 0.05 ? (hx > 46 ? '#cbb994' : '#e4d6b4') : null));
  p.R(3, 22, 2, 17, wd[3]).R(29, 22, 2, 17, wd[3]).R(16, 22, 2, 7, wd[3]).R(3, 29, 28, 2, wd[3]).R(3, 37, 28, 2, wd[3]);
  p.R(6, 31, 1, 6, wd[2]).R(10, 31, 1, 6, wd[2]);
  // door
  p.R(13, 30, 8, 9, wd[4]); planks(p, 14, 31, 6, 8, [wd[1], wd[2], wd[3]], 2); p.R(14, 31, 6, 1, wd[3]).hp(37, 70, PAL.gold[0]).hp(37, 71, PAL.gold[2]);
  // windows with shutters
  for (const wx of [6, 22]) { windowPane(p, wx, 23.5, 6, 5, wd[4]); p.R(wx - 1, 28, 8, 1, wd[3]); if (season !== 'winter') { p.R(wx, 27.5, 6, 1, '#4f8a3a'); p.hp(wx * ART + 2, 55, '#f0a0c8').hp(wx * ART + 6, 55, '#f4e070').hp(wx * ART + 9, 55, '#f0a0c8'); } }
  // thatched roof
  p.T(3, 22, 10, 23, 0, 33, thatchFill(th, 23));
  p.R(0, 21, 34, 1.5, th[3]);
  p.R(9, 3, 16, 1, th[3]);
  // chimney
  p.R(22, 0, 5, 9, PAL.stone[2]).R(22, 0, 5, 1, PAL.stone[3]).R(22, 0, 2, 9, PAL.stone[1]);
  if (season === 'winter') { p.T(3, 8, 10, 23, 6, 27, PAL.snow[0]); p.T(9, 12, 6, 27, 4, 29, PAL.snow[1]); }
  return p.outline().done();
}

export function paintFarm(stage: number, season: Season): Spr {
  const p = new Paint(48, 32);
  const R = (a: number, b: number, w: number, h: number, col: string) => { p.R(a, b, w, h, col); };
  const winter = season === 'winter';
  R(1, 2, 46, 28, winter ? '#c9d0d4' : '#7a5636');
  for (let r = 0; r < 4; r++) {
    const py = 4 + r * 7;
    R(2, py + 2, 44, 3, winter ? '#b0bac2' : '#5e4026');
    R(2, py + 2, 44, 1, winter ? '#dfe6ea' : '#8a6440');
    if (winter) { for (let i = 0; i < 11; i++) if ((i + r) % 2) R(3 + i * 4, py + 1, 1, 2, '#9a8a6a'); continue; }
    for (let i = 0; i < 11; i++) {
      const px = 3 + i * 4;
      if (stage === 0) { R(px + 1, py + 2, 1, 1, '#8ac050'); }
      else if (stage === 1) { R(px, py + 1, 1, 2, '#6aa040'); R(px + 2, py + 1, 1, 2, '#6aa040'); R(px + 1, py, 1, 3, '#8ac050'); }
      else {
        const ripe = season === 'autumn' ? '#e8b440' : '#e0c050';
        R(px, py - 1, 1, 4, '#8a9a3a'); R(px + 2, py - 1, 1, 4, '#8a9a3a'); R(px + 1, py - 2, 1, 5, '#a8b048'); R(px, py - 2, 3, 1, ripe);
      }
    }
  }
  // fence
  for (let i = 0; i < 48; i += 6) { R(i, 0, 2, 4, OUTLINE); R(i, 0, 1, 3, PAL.wood[2]); R(i, 28, 2, 4, OUTLINE); R(i, 28, 1, 3, PAL.wood[2]); }
  R(0, 1, 48, 1, PAL.wood[1]); R(0, 29, 48, 1, PAL.wood[1]);
  // soil texture and fence grain at full resolution
  if (!winter) p.each(1, 2, 46, 27, (hx, hy, r) => (r === 0x7a && hash(hx, hy, 61) < 0.08 ? '#6a4a2e' : r === 0x7a && hash(hx, hy, 62) < 0.04 ? '#8e6a46' : null));
  for (let i = 0; i < 48; i += 6) { p.hp(i * 2, 1, PAL.wood[0]); p.hp(i * 2, 57, PAL.wood[0]); }
  return p.done();
}

export function paintTower(season: Season): Spr {
  const p = new Paint(20, 42);
  const wd = PAL.wood, rf = PAL.roof;
  // legs and braces
  p.R(3, 16, 3, 25, wd[2]).R(14, 16, 3, 25, wd[3]).R(3, 16, 1, 25, wd[1]);
  for (let i = 0; i < 9; i++) { p.P(6 + i, 21 + i, wd[3]); p.P(13 - i, 21 + i, wd[3]); p.P(6 + i, 31 + i * 0.9, wd[3]); p.P(13 - i, 31 + i * 0.9, wd[3]); }
  // platform
  p.R(1, 14, 18, 6, wd[1]); planks(p, 1, 14.5, 18, 3.5, [wd[1], wd[0], wd[2]], 2); p.R(1, 18, 18, 2, wd[3]).R(1, 14, 18, 0.5, wd[0]);
  for (const rx of [3, 16]) p.R(rx, 15.5, 1, 1, '#c8b890');
  // roof
  p.T(0, 9, 10, 10, 0, 19, shingles([rf[0], rf[1], rf[2], rf[3]], 10, 4, 3));
  p.R(2, 10, 1, 4, wd[3]).R(17, 10, 1, 4, wd[3]);
  if (season === 'winter') p.T(0, 3, 10, 10, 6, 14, PAL.snow[0]);
  return p.outline().done();
}

export function paintMarket(season: Season): Spr {
  const p = new Paint(34, 38);
  const wd = PAL.wood;
  // counter
  planks(p, 2, 24, 30, 11, [wd[1], wd[0], wd[2]], 3); p.R(2, 24, 30, 1.5, wd[0]).R(2, 33, 30, 2, wd[3]);
  for (let x = 4; x < 32; x += 6) p.R(x, 26, 1, 7, wd[2]);
  // goods on the counter
  for (const [ax2, ay2] of [[5, 22], [7, 21], [9, 22], [6, 20]]) p.E(ax2, ay2, 1, 1, (_x, _y, nx, ny) => (nx + ny < -0.4 ? '#ff8a6a' : '#d8402e'));
  p.R(13, 20, 7, 4, PAL.thatch[1]).R(14, 19, 5, 1, PAL.thatch[0]);
  p.R(22, 21, 7, 3, PAL.stone[1]).R(23, 20, 5, 1, PAL.stone[0]);
  // posts
  p.R(2, 8, 2, 16, wd[3]).R(30, 8, 2, 16, wd[3]);
  // striped awning
  p.T(2, 12, 6, 27, 0, 33, (row, x, hx, hy) => { const red = Math.floor(x / 4) % 2 === 0; const fold = hx % 8 === 7; const c = red ? (row > 8 ? PAL.red[1] : PAL.red[0]) : (row > 8 ? PAL.cloth[1] : PAL.cloth[0]); return fold ? tint(c, -0.12) : hy % 6 === 0 && row < 8 ? tint(c, 0.08) : c; });
  for (let x = 0; x < 34; x += 4) p.R(x, 13, 2, 2, Math.floor(x / 4) % 2 ? PAL.cloth[1] : PAL.red[1]);
  // sign
  p.R(13, 0, 8, 5, wd[2]).R(14, 1, 6, 3, wd[1]).R(16, 2, 2, 1, PAL.gold[1]);
  // crates at the side
  p.R(26, 30, 8, 6, wd[2]).R(26, 30, 8, 1, wd[0]).R(29, 30, 1, 6, wd[3]);
  if (season === 'winter') p.T(2, 4, 6, 27, 3, 30, PAL.snow[0]);
  return p.outline().done();
}

export function paintBarracks(season: Season): Spr {
  const p = new Paint(50, 44);
  const st = PAL.stone, sl = PAL.slate, wd = PAL.wood;
  stoneBlocks(p, 2, 22, 46, 19, st[1], st[2], st[0], 6, 4);
  p.R(38, 22, 10, 19, st[2]);
  p.R(2, 39, 46, 2, st[3]);
  // door and windows
  p.R(21, 30, 8, 11, wd[4]); planks(p, 22, 31, 6, 10, [wd[1], wd[2], wd[3]], 2);
  for (const wx of [7, 13, 34, 40]) windowPane(p, wx, 26.5, 3.5, 5, PAL.wood[3]);
  // crossed swords sign over the door
  p.R(20, 23, 10, 6, wd[1]);
  for (let i = 0; i < 6; i++) { p.P(21 + i, 23 + i * 0.9, '#cfd4da'); p.P(28 - i, 23 + i * 0.9, '#cfd4da'); }
  // slate roof, long
  p.T(4, 21, 8, 41, 0, 49, shingles([sl[0], sl[1], sl[2], sl[3]], 40, 4, 5));
  p.R(8, 4, 34, 1, sl[3]);
  p.R(0, 21, 50, 1, sl[3]);
  // weapon rack
  p.R(44, 33, 6, 8, wd[2]).R(45, 30, 1, 4, '#cfd4da').R(47, 29, 1, 5, '#cfd4da');
  if (season === 'winter') p.T(4, 8, 8, 41, 5, 44, PAL.snow[0]);
  return p.outline().done();
}

export function paintHealer(season: Season): Spr {
  const p = new Paint(34, 42);
  const pl = PAL.plaster, wd = PAL.wood;
  p.R(3, 22, 28, 17, pl[0]).R(23, 22, 8, 17, pl[1]);
  p.R(3, 22, 2, 17, wd[3]).R(29, 22, 2, 17, wd[3]).R(3, 37, 28, 2, wd[3]);
  p.R(13, 29, 8, 10, wd[4]).R(14, 30, 6, 9, '#6a8a5a').P(19, 34, PAL.gold[1]);
  windowPane(p, 6, 24.5, 5, 4.5, wd[4]);
  // herb bundles hanging by the door
  p.R(23, 25, 1, 5, '#6aa040').R(25, 25, 1, 4, '#8ac050').R(27, 25, 1, 5, '#b89ae0');
  // mossy green roof
  const mg = ['#8cc070', '#6aa456', '#4f8442', '#3a6634'];
  p.T(3, 22, 10, 23, 0, 33, shingles([mg[0], mg[1], mg[2], mg[3]], 23, 4, 4));
  p.R(0, 21, 34, 2, mg[3]);
  // leaf emblem
  p.E(17, 12, 3, 2, '#f2efe6').R(17, 11, 1, 3, mg[2]);
  if (season === 'winter') p.T(3, 8, 10, 23, 6, 27, PAL.snow[0]);
  return p.outline().done();
}

export function paintBallista(): Spr {
  const p = new Paint(24, 22);
  const wd = PAL.wood;
  // wheeled carriage
  p.R(5, 12, 14, 5, wd[2]).R(5, 12, 14, 1, wd[1]).R(5, 16, 14, 1, wd[3]);
  p.E(5, 17, 3, 3, wd[4]).E(5, 17, 1, 1, wd[2]);
  p.E(18, 17, 3, 3, wd[4]).E(18, 17, 1, 1, wd[2]);
  // stock pointing forward (up the screen)
  p.R(11, 2, 3, 12, wd[1]).R(13, 2, 1, 12, wd[3]);
  // curved bow arms with iron tips
  p.T(6, 7, 3, 21, 1, 23, wd[3]);
  p.R(2, 5, 4, 1, wd[2]).R(18, 5, 4, 1, wd[2]).R(1, 4, 2, 1, wd[2]).R(21, 4, 2, 1, wd[2]);
  p.R(0, 3, 1, 2, '#cfd4da').R(23, 3, 1, 2, '#cfd4da');
  // string and loaded bolt
  p.R(2, 8, 20, 1, '#f2e6c8');
  p.R(12, 0, 1, 9, '#e8dcc0').R(11, 0, 3, 1, '#cfd4da');
  // winch
  p.R(10, 13, 5, 2, '#8a9096');
  return p.outline().done();
}

export function paintBrazier(lit: boolean, frame: number): Spr {
  const p = new Paint(14, 20);
  const st = PAL.stone;
  p.R(4, 12, 6, 7, st[2]).R(4, 12, 2, 7, st[1]).R(3, 18, 8, 2, st[3]);
  p.E(7, 10, 6, 2, st[1]);
  p.R(2, 9, 10, 2, st[3]);
  if (lit) {
    const f = frame % 2;
    p.T(1, 8, 7, 7, 3, 10, (_, x) => (Math.abs(x - 7) < 2 ? '#ffe066' : '#ff8a2a'));
    p.P(5 + f, 2, '#ff8a2a').P(9 - f, 3, '#ffb84a').P(7, 0 + f, '#ffe066');
  } else p.R(4, 8, 6, 1, '#3a3030');
  return p.outline().done();
}

export function paintFlag(): Spr {
  return grid([
    'kcccccc.',
    'kcCCccc.',
    'kcCCcccc',
    'kccccc..',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
    'oo......',
  ], { k: '#6a4426', c: '#3f63a8', C: PAL.gold[1], o: '#8a8a80' });
}

export function paintStake(): Spr {
  const p = new Paint(3, 10);
  const wd = PAL.wood;
  p.R(0, 1.5, 3, 8.5, wd[2]).R(0, 1.5, 1, 8.5, wd[1]).R(2.5, 1.5, 0.5, 8.5, wd[3]);
  p.T(0, 1, 1.5, 1.5, 0, 3, (_r, _x, hx) => (hx < 3 ? wd[0] : wd[2]));
  p.hp(2, 8, wd[4]).hp(3, 12, wd[4]).hp(2, 15, wd[4]);
  p.R(0, 6, 3, 0.5, '#7a6a52');
  p.R(0, 9, 3, 1, wd[3]);
  return p.outline(OUTLINE, false).done();
}

const swCache = new Map<string, Spr>();
/**
 * One tile of stone curtain wall, joined to its neighbours (n, s, w, e). Drawn 4 units above the tile so
 * merlons can poke up. A paved walkway on top, crenellated parapets on every open side, and a coursed
 * front face where the wall ends to the south.
 */
export function stoneWallTile(n: boolean, s: boolean, w: boolean, e: boolean, season: Season): Spr {
  const key = `${+n}${+s}${+w}${+e}${season}`;
  let c = swCache.get(key);
  if (c) return c;
  const st = PAL.stone, O = 4; // O: rows of headroom above the tile
  const p = new Paint(16, 16 + O);
  const x0 = w ? 0 : 1, x1 = e ? 16 : 15;
  const yTop = O + (n ? 0 : 2), yEnd = O + (s ? 16 : 9);
  const snow = season === 'winter';
  // walkway paving
  stoneBlocks(p, x0, yTop, x1 - x0, yEnd - yTop, snow ? '#e8eef2' : '#c9c1b2', snow ? '#c8d2da' : '#a49c8e', snow ? '#ffffff' : '#ddd6c8', 4, 3);
  // parapets: a raised lip with merlons along every open edge
  const merlons = (x: number, y: number, len: number, vertical: boolean) => {
    for (let i = 0; i < len; i += 4) {
      const mx = vertical ? x : x + i, my = vertical ? y + i : y;
      p.R(mx, my - 2, vertical ? 2 : 2.5, vertical ? 2.5 : 2, st[0]);
      p.R(mx, my, vertical ? 2 : 2.5, vertical ? 2.5 : 1, st[1]);
    }
  };
  if (!w) { p.R(x0, yTop, 2, yEnd - yTop, st[1]); p.R(x0, yTop, 0.5, yEnd - yTop, st[0]); merlons(x0, yTop + 1, yEnd - yTop - 1, true); }
  if (!e) { p.R(x1 - 2, yTop, 2, yEnd - yTop, st[2]); p.R(x1 - 0.5, yTop, 0.5, yEnd - yTop, st[3]); merlons(x1 - 2, yTop + 1, yEnd - yTop - 1, true); }
  if (!n) { p.R(x0, yTop, x1 - x0, 1.5, st[1]); merlons(x0 + (w ? 0.5 : 2.5), yTop, x1 - x0 - (w ? 1 : 4), false); }
  if (!s) {
    // front face with stone courses, darker at the foot
    stoneBlocks(p, x0, yEnd, x1 - x0, 7, st[1], st[3], st[0], 5, 3.5);
    p.R(x0, yEnd, x1 - x0, 1, st[0]);
    merlons(x0 + (w ? 0.5 : 2.5), yEnd, x1 - x0 - (w ? 1 : 4), false);
    p.R(x0, yEnd + 6, x1 - x0, 1, st[3]);
    if (!snow) for (let i = 0; i < 4; i++) { const mx = x0 + Math.floor(hash(i, x0 + yEnd, 9) * (x1 - x0 - 1)); p.hR(mx * ART, (yEnd + 6) * ART - 1, 3, 1, '#6a8a4a'); }
  }
  if (snow) { if (!n) p.R(x0, yTop - 2, x1 - x0, 0.5, PAL.snow[0]); }
  c = p.outline(OUTLINE, true).done();
  swCache.set(key, c);
  return c;
}

export function paintStoneWall(season: Season): Spr {
  const p = new Paint(18, 22);
  const st = PAL.stone;
  p.R(1, 3, 16, 5, st[0]);
  stoneBlocks(p, 1, 8, 16, 12, st[1], st[2], st[0], 5, 4);
  p.R(1, 18, 16, 2, st[3]);
  for (let x = 1; x < 17; x += 5) p.R(x, 1, 3, 3, st[0]);
  if (season === 'winter') p.R(1, 3, 16, 2, PAL.snow[0]);
  return p.outline().done();
}

export function paintGarden(season: Season): Spr {
  const p = new Paint(16, 16);
  const winter = season === 'winter';
  // stone-edged bed
  p.E(8, 9, 7, 5, PAL.stone[2]);
  p.E(8, 9, 6, 4, winter ? PAL.snow[1] : '#5e8a3a');
  const flowers = winter ? [] : season === 'autumn' ? ['#f0a040', '#d86a3a', '#f4d060'] : ['#f0a0c8', '#f4e070', '#ffffff', '#a0c8f0', '#e05a7a'];
  const spots = [[4, 8], [6, 6], [9, 7], [11, 9], [7, 10], [10, 11], [5, 11], [12, 7]];
  spots.forEach(([x, y], i) => { if (!flowers.length) return; p.P(x, y, flowers[i % flowers.length]); p.P(x, y + 1, '#3f7a2a'); });
  if (winter) { p.P(5, 8, '#8a9a7a').P(9, 9, '#8a9a7a').P(11, 10, '#8a9a7a'); }
  // little bench
  p.R(4, 1, 8, 2, PAL.wood[1]).R(4, 3, 1, 2, PAL.wood[3]).R(11, 3, 1, 2, PAL.wood[3]);
  return p.outline().done();
}

export function paintTrap(sprung = false): Spr {
  const p = new Paint(16, 16);
  p.E(8, 8, 6, 5, sprung ? '#5a4632' : '#3a2a1e');
  p.E(8, 8, 5, 4, sprung ? '#1a120c' : '#2a1e16');
  if (sprung) { p.R(4, 6, 8, 1, PAL.wood[3]).R(5, 10, 6, 1, PAL.wood[3]); return p.done(); }
  for (const [x, y] of [[5, 7], [8, 6], [11, 8], [7, 10], [10, 10]]) { p.P(x, y, '#cfd4da'); p.P(x, y + 1, '#8a9096'); }
  p.R(3, 3, 3, 1, PAL.wood[2]).R(11, 13, 3, 1, PAL.wood[2]).R(2, 11, 2, 1, PAL.leaf[2]).R(12, 4, 2, 1, PAL.leaf[2]);
  return p.done();
}

export function paintEntryBanner(): Spr {
  return grid([
    '.k........',
    'kkRRRRRR..',
    '.kRgggggR.',
    '.kRgYgYgR.',
    '.kRgggggR.',
    '.kRggKggR.',
    '.kRRRRRRR.',
    '.k.R..R...',
    '.k........',
    '.k........',
    'kkk.......',
  ], { k: '#4a3020', R: '#7a2a20', g: '#7cb043', Y: '#ffe14a', K: '#2a1e18' });
}

// ---------- ground ----------
/** Paints the whole map's ground per pixel at ART detail: soft grass patches with blades, pebbly paths, rippled water. */
export function paintGround(W: number, H: number, terrainAt: (x: number, y: number) => number, season: Season): Spr {
  const G = 16 * ART; // real pixels per tile
  const [c, x] = canvas(W * G, H * G);
  const img = x.createImageData(W * G, H * G);
  const px = (i: number, col: string) => {
    const [r, g, b] = rgb(col);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  };
  const winter = season === 'winter';
  const grass = winter ? PAL.snow : season === 'autumn' ? ['#b8b45a', '#a6a650', '#969a48', '#868c3e'] : season === 'summer' ? ['#8cbc52', '#7cae48', '#6ea040', '#5e9036'] : ['#84b85a', '#76aa4e', '#699c45', '#5a8c3c'];
  const dirt = winter ? ['#dcd8d0', '#c8c1b4', '#b2a898', '#9a8e7c'] : ['#d4b380', '#c19e68', '#a98756', '#8a6c44'];
  const terr = new Uint8Array(W * H);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) terr[ty * W + tx] = terrainAt(tx, ty);
  const T = (a: number, b: number) => terr[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
  // smooth per-tile masks sampled bilinearly give rounded shapes
  const mask = (t: number) => (qx: number, qy: number) => {
    const fx = qx / G - 0.5, fy = qy / G - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
    const sx = kx * kx * (3 - 2 * kx), sy = ky * ky * (3 - 2 * ky);
    const m = (a: number, b: number) => (T(a, b) === t ? 1 : 0);
    const top = m(x0, y0) * (1 - sx) + m(x0 + 1, y0) * sx, bot = m(x0, y0 + 1) * (1 - sx) + m(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  const dirtM = mask(5), waterM = mask(3);
  const big = (a: number, b: number, s: number, seed: number) => {
    const fx = a / s, fy = b / s, x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
    const sx = kx * kx * (3 - 2 * kx), sy = ky * ky * (3 - 2 * ky);
    const h = (i: number, j: number) => hash(i, j, seed);
    return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
  };
  const water = winter ? ['#e2eef6', '#cfe2ee', '#b8d4e8', '#a4c4dc'] : ['#a6d6ef', '#6eaedb', '#5592c8', '#4478b0', '#38649a'];
  for (let qy = 0; qy < H * G; qy++) for (let qx = 0; qx < W * G; qx++) {
    const i = qy * W * G + qx;
    const jitter = (big(qx, qy, 7, 9) - 0.5) * 0.22;
    const w = waterM(qx, qy) + jitter * 0.4;
    if (w > 0.5) {
      const depth = Math.min(1, (w - 0.5) * 2.6);
      let col = winter ? (depth > 0.6 ? water[2] : depth > 0.25 ? water[1] : water[0]) : depth > 0.85 ? water[4] : depth > 0.55 ? water[3] : depth > 0.22 ? water[2] : water[1];
      if (w < 0.54) col = winter ? '#f2f8fb' : '#d8f0fa'; // foam at the waterline
      // little ripple streaks
      if (!winter && depth > 0.2 && qy % 6 === 0 && hash(Math.floor(qx / 7), qy, 5) < 0.18) col = water[0];
      if (winter && hash(qx >> 1, qy >> 1, 6) < 0.02) col = '#ffffff';
      px(i, col);
      continue;
    }
    if (w > 0.36) { px(i, winter ? PAL.snow[2] : (hash(qx, qy, 4) < 0.08 ? '#c8ac72' : '#e2cc92')); continue; }
    const d = dirtM(qx, qy) + jitter;
    if (d > 0.5) {
      let col = d < 0.56 ? dirt[2] : dirt[1];
      const b2 = big(qx, qy, 20, 8);
      if (b2 > 0.65) col = d < 0.56 ? dirt[2] : dirt[0];
      // pebbles: a light pixel pair with a dark one below
      const cx = qx >> 2, cy = qy >> 2, ph = hash(cx, cy, 2);
      if (ph < 0.07) {
        const ox = Math.floor(hash(cx, cy, 3) * 3), oy = Math.floor(hash(cx, cy, 4) * 3);
        const lx = qx - (cx << 2) - ox, ly = qy - (cy << 2) - oy;
        if (ly === 0 && (lx === 0 || lx === 1)) col = dirt[0];
        else if (ly === 1 && (lx === 0 || lx === 1)) col = dirt[3];
      } else if (hash(qx, qy, 7) < 0.025) col = dirt[3];
      px(i, col);
      continue;
    }
    const b = big(qx, qy, 96, 3) * 0.7 + big(qx, qy, 28, 11) * 0.3;
    let col = b > 0.6 ? grass[0] : b < 0.38 ? grass[2] : grass[1];
    if (d > 0.4) col = grass[2];
    if (d > 0.46) col = grass[3];
    px(i, col);
  }
  x.putImageData(img, 0, 0);
  // grass blades, clover and flowers
  const R = (a: number, b: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const t = T(tx, ty);
    if (t !== 0 && t !== 1 && t !== 4 && t !== 6) continue;
    if (T(tx + 1, ty) === 5 || T(tx - 1, ty) === 5 || T(tx, ty + 1) === 5 || T(tx, ty - 1) === 5) { /* near paths: fewer */ }
    for (let k = 0; k < 9; k++) {
      const r = hash(tx, ty, 20 + k);
      if (r > 0.6) continue;
      const ox = tx * G + Math.floor(hash(tx, ty, 30 + k) * (G - 4)) + 2, oy = ty * G + Math.floor(hash(tx, ty, 40 + k) * (G - 6)) + 4;
      if (r < 0.035 && !winter) {
        // a little flower: four petals round a yellow eye
        const pc = season === 'autumn' ? ['#f0a040', '#d86a3a'][k % 2] : ['#f4e070', '#f0a0c8', '#ffffff', '#a0c8f0', '#e88aa0'][Math.floor(hash(tx, ty, 50 + k) * 5)];
        R(ox, oy - 1, 1, 1, pc); R(ox - 1, oy, 1, 1, pc); R(ox + 1, oy, 1, 1, pc); R(ox, oy + 1, 1, 1, pc); R(ox, oy, 1, 1, '#f8d040');
        R(ox, oy + 2, 1, 2, grass[3]);
        continue;
      }
      if (r < 0.08 && !winter) { R(ox, oy, 2, 2, grass[0]); R(ox + 2, oy + 1, 2, 2, grass[0]); R(ox + 1, oy + 2, 2, 1, grass[3]); continue; }
      // blade tuft: three strokes, dark at the base, light at the tip
      const dark = winter ? PAL.snow[2] : grass[3], lite = winter ? '#ffffff' : tint(grass[0], 0.15);
      R(ox, oy, 1, 3, dark); R(ox + 2, oy - 1, 1, 4, dark); R(ox + 4, oy + 1, 1, 2, dark);
      R(ox + 2, oy - 2, 1, 1, lite); R(ox, oy - 1, 1, 1, lite);
    }
  }
  return c;
}

// ---------- small icons ----------
export const ICON_PAL: Record<string, string> = {
  r: '#e05a48', R: '#a83a2e', y: '#ffd166', Y: '#c89a2a', w: '#c8884a', W: '#7a5228', g: '#6ab04a', G: '#3f7a2a', s: '#d0d4da', S: '#8a9096',
  b: '#4a8ad0', B: '#2a5a90', k: '#2a1e1a', f: '#ff9a3a', o: '#e8e0c8', p: '#a87ad0', t: '#b0a8a0', T: '#7a726a', h: '#e8b090', l: '#f2e6c8',
};
export const ICONS: Record<string, string[]> = {
  food: ['...gg...', '..gG....', '.rrrrr..', 'rrrrrrr.', 'rRrrrrr.', 'rrrrrRr.', '.rrRrr..', '..rrr...'],
  wood: ['........', '.wwwwww.', 'wWwwwwWw', '.wwwwww.', 'wWwwwwWw', '.wwwwww.', 'wWwwwwWw', '........'],
  stone: ['........', '..ttt...', '.tttTt..', 'ttTtTTt.', 'tTTTtTTt', '.TTTTTT.', '........', '........'],
  gold: ['..yyyy..', '.yYYYYy.', 'yYyyyyYy', 'yYyYYyYy', 'yYyYYyYy', 'yYyyyyYy', '.yYYYYy.', '..yyyy..'],
  hammer: ['.SSSS...', '.SsssS..', '.SSSS...', '...W....', '...W....', '...W....', '...W....', '...W....'],
  scroll: ['.llllll.', 'lWlllllW', '.lkkkkl.', '.llllll.', '.lkkkl..', '.llllll.', 'lWlllllW', '.llllll.'],
  horseshoe: ['.SS..SS.', 'SS....SS', 'Ss....sS', 'Ss....sS', 'Ss....sS', '.Ss..sS.', '..SSSS..', '........'],
  horn: ['......oo', '.....oWo', '....oWo.', '..ooWo..', '.oWWo...', 'oWWo....', 'ooo.....', '........'],
  hearth: ['..f..f..', '.fyf.yf.', '.fyyyyf.', '..fyyf..', 'tttttttt', 'tTTTTTTt', 'tTtttttT', '........'],
  seeds: ['...g....', '..gGg...', '...g....', '.wwwww..', 'wWwwwWw.', 'wwyywww.', '.wwwww..', '........'],
  stakes: ['.w..w..w', 'wWwwWwwW', 'wWwwWwwW', 'wWwwWwwW', 'wWwwWwwW', 'WWWWWWWW', '........', '........'],
  satchel: ['..WWW...', '.W...W..', 'wwwwwww.', 'wgwwwgw.', 'wwgggww.', 'wwwgwww.', '.wwwww..', '........'],
  axe: ['.SSS....', 'SsssS...', 'SssSW...', '.SS.W...', '....W...', '....W...', '....W...', '........'],
  banner: ['k.......', 'krrrrrr.', 'kryyyrr.', 'krryrrr.', 'krrrrrr.', 'kr.r.r..', 'k.......', 'k.......'],
  spyglass: ['......yy', '.....yYy', '....yYy.', '...SSy..', '..SSS...', '.SSS....', 'SSS.....', '........'],
  ledger: ['.WWWWWW.', 'WllllllW', 'WlkkkklW', 'WllllllW', 'WlkkkllW', 'WllllllW', 'WllllllW', '.WWWWWW.'],
  boots: ['..WW....', '..WW....', '..WW....', '..WWW...', '..WWWWW.', '.wwwwww.', '........', '........'],
  idol: ['..gggg..', '.gGggGg.', '.gyggyg.', '.gggggg.', '..gKKg..', '.gggggg.', '..g..g..', '........'],
  sword: ['......ss', '.....sS.', '....sS..', '.k.sS...', '..kS....', '..Wk....', '.W..k...', 'W.......'],
  skull: ['.oooooo.', 'oooooooo', 'okkookko', 'okkookko', 'oooooooo', '.oookoo.', '..okoko.', '..oooo..'],
  people: ['.hh..hh.', 'hhhhhhhh', '.hh..hh.', 'bbbbbbbb', 'bBbbbbBb', 'bbbbbbbb', '.b.bb.b.', '........'],
};
ICON_PAL.K = '#1a1210';
ICON_PAL.h = '#e8b090';
export function icon(name: string): Spr { return grid(ICONS[name], ICON_PAL, OUTLINE, 1); }

export function toDataURL(s: Spr, scale: number): string {
  const [c, x] = canvas(s.width * scale, s.height * scale);
  x.imageSmoothingEnabled = false;
  x.drawImage(s, 0, 0, c.width, c.height);
  return c.toDataURL();
}

/** Fit a sprite into a square icon canvas. */
export function iconOf(s: Spr, size: number): string {
  const [c, x] = canvas(size, size);
  const f = Math.min(size / s.width, size / s.height);
  const k = f >= 1 ? Math.floor(f) : f;
  const w = Math.round(s.width * k), h = Math.round(s.height * k);
  x.imageSmoothingEnabled = k < 1;
  x.imageSmoothingQuality = 'high';
  x.drawImage(s, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  return c.toDataURL();
}

export { canvas, grid, hash };
