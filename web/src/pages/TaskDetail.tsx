import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TopControls from '../components/TopControls';
import {
  ArrowLeft,
  X,
  Folder,
  Clock,
  FileText,
  OctagonAlert,
  Pencil,
  ShieldCheck,
  RefreshCw,
  Check,
  Send,
  CircleCheck,
  Terminal,
  MessageSquare,
  GitBranch,
  ImagePlus,
  PanelBottomOpen,
  PanelBottomClose,
  Bot,
  Download,
  ListFilter,
  RotateCcw,
  ChevronDown,
  Pause,
  Play,
  Brain,
  Gauge,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtAgo, fmtDur, fmtTime } from '../lib/fmt';

const baseName = (p: string) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '';
import { toast } from '../lib/toast';
import AssetPreview from '../components/AssetPreview';
import ConfirmDialog from '../components/ConfirmDialog';
import { MD } from '../lib/md';
import { fileToBase64 } from '../lib/img';
import { useI18n } from '../i18n';
import type { BlockItem, Plan, Task, TaskEvent } from '../lib/types';

// 可折叠长文本（full 模式的 system prompt / 工具输出）
function Collapsible({ text, defaultOpen = false, openLabel, closeLabel }: { text: string; defaultOpen?: boolean; openLabel: string; closeLabel: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const long = text.length > 600;
  if (!long && !open) {
    return <pre className="m-pre">{text}</pre>;
  }
  return (
    <>
      <pre className="m-pre" style={open || !long ? undefined : { maxHeight: 160, overflow: 'hidden' }}>
        {open || !long ? text : text}
      </pre>
      <button className="btn ghost mini m-toggle" data-testid="msg-toggle" onClick={() => setOpen(!open)}>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : '' }} /> {open ? closeLabel : openLabel}
      </button>
    </>
  );
}

// ===== full 模式：TUI 风格渲染（复刻 pi TUI：工具状态色框 + 时间脚注；思考=灰斜体块；段间距=一个空行） =====

// TUI 工具调用框：执行中=灰框+Elapsed（每秒刷新）；成功=绿框；失败=红框 + Took
// 标题行：粗体工具名 + 主参数（bash→命令 / read·write·edit→路径 / grep·find→pattern）
// 输出：默认截断（shell 5 行 / 其他 10 行），点击展开；write 显示内容预览
function ToolBox({ name, args, result, callTs }: { name: string; args: string; result: { text: string; isError: boolean; ts: number } | null; callTs: number }) {
  const { t } = useI18n();
  const [outOpen, setOutOpen] = useState(false);
  const [argsOpen, setArgsOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const pending = !result;
  useEffect(() => {
    if (!pending) return;
    const iv = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [pending]);

  let a: any = null;
  try { a = JSON.parse(args || 'null'); } catch { a = null; }

  let primary = '';
  if ((name === 'bash' || name === 'powershell' || name === 'shell') && a) primary = `> ${String(a.command ?? '').slice(0, 140)}`;
  else if (a && (a.path ?? a.file_path)) primary = String(a.path ?? a.file_path);
  else if (a && (name === 'grep' || name === 'ffgrep' || name === 'find' || name === 'fffind') && a.pattern) primary = String(a.pattern);
  if (!primary) primary = (args || '').replace(/\s+/g, ' ').trim().slice(0, 110);

  const shell = name === 'bash' || name === 'powershell' || name === 'shell';
  const fileTool = ['read', 'write', 'edit'].includes(name) && !!a;
  const showArgs = !shell && !fileTool && !!(args || '').trim();
  const pretty = (() => { try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; } })();

  const contentText = name === 'write' && a && typeof a.content === 'string' ? a.content : '';
  const contentLines = contentText ? contentText.split('\n') : [];
  const contentLong = contentLines.length > 12;

  const outLines = result ? (result.text || '').split('\n') : [];
  const limit = shell ? 5 : 10;
  const hiddenN = Math.max(0, outLines.length - limit);
  const shownLines = outOpen ? outLines : outLines.slice(-limit);

  void tick;
  const endTs = result ? result.ts : Date.now();
  const dur = Math.max(0, (endTs - callTs) / 1000);
  const state = pending ? 'st-pending' : result && result.isError ? 'st-err' : 'st-ok';

  return (
    <div className={`toolbox ${state}`}>
      <div className="tb-line">
        <span className="tb-name">{name}</span>
        {primary && <span className="tb-arg" title={primary}>{primary}</span>}
      </div>
      {contentText && (
        <>
          <pre className="m-pre tb-content">{contentOpen ? contentText : contentLines.slice(0, 12).join('\n')}</pre>
          {contentLong && (
            <button className="btn ghost mini tb-toggle" onClick={() => setContentOpen(!contentOpen)}>
              {contentOpen ? t('toolbox.collapse') : t('toolbox.expand', { n: contentLines.length })}
            </button>
          )}
        </>
      )}
      {showArgs && (
        <>
          <button className="btn ghost mini tb-toggle" data-testid="tb-args" onClick={() => setArgsOpen(!argsOpen)}>
            {argsOpen ? t('toolbox.argsClose') : t('toolbox.args')}
          </button>
          {argsOpen && <pre className="m-pre tb-args">{pretty}</pre>}
        </>
      )}
      {result && outLines.length > 0 && (
        <>
          {hiddenN > 0 && !outOpen && <div className="tb-hint">{t('toolbox.earlier', { n: hiddenN })}</div>}
          <div
            className={`tb-out ${result.isError ? 'err' : ''} ${outLines.length > limit ? 'clickable' : ''}`}
            onClick={() => outLines.length > limit && setOutOpen(!outOpen)}
          >
            {shownLines.join('\n')}
          </div>
        </>
      )}
      <div className="tb-time">{pending ? `${t('tb.elapsed')} ${dur.toFixed(1)}s` : `${t('tb.took')} ${dur.toFixed(1)}s`}</div>
    </div>
  );
}

// full 模式渲染单元：把 toolResult 并入最近一条 assistant 的对应 toolCall（TUI 同框显示调用+结果）
type Unit =
  | { k: 'ev'; ev: TaskEvent }
  | { k: 'ast'; parts: any[]; ts: number }
  | { k: 'user'; ev: TaskEvent }
  | { k: 'sys'; ev: TaskEvent }
  | { k: 'sub'; ev: TaskEvent }
  | { k: 'orphan'; ev: TaskEvent; name: string; text: string; isError: boolean };

function buildUnits(events: TaskEvent[]): Unit[] {
  const units: Unit[] = [];
  for (const ev of events) {
    const p: any = ev.payload ?? {};
    if (ev.kind === 'message' && p.role === 'toolResult') {
      const text = (p.parts ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      const ast: Unit | undefined = [...units]
        .reverse()
        .find((u): u is Extract<Unit, { k: 'ast' }> => u.k === 'ast' && u.parts.some((c: any) => c.type === 'toolCall' && !c.__result));
      if (ast) {
        const idx = ast.parts.findIndex((c: any) => c.type === 'toolCall' && !c.__result);
        if (idx >= 0) {
          ast.parts[idx].__result = { text, isError: !!p.isError, ts: ev.ts };
          continue;
        }
      }
      units.push({ k: 'orphan', ev, name: p.toolName || 'tool', text, isError: !!p.isError });
      continue;
    }
    if (ev.kind === 'message' && p.role === 'user') { units.push({ k: 'user', ev }); continue; }
    if (ev.kind === 'message') { units.push({ k: 'ast', parts: (p.parts ?? []).slice(), ts: ev.ts }); continue; }
    if (ev.kind === 'system_prompt') { units.push({ k: 'sys', ev }); continue; }
    if (ev.kind === 'subagent') { units.push({ k: 'sub', ev }); continue; }
    units.push({ k: 'ev', ev });
  }
  return units;
}

// full 模式：系统提示词 box（保持 P2 样式）
function SysBox({ ev }: { ev: TaskEvent }) {
  const { t } = useI18n();
  const p: any = ev.payload;
  return (
    <div className="mbox mbox-sys" data-mkind="system_prompt">
      <div className="mbox-h">
        <span className="mbox-label">{t('msg.system')}</span>
        <span className="ev-t">{fmtTime(ev.ts)}</span>
      </div>
      <div className="mbox-b">
        <Collapsible text={p.text} openLabel={t('msg.expand')} closeLabel={t('msg.collapse')} />
      </div>
    </div>
  );
}

// full 模式：子 Agent box
function SubBox({ ev }: { ev: TaskEvent }) {
  const { t } = useI18n();
  const p: any = ev.payload;
  const label =
    (typeof p.args?.agent === 'string' && p.args.agent) ||
    (typeof p.args?.name === 'string' && p.args.name) ||
    'subagent';
  let argStr = '';
  try { argStr = JSON.stringify(p.args, null, 2) ?? ''; } catch { argStr = String(p.args); }
  return (
    <div className="mbox mbox-sub" data-mkind="subagent">
      <div className="mbox-h">
        <Bot size={12} className="mbox-ico" />
        <span className="mbox-label">{t('msg.subagent')} · {label}</span>
        <span className="ev-t">{fmtTime(ev.ts)}</span>
      </div>
      <div className="mbox-b">
        <Collapsible text={argStr.slice(0, 4000)} openLabel={t('msg.expand')} closeLabel={t('msg.collapse')} />
      </div>
    </div>
  );
}

// full 模式：user（注入 prompt=虚线框+标签 / 普通留言=实线强调框）
function UserBox({ ev, imgBase }: { ev: TaskEvent; imgBase?: string }) {
  const { t } = useI18n();
  const p: any = ev.payload;
  const injected = p.injected && p.injected !== 'user';
  return (
    <div className={`mbox ${injected ? 'mbox-inject' : 'mbox-user'}`} data-mkind={injected ? 'inject' : 'user'}>
      <div className="mbox-h">
        <span className="mbox-label">{injected ? `${t('msg.inject')} · ${p.injected}` : t('msg.user')}</span>
        <span className="ev-t">{fmtTime(ev.ts)}</span>
      </div>
      <div className="mbox-b">
        {(p.parts ?? []).map((c: any, i: number) =>
          c.type === 'text' ? (
            <div key={i} className="m-text"><MD text={c.text} imgBase={imgBase} /></div>
          ) : null
        )}
      </div>
    </div>
  );
}

// full 模式：assistant（TUI 无气泡：思考=灰斜体块（前后空一行）；文本=正常 markdown；工具=状态色 ToolBox）
function AstUnit({ parts, ts, imgBase }: { parts: any[]; ts: number; imgBase?: string }) {
  type Seg = { t: 'think'; text: string } | { t: 'text'; text: string } | { t: 'tool'; c: any; i: number };
  const segs: Seg[] = [];
  parts.forEach((c: any, i: number) => {
    if (c.type === 'thinking') {
      if (!c.text) return;
      const last = segs[segs.length - 1];
      if (last && last.t === 'think') last.text += '\n\n' + c.text;
      else segs.push({ t: 'think', text: c.text });
    } else if (c.type === 'text' && c.text) {
      segs.push({ t: 'text', text: c.text });
    } else if (c.type === 'toolCall') {
      segs.push({ t: 'tool', c, i });
    }
  });
  return (
    <div className="mbox mbox-ast" data-mkind="assistant">
      {segs.map((s, i) => {
        if (s.t === 'think')
          return (
            <div key={i} className="tui-think" data-testid="think-block">
              <Brain size={12} className="think-inline-ico" />
              <MD text={s.text} />
            </div>
          );
        if (s.t === 'text')
          return (
            <div key={i} className="tui-text">
              <MD text={s.text} imgBase={imgBase} />
            </div>
          );
        return <ToolBox key={i} name={s.c.name} args={s.c.args} result={s.c.__result ?? null} callTs={ts} />;
      })}
    </div>
  );
}

// full 模式渲染入口（每个单元都包 data-testid="ev"，测试统计口径不变）
function renderUnit(u: Unit, ctx: { plan: Plan | null; imgBase?: string; onPreview: (f: { name: string; path: string }) => void }) {
  let inner: ReactNode = null;
  switch (u.k) {
    case 'ast': inner = <AstUnit parts={u.parts} ts={u.ts} imgBase={ctx.imgBase} />; break;
    case 'user': inner = <UserBox ev={u.ev} imgBase={ctx.imgBase} />; break;
    case 'sys': inner = <SysBox ev={u.ev} />; break;
    case 'sub': inner = <SubBox ev={u.ev} />; break;
    case 'orphan': inner = <ToolBox name={u.name} args="" result={{ text: u.text, isError: u.isError, ts: u.ev.ts }} callTs={u.ev.ts} />; break;
    default: inner = <EvRow ev={u.ev} plan={ctx.plan} imgBase={ctx.imgBase} onPreview={ctx.onPreview} />;
  }
  return <div data-testid="ev">{inner}</div>;
}

// summary 模式：轻量事件行（沿用 P2 视觉）
function EvRow({ ev, plan, imgBase, onPreview }: { ev: TaskEvent; plan: Plan | null; imgBase?: string; onPreview?: (f: { name: string; path: string }) => void }) {
  const { t } = useI18n();
  const p = ev.payload;
  const time = <span className="ev-t">{fmtTime(ev.ts)}</span>;
  switch (ev.kind) {
    case 'phase':
      return (
        <div className="ev ev-phase">
          <span className="ev-body">{t(`status.${p.phase}`) ?? p.phase}</span>
        </div>
      );
    case 'assistant':
      return (
        <div className="ev ev-assistant">
          {time}
          <Bot size={13} className="ev-ico" />
          <div className="ev-body"><MD text={p.text} imgBase={imgBase} /></div>
        </div>
      );
    case 'system':
      return (
        <div className="ev ev-system">
          {time}
          <span className="ev-body">{p.text}</span>
        </div>
      );
    case 'think':
      return (
        <div className="ev">
          {time}
          <div className="ev-body ev-think">▸ {p.text}</div>
        </div>
      );
    case 'planned':
      return (
        <div className="ev">
          {time}
          <div className="ev-body ev-planned">
            <b>{t('ev.planned')}</b> —— {p.summary}
          </div>
        </div>
      );
    case 'tool':
      return (
        <div className="ev ev-tool">
          {time}
          <Terminal size={13} className="ev-ico" />
          <div className="ev-body">
            {p.summary}
            {p.result && <div className="res">{p.result}</div>}
          </div>
        </div>
      );
    case 'step': {
      const s = plan?.steps.find((x) => x.id === p.id);
      return (
        <div className="ev ev-step">
          {time}
          <CircleCheck size={13} className="ev-ico" />
          <span className="ev-body">
            {p.id} {s?.title ?? ''}
          </span>
        </div>
      );
    }
    case 'user_message':
      return (
        <div className="ev ev-user">
          <MessageSquare size={13} className="ev-ico" />
          <span className="ev-body"><MD text={p.text} imgBase={imgBase} /></span>
          {time}
        </div>
      );
    case 'message': {
      // full 模式由 buildUnits/AstUnit 渲染完整内容；summary 模式补思维链 + 工具结果
      if (p.role === 'toolResult') {
        const text = ((p.parts ?? []) as any[])
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n')
          .trim();
        if (!text) return null;
        const long = text.length > 600;
        return (
          <div className={`ev ev-toolres${p.isError ? ' err' : ''}`}>
            <span className="ev-t" />
            <div className="ev-body">
              {long ? (
                <details className="toolres-box">
                  <summary>
                    {t('ev.result')}（{text.length} {t('ev.chars')}）
                  </summary>
                  <pre className="toolres-pre">{text}</pre>
                </details>
              ) : (
                <pre className="toolres-pre">{text}</pre>
              )}
            </div>
          </div>
        );
      }
      //（正文由同回合的 assistant 行承载，避免重复）
      const thinks = ((p.parts ?? []) as any[]).filter((c: any) => c.type === 'thinking' && c.text);
      if (!thinks.length) return null;
      const text = thinks.map((c: any) => c.text).join('\n\n');
      return (
        <details className="ev ev-think" open>
          <summary>
            <Brain size={13} className="ev-ico" />
            {time}
          </summary>
          <div className="tui-think ev-think-body">
            <MD text={text} />
          </div>
        </details>
      );
    }
    case 'block':
      return (
        <div className="ev ev-block">
          {time}
          <OctagonAlert size={13} className="ev-ico" />
          <span className="ev-body">
            {t('ev.block')}：{p.question}
          </span>
        </div>
      );
    case 'review':
      return (
        <div className="ev ev-review">
          {time}
          <span className="ev-body">
            {t('ev.review')}：{p.overall === 'pass' ? t('card.acceptance.pass') : t('card.acceptance.fail')}
            {t('ev.items', { n: p.items?.length ?? 0 })}
          </span>
        </div>
      );
    case 'asset':
      return (
        <div className="ev ev-asset">
          {time}
          <FileText size={13} className="ev-ico" />
          <span className="ev-body">
            {onPreview && p.path ? (
              <a
                href="#"
                className="a-link"
                data-testid="asset-feed-link"
                onClick={(e) => {
                  e.preventDefault();
                  onPreview({ name: p.name, path: p.path });
                }}
              >
                {p.name}
              </a>
            ) : (
              p.name
            )}{' '}
            — {p.summary}
          </span>
        </div>
      );
    case 'subagent': {
      const label =
        (typeof p.args?.agent === 'string' && p.args.agent) ||
        (typeof p.args?.name === 'string' && p.args.name) ||
        'subagent';
      return (
        <div className="ev ev-sub">
          {time}
          <Bot size={13} className="ev-ico" />
          <span className="ev-body">
            {t('msg.subagent')} · {label}
          </span>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function TaskDetail() {
  const { taskId = '' } = useParams();
  const id = taskId;
  const nav = useNavigate();
  const { t } = useI18n();
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  // 实时流：pi 思维/文本增量（task.stream，不落库；message_end 后由持久化事件取代）
  const [live, setLive] = useState<{ key: string; kind: 'thinking' | 'text'; text: string }[]>([]);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null); // 确认弹窗：取消/删除任务
  const [feedFilter, setFeedFilter] = useState('all');
  const [mode, setMode] = useState<'summary' | 'full'>('summary');
  const [tab, setTab] = useState<'plan' | 'accept' | 'outputs'>('outputs');
  const [descOpen, setDescOpen] = useState(false);
  const [reworkMode, setReworkMode] = useState(false);
  const [msg, setMsg] = useState('');
  const [longMode, setLongMode] = useState(false);
  const longTextRef = useRef<HTMLTextAreaElement>(null);
  const [draftImgs, setDraftImgs] = useState<{ num: number; name: string; path: string }[]>([]);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const imgBase = `/api/tasks/${id}/file`;
  const [branchSel, setBranchSel] = useState<Record<string, string>>({});
  const [branchCustom, setBranchCustom] = useState<Record<string, string>>({});
  const [blockCustom, setBlockCustom] = useState('');
  const [preview, setPreview] = useState<{ name: string; path: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastSeq = useRef(0);
  // 「贴底」跟随：仅在用户已靠近底部时才自动滚底；用户上滑看历史时不强拉
  const stickRef = useRef(true);
  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const stickScroll = () => {
    const el = feedRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  };

  const reloadTask = () => api.task(id).then(setTask).catch(() => {});
  // 同项目任务列表（依赖管理：可选的父任务 + 跳转到父任务）
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const boardId = task?.board_id ?? '';
  useEffect(() => {
    if (!boardId) return;
    api.tasks(boardId).then(setBoardTasks).catch(() => {});
  }, [boardId]);
  const addableDeps = useMemo(
    () => (boardTasks ?? []).filter((x) => x.id !== task?.id && !(task?.deps ?? []).some((d) => d.parent_id === x.id)),
    [boardTasks, task]
  );
  const loadEvents = (since = 0) =>
    api
      .events(id, since)
      .then((rows) => {
        if (!rows.length) return;
        const fresh = since === 0 ? rows : rows.filter((r) => r.seq > lastSeq.current);
        if (fresh.length) setEvents((x) => (since === 0 ? rows : [...x, ...fresh]));
        lastSeq.current = Math.max(lastSeq.current, ...rows.map((r) => r.seq));
        // 导入的历史会话：只有消息流、无计划/步骤/工具等结构化事件 → 自动切「全部」模式
        if (
          since === 0 &&
          rows.some((r) => r.kind === 'message') &&
          !rows.some((r) => ['planned', 'step', 'tool', 'asset', 'review', 'block', 'user_message'].includes(r.kind))
        ) {
          setMode('full');
          setFeedFilter('all');
        }
      })
      .catch(() => {});
  const loadExtra = () => {
    api.blocks(id).then(setBlocks).catch(() => {});
    api.assets(id).then(setAssets).catch(() => {});
  };

  useEffect(() => {
    setLive([]);
    reloadTask();
    loadEvents();
    loadExtra();
    const off = onEvent((ev) => {
      const p = ev.payload ?? {};
      if (p.taskId && p.taskId !== id) return;
      if (ev.kind === 'task.deleted') { goBack(); return; }
      if (ev.kind === 'task.event') {
        const e = ev.payload.event;
        if (e && e.seq > lastSeq.current) {
          lastSeq.current = e.seq;
          setEvents((x) => (x.some((z) => z.seq === e.seq) ? x : [...x, e]));
        }
        if (e?.kind === 'message') setLive([]); // 完整消息已落库 → 实时流块让位
        if (e?.kind === 'block') loadExtra();
        if (e?.kind === 'asset') api.assets(id).then(setAssets).catch(() => {});
      }
      if (ev.kind === 'task.stream') {
        const s = ev.payload;
        if (Date.now() - ev.ts > 8000) return; // 重连重放的陈旧增量丢弃
        const key = `${s.block}:${s.idx ?? 0}`;
        setLive((prev) => {
          const i = prev.findIndex((b) => b.key === key);
          if (i >= 0) {
            const nxt = prev.slice();
            nxt[i] = { ...nxt[i], text: nxt[i].text + s.delta };
            return nxt;
          }
          return [...prev, { key, kind: s.block, text: s.delta }];
        });
      }
      if (ev.kind === 'task.status' || ev.kind === 'task.user_message') reloadTask();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    stickScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, mode, feedFilter]);
  // 实时思维流增长时跟随滚动（同样只在贴底时）
  useEffect(() => {
    stickScroll();
  }, [live]);

  const openBlock = useMemo(() => blocks.find((b) => b.status === 'open') ?? null, [blocks]);

  // 事件筛选（summary/full 通用；full 下按 message 角色归类）
  const shownEvents = useMemo(() => {
    if (feedFilter === 'all') return events;
    return events.filter((e) => {
      const p: any = e.payload;
      if (mode === 'full' && e.kind === 'message') {
        if (feedFilter === 'user') return p.role === 'user';
        if (feedFilter === 'exec') return p.role !== 'user';
        if (feedFilter === 'review') return false;
        if (feedFilter === 'system') return false;
      }
      if (mode !== 'full' && e.kind === 'message' && p.role === 'toolResult') return feedFilter === 'exec';
      const groups: Record<string, string[]> = {
        user: ['user_message'],
        exec: ['planned', 'step', 'tool', 'asset', 'subagent'],
        review: ['review', 'block'],
        system: ['system', 'phase', 'system_prompt'],
      };
      return groups[feedFilter]?.includes(e.kind) ?? false;
    });
  }, [events, feedFilter, mode]);

  // full 模式：TUI 风格渲染单元（toolResult 并入对应 toolCall，同一框内显示调用+结果）
  const units = useMemo(
    () => (mode === 'full' ? buildUnits(shownEvents) : null),
    [mode, shownEvents]
  );

  async function exportEvents() {
    try {
      const rows = await api.events(id, 0);
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `task-${task?.num ?? id}-events.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast(t('feed.exported'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  async function sendMsg() {
    const txt = msg.trim();
    if (!txt) return;
    // 返工模式（done / awaiting_confirm）：同一输入框走 rework 通道，复用任务会话
    const t0 = task;
    const terminal = !!t0 && (t0.status === 'done' || t0.status === 'awaiting_confirm');
    const isRework = reworkMode && terminal;
    // 完成/待确认时普通发消息 = 提问（复用原会话直接回复，不打回重跑）
    const isChat = !reworkMode && terminal;
    try {
      if (isRework) {
        await api.rework(id, { text: txt, images: draftImgs.map((i) => i.num) });
        toast(t('rework.sent'));
        setReworkMode(false);
        setLongMode(false);
        reloadTask();
      } else if (isChat) {
        await api.chat(id, txt, draftImgs.map((i) => i.num));
        setLongMode(false);
      } else {
        await api.message(id, txt, draftImgs.map((i) => i.num));
        setLongMode(false);
      }
      setMsg('');
      setDraftImgs([]);
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  // 打开返工：直接展开长提示词输入框（不另开框）；再点一次 = 取消
  function toggleRework() {
    if (reworkMode) {
      setReworkMode(false);
      setLongMode(false);
      return;
    }
    setReworkMode(true);
    setLongMode(true);
    setTimeout(() => longTextRef.current?.focus(), 30);
  }

  async function pickImgs(files: FileList | null) {
    if (!files?.length) return;
    try {
      const b64 = await Promise.all(Array.from(files).map(fileToBase64));
      const r = await api.uploadImages(id, b64);
      setDraftImgs((prev) => [...prev, ...r.added]);
    } catch (e: any) {
      toast(t('img.err'), 'err');
    } finally {
      if (imgFileRef.current) imgFileRef.current.value = '';
    }
  }

  if (!task) return <div className="empty">{t('loading')}…</div>;

  const running = ['planning', 'executing', 'testing'].includes(task.status);
  const branchQs = task.plan?.branch_questions ?? [];
  const pendingQs = branchQs.filter((q) => !task.answers[q.id]);
  const actionable = ['waiting_input', 'blocked', 'awaiting_confirm', 'interrupted'].includes(task.status);
  const canRework = task.status === 'done' || task.status === 'awaiting_confirm';
  const canPause = !['done', 'failed', 'cancelled', 'paused'].includes(task.status);
  const projName = (task.workspace_path || '').split(/[\\/]/).filter(Boolean).pop() || 'project';
  const doPause = () => api.pause(id).then(reloadTask).catch((e) => toast(e.message, 'err'));
  const doResume = () => api.resume(id).then(reloadTask).catch((e) => toast(e.message, 'err'));
  // 返回「来的地方」：从哪个看板/项目进来就回哪；直接开 URL（无历史）回首页
  const goBack = () => (window.history.length > 1 ? nav(-1) : nav('/boards'));

  async function submitBranch() {
    const answers: Record<string, string> = {};
    for (const q of pendingQs) {
      const a = (branchCustom[q.id] ?? '').trim() || branchSel[q.id];
      if (!a) return toast(t('branch.needAnswer', { q: q.q.slice(0, 20) }), 'err');
      answers[q.id] = a;
    }
    try {
      await api.answer(id, answers);
      toast(t('branch.submitted'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  const submitBlock = (decision: string) =>
    api.blockAnswer(id, decision).then(() => {
      toast(t('block.submitted'));
      reloadTask();
      loadExtra();
      setBlockCustom('');
    });

  return (
    <div className="td">
      {/* ===== 顶部固定：任务 + 描述 ===== */}
      <header className="td-head">
        <div className="td-hrow">
          <button className="btn ghost" onClick={goBack}>
            <ArrowLeft size={14} /> {t('board.back')}
          </button>
          <h1 className="td-title" title={task.title}>
            <span className="mono" style={{ color: 'var(--text-3)', fontWeight: 500 }}>
              #{task.num}
            </span>{' '}
            {task.title}
          </h1>
          <span className={`badge st-${task.status}`} data-testid="status-badge">
            <span className="dot" />
            {t(`status.${task.status}`)}
          </span>
          <select
            className="inp"
            style={{ width: 74 }}
            value={task.priority}
            onChange={(e) => api.patchTask(id, { priority: Number(e.target.value) }).then(reloadTask).catch((e) => toast(e.message, 'err'))}
          >
            <option value={0}>P0</option>
            <option value={1}>P1</option>
            <option value={2}>P2</option>
            <option value={3}>P3</option>
          </select>
          <span style={{ flex: 1 }} />
          {canRework && (
            <button
              className={`btn ${reworkMode ? 'primary' : 'ghost'} sm`}
              data-testid="btn-rework"
              onClick={toggleRework}
            >
              {reworkMode ? (
                <>
                  <X size={13} /> {t('rework.cancel')}
                </>
              ) : (
                <>
                  <RotateCcw size={13} /> {t('act.rework')}
                </>
              )}
            </button>
          )}
          {task.status === 'paused' && (
            <button className="btn primary sm" data-testid="btn-resume" onClick={doResume}>
              <Play size={13} /> {t('task.resume')}
            </button>
          )}
          {canPause && task.status !== 'paused' && (
            <button className="btn ghost sm" data-testid="btn-pause" onClick={doPause}>
              <Pause size={13} /> {t('task.pause')}
            </button>
          )}
          {task.status !== 'done' && task.status !== 'cancelled' && (
            <button className="btn danger sm" onClick={() => setConfirm('cancel')}>
              <X size={13} /> {t('task.cancel')}
            </button>
          )}
          <button className="btn ghost sm" data-testid="btn-delete" onClick={() => setConfirm('delete')}>
            <Trash2 size={13} /> {t('task.delete')}
          </button>
          <span style={{ width: 8 }} />
          <TopControls />
        </div>
        <div className="td-line2">
          <div
            className="td-desc"
            data-testid="task-desc"
            onClick={() => setDescOpen(true)}
            title={t('task.descTitle')}
          >
            {task.description.replace(/[#*`>\[\]()!_~|]/g, '').replace(/\n+/g, ' ').trim().slice(0, 180)}
          </div>
          <div className="td-meta">
            <span className="meta-ico" title={task.workspace_path}>
              <Folder size={13} /> <code className="mono">{projName}</code>
            </span>
            <span className="meta-ico">
              <GitBranch size={13} /> {t(task.branch_mode === 'manual' ? 'meta.branch.manual' : 'meta.branch.auto', { min: task.branch_timeout_min })}
            </span>
            {task.test_cmd && (
              <span className="meta-ico" title={`${t('meta.test')}: ${task.test_cmd}`}>
                <Terminal size={13} /> {t('meta.test')}
              </span>
            )}
            {task.started_at && (
              <span className="meta-ico">
                <Clock size={13} />{' '}
                {running ? `${t('meta.running')} ${fmtDur(Date.now() - task.started_at)}` : `${t('meta.duration')} ${fmtDur((task.finished_at ?? Date.now()) - task.started_at)}`}
              </span>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <select
            className="inp"
            data-testid="feed-filter"
            style={{ width: 126, padding: '3px 8px', fontSize: 12 }}
            value={mode === 'full' && feedFilter === 'all' ? 'full' : feedFilter}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'full') { setMode('full'); setFeedFilter('all'); }
              else { setMode('summary'); setFeedFilter(v); }
            }}
          >
            {['all', 'user', 'exec', 'review', 'system'].map((k) => (
              <option key={k} value={k}>
                {t(`feed.filter.${k}`)}
              </option>
            ))}
            <option value="full">{t('feed.filter.full')}</option>
          </select>
          <button className="btn ghost sm" data-testid="feed-export" title={t('feed.export')} onClick={exportEvents}>
            <Download size={13} />
          </button>
          <span className="fb-count">{t('feed.count', { n: events.length })}</span>
        </div>
      </header>

      {/* ===== 主体：左=消息流+动作区+状态条+composer；右=计划·验收·产物侧边栏 ===== */}
      <div className="td-body">
      <div className="td-main">
      {/* ===== 消息流（唯一滚动区；feed 控件已并入头部第二行） ===== */}
      <div className="td-feed">
        <div className="feed" data-testid="feed" ref={feedRef} onScroll={onFeedScroll}>
          {mode === 'full' && !events.some((e) => ['message', 'system_prompt', 'subagent'].includes(e.kind)) && (
            <div className="full-hint">
              {t('feed.fullOld')}
            </div>
          )}
          {shownEvents.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 12.5, textAlign: 'center', padding: 18 }}>{t('feed.empty')}</div>
          )}
          {mode === 'full' && units
            ? units.map((u, i) => renderUnit(u, { plan: task.plan, imgBase, onPreview: setPreview }))
            : shownEvents.map((ev) => (
                <div key={ev.seq} data-testid="ev">
                  <EvRow ev={ev} plan={task.plan} imgBase={imgBase} onPreview={setPreview} />
                </div>
              ))}
          {live.length > 0 && (
            <div className="live-stream" data-testid="live-stream">
              {live.map((b) => (
                <div key={b.key} className={b.kind === 'thinking' ? 'tui-think live-block' : 'tui-text live-block'}>
                  {b.kind === 'thinking' && <Brain size={12} className="live-ico" />}
                  <MD text={b.text} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== 底部 1/4：动作区（状态卡 / 计划·验收·产物） ===== */}
      <div className="td-actions">
        {task.status === 'blocked' && openBlock ? (
          <div className="alert-card alert-block">
            <div className="ac-title">
              <OctagonAlert size={14} /> {t('block.title')}
            </div>
            <MD text={openBlock.question} imgBase={imgBase} />
            <div className="ctx-box">
              <span>
                <span className="k">{t('block.ctx.now')}</span>
                {openBlock.context.current}
              </span>
              <span>
                <span className="k">{t('block.ctx.verified')}</span>
                {openBlock.context.verified}
              </span>
              <span>
                <span className="k">{t('block.ctx.impact')}</span>
                {openBlock.context.impact}
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="k">{t('block.ctx.refs')}</span>
                {openBlock.context.refs.map((r) => (
                  <span key={r} className="ref-chip">
                    {r}
                  </span>
                ))}
              </span>
            </div>
            <div className="opt-list">
              {openBlock.options.map((o, i) => (
                <button key={i} className="opt-btn" data-testid="block-opt" data-idx={i} onClick={() => submitBlock(o.label)}>
                  <span className="o-label">
                    {String.fromCharCode(65 + i)}. {o.label}
                    {openBlock.recommended && String.fromCharCode(65 + i) === openBlock.recommended && (
                      <span className="rec-tag">{t('block.recommended')}</span>
                    )}
                  </span>
                  <span className="o-sub">
                    {o.pros && <span className="pro">＋ {o.pros}</span>}{' '}
                    {o.cons && <span className="con">－ {o.cons}</span>}{' '}
                    {o.estimate && <span className="est">（{o.estimate}）</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="row">
              <input
                className="inp"
                placeholder={t('block.custom')}
                value={blockCustom}
                onChange={(e) => setBlockCustom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && blockCustom.trim() && submitBlock(blockCustom.trim())}
              />
              <button className="btn primary" data-testid="btn-block-submit" disabled={!blockCustom.trim()} onClick={() => submitBlock(blockCustom.trim())}>
                {t('block.submit')}
              </button>
            </div>
          </div>
        ) : task.status === 'interrupted' ? (
          <div className="alert-card alert-wait">
            <div className="ac-title">
              <RefreshCw size={14} /> {t('interrupted.title')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('interrupted.desc')}</div>
          </div>
        ) : null}
      </div>

      {/* ===== 状态条（composer 上方，一行进度） ===== */}
      <div className="td-statusline" data-testid="status-line">
        <span className="sl-phase">{t(`status.${task.status}`)}</span>
        {task.current_action && <span className="sl-action">{task.current_action}</span>}
        <span style={{ flex: 1 }} />
        {task.ctx_tokens ? (
          <span
            className={`sl-ctx${(task.ctx_percent ?? 0) >= 90 ? ' hot' : ''}`}
            title={`${t('ctx.used')} ${(task.ctx_tokens ?? 0).toLocaleString()} tok`}
          >
            <Gauge size={12} />
            {Math.min(999, Math.round(task.ctx_percent ?? 0))}%
          </span>
        ) : null}
        {(task.compactions ?? 0) > 0 && (
          <span className="sl-comp" title={t('ctx.compactedTitle')}>
            {t('ctx.compacted').replace('{n}', String(task.compactions))}
          </span>
        )}
        {task.started_at && (
          <span className="sl-dur">
            {running ? `${t('meta.running')} ${fmtDur(Date.now() - task.started_at)}` : `${t('meta.duration')} ${fmtDur((task.finished_at ?? Date.now()) - task.started_at)}`}
          </span>
        )}
      </div>

      {/* ===== composer（永远在底部） ===== */}
      <div className="td-composer">
        {longMode ? (
          <div className="steer-long">
            <div className="steer-long-head">
              <span className="sl-title">{reworkMode ? t('rework.title') : t('feed.long.title')}</span>
              {reworkMode && (
                <button className="btn ghost sm" title={t('rework.cancel')} data-testid="btn-rework-cancel" onClick={() => { setReworkMode(false); setLongMode(false); }}>
                  <X size={13} /> {t('rework.cancel')}
                </button>
              )}
              <button className="btn ghost sm" title={t('img.attach')} onClick={() => imgFileRef.current?.click()}>
                <ImagePlus size={14} /> {t('img.attach')}
              </button>
              <input ref={imgFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickImgs(e.target.files)} />
              <button className="btn ghost sm" title={t('feed.collapse')} onClick={() => setLongMode(false)}>
                <PanelBottomClose size={14} />
              </button>
            </div>
            <textarea
              className="inp"
              data-testid="input-msg-long"
              ref={longTextRef}
              rows={6}
              placeholder={reworkMode ? t('rework.ph') : t('feed.steerPh.long')}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
            {draftImgs.length > 0 && (
              <div className="img-chips">
                {draftImgs.map((im) => (
                  <div key={im.num} className="img-chip" title={im.name}>
                    <img src={api.fileUrl(id, im.path)} alt={im.name} />
                    <span className="n">{t('img.fig', { n: im.num })}</span>
                    <button className="chip-x" onClick={() => setDraftImgs((x) => x.filter((y) => y.num !== im.num))}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="steer-hint">{reworkMode ? t('rework.hint') : t('img.hint')}</div>
            <div className="steer-row" style={{ marginTop: 6 }}>
              <button className="btn primary" data-testid="btn-msg-send-long" onClick={sendMsg} disabled={!msg.trim()}>
                <Send size={13} /> {reworkMode ? t('rework.submit') : t('feed.send')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="steer-row">
              <input
                className="inp"
                data-testid="input-msg-short"
                placeholder={running ? t('feed.steerPh.active') : ['done', 'awaiting_confirm'].includes(task.status) ? t('feed.steerPh.chat') : t('feed.steerPh')}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
              />
              <button className="btn ghost sm" data-testid="btn-msg-expand" title={t('feed.expand')} onClick={() => setLongMode(true)}>
                <PanelBottomOpen size={14} />
              </button>
              <button className="btn primary" data-testid="btn-msg-send-short" onClick={sendMsg} disabled={!msg.trim()}>
                <Send size={13} /> {t('feed.send')}
              </button>
            </div>
            <div className="steer-hint">{running ? t('feed.hint.running') : ['done', 'awaiting_confirm'].includes(task.status) ? t('feed.hint.done') : t('feed.hint.inactive')}</div>
          </>
        )}
      </div>

      </div>

      {/* ===== 右侧栏：计划 / 验收 / 产物（独立滚动） ===== */}
      <aside className="td-side">
        {/* 验收通过·等待确认 → 侧边栏顶部（不占主列） */}
        {task.status === 'awaiting_confirm' && (
          <div className="td-side-confirm">
            <div className="alert-card alert-confirm">
              <div className="ac-title">
                <ShieldCheck size={14} /> {t('confirm.title')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 11 }}>
                {t('confirm.descA')}
                {task.test_cmd && (
                  <>
                    {' '}
                    <code className="mono">{task.test_cmd}</code>
                  </>
                )}{' '}
                {t('confirm.descB')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  data-testid="btn-confirm-done"
                  onClick={() =>
                    api.confirm(id).then(() => {
                      toast(t('act.confirmed'));
                      reloadTask();
                    })
                  }
                >
                  <Check size={14} /> {t('confirm.btn')}
                </button>
                <button className="btn ghost" onClick={toggleRework}>
                  <RotateCcw size={13} /> {t('confirm.rework')}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 依赖关系：父任务先完成本任务才开始（创建后可增删） */}
        {task && (
          <div className="td-deps">
            <div className="td-deps-h">{t('task.dep.title')}</div>
            {(task.deps ?? []).length === 0 && <div className="td-deps-empty">{t('task.dep.empty')}</div>}
            {(task.deps ?? []).map((d) => {
              const p = boardTasks.find((x) => x.id === d.parent_id);
              return (
                <div className="td-dep-row" key={d.parent_id}>
                  <span
                    className="td-dep-title"
                    title={t('task.dep.open')}
                    onClick={() => p && nav(`/p/${encodeURIComponent(baseName(p.workspace_path))}/tasks/${d.parent_id}`)}
                  >
                    {d.parent_title}
                  </span>
                  <span className={`pill s-${d.parent_status}`}>{t(`status.${d.parent_status}`)}</span>
                  <button
                    className="td-dep-x"
                    title={t('task.dep.remove')}
                    onClick={() => api.removeDep(task.id, d.parent_id).then(reloadTask).catch((e) => toast(e.message, 'err'))}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {addableDeps.length > 0 && (
              <select
                className="td-dep-add"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  api.addDep(task.id, v).then(() => { toast(t('task.dep.added')); reloadTask(); }).catch((e) => toast(e.message, 'err'));
                }}
              >
                {addableDeps.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t('task.dep.add')} · {x.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="tabs">
          {(
            [
              ['plan', t('tabs.plan')],
              ['accept', t('tabs.accept')],
              ['outputs', t('tabs.outputs')],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`tab ${tab === k ? 'on' : ''}`} data-testid={`tab-${k}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {!actionable && task.status === 'ready' && (
            <span style={{ color: 'var(--st-ready)', fontSize: 12 }}>{t('tbl.readyHint')}</span>
          )}
        </div>
        <div className="tab-body">
          {tab === 'plan' && (
            <>
              {!task.plan && <div style={{ color: 'var(--text-3)', fontSize: 12.5, padding: 10 }}>{t('tabs.plan.empty')}</div>}
              {task.plan && (
                <>
                  <MD text={task.plan.summary} imgBase={imgBase} />
                  <div style={{ marginTop: 10 }}>
                    {task.plan.steps.map((s, i) => {
                      const active =
                        running && !s.done && task.plan!.steps.slice(0, i + 1).every((x) => x.done || x.id === s.id);
                      return (
                        <div className="plan-step" key={s.id}>
                          <div className="ps-top">
                            <span className={`ps-check ${s.done ? 'done' : active ? 'active' : ''}`}>{s.done ? '✓' : ''}</span>
                            <span className="ps-id">{s.id}</span>
                            <span className="ps-title">{s.title}</span>
                          </div>
                          <div className="ps-goal">{s.goal}</div>
                          <div className="ps-actions">→ {s.actions.join(' · ')}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
          {tab === 'accept' && (
            <>
              {task.review ? (
                <div className="card" style={{ border: 'none', marginBottom: 10 }}>
                  <div className="card-h" style={{ padding: 0 }}>
                    {t('card.acceptance')}{' '}
                    <span className={`badge st-${task.review.overall === 'pass' ? 'done' : 'failed'}`} style={{ marginLeft: 4 }}>
                      {task.review.overall === 'pass' ? t('card.acceptance.pass') : t('card.acceptance.fail')}
                    </span>
                  </div>
                  {task.review.items.map((it, i) => (
                    <div className="review-item" key={i}>
                      <span className={`ri-pass ${it.pass ? 'y' : 'n'}`}>{it.pass ? '✓' : '✗'}</span>
                      <div style={{ minWidth: 0 }}>
                        <div>{it.criterion}</div>
                        <div className="ri-ev">{it.evidence}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !task.acceptance_text && <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{t('tabs.accept.empty')}</div>
              )}
              {task.acceptance_text && (
                <>
                  <div className="card-h" style={{ padding: 0, marginBottom: 6 }}>
                    {t('card.acceptanceText')}
                  </div>
                  <MD text={task.acceptance_text} imgBase={imgBase} />
                </>
              )}
            </>
          )}
          {tab === 'outputs' && (
            <>
              {assets.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.5, padding: 4 }}>{t('card.outputs.none')}</div>}
              {assets.map((a) => (
                <div className="asset-row" key={a.id}>
                  <FileText size={13} className="ev-ico" />
                  {a.path_or_url && !/^https?:/i.test(a.path_or_url) ? (
                    <button
                      className="a-name-link"
                      data-testid="asset-name"
                      title={t('preview.title')}
                      onClick={() => setPreview({ name: a.name, path: a.path_or_url })}
                    >
                      {a.name}
                    </button>
                  ) : (
                    <span className="a-name">{a.name}</span>
                  )}
                  <span className="a-sum" title={a.summary}>
                    {a.summary}
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11, flex: 'none' }}>
                    {fmtAgo(a.at)} {t('time.ago')}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
      </div>

      {/* ===== 分支决策：独立 modal（不再挤在动作区） ===== */}
      {task.status === 'waiting_input' && (
        <div className="modal-bg" data-testid="branch-modal">
          <div className="modal branch-modal">
            <div className="m-h">
              <Pencil size={13} /> {t('branch.title', { n: pendingQs.length })}
            </div>
            <div className="m-b">
              {pendingQs.map((q) => {
                const custom = (branchCustom[q.id] ?? '').trim();
                return (
                  <div key={q.id} className="branch-q">
                    <div className="bq-title">{q.q}</div>
                    <div className="opt-list">
                      {q.options.map((o, i) => (
                        <button
                          key={i}
                          className={`opt-btn ${!custom && branchSel[q.id] === o.label ? 'on' : ''}`}
                          data-testid="branch-opt"
                          data-q={q.id}
                          data-idx={i}
                          onClick={() => setBranchSel((s) => ({ ...s, [q.id]: o.label }))}
                        >
                          <span className="o-label">
                            {String.fromCharCode(65 + i)}. {o.label}
                            {o.recommended && <span className="rec-tag">{t('branch.recommended')}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                    <input
                      className="inp"
                      style={{ marginTop: 7 }}
                      placeholder={t('branch.customPh')}
                      value={branchCustom[q.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBranchCustom((s) => ({ ...s, [q.id]: v }));
                        if (v.trim())
                          setBranchSel((s) => {
                            const n = { ...s };
                            delete n[q.id];
                            return n;
                          });
                      }}
                    />
                    <div className="steer-hint" style={{ marginTop: 5 }}>{t('branch.customHint')}</div>
                  </div>
                );
              })}
              {task.branch_mode === 'manual' && (
                <div style={{ marginTop: 10 }}>{t('branch.hint', { min: task.branch_timeout_min })}</div>
              )}
            </div>
            <div className="m-f">
              <span style={{ flex: 1 }} />
              <button className="btn primary" data-testid="btn-branch-submit" onClick={submitBranch}>
                {t('branch.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 任务描述 modal（第二行点击展开） ===== */}
      {descOpen && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setDescOpen(false)}>
          <div className="modal">
            <div className="m-h">
              {t('task.descTitle')}
              <button className="m-x" onClick={() => setDescOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="m-b">
              <MD text={task.description} imgBase={imgBase} />
            </div>
          </div>
        </div>
      )}

      {preview && <AssetPreview taskId={id} file={preview} onClose={() => setPreview(null)} />}

      {confirm === 'cancel' && (
        <ConfirmDialog
          title={t('task.cancel')}
          message={t('task.cancelMsg')}
          confirmText={t('task.cancel')}
          danger
          onConfirm={() => api.cancel(id).then(reloadTask).catch((e) => toast(e.message, 'err'))}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={t('task.delete')}
          message={t('task.deleteMsg')}
          confirmText={t('task.delete')}
          danger
          onConfirm={() => api.del(id).then(() => { toast(t('task.deleted')); goBack(); }).catch((e) => toast(e.message, 'err'))}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
