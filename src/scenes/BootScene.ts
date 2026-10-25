import Phaser from 'phaser';
import { makeTextures } from '../game/art';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    makeTextures(this);
    this.scene.start(new URLSearchParams(location.search).has('gallery') ? 'gallery' : 'menu');
  }
}
