// The FEEDBACK form: a plain HTML card over the game (a real text box types and pastes
// properly on phones, which a canvas can't). Reports go to /api/feedback.

import { getPilot, SIM_VERSION } from './net';
import { getProfile, pilotRank } from './profile';
import { getRun } from './storage';

type Kind = 'bug' | 'idea' | 'other';
const KINDS: [Kind, string][] = [['bug', 'BUG'], ['idea', 'IDEA'], ['other', 'OTHER']];
const MAX_TEXT = 1000;

/** What the game knows that helps with a report: version, pilot, run and device. */
function context(): string {
  const run = getRun();
  const mode = run ? (run.daily ? 'daily' : run.gauntlet ? 'gauntlet' : run.endless ? 'endless' : 'normal') : null;
  const parts = [
    `v ${SIM_VERSION}`,
    `rank ${pilotRank(getProfile().xp)}`,
    run && run.phase !== 'over' ? `run ${mode} r${run.round} ${run.wins}W ${run.lives}hull ${run.cmd ?? ''} ${run.phase}` : 'no run',
    run?.mods?.length ? `mods ${run.mods.join(',')}` : '',
    `screen ${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    navigator.userAgent.slice(0, 200),
  ];
  return parts.filter(Boolean).join(' | ');
}

const CSS = `
.fb-back{position:fixed;inset:0;z-index:1000;background:rgba(5,6,15,.8);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
.fb-card{width:min(440px,100%);max-height:100%;overflow:auto;background:#0f1430;border:2px solid #3a4a8a;padding:14px;box-sizing:border-box;
  font-family:"Press Start 2P",monospace;color:#e8ecff;font-size:10px;line-height:1.6}
.fb-card h2{margin:0 0 10px;font-size:12px;color:#ffd166;font-weight:normal}
.fb-kinds{display:flex;gap:6px;margin-bottom:10px}
.fb-kinds button,.fb-row button{flex:1;font:inherit;padding:8px 4px;background:#0b1026;color:#9aa6d8;border:1px solid #3a4a8a;cursor:pointer}
.fb-kinds button.on{background:#3a2a10;color:#ffd166;border-color:#ffd166}
.fb-card textarea{width:100%;box-sizing:border-box;height:120px;resize:vertical;font:inherit;font-family:system-ui,sans-serif;font-size:16px;
  background:#05060f;color:#e8ecff;border:1px solid #3a4a8a;padding:8px}
.fb-note{color:#6a76a0;margin:6px 0 10px;font-size:8px}
.fb-msg{min-height:14px;margin-bottom:8px}
.fb-row{display:flex;gap:8px}
.fb-row .send{background:#3a2a10;color:#ffd166;border-color:#ffd166}
.fb-row button:disabled{opacity:.5;cursor:default}`;

let open = false;

/** Show the feedback form. Safe to call twice (the second call does nothing). */
export function openFeedback() {
  if (open) return;
  open = true;
  if (!document.getElementById('fb-style')) {
    const st = document.createElement('style');
    st.id = 'fb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let kind: Kind = 'bug';
  const back = document.createElement('div');
  back.className = 'fb-back';
  back.innerHTML = `
    <div class="fb-card" role="dialog" aria-label="Send feedback">
      <h2>FEEDBACK</h2>
      <div class="fb-kinds">${KINDS.map(([k, l]) => `<button type="button" data-k="${k}">${l}</button>`).join('')}</div>
      <textarea maxlength="${MAX_TEXT}" placeholder="What happened, or what would you like to see?"></textarea>
      <div class="fb-note">Sent with your callsign, the game version, your current run and your device type.</div>
      <div class="fb-msg"></div>
      <div class="fb-row"><button type="button" class="cancel">CLOSE</button><button type="button" class="send">SEND</button></div>
    </div>`;
  // In fullscreen only the fullscreen element is visible, so the card has to live inside it.
  (document.fullscreenElement ?? document.body).appendChild(back);

  const q = <T extends HTMLElement>(sel: string) => back.querySelector(sel) as T;
  const area = q<HTMLTextAreaElement>('textarea');
  const msg = q<HTMLDivElement>('.fb-msg');
  const send = q<HTMLButtonElement>('.send');
  const say = (text: string, color = '#e8ecff') => { msg.textContent = text; msg.style.color = color; };
  const kindButtons = Array.from(back.querySelectorAll<HTMLButtonElement>('.fb-kinds button'));
  const pickKind = (k: Kind) => {
    kind = k;
    kindButtons.forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    area.placeholder = k === 'bug' ? 'What happened? What were you doing just before?'
      : k === 'idea' ? 'What would you like to see in the game?' : 'Anything else on your mind?';
  };
  kindButtons.forEach((b) => b.addEventListener('click', () => pickKind(b.dataset.k as Kind)));
  pickKind('bug');

  const close = () => {
    open = false;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  // Keys typed here belong to the text box, not the game.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  q<HTMLButtonElement>('.cancel').addEventListener('click', close);

  send.addEventListener('click', async () => {
    const text = area.value.trim();
    if (text.length < 3) return say('Write a little more first.', '#ff6b6b');
    send.disabled = true;
    say('Sending...', '#9aa6d8');
    const pilot = getPilot();
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, text, player: pilot.id, name: pilot.name, context: context() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'server unavailable');
      area.value = '';
      say('Sent. Thanks for helping!', '#ffd166');
      setTimeout(() => { if (open) close(); }, 1400);
    } catch (e) {
      send.disabled = false;
      say(`Couldn't send: ${e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'check your connection'}`, '#ff6b6b');
    }
  });
  setTimeout(() => area.focus(), 50);
}
