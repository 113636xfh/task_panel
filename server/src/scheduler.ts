import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, DEFAULT_SETTINGS } from './db.js';
import { publish } from './bus.js';
import { TaskRunner, type TaskRow, type Plan } from './runner.js';
import { StubRunner } from './runner-stub.js';

/** 真实/ stub 执行器的公共接口（private 成员不参与结构化比较） */
export type AnyRunner = {
  start(t: TaskRow): Promise<void>;
  resume(t: TaskRow, plan: Plan, answers: Record<string, string>, pendingMsgs: string[]): Promise<void>;
  steer(text: string): void;
  stop(): void;
};

const runners = new Map<string, AnyRunner>();
const runtimers: NodeJS.Timeout[] = [];

// ---------------- 事件落库 + 广播 ----------------
export function emitEvent(taskId: string, kind: string, payload: unknown, action?: string) {
  const seq = (db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM task_events WHERE task_id=?').get(taskId) as { s: number }).s;
  const ts = Date.now();
  db.prepare('INSERT INTO task_events (task_id, seq, ts, kind, payload) VALUES (?,?,?,?,?)').run(taskId, seq, ts, kind, JSON.stringify(payload));

  if (kind === 'phase') {
    const to = (payload as { phase: string }).phase;
    const cur = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as { status: string };
    if (to !== cur.status) {
      const finish = to === 'done' || to === 'cancelled' || to === 'failed' ? ts : undefined;
      db.prepare(
        'UPDATE tasks SET status=?, current_action=?, started_at=COALESCE(started_at, ?), finished_at=COALESCE(?, finished_at) WHERE id=?'
      ).run(to, action ?? '', ts, finish ?? null, taskId);
      publish('task.status', { taskId, to, from: cur.status });
    } else if (action) {
      db.prepare('UPDATE tasks SET current_action=? WHERE id=?').run(action, taskId);
    }
  } else if (action) {
    db.prepare('UPDATE tasks SET current_action=? WHERE id=?').run(action, taskId);
  }

  if (kind === 'planned') {
    db.prepare('UPDATE tasks SET plan_json=? WHERE id=?').run(JSON.stringify(payload), taskId);
  } else if (kind === 'step') {
    // 持久化步骤完成，保证恢复执行时不重放已完成的步骤（否则阻塞钩子会重复触发）
    const row = db.prepare('SELECT plan_json FROM tasks WHERE id=?').get(taskId) as { plan_json: string | null } | undefined;
    if (row?.plan_json) {
      const plan = JSON.parse(row.plan_json) as Plan;
      const s = plan.steps?.find((x) => x.id === (payload as { id: string }).id);
      if (s) { s.done = true; db.prepare('UPDATE tasks SET plan_json=? WHERE id=?').run(JSON.stringify(plan), taskId); }
    }
  } else if (kind === 'progress') {
    // P3 看板一行进度（执行/验收阶段：当前在第几步）
    const p = payload as { done: number; total: number; current: string };
    if (p && typeof p.total === 'number') {
      db.prepare('UPDATE tasks SET current_action=? WHERE id=?').run(`${p.done}/${p.total} · ${p.current}`, taskId);
    }
  } else if (kind === 'review') {
    db.prepare('UPDATE tasks SET review_json=? WHERE id=?').run(JSON.stringify(payload), taskId);
  } else if (kind === 'asset') {
    const a = payload as { kind: string; name: string; path?: string; summary: string };
    db.prepare('INSERT INTO task_assets (task_id, kind, name, path_or_url, summary, at) VALUES (?,?,?,?,?,?)').run(
      taskId, a.kind ?? 'file', a.name, a.path ?? a.name, a.summary, ts
    );
  }

  publish('task.event', { taskId, event: { seq, ts, kind, payload } });
  publish('runtime.slots', runtimeStats());
}

// ---------------- 运行状态 ----------------
export function runtimeStats() {
  const s = getSettings();
  const cnt = (st: string) => (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE status=?').get(st) as { c: number }).c;
  return {
    used: runners.size,
    total: s.concurrency,
    queue: cnt('queued') + cnt('interrupted'),
    ready: cnt('ready'),
    waiting: cnt('waiting_input'),
    blocked: cnt('blocked'),
    awaiting: cnt('awaiting_confirm'),
  };
}

// ---------------- 启动/恢复任务 ----------------
function onRelease(taskId: string) {
  runners.delete(taskId);
  publish('runtime.slots', runtimeStats());
}

function startTask(t: TaskRow) {
  const settings = getSettings();
  const resume = !!t.plan_json;
  emitEvent(t.id, 'system', { text: resume ? '恢复执行（断点续跑）' : '任务进入打磨阶段（规划智能体已启动，短上下文）' });
  emitEvent(t.id, 'phase', { phase: resume ? 'executing' : 'planning' }, resume ? '▸ 恢复中' : '▸ 打磨中');

  // TP_EXECUTOR=stub 时走确定性 stub（测试用，毫秒级、无需 pi/模型服务）
  const runner: AnyRunner =
    process.env.TP_EXECUTOR === 'stub' ? new StubRunner(t, emitEvent, onRelease, settings) : new TaskRunner(t, emitEvent, onRelease, settings);
  runners.set(t.id, runner);

  if (resume) {
    const plan = JSON.parse(t.plan_json!) as Plan;
    const answers = t.answers_json ? (JSON.parse(t.answers_json) as Record<string, string>) : {};
    const pendRows = (db.prepare('SELECT text FROM task_user_msgs WHERE task_id=? AND delivered_at IS NULL ORDER BY id').all(t.id) as { text: string }[]).map((r) => r.text);
    db.prepare('UPDATE task_user_msgs SET delivered_at=? WHERE task_id=? AND delivered_at IS NULL').run(Date.now(), t.id);
    runner.resume(t, plan, answers, pendRows).catch((e) => {
      emitEvent(t.id, 'system', { text: `恢复执行出错：${String(e)}` });
      onRelease(t.id);
    });
  } else {
    runner.start(t).catch((e) => {
      emitEvent(t.id, 'system', { text: `启动失败：${String(e)}` });
      emitEvent(t.id, 'phase', { phase: 'failed' }, '');
      onRelease(t.id);
    });
  }
}

function tick() {
  const s = getSettings();
  if (runners.size >= s.concurrency) {
    // 无空位：看高优先级排队任务能否抢占低优先级运行任务（P2 抢占项）
    preemptForHighPriority();
  } else {
    // queued 优先于 interrupted（新任务优先，被打断的随后补上）
    const rows = db.prepare(
      "SELECT * FROM tasks WHERE status IN ('queued','interrupted') ORDER BY (status='queued') DESC, priority ASC, created_at ASC"
    ).all() as TaskRow[];
    for (const t of rows) {
      if (runners.size >= s.concurrency) break;
      startTask(t);
    }
  }
  // 分支超时：无人回答 → 自动采用默认答案（设计文档 §3）
  const waiting = db.prepare("SELECT * FROM tasks WHERE status='waiting_input'").all() as TaskRow[];
  for (const t of waiting) {
    if (t.branch_mode !== 'manual' || !t.plan_json) continue;
    let plan: Plan;
    try { plan = JSON.parse(t.plan_json) as Plan; } catch { continue; }
    const answered: Record<string, string> = t.answers_json ? (JSON.parse(t.answers_json) as Record<string, string>) : {};
    const open = (plan.branch_questions ?? []).filter((q) => !(q.id in answered));
    if (!open.length) continue;
    const row = db.prepare("SELECT ts FROM task_events WHERE task_id=? AND kind='phase' ORDER BY id DESC LIMIT 1").get(t.id) as { ts: number } | undefined;
    if (row && Date.now() - row.ts >= s.branchTimeoutMin * 60_000) {
      const ans: Record<string, string> = {};
      for (const q of open) ans[q.id] = q.default || q.options?.[0]?.label || '';
      answerTask(t.id, ans, 'timeout_default');
    }
  }
}

let started = false;

/**
 * 优先级抢占（P2）：槽位全满时，若排队最高优先级任务是 P0/P1，
 * 抢占占用槽位中优先级最低（≥P2）的运行任务 → 置 interrupted（带 checkpoint，
 * tick 会在有空位时自动恢复）。规则保守（只有 P0/P1 能抢、只抢 P2/P3），
 * 避免 P0↔P1 或同级之间的抖动。每 tick 最多抢一个。
 */
function preemptForHighPriority() {
  const top = db
    .prepare(
      "SELECT id, num, priority FROM tasks WHERE status IN ('queued','interrupted') ORDER BY (status='queued') DESC, priority ASC, created_at ASC LIMIT 1"
    )
    .get() as { id: string; num: number; priority: number } | undefined;
  if (!top || top.priority > 1) return; // P2 及以下不能抢
  const victims = [...runners.keys()]
    .map((id) => db.prepare('SELECT id, priority, status FROM tasks WHERE id=?').get(id) as { id: string; priority: number; status: string } | undefined)
    .filter((v): v is { id: string; priority: number; status: string } => !!v && v.priority >= 2);
  if (!victims.length) return;
  const victim = victims.sort((a, b) => b.priority - a.priority)[0];
  if (victim.priority <= top.priority) return; // 同级不抢

  const r = runners.get(victim.id);
  if (r) {
    try {
      r.stop(); // onRelease 会释放槽位
    } catch { /* ignore */ }
  }
  db.prepare("UPDATE tasks SET status='interrupted' WHERE id=?").run(victim.id);
  db.prepare('INSERT INTO checkpoints (task_id, at_status, summary, at) VALUES (?,?,?,?)').run(
    victim.id, 'preempted', `被 P${top.priority} 任务 #${top.num} 抢占，待空位自动恢复`, Date.now()
  );
  emitEvent(victim.id, 'system', {
    text: `被抢占：P${top.priority} 任务 #${top.num} 需要槽位。本任务标记为「被抢占」，有空位时将从断点自动恢复。`,
  });
  publish('task.status', { taskId: victim.id, to: 'interrupted', from: victim.status });
  // 立即再排一次，让高优任务马上补上（不等下一个 tick）
  setTimeout(() => tick(), 100);
}

export function startScheduler() {
  if (started) return;
  started = true;
  tick();
  for (const t of [setInterval(tick, 1000), setInterval(() => publish('runtime.slots', runtimeStats()), 5000)]) runtimers.push(t as unknown as NodeJS.Timeout);
}

/** 服务退出前回收所有 pi 子进程（否则 Windows 上会变孤儿进程） */
export function shutdownRunners() {
  for (const r of runners.values()) {
    try { r.stop(); } catch { /* ignore */ }
  }
}

// ---------------- 服务重启恢复：孤儿任务转 interrupted ----------------
export function recoverOrphans() {
  const rows = db.prepare("SELECT id FROM tasks WHERE status IN ('planning','executing','testing')").all() as { id: string }[];
  for (const r of rows) {
    db.prepare('UPDATE tasks SET status=\'interrupted\' WHERE id=?').run(r.id);
    db.prepare('INSERT INTO checkpoints (task_id, at_status, summary, at) VALUES (?,?,?,?)').run(r.id, 'recovered', '服务重启，按 checkpoint 恢复', Date.now());
    emitEvent(r.id, 'system', { text: '服务重启：任务转为「被抢占/可恢复」，将在有空位时自动恢复（全量重放）' });
    publish('task.status', { taskId: r.id, to: 'interrupted', from: 'recovered' });
  }
}

// ---------------- 用户操作 ----------------
export function answerTask(taskId: string, answers: Record<string, string>, mode: 'user' | 'timeout_default' = 'user') {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as TaskRow | undefined;
  if (!t || t.status !== 'waiting_input') return { ok: false, error: '任务不在等待回答状态' };
  const prev = t.answers_json ? (JSON.parse(t.answers_json) as Record<string, string>) : {};
  const merged = { ...prev, ...answers };
  db.prepare('UPDATE tasks SET answers_json=? WHERE id=?').run(JSON.stringify(merged), taskId);
  for (const [qid, a] of Object.entries(answers)) {
    db.prepare('INSERT INTO branch_answers (task_id, question_id, answer, mode, at) VALUES (?,?,?,?,?)').run(taskId, qid, a, mode, Date.now());
    emitEvent(taskId, 'user_message', { text: `对分支问题 ${qid} 的回答${mode === 'timeout_default' ? '（超时，自动采用默认答案）' : ''}: ${a}` });
  }
  db.prepare('UPDATE tasks SET status=\'queued\' WHERE id=?').run(taskId);
  publish('task.status', { taskId, to: 'queued', from: 'waiting_input' });
  tick();
  return { ok: true };
}

export function answerBlock(taskId: string, answer: string) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as TaskRow | undefined;
  if (!t || t.status !== 'blocked') return { ok: false, error: '任务不在阻塞状态' };
  const open = db.prepare('SELECT id FROM task_blocks WHERE task_id=? AND status=\'open\' ORDER BY id DESC LIMIT 1').get(taskId) as { id: number } | undefined;
  if (open) db.prepare('UPDATE task_blocks SET answer=?, mode=\'user\', answered_at=?, status=\'answered\' WHERE id=?').run(answer, Date.now(), open.id);
  emitEvent(taskId, 'user_message', { text: `阻塞决策: ${answer}` });
  db.prepare('UPDATE tasks SET status=\'queued\' WHERE id=?').run(taskId);
  publish('task.status', { taskId, to: 'queued', from: 'blocked' });
  tick();
  return { ok: true };
}

export function confirmTask(taskId: string) {
  const t = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as { status: string } | undefined;
  if (!t || t.status !== 'awaiting_confirm') return { ok: false, error: '任务不在待确认状态' };
  db.prepare('UPDATE tasks SET status=\'done\', finished_at=? WHERE id=?').run(Date.now(), taskId);
  publish('task.status', { taskId, to: 'done', from: 'awaiting_confirm' });
  publish('runtime.slots', runtimeStats());
  return { ok: true };
}

export function cancelTask(taskId: string) {
  const r = runners.get(taskId);
  if (r) r.stop();
  const t = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as { status: string } | undefined;
  if (!t || ['done', 'cancelled', 'failed'].includes(t.status)) return { ok: false, error: '任务已终态' };
  db.prepare('UPDATE tasks SET status=\'cancelled\', finished_at=? WHERE id=?').run(Date.now(), taskId);
  publish('task.status', { taskId, to: 'cancelled', from: t.status });
  publish('runtime.slots', runtimeStats());
  return { ok: true };
}

export function messageTask(taskId: string, text: string) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as TaskRow | undefined;
  if (!t) return { ok: false, error: 'task not found' };
  emitEvent(taskId, 'user_message', { text });
  publish('task.user_message', { taskId, text });
  const r = runners.get(taskId);
  if (r) {
    r.steer(text); // P1: 真实 pi RPC steer 命令
  } else {
    db.prepare('INSERT INTO task_user_msgs (task_id, text, at) VALUES (?,?,?)').run(taskId, text, Date.now());
  }
  return { ok: true };
}

export function ensureWorkspaceDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
