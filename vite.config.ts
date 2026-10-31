import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { localApi } from './scripts/localApi';

// Snapshot PvP: a short hash of the battle code (src/sim). Online ghosts only meet fleets
// with the same hash, so a balance change never pits old fleets against new rules.
const simDir = resolve(__dirname, 'src/sim');
const simHash = createHash('sha1');
for (const f of readdirSync(simDir).sort()) {
  simHash.update(f).update(readFileSync(resolve(simDir, f), 'utf8').replace(/\r\n/g, '\n'));
}
const simHex = simHash.digest('hex').slice(0, 12);

// Changes that leave every existing fleet fighting exactly as before (like adding a commander)
// can keep the online ghost pool: map the new hash to the live one. Any later edit to
// src/sim makes a new hash that isn't listed here, so the pool resets as normal.
const SIM_COMPAT: Record<string, string> = {
  '1852316f7602': 'a100157dab34', // Juul: new commander only
};

// itskade.space hosts several games: each is its own page in the build.
export default defineConfig({
  plugins: [localApi()], // dev only: runs functions/api locally
  define: { __SIM_VERSION__: JSON.stringify(SIM_COMPAT[simHex] ?? simHex) },
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
