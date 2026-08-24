// Renders the final seating to a PNG the manager can drop into Slack, and to a
// plain text list for pasting anywhere else.
import { bounds } from '/map.js';

const CELL = 168;
const GAP = 12;
const PAD = 44;
const HEADER = 116;
const FOOTER = 52;

const COLORS = {
  bg: '#0e1116', panel: '#171b23', line: '#2b3342',
  ink: '#eef2f8', dim: '#97a3b6',
  chosen: '#253044', chosenLine: '#3d4a63',
  auto: '#2a2733', autoLine: '#4a4358',
  reserved: '#2c2838', reservedLine: '#7a6f96',
  window: '#4d9dff', meh: '#ff8f6b', accent: '#4d9dff'
};

export function drawMap(canvas, layout, assignments) {
  const desks = layout.desks || [];
  const b = bounds(desks);
  const seatOf = new Map(assignments.map(a => [a.deskId, a]));

  const width = PAD * 2 + b.cols * CELL + (b.cols - 1) * GAP;
  const height = HEADER + PAD + b.rows * CELL + (b.rows - 1) * GAP + FOOTER;

  // Render at 2x so the image still looks sharp pasted into Slack.
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '700 34px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Seating', PAD, 62);

  ctx.fillStyle = COLORS.dim;
  ctx.font = '500 17px Inter, system-ui, sans-serif';
  ctx.fillText(
    new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    PAD, 88
  );

  for (const desk of desks) {
    const x = PAD + (desk.c - b.minC) * (CELL + GAP);
    const y = HEADER + (desk.r - b.minR) * (CELL + GAP);
    const seat = desk.reservedFor ? { name: desk.reservedFor, reserved: true } : seatOf.get(desk.id);

    ctx.fillStyle = seat ? (seat.reserved ? COLORS.reserved : seat.auto ? COLORS.auto : COLORS.chosen) : COLORS.panel;
    ctx.strokeStyle = seat?.reserved ? COLORS.reservedLine
      : desk.perk === 'window' ? COLORS.window
      : desk.perk === 'meh' ? COLORS.meh
      : seat ? (seat.auto ? COLORS.autoLine : COLORS.chosenLine) : COLORS.line;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, CELL, CELL, 14);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 14px ui-monospace, Menlo, monospace';
    ctx.fillText(desk.name.toUpperCase(), x + CELL / 2, y + 30);

    if (desk.facing) drawFacing(ctx, desk.facing, x, y);

    if (seat) {
      ctx.fillStyle = COLORS.ink;
      fitText(ctx, seat.name, CELL - 20, 24, x + CELL / 2, y + CELL / 2 + 12);
    }
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = COLORS.dim;
  ctx.font = '500 15px Inter, system-ui, sans-serif';
  const reserved = desks.filter(d => d.reservedFor).length;
  ctx.fillText(
    `${assignments.length} seated${reserved ? ` · ${reserved} reserved` : ''} · window side: ${layout.windowSide}`,
    PAD, height - 22
  );

  return canvas;
}

// A small triangle in the desk's corner showing which way the person faces.
function drawFacing(ctx, facing, x, y) {
  const cx = x + CELL - 22, cy = y + 24, r = 7;
  const points = {
    up:    [[cx, cy - r], [cx - r, cy + r], [cx + r, cy + r]],
    down:  [[cx, cy + r], [cx - r, cy - r], [cx + r, cy - r]],
    left:  [[cx - r, cy], [cx + r, cy - r], [cx + r, cy + r]],
    right: [[cx + r, cy], [cx - r, cy - r], [cx - r, cy + r]]
  }[facing];
  if (!points) return;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  ctx.lineTo(...points[1]);
  ctx.lineTo(...points[2]);
  ctx.closePath();
  ctx.fillStyle = COLORS.accent;
  ctx.fill();
}

// Shrink a name until it fits its desk rather than letting it spill out.
function fitText(ctx, text, maxWidth, startSize, x, y) {
  let size = startSize;
  do {
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    size -= 1;
  } while (ctx.measureText(text).width > maxWidth && size > 10);
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadMapImage(layout, assignments) {
  const canvas = document.createElement('canvas');
  drawMap(canvas, layout, assignments);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seating-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has already started the save.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

// Reading order — top-left to bottom-right — so the list matches the map.
export function seatingList(layout, assignments) {
  const seatOf = new Map(assignments.map(a => [a.deskId, a]));
  return (layout.desks || [])
    .slice()
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .map(d => {
      if (d.reservedFor) return `${d.name}\t${d.reservedFor} (reserved)`;
      const seat = seatOf.get(d.id);
      return `${d.name}\t${seat ? seat.name : '—'}`;
    })
    .join('\n');
}
