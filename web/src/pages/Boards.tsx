import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtDate } from '../lib/fmt';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import type { Board } from '../lib/types';

export default function Boards() {
  const { t } = useI18n();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();

  const load = () => api.boards().then(setBoards).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => {
      if (ev.kind === 'boards.changed') load();
    });
  }, []);
  // 命令面板 ?new=1：自动展开新建行
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

  async function del(b: Board) {
    if (!confirm(t('boards.delConfirm', { name: b.name }))) return;
    try {
      await api.deleteBoard(b.id);
      toast(t('boards.deleted'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t('boards.title')}</h1>
        <span className="sub">
          {boards ? t('boards.count', { n: boards.length, s: boards.length === 1 ? '' : 's' }) : '…'}
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
          <button className="btn primary" data-testid="btn-new-board" onClick={() => setCreating(true)}>
            <Plus size={14} /> {t('boards.newBtn')}
          </button>
        )}
      </div>

      {!boards ? (
        <div className="empty">{t('loading')}…</div>
      ) : boards.length === 0 ? (
        <div className="empty">
          {t('boards.empty')}
          <br />
          {t('boards.note')}
        </div>
      ) : (
        <div className="board-grid">
          {boards.map((b) => (
            <div key={b.id} className="board-card" data-testid="board-card" onClick={() => nav(`/boards/${b.id}`)}>
              <button
                className="bc-del"
                title={t('boards.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  del(b);
                }}
              >
                <X size={13} />
              </button>
              <div className="bc-name">{b.name}</div>
              <div className="bc-stats">
                <span>
                  <b>{b.total}</b> {t('boards.card.tasks')}
                </span>
                <span>
                  <b>{b.active}</b> {t('boards.card.running')}
                </span>
                <span>
                  <b>{b.done}</b> {t('boards.card.done')}
                </span>
                <span style={{ marginLeft: 'auto' }}>{fmtDate(b.created_at)}</span>
              </div>
              <div className="bc-last">{b.last ? t('boards.last', { title: b.last.title }) : t('boards.last.none')}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
