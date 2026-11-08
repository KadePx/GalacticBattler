// Procedural banners: a field, a division and a charge, picked from the civ's seed.
// Milestone 5 turns these same layers into the founder's banner designer.

import { Rand } from '../sim/rng';
import type { Civ } from '../sim/types';

export interface BannerSpec { field: string; second: string; metal: string; division: number; charge: number }

const METALS = ['#f2d27a', '#e9e4d8', '#1d1a17'];
export const DIVISIONS = ['plain', 'pale', 'fess', 'bend', 'chevron', 'quarterly', 'chief', 'saltire'];
export const CHARGES = ['sun', 'star', 'crescent', 'tower', 'tree', 'waves', 'mountain', 'eye', 'none'];

export function bannerSpec(c: Civ): BannerSpec {
  const r = new Rand(c.lex, 0xba22e2);
  const field = `hsl(${c.hue}, 60%, 42%)`;
  const second = r.chance(0.5) ? `hsl(${(c.hue + 180) % 360}, 45%, 30%)` : `hsl(${c.hue}, 55%, 22%)`;
  return { field, second, metal: r.pick(METALS), division: r.int(DIVISIONS.length), charge: r.int(CHARGES.length - 1) };
}

function division(d: string, col: string): string {
  switch (d) {
    case 'pale': return `<rect x="50" y="0" width="50" height="120" fill="${col}"/>`;
    case 'fess': return `<rect x="0" y="55" width="100" height="65" fill="${col}"/>`;
    case 'bend': return `<path d="M0 0 L100 120 L100 0 Z" fill="${col}"/>`;
    case 'chevron': return `<path d="M0 120 L50 55 L100 120 L100 95 L50 30 L0 95 Z" fill="${col}"/>`;
    case 'quarterly': return `<rect x="50" y="0" width="50" height="55" fill="${col}"/><rect x="0" y="55" width="50" height="65" fill="${col}"/>`;
    case 'chief': return `<rect x="0" y="0" width="100" height="32" fill="${col}"/>`;
    case 'saltire': return `<path d="M0 0 L16 0 L100 104 L100 120 L84 120 L0 16 Z M100 0 L100 16 L16 120 L0 120 L0 104 L84 0 Z" fill="${col}"/>`;
    default: return '';
  }
}

function charge(c: string, col: string, cy: number): string {
  const s = `fill="${col}" stroke="#120c07" stroke-width="1.5" stroke-linejoin="round"`;
  switch (c) {
    case 'sun': {
      let rays = '';
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        const x1 = 50 + Math.cos(a) * 14, y1 = cy + Math.sin(a) * 14;
        const x2 = 50 + Math.cos(a) * 22, y2 = cy + Math.sin(a) * 22;
        rays += `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} `;
      }
      return `<path d="${rays}" stroke="${col}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="${cy}" r="11" ${s}/>`;
    }
    case 'star': {
      let d = '';
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 9 : 22;
        d += `${k ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)} `;
      }
      return `<path d="${d}Z" ${s}/>`;
    }
    case 'crescent': return `<path d="M58 ${cy - 20} A21 21 0 1 0 58 ${cy + 20} A16 16 0 1 1 58 ${cy - 20} Z" ${s}/>`;
    case 'tower': return `<path d="M36 ${cy + 20} L36 ${cy - 10} L32 ${cy - 10} L32 ${cy - 20} L40 ${cy - 20} L40 ${cy - 14} L46 ${cy - 14} L46 ${cy - 20} L54 ${cy - 20} L54 ${cy - 14} L60 ${cy - 14} L60 ${cy - 20} L68 ${cy - 20} L68 ${cy - 10} L64 ${cy - 10} L64 ${cy + 20} Z M46 ${cy + 20} L46 ${cy + 8} A4 4 0 0 1 54 ${cy + 8} L54 ${cy + 20} Z" ${s} fill-rule="evenodd"/>`;
    case 'tree': return `<path d="M47 ${cy + 22} L47 ${cy + 6} L53 ${cy + 6} L53 ${cy + 22} Z" ${s}/><circle cx="50" cy="${cy - 4}" r="15" ${s}/>`;
    case 'waves': {
      let d = '';
      for (let k = 0; k < 3; k++) {
        const y = cy - 12 + k * 12;
        d += `M24 ${y} q6.5 -7 13 0 t13 0 t13 0 t13 0 `;
      }
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`;
    }
    case 'mountain': return `<path d="M24 ${cy + 16} L42 ${cy - 16} L52 ${cy} L60 ${cy - 8} L76 ${cy + 16} Z" ${s}/>`;
    case 'eye': return `<path d="M24 ${cy} Q50 ${cy - 22} 76 ${cy} Q50 ${cy + 22} 24 ${cy} Z" ${s}/><circle cx="50" cy="${cy}" r="7" fill="#120c07"/>`;
    default: return '';
  }
}

/** The banner as an SVG string (100 x 120 swallowtail). */
export function bannerSvg(spec: BannerSpec, px = 40): string {
  const clip = `bn${Math.random().toString(36).slice(2, 8)}`;
  const outline = 'M0 0 L100 0 L100 120 L50 100 L0 120 Z';
  return `<svg viewBox="-3 -3 106 126" width="${px}" height="${(px * 126) / 106}" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="${clip}"><path d="${outline}"/></clipPath></defs>
    <g clip-path="url(#${clip})">
      <rect width="100" height="120" fill="${spec.field}"/>
      ${division(DIVISIONS[spec.division], spec.second)}
      ${charge(CHARGES[spec.charge], spec.metal, 50)}
    </g>
    <path d="${outline}" fill="none" stroke="#120c07" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-3" y="-3" width="106" height="6" fill="#6b4f2a"/>
  </svg>`;
}
