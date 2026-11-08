// Commonworld admin. Wipes happen only when the owner asks.
//
//   npm run world:admin -- status
//   npm run world:admin -- wipe --confirm [--seed 123] [--civs 20]
//   add --local to talk to the dev server (http://localhost:5173, key "dev")
//
// The key comes from CW_ADMIN_KEY or the git-ignored file .cw-admin-key. A wipe saves the old
// world as an 'archive' backup in D1 (table cw_snaps) before starting a fresh one.

import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const local = flag('local');
const base = opt('url') ?? (local ? 'http://localhost:5173' : 'https://itskade.space');
const key = process.env.CW_ADMIN_KEY ?? (existsSync('.cw-admin-key') ? readFileSync('.cw-admin-key', 'utf8').trim() : local ? 'dev' : '');
const cmd = args[0];

if (!key) { console.error('No admin key: set CW_ADMIN_KEY or create .cw-admin-key'); process.exit(1); }
if (cmd === 'wipe' && !flag('confirm')) { console.error('A wipe ends this world for everyone. Re-run with --confirm.'); process.exit(1); }
if (cmd !== 'status' && cmd !== 'wipe') { console.error('usage: status | wipe --confirm [--seed N] [--civs N] [--local]'); process.exit(1); }

const body = cmd === 'wipe' ? JSON.stringify({ seed: opt('seed') ? Number(opt('seed')) : undefined, civs: opt('civs') ? Number(opt('civs')) : undefined }) : undefined;
const res = await fetch(`${base}/api/cw/admin/${cmd}`, { method: cmd === 'wipe' ? 'POST' : 'GET', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body });
console.log(res.status, JSON.stringify(await res.json().catch(() => ({})), null, 2));
