import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

/**
 * 原生目录选择器（P3：创建任务选「已有项目目录」时弹文件管理器）。
 * - Windows: PowerShell FolderBrowserDialog（系统原生，隐藏控制台窗口）
 * - Linux:   zenity --file-selection --directory（回退 kdialog）
 * - macOS:   osascript choose folder
 * 用户取消 → 返回 null；命令不存在 → 返回 null（前端回退手动输入）。
 */
export function pickDirectory(startDir: string): Promise<string | null> {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  let bin: string, args: string[];
  if (isWin) {
    // 单引号包裹的 PS 脚本；$ 变量在 Node 字符串里原样传给 powershell
    const start = startDir ? `; $d.RootFolder = '${startDir.replace(/'/g, "''")}'` : '';
    const ps =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "$d.Description = 'Task Panel - 选择工作目录'; " +
      "$d.ShowNewFolderButton = $true" +
      start +
      "; if ($d.ShowDialog() -eq 'OK') { $d.SelectedFolder }";
    bin = 'powershell';
    args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps];
  } else if (isMac) {
    const start = startDir ? `as \"${startDir}\"` : 'as (path to home folder)';
    bin = 'osascript';
    args = ['-e', `set p to (choose folder "选择工作目录" default location ${start})` , '-e', 'POSIX path of p'];
  } else {
    bin = 'zenity';
    args = ['--file-selection', '--directory', '--title=选择工作目录', ...(startDir ? ['--filename=' + startDir] : [])];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, 10 * 60_000);
    child.on('error', (e: any) => {
      clearTimeout(timer);
      // 命令不存在（如 Linux 未装 zenity）→ 回退：Linux 试 kdialog，其他直接 null
      if (process.platform === 'linux' && bin === 'zenity') {
        tryKdialog(startDir).then(resolve, reject);
      } else {
        reject(new Error(`目录选择器不可用（${e.message}）`));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const p = out.trim().split(/\r?\n/).pop()?.trim() ?? '';
      if (code === 0 && p && fsExists(p)) resolve(path.normalize(p));
      else if (code === 1) resolve(null); // 用户取消
      else resolve(null); // 非 0 退出（zenity 未装等）→ 前端回退
      if (code !== 0 && code !== 1 && err) console.error('[pick-directory]', bin, code, err.slice(0, 200));
    });
  });
}

function tryKdialog(startDir: string): Promise<string | null> {
  const args = ['--getExistingDirectory', '选择工作目录'];
  if (startDir) args.push(startDir);
  return new Promise((resolve) => {
    const child = spawn('kdialog', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 10 * 60_000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const p = out.trim().split(/\r?\n/).pop()?.trim() ?? '';
      resolve(code === 0 && p && fsExists(p) ? path.normalize(p) : null);
    });
  });
}

function fsExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
