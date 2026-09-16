import { spawn } from 'node:child_process';

/**
 * 跨平台命令执行（P1 验收测试用；P0 不调用）。
 * Linux: sh -c；Windows: cmd /d /s /c。
 * 注意：P1 起验收测试改走 pi RPC bash 命令（与沙盒同策略），此函数仅留给非 agent 场景。
 */
export function runCmd(cmd: string, opts: { cwd: string; timeoutMs?: number }): Promise<{ code: number | null; out: string }> {
  const isWin = process.platform === 'win32';
  const child = spawn(cmd, isWin ? ['/d', '/s', '/c', cmd] : ['-c', cmd], {
    cwd: opts.cwd,
    shell: isWin,
    windowsHide: true,
    env: process.env,
  });
  let out = '';
  child.stdout.on('data', (d) => (out += String(d)));
  child.stderr.on('data', (d) => (out += String(d)));
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, opts.timeoutMs ?? 600_000);
  return new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.slice(-20000) });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: String(e) });
    });
  });
}
