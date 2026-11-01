// Friend duel: fight a fleet a friend shared (a link or a pasted code) with your most
// recent fleet, and share yours back. Just for fun: no run, rewards or hull at stake.

import Phaser from 'phaser';
import { addStarfield, setPlayerSkin } from '../game/art';
import { audio } from '../game/audio';
import { fleetRow } from '../game/fleetRow';
import { getPilot } from '../game/net';
import { decodeFleet, getChallenge, lastFleet, setChallenge, shareFleet } from '../game/share';
import { C, button, panel, toast, txt } from '../game/ui';
import { CMD_MAP } from '../sim/commanders';
import { levelOf } from '../sim/ships';
import type { Snapshot } from '../sim/types';

const defsOf = (s: Snapshot) => s.fleet.filter(Boolean).map((f) => f!.def);
const levelsOf = (s: Snapshot) => s.fleet.filter(Boolean).map((f) => levelOf(f!.xp));

export class ChallengeScene extends Phaser.Scene {
  constructor() {
    super('challenge');
  }

  create() {
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this);
    txt(this, 240, 14, 'FRIEND DUEL', { size: 16, origin: 0.5, color: C.gold }).setStroke('#05060f', 4);
    txt(this, 240, 32, 'Fight a fleet a friend sent you. Nothing is at stake.', { origin: 0.5, color: C.dim });

    const them = getChallenge();
    const mine = lastFleet();
    const me = mine ? { ...mine, name: getPilot().name } : null;

    // Their fleet (top) and yours (bottom), each in a panel.
    panel(this, 16, 44, 448, 82);
    if (them) {
      txt(this, 26, 50, `THEIR FLEET: ${them.name}`, { color: C.bad });
      txt(this, 26, 62, this.describe(them), { color: C.dim });
      fleetRow(this, defsOf(them), 240, 90, 1, 400, 2, levelsOf(them));
    } else {
      txt(this, 240, 70, 'No fleet to fight yet.', { origin: 0.5, color: C.dim });
      txt(this, 240, 88, 'Ask a friend for their fleet link,\nthen open it or paste it here.', { origin: 0.5, color: C.faint, align: 'center' });
    }

    panel(this, 16, 132, 448, 82);
    if (me) {
      txt(this, 26, 138, `YOUR LATEST FLEET: ${me.name}`, { color: C.cyan });
      txt(this, 26, 150, this.describe(me), { color: C.dim });
      fleetRow(this, defsOf(me), 240, 178, 0, 400, 2, levelsOf(me));
    } else {
      txt(this, 240, 172, 'Play a battle first: your latest fleet fights here.', { origin: 0.5, color: C.dim });
    }

    // Why SHARE / FIGHT are greyed out.
    const why = !me ? 'PLAY A RUN FIRST' : !them ? "PASTE A FRIEND'S CODE TO FIGHT" : '';
    if (why) txt(this, 350, 230, why, { origin: [0.5, 0], color: C.faint });
    button(this, 66, 250, 92, 18, 'BACK', () => this.scene.start('menu'));
    button(this, 170, 250, 104, 18, 'PASTE CODE', () => this.paste());
    button(this, 290, 250, 124, 18, 'SHARE MINE', () => void this.share(me), { disabled: !me, fill: 0x14304a, color: C.cyan });
    button(this, 410, 250, 100, 18, 'FIGHT!', () => {
      audio.play('launch');
      this.scene.start('battle', { duel: { me: me!, opp: them! } });
    }, { disabled: !them || !me, fill: 0x3a2a10, color: C.gold });
  }

  private describe(s: Snapshot) {
    const cmd = s.cmd ? CMD_MAP[s.cmd.id]?.name.toUpperCase() : null;
    return [`ROUND ${s.round}`, `${s.wins} WINS`, cmd].filter(Boolean).join('  ');
  }

  private paste() {
    const typed = window.prompt('Paste a fleet link or code:');
    if (!typed) return;
    const snap = decodeFleet(typed);
    if (!snap) return void toast(this, "That code doesn't work");
    setChallenge(snap);
    this.scene.restart();
  }

  private async share(me: Snapshot | null) {
    if (!me) return;
    const how = await shareFleet(me);
    if (how === 'copied') toast(this, 'Link copied! Send it to a friend.', C.gold);
  }
}
