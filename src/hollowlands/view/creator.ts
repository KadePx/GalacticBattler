// The character creator: a full-screen overlay where a player makes one colonist, step by
// step, with a live portrait and the points budget always in view. The rules are the sim's
// (sim/create.ts): this file only collects choices and shows what checkSpec says about them.
// It never touches a colony; when the player is done it hands the finished spec to main.ts.

import { BUDGET, FREE_SKILL, GOALS, LOOK_RANGE, MAX_TRAITS, MIN_TRAITS, PHOBIAS, SECRETS, baseSkills, checkSpec, type PawnSpec } from '../sim/create';
import { ADULTHOODS, BACKS, CHILDHOODS, type BackDef } from '../sim/data/backstories';
import { PLAYABLE, RACES } from '../sim/data/races';
import { TRAITS, TRAIT_LIST, traitsClash, type TraitDef } from '../sim/data/traits';
import { FAITHS } from '../sim/faith';
import { familyName, givenName } from '../sim/names';
import { Rand } from '../sim/rng';
import { SKILLS, SKILL_NAMES, type RaceK } from '../sim/types';
import { EYES, GARB, HAIR, SKIN, css } from './look';
import { bustSvg } from './portrait';
import { esc } from './words';

// The viewer's own dice: nothing here is part of the deterministic sim.
const rnd = new Rand(Math.floor(Math.random() * 2 ** 31), Date.now() % 2 ** 31);
const pick = <T>(list: readonly T[]): T => list[rnd.int(list.length)];

const STEPS = ['People', 'Looks', 'Name', 'Past', 'Nature', 'Skills', 'Beliefs', 'Arrive'] as const;
const HAIR_NAMES = ['Bald', 'Cropped', 'Fringe', 'Long', 'Bun', 'Crest', 'Ponytail', 'Braids', 'Shaggy', 'Topknot'];
const BODY_NAMES = ['Slight', 'Lean', 'Average', 'Broad', 'Heavy'];
const BEARD_NAMES = ['Clean-shaven', 'Stubble', 'Short beard', 'Long beard', 'Great beard'];
const MARK_NAMES = ['', 'Scar over the eye', 'Scarred cheek', 'Scar across the nose', 'Brow tattoo', 'Chin tattoo', 'Burn mark'];
const DEV_NAMES = ['Lax', 'Observant', 'Devout', 'Zealous'];
const ORIENT_NAMES = ['The other sex', 'Either', 'Their own sex'];
const PAS_NAMES = ['No passion', 'Interested', 'Burning'];
const GROUPS: [TraitDef['group'], string][] = [['temper', 'Temperament'], ['social', 'With other people'], ['body', 'Body'], ['appetite', 'Appetites'], ['mind', 'Mind and work'], ['faith', 'Faith'], ['odd', 'Oddities']];
const WORK_NAMES: Record<string, string> = { farm: 'farm', forage: 'forage', hunt: 'hunt', fish: 'fish', wood: 'cut wood', mine: 'mine', cook: 'cook', build: 'build', craft: 'craft', smith: 'smith', brew: 'brew', heal: 'heal', teach: 'teach', preach: 'preach', guard: 'stand guard', herbs: 'gather herbs' };
const EPITHETS = ['the Bold', 'the Quiet', 'Twice-Burned', 'the Lucky', 'the Grey', 'Longstride', 'the Unwashed', 'Half-Ear', 'the Patient', 'Oakenhand', 'the Younger', 'Far-Walker', 'the Stubborn', 'Barrel-Friend', 'the Lean'];

/** The youngest and oldest a new arrival may be. */
export function ageRange(race: RaceK): [number, number] {
  const R = RACES[race];
  return [R.adult, Math.floor(R.old * 0.9)];
}

const backsFor = (list: BackDef[], race: RaceK): BackDef[] => list.filter((b) => !b.races || b.races.includes(race));
/** No beard to choose: the portrait gives beards to men only, and elves and goblins grow none. */
const beardless = (s: PawnSpec): boolean => s.sex === 0 || s.race === 'elf' || s.race === 'goblin';
/** Traits a past leaves them with, whatever else they pick. */
const forcedTraits = (s: PawnSpec): string[] => [s.bc, s.ba].map((k) => BACKS[k]?.trait ?? '').filter((k) => k);
const faithsOpen = (): string[] => Object.keys(FAITHS).filter((k) => !FAITHS[k].cult);

/** Why a trait cannot be picked right now, or '' if it can. */
function blocked(s: PawnSpec, k: string): string {
  for (const key of [s.bc, s.ba]) {
    const b = BACKS[key];
    if (b?.trait === k) return `Already theirs, from life as a ${b.name.toLowerCase()}`;
    if (b?.trait && traitsClash(k, b.trait)) return `Does not fit a ${b.name.toLowerCase()}`;
  }
  for (const o of s.traits) if (o !== k && traitsClash(k, o)) return `Clashes with ${TRAITS[o]?.name ?? o}`;
  if (!s.traits.includes(k) && s.traits.length >= MAX_TRAITS) return `${MAX_TRAITS} traits at most`;
  return '';
}

/** Keep the spec consistent after a change: no skill past 14, no trait that no longer fits. */
function tidy(s: PawnSpec): void {
  const base = baseSkills(s);
  for (let i = 0; i < s.sk.length; i++) while (s.sk[i] > 0 && base[i] + s.sk[i] > 14) s.sk[i]--;
  const keep: string[] = [];
  for (const k of s.traits) {
    const others = { ...s, traits: keep };
    if (!blocked(others, k)) keep.push(k);
  }
  s.traits = keep;
  if (beardless(s)) s.look.beard = 0;
}

function randomLook(race: RaceK, sex: 0 | 1, age: number): PawnSpec['look'] {
  const noBeard = sex === 0 || race === 'elf' || race === 'goblin';
  return {
    skin: rnd.int(LOOK_RANGE.skin), hair: rnd.int(LOOK_RANGE.hair), hairCol: age > RACES[race].old * 0.8 ? 7 : rnd.int(7),
    body: Math.min(4, Math.floor((rnd.float() + rnd.float()) * 2.5)), face: rnd.int(LOOK_RANGE.face), eyes: rnd.int(LOOK_RANGE.eyes),
    beard: noBeard ? 0 : race === 'dwarf' ? 1 + rnd.int(4) : rnd.int(LOOK_RANGE.beard), marks: rnd.chance(0.15) ? [1 + rnd.int(6)] : [], garb: rnd.int(LOOK_RANGE.garb),
  };
}

/** A complete stranger: every field filled at random, valid and within budget. */
export function randomSpec(race?: RaceK): PawnSpec {
  let last: PawnSpec | null = null;
  for (let tries = 0; tries < 400; tries++) {
    const rc = race ?? pick(PLAYABLE);
    const R = RACES[rc];
    const sex: 0 | 1 = rnd.chance(0.5) ? 0 : 1;
    const [lo, hi] = ageRange(rc);
    const age = Math.round(lo + (hi - lo) * rnd.float() ** 1.6);
    const s: PawnSpec = {
      first: givenName(rnd, rc, sex), fam: familyName(rnd, rc), race: rc, sex, age, look: randomLook(rc, sex, age),
      bc: pick(backsFor(CHILDHOODS, rc)).k, ba: pick(backsFor(ADULTHOODS, rc)).k, traits: [],
      sk: SKILLS.map(() => 0), pas: SKILLS.map(() => 0),
      faith: pick(R.faiths.filter((k) => FAITHS[k] && !FAITHS[k].cult).concat(faithsOpen()[0]).slice(0, 4)), dev: pick([0, 1, 1, 2, 2, 3]),
      goal: pick(Object.keys(GOALS)), orient: rnd.chance(0.82) ? 0 : rnd.chance(0.6) ? 1 : 2,
      phobia: rnd.chance(0.15) ? pick(Object.keys(PHOBIAS)) : undefined, secret: rnd.chance(0.12) ? pick(Object.keys(SECRETS)) : undefined,
    };
    const want = MIN_TRAITS + rnd.int(2);
    for (let guard = 0; s.traits.length < want && guard < 80; guard++) {
      const t = pick(TRAIT_LIST);
      if (!s.traits.includes(t.k) && !blocked(s, t.k)) s.traits.push(t.k);
    }
    // the free skill points go mostly to what they are already good at
    const base = baseSkills(s);
    for (let n = 0, guard = 0; n < FREE_SKILL && guard < 200; guard++) {
      const i = rnd.int(SKILLS.length);
      if (s.sk[i] >= 4 || base[i] + s.sk[i] >= 14 || rnd.float() * 10 > base[i] + 2) continue;
      s.sk[i]++;
      n++;
    }
    const best = SKILLS.map((_, i) => i).sort((a, b) => base[b] + s.sk[b] - (base[a] + s.sk[a]));
    const pasN = 2 + rnd.int(2);
    for (let k = 0; k < pasN; k++) s.pas[best[k]] = k === 0 && rnd.chance(0.5) ? 2 : 1;
    last = s;
    if (checkSpec(s).ok) return s;
  }
  // Should never get here; if it does, strip the last roll down to something plainly allowed.
  const s = last as PawnSpec;
  s.first = 'Wren';
  s.fam = 'Ashdown';
  s.traits = ['gossip', 'talker'];
  s.bc = 'farmchild';
  s.ba = 'farmer';
  s.sk = SKILLS.map(() => 0);
  s.phobia = undefined;
  s.secret = undefined;
  return s;
}

const fullOf = (s: PawnSpec): string => [s.first || 'Nameless', s.fam, s.epi].filter((x) => x).join(' ');
const face = (s: PawnSpec, size: number, race: RaceK = s.race): string => bustSvg({ race, sex: s.sex, look: race === s.race ? s.look : { ...s.look, beard: 0 } }, s.age, size);

/** "+3 Mining, +1 Animals" for a people's or a backstory's skill bonuses. */
function skillList(sk: Partial<Record<string, number>>): string {
  const out: string[] = [];
  SKILLS.forEach((k, i) => {
    const v = sk[k];
    if (v) out.push(`${v > 0 ? '+' : '−'}${Math.abs(v)} ${SKILL_NAMES[i]}`);
  });
  return out.join(', ');
}

/** A points tag: costs are red, flaws that give points back are green. */
function costTag(pts: number): string {
  if (!pts) return '<span class="cost">free</span>';
  return pts > 0 ? `<span class="cost pay">costs ${pts}</span>` : `<span class="cost gain">gives ${-pts}</span>`;
}

export interface CreatorHooks {
  /** The player pressed "Send them in" with a spec that passes checkSpec. */
  send(spec: PawnSpec): void;
}

export class Creator {
  private el: HTMLElement;
  private spec: PawnSpec = randomSpec();
  private step = 0;
  /** Fields the player set by hand, which a change of people must not overwrite. */
  private touched = new Set<string>();
  private fresh = false;
  private colonyName = 'the colony';
  /** a line about room in the colony (HTML), and whether it is full */
  private room = '';
  private full = false;

  constructor(private hooks: CreatorHooks) {
    const el = (this.el = document.createElement('div'));
    el.id = 'creator';
    el.className = 'hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Make your colonist');
    el.innerHTML = '<div class="cr"><aside class="crsum"></aside><section class="crmain"><header class="crhead"><div class="crt">Make your colonist</div><button class="icon" data-cr="close" title="Close" aria-label="Close">&times;</button></header><nav class="crrail"></nav><div class="crbody"></div><footer class="crfoot"></footer></section></div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('input', (e) => this.input(e));
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Show the creator. After a colonist has been sent, the next visit starts from a new stranger. */
  open(colonyName?: string, room = '', full = false): void {
    if (colonyName) this.colonyName = colonyName;
    this.room = room;
    this.full = full;
    if (this.fresh) {
      this.fresh = false;
      this.spec = randomSpec();
      this.touched.clear();
      this.step = 0;
    }
    this.el.classList.remove('hidden');
    this.draw(true);
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  private part(cls: string): HTMLElement {
    return this.el.querySelector('.' + cls) as HTMLElement;
  }

  // ---------- Input ----------

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-cr]');
    if (!t || (t as HTMLButtonElement).disabled || t.classList.contains('off')) return;
    const s = this.spec;
    const v = t.dataset.v ?? '';
    const n = Number(v);
    let top = false;
    switch (t.dataset.cr) {
      case 'close': this.close(); return;
      case 'step': this.step = Math.max(0, Math.min(STEPS.length - 1, n)); top = true; break;
      case 'next': this.step = Math.min(STEPS.length - 1, this.step + 1); top = true; break;
      case 'back': this.step = Math.max(0, this.step - 1); top = true; break;
      case 'roll': this.spec = randomSpec(); this.touched.clear(); this.step = STEPS.length - 1; top = true; break;
      case 'send': this.send(); return;
      case 'race': this.setRace(v as RaceK); break;
      case 'sex':
        s.sex = n ? 1 : 0;
        if (!this.touched.has('first')) s.first = givenName(rnd, s.race, s.sex);
        break;
      case 'look': {
        const k = t.dataset.k as keyof typeof LOOK_RANGE;
        const size = LOOK_RANGE[k];
        if (size) s.look[k] = v === '+' ? (s.look[k] + 1) % size : v === '-' ? (s.look[k] + size - 1) % size : Math.max(0, Math.min(size - 1, n));
        break;
      }
      case 'mark':
        if (s.look.marks.includes(n)) s.look.marks = s.look.marks.filter((m) => m !== n);
        else if (s.look.marks.length < 3) s.look.marks.push(n);
        break;
      case 'randlook': s.look = randomLook(s.race, s.sex, s.age); break;
      case 'suggest':
        if (v === 'first') s.first = givenName(rnd, s.race, s.sex);
        else if (v === 'fam') s.fam = familyName(rnd, s.race);
        else s.epi = pick(EPITHETS.filter((x) => x !== s.epi));
        this.touched.add(v);
        break;
      case 'bc': s.bc = v; break;
      case 'ba': s.ba = v; break;
      case 'trait':
        if (s.traits.includes(v)) s.traits = s.traits.filter((k) => k !== v);
        else if (!blocked(s, v)) s.traits.push(v);
        break;
      case 'sk': {
        const i = Number(t.dataset.k);
        const base = baseSkills(s);
        if (v === '+' && s.sk[i] < 4 && base[i] + s.sk[i] < 14) s.sk[i]++;
        else if (v === '-' && s.sk[i] > 0) s.sk[i]--;
        break;
      }
      case 'pas': {
        // none -> interested -> burning -> none, skipping what the limits do not allow
        const cur = s.pas[n];
        const count = s.pas.filter((x) => x > 0).length;
        const burning = s.pas.includes(2);
        s.pas[n] = cur === 0 ? (count < 3 ? 1 : 0) : cur === 1 ? (burning ? 0 : 2) : 0;
        break;
      }
      case 'faith': s.faith = v; this.touched.add('faith'); break;
      case 'dev': s.dev = Math.max(0, Math.min(3, n)); break;
      case 'goal': s.goal = v; break;
      case 'orient': s.orient = n === 1 ? 1 : n === 2 ? 2 : 0; break;
      case 'phobia': s.phobia = v || undefined; break;
      case 'secret': s.secret = v || undefined; break;
      default: return;
    }
    tidy(this.spec);
    this.draw(top);
  }

  /** Typing and dragging: update the spec and the summary, but leave the control itself alone. */
  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    const f = t.dataset.f;
    if (!f) return;
    const s = this.spec;
    if (f === 'age') {
      s.age = Number(t.value);
      tidy(s);
      const out = this.el.querySelector('[data-out="age"]');
      if (out) out.textContent = this.ageLine();
    } else {
      const v = t.value.trim();
      if (f === 'first') s.first = v;
      else if (f === 'fam') s.fam = v;
      else if (f === 'epi') s.epi = v || undefined;
      else if (f === 'heirloom') s.heirloom = v || undefined;
      this.touched.add(f);
      const out = this.el.querySelector('[data-out="name"]');
      if (out) out.textContent = fullOf(s);
    }
    this.drawSummary();
    this.drawFoot();
  }

  private setRace(race: RaceK): void {
    const s = this.spec;
    if (!RACES[race] || race === s.race) return;
    // keep them at the same point in life: an old dwarf becomes an old elf, not a child
    const [lo, hi] = ageRange(s.race);
    const f = hi > lo ? (s.age - lo) / (hi - lo) : 0;
    s.race = race;
    const [a, b] = ageRange(race);
    s.age = Math.round(a + Math.max(0, Math.min(1, f)) * (b - a));
    if (!backsFor(CHILDHOODS, race).some((x) => x.k === s.bc)) s.bc = pick(backsFor(CHILDHOODS, race)).k;
    if (!backsFor(ADULTHOODS, race).some((x) => x.k === s.ba)) s.ba = pick(backsFor(ADULTHOODS, race)).k;
    if (!this.touched.has('first')) s.first = givenName(rnd, race, s.sex);
    if (!this.touched.has('fam')) s.fam = familyName(rnd, race);
    if (!this.touched.has('faith')) s.faith = RACES[race].faiths.find((k) => FAITHS[k] && !FAITHS[k].cult) ?? s.faith;
  }

  private send(): void {
    const s = this.spec;
    const spec: PawnSpec = { ...s, look: { ...s.look, marks: s.look.marks.slice() }, traits: s.traits.slice(), sk: s.sk.slice(), pas: s.pas.slice(), epi: s.epi || undefined, heirloom: s.heirloom || undefined };
    if (!checkSpec(spec).ok) { this.step = STEPS.length - 1; this.draw(true); return; }
    this.fresh = true;
    this.close();
    this.hooks.send(spec);
  }

  // ---------- Drawing ----------

  private draw(top: boolean): void {
    const body = this.part('crbody');
    const y = body.scrollTop;
    this.part('crrail').innerHTML = STEPS.map((name, i) => `<button class="${i === this.step ? 'on' : i < this.step ? 'done' : ''}" data-cr="step" data-v="${i}">${i + 1}. ${name}</button>`).join('');
    body.innerHTML = [this.people, this.looks, this.naming, this.past, this.nature, this.skills, this.beliefs, this.arrive][this.step].call(this);
    body.scrollTop = top ? 0 : y;
    this.drawSummary();
    this.drawFoot();
  }

  private drawFoot(): void {
    const last = this.step === STEPS.length - 1;
    const ok = checkSpec(this.spec).ok;
    this.part('crfoot').innerHTML =
      `<button class="btn" data-cr="back"${this.step === 0 ? ' disabled' : ''}>Back</button><span class="hint">Step ${this.step + 1} of ${STEPS.length}</span>` +
      (last ? `<button class="btn go" data-cr="send"${ok ? '' : ' disabled'}>Send them in</button>` : '<button class="btn go" data-cr="next">Next</button>');
    const send = this.el.querySelector<HTMLButtonElement>('.crbody [data-cr="send"]');
    if (send) send.disabled = !ok;
  }

  /** The side summary: who they are so far and what the budget looks like. */
  private drawSummary(): void {
    const s = this.spec;
    const chk = checkSpec(s);
    const over = chk.spent > chk.budget;
    const left = chk.budget - chk.spent;
    const extra = Math.max(0, Math.ceil((chk.skillSpent - FREE_SKILL) / 3));
    let h = `<div class="who">${face(s, 180)}<div class="id"><div class="nm">${esc(fullOf(s))}</div><div class="sub">${esc(RACES[s.race].name)} · ${s.sex ? 'Male' : 'Female'} · ${s.age} years</div></div></div>`;
    // flaws give points back, so what is left can be more than the starting budget
    const avail = Math.max(chk.budget, chk.budget - Math.min(0, chk.spent));
    const bonus = chk.spent < 0 ? -chk.spent : 0;
    h += `<div class="meters"><div class="meter${over ? ' over' : ''}"><b>${over ? `${-left} ${-left === 1 ? 'point' : 'points'} over` : `${left} ${left === 1 ? 'point' : 'points'} left`}</b><span>${over ? 'drop a strength or take a flaw' : bonus ? `${chk.budget} to start, +${bonus} from flaws` : `of ${chk.budget}: strengths cost, flaws give back`}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, (left / avail) * 100)).toFixed(0)}%;background:${over ? 'var(--bad)' : 'var(--accent)'}"></i></div></div>`;
    h += `<div class="meter"><b>${chk.skillSpent} of ${FREE_SKILL} skill points</b><span>${extra ? `the extra cost ${extra}` : chk.skillSpent < FREE_SKILL ? `${FREE_SKILL - chk.skillSpent} unused` : 'all used'}</span></div></div>`;
    const traits = [...forcedTraits(s), ...s.traits.filter((k) => !forcedTraits(s).includes(k))];
    h += `<div class="chips">${traits.map((k) => `<span class="chip">${esc(TRAITS[k]?.name ?? k)}</span>`).join('')}</div>`;
    h += `<button class="state ${chk.ok ? 'ok' : 'bad'}" data-cr="step" data-v="${STEPS.length - 1}">${chk.ok ? 'Ready to send' : `${chk.errors.length} ${chk.errors.length === 1 ? 'thing' : 'things'} to fix`}</button>`;
    this.part('crsum').innerHTML = h;
  }

  private ageLine(): string {
    const s = this.spec;
    const [lo, hi] = ageRange(s.race);
    const f = hi > lo ? (s.age - lo) / (hi - lo) : 0;
    return `${s.age} years: ${f < 0.25 ? 'barely grown' : f < 0.6 ? 'in their prime' : f < 0.85 ? 'getting on' : 'close to old'}`;
  }

  private people(): string {
    const roomNote = this.room ? `<div class="crroom${this.full ? ' full' : ''}">${this.room}</div>` : '';
    const s = this.spec;
    let h = roomNote + `<h2>Who are they?</h2><p class="lead">Six peoples share the Hollow Lands. Choose one, or <button class="btn sm" data-cr="roll">Roll a stranger</button> to have everything picked for you.</p><div class="opts">`;
    for (const k of PLAYABLE) {
      const R = RACES[k];
      h += `<button class="opt race${k === s.race ? ' on' : ''}" data-cr="race" data-v="${k}">${face(s, 56, k)}<div><b>${esc(R.name)}</b><small>${esc(R.blurb)}</small><small class="x">Grown at ${R.adult}, old at ${R.old}, may see ${R.max}. ${esc(skillList(R.sk) || 'No special gifts')}.</small></div></button>`;
    }
    const [lo, hi] = ageRange(s.race);
    h += '</div><h3>Sex</h3><div class="seg fit">' + ['Female', 'Male'].map((name, i) => `<button class="${s.sex === i ? 'on' : ''}" data-cr="sex" data-v="${i}">${name}</button>`).join('') + '</div>';
    h += `<h3>Age <span class="legend" data-out="age">${this.ageLine()}</span></h3><input type="range" min="${lo}" max="${hi}" step="1" value="${s.age}" data-f="age" aria-label="Age" />`;
    h += `<div class="hint">A new arrival must be a grown ${esc(RACES[s.race].name.toLowerCase())}, ${lo} to ${hi}. The young have longer to live and learn; the old arrive knowing more.</div>`;
    return h;
  }

  private looks(): string {
    const s = this.spec;
    const L = s.look;
    const swatches = (k: string, cols: number[]): string => `<div class="sw">${cols.map((col, i) => `<button class="${L[k as keyof typeof LOOK_RANGE] === i ? 'on' : ''}" style="background:${css(col)}" data-cr="look" data-k="${k}" data-v="${i}" aria-label="${k} ${i + 1}"></button>`).join('')}</div>`;
    const stepper = (k: string, label: string): string => `<div class="stepper"><button class="icon" data-cr="look" data-k="${k}" data-v="-" aria-label="Previous">&lsaquo;</button><span>${esc(label)}</span><button class="icon" data-cr="look" data-k="${k}" data-v="+" aria-label="Next">&rsaquo;</button></div>`;
    const row = (label: string, control: string): string => `<div class="field"><span class="l">${label}</span>${control}</div>`;
    const grey = s.age >= RACES[s.race].old * 0.85;
    let h = '<h2>How do they look?</h2><p class="lead">Every choice shows in the portrait and on the map. <button class="btn sm" data-cr="randlook">Randomise</button></p>';
    h += row('Skin', swatches('skin', SKIN[s.race] ?? SKIN.human));
    h += row('Hair', stepper('hair', HAIR_NAMES[L.hair] ?? `Style ${L.hair + 1}`));
    h += row('Hair colour', swatches('hairCol', HAIR) + (grey ? '<div class="hint">At this age their hair has already gone grey.</div>' : ''));
    h += row('Build', stepper('body', BODY_NAMES[L.body] ?? ''));
    h += row('Face', stepper('face', `Face ${L.face + 1} of ${LOOK_RANGE.face}`));
    h += row('Eyes', swatches('eyes', EYES));
    if (!beardless(s)) h += row('Beard', stepper('beard', BEARD_NAMES[L.beard] ?? ''));
    h += row('Clothes', swatches('garb', GARB));
    h += row('Marks', `<div class="chips">${MARK_NAMES.map((name, i) => (i ? `<button class="chip${L.marks.includes(i) ? ' on' : ''}" data-cr="mark" data-v="${i}"${!L.marks.includes(i) && L.marks.length >= 3 ? ' disabled' : ''}>${name}</button>` : '')).join('')}</div>`);
    return h + '<div class="hint">Up to three marks. Life in the colony will add its own.</div>';
  }

  private naming(): string {
    const s = this.spec;
    const field = (f: string, label: string, value: string, max: number, hint: string): string =>
      `<div class="field"><label for="cr-${f}">${label}</label><div class="inrow"><input type="text" id="cr-${f}" data-f="${f}" value="${esc(value)}" maxlength="${max}" placeholder="${hint}" autocomplete="off" spellcheck="false" /><button class="btn" data-cr="suggest" data-v="${f}">Suggest</button></div></div>`;
    let h = `<h2>What are they called?</h2><p class="lead">Suggestions follow the naming of the ${esc(RACES[s.race].plural.toLowerCase())}. Use your own if you like.</p>`;
    h += field('first', 'First name', s.first, 16, '2 to 16 letters');
    h += field('fam', 'Family name', s.fam, 16, '2 to 16 letters');
    h += field('epi', 'Epithet', s.epi ?? '', 24, 'Optional, e.g. the Bold');
    h += `<div class="now"><span>They will be known as</span><b data-out="name">${esc(fullOf(s))}</b></div>`;
    return h;
  }

  private backCard(kind: 'bc' | 'ba', b: BackDef): string {
    const s = this.spec;
    const bits: string[] = [];
    const sk = skillList(b.sk);
    if (sk) bits.push(sk);
    if (b.no?.length) bits.push(`Will not ${b.no.map((w) => WORK_NAMES[w] ?? w).join(' or ')}`);
    if (b.trait) bits.push(`Always ${TRAITS[b.trait]?.name.toLowerCase() ?? b.trait}`);
    return `<button class="opt${s[kind] === b.k ? ' on' : ''}" data-cr="${kind}" data-v="${b.k}"><b>${esc(b.name)}${costTag(b.pts ?? 0)}</b><small>${esc(b.desc)}</small><small class="x">${esc(bits.join(' · '))}</small></button>`;
  }

  private past(): string {
    const s = this.spec;
    let h = '<h2>Where have they been?</h2><p class="lead">A childhood and a grown life before the colony. Each brings skills; some refuse certain work, leave a trait behind, or cost points.</p>';
    h += `<h3>Childhood</h3><div class="opts">${backsFor(CHILDHOODS, s.race).map((b) => this.backCard('bc', b)).join('')}</div>`;
    h += `<h3>Adult life</h3><div class="opts">${backsFor(ADULTHOODS, s.race).map((b) => this.backCard('ba', b)).join('')}</div>`;
    return h;
  }

  private nature(): string {
    const s = this.spec;
    const forced = forcedTraits(s);
    let h = `<h2>What are they like?</h2><p class="lead">Pick ${MIN_TRAITS} to ${MAX_TRAITS} traits. Strengths cost points; flaws give points back. <b>${s.traits.length} chosen.</b></p>`;
    if (forced.length) h += `<div class="note">From their past, whatever you pick: ${forced.map((k) => `<span class="chip on" title="${esc(TRAITS[k]?.desc ?? '')}">${esc(TRAITS[k]?.name ?? k)}</span>`).join(' ')}</div>`;
    for (const [g, label] of GROUPS) {
      h += `<h3>${label}</h3><div class="opts">`;
      for (const t of TRAIT_LIST) {
        if (t.group !== g) continue;
        const on = s.traits.includes(t.k);
        const why = on ? '' : blocked(s, t.k);
        h += `<button class="opt${on ? ' on' : ''}${why ? ' off' : ''}" data-cr="trait" data-v="${t.k}"${why ? ' aria-disabled="true"' : ''}><b>${esc(t.name)}${costTag(t.pts)}</b><small>${esc(t.desc)}</small>${why ? `<small class="x">${esc(why)}.</small>` : ''}</button>`;
      }
      h += '</div>';
    }
    return h;
  }

  private skills(): string {
    const s = this.spec;
    const base = baseSkills(s);
    const chk = checkSpec(s);
    const extra = Math.max(0, Math.ceil((chk.skillSpent - FREE_SKILL) / 3));
    const count = s.pas.filter((x) => x > 0).length;
    let h = `<h2>What can they do?</h2><p class="lead">Their people, past and years give the grey levels. Add up to 4 to any skill: the first ${FREE_SKILL} points are free, then every 3 more cost a budget point. <b>${chk.skillSpent} added${extra ? `, costing ${extra}` : ''}.</b></p>`;
    for (let i = 0; i < SKILLS.length; i++) {
      let pips = '';
      for (let k = 0; k < 14; k++) pips += `<i class="${k < base[i] ? 'b' : k < base[i] + s.sk[i] ? 'a' : ''}"></i>`;
      const canAdd = s.sk[i] < 4 && base[i] + s.sk[i] < 14;
      const p = s.pas[i];
      const canPas = p > 0 || count < 3;
      h += `<div class="skrow"><span>${SKILL_NAMES[i]}</span><div class="pips">${pips}</div><b>${base[i] + s.sk[i]}${s.sk[i] ? `<small> +${s.sk[i]}</small>` : ''}</b>` +
        `<span class="pm"><button class="icon" data-cr="sk" data-k="${i}" data-v="-"${s.sk[i] ? '' : ' disabled'} aria-label="Less ${SKILL_NAMES[i]}">&minus;</button><button class="icon" data-cr="sk" data-k="${i}" data-v="+"${canAdd ? '' : ' disabled'} aria-label="More ${SKILL_NAMES[i]}">+</button></span>` +
        `<button class="chip pasb${p ? ' on' : ''}" data-cr="pas" data-v="${i}"${canPas ? '' : ' disabled'} title="Passion: they learn it faster and enjoy the work">${p === 2 ? '◆◆ ' : p === 1 ? '◆ ' : ''}${PAS_NAMES[p] ?? ''}</button></div>`;
    }
    return h + '<div class="hint">Passions: up to three, and only one can burn. Tap a passion to change it. Someone with a passion learns that skill much faster.</div>';
  }

  private beliefs(): string {
    const s = this.spec;
    const usual = RACES[s.race].faiths[0];
    let h = '<h2>What do they believe, want and fear?</h2><p class="lead">Faith shapes who they get on with. A goal gives them something to chase. Flaws give points back.</p><h3>Faith</h3><div class="opts">';
    for (const k of faithsOpen()) {
      const f = FAITHS[k];
      h += `<button class="opt${s.faith === k ? ' on' : ''}" data-cr="faith" data-v="${k}"><b>${esc(f.name)}</b><small>${esc(f.blurb)}</small>${k === usual ? `<small class="x">The usual faith of ${esc(RACES[s.race].plural.toLowerCase())}.</small>` : ''}</button>`;
    }
    h += '</div><h3>Devotion</h3><div class="seg fit">' + DEV_NAMES.map((name, i) => `<button class="${s.dev === i ? 'on' : ''}" data-cr="dev" data-v="${i}">${name}</button>`).join('') + '</div>';
    h += '<div class="hint">The devout take comfort in prayer and think less of other faiths.</div>';
    h += '<h3>Life goal</h3><div class="chips">' + Object.entries(GOALS).map(([k, name]) => `<button class="chip${s.goal === k ? ' on' : ''}" data-cr="goal" data-v="${k}">${esc(name)}</button>`).join('') + '</div>';
    h += '<h3>Drawn to</h3><div class="seg fit">' + ORIENT_NAMES.map((name, i) => `<button class="${s.orient === i ? 'on' : ''}" data-cr="orient" data-v="${i}">${name}</button>`).join('') + '</div>';
    h += `<h3>A fear <span class="legend">optional, gives 1 point</span></h3><div class="chips"><button class="chip${s.phobia ? '' : ' on'}" data-cr="phobia" data-v="">None</button>` + Object.entries(PHOBIAS).map(([k, name]) => `<button class="chip${s.phobia === k ? ' on' : ''}" data-cr="phobia" data-v="${k}">${esc(name)}</button>`).join('') + '</div>';
    h += `<h3>A secret <span class="legend">optional, gives 1 point</span></h3><div class="opts"><button class="opt${s.secret ? '' : ' on'}" data-cr="secret" data-v=""><b>Nothing to hide</b><small>What you see is what there is.</small></button>`;
    for (const [k, d] of Object.entries(SECRETS)) h += `<button class="opt${s.secret === k ? ' on' : ''}" data-cr="secret" data-v="${k}"><b>${esc(d.name)}${costTag(-1)}</b><small>${esc(d.blurb)}</small></button>`;
    h += '</div><div class="hint">Nobody in the colony knows a secret at first. It can come out, and it will not be forgiven lightly.</div>';
    h += `<h3>A keepsake <span class="legend">optional</span></h3><input type="text" data-f="heirloom" value="${esc(s.heirloom ?? '')}" maxlength="32" placeholder="Something they carry, e.g. a mother's ring" autocomplete="off" />`;
    return h;
  }

  private arrive(): string {
    const s = this.spec;
    const chk = checkSpec(s);
    const base = baseSkills(s);
    const top = SKILLS.map((_, i) => i).sort((a, b) => base[b] + s.sk[b] - (base[a] + s.sk[a]) || s.pas[b] - s.pas[a]).slice(0, 5);
    const traits = [...new Set([...forcedTraits(s), ...s.traits])];
    let h = `<h2>Ready for the road?</h2><p class="lead">Once they walk in, they live their own life. You watch, and nudge a little.</p>`;
    h += chk.ok
      ? '<div class="okay">Everything is in order.</div>'
      : `<div class="errs">${chk.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>`;
    h += `<div class="head">${face(s, 96)}<div class="hd"><div class="nm">${esc(fullOf(s))}</div><div class="sub">${esc(RACES[s.race].name)} · ${s.sex ? 'Male' : 'Female'} · ${s.age} years</div><div class="sub">${esc(FAITHS[s.faith]?.name ?? 'No faith')}, ${DEV_NAMES[s.dev]?.toLowerCase() ?? ''}</div></div></div>`;
    h += `<h3>Past</h3><div class="note"><b>${esc(BACKS[s.bc]?.name ?? 'No childhood')}</b>, then <b>${esc(BACKS[s.ba]?.name.toLowerCase() ?? 'nothing yet')}</b>.</div>`;
    h += `<h3>Nature</h3><div class="chips">${traits.map((k) => `<span class="chip" title="${esc(TRAITS[k]?.desc ?? '')}">${esc(TRAITS[k]?.name ?? k)}</span>`).join('') || '<span class="hint">No traits yet.</span>'}</div>`;
    h += '<h3>Best skills</h3>' + top.map((i) => `<div class="th"><span>${SKILL_NAMES[i]}${s.pas[i] ? ` <span class="pas">${s.pas[i] === 2 ? '◆◆' : '◆'}</span>` : ''}</span><b>${base[i] + s.sk[i]}</b></div>`).join('');
    h += '<h3>Heart</h3>';
    h += `<div class="th"><span>Wants to</span><b>${esc((GOALS[s.goal] ?? 'find a purpose').toLowerCase())}</b></div><div class="th"><span>Drawn to</span><b>${ORIENT_NAMES[s.orient].toLowerCase()}</b></div>`;
    if (s.phobia) h += `<div class="th"><span>Afraid of</span><b>${esc((PHOBIAS[s.phobia] ?? s.phobia).toLowerCase())}</b></div>`;
    if (s.secret) h += `<div class="th"><span>Hiding</span><b>${esc(SECRETS[s.secret]?.name ?? s.secret)}</b></div>`;
    if (s.heirloom) h += `<div class="th"><span>Carries</span><b>${esc(s.heirloom)}</b></div>`;
    h += `<div class="th"><span>Points left</span><b class="${chk.spent > BUDGET ? 'down' : ''}">${BUDGET - chk.spent}</b></div>`;
    if (this.room) h += `<div class="hint">${this.room}</div>`;
    h += `<div class="sendrow"><button class="btn go big" data-cr="send"${chk.ok && !this.full ? '' : ' disabled'}>Send them in to ${esc(this.colonyName)}</button></div>`;
    return h;
  }
}
