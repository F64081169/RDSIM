// Tiny synthesised sound effects (no audio assets).
let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(freq, dur, { type = 'sine', vol = 0.5, delay = 0, slide = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const sfx = {
  click: () => tone(1800, 0.03, { type: 'square', vol: 0.12 }),
  key: () => tone(900 + Math.random() * 400, 0.025, { type: 'square', vol: 0.06 }),
  open: () => {
    tone(520, 0.08, { type: 'triangle', vol: 0.3 });
    tone(780, 0.1, { type: 'triangle', vol: 0.3, delay: 0.07 });
  },
  close: () => tone(600, 0.1, { type: 'triangle', vol: 0.25, slide: -250 }),
  ok: () => {
    tone(660, 0.12, { type: 'triangle', vol: 0.4 });
    tone(880, 0.12, { type: 'triangle', vol: 0.4, delay: 0.1 });
    tone(1320, 0.25, { type: 'triangle', vol: 0.35, delay: 0.2 });
  },
  bad: () => {
    tone(220, 0.18, { type: 'sawtooth', vol: 0.25 });
    tone(160, 0.25, { type: 'sawtooth', vol: 0.25, delay: 0.15 });
  },
  toast: () => tone(1200, 0.07, { type: 'sine', vol: 0.2 }),
  alarm: () => {
    for (let i = 0; i < 4; i++) {
      tone(880, 0.22, { type: 'square', vol: 0.18, delay: i * 0.5 });
      tone(660, 0.22, { type: 'square', vol: 0.18, delay: i * 0.5 + 0.25 });
    }
  },
  coffee: () => {
    for (let i = 0; i < 10; i++) tone(200 + Math.random() * 300, 0.06, { type: 'sawtooth', vol: 0.05, delay: i * 0.05 });
    tone(1046, 0.2, { type: 'sine', vol: 0.3, delay: 0.6 });
  },
  ship: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.35, delay: i * 0.12 })),
  fail: () => [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', vol: 0.2, delay: i * 0.2 })),
  step: () => tone(90 + Math.random() * 30, 0.05, { type: 'sine', vol: 0.08 }),
};
