// Boots a server per suite group and runs the suites against it. The timeout
// suite needs a short sprint limit, so it gets its own server rather than
// forcing every other test to race a 6-second clock.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_PORT = Number(process.env.PORT) || 3411;

const GROUPS = [
  { port: BASE_PORT,     env: {},                     suites: ['test/questions.test.mjs', 'test/protocol.test.mjs', 'test/sprint.test.mjs'] },
  { port: BASE_PORT + 1, env: { SPRINT_SECONDS: '5' }, suites: ['test/sprint-timeout.test.mjs'] }
];

function startServer(port, env) {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const up = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.stdout.on('data', d => {
      if (String(d).includes('Seat Draft on')) { clearTimeout(timer); resolve(); }
    });
  });
  return { server, up };
}

const runSuite = (suite, port, env) => new Promise(resolve => {
  spawn(process.execPath, [suite], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: 'inherit'
  }).on('exit', code => resolve(code ?? 1));
});

let failed = 0;
for (const group of GROUPS) {
  const { server, up } = startServer(group.port, group.env);
  try {
    await up;
    for (const suite of group.suites) {
      console.log(`\n=== ${suite} ===`);
      if (await runSuite(suite, group.port, group.env) !== 0) failed++;
    }
  } finally {
    server.kill();
  }
}

console.log(failed ? `\n${failed} suite(s) failed\n` : '\nAll suites passed\n');
process.exit(failed ? 1 : 0);
