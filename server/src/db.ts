import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 Node 24 内置 node:sqlite（零原生依赖，Ubuntu/Windows 行为一致）
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
const dataDir = process.env.TP_DATA_DIR ?? path.join(ROOT, 'data');
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
  provider: 'local-vllm',
  execModel: 'Qwen3.8-27B-W4A16-AWQ',
  planMaxTokens: 8192,
  workspacesBase: path.join(ROOT, 'workspaces'),
  systemPrompt: '',
  promptUpdatedAt: null as number | null,
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value_json);
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v);
      else out[r.key] = v;
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
