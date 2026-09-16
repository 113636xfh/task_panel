import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export type RpcEvent = { type: string; [k: string]: unknown };

let seq = 0;
const nid = () => `tp-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * pi --mode rpc 子进程封装。
 * - 严格 JSONL（只按 \n 切分，剥尾 \r）；
 * - 命令带 id 关联响应；bash 命令长超时 + abort_bash；
 * - agent_settled = 会话完全静止（无重试/压缩/排队续跑）；
 * - extension_ui_request 自动应答（无人值守：confirm→允许，select→首项，input/editor→取消）。
 */
export class PiSession {
  child: ChildProcess | null = null;
  exited = false;
  /** 是否正在流式处理（agent_start → agent_settled 之间） */
  streaming = false;
  stderrTail = '';
  /** 当前会话文件（get_state 后更新），用于 checkpoint / 恢复 */
  sessionFile: string | null = null;

  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private pending = new Map<string, { resolve: (d: RpcEvent) => void; timer: NodeJS.Timeout }>();
  private eventCb: (ev: RpcEvent) => void = () => {};
  private settledWaiters: { resolve: (v: boolean) => void; timer: NodeJS.Timeout }[] = [];
  private exitResolve: (() => void) | null = null;

  constructor(private cwd: string, private extraArgs: string[] = [], private envExtra: Record<string, string> = {}) {}

  onEvent(cb: (ev: RpcEvent) => void) {
    this.eventCb = cb;
  }

  spawn(): void {
    const isWin = process.platform === 'win32';
    this.child = spawn('pi', ['--mode', 'rpc', ...this.extraArgs], {
      cwd: this.cwd,
      shell: isWin, // Windows: pi 是 .cmd shim，需经 shell 解析
      windowsHide: true,
      // P3：任务级 agent 目录（PI_CODING_AGENT_DIR）覆盖 contextWindow 等，不动用户全局 pi 配置
      env: { ...process.env, ...this.envExtra },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (d: Buffer) => {
      this.buffer += this.decoder.write(d);
      this.flushLines();
    });
    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + String(d)).slice(-4000);
    });
    this.child.on('error', (e) => {
      this.stderrTail = (this.stderrTail + String(e)).slice(-4000);
      this.failAll(String(e));
    });
    this.child.on('exit', (code) => {
      this.exited = true;
      this.streaming = false;
      this.failAll(`pi 进程退出 (code=${code})`);
      this.exitResolve?.();
      // 未决的 settled 等待者按超时处理
      for (const w of this.settledWaiters.splice(0)) {
        clearTimeout(w.timer);
        w.resolve(false);
      }
    });
  }

  private failAll(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve({ type: 'response', success: false, error: reason, id });
    }
  }

  private flushLines() {
    for (;;) {
      const i = this.buffer.indexOf('\n');
      if (i === -1) break;
      let line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      line = line.trim();
      if (!line) continue;
      let ev: RpcEvent;
      try {
        ev = JSON.parse(line) as RpcEvent;
      } catch {
        continue; // 非 JSONL 行（如启动 banner）忽略
      }
      if (ev.type === 'response') {
        const id = ev.id as string | undefined;
        if (id && this.pending.has(id)) {
          const p = this.pending.get(id)!;
          clearTimeout(p.timer);
          this.pending.delete(id);
          p.resolve(ev);
        }
        continue;
      }
      if (ev.type === 'agent_start') this.streaming = true;
      if (ev.type === 'agent_settled') {
        this.streaming = false;
        for (const w of this.settledWaiters.splice(0)) {
          clearTimeout(w.timer);
          w.resolve(true);
        }
      }
      this.handleUiRequest(ev);
      this.eventCb(ev);
    }
  }

  /** 无人值守自动应答扩展 UI 请求（pi-ask / 权限确认等） */
  private handleUiRequest(ev: RpcEvent) {
    if (ev.type !== 'extension_ui_request') return;
    const id = ev.id as string;
    const method = ev.method as string;
    let resp: Record<string, unknown> | null = null;
    if (method === 'confirm') resp = { type: 'extension_ui_response', id, confirmed: true };
    else if (method === 'select') resp = { type: 'extension_ui_response', id, value: (ev.options as string[] | undefined)?.[0] ?? '' };
    else if (method === 'input' || method === 'editor') resp = { type: 'extension_ui_response', id, cancelled: true };
    if (resp && this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(resp) + '\n');
  }

  send(cmd: Record<string, unknown>, timeoutMs = 30_000): Promise<RpcEvent> {
    const id = nid();
    return new Promise((resolve) => {
      if (!this.child?.stdin?.writable) {
        resolve({ type: 'response', success: false, error: 'pi 未启动或 stdin 已关闭', id });
        return;
      }
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) resolve({ type: 'response', success: false, error: `命令超时 (${Math.round(timeoutMs / 1000)}s)`, id });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.child!.stdin!.write(JSON.stringify({ ...cmd, id }) + '\n');
    });
  }

  /** 等待会话完全静止；超时返回 false（不抛错，调用方自行兜底） */
  waitSettled(timeoutMs: number): Promise<boolean> {
    if (!this.streaming) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.settledWaiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.settledWaiters.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      this.settledWaiters.push({ resolve, timer });
    });
  }

  /** RPC bash：在工作目录执行命令并进入会话上下文；超时自动 abort_bash */
  async bash(command: string, timeoutMs = 600_000): Promise<{ code: number | null; out: string; fullOutputPath?: string | null }> {
    const res = await this.send({ type: 'bash', command }, timeoutMs + 10_000);
    if (!res.success) {
      this.send({ type: 'abort_bash' });
      return { code: -1, out: String(res.error ?? 'bash 失败') };
    }
    const d = res.data as { output?: string; exitCode?: number | null; fullOutputPath?: string | null } | undefined;
    return { code: d?.exitCode ?? null, out: (d?.output ?? '').slice(-20000), fullOutputPath: d?.fullOutputPath ?? null };
  }

  state(): Promise<RpcEvent> {
    return this.send({ type: 'get_state' }, 10_000);
  }

  async refreshSessionFile() {
    const res = await this.state();
    const f = (res.data as { sessionFile?: string } | undefined)?.sessionFile;
    if (f) this.sessionFile = f;
  }

  lastAssistantText(): Promise<RpcEvent> {
    return this.send({ type: 'get_last_assistant_text' }, 10_000);
  }

  exit(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      this.exitResolve = () => resolve();
      // 宽限 3s 后强杀（Windows: 连带子树）
      setTimeout(() => this.kill(), 3000).unref?.();
    });
  }

  kill() {
    const c = this.child;
    if (!c || c.pid == null) return;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true });
      else c.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}
