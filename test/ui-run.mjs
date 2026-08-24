// Boots a server and runs the browser suites against it.
// These need tooling that is deliberately not in package.json, so a plain
// `npm install` on a deploy host doesn't pull a browser download with it:
//   npm i --no-save playwright jsqr
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3421;

const require = createRequire(import.meta.url);
for (const pkg of ['playwright', 'jsqr']) {
  try {
    require.resolve(pkg);
  } catch {
    console.error(`\nBrowser tests need "${pkg}". Install the test tooling with:\n` +
                  `  npm i --no-save playwright jsqr\n`);
    process.exit(1);
  }
}

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 10000);
  server.stdout.on('data', d => { if (String(d).includes('Seat Draft on')) { clearTimeout(t); resolve(); } });
});

let failed = 0;
for (const suite of ['test/ui.test.mjs', 'test/ui-sprint.test.mjs', 'test/ui-draft.test.mjs', 'test/ui-qr.test.mjs', 'test/ui-sim.test.mjs']) {
  console.log(`\n=== ${suite} ===`);
  const code = await new Promise(r => spawn(process.execPath, [suite], {
    cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit'
  }).on('exit', r));
  if (code !== 0) failed++;
}
server.kill();
process.exit(failed ? 1 : 0);
