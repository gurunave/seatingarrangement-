// One live session. Held in memory: if the server restarts mid-game everyone
// rejoins with the same room code, which is the right trade for a 10-minute
// event that happens four times a year.
import { randomUUID } from 'node:crypto';

// No O/0/I/1 — someone is reading this off a projector from the back row.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 40;
const NAME_MAX = 24;

export const PHASES = ['lobby', 'sprint', 'reveal', 'draft', 'result'];

const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom(layout) {
  const room = {
    code: makeCode(),
    createdAt: Date.now(),
    phase: 'lobby',
    layout,                 // snapshotted, so editing the saved layout mid-game is harmless
    players: new Map(),     // playerId -> player
    sockets: new Map(),     // playerId -> ws
    hosts: new Set()        // big-screen connections
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

export function normalizeName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function nameTaken(room, name, exceptId = null) {
  const key = name.toLowerCase();
  for (const p of room.players.values()) {
    if (p.id !== exceptId && p.name.toLowerCase() === key) return true;
  }
  return false;
}

export function addPlayer(room, name, { manual = false } = {}) {
  const player = {
    id: randomUUID(),
    name,
    manual,               // added from the host screen; may never hold a phone
    connected: false,
    joinedAt: Date.now()
  };
  room.players.set(player.id, player);
  return player;
}

export function removePlayer(room, playerId) {
  const ws = room.sockets.get(playerId);
  if (ws) {
    try { ws.send(JSON.stringify({ type: 'kicked' })); ws.close(); } catch { /* already gone */ }
    room.sockets.delete(playerId);
  }
  return room.players.delete(playerId);
}

// What every client is allowed to know about the room right now.
export function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    layout: room.layout,
    seatCount: room.layout.desks.length,
    players: [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(p => ({ id: p.id, name: p.name, connected: p.connected, manual: p.manual }))
  };
}

export function broadcast(room) {
  const payload = JSON.stringify({ type: 'state', state: publicState(room) });
  for (const ws of room.hosts) trySend(ws, payload);
  for (const ws of room.sockets.values()) trySend(ws, payload);
}

function trySend(ws, payload) {
  if (ws.readyState === 1) {
    try { ws.send(payload); } catch { /* dropped connection; cleanup runs on close */ }
  }
}

// Rooms are cheap but not free — drop anything untouched for six hours.
export function sweepRooms(maxAgeMs = 6 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff && room.hosts.size === 0) rooms.delete(code);
  }
}
