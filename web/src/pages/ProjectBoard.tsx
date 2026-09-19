import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { useI18n } from '../i18n';
import KanbanBoard from '../components/KanbanBoard';
import NewTaskModal from '../components/NewTaskModal';
import type { Task } from '../lib/types';

const baseName = (p: string) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '—';

// 项目看板页：/p/:name —— 只展示该项目（工作目录末段同名）下的任务
export default function ProjectBoard() {
  const { name = '' } = useParams();
  const proj = decodeURIComponent(name);
  const nav = useNavigate();
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [all, setAll] = useState<Task[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [sp, setSp] = useSearchParams();

  // 命令面板 ?new=1：自动展开新建任务弹窗
  useEffect(() => {
    if (sp.get('new') === '1') {
      setShowNew(true);
      const p = new URLSearchParams(sp);
      p.delete('new');
      setSp(p, { replace: true });
    }
  }, [sp, setSp]);

  const loadTasks = () => {
    api
      .tasksAll()
      .then((rows: Task[]) => {
        setAll(rows);
        setTasks(rows.filter((x) => baseName(x.workspace_path) === proj));
      })
      .catch(() => {});
  };
  useEffect(() => {
    loadTasks();
    const off = onEvent((ev) => {
      if (['task.status', 'task.created', 'task.event'].includes(ev.kind)) loadTasks();
    });
    return off;
  }, [proj]);

  // 新建任务：预填该项目已有的工作目录（共用模式）
  const defaultWs = all?.find((x) => baseName(x.workspace_path) === proj)?.workspace_path;

  return (
    <>
      <div className="page-head">
        <button className="btn ghost" onClick={() => nav('/boards')}>
          <ArrowLeft size={14} /> {t('board.back')}
        </button>
        <h1>{proj}</h1>
        <span className="sub">
          {tasks.length} {t('boards.card.tasks')}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" data-testid="btn-new-task" onClick={() => setShowNew(true)}>
          <Plus size={14} /> {t('board.newTask')}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">{t('tbl.empty')}</div>
      ) : (
        <KanbanBoard tasks={tasks} dataTestid="kanban-board" showDone showProj={false} />
      )}

      {showNew && <NewTaskModal defaultWs={defaultWs} onClose={() => setShowNew(false)} onCreated={loadTasks} />}
    </>
  );
}
