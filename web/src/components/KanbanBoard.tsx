import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Check, Loader2, Play } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import type { Task, TaskStatus } from '../lib/types';

// P3 四阶段看板列：等待 / 打磨 / 执行 / 验收
const COLS: { key: string; statuses: TaskStatus[] }[] = [
  { key: 'wait', statuses: ['ready', 'queued', 'paused'] },
  { key: 'plan', statuses: ['planning', 'waiting_input'] },
  { key: 'exec', statuses: ['executing', 'blocked', 'interrupted'] },
  { key: 'test', statuses: ['testing', 'awaiting_confirm', 'done'] },
];

// 项目名 = 工作目录的最后一段（跨项目看板上的卡片标注；不再显示完整路径）
const baseName = (p: string) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '—';

// 颜色纪律：红=阻塞/失败；橙=等用户（待准备/待答/待确认）；冷色=agent 自治；绿=完成
const TONE: Record<string, string> = {
  ready: 'orange',
  queued: 'gray',
  planning: 'calm',
  waiting_input: 'orange',
  executing: 'calm',
  blocked: 'red',
  interrupted: 'gray',
  testing: 'calm',
  awaiting_confirm: 'orange',
  paused: 'orange',
  done: 'green',
};

// 一行「正在进行」的内容：执行/打磨阶段优先 plan 进度，其余用 current_action
function progressLine(t: Task): string {
  if ((t.status === 'executing' || t.status === 'planning') && t.plan?.steps?.length) {
    const done = t.plan.steps.filter((s) => s.done).length;
    const cur = t.plan.steps.find((s) => !s.done)?.title;
    return `${done}/${t.plan.steps.length} · ${cur ?? ''}`.trim();
  }
  return t.current_action || '';
}

const SPIN = new Set(['planning', 'executing', 'testing']);

function KCard({ t, onNav, showProj }: { t: Task; onNav: () => void; showProj?: boolean }) {
  const { t: tx } = useI18n();
  const prog = progressLine(t);
  return (
    <div
      className={`kcard tone-${TONE[t.status] ?? 'gray'}`}
      data-testid="task-row"
      data-num={t.num}
      data-status={t.status}
      onClick={onNav}
      title={t.title}
    >
      <div className="kc-line1">
        <span className="kc-num">#{t.num}</span>
        {showProj && <span className="kc-proj">{baseName(t.workspace_path)}</span>}
        <span className="kc-title">{t.title}</span>
      </div>
      <div className="kc-line2">
        <span className={`pill s-${t.status}`}>
          <span className="dot" />
          {tx(`status.${t.status}`)}
        </span>
        {SPIN.has(t.status) && <Loader2 size={12} className="spin kc-spin" />}
        {prog && <span className="kc-prog">{prog}</span>}
        <span className="kc-actions" onClick={(e) => e.stopPropagation()}>
          {(t.status === 'ready' || t.status === 'queued') && (
            <button
              className="btn primary mini"
              data-testid="btn-start"
              title={tx('tbl.start')}
              onClick={() => api.start(t.id).catch((e) => toast(e.message, 'err'))}
            >
              <Play size={11} /> {tx('tbl.start')}
            </button>
          )}
          {t.status === 'paused' && (
            <button
              className="btn primary mini"
              data-testid="btn-resume"
              title={tx('task.resume')}
              onClick={() => api.resume(t.id).catch((e) => toast(e.message, 'err'))}
            >
              <Play size={11} /> {tx('task.resume')}
            </button>
          )}
          {t.status === 'awaiting_confirm' && (
            <button
              className="btn primary mini"
              data-testid="btn-quick-confirm"
              title={tx('tbl.confirm')}
              onClick={() => api.confirm(t.id).catch((e) => toast(e.message, 'err'))}
            >
              <Check size={11} /> {tx('tbl.confirm')}
            </button>
          )}
        </span>
      </div>
      {t.subagent && (
        <div className="kc-sub" title={t.subagent.label}>
          <Bot size={11} />
          <span className="kc-sub-label">{t.subagent.label}</span>
          <span className="sub-bar" />
        </div>
      )}
    </div>
  );
}

// P3 看板 · 行布局：
// - 一行一个任务（横向分割线），卡片落在它所属的阶段列，其余列留空
// - 行序 = 执行顺序（先优先级 P0 优先，再创建时间）；已完成的任务无论优先级都放最下面的行
// - P 级在行头（左列），不再占用卡片
export default function KanbanBoard({
  tasks,
  dataTestid = 'kanban',
  showDone = false,
  showProj = true,
}: {
  tasks: Task[];
  dataTestid?: string;
  /** 项目看板传 true：显示该项目已完成任务（首页隐藏已完成） */
  showDone?: boolean;
  /** 卡片上是否标注项目名（跨项目看板需要；单项目看板可关） */
  showProj?: boolean;
}) {
  const { t } = useI18n();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const visible = tasks.filter((x) => {
      if (x.status === 'failed' || x.status === 'cancelled') return false; // 终态失败/取消 → 历史页
      if (x.status === 'done' && !showDone) return false; // 首页隐藏已完成
      return true;
    });
    const active = visible
      .filter((x) => x.status !== 'done')
      .sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
    const done = visible
      .filter((x) => x.status === 'done')
      .sort((a, b) => (a.finished_at ?? a.created_at) - (b.finished_at ?? b.created_at));
    return [...active, ...done]; // 已完成恒定在底部
  }, [tasks, showDone]);

  const go = (x: Task) =>
    nav(`/p/${encodeURIComponent(baseName(x.workspace_path))}/tasks/${x.id}`);

  return (
    <div className="kb2" data-testid={dataTestid}>
      <div className="kb2-head">
        <span className="kb2-gutter" />
        {COLS.map((col) => {
          const n = rows.filter((x) => col.statuses.includes(x.status)).length;
          return (
            <div className="kb2-colh" key={col.key}>
              <span className="kb-dot" data-col={col.key} />
              {t(`phase.${col.key}`)}
              <span className="kb-count">{n}</span>
            </div>
          );
        })}
      </div>
      {rows.map((x) => {
        const ci = COLS.findIndex((c) => c.statuses.includes(x.status));
        return (
          <div className="kb2-row" key={x.id}>
            <span className={`kb2-pri p${x.priority}`}>P{x.priority}</span>
            {COLS.map((col, i) => (
              <div className="kb2-cell" key={col.key}>
                {ci === i && <KCard t={x} onNav={() => go(x)} showProj={showProj} />}
              </div>
            ))}
          </div>
        );
      })}
      {rows.length === 0 && <div className="kb-empty">{t('tbl.empty')}</div>}
    </div>
  );
}
