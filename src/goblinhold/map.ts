// Map generation, building grid, goblin flow field and settler A*.
import { BUILD, BUSH_BERRIES, BuildKind, MAP_H, MAP_W, ROCK_STONE, T_BUSH, T_DIRT, T_GRASS, T_ROCK, T_SAPLING, T_TREE, T_WATER, TREE_WOOD } from './defs';
import { Building, Game, idx, inMap, rand } from './state';

const N = MAP_W * MAP_H;
export const KEEP_X = 22;
export const KEEP_Y = 15;

// Derived data, rebuilt from state (never saved).
export let bldGrid = new Int32Array(N);
export let flow = new Float32Array(N);
export let flowNext = new Int32Array(N);
let byId = new Map<number, Building>();
export let flowVersion = 0;

export function bld(g: Game, id: number): Building | undefined {
  const b = byId.get(id);
  if (b && g.blds.includes(b)) return b;
  return g.blds.find((x) => x.id === id);
}

export function obstacle(g: Game, i: number) {
  const t = g.terrain[i];
  return t === T_TREE || t === T_ROCK || t === T_WATER || t === T_BUSH;
}

export function bldAtTile(g: Game, x: number, y: number): Building | undefined {
  if (!inMap(x, y)) return undefined;
  const id = bldGrid[idx(x, y)];
  return id ? byId.get(id) : undefined;
}

/** Can a goblin stand on this tile? */
export function gobFree(g: Game, x: number, y: number) {
  if (!inMap(x, y)) return false;
  const i = idx(x, y);
  if (obstacle(g, i)) return false;
  const b = bldGrid[i] ? byId.get(bldGrid[i]) : undefined;
  return !b || !BUILD[b.kind].solid || !b.done;
}

/** Can a settler walk this tile? Settlers climb palisades. */
export function settlerFree(g: Game, x: number, y: number) {
  if (!inMap(x, y)) return false;
  const i = idx(x, y);
  if (obstacle(g, i)) return false;
  const b = bldGrid[i] ? byId.get(bldGrid[i]) : undefined;
  return !b || !BUILD[b.kind].solid || !b.done || b.kind === 'wall';
}

export function rebuild(g: Game) {
  bldGrid = new Int32Array(N);
  byId = new Map();
  for (const b of g.blds) {
    byId.set(b.id, b);
    const d = BUILD[b.kind];
    for (let y = b.y; y < b.y + d.h; y++) for (let x = b.x; x < b.x + d.w; x++) if (inMap(x, y)) bldGrid[idx(x, y)] = b.id;
  }
  computeFlow(g);
}

// ---------- heap ----------
class Heap {
  k: number[] = [];
  p: number[] = [];
  push(key: number, pr: number) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key); p.push(pr);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pr) break;
      k[i] = k[par]; p[i] = p[par];
      i = par;
    }
    k[i] = key; p[i] = pr;
  }
  pop(): number {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        k[i] = k[c]; p[i] = p[c];
        i = c;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
  get size() { return this.k.length; }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function gobCost(g: Game, i: number): number {
  if (obstacle(g, i)) return Infinity;
  const id = bldGrid[i];
  if (!id) return 1;
  const b = byId.get(id)!;
  return BUILD[b.kind].solid && b.done ? BUILD[b.kind].goblinCost : 1;
}

/** Dijkstra from the keep outward. Solid buildings are expensive rather than blocked, so goblins
 *  chop through a wall when going around would take longer. */
export function computeFlow(g: Game) {
  flow = new Float32Array(N).fill(Infinity);
  flowNext = new Int32Array(N).fill(-1);
  const h = new Heap();
  const keep = g.blds.find((b) => b.kind === 'keep');
  if (!keep) return;
  for (let y = keep.y; y < keep.y + 3; y++) for (let x = keep.x; x < keep.x + 3; x++) {
    const i = idx(x, y);
    flow[i] = 0;
    h.push(i, 0);
  }
  while (h.size) {
    const i = h.pop();
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const di = flow[i];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const ni = idx(nx, ny);
      // no squeezing diagonally past a corner (trees, walls, buildings)
      if (dx && dy && (gobCost(g, idx(x + dx, y)) > 1 || gobCost(g, idx(x, y + dy)) > 1)) continue;
      // cost of stepping from ni into i (goblins walk toward the keep)
      const c = (flow[i] === 0 ? 1 : gobCost(g, i)) * (dx && dy ? 1.414 : 1);
      if (obstacle(g, ni)) continue;
      const nd = di + c;
      if (nd < flow[ni]) {
        flow[ni] = nd;
        flowNext[ni] = i;
        h.push(ni, nd);
      }
    }
  }
  flowVersion++;
}

/** Tiles a goblin would walk from an entry to the keep. */
export function tracePath(g: Game, x: number, y: number): number[] {
  const out: number[] = [];
  let i = idx(x, y);
  for (let n = 0; n < 400 && i >= 0; n++) {
    out.push(i);
    if (flow[i] === 0) break;
    i = flowNext[i];
  }
  return out;
}

// ---------- settler A* ----------
/** Path for a settler to a tile, or to any free tile touching a building rect. Returns tile indices
 *  (excluding the start) or null. */
export function findPath(g: Game, sx: number, sy: number, tx: number, ty: number, tw = 0, th = 0): number[] | null {
  const start = idx(sx, sy);
  const rect = tw > 0;
  const isGoal = (x: number, y: number) => rect
    ? x >= tx - 1 && x <= tx + tw && y >= ty - 1 && y <= ty + th && !(x >= tx && x < tx + tw && y >= ty && y < ty + th)
    : x === tx && y === ty;
  if (isGoal(sx, sy)) return [];
  const gs = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const h = new Heap();
  gs[start] = 0;
  const cx = rect ? tx + tw / 2 : tx, cy = rect ? ty + th / 2 : ty;
  h.push(start, 0);
  let found = -1, iter = 0;
  while (h.size && iter++ < 4000) {
    const i = h.pop();
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    if (isGoal(x, y)) { found = i; break; }
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!settlerFree(g, nx, ny)) continue;
      if (dx && dy && (!settlerFree(g, x + dx, y) || !settlerFree(g, x, y + dy))) continue;
      const ni = idx(nx, ny);
      const wall = bldGrid[ni] && byId.get(bldGrid[ni])?.kind === 'wall';
      const ng = gs[i] + (dx && dy ? 1.414 : 1) * (wall ? 3 : 1);
      if (ng < gs[ni]) {
        gs[ni] = ng;
        from[ni] = i;
        h.push(ni, ng + Math.hypot(nx - cx, ny - cy));
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  for (let i = found; i !== start; i = from[i]) out.push(i);
  return out.reverse();
}

// ---------- placement ----------
export function canPlace(g: Game, kind: BuildKind, x: number, y: number): boolean {
  const d = BUILD[kind];
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    if (!inMap(xx, yy) || xx === 0 || yy === 0 || xx === MAP_W - 1) return false;
    const i = idx(xx, yy);
    if (obstacle(g, i) || bldGrid[i]) return false;
    if (g.terrain[i] === T_SAPLING) return false;
  }
  // keep entries open so goblins never spawn inside a wall
  for (const e of g.entries) if (Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1) return false;
  return true;
}

// ---------- generation ----------
function noise(g: Game, scale: number) {
  const gw = Math.ceil(MAP_W / scale) + 2, gh = Math.ceil(MAP_H / scale) + 2;
  const grid: number[] = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rand(g));
  return (x: number, y: number) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
    const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function generate(g: Game) {
  const n1 = noise(g, 6), n2 = noise(g, 3), nw = noise(g, 5);
  const kcx = KEEP_X + 1.5, kcy = KEEP_Y + 1.5;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    const d = Math.hypot(x + 0.5 - kcx, y + 0.5 - kcy);
    const edge = Math.max(0, 1 - Math.min(x, y, MAP_W - 1 - x) / 6) * 0.22;
    let t = T_GRASS;
    const v = n1(x, y) * 0.7 + n2(x, y) * 0.3 + edge;
    if (y >= MAP_H - 2 - (nw(x, 0) > 0.55 ? 1 : 0)) t = T_WATER;
    else if (d > 7 && v > 0.56) t = T_TREE;
    else if (d > 7 && v > 0.47 && rand(g) < 0.12) t = T_BUSH;
    g.terrain[i] = t;
    if (t === T_TREE) g.amount[i] = TREE_WOOD;
  }
  // a small pond
  const px = rand(g) < 0.5 ? 8 + Math.floor(rand(g) * 6) : 32 + Math.floor(rand(g) * 6);
  const py = 20 + Math.floor(rand(g) * 4);
  for (let y = py - 2; y <= py + 2; y++) for (let x = px - 3; x <= px + 3; x++) {
    if (inMap(x, y) && Math.hypot((x - px) / 1.5, y - py) < 1.9 + rand(g) * 0.5) g.terrain[idx(x, y)] = T_WATER;
  }
  // entries and goblin trails toward the keep
  g.entries = [
    { x: 0, y: 16, name: 'West' },
    { x: 23, y: 0, name: 'North' },
    { x: MAP_W - 1, y: 16, name: 'East' },
  ];
  for (const e of g.entries) {
    let x = e.x, y = e.y;
    for (let s = 0; s < 200; s++) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        if (!inMap(x + dx, y + dy)) continue;
        const i = idx(x + dx, y + dy);
        if (g.terrain[i] !== T_WATER || y + dy < MAP_H - 3) { g.terrain[i] = T_DIRT; g.amount[i] = 0; }
      }
      const d = Math.hypot(x - kcx, y - kcy);
      if (d < 5) break;
      const ax = Math.sign(Math.round(kcx - x)), ay = Math.sign(Math.round(kcy - y));
      if (rand(g) < 0.35) {
        if (rand(g) < 0.5 && ay !== 0) y += ay; else x += ax || (rand(g) < 0.5 ? 1 : -1);
      } else if (Math.abs(kcx - x) > Math.abs(kcy - y)) x += ax; else y += ay;
      x = Math.max(0, Math.min(MAP_W - 1, x));
      y = Math.max(0, Math.min(MAP_H - 4, y));
    }
  }
  // rocky outcrops to quarry: a few clusters away from the keep
  for (let c = 0; c < 5; c++) {
    let cx = 0, cy = 0;
    for (let tries = 0; tries < 40; tries++) {
      cx = 3 + Math.floor(rand(g) * (MAP_W - 6)); cy = 3 + Math.floor(rand(g) * (MAP_H - 9));
      if (Math.hypot(cx - kcx, cy - kcy) > 8 && Math.hypot(cx - kcx, cy - kcy) < 18) break;
    }
    const n = 3 + Math.floor(rand(g) * 4);
    for (let k = 0; k < n; k++) {
      const x = cx + Math.floor(rand(g) * 4) - 1, y = cy + Math.floor(rand(g) * 3) - 1;
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      if (g.terrain[i] === T_WATER || g.terrain[i] === T_DIRT) continue;
      g.terrain[i] = T_ROCK;
      g.amount[i] = ROCK_STONE;
    }
  }
  // clear and wear the ground around the keep
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const d = Math.hypot(x + 0.5 - kcx, y + 0.5 - kcy);
    const i = idx(x, y);
    if (d < 6.5 && g.terrain[i] !== T_WATER) { g.terrain[i] = d < 2.6 ? T_DIRT : T_GRASS; g.amount[i] = 0; }
  }
  for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === T_BUSH) g.amount[i] = BUSH_BERRIES;
}

export function keepCenter(g: Game) {
  const k = bld(g, g.keepId);
  return k ? { x: k.x + 1.5, y: k.y + 1.5 } : { x: KEEP_X + 1.5, y: KEEP_Y + 1.5 };
}

/** Distance from a point to a building's rectangle (tiles). */
export function distToBld(b: Building, x: number, y: number) {
  const d = BUILD[b.kind];
  const dx = Math.max(b.x - x, 0, x - (b.x + d.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + d.h));
  return Math.hypot(dx, dy);
}

export function nearestFree(g: Game, x: number, y: number, settler = true): { x: number; y: number } {
  const free = settler ? settlerFree : gobFree;
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (free(g, cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
  }
  return { x, y };
}
