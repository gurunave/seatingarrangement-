import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { loadLayout, saveLayout, sanitizeLayout, defaultLayout, GRID, PERKS } from './store.js';
import {
  createRoom, getRoom, addPlayer, removePlayer, broadcast, publicState,
  normalizeName, nameTaken, sweepRooms, MAX_PLAYERS,
  startSprint, endSprint, recordAnswer, currentQuestion, pendingPlayers
} from './room.js';
import { publicQuestion } from './sprint.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

// A room's control token. Whoever created the room drives it; a player who
// guesses the URL of the host screen cannot kick people out of the lobby.
const hostTokens = new Map(); // code -> token

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error('request failed', err);
    send(res, 500, { error: 'server_error' });
  }
});

const ROUTES = { '/': 'index.html', '/host': 'host.html', '/setup': 'setup.html' };

async function serveStatic(pathname, res) {
  const rel = ROUTES[pathname] || normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not_found' });
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/layout' && req.method === 'GET') {
    return send(res, 200, { layout: await loadLayout(), grid: GRID, perks: PERKS });
  }
  if (url.pathname === '/api/layout/default' && req.method === 'GET') {
    return send(res, 200, { layout: defaultLayout() });
  }
  if (url.pathname === '/api/layout' && req.method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, { layout: await saveLayout(sanitizeLayout(body)) });
  }
  if (url.pathname === '/api/room' && req.method === 'POST') {
    const layout = await loadLayout();
    if (layout.desks.length === 0) return send(res, 400, { error: 'no_desks' });
    const room = createRoom(structuredClone(layout));
    const token = randomUUID();
    hostTokens.set(room.code, token);
    console.log(`room ${room.code} created with ${layout.desks.length} desks`);
    return send(res, 200, { code: room.code, hostToken: token, state: publicState(room) });
  }
  if (url.pathname === '/api/room' && req.method === 'GET') {
    const room = getRoom(url.searchParams.get('code'));
    if (!room) return send(res, 404, { error: 'no_such_room' });
    return send(res, 200, { state: publicState(room) });
  }
  return send(res, 404, { error: 'not_found' });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    try { handleMessage(ws, msg); } catch (err) { console.error('ws message failed', err); }
  });
  ws.on('close', () => detach(ws));
});

function reply(ws, msg) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(msg)); } catch { /* socket died mid-send; close handler cleans up */ }
}

function handleMessage(ws, msg) {
  const room = getRoom(msg.code);
  if (!room) return reply(ws, { type: 'error', code: 'no_such_room' });

  switch (msg.type) {
    case 'host:join': {
      if (hostTokens.get(room.code) !== msg.hostToken) {
        return reply(ws, { type: 'error', code: 'not_host' });
      }
      detach(ws);
      ws.role = 'host';
      ws.roomCode = room.code;
      room.hosts.add(ws);
      reply(ws, { type: 'state', state: publicState(room) });
      return;
    }

    case 'player:join': {
      if (room.phase !== 'lobby') return reply(ws, { type: 'error', code: 'already_started' });
      const name = normalizeName(msg.name);
      if (name.length < 2) return reply(ws, { type: 'error', code: 'bad_name' });
      if (room.players.size >= MAX_PLAYERS) return reply(ws, { type: 'error', code: 'room_full' });

      // A manager may have pencilled someone in from the host screen. If that
      // name is still waiting for a phone, claim it instead of duplicating it.
      let player = [...room.players.values()].find(
        p => p.manual && !p.connected && p.name.toLowerCase() === name.toLowerCase()
      );
      if (!player) {
        if (nameTaken(room, name)) return reply(ws, { type: 'error', code: 'name_taken' });
        player = addPlayer(room, name);
      } else {
        player.manual = false;
      }
      attachPlayer(ws, room, player);
      reply(ws, { type: 'joined', playerId: player.id, name: player.name });
      broadcast(room);
      return;
    }

    // A phone that locked, refreshed or dropped off WiFi comes back here.
    case 'player:resume': {
      const player = room.players.get(msg.playerId);
      if (!player) return reply(ws, { type: 'error', code: 'unknown_player' });
      attachPlayer(ws, room, player);
      reply(ws, { type: 'joined', playerId: player.id, name: player.name });
      if (room.phase === 'sprint') sendQuestion(ws, room, player.id);
      broadcast(room);
      return;
    }

    case 'sprint:answer': {
      if (room.phase !== 'sprint') return reply(ws, { type: 'error', code: 'not_in_sprint' });
      if (ws.role !== 'player' || ws.roomCode !== room.code) {
        return reply(ws, { type: 'error', code: 'unknown_player' });
      }
      const result = recordAnswer(room, ws.playerId, Number(msg.index), msg.choice);
      if (!result.ok) return reply(ws, { type: 'error', code: result.reason });

      // The phone is told whether it was right, but only after it has committed.
      reply(ws, { type: 'sprint:result', index: Number(msg.index), correct: result.correct });
      if (result.finished) reply(ws, { type: 'sprint:done' });
      else sendQuestion(ws, room, ws.playerId);

      if (pendingPlayers(room).length === 0) endSprint(room);
      else broadcast(room);
      return;
    }

    case 'host:start':
    case 'host:endSprint':
    case 'host:addPlayer':
    case 'host:removePlayer':
    case 'host:renamePlayer':
      if (ws.role !== 'host' || ws.roomCode !== room.code) {
        return reply(ws, { type: 'error', code: 'not_host' });
      }
      return handleHostAction(ws, room, msg);

    default:
      return reply(ws, { type: 'error', code: 'unknown_message' });
  }
}

function handleHostAction(ws, room, msg) {
  if (msg.type === 'host:start') {
    if (room.phase !== 'lobby') return reply(ws, { type: 'error', code: 'already_started' });
    const playing = [...room.players.values()].filter(p => !p.manual);
    if (playing.length < 2) return reply(ws, { type: 'error', code: 'need_players' });

    startSprint(room);
    console.log(`room ${room.code} started the sprint with ${playing.length} playing`);
    for (const [playerId, sock] of room.sockets) sendQuestion(sock, room, playerId);
    broadcast(room);
    return;
  }

  if (msg.type === 'host:endSprint') {
    if (room.phase !== 'sprint') return reply(ws, { type: 'error', code: 'not_in_sprint' });
    endSprint(room);
    return;
  }

  if (msg.type === 'host:addPlayer') {
    const name = normalizeName(msg.name);
    if (name.length < 2) return reply(ws, { type: 'error', code: 'bad_name' });
    if (nameTaken(room, name)) return reply(ws, { type: 'error', code: 'name_taken' });
    if (room.players.size >= MAX_PLAYERS) return reply(ws, { type: 'error', code: 'room_full' });
    addPlayer(room, name, { manual: true });
  }

  if (msg.type === 'host:removePlayer') removePlayer(room, msg.playerId);

  if (msg.type === 'host:renamePlayer') {
    const player = room.players.get(msg.playerId);
    const name = normalizeName(msg.name);
    if (!player) return reply(ws, { type: 'error', code: 'unknown_player' });
    if (name.length < 2) return reply(ws, { type: 'error', code: 'bad_name' });
    if (nameTaken(room, name, player.id)) return reply(ws, { type: 'error', code: 'name_taken' });
    player.name = name;
    const sock = room.sockets.get(player.id);
    if (sock) reply(sock, { type: 'joined', playerId: player.id, name: player.name });
  }

  broadcast(room);
}

function sendQuestion(ws, room, playerId) {
  const question = currentQuestion(room, playerId);
  if (!question) return reply(ws, { type: 'sprint:done' });
  const index = room.sprint.entries.get(playerId).answers.length;
  reply(ws, {
    type: 'sprint:question',
    question: publicQuestion(question, index, room.sprint.questions.length),
    msLeft: Math.max(0, room.sprint.endsAt - Date.now())
  });
}

function attachPlayer(ws, room, player) {
  detach(ws);
  // One phone per person: a second device claiming the same identity wins,
  // and the stale socket is dropped rather than left half-alive.
  const previous = room.sockets.get(player.id);
  if (previous && previous !== ws) {
    try { previous.send(JSON.stringify({ type: 'replaced' })); previous.close(); } catch { /* gone */ }
  }
  ws.role = 'player';
  ws.roomCode = room.code;
  ws.playerId = player.id;
  room.sockets.set(player.id, ws);
  player.connected = true;
  player.manual = false;
}

function detach(ws) {
  const room = getRoom(ws.roomCode);
  if (!room) return;
  if (ws.role === 'host') room.hosts.delete(ws);
  if (ws.role === 'player' && room.sockets.get(ws.playerId) === ws) {
    room.sockets.delete(ws.playerId);
    const player = room.players.get(ws.playerId);
    if (player) player.connected = false;
    broadcast(room);
  }
}

// Phones sleep and WiFi drops; without this the lobby slowly fills with ghosts.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* terminated on next sweep */ }
  }
  sweepRooms();
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Seat Draft on http://localhost:${PORT}  (setup: /setup, big screen: /host)`);
});
