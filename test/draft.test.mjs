import { ok, report, client, isType, seedLayout, newRoom, joinPlayers, runSprint } from './helpers.mjs';

const NAMES = ['Naveen', 'Priya', 'Arjun', 'Deepa', 'Rahul', 'Sneha'];

async function gameToReveal(deskCount) {
  await seedLayout(deskCount);
  const { code, hostToken } = await newRoom();
  const host = client(); await host.ready;
  host.send({ type: 'host:join', code, hostToken });
  await host.next(isType('state'));
  const players = await joinPlayers(code, NAMES);
  await host.next(m => m.type === 'state' && m.state.players.length === NAMES.length);
  const state = await runSprint(host, code, players);
  return { code, host, players, state };
}

console.log('\n— tiers appear at the reveal —');
let g = await gameToReveal(20);
let tiers = g.state.tiers;
ok(Array.isArray(tiers) && tiers.length === 4, 'six players split into four tiers');
ok(tiers.map(t => t.players.length).join('/') === '2/2/1/1', 'sizes are as even as possible (2/2/1/1)');
ok(tiers.map(t => t.options).join(',') === '4,3,2,2', 'tier 1 sees 4 desks, tier 4 sees 2');

const flat = tiers.flatMap(t => t.players);
ok(flat.length === 6, 'everyone lands in exactly one tier');
ok(new Set(flat.map(p => p.id)).size === 6, 'nobody appears twice');

// Tier membership must follow the ranking even though order inside is shuffled.
const ranksByTier = tiers.map(t => t.players.map(p => p.rank).sort((a, b) => a - b));
ok(ranksByTier.every((rs, i) => i === 0 || rs[0] > ranksByTier[i - 1].at(-1)),
   'every rank in a tier beats every rank in the tier below');

console.log('\n— the within-tier shuffle is real —');
// Run several games and check the top tier is not always in rank order.
let shuffledAtLeastOnce = false;
for (let i = 0; i < 12 && !shuffledAtLeastOnce; i++) {
  const g2 = await gameToReveal(20);
  const top = g2.state.tiers[0].players;
  if (top[0].rank > top[1].rank) shuffledAtLeastOnce = true;
  g2.players.forEach(p => p.c.close()); g2.host.close();
}
ok(shuffledAtLeastOnce, 'the top scorer does not always pick first — order inside a tier varies');

console.log('\n— starting the draft —');
g = await gameToReveal(20);
g.host.send({ type: 'host:startDraft', code: g.code });
let s = (await g.host.next(m => m.type === 'state' && m.state.phase === 'draft')).state;
ok(s.phase === 'draft', 'room moved into the draft');
ok(s.draft.total === 6, 'six people in the pick order');
ok(s.draft.autoTail === 0, 'with 20 desks for 6 people, nobody is auto-assigned');
ok(s.draft.order[0].tier === 1, 'the first picker comes from tier 1');
ok(s.draft.current.playerId === s.draft.order[0].id, 'it is the first picker\'s turn');
ok(s.draft.current.options.length === 4, 'a tier 1 picker is offered 4 desks');
ok(s.draft.current.options.every(d => d && d.id && d.name), 'options carry full desk details for the map');
ok(s.draft.current.msLeft > 0, 'a pick timer is running');

console.log('\n— only the right person can pick, and only what was offered —');
const current = g.players.find(p => p.id === s.draft.current.playerId);
const other = g.players.find(p => p.id !== s.draft.current.playerId);
other.c.send({ type: 'draft:pick', code: g.code, deskId: s.draft.current.options[0].id });
ok((await other.c.next(isType('error'))).code === 'not_your_turn', 'someone else cannot pick on your turn');

// Pick a desk that is definitely not among the options, so this never
// accidentally consumes the turn.
const offeredIds = s.draft.current.options.map(o => o.id);
const notOffered = Array.from({ length: 20 }, (_, i) => `d${i + 1}`).find(id => !offeredIds.includes(id));
current.c.send({ type: 'draft:pick', code: g.code, deskId: notOffered });
ok((await current.c.next(isType('error'))).code === 'seat_not_offered',
   `a desk that was not offered (${notOffered}) is refused`);

console.log('\n— picking —');
const chosen = s.draft.current.options[0].id;
current.c.send({ type: 'draft:pick', code: g.code, deskId: chosen });
s = (await g.host.next(m => m.type === 'state' && m.state.draft?.index === 1)).state;
ok(s.draft.assignments.length === 1, 'the pick is recorded');
ok(s.draft.assignments[0].deskId === chosen, 'the desk they chose is the desk they got');
ok(s.draft.assignments[0].auto === false, 'recorded as a real choice, not an auto-assignment');
ok(s.draft.current.playerId === s.draft.order[1].id, 'the turn passed to the next person');
ok(!s.draft.current.options.some(o => o.id === chosen), 'the taken desk is no longer on offer');

console.log('\n— tier 2 gets fewer options —');
ok(s.draft.order[1].tier === 1 ? s.draft.current.options.length === 4 : s.draft.current.options.length === 3,
   `picker ${s.draft.order[1].tier === 1 ? 'still in tier 1 sees 4' : 'in tier 2 sees 3'}`);

console.log('\n— the host can skip a dead phone —');
const skipped = s.draft.current.playerId;
g.host.send({ type: 'host:skipTurn', code: g.code });
s = (await g.host.next(m => m.type === 'state' && m.state.draft?.index === 2)).state;
const forced = s.draft.assignments.find(a => a.playerId === skipped);
ok(!!forced && forced.auto === true, 'the skipped player was given a desk automatically');

console.log('\n— playing the draft out —');
while (s.phase === 'draft' && s.draft.current) {
  const turn = g.players.find(p => p.id === s.draft.current.playerId);
  turn.c.send({ type: 'draft:pick', code: g.code, deskId: s.draft.current.options[0].id });
  s = (await g.host.next(m => m.type === 'state' &&
      (m.state.phase === 'result' || m.state.draft?.index > s.draft.index))).state;
}
ok(s.phase === 'result', 'the draft finished and the room is showing results');

const seats = s.draft.assignments;
ok(seats.length === 6, 'everyone got a desk');
ok(new Set(seats.map(a => a.deskId)).size === 6, 'no desk was given to two people');
ok(new Set(seats.map(a => a.playerId)).size === 6, 'nobody got two desks');
ok(NAMES.every(n => seats.some(a => a.name === n)), 'every player by name has a seat');

g.players.forEach(p => p.c.close()); g.host.close();

console.log('\n— the tail is auto-assigned when desks exactly match people —');
g = await gameToReveal(6);
g.host.send({ type: 'host:startDraft', code: g.code });
s = (await g.host.next(m => m.type === 'state' && m.state.phase === 'draft')).state;
ok(s.draft.autoTail === 3, 'with 6 desks for 6 people, the last 3 are auto-assigned');

let guard = 0;
while (s.phase === 'draft' && s.draft.current && guard++ < 10) {
  const turn = g.players.find(p => p.id === s.draft.current.playerId);
  turn.c.send({ type: 'draft:pick', code: g.code, deskId: s.draft.current.options[0].id });
  s = (await g.host.next(m => m.type === 'state' &&
      (m.state.phase === 'result' || m.state.draft?.index > s.draft.index))).state;
}
ok(s.phase === 'result', 'draft completed');
ok(s.draft.assignments.filter(a => a.auto).length === 3, 'exactly three people were auto-assigned');
ok(s.draft.assignments.filter(a => !a.auto).length === 3, 'the other three chose');
ok(new Set(s.draft.assignments.map(a => a.deskId)).size === 6, 'all six desks used exactly once');

console.log('\n— absent people are seated instantly, never a countdown —');
{
  await seedLayout(20);   // plenty of slack, so the tail is 0 and every skip is the instant path
  const g3 = { code: null, host: client() };
  const room3 = await newRoom();
  g3.code = room3.code;
  await g3.host.ready;
  g3.host.send({ type: 'host:join', code: g3.code, hostToken: room3.hostToken });
  await g3.host.next(isType('state'));

  const present = await joinPlayers(g3.code, ['Here1', 'Here2', 'Here3']);
  for (const name of ['Away1', 'Away2', 'Away3', 'Away4']) {
    g3.host.send({ type: 'host:addPlayer', code: g3.code, name });
  }
  await g3.host.next(m => m.type === 'state' && m.state.players.length === 7);
  await runSprint(g3.host, g3.code, present);

  g3.host.send({ type: 'host:startDraft', code: g3.code });
  let st = (await g3.host.next(m => m.type === 'state' && m.state.phase === 'draft')).state;
  // Absentees rank at the bottom, but the within-tier shuffle can slot one
  // just ahead of the lowest-scoring present person at a tier boundary — the
  // guarantee that matters is behavioural: an absentee never HOLDS a turn.
  const awayRanks = st.draft.order.map((o, i) => o.name.startsWith('Away') ? i : -1).filter(i => i >= 0);
  ok(awayRanks.length === 4 && Math.min(...awayRanks) >= 2,
     'absentees sit in the lower half of the pick order');

  // The three present people pick; the moment the last one does, all four
  // absentees must be seated with no countdowns in between. The 4s message
  // timeout is the proof: four 15s timers would blow straight through it.
  const t0 = Date.now();
  let guard = 0;
  while (st.phase === 'draft' && st.draft.current && guard++ < 10) {
    const turn = present.find(p => p.id === st.draft.current.playerId);
    ok(!!turn, `it is a present person's turn (${st.draft.current.name}) — never an absentee's`);
    turn.c.send({ type: 'draft:pick', code: g3.code, deskId: st.draft.current.options[0].id });
    st = (await g3.host.next(m => m.type === 'state' &&
        (m.state.phase === 'result' || m.state.draft?.index > st.draft.index))).state;
  }
  ok(st.phase === 'result', 'the draft finished');
  ok(Date.now() - t0 < 5000, `no absentee countdown was waited out (${Date.now() - t0}ms total)`);

  const seats = st.draft.assignments;
  ok(seats.length === 7, 'all 7 people are on the map, absent or not');
  const away = seats.filter(a => a.name.startsWith('Away'));
  ok(away.length === 4 && away.every(a => a.auto), 'every absentee is seated and marked auto-assigned');
  ok(seats.filter(a => !a.auto).length === 3, 'the three present people all chose for themselves');
  ok(new Set(seats.map(a => a.deskId)).size === 7, 'no desk double-booked');

  present.forEach(p => p.c.close());
  g3.host.close();
}

console.log('\n— draft messages outside the draft —');
g.players[0].c.send({ type: 'draft:pick', code: g.code, deskId: 'd1' });
ok((await g.players[0].c.next(isType('error'))).code === 'not_in_draft', 'picking after the draft is refused');
g.host.send({ type: 'host:startDraft', code: g.code });
ok((await g.host.next(isType('error'))).code === 'not_ready_to_draft', 'the draft cannot be restarted');

const rogue = client(); await rogue.ready;
rogue.send({ type: 'host:skipTurn', code: g.code });
ok((await rogue.next(isType('error'))).code === 'not_host', 'a player cannot skip turns');
rogue.close();

g.players.forEach(p => p.c.close()); g.host.close();
report();
