// Owner tools for the live Hollow Lands world.
//   npm run hl:admin -- region                      list the colonies
//   npm run hl:admin -- status <colony>             a colony's state
//   npm run hl:admin -- raid <colony> <kind> [n]    send trouble (bandit, slaver, orc, wolf, ghoul, troll, boar)
//   npm run hl:admin -- pace <colony> <msPerDay>    change how long a game day lasts (1440000 = one year per real day)
// Add --local to talk to the dev server (http://localhost:5173, key "dev"), or --url <base>.
// The key comes from HL_ADMIN_KEY or the git-ignored file .hl-admin-key.

import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const local = args.includes('--local');
if (local) args.splice(args.indexOf('--local'), 1);
const base = flag('--url') ?? (local ? 'http://localhost:5173' : 'https://itskade.space');
const key = local ? (process.env.HL_ADMIN_KEY ?? 'dev') : (process.env.HL_ADMIN_KEY ?? (existsSync('.hl-admin-key') ? readFileSync('.hl-admin-key', 'utf8').trim() : ''));
const [cmd, colony, a, b] = args;

async function call(path, body) {
  const r = await fetch(`${base}/api/hl/${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}

if (cmd === 'region') {
  const r = await call('region');
  for (const s of r.body.sites ?? []) console.log(`${s.id.padEnd(8)} ${s.name.padEnd(18)} ${String(s.pop).padStart(3)} people${s.ruler ? '  ruled by ' + s.ruler : ''}${s.dead ? '  (abandoned)' : ''}${s.from ? '  from ' + s.from : ''}`);
} else if (cmd === 'status' && colony) console.log(await call(`c/${colony}/admin/status`));
else if (cmd === 'raid' && colony && a) console.log(await call(`c/${colony}/admin/raid`, { kind: a, n: Number(b) || 3 }));
else if (cmd === 'pace' && colony && a) console.log(await call(`c/${colony}/admin/pace`, { msPerDay: Number(a) }));
else console.log('usage: region | status <colony> | raid <colony> <kind> [n] | pace <colony> <msPerDay>   [--local | --url <base>]');
