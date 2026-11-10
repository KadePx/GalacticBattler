import * as THREE from 'three';
import { paint, place } from '../rotwave/models';

// Low-poly dirt bike and rider. Everything faces +z with the wheels on the ground at y = 0.
// The frame mesh holds the rider; the fork (bars, plate, fender, front wheel) turns around FORK_PIVOT.

type V3 = [number, number, number];
const HALF = Math.PI / 2;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (a: number, b: number, h: number, s: number) => new THREE.CylinderGeometry(a, b, h, s);
const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const dome = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, 4, 0, Math.PI * 2, 0, HALF);

export const FORK_PIVOT: V3 = [0, 1.05, 0.62];
export const REAR_AXLE: V3 = [0, 0.36, -0.72];
/** Front axle relative to the fork pivot. */
export const FRONT_AXLE: V3 = [0, 0.36 - FORK_PIVOT[1], 0.8 - FORK_PIVOT[2]];
/** Where the boost flame comes out: the end of the muffler. */
export const FLAME_POS: V3 = [0.21, 0.94, -0.88];

const UP = new THREE.Vector3(0, 1, 0);
const tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), ta = new THREE.Vector3(), tb = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
/** A part stretched between two points: a box (w x d section) or a round tube. */
function span(geo: (len: number) => THREE.BufferGeometry, a: V3, b: V3) {
  ta.set(...a); tb.set(...b);
  const len = ta.distanceTo(tb);
  const g = geo(len);
  tq.setFromUnitVectors(UP, tb.clone().sub(ta).normalize());
  g.applyMatrix4(tm.compose(ta.add(tb).multiplyScalar(0.5), tq, one));
  return g;
}
const seg = (a: V3, b: V3, w: number, d: number, color: number, jit = 0.06) => paint(span((l) => box(w, l, d), a, b), color, jit);
const tube = (a: V3, b: V3, r: number, color: number, sides = 6, jit = 0.05) => paint(span((l) => cyl(r, r, l, sides), a, b), color, jit);
const mir = (p: V3): V3 => [-p[0], p[1], p[2]];
const both = (make: (s: number) => THREE.BufferGeometry) => [make(1), make(-1)];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ---------------------------------------------------------------- looks

export const HATS = ['Helmet', 'Cap', 'Beanie', 'Cowboy', 'Viking', 'Top hat', 'No hat'];
export const HAIRS = ['Short', 'Long', 'Mohawk', 'Curly', 'Ponytail', 'Bald'];
export const HAIR_COLORS = [0x2a1f1a, 0x6b4126, 0xe8c25a, 0xc8562a, 0xe8e4dc, 0xff6fb5, 0x4aa8ff];
export const SKINS = [0xf2d0b5, 0xe0ac88, 0xc68a5e, 0x8d5a3b, 0x5c3a26];
export interface Look { hat: number; hair: number; hairColor: number; skin: number }
/** The server (functions/api/moto.ts) accepts colour codes below 12 * LOOKS: adding options here needs a matching change there. */
export const LOOKS = HATS.length * HAIRS.length * HAIR_COLORS.length * SKINS.length;

export function packLook(l: Look) {
  return l.hat + HATS.length * (l.hair + HAIRS.length * (l.hairColor + HAIR_COLORS.length * l.skin));
}
export function unpackLook(n: number): Look {
  n = Number.isInteger(n) && n >= 0 && n < LOOKS ? n : 0;
  const hat = n % HATS.length; n = Math.floor(n / HATS.length);
  const hair = n % HAIRS.length; n = Math.floor(n / HAIRS.length);
  const hairColor = n % HAIR_COLORS.length;
  return { hat, hair, hairColor, skin: Math.floor(n / HAIR_COLORS.length) };
}

// ---------------------------------------------------------------- wheel

/** Knobby tyre, spoked rim and brake disc, spinning around x, centred on the axle. */
export function wheelGeo() {
  const parts = [
    paint(place(new THREE.TorusGeometry(0.29, 0.075, 5, 16), [0, 0, 0], [0, HALF, 0]), 0x1d1b22, 0.12),
    paint(place(new THREE.TorusGeometry(0.225, 0.022, 4, 16), [0, 0, 0], [0, HALF, 0]), 0xb8b8c4, 0.05),
    paint(place(cyl(0.06, 0.06, 0.2, 6), [0, 0, 0], [0, 0, HALF]), 0x8c8c98, 0.05),
    paint(place(cyl(0.12, 0.12, 0.02, 8), [0.08, 0, 0], [0, 0, HALF]), 0x9a9aa6, 0.05),
  ];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    parts.push(paint(place(box(0.17, 0.05, 0.07), [0, Math.cos(a) * 0.36, Math.sin(a) * 0.36], [a, 0, 0]), 0x26232b, 0.15));
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, x = k % 2 ? 0.035 : -0.035;
    parts.push(tube([x, Math.cos(a) * 0.05, Math.sin(a) * 0.05], [x * 0.6, Math.cos(a) * 0.22, Math.sin(a) * 0.22], 0.008, 0xd8d8e0, 3, 0));
  }
  return parts;
}

// ---------------------------------------------------------------- bike

const DARK = 0x2c2a31, FRAME = 0x3c3a44, SILVER = 0xc9c9d3, WHITE = 0xf2efe6, SEAT = 0x1c1a20;

function bikeParts(color: number) {
  return [
    // engine and cylinder with cooling fins
    paint(place(box(0.26, 0.26, 0.34), [0, 0.5, 0.02]), DARK, 0.08),
    paint(place(box(0.2, 0.24, 0.2), [0, 0.7, 0.16], [-0.35, 0, 0]), 0x4a4852, 0.08),
    ...[0.64, 0.7, 0.76].map((y) => paint(place(box(0.3, 0.022, 0.24), [0, y, 0.15 + (y - 0.7) * 0.4], [-0.35, 0, 0]), 0x6e6c78, 0.05)),
    // frame
    tube([0, 1.0, 0.56], [0, 0.42, 0.3], 0.04, FRAME),
    tube([0, 0.42, 0.3], [0, 0.37, -0.12], 0.035, FRAME),
    ...both((s) => tube([0.07 * s, 1.02, 0.52], [0.1 * s, 0.93, -0.2], 0.03, FRAME)),
    ...both((s) => tube([0.1 * s, 0.6, -0.15], [0.11 * s, 0.98, -0.6], 0.025, FRAME)),
    // swingarm, shock, chain, pegs
    ...both((s) => seg([0.13 * s, 0.45, -0.1], [0.13 * s, 0.36, -0.72], 0.05, 0.08, SILVER)),
    tube([0, 0.95, -0.14], [0, 0.5, -0.33], 0.05, 0xffc83c, 6, 0.12),
    tube([0, 0.97, -0.13], [0, 0.48, -0.34], 0.025, SILVER),
    seg([-0.15, 0.45, 0.0], [-0.15, 0.36, -0.72], 0.02, 0.05, 0x55525e, 0.1),
    paint(place(cyl(0.11, 0.11, 0.02, 8), [-0.15, 0.36, -0.72], [0, 0, HALF]), 0x77747f),
    paint(place(box(0.56, 0.035, 0.06), [0, 0.5, -0.06]), 0x3a3842),
    // bodywork
    paint(place(box(0.36, 0.2, 0.46), [0, 1.04, 0.28], [-0.12, 0, 0]), color, 0.08),
    paint(place(cyl(0.035, 0.035, 0.03, 6), [0, 1.15, 0.3]), SILVER),
    ...both((s) => paint(place(box(0.05, 0.32, 0.4), [0.2 * s, 0.9, 0.38], [-0.35, 0.18 * s, 0]), color, 0.08)),
    ...both((s) => paint(place(box(0.055, 0.07, 0.3), [0.205 * s, 0.86, 0.39], [-0.35, 0.18 * s, 0]), WHITE, 0.03)),
    paint(place(box(0.27, 0.09, 0.82), [0, 1.08, -0.22], [0.05, 0, 0]), SEAT, 0.06),
    ...both((s) => paint(place(box(0.04, 0.22, 0.34), [0.16 * s, 0.9, -0.52], [0.25, 0, 0]), WHITE, 0.03)),
    paint(place(box(0.26, 0.035, 0.6), [0, 1.03, -0.9], [0.28, 0, 0]), color, 0.08),
    // exhaust: header from the cylinder round the side to a high muffler
    tube([0.06, 0.68, 0.3], [0.17, 0.48, 0.14], 0.035, 0x9a9aa6),
    tube([0.17, 0.48, 0.14], [0.2, 0.66, -0.3], 0.035, 0x9a9aa6),
    tube([0.2, 0.7, -0.34], [0.21, 0.92, -0.84], 0.075, SILVER, 8),
    paint(place(cyl(0.05, 0.05, 0.04, 8), [0.21, 0.93, -0.86], [1.15, 0, 0]), 0x18161c),
  ];
}

/** Fork, triple clamps, bars, number plate and front fender, around the steering pivot. */
export function forkParts(color: number) {
  const ax = FRONT_AXLE;
  return [
    ...both((s) => tube([0.12 * s, 0.07, -0.015], [0.12 * s, -0.36, 0.09], 0.04, 0xd8b25a)),
    ...both((s) => tube([0.12 * s, -0.33, 0.085], [0.12 * s, ax[1], ax[2]], 0.05, 0x26242c)),
    paint(place(box(0.34, 0.05, 0.12), [0, 0.05, 0]), 0x4a4852, 0.05),
    paint(place(box(0.34, 0.05, 0.12), [0, -0.12, 0.04]), 0x4a4852, 0.05),
    tube([-0.36, 0.17, -0.1], [0.36, 0.17, -0.1], 0.02, 0x2a2a30),
    ...both((s) => tube([0.29 * s, 0.17, -0.1], [0.4 * s, 0.17, -0.1], 0.032, 0x111015)),
    ...both((s) => tube([0.07 * s, 0.07, -0.03], [0.07 * s, 0.17, -0.1], 0.02, 0x2a2a30)),
    paint(place(box(0.16, 0.06, 0.06), [0, 0.18, -0.1]), color, 0.06),
    paint(place(box(0.3, 0.27, 0.035), [0, -0.03, 0.13], [-0.35, 0, 0]), WHITE, 0.03),
    paint(place(box(0.3, 0.06, 0.04), [0, 0.09, 0.09], [-0.35, 0, 0]), color, 0.05),
    paint(place(box(0.15, 0.09, 0.03), [0, -0.06, 0.155], [-0.35, 0, 0]), 0xfff6c8),
    paint(place(box(0.2, 0.035, 0.62), [0, -0.28, 0.2], [-0.15, 0, 0]), color, 0.08),
  ];
}

// ---------------------------------------------------------------- rider

const HEAD: V3 = [0, 1.84, 0.16];
const at = (o: V3) => add(HEAD, o);

function hairParts(l: Look, helmet: boolean, hatOn: boolean) {
  const c = HAIR_COLORS[l.hairColor] ?? HAIR_COLORS[0];
  const top = () => paint(place(dome(0.164), at([0, 0.02, -0.01]), [0, 0, 0], [1, 0.9, 1.06]), c, 0.08);
  const out: THREE.BufferGeometry[] = [];
  switch (HAIRS[l.hair]) {
    case 'Short':
      if (!helmet) out.push(paint(place(box(0.27, 0.12, 0.06), at([0, -0.01, -0.13])), c, 0.08));
      if (!hatOn) out.push(top());
      break;
    case 'Long':
      out.push(paint(place(box(0.3, 0.34, 0.08), at([0, helmet ? -0.2 : -0.12, -0.15])), c, 0.1));
      if (!helmet) out.push(...both((s) => paint(place(box(0.04, 0.26, 0.17), at([0.155 * s, -0.06, -0.04])), c, 0.1)));
      if (!hatOn) out.push(top());
      break;
    case 'Mohawk':
      if (!hatOn) {
        out.push(paint(place(box(0.06, 0.1, 0.3), at([0, 0.16, -0.02])), c, 0.08));
        for (const z of [-0.12, -0.02, 0.08]) out.push(paint(place(new THREE.ConeGeometry(0.035, 0.12, 4), at([0, 0.25, z])), c, 0.1));
      }
      break;
    case 'Curly':
      // a cloud of little curls rather than one smooth ball
      if (!hatOn) {
        out.push(paint(place(ico(0.17, 1), at([0, 0.05, -0.03])), c, 0.14));
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          out.push(paint(place(ico(0.085, 0), at([Math.sin(a) * 0.15, 0.1 + Math.cos(a * 2) * 0.04, -0.03 + Math.cos(a) * 0.13])), c, 0.18));
        }
        out.push(paint(place(ico(0.1, 0), at([0, 0.2, -0.04])), c, 0.18));
      }
      else if (!helmet) out.push(...[-1, 0, 1].map((s) => paint(place(ico(0.08, 0), at([0.1 * s, -0.04, -0.13])), c, 0.14)));
      break;
    case 'Ponytail': {
      const base = helmet ? at([0, -0.08, -0.2]) : at([0, 0.02, -0.15]);
      out.push(tube(base, at([0, -0.27, -0.31]), 0.05, c, 6, 0.1));
      out.push(paint(place(cyl(0.056, 0.056, 0.04, 6), add(base, [0, -0.04, -0.02]), [0.6, 0, 0]), 0xff5a3c));
      if (!hatOn) out.push(top());
      break;
    }
  }
  return out;
}

function hatParts(l: Look, color: number) {
  switch (HATS[l.hat]) {
    case 'Helmet': return [
      paint(place(ico(0.22, 1), at([0, 0.02, 0]), [0, 0, 0], [1, 1, 1.12]), color, 0.1),
      paint(place(box(0.2, 0.1, 0.14), at([0, -0.12, 0.17]), [-0.3, 0, 0]), color, 0.08),
      paint(place(box(0.27, 0.03, 0.2), at([0, 0.16, 0.2]), [-0.3, 0, 0]), WHITE, 0.04),
      paint(place(cyl(0.222, 0.222, 0.05, 12), at([0, 0.02, 0]), [0, 0, 0], [1, 1, 1.12]), 0x1d1b22),
      paint(place(box(0.29, 0.11, 0.05), at([0, 0.02, 0.215])), 0x1d1b22),
      paint(place(box(0.24, 0.075, 0.03), at([0, 0.02, 0.24])), 0xffa63c, 0.04),
    ];
    case 'Cap': return [
      paint(place(dome(0.168), at([0, 0.03, 0])), color, 0.08),
      paint(place(box(0.22, 0.025, 0.17), at([0, 0.05, 0.2]), [-0.1, 0, 0]), color, 0.05),
      paint(place(cyl(0.025, 0.025, 0.02, 6), at([0, 0.2, 0])), WHITE),
    ];
    case 'Beanie': return [
      paint(place(dome(0.172), at([0, 0.03, 0]), [0, 0, 0], [1, 1.15, 1]), color, 0.08),
      paint(place(cyl(0.175, 0.175, 0.07, 8), at([0, 0.05, 0])), 0x2a2733, 0.06),
      paint(place(ico(0.055, 0), at([0, 0.24, 0])), WHITE, 0.08),
    ];
    case 'Cowboy': return [
      paint(place(cyl(0.3, 0.3, 0.025, 10), at([0, 0.08, 0])), 0x8a5a32, 0.06),
      paint(place(cyl(0.13, 0.155, 0.17, 8), at([0, 0.17, 0])), 0x8a5a32, 0.06),
      paint(place(cyl(0.157, 0.157, 0.04, 8), at([0, 0.11, 0])), 0x3a2416),
    ];
    case 'Viking': return [
      paint(place(dome(0.176), at([0, 0.02, 0])), 0x9a9aa6, 0.08),
      paint(place(cyl(0.18, 0.18, 0.045, 8), at([0, 0.035, 0])), 0x6e6e78, 0.05),
      ...both((s) => paint(place(new THREE.ConeGeometry(0.06, 0.32, 5), at([0.24 * s, 0.17, 0]), [0, 0, -0.8 * s]), 0xf1e6c8, 0.06)),
      paint(place(box(0.03, 0.11, 0.02), at([0, -0.02, 0.178])), 0x6e6e78),
    ];
    case 'Top hat': return [
      paint(place(cyl(0.22, 0.22, 0.02, 10), at([0, 0.1, 0])), 0x1c1a20, 0.05),
      paint(place(cyl(0.13, 0.13, 0.27, 10), at([0, 0.24, 0])), 0x1c1a20, 0.05),
      paint(place(cyl(0.134, 0.134, 0.05, 10), at([0, 0.14, 0])), color, 0.04),
    ];
  }
  return [];
}

function riderParts(color: number, l: Look) {
  const pants = 0x2f2a3a, glove = 0x1d1b22, boot = 0xe9e6df, skin = SKINS[l.skin] ?? SKINS[0];
  const helmet = HATS[l.hat] === 'Helmet', hatOn = HATS[l.hat] !== 'No hat';
  const grip = (s: number): V3 => [0.33 * s, 1.21, 0.52];
  return [
    // legs: hips on the seat, knees gripping the tank, boots on the pegs
    paint(place(box(0.36, 0.2, 0.3), [0, 1.16, -0.22]), pants, 0.06),
    ...both((s) => seg([0.13 * s, 1.16, -0.18], [0.21 * s, 1.08, 0.2], 0.15, 0.16, pants)),
    ...both((s) => paint(place(box(0.12, 0.13, 0.07), [0.22 * s, 1.07, 0.25]), 0x4a4652, 0.05)),
    ...both((s) => seg([0.21 * s, 1.05, 0.2], [0.23 * s, 0.78, 0.08], 0.13, 0.14, pants)),
    ...both((s) => seg([0.23 * s, 0.84, 0.1], [0.24 * s, 0.56, -0.03], 0.15, 0.17, boot, 0.04)),
    ...both((s) => paint(place(box(0.13, 0.08, 0.27), [0.24 * s, 0.52, 0.01]), boot, 0.04)),
    ...both((s) => paint(place(box(0.14, 0.03, 0.28), [0.24 * s, 0.475, 0.01]), 0x18161c)),
    // jersey: torso, shoulders, number on the back, long sleeves
    seg([0, 1.17, -0.2], [0, 1.62, 0.06], 0.4, 0.26, color, 0.08),
    paint(place(box(0.5, 0.15, 0.27), [0, 1.57, 0.05], [0.53, 0, 0]), color, 0.08),
    paint(place(box(0.42, 0.06, 0.265), [0, 1.24, -0.16], [0.53, 0, 0]), WHITE, 0.03),
    paint(place(box(0.22, 0.2, 0.02), [0, 1.48, -0.19], [0.53, 0, 0]), WHITE, 0.03),
    ...both((s) => seg([0.25 * s, 1.58, 0.06], [0.32 * s, 1.38, 0.3], 0.12, 0.12, color)),
    ...both((s) => seg([0.32 * s, 1.38, 0.3], grip(s), 0.1, 0.1, color)),
    ...both((s) => paint(place(box(0.09, 0.09, 0.11), add(grip(s), [0, -0.01, 0.02])), glove, 0.05)),
    // neck and head
    seg([0, 1.6, 0.07], [0, 1.74, 0.13], 0.1, 0.1, skin, 0.03),
    ...(helmet ? [] : [
      paint(place(ico(0.155, 1), HEAD, [0, 0, 0], [1, 1.08, 1]), skin, 0.05),
      ...both((s) => paint(place(box(0.035, 0.04, 0.02), at([0.055 * s, 0.01, 0.148])), 0x18141c)),
      paint(place(box(0.03, 0.05, 0.03), at([0, -0.03, 0.16])), skin, 0.1),
      ...both((s) => paint(place(box(0.03, 0.06, 0.05), at([0.157 * s, -0.01, 0])), skin, 0.05)),
    ]),
    ...hairParts(l, helmet, hatOn),
    ...hatParts(l, color),
  ];
}

/** Frame, bodywork and rider: the part of the bike that doesn't steer or spin. */
export function frameParts(color: number, look: Look) {
  return [...bikeParts(color), ...riderParts(color, look)];
}
