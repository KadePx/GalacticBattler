// Hex grid in "odd-r" offset layout: odd rows sit half a tile to the right.
// Tile index i = y * W + x.

const NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const NB_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function neighbors(W: number, H: number, i: number, out: number[]): number[] {
  out.length = 0;
  const x = i % W;
  const y = (i - x) / W;
  const d = y & 1 ? NB_ODD : NB_EVEN;
  for (const [dx, dy] of d) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
  }
  return out;
}

function cube(W: number, i: number): [number, number] {
  const x = i % W;
  const y = (i - x) / W;
  return [x - (y - (y & 1)) / 2, y];
}

export function hexDist(W: number, a: number, b: number): number {
  const [q1, r1] = cube(W, a);
  const [q2, r2] = cube(W, b);
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Offsets of every tile within radius r, for a centre on an even row and on an odd row.
const OFFS: [number, number][][][] = [];
function offsets(r: number): [number, number][][] {
  if (OFFS[r]) return OFFS[r];
  const res: [number, number][][] = [[], []];
  for (let parity = 0; parity < 2; parity++) {
    const W = 1000;
    const cy = 10 + parity;
    const c = cy * W + 500;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const t = (cy + dy) * W + 500 + dx;
        if (hexDist(W, c, t) <= r) res[parity].push([dx, dy]);
      }
    }
  }
  return (OFFS[r] = res);
}

/** Calls fn for every tile within radius r of i (including i). */
export function forWithin(W: number, H: number, i: number, r: number, fn: (t: number) => void): void {
  const x = i % W;
  const y = (i - x) / W;
  for (const [dx, dy] of offsets(r)[y & 1]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) fn(ny * W + nx);
  }
}

/** The tile under a pixel position (inverse of tileCenter), or -1 off the map. */
export function tileAtPixel(W: number, H: number, size: number, px: number, py: number): number {
  const w = Math.sqrt(3) * size;
  const gy = Math.round((py - size) / (size * 1.5));
  let best = -1;
  let bd = Infinity;
  for (let y = gy - 1; y <= gy + 1; y++) {
    if (y < 0 || y >= H) continue;
    const gx = Math.round((px - w / 2) / w - 0.5 * (y & 1));
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (x < 0 || x >= W) continue;
      const cx = w * (x + 0.5 * (y & 1)) + w / 2;
      const cy = size * 1.5 * y + size;
      const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d < bd) { bd = d; best = y * W + x; }
    }
  }
  return bd <= size * size * 1.1 ? best : -1;
}

/** Pixel centre of a tile for a hex of the given size (point-top). */
export function tileCenter(W: number, i: number, size: number): [number, number] {
  const x = i % W;
  const y = (i - x) / W;
  const w = Math.sqrt(3) * size;
  return [w * (x + 0.5 * (y & 1)) + w / 2, size * 1.5 * y + size];
}
