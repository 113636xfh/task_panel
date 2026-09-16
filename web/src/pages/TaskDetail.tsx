import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtAgo, fmtDur, fmtTime, STATUS_LABEL } from '../lib/fmt';
import { toast } from '../lib/toast';
import { MD } from '../lib/md';
import type { BlockItem, Plan, Task, TaskEvent } from '../lib/types';

function EvRow({ ev, plan }: { ev: TaskEvent; plan: Plan | null }) {
  const p = ev.payload;
  const time = <span className="ev-t">{fmtTime(ev.ts)}</span>;
  switch (ev.kind) {
    case 'phase': return <div className="ev ev-phase"><span className="ev-body">{STATUS_LABEL[p.phase] ?? p.phase}</span></div>;
    case 'system': return <div className="ev ev-system">{time}<span className="ev-body">{p.text}</span></div>;
    case 'think': return <div className="ev">{time}<div className="ev-body ev-think">▸ {p.text}</div></div>;
    case 'planned': return <div className="ev">{time}<div className="ev-body ev-planned"><b>打磨完成</b> —— {p.summary}</div></div>;
    case 'tool': return (
      <div className="ev ev-tool">{time}
        <div className="ev-body">
          {p.summary}
          {p.result && <div className="res">{p.result}</div>}
        </div>
      </div>
    );
    case 'step': {
      const s = plan?.steps.find((x) => x.id === p.id);
      return <div className="ev ev-step">{time}<span className="ev-body">✓ {p.id} {s?.title ?? ''}</span></div>;
    }
    case 'user_message': return <div className="ev ev-user"><span className="ev-body">{p.text}</span>{time}</div>;
    case 'block': return <div className="ev ev-block">{time}<span className="ev-body">⛔ 阻塞：{p.question}</span></div>;
    case 'review': return <div className="ev ev-review">{time}<span className="ev-body">验收：{p.overall === 'pass' ? '通过' : '未通过'}（{p.items?.length ?? 0} 项）</span></div>;
    case 'asset': return <div className="ev ev-asset">{time}<span className="ev-body">📄 {p.name} — {p.summary}</span></div>;
    default: return null;
  }
}

export default function TaskDetail() {
  const { taskId = '' } = useParams();
  const id = taskId;
  const nav = useNavigate();
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
    api.events(id, since).then((rows) => {
      if (since === 0) setEvents(rows);
      else setEvents((x) => [...x, ...rows.filter((r) => r.seq > lastSeq.current)]);
      lastSeq.current = Math.max(lastSeq.current, ...rows.map((r) => r.seq));
    }).catch(() => {});
  const loadExtra = () => {
    api.blocks(id).then(setBlocks).catch(() => {});
    api.assets(id).then(setAssets).catch(() => {});
  };

  useEffect(() => {
    reloadTask(); loadEvents(); loadExtra();
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
    const t = msg.trim();
    if (!t) return;
    try {
      await api.message(id, t);
      setMsg('');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  if (!task) return <div className="empty">加载中…</div>;

  const running = ['planning', 'executing', 'testing'].includes(task.status);
  const branchQs = task.plan?.branch_questions ?? [];
  const pendingQs = branchQs.filter((q) => !task.answers[q.id]);

  async function submitBranch() {
    const answers: Record<string, string> = {};
    for (const q of pendingQs) {
      const a = (branchCustom[q.id] ?? '').trim() || branchSel[q.id];
      if (!a) return toast(`「${q.q.slice(0, 20)}…」还需要选择或输入`, 'err');
      answers[q.id] = a;
    }
    try {
      await api.answer(id, answers);
      toast('已提交，任务恢复执行');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <>
      <div className="task-head">
        <button className="btn ghost" onClick={() => nav(`/boards/${task.board_id}`)}>← 看板</button>
        <h1><span className="mono" style={{ color: 'var(--text-3)', fontWeight: 500 }}>#{task.num}</span> {task.title}</h1>
        <span className={`badge st-${task.status}`}><span className="dot" />{STATUS_LABEL[task.status]}</span>
        <select className="inp" style={{ width: 78 }} value={task.priority}
          onChange={(e) => api.patchTask(id, { priority: Number(e.target.value) }).then(reloadTask).catch((e) => toast(e.message, 'err'))}>
          <option value={0}>P0</option><option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option>
        </select>
        {task.status !== 'done' && (
          <button className="btn danger sm" onClick={() => api.cancel(id).then(reloadTask).catch((e) => toast(e.message, 'err'))}>取消任务</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>📁 <code className="mono">{task.workspace_path}</code></span>
        <span>分支策略：{task.branch_mode === 'manual' ? `手动（${task.branch_timeout_min}m 默认）` : '自动'}</span>
        {task.test_cmd && <span>测试：<code className="mono">{task.test_cmd}</code></span>}
        {task.extra_prompt && <span style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.extra_prompt}>专属指令：{task.extra_prompt}</span>}
        {task.started_at && <span>{running ? `已运行 ${fmtDur(Date.now() - task.started_at)}` : `用时 ${fmtDur((task.finished_at ?? Date.now()) - task.started_at)}`}</span>}
      </div>

      {/* 阻塞决策卡 */}
      {task.status === 'blocked' && openBlock && (
        <div className="alert-card alert-block">
          <div className="ac-title">⛔ 阻塞 · 需要你的决策</div>
          <MD text={openBlock.question} />
          <div className="ctx-box">
            <span><span className="k">现状</span>{openBlock.context.current}</span>
            <span><span className="k">已验证</span>{openBlock.context.verified}</span>
            <span><span className="k">影响</span>{openBlock.context.impact}</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="k">引用</span>
              {openBlock.context.refs.map((r) => <span key={r} className="ref-chip">{r}</span>)}
            </span>
          </div>
          <div className="opt-list">
            {openBlock.options.map((o, i) => (
              <button key={i} className="opt-btn"
                onClick={() => api.blockAnswer(id, o.label).then(() => { toast('已提交决策'); reloadTask(); loadExtra(); })}>
                <span className="o-label">
                  {String.fromCharCode(65 + i)}. {o.label}
                  {openBlock.recommended && String.fromCharCode(65 + i) === openBlock.recommended && <span className="rec-tag">推荐</span>}
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
            <input className="inp" placeholder="自定义决策（覆盖上方选项）" value={blockCustom} onChange={(e) => setBlockCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && blockCustom.trim() && api.blockAnswer(id, blockCustom.trim()).then(() => { toast('已提交'); reloadTask(); loadExtra(); setBlockCustom(''); })} />
            <button className="btn primary" disabled={!blockCustom.trim()}
              onClick={() => api.blockAnswer(id, blockCustom.trim()).then(() => { toast('已提交'); reloadTask(); loadExtra(); setBlockCustom(''); })}>
              提交决策
            </button>
          </div>
          <div className="steer-hint">默认无限期等待你的决策；任务不占执行位。</div>
        </div>
      )}

      {/* 分支回答卡 */}
      {task.status === 'waiting_input' && (
        <div className="alert-card alert-wait">
          <div className="ac-title">✎ 打磨分支 · 等待回答（{pendingQs.length}）</div>
          {pendingQs.map((q) => (
            <div key={q.id} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 650, marginBottom: 7, fontSize: 13 }}>{q.q}</div>
              <div className="opt-list">
                {q.options.map((o, i) => (
                  <button key={i} className={`opt-btn ${branchSel[q.id] === o.label ? 'on' : ''}`} onClick={() => setBranchSel((s) => ({ ...s, [q.id]: o.label }))}>
                    <span className="o-label">
                      {String.fromCharCode(65 + i)}. {o.label}
                      {o.recommended && <span className="rec-tag">推荐</span>}
                    </span>
                  </button>
                ))}
              </div>
              <input className="inp" style={{ marginTop: 6 }} placeholder="或自定义回答"
                value={branchCustom[q.id] ?? ''} onChange={(e) => setBranchCustom((s) => ({ ...s, [q.id]: e.target.value }))} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={submitBranch}>提交回答</button>
          </div>
        </div>
      )}

      {/* 待确认卡 */}
      {task.status === 'awaiting_confirm' && (
        <div className="alert-card alert-confirm">
          <div className="ac-title">✓ 验收通过 · 等待你确认完成</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 11 }}>
            客观测试{task.test_cmd ? ` <code className="mono">{task.test_cmd}</code>` : ''} 与 LLM 评判均通过。确认后任务标记为完成（P1 起可回滚）。
          </div>
          <button className="btn primary big" onClick={() => api.confirm(id).then(() => { toast('已确认完成'); reloadTask(); })}>✓ 确认完成</button>
        </div>
      )}

      {task.status === 'interrupted' && (
        <div className="alert-card alert-wait">
          <div className="ac-title">↻ 已中断（被抢占 / 服务重启）</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>已按 checkpoint 保存；有空闲执行位时将自动恢复（P1 起为 session resume 全量重放）。</div>
        </div>
      )}

      <div className="task-body">
        <div className="col">
          <div className="card">
            <div className="card-h">任务描述</div>
            <div className="card-b"><MD text={task.description} /></div>
          </div>

          {task.plan && (
            <div className="card">
              <div className="card-h">打磨计划{task.answers && Object.keys(task.answers).length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>· 已吸收 {Object.keys(task.answers).length} 条分支回答</span>}</div>
              <div className="card-b">
                <MD text={task.plan.summary} />
                <div style={{ marginTop: 10 }}>
                  {task.plan.steps.map((s, i) => {
                    const active = running && !s.done && task.plan!.steps.slice(0, i + 1).every((x) => x.done || x.id === s.id);
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
            <div className="card-h">留言板 / 事件流 <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--text-3)' }}>{events.length} 条</span></div>
            <div className="card-b tight">
              <div className="feed" ref={feedRef}>
                {events.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.5, textAlign: 'center', padding: 18 }}>暂无事件</div>}
                {events.map((ev) => <EvRow key={ev.seq} ev={ev} plan={task.plan} />)}
              </div>
              <div style={{ padding: '0 14px 13px' }}>
                <div className="steer-row">
                  <input className="inp" placeholder={running ? '实时指导（steer，下次 LLM 调用前生效）' : '留言（任务未运行，进入回复队列）'}
                    value={msg} onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMsg()} />
                  <button className="btn primary" onClick={sendMsg}>发送</button>
                </div>
                <div className="steer-hint">{running ? '运行中：消息会 steer 进当前执行。' : '未运行：消息排队，恢复执行时合入上下文。'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col">
          {task.review && (
            <div className="card">
              <div className="card-h">验收 <span className={`badge st-${task.review.overall === 'pass' ? 'done' : 'failed'}`} style={{ marginLeft: 4 }}>
                {task.review.overall === 'pass' ? '通过' : '未通过'}
              </span></div>
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
            <div className="card-h">工作产物</div>
            <div className="card-b tight">
              {assets.length === 0 && <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>暂无（agent 产出的文档/产物会出现在这里）</div>}
              {assets.map((a) => (
                <div className="asset-row" key={a.id}>
                  <span>📄</span>
                  <span className="a-name">{a.name}</span>
                  <span className="a-sum" title={a.summary}>{a.summary}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11, flex: 'none' }}>{fmtAgo(a.at)}</span>
                </div>
              ))}
            </div>
          </div>

          {task.acceptance_text && (
            <div className="card">
              <div className="card-h">验收标准（创建时填写）</div>
              <div className="card-b"><MD text={task.acceptance_text} /></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
