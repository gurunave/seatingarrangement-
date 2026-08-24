// The phone. It has one job right now — get you into the lobby and keep you
// there through a screen lock, a refresh, or a WiFi wobble.
import { connect, errorText } from '/net.js';

const $ = id => document.getElementById(id);
const SAVED = 'seatdraft.session';
// Declared up here so show() is safe to call from the moment the module runs.
const VIEWS = ['joinView', 'lobbyView', 'sprintView', 'waitView', 'resultView',
               'draftWaitView', 'turnView', 'seatedView', 'doneView'];

let net = null;
let me = null;   // { code, playerId, name }

start();

function start() {
  // A code in the URL (?c=ABCD, or a /?ABCD-style share link) saves 20 people
  // typing it wrong off a projector.
  const fromUrl = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (fromUrl) $('codeInput').value = fromUrl.slice(0, 4);

  $('codeInput').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (e.target.value.length === 4) $('nameInput').focus();
  });

  $('joinBtn').addEventListener('click', join);
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('nameInput').focus(); });

  $('leaveBtn').addEventListener('click', () => {
    localStorage.removeItem(SAVED);
    location.href = location.pathname;
  });
  $('againBtn').addEventListener('click', () => {
    localStorage.removeItem(SAVED);
    location.href = location.pathname;
  });

  net = connect({ onMessage, onStatus });

  const saved = readSaved();
  if (saved) {
    me = saved;
    if (!fromUrl) $('codeInput').value = saved.code;
    $('nameInput').value = saved.name;
    net.send({ type: 'player:resume', code: saved.code, playerId: saved.playerId });
  } else if (fromUrl) {
    $('nameInput').focus();
  } else {
    $('codeInput').focus();
  }
}

function join() {
  const code = $('codeInput').value.trim().toUpperCase();
  const name = $('nameInput').value.trim();
  if (code.length !== 4) return showError('Enter the 4-letter code from the big screen.');
  if (name.length < 2) return showError('Enter your name so the room knows who you are.');
  hideError();
  $('joinBtn').disabled = true;
  me = { code, name, playerId: null };
  net.send({ type: 'player:join', code, name });
  // If the server never answers, don't leave the button dead forever.
  setTimeout(() => { $('joinBtn').disabled = false; }, 4000);
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined':
      me = { code: me?.code || msg.code, playerId: msg.playerId, name: msg.name };
      localStorage.setItem(SAVED, JSON.stringify(me));
      $('myName').textContent = msg.name;
      $('joinBtn').disabled = false;
      // A sprint:question or sprint:done follows immediately when the game is
      // already running, so only claim the lobby if we're actually in it.
      if ($('sprintView').classList.contains('hidden') && $('turnView').classList.contains('hidden')) {
        show('lobbyView');
      }
      break;

    case 'state':
      onState(msg.state);
      break;

    case 'sprint:question':
      afterVerdict(() => renderQuestion(msg.question, msg.msLeft));
      break;

    case 'sprint:result':
      showVerdict(msg.correct);
      break;

    case 'sprint:done':
      afterVerdict(() => { stopClock(); show('waitView'); });
      break;

    case 'kicked':
      finish("You've been removed from this room.");
      break;

    case 'replaced':
      finish('You joined from another device — this one is now inactive.');
      break;

    case 'error':
      $('joinBtn').disabled = false;
      // A stale saved session is expected after a server restart: quietly fall
      // back to the join form rather than blaming the person holding the phone.
      if (msg.code === 'unknown_player' || msg.code === 'no_such_room') {
        if (localStorage.getItem(SAVED)) {
          localStorage.removeItem(SAVED);
          me = null;
          show('joinView');
          return;
        }
      }
      if (msg.code === 'out_of_step' || msg.code === 'not_in_sprint') {
        answering = false;
        return;   // the server's next question message is the source of truth
      }
      if (msg.code === 'not_your_turn' || msg.code === 'seat_not_offered' || msg.code === 'not_in_draft') {
        turnOptions = [];   // force a rebuild from the next state we're sent
        return;
      }
      showError(errorText(msg.code));
      break;
  }
}

function onStatus(status) {
  $('conn').classList.toggle('hidden', status === 'online');
  // On reconnect the socket is new, so re-announce who we are.
  if (status === 'online' && me?.playerId) {
    net.send({ type: 'player:resume', code: me.code, playerId: me.playerId });
  }
}

// The phone follows whatever phase the room is in, so a reconnect mid-game
// lands on the right screen rather than back in the lobby.
function onState(state) {
  $('playerCount').textContent = state.players.length;

  if (state.phase === 'sprint' && state.sprint) {
    const left = state.sprint.playing - state.sprint.finished;
    $('waitCount').textContent = Math.max(0, left);
    return;
  }

  if (state.phase === 'reveal' && state.results) {
    stopClock();
    renderMyResult(state.results, state.questionTotal ?? 10);
    return;
  }

  if (state.phase === 'draft') return renderDraft(state);
  if (state.phase === 'result') return renderSeated(state);
}

/* -------------------------------------------------------------------- draft */

const PERK_LABELS = {
  window: 'By the window', corner: 'Corner desk', quiet: 'Quiet spot',
  social: 'Social hub', meh: 'Near the AC', none: ''
};

function renderDraft(state) {
  stopClock();
  const d = state.draft;
  const mine = d.current && d.current.playerId === me?.playerId;

  // Already seated while others are still picking.
  const seat = d.assignments.find(a => a.playerId === me?.playerId);
  if (seat && !mine) return renderSeated(state, false);

  if (mine) {
    renderTurn(d.current);
    return;
  }

  stopTurnClock();
  const myTier = (state.tiers || []).find(t => t.players.some(p => p.id === me?.playerId));
  $('myTier').textContent = myTier ? `Tier ${myTier.tier} — ${myTier.options} desks to choose from` : 'Waiting';
  $('whoPicking').textContent = d.current ? d.current.name : 'Seating the rest…';
  $('seatedCount').textContent = d.index;
  $('seatTotal').textContent = d.total;
  show('draftWaitView');
}

let turnOptions = [];

function renderTurn(current) {
  // Re-rendering on every broadcast would wipe a tap mid-flight; the options
  // for one turn never change, so only build them once.
  const ids = current.options.map(o => o.id).join(',');
  if (ids !== turnOptions.join(',')) {
    turnOptions = current.options.map(o => o.id);
    $('seatOpts').innerHTML = current.options.map(o => `
      <button class="seat-opt" data-id="${o.id}">
        <span class="nm">${esc(o.name)}</span>
        <span class="pk">${PERK_LABELS[o.perk] || 'Standard desk'}</span>
      </button>`).join('');
    $('seatOpts').querySelectorAll('.seat-opt').forEach(btn => {
      btn.addEventListener('click', () => claim(btn.dataset.id), { once: true });
    });
  }
  startTurnClock(current.msLeft);
  show('turnView');
}

function claim(deskId) {
  $('seatOpts').querySelectorAll('.seat-opt').forEach(b => { b.disabled = true; });
  net.send({ type: 'draft:pick', code: me.code, deskId });
}

function renderSeated(state, final = true) {
  stopTurnClock();
  turnOptions = [];
  const seat = state.draft?.assignments.find(a => a.playerId === me?.playerId);
  const desk = seat && (state.layout.desks || []).find(d => d.id === seat.deskId);
  if (!desk) return;

  $('mySeat').textContent = desk.name;
  $('mySeatPerk').textContent = PERK_LABELS[desk.perk] || 'Standard desk';
  $('mySeatNote').textContent = seat.auto
    ? 'Assigned automatically — better luck next quarter.'
    : final ? 'See the big screen for the full map.' : 'Sit tight while everyone else picks.';
  show('seatedView');
}

let turnTimer = null;
let turnDeadline = 0;

function startTurnClock(msLeft) {
  turnDeadline = Date.now() + Math.max(0, msLeft ?? 0);
  if (turnTimer) return;
  const tick = () => {
    const secs = Math.ceil(Math.max(0, turnDeadline - Date.now()) / 1000);
    $('turnClock').textContent = secs;
    $('turnClock').classList.toggle('low', secs <= 5);
  };
  tick();
  turnTimer = setInterval(tick, 200);
}

function stopTurnClock() { clearInterval(turnTimer); turnTimer = null; }

function renderMyResult(results, total) {
  const mine = results.find(r => r.id === me?.playerId);
  if (!mine) return;
  $('myRank').textContent = ordinal(mine.rank);
  $('myScore').textContent = `${mine.score} of ${total} correct`;
  $('myTime').textContent = mine.elapsedMs != null
    ? `in ${(mine.elapsedMs / 1000).toFixed(1)}s`
    : 'did not finish';
  show('resultView');
}

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* ------------------------------------------------------------------- sprint */

let clockTimer = null;
let deadline = 0;
let answering = false;
let verdictUntil = 0;

const VERDICT_MS = 420;

// The server answers a tap with the verdict and the next question back to back.
// Without this the green/red flash would be overwritten in the same frame.
function afterVerdict(fn) {
  const wait = verdictUntil - Date.now();
  if (wait > 0) setTimeout(fn, wait); else fn();
}

function renderQuestion(q, msLeft) {
  answering = false;
  $('qNum').textContent = q.index + 1;
  $('qTotal').textContent = q.total;
  $('qbar').style.width = `${(q.index / q.total) * 100}%`;
  $('question').textContent = q.text;
  $('verdict').textContent = '';
  $('verdict').className = 'verdict';

  $('options').innerHTML = q.options
    .map(o => `<button class="opt" data-v="${o}">${o}</button>`).join('');
  $('options').querySelectorAll('.opt').forEach(btn => {
    btn.addEventListener('click', () => answer(q.index, Number(btn.dataset.v), btn), { once: true });
  });

  startClock(msLeft);
  show('sprintView');
}

function answer(index, choice, btn) {
  if (answering) return;   // a double-tap must not count twice
  answering = true;
  btn.dataset.chosen = '1';
  $('options').querySelectorAll('.opt').forEach(b => { b.disabled = true; });
  net.send({ type: 'sprint:answer', code: me.code, index, choice });
}

function showVerdict(correct) {
  verdictUntil = Date.now() + VERDICT_MS;
  const chosen = $('options').querySelector('.opt[data-chosen]');
  if (chosen) chosen.classList.add(correct ? 'right' : 'wrong');
  const v = $('verdict');
  v.textContent = correct ? 'Correct' : 'Wrong';
  v.className = `verdict ${correct ? 'right' : 'wrong'}`;
}

function startClock(msLeft) {
  deadline = Date.now() + Math.max(0, msLeft ?? 0);
  if (clockTimer) return;   // one ticker for the whole sprint, not one per question
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const secs = Math.ceil(left / 1000);
    $('clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('clock').classList.toggle('low', secs <= 10);
  };
  tick();
  clockTimer = setInterval(tick, 250);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

function finish(text) {
  localStorage.removeItem(SAVED);
  $('doneMsg').textContent = text;
  show('doneView');
}

function show(id) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== id);
}

function showError(text) {
  const el = $('joinErr');
  el.textContent = text;
  el.classList.remove('hidden');
}

const hideError = () => $('joinErr').classList.add('hidden');

function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED) || 'null');
    return s?.code && s?.playerId ? s : null;
  } catch { return null; }
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
