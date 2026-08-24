// Pure unit tests over the question generator — no server needed. Runs many
// rounds because the generator is random and a bad option only shows up
// occasionally, which is exactly when it would embarrass you in the room.
import { ok, report } from './helpers.mjs';
import { generateQuestions, QUESTION_COUNT } from '../server/sprint.js';

const ROUNDS = 500;
const rounds = Array.from({ length: ROUNDS }, () => generateQuestions());

console.log(`\n— ${ROUNDS} generated rounds —`);
ok(rounds.every(r => r.length === QUESTION_COUNT), `every round has ${QUESTION_COUNT} questions`);
ok(rounds.every(r => new Set(r.map(q => q.text)).size === r.length), 'no question repeats within a round');

const all = rounds.flat();
console.log(`\n— ${all.length} questions —`);
ok(all.every(q => Number.isInteger(q.answer)), 'every answer is a whole number');
ok(all.every(q => q.answer >= 0), 'no negative answers');
ok(all.every(q => q.options.length === 4), 'four options each');
ok(all.every(q => new Set(q.options).size === 4), 'options are all distinct');
ok(all.every(q => q.options.includes(q.answer)), 'the right answer is always among them');
ok(all.every(q => q.options.every(o => o > 0)), 'no zero or negative options');

// The right answer must not be guessable by shape — no "obviously the odd one out".
const implausible = all.filter(q =>
  q.options.some(o => o !== q.answer && q.answer >= 12 && (o / q.answer < 0.5 || o / q.answer > 1.6)));
ok(implausible.length === 0,
   implausible.length ? `implausible distractors, e.g. ${implausible[0].text} = ${implausible[0].answer} with ${implausible[0].options}`
                      : 'every distractor is a number you could plausibly land on');

// Position must not be a tell: if the answer sat in the same slot too often,
// the fastest strategy would be tapping that slot blind.
const slots = [0, 0, 0, 0];
for (const q of all) slots[q.options.indexOf(q.answer)]++;
const expected = all.length / 4;
const drift = Math.max(...slots.map(n => Math.abs(n - expected) / expected));
ok(drift < 0.12, `the answer is spread evenly across the four slots (worst slot off by ${(drift * 100).toFixed(1)}%)`);

console.log('\n— difficulty stays mental-arithmetic —');
ok(all.every(q => q.answer <= 1000), 'answers stay under 1000');
ok(all.every(q => /^[\d\s+−×÷]+$/.test(q.text)), 'questions use only digits and the four operators');

const ops = { '+': 0, '−': 0, '×': 0, '÷': 0 };
for (const q of all) for (const op of Object.keys(ops)) if (q.text.includes(op)) ops[op]++;
ok(Object.values(ops).every(n => n > 0), `all four operations appear (${JSON.stringify(ops)})`);

report();
