import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import KanbanBoard from '../components/KanbanBoard';
import type { Task } from '../lib/types';

// P3：首页 = 四阶段看板（跨项目；小方框卡片，按项目分组，无文件路径）
export default function Boards() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [sp, setSp] = useSearchParams();

  const load = () => api.tasksAll().then(setTasks).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => {
      if (['task.status', 'task.created', 'boards.changed', 'task.event', 'task.deleted'].includes(ev.kind)) load();
    });
  }, []);
  // 命令面板 ?new=1：自动展开新建看板行
  useEffect(() => {
    if (sp.get('new') === '1') {
      setCreating(true);
      const p = new URLSearchParams(sp);
      p.delete('new');
      setSp(p, { replace: true });
    }
  }, [sp, setSp]);

  async function submit() {
    const n = name.trim();
    if (!n) return;
    try {
      await api.createBoard(n);
      setName('');
      setCreating(false);
      toast(t('boards.created'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t('boards.title')}</h1>
        <span className="sub">
          {tasks ? `${tasks.filter((x) => x.status !== 'failed' && x.status !== 'cancelled').length} ${t('boards.card.tasks')}` : '…'}
        </span>
        <span style={{ flex: 1 }} />
        {creating ? (
          <>
            <input
              className="inp"
              data-testid="input-board-name"
              style={{ width: 220 }}
              placeholder={t('boards.newPh')}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="btn primary" data-testid="btn-create-board" onClick={submit}>
              {t('boards.create')}
            </button>
            <button className="btn ghost" onClick={() => setCreating(false)}>
              {t('boards.cancel')}
            </button>
          </>
        ) : (
          <button className="btn ghost" data-testid="btn-new-board" onClick={() => setCreating(true)}>
            <Plus size={13} /> {t('boards.newBtn')}
          </button>
        )}
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
    </>
  );
}
