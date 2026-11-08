// Motorcycle physics. Arcade-style: grip, drifting, jumps with backflips, wall bumps and wipeouts.
// Fixed 120 Hz step. Forward is (sin h, cos h) on the x/z ground plane; turning right lowers h.

import { CS, type Maze, cellAt, cellCenter, collide, dirHeading, heightAt, isOpen } from './maze';

export const DT = 1 / 120;
export const SAMPLE_EVERY = 12; // replay samples at 10 Hz

const MAXV = 31;
const BOOSTV = 44;
const ACC = 24;
const BRAKE = 36;
const REV = 7;
const G = 28;
const TURN = 2.5;
const GRIP = 12;
const DRIFT_GRIP = 2.2;
const RADIUS = 0.65;
const CRASH_V = 21;
const LAUNCH_MAX = 8;
const FLIP_TIME = 0.55;
const CRASH_TIME = 0.7;
const RESPAWN_SPEED = 15; // back on the bike already rolling, not from a standstill

export interface Input { thr: number; brk: number; steer: number; drift: boolean }
export const noInput = (): Input => ({ thr: 0, brk: 0, steer: 0, drift: false });

export interface Bike {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  h: number;
  pitch: number; // nose up is positive
  lean: number; // right is positive
  steer: number; // smoothed, for the front wheel
  grounded: boolean;
  crashT: number;
  tumble: number; // spin angle while crashed
  boostT: number;
  charge: number; // drift held this long
  drifting: boolean;
  flipT: number; // >0 while a backflip is under way
  airPitch: number; // rotation done this jump
  lastDrift: boolean;
  steps: number;
  finished: boolean;
  wheel: number; // wheel spin angle
}

export type Ev = 'crash' | 'land' | 'flip' | 'jump' | 'boost' | 'driftBoost' | 'scrape' | 'finish' | 'respawn';
export type Emit = (e: Ev, v: number) => void;

export function newBike(m: Maze): Bike {
  const [x, z] = cellCenter(m, m.start);
  return {
    x, y: 0, z, vx: 0, vy: 0, vz: 0, h: m.startH, pitch: 0, lean: 0, steer: 0, grounded: true,
    crashT: 0, tumble: 0, boostT: 0, charge: 0, drifting: false, flipT: 0, airPitch: 0, lastDrift: false,
    steps: 0, finished: false, wheel: 0,
  };
}

export const wrap = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
export const speedOf = (b: Bike) => Math.hypot(b.vx, b.vz);

function slopePitch(m: Maze, b: Bike) {
  const fx = Math.sin(b.h), fz = Math.cos(b.h);
  return Math.atan((heightAt(m, b.x + fx * 0.4, b.z + fz * 0.4) - heightAt(m, b.x - fx * 0.4, b.z - fz * 0.4)) / 0.8);
}

function crash(b: Bike, emit: Emit, v: number) {
  b.crashT = CRASH_TIME;
  b.tumble = 0;
  b.flipT = 0;
  b.boostT = 0;
  b.charge = 0;
  b.drifting = false;
  b.vy = Math.max(b.vy, 3 + Math.min(4, v * 0.15));
  b.grounded = false;
  emit('crash', v);
}

/** Back on the bike in the middle of the cell, rolling toward the open way closest to where we were going. */
function respawn(m: Maze, b: Bike, emit: Emit) {
  const c = Math.max(0, cellAt(m, b.x, b.z));
  const [x, z] = cellCenter(m, c);
  let best = b.h, err = 9;
  for (let d = 0; d < 4; d++) {
    if (!isOpen(m, c, d)) continue;
    const hd = dirHeading(d), e = Math.abs(wrap(hd - b.h));
    if (e < err) { err = e; best = b.h + wrap(hd - b.h); }
  }
  Object.assign(b, { x, z, y: heightAt(m, x, z), vx: Math.sin(best) * RESPAWN_SPEED, vy: 0, vz: Math.cos(best) * RESPAWN_SPEED, h: best, pitch: 0, lean: 0, grounded: true, crashT: 0, tumble: 0 });
  emit('respawn', 0);
}

export function step(m: Maze, b: Bike, inp: Input, emit: Emit) {
  if (b.finished) return;
  b.steps++;
  const fresh = inp.drift && !b.lastDrift;
  b.lastDrift = inp.drift;

  if (b.crashT > 0) {
    b.crashT -= DT;
    b.tumble += DT * (6 + speedOf(b) * 0.5);
    const k = Math.exp(-2.2 * DT);
    b.vx *= k; b.vz *= k;
    b.x += b.vx * DT; b.z += b.vz * DT;
    collide(m, b, RADIUS, 0.4);
    b.vy -= G * DT;
    b.y += b.vy * DT;
    const g = heightAt(m, b.x, b.z);
    if (b.y < g) { b.y = g; b.vy = Math.abs(b.vy) * 0.35; }
    if (b.crashT <= 0) respawn(m, b, emit);
    return;
  }

  const boosting = b.boostT > 0;
  b.boostT = Math.max(0, b.boostT - DT);

  if (b.grounded) {
    // Steer first, then see how much of the old velocity is now sideways: grip eats that.
    let fx = Math.sin(b.h), fz = Math.cos(b.h);
    let vF = b.vx * fx + b.vz * fz;
    const sp = Math.abs(vF);
    const auth = Math.min(1, sp / 5) * (1.15 - 0.45 * Math.min(1, sp / 40));
    const drifting = inp.drift && sp > 8;
    const rate = TURN * auth * (drifting ? 1.45 : 1);
    b.h -= inp.steer * rate * (vF < -0.2 ? -1 : 1) * DT;
    fx = Math.sin(b.h); fz = Math.cos(b.h);
    const rx = -fz, rz = fx; // right = (-cos h, sin h)
    vF = b.vx * fx + b.vz * fz;
    let vL = b.vx * rx + b.vz * rz;

    const top = boosting ? BOOSTV : MAXV;
    if (boosting && vF < top) vF += 30 * DT;
    if (inp.thr > 0 && vF < top) vF += inp.thr * ACC * (1 - Math.max(0, vF) / top) * DT;
    if (vF > top) vF -= (vF - top) * 1.5 * DT;
    if (inp.brk > 0) {
      if (vF > 0.3) vF -= BRAKE * inp.brk * DT;
      else vF = Math.max(-REV, vF - 12 * inp.brk * DT);
    }
    if (!inp.thr && !inp.brk) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 4 * DT);
    vF -= vF * 0.08 * DT;
    vL *= Math.exp(-(drifting ? DRIFT_GRIP : GRIP) * DT);

    b.drifting = drifting && Math.abs(vL) > 2.5;
    if (b.drifting && sp > 10) b.charge += DT;
    if (!inp.drift && b.charge > 0) {
      if (b.charge > 0.5) { b.boostT = Math.max(b.boostT, Math.min(1.6, 0.4 + b.charge * 0.7)); emit('driftBoost', b.charge); }
      b.charge = 0;
    }
    b.vx = fx * vF + rx * vL;
    b.vz = fz * vF + rz * vL;

    const leanT = inp.steer * Math.min(1, sp / 12) * 0.7 + (b.drifting ? Math.sign(-vL) * 0.25 : 0);
    b.lean += (leanT - b.lean) * Math.min(1, 8 * DT);
    const wheelie = inp.thr > 0 && sp < 9 && !boosting ? 0.3 * (1 - sp / 9) : boosting ? 0.08 : 0;
    const pT = slopePitch(m, b) + wheelie;
    b.pitch += (pT - b.pitch) * Math.min(1, 14 * DT);
  } else {
    // In the air: a little steering and pitch to set up the landing, and a backflip on the drift button.
    b.h -= inp.steer * 1.0 * DT;
    if (fresh && b.flipT <= 0 && Math.abs(b.airPitch) < 0.5) b.flipT = FLIP_TIME;
    if (b.flipT > 0) {
      const d = Math.min(b.flipT, DT);
      b.flipT -= DT;
      const rot = ((Math.PI * 2) / FLIP_TIME) * d;
      b.pitch += rot;
      b.airPitch += rot;
    } else {
      const pr = (inp.brk > 0 ? 1 : 0) - (inp.thr > 0 ? 1 : 0);
      b.pitch += pr * 1.2 * DT;
    }
    b.lean += (0 - b.lean) * Math.min(1, 4 * DT);
    b.vx *= 1 - 0.02 * DT;
    b.vz *= 1 - 0.02 * DT;
  }

  b.x += b.vx * DT;
  b.z += b.vz * DT;
  const hit = collide(m, b, RADIUS);
  if (hit > CRASH_V) { crash(b, emit, hit); return; }
  if (hit > 2) {
    emit('scrape', hit);
    const k = 1 - Math.min(0.3, hit * 0.015);
    b.vx *= k; b.vz *= k;
  }

  const g = heightAt(m, b.x, b.z);
  if (b.grounded) {
    const yPrev = b.y;
    b.vy -= G * DT;
    const yb = b.y + b.vy * DT;
    if (yb <= g + 0.001) {
      b.y = g;
      b.vy = (g - yPrev) / DT;
    } else {
      b.grounded = false;
      b.y = yb;
      b.vy = Math.min(b.vy, LAUNCH_MAX);
      b.airPitch = 0;
      if (b.vy > 2) emit('jump', b.vy);
    }
  } else {
    b.vy -= G * DT;
    b.y += b.vy * DT;
    if (b.y <= g) {
      const fall = -b.vy;
      b.y = g;
      b.vy = 0;
      b.grounded = true;
      const pErr = wrap(b.pitch - slopePitch(m, b));
      const hs = speedOf(b);
      const yErr = hs > 3 ? wrap(b.h - Math.atan2(b.vx, b.vz)) : 0;
      if (b.flipT > 0.05 || Math.abs(pErr) > 0.75 || Math.abs(yErr) > 1.2) { crash(b, emit, fall + hs * 0.3); return; }
      b.pitch = slopePitch(m, b);
      const flips = Math.round(Math.abs(b.airPitch) / (Math.PI * 2));
      b.airPitch = 0;
      b.flipT = 0;
      if (flips > 0) { b.boostT = Math.max(b.boostT, 1.4); emit('flip', flips); }
      emit('land', fall);
    }
  }

  if (m.boostAt[cellAt(m, b.x, b.z)] >= 0 && b.grounded && heightAt(m, b.x, b.z) === 0) {
    const [cx, cz] = cellCenter(m, cellAt(m, b.x, b.z));
    if (Math.abs(b.x - cx) < 2.5 && Math.abs(b.z - cz) < 2.5) {
      if (b.boostT < 0.2) emit('boost', 0);
      b.boostT = Math.max(b.boostT, 1.5);
    }
  }
  b.wheel += (b.vx * Math.sin(b.h) + b.vz * Math.cos(b.h)) * DT / 0.36;
  b.steer += (inp.steer - b.steer) * Math.min(1, 10 * DT);

  if (cellAt(m, b.x, b.z) === m.finish) { b.finished = true; emit('finish', b.steps); }
}

/** Cells per sample a replay is allowed to move; also used to check runs on the server. */
export const MAX_SAMPLE_MOVE = (BOOSTV * 1.3 * SAMPLE_EVERY * DT);
export { CS };
