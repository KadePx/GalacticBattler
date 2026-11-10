// The founding ceremony: the one moment a visitor shapes the world directly. Six steps in a
// side panel, with the map beside it: homeland, name, values, banner, final words, then the
// settlers set out. The server applies the founding at the next month.

import { foodYield } from '../sim/civ';
import { isCoastal } from '../sim/econ';
import { hexDist, forWithin } from '../sim/hex';
import { peopleName, sampleTowns } from '../sim/names';
import { VALUES, type ValueId, type World } from '../sim/types';
import { BIOMES, RES_NAMES, isLand } from '../sim/worldgen';
import { foundingSpots } from '../sim/civ';
import { BYNAME_MAX, MOTTO_MAX, properName, cleanMotto, cleanByName } from '../shared/text';
import { founderId } from '../identity';
import { bannerSvg, specFromNums, CHARGES, DIVISIONS, METALS } from './banner';
import { esc, valueChip } from './panels';
import type { MapView } from './map';

export interface FoundingHost {
  world(): World;
  map: MapView;
  turnstileKey: string | null;
  /** Called once the server accepted the founding. */
  onSent(p: Pending): void;
  /** Where to send the founding ('found' now, or 'prefound' for the coming world). */
  endpoint?: string;
  /** The homelands to offer (default: the best free land now). */
  spots?: () => number[];
  /** The opening words of the first step. */
  lead?: string;
  onClose(): void;
}
export interface Pending { name: string; tile: number; eta: number; skew: number }

export const VALUE_TEXT: Record<ValueId, string> = {
  curious: 'Quick to learn. More scholars, faster discoveries.',
  devout: 'Temples and prophets keep their towns steady.',
  martial: 'Strong armies and walls, and readier for war.',
  mercantile: 'Markets, trade roads and merchant princes.',
  seafaring: 'At home on the coast; fish, sea lanes, far trade.',
  stubborn: 'Hard to shake. Unrest rarely takes hold.',
  artistic: 'Great works and master builders.',
  expansionist: 'Spread fast and far, always hungry for land.',
  isolationist: 'Keep to themselves; settle away from others.',
  egalitarian: 'Even a great realm stays united.',
  ancestral: 'Old towns grow proud and steady with age.',
  pragmatic: 'Fields and granaries first; rarely go hungry.',
};

interface Draft {
  step: number;
  spots: number[];
  tile: number;
  name: string;
  capital: string;
  phon: number;
  lex: number;
  values: ValueId[];
  banner: number[];
  motto: string;
  byName: string;
  token: string;
  error: string;
  sending: boolean;
}

const STEPS = ['Homeland', 'Name', 'Values', 'Banner', 'Swear'];
const HUES = [0, 22, 40, 55, 90, 140, 170, 195, 215, 250, 280, 320];

const u32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

function tongue(): { phon: number; lex: number; name: string; capital: string } {
  const phon = u32();
  const lex = u32();
  return { phon, lex, name: peopleName(phon, lex), capital: sampleTowns(phon, lex, 1)[0].name };
}

/** What a homeland offers, in a few words. */
export function describeSpot(w: World, tile: number): { title: string; stars: number; facts: string[]; near: string } {
  let food = 0;
  const res = new Set<string>();
  forWithin(w.W, w.H, tile, 2, (i) => {
    if (w.t.owner[i] !== -1) return;
    food += Math.max(0, foodYield(w, i, false));
    if (w.t.res[i]) res.add(RES_NAMES[w.t.res[i]]);
  });
  const facts: string[] = [];
  if (w.t.river[tile]) {
    const r = w.rivers[w.t.river[tile] - 1];
    facts.push(r.name ? `on the ${r.name}` : 'on an unnamed river');
  }
  if (isCoastal(w, tile)) facts.push('by the sea');
  const tc = w.t.temp[tile];
  facts.push(tc < 2 ? 'cold' : tc < 12 ? 'cool' : tc < 23 ? 'mild' : 'hot');
  if (res.size) facts.push([...res].join(', '));
  let nearest = Infinity;
  let who = -1;
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    const d = hexDist(w.W, s.tile, tile);
    if (d < nearest) { nearest = d; who = s.civ; }
  }
  const them = who < 0 ? '' : w.civs[who].name ? `The ${w.civs[who].name}` : 'An ancient people';
  const one = who >= 0 && !w.civs[who].name;
  const near = who < 0 ? 'No one lives nearby.' : nearest <= 8 ? `${them} ${one ? 'lives' : 'live'} close by.` : nearest <= 14 ? `${them} ${one ? 'is' : 'are'} a few days' walk away.` : 'Far from other peoples.';
  let land = 0;
  forWithin(w.W, w.H, tile, 2, (i) => { if (isLand(w.t, i)) land++; });
  return { title: BIOMES[w.t.biome[tile]].n, stars: Math.max(1, Math.min(5, Math.round((food - 20) / 7))), facts, near: land < 10 ? `${near} A small, tight homeland.` : near };
}

export class Founding {
  private el: HTMLElement;
  private d: Draft;
  private suggestions = [tongue(), tongue(), tongue(), tongue()];
  private tsWidget: string | null = null;

  constructor(private host: FoundingHost, keep?: Partial<Draft>) {
    this.el = document.getElementById('found')!;
    const t = this.suggestions[0];
    const w = host.world();
    const spots = host.spots?.() ?? foundingSpots(w, 5);
    this.d = {
      step: 0, spots, tile: spots[0] ?? -1, name: t.name, capital: t.capital, phon: t.phon, lex: t.lex,
      values: [], banner: [HUES[u32() % HUES.length], u32() % 2, u32() % 3, u32() % 8, u32() % 8],
      motto: '', byName: '', token: '', error: '', sending: false,
      ...keep,
    };
    if (keep) { this.d.spots = spots; if (!spots.includes(this.d.tile)) this.d.tile = spots[0] ?? -1; }
    this.el.classList.remove('hidden');
    this.el.onclick = (e) => this.click(e);
    this.el.oninput = (e) => this.input(e);
    this.render();
    this.showSpots();
  }

  close(): void {
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.host.map.setMarkers([], -1);
    this.setInset(false);
    this.host.onClose();
  }

  /** The map was tapped: pick the homeland nearest the tap, if close. */
  pickTile(tile: number): boolean {
    if (this.d.step !== 0 || tile < 0) return false;
    const w = this.host.world();
    let best = -1;
    let bd = 3;
    for (const s of this.d.spots) {
      const d = hexDist(w.W, s, tile);
      if (d < bd) { bd = d; best = s; }
    }
    if (best < 0) return false;
    this.d.tile = best;
    this.render();
    this.showSpots();
    return true;
  }

  private setInset(on: boolean): void {
    const r = this.el.getBoundingClientRect();
    const phone = window.innerWidth <= 760;
    this.host.map.inset = !on ? { left: 0, bottom: 0 } : phone ? { left: 0, bottom: window.innerHeight - r.top } : { left: r.right, bottom: 0 };
  }

  private showSpots(): void {
    this.setInset(true);
    this.host.map.setMarkers(this.d.step === 0 ? this.d.spots : [this.d.tile], this.d.tile);
    if (this.d.tile >= 0) this.host.map.focus(this.d.tile, 3);
  }

  private go(step: number): void {
    this.d.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.d.error = '';
    this.render();
    this.showSpots();
    this.el.querySelector('.fb')?.scrollTo(0, 0);
  }

  private canNext(): boolean {
    const d = this.d;
    if (d.step === 0) return d.tile >= 0;
    if (d.step === 1) return !!properName(d.name) && !!properName(d.capital);
    if (d.step === 2) return d.values.length === 3;
    return true;
  }

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!t) return;
    const a = t.dataset.a!;
    const v = t.dataset.v ?? '';
    const d = this.d;
    if (a === 'close') return this.close();
    if (a === 'next' && this.canNext()) return this.go(d.step + 1);
    if (a === 'back') return this.go(d.step - 1);
    if (a === 'spot') { d.tile = Number(v); this.render(); this.showSpots(); return; }
    if (a === 'tongue') {
      const s = this.suggestions[Number(v)];
      Object.assign(d, { name: s.name, capital: s.capital, phon: s.phon, lex: s.lex });
      this.render();
      return;
    }
    if (a === 'more') { this.suggestions = [tongue(), tongue(), tongue(), tongue()]; this.render(); return; }
    if (a === 'value') {
      const val = v as ValueId;
      if (d.values.includes(val)) d.values = d.values.filter((x) => x !== val);
      else if (d.values.length < 3 && !(val === 'expansionist' && d.values.includes('isolationist')) && !(val === 'isolationist' && d.values.includes('expansionist'))) d.values.push(val);
      this.render();
      return;
    }
    if (a.startsWith('b')) {
      const k = Number(a.slice(1));
      d.banner[k] = Number(v);
      this.render();
      return;
    }
    if (a === 'shuffle') { d.banner = [HUES[u32() % HUES.length], u32() % 2, u32() % 3, u32() % 8, u32() % 8]; this.render(); return; }
    if (a === 'send') void this.send();
  }

  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.f as 'name' | 'capital' | 'motto' | 'byName' | undefined;
    if (!k) return;
    this.d[k] = t.value;
    // Only refresh the parts that depend on typing, so the caret stays put.
    const next = this.el.querySelector<HTMLButtonElement>('[data-a="next"]');
    if (next) next.disabled = !this.canNext();
    const warn = this.el.querySelector<HTMLElement>(`[data-warn="${k}"]`);
    if (warn) warn.textContent = this.warning(k);
    const prev = this.el.querySelector<HTMLElement>('.prevname');
    if (prev && (k === 'name' || k === 'capital')) prev.innerHTML = this.previewLine();
  }

  private warning(k: string): string {
    const d = this.d;
    if (k === 'name' && d.name && !properName(d.name)) return 'Use 3–16 letters (apostrophes and hyphens are fine), nothing rude.';
    if (k === 'capital' && d.capital && !properName(d.capital)) return 'Use 3–16 letters, nothing rude.';
    if (k === 'motto' && cleanMotto(d.motto) === null) return 'Please choose other words.';
    if (k === 'byName' && cleanByName(d.byName) === null) return 'Letters, numbers and spaces only, nothing rude.';
    return '';
  }

  private previewLine(): string {
    const d = this.d;
    const towns = sampleTowns(d.phon, d.lex, 4).slice(1);
    return `The ${esc(properName(d.name) ?? '…')} of ${esc(properName(d.capital) ?? '…')}. Later towns may be called ${towns.map((t) => esc(t.name) + (t.gloss ? ` <span class="legend">(“${esc(t.gloss)}”)</span>` : '')).join(', ')}. Most names in their tongue mean something about the place.`;
  }

  private render(): void {
    const d = this.d;
    const w = this.host.world();
    const dots = STEPS.map((s, i) => `<span class="dot ${i === d.step ? 'on' : i < d.step ? 'done' : ''}">${s}</span>`).join('');
    let body = '';
    if (d.step === 0) {
      body = `<p class="lead">${this.host.lead ?? 'Every visitor may found one people, once. They will live on without you: growing, trading, warring, perhaps falling. Choose their homeland well.'}</p>
        ${d.spots.length ? d.spots.map((t, i) => {
          const s = describeSpot(w, t);
          return `<button class="spot ${t === d.tile ? 'on' : ''}" data-a="spot" data-v="${t}"><span class="num">${i + 1}</span><span class="sb"><b>${s.title}</b> <span class="stars">${'★'.repeat(s.stars)}<i>${'★'.repeat(5 - s.stars)}</i></span><small>${esc(s.facts.join(' · '))}</small><small>${esc(s.near)}</small></span></button>`;
        }).join('') : '<p class="warn">There is no free land right now. New land opens as peoples fall; please look again later.</p>'}
        <p class="hint">You can also tap a numbered ring on the map.</p>`;
    } else if (d.step === 1) {
      body = `<p class="lead">What do your people call themselves, and their first home? Pick a tongue below, or write your own names.</p>
        <label>People<input data-f="name" maxlength="16" value="${esc(d.name)}"></label><div class="warn" data-warn="name">${this.warning('name')}</div>
        <label>Capital<input data-f="capital" maxlength="16" value="${esc(d.capital)}"></label><div class="warn" data-warn="capital">${this.warning('capital')}</div>
        <p class="prevname hint">${this.previewLine()}</p>
        <div class="tongues">${this.suggestions.map((s, i) => `<button class="chipbtn ${s.lex === d.lex ? 'on' : ''}" data-a="tongue" data-v="${i}">${esc(s.name)} <small>of ${esc(s.capital)}</small></button>`).join('')}
        <button class="chipbtn" data-a="more">More tongues ↻</button></div>`;
    } else if (d.step === 2) {
      body = `<p class="lead">Choose three values. They shape every choice your people make, forever. <b>${d.values.length}/3</b></p>
        <div class="values">${VALUES.map((v) => `<button class="val ${d.values.includes(v) ? 'on' : ''}" data-a="value" data-v="${v}"><b>${v}</b><small>${VALUE_TEXT[v]}</small></button>`).join('')}</div>`;
    } else if (d.step === 3) {
      const b = d.banner;
      const opt = (k: number, vals: number[], label: (v: number) => string) => vals.map((v) => `<button class="opt ${b[k] === v ? 'on' : ''}" data-a="b${k}" data-v="${v}">${label(v)}</button>`).join('');
      const mini = (patch: number[]) => bannerSvg(specFromNums(patch), 26);
      body = `<p class="lead">Their banner will fly over every town they hold, and colour their lands on the map.</p>
        <div class="bannerbig">${bannerSvg(specFromNums(b), 120)}</div>
        <div class="olabel">Colour</div><div class="opts">${HUES.map((h) => `<button class="swatch ${b[0] === h ? 'on' : ''}" data-a="b0" data-v="${h}" style="background:hsl(${h},60%,42%)"></button>`).join('')}</div>
        <div class="olabel">Second colour</div><div class="opts">${opt(1, [0, 1], (v) => (v === 0 ? 'Contrast' : 'Shade'))}</div>
        <div class="olabel">Metal</div><div class="opts">${METALS.map((m, i) => `<button class="swatch ${b[2] === i ? 'on' : ''}" data-a="b2" data-v="${i}" style="background:${m}"></button>`).join('')}</div>
        <div class="olabel">Division</div><div class="opts">${opt(3, DIVISIONS.map((_, i) => i), (v) => mini([b[0], b[1], b[2], v, 8]))}</div>
        <div class="olabel">Emblem</div><div class="opts">${opt(4, CHARGES.map((_, i) => i), (v) => mini([b[0], b[1], b[2], 0, v]))}</div>
        <button class="chipbtn" data-a="shuffle">Surprise me ↻</button>`;
    } else {
      const spot = describeSpot(w, d.tile);
      body = `<div class="summary">${bannerSvg(specFromNums(d.banner), 56)}<div><div class="sname">The ${esc(properName(d.name) ?? '')}</div>
          <div class="hint">of ${esc(properName(d.capital) ?? '')} · ${esc(spot.title.toLowerCase())}${spot.facts.length ? ', ' + esc(spot.facts[0]) : ''}</div>
          <div>${d.values.map((v) => valueChip(v)).join('')}</div></div></div>
        <label>Motto <span class="hint">(optional)</span><input data-f="motto" maxlength="${MOTTO_MAX}" value="${esc(d.motto)}" placeholder="We came with the river."></label><div class="warn" data-warn="motto">${this.warning('motto')}</div>
        <label>Your name <span class="hint">(optional, shown as their founder)</span><input data-f="byName" maxlength="${BYNAME_MAX}" value="${esc(d.byName)}"></label><div class="warn" data-warn="byName">${this.warning('byName')}</div>
        <p class="oath">This cannot be undone. You get one people, and they will outlive this visit. Check in whenever you like to see how they fare.</p>
        ${this.host.turnstileKey ? '<div id="ts"></div>' : ''}
        ${d.error ? `<p class="warn">${esc(d.error)}</p>` : ''}`;
    }
    const last = d.step === STEPS.length - 1;
    // Keep the scroll position when re-drawing the same step (e.g. picking a banner part).
    const oldBody = this.el.querySelector<HTMLElement>('.fb');
    const keepScroll = oldBody && this.el.dataset.step === String(d.step) ? oldBody.scrollTop : 0;
    this.el.dataset.step = String(d.step);
    this.el.innerHTML = `<div class="fh"><span class="t">Found your people</span><button class="icon" data-a="close" title="Close">✕</button></div>
      <div class="steps">${dots}</div>
      <div class="fb">${body}</div>
      <div class="ff">${d.step ? '<button class="btn" data-a="back">Back</button>' : '<span></span>'}
        ${last ? `<button class="btn gold" data-a="send" ${d.sending ? 'disabled' : ''}>${d.sending ? 'Setting out…' : `Found the ${esc(properName(d.name) ?? '')}`}</button>`
          : `<button class="btn gold" data-a="next" ${this.canNext() ? '' : 'disabled'}>Next</button>`}</div>`;
    const fb = this.el.querySelector<HTMLElement>('.fb');
    if (fb) fb.scrollTop = keepScroll;
    if (last && this.host.turnstileKey) this.mountTurnstile();
  }

  private mountTurnstile(): void {
    const slot = this.el.querySelector<HTMLElement>('#ts');
    if (!slot) return;
    const draw = () => {
      const ts = (window as unknown as { turnstile?: { render(el: HTMLElement, o: object): string; remove(id: string): void } }).turnstile;
      if (!ts) return;
      if (this.tsWidget) { try { ts.remove(this.tsWidget); } catch { /* gone */ } }
      this.tsWidget = ts.render(slot, {
        sitekey: this.host.turnstileKey, theme: 'dark',
        callback: (tok: string) => { this.d.token = tok; },
        'expired-callback': () => { this.d.token = ''; },
      });
    };
    if ((window as unknown as { turnstile?: unknown }).turnstile) return draw();
    if (!document.getElementById('ts-script')) {
      const sc = document.createElement('script');
      sc.id = 'ts-script';
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true;
      sc.onload = draw;
      document.head.appendChild(sc);
    } else setTimeout(draw, 300);
  }

  private async send(): Promise<void> {
    const d = this.d;
    if (d.sending) return;
    if (this.host.turnstileKey && !d.token) { d.error = 'Please finish the human check above.'; this.render(); return; }
    d.sending = true;
    d.error = '';
    this.render();
    try {
      const r = await fetch(`/api/cw/${this.host.endpoint ?? 'found'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: founderId(), token: d.token, tile: d.tile, values: d.values, name: properName(d.name), capital: properName(d.capital),
          motto: d.motto, byName: d.byName, banner: d.banner, phon: d.phon, lex: d.lex,
        }),
      });
      const out = (await r.json()) as { ok?: boolean; error?: string; eta?: number; now?: number };
      if (!r.ok || !out.ok) {
        d.sending = false;
        d.token = '';
        d.error = out.error ?? 'Something went wrong. Please try again.';
        if (r.status === 409 && /land|near/.test(d.error)) { d.spots = this.host.spots?.() ?? foundingSpots(this.host.world(), 5); d.tile = d.spots[0] ?? -1; }
        this.render();
        return;
      }
      this.el.classList.add('hidden');
      this.el.innerHTML = '';
      this.host.map.setMarkers([d.tile], d.tile);
      this.setInset(false);
      this.host.onSent({ name: properName(d.name) ?? d.name, tile: d.tile, eta: out.eta ?? Date.now(), skew: (out.now ?? Date.now()) - Date.now() });
    } catch {
      d.sending = false;
      d.error = 'Could not reach the world. Please try again.';
      this.render();
    }
  }
}
