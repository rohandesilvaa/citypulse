// Tiny WebAudio sound kit - no audio files needed.
export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, start, dur, { type = 'sine', gain = 1, slide = 0 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  ring() {
    for (let k = 0; k < 2; k++) {
      this.tone(1046, k * 0.22, 0.16, { gain: 0.5 });
      this.tone(1318, k * 0.22, 0.16, { gain: 0.35 });
    }
  }
  thinking() { this.tone(660, 0, 0.08, { type: 'triangle', gain: 0.3 }); this.tone(990, 0.07, 0.1, { type: 'triangle', gain: 0.25 }); }
  decision() { this.tone(520, 0, 0.1, { type: 'triangle', gain: 0.5 }); this.tone(780, 0.08, 0.14, { type: 'triangle', gain: 0.45 }); }
  dispatch() { this.tone(700, 0, 0.35, { type: 'sawtooth', gain: 0.12, slide: 1.6 }); this.tone(1100, 0.35, 0.35, { type: 'sawtooth', gain: 0.1, slide: 0.65 }); }
  success() { [784, 988, 1318].forEach((f, i) => this.tone(f, i * 0.09, 0.22, { gain: 0.4 })); }
  fail() { this.tone(220, 0, 0.32, { type: 'square', gain: 0.18, slide: 0.7 }); this.tone(165, 0.18, 0.4, { type: 'square', gain: 0.15, slide: 0.7 }); }
  soft() { this.tone(440, 0, 0.12, { type: 'triangle', gain: 0.25 }); }
}
