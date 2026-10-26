import Phaser from 'phaser';
import { addStarfield, portraitKey, setPlayerSkin, shipKey } from '../game/art';
import { audio } from '../game/audio';
import { detailTerms, drawDetail, drawTerms, type Detail } from '../game/details';
import { TERMS } from '../game/glossary';
import { getProfile, isUnlocked } from '../game/profile';
import { soundButton } from '../game/soundPanel';
import { C, TIER_COLORS, button, panel, relicChip, txt } from '../game/ui';
import { COMMANDERS, CMD_MAP } from '../sim/commanders';
import { RELICS } from '../sim/relics';
import { SHIPS, type ShipClass } from '../sim/ships';
import { TRAITS } from '../sim/traits';

type Tab = 'ships' | 'synergy' | 'relics' | 'cmdrs' | 'terms';
const TABS: { id: Tab; label: string }[] = [
  { id: 'ships', label: 'SHIPS' },
  { id: 'synergy', label: 'SYNERGY' },
  { id: 'relics', label: 'RELICS' },
  { id: 'cmdrs', label: 'COMMANDERS' },
  { id: 'terms', label: 'TERMS' },
];

// Every ship, by tier, with the launched-only Fighter last.
const SHIP_LIST = [...Object.values(SHIPS).filter((s) => s.tier > 0).sort((a, b) => a.tier - b.tier), SHIPS.fighter];

const LIST = { x: 6, y: 48, w: 184, h: 216 };
const DETAIL = { x: 196, y: 48, w: 278, h: 216 };
const TERMS_PER_PAGE = 10;

/** Reference for everything in the game: ships, synergies, relics, commanders and terms. */
export class ArchiveScene extends Phaser.Scene {
  private tab: Tab = 'ships';
  private pick: Record<Tab, string> = { ships: SHIP_LIST[0].id, synergy: 'strike', relics: RELICS[0].id, cmdrs: 'vance', terms: TERMS[0].id };
  private termPage = 0;
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('archive');
  }

  create() {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
    this.layer = this.add.container();
    this.refresh();
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private refresh() {
    this.layer.removeAll(true);
    this.add2(panel(this, 0, 0, 480, 22, 0x0a0e22, 0x232c52));
    this.add2(txt(this, 8, 8, 'FLEET ARCHIVE', { color: C.gold }));
    soundButton(this, 400, 11).forEach((o) => this.add2(o));
    button(this, 446, 11, 56, 16, 'BACK', () => this.scene.start('menu')).objects.forEach((o) => this.add2(o));

    // Tabs
    let tx = 6;
    for (const t of TABS) {
      const w = t.label.length * 8 + 14;
      const on = this.tab === t.id;
      const b = button(this, tx + w / 2, 35, w, 16, t.label, () => {
        this.tab = t.id;
        this.refresh();
      }, { fill: on ? 0x3a2a10 : 0x141a33, color: on ? C.gold : C.dim });
      b.objects.forEach((o) => this.add2(o));
      tx += w + 4;
    }

    if (this.tab === 'ships') this.shipGrid();
    else if (this.tab === 'synergy') this.list(TRAITS.map((t) => ({ id: t.id, label: t.name, color: t.color })));
    else if (this.tab === 'relics') this.relicList();
    else if (this.tab === 'cmdrs') this.commanderList();
    else this.termList();
    this.detail();
  }

  private select(id: string) {
    audio.play('select');
    this.pick[this.tab] = id;
    this.refresh();
  }

  // ---------- left side ----------

  private shipGrid() {
    const cols = 6;
    const cw = 30;
    const ch = 36;
    SHIP_LIST.forEach((s, i) => {
      const x = LIST.x + (i % cols) * cw + cw / 2;
      const y = LIST.y + Math.floor(i / cols) * ch + ch / 2;
      const sel = this.pick.ships === s.id;
      const tc = TIER_COLORS[s.tier] ?? 0x8a94b8;
      const box = this.add2(this.add.rectangle(x, y, cw - 4, ch - 4, sel ? 0x1f2c66 : 0x0b1026).setStrokeStyle(sel ? 2 : 1, sel ? C.highlight : tc));
      const img = this.add2(this.add.image(x, y + 2, shipKey(s.id, 0)));
      img.setScale(Math.min(2, (cw - 6) / img.width));
      this.add2(txt(this, x - cw / 2 + 4, y - ch / 2 + 4, s.tier ? `${s.tier}` : 'F', { color: `#${tc.toString(16).padStart(6, '0')}` }).setStroke('#05060f', 2));
      box.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(s.id));
    });
  }

  /** A simple selectable column of labels. */
  private list(items: { id: string; label: string; color: string }[], rowH = 20) {
    items.forEach((it, i) => {
      const y = LIST.y + i * rowH;
      const sel = this.pick[this.tab] === it.id;
      const r = this.add2(this.add.rectangle(LIST.x + LIST.w / 2, y + rowH / 2, LIST.w, rowH - 3, sel ? 0x1f2c66 : 0x0b1026)
        .setStrokeStyle(1, sel ? C.highlight : 0x262e50));
      this.add2(txt(this, LIST.x + 8, y + rowH / 2 - 3, it.label, { color: sel ? C.gold : it.color }));
      r.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(it.id));
    });
  }

  private relicList() {
    const rowH = 10.5;
    RELICS.forEach((r, i) => {
      const y = LIST.y + i * rowH;
      const sel = this.pick.relics === r.id;
      const row = this.add2(this.add.rectangle(LIST.x + LIST.w / 2, y + rowH / 2, LIST.w, rowH - 2, sel ? 0x1f2c66 : 0x0b1026)
        .setStrokeStyle(1, sel ? C.highlight : 0x1d2444));
      const chip = relicChip(this, LIST.x + 8, y + rowH / 2, r.id, 8);
      this.add2(chip.bg);
      this.add2(chip.t);
      this.add2(txt(this, LIST.x + 18, y + 2, r.name.toUpperCase(), { color: sel ? C.gold : C.text }));
      row.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(r.id));
    });
  }

  private commanderList() {
    const p = getProfile();
    const rowH = 19;
    COMMANDERS.forEach((c, i) => {
      const y = LIST.y + i * (rowH + 2.5);
      const sel = this.pick.cmdrs === c.id;
      const open = isUnlocked(p, c.id);
      const row = this.add2(this.add.rectangle(LIST.x + LIST.w / 2, y + rowH / 2, LIST.w, rowH, sel ? 0x1f2c66 : 0x0b1026)
        .setStrokeStyle(1, sel ? C.highlight : 0x262e50));
      this.add2(this.add.image(LIST.x + 12, y + rowH / 2, portraitKey(c.id, !open)).setScale(1));
      this.add2(txt(this, LIST.x + 26, y + 6, c.name.toUpperCase(), { color: open ? c.color : C.dim }));
      this.add2(txt(this, LIST.x + LIST.w - 6, y + 6, open ? 'OPEN' : `RANK ${c.rank}`, { origin: [1, 0], color: open ? C.faint : C.bad }));
      row.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(c.id));
    });
  }

  private termList() {
    const pages = Math.ceil(TERMS.length / TERMS_PER_PAGE);
    this.termPage = Math.min(this.termPage, pages - 1);
    const items = TERMS.slice(this.termPage * TERMS_PER_PAGE, (this.termPage + 1) * TERMS_PER_PAGE);
    this.list(items.map((t) => ({ id: t.id, label: t.name, color: C.cyan })), 18);
    if (pages > 1) {
      const y = LIST.y + LIST.h - 9;
      button(this, LIST.x + 26, y, 48, 16, 'PREV', () => { this.termPage = (this.termPage + pages - 1) % pages; this.refresh(); })
        .objects.forEach((o) => this.add2(o));
      this.add2(txt(this, LIST.x + LIST.w / 2, y - 3, `${this.termPage + 1}/${pages}`, { origin: [0.5, 0], color: C.dim }));
      button(this, LIST.x + LIST.w - 26, y, 48, 16, 'NEXT', () => { this.termPage = (this.termPage + 1) % pages; this.refresh(); })
        .objects.forEach((o) => this.add2(o));
    }
  }

  // ---------- right side ----------

  private detail() {
    const { x, y, w, h } = DETAIL;
    this.add2(panel(this, x, y, w, h));
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => this.add2(o);
    const ix = x + 8;
    const iw = w - 16;
    const bottom = y + h - 6;

    if (this.tab === 'terms') {
      const t = TERMS.find((k) => k.id === this.pick.terms) ?? TERMS[0];
      this.add2(txt(this, ix, y + 8, t.name, { color: C.cyan }));
      const desc = this.add2(txt(this, ix, y + 24, t.desc, { wrap: iw }));
      // Which ships use this term (tap one to jump to it).
      const users = t.match ? SHIP_LIST.filter((s) => t.match!.test([s.desc, ...s.perks].join(' '))) : [];
      if (users.length) {
        const uy = desc.y + desc.height + 12;
        this.add2(txt(this, ix, uy, 'SHIPS THAT USE IT', { color: C.dim }));
        users.slice(0, 14).forEach((s, i) => {
          const cx = ix + 18 + (i % 7) * 37;
          const cy = uy + 26 + Math.floor(i / 7) * 34;
          const tile = this.add2(this.add.rectangle(cx, cy, 34, 30, 0x0b1026).setStrokeStyle(1, TIER_COLORS[s.tier] ?? 0x8a94b8));
          const im = this.add2(this.add.image(cx, cy, shipKey(s.id, 0)));
          im.setScale(Math.min(2, 30 / im.width));
          tile.setInteractive({ useHandCursor: true }).on('pointerup', () => {
            this.tab = 'ships';
            this.select(s.id);
          });
        });
      }
      return;
    }

    let d: Detail;
    if (this.tab === 'ships') d = { def: SHIPS[this.pick.ships] };
    else if (this.tab === 'synergy') d = { trait: this.pick.synergy as ShipClass };
    else if (this.tab === 'relics') d = { relic: this.pick.relics };
    else d = { cmd: this.pick.cmdrs };

    let cy = drawDetail(this, add, d, ix, y + 6, iw);
    if (this.tab === 'cmdrs') {
      const c = CMD_MAP[this.pick.cmdrs];
      const locked = !isUnlocked(getProfile(), c.id);
      const extra = this.add2(txt(this, ix, cy + 2, locked ? `Unlocks at pilot rank ${c.rank}.` : `Level up to unlock passive 2 (LV3).`, {
        color: locked ? C.bad : C.faint, wrap: iw,
      }));
      cy = extra.y + extra.height + 2;
    }

    const terms = detailTerms(d);
    if (!terms.length || cy > bottom - 30) return;
    this.add2(this.add.rectangle(x + w / 2, cy + 4, iw, 1, 0x262e50));
    const left = drawTerms(this, add, terms, ix, cy + 10, iw, bottom - 12);
    if (left > 0) this.add2(txt(this, x + w - 8, y + h - 14, `+${left} in TERMS`, { origin: [1, 0], color: C.faint }));
  }
}
