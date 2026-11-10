// The coming world: the map ballot, then the founding period and countdown before it begins.
// Candidate maps are generated in the browser from their seeds with the same code the server
// uses, so what people vote on and found on is exactly the world that will begin.

import { createWorld, type World } from '../sim/index';
import { isLand } from '../sim/worldgen';
import { BIOMES } from '../sim/worldgen';
import type { ValueId } from '../sim/types';
import { bannerSvg, specFromNums } from './banner';
import { civColor } from './map';
import { esc } from './panels';

export interface Archive { id: string; seed: number; year: number; ended: number; peoples: number; founders: number }
export interface PreFounded { tile: number; name: string | null; banner: number[]; byName: string | null; values: ValueId[]; mine: boolean }
export interface NextInfo {
  phase: 'none' | 'vote' | 'prep';
  simV?: number; held?: boolean;
  round?: string; seeds?: number[]; civs?: number; fill?: number; seed?: number | null; startAt?: number | null; now: number;
  points?: number[]; firsts?: number[]; voters?: number;
  mine?: { first: number; second: number } | Record<string, unknown> | null;
  peoples?: PreFounded[];
  archives: Archive[];
}

export interface Candidate { seed: number; w: World; img: string; land: number; masses: number; rivers: number; terrain: string }

const cands = new Map<string, Candidate>();

/** A candidate map at year 0, with a small picture and a few facts. */
export function candidate(seed: number, civs: number): Candidate {
  const key = `${seed}:${civs}`;
  let c = cands.get(key);
  if (c) return c;
  const w = createWorld({ seed, civs });
  const S = 3;
  const cv = document.createElement('canvas');
  cv.width = w.W * S + 2;
  cv.height = w.H * S;
  const g = cv.getContext('2d')!;
  let land = 0;
  const kinds = new Map<string, number>();
  for (let y = 0; y < w.H; y++) {
    for (let x = 0; x < w.W; x++) {
      const i = y * w.W + x;
      g.fillStyle = w.t.river[i] && isLand(w.t, i) ? '#3a74a3' : BIOMES[w.t.biome[i]].c;
      g.fillRect(x * S + (y & 1 ? 1.5 : 0), y * S, S + 0.5, S + 0.5);
      if (isLand(w.t, i)) {
        land++;
        const n = ({ Mountain: 'mountains', Marsh: 'marshes', Snow: 'ice' } as Record<string, string>)[BIOMES[w.t.biome[i]].n] ?? BIOMES[w.t.biome[i]].n.toLowerCase();
        kinds.set(n, (kinds.get(n) ?? 0) + 1);
      }
    }
  }
  for (const civ of w.civs) {
    const s = w.setts[civ.capital];
    const x = (s.tile % w.W) * S + 1.5;
    const y = Math.floor(s.tile / w.W) * S + 1.5;
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fillStyle = civColor(civ.hue, 62);
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = '#0b0e15';
    g.stroke();
  }
  const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  c = { seed, w, img: cv.toDataURL(), land: land / (w.W * w.H), masses: landmasses(w), rivers: w.rivers.length, terrain: `mostly ${top.join(' and ')}` };
  cands.set(key, c);
  return c;
}

/** Land areas big enough to matter (at least 2% of the map). */
function landmasses(w: World): number {
  const seen = new Uint8Array(w.W * w.H);
  let n = 0;
  const min = w.W * w.H * 0.02;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !isLand(w.t, i)) continue;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      size++;
      const x = t % w.W;
      const y = Math.floor(t / w.W);
      const odd = y & 1;
      const nb = [[x - 1, y], [x + 1, y], [x - 1 + odd, y - 1], [x + odd, y - 1], [x - 1 + odd, y + 1], [x + odd, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w.W || ny >= w.H) continue;
        const j = ny * w.W + nx;
        if (!seen[j] && isLand(w.t, j)) { seen[j] = 1; stack.push(j); }
      }
    }
    if (size >= min) n++;
  }
  return n;
}

export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${ss}s`;
  return `${m}m ${ss}s`;
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A short label for the top bar, or '' when nothing is coming. */
export function pillText(n: NextInfo | null, now: number): string {
  if (!n || n.phase === 'none') return '';
  if (n.phase === 'vote') return n.mine ? 'Next world · you voted' : 'Vote on the next world';
  return n.startAt ? `New world in ${countdown(n.startAt - now)}` : 'New world · founding open';
}

const facts = (c: Candidate) => `${c.masses === 1 ? 'One great landmass' : `${c.masses} landmasses`}, ${c.terrain} · ${c.rivers} rivers`;

/**
 * The card. `live` is true on the living world's page (where founding means going to the
 * new world's page) and false on the new world's own page.
 */
export function nextHtml(n: NextInfo, now: number, opts: { live: boolean; viewing: number; ballot: [number, number]; unnamed?: boolean }): string {
  if (n.phase === 'none') return '';
  const civs = n.civs ?? 20;
  if (n.phase === 'vote') {
    const seeds = n.seeds ?? [];
    const pts = n.points ?? [];
    const max = Math.max(1, ...pts);
    const [first, second] = opts.ballot;
    return `<div class="nh"><h2>Choose the next world</h2><button class="icon" data-n="close" aria-label="Close">✕</button></div>
      <p class="lead">A new world is coming. Vote for its map: your first pick counts 2 points, your second 1. When voting closes, founding opens on the winning map, and everyone who founds a people before it begins starts together in year 0${civs ? '' : ', with the land to themselves at first'}.</p>
      <div class="cands">${seeds.map((seed, i) => {
        const c = candidate(seed, civs);
        const tag = i === first ? '<span class="pick p1">1st</span>' : i === second ? '<span class="pick p2">2nd</span>' : '';
        return `<div class="cand ${i === first ? 'first' : i === second ? 'second' : ''} ${i === opts.viewing ? 'viewing' : ''}">
          <button class="thumb" data-n="see" data-v="${i}" title="Look closer"><img src="${c.img}" alt="Map ${i + 1}">${tag}</button>
          <div class="cn"><b>Map ${i + 1}</b><small>${facts(c)}</small></div>
          <div class="bar"><i style="width:${(100 * (pts[i] ?? 0)) / max}%"></i><span>${pts[i] ?? 0} pts</span></div>
          <div class="cb"><button class="btn ${i === first ? 'on' : ''}" data-n="first" data-v="${i}">1st pick</button><button class="btn ${i === second ? 'on' : ''}" data-n="second" data-v="${i}">2nd pick</button></div>
        </div>`;
      }).join('')}</div>
      ${opts.unnamed ? `<p class="hint">${civs ? 'The ancient peoples, towns and rivers are' : 'Rivers are'} named when the world begins.</p>` : ''}
      <p class="hint">${n.voters ?? 0} ${n.voters === 1 ? 'ballot' : 'ballots'} so far. ${first >= 0 ? 'Your ballot is saved; you can change it until voting closes.' : 'Pick a map to cast your ballot.'} ${civs ? `Dots are where the ${civs} ancient peoples begin.` : `No one lives here at the start: founders arrive first, and AI peoples come later to fill the empty land.`}${opts.live ? ' Tap a map to look at it up close.' : ''}</p>
      ${opts.live ? '<p class="hint">This world carries on until the new one begins, and stays open to visit afterward.</p>' : ''}`;
  }
  const c = candidate(n.seed!, civs);
  const peoples = n.peoples ?? [];
  const mine = peoples.find((p) => p.mine);
  const start = n.startAt
    ? `<div class="count"><small>Begins in</small><b data-countdown="${n.startAt}">${countdown(n.startAt - now)}</b><small>${esc(when(n.startAt))}</small></div>`
    : '<div class="count"><small>Begins</small><b>Soon</b><small>The start time will be announced.</small></div>';
  const act = mine
    ? `<p>Your people, the <b>${esc(mine.name ?? 'unnamed')}</b>, are ready to set out.</p><div class="row2">${opts.live ? '<button class="btn gold" data-n="go">See them on the new map</button>' : '<button class="btn" data-n="edit">Change</button><button class="btn" data-n="withdraw">Withdraw</button>'}</div>`
    : `<div class="row2"><button class="btn gold" data-n="${opts.live ? 'go' : 'found'}">Found your people in the new world</button></div>`;
  return `<div class="nh"><h2>The new world</h2><button class="icon" data-n="close" aria-label="Close">✕</button></div>
    <div class="prep"><img src="${c.img}" alt="The new world's map"><div>${start}<p class="hint">${facts(c)}</p></div></div>
    <p class="lead">Found your people now and they arrive in its very first month, ${civs ? `alongside the ${civs} ancient peoples` : 'before anyone else: AI peoples only arrive from the second year, on land no founder has taken'}. You can change or withdraw them until it begins. Peoples in the current world carry on there until it ends.</p>
    ${act}
    ${opts.unnamed ? `<p class="hint">${civs ? 'The ancient peoples, towns and rivers are' : 'Rivers are'} named when the world begins.</p>` : ''}
    ${n.held ? '<p class="hint">The current world now holds still until the new one begins.</p>' : ''}
    <h3>Ready to set out <span class="legend">${peoples.length}</span></h3>
    ${peoples.length ? `<div class="waiting">${peoples.map((p, i) => `<button class="wp" data-n="tile" data-v="${p.tile}"><span class="wn">${i + 1}</span>${bannerSvg(specFromNums(p.banner), 18)}<span><b>${esc(p.name ?? 'A people')}</b>${p.byName ? `<small>founded by ${esc(p.byName)}</small>` : ''}</span></button>`).join('')}</div>` : '<p class="hint">No one yet. Be the first.</p>'}`;
}

/**
 * The new world will run a newer sim than this page, which names things differently: blank
 * the names rather than show ones that will change. Land and starting places are the same.
 */
export function unname(w: World): void {
  for (const c of w.civs) c.name = '';
  for (const s of w.setts) s.name = '';
  for (const r of w.rivers) r.name = '';
}

/** Earlier worlds, for the world page. */
export function archivesHtml(list: Archive[]): string {
  if (!list.length) return '';
  return `<h3>Earlier worlds</h3>${list.map((a, i) => `<p><a href="?world=${encodeURIComponent(a.id)}">${list.length - i === 1 ? 'The first world' : `World ${list.length - i}`}</a> <span class="legend">${a.year} years · ${a.peoples} peoples, ${a.founders} founded by visitors · ended ${new Date(a.ended).toLocaleDateString()}</span></p>`).join('')}`;
}
