import { useEffect, useMemo, useState } from 'react';
import { X, History, Search, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import { fmtDate, fmtDur } from '../lib/fmt';

type Sess = {
  file: string; id: string; cwd: string; startTs: number; endTs: number;
  messages: number; size: number; title: string; model: string; self: boolean;
};

const baseName = (p: string) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '—';

// 导入历史会话：扫描 pi 会话目录 → 勾选 → 作为「已完成」任务导入当前看板
export default function ImportSessionsModal({
  boardId, boardName, onClose, onImported,
}: {
  boardId: string;
  boardName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Sess[] | null>(null);
  const [q, setQ] = useState('');
  const [includeSelf, setIncludeSelf] = useState(false); // 默认隐藏 Task Panel 自身会话
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');

  // 搜索/开关变化 → 重新拉列表（防抖）
  useEffect(() => {
    let dead = false;
    const timer = setTimeout(() => {
      api
        .listSessions({ includeSelf, q: q.trim() })
        .then((rows) => !dead && setItems(rows as Sess[]))
        .catch((e) => !dead && setErr(String(e)));
    }, 250);
    return () => { dead = true; clearTimeout(timer); };
  }, [q, includeSelf]);

  // Esc 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [busy, onClose]);

  // 按项目（cwd 末段）分组，组内新→旧（items 已按 endTs 降序）
  const groups = useMemo(() => {
    const m = new Map<string, Sess[]>();
    for (const s of items ?? []) {
      const k = baseName(s.cwd);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()];
  }, [items]);

  const toggle = (file: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(file)) n.delete(file);
      else n.add(file);
      return n;
    });

  async function doImport() {
    if (busy || !sel.size) return;
    setBusy(true);
    setErr('');
    const files = [...sel];
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`${i + 1}/${files.length}`);
      try {
        await api.importSession({ file: files[i], boardId });
        ok++;
      } catch (e) {
        fails.push(`${baseName(files[i])}: ${String(e)}`);
      }
    }
    setBusy(false);
    if (ok) toast(t('imp.done', { n: ok }));
    if (fails.length) toast(`${t('imp.fail')}${fails[0]}`, 'err');
    onImported();
    onClose();
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal branch-modal">
        <div className="m-h">
          <History size={15} /> {t('imp.title')}
          <button className="m-x" onClick={onClose} disabled={busy}><X size={15} /></button>
        </div>
        <div className="m-b" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '62vh' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 8, opacity: 0.5 }} />
              <input
                className="inp"
                style={{ width: '100%', paddingLeft: 27 }}
                placeholder={t('imp.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />
              {t('imp.includeSelf')}
            </label>
          </div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{t('imp.hint')}</div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 120 }}>
            {items === null && (
              <div style={{ padding: '18px 0', textAlign: 'center', opacity: 0.6, fontSize: 12 }}>
                {busy ? progress : t('imp.loading')}
              </div>
            )}
            {items !== null && items.length === 0 && <div style={{ padding: '18px 0', textAlign: 'center', opacity: 0.6, fontSize: 12 }}>{t('imp.empty')}</div>}
            {groups.map(([proj, rows]) => (
              <div key={proj}>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.55, padding: '7px 6px 3px', display: 'flex', gap: 6 }}>
                  {proj} <span style={{ fontWeight: 400 }}>· {rows.length}</span>
                </div>
                {rows.map((s) => (
                  <label
                    key={s.file}
                    style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 7, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <input type="checkbox" style={{ marginTop: 3 }} checked={sel.has(s.file)} onChange={() => toggle(s.file)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title || s.id}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span>{fmtDate(s.startTs)}</span>
                        <span>{fmtDur(s.endTs - s.startTs)}</span>
                        <span>{s.messages} {t('imp.messages')}</span>
                        {s.model && <span>{s.model}</span>}
                        <span>{s.size >= 1048576 ? `${(s.size / 1048576).toFixed(1)} MB` : `${(s.size / 1024).toFixed(1)} KB`}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {err && <div style={{ fontSize: 12, opacity: 0.8 }}>{err}</div>}
        </div>
        <div className="m-f">
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: 'auto' }}>
            {sel.size ? t('imp.selected', { n: sel.size }) : ''} {busy && progress}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>{t('imp.cancel')}</button>
          <button className="btn primary" onClick={doImport} disabled={!sel.size || busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <History size={14} />}
            {busy ? t('imp.importing') : t('imp.import', { board: boardName })}
          </button>
        </div>
      </div>
    </div>
  );
}
