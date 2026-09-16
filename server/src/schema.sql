PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  num INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  workspace_path TEXT NOT NULL,
  branch_mode TEXT NOT NULL DEFAULT 'manual',
  branch_timeout_min INTEGER NOT NULL DEFAULT 30,
  acceptance_text TEXT NOT NULL DEFAULT '',
  test_cmd TEXT NOT NULL DEFAULT '',
  extra_prompt TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  plan_json TEXT,
  answers_json TEXT,
  review_json TEXT,
  checkpoint_json TEXT,
  current_action TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_board_num ON tasks(board_id, num);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id, priority, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_task_seq ON task_events(task_id, seq);

CREATE TABLE IF NOT EXISTS task_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  name TEXT NOT NULL,
  path_or_url TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  question TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '[]',
  recommended TEXT NOT NULL DEFAULT '',
  answer TEXT,
  mode TEXT,
  asked_at INTEGER NOT NULL,
  answered_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS task_user_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE TABLE IF NOT EXISTS branch_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'user',
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  at_status TEXT NOT NULL,
  session_file TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'global',
  path TEXT NOT NULL DEFAULT '',
  installed_at INTEGER NOT NULL
);
