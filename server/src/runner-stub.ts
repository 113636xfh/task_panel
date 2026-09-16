import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import type { TaskRow, Plan } from './runner.js';

/**
 * 确定性 stub 执行器（仅测试用，TP_EXECUTOR=stub）。
 * 接口与真实 TaskRunner 一致（start/resume/steer/stop），毫秒级完成整个生命周期。
 *
 * 任务标题中的标记决定剧本：
 *   #branch  规划产出 2 个分支问题 → waiting_input；回答后恢复执行
 *   #block   执行第一步后写 work/block.json → blocked；决策后恢复执行
 *   #fail    第一次验收 fail（retry_count=1），重试后 pass
 *   #slow    执行阶段拉长（5s），便于 steer / cancel / 重启恢复测试
 *   （无标记） 规划 → 执行 2 步 → 测试 → awaiting_confirm
 */

const STEP_MS = 150;
const SLOW_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const workDir = (ws: string) => path.join(ws, 'work');
const workFile = (ws: string, name: string) => path.join(ws, 'work', name);

function basePlan(t: TaskRow): Plan {
  return {
    summary: `stub 计划：${t.title}`,
    steps: [
      { id: 's1', title: '实现核心逻辑', goal: 'stub 步骤一', actions: ['写代码'], done: false },
      { id: 's2', title: '自测', goal: 'stub 步骤二', actions: ['运行自检'], done: false },
    ],
    branch_questions: [],
    acceptance: (t.acceptance_text || 'stub 默认验收').split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    test_cmd: t.test_cmd || undefined,
  };
}

export class StubRunner {
  released = false;
  private timers: NodeJS.Timeout[] = [];
  private answers: Record<string, string> = {};
  private pendingMsgs: string[] = [];

  constructor(
    private t: TaskRow,
    private emit: (taskId: string, kind: string, payload: unknown, action?: string) => void,
    private onRelease: (taskId: string) => void,
    _settings: unknown
  ) {}

  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      if (!this.released) fn();
    }, ms);
    this.timers.push(id);
  }

  private writeWorkFile(name: string, obj: unknown) {
    fs.mkdirSync(workDir(this.t.workspace_path), { recursive: true });
    fs.writeFileSync(workFile(this.t.workspace_path, name), JSON.stringify(obj, null, 2), 'utf8');
  }

  private release() {
    if (this.released) return;
    this.released = true;
    this.onRelease(this.t.id);
  }

  stop() {
    this.released = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.onRelease(this.t.id);
  }

  steer(text: string) {
    const cur = db.prepare('SELECT status FROM tasks WHERE id=?').get(this.t.id) as { status: string } | undefined;
    const running = cur?.status === 'executing';
    this.emit(this.t.id, 'system', { text: running ? 'steer 已注入（stub）' : '留言已入队（stub，下一个执行点自动合入上下文）' });
    if (!running) {
      db.prepare('INSERT INTO task_user_msgs (task_id, text, at) VALUES (?,?,?)').run(this.t.id, text, Date.now());
    }
  }

  // ---------------- 剧本 ----------------

  async start(arg?: TaskRow) {
    if (arg) this.t = arg;
    const t = this.t;
    // P3：stub 也投影 system prompt（供 UI/测试一致性）
    this.emit(t.id, 'system_prompt', { text: `# stub system prompt（测试用）\n\n你是 Task Panel 的执行智能体…（stub 省略全量内容）`, truncated: false });
    const has = (m: string) => t.title.includes(m);
    let plan = basePlan(t);
    if (has('#branch')) {
      plan = {
        ...plan,
        branch_questions: [
          { id: 'q1', q: 'stub 分支问题一：采用哪种方案？', options: [{ label: '方案 A（推荐）', recommended: true }, { label: '方案 B' }, { label: '方案 C' }], default: '方案 A（推荐）' },
          { id: 'q2', q: 'stub 分支问题二：数据存哪里？', options: [{ label: '本地 JSON', recommended: true }, { label: 'SQLite' }], default: '本地 JSON' },
        ],
      };
    }
    this.later(STEP_MS, async () => {
      this.writeWorkFile('plan.json', plan);
      // P3 全部模式：投影完整会话（stub 简化版：注入 prompt + 助手消息）
      this.emit(t.id, 'message', { role: 'user', injected: '规划', parts: [{ type: 'text', text: `# 任务\n${t.title}\n（stub 规划注入 prompt，省略）` }] });
      this.emit(t.id, 'message', { role: 'assistant', parts: [{ type: 'thinking', text: '审视任务描述：检查模糊点、缺失约束与风险…（grade me）' }, { type: 'text', text: `已审视任务「${t.title}」，计划已写入 work/plan.json。` }] });
      this.emit(t.id, 'planned', plan, '');
      this.emit(t.id, 'asset', { kind: 'plan', name: 'work/plan.json', path: 'work/plan.json', summary: plan.summary.slice(0, 80) });
      if (has('#branch') && t.branch_mode === 'manual' && plan.branch_questions.length) {
        this.emit(t.id, 'phase', { phase: 'waiting_input' }, '');
        this.release();
        return;
      }
      await this.runExec(plan, has('#slow') ? SLOW_MS : undefined);
    });
  }

  async resume(_t: TaskRow, plan: Plan, answers: Record<string, string>, pendingMsgs: string[]) {
    this.answers = { ...this.answers, ...answers };
    this.pendingMsgs = pendingMsgs;
    if (pendingMsgs.length) this.emit(this.t.id, 'system', { text: `恢复执行；已合入 ${pendingMsgs.length} 条排队留言（stub）` });
    for (const s of plan.steps) if (s.done) this.emit(this.t.id, 'step', { id: s.id, done: true });
    this.emit(this.t.id, 'system', { text: '恢复执行（断点续跑，stub）' });
    // P3：恢复/返工也投影消息 + 进度
    const doneN = plan.steps.filter((x) => x.done).length;
    this.emit(this.t.id, 'message', { role: 'user', injected: '恢复', parts: [{ type: 'text', text: `# 继续执行任务（stub 恢复注入，省略）${pendingMsgs.length ? `\n# 用户补充留言\n${pendingMsgs.map((m) => '> ' + m).join('\n')}` : ''}` }] });
    this.emit(this.t.id, 'progress', { done: doneN, total: plan.steps.length, current: plan.steps.find((x) => !x.done)?.title ?? '全部步骤已完成' });
    const answeredBlock = db.prepare(
      "SELECT answer FROM task_blocks WHERE task_id=? AND status='answered' ORDER BY id DESC LIMIT 1"
    ).get(this.t.id) as { answer: string } | undefined;
    if (answeredBlock?.answer) {
      this.emit(this.t.id, 'system', { text: `阻塞已决：${answeredBlock.answer}（stub 按决策继续）` });
    }
    this.later(STEP_MS, () => this.runExec(plan));
  }

  /** 执行 → （#block: 写 block.json 停） → 测试 → 验收 → awaiting_confirm（#fail: 先 fail 再 pass） */
  private async runExec(plan: Plan, slowMs?: number) {
    const t = this.t;
    const willBlock = t.title.includes('#block') && !db.prepare(
      "SELECT 1 FROM task_blocks WHERE task_id=? AND status IN ('open','answered') LIMIT 1"
    ).get(t.id);
    this.emit(t.id, 'phase', { phase: 'executing' }, '▸ 按计划执行');
    // P3 一行进度 + 全部模式消息
    this.emit(t.id, 'progress', { done: 0, total: plan.steps.length, current: plan.steps[0]?.title ?? '' });
    this.emit(t.id, 'message', { role: 'user', injected: '执行', parts: [{ type: 'text', text: `# 继续执行任务：${t.title}\n（stub 执行注入 prompt，省略）` }] });
    this.later(STEP_MS, async () => {
      this.emit(t.id, 'step', { id: 's1', done: true });
      plan.steps[0].done = true;
      this.emit(t.id, 'progress', { done: 1, total: plan.steps.length, current: plan.steps[1]?.title ?? '全部步骤已完成' });
      this.emit(t.id, 'message', { role: 'assistant', parts: [{ type: 'toolCall', name: 'bash', args: '{\n  "command": "stub 自检"\n}' }, { type: 'text', text: '步骤 1 完成，已写回 work/plan.json。' }] });
      if (willBlock) {
        const block = {
          question: 'stub 阻塞：缺少关键决策 X',
          context: { current: '执行中', verified: '已验证 a', impact: '影响 Y', refs: ['work/plan.json'] },
          options: [
            { label: '选项 A', pros: '快', cons: '糙', estimate: '1 分钟' },
            { label: '选项 B', pros: '稳', cons: '慢', estimate: '5 分钟' },
          ],
          recommended: 'A',
        };
        this.writeWorkFile('block.json', block);
        const id = (db.prepare('SELECT COALESCE(MAX(id),0)+1 AS x FROM task_blocks').get() as { x: number }).x;
        db.prepare(
          'INSERT INTO task_blocks (id, task_id, question, context_json, options_json, recommended, asked_at, status) VALUES (?,?,?,?,?,?,?,?)'
        ).run(id, t.id, block.question, JSON.stringify(block.context), JSON.stringify(block.options), 'A', Date.now(), 'open');
        this.emit(t.id, 'block', block, '');
        this.emit(t.id, 'phase', { phase: 'blocked' }, '');
        this.release();
        return;
      }
      if (slowMs) {
        // #slow：留出窗口（steer / cancel / 重启）
        await sleep(slowMs - STEP_MS);
      }
      if (this.released) return; // 期间被取消
      this.emit(t.id, 'step', { id: 's2', done: true });
      plan.steps[1].done = true;
      this.writeWorkFile('done.json', { summary: '## stub 交付\n全部步骤完成（stub 执行器）。', changes: ['stub change'], images: [] });
      this.emit(t.id, 'assistant', { text: 'stub 交付总结：全部步骤完成。' });
      await this.runTests(plan);
    });
  }

  private async runTests(plan: Plan) {
    const t = this.t;
    const first = db.prepare('SELECT retry_count FROM tasks WHERE id=?').get(t.id) as { retry_count: number };
    const willFailFirst = t.title.includes('#fail') && first.retry_count === 0;
    this.emit(t.id, 'message', { role: 'user', injected: '验收', parts: [{ type: 'text', text: `# 验收判定（stub 验收注入，省略）` }] });
    this.emit(t.id, 'phase', { phase: 'testing' }, `▸ 验收：${t.test_cmd || '无测试命令，仅 LLM 判定（stub）'}`);
    this.later(STEP_MS, async () => {
      if (t.test_cmd) this.emit(t.id, 'tool', { name: 'bash', summary: `▸ bash: ${t.test_cmd}`, result: '✓ 通过（stub）' });
      const n = first.retry_count + 1;
      if (willFailFirst) {
        db.prepare('UPDATE tasks SET retry_count=? WHERE id=?').run(n, t.id);
        const review = {
          items: plan.acceptance.map((c) => ({ criterion: c, pass: false, evidence: 'stub 故意失败（第 1 次）' })),
          overall: 'fail',
          note: 'stub 重试路径测试：第一次验收 fail',
        };
        this.emit(t.id, 'review', { ...review, overall: 'fail', retriesLeft: 3 });
        this.emit(t.id, 'system', { text: `验收未通过，agent 修复中（第 ${n}/3 次重试，stub）` });
        this.later(STEP_MS, async () => {
          this.writeWorkFile('done.json', { summary: '## stub 交付（重试后）\n已修复。', changes: ['stub fix'], images: [] });
          this.runTests(plan);
          return;
        });
        return;
      }
      const review = {
        items: plan.acceptance.map((c) => ({ criterion: c, pass: true, evidence: 'stub 判定通过' })),
        overall: 'pass',
        note: 'stub 验收通过',
      };
      this.emit(t.id, 'review', { ...review, overall: 'pass', retriesLeft: 3 });
      this.emit(t.id, 'phase', { phase: 'awaiting_confirm' }, '');
      this.release();
    });
  }
}
