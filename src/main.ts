import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { ShopScene } from './scenes/ShopScene';
import { BattleScene } from './scenes/BattleScene';
import { RelicScene } from './scenes/RelicScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GalleryScene } from './scenes/GalleryScene';

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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, MenuScene, ShopScene, BattleScene, RelicScene, GameOverScene, GalleryScene],
  });
  (window as unknown as { __game: Phaser.Game }).__game = game;

  // If the page had no size yet when the game booted (hidden tab, iframe),
  // the canvas ends up 0x0. Re-fit whenever the container changes size.
  const app = document.getElementById('app');
  if (app) new ResizeObserver(() => game.scale.refresh()).observe(app);
}

start();
