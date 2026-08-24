// The big screen. Also the manager's control panel, because in a 20-person
// room the laptop driving the projector is the only authority that matters.
import { connect, errorText } from '/net.js';

const $ = id => document.getElementById(id);
const SAVED = 'seatdraft.host';
// Declared up here: start() runs at module load and calls show() immediately.
const VIEWS = ['startView', 'lobbyView', 'sprintView', 'revealView'];

let net = null;
let session = null;   // { code, hostToken }
let state = null;
let managing = false;

start();

async function start() {
  net = connect({ onMessage, onStatus });
  wire();

  const saved = readSaved();
  if (saved && await roomStillExists(saved.code)) {
    session = saved;
    joinAsHost();
  } else {
    localStorage.removeItem(SAVED);
    await showStartView();
  }
}

function wire() {
  $('createBtn').addEventListener('click', createRoom);
  $('toggleManage').addEventListener('click', () => {
    managing = !managing;
    $('manage').classList.toggle('hidden', !managing);
    $('toggleManage').textContent = managing ? 'Done' : 'Manage';
    render();
  });
  $('addBtn').addEventListener('click', addPlayer);
  $('addName').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

  $('startBtn').addEventListener('click', () => {
    $('startBtn').disabled = true;
    net.send({ type: 'host:start', code: session.code });
  });

  $('endBtn').addEventListener('click', () => {
    if (confirm('End the sprint now? Anyone still answering keeps what they have so far.')) {
      net.send({ type: 'host:endSprint', code: session.code });
    }
  });

  $('againBtn').addEventListener('click', () => {
    if (!confirm('Start a brand new room? The current results will be lost.')) return;
    localStorage.removeItem(SAVED);
    location.reload();
  });
}

async function showStartView() {
  show('startView');
  try {
    const { layout } = await (await fetch('/api/layout')).json();
    const n = layout.desks.length;
    $('deskCount').textContent = n;
    if (n === 0) {
      warn('No desks yet — set up your room layout first.');
      $('createBtn').disabled = true;
    } else if (n < 20) {
      warn(`Only ${n} desks for a team of 20. You can still play, but some people won't get a seat.`);
    }
  } catch {
    warn('Could not reach the server.');
  }
}

function warn(text) {
  $('deskWarn').textContent = text;
  $('deskWarn').classList.remove('hidden');
}

async function roomStillExists(code) {
  try {
    return (await fetch(`/api/room?code=${encodeURIComponent(code)}`)).ok;
  } catch { return false; }
}

async function createRoom() {
  $('createBtn').disabled = true;
  try {
    const res = await fetch('/api/room', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    session = { code: data.code, hostToken: data.hostToken };
    localStorage.setItem(SAVED, JSON.stringify(session));
    joinAsHost();
  } catch (err) {
    warn(errorText(String(err.message)));
    $('createBtn').disabled = false;
  }
}

function joinAsHost() {
  net.send({ type: 'host:join', code: session.code, hostToken: session.hostToken });
  $('code').textContent = session.code;
  // The URL people actually type. On a laptop this is the LAN address, which
  // is exactly what the room needs to see.
  $('joinUrl').textContent = `${location.host}`;
  show('lobbyView');
}

function onMessage(msg) {
  if (msg.type === 'state') {
    state = msg.state;
    render();
    return;
  }
  if (msg.type === 'error') {
    if (msg.code === 'no_such_room' || msg.code === 'not_host') {
      localStorage.removeItem(SAVED);
      session = null;
      showStartView();
      return;
    }
    showManageError(errorText(msg.code));
  }
}

function onStatus(status) {
  $('conn').classList.toggle('hidden', status === 'online');
  if (status === 'online' && session) {
    net.send({ type: 'host:join', code: session.code, hostToken: session.hostToken });
  }
}

function render() {
  if (!state) return;

  if (state.phase === 'sprint') return renderSprint();
  if (state.phase === 'reveal') return renderReveal();
  renderLobby();
}

function renderLobby() {
  stopClock();
  show('lobbyView');
  const players = state.players;

  $('joined').textContent = players.length;
  $('seats').textContent = state.seatCount;
  $('empty').classList.toggle('hidden', players.length > 0);

  $('roster').innerHTML = players.map(p => `
    <div class="chip ${p.connected ? '' : 'off'}">
      <span class="dot"></span><span class="nm">${esc(p.name)}</span>
    </div>`).join('');

  const ready = players.length >= 2 && players.length <= state.seatCount;
  $('startBtn').disabled = !ready;
  $('startHint').textContent =
    players.length < 2 ? 'Waiting for people to join…'
    : players.length > state.seatCount ? `More people than desks — add ${players.length - state.seatCount} more desk(s) in setup.`
    : `Ready when you are — ${players.length} playing for ${state.seatCount} desks.`;

  if (managing) renderManageList(players);
}

/* ------------------------------------------------------------------- sprint */

let clockTimer = null;
let deadline = 0;

function renderSprint() {
  show('sprintView');
  const { sprint, players } = state;
  const byId = new Map(players.map(p => [p.id, p]));

  $('doneCount').textContent = sprint.finished;
  $('playingCount').textContent = sprint.playing;
  startClock(sprint.msLeft);

  $('pgrid').innerHTML = sprint.progress.map(pr => {
    const player = byId.get(pr.id);
    if (!player || player.manual) return '';   // pencilled in, no phone to answer on
    const pips = Array.from({ length: sprint.total }, (_, i) =>
      `<i class="${i < pr.answered ? 'on' : ''}"></i>`).join('');
    return `<div class="pcard ${pr.done ? 'done' : ''}">
        <div class="nm">${esc(player.name)}${pr.done ? ' ✓' : ''}</div>
        <div class="pips">${pips}</div>
      </div>`;
  }).join('');
}

// Ticks locally between broadcasts; each state message re-anchors it, so it
// never drifts far from the server's real deadline.
function startClock(msLeft) {
  deadline = Date.now() + Math.max(0, msLeft ?? 0);
  if (clockTimer) return;
  const tick = () => {
    const secs = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
    $('sprintClock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('sprintClock').classList.toggle('low', secs <= 10);
  };
  tick();
  clockTimer = setInterval(tick, 250);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

/* ------------------------------------------------------------------- reveal */

function renderReveal() {
  stopClock();
  show('revealView');
  const total = state.questionTotal ?? 10;
  const results = state.results || [];
  $('board').style.setProperty('--rows', Math.ceil(results.length / 2));

  $('board').innerHTML = results.map(r => `
    <div class="lrow ${r.rank <= 5 ? 'top' : ''}">
      <span class="pos">${r.rank}</span>
      <span class="who">${esc(r.name)}</span>
      <span class="sc">${r.score}<span class="muted" style="font-size:14px; font-weight:600">/${total}</span></span>
      <span class="tm">${r.elapsedMs != null ? (r.elapsedMs / 1000).toFixed(1) + 's' : '—'}</span>
    </div>`).join('');
}

function renderManageList(players) {
  $('manageList').innerHTML = players.map(p => `
    <div class="manage-row" data-id="${p.id}">
      <span class="grow">${esc(p.name)}</span>
      ${p.manual ? '<span class="tag">NO PHONE</span>' : ''}
      ${p.connected ? '' : '<span class="muted small">offline</span>'}
      <button class="tiny" data-act="rename">Rename</button>
      <button class="tiny danger" data-act="remove">Remove</button>
    </div>`).join('');

  $('manageList').onclick = e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const playerId = btn.closest('.manage-row').dataset.id;
    const player = state.players.find(p => p.id === playerId);
    if (btn.dataset.act === 'remove') {
      if (confirm(`Remove ${player.name} from the room?`)) {
        net.send({ type: 'host:removePlayer', code: session.code, playerId });
      }
    } else {
      const name = prompt('New name', player.name);
      if (name?.trim()) net.send({ type: 'host:renamePlayer', code: session.code, playerId, name: name.trim() });
    }
  };
}

function addPlayer() {
  const name = $('addName').value.trim();
  if (name.length < 2) return showManageError('Enter a name.');
  net.send({ type: 'host:addPlayer', code: session.code, name });
  $('addName').value = '';
  $('manageErr').classList.add('hidden');
}

let errTimer;
function showManageError(text) {
  const el = $('manageErr');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(errTimer);
  errTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function show(id) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
}

function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED) || 'null');
    return s?.code && s?.hostToken ? s : null;
  } catch { return null; }
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
