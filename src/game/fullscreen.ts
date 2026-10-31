// Keep fullscreen across app switches. Phones drop fullscreen when you leave the browser,
// and the game only has a FULLSCREEN button on the main menu. So if the player was in
// fullscreen when the page was hidden, the first tap after coming back puts it back
// (browsers only allow entering fullscreen from a tap).

import type Phaser from 'phaser';

/** How long after leaving fullscreen we wait to see if the page is being hidden. */
const HIDE_GRACE_MS = 1000;

export function installFullscreenRestore(game: Phaser.Game) {
  const scale = game.scale;
  if (!game.device.fullscreen.available) return;
  let want = false;
  let leftAt = -Infinity;

  scale.on('enterfullscreen', () => { want = true; });
  scale.on('leavefullscreen', () => {
    if (document.hidden) return; // switching apps: keep wanting it
    // Leaving while visible is the player's choice (EXIT button, back gesture)...
    want = false;
    leftAt = Date.now();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    // ...unless the page is hidden right after: some phones leave fullscreen just before.
    if (Date.now() - leftAt < HIDE_GRACE_MS) want = true;
    // The page isn't always told that fullscreen ended, so leave it cleanly ourselves.
    if (scale.isFullscreen) {
      try { scale.stopFullscreen(); } catch { /* already left */ }
    }
  });

  window.addEventListener('pointerup', () => {
    if (!want || document.hidden || scale.isFullscreen) return;
    try { scale.startFullscreen(); } catch { /* blocked: try again on the next tap */ }
  }, { capture: true, passive: true });
}
