// Durable bits that outlive a single session: the room layout.
// A quarterly event shouldn't make you rebuild the office map every time.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const LAYOUT_FILE = join(DATA_DIR, 'layout.json');

export const GRID = { cols: 10, rows: 7 };

// Perks are the "mild preferences" — they colour the map and give the draft
// something to talk about, but they carry no mechanical weight.
export const PERKS = {
  none:   { label: 'Standard',  short: '' },
  window: { label: 'Window',    short: 'W' },
  corner: { label: 'Corner',    short: 'C' },
  quiet:  { label: 'Quiet',     short: 'Q' },
  social: { label: 'Social hub', short: 'S' },
  meh:    { label: 'Near the AC', short: '!' }
};

export function defaultLayout() {
  // Two rows of desks along a window, two rows inland — a plausible starting
  // point that the manager is expected to rearrange in the setup screen.
  const desks = [];
  let n = 0;
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 5; c++) {
      n++;
      desks.push({
        id: `d${n}`,
        name: `${String.fromCharCode(64 + r)}${c}`,
        r, c: c + 2,
        perk: r === 1 ? 'window' : r === 4 ? 'meh' : 'none'
      });
    }
  }
  return { version: 1, updatedAt: Date.now(), windowSide: 'top', desks };
}

let cache = null;

export async function loadLayout() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(LAYOUT_FILE, 'utf8'));
  } catch {
    cache = defaultLayout();
  }
  return cache;
}

export async function saveLayout(layout) {
  const clean = sanitizeLayout(layout);
  cache = clean;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LAYOUT_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

// The layout arrives from a browser, so trust nothing: clamp every desk to the
// grid, drop duplicates on the same cell, and cap the total.
export function sanitizeLayout(input) {
  const seen = new Set();
  const desks = [];
  for (const d of Array.isArray(input?.desks) ? input.desks : []) {
    const r = clampInt(d?.r, 0, GRID.rows - 1);
    const c = clampInt(d?.c, 0, GRID.cols - 1);
    const cell = `${r}:${c}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    const name = String(d?.name ?? '').trim().slice(0, 12) || `${r + 1}-${c + 1}`;
    const reservedFor = String(d?.reservedFor ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    desks.push({
      id: typeof d?.id === 'string' && d.id ? d.id.slice(0, 24) : `d${desks.length + 1}`,
      name, r, c,
      perk: Object.hasOwn(PERKS, d?.perk) ? d.perk : 'none',
      ...(reservedFor ? { reservedFor } : {})
    });
    if (desks.length >= 60) break;
  }
  return {
    version: 1,
    updatedAt: Date.now(),
    windowSide: ['top', 'bottom', 'left', 'right'].includes(input?.windowSide) ? input.windowSide : 'top',
    desks
  };
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
