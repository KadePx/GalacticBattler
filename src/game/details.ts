// Detail cards: full descriptions of ships, relics, synergies and commanders,
// plus plain-language definitions of the terms they use. Drawn into whatever
// container you pass, so the shop's pop-up card and the Fleet Archive share them.

import Phaser from 'phaser';
import { CMD_MAP } from '../sim/commanders';
import { RELIC_MAP } from '../sim/relics';
import { REWARD_MAP } from './rewards';
import { SHIPS, levelOf, type ShipClass, type ShipDef } from '../sim/ships';
import { TRAIT_MAP } from '../sim/traits';
import type { FleetShip } from '../sim/types';
import { shipKey } from './art';
import { termsIn, type Term } from './glossary';
import { C, TIER_COLORS, button, panel, relicChip, txt } from './ui';

export type Detail =
  | { def: ShipDef; ship?: FleetShip }
  | { relic: string }
  | { trait: ShipClass; count?: number }
  | { cmd: string; passive?: 'a' | 'b' };

type Add = <T extends Phaser.GameObjects.GameObject>(o: T) => T;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** All the text a detail shows; used to find which terms to explain. */
export function detailText(d: Detail): string[] {
  if ('def' in d) return [d.def.desc, ...d.def.perks];
  if ('relic' in d) return [(RELIC_MAP[d.relic] ?? REWARD_MAP[d.relic])?.desc ?? ''];
  if ('trait' in d) return TRAIT_MAP[d.trait].tiers.map((t) => t.desc);
  const c = CMD_MAP[d.cmd];
  return [c.passives.a.desc, c.passives.b.desc, c.power.desc];
}

export const detailTerms = (d: Detail) => termsIn(...detailText(d));

/** Draw a detail card at (x, y), `w` wide. Returns the y just below it. */
export function drawDetail(scene: Phaser.Scene, add: Add, d: Detail, x: number, y: number, w: number): number {
  if ('def' in d) return drawShip(scene, add, d.def, d.ship, x, y, w);
  if ('relic' in d) return drawRelic(scene, add, d.relic, x, y, w);
  if ('trait' in d) return drawTrait(scene, add, d.trait, d.count, x, y, w);
  return drawCommander(scene, add, d.cmd, d.passive, x, y, w);
}

function drawShip(scene: Phaser.Scene, add: Add, def: ShipDef, ship: FleetShip | undefined, x: number, y: number, w: number) {
  const tc = TIER_COLORS[def.tier] ?? 0x8a94b8;
  add(scene.add.rectangle(x + 18, y + 16, 36, 30, 0x05060f).setStrokeStyle(1, tc));
  add(scene.add.image(x + 18, y + 16, shipKey(def.id, 0)).setScale(2));
  add(txt(scene, x + 42, y + 2, def.name.toUpperCase(), { color: def.accent[1] }));
  const tierLabel = def.tier === 4 ? (w >= 240 ? 'PROTOTYPE' : 'PROTO') : def.tier ? (w >= 240 ? `TIER ${def.tier}` : `T${def.tier}`) : 'LAUNCHED';
  const t = add(txt(scene, x + 42, y + 14, tierLabel, { color: hex(tc) }));
  let cx = t.x + t.width + 8;
  // Class and faction tags; wrap to a second line in narrow cards.
  let cy0 = y + 14;
  for (const c of def.classes) {
    const label = TRAIT_MAP[c].short;
    if (cx + label.length * 8 > x + w) {
      cx = x + 42;
      cy0 += 10;
    }
    const ct = add(txt(scene, cx, cy0, label, { color: TRAIT_MAP[c].color }));
    cx += ct.width + 8;
  }
  const lvl = ship ? levelOf(ship.xp) : 0;
  const stats = add(txt(scene, x, y + 36, `ATK ${ship?.atk ?? def.atk}`, { color: C.atk }));
  const hp = add(txt(scene, stats.x + stats.width + 10, y + 36, `HP ${ship?.hp ?? def.hp}`, { color: C.hp }));
  add(txt(scene, hp.x + hp.width + 10, y + 36, `${w >= 240 ? 'ATTACKS ' : ''}EVERY ${def.cd}T`, { color: C.dim }));
  let cy = y + 50;
  const desc = add(txt(scene, x, cy, def.desc, { wrap: w }));
  cy += desc.height + 6;
  if (def.tier > 0) {
    def.perks.forEach((p, k) => {
      const on = lvl >= k + 2;
      const label = add(txt(scene, x, cy, `LV${k + 2}`, { color: on ? C.gold : C.dim }));
      const pt = add(txt(scene, x + 32, cy, p, { wrap: w - 32, color: on ? C.gold : C.text }));
      cy += Math.max(label.height, pt.height) + 4;
    });
    const note = add(txt(scene, x, cy, ship ? `This ship: level ${lvl}` : def.tier === 4 ? 'Prototype: only from rare rewards.' : 'Merge copies to reach LV2 / LV3.', { color: C.faint, wrap: w }));
    cy += note.height + 2;
  }
  return cy;
}

function drawRelic(scene: Phaser.Scene, add: Add, id: string, x: number, y: number, w: number) {
  const bonus = REWARD_MAP[id];
  const r = RELIC_MAP[id] ?? bonus;
  const chip = relicChip(scene, x + 12, y + 12, id, 22);
  chip.t.setFontSize(16);
  add(chip.bg);
  add(chip.t);
  add(txt(scene, x + 32, y + 2, r.name.toUpperCase(), { color: C.gold, wrap: w - 32 }));
  add(txt(scene, x + 32, y + 14, bonus ? 'ONE-TIME BONUS' : 'RELIC', { color: bonus ? '#e0c8ff' : C.dim }));
  const d = add(txt(scene, x, y + 32, r.desc, { wrap: w }));
  const note = add(txt(scene, x, d.y + d.height + 6, bonus
    ? 'Sometimes offered instead of a relic after a battle (more often after a loss). Used up at once.'
    : 'Lasts the whole run. Copies stack.', { color: C.faint, wrap: w }));
  return note.y + note.height + 4;
}

function drawTrait(scene: Phaser.Scene, add: Add, id: ShipClass, count: number | undefined, x: number, y: number, w: number) {
  const tr = TRAIT_MAP[id];
  add(txt(scene, x, y + 2, `${tr.name} SYNERGY`, { color: tr.color }));
  if (count !== undefined) add(txt(scene, x + w, y + 2, `YOU HAVE ${count}`, { origin: [1, 0], color: C.dim }));
  let cy = y + 16;
  const intro = add(txt(scene, x, cy, tr.faction ? 'A faction. Each different ship counts once; banners add one.' : 'Each different ship of this class counts once.', { wrap: w, color: C.dim }));
  cy += intro.height + 6;
  for (const tier of tr.tiers) {
    const on = count !== undefined && count >= tier.n;
    const t = add(txt(scene, x, cy, `(${tier.n}) ${tier.desc}`, { wrap: w, color: on ? C.gold : C.text }));
    cy += t.height + 4;
  }
  const members = Object.values(SHIPS).filter((s) => s.tier > 0 && s.classes.includes(id));
  cy += 4;
  const pitch = 30;
  const perRow = Math.max(1, Math.floor(w / pitch));
  members.forEach((s, i) => {
    const im = add(scene.add.image(x + 14 + (i % perRow) * pitch, cy + 10 + Math.floor(i / perRow) * 22, shipKey(s.id, 0)));
    im.setScale(Math.min(2, (pitch - 4) / im.width));
  });
  cy += 22 * Math.ceil(members.length / perRow) + 2;
  if (tr.faction || members.length > 5) return cy;
  const names = add(txt(scene, x, cy, members.map((s) => s.name).join(', '), { wrap: w, color: C.faint }));
  return names.y + names.height + 4;
}

function drawCommander(scene: Phaser.Scene, add: Add, id: string, passive: 'a' | 'b' | undefined, x: number, y: number, w: number) {
  const c = CMD_MAP[id];
  add(txt(scene, x, y + 2, `COMMANDER ${c.name.toUpperCase()}`, { color: c.color }));
  let cy = y + 18;
  for (const slot of ['a', 'b'] as const) {
    const p = c.passives[slot];
    const active = passive === slot;
    const head = add(txt(scene, x, cy, `${slot === 'a' ? 'PASSIVE' : 'PASSIVE 2 (LV3)'}: ${p.name}`, {
      color: passive === undefined || active ? C.gold : C.dim, wrap: w,
    }));
    cy += head.height + 2;
    const d = add(txt(scene, x, cy, p.desc + (active ? '  (in use)' : ''), { wrap: w, color: passive === undefined || active ? C.text : C.dim }));
    cy += d.height + 6;
  }
  const ph = add(txt(scene, x, cy, `POWER: ${c.power.name} (${c.power.cost} SCRAP, ONCE A ROUND)`, { color: C.gold, wrap: w }));
  cy += ph.height + 2;
  const pd = add(txt(scene, x, cy, c.power.desc, { wrap: w }));
  return pd.y + pd.height + 4;
}

/**
 * Term definitions, top to bottom, stopping before `maxY`. Returns how many
 * didn't fit so the caller can point to the Archive.
 */
export function drawTerms(scene: Phaser.Scene, add: Add, terms: Term[], x: number, y: number, w: number, maxY: number): number {
  let cy = y;
  let shown = 0;
  for (const t of terms) {
    const name = txt(scene, x, cy, t.name, { color: C.cyan });
    const desc = txt(scene, x, cy + 11, t.desc, { wrap: w, color: C.text });
    if (desc.y + desc.height > maxY && shown > 0) {
      name.destroy();
      desc.destroy();
      break;
    }
    add(name);
    add(desc);
    cy = desc.y + desc.height + 7;
    shown++;
  }
  return terms.length - shown;
}

/** Pop-up card over the current scene: the detail on the left, its terms on the right. */
export function openDetails(scene: Phaser.Scene, d: Detail, onClose?: () => void) {
  const root = scene.add.container().setDepth(2500);
  const blocker = scene.add.rectangle(240, 135, 480, 270, 0x05060f, 0.75).setInteractive();
  root.add(blocker);
  const add: Add = (o) => { root.add(o); return o; };
  let downOnBlocker = false;
  const close = () => {
    root.destroy(true);
    onClose?.();
  };
  blocker.on('pointerdown', () => { downOnBlocker = true; });
  blocker.on('pointerup', () => { if (downOnBlocker) close(); });

  add(panel(scene, 16, 16, 448, 238));
  add(scene.add.rectangle(240, 135, 448, 238, 0xffffff, 0.001).setInteractive()); // swallow taps on the card
  drawDetail(scene, add, d, 28, 26, 196);
  add(scene.add.rectangle(236, 135, 1, 210, 0x262e50));
  const terms = detailTerms(d);
  add(txt(scene, 248, 28, terms.length ? 'WHAT THESE MEAN' : 'NO SPECIAL TERMS', { color: C.dim }));
  const left = drawTerms(scene, add, terms, 248, 44, 204, 222);
  if (left > 0) add(txt(scene, 248, 226, `+${left} more in the Fleet Archive`, { color: C.faint }));
  button(scene, 404, 238, 80, 18, 'CLOSE', close, { fill: 0x3a2a10, color: C.gold }).objects.forEach((o) => add(o));
}
