// Drives a full sprint through real browser pages: the big screen plus several
// phones tapping answers, then the leaderboard.
import pw from 'playwright';
import WebSocket from 'ws';
import { ok, report, BASE, PORT, seedDefaultLayout } from './helpers.mjs';

const SHOTS = process.env.SHOT_DIR || null;
const errors = [];

await seedDefaultLayout();

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(ctx, label) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  return p;
}

console.log('\n— set the room up —');
const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const host = await page(hostCtx, 'host');
await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();
ok(!!code, `room ${code} created`);

// Four real phones, plus a dozen scripted players so the big screen is full.
const phones = [];
for (const name of ['Naveen', 'Priya', 'Arjun', 'Deepa']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await page(ctx, `phone:${name}`);
  await p.goto(`${BASE}/?c=${code}`);
  await p.fill('#nameInput', name);
  await p.click('#joinBtn');
  await p.waitForSelector('#lobbyView:not(.hidden)');
  phones.push({ name, p });
}

const bots = [];
for (const name of ['Rahul','Sneha','Vikram','Ananya','Karthik','Meera','Sanjay','Divya','Rohit','Kavya','Aditya','Nisha']) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'player:join', code, name }));
  bots.push({ name, ws });
}
await host.waitForFunction(() => document.getElementById('joined').textContent === '16');
ok(true, '16 players in the lobby');

console.log('\n— start the sprint —');
await host.click('#startBtn');
await host.waitForSelector('#sprintView:not(.hidden)');
ok(await host.locator('#playingCount').textContent() === '16', 'big screen counts 16 playing');
ok((await host.locator('#doneCount').textContent()) === '0', 'nobody finished yet');
ok(await host.locator('.pcard').count() === 16, 'a progress card per player');

const first = phones[0].p;
await first.waitForSelector('#sprintView:not(.hidden)');
ok((await first.locator('#qNum').textContent()) === '1', 'phone shows question 1');
ok((await first.locator('.opt').count()) === 4, 'four tappable options');
const qText = await first.locator('#question').textContent();
ok(/[+−×÷]/.test(qText), `phone shows a sum (${qText.trim()})`);

// Before tapping, nothing on the page distinguishes the right option from the
// wrong ones — no marker class, no extra attribute to read off the element.
const optionShapes = await first.evaluate(() =>
  [...document.querySelectorAll('.opt')].map(b => ({
    cls: b.className,
    attrs: [...b.attributes].map(a => a.name).sort().join(',')
  })));
ok(new Set(optionShapes.map(o => o.cls)).size === 1, 'every option carries the same classes');
ok(new Set(optionShapes.map(o => o.attrs)).size === 1, 'every option carries the same attributes');
ok(optionShapes.every(o => o.attrs === 'class,data-v'), 'options expose only their value');

if (SHOTS) await first.screenshot({ path: `${SHOTS}/shot-phone-sprint.png` });

console.log('\n— tapping through —');
await first.locator('.opt').first().click();
await first.waitForSelector('.verdict.right, .verdict.wrong');
ok(true, 'tapping an option shows a right/wrong verdict');
await first.waitForFunction(() => document.getElementById('qNum').textContent === '2');
ok(true, 'the next question follows automatically');

await host.waitForFunction(() => document.querySelectorAll('.pips i.on').length > 0);
ok(true, 'the big screen sees progress as it happens');

// Answer the remaining questions on each real phone.
async function finishSprint(p) {
  for (;;) {
    if (!(await p.locator('#sprintView').isVisible())) return;
    const btn = p.locator('.opt:not([disabled])').first();
    if (!(await btn.count())) { await p.waitForTimeout(120); continue; }
    await btn.click().catch(() => {});
    await p.waitForTimeout(160);
  }
}
if (SHOTS) await host.screenshot({ path: `${SHOTS}/shot-host-sprint.png` });

for (const { p } of phones) await finishSprint(p);
await phones[0].p.waitForSelector('#waitView:not(.hidden)');
ok(true, 'a finished phone shows the waiting screen');
await host.waitForFunction(() => document.getElementById('doneCount').textContent === '4');
ok(true, 'big screen counts 4 finished, sprint still running');
ok(await host.locator('#revealView').isHidden(), 'no scores shown while people are still answering');

console.log('\n— host ends it early —');
host.on('dialog', d => d.accept());
await host.click('#endBtn');
await host.waitForSelector('#revealView:not(.hidden)');
ok(await host.locator('.lrow').count() === 16, 'leaderboard lists all 16');

const positions = await host.locator('.lrow .pos').allTextContents();
ok(positions[0] === '1' && positions[15] === '16', 'ranked 1 through 16');
const scores = (await host.locator('.lrow .sc').allTextContents()).map(t => parseInt(t, 10));
ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'scores descend down the board');
if (SHOTS) await host.screenshot({ path: `${SHOTS}/shot-host-reveal.png` });

console.log('\n— what each phone sees —');
await phones[0].p.waitForSelector('#resultView:not(.hidden)');
const rank = await phones[0].p.locator('#myRank').textContent();
ok(/^\d+(st|nd|rd|th)$/.test(rank.trim()), `phone shows its own placing (${rank.trim()})`);
ok((await phones[0].p.locator('#myScore').textContent()).includes('of 10'), 'phone shows its score out of 10');
if (SHOTS) await phones[0].p.screenshot({ path: `${SHOTS}/shot-phone-result.png` });

console.log('\n— reconnect during a sprint —');
const r2 = await (await fetch(`${BASE}/api/room`, { method: 'POST' })).json();
const host2 = await page(await browser.newContext({ viewport: { width: 1280, height: 800 } }), 'host2');
await host2.goto(`${BASE}/host`);
await host2.evaluate(s => localStorage.setItem('seatdraft.host', s), JSON.stringify({ code: r2.code, hostToken: r2.hostToken }));
await host2.reload();
await host2.waitForSelector('#lobbyView:not(.hidden)');
const w = [];
for (const name of ['Solo', 'Duo']) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'player:join', code: r2.code, name }));
  w.push(ws);
}
const rp = await page(await browser.newContext({ viewport: { width: 390, height: 844 } }), 'phone:reconnect');
await rp.goto(`${BASE}/?c=${r2.code}`);
await rp.fill('#nameInput', 'Comeback');
await rp.click('#joinBtn');
await rp.waitForSelector('#lobbyView:not(.hidden)');
await host2.waitForFunction(() => document.getElementById('joined').textContent === '3');
await host2.click('#startBtn');
await rp.waitForSelector('#sprintView:not(.hidden)');
await rp.locator('.opt').first().click();
await rp.waitForFunction(() => document.getElementById('qNum').textContent === '2');
await rp.reload();
await rp.waitForSelector('#sprintView:not(.hidden)', { timeout: 8000 });
ok((await rp.locator('#qNum').textContent()) === '2', 'refreshing mid-sprint returns to the same question, not the lobby');

console.log('\n— console errors —');
ok(errors.length === 0, errors.length ? `console errors: ${errors.join(' | ')}` : 'no console/page errors anywhere');

w.forEach(x => x.close());
bots.forEach(b => b.ws.close());
await browser.close();
report();
