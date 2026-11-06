import Phaser from 'phaser';
import { addShip, addStarfield, setPlayerSkin, syncFlame } from '../game/art';
import { cleanProfile, getProfile, pilotRank, rankXp, saveProfile } from '../game/profile';
import { audio } from '../game/audio';
import { soundButton } from '../game/soundPanel';
import { getRun, useSlot } from '../game/storage';
import { dailyState } from '../game/daily';
import { WIN_TARGET } from '../game/run';
import { decodeFleet, setChallenge } from '../game/share';
import { openFeedback } from '../game/feedback';
import { C, bar, button, panel, tapZone, toast, txt, type Button } from '../game/ui';
import { adoptPilot, claimLinkCode, createLinkCode, fetchGhostNews, getPilot, setCallsign } from '../game/net';
import { cleanCallsign, isPlayerId } from '../net/ghostRules';

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

  create(data?: { linked?: string }) {
    useSlot('main');
    if (data?.linked) this.time.delayedCall(150, () => toast(this, `LINKED! YOU ARE ${data.linked}`, C.gold));
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
    const rank = pilotRank(profile.xp);
    txt(this, 240, 86, `PILOT RANK ${rank}`, { origin: 0.5, color: C.cyan }).setStroke('#05060f', 3);
    // Progress to the next rank (more ranks unlock commanders).
    bar(this, 200, 93, 80, 4, (profile.xp - rankXp(rank)) / (rankXp(rank + 1) - rankXp(rank)), 0x7fe7ff);

    // Bottom strip: the default line, ghost news when it arrives, and a one-line
    // description of whichever mode button is hovered.
    this.add.rectangle(240, 250, 480, 28, 0x05060f, 0.75);
    const tagline = txt(this, 240, 250, '', { origin: 0.5, wrap: 440, align: 'center' });
    let base = { text: 'Build a fleet. Win 10 battles before your 5 hull points run out.', color: C.dim };
    const setLine = (text: string, color: string) => tagline.active && tagline.setColor(color).setText(text);
    setLine(base.text, base.color);
    const hint = (b: Button, text: string) => {
      b.bg.on('pointerover', () => setLine(text, C.text));
      b.bg.on('pointerout', () => setLine(base.text, base.color));
    };

    // Mode buttons: a 200px wide grid.
    let y = hasRun ? 128 : 140;
    if (hasRun) {
      const run = saved!;
      const g = run.gauntlet;
      const label = g ? `CONTINUE GAUNTLET R${run.round}` : run.endless ? `CONTINUE ENDLESS R${run.round}` : `CONTINUE ROUND ${run.round}`;
      const b = button(this, 240, y, 200, 20, label, () => this.scene.start(sceneFor(run.phase)),
        g ? { fill: 0x4a1420, color: '#ff8a8a' } : run.endless ? { fill: 0x2a1a4a, color: '#c58cff' } : {});
      const kind = g ? `Boss Gauntlet, sector ${g.sector}` : run.endless ? 'Endless run' : `Run with ${run.wins}/${WIN_TARGET} wins`;
      hint(b, `${kind}: round ${run.round}, ${run.lives} hull left. Pick up where you left off.`);
      y += 26;
    }
    hint(button(this, 189, y, 98, 20, 'NEW RUN', () => this.scene.start('commanders'), { fill: 0x3a2a10, color: C.gold }),
      'Pick a commander, build a fleet, win 10 battles before your 5 hull runs out.');
    hint(button(this, 291, y, 98, 20, 'GAUNTLET', () => this.scene.start('commanders', { gauntlet: true }), { fill: 0x4a1420, color: '#ff8a8a' }),
      '3 sectors, each ending in a boss. Pick your route. Bosses drop boss relics.');
    y += 26;
    const daily = dailyState();
    const dailyLabel = daily === 'playing' ? 'RESUME DAILY' : daily === 'done' ? 'DAILY DONE' : 'PLAY DAILY';
    const dailyHint = daily === 'playing' ? "Your daily run is in progress. Tap to continue it."
      : daily === 'done' ? "Today's daily is done. See the board; a new one comes at midnight UTC."
        : 'Same commander, shops and rivals for everyone today. First finished run counts.';
    hint(button(this, 200, y, 120, 20, dailyLabel, () => this.scene.start('daily'),
      { fill: 0x2a1a4a, color: daily === 'done' ? C.dim : daily === 'playing' ? C.gold : '#c58cff' }), dailyHint);
    hint(button(this, 302, y, 76, 20, 'DUEL', () => this.scene.start('challenge'), { fill: 0x2a1a4a, color: '#c58cff' }),
      "Fight a fleet a friend sent you with your latest fleet. Nothing at stake.");
    y += 26;
    hint(button(this, 200, y, 120, 20, 'ARCHIVE', () => this.scene.start('archive'), { fill: 0x14304a, color: C.cyan }),
      'Look up every ship, synergy, relic, commander and game term.');
    hint(button(this, 302, y, 76, 20, 'FEEDBACK', () => openFeedback(), { fill: 0x14304a, color: C.cyan }),
      'Report a bug or suggest an idea. It goes straight to the developer.');

    // Callsign: the name other players see on your ghost fleet. Tapping it opens the pilot
    // panel (rename, link another device). The tap area fits the longest callsign + " [EDIT]".
    const callsign = txt(this, 240, 14, `${getPilot().name} [EDIT]`, { origin: 0.5, color: C.cyan });
    const editZone = tapZone(this, 240, 14, 176, 20);
    editZone.on('pointerover', () => callsign.setColor(C.gold));
    editZone.on('pointerout', () => callsign.setColor(C.cyan));
    editZone.on('pointerup', () => this.openPilotPanel());

    // How your ghost fleets did against other players while you were away. Capped at 2 lines:
    // drop the rival names if they would make it wrap to a third.
    void fetchGhostNews().then((news) => {
      if (!news || !tagline.active) return;
      const all = [...new Set(news.recent.map((r) => r.opp))];
      const head = `WHILE YOU WERE AWAY: your ghosts fought ${news.fights} pilot${news.fights === 1 ? '' : 's'} and won ${news.ghostWins}`;
      for (const n of [2, 1, 0]) {
        const names = all.slice(0, n).join(', ');
        base = { text: `${head}${names ? ` (vs ${names})` : ''}.`, color: C.gold };
        setLine(base.text, base.color);
        if (tagline.height <= 22) break;
      }
    });

    soundButton(this, 16, 14);

    // Patch notes live on the site as a normal web page (scrolls and reads well on phones).
    hint(button(this, 92, 14, 112, 16, 'PATCH NOTES', () => {
      const url = 'patch-notes.html';
      if (!window.open(url, '_blank')) window.location.href = url;
    }), 'What changed in each update (opens a web page).');

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
      // Coming back from another app: fullscreen may have ended without an event.
      const onVisible = () => { if (!document.hidden) this.time.delayedCall(300, sync); };
      document.addEventListener('visibilitychange', onVisible);
      this.events.once('shutdown', () => {
        this.scale.off('enterfullscreen', sync);
        this.scale.off('leavefullscreen', sync);
        document.removeEventListener('visibilitychange', onVisible);
      });
    }
  }

  /**
   * Pilot panel: rename, show a code that links another device to this pilot, or enter a
   * code from another device to become that pilot here.
   */
  private openPilotPanel() {
    const root = this.add.container().setDepth(900);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { root.add(o); return o; };
    const close = () => root.destroy(true);
    // Swallows taps on the menu behind; tapping outside the card closes it.
    add(this.add.rectangle(240, 135, 480, 270, 0x05060f, 0.75).setInteractive()).on('pointerup', close);
    add(panel(this, 80, 52, 320, 170));
    add(this.add.rectangle(240, 137, 320, 170, 0xffffff, 0.001).setInteractive()); // card swallows its own taps
    add(txt(this, 92, 62, 'PILOT', { color: C.dim }));
    const name = add(txt(this, 140, 62, getPilot().name, { color: C.cyan }));
    const big = add(txt(this, 240, 96, '', { origin: 0.5, size: 16, color: C.gold }).setStroke('#05060f', 4));
    const info = add(txt(this, 240, 122, 'Playing on another device?\nMake a code here, enter it there.',
      { origin: [0.5, 0], color: C.text, align: 'center', wrap: 300 }));
    const say = (text: string, color = C.text) => info.setText(text).setColor(color);

    const btn = (x: number, y: number, label: string, onClick: () => void, fill?: number, color?: string) =>
      button(this, x, y, 140, 20, label, onClick, { fill, color }).objects.forEach((o) => add(o));

    let busy = false;
    btn(164, 172, 'LINK A DEVICE', async () => {
      if (busy) return;
      busy = true;
      say('Making a code...', C.dim);
      const res = await createLinkCode(getProfile());
      busy = false;
      if (!root.active) return;
      if ('error' in res) return void say(`Couldn't make a code: ${res.error}`, C.bad);
      big.setText(res.code.split('').join(' '));
      say('On the other device: tap the\ncallsign, then ENTER A CODE.\nWorks once, for 10 minutes.', C.text);
    }, 0x3a2a10, C.gold);
    btn(316, 172, 'ENTER A CODE', async () => {
      if (busy) return;
      const typed = window.prompt('Code from your other device (5 digits):');
      if (typed === null) return;
      const code = typed.replace(/\D/g, '');
      if (code.length !== 5) return void say('A link code is 5 digits.', C.bad);
      if (!window.confirm("This device becomes the linked pilot: its callsign and progress replace this device's. Continue?")) return;
      busy = true;
      say('Linking...', C.dim);
      const res = await claimLinkCode(code);
      busy = false;
      if (!root.active) return;
      if ('error' in res) return void say(`Couldn't link: ${res.error}`, C.bad);
      const profile = cleanProfile(res.profile);
      const callsign = cleanCallsign(res.name);
      if (!profile || !callsign || !isPlayerId(res.player)) return void say("Couldn't link: the code's data looks wrong.", C.bad);
      adoptPilot(res.player, callsign);
      saveProfile(profile);
      audio.play('select');
      this.scene.restart({ linked: callsign });
    });
    btn(164, 198, 'RENAME', () => {
      const typed = window.prompt('Your callsign (3-14 letters or numbers):', getPilot().name);
      if (typed === null) return;
      const clean = cleanCallsign(typed);
      if (!clean) return void say('Use 3-14 letters or numbers.', C.bad);
      setCallsign(clean);
      name.setText(clean);
      say('Callsign saved. Daily scores\nshow the new name.', C.gold);
    });
    btn(316, 198, 'CLOSE', () => this.scene.restart());
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

export const sceneFor = (phase: string) => (phase === 'relic' ? 'relic' : phase === 'over' ? 'gameover' : phase === 'route' ? 'route' : 'shop');
