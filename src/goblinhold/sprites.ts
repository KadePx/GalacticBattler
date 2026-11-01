// Pixel art, drawn in code once at startup. One style everywhere: 3/4 top-down view, light from the
// top-left, a shared dark outline, and a small warm palette.
import { GobKind, Job, JOBS, Season } from './defs';

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

function canvas(w: number, h: number): [Spr, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

/** A tiny painting helper: rects, pixels, ellipses, then an automatic outline pass. */
class Paint {
  c: Spr;
  x: CanvasRenderingContext2D;
  constructor(public w: number, public h: number) { [this.c, this.x] = canvas(w, h); }
  R(x: number, y: number, w: number, h: number, col: string) { this.x.fillStyle = col; this.x.fillRect(x, y, w, h); return this; }
  P(x: number, y: number, col: string) { this.x.fillStyle = col; this.x.fillRect(x, y, 1, 1); return this; }
  E(cx: number, cy: number, rx: number, ry: number, col: string) {
    this.x.fillStyle = col;
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.6) + (y * y) / (ry * ry + 0.6) <= 1) this.x.fillRect(cx + x, cy + y, 1, 1);
    return this;
  }
  /** Rows of a trapezoid/triangle: from (x0..x1) at y0 to (x2..x3) at y1. */
  T(y0: number, y1: number, l0: number, r0: number, l1: number, r1: number, col: string | ((row: number, x: number) => string)) {
    for (let y = y0; y <= y1; y++) {
      const k = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      const l = Math.round(l0 + (l1 - l0) * k), r = Math.round(r0 + (r1 - r0) * k);
      for (let x = l; x <= r; x++) { this.x.fillStyle = typeof col === 'string' ? col : col(y - y0, x); this.x.fillRect(x, y, 1, 1); }
    }
    return this;
  }
  outline(col = OUTLINE) {
    const d = this.x.getImageData(0, 0, this.w, this.h);
    const a = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && d.data[(y * this.w + x) * 4 + 3] > 40;
    const out: number[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (a(x, y)) continue;
      if (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1)) out.push(x, y);
    }
    this.x.fillStyle = col;
    for (let i = 0; i < out.length; i += 2) this.x.fillRect(out[i], out[i + 1], 1, 1);
    return this;
  }
  done() { return this.c; }
}

/** Character grid -> canvas with outline. */
function grid(rows: string[], pal: Record<string, string>, outline = OUTLINE): Spr {
  const h = rows.length, w = rows[0].length;
  const p = new Paint(w + 2, h + 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch !== '.' && pal[ch]) p.P(x + 1, y + 1, pal[ch]);
  }
  if (outline) p.outline(outline);
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

// ---------- settlers ----------
const HAIR = ['#6b3e22', '#3a2a20', '#c8963a', '#a8482a', '#e0d0a0', '#5a4a3a', '#2a2420'];
const SKIN = ['#eab88c', '#d49a6c', '#a8704a', '#f2c8a0', '#8a5a3a'];

const BODY = [
  '..hhhh..',
  '.hhhhhh.',
  '.hsssshh',
  '.ssksks.',
  '.sssssS.',
  '..tttt..',
  '.tttttt.',
  'stTttTts',
  '.tttttt.',
  '.bb..bb.',
  '.BB..BB.',
];
const LEGS_B = ['..bbbb..', '.BB..BB.'];

function headRows(job: Job, rows: string[]): string[] {
  const r = rows.slice();
  switch (job) {
    case 'militia': r[0] = '..mmmm..'; r[1] = '.mmmmmm.'; r[2] = '.Mssssm.'; break;
    case 'shieldbearer': r[0] = '..mmmm..'; r[1] = '.mmMMmm.'; r[2] = '.mssssm.'; break;
    case 'archer': r[0] = '..TTTT..'; r[1] = '.TTTTTT.'; r[2] = '.Tssss..'; break;
    case 'farmer': r[0] = '..yyyy..'; r[1] = 'yyyyyyyy'; break;
    case 'builder': r[0] = '..oooo..'; r[1] = '.oooooo.'; break;
    case 'healer': r[0] = '..wwww..'; r[1] = '.wwwwww.'; r[2] = '.wssssw.'; break;
    case 'fisher': r[0] = '..ffff..'; r[1] = 'ffffffff'; break;
    case 'trader': r[0] = '..rrrr..'; r[1] = '.rrrrrr.'; break;
  }
  return r;
}

const settlerCache = new Map<string, Spr[]>();
/** [right A, right B, left A, left B] */
export function settlerSprites(job: Job, look: number): Spr[] {
  const key = job + ':' + look;
  let s = settlerCache.get(key);
  if (s) return s;
  const pal: Record<string, string> = {
    h: HAIR[look % HAIR.length], s: SKIN[(look >> 3) % SKIN.length], S: SKIN[(look >> 3) % SKIN.length], k: '#2a1e1a',
    t: JOBS[job].color, T: JOBS[job].shade, b: '#5a4636', B: '#2e2420', m: '#cfd4da', M: '#8a9096', y: PAL.thatch[0], o: '#d08a3a',
    w: '#f2efe6', f: '#e8d070', r: '#7a3a6a',
  };
  const a = headRows(job, BODY);
  const b = a.slice(0, 9).concat(LEGS_B);
  const ra = grid(a, pal), rb = grid(b, pal);
  s = [ra, rb, flip(ra), flip(rb)];
  settlerCache.set(key, s);
  return s;
}

// ---------- goblins ----------
const GOB: Record<GobKind, { rows: string[]; legs: string[]; pal: Record<string, string> }> = {
  scrapper: {
    rows: [
      'G.......G',
      'GgggggggG',
      '.ggggggg.',
      '.ggggeKe.',
      '.gggggggD',
      '..ggKKg..',
      '..xxxxx..',
      '.gxxXxxg.',
      '..xx.xx..',
      '..GG.GG..',
    ],
    legs: ['.xx...xx.', '.GG...GG.'],
    pal: { g: '#7cb043', G: '#4c7a2a', D: '#4c7a2a', e: '#ffe14a', K: '#1a1210', x: '#8a5a32', X: '#5e3a1e' },
  },
  slinger: {
    rows: [
      '...XXX...',
      '..XXXXXG.',
      '.GXgggggG',
      '..XggeKe.',
      '..Xggggg.',
      '...gKKg..',
      '..xxxxx..',
      '.gxxXxxg.',
      '..xx.xx..',
      '..GG.GG..',
    ],
    legs: ['.xx...xx.', '.GG...GG.'],
    pal: { g: '#8cbc54', G: '#557f31', e: '#ff7a4a', K: '#1a1210', x: '#6a4a7a', X: '#4a3058' },
  },
  wolfrider: {
    rows: [
      '....G...G....',
      '....GgggG....',
      '....gggeK....',
      '....ggggg....',
      '.....xxx.....',
      'WW..xxxxx..WW',
      '.WWWWWWWWWWWw',
      '.WwwwwwwwwWWK',
      '.WwwwwwwwwW..',
      '.WW.W..W.WW..',
      '.KK.K..K.KK..',
    ],
    legs: ['..WW.W.WW.W..', '..KK.K.KK.K..'],
    pal: { g: '#7cb043', G: '#4c7a2a', e: '#ffe14a', K: '#1a1210', x: '#8a5a32', W: '#6a6a72', w: '#9a9aa2' },
  },
  shieldgob: {
    rows: [
      'G.......G..',
      'GgggggggG..',
      '.ggggggg...',
      '.ggggeKe...',
      '.ggggggPPP.',
      '..ggKKPpppP',
      '..xxxxPpPpP',
      '.gxxXxPpppP',
      '..xx.xPpPpP',
      '..xx.xPpppP',
      '..GG.GGPPP.',
    ],
    legs: ['.xx..xPpppP', '.GG..GGPPP.'],
    pal: { g: '#6aa03c', G: '#44702a', e: '#ffe14a', K: '#1a1210', x: '#7a5a3a', X: '#5e3a1e', P: '#5a3a20', p: '#9a6a3a' },
  },
  brute: {
    rows: [
      '.G.........G.',
      '.GgggggggggG.',
      '..ggggggggg..',
      '..gggggeKeK..',
      '..ggggggggg..',
      '...gWKKKWg...',
      '.ggxxxxxxxgg.',
      'gggxXXxXXxggg',
      'gg.xxxxxxx.gg',
      '...xxxxxxx...',
      '...xx...xx...',
      '...GG...GG...',
    ],
    legs: ['..xx.....xx..', '..GG.....GG..'],
    pal: { g: '#5e9a3a', G: '#3c6624', e: '#ff5a3a', K: '#1a1210', W: '#f0ead8', x: '#7a4a2a', X: '#a8acb2' },
  },
  sapper: {
    rows: [
      'G...RRR.G',
      'Gg.RRRRgG',
      '.ggggggg.',
      '.ggggeKe.',
      '.ggggggg.',
      '..ggKKg..',
      'BBxxxxx..',
      'BBxxXxxg.',
      'B.xx.xx..',
      '..GG.GG..',
    ],
    legs: ['.xx...xx.', '.GG...GG.'],
    pal: { g: '#9ab84a', G: '#5f7a2a', e: '#ffe14a', K: '#1a1210', x: '#6a5a3a', X: '#3a2e20', R: '#b83a2a', B: '#3a3a42' },
  },
  shaman: {
    rows: [
      '..F.F.F..',
      '.WWWWWWW.',
      '.WKWWWKW.',
      '.WWWWWWW.',
      '..ggggg..',
      '..gKKKg..',
      '.ppppppp.',
      'gpppPpppg',
      '.ppppppp.',
      '.ppppppp.',
      '..GG.GG..',
    ],
    legs: ['.ppppppp.', '..G...G..'],
    pal: { g: '#7cb043', G: '#4c7a2a', K: '#1a1210', W: '#e8dcc0', F: '#e05a48', p: '#6a3a8a', P: '#b88ae0' },
  },
  warchief: {
    rows: [
      'H.............H',
      'HH...........HH',
      '.HmmmmmmmmmmmH.',
      '..mggggggggggm.',
      '..ggggggeKgeK..',
      '..ggggggggggg..',
      '...ggWKKKKWg...',
      '.gggxxxxxxxggg.',
      'ggggxRRxRRxgggg',
      'gg.xxxxxxxxx.gg',
      'gg.xxxxxxxxx.gg',
      '...xxxxxxxxx...',
      '...xxx...xxx...',
      '...GGG...GGG...',
    ],
    legs: ['..xxx.....xxx..', '..GGG.....GGG..'],
    pal: { g: '#4f8a2e', G: '#335a1e', e: '#ff3a2a', K: '#1a1210', W: '#f0ead8', x: '#5a3a28', R: '#b8402e', H: '#e8dcc0', m: '#8a8f9a' },
  },
};
const gobCache = new Map<string, Spr[]>();
export function goblinSprites(kind: GobKind): Spr[] {
  let s = gobCache.get(kind);
  if (s) return s;
  const d = GOB[kind];
  const n = d.rows.length;
  const b = d.rows.slice(0, n - 2).concat(d.legs);
  const ra = grid(d.rows, d.pal), rb = grid(b, d.pal);
  s = [ra, rb, flip(ra), flip(rb)];
  gobCache.set(kind, s);
  return s;
}

// ---------- terrain objects ----------
const treeCache = new Map<string, Spr>();
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
      p.T(y0, y1, 9, 9, 9 - half, 9 + half, (row, x) => (x < 9 - row * 0.15 ? pl[1] : x > 10 ? pl[2] : pl[1]));
      p.T(y1 - 1, y1, 9 - half + 1, 9 + half - 1, 9 - half, 9 + half, pl[3]);
    }
    p.P(8, 3, pl[0]).P(7, 9, pl[0]).P(6, 15, pl[0]).P(8, 14, pl[0]);
    if (season === 'winter') for (const [y0, , half] of tiers) p.T(y0, y0 + 2, 9, 9, 9 - half / 2, 9 + half / 2 - 1, PAL.snow[0]);
    c = p.outline().done();
  } else {
    const p = new Paint(20, 24);
    p.R(8, 15, 4, 8, PAL.wood[3]).R(8, 15, 2, 8, PAL.wood[2]).P(7, 22, PAL.wood[3]).P(12, 22, PAL.wood[3]);
    const lf = season === 'autumn' ? ['#f0b84a', '#d98a32', '#b8602a', '#8a4220'] : season === 'winter' ? ['#a89a8a', '#8a7a6a', '#6a5a4a', '#4a3e34'] : [PAL.leaf[0], PAL.leaf[1], PAL.leaf[2], PAL.leaf[3]];
    if (season === 'winter') {
      // bare crown: a soft grey-brown mass of twigs with snow on top
      p.E(10, 9, 8, 6, '#6e5a4c');
      p.E(9, 8, 7, 5, '#86705e');
      for (let i = 0; i < 18; i++) p.P(3 + ((i * 7 + v) % 15), 4 + ((i * 5) % 10), i % 3 ? '#5a4838' : '#9a8470');
      p.R(9, 9, 2, 7, PAL.wood[3]).R(6, 11, 4, 1, PAL.wood[3]).R(11, 10, 4, 1, PAL.wood[3]);
      p.E(9, 4, 6, 1, PAL.snow[0]).E(5, 6, 2, 1, PAL.snow[0]).E(14, 5, 2, 1, PAL.snow[0]);
    } else {
      p.E(10, 10, 8, 7, lf[2]);
      p.E(9, 9, 7, 6, lf[1]);
      p.E(7 + (v % 2), 7, 4, 3, lf[0]);
      p.E(13, 6, 2, 2, lf[0]);
      for (let i = 0; i < 7; i++) p.P(4 + ((i * 5 + v) % 12), 9 + ((i * 3) % 6), lf[2]);
      p.T(15, 16, 4, 16, 5, 15, lf[3]);
    }
    c = p.outline().done();
  }
  treeCache.set(key, c);
  return c;
}

export function saplingSprite(): Spr {
  return grid(['..l..', '.lLl.', 'lLlLl', '..n..', '..n..'], { l: PAL.leaf[0], L: PAL.leaf[2], n: PAL.wood[3] });
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
  p.E(cx, cy, r + 1, r - 1, st[3]);
  p.E(cx - 1, cy - 1, r, r - 2, st[2]);
  p.E(cx - 2, cy - 2, Math.max(1, r - 3), Math.max(1, r - 4), st[1]);
  p.P(cx - 3, cy - 3, st[0]).P(cx - 2, cy - 3, st[0]);
  if (v % 3 === 1 && size >= 1) { p.E(cx + 4, cy + 2, 2, 2, st[3]).P(cx + 3, cy + 1, st[1]); }
  p.R(cx - 1, cy + 1, 3, 1, st[3]);
  if (season === 'winter') p.E(cx - 1, cy - r + 2, Math.max(1, r - 2), 1, PAL.snow[0]);
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
  const lf = season === 'winter' ? ['#8a9a7a', '#6a7a5a', '#4a5a3a'] : season === 'autumn' ? ['#a8a848', '#86883a', '#5e622a'] : [PAL.leaf[1], PAL.leaf[2], PAL.leaf[3]];
  p.E(8, 7, 6, 4, lf[2]);
  p.E(7, 6, 5, 3, lf[1]);
  p.E(5, 5, 2, 1, lf[0]);
  const spots = [[4, 7], [9, 5], [11, 8], [6, 9], [8, 7], [12, 6]];
  for (let i = 0; i < b * 2 && i < spots.length; i++) { p.P(spots[i][0], spots[i][1], '#d8304a'); p.P(spots[i][0], spots[i][1] - 1, '#ff7a8a'); }
  if (season === 'winter') p.R(4, 3, 7, 1, PAL.snow[0]);
  c = p.outline().done();
  bushCache.set(key, c);
  return c;
}

// ---------- buildings ----------
function stoneBlocks(p: Paint, x0: number, y0: number, w: number, h: number, base: string, dark: string, light: string, bw = 6, bh = 4) {
  p.R(x0, y0, w, h, base);
  for (let y = y0; y < y0 + h; y += bh) {
    p.R(x0, y, w, 1, dark);
    const off = ((y - y0) / bh) % 2 ? bw / 2 : 0;
    for (let x = x0 + off; x < x0 + w; x += bw) { p.R(x, y, 1, bh, dark); p.R(x + 1, y + 1, Math.min(bw - 2, x0 + w - x - 1), 1, light); }
  }
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
  for (const sx of [19, 25, 31]) p.R(sx, 20, 1, 6, '#2b1d18');
  p.R(18, 29, 16, 2, PAL.wood[2]).R(18, 31, 16, 1, PAL.wood[3]);
  for (let x = 19; x < 34; x += 3) p.R(x, 27, 1, 2, PAL.wood[3]);
  p.T(0, 15, 26, 26, 14, 38, (row, x) => (x < 26 ? (row % 3 === 2 ? sl[1] : sl[0]) : row % 3 === 2 ? sl[3] : sl[2]));
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
    p.T(14, 30, tx + 6, tx + 6, tx - 1, tx + 13, (row, x) => (x < tx + 6 ? (row % 3 === 0 ? rf[1] : rf[0]) : row % 3 === 0 ? rf[3] : rf[2]));
    p.R(tx + 6, 12, 1, 3, '#2b1d18');
    p.R(tx + 7, 12, 3, 2, PAL.gold[1]);
  }
  // gatehouse: arched gate with wooden doors
  p.R(19, 44, 14, 14, st[3]);
  p.T(41, 44, 23, 28, 20, 31, st[3]);
  p.R(21, 46, 10, 12, PAL.wood[3]);
  p.T(43, 46, 24, 27, 21, 30, PAL.wood[3]);
  p.R(21, 46, 10, 1, PAL.wood[4]).R(21, 51, 10, 1, PAL.wood[4]).R(25, 44, 1, 14, PAL.wood[4]);
  p.P(24, 52, PAL.gold[1]).P(27, 52, PAL.gold[1]);
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
  p.R(3, 22, 2, 17, wd[3]).R(29, 22, 2, 17, wd[3]).R(16, 22, 2, 7, wd[3]).R(3, 29, 28, 2, wd[3]).R(3, 37, 28, 2, wd[3]);
  p.R(6, 31, 1, 6, wd[2]).R(10, 31, 1, 6, wd[2]);
  // door
  p.R(13, 30, 8, 9, wd[4]).R(14, 31, 6, 8, wd[2]).R(14, 31, 6, 1, wd[3]).R(17, 31, 1, 8, wd[3]).P(19, 35, PAL.gold[1]);
  // windows with shutters
  for (const wx of [6, 22]) { p.R(wx, 24, 6, 4, wd[4]).R(wx + 1, 25, 4, 2, '#3a3046').P(wx + 1, 25, '#5a5070'); }
  // thatched roof
  p.T(3, 22, 10, 23, 0, 33, (row, x) => {
    const shade = x > 22 ? 2 : x < 6 ? 0 : 1;
    const stripe = row % 3 === 2 ? 1 : 0;
    return th[Math.min(3, shade + stripe)];
  });
  p.R(0, 21, 34, 2, th[3]);
  p.R(9, 3, 16, 1, th[3]);
  for (let i = 0; i < 14; i++) p.P(3 + Math.floor(hash(i, 7) * 28), 6 + Math.floor(hash(i, 8) * 14), th[3]);
  // chimney
  p.R(22, 0, 5, 9, PAL.stone[2]).R(22, 0, 5, 1, PAL.stone[3]).R(22, 0, 2, 9, PAL.stone[1]);
  if (season === 'winter') { p.T(3, 8, 10, 23, 6, 27, PAL.snow[0]); p.T(9, 12, 6, 27, 4, 29, PAL.snow[1]); }
  return p.outline().done();
}

export function paintFarm(stage: number, season: Season): Spr {
  const [c, x] = canvas(48, 32);
  const R = (a: number, b: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
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
  return c;
}

export function paintTower(season: Season): Spr {
  const p = new Paint(20, 42);
  const wd = PAL.wood, rf = PAL.roof;
  // legs and braces
  p.R(3, 16, 3, 25, wd[2]).R(14, 16, 3, 25, wd[3]).R(3, 16, 1, 25, wd[1]);
  for (let i = 0; i < 9; i++) { p.P(6 + i, 21 + i, wd[3]); p.P(13 - i, 21 + i, wd[3]); p.P(6 + i, 31 + i * 0.9, wd[3]); p.P(13 - i, 31 + i * 0.9, wd[3]); }
  // platform
  p.R(1, 14, 18, 6, wd[1]).R(1, 18, 18, 2, wd[3]).R(1, 14, 18, 1, wd[0]);
  for (let i = 0; i < 5; i++) p.R(2 + i * 4, 14, 1, 5, wd[2]);
  // roof
  p.T(0, 9, 10, 10, 0, 19, (row, x) => (x < 10 ? (row % 3 === 2 ? rf[1] : rf[0]) : row % 3 === 2 ? rf[3] : rf[2]));
  p.R(2, 10, 1, 4, wd[3]).R(17, 10, 1, 4, wd[3]);
  if (season === 'winter') p.T(0, 3, 10, 10, 6, 14, PAL.snow[0]);
  return p.outline().done();
}

export function paintMarket(season: Season): Spr {
  const p = new Paint(34, 38);
  const wd = PAL.wood;
  // counter
  p.R(2, 24, 30, 11, wd[1]).R(2, 24, 30, 2, wd[0]).R(2, 33, 30, 2, wd[3]);
  for (let x = 4; x < 32; x += 6) p.R(x, 26, 1, 7, wd[2]);
  // goods on the counter
  p.R(5, 21, 6, 3, '#e05a48').R(6, 20, 4, 1, '#ff8a6a');
  p.R(13, 20, 7, 4, PAL.thatch[1]).R(14, 19, 5, 1, PAL.thatch[0]);
  p.R(22, 21, 7, 3, PAL.stone[1]).R(23, 20, 5, 1, PAL.stone[0]);
  // posts
  p.R(2, 8, 2, 16, wd[3]).R(30, 8, 2, 16, wd[3]);
  // striped awning
  p.T(2, 12, 6, 27, 0, 33, (row, x) => (Math.floor(x / 4) % 2 ? PAL.cloth[0] : (row > 8 ? PAL.red[1] : PAL.red[0])));
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
  p.R(21, 30, 8, 11, wd[4]).R(22, 31, 6, 10, wd[2]).R(24, 31, 1, 10, wd[3]);
  for (const wx of [7, 13, 34, 40]) p.R(wx, 27, 3, 5, '#2b1d18');
  // crossed swords sign over the door
  p.R(20, 23, 10, 6, wd[1]);
  for (let i = 0; i < 6; i++) { p.P(21 + i, 23 + i * 0.9, '#cfd4da'); p.P(28 - i, 23 + i * 0.9, '#cfd4da'); }
  // slate roof, long
  p.T(4, 21, 8, 41, 0, 49, (row, x) => (x < 40 ? (row % 3 === 2 ? sl[1] : sl[0]) : row % 3 === 2 ? sl[3] : sl[2]));
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
  p.R(6, 25, 5, 4, wd[4]).R(7, 26, 3, 2, '#3a3046');
  // herb bundles hanging by the door
  p.R(23, 25, 1, 5, '#6aa040').R(25, 25, 1, 4, '#8ac050').R(27, 25, 1, 5, '#b89ae0');
  // mossy green roof
  const mg = ['#8cc070', '#6aa456', '#4f8442', '#3a6634'];
  p.T(3, 22, 10, 23, 0, 33, (row, x) => mg[Math.min(3, (x > 22 ? 2 : x < 6 ? 0 : 1) + (row % 3 === 2 ? 1 : 0))]);
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
  return grid([
    '.w.',
    'wWw',
    'wWw',
    'wWw',
    'wWw',
    'wWw',
    'wWw',
    'wWw',
    'wWw',
    'nnn',
  ], { w: PAL.wood[2], W: PAL.wood[1], n: PAL.wood[3] });
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
/** Paints the whole map's ground per pixel: soft grass patches, organic dirt paths, rounded water. */
export function paintGround(W: number, H: number, terrainAt: (x: number, y: number) => number, season: Season): Spr {
  const [c, x] = canvas(W * 16, H * 16);
  const img = x.createImageData(W * 16, H * 16);
  const px = (i: number, col: string) => {
    img.data[i * 4] = parseInt(col.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(col.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(col.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  };
  const winter = season === 'winter';
  const grass = winter ? PAL.snow : season === 'autumn' ? ['#b4b458', '#a2a64e', '#949a46', '#868c3e'] : season === 'summer' ? ['#86b84e', '#78ab46', '#6b9e3e', '#5e9036'] : PAL.grass;
  const dirt = winter ? ['#d8d4cc', '#c4bdb0', '#aea494', '#968a78'] : PAL.dirt;
  // smooth per-tile masks sampled bilinearly give rounded shapes
  const mask = (t: number) => (tx: number, ty: number) => {
    const fx = tx / 16 - 0.5, fy = ty / 16 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
    const m = (a: number, b: number) => (terrainAt(Math.min(W - 1, Math.max(0, a)), Math.min(H - 1, Math.max(0, b))) === t ? 1 : 0);
    const top = m(x0, y0) * (1 - kx) + m(x0 + 1, y0) * kx, bot = m(x0, y0 + 1) * (1 - kx) + m(x0 + 1, y0 + 1) * kx;
    return top * (1 - ky) + bot * ky;
  };
  const dirtM = mask(5), waterM = mask(3);
  const big = (a: number, b: number) => {
    // cheap value noise at 3 tile scale for soft colour patches
    const s = 48, fx = a / s, fy = b / s, x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
    const sx = kx * kx * (3 - 2 * kx), sy = ky * ky * (3 - 2 * ky);
    const h = (i: number, j: number) => hash(i, j, 3);
    return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let py = 0; py < H * 16; py++) for (let qx = 0; qx < W * 16; qx++) {
    const i = py * W * 16 + qx;
    const jitter = (hash(qx >> 1, py >> 1, 9) - 0.5) * 0.18;
    const w = waterM(qx, py) + jitter * 0.5;
    if (w > 0.5) {
      const depth = Math.min(1, (w - 0.5) * 3);
      let col = winter ? (depth > 0.5 ? '#b8d4e8' : '#d0e4f0') : depth > 0.7 ? PAL.water[3] : depth > 0.35 ? PAL.water[2] : PAL.water[1];
      if (!winter && hash(qx >> 2, py, 5) < 0.012) col = PAL.water[0];
      px(i, col);
      continue;
    }
    if (w > 0.4) { px(i, winter ? PAL.snow[2] : PAL.sand); continue; }
    const d = dirtM(qx, py) + jitter;
    if (d > 0.5) {
      const n = hash(qx, py, 2);
      px(i, n < 0.03 ? dirt[3] : n < 0.1 ? dirt[2] : n > 0.97 ? dirt[0] : dirt[1]);
      continue;
    }
    const b = big(qx, py);
    let col = b > 0.62 ? grass[0] : b < 0.32 ? grass[2] : grass[1];
    if (d > 0.4) col = grass[2];
    px(i, col);
  }
  x.putImageData(img, 0, 0);
  // tufts and flowers, sparse
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const t = terrainAt(tx, ty);
    if (t !== 0 && t !== 1 && t !== 4 && t !== 6) continue;
    for (let k = 0; k < 3; k++) {
      const r = hash(tx, ty, 20 + k);
      if (r > 0.55) continue;
      const ox = tx * 16 + Math.floor(hash(tx, ty, 30 + k) * 13) + 1, oy = ty * 16 + Math.floor(hash(tx, ty, 40 + k) * 13) + 2;
      if (r < 0.04 && !winter) {
        x.fillStyle = ['#f4e070', '#f0a0c8', '#ffffff', '#a0c8f0'][Math.floor(hash(tx, ty, 50 + k) * 4)];
        x.fillRect(ox, oy, 1, 1);
        continue;
      }
      x.fillStyle = winter ? PAL.snow[2] : grass[3];
      x.fillRect(ox, oy, 1, 2); x.fillRect(ox + 2, oy - 1, 1, 3); x.fillRect(ox + 1, oy + 1, 1, 1);
      x.fillStyle = winter ? PAL.snow[0] : grass[0];
      x.fillRect(ox + 2, oy - 1, 1, 1);
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
export function icon(name: string): Spr { return grid(ICONS[name], ICON_PAL); }

export function toDataURL(s: Spr, scale: number): string {
  const [c, x] = canvas(s.width * scale, s.height * scale);
  x.imageSmoothingEnabled = false;
  x.drawImage(s, 0, 0, c.width, c.height);
  return c.toDataURL();
}

/** Fit a sprite into a square icon canvas. */
export function iconOf(s: Spr, size: number): string {
  const [c, x] = canvas(size, size);
  const k = Math.max(1, Math.floor(Math.min(size / s.width, size / s.height)));
  const w = s.width * k, h = s.height * k;
  x.imageSmoothingEnabled = false;
  x.drawImage(s, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  return c.toDataURL();
}

export { canvas, hash };
