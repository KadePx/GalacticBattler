import * as THREE from 'three';
import { merge, paint, place } from '../rotwave/models';
import {
  CS, DIRS, DI, DJ, RAMP_H, T, WALL_H, type Maze,
  cellAt, cellCenter, collide, dayKey, genMaze, hash, isOpen, mazeNum, rng, shiftDay,
} from './maze';
import { type Bike, type Ev, type Input, DT, SAMPLE_EVERY, newBike, noInput, speedOf, step, wrap } from './sim';
import { type Sample, MAX_SAMPLES, SAMPLE_MS, decode, encode, stepsToMs } from './path';

// ---------------------------------------------------------------- basics

const PALETTE = [0xff5a3c, 0x3ca0ff, 0xffd23c, 0x4fd17a, 0xc65cff, 0xff7ac8, 0x2ee6d6, 0xff9f1c, 0x8f9bff, 0xf0f0f0, 0x7a4cff, 0xa4e83c];
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const LAUNCH = '2026-11-07'; // maze #1

export function fmt(ms: number, dec = 2) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(dec).padStart(dec + 3, '0')}`;
}

const cleanName = (raw: string) => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 3 && s.length <= 14 ? s : null;
};

// ---------------------------------------------------------------- save

interface Save { id: string; name: string; color: number; ghosts: boolean; muted: boolean; best: Record<string, { ms: number; path: string }> }
const SAVE_KEY = 'motomaze.v1';
function loadSave(): Save {
  let s: Partial<Save> = {};
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') ?? {}; } catch { /* private mode */ }
  const id = typeof s.id === 'string' && /^[a-z0-9]{8,40}$/.test(s.id)
    ? s.id
    : Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  return {
    id,
    name: typeof s.name === 'string' ? s.name : '',
    color: Number.isInteger(s.color) ? (s.color as number) % PALETTE.length : Math.floor(Math.random() * PALETTE.length),
    ghosts: s.ghosts !== false,
    muted: !!s.muted,
    best: s.best && typeof s.best === 'object' ? s.best : {},
  };
}
const save = loadSave();
function persist() {
  const keep = [dayKey(), dayKey(Date.now() - 864e5)];
  for (const k of Object.keys(save.best)) if (!keep.includes(k)) delete save.best[k];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ }
}
persist();

// ---------------------------------------------------------------- renderer

const host = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0xf4ae86;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 50, 210);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

{
  const g = new THREE.SphereGeometry(700, 18, 12);
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x40357f), mid = new THREE.Color(0xd9799a), low = new THREE.Color(FOG), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 700;
    if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.6));
    else c.copy(low).lerp(mid, Math.max(0, (y + 0.05) / 0.2));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.userData.sky = sky;
}

scene.add(new THREE.HemisphereLight(0xffe4cc, 0x5a3a4e, 1.25));
const sun = new THREE.DirectionalLight(0xffdcb0, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(38, 70, 22);
let shadowSpan = 0;
function setShadow(focus: THREE.Vector3, span: number) {
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(SUN_OFF);
  if (span !== shadowSpan) {
    shadowSpan = span;
    const c = sun.shadow.camera;
    c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
  }
}

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
const GHOST_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, transparent: true, opacity: 0.45, depthWrite: false });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- bike models

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (a: number, b: number, h: number, s: number) => new THREE.CylinderGeometry(a, b, h, s);
const HALF = Math.PI / 2;
const FORK_PIVOT: [number, number, number] = [0, 1.05, 0.62];

function wheelGeo() {
  return merge([
    paint(place(cyl(0.36, 0.36, 0.2, 10), [0, 0, 0], [0, 0, HALF]), 0x1d1b22, 0.15),
    paint(place(cyl(0.17, 0.17, 0.23, 6), [0, 0, 0], [0, 0, HALF]), 0xb8b8c4, 0.1),
  ]);
}

/** Frame and rider, facing +z, wheels on the ground at y = 0. */
function frameParts(color: number) {
  const suit = 0x2b2536, metal = 0x55525e;
  return [
    paint(place(box(0.12, 0.1, 0.72), [0, 0.42, -0.4], [0.15, 0, 0]), metal),
    paint(place(box(0.34, 0.32, 0.45), [0, 0.52, 0]), 0x3d3a45, 0.1),
    paint(place(box(0.3, 0.24, 0.9), [0, 0.78, 0], [0.08, 0, 0]), color, 0.08),
    paint(place(box(0.44, 0.3, 0.52), [0, 0.98, 0.22], [-0.12, 0, 0]), color, 0.08),
    paint(place(box(0.32, 0.12, 0.55), [0, 0.98, -0.3]), 0x18161c),
    paint(place(box(0.26, 0.16, 0.38), [0, 1.04, -0.66], [-0.35, 0, 0]), color, 0.08),
    paint(place(cyl(0.07, 0.09, 0.62, 6), [0.21, 0.5, -0.5], [HALF - 0.15, 0, 0]), 0xd0d0d8),
    // rider
    paint(place(box(0.16, 0.5, 0.17), [0.17, 0.92, 0.08], [1.25, 0, 0]), suit),
    paint(place(box(0.16, 0.5, 0.17), [-0.17, 0.92, 0.08], [1.25, 0, 0]), suit),
    paint(place(box(0.15, 0.48, 0.16), [0.21, 0.62, 0.32], [-0.35, 0, 0]), suit),
    paint(place(box(0.15, 0.48, 0.16), [-0.21, 0.62, 0.32], [-0.35, 0, 0]), suit),
    paint(place(box(0.46, 0.62, 0.3), [0, 1.38, -0.04], [0.62, 0, 0]), color, 0.1),
    paint(place(box(0.2, 0.12, 0.31), [0, 1.42, -0.07], [0.62, 0, 0]), 0xffffff),
    paint(place(box(0.12, 0.52, 0.12), [0.27, 1.37, 0.3], [1.15, 0, 0]), suit),
    paint(place(box(0.12, 0.52, 0.12), [-0.27, 1.37, 0.3], [1.15, 0, 0]), suit),
    paint(place(new THREE.IcosahedronGeometry(0.25, 1), [0, 1.8, 0.2]), color, 0.12),
    paint(place(box(0.32, 0.12, 0.14), [0, 1.8, 0.39], [0.2, 0, 0]), 0x101018),
  ];
}

/** Fork, bars and headlight, around the steering pivot. */
function forkParts(color: number) {
  return [
    paint(place(box(0.07, 0.76, 0.07), [0.13, -0.345, 0.09], [-0.26, 0, 0]), 0xc8c8d0),
    paint(place(box(0.07, 0.76, 0.07), [-0.13, -0.345, 0.09], [-0.26, 0, 0]), 0xc8c8d0),
    paint(place(box(0.72, 0.06, 0.06), [0, 0.12, -0.08]), 0x22222a),
    paint(place(box(0.36, 0.3, 0.16), [0, 0.02, 0.08], [-0.3, 0, 0]), color, 0.08),
    paint(place(box(0.22, 0.16, 0.06), [0, 0.0, 0.17], [-0.3, 0, 0]), 0xfff6c8),
  ];
}

const WHEEL_GEO = wheelGeo();
const FLAME_GEO = new THREE.ConeGeometry(0.13, 0.9, 6).rotateX(-HALF).translate(0, 0, -0.45);
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

interface Rig { root: THREE.Group; pitch: THREE.Group; roll: THREE.Group; fork?: THREE.Group; wf?: THREE.Mesh; wr?: THREE.Mesh; flame: THREE.Mesh; label?: THREE.Sprite; body: THREE.Mesh }

function makeRig(color: number, ghost: boolean, name?: string): Rig {
  const root = new THREE.Group(), pitch = new THREE.Group(), roll = new THREE.Group();
  root.add(pitch);
  pitch.add(roll);
  let body: THREE.Mesh, fork: THREE.Group | undefined, wf: THREE.Mesh | undefined, wr: THREE.Mesh | undefined;
  if (ghost) {
    // One draw call per ghost: everything merged.
    const fp = forkParts(color).map((g) => g.translate(...FORK_PIVOT));
    const wa = WHEEL_GEO.clone().translate(0, 0.36, -0.72), wb = WHEEL_GEO.clone().translate(0, 0.36, 0.8);
    body = new THREE.Mesh(merge([...frameParts(color), ...fp, wa, wb]), GHOST_MAT);
    roll.add(body);
  } else {
    body = new THREE.Mesh(merge(frameParts(color)), MAT);
    fork = new THREE.Group();
    fork.position.set(...FORK_PIVOT);
    fork.add(new THREE.Mesh(merge(forkParts(color)), MAT));
    wf = new THREE.Mesh(WHEEL_GEO, MAT);
    wf.position.set(0, 0.36 - FORK_PIVOT[1], 0.8 - FORK_PIVOT[2]);
    fork.add(wf);
    wr = new THREE.Mesh(WHEEL_GEO, MAT);
    wr.position.set(0, 0.36, -0.72);
    roll.add(body, fork, wr);
    for (const o of [body, wf, wr, fork.children[0] as THREE.Mesh]) { o.castShadow = true; }
  }
  body.castShadow = true;
  const flame = new THREE.Mesh(FLAME_GEO, FLAME_MAT);
  flame.position.set(0.21, 0.47, -0.8);
  flame.visible = false;
  roll.add(flame);
  let label: THREE.Sprite | undefined;
  if (name) {
    label = makeLabel(name, color);
    root.add(label);
  }
  return { root, pitch, roll, fork, wf, wr, flame, label, body };
}

function makeLabel(text: string, color: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 34px Rubik, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(20,12,26,0.72)';
  g.beginPath();
  g.roundRect(128 - w / 2, 8, w, 48, 14);
  g.fill();
  g.fillStyle = css(color);
  g.fillRect(128 - w / 2 + 10, 26, 10, 12);
  g.fillStyle = '#fff4e8';
  g.fillText(text, 136, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  s.scale.set(4, 1, 1);
  s.position.y = 2.9;
  s.renderOrder = 5;
  return s;
}

function disposeRig(r: Rig) {
  r.root.removeFromParent();
  if (r.body.material === GHOST_MAT || r.body.material === MAT) r.body.geometry.dispose();
  if (r.fork) ((r.fork.children[0] as THREE.Mesh).geometry).dispose();
  if (r.label) { (r.label.material as THREE.SpriteMaterial).map?.dispose(); r.label.material.dispose(); }
}

/** Pose a rig from a state. tumble > 0 spins it like a wipeout. */
function poseRig(r: Rig, x: number, y: number, z: number, h: number, pitch: number, lean: number, crashed: boolean, tumble: number) {
  r.root.position.set(x, y + (crashed ? 0.45 : 0), z);
  r.root.rotation.y = h;
  r.pitch.rotation.x = -pitch - (crashed ? tumble * 0.7 : 0);
  r.roll.rotation.z = lean + (crashed ? tumble : 0);
}

// ---------------------------------------------------------------- world

const WALL_COLORS = [0xff7462, 0x3fc1c9, 0xffbf47, 0x9d78ff];
interface Crate { mesh: THREE.Mesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; wx: number; wz: number; s: number; hx: number; hz: number; moving: boolean }
let world: THREE.Group | null = null;
let crates: Crate[] = [];
let boostTex: THREE.CanvasTexture | null = null;
let finishBeam: THREE.Mesh | null = null;
let finishRing: THREE.Mesh | null = null;
const CRATE_GEO = paint(box(1, 1, 1), 0xc98b4b, 0.25);

function checkerTex(n: number, a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const s = 128 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function makeBoostTex() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d3b45';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#3ef0ff';
  for (let k = 0; k < 2; k++) {
    const y = k * 64;
    g.beginPath();
    g.moveTo(6, y + 40); g.lineTo(32, y + 14); g.lineTo(58, y + 40); g.lineTo(58, y + 54); g.lineTo(32, y + 28); g.lineTo(6, y + 54);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 2);
  return t;
}

function buildWorld(m: Maze) {
  if (world) {
    world.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== CRATE_GEO) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && mat !== MAT) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
    });
    scene.remove(world);
  }
  world = new THREE.Group();
  scene.add(world);
  const r = rng(hash('scenery/' + m.day));
  const W = m.w * CS, H = m.h * CS, cx = W / 2, cz = H / 2;
  const span = Math.max(W, H);

  // Desert floor around the maze, rising into low hills further out.
  {
    const g = new THREE.PlaneGeometry(1100, 1100, 60, 60).rotateX(-HALF).translate(cx, -0.15, cz);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - cx, dz = p.getZ(i) - cz;
      const d = Math.max(Math.abs(dx) - W / 2, Math.abs(dz) - H / 2);
      if (d > 14) p.setY(i, -0.15 + Math.min(40, (d - 14) * 0.12) * (0.4 + r()) + Math.sin(dx * 0.03) * Math.cos(dz * 0.025) * Math.min(1, d / 60) * 9);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(paint(g, 0xe0a46c, 0.12, r), MAT);
    mesh.receiveShadow = true;
    world.add(mesh);
  }
  // Maze floor and walls.
  {
    const parts: THREE.BufferGeometry[] = [];
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      parts.push(paint(place(box(CS, 0.3, CS), [(i + 0.5) * CS, -0.15, (j + 0.5) * CS]), (i + j) % 2 ? 0x4b4656 : 0x524c5e, 0.05, r));
    }
    const floor = new THREE.Mesh(merge(parts), MAT);
    floor.receiveShadow = true;
    world.add(floor);

    const wallParts: THREE.BufferGeometry[] = [];
    const posts = new Set<number>();
    const region = (i: number, j: number) => WALL_COLORS[(i < m.w / 2 ? 0 : 1) + (j < m.h / 2 ? 0 : 2)];
    const addWall = (i: number, j: number, d: number) => {
      const col = region(i, j);
      const horiz = d === 0 || d === 2;
      const vx = d === 1 ? i + 1 : i, vz = d === 2 ? j + 1 : j;
      const len = CS - 2 * T - 0.6;
      const x = horiz ? (i + 0.5) * CS : vx * CS, z = horiz ? vz * CS : (j + 0.5) * CS;
      const sx = horiz ? len : 2 * T, sz = horiz ? 2 * T : len;
      wallParts.push(paint(place(box(sx, WALL_H, sz), [x, WALL_H / 2, z]), col, 0.1, r));
      wallParts.push(paint(place(box(sx + 0.12, 0.2, sz + 0.12), [x, WALL_H + 0.05, z]), new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.45).getHex(), 0.05, r));
      posts.add(vz * (m.w + 1) + vx);
      posts.add(horiz ? vz * (m.w + 1) + vx + 1 : (vz + 1) * (m.w + 1) + vx);
    };
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      const wl = m.walls[j * m.w + i];
      if (wl & DIRS[0]) addWall(i, j, 0);
      if (wl & DIRS[3]) addWall(i, j, 3);
      if (i === m.w - 1 && wl & DIRS[1]) addWall(i, j, 1);
      if (j === m.h - 1 && wl & DIRS[2]) addWall(i, j, 2);
    }
    for (const p of posts) {
      const vx = p % (m.w + 1), vz = Math.floor(p / (m.w + 1));
      wallParts.push(paint(place(box(1.3, WALL_H + 0.45, 1.3), [vx * CS, (WALL_H + 0.45) / 2, vz * CS]), 0x3a3146, 0.12, r));
    }
    const walls = new THREE.Mesh(merge(wallParts), MAT);
    walls.castShadow = true;
    walls.receiveShadow = true;
    world.add(walls);
  }
  // Ramps: humps you can launch off either way.
  if (m.ramps.length) {
    const shape = new THREE.Shape();
    shape.moveTo(-5, 0); shape.lineTo(-1.5, RAMP_H); shape.lineTo(1.5, RAMP_H); shape.lineTo(5, 0); shape.closePath();
    const depth = CS - 2 * T - 0.1;
    const parts = m.ramps.map((f) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
      const [x, z] = cellCenter(m, f.c);
      return paint(place(g, [x, 0, z], [0, f.axis === 0 ? 0 : -HALF, 0]), 0xffa630, 0.14, r);
    });
    for (const f of m.ramps) {
      const [x, z] = cellCenter(m, f.c);
      for (const s of [-1, 1]) {
        const stripe = box(0.25, 0.04, depth - 0.4);
        parts.push(paint(place(stripe, f.axis === 0 ? [x + s * 1.5, RAMP_H + 0.02, z] : [x, RAMP_H + 0.02, z + s * 1.5], [0, f.axis === 0 ? 0 : HALF, 0]), 0x2a1d10));
      }
    }
    const mesh = new THREE.Mesh(merge(parts), MAT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
  }
  // Boost pads.
  boostTex = makeBoostTex();
  for (const f of m.boosts) {
    const [x, z] = cellCenter(m, f.c);
    const mat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.95, fog: true });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), mat);
    pad.rotation.set(-HALF, 0, f.axis === 0 ? HALF : 0);
    pad.position.set(x, 0.03, z);
    world.add(pad);
  }
  // Start and finish.
  {
    const [fx, fz] = cellCenter(m, m.finish);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(CS - 1.2, CS - 1.2), new THREE.MeshBasicMaterial({ map: checkerTex(8, '#1a1420', '#f8f0e0') }));
    fl.rotation.x = -HALF;
    fl.position.set(fx, 0.02, fz);
    world.add(fl);
    finishBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 160, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    finishBeam.position.set(fx, 80, fz);
    world.add(finishBeam);
    finishRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    finishRing.rotation.x = HALF;
    finishRing.position.set(fx, 0.4, fz);
    world.add(finishRing);

    const [sx, sz] = cellCenter(m, m.start);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(CS - 1.2, 1.4), new THREE.MeshBasicMaterial({ map: checkerTex(8, '#1a1420', '#f8f0e0') }));
    st.material.map!.repeat.set(1, 0.18);
    st.rotation.set(-HALF, 0, m.startH);
    st.position.set(sx + Math.sin(m.startH) * 1.5, 0.02, sz + Math.cos(m.startH) * 1.5);
    world.add(st);
  }
  // Scenery: mesas, rocks and cacti outside the walls.
  {
    const parts: THREE.BufferGeometry[] = [];
    const rock = [0xc8643c, 0xb4553a, 0xd9814e, 0x9e4a3a];
    for (let k = 0; k < 140; k++) {
      const a = r() * Math.PI * 2, d = span * 0.5 + 16 + r() * 260;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * (H / W);
      if (Math.abs(x - cx) < W / 2 + 10 && Math.abs(z - cz) < H / 2 + 10) continue;
      const t = r();
      if (t < 0.25 && d > span * 0.5 + 60) {
        const rad = 10 + r() * 22, hh = 14 + r() * 30;
        parts.push(paint(place(cyl(rad * 0.8, rad, hh, 7), [x, hh / 2 - 1, z], [0, r() * 3, 0]), rock[k % 4], 0.12, r));
        parts.push(paint(place(cyl(rad * 0.82, rad * 0.8, 2, 7), [x, hh, z], [0, r() * 3, 0]), 0xe8a070, 0.1, r));
      } else if (t < 0.6) {
        const s = 1 + r() * 3.5;
        parts.push(paint(place(new THREE.DodecahedronGeometry(s, 0), [x, s * 0.4, z], [r() * 3, r() * 3, r() * 3], [1, 0.7, 1]), rock[(k + 1) % 4], 0.15, r));
      } else {
        const hh = 2 + r() * 3;
        parts.push(paint(place(box(0.7, hh, 0.7), [x, hh / 2, z]), 0x5f9a4a, 0.15, r));
        const side = r() < 0.5 ? 1 : -1;
        parts.push(paint(place(box(0.5, 1.4, 0.5), [x + side * 0.75, hh * 0.6, z]), 0x5f9a4a, 0.15, r));
        parts.push(paint(place(box(0.8, 0.4, 0.5), [x + side * 0.45, hh * 0.45, z]), 0x5f9a4a, 0.15, r));
      }
    }
    const mesh = new THREE.Mesh(merge(parts), MAT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
  }
  // Crates.
  crates = m.crates.map((s) => {
    const mesh = new THREE.Mesh(CRATE_GEO, MAT);
    mesh.scale.setScalar(s.s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world!.add(mesh);
    return { mesh, x: s.x, y: s.s / 2, z: s.z, vx: 0, vy: 0, vz: 0, wx: 0, wz: 0, s: s.s, hx: s.x, hz: s.z, moving: false };
  });
  resetCrates();
}

function resetCrates() {
  for (const c of crates) {
    Object.assign(c, { x: c.hx, z: c.hz, y: c.s / 2, vx: 0, vy: 0, vz: 0, wx: 0, wz: 0, moving: false });
    c.mesh.position.set(c.x, c.y, c.z);
    c.mesh.rotation.set(0, (c.hx * 13.7) % 3, 0);
  }
}

interface Pusher { x: number; y: number; z: number; vx: number; vz: number; player?: boolean }
function updateCrates(dt: number, riders: Pusher[]) {
  for (const c of crates) {
    for (const p of riders) {
      const dx = c.x - p.x, dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.7 + c.s * 0.6 || p.y > c.y + c.s) continue;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 2) continue;
      const nx = dx / (d || 1), nz = dz / (d || 1);
      c.vx = p.vx * 0.85 + nx * sp * 0.35 + (Math.random() - 0.5) * 3;
      c.vz = p.vz * 0.85 + nz * sp * 0.35 + (Math.random() - 0.5) * 3;
      c.vy = 3 + sp * 0.22 + Math.random() * 2;
      c.wx = (Math.random() - 0.5) * 14;
      c.wz = (Math.random() - 0.5) * 14;
      c.moving = true;
      if (p.player) {
        bike.vx *= 0.94; bike.vz *= 0.94;
        sfx.thud(sp);
        burst(c.x, c.y + 0.3, c.z, 10, 0xd8a060, 5, false);
      }
    }
    if (!c.moving) continue;
    c.vy -= 28 * dt;
    c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
    collide(maze, c, c.s * 0.5, 0.4);
    c.mesh.rotation.x += c.wx * dt;
    c.mesh.rotation.z += c.wz * dt;
    if (c.y < c.s / 2) {
      c.y = c.s / 2;
      c.vy = Math.abs(c.vy) > 2 ? -c.vy * 0.35 : 0;
      c.vx *= 0.75; c.vz *= 0.75; c.wx *= 0.6; c.wz *= 0.6;
      if (Math.hypot(c.vx, c.vz) < 0.4 && c.vy === 0) {
        c.moving = false;
        c.mesh.rotation.x = Math.round(c.mesh.rotation.x / HALF) * HALF;
        c.mesh.rotation.z = Math.round(c.mesh.rotation.z / HALF) * HALF;
      }
    }
    c.mesh.position.set(c.x, c.y, c.z);
  }
}

// ---------------------------------------------------------------- particles

const PN = 700;
const pPos = new Float32Array(PN * 3).fill(-9999);
const pCol = new Float32Array(PN * 3);
const pVel = new Float32Array(PN * 3);
const pLife = new Float32Array(PN);
const pGrav = new Uint8Array(PN);
let pNext = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
points.frustumCulled = false;
scene.add(points);
const tmpC = new THREE.Color();

function spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, grav: boolean) {
  const i = pNext;
  pNext = (pNext + 1) % PN;
  pPos.set([x, y, z], i * 3);
  pVel.set([vx, vy, vz], i * 3);
  tmpC.setHex(color);
  pCol.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  pLife[i] = life;
  pGrav[i] = grav ? 1 : 0;
}
function burst(x: number, y: number, z: number, n: number, color: number, speed: number, grav = true) {
  for (let k = 0; k < n; k++) {
    spark(x, y, z, (Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed, color, 0.4 + Math.random() * 0.5, grav);
  }
}
function updateParticles(dt: number) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    const o = i * 3;
    if (pLife[i] <= 0) { pPos[o + 1] = -9999; continue; }
    if (pGrav[i]) pVel[o + 1] -= 22 * dt;
    else { pVel[o] *= 1 - 2 * dt; pVel[o + 1] = pVel[o + 1] * (1 - 2 * dt) + 1.2 * dt; pVel[o + 2] *= 1 - 2 * dt; }
    pPos[o] += pVel[o] * dt;
    pPos[o + 1] = Math.max(0.02, pPos[o + 1] + pVel[o + 1] * dt);
    pPos[o + 2] += pVel[o + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- audio

class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  eGain!: GainNode;
  eFilter!: BiquadFilterNode;
  o1!: OscillatorNode;
  o2!: OscillatorNode;
  noise!: AudioBuffer;
  lastScrape = 0;
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = save.muted ? 0 : 0.5;
    this.master.connect(c.destination);
    this.eFilter = c.createBiquadFilter();
    this.eFilter.type = 'lowpass';
    this.eFilter.frequency.value = 900;
    this.eGain = c.createGain();
    this.eGain.gain.value = 0;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.o1.connect(this.eFilter); this.o2.connect(g2).connect(this.eFilter);
    this.eFilter.connect(this.eGain).connect(this.master);
    this.o1.start(); this.o2.start();
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  setMuted(m: boolean) { if (this.ctx) this.master.gain.value = m ? 0 : 0.5; }
  engine(on: boolean, speed: number, thr: number, air: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gears = [0, 9, 17, 25, 33, 60];
    let g = 0;
    while (g < gears.length - 2 && speed > gears[g + 1]) g++;
    const rpm = clamp((speed - gears[g]) / (gears[g + 1] - gears[g]), 0, 1);
    const f = 48 + rpm * 95 + g * 8 + thr * 14 + (air ? 30 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.eFilter.frequency.setTargetAtTime(500 + thr * 1400 + rpm * 600, t, 0.05);
    this.eGain.gain.setTargetAtTime(on ? 0.1 + thr * 0.09 : 0, t, 0.08);
  }
  private burst(dur: number, freq: number, type: BiquadFilterType, vol: number, sweep = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur);
  }
  tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.12, at = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  crash() { this.burst(0.7, 900, 'lowpass', 0.8, 120); this.tone(70, 0.4, 'sine', 0.5); }
  scrape(v: number) {
    if (!this.ctx || this.ctx.currentTime - this.lastScrape < 0.12) return;
    this.lastScrape = this.ctx.currentTime;
    this.burst(0.18, 3000, 'highpass', Math.min(0.4, v * 0.03));
  }
  thud(v: number) { this.burst(0.25, 500, 'lowpass', Math.min(0.6, 0.15 + v * 0.02)); this.tone(110, 0.15, 'triangle', 0.2); }
  land(v: number) { this.burst(0.2, 300, 'lowpass', Math.min(0.6, v * 0.06)); }
  boost() { this.burst(0.6, 400, 'bandpass', 0.5, 3000); }
  jump() { this.burst(0.35, 1200, 'bandpass', 0.15, 400); }
  beep(hi: boolean) { this.tone(hi ? 880 : 440, hi ? 0.45 : 0.18, 'square', 0.1); }
  flip() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'square', 0.08, i * 0.07)); }
  finish() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'square', 0.09, i * 0.11)); }
}
const sfx = new Sfx();

// ---------------------------------------------------------------- input

const keys = new Set<string>();
const touchState = { left: false, right: false, drift: false, brake: false };
let touchMode = false;
let botOn = false;

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  sfx.init();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR' && (mode === 'ride' || mode === 'count' || mode === 'done')) startRide();
  if (e.code === 'Escape') { if (mode === 'watch') exitWatch(); else if (mode !== 'menu') showMenu(); }
  if (e.code === 'KeyM') { save.muted = !save.muted; sfx.setMuted(save.muted); persist(); }
  if (e.code === 'Enter' && mode === 'menu') startRide();
  if (mode === 'watch') {
    if (e.code === 'Space') togglePlay();
    if (e.code === 'KeyC') cycleCam();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('touchstart', () => {
  sfx.init();
  if (!touchMode) { touchMode = true; document.body.classList.add('touch'); if (mode === 'ride' || mode === 'count') $('touch').classList.remove('hidden'); }
}, { passive: true });
addEventListener('pointerdown', () => sfx.init());

for (const [id, k] of [['tl', 'left'], ['tr', 'right'], ['tdrift', 'drift'], ['tbrake', 'brake']] as const) {
  const el = $(id);
  const set = (v: boolean) => { touchState[k] = v; el.classList.toggle('on', v); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); });
  el.addEventListener('pointerup', () => set(false));
  el.addEventListener('pointercancel', () => set(false));
  el.addEventListener('lostpointercapture', () => set(false));
}

function readInput(): Input {
  if (botOn) return botInput();
  const k = (...c: string[]) => c.some((x) => keys.has(x));
  const left = k('KeyA', 'ArrowLeft') || touchState.left, right = k('KeyD', 'ArrowRight') || touchState.right;
  const brk = k('KeyS', 'ArrowDown') || touchState.brake;
  const thr = k('KeyW', 'ArrowUp') || (touchMode && !brk && !keys.size);
  return { thr: thr ? 1 : 0, brk: brk ? 1 : 0, steer: (right ? 1 : 0) - (left ? 1 : 0), drift: k('Space', 'ShiftLeft', 'ShiftRight') || touchState.drift };
}

/** Test rider: follows the shortest route using the maze's distance field. */
function botInput(): Input {
  const b = bike;
  let c = cellAt(maze, b.x, b.z);
  let tx = 0, tz = 0;
  for (let look = 0; look < 2; look++) {
    let next = -1;
    for (let d = 0; d < 4; d++) {
      if (!isOpen(maze, c, d)) continue;
      const n = c + DI[d] + DJ[d] * maze.w;
      if (maze.dist[n] === maze.dist[c] - 1) next = n;
    }
    if (next < 0) break;
    [tx, tz] = cellCenter(maze, next);
    if (look === 0 && Math.hypot(tx - b.x, tz - b.z) > CS * 0.7) break;
    c = next;
  }
  const err = wrap(Math.atan2(tx - b.x, tz - b.z) - b.h);
  const sp = speedOf(b);
  return { thr: Math.abs(err) < 0.7 ? 1 : 0.3, brk: Math.abs(err) > 1.1 && sp > 11 ? 1 : 0, steer: clamp(-err * 3, -1, 1), drift: false };
}

// ---------------------------------------------------------------- API

interface BoardRow { rank: number; name: string; color: number; ms: number; tries: number; me: boolean }
interface RunRow { name: string; color: number; ms: number; path: string; me: boolean }
interface Board { day: string; total: number; top: BoardRow[]; me: { rank: number; ms: number; tries: number } | null; runs?: RunRow[] }

async function getBoard(day: string, paths: number): Promise<Board | null> {
  try {
    const r = await fetch(`/api/moto?day=${day}&player=${save.id}&paths=${paths}`);
    if (!r.ok) return null;
    return (await r.json()) as Board;
  } catch {
    return null;
  }
}

async function postRun(day: string, ms: number, path: string) {
  try {
    const r = await fetch('/api/moto', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player: save.id, name: save.name, color: save.color, day, ms, path }),
    });
    const j = await r.json();
    return r.ok ? (j as { improved: boolean; best: number; rank: number; total: number }) : { error: String(j.error ?? r.status) };
  } catch {
    return { error: 'offline' };
  }
}

// ---------------------------------------------------------------- state

type Mode = 'menu' | 'count' | 'ride' | 'done' | 'watch';
let mode: Mode = 'menu';
let maze = genMaze(dayKey());
let bike: Bike = newBike(maze);
let rig = makeRig(PALETTE[save.color], false);
scene.add(rig.root);
let samples: Sample[] = [];
let countT = 0;
let acc = 0;
let revealed = new Uint8Array(maze.w * maze.h);
let lastCell = -1;
let shake = 0;
let camH = 0;
let board: Board | null = null;
let pending: { day: string; ms: number; path: string } | null = null;
buildWorld(maze);

interface Ghost { name: string; color: number; ms: number; s: Sample[]; me: boolean; rig: Rig; done: boolean; x: number; z: number; y: number; vx: number; vz: number }
let ghosts: Ghost[] = [];

function loadMaze(day: string) {
  if (maze.day === day) return;
  maze = genMaze(day);
  buildWorld(maze);
}

function sampleOf(b: Bike): Sample {
  return { x: b.x, z: b.z, y: b.y, h: b.h, pitch: b.pitch, lean: b.lean, state: b.crashT > 0 ? 2 : b.grounded ? 0 : 1, boost: b.boostT > 0 };
}

function clearGhosts() {
  for (const g of ghosts) disposeRig(g.rig);
  ghosts = [];
}

function addGhost(run: { name: string; color: number; ms: number; path: string; me: boolean }, solid: boolean): Ghost | null {
  const s = decode(run.path);
  if (!s || s.length < 2) return null;
  const color = PALETTE[run.color % PALETTE.length] ?? 0xffffff;
  const r = makeRig(color, true, run.name);
  r.body.material = solid ? MAT : GHOST_MAT;
  if (r.label) r.label.material.opacity = solid ? 1 : 0.7;
  scene.add(r.root);
  const g: Ghost = { name: run.name, color, ms: run.ms, s, me: run.me, rig: r, done: false, x: s[0].x, z: s[0].z, y: 0, vx: 0, vz: 0 };
  ghosts.push(g);
  return g;
}

/** Put a ghost where its replay was at time t (ms). */
function poseGhost(g: Ghost, t: number, dt: number) {
  const f = t / SAMPLE_MS;
  const n = g.s.length;
  const i = Math.min(n - 1, Math.floor(f));
  const a = g.s[i], b = g.s[Math.min(n - 1, i + 1)];
  const k = i >= n - 1 ? 0 : f - i;
  const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
  if (dt > 0) { g.vx = (x - g.x) / dt; g.vz = (z - g.z) / dt; }
  g.x = x; g.z = z;
  g.y = a.y + (b.y - a.y) * k;
  g.done = t >= g.ms;
  const crashed = a.state === 2;
  poseRig(g.rig, x, g.y, z, a.h + (b.h - a.h) * k, a.pitch + (b.pitch - a.pitch) * k, a.lean + (b.lean - a.lean) * k, crashed, crashed ? t * 0.012 : 0);
  g.rig.flame.visible = a.boost && !g.done;
}

// ---------------------------------------------------------------- UI helpers

let toastTimer = 0;
function toast(text: string, sub = '', ms = 1100) {
  const el = $('toast');
  el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

function show(id: string, on: boolean) { $(id).classList.toggle('hidden', !on); }
function setScreens(s: { menu?: boolean; done?: boolean; hud?: boolean; watch?: boolean }) {
  show('menu', !!s.menu);
  show('done', !!s.done);
  show('hud', !!s.hud);
  show('watch', !!s.watch);
  show('touch', !!s.hud && touchMode);
}

const prettyDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function untilReset() {
  const now = Date.now();
  const next = Date.parse(dayKey(now) + 'T00:00:00Z') + 864e5;
  const m = Math.floor((next - now) / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderBoard(el: HTMLElement, rows: BoardRow[] | null, emptyText: string) {
  if (!rows) { el.innerHTML = `<li class="empty">${emptyText}</li>`; return; }
  if (!rows.length) { el.innerHTML = '<li class="empty">No times yet today. Be the first!</li>'; return; }
  el.innerHTML = rows.map((r) =>
    `<li class="${r.me ? 'me' : ''}"><span class="rk">${r.rank}</span><span class="dot" style="background:${css(PALETTE[r.color % PALETTE.length])}"></span><span class="nm">${r.name}</span><span class="tm">${fmt(r.ms)}</span></li>`,
  ).join('');
}

function menuText() {
  const day = dayKey();
  const mine = save.best[day];
  let s = `Maze #${mazeNum(day)} · ${prettyDay(day)} · new maze in ${untilReset()}`;
  if (board?.me) s += `<br>Your best: <b>${fmt(board.me.ms)}</b> (#${board.me.rank} of ${board.total})`;
  else if (mine) s += `<br>Your best: <b>${fmt(mine.ms)}</b>`;
  $('menuSub').innerHTML = s;
  $('mWatch').textContent = board && board.total ? `WATCH ALL (${board.total})` : 'WATCH ALL';
}

async function refreshBoard() {
  const day = dayKey();
  const b = await getBoard(day, 1);
  if (day !== dayKey()) return;
  board = b;
  renderBoard($('board'), b ? b.top : null, 'Offline: times can’t be saved right now.');
  $('boardCount').textContent = b ? `${b.total} rider${b.total === 1 ? '' : 's'}` : '';
  menuText();
}

function showMenu() {
  mode = 'menu';
  clearGhosts();
  if (maze.day !== dayKey()) loadMaze(dayKey());
  bike = newBike(maze);
  resetCrates();
  rig.root.visible = true;
  setScreens({ menu: true });
  menuText();
  void refreshBoard();
}

// ---------------------------------------------------------------- ride

function reveal(c: number) {
  revealed[c] = 1;
  for (let d = 0; d < 4; d++) {
    let a = c;
    for (let k = 0; k < 10 && isOpen(maze, a, d); k++) {
      a = a + DI[d] + DJ[d] * maze.w;
      revealed[a] = 1;
    }
  }
}

function startRide() {
  sfx.init();
  if (mode === 'watch') exitWatch(false);
  const day = dayKey();
  if (maze.day !== day) loadMaze(day);
  bike = newBike(maze);
  bike.y = 0;
  samples = [sampleOf(bike)];
  resetCrates();
  revealed = new Uint8Array(maze.w * maze.h);
  lastCell = maze.start;
  reveal(maze.start);
  clearGhosts();
  if (save.ghosts) {
    const mine = save.best[day];
    const leader = board?.runs?.find((r) => !r.me);
    const meRun = board?.runs?.find((r) => r.me);
    if (leader) addGhost(leader, false);
    if (mine) addGhost({ name: 'YOUR BEST', color: save.color, ms: mine.ms, path: mine.path, me: true }, false);
    else if (meRun) addGhost({ ...meRun, name: 'YOUR BEST' }, false);
  }
  mode = 'count';
  countT = 2.999;
  acc = 0;
  pending = null;
  rig.root.visible = true;
  setScreens({ hud: true });
  $('count').textContent = '3';
  sfx.beep(false);
  $('time').textContent = fmt(0);
  const mine = save.best[day];
  $('timeSub').textContent = mine ? `BEST ${fmt(mine.ms)}` : `MAZE #${maze.num}`;
  $('keys').classList.toggle('hidden', !!mine);
  camH = bike.h;
  chaseCam(1, true);
}

function onEv(e: Ev, v: number) {
  const b = bike;
  switch (e) {
    case 'crash':
      sfx.crash();
      shake = 0.6;
      burst(b.x, b.y + 0.6, b.z, 26, 0xffb347, 9);
      burst(b.x, b.y + 0.3, b.z, 14, 0xb8a090, 4, false);
      toast('WIPEOUT!', '', 900);
      break;
    case 'scrape':
      sfx.scrape(v);
      for (let k = 0; k < Math.min(10, v); k++) spark(b.x, b.y + 0.5, b.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0xffd27a, 0.35, true);
      shake = Math.max(shake, Math.min(0.25, v * 0.02));
      break;
    case 'land':
      if (v > 5) { sfx.land(v); burst(b.x, 0.2, b.z, 12, 0xd9b48a, 5, false); shake = Math.max(shake, Math.min(0.3, v * 0.025)); }
      break;
    case 'jump': sfx.jump(); break;
    case 'flip': sfx.flip(); sfx.boost(); toast(v > 1 ? 'DOUBLE FLIP!' : 'BACKFLIP!', '+ BOOST'); break;
    case 'boost': sfx.boost(); break;
    case 'driftBoost': sfx.boost(); toast('DRIFT BOOST', '', 700); break;
    case 'respawn': break;
    case 'finish': break;
  }
}

function updateRide(dt: number) {
  if (mode === 'count') {
    const before = Math.ceil(countT);
    countT -= dt;
    const now = Math.ceil(countT);
    const inp = readInput();
    sfx.engine(true, inp.thr * 8, inp.thr, false);
    if (countT <= 0) {
      mode = 'ride';
      $('count').textContent = 'GO!';
      sfx.beep(true);
      setTimeout(() => { if ($('count').textContent === 'GO!') $('count').textContent = ''; }, 700);
    } else if (now !== before) {
      $('count').textContent = String(now);
      sfx.beep(false);
    }
  } else if (mode === 'ride') {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 10) {
      acc -= DT;
      n++;
      const inp = readInput();
      step(maze, bike, inp, onEv);
      if (bike.steps % SAMPLE_EVERY === 0 && samples.length <= MAX_SAMPLES) samples.push(sampleOf(bike));
      if (bike.finished) { finishRide(); break; }
    }
    const c = cellAt(maze, bike.x, bike.z);
    if (c >= 0 && c !== lastCell) { lastCell = c; reveal(c); }
    const inp = readInput();
    sfx.engine(true, speedOf(bike), inp.thr, !bike.grounded);
    if (bike.drifting && Math.random() < 0.6) spark(bike.x - Math.sin(bike.h) * 0.7, 0.15, bike.z - Math.cos(bike.h) * 0.7, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, 0xcfc4b8, 0.8, false);
    const t = bike.steps * DT * 1000;
    for (const g of ghosts) poseGhost(g, t, dt);
  }
  updateCrates(dt, [{ x: bike.x, y: bike.y, z: bike.z, vx: bike.vx, vz: bike.vz, player: true }, ...(mode === 'ride' ? ghosts : [])]);
  poseBike();
  if (mode !== 'done') {
    $('time').textContent = fmt(bike.steps * DT * 1000);
    $('speed').textContent = String(Math.round(speedOf(bike) * 3.6));
    const fill = $('boostfill');
    if (bike.boostT > 0) { fill.style.width = `${Math.min(100, (bike.boostT / 1.6) * 100)}%`; fill.style.background = ''; }
    else { fill.style.width = `${Math.min(100, (bike.charge / 1.7) * 100)}%`; fill.style.background = bike.charge > 0.5 ? '#ffd166' : '#a08a70'; }
  }
}

function poseBike() {
  const b = bike;
  poseRig(rig, b.x, b.y, b.z, b.h, b.pitch, b.lean, b.crashT > 0, b.tumble);
  if (rig.wf && rig.wr) { rig.wf.rotation.x = b.wheel; rig.wr.rotation.x = b.wheel; }
  if (rig.fork) rig.fork.rotation.y = -b.steer * 0.35;
  rig.flame.visible = b.boostT > 0;
  if (rig.flame.visible) rig.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
}

function finishRide() {
  mode = 'done';
  samples.push(sampleOf(bike));
  const ms = stepsToMs(bike.steps);
  const day = maze.day;
  const path = encode(samples);
  const prev = save.best[day];
  const pb = !prev || ms < prev.ms;
  const storable = samples.length <= MAX_SAMPLES;
  if (pb && storable) { save.best[day] = { ms, path }; persist(); }
  sfx.finish();
  sfx.engine(false, 0, 0, false);
  burst(bike.x, 1, bike.z, 60, 0xffd166, 12);
  toast('FINISH!', fmt(ms), 1400);
  $('doneTime').textContent = fmt(ms);
  $('doneMsg').innerHTML = pb ? (prev ? `New best! <b>−${fmt(prev.ms - ms)}</b>` : 'First finish today!') : `Today's best: <b>${fmt(prev.ms)}</b> (+${fmt(ms - prev.ms)})`;
  $('doneSub').textContent = '';
  show('doneName', false);
  if (!storable) $('doneSub').textContent = 'Runs over six minutes can’t be saved.';
  else {
    pending = { day, ms, path };
    if (cleanName(save.name)) void submitPending();
    else { show('doneName', true); ($('dName') as HTMLInputElement).value = ''; }
  }
  setTimeout(() => { if (mode === 'done') setScreens({ done: true }); }, 1300);
}

async function submitPending() {
  if (!pending) return;
  const p = pending;
  $('doneSub').textContent = 'Saving…';
  const r = await postRun(p.day, p.ms, p.path);
  if (pending !== p) return;
  pending = null;
  if ('error' in r) {
    $('doneSub').textContent = r.error === 'offline' ? 'Offline: this time wasn’t saved online.' : `Couldn’t save (${r.error}).`;
    return;
  }
  $('doneSub').innerHTML = r.improved
    ? `Rank <b>#${r.rank}</b> of ${r.total} today`
    : `Your best ${fmt(r.best)} is still #${r.rank} of ${r.total}`;
  board = null;
  void getBoard(p.day, 1).then((b) => { if (b) board = b; });
}

// ---------------------------------------------------------------- watch

let wT = 0, wMax = 1, wPlaying = true, wSpeed = 1, wDay = dayKey();
let camMode: 'sky' | 'chase' = 'sky';
let follow: Ghost | null = null;
let skyA = 0;
let standT = 0;
let winnerShown = false;
let watchToken = 0;

async function startWatch(day = dayKey()) {
  sfx.init();
  sfx.engine(false, 0, 0, false);
  mode = 'watch';
  wDay = day;
  loadMaze(day);
  clearGhosts();
  resetCrates();
  rig.root.visible = false;
  setScreens({ watch: true });
  $('wday').textContent = `#${mazeNum(day)} · ${prettyDay(day)}`;
  ($('wNext') as HTMLButtonElement).disabled = day >= dayKey();
  ($('wPrev') as HTMLButtonElement).disabled = day <= LAUNCH;
  $('wlist').innerHTML = '';
  $('wcount').textContent = '';
  const msg = $('wmsg');
  msg.textContent = 'Loading riders…';
  show('wmsg', true);
  wT = 0; wPlaying = true; follow = null; winnerShown = false;
  const token = ++watchToken;
  const b = await getBoard(day, 60);
  if (token !== watchToken || mode !== 'watch') return;
  const runs = b?.runs ?? [];
  // Offline or no one yet: still show your own local best for today.
  if (!runs.some((r) => r.me) && save.best[day]) runs.push({ name: save.name || 'YOU', color: save.color, ms: save.best[day].ms, path: save.best[day].path, me: true });
  for (const r of runs) addGhost(r, true);
  if (!ghosts.length) {
    msg.innerHTML = b ? 'No one has ridden this maze yet.<br><br><button class="btn small" id="wRideNow">BE THE FIRST</button>' : 'Couldn’t load riders (offline).';
    $('wRideNow')?.addEventListener('click', () => startRide());
    return;
  }
  show('wmsg', false);
  ghosts.sort((a, c) => a.ms - c.ms);
  $('wcount').textContent = `${ghosts.length} rider${ghosts.length === 1 ? '' : 's'}`;
  wMax = Math.max(...ghosts.map((g) => g.ms)) + 2500;
  for (const g of ghosts) poseGhost(g, 0, 0);
  updateStandings();
}

function exitWatch(toMenu = true) {
  watchToken++;
  clearGhosts();
  if (toMenu) showMenu();
}

function togglePlay() {
  if (wT >= wMax) { wT = 0; resetCrates(); winnerShown = false; }
  wPlaying = !wPlaying;
  $('wPlay').textContent = wPlaying ? '❚❚' : '▶';
}
function cycleCam() {
  camMode = camMode === 'sky' ? 'chase' : 'sky';
  $('wCam').textContent = camMode === 'sky' ? 'CAM: SKY' : 'CAM: CHASE';
}

function standingOrder() {
  return ghosts
    .map((g) => {
      const c = Math.max(0, cellAt(maze, g.x, g.z));
      return { g, key: g.done ? g.ms - 1e9 : maze.dist[c] * 1e5 - wT * 0 };
    })
    .sort((a, b) => a.key - b.key || a.g.ms - b.g.ms)
    .map((e) => e.g);
}

function updateStandings() {
  const order = standingOrder();
  $('wlist').innerHTML = order.map((g, i) =>
    `<li data-i="${ghosts.indexOf(g)}" class="${g.me ? 'me' : ''} ${follow === g ? 'follow' : ''}"><span class="rk">${i + 1}</span><span class="dot" style="background:${css(g.color)}"></span><span class="nm">${g.name}</span><span class="tm">${g.done ? fmt(g.ms) : '…'}</span></li>`,
  ).join('');
}
$('wlist').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li) return;
  const g = ghosts[Number(li.dataset.i)];
  if (!g) return;
  follow = follow === g ? null : g;
  if (follow) { camMode = 'chase'; $('wCam').textContent = 'CAM: CHASE'; }
  updateStandings();
});

function updateWatch(dt: number) {
  if (!ghosts.length) return;
  const prevT = wT;
  if (wPlaying) wT = Math.min(wMax, wT + dt * 1000 * wSpeed);
  if (wT >= wMax && wPlaying) { wPlaying = false; $('wPlay').textContent = '↺'; }
  const stepDt = (wT - prevT) / 1000;
  for (const g of ghosts) poseGhost(g, wT, stepDt);
  if (stepDt > 0) updateCrates(dt, ghosts.filter((g) => !g.done));
  if (!winnerShown && ghosts[0].done) {
    winnerShown = true;
    toast(`${ghosts[0].name} WINS`, fmt(ghosts[0].ms), 2200);
  }
  ($('wScrub') as HTMLInputElement).value = String(Math.round((wT / wMax) * 1000));
  $('wclock').textContent = fmt(wT, 1);
  standT -= dt;
  if (standT <= 0) { standT = 0.25; updateStandings(); }
  // Big bikes and tags from the sky, so you can follow the race.
  const big = camMode === 'sky' ? 2.4 : 1;
  for (const g of ghosts) {
    g.rig.root.scale.setScalar(big);
    if (g.rig.label) { g.rig.label.scale.set(big > 1 ? 3.4 : 4, big > 1 ? 0.85 : 1, 1); g.rig.label.position.y = big > 1 ? 3.4 : 2.9; }
  }
}

$('wPlay').addEventListener('click', togglePlay);
$('wSpeed').addEventListener('click', () => {
  wSpeed = wSpeed === 1 ? 2 : wSpeed === 2 ? 4 : wSpeed === 4 ? 0.5 : 1;
  $('wSpeed').textContent = `${wSpeed}×`;
});
$('wScrub').addEventListener('input', () => {
  const t = (Number(($('wScrub') as HTMLInputElement).value) / 1000) * wMax;
  if (t < wT) { resetCrates(); winnerShown = false; }
  wT = t;
  for (const g of ghosts) poseGhost(g, wT, 0);
});
$('wCam').addEventListener('click', cycleCam);
$('wExit').addEventListener('click', () => exitWatch());
$('wPrev').addEventListener('click', () => void startWatch(shiftDay(wDay, -1)));
$('wNext').addEventListener('click', () => void startWatch(shiftDay(wDay, 1)));

// ---------------------------------------------------------------- camera

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3(), focus = new THREE.Vector3();

function chaseCam(dt: number, snap = false, target?: { x: number; y: number; z: number; h: number; vx: number; vz: number; crashed: boolean }) {
  const t = target ?? { x: bike.x, y: bike.y, z: bike.z, h: bike.h, vx: bike.vx, vz: bike.vz, crashed: bike.crashT > 0 };
  const sp = Math.hypot(t.vx, t.vz);
  const velH = sp > 4 ? Math.atan2(t.vx, t.vz) : t.h;
  const want = t.crashed ? camH : velH + wrap(t.h - velH) * 0.35;
  camH = snap ? want : camH + wrap(want - camH) * Math.min(1, dt * 4);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  const back = 7.4 + Math.min(sp, 44) * 0.03;
  tmpV.set(t.x - fx * back, t.y + 3.7, t.z - fz * back);
  const k = snap ? 1 : 1 - Math.exp(-dt * 11);
  camPos.lerp(tmpV, k);
  tmpV.set(t.x + fx * 4, t.y + 1.1, t.z + fz * 4);
  camLook.lerp(tmpV, snap ? 1 : 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  if (shake > 0) camera.position.add(tmpV.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(camLook);
  const portrait = camera.aspect < 0.8 ? 1.3 : 1; // phones held upright need a wider view
  const fov = (60 + Math.min(sp, 44) * 0.3 + (bike.boostT > 0 && !target ? 5 : 0)) * portrait;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  focus.set(t.x, 0, t.z);
  setShadow(focus, 42);
}

function skyCam(dt: number, radiusMul: number, height: number, spin: number) {
  const W = maze.w * CS, H = maze.h * CS;
  const cx = W / 2, cz = H / 2, span = Math.max(W, H);
  skyA += dt * spin;
  const fit = camera.aspect < 1 ? 1 / Math.max(0.55, camera.aspect) : 1;
  const r = span * radiusMul * fit;
  camera.position.set(cx + Math.sin(skyA) * r, span * height * fit, cz + Math.cos(skyA) * r);
  camera.lookAt(cx, 0, cz);
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  focus.set(cx, 0, cz);
  setShadow(focus, span * 0.75);
}

function updateCamera(dt: number) {
  shake = Math.max(0, shake - dt * 1.5);
  if (mode === 'menu') skyCam(dt, 0.72, 0.62, 0.06);
  else if (mode === 'watch') {
    if (camMode === 'sky' || !ghosts.length) skyCam(dt, 0.5, 0.95, 0.03);
    else {
      const g = follow ?? standingOrder().find((x) => !x.done) ?? ghosts[0];
      const i = Math.min(g.s.length - 1, Math.floor(wT / SAMPLE_MS));
      const s = g.s[i];
      chaseCam(dt, false, { x: g.x, y: g.y, z: g.z, h: s.h, vx: g.vx, vz: g.vz, crashed: s.state === 2 });
    }
  } else if (mode === 'done') {
    skyA += dt * 0.4;
    tmpV.set(bike.x + Math.sin(skyA) * 9, 4.5, bike.z + Math.cos(skyA) * 9);
    camPos.lerp(tmpV, 1 - Math.exp(-dt * 2));
    camera.position.copy(camPos);
    camera.lookAt(bike.x, 1, bike.z);
  } else chaseCam(dt);
  scene.userData.sky.position.copy(camera.position);
  // From high up, push the fog out past the maze so it stays crisp.
  const high = (mode === 'watch' && camMode === 'sky') || mode === 'menu';
  const camD = camera.position.distanceTo(focus);
  const fog = scene.fog as THREE.Fog;
  const far = high ? camD * 2.6 : 210, near = high ? camD * 1.05 : 50;
  fog.far += (far - fog.far) * Math.min(1, dt * 3);
  fog.near += (near - fog.near) * Math.min(1, dt * 3);
}

// ---------------------------------------------------------------- minimap

const mini = $('mini') as HTMLCanvasElement;
const mg = mini.getContext('2d')!;
function drawMini() {
  const show = mode === 'ride' || mode === 'count';
  if (!show) return;
  const wpx = mini.clientWidth, dpr = Math.min(2, devicePixelRatio);
  if (mini.width !== Math.round(wpx * dpr)) { mini.width = Math.round(wpx * dpr); mini.height = Math.round(wpx * dpr); }
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  mg.clearRect(0, 0, wpx, wpx);
  const pad = 8;
  const sc = (wpx - pad * 2) / (Math.max(maze.w, maze.h) * CS);
  const ox = pad + ((Math.max(maze.w, maze.h) - maze.w) * CS * sc) / 2, oz = pad + ((Math.max(maze.w, maze.h) - maze.h) * CS * sc) / 2;
  const X = (x: number) => ox + x * sc, Z = (z: number) => oz + z * sc;
  const cs = CS * sc;
  mg.fillStyle = 'rgba(255,255,255,0.08)';
  for (let c = 0; c < revealed.length; c++) if (revealed[c]) mg.fillRect(X((c % maze.w) * CS), Z(Math.floor(c / maze.w) * CS), cs, cs);
  mg.strokeStyle = 'rgba(255,244,232,0.85)';
  mg.lineWidth = 1.5;
  mg.beginPath();
  for (let c = 0; c < revealed.length; c++) {
    if (!revealed[c]) continue;
    const x = X((c % maze.w) * CS), z = Z(Math.floor(c / maze.w) * CS), wl = maze.walls[c];
    if (wl & DIRS[0]) { mg.moveTo(x, z); mg.lineTo(x + cs, z); }
    if (wl & DIRS[2]) { mg.moveTo(x, z + cs); mg.lineTo(x + cs, z + cs); }
    if (wl & DIRS[3]) { mg.moveTo(x, z); mg.lineTo(x, z + cs); }
    if (wl & DIRS[1]) { mg.moveTo(x + cs, z); mg.lineTo(x + cs, z + cs); }
  }
  mg.stroke();
  const [fx, fz] = cellCenter(maze, maze.finish);
  const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.3;
  mg.fillStyle = `rgba(255,209,102,${pulse})`;
  mg.fillRect(X(fx) - cs * 0.35, Z(fz) - cs * 0.35, cs * 0.7, cs * 0.7);
  for (const g of ghosts) {
    mg.fillStyle = css(g.color);
    mg.globalAlpha = 0.7;
    mg.beginPath(); mg.arc(X(g.x), Z(g.z), 2.5, 0, Math.PI * 2); mg.fill();
  }
  mg.globalAlpha = 1;
  const px = X(bike.x), pz = Z(bike.z), fwx = Math.sin(bike.h), fwz = Math.cos(bike.h);
  mg.fillStyle = css(PALETTE[save.color]);
  mg.strokeStyle = '#fff';
  mg.lineWidth = 1.2;
  mg.beginPath();
  mg.moveTo(px + fwx * 7, pz + fwz * 7);
  mg.lineTo(px - fwx * 4 + fwz * 4, pz - fwz * 4 - fwx * 4);
  mg.lineTo(px - fwx * 4 - fwz * 4, pz - fwz * 4 + fwx * 4);
  mg.closePath();
  mg.fill(); mg.stroke();
}

// ---------------------------------------------------------------- menu wiring

const nameInput = $('mName') as HTMLInputElement;
nameInput.value = save.name;
nameInput.addEventListener('input', () => {
  nameInput.value = nameInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  const n = cleanName(nameInput.value);
  if (n) { save.name = n; persist(); }
});
const swatches = $('mColors');
function drawSwatches() {
  swatches.innerHTML = PALETTE.map((c, i) => `<button data-i="${i}" class="${i === save.color ? 'on' : ''}" style="background:${css(c)}" title="Bike colour"></button>`).join('');
}
drawSwatches();
swatches.addEventListener('click', (e) => {
  const i = Number((e.target as HTMLElement).dataset.i);
  if (!Number.isInteger(i)) return;
  save.color = i;
  persist();
  drawSwatches();
  disposeRig(rig);
  rig = makeRig(PALETTE[i], false);
  scene.add(rig.root);
  poseBike();
});
const ghostBox = $('mGhosts') as HTMLInputElement;
ghostBox.checked = save.ghosts;
ghostBox.addEventListener('change', () => { save.ghosts = ghostBox.checked; persist(); });

$('mRide').addEventListener('click', () => startRide());
$('mWatch').addEventListener('click', () => void startWatch());
$('dAgain').addEventListener('click', () => startRide());
$('dWatch').addEventListener('click', () => void startWatch(maze.day));
$('dMenu').addEventListener('click', () => showMenu());
$('hMenu').addEventListener('click', () => showMenu());
$('hRestart').addEventListener('click', () => startRide());
const dName = $('dName') as HTMLInputElement;
dName.addEventListener('input', () => { dName.value = dName.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ''); });
const saveName = () => {
  const n = cleanName(dName.value);
  if (!n) { $('doneSub').textContent = 'Names need 3 to 14 letters or numbers.'; return; }
  save.name = n;
  nameInput.value = n;
  persist();
  show('doneName', false);
  void submitPending();
};
$('dSave').addEventListener('click', saveName);
dName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });

// ---------------------------------------------------------------- loop

let last = performance.now();
let time = 0;
let paused = false; // test hook only
function update(dt: number) {
  time += dt;
  if (mode === 'count' || mode === 'ride' || mode === 'done') updateRide(dt);
  else if (mode === 'watch') updateWatch(dt);
  else { poseBike(); updateCrates(dt, []); }
  updateParticles(dt);
  updateCamera(dt);
  if (boostTex) boostTex.offset.y = -time * 1.6;
  if (finishBeam) (finishBeam.material as THREE.MeshBasicMaterial).opacity = 0.26 + Math.sin(time * 3) * 0.08;
  if (finishRing) { finishRing.position.y = 0.4 + Math.sin(time * 2) * 0.25; finishRing.rotation.z = time; }
  drawMini();
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  if (renderer.domElement.width > 0) renderer.render(scene, camera);
}
showMenu();
requestAnimationFrame(frame);

// Test hook for headless checks.
(window as unknown as Record<string, unknown>).__moto = {
  get mode() { return mode; },
  get bike() { return bike; },
  get maze() { return maze; },
  get ghosts() { return ghosts; },
  get samples() { return samples; },
  get wT() { return wT; },
  set wT(v: number) { wT = v; },
  save,
  update,
  startRide,
  startWatch,
  showMenu,
  setBot(on: boolean) { botOn = on; },
  pause(on: boolean) { paused = on; },
  camera,
  shot(w: number, h: number) {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(renderer.domElement, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.86);
  },
  render: () => renderer.render(scene, camera),
  skipCount() { countT = 0.0001; },
  noInput,
};
