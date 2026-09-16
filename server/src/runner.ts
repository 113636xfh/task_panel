import { db, type getSettings } from './db.js';

export type TaskRow = {
  id: string; board_id: string; num: number; title: string; description: string;
  priority: number; status: string; created_at: number; started_at: number | null; finished_at: number | null;
  workspace_path: string; branch_mode: 'manual' | 'auto'; branch_timeout_min: number;
  acceptance_text: string; test_cmd: string; extra_prompt: string; retry_count: number;
  plan_json: string | null; answers_json: string | null; review_json: string | null; checkpoint_json: string | null;
  current_action: string;
};

export type PlanStep = { id: string; title: string; goal: string; actions: string[]; done: boolean };
export type BranchQ = { id: string; q: string; options: { label: string; recommended?: boolean }[]; default: string };
export type Plan = {
  summary: string;
  steps: PlanStep[];
  branch_questions: BranchQ[];
  acceptance: string[];
  test_cmd?: string;
};

export type EmitFn = (taskId: string, kind: string, payload: unknown, action?: string) => void;

function makePlan(t: TaskRow): Plan {
  const title = t.title;
  const acceptance = t.acceptance_text
    .split(/\r?\n|(?<=。)/)
    .map((s) => s.trim().replace(/^[-*\d\.\)\s]+/, ''))
    .filter(Boolean)
    .slice(0, 6);
  return {
    summary: `对「${title}」的描述做了 grade me 式审视：初版描述较简略，缺少边界条件与可验证判据；已补充拆分步骤与验收标准。总评：可执行，但需确认实现取向。`,
    steps: [
      { id: 's1', title: '梳理现状与需求拆解', goal: `明确「${title}」的边界与输入输出`, actions: ['通读任务描述', '列出关键约束'], done: false },
      { id: 's2', title: '设计方案', goal: '确定实现路径与关键取舍', actions: ['对比可选方案', '写入 work/plan 备注'], done: false },
      { id: 's3', title: '实现核心逻辑', goal: '完成主体实现', actions: ['编写代码', '自测基础路径'], done: false },
      { id: 's4', title: '测试与验证', goal: '运行测试并修复失败项', actions: ['运行测试命令', '修复回归'], done: false },
      { id: 's5', title: '验收自查', goal: '逐项核对验收标准', actions: ['逐条验证', '输出自查结论'], done: false },
    ],
    branch_questions: [
      {
        id: 'q1',
        q: `「${title}」的实现取向如何选？`,
        options: [
          { label: '稳妥方案：优先兼容与可回滚（推荐）', recommended: true },
          { label: '激进方案：一步到位，接受短期不稳定' },
        ],
        default: '稳妥方案：优先兼容与可回滚（推荐）',
      },
    ],
    acceptance,
    test_cmd: t.test_cmd || undefined,
  };
}

const TOOL_SEQ = [
  { name: 'read', fmt: (s: string) => `▸ read  work/brief.md` },
  { name: 'bash', fmt: (s: string) => `▸ bash: 收集现有结构 (ls -R . | head)` },
  { name: 'write', fmt: (s: string) => `▸ write  work/design-note.md — ${s}` },
  { name: 'edit', fmt: (s: string) => `▸ edit  实现主体 (+${28 + Math.floor(Math.random() * 40)} 行)` },
  { name: 'bash', fmt: (s: string) => `▸ bash: 自测通过` },
];

/**
 * P0 stub 执行器：模拟 planning → [waiting_input] → executing → testing → awaiting_confirm 的完整生命周期，
 * 用于 UI/调度/事件流联调。P1 由 PiExecutor（pi --mode rpc）替换，接口保持不变。
 * 测试钩子：任务描述包含「阻塞」关键字时，执行到 s2 会触发 block（演示 blocked 列）。
 */
export class TaskRunner {
  private timers: NodeJS.Timeout[] = [];
  private released = false;
  private plan: Plan | null = null;

  constructor(
    private t: TaskRow,
    private emit: EmitFn,
    private onRelease: (taskId: string) => void,
    private settings: ReturnType<typeof getSettings>
  ) {}

  private after(ms: number, fn: () => void) {
    let t!: NodeJS.Timeout;
    t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      if (!this.released) fn();
    }, ms);
    this.timers.push(t);
  }

  private release() {
    if (this.released) return;
    this.released = true;
    this.onRelease(this.t.id);
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.release();
  }

  steer(text: string) {
    // stub：仅记录到留言板（真实执行器走 pi RPC steer 命令）
    this.emit(this.t.id, 'system', { text: `steer 已注入队列（下次 LLM 调用前生效）: ${text}` });
  }

  start(t: TaskRow) {
    this.t = t;
    const E = (delay: number, kind: string, payload: unknown, action?: string) => this.after(delay, () => this.emit(t.id, kind, payload, action));
    E(600, 'think', { text: `审视任务描述「${t.title}」：检查模糊点、缺失约束与风险…（grade me）` }, '▸ grade me 审视中');
    this.after(3200, () => {
      const plan = makePlan(t);
      this.plan = plan;
      this.emit(t.id, 'planned', plan, '');
      this.emit(t.id, 'asset', { kind: 'plan', name: 'work/plan.json', summary: plan.summary.slice(0, 80) });
      const needAnswer = t.branch_mode === 'manual' && plan.branch_questions.length > 0;
      if (needAnswer) {
        this.emit(t.id, 'phase', { phase: 'waiting_input' }, '');
        this.release();
      } else {
        this.runExec(plan, {}, 3600);
      }
    });
  }

  /** 恢复：分支已答 / 阻塞已决。P1 真实实现为 session resume 全量重放。 */
  resume(t: TaskRow, plan: Plan, _answers: Record<string, string>, pendingCount: number) {
    this.t = t;
    this.plan = plan;
    if (pendingCount > 0) {
      this.emit(t.id, 'system', { text: `恢复执行；已合入 ${pendingCount} 条排队留言（见留言板）` });
    }
    // 已完成的步骤标记
    for (const s of plan.steps) if (s.done) this.emit(t.id, 'step', { id: s.id, done: true });
    this.runExec(plan, _answers, 500);
  }

  private runExec(plan: Plan, _answers: Record<string, string>, base: number) {
    const t = this.t;
    this.emit(t.id, 'phase', { phase: 'executing' }, '▸ 按计划执行');
    let acc = base;
    const tools = TOOL_SEQ;
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      if (s.done) continue;
      const tool = tools[i % tools.length];
      this.after(acc, () => this.emit(t.id, 'tool', { name: tool.name, args: { ref: s.title }, summary: tool.fmt(s.title) }, `▸ ${s.title}`));
      const stepDelay = acc + 2600;
      this.after(stepDelay, () => this.emit(t.id, 'step', { id: s.id, done: true }));
      // 阻塞钩子
      if (t.description.includes('阻塞') && s.id === 's2') {
        this.after(stepDelay + 400, () => {
          const block = {
            question: `「${s.title}」存在我无法自行决断的取舍：两种方案对验收标准影响不同，且本机环境限制导致无法自行验证。`,
            context: {
              current: `执行到步骤 2（${s.title}），plan.json 步骤 1 已完成。`,
              verified: '已验证：现有代码结构可承载两种方案（见 work/design-note.md）。',
              impact: '选 A 不改验收标准，约 +40m；选 B 需同步修改验收标准第 1 条，约 +2h。',
              refs: ['work/plan.json#s2', 'work/design-note.md'],
            },
            options: [
              { label: '采用稳妥方案，保持验收标准不变', pros: '风险低', cons: '扩展性一般', estimate: '+40m' },
              { label: '采用激进方案，同步修订验收标准', pros: '一步到位', cons: '需要改验收', estimate: '+2h' },
            ],
            recommended: 'A',
          };
          const id = (db.prepare('SELECT COALESCE(MAX(id),0)+1 AS x FROM task_blocks').get() as { x: number }).x;
          db.prepare(
            'INSERT INTO task_blocks (id, task_id, question, context_json, options_json, recommended, asked_at, status) VALUES (?,?,?,?,?,?,?,?)'
          ).run(id, t.id, block.question, JSON.stringify(block.context), JSON.stringify(block.options), block.recommended, Date.now(), 'open');
          this.emit(t.id, 'block', block, '');
          this.emit(t.id, 'phase', { phase: 'blocked' }, '');
          this.release();
        });
        return;
      }
      acc = stepDelay + 800;
    }
    this.after(acc + 400, () => this.emit(t.id, 'phase', { phase: 'testing' }, `▸ 运行 ${t.test_cmd || '测试'}`));
    const testCmd = t.test_cmd || 'npm test';
    this.after(acc + 1800, () =>
      this.emit(t.id, 'tool', { name: 'bash', summary: `▸ bash: ${testCmd}`, result: '✓ 全部通过 (stub 模拟)' }, `▸ bash: ${testCmd}`)
    );
    this.after(acc + 3600, () => {
      const items = plan.acceptance.map((c) => ({ criterion: c, pass: true, evidence: 'stub: 自查通过' }));
      const overall = items.every((i) => i.pass) ? 'pass' : 'fail';
      const review = { items, overall, retriesLeft: this.settings.retryMax };
      this.emit(t.id, 'review', review, '');
      if (overall === 'pass') {
        this.emit(t.id, 'phase', { phase: 'awaiting_confirm' }, '');
      } else {
        // stub 下不会走到；P1 由调度器处理重试
        this.emit(t.id, 'system', { text: '验收未通过，进入重试' });
      }
      this.release();
    });
  }
}
