import * as THREE from 'three';
import { Built, Collider, Rng, barrel, crate, deadTree, grassTuft, merge, pineTree, rock, wreckedCar } from './models';

export const HALF = 60; // the map runs from -HALF to +HALF on X and Z
export const BASE_CLEAR = 16; // no scenery this close to the HQ

export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1). */
export function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Static colliders bucketed on a coarse grid for quick nearby lookups. */
export class ColliderGrid {
  static CELL = 4;
  cells = new Map<number, Collider[]>();
  key(cx: number, cz: number) {
    return cx * 4096 + cz;
  }
  add(c: Collider) {
    const C = ColliderGrid.CELL;
    const x0 = Math.floor((c.x - c.r) / C), x1 = Math.floor((c.x + c.r) / C);
    const z0 = Math.floor((c.z - c.r) / C), z1 = Math.floor((c.z + c.r) / C);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
  }
  remove(c: Collider) {
    for (const list of this.cells.values()) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
  }
  near(x: number, z: number): Collider[] | undefined {
    return this.cells.get(this.key(Math.floor(x / ColliderGrid.CELL), Math.floor(z / ColliderGrid.CELL)));
  }
  /** Is a circle free of every collider? */
  free(x: number, z: number, r: number) {
    const C = ColliderGrid.CELL;
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++)
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          const dx = x - c.x, dz = z - c.z, rr = r + c.r;
          if (dx * dx + dz * dz < rr * rr) return false;
        }
      }
    return true;
  }
  /** Push a circle out of any collider it overlaps. Mutates p. */
  resolve(p: { x: number; z: number }, r: number) {
    this.resolveHit(p, r);
  }
  /** Like resolve, but returns the last collider that was in the way (or null). */
  resolveHit(p: { x: number; z: number }, r: number): Collider | null {
    let hit: Collider | null = null;
    const C = ColliderGrid.CELL;
    const cx0 = Math.floor((p.x - r) / C), cx1 = Math.floor((p.x + r) / C);
    const cz0 = Math.floor((p.z - r) / C), cz1 = Math.floor((p.z + r) / C);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / d;
            p.x += dx * push;
            p.z += dz * push;
            hit = c;
          }
        }
      }
    return hit;
  }
}

/** Is a point on one of the two dirt roads that cross at the base? */
function onRoad(x: number, z: number) {
  const wob = Math.sin(x * 0.08) * 2.5;
  const wob2 = Math.sin(z * 0.07 + 1) * 2.5;
  return Math.abs(z - wob) < 2.4 || Math.abs(x - wob2) < 2.4;
}

export interface MapBuild {
  ground: THREE.Mesh;
  props: THREE.Mesh;
  grid: ColliderGrid;
}

export function buildMap(seed: number): MapBuild {
  const rng = mulberry(seed);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  // Ground: a low-poly plane, slightly bumpy, coloured per triangle.
  const size = HALF * 2 + 40; // overhang past the playable edge
  const seg = 70;
  const plane = new THREE.PlaneGeometry(size, size, seg, seg).toNonIndexed();
  plane.rotateX(-Math.PI / 2);
  const pos = plane.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edge = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - HALF);
    pos.setY(i, (noise(x * 0.15, z * 0.15, seed + 9) - 0.5) * 0.25 + edge * 0.08);
  }
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const grass = [0x3b4a2a, 0x425030, 0x37452a, 0x4a5534];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const n = noise(cx * 0.06, cz * 0.06, seed);
    const r = Math.max(Math.abs(cx), Math.abs(cz));
    if (onRoad(cx, cz)) col.setHex(0x5c4d36);
    else if (Math.hypot(cx, cz) < 9) col.setHex(0x4f4836);
    else if (n > 0.68) col.setHex(0x4b4430);
    else col.setHex(grass[Math.floor(hash2(Math.floor(cx * 3), Math.floor(cz * 3), seed) * grass.length)]);
    if (r > HALF) col.multiplyScalar(0.7);
    const j = 0.92 + rng() * 0.16;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = col.r * j;
      colors[(i + k) * 3 + 1] = col.g * j;
      colors[(i + k) * 3 + 2] = col.b * j;
    }
  }
  plane.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  plane.deleteAttribute('uv');
  plane.computeVertexNormals();
  const ground = new THREE.Mesh(plane, mat);
  ground.receiveShadow = true;

  // Scenery.
  const out: Built = { parts: [], colliders: [] };
  const grid = new ColliderGrid();
  const fits = (x: number, z: number, r: number) => {
    if (Math.hypot(x, z) < BASE_CLEAR + r) return false;
    if (onRoad(x, z)) return false;
    for (const c of out.colliders) {
      const dx = x - c.x, dz = z - c.z, rr = r + c.r + 0.6;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  };
  const scatter = (count: number, r: number, fn: (x: number, z: number, rng: Rng, out: Built) => void, where: (x: number, z: number) => boolean) => {
    for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
      const x = (rng() * 2 - 1) * (HALF + 14);
      const z = (rng() * 2 - 1) * (HALF + 14);
      if (!where(x, z) || !fits(x, z, r)) continue;
      fn(x, z, rng, out);
      n++;
    }
  };
  const forest = (x: number, z: number) => noise(x * 0.05, z * 0.05, seed + 3) > 0.55 || Math.max(Math.abs(x), Math.abs(z)) > HALF - 2;
  const open = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < HALF - 4;
  scatter(260, 0.9, pineTree, forest);
  scatter(40, 0.5, deadTree, open);
  scatter(55, 0.9, rock, open);
  // abandoned stuff near the roads
  scatter(10, 2.0, wreckedCar, (x, z) => open(x, z) && Math.hypot(x, z) < 40);
  scatter(18, 0.5, barrel, (x, z) => open(x, z) && Math.hypot(x, z) < 34);
  scatter(18, 0.6, crate, (x, z) => open(x, z) && Math.hypot(x, z) < 34);
  for (let i = 0; i < 260; i++) {
    const x = (rng() * 2 - 1) * HALF, z = (rng() * 2 - 1) * HALF;
    if (!onRoad(x, z) && Math.hypot(x, z) > 6) grassTuft(x, z, rng, out);
  }
  // Only colliders inside the playable square matter to units.
  for (const c of out.colliders) if (Math.abs(c.x) < HALF + 3 && Math.abs(c.z) < HALF + 3) grid.add(c);

  const props = new THREE.Mesh(merge(out.parts), mat);
  props.castShadow = true;
  props.receiveShadow = true;
  return { ground, props, grid };
}
