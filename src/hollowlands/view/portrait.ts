// Portraits: a front-facing flat-vector bust built from layers (hair behind, ears, clothes,
// head, face, beard, hair in front, marks) so every appearance choice combines with every
// other. Returns an inline SVG string. Works for the living and the dead alike.

import type { Colony, Dead, Look, Pawn, RaceK } from '../sim/types';
import { EYES, HAIR, SHAPE, css, darken, garbOf, hairIndex, lighten, skinOf, stageOfAge, yearsAt } from './look';

type Who = Pawn | Dead;

const n = (v: number): string => (Math.round(v * 10) / 10).toString();

const yearsOf = (c: Colony, p: Who): number => yearsAt(p.born, 'died' in p ? p.died : c.tick);

/** Changes whenever the portrait would look different; used to cache the SVG text. */
export function portraitKey(c: Colony, p: Who): string {
  const y = yearsOf(c, p);
  const l = p.look;
  return `${p.race}${p.sex}${stageOfAge(p.race, y)}${hairIndex(p.race, l, y)}|${l.skin},${l.hair},${l.body},${l.face},${l.eyes},${l.beard},${l.garb},${l.marks.join('.')}`;
}

export function portraitSvg(c: Colony, p: Who, size: number): string {
  return bustSvg(p, yearsOf(c, p), size);
}

/** What a portrait needs to know about someone. */
export interface Bust { race: RaceK; sex: 0 | 1; look: Look }

/** The portrait itself, for anyone of a given age (the creator uses this before a colonist exists). */
export function bustSvg(p: Bust, years: number, size: number): string {
  const st = stageOfAge(p.race, years);
  const kid = st <= 1;
  const elder = st === 4;
  const sh = SHAPE[p.race];
  const l = p.look;
  const skin = skinOf(p.race, l);
  const skinD = css(darken(skin, 0.2));
  const skinC = css(skin);
  const hairN = HAIR[hairIndex(p.race, l, years)];
  const hair = css(hairN);
  const hairD = css(darken(hairN, 0.3));
  const garbN = garbOf(l);
  const garb = css(garbN);
  const garbD = css(darken(garbN, 0.28));

  // Children: a rounder, larger head on small shoulders, with big low-set eyes.
  const hw = kid ? Math.min(14, sh.hw * 0.98 + 1) : sh.hw * (0.96 + l.body * 0.02);
  const hh = kid ? Math.min(14, sh.hh * 0.86 + 1) : sh.hh;
  const cx = 32;
  const cy = kid ? 31 : 27.5;
  const sw = kid ? 14 : Math.min(27, 20 * sh.wide * (0.94 + l.body * 0.03));
  const shTop = kid ? 52 : 47.5;
  const eyeY = cy + (kid ? 2.6 : 0.6);
  const eyeX = hw * 0.43;
  const mouthY = cy + hh * (kid ? 0.6 : 0.54);
  const o: string[] = [];

  o.push(`<rect width="64" height="64" rx="14" fill="#1b2233"/>`);

  // --- hair that hangs behind the head
  const hs = l.hair % 10;
  if (hs === 3) o.push(`<path d="M${n(cx - hw - 3)} ${n(cy - 4)}C${n(cx - hw - 4)} ${n(cy - hh - 8)},${n(cx + hw + 4)} ${n(cy - hh - 8)},${n(cx + hw + 3)} ${n(cy - 4)}L${n(cx + hw + 4.5)} ${n(cy + hh + 9)}L${n(cx - hw - 4.5)} ${n(cy + hh + 9)}Z" fill="${hairD}"/>`);
  else if (hs === 8) o.push(`<ellipse cx="${cx}" cy="${n(cy - 1)}" rx="${n(hw + 4)}" ry="${n(hh + 4.5)}" fill="${hairD}"/>`);
  else if (hs === 6) o.push(`<ellipse cx="${n(cx + hw + 2.5)}" cy="${n(cy + 7)}" rx="3.4" ry="9" fill="${hairD}"/>`);
  else if (hs === 7) o.push(`<rect x="${n(cx - hw - 2.6)}" y="${n(cy)}" width="4.2" height="${n(hh + 8)}" rx="2.1" fill="${hairD}"/><rect x="${n(cx + hw - 1.6)}" y="${n(cy)}" width="4.2" height="${n(hh + 8)}" rx="2.1" fill="${hairD}"/>`);

  // --- ears: the quickest way to tell the peoples apart
  for (const s of [-1, 1]) {
    const ex = cx + s * hw;
    if (sh.ears === 0) o.push(`<circle cx="${n(ex)}" cy="${n(cy + 1.5)}" r="2.8" fill="${skinD}"/>`);
    else if (sh.ears === 1) o.push(`<path d="M${n(ex - s * 1.5)} ${n(cy - 2.5)}L${n(ex + s * 4.6)} ${n(cy - 5)}L${n(ex - s * 1.5)} ${n(cy + 4)}Z" fill="${skinD}"/>`);
    else if (sh.ears === 2) o.push(`<path d="M${n(ex - s * 1.5)} ${n(cy - 2)}L${n(ex + s * 8.5)} ${n(cy - 11)}L${n(ex - s * 1.5)} ${n(cy + 4.5)}Z" fill="${skinD}"/>`);
    else o.push(`<path d="M${n(ex - s * 2)} ${n(cy - 3.5)}L${n(ex + s * 12)} ${n(cy - 8)}L${n(ex + s * 8.5)} ${n(cy + 1.5)}L${n(ex - s * 2)} ${n(cy + 4.5)}Z" fill="${skinD}"/><path d="M${n(ex)} ${n(cy - 1.5)}L${n(ex + s * 8.5)} ${n(cy - 5.5)}L${n(ex + s * 6.5)} ${n(cy)}Z" fill="${css(darken(skin, 0.36))}"/>`);
  }

  // --- shoulders, neck and collar
  o.push(`<path d="M${n(cx - sw)} 64Q${n(cx - sw)} ${n(shTop + 1.5)} ${cx} ${n(shTop)}Q${n(cx + sw)} ${n(shTop + 1.5)} ${n(cx + sw)} 64Z" fill="${garb}"/>`);
  o.push(`<rect x="${n(cx - 4.6)}" y="${n(cy + hh - 5)}" width="9.2" height="${n(shTop - (cy + hh) + 9)}" rx="3" fill="${skinD}"/>`);
  o.push(`<path d="M${n(cx - 7)} ${n(shTop + 0.6)}L${cx} ${n(shTop + 7.5)}L${n(cx + 7)} ${n(shTop + 0.6)}" fill="none" stroke="${garbD}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);

  // --- head (orcs carry a heavy square jaw)
  o.push(`<ellipse cx="${cx}" cy="${n(cy)}" rx="${n(hw)}" ry="${n(hh)}" fill="${skinC}"/>`);
  if (sh.tusks && !kid) o.push(`<rect x="${n(cx - hw * 0.84)}" y="${n(cy)}" width="${n(hw * 1.68)}" height="${n(hh * 0.98)}" rx="6.5" fill="${skinC}"/>`);
  if (kid) o.push(`<circle cx="${n(cx - eyeX - 1.6)}" cy="${n(eyeY + 4.4)}" r="2.4" fill="#e87a7a" opacity="0.28"/><circle cx="${n(cx + eyeX + 1.6)}" cy="${n(eyeY + 4.4)}" r="2.4" fill="#e87a7a" opacity="0.28"/>`);

  // --- eyes and brows
  const eyeR = kid ? 2.5 : 2.1;
  const iris = css(EYES[l.eyes % EYES.length]);
  const brow = l.face % 3; // 0 level, 1 stern, 2 raised
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeX;
    o.push(`<ellipse cx="${n(ex)}" cy="${n(eyeY)}" rx="${n(eyeR)}" ry="${n(eyeR * 0.8)}" fill="#f4f1ea"/><circle cx="${n(ex)}" cy="${n(eyeY + 0.1)}" r="${n(eyeR * 0.6)}" fill="${iris}"/>`);
    const by = eyeY - eyeR - 1.7;
    const tilt = brow === 1 ? 1.3 : brow === 2 ? -1.1 : 0;
    o.push(`<path d="M${n(ex - s * 2.9)} ${n(by - tilt)}L${n(ex + s * 2.9)} ${n(by + tilt * 0.4)}" stroke="${hairD}" stroke-width="${kid ? 1 : 1.5}" stroke-linecap="round"/>`);
  }
  if (elder) {
    o.push(`<path d="M${n(cx - eyeX - 2)} ${n(eyeY + 3.2)}q2 1 4 0M${n(cx + eyeX - 2)} ${n(eyeY + 3.2)}q2 1 4 0M${n(cx - 4)} ${n(cy - hh * 0.5)}q4 -1.2 8 0" fill="none" stroke="${skinD}" stroke-width="0.8" stroke-linecap="round"/>`);
  }

  // --- nose and mouth
  if (sh.tusks) o.push(`<circle cx="${n(cx - 1.5)}" cy="${n(cy + hh * 0.3)}" r="0.8" fill="${skinD}"/><circle cx="${n(cx + 1.5)}" cy="${n(cy + hh * 0.3)}" r="0.8" fill="${skinD}"/>`);
  else o.push(`<path d="M${cx} ${n(eyeY + 2)}q-1.6 ${n(hh * 0.22)} 0.6 ${n(hh * 0.25)}" fill="none" stroke="${skinD}" stroke-width="1.1" stroke-linecap="round"/>`);
  const mw = kid ? 2.4 : 3.6;
  const curve = [0, 1.2, -0.9, 1.9, 0.7, 0.2][l.face % 6];
  o.push(`<path d="M${n(cx - mw)} ${n(mouthY)}Q${cx} ${n(mouthY + curve * 1.6)} ${n(cx + mw)} ${n(mouthY - (l.face % 6 === 4 ? 0.9 : 0))}" fill="none" stroke="${css(darken(skin, 0.45))}" stroke-width="1.2" stroke-linecap="round"/>`);

  // --- beard and moustache
  const beard = p.sex === 1 && st >= 3 ? l.beard : 0;
  if (beard === 1) {
    o.push(`<path d="M${n(cx - hw * 0.8)} ${n(cy + 3)}C${n(cx - hw * 0.9)} ${n(cy + hh + 1)},${n(cx + hw * 0.9)} ${n(cy + hh + 1)},${n(cx + hw * 0.8)} ${n(cy + 3)}C${n(cx + hw * 0.4)} ${n(cy + hh * 0.8)},${n(cx - hw * 0.4)} ${n(cy + hh * 0.8)},${n(cx - hw * 0.8)} ${n(cy + 3)}Z" fill="${hair}" opacity="0.4"/>`);
  } else if (beard >= 2) {
    const len = beard === 2 ? 2.5 : beard === 3 ? 9 : 16;
    o.push(`<path d="M${n(cx - hw * 0.9)} ${n(cy + 1.5)}C${n(cx - hw * 1.05)} ${n(cy + hh + len)},${n(cx + hw * 1.05)} ${n(cy + hh + len)},${n(cx + hw * 0.9)} ${n(cy + 1.5)}C${n(cx + hw * 0.42)} ${n(cy + hh * 0.78)},${n(cx - hw * 0.42)} ${n(cy + hh * 0.78)},${n(cx - hw * 0.9)} ${n(cy + 1.5)}Z" fill="${hair}"/>`);
    o.push(`<path d="M${n(cx - 4.6)} ${n(mouthY - 1)}Q${cx} ${n(mouthY - 3.4)} ${n(cx + 4.6)} ${n(mouthY - 1)}Q${cx} ${n(mouthY - 0.4)} ${n(cx - 4.6)} ${n(mouthY - 1)}Z" fill="${hair}"/>`);
    if (beard === 4) o.push(`<rect x="${n(cx - 2.6)}" y="${n(cy + hh + 5.5)}" width="5.2" height="2.2" rx="1" fill="#c9ccd4"/>`);
  }

  // --- tusks jut up from the lower jaw
  if (sh.tusks && !kid) {
    const th = sh.tusks === 2 ? 4.6 : 2.8;
    for (const s of [-1, 1]) o.push(`<path d="M${n(cx + s * 2.4)} ${n(mouthY + 0.9)}L${n(cx + s * 4.6)} ${n(mouthY - th)}L${n(cx + s * 5.4)} ${n(mouthY + 0.9)}Z" fill="#f3efe2"/>`);
  }

  // --- hair on top: a cap whose hairline and extras change with the style
  const cap = (line: number, lift: number, side: number): string =>
    `<path d="M${n(cx - hw - 0.8)} ${n(cy + side)}C${n(cx - hw - 1.5)} ${n(cy - hh - lift)},${n(cx + hw + 1.5)} ${n(cy - hh - lift)},${n(cx + hw + 0.8)} ${n(cy + side)}C${n(cx + hw * 0.55)} ${n(cy - hh * line)},${n(cx - hw * 0.55)} ${n(cy - hh * line)},${n(cx - hw - 0.8)} ${n(cy + side)}Z" fill="${hair}"/>`;
  const thin = kid && st === 0 ? ' opacity="0.7"' : '';
  if (hs === 1 || hs === 9) o.push(cap(0.95, 6, -3));
  else if (hs === 2) o.push(cap(0.5, 7, -1));
  else if (hs === 3 || hs === 6 || hs === 7) o.push(cap(0.85, 7, -1));
  else if (hs === 4) o.push(cap(0.9, 6.5, -2), `<circle cx="${cx}" cy="${n(cy - hh - 3)}" r="4.6" fill="${hair}"/>`);
  else if (hs === 5) o.push(`<path d="M${n(cx - 3)} ${n(cy - hh * 0.55)}L${n(cx - 2.6)} ${n(cy - hh - 6)}Q${cx} ${n(cy - hh - 8.5)} ${n(cx + 2.6)} ${n(cy - hh - 6)}L${n(cx + 3)} ${n(cy - hh * 0.55)}Z" fill="${hair}"/>`);
  else if (hs === 8) o.push(cap(0.55, 9, 1));
  if (hs === 9) o.push(`<circle cx="${cx}" cy="${n(cy - hh - 3)}" r="2.8" fill="${hair}"/><rect x="${n(cx - 2)}" y="${n(cy - hh - 1.2)}" width="4" height="1.4" fill="${hairD}"/>`);
  if (hs === 0 && elder) for (const s of [-1, 1]) o.push(`<ellipse cx="${n(cx + s * (hw - 0.5))}" cy="${n(cy - 3)}" rx="2" ry="4" fill="${hair}"/>`);
  if (thin && hs !== 0) o.push(`<ellipse cx="${cx}" cy="${n(cy - hh * 0.62)}" rx="${n(hw * 0.6)}" ry="${n(hh * 0.2)}" fill="${skinC}"${thin}/>`);

  // --- scars, tattoos and other marks
  const scar = css(mix3(skin));
  for (const m of l.marks) {
    if (m === 1) o.push(`<path d="M${n(cx - eyeX - 1.5)} ${n(eyeY - 5)}L${n(cx - eyeX + 1.2)} ${n(eyeY + 5)}" stroke="${scar}" stroke-width="1.2" stroke-linecap="round"/>`);
    else if (m === 2) o.push(`<path d="M${n(cx + eyeX - 1)} ${n(eyeY + 4)}l4 3.5" stroke="${scar}" stroke-width="1.2" stroke-linecap="round"/>`);
    else if (m === 3) o.push(`<path d="M${n(cx - 3.5)} ${n(eyeY + 2)}l7 2" stroke="${scar}" stroke-width="1.1" stroke-linecap="round"/>`);
    else if (m === 4) o.push(`<path d="M${n(cx - 4)} ${n(cy - hh * 0.55)}l4 2.4 4 -2.4M${cx} ${n(cy - hh * 0.55 + 2.4)}v2.6" fill="none" stroke="#3f5f8a" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>`);
    else if (m === 5) o.push(`<path d="M${n(cx - 2.2)} ${n(mouthY + 2.6)}v3.4M${cx} ${n(mouthY + 2.8)}v4M${n(cx + 2.2)} ${n(mouthY + 2.6)}v3.4" stroke="#3f5f8a" stroke-width="1" stroke-linecap="round" opacity="0.8"/>`);
    else if (m === 6) o.push(`<ellipse cx="${n(cx + eyeX + 1.5)}" cy="${n(eyeY + 5.5)}" rx="3.2" ry="2.4" fill="${css(lighten(0xb04a3a, 0.1))}" opacity="0.45"/>`);
    else if (m === 9) o.push(`<g fill="${skinD}" opacity="0.75"><circle cx="${n(cx - eyeX - 1)}" cy="${n(eyeY + 5)}" r="0.8"/><circle cx="${n(cx - eyeX + 2)}" cy="${n(eyeY + 7)}" r="0.7"/><circle cx="${n(cx + eyeX)}" cy="${n(eyeY + 5.5)}" r="0.8"/><circle cx="${n(cx + eyeX - 2.5)}" cy="${n(eyeY + 7.5)}" r="0.7"/><circle cx="${n(cx + 1)}" cy="${n(cy - hh * 0.5)}" r="0.7"/></g>`); // pox scars
  }

  return `<svg class="pt" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${o.join('')}</svg>`;
}

/** Scar tissue: a paler, pinker version of the skin. */
function mix3(skin: number): number {
  const r = Math.min(255, ((skin >> 16) & 255) * 0.75 + 70);
  const g = ((skin >> 8) & 255) * 0.62 + 30;
  const b = (skin & 255) * 0.62 + 32;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
