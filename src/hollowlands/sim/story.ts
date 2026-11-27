// The Weaver: paces what the world throws at a colony. Trouble comes more often to the rich
// and the comfortable, backs off after a tragedy, and never arrives twice in quick succession.
// Events are sparks. What they lead to is up to the colony.

import { heardOf, traderTalk } from './tech';
import { cropsChanged } from './cache';
import { siegeable, startSiege } from './siege';
import { WALL_KINDS } from './data/buildings';
import { DAYS_PER_YEAR, HARD_CAP, SOFT_CAP, TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, seasonOf } from '../config';
import { checkSpec, pawnFromSpec, type PawnSpec } from './create';
import { addFact, learn } from './social';
import { accuse } from './crime';
import { nudge, takeHeir } from './player';
import { answer } from './ask';
import { abroadInput } from './abroad';
import { neighInput } from './neigh';
import { oddThing } from './odd';
import { importPawns } from './settle';
import { cells } from './data/buildings';
import { PLAYABLE } from './data/races';
import { canFight, spawnRaid } from './combat';
import { buyBeasts } from './herd';
import { foodUnits } from './econ';
import { bump, log, note } from './events';
import { infect, tend, wound } from './health';
import { think } from './mood';
import { STAGE, has, makePawn, mkAct, per, stage } from './pawn';
import { Rand, S } from './rng';
import { AX, type Colony, type Pawn, type RaceK } from './types';
import { stoneWant } from './market';

export const hasMod = (c: Colony, k: string): boolean => c.mods.some((m) => m[0] === k && m[1] > c.tick);

export function wealth(c: Colony): number {
  const s = c.stock;
  return c.pawns.length * 8 + foodUnits(c) / 10 + c.blds.length * 2 + s.goods + s.silver * 2 + s.weapons * 3 + s.tools * 2 + s.ale / 3 + s.iron * 2;
}

/** Someone new walks in from the road. */
export function arrive(c: Colony, p: Pawn, why: string): void {
  p.x = c.gx;
  p.y = Math.max(1, Math.min(c.h - 2, c.gy));
  p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
  c.pawns.push(p);
  think(c, p, 'arrived');
  note(c, p, 'arrived', undefined, c.name);
  log(c, 'joined', p.id, undefined, why);
  bump(c, 'joined');
  for (const o of c.pawns) {
    if (o === p || stage(c, o) < STAGE.ADULT) continue;
    if (per(o, AX.KIND) > 0.8 || has(o, 'gregarious')) { think(c, p, 'welcomed', o.id); }
    else if (has(o, 'bigot') && o.race !== p.race) { think(c, p, 'unwelcome', o.id); think(c, o, 'newcomer', p.id); }
    else if (per(o, AX.SOCIABLE) < -0.6) think(c, o, 'newcomer', p.id);
  }
}

function mainRace(c: Colony): RaceK {
  const n: Record<string, number> = {};
  let best: RaceK = 'human';
  for (const p of c.pawns) {
    n[p.race] = (n[p.race] ?? 0) + 1;
    if (n[p.race] > (n[best] ?? 0)) best = p.race;
  }
  return PLAYABLE.includes(best) ? best : 'human';
}

interface Opt { k: string; w: number }

function pick(r: Rand, opts: Opt[]): string {
  let total = 0;
  for (const o of opts) total += Math.max(0, o.w);
  if (total <= 0) return '';
  let roll = r.float() * total;
  for (const o of opts) {
    roll -= Math.max(0, o.w);
    if (roll <= 0) return o.k;
  }
  return opts[0].k;
}

/** Things queued for a set tick: scheduled raids now; players' actions and the owner's events later. */
export function applyInputs(c: Colony): void {
  for (let i = 0; i < c.inq.length;) {
    const e = c.inq[i];
    if (e.t > c.tick) { i++; continue; }
    c.inq.splice(i, 1);
    if (neighInput(c, e)) continue;
    if (abroadInput(c, e)) continue;
    if (e.k === 'raid') {
      // trouble sent from elsewhere may still be a day or two down the road
      if (e.delay) { c.inq.push({ ...e, t: c.tick + Number(e.delay), delay: undefined }); continue; }
      if (c.foes.length) {
        // a host on the march waits a day for the trouble already here to clear (for a few days at most)
        if ((e.siege || e.king) && Number(e.waits ?? 0) < 5) c.inq.push({ ...e, t: c.tick + TICKS_PER_DAY, waits: Number(e.waits ?? 0) + 1 });
        continue;
      }
      const rr = new Rand(c.seed, S.FIGHT, c.tick, 99);
      const from = e.fromId ? { id: String(e.fromId), name: String(e.fromName) } : undefined;
      // a host come to besiege a walled town makes camp; an unwalled one it simply falls on
      // (e.siege is the size of the host that comes if there are walls to besiege; e.n the band that comes if not)
      // the host's size answers to the colony's strength: 4 and one more for every 4 who can fight, 10 at most;
      // a band from beyond the hills sizes itself to the place too (they come for loot, not to be cut down)
      let fighters = 0;
      for (const p of c.pawns) if (canFight(c, p)) fighters++;
      const host = Math.min(Number(e.siege) || 1, 10, 4 + Math.floor(fighters / 4));
      const band = e.fromId || e.siege ? Math.min(Number(e.n) || 1, Math.max(2, Math.ceil(fighters / 2))) : Number(e.n) || 1;
      // the king's soldiers, come for the tax that was refused
      if (e.king) { log(c, 'v_kingmen', undefined, undefined, undefined, Number(e.n) || 1); c.stats.kingLoot = Math.round((Number(e.due) || 40) * 1.5); }
      const sieged = !!e.siege && siegeable(c) && startSiege(c, String(e.kind), host, String(e.name ?? e.fromName ?? ''), rr, from);
      if (!sieged) spawnRaid(c, String(e.kind), band, rr);
      if (e.fromId) {
        c.raidFrom = { id: String(e.fromId), name: String(e.fromName), loot0: c.stats.looted ?? 0, slain0: c.stats.foesSlain ?? 0, died0: c.stats.deaths ?? 0 };
        const g = (c.grudge ??= {});
        g[String(e.fromId)] = (g[String(e.fromId)] ?? 0) + 10;
        const war = c.wars?.[String(e.fromId)];
        if (war) war.came++;
        log(c, 'raiders_from', undefined, undefined, String(e.fromName));
      }
    }
    else if (e.k === 'nudge') nudge(c, e);
    else if (e.k === 'news') {
      log(c, 'news', undefined, undefined, String(e.what) + ':' + String(e.name) + ':' + String(e.who ?? ''));
      // something a neighbour has worked out: our own people start puzzling over it too
      if (e.what === 'tech') heardOf(c, String(e.who ?? '').split('|')[0], String(e.name));
      // sickness travels with the news
      if (e.what === 'outbreak' && e.who === 'plague') {
        const r = new Rand(c.seed, S.HEALTH, c.tick, 41);
        if (r.chance(0.25) && c.pawns.length) infect(c, r.pick(c.pawns), 'plague');
      }
    } else if (e.k === 'answer') answer(c, e);
    else if (e.k === 'migrant') {
      // someone from another colony walks in: an exile, or someone who had had enough
      if (!e.pawn || (c.pawns.length >= HARD_CAP && !(e.pawn as Pawn).owner)) continue;
      const id = importPawns(c, { k: 'settlers', t: c.tick, from: '', fromName: String(e.fromName), leader: (e.pawn as Pawn).id, pawns: [e.pawn as Pawn], stock: {} }, new Rand(c.seed, S.EVENT, c.tick, 5));
      const p = c.pawns.find((x) => x.id === id);
      if (p) {
        p.x = c.gx; p.y = Math.max(1, Math.min(c.h - 2, c.gy));
        p.act = mkAct('idle', c.tick, p.x, p.y, 1, 'new');
        p.bio.pop();
        note(c, p, 'migrated', undefined, String(e.fromName));
        log(c, 'joined', p.id, undefined, (e.why === 'exiled' ? 'exile:' : e.why === 'match' ? 'match:' : 'migrant:') + String(e.fromName));
        if (e.why === 'match') {
          // sent to marry: the best-placed unwed adult of this colony takes their hand
          p.rank = 5;
          const o = c.pawns.filter((x) => x !== p && !x.gone && !x.sp && !x.thrall && stage(c, x) === STAGE.ADULT && x.sex !== p.sex && x.mo !== p.mo).sort((a, b) => b.rank - a.rank || a.id - b.id)[0];
          if (o) {
            p.sp = o.id; o.sp = p.id;
            p.rel[o.id] = { m: [], k: 'betrothed', s: c.tick };
            o.rel[p.id] = { ...(o.rel[p.id] ?? { m: [] }), k: 'betrothed', s: c.tick };
            log(c, 'match', p.id, o.id, String(e.fromName));
            note(c, p, 'match', o.id, String(e.fromName));
            note(c, o, 'match', p.id, String(e.fromName));
          }
        }
        bump(c, 'migrants');
      }
    }
    else if (e.k === 'heir') takeHeir(c, e);
    else if (e.k === 'join') {
      // a player's colonist walks in off the road
      const spec = e.spec as PawnSpec;
      if (c.pawns.length >= HARD_CAP || !checkSpec(spec).ok) continue;
      const p = pawnFromSpec(c, spec, String(e.owner ?? ''));
      arrive(c, p, 'player');
      if (p.secret) p.know.push(addFact(c, 'secret', p.id, undefined, true, p.secret).id);
    }
  }
}

/** Once a day, at midnight. */
export function dailyStory(c: Colony): void {
  const day = dayOf(c.tick);
  const season = seasonOf(c.tick);
  const r = new Rand(c.seed, S.STORY, day);
  c.mods = c.mods.filter((m) => m[1] > c.tick);
  const pop = c.pawns.length;
  if (!pop) return;
  const rich = wealth(c);
  c.story.heat += 1 + rich / 260;
  const quiet = day - dayOf(c.story.lastBad);
  let recentDeaths = 0;
  for (const d of c.dead) if (!d.left && c.tick - d.died < TICKS_PER_DAY * 6) recentDeaths++;

  // Good or neutral things happen on their own clock
  if (day >= 3 && r.chance(0.085)) goodThing(c, r, season, pop);
  if (day >= 20 && r.chance(0.022)) oddThing(c, new Rand(c.seed, S.STORY, day, 31));

  if (day < 20 || c.foes.length || quiet < 6 || c.story.heat < 14) return;
  if (!r.chance(recentDeaths >= 2 ? 0.04 : recentDeaths ? 0.1 : 0.22)) return;

  let able = 0;
  for (const p of c.pawns) if (stage(c, p) >= STAGE.ADULT && !has(p, 'pacifist') && !has(p, 'coward')) able++;
  const points = Math.min(able * 25 + 16, 22 + rich * 0.42 + Math.min(140, day * 0.18)) * (0.7 + r.float() * 0.7);
  let growing = 0;
  for (const b of c.blds) if (b.k === 'field' && b.built) for (const cell of cells('field')) { const v = c.crop[(b.y + cell.dy) * c.w + b.x + cell.dx]; if (v > 0) growing++; }
  let goblins = 0;
  for (const p of c.pawns) if (p.race === 'goblin') goblins++;
  const graves = c.dead.filter((d) => !d.left).length;
  const well = c.blds.some((b) => b.k === 'well' && b.built);
  const k = pick(r, [
    { k: 'wolf', w: season === 3 ? 7 : 2.2 },
    { k: 'boar', w: season === 3 ? 0 : 1.2 },
    { k: 'bandit', w: rich > 70 ? 3.2 : 0.5 },
    { k: 'slaver', w: pop >= 8 ? 1.5 : 0 },
    { k: 'ghoul', w: graves >= 2 ? 1.3 : 0 },
    { k: 'orc', w: points >= 85 ? 1.5 : 0 },
    { k: 'troll', w: points >= 115 && c.biome !== 'coast' ? 0.6 : 0 },
    { k: 'blight', w: growing > 40 ? 1.3 : 0 },
    { k: 'drought', w: season === 1 ? 1.4 : 0 },
    { k: 'coldsnap', w: season === 3 ? 2.6 : season === 2 ? 0.6 : 0 },
    { k: 'storm', w: season === 3 ? 0.4 : 1.1 },
    { k: 'flux', w: season === 1 ? (well ? 0.8 : 2) : 0.2 },
    { k: 'plague', w: pop >= 10 ? 1.1 : 0 },
    { k: 'pox', w: goblins ? 0.8 : 0.25 },
    { k: 'fire', w: season === 1 || c.pawns.some((p) => has(p, 'pyro')) ? 0.9 : 0.3 },
    { k: 'rats', w: c.stock.grain > 60 ? 0.9 : 0 },
    { k: 'eclipse', w: 0.35 },
  ]);
  if (!k) return;
  c.story.heat = 0;
  c.story.lastBad = c.tick;
  c.story.last = c.tick;
  bump(c, 'badEvents');
  const n = (cost: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(points / cost)));
  // trouble does not keep office hours: wolves and ghouls come by night, the rest whenever
  const raid = (kind: string, count: number, night: boolean): void => {
    const hour = night ? 20 + r.int(8) : 5 + r.int(17);
    c.inq.push({ t: c.tick + hour * TICKS_PER_HOUR + r.int(TICKS_PER_HOUR), k: 'raid', kind, n: count });
  };
  switch (k) {
    case 'wolf': raid('wolf', n(14, 2, 7), true); break;
    case 'boar': raid('boar', n(40, 1, 2), false); break;
    case 'bandit': raid('bandit', n(22, 2, 8), false); break;
    case 'slaver': raid('slaver', n(27, 2, 6), false); break;
    case 'ghoul': raid('ghoul', n(26, 2, 5), true); break;
    case 'orc': raid('orc', n(38, 2, 6), false); break;
    case 'troll': raid('troll', 1, false); break;
    case 'blight': {
      let lost = 0;
      for (const b of c.blds) {
        if (b.k !== 'field' || !b.built || !r.chance(0.6)) continue;
        for (const cell of cells('field')) {
          const i = (b.y + cell.dy) * c.w + b.x + cell.dx;
          if (c.crop[i] > 0 && r.chance(0.55)) { c.crop[i] = 0; lost++; }
        }
      }
      if (lost) cropsChanged(c);
      log(c, 'blight', undefined, undefined, undefined, lost);
      break;
    }
    case 'drought': c.mods.push(['drought', c.tick + (6 + r.int(5)) * TICKS_PER_DAY]); log(c, 'drought'); break;
    case 'coldsnap': c.mods.push(['coldsnap', c.tick + (3 + r.int(4)) * TICKS_PER_DAY]); log(c, 'coldsnap'); break;
    case 'storm': {
      for (const b of c.blds) if (b.built && b.k !== 'field' && b.k !== 'graveyard' && b.k !== 'well' && !WALL_KINDS.has(b.k)) b.dmg = Math.min(80, b.dmg + 6 + r.int(14));
      const out = c.pawns.filter((p) => stage(c, p) >= STAGE.TEEN);
      if (out.length && r.chance(0.5)) wound(c, r.pick(out), 'crush', 10 + r.int(16), r);
      log(c, 'storm');
      break;
    }
    case 'flux':
    case 'plague':
    case 'pox': {
      const order = r.shuffle(c.pawns);
      let hit = 0;
      const want = k === 'plague' ? 1 + r.int(2) : 2 + r.int(2);
      for (const p of order) { if (hit >= want) break; if (infect(c, p, k)) hit++; }
      if (hit) log(c, 'outbreak', undefined, undefined, k, hit);
      break;
    }
    case 'fire': {
      const wooden = c.blds.filter((b) => b.built && !b.mat && b.k !== 'field' && b.k !== 'graveyard' && b.k !== 'well');
      if (!wooden.length) break;
      const b = r.pick(wooden);
      b.dmg = Math.min(80, b.dmg + 35 + r.int(25));
      if (b.k === 'store') for (const key of ['grain', 'veg', 'meal', 'wood', 'cloth', 'leather', 'goods'] as const) c.stock[key] *= 0.75;
      for (const id of b.beds) {
        const p = c.pawns.find((x) => x.id === id);
        if (p && r.chance(0.3)) wound(c, p, 'burn', 8 + r.int(16), r);
      }
      const firebug = c.pawns.find((p) => has(p, 'pyro') && p.mood < 45);
      log(c, 'fire', firebug?.id, undefined, b.k);
      // in a dry wind it jumps from roof to roof
      let spread = 0;
      for (const o of wooden) {
        if (o === b || spread >= 3) continue;
        const near = Math.abs(o.x + o.w / 2 - b.x - b.w / 2) + Math.abs(o.y + o.h / 2 - b.y - b.h / 2) < 12;
        if (near && r.chance(c.weather >= 2 ? 0.1 : season === 1 ? 0.45 : 0.3)) { o.dmg = Math.min(80, o.dmg + 20 + r.int(25)); spread++; }
      }
      if (spread) log(c, 'fire_spread', undefined, undefined, undefined, spread);
      for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, spread ? 'bigfire' : 'foughtfire');
      if (firebug && r.chance(0.35)) {
        const w = c.pawns.find((p) => p !== firebug && stage(c, p) >= STAGE.ADULT);
        if (w) { const f = addFact(c, 'arson', firebug.id, undefined, true); learn(c, w, f); accuse(c, w, firebug, 'arson', f); }
      }
      break;
    }
    case 'rats': { const lost = c.stock.grain * (0.15 + r.float() * 0.2); c.stock.grain -= lost; log(c, 'rats', undefined, undefined, undefined, Math.round(lost)); break; }
    case 'eclipse': {
      for (const p of c.pawns) {
        if (stage(c, p) < STAGE.CHILD) continue;
        if (has(p, 'superstitious') || p.dev >= 2) think(c, p, 'omen_bad');
        else if (has(p, 'curious') || has(p, 'skeptic')) think(c, p, 'omen_good');
      }
      log(c, 'eclipse');
      break;
    }
    default: break;
  }
  void DAYS_PER_YEAR;
}

function goodThing(c: Colony, r: Rand, season: number, pop: number): void {
  const hurt = c.pawns.some((p) => p.inj.length || p.ill);
  const k = pick(r, [
    // newcomers matter most to a small colony; past the soft cap nobody new comes looking
    { k: 'wanderer', w: pop >= SOFT_CAP ? 0 : pop < SOFT_CAP * 0.4 ? 5 : pop < SOFT_CAP * 0.67 ? 3 : pop < SOFT_CAP * 0.87 ? 1.4 : 0.5 },
    { k: 'trader', w: 3 },
    { k: 'herd', w: season === 3 ? 0.4 : 1 },
    { k: 'omen', w: 0.5 },
    { k: 'healer', w: hurt ? 1.5 : 0 },
    { k: 'bumper', w: season === 1 ? 0.8 : 0 },
  ]);
  c.story.last = c.tick;
  switch (k) {
    case 'wanderer': {
      const race = r.chance(0.55) ? mainRace(c) : r.pick(PLAYABLE);
      arrive(c, makePawn(c, r, { race }), 'wanderer');
      break;
    }
    case 'trader': trade(c, r); break;
    case 'herd': c.game = Math.min(100, c.game + 45); log(c, 'herd'); break;
    case 'omen': {
      for (const p of c.pawns) if (stage(c, p) >= STAGE.CHILD && (p.dev >= 2 || has(p, 'superstitious'))) think(c, p, 'omen_good');
      log(c, 'omen');
      break;
    }
    case 'healer': {
      const best = c.pawns.reduce((a, b) => (b.sk[8] > a.sk[8] ? b : a), c.pawns[0]);
      for (const p of c.pawns) if (p.inj.some((i) => !i.tend) || p.ill) { c.stock.medicine += 1; tend(c, best, p, r); }
      c.stock.medicine += 2;
      log(c, 'healer_visit');
      break;
    }
    case 'bumper': {
      for (const b of c.blds) if (b.k === 'field') b.tend = Math.min(100, (b.tend ?? 0) + 35);
      log(c, 'bumper');
      break;
    }
    default: break;
  }
}

/** A caravan stops for the day: surplus out, needs in. */
function trade(c: Colony, r: Rand): void {
  const s = c.stock;
  const pop = c.pawns.length;
  let silver = s.silver;
  const sell = (k: 'goods' | 'leather' | 'ale' | 'cloth', keep: number, price: number): void => {
    const n = Math.max(0, s[k] - keep) * 0.8;
    s[k] -= n;
    silver += n * price;
  };
  sell('goods', 0, 1.2);
  sell('leather', 6, 0.5);
  sell('ale', pop * 1.5, 0.25);
  sell('cloth', 8, 0.5);
  let bought = 0;
  const buy = (k: 'tools' | 'medicine' | 'iron' | 'clothes' | 'weapons' | 'grain' | 'stone' | 'wood', want: number, price: number): void => {
    const n = Math.min(Math.max(0, want - s[k]), silver / price);
    if (n <= 0.2) return;
    s[k] += n;
    silver -= n * price;
    bought += n;
  };
  buy('medicine', 2 + pop * 0.15, 3);
  buy('tools', 2 + pop * 0.2, 3);
  if (s.grain + s.veg + s.meal < pop * 8) buy('grain', pop * 14, 0.3);
  buy('weapons', pop * 0.25, 5);
  buy('iron', 4, 2);
  // stone and timber by the cartload, for whatever the town is waiting to build (half the treasury at most)
  const want = stoneWant(c);
  const keep = silver * 0.5;
  silver -= keep;
  if (s.stone < 10 || want > s.stone + 10) buy('stone', Math.max(30, Math.min(want, s.stone + 80)), 0.4);
  if (s.wood < pop * 4) buy('wood', pop * 8, 0.2);
  silver += keep;
  buy('clothes', 1 + pop * 0.15, 2.5);
  s.silver = silver;
  const beasts = r.chance(0.5) ? buyBeasts(c, r) : '';
  if (beasts) log(c, 'bought_beasts', undefined, undefined, beasts);
  for (const p of c.pawns) if (stage(c, p) >= STAGE.TEEN) think(c, p, 'newfaces');
  const from = c.near?.length ? r.pick(c.near).name : undefined;
  log(c, 'trader', undefined, undefined, from, Math.round(bought));
  // traders from a neighbour who knows something we do not: they talk about it
  traderTalk(c, from);
  bump(c, 'traders');
}
