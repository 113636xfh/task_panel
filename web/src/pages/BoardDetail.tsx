import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, RefreshCw, ImagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtDur, fmtTime, shortPath } from '../lib/fmt';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import { fileToBase64 } from '../lib/img';
import type { Task } from '../lib/types';

const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

function dataUrl(name: string, data: string): string {
  const ext = (name.slice(name.lastIndexOf('.') + 1) || 'png').toLowerCase();
  return `data:${IMG_MIME[ext] ?? 'image/png'};base64,${data}`;
}

const COLS: { key: string; color: string; statuses: string[] }[] = [
  { key: 'queued', color: 'var(--st-queued)', statuses: ['queued', 'interrupted'] },
  { key: 'planning', color: 'var(--st-planning)', statuses: ['planning'] },
  { key: 'waiting_input', color: 'var(--st-waiting)', statuses: ['waiting_input'] },
  { key: 'executing', color: 'var(--st-executing)', statuses: ['executing'] },
  { key: 'blocked', color: 'var(--st-blocked)', statuses: ['blocked'] },
  { key: 'testing', color: 'var(--st-testing)', statuses: ['testing'] },
  { key: 'awaiting_confirm', color: 'var(--st-confirm)', statuses: ['awaiting_confirm'] },
  { key: 'done', color: 'var(--st-done)', statuses: ['done'] },
];

function TaskCard({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const { t: tx } = useI18n();
  const running = ['planning', 'executing', 'testing'].includes(t.status);
  return (
    <div className={`tcard st-${t.status}`} data-testid="task-card" data-num={t.num} data-status={t.status} onClick={onOpen}>
      <div className="tc-top">
        <span className="tc-num">#{t.num}</span>
        {t.status === 'interrupted' && (
          <span className="tc-interrupted" title={tx('status.interrupted')}>
            <RefreshCw size={12} />
          </span>
        )}
        <span className={`prio p${t.priority}`}>P{t.priority}</span>
      </div>
      <div className="tc-title">{t.title}</div>
      {t.current_action && running && <div className="tc-action">{t.current_action}</div>}
      <div className="tc-meta">
        <span>{shortPath(t.workspace_path)}</span>
        <span>·</span>
        <span>{running && t.started_at ? fmtDur(Date.now() - t.started_at) : fmtTime(t.created_at)}</span>
        {t.status === 'waiting_input' && <span className="tc-chip chip-wait">{tx('chip.waiting')}</span>}
        {t.status === 'blocked' && <span className="tc-chip chip-block">{tx('chip.blocked')}</span>}
        {t.status === 'awaiting_confirm' && <span className="tc-chip chip-confirm">{tx('chip.awaiting')}</span>}
      </div>
    </div>
  );
}

function NewTaskModal({
  boardId,
  skills,
  onClose,
  onCreated,
}: {
  boardId: string;
  skills: { name: string; source: string; kind: string; description: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
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
  const [imgFiles, setImgFiles] = useState<{ name: string; data: string; url: string }[]>([]);
  const imgInputRef = useRef<HTMLInputElement>(null);

  async function pickImgs(files: FileList | null) {
    if (!files?.length) return;
    try {
      const items = await Promise.all(
        Array.from(files).map(async (f) => {
          const { name, data } = await fileToBase64(f);
          return { name, data, url: dataUrl(name, data) };
        })
      );
      setImgFiles((prev) => [...prev, ...items]);
    } catch {
      toast(t('img.err'), 'err');
    } finally {
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  }

  async function submit() {
    if (!title.trim() || !desc.trim()) return toast(t('modal.missing'), 'err');
    if (wsMode === 'shared' && !wsPath.trim()) return toast(t('modal.wsPick'), 'err');
    setBusy(true);
    try {
      await api.createTask(boardId, {
        title: title.trim(),
        description: desc.trim(),
        priority,
        workspace: wsMode === 'fresh' ? { mode: 'fresh', name: wsName.trim() } : { mode: 'shared', path: wsPath.trim() },
        branch_mode: branch,
        branch_timeout_min: branchMin,
        acceptance: acceptance.trim(),
        test_cmd: testCmd.trim(),
        extra_prompt: extra.trim(),
        skills: picked.join(','),
        images: imgFiles.map(({ name, data }) => ({ name, data })),
      });
      toast(t('modal.created'));
      onCreated();
      onClose();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="m-h">
          {t('modal.newTitle')}
          <button className="m-x" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="m-b">
          <div className="field">
            <label>{t('modal.title')}</label>
            <input className="inp" data-testid="input-task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('modal.titlePh')} />
          </div>
          <div className="field">
            <label>{t('modal.desc')}</label>
            <textarea className="inp" data-testid="input-task-desc" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('modal.descPh')} />
          </div>
          <div className="field">
            <label className="m-img-label">
              {t('modal.img')}
              <button type="button" className="btn ghost sm" onClick={() => imgInputRef.current?.click()}>
                <ImagePlus size={13} /> {t('img.attach')}
              </button>
            </label>
            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickImgs(e.target.files)} />
            {imgFiles.length > 0 ? (
              <div className="img-chips">
                {imgFiles.map((im, i) => (
                  <div key={i} className="img-chip" title={im.name}>
                    <img src={im.url} alt={im.name} />
                    <span className="n">{t('img.fig', { n: i + 1 })}</span>
                    <button type="button" className="chip-x" onClick={() => setImgFiles((x) => x.filter((_, j) => j !== i))}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="steer-hint">{t('img.none')}</div>
            )}
          </div>

          <div className="field">
            <label>{t('modal.workspace')}</label>
            <div className="ws-radio">
              <div className={`ws-opt ${wsMode === 'fresh' ? 'on' : ''}`} onClick={() => setWsMode('fresh')}>
                <span className="radio" /> {t('modal.ws.fresh')}
              </div>
              {wsMode === 'fresh' && (
                <input
                  className="inp"
                  data-testid="input-ws-name"
                  style={{ marginLeft: 23 }}
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder={t('modal.ws.freshPh')}
                />
              )}
              <div className={`ws-opt ${wsMode === 'shared' ? 'on' : ''}`} onClick={() => setWsMode('shared')}>
                <span className="radio" /> {t('modal.ws.existing')}
              </div>
              {wsMode === 'shared' && (
                <input
                  className="inp mono"
                  style={{ marginLeft: 23 }}
                  value={wsPath}
                  onChange={(e) => setWsPath(e.target.value)}
                  placeholder={t('modal.ws.existingPh')}
                />
              )}
            </div>
          </div>

          <div className="field">
            <label>{t('modal.branch')}</label>
            <div className="row">
              <div className="seg">
                <button className={branch === 'manual' ? 'on' : ''} onClick={() => setBranch('manual')}>
                  {t('modal.branch.manual')}
                </button>
                <button className={branch === 'auto' ? 'on' : ''} onClick={() => setBranch('auto')}>
                  {t('modal.branch.auto')}
                </button>
              </div>
            </div>
            {branch === 'manual' && (
              <div style={{ marginTop: 8 }}>
                <label>{t('modal.branch.timeout')}</label>
                <div className="row" style={{ alignItems: 'center' }}>
                  <input type="range" min={5} max={1440} step={5} value={branchMin} onChange={(e) => setBranchMin(Number(e.target.value))} />
                  <span className="mono" style={{ color: 'var(--text-2)' }}>
                    {branchMin}m
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="row">
            <div className="field">
              <label>{t('modal.accept')}</label>
              <textarea className="inp" rows={2} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder={t('modal.acceptPh')} />
            </div>
            <div className="field">
              <label>{t('modal.test')}</label>
              <input className="inp mono" value={testCmd} onChange={(e) => setTestCmd(e.target.value)} placeholder={t('modal.testPh')} />
            </div>
          </div>

          <div className="field">
            <label>{t('modal.extra')}</label>
            <textarea className="inp mono" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('modal.extraPh')} />
          </div>

          <div className="field">
            <label>{t('modal.skills')}</label>
            <div className="skill-list">
              {skills.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{t('modal.skills.empty')}</span>}
              {skills.map((s) => (
                <label key={`${s.source}|${s.kind}|${s.name}`} className="skill-opt">
                  <input
                    type="checkbox"
                    checked={picked.includes(s.name)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.name] : p.filter((x) => x !== s.name)))}
                  />
                  <b>{s.name}</b>
                  <span className="kind-tag">{s.kind}</span>
                  <span className="s-desc">{s.source === 'global' ? t('modal.skill.global') : t('modal.skill.project')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="m-f">
          <span className="mono" style={{ color: 'var(--text-3)', marginRight: 'auto', fontSize: 11 }}>
            {t('modal.prio')}
          </span>
          <select className="inp" style={{ width: 90 }} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>P0</option>
            <option value={1}>P1</option>
            <option value={2}>P2</option>
            <option value={3}>P3</option>
          </select>
          <button className="btn" onClick={onClose}>
            {t('boards.cancel')}
          </button>
          <button className="btn primary" data-testid="btn-create-task" disabled={busy} onClick={submit}>
            {busy ? t('modal.creating') : t('modal.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BoardDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const [board, setBoard] = useState<any | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [skills, setSkills] = useState<{ name: string; source: string; kind: string; description: string }[]>([]);

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
        <button className="btn ghost" onClick={() => nav('/boards')}>
          <ArrowLeft size={14} /> {t('board.back')}
        </button>
        <h1>{board?.name ?? '…'}</h1>
        <span className="sub">
          {tasks.length} {t('boards.card.tasks')}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" data-testid="btn-new-task" onClick={() => setShowNew(true)}>
          <Plus size={14} /> {t('board.newTask')}
        </button>
      </div>

      <div className="kanban">
        {COLS.map((c) => (
          <div key={c.key} className={`kcol ${c.key}`} data-testid={`col-${c.key}`}>
            <div className="kcol-h">
              <span className="cdot" style={{ background: c.color }} />
              {t(`col.${c.key}`)}
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
          {byCol.dead.map((tt) => (
            <span key={tt.id} className="dead-chip" onClick={() => nav(`/boards/${id}/tasks/${tt.id}`)}>
              #{tt.num} {tt.title} · {t(`status.${tt.status}`)}
            </span>
          ))}
        </div>
      )}

      {showNew && <NewTaskModal boardId={id} skills={skills} onClose={() => setShowNew(false)} onCreated={loadTasks} />}
    </>
  );
}
