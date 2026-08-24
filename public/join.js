// The phone. It has one job right now — get you into the lobby and keep you
// there through a screen lock, a refresh, or a WiFi wobble.
import { connect, errorText } from '/net.js';

const $ = id => document.getElementById(id);
const SAVED = 'seatdraft.session';

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
      show('lobbyView');
      break;

    case 'state':
      $('playerCount').textContent = msg.state.players.length;
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

function finish(text) {
  localStorage.removeItem(SAVED);
  $('doneMsg').textContent = text;
  show('doneView');
}

function show(id) {
  for (const v of ['joinView', 'lobbyView', 'doneView']) {
    $(v).classList.toggle('hidden', v !== id);
  }
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
