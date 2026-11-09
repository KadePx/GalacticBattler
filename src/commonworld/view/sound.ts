// Small synthesized sounds (no audio files): a soft chime for news, a rising call when the people
// await a sign, a tap when something is sent. Browsers only allow audio after the visitor has
// clicked or tapped, so the audio context starts on the first gesture. Remembered per browser.

type Cue = 'send' | 'note' | 'omen' | 'arrive';

const NOTES: Record<Cue, [number, number, number][]> = {
  // [frequency Hz, start s, length s]
  send: [[880, 0, 0.12]],
  note: [[660, 0, 0.35], [990, 0.12, 0.45]],
  omen: [[392, 0, 0.6], [523, 0.18, 0.6], [784, 0.36, 0.9]],
  arrive: [[523, 0, 0.5], [659, 0.15, 0.5], [784, 0.3, 0.5], [1046, 0.45, 0.9]],
};

class Sound {
  private ctx: AudioContext | null = null;
  on = true;

  constructor() {
    try { this.on = localStorage.getItem('cw.sound') !== '0'; } catch { /* private mode */ }
    const wake = () => {
      if (!this.ctx && this.on) {
        try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
      }
      void this.ctx?.resume();
    };
    addEventListener('pointerdown', wake, { passive: true });
    addEventListener('keydown', wake);
  }

  toggle(): boolean {
    this.on = !this.on;
    try { localStorage.setItem('cw.sound', this.on ? '1' : '0'); } catch { /* private mode */ }
    if (this.on) this.play('send');
    return this.on;
  }

  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 0.12;
    out.connect(ctx.destination);
    for (const [f, at, len] of NOTES[cue]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(1, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
      // A quiet octave above gives it a bell-like shimmer.
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.value = f * 2.01;
      g2.gain.setValueAtTime(0, t0 + at);
      g2.gain.linearRampToValueAtTime(0.25, t0 + at + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.001, t0 + at + len * 0.6);
      o2.connect(g2).connect(out);
      o2.start(t0 + at);
      o2.stop(t0 + at + len);
    }
  }
}

export const sound = new Sound();
