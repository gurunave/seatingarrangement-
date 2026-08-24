import { BASE, ok, report, client, isType, sleep, seedDefaultLayout, newRoom, joinPlayers } from './helpers.mjs';

await seedDefaultLayout();

// Play through the whole sprint, always tapping the given option position.
// Returns what the server said about each answer.
async function playAll(p, code, choose = q => q.options[0], firstQuestion = null) {
  const results = [];
  // The caller may already have taken the current question off the wire.
  let q = firstQuestion ?? await p.c.next(isType('sprint:question'));
  for (;;) {
    p.c.send({ type: 'sprint:answer', code, index: q.question.index, choice: choose(q.question) });
    const r = await p.c.next(isType('sprint:result'));
    results.push(r.correct);
    const nextMsg = await p.c.next(m => m.type === 'sprint:question' || m.type === 'sprint:done');
    if (nextMsg.type === 'sprint:done') return results;
    q = nextMsg;
  }
}

console.log('\n— starting the sprint —');
let { code, hostToken } = await newRoom();
const host = client(); await host.ready;
host.send({ type: 'host:join', code, hostToken });
await host.next(isType('state'));

host.send({ type: 'host:start', code });
ok((await host.next(isType('error'))).code === 'need_players', 'refuses to start with nobody playing');

const players = await joinPlayers(code, ['Naveen', 'Priya', 'Arjun']);
await host.next(m => m.type === 'state' && m.state.players.length === 3);

host.send({ type: 'host:addPlayer', code, name: 'Ghost' });   // no phone
await host.next(m => m.type === 'state' && m.state.players.length === 4);

host.send({ type: 'host:start', code });
let s = (await host.next(m => m.type === 'state' && m.state.phase === 'sprint')).state;
ok(s.phase === 'sprint', 'room moved into the sprint phase');
ok(s.sprint.total === 10, 'ten questions in the sprint');
ok(s.sprint.playing === 3, 'the pencilled-in player is not counted as playing');
ok(s.sprint.msLeft > 0 && s.sprint.msLeft <= 90000, 'a time limit is running');

console.log('\n— what a phone is told —');
const q0 = await players[0].c.next(isType('sprint:question'));
ok(q0.question.index === 0 && q0.question.total === 10, 'first question is index 0 of 10');
ok(typeof q0.question.text === 'string' && q0.question.text.length > 0, 'question has text');
ok(q0.question.options.length === 4, 'four options offered');
ok(!('answer' in q0.question), 'THE ANSWER IS NOT SENT TO THE PHONE');
ok(JSON.stringify(q0).match(/answer/i) === null, 'no answer key anywhere in the payload');

console.log('\n— the same questions for everyone —');
const q0b = await players[1].c.next(isType('sprint:question'));
ok(q0b.question.text === q0.question.text, 'every player gets the same first question');

console.log('\n— answering —');
players[0].c.send({ type: 'sprint:answer', code, index: 5, choice: 1 });
ok((await players[0].c.next(isType('error'))).code === 'out_of_step', 'an answer for the wrong question is rejected');

players[0].c.send({ type: 'sprint:answer', code, index: 0, choice: q0.question.options[0] });
const first = await players[0].c.next(isType('sprint:result'));
ok(typeof first.correct === 'boolean', 'server reports right or wrong');

players[0].c.send({ type: 'sprint:answer', code, index: 0, choice: q0.question.options[1] });
ok((await players[0].c.next(isType('error'))).code === 'out_of_step', 'the same question cannot be answered twice');

console.log('\n— progress is public, scores are not —');
s = (await host.next(m => m.type === 'state' && m.state.sprint?.progress.some(p => p.answered > 0))).state;
const prog = s.sprint.progress.find(p => p.id === players[0].id);
ok(prog.answered === 1, 'big screen sees one question answered');
ok(!('score' in prog) && !('correct' in prog), 'progress carries no score or correctness');
ok(JSON.stringify(s.sprint).match(/score/i) === null, 'no scores leak in the sprint state at all');

console.log('\n— nobody new gets in mid-sprint —');
const latecomer = client(); await latecomer.ready;
latecomer.send({ type: 'player:join', code, name: 'Latecomer' });
ok((await latecomer.next(isType('error'))).code === 'already_started', 'joining mid-sprint is refused');
latecomer.close();

console.log('\n— reconnecting mid-sprint —');
players[0].c.close();
await sleep(120);
const back = client(); await back.ready;
back.send({ type: 'player:resume', code, playerId: players[0].id });
await back.next(isType('joined'));
const resumeQ = await back.next(isType('sprint:question'));
ok(resumeQ.question.index === 1, 'resumed on question 2 — the one answer already given still counts');
ok(resumeQ.msLeft > 0 && resumeQ.msLeft <= 90000, 'resumed phone gets the remaining time');
players[0].c = back;

console.log('\n— playing to the end —');
const naveen = await playAll(players[0], code, q => q.options[0], resumeQ);
ok(naveen.length === 9, 'Naveen answered the remaining 9 questions');

// Priya answers everything; Arjun answers nothing, to exercise the "did not
// finish" path when the host cuts the sprint short.
const priya = await playAll(players[1], code, q => q.options[1], q0b);
ok(priya.length === 10, 'Priya answered all 10');

s = (await host.next(m => m.type === 'state' && m.state.sprint?.finished === 2)).state;
ok(s.sprint.finished === 2, 'two of three finished; the sprint is still running');
ok(s.phase === 'sprint', 'the room waits rather than ending early');

console.log('\n— host ends it early —');
host.send({ type: 'host:endSprint', code });
s = (await host.next(m => m.type === 'state' && m.state.phase === 'reveal')).state;
ok(s.phase === 'reveal', 'room moved to reveal');
ok(Array.isArray(s.results) && s.results.length === 4, 'everyone appears in the results, phone or not');

console.log('\n— the ranking —');
const byName = Object.fromEntries(s.results.map(r => [r.name, r]));
ok(byName.Naveen.score === naveen.filter(Boolean).length + (first.correct ? 1 : 0),
   'Naveen\'s score matches the answers the server confirmed');
ok(byName.Priya.score === priya.filter(Boolean).length, "Priya's score matches hers");
ok(byName.Arjun.score === 0, 'Arjun, who never answered, scored 0');
ok(byName.Ghost.score === 0, 'the player with no phone scored 0');
ok(byName.Arjun.elapsedMs === null, 'a player who never answered has no time');
ok(s.results.every((r, i) => r.rank === i + 1), 'ranks are 1..n in order');
ok(s.results.every((r, i, a) => i === 0 || a[i - 1].score >= r.score), 'sorted by score, highest first');

const tie = s.results.filter(r => r.score === s.results[0].score);
ok(tie.every((r, i, a) => i === 0 || a[i - 1].elapsedMs <= r.elapsedMs || r.elapsedMs === null),
   'players on the same score are ordered by time');
ok(s.questionTotal === 10, 'question count published for the scoreboard');

console.log('\n— sprint messages are refused outside the sprint —');
players[1].c.send({ type: 'sprint:answer', code, index: 0, choice: 1 });
ok((await players[1].c.next(isType('error'))).code === 'not_in_sprint', 'answers after the end are refused');
host.send({ type: 'host:endSprint', code });
ok((await host.next(isType('error'))).code === 'not_in_sprint', 'ending twice is refused');
host.send({ type: 'host:start', code });
ok((await host.next(isType('error'))).code === 'already_started', 'restarting a finished room is refused');

console.log('\n— only the host can drive it —');
const rogue = client(); await rogue.ready;
rogue.send({ type: 'host:start', code });
ok((await rogue.next(isType('error'))).code === 'not_host', 'a random socket cannot start the sprint');
rogue.send({ type: 'host:endSprint', code });
ok((await rogue.next(isType('error'))).code === 'not_host', 'a random socket cannot end the sprint');
rogue.close();

players.forEach(p => p.c.close());
host.close();
report();
