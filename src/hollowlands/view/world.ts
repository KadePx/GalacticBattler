// The world overlay: every colony on the region map, who founded it from where, and a way
// to go and look at any of them.

import { TICKS_PER_DAY } from '../config';
import { esc } from './words';

export interface WorldSite { id: string; name: string; x: number; y: number; founded: number; from?: string; pop: number; ruler?: string; dead?: number }

const W = 48;
const H = 36;

export class WorldView {
  private el: HTMLElement;

  constructor(private go: (id: string) => void) {
    this.el = document.createElement('div');
    this.el.id = 'world';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-c],[data-x]');
      if (!t) { if (e.target === this.el) this.close(); return; }
      if (t.dataset.x !== undefined) this.close();
      else if (t.dataset.c) this.go(t.dataset.c);
    });
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  open(sites: WorldSite[], here: string, mine: string): void {
    const by = new Map(sites.map((s) => [s.id, s]));
    const sx = (x: number): number => 20 + (x / W) * 560;
    const sy = (y: number): number => 16 + (y / H) * 328;
    let svg = '';
    for (const s of sites) {
      const p = s.from ? by.get(s.from) : undefined;
      if (p) svg += `<line x1="${sx(p.x)}" y1="${sy(p.y)}" x2="${sx(s.x)}" y2="${sy(s.y)}" class="road"/>`;
    }
    for (const s of sites) {
      const r = s.dead ? 5 : 5 + Math.sqrt(s.pop);
      svg += `<g class="site${s.dead ? ' dead' : ''}${s.id === here ? ' here' : ''}" data-c="${s.id}"><circle cx="${sx(s.x)}" cy="${sy(s.y)}" r="${r.toFixed(1)}"/>`;
      if (s.id === mine) svg += `<circle cx="${sx(s.x)}" cy="${sy(s.y)}" r="${(r + 4).toFixed(1)}" class="mine"/>`;
      svg += `<text x="${sx(s.x)}" y="${sy(s.y) + r + 13}">${esc(s.name)}</text></g>`;
    }
    const year = (t: number): number => Math.floor(t / (TICKS_PER_DAY * 60)) + 1;
    const rows = sites.slice().sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0) || b.pop - a.pop).map((s) => {
      const p = s.from ? by.get(s.from) : undefined;
      const sub = s.dead ? 'Abandoned' : `${s.pop} people${s.ruler ? ' · ruled by ' + esc(s.ruler) : ''}`;
      const origin = p ? `Founded from ${esc(p.name)} in year ${year(s.founded)}` : 'One of the first colonies';
      return `<button class="wrow${s.id === here ? ' here' : ''}" data-c="${s.id}"><b>${esc(s.name)}${s.id === mine ? ' <span class="tie kin">Yours</span>' : ''}${s.id === here ? ' <span class="tie dim">Viewing</span>' : ''}</b><span>${sub}</span><span>${origin}</span></button>`;
    }).join('');
    this.el.innerHTML = `<div class="wbox panel"><div class="whead"><b>The Hollow Lands</b><span>${sites.filter((s) => !s.dead).length} colonies</span><button class="icon" data-x title="Close" aria-label="Close">&times;</button></div><svg viewBox="0 0 600 372" class="wmap">${svg}</svg><div class="wlist">${rows}</div></div>`;
    this.el.classList.remove('hidden');
  }
}
