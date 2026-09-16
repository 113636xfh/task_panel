import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, getSettings } from './db.js';
import { PiSession, type RpcEvent } from './executor.js';
import { getPromptTpl, renderTemplate } from './prompts.js';

export type TaskRow = {
  id: string; board_id: string; num: number; title: string; description: string;
  priority: number; status: string; created_at: number; started_at: number | null; finished_at: number | null;
  workspace_path: string; branch_mode: 'manual' | 'auto'; branch_timeout_min: number;
  acceptance_text: string; test_cmd: string; extra_prompt: string; retry_count: number;
  plan_json: string | null; answers_json: string | null; review_json: string | null; checkpoint_json: string | null;
  current_action: string;
  context_window: number;
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

const PLAN_TIMEOUT = 20 * 60_000;
const EXEC_TIMEOUT = 60 * 60_000;
const JUDGE_TIMEOUT = 15 * 60_000;
const TEST_TIMEOUT = 10 * 60_000;
const MAX_NAG = 1;

const workDir = (ws: string) => path.join(ws, 'work');
const workFile = (ws: string, name: string) => path.join(ws, 'work', name);

function readJson(p: string): any {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function deleteQuiet(p: string) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function normalizePlan(raw: any, t: TaskRow): Plan {
  const steps: PlanStep[] = Array.isArray(raw?.steps)
    ? raw.steps.map((s: any, i: number) => ({
        id: String(s?.id ?? `s${i + 1}`),
        title: String(s?.title ?? `步骤 ${i + 1}`),
        goal: String(s?.goal ?? ''),
        actions: Array.isArray(s?.actions) ? s.actions.map(String) : [],
        done: !!s?.done,
      }))
    : [];
  const branch_questions: BranchQ[] = Array.isArray(raw?.branch_questions)
    ? raw.branch_questions.map((q: any, i: number) => ({
        id: String(q?.id ?? `q${i + 1}`),
        q: String(q?.q ?? ''),
        options: Array.isArray(q?.options)
          ? q.options.map((o: any) => ({ label: String(o?.label ?? ''), recommended: !!o?.recommended }))
          : [],
        default: String(q?.default ?? q?.options?.[0]?.label ?? ''),
      }))
    : [];
  return {
    summary: String(raw?.summary ?? t.title),
    steps,
    branch_questions,
    acceptance: Array.isArray(raw?.acceptance) ? raw.acceptance.map(String) : [],
    test_cmd: raw?.test_cmd ? String(raw.test_cmd) : t.test_cmd || undefined,
  };
}

// ---------------- 提示词（P3：模板在设置页可编辑，见 prompts.ts） ----------------

/** 把返工/排队留言渲染为 rework 模板块（无留言 → 空串） */
function reworkBlock(s: ReturnType<typeof getSettings>, msgs: string[]): string {
  if (!msgs.length) return '';
  return renderTemplate(getPromptTpl(s, 'rework'), {
    msgs: msgs.map((m) => `> ${m.replace(/\n/g, '\n> ')}`).join('\n'),
  }).trim() + '\n';
}

function planPrompt(t: TaskRow, s: ReturnType<typeof getSettings>, reworkMsgs: string[] = []): string {
  const skills = (db.prepare('SELECT name, kind FROM task_skills WHERE task_id=?').all(t.id) as { name: string; kind: string }[])
    .map((r) => `- ${r.kind} ${r.name}`)
    .join('\n');
  // 注意：全局系统提示词（s.systemPrompt）不进这里——它被写入 <workspace>/.pi/APPEND_SYSTEM.md
  // 进 system 消息（全会话稳定、跨任务相同 → 前缀缓存友好）。此处的内容都是任务特定的。
  return renderTemplate(getPromptTpl(s, 'plan'), {
    title: t.title,
    description: t.description,
    acceptance: t.acceptance_text || '（未提供，请在 plan.json 的 acceptance 中自行补全可验证判据）',
    test_cmd: t.test_cmd || '（未提供，请在 plan.json 的 test_cmd 中给出建议命令；确实无法给出则留空字符串）',
    extra_prompt: t.extra_prompt || '（无）',
    skills: skills || '（无）',
    rework: reworkBlock(s, reworkMsgs),
  });
}

function execPrompt(
  t: TaskRow,
  plan: Plan,
  answers: Record<string, string>,
  pendingMsgs: string[],
  s: ReturnType<typeof getSettings>,
  extra?: string
): string {
  const ans = Object.entries(answers)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const msgs = pendingMsgs.map((m) => `> ${m.replace(/\n/g, '\n> ')}`).join('\n');
  return `# 继续执行任务：${t.title}

# 计划（work/plan.json，当前状态如下）
${JSON.stringify(plan, null, 2)}

${ans ? `# 分支决策（用户已确认，按此执行）\n${ans}\n` : ''}${msgs ? `# 用户补充留言（必须纳入考虑）\n${msgs}\n` : ''}
${getPromptTpl(s, 'exec')}${extra ? `\n${extra}\n` : ''}
现在开始执行。`;
}

function judgePrompt(t: TaskRow, plan: Plan, testCmd: string, code: number | null, s: ReturnType<typeof getSettings>): string {
  // 验收标准以任务创建时的原始标准为准（plan.acceptance 是规划期的推导，可能随阻塞决策过时）
  const userAcc = (t.acceptance_text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const acc = userAcc.length ? userAcc : plan.acceptance;
  return renderTemplate(getPromptTpl(s, 'judge'), {
    test_cmd: testCmd || '（无测试命令）',
    code: String(code ?? 'N/A'),
    items: JSON.stringify({ items: acc.map((c) => ({ criterion: c, pass: false, evidence: '' })) }, null, 2),
  });
}

// ---------------- 任务级 agent 目录（P3 会话长度覆盖） ----------------

/**
 * 构建自包含的任务级 pi agent 目录（<workspace>/.pi/agent-task-<cw>）：
 * 复制用户全局 agent 目录的 models.json（覆盖本任务 contextWindow）/auth.json/settings.json/
 * trust.json/extensions，然后以 PI_CODING_AGENT_DIR 指向它 spawn pi。
 * 不修改用户全局 pi 配置，不影响 pi CLI。
 */
function buildTaskAgentDir(ws: string, s: ReturnType<typeof getSettings>, cw: number): string {
  const base = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  const dir = path.join(ws, '.pi', `agent-task-${cw}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['auth.json', 'settings.json', 'trust.json']) {
    try {
      fs.copyFileSync(path.join(base, f), path.join(dir, f));
    } catch { /* 源文件不存在则跳过 */ }
  }
  const extSrc = path.join(base, 'extensions');
  const extDst = path.join(dir, 'extensions');
  if (fs.existsSync(extSrc) && !fs.existsSync(extDst)) {
    try { fs.cpSync(extSrc, extDst, { recursive: true }); } catch { /* 忽略 */ }
  }
  let models: any = { providers: {} };
  try {
    models = JSON.parse(fs.readFileSync(path.join(base, 'models.json'), 'utf8'));
  } catch { /* 用空结构 */ }
  const provider = models.providers?.[String(s.provider)];
  const model = provider?.models?.find((m: any) => m?.id === s.execModel);
  if (model) {
    model.contextWindow = cw;
  } else if (provider) {
    provider.models = [...(provider.models ?? []), {
      id: String(s.execModel), name: String(s.execModel),
      api: 'openai-completions', baseUrl: String(s.endpoint),
      contextWindow: cw, maxTokens: 8192,
    }];
  }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(models, null, 2), 'utf8');
  return dir;
}

// ---------------- 全量消息投影（P3 全部模式：推理框架收到的完整会话） ----------------

const PART_CAP = 256 * 1024; // 单个 part 上限（防巨量工具输出刷爆 DB/事件流）

function clip(text: string): { text: string; truncated: boolean } {
  return text.length > PART_CAP ? { text: text.slice(0, PART_CAP), truncated: true } : { text, truncated: false };
}

function projectPart(c: any): any | null {
  if (!c || typeof c !== 'object') return null;
  if (c.type === 'text') {
    const { text, truncated } = clip(String(c.text ?? ''));
    return { type: 'text', text, truncated };
  }
  if (c.type === 'thinking') {
    const { text, truncated } = clip(String(c.thinking ?? c.text ?? ''));
    return { type: 'thinking', text, truncated };
  }
  if (c.type === 'toolCall') {
    let args: unknown = c.arguments;
    try { if (args && typeof args === 'object') args = JSON.stringify(args, null, 2); } catch { /* ignore */ }
    const { text, truncated } = clip(String(args ?? ''));
    return { type: 'toolCall', id: c.id ? String(c.id) : undefined, name: c.name ? String(c.name) : 'tool', args: text, truncated };
  }
  if (c.type === 'image') return { type: 'image' };
  return null;
}

// ---------------- 执行器 ----------------

/**
 * 真实执行器：每任务一个 `pi --mode rpc` 子进程（cwd = 任务工作目录）。
 * 协议文件（都在 <workspace>/work/ 下）：
 *   plan.json    规划产物（planning 阶段后读取）
 *   block.json   阻塞决策（executing 期间出现 → blocked，等待用户）
 *   done.json    交付声明（出现后进入 testing）
 *   review.json  验收判定（judge 回合后读取）
 */
export class TaskRunner {
  private sess: PiSession | null = null;
  private released = false;
  private stopWatchers: NodeJS.Timeout[] = [];
  private answers: Record<string, string> = {};
  private pendingMsgs: string[] = [];
  private nags = 0;
  private execStarted = false;
  private blockBaseline = 0;
  private lastTestAt = 0;
  /** 当前回合注入 prompt 的标签（全部模式下区分「系统注入」与用户消息）；user 消息消费后置空 */
  private promptTag = '';

  constructor(
    private t: TaskRow,
    private emit: EmitFn,
    private onRelease: (taskId: string) => void,
    private settings: ReturnType<typeof getSettings>
  ) {}

  private release() {
    if (this.released) return;
    this.released = true;
    this.onRelease(this.t.id);
  }

  private clearWatchers() {
    this.stopWatchers.forEach(clearInterval);
    this.stopWatchers = [];
  }

  stop() {
    this.released = true;
    this.clearWatchers();
    const s = this.sess;
    if (s && !s.exited) {
      s.send({ type: 'abort' });
      s.kill();
    }
    this.onRelease(this.t.id);
  }

  steer(text: string) {
    const s = this.sess;
    if (s && !s.exited && s.streaming) {
      s.send({ type: 'steer', message: text });
      this.emit(this.t.id, 'system', { text: 'steer 已注入（当前回合工具调用结束后、下次 LLM 调用前生效）' });
      return;
    }
    db.prepare('INSERT INTO task_user_msgs (task_id, text, at) VALUES (?,?,?)').run(this.t.id, text, Date.now());
    this.emit(this.t.id, 'system', { text: '留言已入队（下一个执行点自动合入上下文）' });
  }

  private setupSession() {
    const t = this.t;
    const s = this.settings;
    fs.mkdirSync(workDir(t.workspace_path), { recursive: true });
    // 清理上一轮遗留的协议文件（恢复执行场景）
    deleteQuiet(workFile(t.workspace_path, 'block.json'));
    deleteQuiet(workFile(t.workspace_path, 'review.json'));
    // 全局系统提示词 → <workspace>/.pi/APPEND_SYSTEM.md（pi 自动追加到 system 消息：
    // 全会话稳定、跨任务相同 → 前缀缓存友好；不动用户全局 ~/.pi/agent 配置，跨平台无命令行长度问题）
    const appendFile = path.join(t.workspace_path, '.pi', 'APPEND_SYSTEM.md');
    if (s.systemPrompt && s.systemPrompt.trim()) {
      fs.mkdirSync(path.join(t.workspace_path, '.pi'), { recursive: true });
      fs.writeFileSync(appendFile, s.systemPrompt, 'utf8');
    } else {
      deleteQuiet(appendFile);
    }
    const args = ['--name', `taskpanel-${t.id}`];
    // 非交互 RPC 模式下 defaultProjectTrust=ask 会忽略项目内 .pi 资源（信任门），
    // --approve 仅对本次运行生效（不写 trust.json、不动全局配置），保证 APPEND_SYSTEM.md 被加载
    args.push('--approve');
    if (s.provider) args.push('--provider', String(s.provider));
    if (s.execModel) args.push('--model', String(s.execModel));
    // P3 会话长度：任务级覆盖 > 全局默认；>0 时构建自包含 agent 目录（PI_CODING_AGENT_DIR）
    const cw = t.context_window > 0 ? t.context_window : Math.max(0, Number(s.contextWindow) || 0);
    const envExtra: Record<string, string> = { TP_PANEL: '1' };
    if (cw > 0) {
      try {
        envExtra.PI_CODING_AGENT_DIR = buildTaskAgentDir(t.workspace_path, s, cw);
      } catch { /* 构建失败则用默认目录（不阻塞任务） */ }
    }
    this.sess = new PiSession(t.workspace_path, args, envExtra);
    this.sess.onEvent((ev) => this.onPiEvent(ev));
    this.sess.spawn();
  }

  private closeSession() {
    const s = this.sess;
    this.sess = null;
    if (s && !s.exited) s.kill();
  }

  private onPiEvent(ev: RpcEvent) {
    if (this.released) return;
    const t = this.t;
    if (ev.type === 'message_end') {
      const m = ev.message as { role?: string; content?: { type?: string; text?: string }[]; toolName?: string; isError?: boolean } | undefined;
      if (m?.role === 'assistant' && Array.isArray(m.content)) {
        const text = m.content
          .filter((c) => c?.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n')
          .trim();
        if (text) this.emit(t.id, 'assistant', { text: text.slice(0, 4000) });
      }
      // P3 全部模式：投影完整消息（user/assistant/toolResult；user 带注入标签）
      if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult') && Array.isArray(m.content)) {
        const parts = (m.content as any[]).map(projectPart).filter(Boolean);
        if (parts.length) {
          const payload: Record<string, unknown> = { role: m.role, parts };
          if (m.role === 'user') {
            payload.injected = this.promptTag || 'user';
            this.promptTag = ''; // 消费：后续 user 消息（steer/留言）不再误标
          }
          if (m.role === 'toolResult') {
            payload.toolName = m.toolName ? String(m.toolName) : undefined;
            payload.isError = !!m.isError;
          }
          this.emit(t.id, 'message', payload);
        }
      }
    } else if (ev.type === 'tool_execution_start') {
      const name = String(ev.toolName ?? 'tool');
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const brief = name === 'bash' ? String(args.command ?? '') : String(args.path ?? args.file_path ?? '');
      this.emit(t.id, 'tool', { name, summary: `▸ ${name}${brief ? ': ' + brief.split('\n')[0].slice(0, 120) : ''}` });
    } else if (ev.type === 'tool_execution_end' && ev.isError) {
      const name = String((ev.result as { [k: string]: unknown })?.name ?? ev.toolName ?? 'tool');
      this.emit(t.id, 'system', { text: `工具 ${name} 执行出错（见上方工具输出）` });
    }
  }

  private saveCheckpoint(status: string, summary: string) {
    const f = this.sess?.sessionFile ?? null;
    if (!f) return;
    const t = this.t;
    db.prepare(
      'INSERT INTO checkpoints (task_id, at_status, session_file, summary, at) VALUES (?,?,?,?,?)'
    ).run(t.id, status, f, summary.slice(0, 300), Date.now());
    db.prepare('UPDATE tasks SET checkpoint_json=? WHERE id=?').run(JSON.stringify({ session_file: f, at_status: status, at: Date.now() }), t.id);
  }

  private fail(msg: string, detail?: string) {
    if (this.released) return;
    this.emit(this.t.id, 'system', { text: `执行失败：${msg}${detail ? `\n\`\`\`\n${detail.slice(-1500)}\n\`\`\`` : ''}` });
    this.emit(this.t.id, 'phase', { phase: 'failed' }, '');
    this.closeSession();
    this.release();
  }

  /** 启动 block 侦测：streaming 中出现新 block.json → 立即 abort（协议要求 agent 停手） */
  private startBlockWatch() {
    const t = this.t;
    this.blockBaseline = Date.now();
    const timer = setInterval(() => {
      if (this.released || !this.sess) return;
      const p = workFile(t.workspace_path, 'block.json');
      let mtime = 0;
      try {
        mtime = fs.statSync(p).mtimeMs;
      } catch {
        return;
      }
      if (mtime > this.blockBaseline && this.sess.streaming) {
        this.sess.send({ type: 'abort' });
      }
    }, 1000);
    this.stopWatchers.push(timer);
  }

  /** 到点检查新 block.json；有则落库 + 广播 + 转 blocked */
  private handleBlock(): boolean {
    const t = this.t;
    const p = workFile(t.workspace_path, 'block.json');
    let mtime = 0;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      return false;
    }
    if (mtime <= this.blockBaseline) return false;
    const b = readJson(p);
    if (!b || !b.question) return false;
    const id = (db.prepare('SELECT COALESCE(MAX(id),0)+1 AS x FROM task_blocks').get() as { x: number }).x;
    db.prepare(
      'INSERT INTO task_blocks (id, task_id, question, context_json, options_json, recommended, asked_at, status) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      id, t.id, String(b.question),
      JSON.stringify(b.context ?? {}),
      JSON.stringify(Array.isArray(b.options) ? b.options : []),
      String(b.recommended ?? 'A'),
      Date.now(), 'open'
    );
    this.emit(t.id, 'block', b, '');
    this.emit(t.id, 'phase', { phase: 'blocked' }, '');
    this.closeSession();
    this.release();
    return true;
  }

  private freshDone(): boolean {
    const p = workFile(this.t.workspace_path, 'done.json');
    let mtime = 0;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      return false;
    }
    return mtime > this.lastTestAt - 1; // done.json 必须是本轮执行写出的
  }

  private async promptWait(message: string, timeoutMs: number, action: string): Promise<void> {
    const s = this.sess!;
    this.emit(this.t.id, 'system', { text: `▸ ${action}` });
    const res = await s.send({ type: 'prompt', message });
    if (!res.success) throw new Error(String(res.error ?? 'prompt 被拒绝'));
    await s.refreshSessionFile();
    this.saveCheckpoint(this.t.status, action);
    await s.waitSettled(timeoutMs);
  }

  // ---------------- 生命周期 ----------------

  async start(t: TaskRow) {
    this.t = t;
    // 返工/排队留言：读出未投递留言并标记已投递（合入本轮首个 prompt）
    const pendRows = (db.prepare('SELECT text FROM task_user_msgs WHERE task_id=? AND delivered_at IS NULL ORDER BY id').all(t.id) as { text: string }[]).map((r) => r.text);
    db.prepare('UPDATE task_user_msgs SET delivered_at=? WHERE task_id=? AND delivered_at IS NULL').run(Date.now(), t.id);
    const rework = pendRows.length > 0;
    this.setupSession();
    // 返工场景：上一轮 checkpoint 有会话文件 → 切回原会话（全量上下文，同会话重新打磨）
    const cp = t.checkpoint_json ? (readJson(t.checkpoint_json) as { session_file?: string } | null) : null;
    if (rework && cp?.session_file) {
      try {
        if (fs.existsSync(cp.session_file)) {
          await this.sess!.send({ type: 'switch_session', sessionPath: cp.session_file }, 15_000);
          await this.sess!.refreshSessionFile();
          this.emit(t.id, 'system', { text: '已切回原会话（全量上下文恢复）；已合入用户返工反馈' });
        }
      } catch { /* 切回失败则新上下文重走 */ }
    }
    const plan = await this.planPhase(pendRows);
    if (this.released) return;
    if (!plan) return;
    const needAnswer = t.branch_mode === 'manual' && plan.branch_questions.length > 0;
    if (needAnswer) {
      this.emit(t.id, 'phase', { phase: 'waiting_input' }, '');
      this.closeSession();
      this.release();
      return;
    }
    this.execStarted = false;
    this.nags = 0;
    await this.execLoop(plan);
  }

  async resume(t: TaskRow, plan: Plan, answers: Record<string, string>, pendingMsgs: string[]) {
    this.t = t;
    this.answers = answers;
    this.pendingMsgs = pendingMsgs;
    this.setupSession();
    // 断点续跑：若 checkpoint 有 session 文件 → 切回原会话（全量上下文）
    const cp = t.checkpoint_json ? (readJson(t.checkpoint_json) as { session_file?: string } | null) : null;
    if (cp?.session_file) {
      try {
        if (fs.existsSync(cp.session_file)) {
          await this.sess!.send({ type: 'switch_session', sessionPath: cp.session_file }, 15_000);
          await this.sess!.refreshSessionFile();
          this.emit(t.id, 'system', { text: '已切回原会话（全量上下文恢复）' });
        }
      } catch {
        /* 切回失败则用新上下文重放计划 */
      }
    }
    if (pendingMsgs.length) this.emit(t.id, 'system', { text: `恢复执行；已合入 ${pendingMsgs.length} 条排队留言（见留言板）` });
    for (const s of plan.steps) if (s.done) this.emit(t.id, 'step', { id: s.id, done: true });
    this.execStarted = false;
    this.nags = 0;
    // 阻塞已决：把用户决策合入恢复 prompt（否则 agent 会按原计划重走「写 block.json」步骤）
    const answered = db.prepare(
      "SELECT question, answer FROM task_blocks WHERE task_id=? AND status='answered' ORDER BY id DESC LIMIT 1"
    ).get(t.id) as { question: string; answer: string } | undefined;
    let extra = '';
    if (answered?.answer) {
      extra = `# 阻塞已决（用户拍板，最高优先级）\n之前的阻塞问题：${answered.question}\n用户决策：${answered.answer}\n按此决策继续完成剩余步骤（例如把决策值写入相应文件）；【不要】再写 work/block.json；计划步骤若与该决策冲突，一律以用户决策为准。`;
    }
    await this.execLoop(plan, extra || undefined, 'resume');
  }

  private async planPhase(reworkMsgs: string[] = []) {
    const t = this.t;
    const s = this.settings;
    this.promptTag = reworkMsgs.length ? 'rework' : 'planning';
    await this.promptWait(planPrompt(t, s, reworkMsgs), PLAN_TIMEOUT, '规划智能体审视任务并产出 work/plan.json');
    if (this.released) return null;
    if (this.sess!.exited) {
      this.fail('pi 进程意外退出（规划阶段）', this.sess!.stderrTail);
      return null;
    }

    let raw = readJson(workFile(t.workspace_path, 'plan.json'));
    if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      if (this.nags < MAX_NAG) {
        this.nags++;
        await this.promptWait(
          '未检测到 work/plan.json（或格式不合法）。请严格按要求的 schema 把计划写入 work/plan.json 后立即停止。',
          10 * 60_000, '补写 plan.json'
        );
        if (this.released || this.sess!.exited) {
          if (this.sess!.exited && !this.released) this.fail('pi 进程意外退出（补写 plan.json）', this.sess!.stderrTail);
          return null;
        }
        raw = readJson(workFile(t.workspace_path, 'plan.json'));
      }
    }
    if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      this.fail('规划失败：未能获得合法的 work/plan.json（可能模型未遵循指令或上下文不足）');
      return null;
    }
    const plan = normalizePlan(raw, t);
    this.emit(t.id, 'planned', plan, '');
    this.emit(t.id, 'asset', { kind: 'plan', name: 'work/plan.json', path: 'work/plan.json', summary: plan.summary.slice(0, 80) });
    return plan;
  }

  private async execLoop(plan: Plan, extra?: string, tag: 'executing' | 'resume' = 'executing') {
    const t = this.t;
    // plan.json 以磁盘为准（agent 每完成一步会写回 done=true；恢复/重试时内存副本会过时）
    const disk = readJson(workFile(t.workspace_path, 'plan.json'));
    if (disk && Array.isArray(disk.steps)) {
      for (const s of plan.steps) {
        const d = disk.steps.find((x: any) => x && x.id === s.id);
        if (d) s.done = !!d.done;
      }
    }
    if (!this.execStarted) {
      this.execStarted = true;
      this.emit(t.id, 'phase', { phase: 'executing' }, '▸ 按计划执行');
    }
    // P3 看板一行进度：从 plan.json 步骤勾选派生（无需额外提示词注入）
    const doneN = plan.steps.filter((x) => x.done).length;
    const cur = plan.steps.find((x) => !x.done);
    this.emit(t.id, 'progress', { done: doneN, total: plan.steps.length, current: cur?.title ?? '全部步骤已完成' });
    this.lastTestAt = Date.now();
    this.startBlockWatch();
    this.promptTag = tag;
    const prompt = execPrompt(t, plan, this.answers, this.pendingMsgs, this.settings, extra);
    this.pendingMsgs = [];
    const s = this.sess!;
    const res = await s.send({ type: 'prompt', message: prompt });
    if (!res.success) {
      this.clearWatchers();
      return this.fail('执行 prompt 被拒绝', String(res.error));
    }
    await s.refreshSessionFile();
    this.saveCheckpoint('executing', '执行中');
    await s.waitSettled(EXEC_TIMEOUT);
    this.clearWatchers();
    if (this.released) return;
    if (this.handleBlock()) return;
    if (s.exited) return this.fail('pi 进程意外退出（执行阶段）', s.stderrTail);
    if (this.freshDone()) {
      await this.runTests(plan);
      return;
    }
    if (this.nags < MAX_NAG) {
      this.nags++;
      await this.promptWait(
        '你上一轮停止了但没有写出 work/done.json。请继续完成剩余步骤；全部完成后写 work/done.json 并给出交付总结。若被阻塞，写 work/block.json 后停止。',
        30 * 60_000, '继续执行（上一轮未交付）'
      );
      if (this.released || s.exited) {
        if (s.exited && !this.released) this.fail('pi 进程意外退出（续跑）', s.stderrTail);
        return;
      }
      if (this.handleBlock()) return;
      if (this.freshDone()) {
        await this.runTests(plan);
        return;
      }
    }
    this.fail('agent 两轮后仍未交付（缺少 work/done.json）');
  }

  private async runTests(plan: Plan) {
    const t = this.t;
    const s = this.sess!;
    this.emit(t.id, 'phase', { phase: 'testing' }, `▸ 验收：${t.test_cmd || '无测试命令，仅 LLM 判定'}`);
    const testCmd = plan.test_cmd || t.test_cmd || '';
    let code: number | null = null;
    let testOut = '';
    if (testCmd) {
      this.emit(t.id, 'tool', { name: 'bash', summary: `▸ bash: ${testCmd}` });
      const r = await s.bash(testCmd, TEST_TIMEOUT);
      code = r.code;
      testOut = r.out;
      this.emit(
        t.id, 'tool',
        { name: 'bash', summary: `▸ bash: ${testCmd}`, result: code === 0 ? '✓ 通过' : `exit=${code}\n${testOut.slice(-800)}` }
      );
    } else {
      this.emit(t.id, 'system', { text: '未配置测试命令，本次验收仅由 LLM 判定' });
    }

    // LLM 验收官（同一会话：测试输出已在上下文中）
    this.promptTag = 'acceptance';
    await this.promptWait(judgePrompt(t, plan, testCmd, code, this.settings), JUDGE_TIMEOUT, '验收官逐项判定，写入 work/review.json');
    if (this.released || s.exited) {
      if (s.exited && !this.released) this.fail('pi 进程意外退出（验收阶段）', s.stderrTail);
      return;
    }
    let review = readJson(workFile(t.workspace_path, 'review.json'));
    if (!review || !Array.isArray(review.items)) {
      const ok = code == null || code === 0;
      review = {
        items: (plan.acceptance.length ? plan.acceptance : [t.acceptance_text]).map((c: string) => ({
          criterion: c, pass: ok, evidence: 'review.json 缺失，按测试退出码自动判定',
        })),
        overall: ok ? 'pass' : 'fail',
        note: '自动判定（验收官未写 review.json）',
      };
    }
    const retriesLeft = Math.max(0, this.settings.retryMax - t.retry_count);
    const overall: string = review.overall === 'pass' ? 'pass' : 'fail';
    this.emit(t.id, 'review', { ...review, overall, retriesLeft });

    if (overall === 'pass') {
      const done = readJson(workFile(t.workspace_path, 'done.json'));
      if (done?.summary) this.emit(t.id, 'assistant', { text: String(done.summary).slice(0, 4000) });
      this.emit(t.id, 'phase', { phase: 'awaiting_confirm' }, '');
      this.closeSession();
      this.release();
      return;
    }

    if (t.retry_count < this.settings.retryMax) {
      const n = t.retry_count + 1;
      db.prepare('UPDATE tasks SET retry_count=? WHERE id=?').run(n, t.id);
      t.retry_count = n;
      this.emit(t.id, 'system', { text: `验收未通过，agent 修复中（第 ${n}/${this.settings.retryMax} 次重试）` });
      this.nags = 0;
      await this.execLoop(plan, `# 验收未通过（第 ${n} 次重试）\n${JSON.stringify(review, null, 2)}\n修复上述不通过项，重新运行测试命令 \`${testCmd || '（无）'}\` 直至通过，然后更新 work/done.json 并给出最终交付总结。`);
      if (this.released) return;
      await this.runTests(plan);
    } else {
      this.emit(t.id, 'system', { text: `重试次数用尽（${this.settings.retryMax} 次），转人工判定：可确认完成或取消任务` });
      this.emit(t.id, 'phase', { phase: 'awaiting_confirm' }, '');
      this.closeSession();
      this.release();
    }
  }
}
