import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

// Snapshot PvP: a short hash of the battle code (src/sim). Online ghosts only meet fleets
// with the same hash, so a balance change never pits old fleets against new rules.
const simDir = resolve(__dirname, 'src/sim');
const simHash = createHash('sha1');
for (const f of readdirSync(simDir).sort()) {
  simHash.update(f).update(readFileSync(resolve(simDir, f), 'utf8').replace(/\r\n/g, '\n'));
}

// itskade.space hosts several games: each is its own page in the build.
export default defineConfig({
  define: { __SIM_VERSION__: JSON.stringify(simHash.digest('hex').slice(0, 12)) },
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
