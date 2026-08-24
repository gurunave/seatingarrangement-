// One socket, kept alive. Phones sleep and office WiFi hiccups, so every
// screen assumes the connection will drop and plans to walk back in.
export function connect({ onMessage, onStatus }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let ws = null;
  let attempts = 0;
  let closed = false;
  let queue = [];

  function open() {
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      attempts = 0;
      onStatus?.('online');
      const pending = queue;
      queue = [];
      pending.forEach(m => send(m));
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage?.(msg);
    });

    ws.addEventListener('close', () => {
      if (closed) return;
      onStatus?.('offline');
      // Back off, but never so far that someone is stranded mid-draft.
      const delay = Math.min(1000 * 2 ** attempts++, 5000);
      setTimeout(open, delay);
    });

    ws.addEventListener('error', () => ws.close());
  }

  function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queue.push(msg); // replayed on reconnect, so a tap during a blip isn't lost
  }

  open();
  return { send, close() { closed = true; ws?.close(); } };
}

export const ERRORS = {
  no_such_room: 'No room with that code. Check the big screen.',
  already_started: 'That game has already started.',
  bad_name: 'Please enter your name (at least 2 characters).',
  name_taken: 'Someone already joined with that name.',
  room_full: 'This room is full.',
  unknown_player: 'We lost your place — please join again.',
  not_host: 'Only the host screen can do that.',
  no_desks: 'Add some desks in setup first.',
  not_in_sprint: 'The sprint is not running.',
  need_players: 'You need at least two people with phones to start.',
  out_of_step: 'That answer arrived out of order — showing your current question.',
  already_finished: "You've already finished the sprint.",
  not_in_draft: 'The draft is not running.',
  not_ready_to_draft: 'The draft can only start after the sprint.',
  not_enough_desks: 'There are fewer desks than people — add more in setup.',
  not_your_turn: "It isn't your turn yet.",
  seat_not_offered: 'That desk was not one of your options.',
  nobody_picking: 'Nobody is picking right now.',
  server_error: 'Something went wrong. Try again.'
};

export const errorText = code => ERRORS[code] || 'Something went wrong.';
