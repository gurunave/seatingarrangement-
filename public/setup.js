// Layout editor. The whole layout lives in one object; every action mutates it
// and re-renders. At 70 cells that is far cheaper than tracking diffs.
const $ = id => document.getElementById(id);

let grid = { cols: 10, rows: 7 };
let perks = {};
let layout = { windowSide: 'top', desks: [] };
let selectedId = null;
let movingId = null;
let dirty = false;

const mapEl = $('map');

init();

async function init() {
  const res = await fetch('/api/layout');
  const data = await res.json();
  grid = data.grid;
  perks = data.perks;
  layout = data.layout;

  $('deskPerk').innerHTML = Object.entries(perks)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('windowSide').value = layout.windowSide;

  mapEl.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
  wireEvents();
  render();
}

function wireEvents() {
  mapEl.addEventListener('click', onMapClick);

  $('windowSide').addEventListener('change', e => { layout.windowSide = e.target.value; markDirty(); });

  $('deskName').addEventListener('input', e => {
    const desk = selected();
    if (!desk) return;
    desk.name = e.target.value.slice(0, 12);
    markDirty();
    renderMap(); // live-update the tile without stealing focus from the input
  });

  $('deskPerk').addEventListener('change', e => {
    const desk = selected();
    if (!desk) return;
    desk.perk = e.target.value;
    markDirty();
    render();
  });

  $('move').addEventListener('click', () => {
    movingId = movingId === selectedId ? null : selectedId;
    render();
    if (movingId) notice('Now click the square you want to move it to.', 'ok');
  });

  $('delete').addEventListener('click', () => {
    layout.desks = layout.desks.filter(d => d.id !== selectedId);
    selectedId = movingId = null;
    markDirty();
    render();
  });

  $('fill').addEventListener('click', async () => {
    if (layout.desks.length && !confirm('Replace the current layout with a fresh 20-desk grid?')) return;
    const fresh = await (await fetch('/api/layout/default')).json();
    layout = fresh.layout;
    $('windowSide').value = layout.windowSide;
    selectedId = movingId = null;
    markDirty(); // a reset is an unsaved edit until they press Save
    render();
    notice('Reset to a default 20-desk layout.', 'ok');
  });

  $('clear').addEventListener('click', () => {
    if (!confirm('Remove every desk?')) return;
    layout.desks = [];
    selectedId = movingId = null;
    markDirty();
    render();
  });

  $('save').addEventListener('click', save);

  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function onMapClick(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  const existing = deskAt(r, c);

  if (movingId) {
    if (existing) { notice('That square is taken. Pick an empty one.', 'err'); return; }
    const desk = layout.desks.find(d => d.id === movingId);
    desk.r = r; desk.c = c;
    movingId = null;
    markDirty();
    render();
    return;
  }

  if (existing) {
    selectedId = existing.id;
    render();
    return;
  }

  const desk = { id: `d${Date.now().toString(36)}${layout.desks.length}`, name: nextName(), r, c, perk: 'none' };
  layout.desks.push(desk);
  selectedId = desk.id;
  markDirty();
  render();
}

// Desk names default to a spreadsheet-ish sequence so a 20-desk room can be
// filled quickly without typing, but every one stays editable.
function nextName() {
  const used = new Set(layout.desks.map(d => d.name));
  for (let i = 1; i <= 200; i++) {
    const name = `${String.fromCharCode(65 + Math.floor((i - 1) / 5))}${((i - 1) % 5) + 1}`;
    if (!used.has(name)) return name;
  }
  return `D${layout.desks.length + 1}`;
}

const deskAt = (r, c) => layout.desks.find(d => d.r === r && d.c === c);
const selected = () => layout.desks.find(d => d.id === selectedId);

function render() { renderMap(); renderSidebar(); }

function renderMap() {
  const cells = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const desk = deskAt(r, c);
      if (!desk) {
        cells.push(`<div class="cell empty" data-r="${r}" data-c="${c}"></div>`);
        continue;
      }
      const cls = ['cell', 'desk', desk.id === selectedId ? 'selected' : '', desk.id === movingId ? 'moving' : ''];
      const short = perks[desk.perk]?.short || '';
      cells.push(
        `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}" data-perk="${desk.perk}" title="${esc(perks[desk.perk]?.label || '')}">
           <span>${esc(desk.name)}</span>${short ? `<span class="perk">${esc(short)}</span>` : ''}
         </div>`
      );
    }
  }
  mapEl.innerHTML = cells.join('');
}

function renderSidebar() {
  const desk = selected();
  const n = layout.desks.length;
  const countEl = $('count');
  countEl.textContent = n;
  countEl.classList.toggle('short', n < 20);

  $('editor').classList.toggle('hidden', !desk);
  $('hint').classList.toggle('hidden', !!desk);

  if (desk) {
    if ($('deskName').value !== desk.name) $('deskName').value = desk.name;
    $('deskPerk').value = desk.perk;
    $('move').textContent = movingId ? 'Cancel move' : 'Move to another square';
  }
}

function markDirty() {
  dirty = true;
  $('save').textContent = 'Save layout •';
}

async function save() {
  $('save').disabled = true;
  try {
    const res = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout)
    });
    if (!res.ok) throw new Error('save failed');
    const data = await res.json();
    layout = data.layout;
    dirty = false;
    $('save').textContent = 'Save layout';
    render();
    notice(`Saved — ${layout.desks.length} desks. This layout is reused every time you run the game.`, 'ok');
  } catch {
    notice('Could not save. Check the server is still running.', 'err');
  } finally {
    $('save').disabled = false;
  }
}

let noticeTimer;
function notice(text, kind) {
  const el = $('notice');
  el.textContent = text;
  el.className = `notice ${kind}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
