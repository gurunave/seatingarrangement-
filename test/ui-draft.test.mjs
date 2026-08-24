// Drives the reveal, the draft and the final map through real browser pages,
// with a full room of 20 so the big screen is shown as it will actually look.
import pw from 'playwright';
import WebSocket from 'ws';
import { ok, report, BASE, PORT, seedLayout } from './helpers.mjs';

const SHOTS = process.env.SHOT_DIR || null;
const errors = [];
const HUMANS = ['Naveen', 'Priya', 'Arjun', 'Deepa'];
const BOTS = ['Rahul','Sneha','Vikram','Ananya','Karthik','Meera','Sanjay','Divya',
              'Rohit','Kavya','Aditya','Nisha','Suresh','Pooja','Manoj','Lakshmi'];

await seedLayout(20);

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(ctx, label) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  return p;
}

// A scripted player: answers every question, and claims a desk when it's their turn.
function bot(code, name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const self = { name, id: null, ws, seated: false };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'player:join', code, name })));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') self.id = m.playerId;
    if (m.type === 'sprint:question') {
      ws.send(JSON.stringify({ type: 'sprint:answer', code, index: m.question.index, choice: m.question.options[0] }));
    }
    if (m.type === 'state' && m.state.phase === 'draft') {
      const cur = m.state.draft.current;
      if (cur && cur.playerId === self.id && !self.seated) {
        self.seated = true;
        ws.send(JSON.stringify({ type: 'draft:pick', code, deskId: cur.options[0].id }));
      }
    }
  });
  return self;
}

console.log('\n— a full room —');
const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const host = await page(hostCtx, 'host');
await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();

const phones = [];
for (const name of HUMANS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await page(ctx, `phone:${name}`);
  await p.goto(`${BASE}/?c=${code}`);
  await p.fill('#nameInput', name);
  await p.click('#joinBtn');
  await p.waitForSelector('#lobbyView:not(.hidden)');
  phones.push({ name, p });
}
const bots = BOTS.map(n => bot(code, n));
await host.waitForFunction(() => document.getElementById('joined').textContent === '20');
ok(true, '20 people in the lobby, 20 desks');

console.log('\n— sprint —');
await host.click('#startBtn');
await host.waitForSelector('#sprintView:not(.hidden)');
for (const { p } of phones) {
  for (;;) {
    if (!(await p.locator('#sprintView').isVisible())) break;
    const btn = p.locator('.opt:not([disabled])').first();
    if (!(await btn.count())) { await p.waitForTimeout(120); continue; }
    await btn.click().catch(() => {});
    await p.waitForTimeout(150);
  }
}
await host.waitForSelector('#revealView:not(.hidden)', { timeout: 20000 });
ok(true, 'everyone finished and the leaderboard came up on its own');

console.log('\n— the pick order —');
await host.click('#showTiersBtn');
await host.waitForSelector('#tiersView:not(.hidden)');
ok(await host.locator('.tier').count() === 4, 'four tiers shown');
const tierOpts = await host.locator('.tier-opts').allTextContents();
ok(tierOpts.join(' | ') === '4 desks each | 3 desks each | 2 desks each | 2 desks each',
   'each tier states how many desks it gets');
ok(await host.locator('.tname').count() === 20, 'all 20 people placed in a tier');
const seqs = await host.locator('.tname .seq').allTextContents();
ok(seqs.join(',') === Array.from({ length: 20 }, (_, i) => i + 1).join(','), 'pick order numbered 1..20');
// The names slot in on a stagger; wait for the last one before capturing.
await host.locator('.tname').last().waitFor({ state: 'visible' });
await host.waitForTimeout(1700);
ok(await host.locator('.tname').last().evaluate(el => getComputedStyle(el).opacity === '1'),
   'every name has settled into the pick order');
if (SHOTS) await host.screenshot({ path: `${SHOTS}/shot-host-tiers.png` });

// The phone should know its own tier while it waits.
await host.click('#startDraftBtn');
await host.waitForSelector('#draftView:not(.hidden)');
ok(true, 'the draft started');

console.log('\n— the draft —');
ok(await host.locator('.desk.offered').count() >= 2, 'the desks on offer are highlighted on the map');
// The bots pick instantly, so by now the turn may have moved on — check the
// count against whichever tier is actually up rather than assuming tier 1.
const tierText = await host.locator('#pickerTier').textContent();
const shownTier = Number(tierText.match(/Tier (\d)/)?.[1]);
const optCount = await host.locator('.opt-chip').count();
const expected = [4, 3, 2, 2][shownTier - 1];
ok(optCount === expected, `the tier ${shownTier} picker is offered ${optCount} desks (expected ${expected})`);
ok(/^\d+$/.test((await host.locator('#pickClock').textContent()).trim()), 'a pick countdown is running');

// Play the draft out: whichever human is up taps; the bots handle themselves.
let guard = 0;
while (guard++ < 60) {
  if (await host.locator('#resultView').isVisible()) break;
  let acted = false;
  for (const { p } of phones) {
    if (await p.locator('#turnView').isVisible()) {
      if (SHOTS && !acted) await p.screenshot({ path: `${SHOTS}/shot-phone-turn.png` });
      if (SHOTS && guard < 4) await host.screenshot({ path: `${SHOTS}/shot-host-draft.png` });
      await p.locator('.seat-opt:not([disabled])').first().click().catch(() => {});
      acted = true;
    }
  }
  await host.waitForTimeout(acted ? 250 : 150);
}
await host.waitForSelector('#resultView:not(.hidden)', { timeout: 25000 });
ok(true, 'the draft completed and the final seating came up');

console.log('\n— the final map —');
ok(await host.locator('#resultMap .desk.taken').count() === 20, 'all 20 desks show an occupant');
// The tail is always auto-assigned; a human whose 15s ran out is auto too, so
// assert the rule (the last three in pick order) rather than a bare count.
const tail = await host.evaluate(() => {
  const st = window.__state;
  const seatOf = new Map(st.draft.assignments.map(a => [a.playerId, a]));
  const order = st.draft.order.map(o => o.id);
  return {
    autoTail: st.draft.autoTail,
    lastThreeAuto: order.slice(-3).every(id => seatOf.get(id)?.auto === true),
    totalAuto: st.draft.assignments.filter(a => a.auto).length
  };
});
ok(tail.autoTail === 3, 'with 20 desks for 20 people the tail is 3');
ok(tail.lastThreeAuto, 'the last three in the pick order were auto-assigned');
ok(tail.totalAuto >= 3, `at least the tail is marked auto on the map (${tail.totalAuto} total)`);
const names = await host.locator('#resultMap .desk .who').allTextContents();
ok(new Set(names).size === 20, 'every occupant is a different person');
ok([...HUMANS, ...BOTS].every(n => names.includes(n)), 'everyone who played has a desk on the map');
if (SHOTS) await host.screenshot({ path: `${SHOTS}/shot-host-result.png` });

console.log('\n— what each phone ends on —');
const seatedName = await phones[0].p.locator('#mySeat').textContent();
ok(!!seatedName.trim() && seatedName.trim() !== '—', `a phone shows its own desk (${seatedName.trim()})`);
ok(names.includes(HUMANS[0]), 'and that person appears on the big-screen map');
if (SHOTS) await phones[0].p.screenshot({ path: `${SHOTS}/shot-phone-seat.png` });

console.log('\n— the downloadable map —');
const png = await host.evaluate(async () => {
  const { drawMap } = await import('/mapimage.js');
  const res = await fetch(`/api/room?code=${document.getElementById('code')?.textContent?.trim() || ''}`);
  return res.ok;
});
ok(png !== undefined, 'the image module loads in the page');
const dataUrl = await host.evaluate(async () => {
  const { drawMap } = await import('/mapimage.js');
  const c = document.createElement('canvas');
  const st = window.__state;
  drawMap(c, st.layout, st.draft.assignments);
  return { url: c.toDataURL('image/png').slice(0, 20), w: c.width, h: c.height };
});
ok(dataUrl.url.startsWith('data:image/png'), 'the map renders to a PNG');
ok(dataUrl.w > 800 && dataUrl.h > 600, `at a usable size (${dataUrl.w}×${dataUrl.h})`);

if (SHOTS) {
  const full = await host.evaluate(async () => {
    const { drawMap } = await import('/mapimage.js');
    const c = document.createElement('canvas');
    drawMap(c, window.__state.layout, window.__state.draft.assignments);
    return c.toDataURL('image/png');
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${SHOTS}/shot-download.png`, Buffer.from(full.split(',')[1], 'base64'));
}

const list = await host.evaluate(async () => {
  const { seatingList } = await import('/mapimage.js');
  return seatingList(window.__state.layout, window.__state.draft.assignments);
});
ok(list.split('\n').length === 20, 'the copyable list has one line per desk');
ok(list.split('\n').every(l => l.includes('\t')), 'each line is desk then name, tab separated');

console.log('\n— console errors —');
ok(errors.length === 0, errors.length ? `console errors: ${errors.join(' | ')}` : 'no console/page errors anywhere');

bots.forEach(b => b.ws.close());
await browser.close();
report();
