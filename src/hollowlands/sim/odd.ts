// The strange things. None of these is a plot: each is a spark dropped into a colony, and
// what people make of it depends on who they are.

import { SOFT_CAP, TICKS_PER_DAY } from '../config';
import { foodDays } from './econ';
import { bump, factById, log, note } from './events';
import { think } from './mood';
import { STAGE, has, makePawn, mkAct, per, stage } from './pawn';
import type { Rand } from './rng';
import { learn } from './social';
import { AX, type Colony, type Pawn } from './types';

interface Odd { k: string; w: (c: Colony, adults: Pawn[]) => number; run: (c: Colony, adults: Pawn[], r: Rand) => boolean }

const OGRES = ['Mog', 'Dunch', 'Big Aud', 'Hrup', 'Gorm', 'Little Bess'];

const ODD: Odd[] = [
  {
    // hungry people will believe a great deal
    k: 'goat', w: (c) => (foodDays(c) < 7 ? 3 : 0.4),
    run: (c, adults, r) => {
      const herd = adults.filter((p) => p.dev >= 1).sort((a, b) => per(b, AX.PIETY) - per(a, AX.PIETY))[0];
      if (!herd) return false;
      for (const p of adults) think(c, p, p.dev >= 2 || has(p, 'superstitious') ? 'omen_good' : has(p, 'skeptic') ? 'folly' : 'goatday');
      c.mods.push(['goat', c.tick + TICKS_PER_DAY * (8 + r.int(10))]);
      log(c, 'odd_goat', herd.id);
      note(c, herd, 'odd_goat');
      return true;
    },
  },
  {
    k: 'ring', w: () => 1,
    run: (c, adults, r) => {
      const p = r.pick(adults);
      if (p.heirloom) return false;
      p.heirloom = 'a ring that is always cold';
      p.coin += 12;
      if (!has(p, 'greedy') && !has(p, 'generous') && !has(p, 'content')) p.traits = [...p.traits, 'greedy'];
      think(c, p, 'cursedring');
      log(c, 'odd_ring', p.id);
      note(c, p, 'odd_ring');
      return true;
    },
  },
  {
    // a raven that repeats what it has heard, to whoever is standing nearest
    k: 'raven', w: (c) => (c.facts.length > 3 ? 1.2 : 0),
    run: (c, adults, r) => {
      const secrets = c.facts.filter((f) => f.real && (f.k === 'affair' || f.k === 'secret' || f.k === 'theft' || f.k === 'bastard') && adults.some((p) => p.id === f.a) && adults.filter((p) => p.know.includes(f.id)).length <= 3);
      if (!secrets.length) return false;
      const f = factById(c, r.pick(secrets).id);
      if (!f) return false;
      const hear = r.shuffle(adults.filter((p) => p.id !== f.a && p.id !== f.b)).slice(0, 3);
      for (const p of hear) learn(c, p, f);
      log(c, 'odd_raven', f.a, undefined, f.k, hear.length);
      return true;
    },
  },
  {
    k: 'ogre', w: (c) => (c.pawns.length < SOFT_CAP - 2 && !c.pawns.some((p) => p.epi === 'the Ogre') ? 0.7 : 0),
    run: (c, _adults, r) => {
      const p = makePawn(c, r, { race: 'orc', first: r.pick(OGRES), fam: 'of the Hills' });
      p.epi = 'the Ogre';
      p.traits = ['tough', 'gentle', 'slow'];
      p.look.body = 4;
      p.sk[0] = 9; p.sk[2] = 6; p.sk[3] = 6; p.sk[10] = 0;
      p.x = c.gx; p.y = Math.max(1, Math.min(c.h - 2, c.gy));
      p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
      c.pawns.push(p);
      think(c, p, 'arrived');
      for (const o of c.pawns) if (o !== p && stage(c, o) >= STAGE.CHILD) think(c, o, stage(c, o) === STAGE.CHILD || per(o, AX.BRAVE) > 0.3 ? 'ogrefriend' : 'ogrefear', p.id);
      log(c, 'odd_ogre', p.id);
      note(c, p, 'odd_ogre', undefined, c.name);
      return true;
    },
  },
  {
    k: 'ghost', w: (c) => (c.dead.some((d) => !d.left) ? 1.3 : 0),
    run: (c, adults, r) => {
      const pairs: [Pawn, number][] = [];
      for (const p of adults) for (const d of c.dead) if (!d.left && (d.sp === p.id || d.mo === p.id || d.fa === p.id || p.mo === d.id || p.fa === d.id) && c.tick - d.died < TICKS_PER_DAY * 240) pairs.push([p, d.id]);
      if (!pairs.length) return false;
      const [p, dead] = r.pick(pairs);
      think(c, p, has(p, 'skeptic') ? 'ghostdoubt' : 'sawghost', dead);
      for (const o of adults) if (o !== p && has(o, 'superstitious')) think(c, o, 'omen_bad');
      log(c, 'odd_ghost', p.id, dead);
      note(c, p, 'odd_ghost', dead);
      return true;
    },
  },
  {
    k: 'mushroom', w: () => 1,
    run: (c, adults, r) => {
      const p = r.pick(adults);
      p.insp = ['insight', c.tick + TICKS_PER_DAY * 2];
      p.dev = 3;
      think(c, p, 'visions');
      for (const o of r.shuffle(adults.filter((x) => x !== p)).slice(0, 3)) think(c, o, per(o, AX.PIETY) > 0 ? 'heardtale' : 'bored_by', p.id);
      log(c, 'odd_mushroom', p.id);
      note(c, p, 'odd_mushroom');
      return true;
    },
  },
  {
    k: 'coat', w: (c) => (c.stock.silver >= 8 ? 1 : 0),
    run: (c, adults) => {
      c.stock.silver -= 8;
      for (const p of adults) think(c, p, per(p, AX.HUMOR) > 0.5 ? 'coatlaugh' : 'swindled');
      log(c, 'odd_coat');
      return true;
    },
  },
  {
    k: 'oath', w: (c) => (c.stock.ale > 2 ? 1 : 0),
    run: (c, adults, r) => {
      const pool = adults.filter((p) => !p.epi && !has(p, 'teetotal') && p.id !== c.gov.ruler && (p.race === 'dwarf' || has(p, 'drunkard') || per(p, AX.LOYAL) > 0.5));
      const b = c.blds.filter((x) => x.built && x.k !== 'field' && x.k !== 'graveyard' && x.k !== 'well');
      if (!pool.length || !b.length) return false;
      const p = r.pick(pool);
      const bld = r.pick(b);
      p.epi = 'the Doorward';
      if (p.prof !== 'guard') p.prof = 'guard';
      think(c, p, 'oath');
      log(c, 'odd_oath', p.id, undefined, bld.k);
      note(c, p, 'odd_oath', undefined, bld.k);
      return true;
    },
  },
  {
    k: 'bones', w: (c) => (c.stats.bones ? 0 : 0.8),
    run: (c, adults) => {
      c.stats.bones = 1;
      c.stock.stone += 10;
      for (const p of adults) think(c, p, has(p, 'morbid') ? 'bonesglad' : has(p, 'superstitious') || p.dev >= 2 ? 'omen_bad' : 'bonesuneasy');
      log(c, 'odd_bones');
      return true;
    },
  },
  {
    k: 'cat', w: (c) => (c.mods.some((m) => m[0] === 'cat') ? 0 : 1),
    run: (c) => {
      c.mods.push(['cat', c.tick + TICKS_PER_DAY * 600]);
      for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD) think(c, p, 'colonycat');
      log(c, 'odd_cat');
      return true;
    },
  },
  {
    k: 'weep', w: (c) => (c.blds.some((b) => b.k === 'shrine' && b.built) ? 0.8 : 0),
    run: (c, adults) => {
      for (const p of adults) think(c, p, p.dev >= 2 ? 'omen_good' : has(p, 'skeptic') ? 'folly' : 'bonesuneasy');
      log(c, 'odd_weep');
      return true;
    },
  },
];

/** Now and then, something odd. */
export function oddThing(c: Colony, r: Rand): void {
  const adults = c.pawns.filter((p) => !p.gone && stage(c, p) >= STAGE.ADULT && !p.thrall);
  if (adults.length < 5) return;
  let total = 0;
  const ws = ODD.map((o) => { const w = Math.max(0, o.w(c, adults)); total += w; return w; });
  if (total <= 0) return;
  let roll = r.float() * total;
  for (let i = 0; i < ODD.length; i++) {
    roll -= ws[i];
    if (roll <= 0) { if (ODD[i].run(c, adults, r)) bump(c, 'oddThings'); return; }
  }
}
