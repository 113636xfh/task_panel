// 轻量 dev 编排：同时起 server(tsx watch) 与 vite，无额外依赖
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(name, cmd, args) {
  const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
  const tag = `[${name}] `.padEnd(9);
  const pipe = (stream, color) =>
    stream.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l + '\n').join('')));
  pipe(p.stdout, 0);
  p.stderr.on('data', (d) => process.stderr.write(d.toString()));
  p.on('exit', (code) => {
    console.log(`${tag}exited (${code})`);
    shutdown(code ?? 0);
  });
  return p;
}

const children = [
  run('server', isWin ? 'npm' : 'npx', isWin ? ['cmd', '/c', 'dev:server'] : ['run', 'dev:server']),
  run('web', isWin ? 'npm' : 'npx', isWin ? ['cmd', '/c', 'dev:web'] : ['run', 'dev:web']),
];

let done = false;
function shutdown(code) {
  if (done) return;
  done = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
