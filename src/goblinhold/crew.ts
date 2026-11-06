// Crew sidebar (every colonist at a glance) and map hover tooltips.
import { BUILD, GOBS, JOB_ORDER, JOBS, KEEP_LEVELS, T_BUSH, T_ROCK, T_SAPLING, T_TREE, T_WATER } from './defs';
import { bld, bldAtTile } from './map';
import { bedCount, bedsOf, activity, canPromote, mood, season } from './sim';
import { CH, settlerSprites } from './chars';
import { Game, idx, inMap, Settler } from './state';

const portraits = new Map<string, string>();
export function portrait(s: Settler, size = 24) {
  const k = `${s.job}|${s.look}|${size}`;
  let u = portraits.get(k);
  if (!u) {
    // head and shoulders, cropped from the idle frame and scaled up without blur
    const sp = settlerSprites(s.job, s.look)[0];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    x.drawImage(sp, CH.ax - 9, 5, 18, 18, 0, 0, size, size);
    u = c.toDataURL(); portraits.set(k, u);
  }
  return u;
}

/** The single most urgent thing about a settler, as a short tag. */
export function crewStatus(g: Game, s: Settler): { t: string; c: 'bad' | 'warn' | 'good' | '' } {
  const k = s.task?.k;
  if (s.away > 0) return { t: 'Away', c: '' };
  if (k === 'flee') return { t: 'Fleeing', c: 'bad' };
  if (k === 'sulk') return { t: 'Breakdown', c: 'bad' };
  if (k === 'recover') return { t: 'Wounded', c: 'bad' };
  if (s.hp < s.maxHp * 0.4) return { t: 'Hurt', c: 'bad' };
  if (s.sick > 0) return { t: 'Sick', c: 'bad' };
  if (s.needs.hunger < 25) return { t: 'Hungry', c: 'bad' };
  if (s.needs.warmth < 25) return { t: 'Cold', c: 'warn' };
  if (s.needs.rest < 18) return { t: 'Exhausted', c: 'warn' };
  if (s.needs.safety < 20) return { t: 'Scared', c: 'warn' };
  if (s.job === 'idle') return { t: 'Idle', c: 'warn' };
  if (JOBS[s.job].combat && canPromote(g, s)) return { t: 'Promote', c: 'good' };
  return { t: '', c: '' };
}

let mini = false;
try { mini = localStorage.getItem('goblinhold.crew') === 'mini'; } catch { /* storage blocked */ }
export function toggleCrewMini() {
  mini = !mini;
  try { localStorage.setItem('goblinhold.crew', mini ? 'mini' : 'full'); } catch { /* storage blocked */ }
}

/** HTML for the crew sidebar. `sel` is the selected settler id, if any. */
export function crewHTML(g: Game, sel: number): string {
  const order = (s: Settler) => {
    const night = g.phase !== 'day';
    const combat = JOBS[s.job].combat ? 0 : 1;
    return (night ? combat * 100 : 0) + JOB_ORDER.indexOf(s.job);
  };
  const list = [...g.settlers].sort((a, b) => order(a) - order(b) || a.id - b.id);
  const idle = g.settlers.filter((s) => s.job === 'idle').length;
  const alerts = g.settlers.filter((s) => crewStatus(g, s).c === 'bad').length;
  const rows = list.map((s) => {
    const st = crewStatus(g, s);
    const m = mood(g, s);
    const mc = m >= 60 ? 'var(--green)' : m >= 35 ? 'var(--gold)' : 'var(--red)';
    const hp = s.hp / s.maxHp;
    const tip = `<b>${s.name}</b> · ${JOBS[s.job].name}<br>${activity(g, s)}<br>Mood ${m} · Health ${Math.ceil(s.hp)}/${s.maxHp}${st.t ? `<br><b>${st.t}</b>` : ''}`;
    return `<div class="cr${sel === s.id ? ' sel' : ''}${st.c === 'bad' ? ' alert' : ''}" data-sid="${s.id}" style="--jc:${JOBS[s.job].color}" ${mini ? `data-tip="${tip.replace(/"/g, '&quot;')}"` : ''}>
      <img src="${portrait(s, 36)}" alt="">
      <span class="t"><b>${s.name}</b><small>${activity(g, s)}</small></span>
      <span class="r">${st.t ? `<span class="tag ${st.c}">${st.t}</span>` : ''}<i class="md" style="background:${mc}" data-tip="Mood ${m}"></i></span>
      <span class="hp"><i style="width:${Math.round(hp * 100)}%;background:${hp < 0.4 ? 'var(--red)' : 'var(--green)'}"></i></span>
    </div>`;
  }).join('');
  const sum = `${g.settlers.length}${idle ? ` · <span class="warnc">${idle} idle</span>` : ''}${alerts ? ` · <span class="badc">${alerts} need help</span>` : ''}`;
  const beds = bedCount(g), avg = Math.round(g.settlers.reduce((a, s) => a + mood(g, s), 0) / Math.max(1, g.settlers.length));
  const pm = `<span class="pm" data-tip="Settlers / beds · average mood"><b class="${g.settlers.length > beds ? 'badc' : ''}">${g.settlers.length}/${beds}</b><i style="color:${avg >= 65 ? 'var(--green)' : avg >= 40 ? 'var(--gold)' : 'var(--red)'}">● ${avg}</i></span>`;
  return `<div class="ch">${pm}<span class="cl">Crew <small>${sum}</small></span><span><button class="small" data-act="jobs" data-tip="Assign jobs to everyone (R)">Jobs</button><button class="small" data-act="mini" data-tip="${mini ? 'Show names' : 'Compact view'}">${mini ? '«' : '»'}</button></span></div><div class="list">${rows}</div>`;
}
export const crewMini = () => mini;

/** What's under the mouse on the map, in words. */
export function hoverHTML(g: Game, fx: number, fy: number): string {
  for (const gb of g.goblins) {
    if (Math.abs(gb.x - fx) < 0.55 && fy > gb.y - 1.4 && fy < gb.y + 0.35) {
      const d = GOBS[gb.kind];
      const st = [(gb.root ?? 0) > 0 ? 'stuck in a pit' : '', gb.slow > 0 ? 'slowed by fire' : '', gb.buff > 0 ? 'frenzied by the warchief' : ''].filter(Boolean).join(', ');
      return `<b class="badc">${d.name}</b> · ${Math.ceil(gb.hp)}/${gb.maxHp} hp<br>${d.desc}${st ? `<br><i>${st}</i>` : ''}`;
    }
  }
  for (const s of g.settlers) {
    if (s.inside || s.away > 0) continue;
    if (Math.abs(s.x - fx) < 0.5 && fy > s.y - 1.3 && fy < s.y + 0.3) {
      const st = crewStatus(g, s);
      return `<b>${s.name}</b> · ${JOBS[s.job].name}<br>${activity(g, s)}<br>Mood ${mood(g, s)} · Health ${Math.ceil(s.hp)}/${s.maxHp}${st.t ? ` · <b class="${st.c === 'bad' ? 'badc' : 'warnc'}">${st.t}</b>` : ''}<br><small>Click to manage</small>`;
    }
  }
  const tx = Math.floor(fx), ty = Math.floor(fy);
  if (!inMap(tx, ty)) return '';
  const b = bldAtTile(g, tx, ty);
  if (b) {
    const d = BUILD[b.kind];
    const name = b.kind === 'keep' ? KEEP_LEVELS[b.level ?? 0].name : d.name;
    const lines: string[] = [];
    if (!b.done) lines.push(`Under construction · ${Math.floor((b.progress / d.work) * 100)}%${g.settlers.some((s) => s.job === 'builder') ? '' : ' · <span class="badc">no builder!</span>'}`);
    else if (b.kind !== 'flag' && b.kind !== 'trap') lines.push(`Health ${Math.ceil(b.hp)}/${b.maxHp}${b.hp < b.maxHp * 0.5 ? ' · <span class="badc">damaged</span>' : ''}`);
    if (b.done && (b.kind === 'hut' || b.kind === 'barracks')) { const n = g.settlers.filter((s) => s.home === b.id).length; lines.push(`Beds ${n}/${bedsOf(b)}`); }
    if (b.done && (b.kind === 'tower' || b.kind === 'ballista')) { const o = g.settlers.find((s) => s.id === b.occupant); lines.push(o ? `Manned by ${o.name}` : b.kind === 'ballista' ? '<span class="warnc">No crew: needs an archer</span>' : 'Unmanned: an archer doubles its fire'); }
    if (b.done && b.kind === 'farm') lines.push(season(g) === 'winter' ? 'Frozen until spring' : g.settlers.some((s) => s.task?.k === 'farm' && s.task.id === b.id) ? 'Being farmed' : '<span class="warnc">No farmer here</span>');
    if (b.kind === 'trap') lines.push(b.sprung ? 'Sprung · re-dug at dawn' : 'Armed');
    if ((b.level ?? 0) > 0 && b.kind !== 'keep') lines.push(`Upgraded ×${b.level}`);
    if (b.hitT > 0 && g.phase === 'night') lines.push('<b class="badc">Under attack!</b>');
    return `<b>${name}</b><br>${lines.join('<br>')}<br><small>Click for details</small>`;
  }
  const i = idx(tx, ty), t = g.terrain[i];
  if (t === T_TREE) return `<b>Tree</b> · ${g.amount[i]} wood left<br><small>Woodcutters chop trees nearest the keep first.</small>`;
  if (t === T_ROCK) return `<b>Boulder</b> · ${g.amount[i]} stone left<br><small>Quarriers break it into stone.</small>`;
  if (t === T_BUSH) return `<b>Berry bush</b> · ${season(g) === 'winter' ? 'bare until spring' : `${g.amount[i]} berries`}<br><small>Foragers pick berries; bushes regrow.</small>`;
  if (t === T_SAPLING) return '<b>Sapling</b><br><small>Grows into a tree in a few days.</small>';
  if (t === T_WATER) return '<b>Pond</b><br><small>Fishers catch food from the shore, even in winter.</small>';
  return '';
}

export function focusOf(g: Game, s: Settler) {
  const b = s.inside ? bld(g, s.inside) : undefined;
  return b ? { x: b.x + 1, y: b.y + 1 } : { x: s.x, y: s.y };
}
