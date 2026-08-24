// Runs against a server with a short DRAFT_SECONDS, so the pick timer that
// stops one dead phone stalling twenty people is exercised for real.
import { ok, report, client, isType, seedLayout, newRoom, joinPlayers, runSprint } from './helpers.mjs';

const limit = Number(process.env.DRAFT_SECONDS) || 15;
const NAMES = ['Naveen', 'Priya', 'Arjun', 'Deepa'];

await seedLayout(20);
const { code, hostToken } = await newRoom();
const host = client(); await host.ready;
host.send({ type: 'host:join', code, hostToken });
await host.next(isType('state'));
const players = await joinPlayers(code, NAMES);
await host.next(m => m.type === 'state' && m.state.players.length === NAMES.length);
await runSprint(host, code, players);

host.send({ type: 'host:startDraft', code });
let s = (await host.next(m => m.type === 'state' && m.state.phase === 'draft')).state;
const stalling = s.draft.current.playerId;
const offered = s.draft.current.options.map(o => o.id);

console.log(`\n— a phone that never answers (${limit}s limit) —`);
ok(s.draft.current.msLeft <= limit * 1000, 'the turn carries the short limit');

// Nobody picks. The timer must move the room on by itself.
s = (await host.next(m => m.type === 'state' && m.state.draft?.index === 1, (limit + 4) * 1000)).state;
ok(s.draft.index === 1, `the turn resolved itself after ${limit}s with no input`);

const forced = s.draft.assignments.find(a => a.playerId === stalling);
ok(!!forced, 'the silent player still got a desk');
ok(forced.auto === true, 'it is recorded as automatic, not as their choice');
ok(offered.includes(forced.deskId), 'the desk came from the options they were shown');
ok(s.draft.current && s.draft.current.playerId !== stalling, 'the draft moved on to the next person');

console.log('\n— a late pick from the player who timed out —');
const late = players.find(p => p.id === stalling);
late.c.send({ type: 'draft:pick', code, deskId: offered[0] });
ok((await late.c.next(isType('error'))).code === 'not_your_turn', 'their late tap is refused');

console.log('\n— the whole draft can finish on timers alone —');
s = (await host.next(m => m.type === 'state' && m.state.phase === 'result', (limit + 4) * 1000 * 4)).state;
ok(s.phase === 'result', 'the room reached the result with nobody picking anything');
ok(s.draft.assignments.length === NAMES.length, 'everyone still ended up with a desk');
ok(new Set(s.draft.assignments.map(a => a.deskId)).size === NAMES.length, 'no desk was double-booked');
ok(s.draft.assignments.every(a => a.auto), 'every desk is marked as auto-assigned');

players.forEach(p => p.c.close());
host.close();
report();
