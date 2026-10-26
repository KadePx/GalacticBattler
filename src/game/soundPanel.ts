// Speaker button and the sound settings panel it opens (music, effects, mute).
import Phaser from 'phaser';
import { audio } from './audio';
import { C, button, panel, txt } from './ui';

const STEPS = 5;
const silent = () => audio.settings.muted || (audio.settings.music <= 0 && audio.settings.sfx <= 0);

/**
 * A small speaker icon with a finger-sized hit area. Tapping it opens the panel.
 * Returns its objects so a scene can put them in a layer.
 */
export function soundButton(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.GameObject[] {
  const icon = scene.add.image(x, y, silent() ? 'spk_off' : 'spk_on');
  const hit = scene.add.rectangle(x, y, 22, 18, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => icon.setTint(0xffd166));
  hit.on('pointerout', () => icon.clearTint());
  hit.on('pointerup', () => {
    audio.play('click');
    openSoundPanel(scene, () => icon.active && icon.setTexture(silent() ? 'spk_off' : 'spk_on'));
  });
  return [icon, hit];
}

/** Modal panel over the current scene. Changes apply (and save) immediately. */
export function openSoundPanel(scene: Phaser.Scene, onClose?: () => void) {
  const root = scene.add.container().setDepth(3000);
  // Full-screen blocker: swallows taps meant for the scene underneath; tapping it closes.
  const blocker = scene.add.rectangle(240, 135, 480, 270, 0x05060f, 0.7).setInteractive();
  root.add(blocker);
  const body = scene.add.container();
  root.add(body);

  const close = () => {
    root.destroy(true);
    onClose?.();
  };
  // Close only on a tap that started on the backdrop (not a press on +/- released off the panel).
  let downOnBlocker = false;
  blocker.on('pointerdown', () => { downOnBlocker = true; });
  blocker.on('pointerup', () => { if (downOnBlocker) close(); });

  const draw = () => {
    body.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { body.add(o); return o; };
    add(panel(scene, 130, 64, 220, 142));
    // Swallow taps on the panel itself so they don't reach the blocker.
    add(scene.add.rectangle(240, 135, 220, 142, 0xffffff, 0.001).setInteractive());
    add(txt(scene, 240, 76, 'SOUND', { origin: 0.5, color: C.gold }));

    const row = (y: number, label: string, key: 'music' | 'sfx') => {
      const v = audio.settings[key];
      const off = audio.settings.muted;
      add(txt(scene, 142, y - 4, label, { color: off ? C.faint : C.text }));
      const level = Math.round(v * STEPS);
      const minus = button(scene, 238, y, 20, 18, '-', () => {
        audio.update({ [key]: Math.max(0, level - 1) / STEPS, muted: false });
        draw();
      });
      minus.objects.forEach(add);
      for (let i = 0; i < STEPS; i++) {
        const on = i < level && !off;
        add(scene.add.rectangle(256 + i * 12, y, 9, 12, on ? 0xffd166 : 0x1a2140).setStrokeStyle(1, on ? 0xffe8a8 : 0x3a4a7a));
      }
      const plus = button(scene, 330, y, 20, 18, '+', () => {
        audio.update({ [key]: Math.min(STEPS, level + 1) / STEPS, muted: false });
        if (key === 'sfx') audio.play('select'); // preview the new effects volume
        draw();
      });
      plus.objects.forEach(add);
    };
    row(102, 'MUSIC', 'music');
    row(128, 'EFFECTS', 'sfx');

    const muted = audio.settings.muted;
    button(scene, 190, 160, 96, 20, muted ? 'UNMUTE' : 'MUTE ALL', () => {
      audio.update({ muted: !muted });
      draw();
    }, { fill: muted ? 0x3a1420 : 0x24305e, color: muted ? C.bad : C.text }).objects.forEach(add);
    button(scene, 292, 160, 96, 20, 'DONE', close, { fill: 0x3a2a10, color: C.gold }).objects.forEach(add);
    if (!audio.ready) add(txt(scene, 240, 186, 'Sound starts after your first tap.', { origin: 0.5, color: C.faint }));
  };
  draw();
}
