// The QR on the big screen is only useful if a phone camera can actually read
// it, so this decodes the rendered code back and checks where it points.
import pw from 'playwright';
import { readFile } from 'node:fs/promises';
import { ok, report, BASE, PORT, seedDefaultLayout } from './helpers.mjs';

const SHOTS = process.env.SHOT_DIR || null;
const jsQRSource = await readFile('node_modules/jsqr/dist/jsQR.js', 'utf8');
const errors = [];

await seedDefaultLayout();

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const host = await ctx.newPage();
host.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
host.on('pageerror', e => errors.push(e.message));

await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();

console.log('\n— the QR renders —');
await host.waitForFunction(() => {
  const img = document.getElementById('qr');
  return img && img.complete && img.naturalWidth > 0;
});
ok(true, 'the QR image loaded');

const box = await host.locator('#qr').boundingBox();
ok(box.width >= 130, `it is rendered large enough to scan (${Math.round(box.width)}px on screen)`);
ok(Math.abs(box.width - box.height) < 2, 'and square, not stretched');

const bg = await host.locator('.qr-card').evaluate(el => getComputedStyle(el).backgroundColor);
ok(bg === 'rgb(255, 255, 255)', 'it sits on a white quiet zone rather than the dark panel');

console.log('\n— it decodes —');
await host.addScriptTag({ content: jsQRSource });
const decoded = await host.evaluate(() => {
  const img = document.getElementById('qr');
  const size = 360;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size);
  const res = window.jsQR(d.data, size, size);
  return res ? res.data : null;
});
ok(decoded !== null, 'a QR decoder can read the rendered image');
ok(decoded === `${BASE}/?c=${code}`, `it points at the join page with the code prefilled (${decoded})`);

console.log('\n— following it actually joins —');
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
phone.on('pageerror', e => errors.push(`[phone] ${e.message}`));
await phone.goto(decoded);
ok((await phone.inputValue('#codeInput')) === code, 'opening the scanned link prefills the room code');
await phone.fill('#nameInput', 'Scanner');
await phone.click('#joinBtn');
await phone.waitForSelector('#lobbyView:not(.hidden)');
await host.waitForFunction(() => document.getElementById('joined').textContent === '1');
ok(true, 'and the person lands in the lobby without typing a code');

if (SHOTS) await host.screenshot({ path: `${SHOTS}/shot-host-qr.png` });

// Everything after this point deliberately requests bad codes, which the
// browser logs as failed resources. Judge the page on what came before.
const errorsBeforeBadRequests = errors.length ? [...errors] : [];

console.log('\n— a bad code is refused —');
const statuses = await host.evaluate(async () => {
  const codes = ['ABCD', '12', 'TOOLONG', ''];
  const out = {};
  for (const c of codes) out[c || '(empty)'] = (await fetch(`/api/qr?code=${encodeURIComponent(c)}`)).status;
  return out;
});
ok(statuses.ABCD === 200, 'a valid code returns an image');
ok(statuses['12'] === 400 && statuses.TOOLONG === 400 && statuses['(empty)'] === 400,
   'malformed codes are refused rather than encoded into a QR');

console.log('\n— console errors —');
ok(errorsBeforeBadRequests.length === 0,
   errorsBeforeBadRequests.length ? `console errors: ${errorsBeforeBadRequests.join(' | ')}`
                                  : 'no console/page errors during normal use');

await browser.close();
report();
