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

  ws.on('message', d => {
    const m = JSON.parse(d);
    const i = waiters.findIndex(w => w.match(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });

  return {
    ws,
    ready: new Promise(r => ws.on('open', r)),
    send: m => ws.send(JSON.stringify(m)),
    next(match = () => true, ms = 4000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ match, resolve });
        setTimeout(() => reject(new Error(`timeout waiting for message`)), ms);
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
