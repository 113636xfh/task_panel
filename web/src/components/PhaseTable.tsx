import { Fragment, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Check } from 'lucide-react';
import { api } from '../lib/api';
import { shortPath, fmtTime, fmtDur } from '../lib/fmt';
import { useI18n } from '../i18n';
import type { Task, TaskStatus } from '../lib/types';

// P3 四阶段：等待 / 打磨 / 执行 / 验收（done = 全过；failed/cancelled = 终态）
export const PHASES = ['wait', 'plan', 'exec', 'test'] as const;
export type Phase = (typeof PHASES)[number];

// 项目名 = 工作目录的最后一段（跨项目分组的 key）
const baseName = (p: string) => (p || '').split(/[\/]/).filter(Boolean).pop() || '—';

const PHASE_OF: Record<TaskStatus, 0 | 1 | 2 | 3 | 4 | null> = {
  ready: 0,
  queued: 0,
  planning: 1,
  waiting_input: 1,
  executing: 2,
  blocked: 2,
  interrupted: 2,
  testing: 3,
  awaiting_confirm: 3,
  done: 4,
  failed: null,
  cancelled: null,
};

/** 一行进度：执行阶段优先取 plan.json（done/total · 当前步骤），其余用 current_action */
export function progressLine(t: Task): string {
  if ((t.status === 'executing' || t.status === 'planning') && t.plan?.steps?.length) {
    const done = t.plan.steps.filter((s) => s.done).length;
    const cur = t.plan.steps.find((s) => !s.done)?.title;
    return `${done}/${t.plan.steps.length} · ${cur ?? ''}`.trim();
  }
  return t.current_action || '';
}

export default function PhaseTable({
  tasks,
  showBoard = false,
  dataTestid = 'ptable',
}: {
  tasks: Task[];
  /** 跨项目视图：组头显示看板名 */
  showBoard?: boolean;
  dataTestid?: string;
}) {
  const { t } = useI18n();
  const nav = useNavigate();

  // 按项目（工作目录名）分组；组内按 优先级 + 创建时间
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const x of tasks) {
      const key = baseName(x.workspace_path);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(x);
    }
    for (const list of m.values()) list.sort((a, b) => a.priority - b.priority || a.num - b.num);
    return [...m.entries()].map(([name, list]) => ({ name, list }));
  }, [tasks]);

  function open(tsk: Task) {
    nav(`/boards/${tsk.board_id}/tasks/${tsk.id}`);
  }

  async function quick(tsk: Task, kind: 'start' | 'confirm') {
    try {
      if (kind === 'start') await api.start(tsk.id);
      else await api.confirm(tsk.id);
    } catch (e: any) {
      // 静默（列表会自动刷新）
    }
  }

  // 单元格内容：i < idx 已完成（灰勾）；i === idx 当前状态 pill；i > idx 未来（灰点）
  function cell(tsk: Task, i: number) {
    const idx = PHASE_OF[tsk.status];
    if (idx === null) {
      // 终态：第一格放状态 chip，其余格 —
      if (i === 0) {
        return <span className={`pill s-${tsk.status}`}>{t(`status.${tsk.status}`)}</span>;
      }
      return <span className="cell-future">—</span>;
    }
    if (tsk.status === 'done') {
      return (
        <span className="cell-done" title={t('status.done')}>
          <Check size={13} />
        </span>
      );
    }
    if (i < idx) {
      return (
        <span className="cell-done" title={t(`phase.${PHASES[i]}`)}>
          <Check size={13} />
        </span>
      );
    }
    if (i > idx) return <span className="cell-future">·</span>;
    // 当前阶段
    const line = progressLine(tsk);
    const qn = tsk.status === 'waiting_input' ? (tsk.plan?.branch_questions?.length ?? 0) : 0;
    return (
      <>
        <span className={`pill s-${tsk.status}`}>
          {t(`status.${tsk.status}`)}
          {tsk.status === 'waiting_input' && qn > 0 && ` · ${qn}`}
          {tsk.status === 'ready' && (
            <button
              className="btn ghost mini"
              data-testid="btn-start"
              onClick={(e) => {
                e.stopPropagation();
                quick(tsk, 'start');
              }}
            >
              {t('tbl.start')}
            </button>
          )}
          {tsk.status === 'awaiting_confirm' && (
            <button
              className="btn primary mini"
              data-testid="btn-confirm"
              onClick={(e) => {
                e.stopPropagation();
                quick(tsk, 'confirm');
              }}
            >
              {t('tbl.confirm')}
            </button>
          )}
        </span>
        {line && <span className="line" title={line}>{line}</span>}
      </>
    );
  }

  if (tasks.length === 0) {
    return <div className="empty" data-testid={dataTestid}>{t('tbl.empty')}</div>;
  }

  return (
    <div className="ptable" data-testid={dataTestid}>
      <div className="pthead">
        <span className="ph ph-t" />
        {PHASES.map((p) => (
          <span key={p} className="ph">
            {t(`phase.${p}`)}
          </span>
        ))}
      </div>
      {groups.map((g) => (
        <div className="pgroup" key={g.name}>
          <div className="pgroup-h">
            {g.name}
            <span className="cnt">
              {g.list.length} {t('boards.card.tasks')}
              {showBoard && g.list[0].board_name ? ` · ${g.list[0].board_name}` : ''}
            </span>
          </div>
          {g.list.map((x) => (
            <Fragment key={x.id}>
              <div
                className={`prow st-${x.status}`}
                data-testid="task-row"
                data-status={x.status}
                data-num={x.num}
                onClick={() => open(x)}
              >
                <span className="ph ph-t">
                  <span className="tc-num">#{x.num}</span>
                  <span className={`prio p${x.priority}`}>P{x.priority}</span>
                  <b className="t-title" title={x.title}>
                    {x.title}
                  </b>
                  <span className="t-meta">
                    {showBoard && x.board_name ? x.board_name : shortPath(x.workspace_path)}
                    {' · '}
                    {['planning', 'executing', 'testing', 'waiting_input', 'blocked'].includes(x.status) && x.started_at
                      ? fmtDur(Date.now() - x.started_at)
                      : fmtTime(x.created_at)}
                  </span>
                </span>
                {PHASES.map((_, i) => (
                  <span className="ph" key={i}>
                    {cell(x, i)}
                  </span>
                ))}
              </div>
              {x.subagent && x.status === 'executing' && (
                <div className="prow sub" data-testid="subagent-row" onClick={() => open(x)}>
                  <span className="ph ph-t">
                    <span className="sub-ico">
                      <Bot size={12} />
                    </span>
                    sub agent · {x.subagent.label}
                  </span>
                  <span className="ph" />
                  <span className="ph" />
                  <span className="ph">
                    <span className="sub-bar">
                      <i />
                    </span>
                  </span>
                  <span className="ph" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
