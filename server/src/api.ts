import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, setSettings, uid, DEFAULT_SETTINGS, ROOT } from './db.js';
import { PROMPT_DEFAULTS } from './prompts.js';
import { publish } from './bus.js';
import { inventory, installToTask, removeTaskSkill } from './skills.js';
import {
  emitEvent, runtimeStats, answerTask, answerBlock, confirmTask, cancelTask, messageTask, pauseTask, resumeTask,
} from './scheduler.js';
import { runCmd, pickDirectory } from './util.js';

import type { TaskRow } from './runner.js';

export const api = express.Router();

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

// ---------------- task images（长提示词附图：自动编号 + 引用 + 回传） ----------------
const IMG_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

function workspaceOf(taskId: string): string | null {
  const t = db.prepare('SELECT workspace_path FROM tasks WHERE id=?').get(taskId) as { workspace_path: string } | undefined;
  return t?.workspace_path ?? null;
}

function listTaskImages(taskId: string): { num: number; name: string; path: string }[] {
  const ws = workspaceOf(taskId);
  if (!ws) return [];
  const dir = path.join(ws, 'work', 'images');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d+\.(png|jpe?g|webp|gif|bmp)$/i.test(f))
    .map((f) => ({ num: Number(f.match(/^(\d+)\./)![1]), name: f, path: `work/images/${f}` }))
    .sort((a, b) => a.num - b.num);
}

function saveTaskImages(taskId: string, files: { name?: string; data?: string }[]): { num: number; name: string; path: string }[] {
  const ws = workspaceOf(taskId);
  if (!ws) throw new Error('task not found');
  const dir = path.join(ws, 'work', 'images');
  fs.mkdirSync(dir, { recursive: true });
  let max = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d+)\./);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const out: { num: number; name: string; path: string }[] = [];
  for (const f of files.slice(0, 12)) {
    const data = String((f as { data?: string })?.data ?? '');
    if (!data || data.length < 32) continue;
    const ext = (path.extname(String((f as { name?: string })?.name ?? '')) || '.png').toLowerCase().slice(0, 5);
    if (!IMG_EXT[ext]) continue;
    max += 1;
    const rel = `work/images/${max}${ext}`;
    fs.writeFileSync(path.join(ws, rel), Buffer.from(data, 'base64'));
    out.push({ num: max, name: String((f as { name?: string })?.name ?? `image${max}${ext}`), path: rel });
  }
  return out;
}

function imageMapBlock(items: { num: number; path: string }[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => `![图 ${i.num}](${i.path})`);
  return `\n\n[附图：正文可用“图 N”引用；agent 用 read 工具读取路径即可看到图片（多模态模型可直接看图）]\n${lines.join('\n')}`;
}

function taskFromRow(t: TaskRow) {
  return {
    ...t,
    plan: t.plan_json ? JSON.parse(t.plan_json) : null,
    answers: t.answers_json ? JSON.parse(t.answers_json) : {},
    review: t.review_json ? JSON.parse(t.review_json) : null,
    // P3：本轮执行中派生的 sub agent（供看板小行展示；无则 null）
    subagent: latestSubagent(t.id, t.started_at ?? 0) ?? null,
  };
}

// 当前运行轮次（started_at 之后）最近一次 subagent 事件 → {label, at, id}
function latestSubagent(taskId: string, since: number): { label: string; at: number; id: string | null } | null {
  try {
    const r = db.prepare(
      "SELECT payload, ts FROM task_events WHERE task_id=? AND kind='subagent' AND ts>=? ORDER BY id DESC LIMIT 1"
    ).get(taskId, since) as { payload: string; ts: number } | undefined;
    if (!r) return null;
    const p = JSON.parse(r.payload) as { id?: string; args?: Record<string, unknown> };
    const label =
      (typeof p.args?.agent === 'string' && p.args.agent) ||
      (typeof p.args?.name === 'string' && p.args.name) ||
      (typeof p.args?.label === 'string' && p.args.label) ||
      'subagent';
    return { label: String(label), at: r.ts, id: p.id ?? null };
  } catch {
    return null;
  }
}

function taskFull(id: string) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
  return t ? taskFromRow(t) : null;
}

// ---------------- boards ----------------
api.get('/health', (_req, res) => res.json({
  ok: true,
  executor: process.env.TP_EXECUTOR === 'stub' ? 'stub' : 'pi',
  uptime: Math.round(process.uptime()),
  runtime: runtimeStats(),
}));

api.get('/boards', (_req, res) => {
  const boards = db.prepare('SELECT * FROM boards ORDER BY created_at').all() as { id: string; name: string; created_at: number }[];
  const stats = db.prepare('SELECT board_id, COUNT(*) total, SUM(status IN (\'planning\',\'executing\',\'testing\')) active, SUM(status=\'done\') done FROM tasks GROUP BY board_id').all() as any[];
  const lastRows = db.prepare('SELECT t.board_id, t.title, t.priority FROM tasks t JOIN (SELECT board_id, MAX(created_at) mc FROM tasks GROUP BY board_id) m ON m.board_id=t.board_id AND m.mc=t.created_at').all() as any[];
  const lastMap = new Map(lastRows.map((r) => [r.board_id, r]));
  res.json(
    boards.map((b) => ({
      ...b,
      total: stats.find((s) => s.board_id === b.id)?.total ?? 0,
      active: stats.find((s) => s.board_id === b.id)?.active ?? 0,
      done: stats.find((s) => s.board_id === b.id)?.done ?? 0,
      last: lastMap.get(b.id) ?? null,
    }))
  );
});

api.post('/boards', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: '名称必填' });
  const id = uid('b');
  db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?,?,?)').run(id, name, Date.now());
  publish('boards.changed', {});
  res.json({ id });
});

api.get('/boards/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});

api.delete('/boards/:id', (req, res) => {
  const active = (db.prepare("SELECT COUNT(*) c FROM tasks WHERE board_id=? AND status NOT IN ('done','failed','cancelled')").get(req.params.id) as { c: number }).c;
  if (active > 0) return res.status(409).json({ error: '看板还有进行中的任务，不能删除' });
  db.prepare('DELETE FROM tasks WHERE board_id=?').run(req.params.id);
  db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);
  publish('boards.changed', {});
  res.json({ ok: true });
});

// ---------------- tasks ----------------
// P3：跨项目全量任务（首页总表用；含 board_name）
api.get('/tasks/all', (_req, res) => {
  const rows = db.prepare(
    'SELECT t.*, b.name AS board_name FROM tasks t JOIN boards b ON b.id = t.board_id ORDER BY b.name, t.created_at'
  ).all() as unknown as TaskRow[];
  res.json(rows.map(taskFromRow));
});

// 项目 = 工作目录的末段（看板与项目合并：首页 = 全部任务的大看板，/p/:name = 该项目看板）
api.get('/projects', (_req, res) => {
  const rows = db.prepare(
    "SELECT workspace_path, COUNT(*) n, SUM(status IN ('planning','executing','testing','queued','interrupted','waiting_input','blocked','awaiting_confirm','paused')) active"
    + ' FROM tasks GROUP BY workspace_path'
  ).all() as { workspace_path: string; n: number; active: number | null }[];
  const m = new Map<string, { name: string; paths: string[]; tasks: number; active: number }>();
  for (const r of rows) {
    const name = r.workspace_path.split(/[\\/]/).filter(Boolean).pop() || '—';
    const e = m.get(name) ?? { name, paths: [], tasks: 0, active: 0 };
    e.paths.push(r.workspace_path);
    e.tasks += r.n;
    e.active += Number(r.active ?? 0);
    m.set(name, e);
  }
  res.json([...m.values()].sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name)));
});

api.get('/boards/:id/tasks', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks WHERE board_id=? ORDER BY created_at').all(req.params.id) as unknown as TaskRow[];
  res.json(rows.map(taskFromRow));
});

api.get('/tasks/:id', (req, res) => {
  const t = taskFull(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

api.get('/tasks/:id/events', (req, res) => {
  const since = Number(req.query.since ?? 0);
  const rows = db.prepare('SELECT seq, ts, kind, payload FROM task_events WHERE task_id=? AND seq>? ORDER BY seq').all(req.params.id, since) as any[];
  res.json(rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })));
});

api.get('/tasks/:id/assets', (req, res) => {
  const rows = db.prepare('SELECT id, kind, name, path_or_url, summary, at FROM task_assets WHERE task_id=? ORDER BY at').all(req.params.id);
  res.json(rows);
});

api.get('/tasks/:id/blocks', (req, res) => {
  const rows = db.prepare('SELECT * FROM task_blocks WHERE task_id=? ORDER BY id DESC').all(req.params.id) as any[];
  res.json(rows.map((r) => ({ ...r, context: JSON.parse(r.context_json), options: JSON.parse(r.options_json) })));
});

// 建任务（公共逻辑）。boardId 对应的看板即「项目」（同名）。
function createTaskInBoard(boardId: string, body: any): { status: number; result: any } {
  const b = db.prepare('SELECT * FROM boards WHERE id=?').get(boardId) as { id: string } | undefined;
  if (!b) return { status: 404, result: { error: 'board not found' } };
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const ws = body.workspace ?? {};
  if (!title) return { status: 400, result: { error: '标题必填' } };
  if (!description) return { status: 400, result: { error: '描述必填' } };
  if (ws.mode !== 'fresh' && ws.mode !== 'shared') return { status: 400, result: { error: '工作目录必须选定（fresh 或 shared）' } };

  const settings = getSettings();
  let workspace: string;
  if (ws.mode === 'fresh') {
    const raw = String(body.workspace?.name ?? `task-${title.slice(0, 24)}`).replace(/[\\/]/g, '-').trim() || 'untitled';
    workspace = path.join(settings.workspacesBase, raw);
  } else {
    const p = String(ws.path ?? '').trim();
    if (!p || !fs.existsSync(p)) return { status: 400, result: { error: '指定的项目目录不存在' } };
    workspace = p;
  }

  const num = ((db.prepare('SELECT COALESCE(MAX(num),0)+1 n FROM tasks WHERE board_id=?').get(b.id) as { n: number }).n);
  // 唯一化目录
  let dir = workspace, i = num;
  while (fs.existsSync(dir) && ws.mode === 'fresh') dir = path.join(settings.workspacesBase, `${path.basename(workspace)}-${i++}`);
  fs.mkdirSync(dir, { recursive: true });

  const id = uid('t');
  const at = Date.now();
  const prio = Math.min(3, Math.max(0, Number(body.priority ?? 2)));
  const cw = Math.min(10_000_000, Math.max(0, Math.round(Number(body.context_window ?? 0)) || 0));
  db.prepare(
    `INSERT INTO tasks (id, board_id, num, title, description, priority, status, created_at, workspace_path,
       branch_mode, branch_timeout_min, acceptance_text, test_cmd, extra_prompt, context_window)
     VALUES (?,?,?,?,?,?,'ready',?,?,?,?,?,?,?,?)`
  ).run(id, b.id, num, title, description, prio, at, dir,
    body.branch_mode === 'auto' ? 'auto' : 'manual',
    Number(body.branch_timeout_min ?? settings.branchTimeoutMin),
    String(body.acceptance ?? ''), String(body.test_cmd ?? ''), String(body.extra_prompt ?? ''), cw);
  for (const s of String(body.skills ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    installToTask(id, dir, s, 'skill', 'global');
  }
  // 长提示词附图：保存到工作区 work/images/，并把编号映射追加到描述
  if (Array.isArray(body.images) && body.images.length) {
    try {
      const saved = saveTaskImages(id, body.images as { name?: string; data?: string }[]);
      if (saved.length) db.prepare('UPDATE tasks SET description=? WHERE id=?').run(description + imageMapBlock(saved), id);
    } catch { /* 图片失败不阻塞建任务 */ }
  }
  emitEvent(id, 'system', { text: `任务已创建（#${num}），待准备：不占槽位、不排队，点「开始」进入打磨队列` });
  publish('task.created', { taskId: id, boardId: b.id, num });
  return { status: 200, result: { id, num } };
}

api.post('/boards/:id/tasks', (req, res) => {
  const { status, result } = createTaskInBoard(req.params.id, req.body ?? {});
  res.status(status).json(result);
});

// 无看板建任务：项目名 = 目录末段，自动关联/创建同名「看板」（数据模型不变，UI 不再暴露看板概念）
api.post('/tasks', (req, res) => {
  const body = req.body ?? {};
  const ws = body.workspace ?? {};
  const title = String(body.title ?? '').trim();
  let proj = '';
  if (ws.mode === 'fresh') {
    proj = String(ws.name ?? `task-${title.slice(0, 24)}`).replace(/[\\/]/g, '-').trim() || 'untitled';
  } else if (ws.mode === 'shared') {
    const p = String(ws.path ?? '').trim();
    if (!p || !fs.existsSync(p)) return res.status(400).json({ error: '指定的项目目录不存在' });
    proj = p.split(/[\\/]/).filter(Boolean).pop() || '—';
  } else {
    return res.status(400).json({ error: '工作目录必须选定（fresh 或 shared）' });
  }
  let b = db.prepare('SELECT id FROM boards WHERE name=?').get(proj) as { id: string } | undefined;
  if (!b) {
    const bid = uid('b');
    db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?,?,?)').run(bid, proj, Date.now());
    b = { id: bid };
  }
  const { status, result } = createTaskInBoard(b.id, body);
  res.status(status).json(result);
});

// P3：待准备 → 手动开始（进入打磨队列）
api.post('/tasks/:id/start', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as TaskRow | undefined;
  if (!t) return res.status(404).json({ error: 'not found' });
  // 待准备 → 手动开始；失败 → 断点重跑（有 checkpoint 续跑，没有则重新规划）
  if (!['ready', 'failed'].includes(t.status)) return res.status(400).json({ error: `只有「待准备/失败」状态可开始（当前：${t.status}）` });
  const from = t.status;
  db.prepare("UPDATE tasks SET status='queued' WHERE id=?").run(t.id);
  emitEvent(t.id, 'system', { text: from === 'failed' ? '已重试：从断点重跑（已完成步骤不重放）' : '已手动开始：进入打磨队列' });
  publish('task.status', { taskId: t.id, to: 'queued', from });
  res.json({ ok: true });
});

// P3：返工——完成/待确认任务写留言（可附图）→ 打回打磨（复用原会话，不限次数）
api.post('/tasks/:id/rework', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as TaskRow | undefined;
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.status !== 'done' && t.status !== 'awaiting_confirm') {
    return res.status(400).json({ error: `只有已完成/待确认任务可返工（当前：${t.status}）` });
  }
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '请填写返工意见' });
  let final = text;
  const nums = (Array.isArray(req.body?.images) ? (req.body.images as unknown[]) : [])
    .map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length) {
    const list = listTaskImages(t.id);
    const items = nums.map((n) => list.find((i) => i.num === n)).filter(Boolean) as { num: number; path: string }[];
    final += imageMapBlock(items);
  }
  // 清理本轮协议文件：重新打磨要重写 plan.json
  for (const f of ['plan.json', 'done.json', 'review.json', 'block.json']) {
    try { fs.unlinkSync(path.join(t.workspace_path, 'work', f)); } catch { /* ignore */ }
  }
  db.prepare('INSERT INTO task_user_msgs (task_id, text, at) VALUES (?,?,?)').run(t.id, final, Date.now());
  db.prepare("UPDATE tasks SET status='queued', plan_json=NULL, current_action='' WHERE id=?").run(t.id);
  emitEvent(t.id, 'system', { text: '已打回打磨：用户返工反馈已记录，重新规划（同会话）' });
  publish('task.status', { taskId: t.id, to: 'queued', from: t.status });
  res.json({ ok: true });
});

api.patch('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as TaskRow | undefined;
  if (!t) return res.status(404).json({ error: 'not found' });
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof b.priority === 'number') patch.priority = Math.min(3, Math.max(0, Math.round(b.priority)));
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim();
  if (typeof b.description === 'string' && b.description.trim()) patch.description = b.description.trim();
  if (typeof b.extra_prompt === 'string') patch.extra_prompt = b.extra_prompt;
  if (typeof b.test_cmd === 'string') patch.test_cmd = b.test_cmd;
  if (typeof b.context_window === 'number') patch.context_window = Math.min(10_000_000, Math.max(0, Math.round(b.context_window)));
  if (Object.keys(patch).length) {
    const sets = Object.keys(patch).map((k) => `${k}=?`).join(',');
    db.prepare(`UPDATE tasks SET ${sets} WHERE id=?`).run(...(Object.values(patch) as (string | number)[]), t.id);
    if (patch.priority !== undefined && t.status === 'queued') emitEvent(t.id, 'system', { text: `优先级调整为 P${patch.priority}` });
  }
  res.json({ ok: true });
});

api.post('/tasks/:id/cancel', (req, res) => res.json(cancelTask(req.params.id)));
api.post('/tasks/:id/confirm', (req, res) => res.json(confirmTask(req.params.id)));
api.post('/tasks/:id/pause', (req, res) => res.json(pauseTask(req.params.id)));
api.post('/tasks/:id/resume', (req, res) => res.json(resumeTask(req.params.id)));
api.post('/tasks/:id/answer', (req, res) => res.json(answerTask(req.params.id, req.body?.answers ?? {})));
api.post('/tasks/:id/block-answer', (req, res) => res.json(answerBlock(req.params.id, String(req.body?.answer ?? ''))));
api.post('/tasks/:id/message', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '留言不能为空' });
  let final = text;
  const raw: unknown[] = Array.isArray(req.body?.images) ? (req.body.images as unknown[]) : [];
  const nums = raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length) {
    const list = listTaskImages(req.params.id);
    const items = nums.map((n) => list.find((i) => i.num === n)).filter(Boolean) as { num: number; path: string }[];
    final = text + imageMapBlock(items);
  }
  res.json(messageTask(req.params.id, final));
});

// ---------------- task images ----------------
api.post('/tasks/:id/images', (req, res) => {
  const files = Array.isArray(req.body?.files) ? (req.body.files as { name?: string; data?: string }[]) : [];
  try {
    const saved = saveTaskImages(req.params.id, files);
    if (!saved.length) return res.status(400).json({ error: '没有可保存的图片（支持 png/jpg/webp/gif/bmp）' });
    res.json({ images: listTaskImages(req.params.id), added: saved });
  } catch (e) {
    res.status(400).json({ error: (e as Error)?.message ?? '保存失败' });
  }
});

api.get('/tasks/:id/images', (req, res) => res.json({ images: listTaskImages(req.params.id) }));

api.get('/tasks/:id/file', (req, res) => {
  const ws = workspaceOf(req.params.id);
  if (!ws) return res.status(404).json({ error: 'not found' });
  const p = String(req.query?.p ?? '');
  const root = path.resolve(ws);
  const abs = path.resolve(root, p);
  if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ error: 'not found' });
  if (fs.statSync(abs).size > 16 * 1024 * 1024) return res.status(413).json({ error: 'too large' });
  res.type(IMG_EXT[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
  fs.createReadStream(abs).pipe(res);
});

// ---------------- skills ----------------
api.get('/skills', (_req, res) => res.json(json(inventory())));
api.post('/skills/install', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(String(req.body?.taskId ?? '')) as TaskRow | undefined;
  if (!t) return res.status(404).json({ error: 'task not found' });
  const r = installToTask(t.id, t.workspace_path, String(req.body?.name ?? ''), (req.body?.kind === 'extension' ? 'extension' : 'skill'), String(req.body?.source ?? 'global'));
  if (!r.ok) return res.status(400).json(r);
  publish('skills.changed', {});
  res.json(r);
});
api.delete('/skills/task/:taskId/:id', (req, res) => {
  const r = removeTaskSkill(Number(req.params.id));
  if (!r.ok) return res.status(400).json(r);
  publish('skills.changed', {});
  res.json(r);
});

// ---------------- settings ----------------
api.get('/settings', (_req, res) => {
  const cur = getSettings() as Record<string, unknown>;
  // P3：提示词模板返回“有效值”（默认模板 + 用户覆盖），设置页可直接编辑真实文本
  res.json({ ...cur, promptTemplates: { ...PROMPT_DEFAULTS, ...((cur.promptTemplates as Record<string, string>) || {}) } });
});

api.put('/settings', (req, res) => {
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof b.concurrency === 'number') patch.concurrency = Math.min(8, Math.max(1, Math.round(b.concurrency)));
  if (typeof b.branchTimeoutMin === 'number') patch.branchTimeoutMin = Math.min(1440, Math.max(1, b.branchTimeoutMin));
  if (typeof b.retryMax === 'number') patch.retryMax = Math.min(10, Math.max(1, Math.round(b.retryMax)));
  if (typeof b.endpoint === 'string' && b.endpoint.trim()) patch.endpoint = b.endpoint.trim();
  if (typeof b.provider === 'string' && b.provider.trim()) patch.provider = b.provider.trim();
  if (typeof b.execModel === 'string' && b.execModel.trim()) patch.execModel = b.execModel.trim();
  if (typeof b.planMaxTokens === 'number') patch.planMaxTokens = b.planMaxTokens;
  if (typeof b.workspacesBase === 'string' && b.workspacesBase.trim()) patch.workspacesBase = b.workspacesBase.trim();
  if (typeof b.contextWindow === 'number') patch.contextWindow = Math.min(10_000_000, Math.max(0, Math.round(b.contextWindow)));
  if (b.promptTemplates && typeof b.promptTemplates === 'object' && !Array.isArray(b.promptTemplates)) {
    const t = b.promptTemplates as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of ['plan', 'exec', 'judge', 'rework']) if (typeof t[k] === 'string') out[k] = t[k] as string;
    if (Object.keys(out).length) patch.promptTemplates = out;
  }
  setSettings(patch);
  publish('settings.changed', {});
  res.json({ ok: true, ...getSettings() });
});

api.get('/settings/system-prompt', (_req, res) => {
  const s = getSettings();
  const history = db.prepare('SELECT id, text, at FROM prompt_history ORDER BY at DESC LIMIT 5').all();
  res.json({ text: s.systemPrompt as string, at: s.promptUpdatedAt as number | null, history });
});

api.put('/settings/system-prompt', (req, res) => {
  const text = String(req.body?.text ?? '');
  db.prepare('INSERT INTO prompt_history (text, at) VALUES (?,?)').run(text, Date.now());
  db.prepare('DELETE FROM prompt_history WHERE id NOT IN (SELECT id FROM prompt_history ORDER BY at DESC LIMIT 5)').run();
  setSettings({ systemPrompt: text, promptUpdatedAt: Date.now() });
  emitEventGlobal('全局系统提示词已更新（新启动/恢复的派 Agent 立即生效；不影响全局 pi CLI）');
  publish('settings.changed', {});
  res.json({ ok: true });
});

api.post('/settings/system-prompt/restore', (req, res) => {
  const row = db.prepare('SELECT text FROM prompt_history WHERE id=?').get(Number(req.body?.id)) as { text: string } | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('INSERT INTO prompt_history (text, at) VALUES (?,?)').run(row.text, Date.now());
  db.prepare('DELETE FROM prompt_history WHERE id NOT IN (SELECT id FROM prompt_history ORDER BY at DESC LIMIT 5)').run();
  setSettings({ systemPrompt: row.text, promptUpdatedAt: Date.now() });
  publish('settings.changed', {});
  res.json({ ok: true });
});

function emitEventGlobal(text: string) {
  publish('global.notice', { text });
}

api.get('/runtime', (_req, res) => res.json(runtimeStats()));

// 原生目录选择器（创建任务时选已有项目目录；Windows 文件管理器 / Linux zenity|kdialog / mac Finder）
api.post('/fs/pick-directory', async (req, res) => {
  const cwd = String(req.body?.cwd ?? '');
  try {
    const p = await pickDirectory(cwd);
    if (!p) return res.json({ cancelled: true });
    res.json({ ok: true, path: p });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
