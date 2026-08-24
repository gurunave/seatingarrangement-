// Rehearsal control panel: start/stop bots and watch what they're up to.
const $ = id => document.getElementById(id);

let pollTimer = null;

init();

function init() {
  const fromUrl = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (fromUrl) $('codeInput').value = fromUrl.slice(0, 4);

  $('codeInput').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });
  $('countInput').addEventListener('input', e => { $('countVal').textContent = e.target.value; });

  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', stop);

  if (fromUrl) poll();
}

async function start() {
  const code = $('codeInput').value.trim();
  if (code.length !== 4) return notice('Enter the 4-letter room code from the big screen.', 'err');

  $('startBtn').disabled = true;
  try {
    const res = await fetch('/api/sim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, count: Number($('countInput').value) })
    });
    const data = await res.json();
    if (!res.ok) return notice(explain(data.error), 'err');
    notice(`${data.bots.length} test players joining. Watch the big screen fill up, then start the sprint from there.`, 'ok');
    render(data);
    startPolling();
  } finally {
    $('startBtn').disabled = false;
  }
}

async function stop() {
  const code = $('codeInput').value.trim();
  if (code.length !== 4) return;
  const res = await fetch('/api/sim', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (res.ok) {
    notice('Test players disconnected. They stay on the roster as offline — remove them from the big screen\'s Manage panel, or just make a fresh room.', 'ok');
    render({ bots: [] });
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 1500);
}

async function poll() {
  const code = $('codeInput').value.trim();
  if (code.length !== 4) return;
  const res = await fetch(`/api/sim?code=${encodeURIComponent(code)}`);
  if (!res.ok) return;
  render(await res.json());
}

function render(data) {
  const bots = data.bots || [];
  $('botCount').textContent = bots.length ? `${bots.length} active` : '';
  $('botEmpty').classList.toggle('hidden', bots.length > 0);
  $('botList').innerHTML = bots.map(b =>
    `<div class="bot"><span>${esc(b.name)}</span><span class="st">${esc(b.state)}</span></div>`).join('');
}

function explain(code) {
  return {
    no_such_room: 'No room with that code — create one on the big screen first.',
    already_started: 'That game has already started. Bots can only join the lobby.',
    room_full: 'The room is already full.',
    bad_count: 'Pick how many test players to add.'
  }[code] || 'Something went wrong.';
}

let noticeTimer;
function notice(text, kind) {
  const el = $('notice');
  el.textContent = text;
  el.className = `notice ${kind}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.classList.add('hidden'), 8000);
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
