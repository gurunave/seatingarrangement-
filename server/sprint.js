// The maths sprint: ten questions, same set and same order for everyone.
// Questions and answers live only on the server — a phone is told the options
// but never which one is right, so the answer key can't be read off a device.

const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const QUESTION_COUNT = 10;
// Overridable so tests can drive the auto-end path without waiting 90 seconds.
export const SPRINT_SECONDS = Number(process.env.SPRINT_SECONDS) || 90;

// Three difficulty bands. Everything here stays mental-arithmetic: no
// long division, nothing that wants a pen.
const BANDS = {
  easy: [
    () => { const a = rand(11, 49), b = rand(3, 9); return [`${a} + ${b}`, a + b]; },
    () => { const a = rand(20, 60), b = rand(3, 9); return [`${a} − ${b}`, a - b]; },
    () => { const a = rand(3, 9), b = rand(3, 9); return [`${a} × ${b}`, a * b]; }
  ],
  medium: [
    () => { const a = rand(23, 78), b = rand(14, 49); return [`${a} + ${b}`, a + b]; },
    () => { const a = rand(50, 95), b = rand(13, 44); return [`${a} − ${b}`, a - b]; },
    () => { const a = rand(12, 29), b = rand(3, 8); return [`${a} × ${b}`, a * b]; },
    () => { const b = rand(3, 9), q = rand(4, 12); return [`${b * q} ÷ ${b}`, q]; }
  ],
  hard: [
    () => { const a = rand(14, 39), b = rand(11, 12); return [`${a} × ${b}`, a * b]; },
    () => { const a = rand(120, 480), b = rand(35, 95); return [`${a} − ${b}`, a - b]; },
    () => { const a = rand(15, 45), b = rand(6, 9); return [`${a} × ${b}`, a * b]; },
    () => { const a = rand(105, 380), b = rand(45, 130); return [`${a} + ${b}`, a + b]; }
  ]
};

const SHAPE = ['easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard', 'hard'];

export function generateQuestions(count = QUESTION_COUNT) {
  const questions = [];
  const seenText = new Set();
  let guard = 0;

  while (questions.length < count && guard++ < 500) {
    const band = SHAPE[questions.length] || 'hard';
    const [text, answer] = pick(BANDS[band])();
    if (seenText.has(text)) continue;
    seenText.add(text);
    questions.push({ text, answer, options: buildOptions(answer) });
  }
  return questions;
}

// Distractors are near-misses — the errors you'd actually make in your head —
// so the right answer never stands out as the only plausible number.
function buildOptions(answer) {
  const candidates = [
    answer + 1, answer - 1, answer + 2, answer - 2,
    answer + 10, answer - 10, answer + 9, answer - 9,
    answer + 20, answer - 20, swapDigits(answer)
  ];

  const wrong = [];
  for (const c of shuffle(candidates)) {
    if (c === answer || wrong.includes(c) || !plausible(c, answer)) continue;
    wrong.push(c);
    if (wrong.length === 3) break;
  }
  // Pathological cases (tiny answers) can starve the candidate list.
  let pad = 1;
  while (wrong.length < 3) {
    const c = answer + (pad % 2 ? pad : -pad);
    pad++;
    if (c > 0 && c !== answer && !wrong.includes(c)) wrong.push(c);
  }
  return shuffle([answer, ...wrong]);
}

// A distractor only does its job if it's a number you might actually land on.
// Digit-swapping 30 gives 3, which nobody would pick and which makes the right
// answer obvious by elimination.
function plausible(c, answer) {
  if (c <= 0) return false;
  if (answer < 12) return Math.abs(c - answer) <= 6;
  return c >= answer * 0.5 && c <= answer * 1.6;
}

function swapDigits(n) {
  const s = String(n);
  if (s.length < 2) return n + 3;
  return Number(s[1] + s[0] + s.slice(2));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// What a phone is allowed to see: the sum and four numbers, no answer key.
export const publicQuestion = (q, index, total) => ({
  index, total, text: q.text, options: q.options
});

/* ------------------------------------------------------------------ scoring */

// Score is correct answers; ties break on total elapsed time, so being fast
// only matters once you are right. Someone who never answered ranks last
// regardless of the clock.
export function rankEntries(players, sprint) {
  return [...players]
    .map(p => {
      const entry = sprint.entries.get(p.id);
      return {
        id: p.id,
        name: p.name,
        score: entry?.score ?? 0,
        answered: entry?.answers.length ?? 0,
        elapsedMs: entry?.finishedAt ? entry.finishedAt - sprint.startedAt : Infinity,
        played: !!entry
      };
    })
    .sort((a, b) => b.score - a.score || a.elapsedMs - b.elapsedMs || a.name.localeCompare(b.name))
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      elapsedMs: Number.isFinite(r.elapsedMs) ? r.elapsedMs : null
    }));
}
