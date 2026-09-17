import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtAgo, fmtDur, fmtTime } from '../lib/fmt';
import { toast } from '../lib/toast';
import AssetPreview from '../components/AssetPreview';
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

// full 模式：完整推理消息框（不同角色不同 box + 小标签）
function MsgBox({ ev, imgBase }: { ev: TaskEvent; imgBase?: string }) {
  const { t } = useI18n();
  const p: any = ev.payload;
  const time = <span className="ev-t">{fmtTime(ev.ts)}</span>;

  if (ev.kind === 'system_prompt') {
    return (
      <div className="mbox mbox-sys" data-mkind="system_prompt">
        <div className="mbox-h">
          <span className="mbox-label">{t('msg.system')}</span>
          {time}
        </div>
        <div className="mbox-b">
          <Collapsible text={p.text} openLabel={t('msg.expand')} closeLabel={t('msg.collapse')} />
        </div>
      </div>
    );
  }
  if (ev.kind === 'subagent') {
    const label =
      (typeof p.args?.agent === 'string' && p.args.agent) ||
      (typeof p.args?.name === 'string' && p.args.name) ||
      (typeof p.args?.label === 'string' && p.args.label) ||
      'subagent';
    let argStr = '';
    try {
      argStr = JSON.stringify(p.args, null, 2) ?? '';
    } catch {
      argStr = String(p.args);
    }
    return (
      <div className="mbox mbox-sub" data-mkind="subagent">
        <div className="mbox-h">
          <Bot size={12} className="mbox-ico" />
          <span className="mbox-label">
            {t('msg.subagent')} · {label}
          </span>
          {time}
        </div>
        <div className="mbox-b">
          <Collapsible text={argStr.slice(0, 4000)} openLabel={t('msg.expand')} closeLabel={t('msg.collapse')} />
        </div>
      </div>
    );
  }
  if (ev.kind !== 'message') return null;

  // user：注入 prompt（虚线框+标签） / 普通留言（实线强调框）
  if (p.role === 'user') {
    const injected = p.injected && p.injected !== 'user';
    return (
      <div className={`mbox ${injected ? 'mbox-inject' : 'mbox-user'}`} data-mkind={injected ? 'inject' : 'user'}>
        <div className="mbox-h">
          <span className="mbox-label">
            {injected ? `${t('msg.inject')} · ${p.injected}` : t('msg.user')}
          </span>
          {time}
        </div>
        <div className="mbox-b">
          {(p.parts ?? []).map((c: any, i: number) =>
            c.type === 'text' ? (
              <div key={i} className="m-text">
                <MD text={c.text} imgBase={imgBase} />
              </div>
            ) : null
          )}
        </div>
      </div>
    );
  }
  // toolResult：代码框
  if (p.role === 'toolResult') {
    const text = (p.parts ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    return (
      <div className={`mbox mbox-toolres ${p.isError ? 'err' : ''}`} data-mkind="tool">
        <div className="mbox-h">
          <Terminal size={12} className="mbox-ico" />
          <span className="mbox-label">
            {t('msg.toolres')}
            {p.toolName ? ` · ${p.toolName}` : ''}
            {p.isError ? ` · ${t('msg.err')}` : ''}
          </span>
          {time}
        </div>
        <div className="mbox-b">
          <Collapsible text={text || '—'} openLabel={t('msg.expand')} closeLabel={t('msg.collapse')} />
        </div>
      </div>
    );
  }
  // assistant：文本气泡 / 思考（灰斜体）/ 工具调用（代码框）
  return (
    <div className="mbox mbox-ast" data-mkind="assistant">
      {(p.parts ?? []).map((c: any, i: number) => {
        if (c.type === 'text')
          return (
            <div key={i} className="m-bubble">
              <MD text={c.text} imgBase={imgBase} />
            </div>
          );
        if (c.type === 'thinking') return <div key={i} className="m-think">▸ {c.text}</div>;
        if (c.type === 'toolCall')
          return (
            <div key={i} className="m-toolcall">
              <div className="mbox-h">
                <Terminal size={12} className="mbox-ico" />
                <span className="mbox-label">
                  {t('msg.toolcall')} · {c.name}
                </span>
              </div>
              <pre className="m-pre">{c.args}</pre>
            </div>
          );
        return null;
      })}
    </div>
  );
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

  const reloadTask = () => api.task(id).then(setTask).catch(() => {});
  const loadEvents = (since = 0) =>
    api
      .events(id, since)
      .then((rows) => {
        if (!rows.length) return;
        const fresh = since === 0 ? rows : rows.filter((r) => r.seq > lastSeq.current);
        if (fresh.length) setEvents((x) => (since === 0 ? rows : [...x, ...fresh]));
        lastSeq.current = Math.max(lastSeq.current, ...rows.map((r) => r.seq));
      })
      .catch(() => {});
  const loadExtra = () => {
    api.blocks(id).then(setBlocks).catch(() => {});
    api.assets(id).then(setAssets).catch(() => {});
  };

  useEffect(() => {
    reloadTask();
    loadEvents();
    loadExtra();
    const off = onEvent((ev) => {
      const p = ev.payload ?? {};
      if (p.taskId && p.taskId !== id) return;
      if (ev.kind === 'task.event') {
        const e = ev.payload.event;
        if (e && e.seq > lastSeq.current) {
          lastSeq.current = e.seq;
          setEvents((x) => (x.some((z) => z.seq === e.seq) ? x : [...x, e]));
        }
        if (e?.kind === 'block') loadExtra();
        if (e?.kind === 'asset') api.assets(id).then(setAssets).catch(() => {});
      }
      if (ev.kind === 'task.status' || ev.kind === 'task.user_message') reloadTask();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, mode, feedFilter]);

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
      const groups: Record<string, string[]> = {
        user: ['user_message'],
        exec: ['planned', 'step', 'tool', 'asset', 'subagent'],
        review: ['review', 'block'],
        system: ['system', 'phase', 'system_prompt'],
      };
      return groups[feedFilter]?.includes(e.kind) ?? false;
    });
  }, [events, feedFilter, mode]);

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
    const isRework = reworkMode && !!t0 && (t0.status === 'done' || t0.status === 'awaiting_confirm');
    try {
      if (isRework) {
        await api.rework(id, { text: txt, images: draftImgs.map((i) => i.num) });
        toast(t('rework.sent'));
        setReworkMode(false);
        setLongMode(false);
        reloadTask();
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
          <button className="btn ghost" onClick={() => nav(`/boards/${task.board_id}`)}>
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
          {task.status !== 'done' && (
            <button
              className="btn danger sm"
              onClick={() => api.cancel(id).then(reloadTask).catch((e) => toast(e.message, 'err'))}
            >
              <X size={13} /> {t('task.cancel')}
            </button>
          )}
        </div>
        <div
          className={`td-desc ${descOpen ? 'open' : ''}`}
          data-testid="task-desc"
          onClick={() => setDescOpen(!descOpen)}
          title={descOpen ? undefined : t('task.descToggle')}
        >
          <MD text={task.description} imgBase={imgBase} />
        </div>
        <div className="td-meta">
          <span className="meta-ico">
            <Folder size={13} /> <code className="mono">{task.workspace_path}</code>
          </span>
          <span className="meta-ico">
            <GitBranch size={13} /> {t(task.branch_mode === 'manual' ? 'meta.branch.manual' : 'meta.branch.auto', { min: task.branch_timeout_min })}
          </span>
          {task.test_cmd && (
            <span className="meta-ico">
              {t('meta.test')}：<code className="mono">{task.test_cmd}</code>
            </span>
          )}
          {task.started_at && (
            <span className="meta-ico">
              <Clock size={13} />{' '}
              {running ? `${t('meta.running')} ${fmtDur(Date.now() - task.started_at)}` : `${t('meta.duration')} ${fmtDur((task.finished_at ?? Date.now()) - task.started_at)}`}
            </span>
          )}
        </div>
      </header>

      {/* ===== 中部：消息流（唯一滚动区） ===== */}
      <div className="td-feed">
        <div className="td-feedbar">
          <ListFilter size={13} className="fb-ico" />
          <select
            className="inp"
            data-testid="feed-filter"
            style={{ width: 122, padding: '3px 8px', fontSize: 12 }}
            value={feedFilter}
            onChange={(e) => setFeedFilter(e.target.value)}
          >
            {['all', 'user', 'exec', 'review', 'system'].map((k) => (
              <option key={k} value={k}>
                {t(`feed.filter.${k}`)}
              </option>
            ))}
          </select>
          <button className="btn ghost sm" data-testid="feed-export" title={t('feed.export')} onClick={exportEvents}>
            <Download size={13} />
          </button>
          <span className="fb-count">{t('feed.count', { n: events.length })}</span>
          <span style={{ flex: 1 }} />
          <button
            className={`btn ${mode === 'full' ? 'primary' : 'ghost'} sm`}
            data-testid="btn-mode"
            onClick={() => setMode(mode === 'full' ? 'summary' : 'full')}
            title={t('feed.modeTip')}
          >
            {mode === 'full' ? t('feed.mode.full') : t('feed.mode.summary')}
          </button>
        </div>
        <div className="feed" data-testid="feed" ref={feedRef}>
          {mode === 'full' && !events.some((e) => ['message', 'system_prompt', 'subagent'].includes(e.kind)) && (
            <div className="full-hint">
              {t('feed.fullOld')}
            </div>
          )}
          {shownEvents.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 12.5, textAlign: 'center', padding: 18 }}>{t('feed.empty')}</div>
          )}
          {shownEvents.map((ev) =>
            mode === 'full' ? (
              <div key={ev.seq} data-testid="ev">
                {['message', 'system_prompt', 'subagent'].includes(ev.kind) ? (
                  <MsgBox ev={ev} imgBase={imgBase} />
                ) : (
                  <EvRow ev={ev} plan={task.plan} imgBase={imgBase} onPreview={setPreview} />
                )}
              </div>
            ) : (
              <div key={ev.seq} data-testid="ev">
                <EvRow ev={ev} plan={task.plan} imgBase={imgBase} onPreview={setPreview} />
              </div>
            )
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
        ) : task.status === 'waiting_input' ? (
          <div className="alert-card alert-wait">
            <div className="ac-title">
              <Pencil size={14} /> {t('branch.title', { n: pendingQs.length })}
            </div>
            {pendingQs.map((q) => (
              <div key={q.id} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 650, marginBottom: 7, fontSize: 13 }}>{q.q}</div>
                <div className="opt-list">
                  {q.options.map((o, i) => (
                    <button
                      key={i}
                      className={`opt-btn ${branchSel[q.id] === o.label ? 'on' : ''}`}
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
                  style={{ marginTop: 6 }}
                  placeholder={t('branch.customPh')}
                  value={branchCustom[q.id] ?? ''}
                  onChange={(e) => setBranchCustom((s) => ({ ...s, [q.id]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" data-testid="btn-branch-submit" onClick={submitBranch}>
                {t('branch.submit')}
              </button>
            </div>
          </div>
        ) : task.status === 'awaiting_confirm' ? (
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn primary big"
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
              <button className="btn ghost" data-testid="btn-rework" onClick={toggleRework}>
                <RotateCcw size={13} /> {t('confirm.rework')}
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
        ) : (
          <div className="tabs-card">
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
          </div>
        )}
      </div>

      {/* ===== 状态条（composer 上方，一行进度） ===== */}
      <div className="td-statusline" data-testid="status-line">
        <span className="sl-phase">{t(`status.${task.status}`)}</span>
        {task.current_action && <span className="sl-action">{task.current_action}</span>}
        <span style={{ flex: 1 }} />
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
                placeholder={running ? t('feed.steerPh.active') : t('feed.steerPh')}
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
            <div className="steer-hint">{running ? t('feed.hint.running') : t('feed.hint.inactive')}</div>
          </>
        )}
      </div>

      {preview && <AssetPreview taskId={id} file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
