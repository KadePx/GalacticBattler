// Milestone 8: share images. Draws the map around one people as a PNG for link previews
// (1200x630): terrain colours, every people's land tinted, the chosen people bright with a
// marker on their capital. Pure pixel work plus a tiny PNG writer; runs in the world host.

import type { World } from '../sim/types';
import { BIOMES } from '../sim/worldgen';

const OW = 1200;
const OH = 630;

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslRgb(hue: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function png(rgb: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The map around a people as a 1200x630 PNG. */
export async function ogImage(w: World, civ: number): Promise<Uint8Array> {
  const c = w.civs[civ];
  const capT = w.setts[c.capital]?.tile ?? 0;
  const W = w.W;
  const H = w.H;
  const t = w.t;
  // Frame the people's land: its bounding box, padded, at least 28 tiles wide.
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let i = 0; i < t.owner.length; i++) {
    if (t.owner[i] !== civ) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = capT % W;
  const cy = (capT - cx) / W;
  if (maxX < 0) { minX = maxX = cx; minY = maxY = cy; }
  const sq3 = Math.sqrt(3);
  const spanCols = Math.max(36, (maxX - minX + 1) * 1.8, ((maxY - minY + 1) * 1.5 * 1.8 * OW) / OH / sq3);
  const size = OW / (spanCols * sq3); // hex radius in pixels
  const midX = ((minX + maxX + 1) / 2) * sq3 * size;
  const midY = ((minY + maxY) / 2) * 1.5 * size + size;
  const ox = midX - OW / 2;
  const oy = midY - OH / 2;
  const biome = BIOMES.map((b) => hexRgb(b.c));
  const sea = biome[0];
  const tint = w.civs.map((o) => hslRgb(o.hue, 0.68, 0.55));
  const rgb = new Uint8Array(OW * OH * 3);
  // The hex under a pixel: nearest tile centre among the few candidates (odd rows shift right).
  const tileAt = (px: number, py: number): number => {
    const X = px + ox;
    const Y = py + oy;
    const r0 = Math.floor((Y - size) / (1.5 * size));
    let best = -1;
    let bd = Infinity;
    for (let row = r0 - 1; row <= r0 + 1; row++) {
      if (row < 0 || row >= H) continue;
      const col0 = Math.round(X / (sq3 * size) - 0.5 - 0.5 * (row & 1));
      for (let col = col0 - 1; col <= col0 + 1; col++) {
        if (col < 0 || col >= W) continue;
        const tx = sq3 * size * (col + 0.5 * (row & 1)) + (sq3 * size) / 2;
        const ty = size * 1.5 * row + size;
        const d = (tx - X) * (tx - X) + (ty - Y) * (ty - Y);
        if (d < bd) { bd = d; best = row * W + col; }
      }
    }
    return bd > size * size * 1.3 ? -1 : best;
  };
  const tiles = new Int32Array(OW * OH);
  for (let py = 0; py < OH; py++) for (let px = 0; px < OW; px++) tiles[py * OW + px] = tileAt(px, py);
  for (let py = 0; py < OH; py++) {
    for (let px = 0; px < OW; px++) {
      const i = tiles[py * OW + px];
      let r: number, g: number, b: number;
      if (i < 0) [r, g, b] = sea;
      else {
        [r, g, b] = biome[t.biome[i]];
        const o = t.owner[i];
        if (o !== civ && t.biome[i] > 2) { r *= 0.72; g *= 0.72; b *= 0.72; } // everyone else's land, a little darker
        if (o >= 0) {
          const mine = o === civ;
          const k = mine ? 0.6 : 0.25;
          const [tr, tg, tb] = tint[o];
          r = r * (1 - k) + tr * k;
          g = g * (1 - k) + tg * k;
          b = b * (1 - k) + tb * k;
          // Borders: where a neighbouring pixel belongs to someone else.
          const j = tiles[py * OW + Math.min(OW - 1, px + 2)];
          const jj = tiles[Math.min(OH - 1, py + 2) * OW + px];
          const oj = j >= 0 ? t.owner[j] : -1;
          const ojj = jj >= 0 ? t.owner[jj] : -1;
          if (oj !== o || ojj !== o) {
            if (mine) { r = tr * 0.9 + 25; g = tg * 0.9 + 25; b = tb * 0.9 + 25; } else { r *= 0.55; g *= 0.55; b *= 0.55; }
          }
        }
      }
      const q = (py * OW + px) * 3;
      rgb[q] = r;
      rgb[q + 1] = g;
      rgb[q + 2] = b;
    }
  }
  // Capital marker: a white disc with a dark ring.
  const mx = sq3 * size * (cx + 0.5 * (cy & 1)) + (sq3 * size) / 2 - ox;
  const my = size * 1.5 * cy + size - oy;
  for (let py = Math.floor(my - 16); py <= my + 16; py++) {
    for (let px = Math.floor(mx - 16); px <= mx + 16; px++) {
      if (px < 0 || py < 0 || px >= OW || py >= OH) continue;
      const d = Math.hypot(px - mx, py - my);
      if (d > 14) continue;
      const q = (py * OW + px) * 3;
      const v = d > 10 ? 15 : 250;
      rgb[q] = v; rgb[q + 1] = v; rgb[q + 2] = v;
    }
  }
  return png(rgb, OW, OH);
}
