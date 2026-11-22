// Запуск без concurrently: только стандартные модули Node.js.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
const root = fileURLToPath(new URL('../', import.meta.url));
loadEnvFile(new URL('../.env', import.meta.url));
const commands = [
  ['--env-file=.env', 'server/index.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
];
if (process.argv.includes('--demo')) commands.unshift(['--env-file=.env', 'mock/transport.ts']);
const children = commands.map(args => spawn(process.execPath, args, { cwd: root, stdio: 'inherit' }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32') {
      // Только дерево процесса, созданного этим скриптом, не все процессы Node.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`Откройте http://localhost:${process.env.CLIENT_PORT || 5173}. Остановка всех процессов: Ctrl+C.`);
