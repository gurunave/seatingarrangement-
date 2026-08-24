// Draws the room. Used by the draft (to highlight what's on offer) and by the
// final result (to show who ended up where).

// Desks rarely fill the whole editor grid, so render only the area actually
// used — otherwise the map floats in a sea of empty cells on the big screen.
export function bounds(desks) {
  if (!desks.length) return { minR: 0, maxR: 0, minC: 0, maxC: 0, rows: 1, cols: 1 };
  const rs = desks.map(d => d.r), cs = desks.map(d => d.c);
  const minR = Math.min(...rs), maxR = Math.max(...rs);
  const minC = Math.min(...cs), maxC = Math.max(...cs);
  return { minR, maxR, minC, maxC, rows: maxR - minR + 1, cols: maxC - minC + 1 };
}

export const FACE_ARROW = { up: '▲', right: '▶', down: '▼', left: '◀' };

export const PERK_SHORT = {
  window: 'W', corner: 'C', quiet: 'Q', social: 'S', meh: '!', none: ''
};

/**
 * @param {object} opts
 *   assignments: [{deskId, name, auto}]
 *   offered:     desk ids currently on offer to the picker
 *   taken:       highlight the desk just claimed
 */
export function renderMap(el, layout, { assignments = [], offered = [], taken = null } = {}) {
  const desks = layout.desks || [];
  const b = bounds(desks);
  const byCell = new Map(desks.map(d => [`${d.r}:${d.c}`, d]));
  const seatOf = new Map(assignments.map(a => [a.deskId, a]));
  const offeredSet = new Set(offered);

  el.style.gridTemplateColumns = `repeat(${b.cols}, 1fr)`;
  el.style.setProperty('--cols', b.cols);
  el.style.setProperty('--rows', b.rows);

  const cells = [];
  for (let r = b.minR; r <= b.maxR; r++) {
    for (let c = b.minC; c <= b.maxC; c++) {
      const desk = byCell.get(`${r}:${c}`);
      if (!desk) { cells.push('<div class="cell empty"></div>'); continue; }

      // A reserved desk is permanently its owner's — drawn occupied from the start.
      const seat = desk.reservedFor
        ? { name: desk.reservedFor, reserved: true }
        : seatOf.get(desk.id);
      const classes = ['cell', 'desk'];
      if (seat) classes.push('taken');
      if (seat?.auto) classes.push('auto');
      if (seat?.reserved) classes.push('reserved');
      if (offeredSet.has(desk.id)) classes.push('offered');
      if (taken === desk.id) classes.push('just-taken');

      const arrow = FACE_ARROW[desk.facing]
        ? `<span class="face-arrow">${FACE_ARROW[desk.facing]}</span>` : '';
      cells.push(
        `<div class="${classes.join(' ')}" data-perk="${desk.perk}" data-id="${desk.id}">
           ${arrow}<span class="dname">${esc(desk.name)}</span>
           ${seat ? `<span class="who">${esc(seat.name)}</span>`
                  : `<span class="perk">${PERK_SHORT[desk.perk] || ''}</span>`}
         </div>`
      );
    }
  }
  el.innerHTML = cells.join('');
}

export const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
