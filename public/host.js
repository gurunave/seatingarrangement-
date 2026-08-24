// The big screen. Also the manager's control panel, because in a 20-person
// room the laptop driving the projector is the only authority that matters.
import { connect, errorText } from '/net.js';

const $ = id => document.getElementById(id);
const SAVED = 'seatdraft.host';

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
    // Phase 2 lands here next — the maths sprint.
    $('startHint').textContent = 'The maths sprint is the next thing being built.';
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
  for (const v of ['startView', 'lobbyView']) $(v).classList.toggle('hidden', v !== id);
}

function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED) || 'null');
    return s?.code && s?.hostToken ? s : null;
  } catch { return null; }
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
