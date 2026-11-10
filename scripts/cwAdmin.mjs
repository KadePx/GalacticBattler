// Commonworld admin. Wipes happen only when the owner asks.
//
//   npm run world:admin -- status
//   npm run world:admin -- wipe --confirm [--seed 123] [--civs 20]
//   npm run world:admin -- next open [--seeds 11,22,33,44,55,66] [--sim 7]   open the map ballot (6 random maps);
//        --sim N: the new world begins only once sim version N is deployed (an older world then holds still)
//   npm run world:admin -- next close [--pick 3] [--at "2026-11-14 19:00"]   end voting (winner, or map number --pick)
//   npm run world:admin -- next schedule --at "2026-11-14 19:00"     set or move the start (local time), or --in 2h
//   npm run world:admin -- next set [--civs 0] [--fill 20] [--sim 7]   ancient peoples at the start / AI peoples arriving later
//   npm run world:admin -- next unschedule | next cancel
//   npm run world:admin -- god <what> [--civ NAME] [--other NAME] [--town NAME] [--text "..."] [--name NAME] [--power 2]
//        what: say (--text, optional --civ/--town) | plague, quake, eruption, fire, flood, tsunami, revolt (--town)
//              famine, bless, collapse, calm (--civ) | war, peace (--civ --other)
//              horde [--civ NAME to ride in near them] [--name NAME] [--power 1-6]: an unbreakable people at war
//              with its nearest neighbours until it is calmed (god calm --civ NAME)
//   add --local to talk to the dev server (http://localhost:5173, key "dev")
//
// The key comes from CW_ADMIN_KEY or the git-ignored file .cw-admin-key. A wipe saves the old
// world as an 'archive' backup in D1 (table cw_snaps) before starting a fresh one. When a
// scheduled new world begins, the old one is archived the same way and stays viewable.

import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const local = flag('local');
const base = opt('url') ?? (local ? 'http://localhost:5173' : 'https://itskade.space');
const key = process.env.CW_ADMIN_KEY ?? (local ? 'dev' : existsSync('.cw-admin-key') ? readFileSync('.cw-admin-key', 'utf8').trim() : '');
const cmd = args[0];

/** --at "2026-11-14 19:00" (local time) or --in 90m / 2h / 3d. */
function startTime() {
  const at = opt('at');
  const inn = opt('in');
  if (at) {
    const t = new Date(at.replace(' ', 'T')).getTime();
    if (!Number.isFinite(t)) { console.error(`Cannot read the time "${at}"`); process.exit(1); }
    return t;
  }
  if (inn) {
    const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(inn);
    if (!m) { console.error('--in takes e.g. 90m, 2h or 3d'); process.exit(1); }
    return Date.now() + Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  }
  return undefined;
}

if (!key) { console.error('No admin key: set CW_ADMIN_KEY or create .cw-admin-key'); process.exit(1); }
if (cmd === 'god') {
  // npm run world:admin -- god <what> [--civ NAME] [--other NAME] [--town NAME] [--text "..."] [--name NAME] [--power 2]
  const body = { what: args[1], civ: opt('civ'), other: opt('other'), town: opt('town'), text: opt('text'), name: opt('name'),
    power: opt('power') ? Number(opt('power')) : undefined, tile: opt('tile') ? Number(opt('tile')) : undefined };
  const res = await fetch(`${base}/api/cw/admin/god`, { method: 'POST', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.status, JSON.stringify(await res.json().catch(() => ({})), null, 2));
  process.exit(0);
}
if (cmd === 'next') {
  const sub = args[1];
  let body = {};
  const num = (k) => (opt(k) !== undefined ? Number(opt(k)) : undefined);
  if (sub === 'open') body = { seeds: opt('seeds') ? opt('seeds').split(',').map(Number) : undefined, civs: num('civs'), simV: num('sim'), fill: num('fill') };
  else if (sub === 'set') body = { civs: num('civs'), fill: num('fill'), simV: num('sim') };
  else if (sub === 'close') body = { pick: opt('pick') ? Number(opt('pick')) - 1 : undefined, at: startTime() };
  else if (sub === 'schedule') {
    const at = startTime();
    if (at === undefined) { console.error('schedule needs --at "YYYY-MM-DD HH:MM" or --in 2h'); process.exit(1); }
    body = { at };
  } else if (sub === 'unschedule') body = { at: null };
  else if (sub !== 'cancel' && sub !== 'set') { console.error('usage: next open | set | close | schedule --at ... | unschedule | cancel'); process.exit(1); }
  const path = sub === 'unschedule' ? 'schedule' : sub;
  const res = await fetch(`${base}/api/cw/admin/next/${path}`, { method: 'POST', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (out.startAt) out.startsAtLocal = new Date(out.startAt).toString();
  console.log(res.status, JSON.stringify(out, null, 2));
  process.exit(0);
}
if (cmd === 'wipe' && !flag('confirm')) { console.error('A wipe ends this world for everyone. Re-run with --confirm.'); process.exit(1); }
if (cmd !== 'status' && cmd !== 'wipe') { console.error('usage: status | wipe --confirm [--seed N] [--civs N] | next ... | god ... [--local]'); process.exit(1); }

const body = cmd === 'wipe' ? JSON.stringify({ seed: opt('seed') ? Number(opt('seed')) : undefined, civs: opt('civs') ? Number(opt('civs')) : undefined }) : undefined;
const res = await fetch(`${base}/api/cw/admin/${cmd}`, { method: cmd === 'wipe' ? 'POST' : 'GET', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body });
console.log(res.status, JSON.stringify(await res.json().catch(() => ({})), null, 2));
