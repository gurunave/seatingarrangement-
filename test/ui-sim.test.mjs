// The rehearsal page: add bots from the browser, watch them appear on the big
// screen, remove them. (The full bot game is covered in the protocol suite.)
import pw from 'playwright';
import { ok, report, BASE, seedDefaultLayout } from './helpers.mjs';

const SHOTS = process.env.SHOT_DIR || null;
const errors = [];

await seedDefaultLayout();

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const host = await ctx.newPage();
host.on('pageerror', e => errors.push(`[host] ${e.message}`));
await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();

const sim = await ctx.newPage();
sim.on('pageerror', e => errors.push(`[sim] ${e.message}`));
await sim.goto(`${BASE}/simulate?c=${code}`);
ok((await sim.inputValue('#codeInput')) === code, 'room code prefilled from the link');

await sim.locator('#countInput').fill('8');
ok((await sim.locator('#countVal').textContent()) === '8', 'the slider shows the chosen count');
await sim.click('#startBtn');
await sim.waitForSelector('#notice.ok');
ok(true, 'starting bots reports success');

await host.waitForFunction(() => document.getElementById('joined').textContent === '8', null, { timeout: 8000 });
ok(true, 'the big screen fills with 8 test players');
await sim.waitForFunction(() => document.querySelectorAll('.bot').length === 8);
ok(true, 'the rehearsal page lists all 8 with their state');
if (SHOTS) await sim.screenshot({ path: `${SHOTS}/shot-simulate.png` });

await sim.click('#stopBtn');
await sim.waitForFunction(() => document.querySelectorAll('.bot').length === 0);
ok(true, 'removing them clears the list');
await host.waitForFunction(() => document.querySelectorAll('.chip.off').length === 8, null, { timeout: 8000 });
ok(true, 'the big screen shows them gone offline (removable via Manage)');

ok(errors.length === 0, errors.length ? `console errors: ${errors.join(' | ')}` : 'no page errors');

await browser.close();
report();
