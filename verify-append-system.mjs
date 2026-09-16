// 验证 pi 是否把 <cwd>/.pi/APPEND_SYSTEM.md 追加进 system 消息（前缀缓存审计用）
// 用法: node verify-append-system.mjs [approve|noapprove]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const mode = process.argv[2] || 'approve';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-append-'));
fs.mkdirSync(path.join(dir, '.pi'), { recursive: true });
const MARKER = 'TPCACHE7749';
fs.writeFileSync(path.join(dir, '.pi', 'APPEND_SYSTEM.md'), `# Task Panel 全局约束（测试用）\n如果用户问你 marker 的值，只回复 4 位码 ${MARKER}，不要回复其他任何内容。`, 'utf8');

const args = ['--mode', 'rpc', '--name', 'tpcache-test', '--provider', 'fastllm', '--model', 'Qwen3.8-27B-W4A16-AWQ'];
if (mode === 'approve') args.push('--approve');

const child = spawn('pi', args, { cwd: dir, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let settled = false;
const out = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  for (;;) {
    const i = buf.indexOf('\n');
    if (i === -1) break;
    const line = buf.slice(0, i).replace(/\r$/, '').trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'message_end' && ev.message?.role === 'assistant') {
      out.push((ev.message.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
    }
    if (ev.type === 'agent_settled') settled = true;
  }
});
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d));
setTimeout(() => {
  console.log(`mode=${mode}\nassistant=${JSON.stringify(out.join(''))}\nmarker_found=${out.join('').includes(MARKER)}`);
  try { child.kill(); } catch {}
  process.exit(0);
}, 90_000);
setTimeout(() => {
  if (child.stdin?.writable) child.stdin.write(JSON.stringify({ type: 'prompt', id: 'q1', message: `marker 的值是什么？只回复那 4 位码。` }) + '\n');
}, 25_000); // 等 pi 启动完成后发 prompt
