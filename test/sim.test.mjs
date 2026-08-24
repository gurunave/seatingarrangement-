// Runs a complete game where every player is a rehearsal bot: they join via
// the API, solve the sprint, and pick seats — exactly what the manager's dry
// run will do. Runs against a server with short bot think-times.
import { BASE, ok, report, client, isType, seedLayout, newRoom } from './helpers.mjs';

await seedLayout(20);
const { code, hostToken } = await newRoom();
const host = client(); await host.ready;
host.send({ type: 'host:join', code, hostToken });
await host.next(isType('state'));

console.log('\n— starting bots —');
let res = await fetch(`${BASE}/api/sim`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, count: 12 })
});
let data = await res.json();
ok(res.ok, 'sim start accepted');
ok(data.bots.length === 12, `12 bots requested, ${data.bots.length} started`);

let s = (await host.next(m => m.type === 'state' && m.state.players.length === 12, 8000)).state;
ok(s.players.length === 12, 'all 12 bots joined the lobby');
ok(s.players.every(p => p.connected), 'every bot shows as connected');
ok(s.players.every(p => p.name.includes('(bot)')), 'bots are visibly labelled as bots');

console.log('\n— guard rails —');
res = await fetch(`${BASE}/api/sim`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'ZZZZ', count: 5 })
});
ok(res.status === 404, 'bots refuse a room that does not exist');
res = await fetch(`${BASE}/api/sim`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, count: 0 })
});
ok(res.status === 400, 'a zero count is refused');

console.log('\n— the bots play the sprint —');
host.send({ type: 'host:start', code });
await host.next(m => m.type === 'state' && m.state.phase === 'sprint');
s = (await host.next(m => m.type === 'state' && m.state.phase === 'reveal', 30000)).state;
ok(s.phase === 'reveal', 'every bot finished and the sprint ended on its own');
const scores = s.results.map(r => r.score);
ok(scores.some(x => x >= 7), `some bots are good at maths (best: ${Math.max(...scores)}/10)`);
ok(new Set(scores).size >= 3, `scores vary like real people (${[...new Set(scores)].sort((a,b)=>b-a).join(', ')})`);

res = await fetch(`${BASE}/api/sim`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, count: 3 })
});
ok(res.status === 400, 'bots cannot be added after the game has started');

console.log('\n— the bots draft their seats —');
host.send({ type: 'host:startDraft', code });
s = (await host.next(m => m.type === 'state' && m.state.phase === 'result', 60000)).state;
ok(s.phase === 'result', 'the whole draft completed with nobody human');
ok(s.draft.assignments.length === 12, 'all 12 bots are seated');
ok(new Set(s.draft.assignments.map(a => a.deskId)).size === 12, 'no desk double-booked');
// 20 desks for 12 players leaves 8 spare, which by design shrinks the
// auto-assigned tail to zero: every bot gets a real choice.
const chosen = s.draft.assignments.filter(a => !a.auto).length;
ok(chosen === 12, `with 8 spare desks every bot picked for itself (${chosen}/12 chose)`);

console.log('\n— status and stop —');
data = await (await fetch(`${BASE}/api/sim?code=${code}`)).json();
ok(data.bots.every(b => b.state === 'done'), 'status shows every bot done');
res = await fetch(`${BASE}/api/sim`, {
  method: 'DELETE', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code })
});
ok(res.ok, 'stop accepted');
data = await (await fetch(`${BASE}/api/sim?code=${code}`)).json();
ok(data.bots.length === 0, 'no bots left after stop');

host.close();
report();
