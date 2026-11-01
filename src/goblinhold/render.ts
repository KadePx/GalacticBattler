// Canvas renderer: terrain, y-sorted sprites, night lighting, overlays.
import { BALLISTA, BRAZIER, BUILD, BuildKind, DAY_LEN, DUSK_LEN, JOBS, LINE_KINDS, MAP_H, MAP_W, Season, T_BUSH, T_ROCK, T_SAPLING, T_TREE, TILE, TOWER } from './defs';
import { bldAtTile, canPlace, flowVersion, tracePath } from './map';
import {
  bushSprite, goblinSprites, paintBallista, paintGarden, paintBarracks, paintBrazier, paintEntryBanner, paintFarm, paintFlag, paintGround, paintHealer, paintHut,
  paintKeep, paintMarket, paintStake, paintStoneWall, paintTower, paintTrap, rockSprite, saplingSprite, settlerSprites, Spr, treeSprite,
} from './sprites';
import { Building, Game, hasRelic, idx, Settler } from './state';
import { FxEvent, buildCost, canPay, dayLen, season, unlocked, wallLine } from './sim';

export type Tool = BuildKind | 'demolish' | null;
export interface Sel { t: 's' | 'b' | 'g'; id: number; }
export interface View {
  cam: { x: number; y: number; z: number };
  sel: Sel | null;
  tool: Tool;
  hover: { x: number; y: number } | null;
  drag: { x0: number; y0: number; x1: number; y1: number } | null;
  w: number;
  h: number;
  dpr: number;
}

let ground: HTMLCanvasElement | null = null;
let shake = 0;
export function addShake(n: number) { shake = Math.min(6, shake + n); }
let groundKey = '';
let dark: HTMLCanvasElement | null = null;

interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; s: number; g: number; }
const parts: Particle[] = [];
const smoke: Particle[] = [];
const snow: { x: number; y: number; v: number; s: number }[] = [];
const lastPos = new Map<number, { x: number; y: number; m: number }>();

// ---------- sprite cache per season ----------
const sprCache = new Map<string, Spr>();
function spr(key: string, make: () => Spr): Spr {
  let s = sprCache.get(key);
  if (!s) { s = make(); sprCache.set(key, s); }
  return s;
}
const baselineCache = new WeakMap<Spr, number>();
/** Last opaque row of a sprite, so every building sits on its footprint the same way. */
function baseline(s: Spr) {
  let b = baselineCache.get(s);
  if (b !== undefined) return b;
  const d = s.getContext('2d')!.getImageData(0, 0, s.width, s.height).data;
  b = s.height - 1;
  outer: for (let y = s.height - 1; y >= 0; y--) for (let x = 0; x < s.width; x++) if (d[(y * s.width + x) * 4 + 3] > 40) { b = y; break outer; }
  baselineCache.set(s, b);
  return b;
}

function bldSprite(kind: BuildKind, sea: Season, extra = 0): Spr | null {
  switch (kind) {
    case 'keep': return spr('keep' + sea, () => paintKeep(sea));
    case 'hut': return spr('hut' + sea, () => paintHut(sea));
    case 'tower': return spr('tower' + sea, () => paintTower(sea));
    case 'market': return spr('market' + sea, () => paintMarket(sea));
    case 'barracks': return spr('barracks' + sea, () => paintBarracks(sea));
    case 'healer': return spr('healer' + sea, () => paintHealer(sea));
    case 'ballista': return spr('ballista', paintBallista);
    case 'brazier': return spr('brazier' + extra, () => paintBrazier(extra > 0, extra - 1));
    case 'flag': return spr('flag', paintFlag);
    case 'trap': return spr('trap' + extra, () => paintTrap(extra > 0));
    case 'garden': return spr('garden' + sea, () => paintGarden(sea));
    case 'farm': return spr('farm' + extra + sea, () => paintFarm(extra, sea));
    case 'stonewall': return spr('stonewall' + sea, () => paintStoneWall(sea));
    default: return null;
  }
}
export function buildingIcon(kind: BuildKind): Spr {
  if (kind === 'wall') return spr('stake', paintStake);
  if (kind === 'farm') return bldSprite('farm', 'summer', 2)!;
  if (kind === 'brazier') return bldSprite('brazier', 'summer', 1)!;
  return bldSprite(kind, 'summer')!;
}

function buildGround(g: Game, sea: Season) {
  const tAt = (x: number, y: number) => {
    const t = g.terrain[idx(x, y)];
    return t === T_TREE || t === T_SAPLING || t === T_ROCK || t === T_BUSH ? 0 : t;
  };
  ground = paintGround(MAP_W, MAP_H, tAt, sea);
}

export function invalidateTerrain() { groundKey = ''; }

// ---------- effects ----------
export function spawnFx(e: FxEvent) {
  if (e.x === undefined || e.y === undefined) return;
  const burst = (n: number, c: string[], sp: number, life: number, g = 6, s = 1) => {
    for (let i = 0; i < n && parts.length < 500; i++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random() * 0.8);
      parts.push({ x: e.x!, y: e.y!, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.6, t: 0, life: life * (0.6 + Math.random() * 0.6), c: c[i % c.length], s, g });
    }
  };
  switch (e.k) {
    case 'chop': burst(4, ['#c89a5a', '#7a5228'], 2.5, 0.4); break;
    case 'pick': burst(4, ['#d8d1c4', '#968e82'], 2.5, 0.4); break;
    case 'pluck': burst(2, ['#d8304a', '#5aa445'], 1.5, 0.4); break;
    case 'splash': burst(5, ['#9ccdea', '#ffffff'], 2, 0.4); break;
    case 'fell': burst(14, ['#3f8436', '#5aa445', '#633f22'], 3, 0.7); break;
    case 'crumble': burst(14, ['#b8b0a2', '#726b62'], 3, 0.7); break;
    case 'hammer': burst(2, ['#e8d8a8', '#a08060'], 2, 0.3); break;
    case 'gobdie': burst(10, ['#7cb043', '#4c7a2a', '#e8e0c8'], 3, 0.6); break;
    case 'bossdie': addShake(5); burst(40, ['#ffd166', '#7cb043', '#e8e0c8', '#e05a48'], 5, 1.4, 4, 2); break;
    case 'death': burst(12, ['#c84a32', '#e8e0c8'], 2.5, 0.8); break;
    case 'rescue': burst(10, ['#9cf07a', '#ffffff'], 2, 0.8, 1); break;
    case 'hit': burst(3, ['#fff2b0', '#ffd166'], 2.5, 0.25, 0); break;
    case 'hurt': burst(4, ['#d8402a'], 2, 0.3); break;
    case 'slash': burst(3, ['#ffffff', '#c8ccd2'], 3, 0.18, 0); break;
    case 'block': burst(3, ['#d39a5e', '#8a5a32'], 2, 0.25, 2); break;
    case 'smash': burst(8, ['#ffffff', '#a89a8a'], 3.5, 0.3, 2); break;
    case 'heal': burst(6, ['#9cf07a', '#e0ffd0'], 1.5, 0.6, -2); break;
    case 'collapse': addShake(2); burst(26, ['#8a6a4a', '#5a4a3a', '#a89a8a'], 3.5, 1, 3, 2); break;
    case 'boom': addShake(3); burst(30, ['#ffe066', '#ff8a2a', '#5a4a3a', '#2b1d18'], 5, 0.8, 2, 2); break;
    case 'trap': burst(12, ['#a89a8a', '#7cb043', '#ffffff'], 3, 0.5); break;
    case 'built': burst(14, ['#ffe58a', '#ffffff'], 3, 0.7, 2); break;
    case 'harvest': burst(3, ['#e8d070', '#a8c050'], 1.8, 0.5); break;
    case 'coin': burst(4, ['#ffd166', '#fff2b0'], 2, 0.5); break;
    case 'keephit': addShake(0.8); burst(2, ['#a8a29a'], 2, 0.3); break;
    case 'thud': burst(2, ['#a08060'], 2, 0.3); break;
    case 'place': burst(6, ['#e8e0c8'], 2, 0.4, 2); break;
    case 'demolish': burst(12, ['#8a6a4a', '#a89a8a'], 3, 0.6); break;
  }
}

// ---------- lighting ----------
export function darkness(g: Game): number {
  if (g.phase === 'day') return Math.max(0, (g.phaseT - (dayLen(g) - 25)) / 25) * 0.12;
  if (g.phase === 'dusk') return 0.12 + (g.phaseT / DUSK_LEN) * 0.4;
  if (g.phase === 'night') return 0.52;
  return 0.28;
}

function activityIcon(s: Settler): string {
  const k = s.task?.k;
  if (k === 'sulk') return 'sulk';
  if (k === 'flee') return 'scared';
  if (s.sick > 0) return 'sick';
  if (s.needs.hunger < 25) return 'food';
  if (s.needs.rest < 18) return 'zzz';
  if (s.needs.warmth < 25) return 'cold';
  if (s.needs.safety < 20) return 'scared';
  if (s.job === 'idle') return 'idle';
  return '';
}

// ---------- main draw ----------
export function draw(ctx: CanvasRenderingContext2D, g: Game, v: View, dt: number, now: number) {
  const sea = season(g);
  const key = `${g.seed}:${sea}`;
  if (!ground || groundKey !== key) { buildGround(g, sea); groundKey = key; }
  const { w, h, dpr } = v;
  const z = v.cam.z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = sea === 'winter' ? '#cfd8df' : '#3f6a2e';
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  const k = z * dpr;
  shake = dt <= 0 ? 0 : Math.max(0, shake - dt * 12);
  const sx0 = shake > 0.1 ? (Math.random() - 0.5) * shake * k : 0, sy0 = shake > 0.1 ? (Math.random() - 0.5) * shake * k : 0;
  const ox = Math.round(w * dpr / 2 - v.cam.x * k + sx0), oy = Math.round(h * dpr / 2 - v.cam.y * k + sy0);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  ctx.drawImage(ground!, 0, 0);

  const P = (tx: number) => tx * TILE;

  // entry banners
  const entriesTonight = new Set(g.wave.groups.map((gr) => gr.entry));
  const banner = spr('banner', paintEntryBanner);
  g.entries.forEach((e, i) => {
    const ex = Math.min(Math.max(e.x, 0.6), MAP_W - 1.6), ey = Math.max(e.y, 0.4);
    ctx.globalAlpha = entriesTonight.has(i) ? 1 : 0.35;
    ctx.drawImage(banner, Math.round(P(ex) + 2), Math.round(P(ey) - 4));
    ctx.globalAlpha = 1;
  });

  if (g.phase !== 'dawn') drawRoutes(ctx, g, now);

  // flat things under everything: farms, traps
  for (const b of g.blds) {
    if (b.kind !== 'farm' && b.kind !== 'trap' && b.kind !== 'garden') continue;
    const stage = b.kind === 'farm' ? (b.done ? (g.day + Math.floor(g.phaseT / 50)) % 3 : 0) : b.kind === 'trap' && b.sprung ? 1 : 0;
    const s = bldSprite(b.kind, sea, stage)!;
    ctx.globalAlpha = b.done ? (b.kind === 'trap' ? 0.85 : 1) : 0.45;
    ctx.drawImage(s, P(b.x), P(b.y));
    ctx.globalAlpha = 1;
    if (!b.done) progressBar(ctx, b);
  }

  // y-sorted world
  type D = { y: number; f: () => void };
  const list: D[] = [];
  for (let i = 0; i < g.terrain.length; i++) {
    const t = g.terrain[i];
    if (t !== T_TREE && t !== T_SAPLING && t !== T_ROCK && t !== T_BUSH) continue;
    const tx = i % MAP_W, ty = Math.floor(i / MAP_W);
    if (t === T_TREE) {
      const sp = treeSprite(tx * 7 + ty * 3, sea);
      list.push({ y: ty + 0.9, f: () => { shadow(ctx, P(tx) + 8, P(ty) + 14, 7); ctx.drawImage(sp, P(tx) + 8 - (sp.width >> 1), P(ty) + 15 - baseline(sp)); } });
    } else if (t === T_ROCK) {
      const sz = g.amount[i] > 6 ? 2 : g.amount[i] > 3 ? 1 : 0;
      const sp = rockSprite(tx + ty, sz, sea);
      list.push({ y: ty + 0.7, f: () => ctx.drawImage(sp, P(tx), P(ty) + 2) });
    } else if (t === T_BUSH) {
      const sp = bushSprite(sea === 'winter' ? 0 : g.amount[i], sea);
      list.push({ y: ty + 0.7, f: () => ctx.drawImage(sp, P(tx), P(ty) + 3) });
    } else list.push({ y: ty + 0.8, f: () => ctx.drawImage(spr('sapling', saplingSprite), P(tx) + 4, P(ty) + 6) });
  }
  for (const b of g.blds) {
    if (b.kind === 'farm' || b.kind === 'trap' || b.kind === 'garden') continue;
    const d = BUILD[b.kind];
    list.push({ y: b.y + d.h - (b.kind === 'flag' ? 0.3 : 0.05), f: () => drawBuilding(ctx, g, b, sea, now) });
  }
  const moved = (id: number, x: number, y: number) => {
    const p = lastPos.get(id);
    let m = p ? p.m : 0;
    if (p && Math.hypot(p.x - x, p.y - y) > 0.001) m = 0.15; else m = Math.max(0, m - dt);
    lastPos.set(id, { x, y, m });
    return m > 0;
  };
  for (const s of g.settlers) {
    const walking = moved(s.id, s.x, s.y);
    if (s.inside || s.away > 0) continue;
    list.push({
      y: s.y, f: () => {
        const sp = settlerSprites(s.job, s.look);
        const fr = (s.face < 0 ? 2 : 0) + (walking ? Math.floor(s.walk) % 2 : 0);
        const px = Math.round(P(s.x) - 5 + (s.hitT > 0 ? 1 : 0)), py = Math.round(P(s.y) - 12 - (walking && Math.floor(s.walk) % 2 ? 1 : 0));
        shadow(ctx, P(s.x), P(s.y) + 0.5, 4);
        if (v.sel?.t === 's' && v.sel.id === s.id) ring(ctx, P(s.x), P(s.y), '#ffe14a');
        ctx.drawImage(sp[fr], px, py);
        drawTool(ctx, s.job, s.face, px, py, s.task?.k ?? '', now, s.carry, s.carryRes);
        if (s.promo && JOBS[s.job].combat) { ctx.fillStyle = '#ffd166'; ctx.fillRect(px + 4, py + 7, 3, 1); ctx.fillRect(px + 5, py + 8, 1, 1); }
        if (s.hitT > 0) { ctx.fillStyle = 'rgba(255,80,60,0.5)'; ctx.fillRect(px + 1, py + 1, 8, 11); }
      },
    });
  }
  for (const gb of g.goblins) {
    const walking = moved(gb.id, gb.x, gb.y);
    list.push({
      y: gb.y, f: () => {
        const sp = goblinSprites(gb.kind);
        const fr = (gb.face < 0 ? 2 : 0) + (walking ? Math.floor(gb.walk) % 2 : 0);
        const s0 = sp[fr];
        const px = Math.round(P(gb.x) - s0.width / 2), py = Math.round(P(gb.y) - s0.height + 1);
        shadow(ctx, P(gb.x), P(gb.y) + 0.5, Math.max(4, s0.width / 2 - 1));
        if (gb.kind === 'warchief') { ctx.strokeStyle = 'rgba(224,90,72,0.45)'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.ellipse(P(gb.x), P(gb.y), 64, 40, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        if (v.sel?.t === 'g' && v.sel.id === gb.id) ring(ctx, P(gb.x), P(gb.y), '#ff6a4a');
        if (gb.buff > 0) { ctx.fillStyle = 'rgba(255,90,60,0.35)'; ctx.fillRect(px, py - 2, s0.width, 2); }
        ctx.drawImage(s0, px, py);
        drawGobWeapon(ctx, gb.kind, gb.face, px, py, s0.width, now);
        if (gb.slow > 0) { ctx.fillStyle = 'rgba(255,140,40,0.5)'; ctx.fillRect(px + 2, py + s0.height - 3, s0.width - 4, 2); }
        if (gb.hitT > 0) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px + 1, py + 1, s0.width - 2, s0.height - 2); }
        if (gb.hp < gb.maxHp || gb.kind === 'warchief') bar(ctx, P(gb.x) - (gb.kind === 'warchief' ? 10 : 5), py - 3, gb.kind === 'warchief' ? 20 : 10, gb.hp / gb.maxHp, '#e0503a');
      },
    });
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();

  // projectiles
  for (const sh of g.shots) {
    const k2 = Math.min(1, sh.t / sh.dur);
    const arc = sh.kind === 'stone' ? Math.sin(k2 * Math.PI) * 0.6 : 0;
    const x = P(sh.x), y = P(sh.y - arc);
    if (sh.kind === 'stone') { ctx.fillStyle = '#4a4440'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); }
    else if (sh.kind === 'spell') { ctx.fillStyle = '#b88ae0'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); ctx.fillStyle = '#f0e0ff'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); }
    else {
      const a = Math.atan2(sh.ey - sh.sy, sh.ex - sh.sx);
      const len = sh.kind === 'heavy' ? 9 : 5;
      ctx.strokeStyle = sh.kind === 'bolt' ? '#3a2a20' : sh.kind === 'heavy' ? '#4a3020' : '#f2e6c8';
      ctx.lineWidth = sh.kind === 'heavy' ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len); ctx.lineTo(x, y); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // particles: chimney smoke, then effects
  emitSmoke(g, dt);
  for (const p of smoke) {
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.max(0, 0.45 * (1 - p.t / p.life));
    ctx.fillStyle = p.c;
    const s = 1 + Math.floor((p.t / p.life) * 3);
    ctx.fillRect(Math.round(P(p.x)), Math.round(P(p.y)), s, s);
  }
  for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t >= smoke[i].life) smoke.splice(i, 1);
  for (const p of parts) {
    p.t += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.c;
    ctx.fillRect(Math.round(P(p.x)), Math.round(P(p.y)), p.s, p.s);
  }
  ctx.globalAlpha = 1;
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= parts[i].life) parts.splice(i, 1);

  // night
  const dk = darkness(g);
  if (dk > 0.01) drawDark(ctx, g, v, dk, ox, oy, k, now);
  ctx.setTransform(k, 0, 0, k, ox, oy);

  // overlays above the darkness: goblin eyes glow so raiders stay readable at night
  if (dk > 0.2) {
    for (const gb of g.goblins) {
      const sp = goblinSprites(gb.kind)[0];
      const px = Math.round(P(gb.x) - sp.width / 2), py = Math.round(P(gb.y) - sp.height + 1);
      ctx.fillStyle = gb.kind === 'slinger' || gb.kind === 'brute' || gb.kind === 'warchief' ? '#ff8a5a' : '#ffe14a';
      ctx.globalAlpha = Math.min(1, dk * 1.6);
      const eyeY = py + (gb.kind === 'warchief' ? 5 : 4);
      const ex = gb.face > 0 ? px + sp.width - 4 : px + 3;
      ctx.fillRect(ex, eyeY, 1, 1);
      ctx.fillRect(ex + (gb.face > 0 ? -2 : 2), eyeY, 1, 1);
      ctx.globalAlpha = 1;
    }
  }
  for (const b of g.blds) {
    if (b.done && b.hp < b.maxHp && b.kind !== 'flag' && b.kind !== 'trap') { const d = BUILD[b.kind]; bar(ctx, P(b.x + d.w / 2) - 8, P(b.y) - (b.kind === 'tower' ? 26 : b.kind === 'keep' ? 18 : 10), 16, b.hp / b.maxHp, '#7ee06a'); }
  }
  for (const s of g.settlers) {
    if (s.inside || s.away > 0) continue;
    const px = P(s.x), py = P(s.y) - 15;
    if (s.hp < s.maxHp) bar(ctx, px - 5, py, 10, s.hp / s.maxHp, '#7ee06a');
    const ic = activityIcon(s);
    if (ic) drawGlyph(ctx, ic, Math.round(px) - 3, Math.round(py) - 7 + (Math.floor(now * 3) % 2));
  }
  if (v.sel?.t === 'b') {
    const b = g.blds.find((q) => q.id === v.sel!.id);
    if (b) {
      const d = BUILD[b.kind];
      ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 1;
      ctx.strokeRect(P(b.x) + 0.5, P(b.y) + 0.5, d.w * TILE - 1, d.h * TILE - 1);
      const r = rangeOf(g, b.kind);
      if (r) circle(ctx, b.x + 0.5, b.y + 0.5, r, 'rgba(255,225,74,0.55)');
    }
  }
  for (const f of g.floaters) {
    ctx.globalAlpha = Math.min(1, f.t * 2);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1a1210';
    ctx.fillText(f.text, P(f.x) + 0.5, P(f.y) + 0.5);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, P(f.x), P(f.y));
  }
  ctx.globalAlpha = 1;

  drawGhost(ctx, g, v);

  // weather: snow in winter, in screen space
  if (sea === 'winter') drawSnow(ctx, v, dt);
}

function rangeOf(g: Game, kind: BuildKind) {
  const spy = hasRelic(g, 'spyglass') ? 1 : 0;
  if (kind === 'tower') return TOWER.range + spy;
  if (kind === 'ballista') return BALLISTA.range + spy;
  if (kind === 'brazier') return BRAZIER.range;
  if (kind === 'flag') return 4;
  return 0;
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(20,30,10,0.22)';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
}

function emitSmoke(g: Game, dt: number) {
  if (dt <= 0 || smoke.length > 160) return;
  for (const b of g.blds) {
    if (!b.done) continue;
    let sx = 0, sy = 0;
    if (b.kind === 'hut') { sx = b.x + 1.5; sy = b.y - 0.4; }
    else if (b.kind === 'keep') { sx = b.x + 1.65; sy = b.y - 0.7; }
    else if (b.kind === 'brazier' && b.lit) { sx = b.x + 0.5; sy = b.y - 0.2; }
    else continue;
    if (Math.random() > dt * (b.kind === 'brazier' ? 6 : 1.5)) continue;
    smoke.push({ x: sx + (Math.random() - 0.5) * 0.15, y: sy, vx: 0.15 + Math.random() * 0.15, vy: -0.45 - Math.random() * 0.2, t: 0, life: 2.4, c: b.kind === 'brazier' ? '#ffb84a' : '#e8e4dc', s: 1, g: 0 });
  }
}

function drawSnow(ctx: CanvasRenderingContext2D, v: View, dt: number) {
  const W = v.w * v.dpr, H = v.h * v.dpr;
  while (snow.length < 120) snow.push({ x: Math.random() * W, y: Math.random() * H, v: 20 + Math.random() * 40, s: Math.random() < 0.3 ? 2 : 1 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const sc = v.dpr * 1.5;
  for (const f of snow) {
    f.y += f.v * dt * sc; f.x += Math.sin(f.y * 0.02) * 0.3 * sc;
    if (f.y > H) { f.y = -4; f.x = Math.random() * W; }
    ctx.fillRect(Math.round(f.x), Math.round(f.y), f.s * sc, f.s * sc);
  }
}

function drawRoutes(ctx: CanvasRenderingContext2D, g: Game, now: number) {
  const entries = [...new Set(g.wave.groups.map((gr) => gr.entry))];
  const key = entries.join(',') + ':' + g.seed;
  if (routeCache.v !== flowVersion || routeCache.key !== key) {
    routeCache.v = flowVersion;
    routeCache.key = key;
    routeCache.paths = entries.map((e) => tracePath(g, g.entries[e].x, g.entries[e].y));
  }
  // A static dashed trail along tonight's route, with an arrow at the trailhead. Gone once the raid starts.
  if (g.phase === 'night') return;
  const dusk = g.phase === 'dusk';
  for (const p of routeCache.paths) {
    const pts = p.map((i) => [(i % MAP_W + 0.5) * TILE, (Math.floor(i / MAP_W) + 0.5) * TILE]);
    if (pts.length < 2) continue;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = dusk ? 0.85 : 0.55;
    ctx.strokeStyle = '#3a120c'; ctx.lineWidth = 3.5;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = '#ff7a5a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.setLineDash([]);
    // arrow at the trailhead, gently pulsing at dusk
    if (pts.length > 3) {
      const [ax, ay] = pts[1], [bx, by] = pts[3];
      const ang = Math.atan2(by - ay, bx - ax);
      const sc = dusk ? 1.25 + Math.sin(now * 5) * 0.15 : 1.1;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.translate(bx, by); ctx.rotate(ang); ctx.scale(sc, sc);
      ctx.fillStyle = '#2b1d18'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff5a45'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
const routeCache = { v: -1, key: '', paths: [] as number[][] };

function drawBuilding(ctx: CanvasRenderingContext2D, g: Game, b: Building, sea: Season, now: number) {
  const d = BUILD[b.kind];
  const px = b.x * TILE, py = b.y * TILE;
  const fw = d.w * TILE, fh = d.h * TILE;
  const shake = b.hitT > 0 ? 1 : 0;
  ctx.globalAlpha = b.done ? 1 : 0.45;
  if (b.kind === 'wall') drawWall(ctx, g, b, px + shake, py);
  else if (b.kind === 'stonewall') drawStoneWall(ctx, g, b, sea, px + shake, py);
  else {
    const frame = b.kind === 'brazier' ? (b.lit && g.phase === 'night' ? 1 + (Math.floor(now * 6) % 2) : 0) : 0;
    const s = bldSprite(b.kind, sea, frame)!;
    if (b.kind !== 'flag') shadow(ctx, px + fw / 2, py + fh - 1, fw / 2);
    // ballista crew stands behind the machine
    if (b.kind === 'ballista' && b.occupant) drawOccupant(ctx, g, b, px + 3, py - 4);
    const bx = px + Math.round((fw - s.width) / 2) + shake;
    const by = b.kind === 'flag' ? py + 2 : py + fh - baseline(s) + 1;
    ctx.drawImage(s, bx, by);
    if (b.kind === 'keep' && (b.level ?? 0) > 0) {
      // fortified keeps fly pennants from every turret
      const cols = (b.level ?? 0) > 1 ? ['#ffd166', '#3f63a8'] : ['#3f63a8', '#3f63a8'];
      for (const [fx, fy] of [[bx + 6, by + 10], [bx + 45, by + 10], [bx + 26, by - 2]]) {
        ctx.fillStyle = '#2b1d18'; ctx.fillRect(fx, fy - 6, 1, 7);
        ctx.fillStyle = cols[0]; ctx.fillRect(fx + 1, fy - 6, 4, 2);
        ctx.fillStyle = cols[1]; ctx.fillRect(fx + 1, fy - 4, 3, 1);
      }
      if ((b.level ?? 0) > 1) { ctx.fillStyle = '#ffd166'; ctx.fillRect(bx + 4, by + 52, 44, 1); }
    }
    if (b.kind === 'tower' && b.occupant) drawOccupant(ctx, g, b, bx + 5, by + 5, by + 15);
    // upgrade pips
    if (b.kind !== 'keep' && (b.level ?? 0) > 0) {
      for (let i = 0; i < (b.level ?? 0); i++) { ctx.fillStyle = '#2b1d18'; ctx.fillRect(bx + s.width - 4 - i * 4, by - 1, 4, 4); ctx.fillStyle = '#ffd166'; ctx.fillRect(bx + s.width - 3 - i * 4, by, 2, 2); }
    }
  }
  ctx.globalAlpha = 1;
  if (!b.done && b.kind !== 'flag') {
    ctx.strokeStyle = '#e8d0a0'; ctx.lineWidth = 1;
    const top = py + fh - Math.min(30, fh + 10);
    ctx.beginPath();
    ctx.moveTo(px + 1.5, top); ctx.lineTo(px + 1.5, py + fh);
    ctx.moveTo(px + fw - 1.5, top); ctx.lineTo(px + fw - 1.5, py + fh);
    ctx.moveTo(px + 1, py + fh - 6.5); ctx.lineTo(px + fw - 1, py + fh - 6.5);
    ctx.stroke();
    progressBar(ctx, b);
  }
  if (b.hitT > 0 && b.kind !== 'wall' && b.kind !== 'stonewall') {
    const s = bldSprite(b.kind, sea);
    if (s) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(s, px + Math.round((fw - s.width) / 2), b.kind === 'flag' ? py + 2 : py + fh - baseline(s) + 1); ctx.restore(); }
  }
}

function drawOccupant(ctx: CanvasRenderingContext2D, g: Game, b: Building, x: number, y: number, clipBottom?: number) {
  const s = g.settlers.find((q) => q.id === b.occupant);
  if (!s) return;
  const sp = settlerSprites(s.job, s.look);
  ctx.save();
  if (clipBottom !== undefined) { ctx.beginPath(); ctx.rect(x - 4, y - 20, 20, clipBottom - (y - 20)); ctx.clip(); }
  ctx.drawImage(sp[s.face < 0 ? 2 : 0], x, y - 5);
  ctx.restore();
}

function drawWall(ctx: CanvasRenderingContext2D, g: Game, b: Building, px: number, py: number) {
  // Palisade: a row of sharpened logs. Runs along x show 3 stakes per tile, runs along y show a staggered pair,
  // so a line of any direction reads as a solid fence.
  const isWall = (dx: number, dy: number) => bldAtTile(g, b.x + dx, b.y + dy)?.kind === 'wall';
  const stake = spr('stake', paintStake);
  const h = isWall(1, 0) || isWall(-1, 0), v = isWall(0, 1) || isWall(0, -1);
  shadow(ctx, px + 8, py + 14, 7);
  ctx.fillStyle = '#633f22';
  if (isWall(1, 0)) { ctx.fillRect(px + 8, py + 6, 9, 2); ctx.fillRect(px + 8, py + 10, 9, 2); }
  if (isWall(0, 1)) { ctx.fillRect(px + 4, py + 9, 2, 16); ctx.fillRect(px + 10, py + 9, 2, 16); }
  const cols = h || !v ? [1, 6, 11] : [2, 8];
  for (const sx of cols) ctx.drawImage(stake, px + sx - 1, py + 1);
  if (v) for (const sx of [5, 11]) ctx.drawImage(stake, px + sx - 1, py + 7);
  if ((b.level ?? 0) > 0) { ctx.fillStyle = '#cfd4da'; for (const sx of cols) ctx.fillRect(px + sx, py + 6, 1, 1); }
}

function drawStoneWall(ctx: CanvasRenderingContext2D, g: Game, b: Building, sea: Season, px: number, py: number) {
  // Drawn per tile so lines join up: a light walkway on top, a block face only where the wall ends to the south.
  const isWall = (dx: number, dy: number) => bldAtTile(g, b.x + dx, b.y + dy)?.kind === 'stonewall';
  const top = sea === 'winter' ? '#eef3f6' : '#cbc3b4', face = '#b8b0a2', dark = '#968e82', line = '#726b62', out = '#2b1d18';
  const n = isWall(0, -1), s = isWall(0, 1), w = isWall(-1, 0), e = isWall(1, 0);
  const x0 = w ? px : px + 1, x1 = e ? px + 16 : px + 15;
  const yTop = n ? py : py + 1;
  const yFace = py + 9;
  shadow(ctx, px + 8, py + 15, 7);
  // walkway
  ctx.fillStyle = out; ctx.fillRect(x0 - (w ? 0 : 1), yTop - (n ? 0 : 1), x1 - x0 + (w ? 0 : 1) + (e ? 0 : 1), (s ? py + 16 : yFace) - yTop + (n ? 0 : 1));
  ctx.fillStyle = top; ctx.fillRect(x0, yTop, x1 - x0, (s ? py + 16 : yFace) - yTop);
  ctx.fillStyle = dark; ctx.fillRect(x0, yTop + 3, x1 - x0, 1);
  if (!e) { ctx.fillStyle = line; ctx.fillRect(x1 - 2, yTop, 2, (s ? py + 16 : yFace) - yTop); }
  if (!w) { ctx.fillStyle = '#e4ddd0'; ctx.fillRect(x0, yTop, 1, (s ? py + 16 : yFace) - yTop); }
  // merlons along open edges
  ctx.fillStyle = face;
  if (!n) for (let x = x0 + 1; x < x1 - 1; x += 4) { ctx.fillStyle = out; ctx.fillRect(x - 1, yTop - 3, 4, 3); ctx.fillStyle = face; ctx.fillRect(x, yTop - 2, 2, 2); }
  if (!s) {
    // south face with block courses
    ctx.fillStyle = out; ctx.fillRect(x0 - (w ? 0 : 1), yFace, x1 - x0 + (w ? 0 : 1) + (e ? 0 : 1), 8);
    ctx.fillStyle = face; ctx.fillRect(x0, yFace, x1 - x0, 7);
    ctx.fillStyle = line;
    ctx.fillRect(x0, yFace + 3, x1 - x0, 1);
    for (let x = x0 + ((b.x % 2) ? 2 : 5); x < x1; x += 6) ctx.fillRect(x, yFace, 1, 3);
    for (let x = x0 + ((b.x % 2) ? 5 : 2); x < x1; x += 6) ctx.fillRect(x, yFace + 4, 1, 3);
    ctx.fillStyle = dark; ctx.fillRect(x0, yFace + 6, x1 - x0, 1);
  }
}

function progressBar(ctx: CanvasRenderingContext2D, b: Building) {
  const d = BUILD[b.kind];
  if (!d.work) return;
  bar(ctx, b.x * TILE + d.w * 8 - 8, b.y * TILE + d.h * TILE - 4, 16, b.progress / d.work, '#ffd166');
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, f: number, c: string) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#1a1210'; ctx.fillRect(x - 1, y - 1, w + 2, 4);
  ctx.fillStyle = '#3a2a24'; ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = f < 0.35 ? '#e0503a' : c; ctx.fillRect(x, y, Math.max(1, Math.round(w * Math.max(0, Math.min(1, f)))), 2);
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.strokeStyle = c; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, y, 6, 3, 0, 0, Math.PI * 2); ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  ctx.strokeStyle = c; ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(x * TILE, y * TILE, r * TILE, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

function drawTool(ctx: CanvasRenderingContext2D, job: string, face: number, px: number, py: number, task: string, now: number, carry: number, carryRes: string) {
  const hx = face > 0 ? px + 8 : px + 1;
  const swing = ['chop', 'quarry', 'build', 'repair', 'farm', 'forage'].includes(task) && Math.floor(now * 4) % 2 === 0;
  const R = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  switch (job) {
    case 'woodcutter': R(hx, py + (swing ? 3 : 5), 1, 5, '#6a4426'); R(hx + (face > 0 ? 0 : -1), py + (swing ? 2 : 4), 2, 2, '#c8ccd2'); break;
    case 'quarrier': R(hx, py + (swing ? 3 : 5), 1, 5, '#6a4426'); R(hx - 1, py + (swing ? 2 : 4), 3, 1, '#8a9096'); break;
    case 'builder': R(hx, py + (swing ? 4 : 6), 1, 4, '#6a4426'); R(hx - (face > 0 ? 0 : 1), py + (swing ? 3 : 5), 2, 1, '#8a9096'); break;
    case 'farmer': R(hx, py + (swing ? 2 : 3), 1, 7, '#8a6036'); R(hx - (face > 0 ? -1 : 1), py + (swing ? 9 : 10), 2, 1, '#8a9096'); break;
    case 'fisher': if (task === 'fish') { R(hx, py + 2, 1, 6, '#8a6036'); ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.beginPath(); ctx.moveTo(hx + 0.5, py + 2); ctx.lineTo(hx + face * 9, py + 12 + Math.sin(now * 3)); ctx.stroke(); } break;
    case 'forager': R(face > 0 ? px + 1 : px + 7, py + 7, 3, 3, '#8a6036'); if (carry) R(face > 0 ? px + 1 : px + 7, py + 7, 3, 1, '#d8304a'); break;
    case 'militia': R(hx, py - 3, 1, 12, '#7a5228'); R(hx, py - 4, 1, 2, '#e0e4ea'); R(face > 0 ? px + 1 : px + 6, py + 6, 3, 4, '#8a5a32'); break;
    case 'shieldbearer': R(face > 0 ? px + 6 : px, py + 4, 4, 7, '#8a9096'); R(face > 0 ? px + 7 : px + 1, py + 5, 2, 5, '#cfd4da'); R(face > 0 ? px + 7 : px + 1, py + 7, 2, 1, '#b73a2e'); break;
    case 'archer': R(hx, py + 3, 1, 6, '#7a4a22'); R(hx + (face > 0 ? -1 : 1), py + 2, 1, 1, '#7a4a22'); R(hx + (face > 0 ? -1 : 1), py + 9, 1, 1, '#7a4a22'); break;
    case 'healer': R(face > 0 ? px + 7 : px + 1, py + 6, 2, 3, '#f2efe6'); R(face > 0 ? px + 7 : px + 1, py + 7, 2, 1, '#6aa040'); break;
    case 'trader': R(face > 0 ? px + 7 : px + 1, py + 6, 2, 2, '#ffd166'); break;
  }
  if (carry > 0 && job !== 'forager' && job !== 'fisher') {
    const c = carryRes === 'wood' ? ['#b07a44', '#d39a5e'] : carryRes === 'stone' ? ['#968e82', '#b8b0a2'] : ['#d8304a', '#ff7a8a'];
    R(px + 2, py + 5, 6, 2, c[0]); R(px + 3, py + 4, 4, 1, c[1]);
  }
  if (carry > 0 && job === 'fisher') { R(px + 3, py + 6, 4, 2, '#9ab8d0'); R(px + 2, py + 6, 1, 2, '#6a8aa8'); }
}

function drawGobWeapon(ctx: CanvasRenderingContext2D, kind: string, face: number, px: number, py: number, w: number, now: number) {
  const hx = face > 0 ? px + w - 2 : px + 1;
  const R = (x: number, y: number, ww: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, ww, h); };
  switch (kind) {
    case 'scrapper': R(hx, py + 4, 1, 5, '#a8acb2'); R(hx, py + 8, 1, 2, '#6a4426'); break;
    case 'slinger': R(hx, py + 6, 1, 3, '#6a4426'); R(hx, py + 5, 1, 1, '#c8c0a8'); break;
    case 'brute': R(hx - (face > 0 ? 0 : 1), py + 3, 2, 7, '#7a5228'); R(hx - 1, py + 2, 3, 3, '#5a3a20'); break;
    case 'sapper': R(hx, py + 5, 1, 3, '#6a4426'); R(hx, py + 3 + (Math.floor(now * 8) % 2), 1, 2, '#ffb84a'); break;
    case 'shaman': R(hx, py, 1, 12, '#6a4426'); R(hx - 1, py - 1, 3, 2, '#9cf07a'); break;
    case 'warchief': R(px + w / 2 - 1, py - 8, 1, 10, '#5a3a20'); R(px + w / 2, py - 8, 6, 5, '#b73a2e'); R(px + w / 2 + 2, py - 7, 2, 2, '#ffe14a'); R(hx - 1, py + 4, 3, 9, '#cfd4da'); break;
  }
}

// tiny 5x5 status glyphs
const GLYPH: Record<string, { rows: string[]; c: string }> = {
  food: { rows: ['.XX..', 'XXXX.', 'XXXXX', '.XXXX', '..XX.'], c: '#e86a3a' },
  zzz: { rows: ['XXXX.', '..X..', '.X...', 'XXXX.', '.....'], c: '#a8c8ff' },
  cold: { rows: ['X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X'], c: '#bfe8ff' },
  scared: { rows: ['..X..', '..X..', '..X..', '.....', '..X..'], c: '#ffd166' },
  sulk: { rows: ['.XXX.', 'XXXXX', 'XXXXX', '.X.X.', 'X.X..'], c: '#9aa0b0' },
  idle: { rows: ['.XXX.', '...X.', '..X..', '.....', '..X..'], c: '#e8e0c8' },
  sick: { rows: ['X...X', '.XXX.', '.X.X.', '.XXX.', 'X...X'], c: '#a8e070' },
};
function drawGlyph(ctx: CanvasRenderingContext2D, name: string, x: number, y: number) {
  const gl = GLYPH[name];
  if (!gl) return;
  ctx.fillStyle = '#1a1210';
  ctx.fillRect(x - 1, y - 1, 7, 7);
  ctx.fillStyle = gl.c;
  gl.rows.forEach((r, yy) => { for (let xx = 0; xx < 5; xx++) if (r[xx] === 'X') ctx.fillRect(x + xx, y + yy, 1, 1); });
}

function drawDark(ctx: CanvasRenderingContext2D, g: Game, v: View, dk: number, ox: number, oy: number, k: number, now: number) {
  const W = Math.ceil(v.w / 2), H = Math.ceil(v.h / 2);
  if (!dark || dark.width !== W || dark.height !== H) { dark = document.createElement('canvas'); dark.width = W; dark.height = H; }
  const d = dark.getContext('2d')!;
  d.globalCompositeOperation = 'source-over';
  d.clearRect(0, 0, W, H);
  d.fillStyle = `rgba(14,20,50,${dk})`;
  d.fillRect(0, 0, W, H);
  d.globalCompositeOperation = 'destination-out';
  const sk = k / v.dpr / 2;
  const sx = (x: number) => (x * TILE * k + ox) / v.dpr / 2, sy = (y: number) => (y * TILE * k + oy) / v.dpr / 2;
  const flick = 1 + Math.sin(now * 9) * 0.03 + Math.sin(now * 23) * 0.02;
  const lights: { x: number; y: number; r: number; c: string }[] = [];
  for (const b of g.blds) {
    if (!b.done) continue;
    if (b.kind === 'keep') lights.push({ x: b.x + 1.5, y: b.y + 1.5, r: 5.5, c: '255,150,60' });
    else if (b.kind === 'hut' || b.kind === 'healer' || b.kind === 'barracks') lights.push({ x: b.x + BUILD[b.kind].w / 2, y: b.y + 1.2, r: 2.6, c: '255,160,70' });
    else if (b.kind === 'tower' || b.kind === 'ballista') lights.push({ x: b.x + 0.5, y: b.y - 0.3, r: 3, c: '255,160,70' });
    else if (b.kind === 'brazier' && b.lit) lights.push({ x: b.x + 0.5, y: b.y + 0.2, r: 4.2, c: '255,130,40' });
    else if (b.kind === 'flag') lights.push({ x: b.x + 0.5, y: b.y + 0.5, r: 1.8, c: '255,160,70' });
    else if (b.kind === 'market') lights.push({ x: b.x + 1, y: b.y + 1, r: 2.2, c: '255,160,70' });
  }
  for (const s of g.settlers) if (!s.inside && s.away <= 0 && JOBS[s.job].combat) lights.push({ x: s.x, y: s.y - 0.3, r: 1.7, c: '255,160,70' });
  for (const gb of g.goblins) if (gb.kind === 'sapper' || gb.kind === 'shaman') lights.push({ x: gb.x, y: gb.y - 0.4, r: 1.4, c: gb.kind === 'shaman' ? '150,255,120' : '255,170,60' });
  for (const l of lights) {
    const r = l.r * TILE * sk * flick;
    const gr = d.createRadialGradient(sx(l.x), sy(l.y), 0, sx(l.x), sy(l.y), r);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = gr;
    d.fillRect(sx(l.x) - r, sy(l.y) - r, r * 2, r * 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(dark, 0, 0, v.w * v.dpr, v.h * v.dpr);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const x = (l.x * TILE * k + ox), y = (l.y * TILE * k + oy), r = l.r * TILE * k * 0.6 * flick;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${l.c},${0.22 * dk})`);
    gr.addColorStop(1, `rgba(${l.c},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
}

function drawGhost(ctx: CanvasRenderingContext2D, g: Game, v: View) {
  if (!v.tool || !v.hover) return;
  const sea = season(g);
  if (v.tool === 'demolish') {
    const b = bldAtTile(g, v.hover.x, v.hover.y);
    ctx.strokeStyle = b && b.kind !== 'keep' ? '#ff5a45' : 'rgba(255,90,69,0.4)';
    ctx.lineWidth = 1;
    if (b) { const d = BUILD[b.kind]; ctx.strokeRect(b.x * TILE + 0.5, b.y * TILE + 0.5, d.w * TILE - 1, d.h * TILE - 1); }
    else ctx.strokeRect(v.hover.x * TILE + 0.5, v.hover.y * TILE + 0.5, 15, 15);
    return;
  }
  const kind = v.tool;
  const d = BUILD[kind];
  const line = LINE_KINDS.includes(kind);
  const tiles = line && v.drag ? wallLine(v.drag.x0, v.drag.y0, v.drag.x1, v.drag.y1) : [{ x: v.hover.x - Math.floor((d.w - 1) / 2), y: v.hover.y - Math.floor((d.h - 1) / 2) }];
  const budget = { ...g.res };
  const cost = buildCost(g, kind);
  for (const t of tiles) {
    const afford = canPay({ res: budget } as Game, cost);
    const ok = unlocked(g, kind) && canPlace(g, kind, t.x, t.y) && afford;
    if (ok) for (const r of Object.keys(cost) as (keyof typeof cost)[]) budget[r] -= cost[r] ?? 0;
    ctx.fillStyle = ok ? 'rgba(126,224,106,0.25)' : 'rgba(255,90,69,0.3)';
    ctx.fillRect(t.x * TILE, t.y * TILE, d.w * TILE, d.h * TILE);
    ctx.strokeStyle = ok ? '#7ee06a' : '#ff5a45';
    ctx.lineWidth = 1;
    ctx.strokeRect(t.x * TILE + 0.5, t.y * TILE + 0.5, d.w * TILE - 1, d.h * TILE - 1);
    if (!ok) {
      ctx.beginPath();
      ctx.moveTo(t.x * TILE + 3, t.y * TILE + 3); ctx.lineTo((t.x + d.w) * TILE - 3, (t.y + d.h) * TILE - 3);
      ctx.moveTo((t.x + d.w) * TILE - 3, t.y * TILE + 3); ctx.lineTo(t.x * TILE + 3, (t.y + d.h) * TILE - 3);
      ctx.stroke();
    }
    if (!line) {
      const s = kind === 'farm' ? bldSprite('farm', sea, 2) : kind === 'brazier' ? bldSprite('brazier', sea, 1) : bldSprite(kind, sea);
      if (s) {
        ctx.globalAlpha = 0.6;
        const bx = t.x * TILE + Math.round((d.w * TILE - s.width) / 2);
        const by = kind === 'flag' ? t.y * TILE + 2 : kind === 'farm' || kind === 'trap' || kind === 'garden' ? t.y * TILE : (t.y + d.h) * TILE - baseline(s) + 1;
        ctx.drawImage(s, bx, by);
        ctx.globalAlpha = 1;
      }
    }
  }
  const r = rangeOf(g, kind);
  if (r) circle(ctx, tiles[0].x + 0.5, tiles[0].y + 0.5, r, 'rgba(255,225,74,0.5)');
}

/** Screen (css px) -> world tile coords. */
export function screenToTile(v: View, sx: number, sy: number) {
  const wx = (sx - v.w / 2) / v.cam.z + v.cam.x, wy = (sy - v.h / 2) / v.cam.z + v.cam.y;
  return { x: wx / TILE, y: wy / TILE };
}

export function clampCam(v: View) {
  const mw = MAP_W * TILE, mh = MAP_H * TILE;
  const minZ = Math.min(v.w / mw, v.h / mh) * 0.9;
  if (!Number.isFinite(v.cam.z)) v.cam.z = 2;
  if (!Number.isFinite(v.cam.x) || !Number.isFinite(v.cam.y)) { v.cam.x = mw / 2; v.cam.y = mh / 2; }
  v.cam.z = Math.max(Math.max(1, minZ), Math.min(6, v.cam.z));
  const hw = v.w / 2 / v.cam.z, hh = v.h / 2 / v.cam.z;
  v.cam.x = hw * 2 >= mw ? mw / 2 : Math.max(hw - 40, Math.min(mw - hw + 40, v.cam.x));
  v.cam.y = hh * 2 >= mh ? mh / 2 : Math.max(hh - 60, Math.min(mh - hh + 90, v.cam.y));
}
