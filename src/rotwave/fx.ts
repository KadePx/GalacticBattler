import * as THREE from 'three';

// Purely visual effects. Gameplay never reads anything from here.

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  c: THREE.Color;
  grav: number;
  spin: number;
}

const PUFF_CAP = 1400;
const CHUNK_CAP = 600;
const DECAL_CAP = 320;
const TRACER_CAP = 500;

export class Fx {
  shake = 0;
  private puffs: Puff[] = [];
  private chunks: Puff[] = [];
  private puffMesh: THREE.InstancedMesh;
  private chunkMesh: THREE.InstancedMesh;
  private decalMesh: THREE.InstancedMesh;
  private decalNext = 0;
  private tracers: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; life: number; c: number }[] = [];
  private tracerPos = new Float32Array(TRACER_CAP * 6);
  private tracerCol = new Float32Array(TRACER_CAP * 6);
  private tracerGeo = new THREE.BufferGeometry();
  private lights: THREE.PointLight[] = [];
  private lightNext = 0;
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial(), PUFF_CAP);
    this.chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshLambertMaterial({ flatShading: true }), CHUNK_CAP);
    this.decalMesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      DECAL_CAP,
    );
    for (const m of [this.puffMesh, this.chunkMesh, this.decalMesh]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this.puffMesh.renderOrder = 2;
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, fog: false }));
    lines.frustumCulled = false;
    scene.add(lines);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 14, 1.4);
      scene.add(l);
      this.lights.push(l);
    }
  }

  private puff(p: Omit<Puff, 'c' | 'spin'> & { color: number }) {
    if (this.puffs.length >= PUFF_CAP) this.puffs.shift();
    this.puffs.push({ ...p, c: new THREE.Color(p.color), spin: Math.random() * 6 });
  }

  /** Brief light at a point (muzzle flash, explosion). */
  flash(x: number, y: number, z: number, intensity: number, color = 0xffb060) {
    const l = this.lights[this.lightNext];
    this.lightNext = (this.lightNext + 1) % this.lights.length;
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.intensity = Math.max(l.intensity, intensity);
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: number) {
    if (this.tracers.length >= TRACER_CAP) this.tracers.shift();
    this.tracers.push({ ax, ay, az, bx, by, bz, life: 0.06, c });
    this.flash(ax, ay + 0.3, az, 6, 0xffc870);
  }

  /** Flying chunks with gravity (gore, debris). */
  gore(x: number, z: number, y: number, color: number, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      if (this.chunks.length >= CHUNK_CAP) this.chunks.shift();
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 3) * power;
      this.chunks.push({
        x, y, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4 * power, vz: Math.sin(a) * s,
        life: 0.8 + Math.random() * 0.8, max: 1.6, s0: 0.6 + Math.random() * 0.9, s1: 0,
        c: new THREE.Color(Math.random() < 0.55 && color !== 0x8a7a5a ? 0x7a1612 : color), grav: 18, spin: Math.random() * 10,
      });
    }
  }

  decal(x: number, z: number, s: number, color = 0x4a0e0c) {
    const d = this.dummy;
    d.position.set(x, 0.03 + Math.random() * 0.015, z);
    d.rotation.set(0, Math.random() * 6, 0);
    d.scale.set(s * (0.8 + Math.random() * 0.6), 1, s * (0.8 + Math.random() * 0.6));
    d.updateMatrix();
    this.decalMesh.setMatrixAt(this.decalNext, d.matrix);
    this.decalMesh.setColorAt(this.decalNext, this.tmp.setHex(color));
    this.decalNext = (this.decalNext + 1) % DECAL_CAP;
    this.decalMesh.count = Math.min(DECAL_CAP, this.decalMesh.count + 1);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    if (this.decalMesh.instanceColor) this.decalMesh.instanceColor.needsUpdate = true;
  }

  explosion(x: number, z: number, radius: number) {
    const k = radius / 2.5;
    for (let i = 0; i < 10 + radius * 4; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 5 * k;
      this.puff({
        x: x + Math.cos(a) * 0.3, y: 0.4, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * s, vy: 2 + Math.random() * 5, vz: Math.sin(a) * s,
        life: 0.3 + Math.random() * 0.25, max: 0.55, s0: 0.5 * k + 0.25, s1: 1.1 * k + 0.3,
        color: [0xfff1a0, 0xffb040, 0xff6a20][Math.floor(Math.random() * 3)], grav: -2,
      });
    }
    for (let i = 0; i < 4 + radius; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 2;
      this.puff({
        x, y: 0.6, z, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * s,
        life: 0.9 + Math.random() * 0.6, max: 1.5, s0: 0.4 * k + 0.25, s1: 1.4 * k + 0.4,
        color: [0x3a3632, 0x4a4540, 0x2c2a28][Math.floor(Math.random() * 3)], grav: -0.6,
      });
    }
    this.gore(x, z, 0.4, 0x3a3226, 6 + Math.round(radius * 2), 1.4);
    this.decal(x, z, radius * 0.9, 0x1c1a17);
    this.flash(x, 2, z, 40 * k, 0xffa040);
    this.shake = Math.min(1.2, this.shake + 0.25 * k);
  }

  /** A gout of flame from (x,y,z) heading along (dx,dz). */
  flame(x: number, y: number, z: number, dx: number, dz: number, len: number) {
    for (let i = 0; i < 3; i++) {
      const sp = len * (2.2 + Math.random() * 0.8);
      const j = (Math.random() - 0.5) * 0.5;
      const vx = (dx - dz * j) * sp, vz = (dz + dx * j) * sp;
      this.puff({
        x, y, z, vx, vy: 0.4 + Math.random(), vz,
        life: 0.32 + Math.random() * 0.12, max: 0.44, s0: 0.15, s1: 0.9,
        color: [0xfff0a0, 0xffb040, 0xff7020, 0xff5010][Math.floor(Math.random() * 4)], grav: -3,
      });
    }
    this.flash(x, y, z, 8, 0xff8a30);
  }

  /** Small flame on a burning zombie. */
  burn(x: number, y: number, z: number) {
    this.puff({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4, vx: 0, vy: 1.6, vz: 0,
      life: 0.35, max: 0.35, s0: 0.35, s1: 0.05, color: Math.random() < 0.5 ? 0xffa030 : 0xff6a20, grav: 0,
    });
  }

  smoke(x: number, y: number, z: number, size = 0.4) {
    this.puff({
      x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.8, vz: (Math.random() - 0.5) * 0.4,
      life: 1.2, max: 1.2, s0: size, s1: size * 2.5, color: 0x55524c, grav: 0,
    });
  }

  /** Rising green sparkles for heals and repairs. */
  sparkle(x: number, y: number, z: number, color = 0x8af07a) {
    this.puff({
      x: x + (Math.random() - 0.5) * 0.8, y, z: z + (Math.random() - 0.5) * 0.8, vx: 0, vy: 1.4, vz: 0,
      life: 0.6, max: 0.6, s0: 0.22, s1: 0.02, color, grav: 0,
    });
  }

  /** Muzzle smoke and spark for big guns. */
  muzzle(x: number, y: number, z: number) {
    for (let i = 0; i < 4; i++) this.smoke(x, y, z, 0.3);
    this.flash(x, y, z, 25, 0xffc060);
  }

  update(dt: number) {
    const d = this.dummy;
    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.puffs.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      p.vx *= 1 - dt * 2.5;
      p.vz *= 1 - dt * 2.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = 1 - p.life / p.max;
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.spin, p.spin * 0.6 + t, 0);
      d.scale.setScalar(Math.max(0.01, p.s0 + (p.s1 - p.s0) * t));
      d.updateMatrix();
      this.puffMesh.setMatrixAt(n, d.matrix);
      this.puffMesh.setColorAt(n, p.c);
      n++;
    }
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const g = this.chunks[i];
      g.life -= dt;
      if (g.life <= 0) {
        this.chunks.splice(i, 1);
        continue;
      }
      g.vy -= g.grav * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < 0.08) {
        g.y = 0.08;
        g.vy *= -0.3;
        g.vx *= 0.6;
        g.vz *= 0.6;
      }
      d.position.set(g.x, g.y, g.z);
      d.rotation.set(g.spin * g.life, g.spin * g.life * 0.7, 0);
      d.scale.setScalar(g.s0 * Math.min(1, g.life * 2));
      d.updateMatrix();
      this.chunkMesh.setMatrixAt(n, d.matrix);
      this.chunkMesh.setColorAt(n, g.c);
      n++;
    }
    this.chunkMesh.count = n;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;

    let t = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      const o = t * 6;
      const P = this.tracerPos, C = this.tracerCol;
      P[o] = tr.ax; P[o + 1] = tr.ay; P[o + 2] = tr.az;
      P[o + 3] = tr.bx; P[o + 4] = tr.by; P[o + 5] = tr.bz;
      this.tmp.setHex(tr.c);
      C[o] = this.tmp.r * 0.4; C[o + 1] = this.tmp.g * 0.4; C[o + 2] = this.tmp.b * 0.4;
      C[o + 3] = this.tmp.r; C[o + 4] = this.tmp.g; C[o + 5] = this.tmp.b;
      t++;
    }
    this.tracerGeo.setDrawRange(0, t * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;

    const decay = Math.pow(0.0005, dt);
    for (const l of this.lights) l.intensity *= decay;
    this.shake *= Math.pow(0.02, dt);
  }

  clear() {
    this.puffs.length = 0;
    this.chunks.length = 0;
    this.tracers.length = 0;
    this.decalMesh.count = 0;
    this.decalNext = 0;
  }
}
