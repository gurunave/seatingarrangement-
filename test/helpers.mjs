import WebSocket from 'ws';

export const PORT = process.env.PORT || 3000;
export const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
export const ok = (cond, msg) => {
  cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.log('  ✗ FAIL:', msg));
};
export const tally = () => ({ pass, fail });
export const report = () => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

// A test websocket client that lets a test await the specific message it wants
// without caring what else arrived first.
export function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];

  // A matcher that throws (usually reading through a null the test didn't
  // expect) must surface as that error, not as a mystery timeout.
  const safeMatch = (w, m) => { try { return w.match(m); } catch (err) { w.reject?.(err); return false; } };

  ws.on('message', d => {
    const m = JSON.parse(d);
    const i = waiters.findIndex(w => safeMatch(w, m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });

  return {
    ws,
    ready: new Promise(r => ws.on('open', r)),
    send: m => ws.send(JSON.stringify(m)),
    next(match = () => true, ms = 4000) {
      const i = inbox.findIndex(m => { try { return match(m); } catch { return false; } });
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ match, resolve, reject });
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    drain: () => inbox.splice(0),
    close: () => ws.close()
  };
}

export const isType = t => m => m.type === t;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reset the saved layout so a suite never depends on a previous run's state.
export async function seedDefaultLayout() {
  const { layout } = await (await fetch(`${BASE}/api/layout/default`)).json();
  await fetch(`${BASE}/api/layout`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(layout)
  });
  return layout;
}

export async function newRoom() {
  const res = await fetch(`${BASE}/api/room`, { method: 'POST' });
  return res.json();
}

// Join `names` as connected players and return their clients + ids.
export async function joinPlayers(code, names) {
  const out = [];
  for (const name of names) {
    const c = client();
    await c.ready;
    c.send({ type: 'player:join', code, name });
    const joined = await c.next(isType('joined'));
    out.push({ name, id: joined.playerId, c });
  }
  return out;
}

// Save a layout with exactly `count` desks, so a test can control the
// seats-to-people ratio (which decides how many people are auto-assigned).
export async function seedLayout(count) {
  const desks = Array.from({ length: count }, (_, i) => ({
    id: `d${i + 1}`, name: `S${i + 1}`, r: Math.floor(i / 6), c: i % 6,
    perk: i < 6 ? 'window' : 'none'
  }));
  await fetch(`${BASE}/api/layout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ windowSide: 'top', desks })
  });
  return desks;
}

// Run a whole maths sprint to completion so a test can reach the reveal.
export async function runSprint(host, code, players) {
  host.send({ type: 'host:start', code });
  await host.next(m => m.type === 'state' && m.state.phase === 'sprint');

  await Promise.all(players.map(async p => {
    let msg = await p.c.next(m => m.type === 'sprint:question' || m.type === 'sprint:done');
    while (msg.type === 'sprint:question') {
      p.c.send({ type: 'sprint:answer', code, index: msg.question.index, choice: msg.question.options[0] });
      await p.c.next(isType('sprint:result'));
      msg = await p.c.next(m => m.type === 'sprint:question' || m.type === 'sprint:done');
    }
  }));

  return (await host.next(m => m.type === 'state' && m.state.phase === 'reveal')).state;
}
