// Runs against a server started with ADMIN_PASSCODE=secret123. The manager's
// actions must demand it; everything a player or the big screen needs must
// keep working without it.
import { BASE, ok, report, client, isType } from './helpers.mjs';

const PASS = process.env.ADMIN_PASSCODE;
const withPass = { 'x-admin-passcode': PASS, 'content-type': 'application/json' };
const noPass = { 'content-type': 'application/json' };

console.log('\n— locked without the passcode —');
let res = await fetch(`${BASE}/api/layout`, { method: 'POST', headers: noPass, body: '{"desks":[]}' });
ok(res.status === 401 && (await res.json()).error === 'passcode_required', 'saving the layout is refused');
res = await fetch(`${BASE}/api/room`, { method: 'POST', headers: noPass });
ok(res.status === 401, 'creating a room is refused');
res = await fetch(`${BASE}/api/sim`, { method: 'POST', headers: noPass, body: '{"code":"AAAA","count":5}' });
ok(res.status === 401, 'starting bots is refused');
res = await fetch(`${BASE}/api/sim`, { method: 'DELETE', headers: noPass, body: '{"code":"AAAA"}' });
ok(res.status === 401, 'stopping bots is refused');

res = await fetch(`${BASE}/api/room`, { method: 'POST', headers: { 'x-admin-passcode': 'wrong-guess' } });
ok(res.status === 401 && (await res.json()).error === 'bad_passcode', 'a wrong passcode is told apart from a missing one');

console.log('\n— open with the passcode —');
const seed = (await (await fetch(`${BASE}/api/layout/default`)).json()).layout;
res = await fetch(`${BASE}/api/layout`, { method: 'POST', headers: withPass, body: JSON.stringify(seed) });
ok(res.ok, 'the layout saves with the passcode');
res = await fetch(`${BASE}/api/room`, { method: 'POST', headers: withPass });
const { code, hostToken } = await res.json();
ok(res.ok && /^[A-Z]{4}$/.test(code), 'a room is created with the passcode');
res = await fetch(`${BASE}/api/sim`, { method: 'POST', headers: withPass, body: JSON.stringify({ code, count: 2 }) });
ok(res.ok, 'bots start with the passcode');
res = await fetch(`${BASE}/api/sim`, { method: 'DELETE', headers: withPass, body: JSON.stringify({ code }) });
ok(res.ok, 'bots stop with the passcode');

console.log('\n— the game itself never needs it —');
res = await fetch(`${BASE}/api/layout`);
ok(res.ok, 'reading the layout is open (the pages need it)');
res = await fetch(`${BASE}/api/qr?code=${code}`);
ok(res.ok, 'the QR image is open');
res = await fetch(`${BASE}/api/room?code=${code}`);
ok(res.ok, 'reading room state is open');

const host = client(); await host.ready;
host.send({ type: 'host:join', code, hostToken });
ok((await host.next(isType('state'))).state.code === code, 'the big screen still drives via its host token');

const phone = client(); await phone.ready;
phone.send({ type: 'player:join', code, name: 'Naveen' });
ok((await phone.next(isType('joined'))).name === 'Naveen', 'a phone joins with no passcode anywhere');

host.close(); phone.close();
report();
