import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, setSettings, uid, DEFAULT_SETTINGS, ROOT } from './db.js';
import { publish } from './bus.js';
import { inventory, installToTask, removeTaskSkill } from './skills.js';
import {
  emitEvent, runtimeStats, answerTask, answerBlock, confirmTask, cancelTask, messageTask,
} from './scheduler.js';
import type { TaskRow } from './runner.js';

export const api = express.Router();
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

function taskFromRow(t: TaskRow) {
  return {
    ...t,
    plan: t.plan_json ? JSON.parse(t.plan_json) : null,
    answers: t.answers_json ? JSON.parse(t.answers_json) : {},
    review: t.review_json ? JSON.parse(t.review_json) : null,
  };
}

function taskFull(id: string) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
  return t ? taskFromRow(t) : null;
}

// ---------------- boards ----------------
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

api.delete('/boards/:id', (req, res) => {
  const active = (db.prepare("SELECT COUNT(*) c FROM tasks WHERE board_id=? AND status NOT IN ('done','failed','cancelled')").get(req.params.id) as { c: number }).c;
  if (active > 0) return res.status(409).json({ error: '看板还有进行中的任务，不能删除' });
  db.prepare('DELETE FROM tasks WHERE board_id=?').run(req.params.id);
  db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);
  publish('boards.changed', {});
  res.json({ ok: true });
});

// ---------------- tasks ----------------
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

api.post('/boards/:id/tasks', (req, res) => {
  const b = db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id) as { id: string } | undefined;
  if (!b) return res.status(404).json({ error: 'board not found' });
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const ws = body.workspace ?? {};
  if (!title) return res.status(400).json({ error: '标题必填' });
  if (!description) return res.status(400).json({ error: '描述必填' });
  if (ws.mode !== 'fresh' && ws.mode !== 'shared') return res.status(400).json({ error: '工作目录必须选定（fresh 或 shared）' });

  const settings = getSettings();
  let workspace: string;
  if (ws.mode === 'fresh') {
    const raw = String(body.workspace?.name ?? `task-${title.slice(0, 24)}`).replace(/[\\/]/g, '-').trim() || 'untitled';
    workspace = path.join(settings.workspacesBase, raw);
  } else {
    const p = String(ws.path ?? '').trim();
    if (!p || !fs.existsSync(p)) return res.status(400).json({ error: '指定的项目目录不存在' });
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
  db.prepare(
    `INSERT INTO tasks (id, board_id, num, title, description, priority, status, created_at, workspace_path,
       branch_mode, branch_timeout_min, acceptance_text, test_cmd, extra_prompt)
     VALUES (?,?,?,?,?,?,'queued',?,?,?,?,?,?,?)`
  ).run(id, b.id, num, title, description, prio, at, dir,
    body.branch_mode === 'auto' ? 'auto' : 'manual',
    Number(body.branch_timeout_min ?? settings.branchTimeoutMin),
    String(body.acceptance ?? ''), String(body.test_cmd ?? ''), String(body.extra_prompt ?? ''));
  for (const s of String(body.skills ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    installToTask(id, dir, s, 'skill', 'global');
  }
  emitEvent(id, 'system', { text: `任务已创建（#${num}），进入待打磨队列` });
  publish('task.created', { taskId: id, boardId: b.id, num });
  res.json({ id, num });
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
  if (Object.keys(patch).length) {
    const sets = Object.keys(patch).map((k) => `${k}=?`).join(',');
    db.prepare(`UPDATE tasks SET ${sets} WHERE id=?`).run(...(Object.values(patch) as (string | number)[]), t.id);
    if (patch.priority !== undefined && t.status === 'queued') emitEvent(t.id, 'system', { text: `优先级调整为 P${patch.priority}` });
  }
  res.json({ ok: true });
});

api.post('/tasks/:id/cancel', (req, res) => res.json(cancelTask(req.params.id)));
api.post('/tasks/:id/confirm', (req, res) => res.json(confirmTask(req.params.id)));
api.post('/tasks/:id/answer', (req, res) => res.json(answerTask(req.params.id, req.body?.answers ?? {})));
api.post('/tasks/:id/block-answer', (req, res) => res.json(answerBlock(req.params.id, String(req.body?.answer ?? ''))));
api.post('/tasks/:id/message', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '留言不能为空' });
  res.json(messageTask(req.params.id, text));
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
api.get('/settings', (_req, res) => res.json(getSettings()));

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
