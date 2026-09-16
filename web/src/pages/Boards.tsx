import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { fmtDate } from '../lib/fmt';
import { toast } from '../lib/toast';
import type { Board } from '../lib/types';

export default function Boards() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const nav = useNavigate();

  const load = () => api.boards().then(setBoards).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.kind === 'boards.changed') load(); });
  }, []);

  async function submit() {
    const n = name.trim();
    if (!n) return;
    try {
      await api.createBoard(n);
      setName(''); setCreating(false);
      toast('看板已创建');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function del(b: Board) {
    if (!confirm(`删除看板「${b.name}」？（进行中的任务会阻止删除）`)) return;
    try {
      await api.deleteBoard(b.id);
      toast('已删除');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <>
      <div className="page-head">
        <h1>看板</h1>
        <span className="sub">{boards?.length ?? '…'} 个看板</span>
        <span style={{ flex: 1 }} />
        {creating ? (
          <>
            <input className="inp" style={{ width: 220 }} placeholder="看板名称，回车创建"
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <button className="btn primary" onClick={submit}>创建</button>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => setCreating(true)}>＋ 新看板</button>
        )}
      </div>

      {!boards ? (
        <div className="empty">加载中…</div>
      ) : boards.length === 0 ? (
        <div className="empty">还没有看板 —— 点右上角「新看板」开始。<br />P0 说明：执行器为 stub 模拟，用于联调 UI / 调度 / 事件流；P1 接入真实 pi 执行。</div>
      ) : (
        <div className="board-grid">
          {boards.map((b) => (
            <div key={b.id} className="board-card" onClick={() => nav(`/boards/${b.id}`)}>
              <button className="bc-del" title="删除看板" onClick={(e) => { e.stopPropagation(); del(b); }}>✕</button>
              <div className="bc-name">{b.name}</div>
              <div className="bc-stats">
                <span><b>{b.total}</b> 任务</span>
                <span><b>{b.active}</b> 进行中</span>
                <span><b>{b.done}</b> 完成</span>
                <span style={{ marginLeft: 'auto' }}>{fmtDate(b.created_at)}</span>
              </div>
              <div className="bc-last">{b.last ? `最近：${b.last.title}` : '还没有任务'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
