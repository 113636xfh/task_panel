import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 Node 24 内置 node:sqlite（零原生依赖，Ubuntu/Windows 行为一致）
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const DATA_DIR = process.env.TP_DATA_DIR ?? path.join(ROOT, 'data');
const dataDir = DATA_DIR;
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'taskpanel.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  concurrency: 2,
  branchTimeoutMin: 30,
  retryMax: 3,
  endpoint: 'http://192.168.2.15:8080/v1',
  // 与用户 pi 的 ~/.pi/agent/models.json 中 provider 名一致（vLLM 服务）
  provider: 'fastllm',
  execModel: 'Qwen3.8-27B-W4A16-AWQ',
  planMaxTokens: 8192,
  workspacesBase: path.join(ROOT, 'workspaces'),
  // 默认全局追加提示词：只写本扩展（Task Panel）的协议纪律，不重复 pi 原生规范
  systemPrompt: 'Task Panel 扩展协议纪律（在 pi 默认规范之上，只补充本面板的规则）：\n- 遇到无法自行判断的问题：写入 work/block.json（question/context/options/recommended），随后立即停止，等待用户拍板。\n- 计划写入 work/plan.json；全部步骤完成后写 work/done.json（含交付总结）并停止。\n- 验收由面板完成，不要自行写验收报告。',
  promptUpdatedAt: null as number | null,
  // P3：会话长度（contextWindow，tokens）；0 = 沿用 models.json 的模型默认值。>0 时为任务构建独立 agent 目录覆盖
  contextWindow: 0,
};

// P3 迁移：tasks.context_window（0 = 跟随全局默认；>0 = 该任务单独覆盖）
{
  const cols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('context_window')) db.exec('ALTER TABLE tasks ADD COLUMN context_window INTEGER NOT NULL DEFAULT 0');
  // 上下文空间监控：pi get_session_stats 的 contextUsage + 压缩次数
  if (!cols.includes('ctx_tokens')) db.exec('ALTER TABLE tasks ADD COLUMN ctx_tokens INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('ctx_percent')) db.exec('ALTER TABLE tasks ADD COLUMN ctx_percent REAL NOT NULL DEFAULT 0');
  if (!cols.includes('compactions')) db.exec('ALTER TABLE tasks ADD COLUMN compactions INTEGER NOT NULL DEFAULT 0');
  // 手动排序（行序=优先级/执行顺序，拖动行调整）；任务依赖：父必须先完成
  if (!cols.includes('sort_order')) db.exec('ALTER TABLE tasks ADD COLUMN sort_order REAL NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS task_deps (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id TEXT NOT NULL, child_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(parent_id, child_id))');
  if (!cols.includes('sort_order')) {
    // 回填：按项目内 created_at 顺序 1..n
    const boards = (db.prepare('SELECT id FROM boards').all() as { id: string }[]);
    for (const b of boards) {
      const rows = db.prepare('SELECT id FROM tasks WHERE board_id=? ORDER BY created_at ASC').all(b.id) as { id: string }[];
      rows.forEach((r, i) => db.prepare('UPDATE tasks SET sort_order=? WHERE id=?').run(i + 1, r.id));
    }
  }
  // v3：首页/执行顺序 = 全局序列（不分项目）；值分层：priority*1e9 + 层内序号（P0 全在 P1 之上）
  const verRow = db.prepare('PRAGMA user_version').get() as unknown;
  const ver = (verRow && typeof verRow === 'object' && 'user_version' in verRow) ? Number((verRow as { user_version: number }).user_version) : 0;
  if (ver < 3) {
    const rows = db.prepare('SELECT id, priority FROM tasks ORDER BY priority ASC, created_at ASC').all() as { id: string; priority: number }[];
    const rank: Record<number, number> = {};
    for (const r of rows) {
      rank[r.priority] = (rank[r.priority] ?? 0) + 1;
      db.prepare('UPDATE tasks SET sort_order=? WHERE id=?').run(r.priority * 1_000_000_000 + rank[r.priority], r.id);
    }
    db.exec('PRAGMA user_version = 3');
  }
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value_json);
      // 每行就是一个 key 的完整值（标量或对象，如 promptTemplates）
      out[r.key] = v;
    } catch { /* ignore */ }
  }
  return out as typeof DEFAULT_SETTINGS & Record<string, unknown>;
}

export function setSettings(patch: Record<string, unknown>) {
  const stmt = db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json');
  for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
}

// ---------- helpers ----------
export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
