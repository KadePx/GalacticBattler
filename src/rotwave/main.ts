import * as THREE from 'three';
import { HALF, ColliderGrid, buildMap } from './map';
import {
  Collider, SoldierLook, canopyGeometry, cannonHead, crateGeometry, flameHead, hqGeometry, jeepRig, jetGeometry,
  lookoutHead, mortarBase, mortarHead, soldierRig, spikeGeometry, tankRig, towerGeometry, turretBase, turretHead,
  wallGeometry, zombieGeometry,
} from './models';
import { sfx, toggleMute, unlockAudio } from './audio';
import { N as NAV_N, Nav, Pt } from './nav';
import { Fx } from './fx';
import {
  AGGRO, BASE_ORDER, BUILDS, BuildKind, CALLS, CALL_ORDER, CallKind, GunDef, HQ, SQUAD_ORDER, UNITS, UNIT_CAP,
  UnitDef, UnitKind, ZTYPES,
} from './defs';

// =====================================================================
// Rotwave: low-poly RTS wave defense. Train a squad, build a base, call
// in support, and hold the HQ against endless, escalating zombie waves.
// =====================================================================

// ------------------------------------------------------------ renderer + scene

const host = document.getElementById('game')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const FOG = 0x2b313b;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 75, 150);

const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
scene.add(new THREE.HemisphereLight(0xa9bad6, 0x3b3326, 1.7));
const sun = new THREE.DirectionalLight(0xffd2a0, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 160 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const map = buildMap(1337);
scene.add(map.ground, map.props);
const statics = map.grid; // trees, rocks, cars
const dynamics = new ColliderGrid(); // solid player buildings
const nav = new Nav(statics);
const fx = new Fx(scene);

const lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// ------------------------------------------------------------ entities

interface Ent {
  id: number;
  x: number;
  z: number;
  r: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}
interface Unit extends Ent {
  type: 'unit';
  kind: UnitKind;
  def: UnitDef;
  obj: THREE.Group;
  legs: [THREE.Object3D, THREE.Object3D] | null;
  head: THREE.Object3D | null; // vehicle turret
  ring: THREE.Mesh;
  bar: HpBar;
  canopy: THREE.Object3D | null;
  drop: number; // height while parachuting in; 0 when on the ground
  path: Pt[];
  dest: Pt | null;
  moving: boolean;
  cd: number;
  aim: Zombie | null;
  retarget: number;
  yaw: number;
  aimYaw: number;
  walk: number;
  selected: boolean;
  px: number;
  pz: number;
  stuck: number;
  repath: number;
  nadeCd: number;
  supportCd: number;
}
interface BCollider extends Collider {
  owner: Building;
}
interface Building extends Ent {
  type: 'building';
  kind: BuildKind | 'hq';
  gun: GunDef | null;
  muzzle: number;
  gunY: number;
  obj: THREE.Object3D;
  head: THREE.Object3D | null;
  colliders: BCollider[];
  bar: HpBar;
  cd: number;
  aim: Zombie | null;
  retarget: number;
}
interface Zombie {
  id: number;
  t: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  r: number;
  dps: number;
  yaw: number;
  phase: number;
  flash: number;
  burn: number;
  slow: number;
  target: Unit | Building | null;
  think: number;
  attacking: boolean;
  tint: THREE.Color;
  dead: boolean;
  px: number;
  pz: number;
  stuck: number;
  shove: number; // >0: pushing through scenery after being wedged
}

let nextId = 1;
let units: Unit[] = [];
let buildings: Building[] = [];
let zombies: Zombie[] = [];
let hq: Building;

// ------------------------------------------------------------ hp bars

const barGeo = new THREE.PlaneGeometry(1, 1);
const barBg = new THREE.MeshBasicMaterial({ color: 0x0b0d10, depthTest: false, transparent: true, opacity: 0.75, fog: false });
const barFgGood = new THREE.MeshBasicMaterial({ color: 0x7ee06a, depthTest: false, fog: false });
const barFgBad = new THREE.MeshBasicMaterial({ color: 0xff5a45, depthTest: false, fog: false });
const qInv = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
class HpBar {
  group = new THREE.Group();
  fg: THREE.Mesh;
  constructor(public w: number, y: number) {
    const bg = new THREE.Mesh(barGeo, barBg);
    bg.scale.set(w + 0.08, 0.2, 1);
    bg.renderOrder = 10;
    this.fg = new THREE.Mesh(barGeo, barFgGood);
    this.fg.scale.set(w, 0.12, 1);
    this.fg.position.z = 0.001;
    this.fg.renderOrder = 11;
    this.group.add(bg, this.fg);
    this.group.position.y = y;
    this.group.visible = false;
  }
  set(frac: number, show: boolean, parentYaw: number) {
    frac = Math.max(0, Math.min(1, frac));
    this.group.visible = show;
    if (!show) return;
    this.fg.scale.x = Math.max(0.001, this.w * frac);
    this.fg.position.x = -(this.w * (1 - frac)) / 2;
    this.fg.material = frac < 0.35 ? barFgBad : barFgGood;
    this.group.quaternion.copy(camera.quaternion).premultiply(qInv.setFromAxisAngle(yAxis, -parentYaw));
  }
}

// ------------------------------------------------------------ zombie rendering (instanced)

const ZLOOKS = [
  { skin: 0x8aa66a, shirt: 0x6b6f86, pants: 0x3e3a35, width: 1, hunch: 0.25, armLen: 0.7 },
  { skin: 0x9bb07a, shirt: 0x8a3b30, pants: 0x2f3440, width: 0.85, hunch: 0.5, armLen: 0.65 },
  { skin: 0x7a9460, shirt: 0x4b4239, pants: 0x2e2a26, width: 1.35, hunch: 0.2, armLen: 0.85 },
];
const ZCAP = 700;
const zMeshes = ZLOOKS.map((look) => {
  const m = new THREE.InstancedMesh(zombieGeometry(look), lambert, ZCAP);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ZCAP * 3).fill(1), 3);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
});
const dummy = new THREE.Object3D();
dummy.rotation.order = 'YXZ';
const tmpC = new THREE.Color();

// grenades, mortar shells and bombs in flight
const LOB_CAP = 200;
const lobMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshLambertMaterial({ color: 0x2a2d22, flatShading: true }), LOB_CAP);
lobMesh.frustumCulled = false;
lobMesh.count = 0;
lobMesh.castShadow = true;
scene.add(lobMesh);
interface Lob {
  sx: number; sy: number; sz: number;
  tx: number; tz: number;
  t: number; dur: number; h: number;
  dmg: number; r: number; big: boolean;
}
let lobs: Lob[] = [];

// ------------------------------------------------------------ zombie spatial grid

const ZCELL = 2;
const zgrid = new Map<number, Zombie[]>();
const zkey = (cx: number, cz: number) => cx * 4096 + cz;
function rebuildZGrid() {
  for (const list of zgrid.values()) list.length = 0;
  for (const z of zombies) {
    if (z.dead) continue;
    const k = zkey(Math.floor(z.x / ZCELL), Math.floor(z.z / ZCELL));
    let list = zgrid.get(k);
    if (!list) zgrid.set(k, (list = []));
    list.push(z);
  }
}
/** Call fn for every live zombie whose edge is within range of (x,z). */
function forZombiesNear(x: number, z: number, range: number, fn: (zz: Zombie, d2: number) => void) {
  const c0x = Math.floor((x - range - 1) / ZCELL), c1x = Math.floor((x + range + 1) / ZCELL);
  const c0z = Math.floor((z - range - 1) / ZCELL), c1z = Math.floor((z + range + 1) / ZCELL);
  for (let cx = c0x; cx <= c1x; cx++)
    for (let cz = c0z; cz <= c1z; cz++) {
      const list = zgrid.get(zkey(cx, cz));
      if (!list) continue;
      for (const zz of list) {
        if (zz.dead) continue;
        const d2 = (zz.x - x) ** 2 + (zz.z - z) ** 2;
        const rr = range + zz.r;
        if (d2 < rr * rr) fn(zz, d2);
      }
    }
}
function nearestZombie(x: number, z: number, range: number, minRange = 0): Zombie | null {
  let best: Zombie | null = null;
  let bd = Infinity;
  const min2 = minRange * minRange;
  forZombiesNear(x, z, range, (zz, d2) => {
    if (d2 < bd && d2 >= min2) {
      bd = d2;
      best = zz;
    }
  });
  return best;
}

// ------------------------------------------------------------ game state

type Phase = 'title' | 'build' | 'wave' | 'over';
type Tab = 'squad' | 'base';
const S = {
  phase: 'title' as Phase,
  paused: false,
  wave: 0,
  buildTimer: 0,
  scrap: 0,
  kills: 0,
  time: 0,
  spawnQueue: [] as { t: number; side: number; center: number }[],
  spawnTimer: 0,
  spawnInterval: 0.3,
  hpMult: 1,
  speedMult: 1,
  placing: null as BuildKind | null,
  targeting: null as CallKind | null,
  wallRot: 0,
  tab: 'squad' as Tab,
  cd: { airstrike: 0, artillery: 0, supply: 0, para: 0 } as Record<CallKind, number>,
  timers: [] as { at: number; fn: () => void }[],
  groan: 2,
  best: 0,
};
try {
  S.best = Number(localStorage.getItem('rotwave.bestWave') ?? 0) || 0;
} catch {
  /* storage blocked */
}
function later(sec: number, fn: () => void) {
  S.timers.push({ at: S.time + sec, fn });
}

// ------------------------------------------------------------ units

const LOOKS: Record<UnitKind, SoldierLook | null> = {
  rifle: { jacket: 0x5a6b3c, helmet: 0x3d4a2c, gunLen: 0.9, bulk: 1 },
  gunner: { jacket: 0x8f6a38, helmet: 0x5a4a2c, gunLen: 1.15, bulk: 1.25, gunW: 0.16 },
  sniper: { jacket: 0x3c4554, helmet: 0x2a2f38, gunLen: 1.6, bulk: 0.9 },
  grenadier: { jacket: 0x6b5a3a, helmet: 0x4a3f2c, gunLen: 0.7, bulk: 1.05, gunW: 0.24, pack: 0x6a5a3a },
  flamer: { jacket: 0x7a4a2e, helmet: 0x3a3a3a, gunLen: 0.8, bulk: 1.15, gunW: 0.14, tanks: true },
  medic: { jacket: 0x5a6b3c, helmet: 0xe8e4d8, gunLen: 0.55, bulk: 0.95, cross: true },
  engineer: { jacket: 0x46566a, helmet: 0xe0b030, gunLen: 0.55, bulk: 1, visor: 0x2a2a2a, pack: 0x8a6a3e },
  jeep: null,
  tank: null,
};

const ringGeo = new THREE.RingGeometry(0.55, 0.7, 24).rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x7ee06a, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
const canopyGeo = canopyGeometry();

function spawnUnit(kind: UnitKind, x: number, z: number, drop = 0): Unit {
  const def = UNITS[kind];
  let obj: THREE.Group;
  let legs: [THREE.Object3D, THREE.Object3D] | null = null;
  let head: THREE.Object3D | null = null;
  const look = LOOKS[kind];
  if (look) {
    const rig = soldierRig(look);
    obj = rig.root;
    legs = [rig.legL, rig.legR];
  } else {
    const rig = kind === 'jeep' ? jeepRig() : tankRig();
    obj = rig.root;
    head = rig.head;
  }
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.05;
  ring.scale.setScalar(def.r / 0.42);
  ring.visible = false;
  obj.add(ring);
  const bar = new HpBar(def.vehicle ? 1.6 : 0.9, kind === 'tank' ? 2.9 : kind === 'jeep' ? 2.6 : 2.5);
  obj.add(bar.group);
  let canopy: THREE.Object3D | null = null;
  if (drop > 0) {
    canopy = new THREE.Mesh(canopyGeo, lambert);
    canopy.position.y = 0.7;
    obj.add(canopy);
  }
  obj.position.set(x, drop, z);
  scene.add(obj);
  const u: Unit = {
    id: nextId++, type: 'unit', kind, def, x, z, r: def.r, hp: def.hp, maxHp: def.hp, dead: false,
    obj, legs, head, ring, bar, canopy, drop, path: [], dest: null, moving: false,
    cd: Math.random() * 0.5, aim: null, retarget: 0, yaw: Math.PI, aimYaw: Math.PI, walk: 0, selected: false,
    px: x, pz: z, stuck: 0, repath: 0, nadeCd: 4 + Math.random() * 6, supportCd: 0,
  };
  units.push(u);
  return u;
}

function popUsed() {
  let n = 0;
  for (const u of units) if (!u.dead) n += u.def.pop;
  return n;
}

function moveUnit(u: Unit, x: number, z: number) {
  const p = nav.path(u.x, u.z, x, z, u.r);
  if (!p) return false;
  u.path = p;
  u.dest = { x, z };
  u.moving = true;
  u.stuck = 0;
  u.repath = 0;
  return true;
}

// ------------------------------------------------------------ buildings

const wallGeo = wallGeometry();
const geos = {
  turretBase: turretBase(), turretHead: turretHead(), cannonHead: cannonHead(), flameHead: flameHead(),
  mortarBase: mortarBase(), mortarHead: mortarHead(), tower: towerGeometry(), lookout: lookoutHead(),
  spikes: spikeGeometry(), hq: hqGeometry(),
};

/** Build the meshes for a structure. Shared by real buildings and placement ghosts. */
function buildingVisual(kind: BuildKind | 'hq', mat: THREE.Material, shadows: boolean) {
  const obj = new THREE.Group();
  let head: THREE.Object3D | null = null;
  const add = (g: THREE.BufferGeometry, parent: THREE.Object3D = obj) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = shadows;
    parent.add(m);
    return m;
  };
  const withHead = (base: THREE.BufferGeometry, hg: THREE.BufferGeometry, y: number) => {
    add(base);
    const h = new THREE.Group();
    h.position.y = y;
    add(hg, h);
    obj.add(h);
    head = h;
  };
  switch (kind) {
    case 'hq': add(geos.hq); break;
    case 'wall': add(wallGeo); break;
    case 'spikes': add(geos.spikes); break;
    case 'turret': withHead(geos.turretBase, geos.turretHead, 1.35); break;
    case 'cannon': withHead(geos.turretBase, geos.cannonHead, 1.4); break;
    case 'flame': withHead(geos.turretBase, geos.flameHead, 1.3); break;
    case 'mortar': withHead(geos.mortarBase, geos.mortarHead, 0.08); break;
    case 'tower': withHead(geos.tower, geos.lookout, 4.0); break;
  }
  return { obj, head: head as THREE.Object3D | null };
}

function wallCircles(x: number, z: number, rot: number) {
  const ax = rot ? 0 : 1, az = rot ? 1 : 0;
  return [-0.7, 0, 0.7].map((o) => ({ x: x + ax * o, z: z + az * o, r: 0.42 }));
}
function buildCircles(kind: BuildKind | 'hq', x: number, z: number, rot: number): Collider[] {
  if (kind === 'hq') return [{ x, z, r: 2.4 }];
  if (kind === 'wall') return wallCircles(x, z, rot);
  if (kind === 'spikes') return [];
  return [{ x, z, r: BUILDS[kind].r }];
}
const MUZZLE: Partial<Record<BuildKind | 'hq', number>> = { hq: 1.6, turret: 1.3, cannon: 2.0, flame: 1.1, mortar: 0.6, tower: 1.2 };
const BAR_Y: Record<BuildKind | 'hq', number> = { hq: 5.6, wall: 1.7, turret: 2.4, cannon: 2.5, flame: 2.3, mortar: 1.6, tower: 6.3, spikes: 0.9 };

function makeBuilding(kind: BuildKind | 'hq', x: number, z: number, rot = 0): Building {
  const { obj, head } = buildingVisual(kind, lambert, true);
  if (kind === 'wall' && rot) obj.rotation.y = Math.PI / 2;
  obj.position.set(x, 0, z);
  scene.add(obj);
  const def = kind === 'hq' ? null : BUILDS[kind];
  const hp = kind === 'hq' ? HQ.hp : def!.hp;
  const bar = new HpBar(kind === 'hq' ? 3.4 : 1.4, BAR_Y[kind]);
  obj.add(bar.group);
  const gun: GunDef | null = kind === 'hq' ? HQ : def && def.range ? (def as GunDef) : null;
  const b: Building = {
    id: nextId++, type: 'building', kind, x, z,
    r: kind === 'hq' ? 2.4 : kind === 'spikes' ? 1.1 : def!.r,
    hp, maxHp: hp, dead: false, gun, muzzle: MUZZLE[kind] ?? 1, gunY: kind === 'hq' ? 2.4 : def?.gunY ?? 1.4,
    obj, head, colliders: [], bar, cd: 0, aim: null, retarget: 0,
  };
  b.colliders = buildCircles(kind, x, z, rot).map((c) => ({ ...c, owner: b }));
  for (const c of b.colliders) dynamics.add(c);
  buildings.push(b);
  refreshNav();
  return b;
}

function refreshNav() {
  const all: Collider[] = [];
  for (const b of buildings) if (!b.dead) all.push(...b.colliders);
  nav.setBuildings(all);
}

/** Distance from a point to the edge of an entity (walls use their collider chain). */
function edgeDist(e: Unit | Building, x: number, z: number) {
  if (e.type === 'unit' || !e.colliders.length) return Math.hypot(e.x - x, e.z - z) - e.r;
  let best = Infinity;
  for (const c of e.colliders) best = Math.min(best, Math.hypot(c.x - x, c.z - z) - c.r);
  return best;
}
function nearestCollider(b: Building, x: number, z: number): Pt {
  let best: Pt = b;
  let bd = Infinity;
  for (const c of b.colliders) {
    const d = Math.hypot(c.x - x, c.z - z) - c.r;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// ------------------------------------------------------------ combat

function damageZombie(z: Zombie, dmg: number) {
  if (z.dead) return;
  z.hp -= dmg;
  z.flash = 0.09;
  if (z.hp <= 0) killZombie(z);
}

function killZombie(z: Zombie) {
  z.dead = true;
  const t = ZTYPES[z.t];
  S.kills++;
  S.scrap += t.bounty;
  fx.gore(z.x, z.z, 1.1 * t.scale, ZLOOKS[z.t].skin, z.t === 2 ? 16 : 7, z.t === 2 ? 1.3 : 1);
  fx.decal(z.x, z.z, t.scale * 1.1);
  sfx.kill();
}

function explode(x: number, z: number, r: number, dmg: number) {
  forZombiesNear(x, z, r, (zz, d2) => {
    const d = Math.sqrt(d2);
    damageZombie(zz, dmg * (1 - 0.5 * Math.min(1, d / r)));
    if (!zz.dead && d > 0.01) {
      const k = (0.8 * Math.max(0, 1 - d / (r + zz.r))) / (zz.t === 2 ? 3 : 1);
      zz.x += ((zz.x - x) / d) * k;
      zz.z += ((zz.z - z) / d) * k;
    }
  });
  fx.explosion(x, z, r);
  sfx.boom(r >= 2.8);
}

function lob(sx: number, sy: number, sz: number, tx: number, tz: number, dmg: number, r: number, opts: { dur?: number; h?: number; big?: boolean } = {}) {
  if (lobs.length >= LOB_CAP) return;
  const d = Math.hypot(tx - sx, tz - sz);
  lobs.push({ sx, sy, sz, tx, tz, t: 0, dur: opts.dur ?? 0.5 + d * 0.05, h: opts.h ?? 1.5 + d * 0.22, dmg, r, big: !!opts.big });
}

/** Fire one shot from a gun at a target. (x,z) is the shooter, yaw its aim. */
function fireGun(gun: GunDef, x: number, y: number, z: number, yaw: number, muzzle: number, target: Zombie) {
  const mx = x + Math.sin(yaw) * muzzle, mz = z + Math.cos(yaw) * muzzle;
  const s = ZTYPES[target.t].scale;
  switch (gun.weapon) {
    case 'bullet':
      fx.tracer(mx, y, mz, target.x + (Math.random() - 0.5) * 0.3, 1.1 * s, target.z + (Math.random() - 0.5) * 0.3, gun.tracer);
      damageZombie(target, gun.dmg);
      break;
    case 'shell':
      fx.tracer(mx, y, mz, target.x, 0.8 * s, target.z, gun.tracer);
      fx.muzzle(mx, y, mz);
      explode(target.x, target.z, gun.splash ?? 2, gun.dmg);
      break;
    case 'lob':
      lob(mx, y, mz, target.x + (Math.random() - 0.5) * 0.6, target.z + (Math.random() - 0.5) * 0.6, gun.dmg, gun.splash ?? 2);
      fx.smoke(mx, y, mz, 0.25);
      break;
    case 'flame': {
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      const reach = gun.splash ?? gun.range;
      forZombiesNear(x, z, reach, (zz, d2) => {
        const d = Math.sqrt(d2) || 0.01;
        if (((zz.x - x) * dx + (zz.z - z) * dz) / d < 0.8) return;
        damageZombie(zz, gun.dmg);
        zz.burn = 2.5;
      });
      fx.flame(mx, y, mz, dx, dz, reach / 4.8);
      break;
    }
  }
  sfx.shot(gun.gun);
}

function damageEnt(e: Unit | Building, dmg: number) {
  if (e.dead) return;
  e.hp -= dmg;
  if (e.type === 'unit') sfx.hit();
  if (e.hp > 0) return;
  e.dead = true;
  if (e.type === 'unit') {
    if (e.def.vehicle) {
      fx.explosion(e.x, e.z, 3);
      sfx.boom(true);
      fx.gore(e.x, e.z, 1, 0x3a3f33, 14, 1.4);
    } else {
      fx.gore(e.x, e.z, 1.2, 0x5a6b3c, 10);
      fx.decal(e.x, e.z, 1.2);
    }
    scene.remove(e.obj);
  } else {
    fx.gore(e.x, e.z, 0.8, 0x8a7a5a, e.kind === 'hq' ? 40 : 14, 1.2);
    if (e.kind !== 'wall' && e.kind !== 'spikes') fx.explosion(e.x, e.z, e.kind === 'hq' ? 4 : 2);
    for (const c of e.colliders) dynamics.remove(c);
    scene.remove(e.obj);
    sfx.collapse();
    refreshNav();
    if (e.kind === 'hq') gameOver();
  }
}

// ------------------------------------------------------------ waves

const SIDES = [
  (c: number) => ({ x: c, z: -HALF + 1 }),
  (c: number) => ({ x: HALF - 1, z: c }),
  (c: number) => ({ x: c, z: HALF - 1 }),
  (c: number) => ({ x: -HALF + 1, z: c }),
];

function startWave() {
  S.wave++;
  S.phase = 'wave';
  const n = S.wave;
  const total = Math.round(10 + n * 5 + Math.pow(n, 1.55));
  const runnerShare = n >= 3 ? Math.min(0.35, (n - 2) * 0.06) : 0;
  let brutes = n >= 4 ? Math.floor((n - 2) / 2) : 0;
  const bruteWave = n % 5 === 0;
  if (bruteWave) brutes += (n / 5) * 3;
  S.hpMult = 1 + (n - 1) * 0.1;
  S.speedMult = 1 + Math.min(0.3, (n - 1) * 0.015);

  const sideCount = Math.min(4, 1 + (n >= 3 ? 1 : 0) + (n >= 7 ? 1 : 0) + (n >= 12 ? 1 : 0));
  const sides = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, sideCount);
  const centers = sides.map(() => (Math.random() * 2 - 1) * (HALF - 18));
  const q: { t: number; side: number; center: number }[] = [];
  for (let i = 0; i < total; i++) {
    const k = i % sides.length;
    q.push({ t: Math.random() < runnerShare ? 1 : 0, side: sides[k], center: centers[k] });
  }
  for (let i = 0; i < brutes; i++) {
    const k = i % sides.length;
    q.splice(Math.floor(Math.random() * q.length), 0, { t: 2, side: sides[k], center: centers[k] });
  }
  S.spawnQueue = q;
  S.spawnInterval = Math.max(0.05, (10 + n * 1.2) / q.length);
  S.spawnTimer = 0;
  const where = sides.map((s) => ['NORTH', 'EAST', 'SOUTH', 'WEST'][s]).join(' + ');
  banner(`WAVE ${n}`, bruteWave ? `Brutes incoming from the ${where}` : `${q.length} zombies from the ${where}`, bruteWave);
  sfx.horde();
}

function spawnZombie(t: number, side: number, center: number) {
  const def = ZTYPES[t];
  let p = SIDES[side](center + (Math.random() - 0.5) * 22);
  for (let i = 0; i < 12 && (!statics.free(p.x, p.z, def.r) || !isFinite(nav.flowAt(p.x, p.z))); i++) p = SIDES[side](center + (Math.random() - 0.5) * 26);
  const hp = def.hp * S.hpMult;
  const tint = new THREE.Color().setHSL(0.25 + (Math.random() - 0.5) * 0.12, 0.15, 0.75 + Math.random() * 0.2);
  zombies.push({
    id: nextId++, t, x: p.x, z: p.z, hp, maxHp: hp,
    speed: def.speed * S.speedMult * (0.85 + Math.random() * 0.3), r: def.r, dps: def.dps,
    yaw: 0, phase: Math.random() * 10, flash: 0, burn: 0, slow: 1, target: null, think: 0, attacking: false,
    tint: new THREE.Color(tint.r * 1.25, tint.g * 1.25, tint.b * 1.25), dead: false,
    px: p.x, pz: p.z, stuck: 0, shove: 0,
  });
}

function waveCleared() {
  const bonus = 40 + S.wave * 15;
  S.scrap += bonus;
  S.phase = 'build';
  S.buildTimer = 25;
  banner(`WAVE ${S.wave} HELD`, `+${bonus} scrap. Next wave in 25s`);
  sfx.clear();
}

// ------------------------------------------------------------ call-ins

const jetGeo = jetGeometry();
const crateGeo = crateGeometry();
interface Jet { obj: THREE.Mesh; x: number; z: number; vx: number; drops: number[]; endX: number }
interface Crate { obj: THREE.Group; canopy: THREE.Mesh; x: number; z: number; y: number; landed: number }
let jets: Jet[] = [];
let crates: Crate[] = [];

function callIn(kind: CallKind, x: number, z: number) {
  const def = CALLS[kind];
  if (S.cd[kind] > 0) return false;
  if (S.scrap < def.cost) {
    flashScrap();
    sfx.error();
    return false;
  }
  if (kind === 'para' && popUsed() >= UNIT_CAP) {
    banner('SQUAD FULL', `Max ${UNIT_CAP} squad slots`);
    sfx.error();
    return false;
  }
  S.scrap -= def.cost;
  S.cd[kind] = def.cooldown;
  sfx.radio();
  if (kind === 'airstrike') {
    const obj = new THREE.Mesh(jetGeo, lambert);
    obj.castShadow = true;
    obj.rotation.y = Math.PI / 2;
    obj.scale.setScalar(1.3);
    const startX = x - 75;
    obj.position.set(startX, 15, z);
    scene.add(obj);
    const drops = [-6, -3.6, -1.2, 1.2, 3.6, 6].map((o) => x + o);
    jets.push({ obj, x: startX, z, vx: 48, drops, endX: x + 80 });
    later(0.4, () => sfx.jet());
  } else if (kind === 'artillery') {
    for (let i = 0; i < 9; i++) {
      later(1.6 + i * 0.28 + Math.random() * 0.15, () => {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * def.radius;
        const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
        sfx.whistle();
        lob(tx - 4, 34, tz - 6, tx, tz, 90, 2.6, { dur: 0.9, h: 0 });
      });
    }
  } else if (kind === 'supply') {
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(crateGeo, lambert));
    const canopy = new THREE.Mesh(canopyGeo, lambert);
    obj.add(canopy);
    obj.traverse((o) => (o.castShadow = true));
    obj.position.set(x, 18, z);
    scene.add(obj);
    crates.push({ obj, canopy, x, z, y: 18, landed: 0 });
  } else {
    const room = Math.min(4, UNIT_CAP - popUsed());
    for (let i = 0; i < room; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      const cell = nav.nearestOpen(x + Math.cos(a) * 1.6, z + Math.sin(a) * 1.6, 0.42);
      const px = cell >= 0 ? Math.floor(cell / NAV_N) - NAV_N / 2 + 0.5 : x;
      const pz = cell >= 0 ? (cell % NAV_N) - NAV_N / 2 + 0.5 : z;
      spawnUnit('rifle', px, pz, 16 + i * 1.5);
    }
  }
  return true;
}

function updateCallIns(dt: number) {
  for (const k of CALL_ORDER) S.cd[k] = Math.max(0, S.cd[k] - dt);
  for (const j of jets) {
    j.x += j.vx * dt;
    j.obj.position.x = j.x;
    j.obj.rotation.z = Math.sin(S.time * 3) * 0.05;
    while (j.drops.length && j.x >= j.drops[0] - 2) {
      const bx = j.drops.shift()!;
      lob(j.x, 14, j.z, bx, j.z + (Math.random() - 0.5) * 1.2, 140, 3, { dur: 0.55, h: 0, big: true });
    }
  }
  jets = jets.filter((j) => {
    if (j.x < j.endX) return true;
    scene.remove(j.obj);
    return false;
  });
  for (const c of crates) {
    if (!c.landed) {
      c.y = Math.max(0, c.y - dt * 6);
      c.obj.position.y = c.y;
      c.obj.rotation.y += dt * 0.6;
      if (c.y <= 0) {
        c.landed = 0.001;
        c.obj.remove(c.canopy);
        const R = CALLS.supply.radius;
        for (const u of units) {
          if (u.dead || Math.hypot(u.x - c.x, u.z - c.z) > R) continue;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.7);
          for (let i = 0; i < 4; i++) fx.sparkle(u.x, 1, u.z);
        }
        for (const b of buildings) {
          if (b.dead || Math.hypot(b.x - c.x, b.z - c.z) > R + b.r) continue;
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.5);
          for (let i = 0; i < 4; i++) fx.sparkle(b.x, 1.5, b.z, 0xffc060);
        }
        fx.gore(c.x, c.z, 0.2, 0x6b5a3a, 6, 0.6);
        sfx.heal();
        sfx.build();
      }
    } else c.landed += dt;
  }
  crates = crates.filter((c) => {
    if (c.landed < 8) return true;
    scene.remove(c.obj);
    return false;
  });
}

function updateLobs(dt: number) {
  let n = 0;
  for (const l of lobs) {
    l.t += dt / l.dur;
    if (l.t >= 1) {
      explode(l.tx, l.tz, l.r, l.dmg);
      continue;
    }
    const t = l.t;
    const y = l.sy + (0.2 - l.sy) * t + l.h * 4 * t * (1 - t);
    dummy.position.set(l.sx + (l.tx - l.sx) * t, y, l.sz + (l.tz - l.sz) * t);
    dummy.rotation.set(t * 10, t * 7, 0);
    dummy.scale.setScalar(l.big ? 2.2 : 1);
    dummy.updateMatrix();
    lobMesh.setMatrixAt(n++, dummy.matrix);
  }
  lobs = lobs.filter((l) => l.t < 1);
  lobMesh.count = n;
  lobMesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------ input state + camera

const keys = new Set<string>();
const mouse = { x: 0, y: 0, inside: false };
let drag: { x: number; y: number; active: boolean; button: number } | null = null;
let paintingWalls = false;
let lastPaint = '';
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

function groundAt(sx: number, sy: number): THREE.Vector3 | null {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, hitPoint);
}

const cam = { x: 0, z: 4, dist: 38, tdist: 38 };
function placeCamera(dt: number) {
  cam.dist += (cam.tdist - cam.dist) * Math.min(1, dt * 10);
  cam.x = Math.max(-HALF, Math.min(HALF, cam.x));
  cam.z = Math.max(-HALF, Math.min(HALF + 6, cam.z));
  const sh = fx.shake * 0.5;
  const ox = (Math.random() - 0.5) * sh, oz = (Math.random() - 0.5) * sh;
  camera.position.set(cam.x + ox, cam.dist * 0.84, cam.z + cam.dist * 0.55 + oz);
  camera.lookAt(cam.x + ox, 0, cam.z + oz);
  sun.position.set(cam.x - 30, 55, cam.z + 18);
  sun.target.position.set(cam.x, 0, cam.z);
}

// ------------------------------------------------------------ placement ghosts + call-in targeting

const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7ee06a, transparent: true, opacity: 0.45, depthWrite: false });
const ghosts = new Map<BuildKind, THREE.Object3D>();
const ringLine = (r: number, color = 0xffffff, op = 0.25) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
  m.position.y = 0.06;
  return m;
};
for (const kind of BASE_ORDER) {
  const { obj } = buildingVisual(kind, ghostMat, false);
  const def = BUILDS[kind];
  if (def.range) obj.add(ringLine(def.range));
  if (def.minRange) obj.add(ringLine(def.minRange, 0xff5a45, 0.35));
  obj.visible = false;
  scene.add(obj);
  ghosts.set(kind, obj);
}

const targetRing = ringLine(1, 0xffd166, 0.8);
const targetLine = new THREE.Mesh(new THREE.BoxGeometry(14, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.6, depthWrite: false }));
targetLine.position.y = 0.08;
const targetMarker = new THREE.Group();
targetMarker.add(targetRing, targetLine);
targetMarker.visible = false;
scene.add(targetMarker);

function snap(v: number) {
  return Math.round(v * 2) / 2;
}
function placementSpot(): { x: number; z: number; ok: boolean } | null {
  if (!S.placing || !mouse.inside) return null;
  const p = groundAt(mouse.x, mouse.y);
  if (!p) return null;
  const x = snap(p.x), z = snap(p.z);
  const kind = S.placing;
  const def = BUILDS[kind];
  let ok = S.scrap >= def.cost;
  if (kind === 'spikes') {
    if (!statics.free(x, z, 0.8) || !dynamics.free(x, z, 0.8)) ok = false;
    for (const b of buildings) if (!b.dead && b.kind === 'spikes' && Math.hypot(b.x - x, b.z - z) < 2) ok = false;
    if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) ok = false;
    return { x, z, ok };
  }
  for (const c of buildCircles(kind, x, z, S.wallRot)) {
    if (Math.abs(c.x) > HALF - 2 || Math.abs(c.z) > HALF - 2) ok = false;
    if (!statics.free(c.x, c.z, c.r * 0.8)) ok = false;
    // walls can butt up against walls; everything else needs room
    if (!dynamics.free(c.x, c.z, kind === 'wall' ? 0.2 : c.r * 0.9)) ok = false;
  }
  return { x, z, ok };
}
function tryPlace(): boolean {
  const spot = placementSpot();
  if (!spot || !S.placing) return false;
  if (!spot.ok) {
    if (S.scrap < BUILDS[S.placing].cost) flashScrap();
    sfx.error();
    return false;
  }
  S.scrap -= BUILDS[S.placing].cost;
  makeBuilding(S.placing, spot.x, spot.z, S.wallRot);
  // anyone standing where the building went steps aside
  for (const u of units) if (!u.dead) dynamics.resolve(u, u.r);
  sfx.build();
  return true;
}
function setPlacing(kind: BuildKind | null) {
  S.placing = kind;
  if (kind) {
    S.targeting = null;
    targetMarker.visible = false;
  }
  for (const [k, g] of ghosts) g.visible = k === kind;
  refreshButtons();
}
function setTargeting(kind: CallKind | null) {
  if (kind && S.cd[kind] > 0) {
    sfx.error();
    return;
  }
  if (kind && S.scrap < CALLS[kind].cost) {
    flashScrap();
    sfx.error();
    return;
  }
  if (kind) setPlacing(null);
  S.targeting = kind;
  targetMarker.visible = !!kind;
  if (kind) {
    targetRing.scale.setScalar(CALLS[kind].radius);
    targetLine.visible = kind === 'airstrike';
  }
  refreshButtons();
}

// ------------------------------------------------------------ selection + orders

function selected() {
  return units.filter((u) => u.selected && !u.dead);
}
function setSelected(list: Unit[], additive: boolean) {
  if (!additive) for (const u of units) u.selected = false;
  for (const u of list) u.selected = true;
  for (const u of units) u.ring.visible = u.selected;
  refreshSelection();
}
const proj = new THREE.Vector3();
function screenPos(x: number, y: number, z: number) {
  proj.set(x, y, z).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((proj.x + 1) / 2) * r.width, y: r.top + ((1 - proj.y) / 2) * r.height };
}
function unitAtScreen(sx: number, sy: number): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const u of units) {
    if (u.dead) continue;
    const p = screenPos(u.x, u.def.vehicle ? 0.8 : 1, u.z);
    const lim = u.def.vehicle ? 44 : 28;
    const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d < lim * lim && d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

const markerMat = new THREE.MeshBasicMaterial({ color: 0x7ee06a, transparent: true, opacity: 1, depthWrite: false, fog: false });
const marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 20).rotateX(-Math.PI / 2), markerMat);
marker.visible = false;
scene.add(marker);
let markerLife = 0;

function orderMove(x: number, z: number) {
  const sel = selected();
  if (!sel.length) return;
  // infantry form a block; vehicles line up in a wider row in front of it
  const slots: Pt[] = [];
  const inf = sel.filter((u) => !u.def.vehicle).sort((a, b) => a.x - b.x || a.z - b.z);
  const veh = sel.filter((u) => u.def.vehicle).sort((a, b) => a.x - b.x);
  const cols = Math.ceil(Math.sqrt(inf.length));
  inf.forEach((_, i) => {
    const cx = (i % cols) - (cols - 1) / 2;
    const cz = Math.floor(i / cols) - (Math.ceil(inf.length / cols) - 1) / 2;
    slots.push({ x: x + cx * 1.4, z: z + cz * 1.4 + (veh.length ? 1.6 : 0) });
  });
  veh.forEach((_, i) => slots.push({ x: x + (i - (veh.length - 1) / 2) * 3.2, z: z - (inf.length ? 2.4 : 0) }));
  [...inf, ...veh].forEach((u, i) => {
    const s = slots[i];
    moveUnit(u, Math.max(-HALF + 2, Math.min(HALF - 2, s.x)), Math.max(-HALF + 2, Math.min(HALF - 2, s.z)));
  });
  marker.position.set(x, 0.07, z);
  marker.visible = true;
  markerLife = 0.6;
}

// ------------------------------------------------------------ training

function train(kind: UnitKind) {
  if (S.phase === 'title' || S.phase === 'over') return;
  const def = UNITS[kind];
  if (S.scrap < def.cost) {
    flashScrap();
    sfx.error();
    return;
  }
  if (popUsed() + def.pop > UNIT_CAP) {
    banner('SQUAD FULL', `Max ${UNIT_CAP} squad slots`);
    sfx.error();
    return;
  }
  S.scrap -= def.cost;
  // roll out of the HQ door and step forward to an open spot
  const a = Math.PI / 2 + (Math.random() - 0.5) * 1.0;
  const out = def.vehicle ? 4.2 : 3.4;
  const u = spawnUnit(kind, hq.x + Math.cos(a) * out, hq.z + Math.sin(a) * out);
  u.yaw = u.aimYaw = Math.atan2(Math.cos(a), Math.sin(a));
  moveUnit(u, hq.x + Math.cos(a) * (out + 2.5) + (Math.random() - 0.5) * 2, hq.z + Math.sin(a) * (out + 2.5));
  if (def.vehicle) sfx.engine();
  else sfx.train();
}

// ------------------------------------------------------------ update: units

function turnToward(cur: number, target: number, maxStep: number) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function updateUnits(dt: number) {
  for (const u of units) {
    if (u.dead) continue;
    const def = u.def;

    // parachuting in
    if (u.drop > 0) {
      u.drop = Math.max(0, u.drop - dt * 4.5);
      u.obj.position.set(u.x, u.drop, u.z);
      u.obj.rotation.y = u.yaw + Math.sin(S.time * 2 + u.id) * 0.2;
      if (u.drop === 0 && u.canopy) {
        u.obj.remove(u.canopy);
        u.canopy = null;
        fx.gore(u.x, u.z, 0.1, 0x6b5a3a, 3, 0.3);
      }
      continue;
    }

    // movement along the path
    let moveYaw: number | null = null;
    if (u.moving && u.path.length) {
      const wp = u.path[0];
      const dx = wp.x - u.x, dz = wp.z - u.z;
      const d = Math.hypot(dx, dz);
      const last = u.path.length === 1;
      if (d < (last ? 0.25 : 0.6)) {
        u.path.shift();
        if (!u.path.length) u.moving = false;
      } else {
        moveYaw = Math.atan2(dx, dz);
        let speed = def.speed;
        if (def.vehicle) {
          // vehicles steer: turn first, then drive
          u.yaw = turnToward(u.yaw, moveYaw, dt * (u.kind === 'tank' ? 1.6 : 3.2));
          const off = angleDiff(u.yaw, moveYaw);
          speed *= off > 1 ? 0.15 : off > 0.4 ? 0.5 : 1;
          const step = Math.min(d, speed * dt);
          u.x += Math.sin(u.yaw) * step;
          u.z += Math.cos(u.yaw) * step;
        } else {
          const step = Math.min(d, speed * dt);
          u.x += (dx / d) * step;
          u.z += (dz / d) * step;
        }
        u.walk += dt * speed * 2.6;
      }
    } else u.moving = false;

    // keep apart from each other (big things shove small things)
    for (const o of units) {
      if (o === u || o.dead || o.drop > 0) continue;
      const dx = u.x - o.x, dz = u.z - o.z;
      const rr = u.r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = ((rr - d) / d) * (o.r / rr) * 0.6;
        u.x += dx * push;
        u.z += dz * push;
      }
    }
    statics.resolve(u, u.r);
    dynamics.resolve(u, u.r);
    u.x = Math.max(-HALF + 1, Math.min(HALF - 1, u.x));
    u.z = Math.max(-HALF + 1, Math.min(HALF - 1, u.z));

    // pressed against something and not getting anywhere? re-plan, then give up
    if (u.moving) {
      const moved = Math.hypot(u.x - u.px, u.z - u.pz);
      u.stuck = moved < def.speed * dt * 0.2 ? u.stuck + dt : 0;
      if (u.stuck > 0.7 && u.dest) {
        u.stuck = 0;
        if (u.repath++ < 3) {
          const p = nav.path(u.x, u.z, u.dest.x, u.dest.z, u.r);
          if (p) u.path = p;
          else u.moving = false;
        } else u.moving = false;
      }
    }
    u.px = u.x;
    u.pz = u.z;

    // tanks run zombies over
    if (def.crush && moveYaw !== null) {
      forZombiesNear(u.x, u.z, u.r, (zz, d2) => {
        damageZombie(zz, (zz.t === 2 ? 40 : 260) * dt);
        const d = Math.sqrt(d2) || 0.01;
        const rr = u.r + zz.r;
        if (!zz.dead && d < rr) {
          zz.x += ((zz.x - u.x) / d) * (rr - d);
          zz.z += ((zz.z - u.z) / d) * (rr - d);
        }
      });
    }

    // combat
    u.cd -= dt;
    u.retarget -= dt;
    if (u.aim && (u.aim.dead || Math.hypot(u.aim.x - u.x, u.aim.z - u.z) > def.range + u.aim.r + 0.5)) u.aim = null;
    if (!u.aim && u.retarget <= 0) {
      u.aim = nearestZombie(u.x, u.z, def.range, def.minRange);
      u.retarget = 0.15 + Math.random() * 0.1;
    }
    if (u.aim) {
      const want = Math.atan2(u.aim.x - u.x, u.aim.z - u.z);
      u.aimYaw = turnToward(u.aimYaw, want, dt * (u.kind === 'tank' ? 3 : 12));
      if (u.cd <= 0 && angleDiff(u.aimYaw, want) < 0.25) {
        u.cd = 1 / def.rate;
        const y = u.kind === 'tank' ? 1.3 : u.kind === 'jeep' ? 1.55 : 1.3;
        const muzzle = u.kind === 'tank' ? 3.0 : u.kind === 'jeep' ? 1.0 : 1.1;
        fireGun(def, u.x, y, u.z, u.aimYaw, muzzle, u.aim);
      }
      // riflemen lob a grenade into a tight crowd now and then
      u.nadeCd -= dt;
      if (def.nades && u.nadeCd <= 0 && u.aim && !u.aim.dead) {
        const t = u.aim;
        const d = Math.hypot(t.x - u.x, t.z - u.z);
        let crowd = 0;
        forZombiesNear(t.x, t.z, 2.4, () => crowd++);
        if (crowd >= 4 && d > 3) {
          lob(u.x, 1.6, u.z, t.x, t.z, 55, 2.4);
          sfx.shot('launcher');
          u.nadeCd = 14 + Math.random() * 4;
        } else u.nadeCd = 1;
      }
    } else if (moveYaw !== null) u.aimYaw = turnToward(u.aimYaw, def.vehicle ? u.yaw : moveYaw, dt * 10);

    // support roles
    u.supportCd -= dt;
    if ((def.heal || def.repair) && u.supportCd <= 0) {
      u.supportCd = 0.25;
      if (def.heal) {
        let healed = false;
        for (const o of units) {
          if (o.dead || o.drop > 0 || o.hp >= o.maxHp || Math.hypot(o.x - u.x, o.z - u.z) > 5.5) continue;
          o.hp = Math.min(o.maxHp, o.hp + def.heal * 0.25);
          if (Math.random() < 0.5) fx.sparkle(o.x, 1.2, o.z);
          healed = true;
        }
        if (healed) sfx.heal();
      }
      if (def.repair) {
        let worst: Building | null = null;
        for (const b of buildings) {
          if (b.dead || b.hp >= b.maxHp || edgeDist(b, u.x, u.z) > 4.5) continue;
          if (!worst || b.hp / b.maxHp < worst.hp / worst.maxHp) worst = b;
        }
        if (worst) {
          worst.hp = Math.min(worst.maxHp, worst.hp + def.repair * 0.25);
          fx.sparkle(worst.x + (Math.random() - 0.5) * worst.r, 1.2, worst.z + (Math.random() - 0.5) * worst.r, 0xffc060);
          if (!u.aim) u.aimYaw = Math.atan2(worst.x - u.x, worst.z - u.z);
          sfx.repair();
        }
      }
    }

    // pose
    if (!def.vehicle) u.yaw = u.aim || !u.moving ? u.aimYaw : moveYaw ?? u.yaw;
    u.obj.position.set(u.x, !def.vehicle && u.moving ? Math.abs(Math.sin(u.walk)) * 0.06 : 0, u.z);
    u.obj.rotation.y = u.yaw;
    if (u.legs) {
      const swing = u.moving ? Math.sin(u.walk) * 0.6 : 0;
      u.legs[0].rotation.x = swing;
      u.legs[1].rotation.x = -swing;
    }
    if (u.head) u.head.rotation.y = u.aimYaw - u.yaw;
    if (def.vehicle && u.moving && Math.random() < dt * 6) fx.smoke(u.x - Math.sin(u.yaw) * u.r * 1.3, 0.8, u.z - Math.cos(u.yaw) * u.r * 1.3, 0.2);
    u.bar.set(u.hp / u.maxHp, u.selected || u.hp < u.maxHp, u.yaw);
  }
}

// ------------------------------------------------------------ update: buildings

function updateBuildings(dt: number) {
  for (const b of buildings) {
    if (b.dead) continue;
    const gun = b.gun;
    if (gun) {
      b.cd -= dt;
      b.retarget -= dt;
      if (b.aim && (b.aim.dead || Math.hypot(b.aim.x - b.x, b.aim.z - b.z) > gun.range + 0.5)) b.aim = null;
      if (!b.aim && b.retarget <= 0) {
        b.aim = nearestZombie(b.x, b.z, gun.range, gun.minRange);
        b.retarget = 0.15;
      }
      if (b.aim) {
        const yaw = Math.atan2(b.aim.x - b.x, b.aim.z - b.z);
        if (b.head) b.head.rotation.y = turnToward(b.head.rotation.y, yaw, dt * 8);
        const hy = b.head ? b.head.rotation.y : yaw;
        if (b.cd <= 0 && angleDiff(hy, yaw) < 0.3) {
          b.cd = 1 / gun.rate;
          fireGun(gun, b.x, b.gunY, b.z, hy, b.muzzle, b.aim);
        }
      }
    }
    b.bar.set(b.hp / b.maxHp, b.hp < b.maxHp || b.kind === 'hq', b.obj.rotation.y);
  }
}

// ------------------------------------------------------------ update: zombies

function pickTarget(z: Zombie): Unit | Building | null {
  let best: Unit | Building | null = null;
  let bd = AGGRO;
  for (const u of units) {
    if (u.dead || u.drop > 0) continue;
    const d = edgeDist(u, z.x, z.z);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  for (const b of buildings) {
    if (b.dead || b.kind === 'hq' || b.kind === 'spikes') continue;
    // barricades are a last resort: they only get chewed when in the way
    const d = edgeDist(b, z.x, z.z) + (b.kind === 'wall' ? 4 : 0);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best ?? (hq.dead ? null : hq);
}

function updateZombies(dt: number) {
  const traps = buildings.filter((b) => b.kind === 'spikes' && !b.dead);
  for (const z of zombies) {
    if (z.dead) continue;
    // fire
    if (z.burn > 0) {
      z.burn -= dt;
      damageZombie(z, 14 * dt);
      if (Math.random() < dt * 10) fx.burn(z.x, 1.2 * ZTYPES[z.t].scale, z.z);
      if (z.dead) continue;
    }
    // spike traps
    z.slow = 1;
    for (const tr of traps) {
      if (tr.dead || Math.hypot(z.x - tr.x, z.z - tr.z) >= 1.1 + z.r * 0.5) continue;
      z.slow = 0.45;
      damageZombie(z, 30 * dt);
      damageEnt(tr, (z.t === 2 ? 8 : 2.5) * dt);
      if (Math.random() < dt * 3) fx.gore(z.x, z.z, 0.3, 0x7a1612, 1, 0.4);
    }
    if (z.dead) continue;

    z.think -= dt;
    if (z.think <= 0 || !z.target || z.target.dead || (z.target.type === 'unit' && z.target.drop > 0)) {
      z.target = pickTarget(z);
      z.think = 0.4 + Math.random() * 0.4;
    }
    const tgt = z.target;
    z.attacking = false;
    if (tgt) {
      const reach = edgeDist(tgt, z.x, z.z) - z.r;
      const tp = tgt.type === 'unit' ? tgt : nearestCollider(tgt, z.x, z.z);
      let dx = tp.x - z.x, dz = tp.z - z.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      // far from an HQ target: follow the flow field around the scenery
      if (tgt === hq && reach > 3) {
        const f = nav.flowDir(z.x, z.z);
        if (f) {
          dx = f.x;
          dz = f.z;
        }
      }
      z.yaw = turnToward(z.yaw, Math.atan2(dx, dz), dt * 6);
      if (reach < 0.3) {
        z.attacking = true;
        const mult = z.t === 2 && tgt.type === 'building' ? 2 : 1;
        damageEnt(tgt, z.dps * mult * dt);
      } else {
        const sp = z.speed * z.slow;
        z.x += dx * sp * dt;
        z.z += dz * sp * dt;
        z.phase += dt * sp * 2.2;
      }
    }
    // crowd separation
    const cx = Math.floor(z.x / ZCELL), cz = Math.floor(z.z / ZCELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++)
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = zgrid.get(zkey(ix, iz));
        if (!list) continue;
        for (const o of list) {
          if (o === z || o.dead) continue;
          const dx = z.x - o.x, dz = z.z - o.z;
          const rr = z.r + o.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = ((rr - d) / d) * (o.r / rr) * 0.6; // brutes shove smaller zombies aside
            z.x += dx * push;
            z.z += dz * push;
          }
        }
      }
    // don't walk through soldiers or vehicles
    for (const u of units) {
      if (u.dead || u.drop > 0) continue;
      const dx = z.x - u.x, dz = z.z - u.z;
      const rr = z.r + u.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        z.x += (dx / d) * (rr - d);
        z.z += (dz / d) * (rr - d);
      }
    }
    if (z.shove > 0) z.shove -= dt;
    else statics.resolve(z, z.r);
    const blocker = dynamics.resolveHit(z, z.r) as BCollider | null;
    // blocked by a barricade or turret on the way? tear it down
    if (blocker && blocker.owner !== z.target && !blocker.owner.dead && (!z.target || z.target.type === 'building' || edgeDist(z.target, z.x, z.z) > 1.5)) {
      z.target = blocker.owner;
      z.think = 2;
    }
    // wedged on scenery while chasing something? fall back to the HQ route for a bit
    if (!z.attacking) {
      const moved = Math.hypot(z.x - z.px, z.z - z.pz);
      z.stuck = moved < z.speed * z.slow * dt * 0.2 ? z.stuck + dt : Math.max(0, z.stuck - dt);
      if (z.stuck > 1 && z.target !== hq && !hq.dead) {
        z.target = hq;
        z.think = 3;
        z.stuck = 0;
      } else if (z.stuck > 1.5) {
        z.shove = 1.2;
        z.stuck = 0;
      }
    } else z.stuck = 0;
    z.px = z.x;
    z.pz = z.z;
    z.x = Math.max(-HALF - 2, Math.min(HALF + 2, z.x));
    z.z = Math.max(-HALF - 2, Math.min(HALF + 2, z.z));
    z.flash = Math.max(0, z.flash - dt);
  }
}

function drawZombies(time: number) {
  const counts = [0, 0, 0];
  for (const z of zombies) {
    if (z.dead) continue;
    const def = ZTYPES[z.t];
    const mesh = zMeshes[z.t];
    const i = counts[z.t]++;
    if (i >= ZCAP) continue;
    const sway = z.attacking ? Math.sin(time * 12 + z.phase) * 0.15 : Math.sin(z.phase) * 0.14;
    const lean = z.attacking ? 0.25 + Math.sin(time * 12 + z.phase) * 0.2 : 0.08;
    dummy.position.set(z.x, Math.abs(Math.cos(z.phase)) * 0.07 * def.scale, z.z);
    dummy.rotation.set(lean, z.yaw, sway);
    dummy.scale.setScalar(def.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (z.flash > 0) tmpC.setRGB(4, 4, 4);
    else if (z.burn > 0) tmpC.setRGB(1.6, 0.8, 0.4);
    else tmpC.copy(z.tint);
    mesh.setColorAt(i, tmpC);
  }
  zMeshes.forEach((m, t) => {
    m.count = Math.min(ZCAP, counts[t]);
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
}

function updateMarker(dt: number) {
  if (markerLife > 0) {
    markerLife -= dt;
    marker.scale.setScalar(0.6 + markerLife);
    markerMat.opacity = Math.max(0, markerLife / 0.6);
    if (markerLife <= 0) marker.visible = false;
  }
}

// ------------------------------------------------------------ HUD

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hud = {
  wave: $('wave'), phase: $('phase'), scrap: $('scrap'), units: $('units'), kills: $('kills'),
  hqFill: $('hq-fill'), hqText: $('hq-text'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
  cmd: $('cmd'), tabs: $('tabs'), calls: $('calls'), sel: $('sel'), drag: $('dragbox'), mini: $<HTMLCanvasElement>('mini'),
  title: $('title'), over: $('over'), pause: $('pause'), next: $('next'),
};

let bannerTimer = 0;
function banner(title: string, sub: string, danger = false) {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.banner.classList.toggle('danger', danger);
  hud.banner.classList.add('show');
  bannerTimer = 3.2;
}
function flashScrap() {
  const el = hud.scrap.parentElement!;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

interface CmdButton { el: HTMLButtonElement; cost: number; kind: UnitKind | BuildKind; tab: Tab }
interface CallButton { el: HTMLButtonElement; cdEl: HTMLElement; kind: CallKind }
const cmdButtons: CmdButton[] = [];
const callButtons: CallButton[] = [];

function buildCommandCard() {
  hud.cmd.innerHTML = '';
  const add = (tab: Tab, kind: UnitKind | BuildKind, i: number, name: string, cost: number, desc: string, extra: string) => {
    const el = document.createElement('button');
    el.className = `cmd ${tab}`;
    el.innerHTML = `<span class="key">${i + 1}</span><span class="ico ico-${kind}"></span><span class="nm">${name}</span><span class="cost">${cost}</span><span class="tip"><b>${name}</b>${extra}<br>${desc}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      unlockAudio();
      command(kind);
    });
    hud.cmd.appendChild(el);
    cmdButtons.push({ el, cost, kind, tab });
  };
  SQUAD_ORDER.forEach((k, i) => {
    const d = UNITS[k];
    add('squad', k, i, d.name, d.cost, d.desc, ` · ${d.hp} HP${d.pop > 1 ? ` · ${d.pop} slots` : ''}`);
  });
  BASE_ORDER.forEach((k, i) => {
    const d = BUILDS[k];
    add('base', k, i, d.name, d.cost, d.desc, ` · ${d.hp} HP${d.range ? ` · range ${d.range}` : ''}`);
  });
  hud.tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setTab(b.dataset.tab as Tab);
    }),
  );
  hud.calls.innerHTML = '';
  for (const k of CALL_ORDER) {
    const d = CALLS[k];
    const el = document.createElement('button');
    el.className = 'call';
    el.innerHTML = `<span class="ico ico-${k}"></span><span class="ck">${d.key}</span><span class="cn">${d.name}</span><span class="cost">${d.cost}</span><span class="cdv"></span><span class="tip"><b>${d.name}</b> · ${d.cooldown}s cooldown<br>${d.desc}</span>`;
    const cdEl = el.querySelector('.cdv') as HTMLElement;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      unlockAudio();
      setTargeting(S.targeting === k ? null : k);
    });
    hud.calls.appendChild(el);
    callButtons.push({ el, cdEl, kind: k });
  }
  setTab('squad');
}
function setTab(tab: Tab) {
  S.tab = tab;
  hud.tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  for (const b of cmdButtons) b.el.style.display = b.tab === tab ? '' : 'none';
}
function command(kind: UnitKind | BuildKind) {
  if (kind in BUILDS) setPlacing(S.placing === kind ? null : (kind as BuildKind));
  else train(kind as UnitKind);
}
function refreshButtons() {
  const pop = popUsed();
  for (const b of cmdButtons) {
    const unitDef = b.tab === 'squad' ? UNITS[b.kind as UnitKind] : null;
    b.el.classList.toggle('poor', S.scrap < b.cost || (!!unitDef && pop + unitDef.pop > UNIT_CAP));
    b.el.classList.toggle('active', S.placing === b.kind);
  }
  for (const c of callButtons) {
    const cd = S.cd[c.kind];
    c.el.classList.toggle('poor', S.scrap < CALLS[c.kind].cost);
    c.el.classList.toggle('cooling', cd > 0);
    c.el.classList.toggle('active', S.targeting === c.kind);
    c.cdEl.textContent = cd > 0 ? `${Math.ceil(cd)}` : '';
    c.el.style.setProperty('--cd', `${(cd / CALLS[c.kind].cooldown) * 100}%`);
  }
}
const plural = (n: string) => (n.endsWith('man') ? n.slice(0, -3) + 'men' : n + 's');
function refreshSelection() {
  const sel = selected();
  if (!sel.length) {
    hud.sel.innerHTML = `<div class="hint"><b>Drag</b> select · <b>Right-click</b> move · <b>Tab</b> squad/base<br><b>Z X C V</b> call-ins · <b>WASD</b> pan · <b>Q</b> all · <b>Space</b> HQ</div>`;
    return;
  }
  const counts: Record<string, number> = {};
  let hp = 0, max = 0;
  for (const u of sel) {
    counts[u.def.name] = (counts[u.def.name] ?? 0) + 1;
    hp += u.hp;
    max += u.maxHp;
  }
  const parts = Object.entries(counts).map(([n, c]) => `${c} ${c > 1 ? plural(n) : n}`);
  hud.sel.innerHTML = `<div class="selhead">${sel.length} selected</div><div>${parts.join(' · ')}</div><div class="selhp"><i style="width:${(hp / max) * 100}%"></i></div>`;
}

let hudTimer = 0;
function updateHud(dt: number) {
  hudTimer -= dt;
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) hud.banner.classList.remove('show');
  }
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  hud.wave.textContent = S.wave ? `WAVE ${S.wave}` : 'PREPARE';
  if (S.phase === 'build') {
    hud.phase.textContent = `Next wave in ${Math.ceil(S.buildTimer)}s`;
    hud.next.style.display = '';
    hud.next.textContent = `Send wave now (+${Math.floor(S.buildTimer) * 2})`;
  } else {
    const left = zombies.filter((z) => !z.dead).length + S.spawnQueue.length;
    hud.phase.textContent = `${left} zombies left`;
    hud.next.style.display = 'none';
  }
  hud.scrap.textContent = String(Math.floor(S.scrap));
  hud.units.textContent = `${popUsed()}/${UNIT_CAP}`;
  hud.kills.textContent = String(S.kills);
  const f = Math.max(0, hq.hp / hq.maxHp);
  hud.hqFill.style.width = `${f * 100}%`;
  hud.hqFill.classList.toggle('low', f < 0.35);
  hud.hqText.textContent = `${Math.max(0, Math.ceil(hq.hp))}`;
  refreshButtons();
  if (selected().length) refreshSelection();
  drawMinimap();
}

// ------------------------------------------------------------ minimap

const mctx = hud.mini.getContext('2d')!;
const MINI = 180;
hud.mini.width = MINI;
hud.mini.height = MINI;
function toMini(x: number, z: number) {
  return { x: ((x + HALF) / (HALF * 2)) * MINI, y: ((z + HALF) / (HALF * 2)) * MINI };
}
const miniBg = document.createElement('canvas');
miniBg.width = miniBg.height = MINI;
{
  const g = miniBg.getContext('2d')!;
  g.fillStyle = '#28331f';
  g.fillRect(0, 0, MINI, MINI);
  g.fillStyle = '#1a2416';
  for (const list of statics.cells.values())
    for (const c of list) {
      const p = toMini(c.x, c.z);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(1, c.r * (MINI / (HALF * 2))), 0, Math.PI * 2);
      g.fill();
    }
}
function drawMinimap() {
  mctx.drawImage(miniBg, 0, 0);
  mctx.fillStyle = '#ff4b3a';
  for (const z of zombies) {
    if (z.dead) continue;
    const p = toMini(z.x, z.z);
    const s = z.t === 2 ? 4 : 2;
    mctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  for (const b of buildings) {
    if (b.dead) continue;
    const p = toMini(b.x, b.z);
    mctx.fillStyle = b.kind === 'hq' ? '#ffd166' : b.gun ? '#9fd3ff' : '#c9b48a';
    const s = b.kind === 'hq' ? 8 : 3;
    mctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  for (const u of units) {
    if (u.dead) continue;
    const p = toMini(u.x, u.z);
    mctx.fillStyle = u.selected ? '#ffffff' : '#7ee06a';
    const s = u.def.vehicle ? 5 : 3;
    mctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  const r = renderer.domElement.getBoundingClientRect();
  const corners = [
    [r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom],
  ].map(([sx, sy]) => {
    const g = groundAt(sx, sy);
    return g ? toMini(g.x, g.z) : null;
  });
  if (corners.every(Boolean)) {
    mctx.strokeStyle = 'rgba(255,255,255,0.7)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    corners.forEach((c, i) => (i ? mctx.lineTo(c!.x, c!.y) : mctx.moveTo(c!.x, c!.y)));
    mctx.closePath();
    mctx.stroke();
  }
}
function miniJump(ev: PointerEvent) {
  const r = hud.mini.getBoundingClientRect();
  cam.x = ((ev.clientX - r.left) / r.width) * HALF * 2 - HALF;
  cam.z = ((ev.clientY - r.top) / r.height) * HALF * 2 - HALF;
}
hud.mini.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation();
  miniJump(ev);
  hud.mini.setPointerCapture(ev.pointerId);
});
hud.mini.addEventListener('pointermove', (ev) => {
  if (ev.buttons & 1) miniJump(ev);
});

// ------------------------------------------------------------ input wiring

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const touches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (ev) => {
  unlockAudio();
  if (S.phase === 'title' || S.phase === 'over') return;
  canvas.setPointerCapture(ev.pointerId);
  mouse.x = ev.clientX;
  mouse.y = ev.clientY;
  mouse.inside = true;
  if (ev.pointerType === 'touch') {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now() });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    return;
  }
  if (ev.button === 0) {
    if (S.targeting) {
      const p = groundAt(ev.clientX, ev.clientY);
      if (p && callIn(S.targeting, p.x, p.z)) setTargeting(null);
      return;
    }
    if (S.placing) {
      const kind = S.placing;
      tryPlace();
      if (kind === 'wall') {
        paintingWalls = true;
        const g = groundAt(ev.clientX, ev.clientY);
        lastPaint = g ? `${snap(g.x)},${snap(g.z)}` : '';
      } else if (!ev.shiftKey) setPlacing(null);
      return;
    }
    drag = { x: ev.clientX, y: ev.clientY, active: false, button: 0 };
  } else if (ev.button === 1) {
    drag = { x: ev.clientX, y: ev.clientY, active: true, button: 1 };
  } else if (ev.button === 2) {
    if (S.placing || S.targeting) {
      setPlacing(null);
      setTargeting(null);
      return;
    }
    const p = groundAt(ev.clientX, ev.clientY);
    if (p) orderMove(p.x, p.z);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  mouse.x = ev.clientX;
  mouse.y = ev.clientY;
  mouse.inside = true;
  if (ev.pointerType === 'touch') {
    const t = touches.get(ev.pointerId);
    if (!t) return;
    const dx = ev.clientX - t.x, dy = ev.clientY - t.y;
    t.x = ev.clientX;
    t.y = ev.clientY;
    if (touches.size === 1 && !S.placing && !S.targeting) {
      const k = (cam.dist / canvas.clientHeight) * 1.1;
      cam.x -= dx * k;
      cam.z -= dy * k * 1.4;
    } else if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) cam.tdist = Math.max(16, Math.min(60, cam.tdist * (pinchDist / d)));
      pinchDist = d;
    }
    return;
  }
  if (paintingWalls && S.placing === 'wall') {
    const p = groundAt(ev.clientX, ev.clientY);
    if (p) {
      // lay walls in 2-unit steps along the wall's axis
      const k = S.wallRot ? `${snap(p.x)},${Math.round(p.z / 2) * 2}` : `${Math.round(p.x / 2) * 2},${snap(p.z)}`;
      if (k !== lastPaint) {
        lastPaint = k;
        tryPlace();
      }
    }
    return;
  }
  if (!drag) return;
  if (drag.button === 1) {
    const k = (cam.dist / canvas.clientHeight) * 1.1;
    cam.x -= ev.movementX * k;
    cam.z -= ev.movementY * k * 1.4;
    return;
  }
  if (!drag.active && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) drag.active = true;
  if (drag.active) {
    const x0 = Math.min(drag.x, ev.clientX), y0 = Math.min(drag.y, ev.clientY);
    Object.assign(hud.drag.style, {
      display: 'block', left: `${x0}px`, top: `${y0}px`,
      width: `${Math.abs(ev.clientX - drag.x)}px`, height: `${Math.abs(ev.clientY - drag.y)}px`,
    });
  }
});

canvas.addEventListener('pointerup', (ev) => {
  if (ev.pointerType === 'touch') {
    const t = touches.get(ev.pointerId);
    touches.delete(ev.pointerId);
    if (!t) return;
    const tap = Math.hypot(ev.clientX - t.sx, ev.clientY - t.sy) < 12 && performance.now() - t.t < 400;
    if (touches.size < 2) pinchDist = 0;
    if (!tap) return;
    if (S.targeting) {
      const p = groundAt(ev.clientX, ev.clientY);
      if (p && callIn(S.targeting, p.x, p.z)) setTargeting(null);
      return;
    }
    if (S.placing) {
      tryPlace();
      return;
    }
    const u = unitAtScreen(ev.clientX, ev.clientY);
    if (u) setSelected([u], true);
    else if (selected().length) {
      const p = groundAt(ev.clientX, ev.clientY);
      if (p) orderMove(p.x, p.z);
    }
    return;
  }
  paintingWalls = false;
  if (!drag) return;
  const d = drag;
  drag = null;
  hud.drag.style.display = 'none';
  if (d.button !== 0) return;
  if (d.active) {
    const x0 = Math.min(d.x, ev.clientX), x1 = Math.max(d.x, ev.clientX);
    const y0 = Math.min(d.y, ev.clientY), y1 = Math.max(d.y, ev.clientY);
    const picked = units.filter((u) => {
      if (u.dead) return false;
      const p = screenPos(u.x, 1, u.z);
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    setSelected(picked, ev.shiftKey);
  } else {
    const u = unitAtScreen(ev.clientX, ev.clientY);
    if (u && ev.shiftKey) {
      u.selected = !u.selected;
      setSelected([], true);
    } else if (u && ev.detail >= 2) {
      // double-click: every unit of that type on screen
      const r = canvas.getBoundingClientRect();
      setSelected(units.filter((o) => {
        if (o.dead || o.kind !== u.kind) return false;
        const p = screenPos(o.x, 1, o.z);
        return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      }), false);
    } else setSelected(u ? [u] : [], false);
  }
});
canvas.addEventListener('pointerleave', () => (mouse.inside = false));
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  cam.tdist = Math.max(16, Math.min(60, cam.tdist * (ev.deltaY > 0 ? 1.12 : 0.89)));
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (S.phase === 'title') {
    if (k === 'enter' || k === ' ') startGame();
    return;
  }
  if (S.phase === 'over') {
    if (k === 'enter') startGame();
    return;
  }
  if (k === 'tab') {
    ev.preventDefault();
    setTab(S.tab === 'squad' ? 'base' : 'squad');
    return;
  }
  keys.add(k);
  if (k === 'escape') {
    if (S.placing || S.targeting) {
      setPlacing(null);
      setTargeting(null);
    } else togglePause();
  } else if (k === 'p') togglePause();
  if (S.paused) return;
  const num = Number(k);
  if (num >= 1 && num <= 9) {
    const list: (UnitKind | BuildKind)[] = S.tab === 'squad' ? SQUAD_ORDER : BASE_ORDER;
    const kind = list[num - 1];
    if (kind) command(kind);
    return;
  }
  const call = CALL_ORDER.find((c) => CALLS[c].key.toLowerCase() === k);
  if (call) {
    setTargeting(S.targeting === call ? null : call);
    return;
  }
  if (k === 'r') S.wallRot = S.wallRot ? 0 : 1;
  else if (k === 'q' || (k === 'a' && (ev.ctrlKey || ev.metaKey))) {
    ev.preventDefault();
    setSelected(units.filter((u) => !u.dead), false);
  } else if (k === ' ') {
    ev.preventDefault();
    cam.x = hq.x;
    cam.z = hq.z + 4;
  } else if (k === 'm') toggleMute();
  else if (k === 'n' && S.phase === 'build') sendWaveNow();
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => {
  keys.clear();
  if (S.phase === 'build' || S.phase === 'wave') setPaused(true);
});

function sendWaveNow() {
  if (S.phase !== 'build') return;
  S.scrap += Math.floor(S.buildTimer) * 2;
  startWave();
}
hud.next.addEventListener('click', () => {
  unlockAudio();
  sendWaveNow();
});
$('selall').addEventListener('click', () => setSelected(units.filter((u) => !u.dead), false));

function togglePause() {
  setPaused(!S.paused);
}
function setPaused(p: boolean) {
  if (S.phase !== 'build' && S.phase !== 'wave') return;
  S.paused = p;
  hud.pause.classList.toggle('show', p);
}
$('resume').addEventListener('click', () => setPaused(false));

// ------------------------------------------------------------ game flow

function clearWorld() {
  for (const u of units) scene.remove(u.obj);
  for (const b of buildings) {
    scene.remove(b.obj);
    for (const c of b.colliders) dynamics.remove(c);
  }
  for (const j of jets) scene.remove(j.obj);
  for (const c of crates) scene.remove(c.obj);
  units = [];
  buildings = [];
  zombies = [];
  lobs = [];
  jets = [];
  crates = [];
  fx.clear();
}

function setupBase() {
  hq = makeBuilding('hq', 0, 0);
  for (let i = 0; i < 4; i++) spawnUnit('rifle', -2.1 + i * 1.4, 5.2);
  for (const x of [-4, -2, 2, 4]) makeBuilding('wall', x, 8.5, 0);
}

function startGame() {
  unlockAudio();
  clearWorld();
  Object.assign(S, {
    phase: 'build', paused: false, wave: 0, buildTimer: 35, scrap: 300, kills: 0, time: 0, spawnQueue: [], timers: [],
    cd: { airstrike: 0, artillery: 0, supply: 0, para: 0 },
  });
  setupBase();
  cam.x = 0;
  cam.z = 4;
  setPlacing(null);
  setTargeting(null);
  setSelected([], false);
  hud.title.classList.remove('show');
  hud.over.classList.remove('show');
  hud.pause.classList.remove('show');
  banner('HOLD THE LINE', 'Train a squad, build defenses, call in support. First wave in 35s');
}

function gameOver() {
  S.phase = 'over';
  setPlacing(null);
  setTargeting(null);
  sfx.lose();
  const reached = S.wave;
  const isBest = reached > S.best;
  if (isBest) {
    S.best = reached;
    try {
      localStorage.setItem('rotwave.bestWave', String(reached));
    } catch {
      /* ignore */
    }
  }
  $('over-stats').innerHTML = `You held out until <b>wave ${reached}</b> and put down <b>${S.kills}</b> zombies.<br>${isBest ? '<span class="best">New best!</span>' : `Best: wave ${S.best}`}`;
  setTimeout(() => hud.over.classList.add('show'), 1200);
}

$('play').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('best-line').textContent = S.best ? `Best: wave ${S.best}` : '';

// ------------------------------------------------------------ main loop

function update(dt: number) {
  S.time += dt;
  const pan = cam.dist * 0.9 * dt;
  if (keys.has('w') || keys.has('arrowup')) cam.z -= pan;
  if (keys.has('s') || keys.has('arrowdown')) cam.z += pan;
  if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
  if (keys.has('d') || keys.has('arrowright')) cam.x += pan;

  if (S.phase === 'build') {
    S.buildTimer -= dt;
    if (S.buildTimer <= 0) startWave();
  } else if (S.phase === 'wave') {
    S.spawnTimer -= dt;
    while (S.spawnTimer <= 0 && S.spawnQueue.length) {
      const s = S.spawnQueue.shift()!;
      spawnZombie(s.t, s.side, s.center);
      S.spawnTimer += S.spawnInterval;
    }
    if (!S.spawnQueue.length && zombies.every((z) => z.dead)) waveCleared();
  }
  if (S.timers.length) {
    const due = S.timers.filter((t) => t.at <= S.time);
    S.timers = S.timers.filter((t) => t.at > S.time);
    for (const t of due) t.fn();
  }

  rebuildZGrid();
  updateUnits(dt);
  updateBuildings(dt);
  if (S.phase !== 'over' || zombies.length) updateZombies(dt);
  updateLobs(dt);
  updateCallIns(dt);

  // ambient zombie moans while the dead are about
  S.groan -= dt;
  if (S.groan <= 0) {
    const alive = zombies.length;
    if (alive) sfx.groan();
    S.groan = alive > 60 ? 0.6 + Math.random() : 1.5 + Math.random() * 2.5;
  }

  if (zombies.some((z) => z.dead)) zombies = zombies.filter((z) => !z.dead);
  if (units.some((u) => u.dead)) {
    const lost = units.some((u) => u.dead && u.selected);
    units = units.filter((u) => !u.dead);
    if (lost) refreshSelection();
  }
  if (buildings.some((b) => b.dead)) buildings = buildings.filter((b) => !b.dead || b === hq);
}

function updateGhost() {
  if (S.placing) {
    const g = ghosts.get(S.placing)!;
    const spot = placementSpot();
    g.visible = !!spot;
    if (spot) {
      g.position.set(spot.x, 0, spot.z);
      g.rotation.y = S.placing === 'wall' && S.wallRot ? Math.PI / 2 : 0;
      ghostMat.color.setHex(spot.ok ? 0x7ee06a : 0xff5a45);
    }
  }
  if (S.targeting && mouse.inside) {
    const p = groundAt(mouse.x, mouse.y);
    if (p) targetMarker.position.set(p.x, 0, p.z);
  }
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 58 : 40; // portrait screens need a wider view to see the base
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let clock = 0;
function tick(dt: number) {
  clock += dt;
  update(dt);
  fx.update(dt);
  updateMarker(dt);
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if ((S.phase === 'build' || S.phase === 'wave' || S.phase === 'over') && !S.paused) tick(dt);
  placeCamera(dt);
  updateGhost();
  drawZombies(clock);
  if (hq) updateHud(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Title-screen backdrop: an idle base so the scene isn't empty behind the menu.
buildCommandCard();
setupBase();
refreshSelection();
hud.title.classList.add('show');
requestAnimationFrame(frame);

// dev hook for testing from the console
(window as unknown as { __rot: unknown }).__rot = {
  S, cam, nav, startWave, train, callIn, makeBuilding, moveUnit, spawnUnit, spawnZombie, setTargeting, setPlacing,
  get units() { return units; }, get zombies() { return zombies; }, get buildings() { return buildings; },
  /** advance the sim n frames at 60fps and render once (works while the tab is hidden) */
  step(n: number) {
    for (let i = 0; i < n; i++) tick(1 / 60);
    placeCamera(1);
    drawZombies(clock);
    hudTimer = 0;
    updateHud(0);
    renderer.render(scene, camera);
  },
};
