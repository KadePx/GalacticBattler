import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// itskade.space hosts several games: each is its own page in the build.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000, // Phaser and three.js are big on their own
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        galactic: resolve(__dirname, 'galactic-battler/index.html'),
        rotwave: resolve(__dirname, 'rotwave/index.html'),
      },
    },
  },
});
