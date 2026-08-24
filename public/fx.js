// Celebration effects: confetti and synthesized sound. Everything is generated
// in the browser — no audio files, no libraries — so it works offline and
// costs nothing to load.

let audioCtx = null;
let muted = localStorage.getItem('seatdraft.muted') === '1';

// Browsers only allow sound after a user gesture; the host clicks plenty of
// buttons, so arm the context on the first one.
export function armAudio() {
  const arm = () => {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  };
  window.addEventListener('pointerdown', arm, { capture: true });
  window.addEventListener('keydown', arm, { capture: true });
}

export function setMuted(value) {
  muted = value;
  localStorage.setItem('seatdraft.muted', value ? '1' : '0');
}
export const isMuted = () => muted;

function tone(freq, start, duration, { type = 'sine', gain = 0.12 } = {}) {
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function withAudio(fn) {
  if (muted || !audioCtx || audioCtx.state !== 'running') return;
  try { fn(audioCtx.currentTime); } catch { /* effects must never break the game */ }
}

// A bright two-note "ding" for a claimed seat.
export function playPick() {
  countFx('pick');
  withAudio(t => {
    tone(660, t, 0.18);
    tone(990, t + 0.09, 0.28);
  });
}

// A soft low blip for an auto-assigned seat — audible, but not a celebration.
export function playAuto() {
  countFx('auto');
  withAudio(t => tone(330, t, 0.15, { type: 'triangle', gain: 0.07 }));
}

// A little rising arpeggio when the final map lands.
export function playFanfare() {
  countFx('fanfare');
  withAudio(t => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.35, { gain: 0.11 }));
    tone(262, t, 0.8, { type: 'triangle', gain: 0.05 });
  });
}

// A quiet pop for the phone when your own seat is confirmed.
export function playPop() {
  countFx('pop');
  withAudio(t => tone(880, t, 0.12, { gain: 0.1 }));
  try { navigator.vibrate?.(60); } catch { /* not supported */ }
}

/* ----------------------------------------------------------------- confetti */

const COLORS = ['#4d9dff', '#3ddc97', '#ffb454', '#ff6b6b', '#b9a9e0', '#eef2f8'];
let canvas = null, ctx2d = null, particles = [], rafId = null;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:200';
  document.body.appendChild(canvas);
  ctx2d = canvas.getContext('2d');
  const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  size();
  addEventListener('resize', size);
}

/** Burst confetti. origin is in viewport fractions, e.g. {x:.5, y:.35}. */
export function confetti({ count = 90, origin = { x: 0.5, y: 0.4 }, spread = 1 } = {}) {
  countFx('confetti');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ensureCanvas();
  const ox = origin.x * canvas.width, oy = origin.y * canvas.height;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
    const speed = 6 + Math.random() * 9;
    particles.push({
      x: ox, y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 6,
      h: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 90 + Math.random() * 50
    });
  }
  if (!rafId) rafId = requestAnimationFrame(step);
}

function step() {
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 30);
  for (const p of particles) {
    p.vy += 0.22;                       // gravity
    p.vx *= 0.99;
    p.x += p.vx; p.y += p.vy;
    p.rot += p.vr;
    p.life--;
    ctx2d.save();
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate(p.rot);
    ctx2d.globalAlpha = Math.min(1, p.life / 40);
    ctx2d.fillStyle = p.color;
    ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx2d.restore();
  }
  rafId = particles.length ? requestAnimationFrame(step) : null;
  if (!rafId) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

// Test hook: browsers in CI have no ears, so tests count effect triggers.
function countFx(kind) {
  const c = (window.__fx ??= {});
  c[kind] = (c[kind] || 0) + 1;
}
