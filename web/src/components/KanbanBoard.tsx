import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Check, Loader2, Play } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import type { Task, TaskStatus } from '../lib/types';

// P3 四阶段看板列：等待 / 打磨 / 执行 / 验收
const COLS: { key: string; statuses: TaskStatus[] }[] = [
  { key: 'wait', statuses: ['ready', 'queued'] },
  { key: 'plan', statuses: ['planning', 'waiting_input'] },
  { key: 'exec', statuses: ['executing', 'blocked', 'interrupted'] },
  { key: 'test', statuses: ['testing', 'awaiting_confirm', 'done'] },
];

// 项目名 = 工作目录的最后一段（分组 key；卡片上不再显示完整路径）
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

function KCard({ t, onNav }: { t: Task; onNav: () => void }) {
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
        <span className="kc-title">{t.title}</span>
        <span className={`prio p${t.priority}`}>P{t.priority}</span>
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

export default function KanbanBoard({
  tasks,
  dataTestid = 'kanban',
}: {
  tasks: Task[];
  dataTestid?: string;
}) {
  const { t } = useI18n();
  const nav = useNavigate();

  const byProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const x of tasks) {
      if (x.status === 'failed' || x.status === 'cancelled') continue; // 终态失败/取消 → 历史页
      const key = baseName(x.workspace_path);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(x);
    }
    for (const list of m.values()) list.sort((a, b) => a.priority - b.priority || a.num - b.num);
    return m;
  }, [tasks]);

  const colTasks = (key: string) => {
    const col = COLS.find((c) => c.key === key)!;
    const out: { group: string; items: Task[] }[] = [];
    for (const [group, list] of byProject) {
      const items = list.filter((x) => col.statuses.includes(x.status));
      if (items.length) out.push({ group, items });
    }
    return out;
  };

  return (
    <div className="kb" data-testid={dataTestid}>
      {COLS.map((col) => {
        const groups = colTasks(col.key);
        const total = groups.reduce((n, g) => n + g.items.length, 0);
        return (
          <div className="kb-col" key={col.key}>
            <div className="kb-col-h">
              <span className="kb-dot" data-col={col.key} />
              {t(`phase.${col.key}`)}
              <span className="kb-count">{total}</span>
            </div>
            <div className="kb-col-b">
              {total === 0 && <div className="kb-empty">{t('tbl.empty')}</div>}
              {groups.map((g) => (
                <div className="kb-group" key={g.group}>
                  <div className="kb-group-h">{g.group}</div>
                  {g.items.map((x) => (
                    <KCard key={x.id} t={x} onNav={() => nav(`/boards/${x.board_id}/tasks/${x.id}`)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
