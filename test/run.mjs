// Boots the server on a scratch port, runs the protocol tests against it, and
// always tears the server back down.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const PORT = process.env.PORT || 3411;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT },
  stdio: ['ignore', 'pipe', 'inherit']
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
  server.stdout.on('data', d => {
    if (String(d).includes('Seat Draft on')) { clearTimeout(timer); resolve(); }
  });
});

const tests = spawn(process.execPath, ['test/protocol.test.mjs'], {
  cwd: root,
  env: { ...process.env, PORT },
  stdio: 'inherit'
});

tests.on('exit', code => { server.kill(); process.exit(code ?? 1); });
process.on('exit', () => server.kill());
