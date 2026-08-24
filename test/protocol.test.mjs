import { BASE, ok, report, client, isType, seedDefaultLayout } from './helpers.mjs';

console.log('\n— layout API —');
// Start from a known layout: /api/layout returns whatever was last SAVED, so
// without this the suite passes only on a clean data directory.
await seedDefaultLayout();

let r = await fetch(`${BASE}/api/layout`);
let { layout, grid, perks } = await r.json();
ok(r.ok, 'GET /api/layout');
ok(layout.desks.length === 20, `saved layout round-trips 20 desks (got ${layout.desks.length})`);
ok(grid.cols === 10 && grid.rows === 7, 'grid dimensions returned');
ok(!!perks.window, 'perk vocabulary returned');

r = await fetch(`${BASE}/api/layout/default`);
ok((await r.json()).layout.desks.length === 20, 'GET /api/layout/default returns a fresh 20-desk layout');

console.log('\n— layout sanitising —');
r = await fetch(`${BASE}/api/layout`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ windowSide: 'left', desks: [
    { id: 'a', name: 'Win', r: 0, c: 0, perk: 'window' },
    { id: 'b', name: 'Dup', r: 0, c: 0, perk: 'none' },        // same cell — must be dropped
    { id: 'c', name: 'Far', r: 99, c: 99, perk: 'nonsense' },  // out of grid + bad perk
    { id: 'd', name: '   ', r: 2, c: 2 }
  ] })
});
const saved = (await r.json()).layout;
ok(saved.desks.length === 3, `duplicate cell dropped (${saved.desks.length} desks kept)`);
ok(saved.desks[1].r === 6 && saved.desks[1].c === 9, 'out-of-grid desk clamped into the grid');
ok(saved.desks[1].perk === 'none', 'unknown perk reset to none');
ok(saved.desks[2].name === '3-3', 'blank desk name given a fallback');
ok(saved.windowSide === 'left', 'window side persisted');

console.log('\n— room with too few desks still creates, empty layout refuses —');
await fetch(`${BASE}/api/layout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"desks":[]}' });
r = await fetch(`${BASE}/api/room`, { method: 'POST' });
ok(r.status === 400, 'refuses to create a room with zero desks');

// restore a real 20-desk layout for the rest of the run
const fresh = (await (await fetch(`${BASE}/api/layout/default`)).json()).layout;
await fetch(`${BASE}/api/layout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fresh) });

console.log('\n— room creation —');
r = await fetch(`${BASE}/api/room`, { method: 'POST' });
const { code, hostToken, state } = await r.json();
ok(/^[A-Z]{4}$/.test(code), `room code looks right (${code})`);
ok(!!hostToken, 'host token issued');
ok(state.seatCount === 20, 'room snapshot carries 20 seats');

console.log('\n— host auth —');
const host = client(); await host.ready;
const impostor = client(); await impostor.ready;
impostor.send({ type: 'host:join', code, hostToken: 'wrong-token' });
ok((await impostor.next(isType('error'))).code === 'not_host', 'wrong host token rejected');

host.send({ type: 'host:join', code, hostToken });
ok((await host.next(isType('state'))).state.code === code, 'host joined and got state');

impostor.send({ type: 'host:removePlayer', code, playerId: 'anyone' });
ok((await impostor.next(isType('error'))).code === 'not_host', 'non-host cannot remove players');
impostor.close();

console.log('\n— players joining —');
const alice = client(); await alice.ready;
alice.send({ type: 'player:join', code, name: 'Alice' });
const aliceJoined = await alice.next(isType('joined'));
ok(!!aliceJoined.playerId, 'Alice joined and got an id');
ok((await host.next(isType('state'))).state.players.length === 1, 'host sees Alice arrive');

const bob = client(); await bob.ready;
bob.send({ type: 'player:join', code, name: 'Bob' });
await bob.next(isType('joined'));
ok((await host.next(m => m.type === 'state' && m.state.players.length === 2)).state.players.length === 2, 'host sees 2 players');

console.log('\n— join validation —');
const dupe = client(); await dupe.ready;
dupe.send({ type: 'player:join', code, name: 'alice' });
ok((await dupe.next(isType('error'))).code === 'name_taken', 'duplicate name (case-insensitive) rejected');
dupe.send({ type: 'player:join', code, name: 'X' });
ok((await dupe.next(isType('error'))).code === 'bad_name', 'one-character name rejected');
dupe.send({ type: 'player:join', code: 'ZZZZ', name: 'Nobody' });
ok((await dupe.next(isType('error'))).code === 'no_such_room', 'bad room code rejected');
dupe.close();

console.log('\n— manual add, then that person turns up with a phone —');
host.send({ type: 'host:addPlayer', code, name: 'Carol' });
let s = (await host.next(m => m.type === 'state' && m.state.players.length === 3)).state;
ok(s.players.find(p => p.name === 'Carol').manual === true, 'manually added Carol flagged NO PHONE');

const carol = client(); await carol.ready;
carol.send({ type: 'player:join', code, name: 'Carol' });
await carol.next(isType('joined'));
s = (await host.next(m => m.type === 'state' && m.state.players.every(p => !p.manual))).state;
ok(s.players.length === 3, 'Carol claimed her placeholder instead of duplicating (still 3 players)');
ok(s.players.find(p => p.name === 'Carol').connected === true, 'Carol now shows as connected');

console.log('\n— reconnect —');
const aliceId = aliceJoined.playerId;
alice.close();
s = (await host.next(m => m.type === 'state' && !m.state.players.find(p => p.id === aliceId).connected)).state;
ok(true, 'Alice shows offline after her phone drops');
ok(s.players.length === 3, 'Alice is NOT removed from the roster when she drops');

const alice2 = client(); await alice2.ready;
alice2.send({ type: 'player:resume', code, playerId: aliceId });
const resumed = await alice2.next(isType('joined'));
ok(resumed.name === 'Alice' && resumed.playerId === aliceId, 'Alice resumed with the same identity');
s = (await host.next(m => m.type === 'state' && m.state.players.find(p => p.id === aliceId).connected)).state;
ok(s.players.length === 3, 'still 3 players after reconnect — no ghost');

console.log('\n— second device claims the same identity —');
const alice3 = client(); await alice3.ready;
alice3.send({ type: 'player:resume', code, playerId: aliceId });
await alice3.next(isType('joined'));
ok((await alice2.next(isType('replaced'))).type === 'replaced', 'old device told it was replaced');

console.log('\n— host management —');
host.send({ type: 'host:renamePlayer', code, playerId: aliceId, name: 'Alice K' });
ok((await alice3.next(isType('joined'))).name === 'Alice K', 'renamed player told their new name');
host.send({ type: 'host:renamePlayer', code, playerId: aliceId, name: 'Bob' });
ok((await host.next(isType('error'))).code === 'name_taken', 'rename to an existing name rejected');

host.send({ type: 'host:removePlayer', code, playerId: aliceId });
ok((await alice3.next(isType('kicked'))).type === 'kicked', 'removed player notified');
ok((await host.next(m => m.type === 'state' && m.state.players.length === 2)).state.players.length === 2, 'roster down to 2');

console.log('\n— unknown message —');
host.send({ type: 'host:nonsense', code });
ok((await host.next(isType('error'))).code === 'unknown_message', 'unknown message type rejected');

console.log('\n— static routes —');
for (const p of ['/', '/host', '/setup', '/app.css', '/net.js', '/join.js', '/host.js', '/setup.js']) {
  ok((await fetch(BASE + p)).ok, `serves ${p}`);
}
ok((await fetch(`${BASE}/../server/store.js`)).status === 404, 'path traversal blocked');

host.close(); bob.close(); carol.close(); alice3.close();
report();
