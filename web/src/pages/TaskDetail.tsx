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
} from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtAgo, fmtDur, fmtTime } from '../lib/fmt';
import { toast } from '../lib/toast';
import { MD } from '../lib/md';
import { useI18n } from '../i18n';
import type { BlockItem, Plan, Task, TaskEvent } from '../lib/types';

function EvRow({ ev, plan }: { ev: TaskEvent; plan: Plan | null }) {
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
          <span className="ev-body">{p.text}</span>
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
            {p.name} — {p.summary}
          </span>
        </div>
      );
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
  const [msg, setMsg] = useState('');
  const [branchSel, setBranchSel] = useState<Record<string, string>>({});
  const [branchCustom, setBranchCustom] = useState<Record<string, string>>({});
  const [blockCustom, setBlockCustom] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const lastSeq = useRef(0);

  const reloadTask = () => api.task(id).then(setTask).catch(() => {});
  const loadEvents = (since = 0) =>
    api
      .events(id, since)
      .then((rows) => {
        if (since === 0) setEvents(rows);
        else setEvents((x) => [...x, ...rows.filter((r) => r.seq > lastSeq.current)]);
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
        loadEvents(lastSeq.current);
        if (ev.payload.event.kind === 'block') loadExtra();
        if (ev.payload.event.kind === 'asset') api.assets(id).then(setAssets).catch(() => {});
      }
      if (ev.kind === 'task.status' || ev.kind === 'task.user_message') reloadTask();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const openBlock = useMemo(() => blocks.find((b) => b.status === 'open') ?? null, [blocks]);

  async function sendMsg() {
    const txt = msg.trim();
    if (!txt) return;
    try {
      await api.message(id, txt);
      setMsg('');
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  if (!task) return <div className="empty">{t('loading')}…</div>;

  const running = ['planning', 'executing', 'testing'].includes(task.status);
  const branchQs = task.plan?.branch_questions ?? [];
  const pendingQs = branchQs.filter((q) => !task.answers[q.id]);

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
    <>
      <div className="task-head">
        <button className="btn ghost" onClick={() => nav(`/boards/${task.board_id}`)}>
          <ArrowLeft size={14} /> {t('board.back')}
        </button>
        <h1>
          <span className="mono" style={{ color: 'var(--text-3)', fontWeight: 500 }}>
            #{task.num}
          </span>{' '}
          {task.title}
        </h1>
        <span className={`badge st-${task.status}`}>
          <span className="dot" />
          {t(`status.${task.status}`)}
        </span>
        <select
          className="inp"
          style={{ width: 78 }}
          value={task.priority}
          onChange={(e) => api.patchTask(id, { priority: Number(e.target.value) }).then(reloadTask).catch((e) => toast(e.message, 'err'))}
        >
          <option value={0}>P0</option>
          <option value={1}>P1</option>
          <option value={2}>P2</option>
          <option value={3}>P3</option>
        </select>
        {task.status !== 'done' && (
          <button
            className="btn danger sm"
            onClick={() => api.cancel(id).then(reloadTask).catch((e) => toast(e.message, 'err'))}
          >
            <X size={13} /> {t('task.cancel')}
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
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
        {task.extra_prompt && (
          <span
            style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={task.extra_prompt}
          >
            {t('meta.extra')}：{task.extra_prompt}
          </span>
        )}
        {task.started_at && (
          <span className="meta-ico">
            <Clock size={13} />{' '}
            {running ? `${t('meta.running')} ${fmtDur(Date.now() - task.started_at)}` : `${t('meta.duration')} ${fmtDur((task.finished_at ?? Date.now()) - task.started_at)}`}
          </span>
        )}
      </div>

      {/* 阻塞决策卡 */}
      {task.status === 'blocked' && openBlock && (
        <div className="alert-card alert-block">
          <div className="ac-title">
            <OctagonAlert size={14} /> {t('block.title')}
          </div>
          <MD text={openBlock.question} />
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
              <button key={i} className="opt-btn" onClick={() => submitBlock(o.label)}>
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
            <button className="btn primary" disabled={!blockCustom.trim()} onClick={() => submitBlock(blockCustom.trim())}>
              {t('block.submit')}
            </button>
          </div>
          <div className="steer-hint">{t('block.hint')}</div>
        </div>
      )}

      {/* 分支回答卡 */}
      {task.status === 'waiting_input' && (
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
            <button className="btn primary" onClick={submitBranch}>
              {t('branch.submit')}
            </button>
          </div>
        </div>
      )}

      {/* 待确认卡 */}
      {task.status === 'awaiting_confirm' && (
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
          <button
            className="btn primary big"
            onClick={() => api.confirm(id).then(() => {
              toast(t('act.confirmed'));
              reloadTask();
            })}
          >
            <Check size={14} /> {t('confirm.btn')}
          </button>
        </div>
      )}

      {task.status === 'interrupted' && (
        <div className="alert-card alert-wait">
          <div className="ac-title">
            <RefreshCw size={14} /> {t('interrupted.title')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('interrupted.desc')}</div>
        </div>
      )}

      <div className="task-body">
        <div className="col">
          <div className="card">
            <div className="card-h">{t('card.desc')}</div>
            <div className="card-b">
              <MD text={task.description} />
            </div>
          </div>

          {task.plan && (
            <div className="card">
              <div className="card-h">
                {t('card.plan')}
                {task.answers && Object.keys(task.answers).length > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>
                    · {t('card.plan.answers', { n: Object.keys(task.answers).length })}
                  </span>
                )}
              </div>
              <div className="card-b">
                <MD text={task.plan.summary} />
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
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h">
              {t('feed.title')} <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--text-3)' }}>{t('feed.count', { n: events.length })}</span>
            </div>
            <div className="card-b tight">
              <div className="feed" ref={feedRef}>
                {events.length === 0 && (
                  <div style={{ color: 'var(--text-3)', fontSize: 12.5, textAlign: 'center', padding: 18 }}>{t('feed.empty')}</div>
                )}
                {events.map((ev) => (
                  <EvRow key={ev.seq} ev={ev} plan={task.plan} />
                ))}
              </div>
              <div style={{ padding: '0 14px 13px' }}>
                <div className="steer-row">
                  <input
                    className="inp"
                    placeholder={running ? t('feed.steerPh.active') : t('feed.steerPh')}
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                  />
                  <button className="btn primary" onClick={sendMsg}>
                    <Send size={13} /> {t('feed.send')}
                  </button>
                </div>
                <div className="steer-hint">{running ? t('feed.hint.running') : t('feed.hint.inactive')}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col">
          {task.review && (
            <div className="card">
              <div className="card-h">
                {t('card.acceptance')}{' '}
                <span className={`badge st-${task.review.overall === 'pass' ? 'done' : 'failed'}`} style={{ marginLeft: 4 }}>
                  {task.review.overall === 'pass' ? t('card.acceptance.pass') : t('card.acceptance.fail')}
                </span>
              </div>
              <div className="card-b">
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
            </div>
          )}

          <div className="card">
            <div className="card-h">{t('card.outputs')}</div>
            <div className="card-b tight">
              {assets.length === 0 && <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>{t('card.outputs.none')}</div>}
              {assets.map((a) => (
                <div className="asset-row" key={a.id}>
                  <FileText size={13} className="ev-ico" />
                  <span className="a-name">{a.name}</span>
                  <span className="a-sum" title={a.summary}>
                    {a.summary}
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11, flex: 'none' }}>
                    {fmtAgo(a.at)} {t('time.ago')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {task.acceptance_text && (
            <div className="card">
              <div className="card-h">{t('card.acceptanceText')}</div>
              <div className="card-b">
                <MD text={task.acceptance_text} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

