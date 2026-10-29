import Phaser from 'phaser';
import { addShip, addStarfield, setPlayerSkin, syncFlame } from '../game/art';
import { getProfile, pilotRank } from '../game/profile';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { getRun, useSlot } from '../game/storage';
import { dailyState } from '../game/daily';
import { decodeFleet, setChallenge } from '../game/share';
import { C, button, toast, txt } from '../game/ui';
import { fetchGhostNews, getPilot, setCallsign } from '../game/net';
import { cleanCallsign } from '../net/ghostRules';

let linkChecked = false; // a ?fleet= link is handled once per page load

interface Flyer {
  spr: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  side: 0 | 1;
  speed: number;
  baseY: number;
  phase: number;
}

export class MenuScene extends Phaser.Scene {
  private flyers: Flyer[] = [];

  constructor() {
    super('menu');
  }

  create() {
    useSlot('main');
    // Opened from a friend's fleet link: go straight to the duel.
    if (!linkChecked) {
      linkChecked = true;
      const shared = /[?&]fleet=/.test(location.search) ? decodeFleet(location.search) : null;
      if (/[?&]fleet=/.test(location.search)) history.replaceState(null, '', location.pathname);
      if (shared) {
        setChallenge(shared);
        this.scene.start('challenge');
        return;
      }
    }
    setPlayerSkin(null);
    audio.setMood('menu');
    addStarfield(this, true);
    this.flyers = [];

    // Flyby: a player squadron heading right, a raider pack heading left behind it.
    const squad: [string, 0 | 1, number, number][] = [
      ['dread', 0, 112, 0], ['gunboat', 0, 98, 60], ['scout', 0, 126, 90], ['carrier', 0, 134, 170],
      ['queen', 1, 196, 40], ['raider', 1, 210, 120], ['phantom', 1, 188, 200],
    ];
    for (const [def, side, y, offset] of squad) {
      const x = side === 0 ? -40 - offset : 520 + offset;
      const { spr, flame } = addShip(this, x, y, def, side, 2);
      if (side === 1) { spr.setAlpha(0.8); }
      this.flyers.push({ spr, flame, side, speed: side === 0 ? 0.035 : 0.05, baseY: y, phase: Math.random() * 6 });
    }

    const title = txt(this, 240, 46, 'GALACTIC BATTLER', { size: 20, origin: 0.5, color: C.gold });
    title.setStroke('#3a1d00', 6);
    txt(this, 240, 72, 'SPACE AUTO-BATTLER', { origin: 0.5, color: C.cyan }).setStroke('#05060f', 3);

    const saved = getRun();
    const hasRun = !!saved && saved.phase !== 'over';
    const profile = getProfile();
    txt(this, 240, 86, `PILOT RANK ${pilotRank(profile.xp)}`, { origin: 0.5, color: C.cyan }).setStroke('#05060f', 3);
    let y = hasRun ? 128 : 140;
    if (hasRun) {
      button(this, 240, y, 160, 20, 'CONTINUE', () => this.scene.start(sceneFor(saved!.phase)));
      y += 26;
    }
    button(this, 240, y, 160, 20, 'NEW RUN', () => this.scene.start('commanders'), { fill: 0x3a2a10, color: C.gold });
    y += 26;
    const daily = dailyState();
    button(this, 199, y, 78, 20, daily === 'playing' ? 'DAILY >' : 'DAILY', () => this.scene.start('daily'),
      { fill: 0x2a1a4a, color: daily === 'done' ? C.dim : '#c58cff' });
    button(this, 281, y, 78, 20, 'DUEL', () => this.scene.start('challenge'), { fill: 0x2a1a4a, color: '#c58cff' });
    y += 26;
    button(this, 240, y, 160, 20, 'FLEET ARCHIVE', () => this.scene.start('archive'), { fill: 0x14304a, color: C.cyan });

    // Callsign: the name other players see on your ghost fleet.
    const callsign = txt(this, 240, 14, `${getPilot().name} [EDIT]`, { origin: 0.5, color: C.cyan })
      .setInteractive({ useHandCursor: true });
    callsign.on('pointerup', () => {
      const typed = window.prompt('Your callsign (3-14 letters or numbers):', getPilot().name);
      if (typed === null) return;
      const clean = cleanCallsign(typed);
      if (!clean) return void toast(this, 'Use 3-14 letters or numbers');
      setCallsign(clean);
      callsign.setText(`${clean} [EDIT]`);
      toast(this, 'Callsign saved', C.gold);
    });

    this.add.rectangle(240, 250, 480, 28, 0x05060f, 0.75);
    const tagline = txt(this, 240, 250, 'Build a fleet. Win 10 battles before your 5 hull points run out.',
      { origin: 0.5, color: C.dim, wrap: 440, align: 'center' });
    // How your ghost fleets did against other players while you were away.
    void fetchGhostNews().then((news) => {
      if (!news || !tagline.active) return;
      const names = [...new Set(news.recent.map((r) => r.opp))].slice(0, 2).join(', ');
      tagline.setColor(C.gold).setText(
        `WHILE YOU WERE AWAY: your ghosts fought ${news.fights} pilot${news.fights === 1 ? '' : 's'} and won ${news.ghostWins}${names ? ` (vs ${names})` : ''}.`,
      );
    });

    soundButton(this, 16, 14);

    // Patch notes live on the site as a normal web page (scrolls and reads well on phones).
    button(this, 92, 14, 112, 16, 'PATCH NOTES', () => {
      const url = 'patch-notes.html';
      if (!window.open(url, '_blank')) window.location.href = url;
    }, { fill: 0x3a2a10, color: C.gold });

    // Fullscreen hides the phone's browser bars, which matters a lot in landscape.
    if (this.sys.game.device.fullscreen.available) {
      const label = () => (this.scale.isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN');
      const fs = button(this, 404, 14, 140, 16, label(), () => {
        if (this.scale.isFullscreen) this.scale.stopFullscreen();
        else this.scale.startFullscreen();
      });
      const sync = () => fs.label.active && fs.label.setText(label());
      this.scale.on('enterfullscreen', sync);
      this.scale.on('leavefullscreen', sync);
      this.events.once('shutdown', () => {
        this.scale.off('enterfullscreen', sync);
        this.scale.off('leavefullscreen', sync);
      });
    }
  }

  update(time: number, delta: number) {
    for (const f of this.flyers) {
      f.spr.x += (f.side === 0 ? 1 : -1) * f.speed * delta;
      if (f.side === 0 && f.spr.x > 540) f.spr.x = -60;
      if (f.side === 1 && f.spr.x < -60) f.spr.x = 540;
      f.spr.y = Math.round(f.baseY + Math.sin(time * 0.002 + f.phase) * 2);
      syncFlame(f.spr, f.flame, f.side);
    }
  }
}

export const sceneFor = (phase: string) => (phase === 'relic' ? 'relic' : phase === 'over' ? 'gameover' : 'shop');
