import pw from 'playwright';
import WebSocket from 'ws';
const S = process.env.SHOT_DIR;
const BASE = 'http://localhost:3000';

// Their exact room: 5 columns x 4 rows, A5 and C5 reserved.
const desks = [];
let n = 0;
for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
  n++;
  desks.push({ id: `d${n}`, name: `${'ABCD'[r]}${c + 1}`, r, c,
               perk: r === 0 ? 'window' : 'none', facing: r < 2 ? 'down' : 'up' });
}
desks.find(d => d.name === 'A5').reservedFor = 'Naveen';
desks.find(d => d.name === 'C5').reservedFor = 'Rajashekara';
await fetch(`${BASE}/api/layout`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ windowSide: 'top', desks }) });

const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const host = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await host.goto(`${BASE}/host`);
await host.waitForSelector('#createBtn:not([disabled])');
await host.click('#createBtn');
await host.waitForSelector('#lobbyView:not(.hidden)');
const code = (await host.locator('#code').textContent()).trim();

const names = ['Priya','Arjun','Deepa','Rahul','Sneha','Vikram','Ananya','Karthik','Meera','Sanjay',
               'Divya','Rohit','Kavya','Aditya','Nisha','Suresh','Pooja','Manoj'];   // 18 = 20 - 2 reserved
const socks = [];
for (const nm of names) {
  const ws = new WebSocket('ws://localhost:3000/ws');
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'player:join', code, name: nm }));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'sprint:question') {
      ws.send(JSON.stringify({ type: 'sprint:answer', code, index: m.question.index, choice: m.question.options[0] }));
    }
    if (m.type === 'joined') ws._id = m.playerId;
    if (m.type === 'state' && m.state.phase === 'draft') {
      const cur = m.state.draft.current;
      if (cur && cur.playerId === ws._id && !ws._picked) {
        ws._picked = true;
        ws.send(JSON.stringify({ type: 'draft:pick', code, deskId: cur.options[0].id }));
      }
    }
  });
}
await host.waitForFunction(() => document.getElementById('joined').textContent === '18');
await host.click('#startBtn');
await host.waitForSelector('#revealView:not(.hidden)', { timeout: 60000 });
await host.click('#showTiersBtn');
await host.click('#startDraftBtn');
await host.waitForSelector('#draftView:not(.hidden)');
await host.waitForTimeout(700);
const draftFit = await host.evaluate(() => ({
  scroll: document.documentElement.scrollHeight, inner: innerHeight,
  reservedNames: [...document.querySelectorAll('#draftMap .desk.reserved .who')].map(e => e.textContent)
}));
console.log('DRAFT  page height', draftFit.scroll, 'vs viewport', draftFit.inner,
            draftFit.scroll <= draftFit.inner + 2 ? '=> fits' : '=> SCROLLS');
console.log('DRAFT  reserved names shown:', draftFit.reservedNames.join(', '));
await host.screenshot({ path: `${S}/shot-fit-draft.png` });

await host.waitForSelector('#resultView:not(.hidden)', { timeout: 120000 });
await host.waitForTimeout(500);
const resFit = await host.evaluate(() => ({
  scroll: document.documentElement.scrollHeight, inner: innerHeight,
  reservedNames: [...document.querySelectorAll('#resultMap .desk.reserved .who')].map(e => e.textContent),
  taken: document.querySelectorAll('#resultMap .desk.taken').length
}));
console.log('RESULT page height', resFit.scroll, 'vs viewport', resFit.inner,
            resFit.scroll <= resFit.inner + 2 ? '=> fits' : '=> SCROLLS');
console.log('RESULT reserved names shown:', resFit.reservedNames.join(', '), '| desks occupied:', resFit.taken);
await host.screenshot({ path: `${S}/shot-fit-result.png` });
socks.forEach(w => w.close());
await b.close();
