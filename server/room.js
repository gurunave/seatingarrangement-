// One live session. Held in memory: if the server restarts mid-game everyone
// rejoins with the same room code, which is the right trade for a 10-minute
// event that happens four times a year.
import { randomUUID } from 'node:crypto';
import { generateQuestions, rankEntries, QUESTION_COUNT, SPRINT_SECONDS } from './sprint.js';
import { buildTiers, draftOrder, autoTailCount, sampleDesks, DRAFT_SECONDS } from './draft.js';

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
    hosts: new Set(),       // big-screen connections
    sprint: null,           // set when the maths sprint starts
    results: null,          // ranked once the sprint ends
    tiers: null,            // tiers + shuffled within-tier order, fixed at reveal
    draft: null             // seat draft, once it starts
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

/* ------------------------------------------------------------------- sprint */

export function startSprint(room) {
  room.sprint = {
    questions: generateQuestions(QUESTION_COUNT),
    startedAt: Date.now(),
    endsAt: Date.now() + SPRINT_SECONDS * 1000,
    entries: new Map(),   // playerId -> { answers: [], score, finishedAt }
    timer: null
  };
  room.results = null;
  room.phase = 'sprint';

  // Someone whose phone died shouldn't hold the whole room hostage.
  room.sprint.timer = setTimeout(() => endSprint(room), SPRINT_SECONDS * 1000);
  return room.sprint;
}

export function entryFor(room, playerId) {
  let entry = room.sprint.entries.get(playerId);
  if (!entry) {
    entry = { answers: [], score: 0, finishedAt: null };
    room.sprint.entries.set(playerId, entry);
  }
  return entry;
}

// Returns the next question for this player, or null once they're finished.
export function currentQuestion(room, playerId) {
  const entry = entryFor(room, playerId);
  if (entry.finishedAt) return null;
  return room.sprint.questions[entry.answers.length] ?? null;
}

export function recordAnswer(room, playerId, index, choice) {
  const entry = entryFor(room, playerId);
  if (entry.finishedAt) return { ok: false, reason: 'already_finished' };

  // The index guards against a double-tap or a replayed message scoring twice.
  if (index !== entry.answers.length) return { ok: false, reason: 'out_of_step' };

  const question = room.sprint.questions[index];
  if (!question) return { ok: false, reason: 'out_of_step' };

  const correct = Number(choice) === question.answer;
  entry.answers.push({ index, choice: Number(choice), correct });
  if (correct) entry.score++;

  if (entry.answers.length >= room.sprint.questions.length) entry.finishedAt = Date.now();
  return { ok: true, correct, finished: !!entry.finishedAt };
}

// Everyone who could realistically still be answering — a person pencilled in
// from the host screen has no phone, so the room never waits on them.
export function pendingPlayers(room) {
  return [...room.players.values()].filter(
    p => !p.manual && !room.sprint.entries.get(p.id)?.finishedAt
  );
}

export function endSprint(room) {
  if (!room.sprint || room.phase !== 'sprint') return null;
  clearTimeout(room.sprint.timer);
  room.sprint.timer = null;

  // Anyone still mid-sprint is banked where they stand: answered questions
  // count, the rest are simply missing.
  for (const player of room.players.values()) {
    const entry = entryFor(room, player.id);
    if (!entry.finishedAt && entry.answers.length > 0) entry.finishedAt = Date.now();
  }

  room.results = rankEntries([...room.players.values()], room.sprint);
  // Fixed here rather than at draft time: the big screen animates this order,
  // and it must be the same order the draft actually uses.
  room.tiers = buildTiers(room.results);
  room.phase = 'reveal';
  broadcast(room);
  return room.results;
}

export function sprintSummary(room) {
  if (!room.sprint) return null;
  const players = [...room.players.values()];
  return {
    total: room.sprint.questions.length,
    startedAt: room.sprint.startedAt,
    endsAt: room.sprint.endsAt,
    msLeft: Math.max(0, room.sprint.endsAt - Date.now()),
    playing: players.filter(p => !p.manual).length,
    finished: players.filter(p => room.sprint.entries.get(p.id)?.finishedAt).length,
    // Progress only — how far along someone is says nothing about their score.
    progress: players.map(p => ({
      id: p.id,
      answered: room.sprint.entries.get(p.id)?.answers.length ?? 0,
      done: !!room.sprint.entries.get(p.id)?.finishedAt
    }))
  };
}

/* -------------------------------------------------------------------- draft */

export function startDraft(room) {
  const order = draftOrder(room.tiers);
  room.draft = {
    order,
    index: 0,
    assignments: new Map(),   // deskId -> { playerId, name, auto }
    autoTail: autoTailCount(room.layout.desks.length, order.length),
    current: null,
    timer: null
  };
  room.phase = 'draft';
  beginTurn(room);
  return room.draft;
}

export const remainingDeskIds = room =>
  room.layout.desks.filter(d => !room.draft.assignments.has(d.id)).map(d => d.id);

// Starts the next person's turn, or closes the draft out when the only people
// left are the tail who have nothing meaningful to choose between.
export function beginTurn(room) {
  const draft = room.draft;
  clearTimeout(draft.timer);
  draft.timer = null;

  const remainingPickers = draft.order.length - draft.index;
  if (remainingPickers <= draft.autoTail || remainingDeskIds(room).length === 0) {
    draft.current = null;
    return assignRest(room);
  }

  const seat = draft.order[draft.index];

  // An absent person (added from the host screen, never claimed by a phone)
  // has nobody to pick for them — assign instantly instead of making the
  // room watch a countdown that can only ever time out.
  if (room.players.get(seat.id)?.manual) {
    const deskId = sampleDesks(remainingDeskIds(room), 1)[0];
    if (deskId) {
      draft.assignments.set(deskId, { playerId: seat.id, name: seat.name, auto: true });
    }
    draft.index++;
    return beginTurn(room);
  }

  const options = sampleDesks(remainingDeskIds(room), seat.options);
  draft.current = {
    playerId: seat.id,
    name: seat.name,
    tier: seat.tier,
    options,
    endsAt: Date.now() + DRAFT_SECONDS * 1000
  };
  // A phone that's locked, dead, or in someone's pocket must not stall the room.
  draft.timer = setTimeout(() => {
    const auto = sampleDesks(draft.current.options, 1)[0];
    commitPick(room, draft.current.playerId, auto, true);
  }, DRAFT_SECONDS * 1000);

  return draft.current;
}

export function applyPick(room, playerId, deskId) {
  const draft = room.draft;
  if (!draft?.current) return { ok: false, reason: 'not_your_turn' };
  if (draft.current.playerId !== playerId) return { ok: false, reason: 'not_your_turn' };
  if (!draft.current.options.includes(deskId)) return { ok: false, reason: 'seat_not_offered' };
  commitPick(room, playerId, deskId, false);
  return { ok: true };
}

function commitPick(room, playerId, deskId, auto) {
  const draft = room.draft;
  if (!deskId || draft.assignments.has(deskId)) return;
  clearTimeout(draft.timer);
  draft.timer = null;

  draft.assignments.set(deskId, { playerId, name: nameOf(room, playerId), auto });
  draft.index++;
  draft.current = null;
  beginTurn(room);
  broadcast(room);
}

// Everyone left gets a desk at random. This is the tail whose "choice" would
// have been between the last few identical leftovers.
function assignRest(room) {
  const draft = room.draft;
  while (draft.index < draft.order.length) {
    const free = remainingDeskIds(room);
    if (free.length === 0) break;
    const seat = draft.order[draft.index++];
    const deskId = sampleDesks(free, 1)[0];
    draft.assignments.set(deskId, { playerId: seat.id, name: seat.name, auto: true });
  }
  room.phase = 'result';
  return null;
}

const nameOf = (room, playerId) => room.players.get(playerId)?.name ?? 'Unknown';

// Skip whoever is picking — for a phone that has plainly died on the day.
export function skipTurn(room) {
  const draft = room.draft;
  if (!draft?.current) return false;
  const auto = sampleDesks(draft.current.options, 1)[0];
  commitPick(room, draft.current.playerId, auto, true);
  return true;
}

export function draftSummary(room) {
  const draft = room.draft;
  if (!draft) return null;
  const desks = new Map(room.layout.desks.map(d => [d.id, d]));
  return {
    total: draft.order.length,
    index: draft.index,
    autoTail: draft.autoTail,
    order: draft.order.map(o => ({ id: o.id, name: o.name, tier: o.tier })),
    current: draft.current && {
      playerId: draft.current.playerId,
      name: draft.current.name,
      tier: draft.current.tier,
      // The big screen highlights these on the map, so it needs the desks too.
      options: draft.current.options.map(id => desks.get(id)),
      msLeft: Math.max(0, draft.current.endsAt - Date.now())
    },
    assignments: [...draft.assignments].map(([deskId, a]) => ({ deskId, ...a }))
  };
}

// What every client is allowed to know about the room right now.
export function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    layout: room.layout,
    seatCount: room.layout.desks.length,
    sprint: room.phase === 'sprint' ? sprintSummary(room) : null,
    results: room.results,
    questionTotal: room.sprint ? room.sprint.questions.length : null,
    tiers: room.tiers,
    draft: draftSummary(room),
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
