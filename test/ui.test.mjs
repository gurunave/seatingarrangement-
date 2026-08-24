import pw from 'playwright';
const { chromium } = pw;
const S = process.env.SHOT_DIR || '.';
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗ FAIL:', m)); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(ctx, label) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  return p;
}

// reset to a clean 20-desk layout
const def = (await (await fetch(`${BASE}/api/layout/default`)).json()).layout;
await fetch(`${BASE}/api/layout`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(def) });

console.log('\n— setup screen —');
const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const setup = await newPage(deskCtx, 'setup');
await setup.goto(`${BASE}/setup`);
await setup.waitForSelector('.desk');
ok(await setup.locator('.desk').count() === 20, '20 desks render on the map');
ok((await setup.locator('#count').textContent()) === '20', 'counter shows 20');
ok(await setup.locator('.cell.empty').count() === 50, 'empty cells fill the rest of the grid');

// add a desk by clicking an empty cell
await setup.locator('.cell.empty').first().click();
await setup.waitForFunction(() => document.getElementById('count').textContent === '21');
ok(true, 'clicking an empty square adds a desk');
ok(await setup.locator('#editor').isVisible(), 'editor panel opens for the new desk');

// rename it
await setup.fill('#deskName', 'BOSS');
await setup.waitForFunction(() => [...document.querySelectorAll('.desk')].some(d => d.textContent.includes('BOSS')));
ok(true, 'renaming updates the tile live');

// tag it
await setup.selectOption('#deskPerk', 'window');
ok(await setup.locator('.desk[data-perk="window"]').count() > 0, 'tagging a desk applies the window style');

// move it
const before = await setup.locator('.desk.selected').getAttribute('data-r');
await setup.click('#move');
await setup.locator('.cell.empty').last().click();
const after = await setup.locator('.desk.selected').getAttribute('data-r');
ok(before !== after, 'move relocates the desk to the clicked square');

// delete it
await setup.click('#delete');
await setup.waitForFunction(() => document.getElementById('count').textContent === '20');
ok(true, 'delete removes the desk');

// save persists
await setup.locator('.cell.empty').first().click();
await setup.fill('#deskName', 'KEEP');
await setup.click('#save');
await setup.waitForSelector('#notice.ok');
const persisted = (await (await fetch(`${BASE}/api/layout`)).json()).layout;
ok(persisted.desks.some(d => d.name === 'KEEP'), 'saved layout persisted to the server');
ok(persisted.desks.length === 21, 'server stored 21 desks');

console.log('\n— big screen: create room —');
const host = await newPage(deskCtx, 'host');
await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
ok((await host.locator('#deskCount').textContent()) === '21', 'start screen reports the saved desk count');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();
ok(/^[A-Z]{4}$/.test(code), `room code shown on the big screen (${code})`);
ok((await host.locator('#seats').textContent()) === '21', 'seat count shown');
ok(await host.locator('#startBtn').isDisabled(), 'start button disabled with nobody joined');
ok(await host.locator('#empty').isVisible(), '"nobody yet" prompt visible');

console.log('\n— phones join —');
const phones = [];
for (const name of ['Naveen', 'Priya', 'Arjun']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await newPage(ctx, `phone:${name}`);
  await p.goto(BASE);
  await p.fill('#codeInput', code.toLowerCase());   // lowercase must still work
  await p.fill('#nameInput', name);
  await p.click('#joinBtn');
  await p.waitForSelector('#lobbyView:not(.hidden)');
  ok((await p.locator('#myName').textContent()) === name, `${name} joined from a phone`);
  phones.push({ name, page: p, ctx });
}

await host.waitForFunction(() => document.getElementById('joined').textContent === '3');
ok(await host.locator('.chip').count() === 3, 'big screen shows all 3 name chips');
ok(!(await host.locator('#startBtn').isDisabled()), 'start button enabled once people are in');
ok(await phones[0].page.locator('#playerCount').textContent() === '3', 'phones see the live joined count');

console.log('\n— duplicate name is refused on the phone —');
const dupCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const dup = await newPage(dupCtx, 'phone:dup');
await dup.goto(`${BASE}/?c=${code}`);
ok((await dup.inputValue('#codeInput')) === code, 'code prefilled from the ?c= link');
await dup.fill('#nameInput', 'naveen');
await dup.click('#joinBtn');
await dup.waitForSelector('#joinErr:not(.hidden)');
ok((await dup.locator('#joinErr').textContent()).includes('already joined'), 'duplicate name rejected with a clear message');
await dupCtx.close();

console.log('\n— phone survives a refresh —');
await phones[0].page.reload();
await phones[0].page.waitForSelector('#lobbyView:not(.hidden)');
ok((await phones[0].page.locator('#myName').textContent()) === 'Naveen', 'Naveen came back into the lobby after refresh');
await host.waitForFunction(() => document.querySelectorAll('.chip:not(.off)').length === 3);
ok(true, 'no ghost left on the big screen after the refresh');

console.log('\n— host management —');
await host.click('#toggleManage');
await host.fill('#addName', 'Deepa');
await host.click('#addBtn');
await host.waitForFunction(() => document.getElementById('joined').textContent === '4');
ok((await host.locator('.tag').count()) === 1, 'manually added person flagged NO PHONE');

// Deepa turns up with a phone and claims the placeholder
const dCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const deepa = await newPage(dCtx, 'phone:Deepa');
await deepa.goto(`${BASE}/?c=${code}`);
await deepa.fill('#nameInput', 'Deepa');
await deepa.click('#joinBtn');
await deepa.waitForSelector('#lobbyView:not(.hidden)');
await host.waitForFunction(() => document.querySelectorAll('.tag').length === 0);
ok((await host.locator('#joined').textContent()) === '4', 'Deepa claimed her placeholder — still 4, not 5');

host.on('dialog', d => d.accept());
await host.locator('.manage-row', { hasText: 'Arjun' }).locator('button.danger').click();
await host.waitForFunction(() => document.getElementById('joined').textContent === '3');
ok(true, 'host removed Arjun');
await phones[2].page.waitForSelector('#doneView:not(.hidden)');
ok((await phones[2].page.locator('#doneMsg').textContent()).includes('removed'), "removed player's phone tells them");

console.log('\n— big screen reload keeps control of the room —');
await host.reload();
await host.waitForSelector('#lobbyView:not(.hidden)');
ok((await host.locator('#code').textContent()).trim() === code, 'same room after reloading the big screen');
await host.waitForFunction(() => document.getElementById('joined').textContent === '3');
ok(true, 'roster restored after reload');

console.log('\n— screenshots —');
await host.screenshot({ path: `${S}/shot-host.png`, fullPage: true });
await setup.screenshot({ path: `${S}/shot-setup.png`, fullPage: true });
await phones[0].page.screenshot({ path: `${S}/shot-phone.png` });
const joinShot = await browser.newContext({ viewport: { width: 390, height: 844 } });
const jp = await newPage(joinShot, 'shot');
await jp.goto(BASE);
await jp.fill('#codeInput', code);
await jp.screenshot({ path: `${S}/shot-join.png` });
ok(true, 'captured screenshots');

console.log('\n— console errors —');
ok(errors.length === 0, errors.length ? `console errors: ${errors.join(' | ')}` : 'no console/page errors anywhere');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
