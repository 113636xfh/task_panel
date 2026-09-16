// 测试公共基建：起/停 Task Panel 服务（stub 执行器）、API 封装、状态轮询、WS 收集
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Task Panel 服务（子进程）。
 * @param {object} o
 * @param {number} o.port  测试端口（避开 8787）
 * @param {string} [o.dataDir]  数据目录（默认 tmp）
 * @param {string} [o.executor] 'stub'（默认，毫秒级确定性）| 'pi'（真实执行器，需 pi+模型服务）
 */
export async function startServer({ port = 18801, dataDir, executor = 'stub' } = {}) {
  dataDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'tp-test-'));
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server', 'src', 'index.ts')], {
    cwd: ROOT,
    env: { ...process.env, TP_PORT: String(port), TP_DATA_DIR: dataDir, TP_EXECUTOR: executor },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) {
        return { base, port, dataDir, child, logs: () => logs, stop: () => stopServer(child) };
      }
    } catch { /* 未就绪 */ }
    await sleep(300);
  }
  try { child.kill(); } catch { /* ignore */ }
  throw new Error('服务未就绪：\n' + logs.slice(-3000));
}

export function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    const done = () => { try { child.kill(); } catch { /* ignore */ } resolve(); };
    const t = setTimeout(done, 5000);
    child.on('exit', () => { clearTimeout(t); done(); });
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill('SIGKILL');
    } catch { done(); }
  });
}

/** API 封装（JSON） */
export function makeApi(base) {
  async function j(method, url, body) {
    const r = await fetch(base + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 200)}`);
    return data;
  }
  return {
    get: (u) => j('GET', u),
    post: (u, b) => j('POST', u, b),
    put: (u, b) => j('PUT', u, b),
    del: (u) => j('DELETE', u),
  };
}

/** 轮询任务状态直到到达 target（或超时） */
export async function waitForStatus(base, taskId, target, timeoutMs = 20_000) {
  const a = makeApi(base.endsWith('/api') ? base : base + '/api');
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const t = await a.get(`/tasks/${taskId}`);
    last = t.status;
    if (t.status === target) return t;
    await sleep(200);
  }
  throw new Error(`任务 ${taskId} 超时未达 ${target}（最后状态 ${last}）`);
}

/** 连 WS 收集事件；resolve 时返回 {events, close, waitKind} */
export function wsCollect(base, since = 0) {
  const port = base.match(/:(\d+)/)[1];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?since=${since}`);
  const events = [];
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (d) => {
    try { events.push(JSON.parse(d.toString())); } catch { /* ignore */ }
  });
  return {
    events,
    opened,
    close: () => { try { ws.close(); } catch { /* ignore */ } },
    /** 等到某个 (kind, payload.taskId 或匹配函数) 的事件 */
    async wait(match, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find(match);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error('WS 事件超时: ' + JSON.stringify(Object.keys(match)));
        await sleep(100);
      }
    },
  };
}

/** 创建任务（stub 剧本标记见 server/src/runner-stub.ts：#branch #block #fail #slow） */
export function makeTaskPayload(o = {}) {
  const {
    title, description = '自动化测试任务。', priority = 0,
    wsName = `t${Math.random().toString(36).slice(2, 9)}`,
    branchMode = 'manual', acceptance = '自动测试验收项', testCmd = '',
    images = [], contextWindow = 0,
  } = o;
  return {
    title, description, priority,
    workspace: { mode: 'fresh', name: wsName },
    branch_mode: branchMode,
    acceptance: acceptance ?? '',
    test_cmd: testCmd ?? '',
    images,
    context_window: contextWindow,
  };
}

/** 创建任务（P3：默认状态 ready，不占槽不排队） */
export async function createTask(a, boardId, payload) {
  return a.post(`/boards/${boardId}/tasks`, payload);
}

/** 创建并立即开始（P3：ready → start → 进入队列） */
export async function createAndStart(a, boardId, payload) {
  const t = await a.post(`/boards/${boardId}/tasks`, payload);
  await a.post(`/tasks/${t.id}/start`);
  return t;
}

/** 1x1 透明 PNG（base64） */
export const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA6mE8kgAAAABJRU5ErkJggg==';
