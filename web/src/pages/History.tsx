import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtDate } from '../lib/fmt';
import { useI18n } from '../i18n';
import { shortPath } from '../lib/fmt';
import type { Task, TaskStatus } from '../lib/types';

const PAST: TaskStatus[] = ['done', 'failed', 'cancelled'];

export default function History() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');

  const load = () => api.tasksAll().then(setTasks).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => {
      if (['task.status', 'task.created', 'task.deleted'].includes(ev.kind)) load();
    });
  }, []);

  const past = useMemo(() => {
    if (!tasks) return [];
    return tasks
      .filter((x) => PAST.includes(x.status))
      .filter((x) => filter === 'all' || x.status === filter)
      .sort((a, b) => (b.finished_at ?? b.created_at) - (a.finished_at ?? a.created_at));
  }, [tasks, filter]);

  // 按项目分组
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const x of past) {
      const key = (x.workspace_path || '').split(/[\/]/).filter(Boolean).pop() || '—';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(x);
    }
    return [...m.entries()];
  }, [past]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: past.length, done: 0, failed: 0, cancelled: 0 };
    for (const x of past) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [past]);

  const FILTERS: (TaskStatus | 'all')[] = ['all', 'done', 'failed', 'cancelled'];

  return (
    <>
      <div className="page-head">
        <h1>{t('hist.title')}</h1>
        <span className="sub">{past.length} {t('boards.card.tasks')}</span>
      </div>

      <div className="hist-filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`btn ${filter === f ? 'primary' : 'ghost'} mini`}
            data-testid={`hist-filter-${f}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('hist.all') : t(`status.${f}`)}
            <span style={{ opacity: 0.7 }}>· {counts[f] ?? 0}</span>
          </button>
        ))}
      </div>

      {!tasks ? (
        <div className="empty">{t('loading')}…</div>
      ) : past.length === 0 ? (
        <div className="empty">{t('hist.empty')}</div>
      ) : (
        <div className="ptable" data-testid="hist-table">
          <div className="pthead" style={{ gridTemplateColumns: '44px minmax(200px,1fr) 180px 130px 110px' }}>
            <span className="ph" />
            <span className="ph">{t('hist.col.title')}</span>
            <span className="ph">{t('hist.col.project')}</span>
            <span className="ph">{t('hist.col.status')}</span>
            <span className="ph">{t('hist.col.time')}</span>
          </div>
          {groups.map(([g, list]) => (
            <div className="pgroup" key={g}>
              <div className="pgroup-h">
                {g}
                <span className="cnt">
                  {list.length} {t('boards.card.tasks')}
                </span>
              </div>
              {list.map((x) => (
                <div
                  key={x.id}
                  className="hrow"
                  data-testid="hist-row"
                  data-status={x.status}
                  onClick={() => nav(`/boards/${x.board_id}/tasks/${x.id}`)}
                >
                  <span className="tc-num">#{x.num}</span>
                  <span className="t2" title={x.title}>
                    {x.title}
                  </span>
                  <span className="t2">{shortPath(x.workspace_path)}</span>
                  <span>
                    <span className={`pill s-${x.status}`}>{t(`status.${x.status}`)}</span>
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>{x.finished_at ? fmtDate(x.finished_at) : '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
