import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, uid, ROOT } from './db.js';
import { publish } from './bus.js';

/**
 * pi 历史会话导入：扫描 ~/.pi/agent/sessions 下的 JSONL 会话文件，
 * 作为「已完成」任务导入看板 —— 完整消息流落库（full 模式可查），
 * checkpoint 指向原会话文件（返工时 pi switch_session 接续原会话）。
 */

// 会话存储根目录（测试可用 TP_SESSIONS_DIR 覆盖）
export const SESSIONS_ROOT = process.env.TP_SESSIONS_DIR
  ? path.resolve(process.env.TP_SESSIONS_DIR)
  : path.join(os.homedir(), '.pi', 'agent', 'sessions');

const TEXT_CAP = 20_000; // 单个导入文本片段上限（防单条超大工具结果撑爆 DB/UI）

export interface SessionMeta {
  file: string; // 绝对路径
  id: string; // pi session id
  cwd: string; // 会话工作目录（= 导入任务的 workspace_path）
  startTs: number;
  endTs: number;
  messages: number; // message 行数
  size: number; // 字节
  title: string; // 首条用户消息预览
  model: string; // provider/modelId
  self: boolean; // Task Panel 自身（本项目或其 workspaces）的会话
}

function trunc(s: string, cap: number = TEXT_CAP): string {
  return s.length > cap ? s.slice(0, cap) + `\n…（截断，原 ${s.length.toLocaleString()} 字符）` : s;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** 是否 Task Panel 自身会话（本项目根或 workspaces 子目录） */
export function isSelf(cwd: string): boolean {
  if (!cwd) return false;
  const c = norm(cwd);
  const root = norm(ROOT);
  return c === root || c.startsWith(root + '/');
}

function parseTs(l: any): number {
  return Date.parse(l?.timestamp ?? '') || 0;
}

/** 首条用户消息纯文本 */
function firstUserText(lines: any[]): string {
  for (const l of lines) {
    if (l?.type !== 'message' || l.message?.role !== 'user') continue;
    const c = Array.isArray(l.message.content) ? l.message.content : [];
    const text = c.map((p: any) => (p?.type === 'text' ? String(p.text ?? '') : '')).join(' ');
    if (text.trim()) return text.replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** 单条会话文件 → 元信息（读全文一次） */
function scanSession(file: string): SessionMeta | null {
  const st = fs.statSync(file);
  const lines = parseLines(fs.readFileSync(file, 'utf8'));
  let id = '';
  let cwd = '';
  let startTs = 0;
  let endTs = 0;
  let messages = 0;
  let model = '';
  for (const l of lines) {
    const ts = parseTs(l);
    if (ts) {
      if (!startTs) startTs = ts;
      endTs = Math.max(endTs, ts);
    }
    if (l.type === 'session') {
      id = l.id ?? '';
      cwd = l.cwd ?? '';
    } else if (l.type === 'model_change') {
      model = [l.provider, l.modelId].filter(Boolean).join('/');
    } else if (l.type === 'message') {
      messages++;
    }
  }
  if (!cwd) return null;
  return {
    file,
    id,
    cwd,
    startTs: startTs || st.mtimeMs,
    endTs: endTs || st.mtimeMs,
    messages,
    size: st.size,
    title: firstUserText(lines).slice(0, 120),
    model,
    self: isSelf(cwd),
  };
}

function parseLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 跳过坏行 */
    }
  }
  return out;
}

/** 列出可导入会话（新→旧） */
export function listSessions(opts: { includeSelf?: boolean; q?: string } = {}): SessionMeta[] {
  if (!fs.existsSync(SESSIONS_ROOT)) return [];
  const out: SessionMeta[] = [];
  for (const dir of fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    const d = path.join(SESSIONS_ROOT, dir.name);
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const m = scanSession(path.join(d, f));
        if (m) out.push(m);
      } catch {
        /* 跳过不可读文件 */
      }
    }
  }
  const q = (opts.q ?? '').trim().toLowerCase();
  return out
    .filter((m) => (opts.includeSelf ? true : !m.self))
    .filter((m) => !q || m.title.toLowerCase().includes(q) || m.cwd.toLowerCase().includes(q) || m.id.includes(q))
    .sort((a, b) => b.endTs - a.endTs);
}

/** 会话 message → 任务事件 payload（与前端 full 模式渲染口径一致） */
function toMsgPayload(m: any): { role: string; parts: any[]; toolName?: string; isError?: boolean } {
  const role = m?.role ?? 'assistant';
  const c: any[] = Array.isArray(m?.content) ? m.content : [];
  if (role === 'toolResult') {
    const text = c
      .map((p) => (typeof p === 'string' ? p : String(p?.text ?? '')))
      .join('')
      .trim();
    return { role, toolName: m.toolName, parts: [{ type: 'text', text: trunc(text) }], isError: !!m.isError };
  }
  const parts: any[] = [];
  for (const p of c) {
    if (p?.type === 'text' && p.text) parts.push({ type: 'text', text: trunc(String(p.text)) });
    else if (p?.type === 'thinking') {
      const th = String(p.thinking ?? p.text ?? '');
      if (th) parts.push({ type: 'thinking', text: trunc(th) });
    } else if (p?.type === 'toolCall') {
      parts.push({ type: 'toolCall', id: p.id, name: p.name, args: p.arguments ?? p.args ?? {} });
    } else if (p?.type === 'image') {
      parts.push({ type: 'text', text: '[图片]' });
    }
  }
  return { role, parts };
}

/**
 * 导入一个历史会话为「已完成」任务。
 * 事件全量落库（保留原始时间戳）；checkpoint 指向原 JSONL → 返工可接续原会话。
 */
export function importSession(
  file: string,
  boardId: string,
  opts: { title?: string; description?: string } = {},
): { id: string; num: number } {
  const abs = path.resolve(file);
  const rootN = norm(SESSIONS_ROOT);
  if (!norm(abs).startsWith(rootN + '/') || !abs.endsWith('.jsonl')) throw new Error('非法的会话文件路径');
  const b = db.prepare('SELECT * FROM boards WHERE id=?').get(boardId) as { id: string } | undefined;
  if (!b) throw new Error('看板不存在');

  const lines = parseLines(fs.readFileSync(abs, 'utf8'));
  let cwd = '';
  let startTs = 0;
  let endTs = 0;
  let model = '';
  const events: { ts: number; kind: string; payload: unknown }[] = [];
  for (const l of lines) {
    const ts = parseTs(l);
    if (ts) {
      if (!startTs) startTs = ts;
      endTs = Math.max(endTs, ts);
    }
    if (l.type === 'session') {
      cwd = l.cwd ?? '';
      continue;
    }
    if (l.type === 'model_change') {
      model = [l.provider, l.modelId].filter(Boolean).join('/');
      events.push({ ts, kind: 'system', payload: { text: `模型：${model || '未知'}` } });
      continue;
    }
    if (l.type === 'custom_message') {
      const c = typeof l.content === 'string' ? l.content
        : Array.isArray(l.content) ? l.content.map((x: any) => String(x?.text ?? '')).join('') : '';
      if (c.trim()) events.push({ ts, kind: 'system', payload: { text: `[${l.customType ?? 'custom'}] ${trunc(c.trim(), 4000)}` } });
      continue;
    }
    if (l.type === 'message') {
      events.push({ ts, kind: 'message', payload: toMsgPayload(l.message) });
      continue;
    }
    // thinking_level_change 等其余类型跳过
  }
  if (!cwd) throw new Error('会话文件缺少工作目录（cwd）');
  if (!events.length) throw new Error('会话没有可导入的消息');

  const firstUser = firstUserText(lines);
  const title = (opts.title ?? '').trim() || firstUser.slice(0, 80) || path.basename(abs, '.jsonl');
  const description = (opts.description ?? '').trim() || trunc(firstUser, 8000);
  const at = startTs || Date.now();
  const end = endTs || at;

  const num = (db.prepare('SELECT COALESCE(MAX(num),0)+1 n FROM tasks WHERE board_id=?').get(b.id) as { n: number }).n;
  const prio = 2;
  const maxInTier = (db.prepare('SELECT COALESCE(MAX(sort_order),0) n FROM tasks WHERE priority=?').get(prio) as { n: number }).n;
  const so = maxInTier + (maxInTier === 0 ? prio * 1_000_000_000 : 0) + 1;
  const id = uid('t');
  const checkpoint = JSON.stringify({ session_file: abs, at_status: 'done', at: end });
  db.prepare(
    `INSERT INTO tasks (id, board_id, num, title, description, priority, status, created_at, workspace_path,
       branch_mode, branch_timeout_min, acceptance_text, test_cmd, extra_prompt, context_window, sort_order,
       started_at, finished_at, checkpoint_json)
     VALUES (?,?,?,?,?,?,'done',?,?,'manual',30,'','','',?,?,?,?,?)`,
  ).run(id, b.id, num, title, description, prio, at, cwd, 0, so, at, end, checkpoint);

  // 事件全量落库（seq 顺序 + 原始时间戳）
  const insEv = db.prepare('INSERT INTO task_events (task_id, seq, ts, kind, payload) VALUES (?,?,?,?,?)');
  let seq = 0;
  for (const e of events) {
    seq += 1;
    insEv.run(id, seq, e.ts || at, e.kind, JSON.stringify(e.payload));
  }
  seq += 1;
  insEv.run(
    id, seq, Date.now(), 'system',
    JSON.stringify({ text: `导入历史会话：${path.basename(abs)}（${events.length} 条消息 · 模型 ${model || '未知'} · 工作区 ${cwd}）` }),
  );

  // 工作区 work/ 下的协议文件 → 资产（可点开预览）
  const workDir = path.join(cwd, 'work');
  if (fs.existsSync(workDir)) {
    const insAsset = db.prepare('INSERT INTO task_assets (task_id, kind, name, path_or_url, summary, at) VALUES (?,?,?,?,?,?)');
    for (const f of fs.readdirSync(workDir)) {
      if (!f.endsWith('.json')) continue;
      const sum = fs.readFileSync(path.join(workDir, f), 'utf8').slice(0, 80).replace(/\s+/g, ' ');
      insAsset.run(id, 'file', `work/${f}`, `work/${f}`, sum, end);
    }
  }

  publish('task.created', { taskId: id, boardId: b.id, num });
  return { id, num };
}
