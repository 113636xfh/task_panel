import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { useI18n } from '../i18n';
import KanbanBoard from '../components/KanbanBoard';
import NewTaskModal from '../components/NewTaskModal';
import type { Task } from '../lib/types';

// 首页 = 所有项目全部任务的大看板（四阶段列，按项目分组）
export default function Boards() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [sp, setSp] = useSearchParams();

  const load = () => api.tasksAll().then(setTasks).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => {
      if (['task.status', 'task.created', 'boards.changed', 'task.event', 'task.deleted'].includes(ev.kind)) load();
    });
  }, []);
  // 命令面板 ?new=1：自动展开新建任务弹窗
  useEffect(() => {
    if (sp.get('new') === '1') {
      setShowNew(true);
      const p = new URLSearchParams(sp);
      p.delete('new');
      setSp(p, { replace: true });
    }
  }, [sp, setSp]);

  return (
    <>
      <div className="page-head">
        <h1>{t('boards.title')}</h1>
        <span className="sub">
          {tasks ? `${tasks.filter((x) => x.status !== 'done').length} ${t('boards.card.tasks')}` : '…'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" data-testid="btn-new-task" onClick={() => setShowNew(true)}>
          <Plus size={14} /> {t('board.newTask')}
        </button>
      </div>

      {!tasks ? (
        <div className="empty">{t('loading')}…</div>
      ) : tasks.length === 0 ? (
        <div className="empty">
          {t('tbl.empty')}
          <br />
          {t('boards.note')}
        </div>
      ) : (
        <KanbanBoard tasks={tasks} dataTestid="kanban-home" />
      )}

      {showNew && <NewTaskModal onClose={() => setShowNew(false)} onCreated={load} />}
    </>
  );
}
