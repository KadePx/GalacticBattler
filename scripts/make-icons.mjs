// Draws the pixel-art site and game icons and writes them into public/.
// Each icon is a 32x32 pixel grid. Outputs per icon: favicon.svg (crisp, rounded tile),
// favicon-32.png and apple-touch-icon.png (180px, full-bleed). The home icon also gets /favicon.ico.
// Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const N = 32;

const grid = () => Array.from({ length: N }, () => Array(N).fill(null));
// paint a small hand-drawn map scaled up by k, centred, using a palette
function stamp(g, rows, pal, k, ox = 0, oy = 0) {
  const w = rows[0].length * k, h = rows.length * k;
  const x0 = Math.floor((N - w) / 2) + ox, y0 = Math.floor((N - h) / 2) + oy;
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (!pal[c]) return;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) g[y0 + y * k + dy][x0 + x * k + dx] = pal[c];
  }));
}
function stars(g, pts, col = '#ffffff') { for (const [x, y] of pts) if (!g[y][x]) g[y][x] = col; }

const icons = {
  // itskade.space: a ringed planet over a starfield
  home: {
    bg: '#12152a',
    draw() {
      const g = grid();
      stars(g, [[4, 5], [26, 4], [6, 25], [27, 22], [22, 28], [3, 15]], '#c9d3ff');
      const cx = 15.5, cy = 15.5, a = -0.42, ca = Math.cos(a), sa = Math.sin(a);
      const ring = (x, y) => { const u = (x - cx) * ca + (y - cy) * sa, v = -(x - cx) * sa + (y - cy) * ca; return (u / 13.5) ** 2 + (v / 4.2) ** 2; };
      const front = (x, y) => -(x - cx) * sa + (y - cy) * ca > 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = x + 0.5, py = y + 0.5, d = Math.hypot(px - cx, py - cy);
        const r = ring(px, py), onRing = r > 0.62 && r < 1;
        if (onRing && !(d < 8.6 && !front(px, py))) { g[y][x] = r < 0.8 ? '#ffd166' : '#e0a93a'; continue; }
        if (d < 8.6) {
          const lit = (px - cx) * -0.6 + (py - cy) * -0.8;
          g[y][x] = lit > 3.5 ? '#c9d3ff' : lit > -2.5 ? '#8fa4ff' : '#5c6fd6';
          if (Math.abs((py - cy) - (px - cx) * 0.25 - 2) < 1 && d < 8) g[y][x] = lit > -2.5 ? '#7a8ff0' : '#4e60c4';
        }
      }
      return g;
    },
  },
  // Galactic Battler: a gold fighter climbing through space
  'galactic-battler': {
    bg: '#0d0f24',
    draw() {
      const g = grid();
      stars(g, [[3, 4], [27, 6], [5, 27], [28, 26], [24, 2], [2, 18], [29, 15]], '#9fb4ff');
      stamp(g, [
        '.......XX.......',
        '......XxXX......',
        '......XCcX......',
        '......XCcX......',
        '.....XxXXXD.....',
        '.....XxXXXD.....',
        '..X..XxXXXD..D..',
        '..X.XXxXXXXD.D..',
        '..XXXXxXXXXXDD..',
        '.XXXXXXXXXXXXDD.',
        '.XXRXXDXXDXXRXX.',
        '.XX..XXXXXX..XX.',
        '.X...XX..XX...X.',
        '......FF.FF.....',
        '......fF.Ff.....',
        '.......f..f.....',
      ], { X: '#ffcf4a', x: '#fff1a8', D: '#c98a1e', C: '#5ad1ff', c: '#2a8fc4', R: '#ff5d5d', F: '#ff8a3c', f: '#ffd166' }, 2);
      return g;
    },
  },
  // Rotwave: a rotting zombie head
  rotwave: {
    bg: '#1d2116',
    draw() {
      const g = grid();
      stamp(g, [
        '....hhhhhhhh....',
        '...hGGGGGGGGh...',
        '..hGGGGGGGGGgh..',
        '..GGGGGGGGGGgg..',
        '..GGgGGGGGGGgg..',
        '..GEEEGGGEEEgg..',
        '..GERkGGGERkgg..',
        '..GEEEGGGEEEgg..',
        '..GGGGGgGGGGgg..',
        '..gGGGGgGGGGgg..',
        '..gGKKKKKKKGgg..',
        '..ggKTKTKTKggg..',
        '...gGKKKKKGgg...',
        '....ggGGGggg....',
        '.....gggggg.....',
        '......b..b......',
      ], { h: '#3b4a2a', G: '#8fb86a', g: '#5f8a45', E: '#20261a', R: '#ff3b3b', k: '#7a1414', K: '#2a1a14', T: '#e8dfc4', b: '#8a1f1f' }, 2);
      return g;
    },
  },
  // Mob Surge: a red crowd pouring forward past a blue one
  'mob-surge': {
    bg: '#d9e1f2',
    draw() {
      const g = grid();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (y % 8 === 7 || (x + (Math.floor(y / 8) % 2) * 4) % 8 === 7) g[y][x] = '#c5cfe4';
      const pawn = (cx, cy, c, d) => stamp(g, ['.HH.', 'HHHH', '.HH.', 'BBBB', 'BBBB', 'BBBB'], { H: c, B: c }, 1, cx - 14, cy - 13) || shade(cx, cy, d);
      const shade = (cx, cy, d) => { const x0 = cx - 14 + 14, y0 = cy - 13 + 13; for (let i = 0; i < 4; i++) g[y0 + 5][x0 + i] = d; g[y0 + 1][x0 + 3] = d; };
      for (const [x, y] of [[3, 20], [8, 22], [4, 26]]) pawn(x, y, '#4a7cf0', '#2f56b8');
      for (const [x, y] of [[20, 2], [14, 7], [21, 8], [26, 6], [12, 13], [18, 14], [24, 13], [15, 19], [21, 20], [26, 18], [19, 25], [25, 24]]) pawn(x, y, '#f0524a', '#b8322c');
      return g;
    },
  },
  // Moto Maze: maze walls with a rider racing through
  'moto-maze': {
    bg: '#2c2836',
    draw() {
      const g = grid();
      stamp(g, [
        'TTTTTTTT',
        'T..O...T',
        'T.OO.O.T',
        'T....O.T',
        'TT.OOO.T',
        'T..O.Y.T',
        'T.OO...T',
        'TTTT.TTT',
      ], { T: '#2f9a92', O: '#e07a5a' }, 4);
      // wall tops for depth
      const o = g.map((r) => [...r]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (o[y][x] && (y === 0 || o[y - 1][x] !== o[y][x])) g[y][x] = o[y][x] === '#2f9a92' ? '#5cc7bd' : '#f4a585';
      // rider: helmet + bike
      stamp(g, ['.YY.', 'YYYY', 'RRRR', 'K..K'], { Y: '#ffd23f', R: '#ff5a3c', K: '#14121a' }, 1, 6, 6);
      return g;
    },
  },
};

// ---------- writers ----------
function svg(g, bg) {
  let rects = '';
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const c = g[y][x];
      if (!c) { x++; continue; }
      let e = x + 1;
      while (e < N && g[y][e] === c) e++;
      rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${c}"/>`;
      x = e;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges"><rect width="${N}" height="${N}" rx="6" fill="${bg}"/>${rects}</svg>\n`;
}

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
}
function png(size, px) { // px(x, y) -> [r,g,b,a]
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(px(x, y), y * (size * 4 + 1) + 1 + x * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const inRound = (x, y, s, r) => { const cx = Math.min(Math.max(x + 0.5, r), s - r), cy = Math.min(Math.max(y + 0.5, r), s - r); return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r; };

function ico(pngBuf) {
  const h = Buffer.alloc(22);
  h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4); h[6] = 32; h[7] = 32; h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12);
  h.writeUInt32LE(pngBuf.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, pngBuf]);
}

for (const [name, ic] of Object.entries(icons)) {
  const g = ic.draw();
  const dir = name === 'home' ? ROOT : join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'favicon.svg'), svg(g, ic.bg));
  const f32 = png(32, (x, y) => g[y][x] ? rgb(g[y][x]) : inRound(x, y, 32, 6) ? rgb(ic.bg) : [0, 0, 0, 0]);
  writeFileSync(join(dir, 'favicon-32.png'), f32);
  // home-screen icon: full-bleed (iOS rounds it), art scaled 5x with a small margin
  writeFileSync(join(dir, 'apple-touch-icon.png'), png(180, (x, y) => { const gx = Math.floor((x - 10) / 5), gy = Math.floor((y - 10) / 5); const c = gx >= 0 && gy >= 0 && gx < N && gy < N ? g[gy][gx] : null; return rgb(c ?? ic.bg); }));
  if (name === 'home') writeFileSync(join(ROOT, 'favicon.ico'), ico(f32));
  console.log('wrote', name);
}
