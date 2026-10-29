import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { ShopScene } from './scenes/ShopScene';
import { BattleScene } from './scenes/BattleScene';
import { RelicScene } from './scenes/RelicScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GalleryScene } from './scenes/GalleryScene';
import { CommanderScene } from './scenes/CommanderScene';
import { ArchiveScene } from './scenes/ArchiveScene';
import { DailyScene } from './scenes/DailyScene';
import { ChallengeScene } from './scenes/ChallengeScene';
import { RouteScene } from './scenes/RouteScene';
import { installAudioUnlock } from './game/audio';

async function start() {
  // The pixel font must be loaded before Phaser draws any text.
  try {
    await Promise.race([
      document.fonts.load('8px "Press Start 2P"'),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to monospace */
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    width: 480,
    height: 270,
    pixelArt: true,
    backgroundColor: '#05060f',
    audio: { noAudio: true }, // the game makes its own sound (src/game/audio.ts)
    scale: { mode: Phaser.Scale.NONE, zoom: fitZoom(), autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, MenuScene, ShopScene, BattleScene, RelicScene, GameOverScene, GalleryScene, CommanderScene, ArchiveScene, DailyScene, ChallengeScene, RouteScene],
  });
  (window as unknown as { __game: Phaser.Game }).__game = game;
  installAudioUnlock();

  // Re-fit whenever the window (or phone orientation) changes. This also covers a
  // page that had no size yet when the game booted (hidden tab, iframe).
  const app = document.getElementById('app');
  const refit = () => {
    const z = fitZoom();
    if (Math.abs(game.scale.zoom - z) > 0.001) game.scale.setZoom(z);
    else game.scale.refresh();
  };
  if (app) new ResizeObserver(refit).observe(app);
  window.visualViewport?.addEventListener('resize', refit);
}

/**
 * How much to magnify the 480x270 game. Big screens get a whole-number zoom
 * (crisp, even pixels) capped at 3x so it never feels huge on a monitor.
 * Small screens (phones) just fill the space, since every pixel counts there.
 */
const MAX_ZOOM = 3;
function fitZoom(): number {
  const app = document.getElementById('app');
  // #app sits inside the safe-area padding, so its size is the space we can use.
  const w = app && app.clientWidth > 0 ? app.clientWidth : window.innerWidth;
  const h = app && app.clientHeight > 0 ? app.clientHeight : window.innerHeight;
  const fit = Math.min(w / 480, h / 270);
  if (!(fit > 0)) return 1;
  return fit >= 2 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit;
}

start();
