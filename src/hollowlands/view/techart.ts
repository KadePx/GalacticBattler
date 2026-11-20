// The things of the trades a colony discovers, drawn on the map: the mill's stone, sails and wheel,
// the baker's oven, the potter's kiln, the glass furnace, the tanning and dye vats, the steel
// furnace, the jeweller's bench and the printing press. Also what discoveries change on things
// already drawn: glass in the windows of homes, ditches and clover along the fields, pennants on
// the towers once the colony can dye cloth. Display only.

import type { Graphics } from 'pixi.js';
import { B, T, type Bld, type Colony } from '../sim/types';

const TS = 24;
const INK = 0x2a1d12;
const WOOD = 0x8a6440;

/** Furniture codes drawn here. */
export const isTechThing = (s: number): boolean => s >= B.MILLSTONE && s <= B.PRESS;

/** Steady 0..1 for a tile. */
const h2 = (x: number, y: number, k: number): number => {
  let h = Math.imul(x + 9137, 668265263) ^ Math.imul(y + 2246, 374761393) ^ Math.imul(k + 77, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const DYES = [0xb83a3a, 0x2f5fa8, 0xd9b83a, 0x6a3a8a, 0x3a8a4a];

/** Is this tile water (a mill's wheel turns in it)? */
const wet = (c: Colony, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  const t = c.ter[y * c.w + x];
  return t === T.SHALLOW || t === T.DEEP;
};

export function drawTechThing(g: Graphics, c: Colony, s: number, x: number, y: number): void {
  const px = x * TS;
  const py = y * TS;
  const cx = px + TS / 2;
  const cy = py + TS / 2;
  const shade = (sx: number, sy: number, w: number, h: number, r: number): void => { g.roundRect(sx + 1.5, sy + 2, w, h, r).fill({ color: 0x140c06, alpha: 0.28 }); };
  switch (s) {
    case B.MILLSTONE: {
      // the millstone on its bed, furrows cut in its face, a sack of flour beside it
      shade(cx - 9, cy - 9, 18, 18, 9);
      g.circle(cx, cy, 9.5).fill(0x9a968c).stroke({ width: 1.2, color: 0x3a3830 });
      for (let n = 0; n < 6; n++) {
        const a = (n * Math.PI) / 3 + 0.3;
        g.moveTo(cx + Math.cos(a) * 2.6, cy + Math.sin(a) * 2.6).lineTo(cx + Math.cos(a + 0.5) * 8.6, cy + Math.sin(a + 0.5) * 8.6).stroke({ width: 0.8, color: 0x6a665c });
      }
      g.circle(cx, cy, 2.4).fill(0x3a3830);
      g.roundRect(px + 15, py + 14, 8, 9, 3).fill(0xe9e1cc).stroke({ width: 0.8, color: 0x8a7a5a });
      g.rect(px + 16.5, py + 14, 5, 1.6).fill(0xc9b98a);
      break;
    }
    case B.SAILS: {
      // the windmill's cap, where the sails' shaft comes out (the sails themselves turn above the map: see drawSails)
      shade(cx - 8, cy - 8, 16, 16, 8);
      g.circle(cx, cy, 8).fill(0x6a4426).stroke({ width: 1.2, color: INK });
      g.circle(cx, cy, 5).fill(0x8a6440);
      break;
    }
    case B.WHEEL: {
      // the water wheel, standing out over the river from the mill's wall
      const ox = wet(c, x + 1, y) ? 1 : wet(c, x - 1, y) ? -1 : 0;
      const oy = ox ? 0 : wet(c, x, y + 1) ? 1 : -1;
      g.rect(px, py, TS, TS).fill(0x8a6440);
      const wx = cx + ox * 17;
      const wy = cy + oy * 17;
      // the wheel seen from above: a long drum of paddles across the flow
      const along = ox !== 0; // the axle runs out from the wall: the paddles lie across it
      const ww = along ? 13 : 28;
      const wh = along ? 28 : 13;
      g.ellipse(wx, wy, ww * 0.75, wh * 0.75).fill({ color: 0xffffff, alpha: 0.18 });
      g.roundRect(wx - ww / 2 - 1, wy - wh / 2 - 1, ww + 2, wh + 2, 2).fill({ color: 0xffffff, alpha: 0.25 });
      g.roundRect(wx - ww / 2, wy - wh / 2, ww, wh, 2).fill(0x6a4426).stroke({ width: 1.2, color: INK });
      for (let k = 0; k < 6; k++) {
        if (along) g.rect(wx - ww / 2 + 1, wy - wh / 2 + 1.5 + k * 3.5, ww - 2, 1.4).fill(0xa47a4c);
        else g.rect(wx - ww / 2 + 1.5 + k * 3.5, wy - wh / 2 + 1, 1.4, wh - 2).fill(0xa47a4c);
      }
      g.moveTo(cx, cy).lineTo(wx, wy).stroke({ width: 2.4, color: 0x3a3d45 });
      g.circle(wx, wy, 1.8).fill(0x3a3d45);
      break;
    }
    case B.OVEN: {
      // a brick oven, its mouth glowing, a loaf on the peel
      g.circle(cx, cy, 13).fill({ color: 0xff9a3a, alpha: 0.12 });
      shade(px + 2, py + 2, 20, 19, 9);
      g.roundRect(px + 2, py + 2, 20, 19, 9).fill(0xb0563a).stroke({ width: 1.2, color: 0x4a2216 });
      for (let k = 0; k < 3; k++) g.rect(px + 4, py + 6 + k * 4.5, 16, 0.8).fill({ color: 0x6a2a1a, alpha: 0.6 });
      g.roundRect(cx - 5, py + 13, 10, 7, 3).fill(0x2a1410);
      g.roundRect(cx - 3.5, py + 15, 7, 4, 2).fill(0xff9a3a);
      g.ellipse(cx, py + 16.5, 2.6, 1.4).fill(0xd9a85a);
      break;
    }
    case B.KILN: {
      // a beehive kiln of brick, fire in its belly, pots set out to cool
      g.circle(cx, cy, 13).fill({ color: 0xff7a3a, alpha: 0.12 });
      shade(cx - 10, cy - 10, 20, 20, 10);
      g.circle(cx, cy, 10).fill(0xa04a32).stroke({ width: 1.3, color: 0x4a2216 });
      g.circle(cx, cy, 6.6).fill(0x7a3424);
      g.circle(cx, cy, 4).fill(0xe8662a);
      g.circle(cx - 0.8, cy - 0.8, 1.8).fill(0xffc24a);
      for (const [dx, dy] of [[-8, 8], [8, 8], [8, -8]]) g.circle(cx + dx, cy + dy, 2.4).fill(0xc9845a).stroke({ width: 0.6, color: 0x5a2a1a });
      break;
    }
    case B.GLASSFURN: {
      // the glass furnace: a round hearth white-hot in the middle, blown vessels cooling round it
      g.circle(cx, cy, 14).fill({ color: 0xffb35a, alpha: 0.14 });
      shade(cx - 10, cy - 10, 20, 20, 10);
      g.circle(cx, cy, 10).fill(0x55585f).stroke({ width: 1.2, color: 0x1f2126 });
      g.circle(cx, cy, 5.6).fill(0xff9a3a);
      g.circle(cx, cy, 3).fill(0xfff2b0);
      for (const [dx, dy, col] of [[-7, -8, 0x7ac9b8], [8, -7, 0x8ab0e0], [-8, 7, 0x9ad08a]]) g.circle(cx + dx, cy + dy, 2.6).fill({ color: col, alpha: 0.85 }).stroke({ width: 0.6, color: 0xffffff, alpha: 0.6 });
      break;
    }
    case B.TANVAT: {
      // a tanning pit full of dark bark liquor, a hide hung over its edge
      shade(px + 2, py + 2, 20, 20, 2);
      g.roundRect(px + 2, py + 2, 20, 20, 2).fill(0x6a5236).stroke({ width: 1.2, color: INK });
      g.roundRect(px + 4, py + 4, 16, 16, 1.5).fill(0x4a3218);
      g.ellipse(cx - 2, cy - 2, 4, 2).fill({ color: 0x8a6a3a, alpha: 0.6 });
      g.poly([px + 12, py + 1, px + 22, py + 3, px + 21, py + 11, px + 14, py + 9]).fill(0xc9a27a).stroke({ width: 0.8, color: 0x6a4a2a });
      break;
    }
    case B.DYEVAT: {
      // a dye vat, each in its own colour
      const col = DYES[Math.floor(h2(x, y, 9) * DYES.length)];
      shade(cx - 10, cy - 10, 20, 20, 10);
      g.circle(cx, cy, 10).fill(0x8a5a32).stroke({ width: 1.3, color: INK });
      g.circle(cx, cy, 7.6).fill(col);
      g.ellipse(cx - 2, cy - 2.4, 3.2, 1.6).fill({ color: 0xffffff, alpha: 0.3 });
      g.moveTo(cx + 3, cy + 1).lineTo(cx + 11, cy - 9).stroke({ width: 1.6, color: 0x9a7a50, cap: 'round' });
      break;
    }
    case B.BLOOMERY: {
      // the steel furnace: a squat stone stack, glowing at its mouth, bellows at its side
      g.circle(cx, cy, 14).fill({ color: 0xff7a3a, alpha: 0.14 });
      shade(px + 3, py + 3, 18, 18, 3);
      g.roundRect(px + 3, py + 3, 18, 18, 3).fill(0x4b4f58).stroke({ width: 1.2, color: 0x15171b });
      g.circle(cx, cy - 1, 5.6).fill(0x241c1c);
      g.circle(cx, cy - 1, 3.8).fill(0xe8662a);
      g.circle(cx, cy - 1.5, 1.8).fill(0xfff2b0);
      g.poly([px + 1, py + 17, px + 7, py + 14, px + 7, py + 22, px + 1, py + 21]).fill(0x7a5232).stroke({ width: 0.7, color: INK });
      break;
    }
    case B.JEWELBENCH: {
      // the jeweller's bench: a little vice, a lamp, stones laid out on cloth
      shade(px + 2, py + 5, 20, 14, 2);
      g.roundRect(px + 2, py + 5, 20, 14, 2).fill(WOOD).stroke({ width: 1.1, color: INK });
      g.roundRect(px + 4, py + 7, 10, 9, 1).fill(0x2f4f6a);
      for (const [dx, dy, col] of [[6, 9, 0xd2445a], [10, 10, 0x5ad2c9], [7, 13, 0xe8c75a], [11, 14, 0xb0e05a]]) g.poly([px + dx, py + dy - 1.4, px + dx + 1.4, py + dy, px + dx, py + dy + 1.4, px + dx - 1.4, py + dy]).fill(col);
      g.circle(px + 18, py + 9, 2.4).fill(0xffe9a8);
      g.circle(px + 18, py + 15, 1.8).fill(0x8a9099);
      break;
    }
    case B.PRESS: {
      // the printing press: a heavy frame, its great screw, and printed sheets drying
      shade(px + 2, py + 2, 20, 20, 2);
      g.rect(px + 3, py + 3, 18, 18).fill(0xa47a4c).stroke({ width: 1.3, color: INK });
      g.rect(px + 6, py + 6, 12, 12).fill(0xf4efe4).stroke({ width: 0.8, color: 0x6a5a3a });
      for (let k = 0; k < 4; k++) g.rect(px + 7.5, py + 8 + k * 2.5, 9, 0.9).fill({ color: 0x2a2422, alpha: 0.7 });
      g.rect(px + 2, cy - 1.5, 20, 3).fill(0x5a3d28);
      g.circle(cx, cy, 3).fill(0x3a3d45).stroke({ width: 0.8, color: 0x15171b });
      break;
    }
    default: break;
  }
}

/** Glass in a glazed home's window: on every other stretch of straight outer wall. */
export function drawWindow(g: Graphics, x: number, y: number, horiz: boolean, night: boolean): void {
  const px = x * TS;
  const py = y * TS;
  const glass = night ? 0xffd27a : 0xbfe0ef;
  if (horiz) {
    g.rect(px + 6, py + 6, 12, 6).fill(glass).stroke({ width: 1, color: 0x2a1d12 });
    g.rect(px + 11.5, py + 6, 1, 6).fill(0x2a1d12);
    if (!night) g.rect(px + 7, py + 7, 3, 1.2).fill({ color: 0xffffff, alpha: 0.7 });
  } else {
    g.rect(px + 9, py + 5, 6, 12).fill(glass).stroke({ width: 1, color: 0x2a1d12 });
    g.rect(px + 9, py + 10.5, 6, 1).fill(0x2a1d12);
    if (!night) g.rect(px + 10, py + 6, 1.2, 3).fill({ color: 0xffffff, alpha: 0.7 });
  }
}

/** A field's ditch (irrigation) along its top edge and clover sown on its headland (rotation) down its left. */
export function drawFieldWorks(g: Graphics, b: Bld, x: number, y: number, ditch: boolean, clover: boolean, frozen: boolean): void {
  const px = x * TS;
  const py = y * TS;
  if (clover && x === b.x) {
    g.rect(px, py, 5, TS).fill(frozen ? 0x9aa69a : 0x5f9a4a);
    for (let k = 0; k < 3; k++) g.circle(px + 2.5, py + 4 + k * 8, 1.1).fill(frozen ? 0xdfe6e3 : 0xf2e6f2);
  }
  if (ditch && y === b.y) {
    g.rect(px, py, TS, 5).fill(0x4a3a26);
    g.rect(px, py + 1.2, TS, 2.6).fill(frozen ? 0xcfe3ea : 0x4f9ac0);
    if (!frozen) g.rect(px + ((x * 7) % 14), py + 1.8, 5, 0.8).fill({ color: 0xffffff, alpha: 0.5 });
  }
}

/** A pennant in the ruling house's colours on a tower, once the colony can dye cloth fast. */
export function drawPennant(g: Graphics, x: number, y: number, field: number, metal: number): void {
  const px = x * TS;
  const py = y * TS;
  g.moveTo(px + 12, py + 14).lineTo(px + 12, py - 6).stroke({ width: 1.4, color: 0x3a2716 });
  g.poly([px + 12.6, py - 6, px + 24, py - 2.5, px + 12.6, py + 1]).fill(field).stroke({ width: 0.7, color: 0x1a120a });
  g.circle(px + 16.5, py - 2.5, 1.3).fill(metal);
}

/** A windmill's four great sails, lattice and canvas, centred on (0,0): turned by the view as the wind blows. */
export function drawSails(g: Graphics): void {
  g.clear();
  for (let n = 0; n < 4; n++) {
    const a = (n * Math.PI) / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const vx = -uy;
    const vy = ux;
    const l0 = 5;
    const l1 = 40;
    g.poly([ux * l0, uy * l0, ux * l1, uy * l1, ux * l1 + vx * 9, uy * l1 + vy * 9, ux * l0 + vx * 6, uy * l0 + vy * 6]).fill({ color: 0xf2ead6, alpha: 0.92 }).stroke({ width: 1, color: 0x5a3d28 });
    for (let k = 1; k < 5; k++) {
      const l = l0 + ((l1 - l0) * k) / 5;
      g.moveTo(ux * l, uy * l).lineTo(ux * l + vx * (6 + k * 0.7), uy * l + vy * (6 + k * 0.7)).stroke({ width: 0.7, color: 0x8a6a4a });
    }
    g.moveTo(0, 0).lineTo(ux * (l1 + 2), uy * (l1 + 2)).stroke({ width: 2.2, color: 0x5a3d28, cap: 'round' });
  }
  g.circle(0, 0, 6).fill(0x6a4426).stroke({ width: 1.2, color: INK });
  g.circle(0, 0, 2).fill(0xd9b85a);
}
