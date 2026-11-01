// Settlers and goblins, painted at full resolution (ART real pixels per world unit) with animation frames.
// Every character faces right when painted; left-facing frames are mirrored copies.
import { GobKind, Job, JOBS } from './defs';
import { flip, OUTLINE, PAL, Paint, Spr, tint } from './sprites';

export type Pose = 'idle' | 'walk' | 'work' | 'attack';
export type Carry = '' | 'wood' | 'stone' | 'food' | 'fish';

/** Canvas size and the feet anchor, in real pixels. */
export const CH = { w: 36, h: 36, ax: 18, ay: 33 };

const HAIR = ['#6b3e22', '#3a2a20', '#c8963a', '#a8482a', '#e0d0a0', '#5a4a3a', '#2a2420', '#8a5a3a'];
const SKIN = ['#eab88c', '#d49a6c', '#a8704a', '#f2c8a0', '#8a5a3a'];
const STEEL = ['#eef1f4', '#c4cad2', '#8a9198', '#5c636b'];
const WOODC = ['#c08a52', '#8a5a32', '#5e3c20'];
const EYE = '#241814';

type Tool = '' | 'axe' | 'pick' | 'hammer' | 'hoe' | 'spear' | 'sword' | 'bow' | 'staff' | 'rod' | 'pouch' | 'knife' | 'club' | 'bigclub' | 'cleaver' | 'sling' | 'skullstaff';

interface Rig {
  fa: number; // front arm angle (0 = forward, +pi/2 = straight down)
  ba: number; // back arm angle
  ta: number; // tool angle
  bob: number; // body lift in px (negative = up)
  lean: number; // torso/head shift forward in px
  lf: number; lb: number; // leg forward offsets
  uf: number; ub: number; // leg lifts
  pull: number; // bow string pull
}

const DOWN = 1.5;
function rest(): Rig { return { fa: DOWN, ba: DOWN, ta: -1.1, bob: 0, lean: 0, lf: 0, lb: 0, uf: 0, ub: 0, pull: 0 }; }

function walkRig(r: Rig, f: number) {
  const ph = (f / 4) * Math.PI * 2, s = Math.sin(ph);
  r.lf = Math.round(s * 2); r.lb = -r.lf;
  r.uf = f === 1 ? 1 : 0; r.ub = f === 3 ? 1 : 0;
  r.bob = f % 2 ? -1 : 0;
  r.fa = DOWN - s * 0.55; r.ba = DOWN + s * 0.55;
}

// ---------- low-level helpers ----------
const dirOf = (a: number) => [Math.cos(a), Math.sin(a)];

/** A two-pixel-thick limb from (x, y) at angle a; returns the hand position. */
function limb(p: Paint, x: number, y: number, a: number, len: number, sleeve: string, hand: string): [number, number] {
  const [dx, dy] = dirOf(a);
  for (let t = 0; t <= len; t += 0.5) {
    const px = Math.round(x + dx * t), py = Math.round(y + dy * t);
    p.hR(px, py, 2, 2, t >= len - 1.2 ? hand : sleeve);
  }
  return [x + dx * len + 0.5, y + dy * len + 0.5];
}

/** Line along a direction from the hand: points hand + dir*a .. hand + dir*b, offset sideways by o. */
function seg(p: Paint, hx: number, hy: number, ang: number, a: number, b: number, col: string, o = 0) {
  const [dx, dy] = dirOf(ang), nx = -dy, ny = dx;
  p.line(hx + dx * a + nx * o, hy + dy * a + ny * o, hx + dx * b + nx * o, hy + dy * b + ny * o, col);
}

/** Draws a tool held at the hand. `side` is +1 when the working edge faces forward. */
function tool(p: Paint, t: Tool, hx: number, hy: number, ang: number, pull = 0) {
  const [dx, dy] = dirOf(ang), nx = -dy, ny = dx;
  // perpendicular that points "forward/down" of the swing, so blades face the target
  const side = nx * 1 + ny * 0.25 >= 0 ? 1 : -1;
  const at = (a: number, o: number) => [hx + dx * a + nx * o * side, hy + dy * a + ny * o * side];
  const dot = (a: number, o: number, c: string) => { const [x, y] = at(a, o); p.hp(x, y, c); };
  switch (t) {
    case 'axe':
      seg(p, hx, hy, ang, -2, 8, WOODC[1]); seg(p, hx, hy, ang, -2, 8, WOODC[2], side * -1);
      for (let a = 5.5; a <= 8.5; a += 0.5) for (let o = 1; o <= 3.5; o += 0.5) dot(a, o, o >= 3 ? STEEL[0] : a > 7.5 ? STEEL[2] : STEEL[1]);
      break;
    case 'pick':
      seg(p, hx, hy, ang, -2, 8, WOODC[1]); seg(p, hx, hy, ang, -2, 8, WOODC[2], -side);
      for (let o = -4; o <= 4; o += 0.5) { const bend = Math.abs(o) * 0.35; dot(8 - bend, o, Math.abs(o) > 3 ? STEEL[0] : STEEL[2]); dot(7.5 - bend, o, STEEL[1]); }
      break;
    case 'hammer':
      seg(p, hx, hy, ang, -1, 6, WOODC[1]);
      for (let a = 5; a <= 7.5; a += 0.5) for (let o = -2; o <= 2.5; o += 0.5) dot(a, o, a < 5.6 ? STEEL[1] : STEEL[2]);
      break;
    case 'hoe':
      seg(p, hx, hy, ang, -3, 11, WOODC[0]); seg(p, hx, hy, ang, -3, 11, WOODC[2], -side);
      for (let o = 0; o <= 3.5; o += 0.5) { dot(11, o, STEEL[2]); dot(10.5, o, STEEL[1]); }
      break;
    case 'spear':
      seg(p, hx, hy, ang, -6, 12, WOODC[1]); seg(p, hx, hy, ang, -6, 12, WOODC[2], -side);
      for (let a = 12; a <= 16; a += 0.5) { const w = (16 - a) * 0.4; for (let o = -w; o <= w; o += 0.5) dot(a, o, o > 0 ? STEEL[2] : STEEL[0]); }
      dot(11.5, 1, '#b73a2e'); dot(11.5, -1, '#b73a2e');
      break;
    case 'sword':
      seg(p, hx, hy, ang, -2, 0, '#5a3a20');
      for (let o = -2.5; o <= 2.5; o += 0.5) dot(0.5, o, '#b08a3a');
      for (let a = 1; a <= 9; a += 0.5) { dot(a, 0, STEEL[1]); dot(a, 0.5, a > 8 ? STEEL[1] : STEEL[0]); dot(a, -0.5, STEEL[2]); }
      break;
    case 'knife':
      seg(p, hx, hy, ang, -1, 0, '#5a3a20');
      for (let a = 1; a <= 5; a += 0.5) { dot(a, 0, '#9a8a78'); dot(a, 0.5, '#c8b8a0'); }
      break;
    case 'cleaver':
      seg(p, hx, hy, ang, -2, 1, '#3a2418');
      for (let a = 1; a <= 9; a += 0.5) for (let o = -1; o <= 2.5 + (a > 5 ? 1 : 0); o += 0.5) dot(a, o, o > 2.5 ? STEEL[0] : (a + o) % 3 < 0.6 ? '#7a5a48' : STEEL[2]);
      break;
    case 'club':
      for (let a = -1; a <= 7; a += 0.5) { const w = a > 3 ? 1 : 0.5; for (let o = -w; o <= w; o += 0.5) dot(a, o, o > 0 ? WOODC[2] : WOODC[1]); }
      break;
    case 'bigclub':
      for (let a = -2; a <= 10; a += 0.5) { const w = a > 4 ? 2 : 1; for (let o = -w; o <= w; o += 0.5) dot(a, o, o > 0.5 ? WOODC[2] : o < -0.5 ? WOODC[0] : WOODC[1]); }
      dot(6, 2.5, STEEL[0]); dot(8, -2.5, STEEL[0]); dot(9.5, 2.5, STEEL[0]);
      break;
    case 'staff':
      seg(p, hx, hy, ang, -6, 10, WOODC[1]); seg(p, hx, hy, ang, -6, 10, WOODC[2], -side);
      { const [ex, ey] = at(11.5, 0); p.E(Math.round(ex), Math.round(ey), 1, 1, (_x, _y, a2, b2) => (a2 + b2 < -0.3 ? '#e8ffd8' : '#7ad060')); }
      break;
    case 'skullstaff':
      seg(p, hx, hy, ang, -7, 11, '#4a3020');
      { const [ex, ey] = at(12, 0); p.hR(ex - 2, ey - 2, 5, 4, '#e8dcc0').hp(ex - 1, ey - 1, '#1a1210').hp(ex + 1, ey - 1, '#1a1210').hR(ex - 1, ey + 2, 3, 1, '#c8bca0'); }
      break;
    case 'rod':
      seg(p, hx, hy, ang, -2, 14, '#9a6a3a');
      break;
    case 'pouch':
      p.hR(hx - 1, hy, 4, 3, '#d9a22c').hR(hx, hy - 1, 2, 1, '#8a5a20').hp(hx, hy + 1, '#ffe58a');
      break;
    case 'sling': {
      // a short cord with a stone whirling at the end
      const [ex, ey] = at(5, 0);
      p.line(hx, hy, ex, ey, '#c8b890');
      p.hR(ex - 1, ey - 1, 2, 2, '#6a625a');
      break;
    }
    case 'bow': {
      // held upright in front of the hand; string pulled back by `pull`
      const top: [number, number] = [hx + 1, hy - 8], bot: [number, number] = [hx + 1, hy + 8];
      for (let i = 0; i <= 16; i++) {
        const k = i / 16, x = hx + 1 + Math.sin(k * Math.PI) * 3, y = hy - 8 + k * 16;
        p.hR(x, y, 1, 1, WOODC[1]); p.hp(x + 1, y, WOODC[2]);
      }
      const sx = hx + 1 - pull;
      p.line(top[0], top[1], sx, hy, '#efe6cf'); p.line(sx, hy, bot[0], bot[1], '#efe6cf');
      if (pull > 0) { p.line(sx, hy, hx + 6, hy, '#d8c8a0'); p.hp(hx + 7, hy, STEEL[1]); p.hp(sx - 1, hy - 1, '#e05a48'); p.hp(sx - 1, hy + 1, '#e05a48'); }
      break;
    }
  }
}

// ---------- settlers ----------
function settlerTool(job: Job): Tool {
  switch (job) {
    case 'woodcutter': return 'axe';
    case 'quarrier': return 'pick';
    case 'builder': return 'hammer';
    case 'farmer': return 'hoe';
    case 'militia': return 'spear';
    case 'shieldbearer': return 'sword';
    case 'archer': return 'bow';
    case 'healer': return 'staff';
    case 'fisher': return 'rod';
    case 'trader': return 'pouch';
    default: return '';
  }
}

/** Pose for a job, pose and frame. */
function settlerRig(job: Job, pose: Pose, f: number, carry: Carry): Rig {
  const r = rest();
  const t = settlerTool(job);
  if (t === 'spear' || t === 'staff') r.ta = -1.48;
  if (t === 'bow') { r.fa = 1.2; }
  if (t === 'rod') r.ta = -1.2;
  if (pose === 'walk') {
    walkRig(r, f);
    if (t === 'spear' || t === 'staff') { r.fa = 1.25; r.ta = -1.48; }
    else if (t === 'bow') r.fa = 1.2;
    else if (t) r.ta = -1.0 + (r.fa - DOWN) * 0.3;
  }
  if (pose === 'idle') { r.bob = f ? -0 : 0; r.fa += f ? 0.06 : 0; r.ba -= f ? 0.06 : 0; r.lean = 0; }
  if (carry && pose !== 'work' && pose !== 'attack') { r.fa = 0.35; r.ba = 0.5; }
  if (pose === 'work') {
    const swing = (arms: number[], off: number, lean: number[]) => { r.fa = arms[f]; r.ta = arms[f] - off; r.lean = lean[f]; r.ba = 0.9 + (arms[f] > 0 ? 0.3 : -0.4); };
    switch (job) {
      case 'woodcutter': swing([-2.1, -1.2, 0.35, 0.6], 0.6, [-1, 0, 1, 1]); break;
      case 'quarrier': swing([-2.5, -1.3, 0.7, 1.0], 0.55, [-1, 0, 1, 1]); r.bob = f >= 2 ? 1 : 0; break;
      case 'builder': swing([-1.5, -0.7, 0.55, 0.4], 0.6, [0, 0, 1, 0]); break;
      case 'farmer': swing([-1.7, -0.5, 1.0, 1.25], 0.35, [-1, 0, 1, 1]); r.bob = f >= 2 ? 1 : 0; break;
      case 'forager': r.fa = [-0.3, 0.1, 0.5, 0.1][f]; r.ba = 1.0; r.lean = 1; r.bob = f === 2 ? 1 : 0; break;
      case 'fisher': r.fa = 0.2; r.ta = [-0.75, -0.7, -0.65, -0.7][f]; r.ba = 0.6; break;
      case 'trader': r.fa = [-0.7, 0.2, -0.4, 0.6][f]; r.ta = 0; r.ba = [1.2, 0.8, 1.2, 0.8][f]; break;
      case 'healer': r.fa = [0.2, -0.4, -0.8, -0.4][f]; r.ta = -1.48; r.ba = [0.4, 0.2, 0.0, 0.2][f]; break;
      case 'militia': case 'shieldbearer': case 'archer': return settlerRig(job, 'attack', f % 3, carry);
      default: r.fa = [1.2, 0.8, 1.2, 1.5][f];
    }
  }
  if (pose === 'attack') {
    if (job === 'militia') { r.fa = [1.1, -0.05, 0.35][f]; r.ta = [-0.25, -0.02, -0.12][f]; r.lean = [-1, 2, 1][f]; r.ba = [1.2, 1.4, 1.3][f]; r.lf = [0, 2, 1][f]; r.lb = -r.lf; }
    else if (job === 'shieldbearer') { r.fa = [-2.0, 0.3, 0.9][f]; r.ta = [-2.5, 0.1, 0.6][f]; r.lean = [-1, 1, 1][f]; }
    else if (job === 'archer') { r.fa = 0; r.ba = 0.15; r.pull = [3, 5, 0][f]; r.ta = 0; }
    else { r.fa = [-1.6, 0.4, 0.9][f]; r.ta = r.fa - 0.6; r.lean = [-1, 1, 1][f]; }
  }
  return r;
}

function hat(p: Paint, job: Job, ax: number, hy: number, hair: string) {
  // hy = top row of the head
  const R = (x: number, y: number, w: number, h: number, c: string) => p.hR(ax + x, hy + y, w, h, c);
  switch (job) {
    case 'militia': // kettle helm
      R(-4, -1, 9, 3, STEEL[2]); R(-3, -2, 7, 1, STEEL[1]); R(-2, -2, 3, 1, STEEL[0]); R(-6, 2, 13, 1, STEEL[3]); R(-5, 1, 11, 1, STEEL[2]);
      break;
    case 'shieldbearer': // great helm with a visor slit
      R(-4, -2, 9, 8, STEEL[2]); R(-3, -2, 5, 1, STEEL[0]); R(-4, -1, 2, 6, STEEL[1]); R(1, 2, 4, 1, '#1a1210'); R(3, 4, 1, 2, '#1a1210'); R(-4, 6, 9, 1, STEEL[3]);
      break;
    case 'archer': // hood with a point at the back
      R(-4, -1, 9, 5, JOBS.archer.color); R(-5, 1, 2, 7, JOBS.archer.shade); R(-6, 2, 2, 3, JOBS.archer.shade); R(-2, -1, 4, 1, tint(JOBS.archer.color, 0.25));
      break;
    case 'farmer': // wide straw hat
      R(-6, 2, 14, 1, PAL.thatch[2]); R(-5, 1, 12, 1, PAL.thatch[1]); R(-3, -1, 7, 2, PAL.thatch[0]); R(-3, 0, 7, 1, '#b8503a');
      break;
    case 'builder': // leather cap
      R(-4, -1, 9, 3, '#d08a3a'); R(-3, -1, 4, 1, '#f0b060'); R(3, 1, 3, 1, '#94591c');
      break;
    case 'fisher': // sou'wester
      R(-5, -1, 10, 3, '#e8c84a'); R(-6, 2, 4, 2, '#c8a83a'); R(3, 1, 3, 1, '#c8a83a'); R(-3, -1, 4, 1, '#fff0a0');
      break;
    case 'woodcutter': // knit cap
      R(-4, -1, 9, 3, '#b84a3a'); R(-4, 1, 9, 1, '#8e3a2b'); R(-1, -2, 3, 1, '#e8e0c8');
      break;
    case 'quarrier': // headband
      R(-4, 2, 9, 1, '#5a6a8a');
      break;
    case 'healer': // white hood
      R(-4, -1, 9, 4, '#f2efe6'); R(-5, 1, 2, 8, '#d8d2c4'); R(-2, -1, 3, 1, '#ffffff');
      break;
    case 'trader': // feathered cap
      R(-4, -1, 9, 3, '#7a3a6a'); R(-5, 1, 11, 1, '#5a2a4e'); R(2, -4, 1, 4, '#e8c84a'); R(3, -5, 1, 2, '#f0e0a0');
      break;
    case 'forager': // headscarf
      R(-4, -1, 9, 3, '#7a9a4a'); R(-5, 2, 2, 3, '#5e7a36');
      break;
    default: break;
  }
  void hair;
}

function torsoStyle(job: Job): { c: string; d: string; trim?: string; robe?: boolean } {
  const j = JOBS[job];
  switch (job) {
    case 'healer': return { c: '#ece6d6', d: '#bdb5a2', trim: '#6aa040', robe: true };
    case 'trader': return { c: j.color, d: j.shade, trim: '#e8c84a', robe: true };
    case 'shieldbearer': return { c: '#9aa0aa', d: '#6a7078', trim: '#b73a2e' };
    case 'militia': return { c: j.color, d: j.shade, trim: '#e8dcc0' };
    default: return { c: j.color, d: j.shade };
  }
}

const frameCache = new Map<string, Spr>();
export function settlerFrame(job: Job, look: number, pose: Pose, f: number, face: number, carry: Carry = '', promo = ''): Spr {
  const key = `${job}|${look}|${pose}|${f}|${face > 0 ? 1 : 0}|${carry}|${promo}`;
  let c = frameCache.get(key);
  if (c) return c;
  if (face < 0) { c = flip(settlerFrame(job, look, pose, f, 1, carry, promo)); frameCache.set(key, c); return c; }
  const p = new Paint(CH.w, CH.h, 1);
  const r = settlerRig(job, pose, f, carry);
  const ax = CH.ax, gy = CH.ay - 1; // gy = lowest row of the feet
  const hair = HAIR[look % HAIR.length], skin = SKIN[(look >> 3) % SKIN.length], skinD = tint(skin, -0.18);
  const style = (look >> 1) % 4, beard = (look >> 5) % 3 === 0 && job !== 'shieldbearer';
  const ts = torsoStyle(job);
  const t = settlerTool(job);
  const pants = '#5a4636', pantsD = '#46362a', boot = '#2e2420';
  const top = gy - 22 + r.bob; // top of head
  const torsoY = top + 9, hipY = gy - 5;
  const L = ax + r.lean;

  // back arm, back leg, quiver and buckler sit behind the body
  const backArmSleeve = tint(ts.c, -0.25);
  if (job === 'archer') { p.hR(L - 6, torsoY - 3, 3, 8, '#7a4a22').hR(L - 6, torsoY - 4, 1, 2, '#e8e0c8').hR(L - 4, torsoY - 5, 1, 2, '#e05a48'); }
  const [bhx, bhy] = limb(p, L - 3, torsoY + 1, r.ba, 6, backArmSleeve, skinD);
  if (job === 'militia') p.E((L - 5) / 1 - 0.5, torsoY + 4, 2, 2, (hx, hy, nx, ny) => (nx * nx + ny * ny < 0.15 ? STEEL[1] : nx + ny < 0 ? '#9a6a3a' : '#7a5228'));
  if (job === 'forager') { p.hR(bhx - 2, bhy, 5, 4, '#a8783a').hR(bhx - 2, bhy, 5, 1, '#d8a868').hR(bhx - 1, bhy + 2, 3, 1, '#8a5a28'); if (carry) p.hR(bhx - 1, bhy - 1, 3, 1, '#d8304a'); }
  if (pose === 'attack' && job === 'archer') p.hR(bhx - 1, bhy - 1, 2, 2, skinD);
  // legs
  const leg = (x: number, lift: number, col: string) => { p.hR(x, hipY, 3, 5 - lift, col); p.hR(x - (lift ? 0 : 0), gy - 1 - lift, 4, 2, boot); };
  if (!ts.robe) { leg(ax - 3 + r.lb, r.ub, pantsD); leg(ax + r.lf, r.uf, pants); }
  else { leg(ax - 3 + Math.round(r.lb / 2), r.ub, pantsD); leg(ax + Math.round(r.lf / 2), r.uf, pants); }
  // torso
  const ty0 = torsoY, ty1 = ts.robe ? gy - 3 : hipY + 1;
  p.hR(L - 4, ty0 + 1, 9, ty1 - ty0, ts.c);
  p.hR(L - 3, ty0, 7, 1, ts.c);
  p.hR(L + 3, ty0 + 1, 2, ty1 - ty0, ts.d); // shaded front-right side
  p.hR(L - 4, ty0 + 1, 1, ty1 - ty0 - 1, tint(ts.c, 0.18)); // lit back edge
  if (ts.robe) { p.hR(L - 5, ty1 - 3, 11, 3, ts.c).hR(L + 3, ty1 - 3, 3, 3, ts.d); if (ts.trim) p.hR(L - 5, ty1 - 1, 11, 1, ts.trim); }
  if (!ts.robe) { p.hR(L - 4, hipY - 1, 9, 1, '#4a3020'); p.hp(L + 1, hipY - 1, '#d9a22c'); }
  if (ts.trim && !ts.robe) p.hR(L - 1, ty0 + 1, 3, ty1 - ty0 - 2, ts.trim);
  if (job === 'shieldbearer') for (let y = ty0 + 1; y < ty1; y += 2) for (let x = L - 3 + (y % 4 ? 0 : 1); x < L + 3; x += 2) p.hp(x, y, '#7c828c');
  if (job === 'builder') { p.hR(L - 1, ty0 + 3, 6, ty1 - ty0 - 2, '#8a5a32').hR(L - 1, ty0 + 3, 6, 1, '#a8703c'); }
  if (job === 'farmer') { p.hR(L - 1, ty0 + 1, 1, 4, '#5a6aa0').hR(L + 3, ty0 + 1, 1, 4, '#5a6aa0'); }
  if (promo) p.hR(L + 1, ty0 + 2, 2, 2, '#ffd166').hp(L + 1, ty0 + 2, '#fff2b0');
  // head
  const hx0 = L - 4, hy0 = top;
  p.hR(hx0 + 1, hy0, 7, 9, skin).hR(hx0, hy0 + 1, 9, 7, skin);
  p.hR(hx0 + 7, hy0 + 1, 2, 7, skinD); // jaw shade
  // hair
  const hairD = tint(hair, -0.25);
  if (job !== 'shieldbearer') {
    p.hR(hx0, hy0, 9, 3, hair).hR(hx0 + 1, hy0 - 1, 7, 1, hair).hR(hx0, hy0 + 3, 3, 3, hair).hp(hx0 + 7, hy0 + 3, hair);
    if (style === 1) p.hR(hx0 - 1, hy0 + 2, 3, 8, hairD).hR(hx0, hy0 + 3, 2, 7, hair);
    if (style === 2) p.hR(hx0 - 2, hy0 + 1, 3, 3, hairD);
    if (style === 3) p.hR(hx0 + 2, hy0 - 1, 5, 1, tint(hair, 0.2));
    p.hR(hx0 + 2, hy0, 3, 1, tint(hair, 0.22));
    if (beard) p.hR(hx0 + 4, hy0 + 6, 5, 3, hair).hR(hx0 + 5, hy0 + 9, 3, 1, hairD).hp(hx0 + 6, hy0 + 6, skin);
  }
  // face: two eyes, a cheek, an ear
  if (job !== 'shieldbearer') {
    p.hp(hx0 + 5, hy0 + 4, EYE).hp(hx0 + 5, hy0 + 5, EYE).hp(hx0 + 8, hy0 + 4, EYE).hp(hx0 + 8, hy0 + 5, EYE);
    p.hp(hx0 + 6, hy0 + 6, tint(skin, -0.1)).hp(hx0 + 7, hy0 + 6, '#e89a8a');
    p.hp(hx0 + 3, hy0 + 5, skinD);
  }
  hat(p, job, hx0 + 4, hy0, hair);
  // carried load in front of the chest
  if (carry && pose !== 'work' && pose !== 'attack' && job !== 'forager') {
    const cx = L + 2, cy = torsoY + 2;
    if (carry === 'wood') { for (const [x, y] of [[0, 2], [0, 0], [3, 1]]) { p.hR(cx + x, cy + y, 6, 2, '#a8703c'); p.hR(cx + x, cy + y, 6, 1, '#c89058'); p.hp(cx + x + 5, cy + y, '#e8c890').hp(cx + x + 5, cy + y + 1, '#8a5a32'); } }
    else if (carry === 'stone') p.hR(cx, cy, 6, 5, '#a09888').hR(cx + 1, cy, 4, 1, '#d0c8b8').hR(cx, cy + 4, 6, 1, '#726b62').hp(cx + 4, cy + 2, '#726b62');
    else if (carry === 'fish') p.hR(cx, cy + 1, 6, 2, '#8ab0c8').hp(cx + 6, cy, '#6a8aa8').hp(cx + 6, cy + 3, '#6a8aa8').hp(cx + 1, cy + 1, EYE);
    else p.hR(cx, cy + 1, 6, 4, '#a8783a').hR(cx + 1, cy, 4, 2, '#d8304a').hp(cx + 2, cy, '#ff7a8a');
  }
  // front arm and tool
  const [hx, hy] = limb(p, L + 1, torsoY + 1, r.fa, 6, tint(ts.c, -0.05), skin);
  // a full load means the tool is stowed (archers keep their bow)
  const hauling = !!carry && pose !== 'work' && pose !== 'attack';
  if (t && (!hauling || t === 'bow')) tool(p, t, hx, hy, r.ta, r.pull);
  p.hR(hx - 1, hy - 1, 2, 2, skin);
  if (job === 'shieldbearer') {
    // tower shield carried in front
    const sx = L + 3 + (pose === 'attack' ? (f === 1 ? 2 : 0) : 0), sy = torsoY;
    p.hR(sx, sy, 6, 11, '#8a5a32').hR(sx, sy, 6, 1, '#c89058').hR(sx + 5, sy, 1, 11, '#5e3c20');
    p.hR(sx + 2, sy, 2, 11, '#b73a2e').hR(sx + 1, sy + 4, 4, 3, STEEL[1]).hp(sx + 2, sy + 5, STEEL[0]);
    if (promo === 'warden' || promo === 'bulwark') p.hp(sx + 3, sy + 2, '#ffd166');
  }
  if (promo === 'veteran' || promo === 'berserker') p.hR(hx0 + 3, hy0 - 4, 2, 3, promo === 'berserker' ? '#e05a48' : '#ffd166');
  c = p.outline(OUTLINE, true).done();
  frameCache.set(key, c);
  return c;
}

/** Compatibility: [right, right, left, left] idle frames, used for portraits and icons. */
export function settlerSprites(job: Job, look: number): Spr[] {
  const a = settlerFrame(job, look, 'idle', 0, 1), b = settlerFrame(job, look, 'idle', 0, -1);
  return [a, a, b, b];
}

// ---------- goblins ----------
interface GobStyle {
  skin: string; skinD: string; eye: string;
  size: number; // 1 normal, 1.4 brute, 1.6 warchief
  cloth: string; clothD: string;
  weapon: Tool;
}
const GSTYLE: Record<GobKind, GobStyle> = {
  scrapper: { skin: '#7cb043', skinD: '#5a8a2e', eye: '#ffe14a', size: 1, cloth: '#8a5a32', clothD: '#5e3a1e', weapon: 'knife' },
  slinger: { skin: '#8cbc54', skinD: '#64923a', eye: '#ff7a4a', size: 1, cloth: '#6a4a7a', clothD: '#4a3058', weapon: 'sling' },
  wolfrider: { skin: '#7cb043', skinD: '#5a8a2e', eye: '#ffe14a', size: 0.9, cloth: '#8a5a32', clothD: '#5e3a1e', weapon: 'spear' },
  shieldgob: { skin: '#6aa03c', skinD: '#4c7a2a', eye: '#ffe14a', size: 1, cloth: '#7a5a3a', clothD: '#5e3a1e', weapon: 'club' },
  brute: { skin: '#5e9a3a', skinD: '#457528', eye: '#ff5a3a', size: 1.4, cloth: '#7a4a2a', clothD: '#5a3420', weapon: 'bigclub' },
  sapper: { skin: '#9ab84a', skinD: '#76902e', eye: '#ffe14a', size: 1, cloth: '#6a5a3a', clothD: '#3a2e20', weapon: '' },
  shaman: { skin: '#7cb043', skinD: '#5a8a2e', eye: '#9cf07a', size: 1, cloth: '#6a3a8a', clothD: '#4a2866', weapon: 'skullstaff' },
  warchief: { skin: '#4f8a2e', skinD: '#3a6a20', eye: '#ff3a2a', size: 1.6, cloth: '#5a3a28', clothD: '#3a2418', weapon: 'cleaver' },
};
export const GOB_CANVAS: Record<GobKind, { w: number; h: number; ax: number; ay: number }> = {
  scrapper: { w: 36, h: 34, ax: 18, ay: 31 },
  slinger: { w: 36, h: 34, ax: 18, ay: 31 },
  shieldgob: { w: 36, h: 34, ax: 18, ay: 31 },
  sapper: { w: 36, h: 34, ax: 18, ay: 31 },
  shaman: { w: 36, h: 40, ax: 18, ay: 37 },
  wolfrider: { w: 44, h: 38, ax: 22, ay: 35 },
  brute: { w: 46, h: 44, ax: 23, ay: 41 },
  warchief: { w: 54, h: 56, ax: 27, ay: 53 },
};
/** Eye positions (real px, right-facing) for the night glow overlay. */
export const GOB_EYES = new Map<GobKind, [number, number][]>();

function gobRig(kind: GobKind, pose: Pose, f: number): Rig {
  const r = rest();
  r.fa = 1.1; r.ba = 1.7; r.ta = -0.9;
  if (GSTYLE[kind].weapon === 'spear' || GSTYLE[kind].weapon === 'skullstaff') { r.fa = 1.2; r.ta = -1.45; }
  if (pose === 'walk') {
    walkRig(r, f);
    r.fa = 1.0 - Math.sin((f / 4) * Math.PI * 2) * 0.4;
    if (GSTYLE[kind].weapon === 'spear' || GSTYLE[kind].weapon === 'skullstaff') { r.fa = 1.2; r.ta = -1.45; }
    else r.ta = -0.9 + (r.fa - 1.0) * 0.4;
  }
  if (pose === 'idle') r.fa += f ? 0.08 : 0;
  if (pose === 'attack') {
    const w = GSTYLE[kind].weapon;
    if (w === 'spear') { r.fa = [1.0, -0.05, 0.3][f]; r.ta = [-0.3, 0.1, 0][f]; r.lean = [-1, 2, 1][f]; }
    else if (w === 'skullstaff') { r.fa = [-0.6, -1.2, -0.6][f]; r.ta = -1.45; }
    else if (w === 'sling') { r.fa = [-1.2, -2.6, 0.2][f]; r.ta = [-2.4, 2.6, 0.2][f]; }
    else if (kind === 'sapper') { r.fa = [-1.0, -0.4, 0.4][f]; r.lean = [0, 1, 1][f]; }
    else { r.fa = [-2.2, 0.2, 0.8][f]; r.ta = [-2.8, -0.2, 0.4][f]; r.lean = [-1, 2, 1][f]; }
  }
  return r;
}

const gobCache = new Map<string, Spr>();
export function goblinFrame(kind: GobKind, pose: Pose, f: number, face: number): Spr {
  const key = `${kind}|${pose}|${f}|${face > 0 ? 1 : 0}`;
  let c = gobCache.get(key);
  if (c) return c;
  if (face < 0) { c = flip(goblinFrame(kind, pose, f, 1)); gobCache.set(key, c); return c; }
  const st = GSTYLE[kind], cv = GOB_CANVAS[kind];
  const p = new Paint(cv.w, cv.h, 1);
  const r = gobRig(kind, pose, f);
  const k = st.size;
  const S = (v: number) => Math.round(v * k);
  const ax = cv.ax, gy = cv.ay - 1;
  const eyes: [number, number][] = [];

  if (kind === 'wolfrider') {
    // the wolf: long body, four legs in a loping gait, a bushy tail and a snout
    const wolf = '#6a6a72', wolfL = '#9a9aa2', wolfD = '#4a4a52';
    const bob = pose === 'walk' ? (f % 2 ? -1 : 0) : 0;
    const by = gy - 9 + bob;
    const legs = pose === 'walk' ? [[2, -2], [-1, 1], [-2, 2], [1, -1]][f] : [0, 0];
    for (const [lx, o, col] of [[-7, legs[1], wolfD], [5, legs[0], wolfD], [-5, legs[0], wolf], [7, legs[1], wolf]] as [number, number, string][]) {
      p.hR(ax + lx + o, by + 5, 2, gy - by - 5, col).hR(ax + lx + o, gy - 1, 3, 1, '#2a2a30');
    }
    p.E((ax - 0.5), by + 3, 8, 3, (hx, hy, nx, ny) => (ny < -0.45 ? wolfL : ny > 0.5 ? wolfD : wolf));
    // tail
    p.hR(ax - 11, by - 1, 3, 2, wolf).hR(ax - 13, by - 3, 3, 2, wolf).hR(ax - 14, by - 4, 2, 1, wolfL);
    // head and snout
    p.hR(ax + 7, by - 3, 6, 6, wolf).hR(ax + 7, by - 3, 6, 1, wolfL).hR(ax + 12, by, 4, 3, wolf).hR(ax + 15, by, 1, 1, '#1a1210');
    p.hR(ax + 8, by - 5, 2, 2, wolfD).hR(ax + 11, by - 5, 2, 2, wolfD);
    p.hR(ax + 12, by + 2, 4, 1, '#f0ead8');
    p.hp(ax + 11, by - 1, '#ffe14a');
    eyes.push([ax + 11, by - 1]);
    // rider: small goblin torso on the wolf's back
    const ry = by - 9;
    p.hR(ax - 3, ry + 4, 6, 6, st.cloth).hR(ax + 2, ry + 4, 1, 6, st.clothD);
    const hx0 = ax - 4;
    p.hR(hx0, ry - 3, 8, 7, st.skin).hR(hx0 + 6, ry - 2, 2, 6, st.skinD);
    p.hR(hx0 - 3, ry - 1, 3, 1, st.skin).hp(hx0 - 4, ry - 2, st.skin).hR(hx0 + 8, ry - 1, 3, 1, st.skin).hp(hx0 + 11, ry - 2, st.skin);
    p.hp(hx0 + 4, ry, st.eye).hp(hx0 + 6, ry, st.eye).hp(hx0 + 5, ry, '#1a1210');
    eyes.push([hx0 + 4, ry], [hx0 + 6, ry]);
    p.hR(hx0 + 3, ry + 2, 4, 1, '#3a1a10').hp(hx0 + 4, ry + 2, '#f0ead8');
    const [hx, hy] = limb(p, ax + 1, ry + 5, r.fa, 5, st.skin, st.skinD);
    tool(p, 'spear', hx, hy, r.ta);
  } else {
    // body proportions
    const legH = S(4), torsoH = S(6), headH = S(9), headW = S(10), torsoW = S(7);
    const top = gy - legH - torsoH - headH + 2 + r.bob;
    const torsoY = top + headH - 1, hipY = gy - legH + 1;
    const L = ax + r.lean;
    // cape / banner behind the warchief
    if (kind === 'warchief') {
      p.hR(L - 9, torsoY - 18, 1, 30, '#4a3020');
      p.hR(L - 8, torsoY - 18, 8, 6, '#b8402e').hR(L - 8, torsoY - 18, 8, 1, '#e06a50').hR(L - 6, torsoY - 16, 3, 2, '#1a1210').hp(L - 5, torsoY - 13, '#b8402e');
      p.hR(L - 7, torsoY, 4, torsoH + 4, '#8a2a20');
    }
    if (kind === 'sapper') {
      // powder keg strapped to the back
      p.E(L - 6.5, torsoY + 2, 3, 3, (hx, hy, nx, ny) => (nx + ny < -0.6 ? '#5a5a62' : '#3a3a42'));
      p.hR(L - 7, torsoY - 3, 1, 3, '#c8b890');
    }
    // back arm
    const [bhx, bhy] = limb(p, L - S(3), torsoY + 1, r.ba, S(5), st.skinD, st.skinD);
    void bhx; void bhy;
    // legs: short and bowed
    const lw = Math.max(2, S(2));
    const leg = (x: number, lift: number, col: string) => { p.hR(x, hipY, lw, legH - lift, col); p.hR(x - 1, gy - lift, lw + 2, 1, '#2a1e18'); };
    leg(ax - S(3) + r.lb, r.ub, st.skinD);
    leg(ax + S(1) + r.lf, r.uf, st.skin);
    // torso, pot belly and loincloth
    const t0 = L - Math.floor(torsoW / 2);
    p.hR(t0, torsoY, torsoW, torsoH, st.skin).hR(t0 + torsoW - S(2), torsoY, S(2), torsoH, st.skinD);
    p.hR(t0 + 1, torsoY + torsoH - S(3), torsoW, S(2), st.skin);
    p.hR(t0, hipY - 1, torsoW, S(3), st.cloth).hR(t0 + torsoW - 2, hipY - 1, 2, S(3), st.clothD);
    p.hR(t0 + 1, hipY + S(2) - 1, 2, 1, st.cloth).hR(t0 + torsoW - 3, hipY + S(2) - 1, 2, 1, st.clothD);
    if (kind === 'shaman') { p.hR(t0 - 1, torsoY, torsoW + 2, gy - torsoY - 1, st.cloth).hR(t0 + torsoW - 1, torsoY, 2, gy - torsoY - 1, st.clothD); for (let y = torsoY + 2; y < gy - 1; y += 3) p.hp(t0 + 1, y, '#b88ae0'); }
    if (kind === 'brute' || kind === 'warchief') { p.hR(t0 + 1, torsoY + 1, torsoW - 2, 2, '#a8acb2').hR(t0 + 1, torsoY + 1, torsoW - 2, 1, '#d8dce2'); }
    if (kind === 'scrapper' || kind === 'sapper') p.hR(t0, torsoY + 1, 2, torsoH - 2, st.cloth).line(t0, torsoY, t0 + torsoW - 1, hipY - 2, st.clothD);
    // head: wide, with long ears, big eyes and a toothy grin
    const hx0 = L - Math.floor(headW / 2) + S(1);
    p.hR(hx0 + 1, top, headW - 2, headH, st.skin).hR(hx0, top + 1, headW, headH - 2, st.skin);
    p.hR(hx0 + headW - S(2), top + 1, S(2), headH - 2, st.skinD);
    p.hR(hx0 + 2, top, S(4), 1, tint(st.skin, 0.25));
    const earY = top + S(3);
    const ear = (x: number, dir: number, col: string) => { for (let i = 0; i < S(5); i++) p.hR(x + dir * i - (dir < 0 ? 1 : 0), earY - Math.floor(i / 2), 2, 2 - (i > S(3) ? 1 : 0), col); };
    ear(hx0 - 1, -1, st.skinD);
    ear(hx0 + headW, 1, st.skin);
    // nose
    p.hR(hx0 + headW - 1, top + S(5), S(2), S(2), st.skinD);
    // eyes
    const ey = top + S(4);
    const e1 = hx0 + S(4), e2 = hx0 + S(7);
    for (const ex of [e1, e2]) { p.hR(ex, ey, S(2), S(2), st.eye); p.hp(ex + S(2) - 1, ey + S(2) - 1, '#1a1210'); eyes.push([ex, ey]); }
    p.hR(e1 - 1, ey - 1, S(3), 1, st.skinD).hR(e2, ey - 1, S(3), 1, st.skinD);
    // mouth
    const my = top + headH - S(3);
    p.hR(hx0 + S(3), my, S(6), 1, '#3a1a10');
    p.hp(hx0 + S(4), my, '#f0ead8').hp(hx0 + S(7), my, '#f0ead8');
    if (k > 1.2) { p.hR(hx0 + S(3), my - 2, 1, 2, '#f0ead8').hR(hx0 + S(8), my - 2, 1, 2, '#f0ead8'); }
    // headgear
    if (kind === 'slinger') p.hR(hx0, top - 1, headW, S(3), st.cloth).hR(hx0 - 1, top + 1, 3, S(5), st.clothD).hR(hx0 + 2, top - 1, S(4), 1, '#8a6a9a');
    if (kind === 'sapper') p.hR(hx0, top, headW, S(2), '#b83a2a').hR(hx0 - 2, top + 1, 3, 2, '#b83a2a');
    if (kind === 'shieldgob') p.hR(hx0 + 1, top - 1, headW - 2, S(3), STEEL[2]).hR(hx0 + 2, top - 1, S(4), 1, STEEL[1]);
    if (kind === 'shaman') {
      // bone mask over the face, feathers on top
      p.hR(hx0 + 2, top + 1, headW - 3, headH - 3, '#e8dcc0').hR(hx0 + headW - 3, top + 1, 2, headH - 3, '#c8bca0');
      p.hR(e1, ey, 2, 2, '#1a1210').hR(e2, ey, 2, 2, '#1a1210').hp(e1, ey, st.eye).hp(e2, ey, st.eye);
      for (const [fx, col] of [[2, '#e05a48'], [5, '#ffd166'], [8, '#e05a48']] as [number, string][]) p.hR(hx0 + fx, top - 4, 1, 4, col);
    }
    if (kind === 'warchief') {
      // horned iron helm
      p.hR(hx0, top - 2, headW, S(3), STEEL[2]).hR(hx0 + 2, top - 2, S(5), 1, STEEL[1]);
      for (const [x0, dir] of [[hx0 - 1, -1], [hx0 + headW, 1]] as [number, number][]) for (let i = 0; i < 6; i++) p.hR(x0 + dir * Math.floor(i / 1.5) - (dir < 0 ? 1 : 0), top - 2 - i, 2, 2, i > 3 ? '#f0ead8' : '#d8ccb0');
    }
    // front arm and weapon
    const [hx, hy] = limb(p, L + S(1), torsoY + 1, r.fa, S(5), st.skin, st.skinD);
    if (st.weapon) tool(p, st.weapon, hx, hy, r.ta);
    if (kind === 'sapper') {
      // lit bomb in hand
      p.E(hx / 1 - 0.5, hy + 1, 2, 2, (hx2, hy2, nx, ny) => (nx + ny < -0.5 ? '#6a6a72' : '#3a3a42'));
      p.hp(hx + 1, hy - 3, '#c8b890').hp(hx + 2, hy - 4, '#ffb84a');
    }
    if (kind === 'shieldgob') {
      // plank shield held in front
      const sx = L + S(3) + (pose === 'attack' && f === 1 ? 2 : 0), sy = torsoY - 2;
      p.hR(sx, sy, 6, 11, '#9a6a3a');
      for (let x = sx + 2; x < sx + 6; x += 2) p.hR(x, sy, 1, 11, '#7a5228');
      p.hR(sx, sy + 2, 6, 1, STEEL[2]).hR(sx, sy + 8, 6, 1, STEEL[2]).hR(sx, sy, 6, 1, '#c89058');
    }
  }
  if (!GOB_EYES.has(kind)) GOB_EYES.set(kind, eyes);
  c = p.outline(OUTLINE, true).done();
  gobCache.set(key, c);
  return c;
}

/** Compatibility: [right, right, left, left] idle frames, used for icons. */
export function goblinSprites(kind: GobKind): Spr[] {
  const a = goblinFrame(kind, 'idle', 0, 1), b = goblinFrame(kind, 'idle', 0, -1);
  return [a, a, b, b];
}
