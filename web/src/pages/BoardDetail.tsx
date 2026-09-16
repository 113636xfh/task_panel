import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtDur, fmtTime, shortPath, STATUS_LABEL } from '../lib/fmt';
import { toast } from '../lib/toast';
import type { Task } from '../lib/types';

const COLS: { key: string; label: string; color: string; statuses: string[] }[] = [
  { key: 'queued', label: '待打磨', color: 'var(--st-queued)', statuses: ['queued', 'interrupted'] },
  { key: 'planning', label: '打磨中', color: 'var(--st-planning)', statuses: ['planning'] },
  { key: 'waiting_input', label: '待回答', color: 'var(--st-waiting)', statuses: ['waiting_input'] },
  { key: 'executing', label: '执行中', color: 'var(--st-executing)', statuses: ['executing'] },
  { key: 'blocked', label: '阻塞', color: 'var(--st-blocked)', statuses: ['blocked'] },
  { key: 'testing', label: '验收中', color: 'var(--st-testing)', statuses: ['testing'] },
  { key: 'awaiting_confirm', label: '待确认', color: 'var(--st-confirm)', statuses: ['awaiting_confirm'] },
  { key: 'done', label: '完成', color: 'var(--st-done)', statuses: ['done'] },
];

function TaskCard({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const running = ['planning', 'executing', 'testing'].includes(t.status);
  return (
    <div className={`tcard st-${t.status}`} onClick={onOpen}>
      <div className="tc-top">
        <span className="tc-num">#{t.num}</span>
        {t.status === 'interrupted' && <span title="被抢占/服务重启，空位后自动恢复">↻</span>}
        <span className={`prio p${t.priority}`}>P{t.priority}</span>
      </div>
      <div className="tc-title">{t.title}</div>
      {t.current_action && running && <div className="tc-action">{t.current_action}</div>}
      <div className="tc-meta">
        <span>{shortPath(t.workspace_path)}</span>
        <span>·</span>
        <span>{running && t.started_at ? fmtDur(Date.now() - t.started_at) : fmtTime(t.created_at)}</span>
        {t.status === 'waiting_input' && <span className="tc-chip chip-wait">待回答分支</span>}
        {t.status === 'blocked' && <span className="tc-chip chip-block">待决策</span>}
        {t.status === 'awaiting_confirm' && <span className="tc-chip chip-confirm">待确认</span>}
      </div>
    </div>
  );
}

function NewTaskModal({ boardId, skills, onClose, onCreated }: {
  boardId: string;
  skills: { name: string; source: string; kind: string; description: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState(2);
  const [wsMode, setWsMode] = useState<'fresh' | 'shared'>('fresh');
  const [wsName, setWsName] = useState('');
  const [wsPath, setWsPath] = useState('');
  const [branch, setBranch] = useState<'manual' | 'auto'>('manual');
  const [branchMin, setBranchMin] = useState(30);
  const [acceptance, setAcceptance] = useState('');
  const [testCmd, setTestCmd] = useState('');
  const [extra, setExtra] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !desc.trim()) return toast('标题和描述必填', 'err');
    if (wsMode === 'shared' && !wsPath.trim()) return toast('请选择项目目录', 'err');
    setBusy(true);
    try {
      await api.createTask(boardId, {
        title: title.trim(), description: desc.trim(), priority,
        workspace: wsMode === 'fresh' ? { mode: 'fresh', name: wsName.trim() } : { mode: 'shared', path: wsPath.trim() },
        branch_mode: branch, branch_timeout_min: branchMin,
        acceptance: acceptance.trim(), test_cmd: testCmd.trim(), extra_prompt: extra.trim(),
        skills: picked.join(','),
      });
      toast('任务已创建，进入待打磨队列');
      onCreated();
      onClose();
    } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="m-h">新任务<button className="m-x" onClick={onClose}>✕</button></div>
        <div className="m-b">
          <div className="field">
            <label>标题</label>
            <input className="inp" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话描述要做什么" />
          </div>
          <div className="field">
            <label>任务描述（越具体越好 —— 打磨阶段会先审视这段描述）</label>
            <textarea className="inp" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder={'背景 / 目标 / 约束 / 期望结果…\n例：给 src/x.ts 增加 Y 功能，注意保持 Z 行为不变。'} />
          </div>

          <div className="field">
            <label>工作目录（必选）</label>
            <div className="ws-radio">
              <div className={`ws-opt ${wsMode === 'fresh' ? 'on' : ''}`} onClick={() => setWsMode('fresh')}>
                <span className="radio" /> ① 独立新目录（默认）
              </div>
              {wsMode === 'fresh' && (
                <input className="inp" style={{ marginLeft: 23 }} value={wsName} onChange={(e) => setWsName(e.target.value)}
                  placeholder="目录名（如 demo-app），留空用任务名" />
              )}
              <div className={`ws-opt ${wsMode === 'shared' ? 'on' : ''}`} onClick={() => setWsMode('shared')}>
                <span className="radio" /> ② 指定已有项目目录
              </div>
              {wsMode === 'shared' && (
                <input className="inp mono" style={{ marginLeft: 23 }} value={wsPath} onChange={(e) => setWsPath(e.target.value)}
                  placeholder="绝对路径，如 C:\\proj 或 ~/proj（同目录任务共享 .pi 技能）" />
              )}
            </div>
          </div>

          <div className="field">
            <label>打磨分支策略</label>
            <div className="row">
              <div className="seg">
                <button className={branch === 'manual' ? 'on' : ''} onClick={() => setBranch('manual')}>手动（默认：有分支即暂停等回答）</button>
                <button className={branch === 'auto' ? 'on' : ''} onClick={() => setBranch('auto')}>自动（超时取默认）</button>
              </div>
            </div>
            {branch === 'manual' && (
              <div style={{ marginTop: 8 }}>
                <label>超时默认</label>
                <div className="row" style={{ alignItems: 'center' }}>
                  <input type="range" min={5} max={1440} step={5} value={branchMin} onChange={(e) => setBranchMin(Number(e.target.value))} />
                  <span className="mono" style={{ color: 'var(--text-2)' }}>{branchMin}m</span>
                </div>
              </div>
            )}
          </div>

          <div className="row">
            <div className="field">
              <label>验收标准（可选，可多条换行）</label>
              <textarea className="inp" rows={2} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder={'- 功能点 A 可用\n- 现有测试全部通过'} />
            </div>
            <div className="field">
              <label>测试命令（可选）</label>
              <input className="inp mono" value={testCmd} onChange={(e) => setTestCmd(e.target.value)} placeholder="如 npm test" />
            </div>
          </div>

          <div className="field">
            <label>任务专属系统提示词（可选，追加在全局之后）</label>
            <textarea className="inp mono" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder="本任务专属的额外指令（P0 stub 阶段仅存储展示）" />
          </div>

          <div className="field">
            <label>附加技能/扩展（任务级，可选）</label>
            <div className="skill-list">
              {skills.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>全局/项目层暂无可装项</span>}
              {skills.map((s) => (
                <label key={`${s.source}|${s.kind}|${s.name}`} className="skill-opt">
                  <input type="checkbox" checked={picked.includes(s.name)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.name] : p.filter((x) => x !== s.name)))} />
                  <b>{s.name}</b>
                  <span className="kind-tag">{s.kind}</span>
                  <span className="s-desc">{s.source === 'global' ? '全局' : '项目级'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="m-f">
          <span className="mono" style={{ color: 'var(--text-3)', marginRight: 'auto', fontSize: 11 }}>优先级</span>
          <select className="inp" style={{ width: 90 }} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>P0</option><option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option>
          </select>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? '创建中…' : '创建任务'}</button>
        </div>
      </div>
    </div>
  );
}

export default function BoardDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [board, setBoard] = useState<any | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [skills, setSkills] = useState<{ name: string; source: string; kind: string; description: string }[]>([]);
  const firstLoad = useRef(true);

  const loadTasks = () => {
    api.tasks(id).then(setTasks).catch(() => {});
  };
  useEffect(() => {
    api.boards().then((bs) => setBoard(bs.find((b) => b.id === id) ?? null)).catch(() => {});
    loadTasks();
    api.skills().then((inv) => {
      const g: any[] = [...inv.global.skills, ...inv.global.extensions];
      const p: any[] = inv.projects.flatMap((x: any) => [...x.skills, ...x.extensions]);
      const seen = new Set<string>();
      setSkills([...g, ...p].filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true))));
    }).catch(() => {});
    const off = onEvent((ev) => {
      if (!['task.status', 'task.created', 'boards.changed', 'task.event'].includes(ev.kind)) return;
      if (ev.kind === 'task.event' && !tasks.some((t) => t.id === ev.payload?.taskId)) return;
      loadTasks();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const byCol = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const c of COLS) m[c.key] = [];
    const dead: Task[] = [];
    for (const t of tasks) {
      if (t.status === 'failed' || t.status === 'cancelled') dead.push(t);
      else {
        const c = COLS.find((c) => c.statuses.includes(t.status));
        c?.statuses.includes(t.status) && m[c.key].push(t);
      }
    }
    for (const c of COLS) m[c.key].sort((a, b) => a.priority - b.priority || a.num - b.num);
    return { cols: m, dead };
  }, [tasks]);

  return (
    <>
      <div className="page-head">
        <button className="btn ghost" onClick={() => nav('/boards')}>← 看板</button>
        <h1>{board?.name ?? '…'}</h1>
        <span className="sub">{tasks.length} 任务</span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setShowNew(true)}>＋ 新任务</button>
      </div>

      <div className="kanban">
        {COLS.map((c) => (
          <div key={c.key} className={`kcol ${c.key}`}>
            <div className="kcol-h">
              <span className="cdot" style={{ background: c.color }} />
              {c.label}
              <span className="cnt">{byCol.cols[c.key].length}</span>
            </div>
            {byCol.cols[c.key].map((t) => (
              <TaskCard key={t.id} t={t} onOpen={() => nav(`/boards/${id}/tasks/${t.id}`)} />
            ))}
          </div>
        ))}
      </div>

      {byCol.dead.length > 0 && (
        <div className="dead-row">
          {byCol.dead.map((t) => (
            <span key={t.id} className="dead-chip" onClick={() => nav(`/boards/${id}/tasks/${t.id}`)}>
              #{t.num} {t.title} · {STATUS_LABEL[t.status]}
            </span>
          ))}
        </div>
      )}

      {showNew && (
        <NewTaskModal boardId={id} skills={skills} onClose={() => setShowNew(false)} onCreated={loadTasks} />
      )}
    </>
  );
}
