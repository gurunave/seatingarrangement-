// Runs against a server started with a short SPRINT_SECONDS so the sprint's
// own deadline is exercised for real rather than mocked.
import { ok, report, client, isType, seedDefaultLayout, newRoom, joinPlayers } from './helpers.mjs';

await seedDefaultLayout();

console.log('\n— the clock ends it on its own —');
// The suite runs the server with a short SPRINT_SECONDS so this path is real.
const limit = Number(process.env.SPRINT_SECONDS) || 90;
const r2 = await newRoom();
const host2 = client(); await host2.ready;
host2.send({ type: 'host:join', code: r2.code, hostToken: r2.hostToken });
await host2.next(isType('state'));
const two = await joinPlayers(r2.code, ['Slowcoach', 'Dawdler']);
await host2.next(m => m.type === 'state' && m.state.players.length === 2);
host2.send({ type: 'host:start', code: r2.code });
await host2.next(m => m.type === 'state' && m.state.phase === 'sprint');

// One of them answers a single question, then both stall.
const sq = await two[0].c.next(isType('sprint:question'));
two[0].c.send({ type: 'sprint:answer', code: r2.code, index: 0, choice: sq.question.options[0] });
await two[0].c.next(isType('sprint:result'));

const timedOut = (await host2.next(m => m.type === 'state' && m.state.phase === 'reveal', (limit + 4) * 1000)).state;
ok(timedOut.phase === 'reveal', `the sprint ended itself after ${limit}s with people still answering`);
const stalled = Object.fromEntries(timedOut.results.map(r => [r.name, r]));
ok(stalled.Slowcoach.answered === 1, 'the one answer given before the buzzer was kept');
ok(stalled.Slowcoach.elapsedMs !== null, 'a partial player still gets a time');
ok(stalled.Dawdler.answered === 0 && stalled.Dawdler.elapsedMs === null, 'the player who never answered has none');
two.forEach(p => p.c.close());
host2.close();


report();
