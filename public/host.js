// The big screen. Also the manager's control panel, because in a 20-person
// room the laptop driving the projector is the only authority that matters.
import { connect, errorText } from '/net.js';
import { renderMap, PERK_SHORT } from '/map.js';
import { downloadMapImage, seatingList } from '/mapimage.js';

const $ = id => document.getElementById(id);
const SAVED = 'seatdraft.host';
// Declared up here: start() runs at module load and calls show() immediately.
const VIEWS = ['startView', 'lobbyView', 'sprintView', 'revealView', 'tiersView', 'draftView', 'resultView'];

let net = null;
let session = null;   // { code, hostToken }
let state = null;
let managing = false;
// The reveal has two beats on one server phase: the board, then the pick order.
let revealStep = 'board';

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

  const newRoom = () => {
    if (!confirm('Start a brand new room? The current results will be lost.')) return;
    localStorage.removeItem(SAVED);
    location.reload();
  };
  $('againBtn2').addEventListener('click', newRoom);

  $('showTiersBtn').addEventListener('click', () => { revealStep = 'tiers'; render(); });
  $('backToBoard').addEventListener('click', () => { revealStep = 'board'; render(); });

  $('startDraftBtn').addEventListener('click', () => {
    $('startDraftBtn').disabled = true;
    net.send({ type: 'host:startDraft', code: session.code });
  });

  $('skipBtn').addEventListener('click', () => {
    if (confirm('Skip this turn? They will be given one of their options at random.')) {
      net.send({ type: 'host:skipTurn', code: session.code });
    }
  });

  $('downloadBtn').addEventListener('click', () => {
    downloadMapImage(state.layout, state.draft.assignments);
  });

  $('copyBtn').addEventListener('click', async () => {
    const text = seatingList(state.layout, state.draft.assignments);
    try {
      await navigator.clipboard.writeText(text);
      note('Copied — paste it straight into Slack or Teams.');
    } catch {
      // Clipboard access needs a secure context, which a LAN IP is not.
      note('Clipboard blocked here — the downloaded map has the same information.');
    }
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
    window.__state = state;   // read by the browser tests
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
  if (state.phase === 'reveal') return revealStep === 'tiers' ? renderTiers() : renderReveal();
  if (state.phase === 'draft') return renderDraft();
  if (state.phase === 'result') return renderResult();
  renderLobby();
}

function renderLobby() {
  stopClock();
  stopPickClock();
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

/* -------------------------------------------------------------------- tiers */

function renderTiers() {
  stopClock();
  show('tiersView');

  let seq = 0;
  $('tiers').innerHTML = (state.tiers || []).map(t => `
    <div class="tier tier-${t.tier}">
      <div class="tier-head">
        <h3>Tier ${t.tier}</h3>
        <span class="tier-opts">${t.options} desks each</span>
      </div>
      ${t.players.map(p => {
        seq++;
        // Staggered so the order lands one name at a time on the big screen.
        return `<div class="tname" style="animation-delay:${(seq - 1) * 70}ms">
                  <span class="seq">${seq}</span><span>${esc(p.name)}</span>
                </div>`;
      }).join('')}
    </div>`).join('');

  const shortfall = state.players.length - state.seatCount;
  $('tierWarn').classList.toggle('hidden', shortfall <= 0);
  if (shortfall > 0) {
    $('tierWarn').textContent = `There are ${shortfall} more people than desks — add desks in setup before drafting.`;
  }
  $('startDraftBtn').disabled = shortfall > 0;
}

/* -------------------------------------------------------------------- draft */

function renderDraft() {
  stopClock();
  show('draftView');
  const d = state.draft;

  $('pickIndex').textContent = d.index;
  $('pickTotal').textContent = d.total;

  if (d.current) {
    $('pickerName').textContent = d.current.name;
    $('pickerTier').textContent = `Tier ${d.current.tier} — choosing from ${d.current.options.length}`;
    $('optList').innerHTML = d.current.options.map(o => `
      <div class="opt-chip">
        <span>${esc(o.name)}</span>
        <span class="tag">${PERK_SHORT[o.perk] ? perkLabel(o.perk) : ''}</span>
      </div>`).join('');
    startPickClock(d.current.msLeft);
  } else {
    $('pickerName').textContent = 'Seating the rest…';
    $('pickerTier').textContent = '';
    $('optList').innerHTML = '';
  }

  renderMap($('draftMap'), state.layout, {
    assignments: d.assignments,
    offered: d.current ? d.current.options.map(o => o.id) : []
  });
}

const PERK_LABELS = { window: 'Window', corner: 'Corner', quiet: 'Quiet', social: 'Social hub', meh: 'Near the AC' };
const perkLabel = p => PERK_LABELS[p] || '';

let pickTimer = null;
let pickDeadline = 0;

function startPickClock(msLeft) {
  pickDeadline = Date.now() + Math.max(0, msLeft ?? 0);
  if (pickTimer) return;
  const tick = () => {
    const secs = Math.ceil(Math.max(0, pickDeadline - Date.now()) / 1000);
    $('pickClock').textContent = secs;
    $('pickClock').classList.toggle('low', secs <= 5);
  };
  tick();
  pickTimer = setInterval(tick, 200);
}

function stopPickClock() { clearInterval(pickTimer); pickTimer = null; }

/* ------------------------------------------------------------------- result */

function renderResult() {
  stopClock();
  stopPickClock();
  show('resultView');

  renderMap($('resultMap'), state.layout, { assignments: state.draft.assignments });

  const total = state.questionTotal ?? 10;
  $('miniBoard').innerHTML = (state.results || []).slice(0, 5).map(r => `
    <div class="row spread small">
      <span><b>${r.rank}</b> &nbsp;${esc(r.name)}</span>
      <span class="muted">${r.score}/${total}</span>
    </div>`).join('');
}

let noteTimer;
function note(text) {
  const el = $('copyNote');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.add('hidden'), 5000);
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
