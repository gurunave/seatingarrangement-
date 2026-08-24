// Rehearsal bots. They connect over the same WebSocket protocol as a phone —
// nothing is faked server-side — so a dry run with bots exercises exactly what
// game day will. Each bot has its own accuracy and pace, which produces a
// realistic score spread instead of twenty identical rows.
import WebSocket from 'ws';

const NAMES = [
  'Asha', 'Bharat', 'Chitra', 'Dinesh', 'Esha', 'Farhan', 'Gita', 'Hari',
  'Indira', 'Jai', 'Kiran', 'Lata', 'Mohan', 'Nithya', 'Om', 'Padma',
  'Qasim', 'Radha', 'Sunil', 'Tara'
];

// Delay bounds are env-tunable so tests can run the whole game in seconds.
const THINK_MIN = Number(process.env.SIM_THINK_MIN_MS) || 1200;
const THINK_MAX = Number(process.env.SIM_THINK_MAX_MS) || 5000;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Bots are only given the question text, like a phone. They "solve" it by
// evaluating the sum — or, when their accuracy roll fails, tap a wrong option.
export function solve(text) {
  const m = text.match(/^(\d+)\s*([+−×÷])\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[3]);
  switch (m[2]) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? null : a / b;
  }
}

// One sim group per room. Starting a new group replaces the old one.
const groups = new Map();

export function startBots({ port, code, count }) {
  stopBots(code);
  const group = { code, bots: [], stopped: false };
  groups.set(code, group);

  for (let i = 0; i < count; i++) {
    group.bots.push(spawnBot(group, port, code, `${NAMES[i % NAMES.length]} (bot)`));
  }
  return status(code);
}

function spawnBot(group, port, code, name) {
  const bot = {
    name,
    state: 'connecting',
    accuracy: rand(0.45, 0.95),   // some bots are sharp, some are not
    pace: rand(0.6, 1.6),         // multiplier on thinking time
    timers: new Set(),
    ws: null
  };

  const later = (fn, ms) => {
    const t = setTimeout(() => { bot.timers.delete(t); if (!group.stopped) fn(); }, ms);
    bot.timers.add(t);
  };
  const think = () => rand(THINK_MIN, THINK_MAX) * bot.pace;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  bot.ws = ws;

  ws.on('open', () => ws.send(JSON.stringify({ type: 'player:join', code, name })));
  ws.on('error', () => { bot.state = 'error'; });
  ws.on('close', () => { if (bot.state !== 'done') bot.state = 'disconnected'; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'joined':
        bot.id = msg.playerId;
        bot.state = 'in lobby';
        break;

      case 'error':
        if (msg.code === 'name_taken') {
          // A colleague with the same name beat us to it; add a suffix.
          ws.send(JSON.stringify({ type: 'player:join', code, name: `${name} ${Math.floor(rand(2, 99))}` }));
        } else if (bot.state === 'connecting') {
          bot.state = `refused: ${msg.code}`;
        }
        break;

      case 'sprint:question': {
        bot.state = `question ${msg.question.index + 1}`;
        const options = msg.question.options;
        const right = solve(msg.question.text);
        const useRight = right != null && options.includes(right) && Math.random() < bot.accuracy;
        const wrong = options.filter(o => o !== right);
        const choice = useRight ? right : wrong[Math.floor(Math.random() * wrong.length)];
        later(() => ws.send(JSON.stringify({ type: 'sprint:answer', code, index: msg.question.index, choice })), think());
        break;
      }

      case 'sprint:done':
        bot.state = 'finished sprint';
        break;

      case 'state': {
        const st = msg.state;
        if (st.phase === 'draft' && st.draft?.current?.playerId === bot.id && !bot.picking) {
          bot.picking = true;
          bot.state = 'picking a seat';
          const options = st.draft.current.options.map(o => o.id);
          later(() => {
            const deskId = options[Math.floor(Math.random() * options.length)];
            ws.send(JSON.stringify({ type: 'draft:pick', code, deskId }));
            bot.picking = false;
          }, Math.min(think(), 9000));   // never outlast the 15s pick timer
        }
        if (st.phase === 'result') bot.state = 'done';
        if (st.phase === 'reveal') bot.state = 'waiting for draft';
        break;
      }
    }
  });

  return bot;
}

export function stopBots(code) {
  const group = groups.get(code);
  if (!group) return { code, bots: [] };
  group.stopped = true;
  for (const bot of group.bots) {
    for (const t of bot.timers) clearTimeout(t);
    try { bot.ws?.close(); } catch { /* already gone */ }
  }
  groups.delete(code);
  return { code, bots: [] };
}

export function status(code) {
  const group = groups.get(code);
  return {
    code,
    bots: group ? group.bots.map(b => ({ name: b.name, state: b.state })) : []
  };
}
