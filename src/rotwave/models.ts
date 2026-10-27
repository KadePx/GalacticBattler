import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-poly models built from primitives. Each part gets flat vertex colours
// (with a little per-triangle jitter) and parts are merged into one geometry,
// so a whole zombie type or a whole chunk of scenery is a single draw call.

export type Rng = () => number;
type V3 = [number, number, number];

const tmpColor = new THREE.Color();

/** Bake a colour into a geometry, with optional per-triangle brightness jitter. */
export function paint(geo: THREE.BufferGeometry, color: number, jitter = 0, rng: Rng = Math.random): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  tmpColor.setHex(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rng() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      const o = (i + k) * 3;
      arr[o] = tmpColor.r * j;
      arr[o + 1] = tmpColor.g * j;
      arr[o + 2] = tmpColor.b * j;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const vp = new THREE.Vector3();
const vs = new THREE.Vector3();

/** Move/rotate/scale a geometry in place. */
export function place(geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.BufferGeometry {
  e.set(rot[0], rot[1], rot[2]);
  q.setFromEuler(e);
  m4.compose(vp.set(pos[0], pos[1], pos[2]), q, vs.set(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(m4);
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cone = (r: number, h: number, seg: number) => new THREE.ConeGeometry(r, h, seg);
const cyl = (rt: number, rb: number, h: number, seg: number) => new THREE.CylinderGeometry(rt, rb, h, seg);

// ---------------------------------------------------------------- zombies

export interface ZombieLook {
  skin: number;
  shirt: number;
  pants: number;
  width: number; // torso width multiplier
  hunch: number; // forward lean of the torso (radians)
  armLen: number;
}

/** A zombie standing at the origin, facing +Z, feet on y=0, about 1.9 tall. */
export function zombieGeometry(look: ZombieLook): THREE.BufferGeometry {
  const w = look.width;
  const parts = [
    // legs
    place(paint(box(0.22, 0.8, 0.25), look.pants, 0.15), [-0.15 * w, 0.4, 0]),
    place(paint(box(0.22, 0.8, 0.25), look.pants, 0.15), [0.15 * w, 0.4, -0.04], [0.1, 0, 0]),
    // torso, leaning forward
    place(paint(box(0.6 * w, 0.78, 0.36), look.shirt, 0.25), [0, 1.17, 0.04], [look.hunch, 0, 0]),
    // arms stretched out in front
    place(paint(box(0.17, 0.17, look.armLen), look.skin, 0.2), [-0.38 * w, 1.38, 0.28 + look.armLen / 2 - 0.1], [-0.12, 0.08, 0]),
    place(paint(box(0.17, 0.17, look.armLen * 0.9), look.skin, 0.2), [0.38 * w, 1.33, 0.26 + look.armLen / 2 - 0.12], [-0.02, -0.1, 0]),
    // head, tilted
    place(paint(box(0.4, 0.4, 0.4), look.skin, 0.2), [0.02, 1.78, 0.14], [0.2, 0.1, 0.18]),
    // eyes
    place(paint(box(0.08, 0.06, 0.04), 0xff3a2a), [-0.08, 1.8, 0.35], [0.2, 0.1, 0.18]),
    place(paint(box(0.08, 0.06, 0.04), 0xff3a2a), [0.1, 1.83, 0.35], [0.2, 0.1, 0.18]),
  ];
  return merge(parts);
}

// ---------------------------------------------------------------- soldiers

export interface SoldierLook {
  jacket: number;
  helmet: number;
  gunLen: number;
  bulk: number; // torso width multiplier
  gunW?: number; // barrel thickness
  pack?: number; // backpack colour
  tanks?: boolean; // flamer fuel tanks
  cross?: boolean; // medic red cross on the helmet
  visor?: number; // stripe on the helmet (engineer)
}

export interface SoldierRig {
  root: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
}

const soldierMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** A soldier facing +Z, feet on y=0. Legs are separate so they can swing. */
export function soldierRig(look: SoldierLook): SoldierRig {
  const mesh = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, soldierMat);
    m.castShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const b = look.bulk;

  const leg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.82, 0);
    pivot.add(mesh(merge([
      place(paint(box(0.24, 0.72, 0.26), 0x2b3242, 0.1), [0, -0.4, 0]),
      place(paint(box(0.26, 0.14, 0.34), 0x1a1a1a), [0, -0.76, 0.04]),
    ])));
    root.add(pivot);
    return pivot;
  };
  const legL = leg(-0.15 * b);
  const legR = leg(0.15 * b);

  const L = look.gunLen;
  root.add(mesh(merge([
    place(paint(box(0.62 * b, 0.72, 0.38), look.jacket, 0.15), [0, 1.2, 0]),
    place(paint(box(0.36, 0.36, 0.36), 0xe2b48c, 0.1), [0, 1.76, 0]),
    place(paint(box(0.44, 0.2, 0.46), look.helmet, 0.1), [0, 1.98, 0.01]),
    place(paint(box(0.16, 0.16, 0.56), look.jacket, 0.15), [-0.34 * b, 1.32, 0.24], [0, 0.22, 0]),
    place(paint(box(0.16, 0.16, 0.56), look.jacket, 0.15), [0.34 * b, 1.32, 0.24], [0, -0.22, 0]),
    place(paint(box(look.gunW ?? 0.12, (look.gunW ?? 0.12) + 0.04, L), 0x23262b, 0.1), [0, 1.3, 0.2 + L / 2]),
    place(paint(box(0.1, 0.22, 0.12), 0x23262b), [0, 1.18, 0.5]),
    ...(look.tanks
      ? [
          place(paint(cyl(0.13, 0.13, 0.62, 6), 0xb23a22, 0.2), [-0.13, 1.25, -0.32]),
          place(paint(cyl(0.13, 0.13, 0.62, 6), 0xb23a22, 0.2), [0.13, 1.25, -0.32]),
        ]
      : [place(paint(box(0.46 * b, 0.5, 0.2), look.pack ?? 0x4a4234, 0.15), [0, 1.24, -0.28])]),
    ...(look.cross
      ? [
          place(paint(box(0.24, 0.07, 0.05), 0xd8302a), [0, 2.0, 0.25]),
          place(paint(box(0.07, 0.16, 0.05), 0xd8302a), [0, 2.0, 0.25]),
          place(paint(box(0.12, 0.22, 0.05), 0xd8302a), [0.31 * b, 1.38, 0.0]),
        ]
      : []),
    ...(look.visor ? [place(paint(box(0.46, 0.06, 0.48), look.visor), [0, 1.9, 0.01])] : []),
  ])));
  return { root, legL, legR };
}

// ---------------------------------------------------------------- structures

/** HQ: a sandbagged bunker with a radio mast, about 3.4 across. */
export function hqGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    place(paint(box(3.4, 1.6, 3.4), 0x6d6a5c, 0.2), [0, 0.8, 0]),
    place(paint(box(3.7, 0.25, 3.7), 0x4e4b40, 0.2), [0, 1.7, 0]),
    place(paint(box(1.4, 0.9, 1.4), 0x7a7766, 0.2), [0.6, 2.25, -0.5]),
    place(paint(cyl(0.05, 0.07, 3.2, 4), 0x2a2a2a), [-1.1, 3.3, -1.1]),
    place(paint(box(0.2, 0.2, 0.2), 0xff4433), [-1.1, 4.9, -1.1]),
    place(paint(box(2.2, 0.35, 0.1), 0x1a1d1f), [0, 1.1, 1.71]),
  ];
  // sandbag ring
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue;
    parts.push(place(paint(box(0.9, 0.45, 0.5), 0xa89a72, 0.25), [Math.cos(a) * 2.6, 0.23, Math.sin(a) * 2.6], [0, -a + Math.PI / 2, 0]));
  }
  return merge(parts);
}

/** A 2-long barricade along X: planks over sandbags. */
export function wallGeometry(): THREE.BufferGeometry {
  return merge([
    place(paint(box(2.0, 0.5, 0.7), 0xa89a72, 0.25), [0, 0.25, 0]),
    place(paint(box(2.1, 0.22, 0.12), 0x7a5a36, 0.3), [0, 0.75, 0.15], [0, 0, 0.06]),
    place(paint(box(2.1, 0.22, 0.12), 0x6a4a2e, 0.3), [0, 1.0, 0.15], [0, 0, -0.05]),
    place(paint(box(0.12, 1.2, 0.12), 0x5a3d2a), [-0.85, 0.6, 0.2]),
    place(paint(box(0.12, 1.2, 0.12), 0x5a3d2a), [0.85, 0.6, 0.2]),
  ]);
}

export function turretBase(): THREE.BufferGeometry {
  return merge([
    place(paint(cyl(0.9, 1.05, 0.6, 8), 0x5a5d60, 0.2), [0, 0.3, 0]),
    place(paint(cyl(0.45, 0.6, 0.5, 6), 0x46494c, 0.2), [0, 0.85, 0]),
  ]);
}

/** Turret head, pivots at its own origin, barrels along +Z. */
export function turretHead(): THREE.BufferGeometry {
  return merge([
    place(paint(box(0.8, 0.5, 0.9), 0x6b7a5a, 0.2), [0, 0, 0]),
    place(paint(box(0.1, 0.1, 1.0), 0x1f2124), [-0.14, 0.02, 0.85]),
    place(paint(box(0.1, 0.1, 1.0), 0x1f2124), [0.14, 0.02, 0.85]),
    place(paint(box(0.5, 0.12, 0.3), 0x3a3f33), [0, 0.3, -0.2]),
  ]);
}

/** Cannon: chunky housing with one thick barrel. */
export function cannonHead(): THREE.BufferGeometry {
  return merge([
    place(paint(box(1.0, 0.6, 1.1), 0x5d6b4c, 0.2), [0, 0, 0]),
    place(paint(cyl(0.16, 0.2, 1.6, 7), 0x1f2124, 0.1), [0, 0.05, 1.2], [Math.PI / 2, 0, 0]),
    place(paint(cyl(0.22, 0.22, 0.25, 7), 0x2b2e31), [0, 0.05, 1.95], [Math.PI / 2, 0, 0]),
    place(paint(box(0.7, 0.15, 0.5), 0x46523a), [0, 0.38, -0.2]),
  ]);
}

/** Flame turret: fuel tank with a nozzle. */
export function flameHead(): THREE.BufferGeometry {
  return merge([
    place(paint(cyl(0.38, 0.38, 0.8, 8), 0xb23a22, 0.2), [0, 0, -0.1], [Math.PI / 2, 0, 0]),
    place(paint(box(0.24, 0.24, 0.8), 0x2b2e31), [0, 0, 0.6]),
    place(paint(cyl(0.12, 0.18, 0.2, 6), 0x1a1a1a), [0, 0, 1.05], [Math.PI / 2, 0, 0]),
    place(paint(box(0.1, 0.3, 0.1), 0xffb030), [0, -0.15, 1.05]),
  ]);
}

/** Mortar pit: a ring of sandbags (the tube is a separate head). */
export function mortarBase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [place(paint(cyl(1.15, 1.2, 0.08, 10), 0x4f4836, 0.2), [0, 0.04, 0])];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(place(paint(box(0.75, 0.4, 0.42), 0xa89a72, 0.25), [Math.cos(a) * 1.15, 0.2, Math.sin(a) * 1.15], [0, -a + Math.PI / 2, 0]));
  }
  parts.push(place(paint(box(0.5, 0.3, 0.4), 0x5a4a2e, 0.2), [0.6, 0.15, -0.5]));
  return merge(parts);
}
export function mortarHead(): THREE.BufferGeometry {
  return merge([
    place(paint(cyl(0.13, 0.15, 1.1, 7), 0x2b2e31, 0.1), [0, 0.45, 0.2], [0.75, 0, 0]),
    place(paint(cyl(0.3, 0.3, 0.06, 7), 0x3a3d40), [0, 0.03, 0]),
    place(paint(box(0.05, 0.5, 0.05), 0x2b2e31), [0.12, 0.25, 0.4], [-0.5, 0, 0]),
  ]);
}

/** Watchtower: stilts, platform with railings and a roof. */
export function towerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    parts.push(place(paint(box(0.18, 3.6, 0.18), 0x6a4a2e, 0.2), [x, 1.8, z]));
  }
  parts.push(
    place(paint(box(0.08, 2.4, 0.08), 0x5a3d2a), [-0.8, 1.6, 0], [0.9, 0, 0]),
    place(paint(box(0.08, 2.4, 0.08), 0x5a3d2a), [0.8, 1.6, 0], [-0.9, 0, 0]),
    place(paint(box(2.1, 0.18, 2.1), 0x7a5a36, 0.25), [0, 3.6, 0]),
    place(paint(box(2.1, 0.5, 0.1), 0x7a5a36, 0.25), [0, 3.95, 1.0]),
    place(paint(box(2.1, 0.5, 0.1), 0x7a5a36, 0.25), [0, 3.95, -1.0]),
    place(paint(box(0.1, 0.5, 2.1), 0x7a5a36, 0.25), [1.0, 3.95, 0]),
    place(paint(box(0.1, 0.5, 2.1), 0x7a5a36, 0.25), [-1.0, 3.95, 0]),
    place(paint(box(0.1, 1.4, 0.1), 0x5a3d2a), [-0.95, 4.5, -0.95]),
    place(paint(box(0.1, 1.4, 0.1), 0x5a3d2a), [0.95, 4.5, 0.95]),
    place(paint(box(0.1, 1.4, 0.1), 0x5a3d2a), [0.95, 4.5, -0.95]),
    place(paint(box(0.1, 1.4, 0.1), 0x5a3d2a), [-0.95, 4.5, 0.95]),
    place(paint(cone(1.75, 0.8, 4), 0x4f5d3a, 0.2), [0, 5.55, 0], [0, Math.PI / 4, 0]),
  );
  return merge(parts);
}
/** The lookout on the tower: a small torso with a rifle, along +Z. */
export function lookoutHead(): THREE.BufferGeometry {
  return merge([
    place(paint(box(0.5, 0.55, 0.32), 0x3c4554, 0.15), [0, 0.1, 0]),
    place(paint(box(0.32, 0.32, 0.32), 0xe2b48c, 0.1), [0, 0.55, 0]),
    place(paint(box(0.38, 0.16, 0.4), 0x2a2f38, 0.1), [0, 0.74, 0]),
    place(paint(box(0.08, 0.1, 1.4), 0x23262b), [0, 0.2, 0.6]),
  ]);
}

/** Spike trap: a board studded with metal spikes, flat on the ground. */
export function spikeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [place(paint(box(2.0, 0.12, 2.0), 0x5a3d2a, 0.25), [0, 0.06, 0])];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      parts.push(place(paint(cone(0.09, 0.45, 4), 0x9aa0a6, 0.2), [-0.72 + i * 0.48 + (j % 2) * 0.12, 0.33, -0.72 + j * 0.48]));
    }
  return merge(parts);
}

// ---------------------------------------------------------------- vehicles

export interface VehicleRig {
  root: THREE.Group;
  head: THREE.Object3D;
}
const vmesh = (g: THREE.BufferGeometry) => {
  const m = new THREE.Mesh(g, soldierMat);
  m.castShadow = true;
  return m;
};

/** Open-top gun jeep, facing +Z. */
export function jeepRig(): VehicleRig {
  const root = new THREE.Group();
  const olive = 0x5f6b3d;
  const parts: THREE.BufferGeometry[] = [
    place(paint(box(1.5, 0.45, 2.8), olive, 0.2), [0, 0.6, 0]),
    place(paint(box(1.4, 0.3, 0.9), 0x55613a, 0.2), [0, 0.9, 0.9]),
    place(paint(box(1.4, 0.5, 0.06), 0x2a3036), [0, 1.15, 0.42], [-0.25, 0, 0]),
    place(paint(box(0.5, 0.35, 0.5), 0x3a3f33), [-0.35, 0.95, -0.1]),
    place(paint(box(1.6, 0.12, 0.25), 0x2b2b2b), [0, 0.5, 1.45]),
    place(paint(box(0.4, 0.35, 0.3), 0x4a4234), [0, 0.95, -1.25]),
  ];
  for (const [x, z] of [[-0.78, 0.9], [0.78, 0.9], [-0.78, -0.9], [0.78, -0.9]]) {
    parts.push(place(paint(cyl(0.36, 0.36, 0.3, 8), 0x151515), [x, 0.36, z], [0, 0, Math.PI / 2]));
  }
  root.add(vmesh(merge(parts)));
  const head = new THREE.Group();
  head.position.set(0.15, 1.25, -0.5);
  head.add(vmesh(merge([
    place(paint(box(0.12, 0.6, 0.12), 0x2b2e31), [0, -0.1, 0]),
    place(paint(box(0.3, 0.25, 0.7), 0x2b2e31), [0, 0.25, 0.2]),
    place(paint(box(0.08, 0.08, 0.8), 0x1a1a1a), [0, 0.28, 0.9]),
    place(paint(box(0.5, 0.35, 0.05), 0x46523a), [0, 0.35, 0.35]),
    // the gunner
    place(paint(box(0.45, 0.5, 0.3), 0x5a6b3c, 0.15), [0, 0.15, -0.45]),
    place(paint(box(0.3, 0.3, 0.3), 0xe2b48c), [0, 0.55, -0.45]),
    place(paint(box(0.36, 0.16, 0.38), 0x3d4a2c), [0, 0.72, -0.45]),
  ])));
  root.add(head);
  return { root, head };
}

/** Low-poly tank, facing +Z. Turret is the head. */
export function tankRig(): VehicleRig {
  const root = new THREE.Group();
  const hull = 0x4f5d3a;
  const parts: THREE.BufferGeometry[] = [
    place(paint(box(1.7, 0.6, 3.2), hull, 0.2), [0, 0.75, 0]),
    place(paint(box(1.6, 0.3, 0.6), 0x46523a, 0.2), [0, 0.7, 1.7], [0.5, 0, 0]),
    place(paint(box(0.55, 0.7, 3.5), 0x23262b, 0.15), [-1.05, 0.45, 0]),
    place(paint(box(0.55, 0.7, 3.5), 0x23262b, 0.15), [1.05, 0.45, 0]),
    place(paint(box(0.6, 0.1, 3.5), 0x3a3f33), [-1.05, 0.83, 0]),
    place(paint(box(0.6, 0.1, 3.5), 0x3a3f33), [1.05, 0.83, 0]),
  ];
  for (let i = 0; i < 5; i++) {
    const z = -1.3 + i * 0.65;
    parts.push(
      place(paint(cyl(0.28, 0.28, 0.6, 7), 0x3a3d40), [-1.05, 0.35, z], [0, 0, Math.PI / 2]),
      place(paint(cyl(0.28, 0.28, 0.6, 7), 0x3a3d40), [1.05, 0.35, z], [0, 0, Math.PI / 2]),
    );
  }
  root.add(vmesh(merge(parts)));
  const head = new THREE.Group();
  head.position.set(0, 1.25, -0.2);
  head.add(vmesh(merge([
    place(paint(box(1.3, 0.55, 1.6), 0x5d6b4c, 0.2), [0, 0, 0]),
    place(paint(box(0.9, 0.2, 0.9), 0x4f5d3a, 0.2), [0, 0.35, -0.2]),
    place(paint(cyl(0.12, 0.15, 2.2, 7), 0x2b2e31, 0.1), [0, 0.05, 1.85], [Math.PI / 2, 0, 0]),
    place(paint(cyl(0.18, 0.18, 0.3, 7), 0x1f2124), [0, 0.05, 2.9], [Math.PI / 2, 0, 0]),
    place(paint(cyl(0.22, 0.22, 0.15, 7), 0x3a3f33), [0.35, 0.5, -0.3]),
  ])));
  root.add(head);
  return { root, head };
}

/** Ground-attack jet, nose along +Z. */
export function jetGeometry(): THREE.BufferGeometry {
  return merge([
    place(paint(box(0.7, 0.6, 4.2), 0x6b7480, 0.15), [0, 0, 0]),
    place(paint(cone(0.35, 1.2, 6), 0x5a626c), [0, 0, 2.7], [Math.PI / 2, 0, 0]),
    place(paint(box(0.45, 0.3, 0.9), 0x2a3a4a), [0, 0.38, 1.0]),
    place(paint(box(5.2, 0.12, 1.4), 0x5a626c, 0.15), [0, -0.05, -0.1]),
    place(paint(box(2.0, 0.1, 0.8), 0x5a626c, 0.15), [0, 0, -1.9]),
    place(paint(box(0.1, 1.0, 0.9), 0x5a626c, 0.15), [0, 0.5, -1.9]),
    place(paint(box(0.5, 0.4, 0.3), 0xff8a3a), [0, 0, -2.2]),
  ]);
}

/** Supply crate with a medical marking. */
export function crateGeometry(): THREE.BufferGeometry {
  return merge([
    place(paint(box(1.1, 0.8, 1.1), 0x6b7a4a, 0.2), [0, 0.4, 0]),
    place(paint(box(0.4, 0.42, 0.06), 0xe8e4d8), [0, 0.45, 0.56]),
    place(paint(box(0.08, 0.25, 0.07), 0xd8302a), [0, 0.45, 0.58]),
    place(paint(box(0.25, 0.08, 0.07), 0xd8302a), [0, 0.45, 0.58]),
  ]);
}
/** Parachute canopy and lines, hanging above whatever it carries. */
export function canopyGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1.4, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const parts = [place(paint(g, 0xe8e4d8, 0.25), [0, 2.6, 0], [0, 0, 0], [1, 0.55, 1])];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(place(paint(box(0.03, 2.1, 0.03), 0x9a958a), [x * 0.6, 1.6, z * 0.6], [-z * 0.35, 0, x * 0.35]));
  }
  return merge(parts);
}

// ---------------------------------------------------------------- scenery

export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** Each builder returns parts (already placed in world space) and colliders. */
export interface Built {
  parts: THREE.BufferGeometry[];
  colliders: Collider[];
}

export function pineTree(x: number, z: number, rng: Rng, out: Built) {
  const s = 0.85 + rng() * 0.6;
  const yaw = rng() * Math.PI;
  const greens = [0x2f5a3a, 0x355f36, 0x2a4e3c, 0x3d6338];
  const g = greens[Math.floor(rng() * greens.length)];
  const p = (geo: THREE.BufferGeometry, y: number) => place(geo, [x, y * s, z], [0, yaw, 0], [s, s, s]);
  out.parts.push(
    p(paint(cyl(0.16, 0.22, 0.9, 5), 0x5a3d2a, 0.2, rng), 0.45),
    p(paint(cone(1.3, 1.7, 6), g, 0.3, rng), 1.5),
    p(paint(cone(1.0, 1.4, 6), g, 0.3, rng), 2.3),
    p(paint(cone(0.65, 1.1, 6), g, 0.3, rng), 3.0),
  );
  out.colliders.push({ x, z, r: 0.45 * s });
}

export function deadTree(x: number, z: number, rng: Rng, out: Built) {
  const s = 0.9 + rng() * 0.5;
  const yaw = rng() * Math.PI * 2;
  const c = 0x4a3a30;
  const p = (geo: THREE.BufferGeometry, pos: V3, rot: V3) => {
    place(geo, pos, rot);
    return place(geo, [x, 0, z], [0, yaw, 0], [s, s, s]);
  };
  out.parts.push(
    p(paint(cyl(0.1, 0.2, 2.6, 5), c, 0.2, rng), [0, 1.3, 0], [0, 0, 0.05]),
    p(paint(cyl(0.04, 0.08, 1.2, 4), c, 0.2, rng), [0.35, 2.0, 0], [0, 0, -0.9]),
    p(paint(cyl(0.03, 0.07, 1.0, 4), c, 0.2, rng), [-0.3, 1.6, 0.1], [0.3, 0, 0.8]),
    p(paint(cyl(0.03, 0.06, 0.8, 4), c, 0.2, rng), [0.05, 2.4, -0.25], [-0.7, 0, 0.1]),
  );
  out.colliders.push({ x, z, r: 0.3 * s });
}

export function rock(x: number, z: number, rng: Rng, out: Built) {
  const r = 0.4 + rng() * 0.9;
  const greys = [0x6b6e70, 0x5d6062, 0x787468];
  const geo = paint(new THREE.DodecahedronGeometry(r, 0), greys[Math.floor(rng() * 3)], 0.3, rng);
  out.parts.push(place(geo, [x, r * 0.3, z], [rng() * 3, rng() * 3, rng() * 3], [1, 0.6, 1]));
  out.colliders.push({ x, z, r: r * 0.9 });
}

export function grassTuft(x: number, z: number, rng: Rng, out: Built) {
  const c = rng() < 0.5 ? 0x4d6b35 : 0x5a7136;
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    out.parts.push(place(paint(cone(0.06, 0.5, 3), c, 0.2, rng), [x + Math.cos(a) * 0.12, 0.22, z + Math.sin(a) * 0.12], [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35]));
  }
}

export function wreckedCar(x: number, z: number, rng: Rng, out: Built) {
  const yaw = rng() * Math.PI * 2;
  const paints = [0x7a2e26, 0x355a7a, 0x8a7a50, 0x4f5d4a, 0x6a6a6a];
  const body = paints[Math.floor(rng() * paints.length)];
  const local: THREE.BufferGeometry[] = [
    place(paint(box(1.8, 0.6, 3.8), body, 0.3, rng), [0, 0.6, 0]),
    place(paint(box(1.6, 0.55, 2.0), body, 0.3, rng), [0, 1.17, -0.25]),
    place(paint(box(1.5, 0.45, 0.05), 0x1b2228), [0, 1.17, 0.76], [-0.35, 0, 0]),
    place(paint(box(1.62, 0.4, 1.7), 0x1b2228), [0, 1.17, -0.25]),
  ];
  for (const [wx, wz] of [[-0.85, 1.2], [0.85, 1.2], [-0.85, -1.2], [0.85, -1.2]] as const) {
    local.push(place(paint(cyl(0.34, 0.34, 0.24, 7), 0x151515), [wx, 0.32, wz], [0, 0, Math.PI / 2]));
  }
  const tilt = (rng() - 0.5) * 0.1;
  for (const g of local) out.parts.push(place(g, [x, 0, z], [0, yaw, tilt]));
  const dx = Math.sin(yaw) * 0.95;
  const dz = Math.cos(yaw) * 0.95;
  out.colliders.push({ x: x + dx, z: z + dz, r: 1.0 }, { x: x - dx, z: z - dz, r: 1.0 });
}

export function barrel(x: number, z: number, rng: Rng, out: Built) {
  const c = rng() < 0.5 ? 0x8a3a22 : 0x3f5a6a;
  out.parts.push(
    place(paint(cyl(0.34, 0.34, 0.95, 8), c, 0.25, rng), [x, 0.48, z]),
    place(paint(cyl(0.36, 0.36, 0.06, 8), 0x2a2a2a), [x, 0.75, z]),
  );
  out.colliders.push({ x, z, r: 0.38 });
}

export function crate(x: number, z: number, rng: Rng, out: Built) {
  const s = 0.7 + rng() * 0.3;
  out.parts.push(place(paint(box(s, s, s), 0x8a6a3e, 0.3, rng), [x, s / 2, z], [0, rng() * 3, 0]));
  out.colliders.push({ x, z, r: s * 0.6 });
}
