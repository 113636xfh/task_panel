import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SquareKanban, Wrench, Settings2, Moon, Sun, Globe, Type, History as HistIcon, Plus, X, FolderKanban } from 'lucide-react';
import { onEvent, wsState } from '../lib/ws';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { Board, Runtime } from '../lib/types';
import { useI18n } from '../i18n';
import CommandPalette from './CommandPalette';

const TITLES: [RegExp, string][] = [
  [/^\/boards\/.+\/tasks/, 'crumb.task'],
  [/^\/boards\/.+/, 'nav.boards'],
  [/^\/skills/, 'nav.skills'],
  [/^\/settings/, 'nav.settings'],
  [/^\/history/, 'nav.history'],
  [/^\/boards/, 'nav.boards'],
];

function Toasts() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, ...d }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200);
    };
    window.addEventListener('tp-toast', h);
    return () => window.removeEventListener('tp-toast', h);
  }, []);
  return (
    <div className="toasts">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.kind === 'err' ? 'err' : ''}`}>
          {i.msg}
        </div>
      ))}
    </div>
  );
}

export default function Layout() {
  const { locale, setLocale, t } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const [rt, setRt] = useState<Runtime | null>(null);
  const [online, setOnline] = useState(wsState.online);
  const [theme, setTheme] = useState(localStorage.getItem('tp-theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const [boards, setBoards] = useState<Board[]>([]);
  const [newBoard, setNewBoard] = useState('');
  const [showSbBoard, setShowSbBoard] = useState(false);

  const loadBoards = () => api.boards().then(setBoards).catch(() => {});
  useEffect(() => {
    loadBoards();
    return onEvent((ev) => {
      if (ev.kind === 'boards.changed') loadBoards();
    });
  }, []);

  async function createBoard() {
    const n = newBoard.trim();
    if (!n) return;
    try {
      await api.createBoard(n);
      setNewBoard('');
      setShowSbBoard(false);
      toast(t('boards.created'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  async function deleteBoard(b: Board) {
    if (!confirm(t('boards.delConfirm', { name: b.name }))) return;
    try {
      await api.deleteBoard(b.id);
      toast(t('boards.deleted'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tp-theme', theme);
  }, [theme]);

  // 设置页切换主题时同步顶栏按钮（避免两处状态漂移）
  useEffect(() => {
    const h = () => setTheme(localStorage.getItem('tp-theme') ?? 'dark');
    window.addEventListener('tp-theme-apply', h);
    return () => window.removeEventListener('tp-theme-apply', h);
  }, []);

  // P3：字体大小（S/M/L，循环切换；#root zoom 整体缩放）
  const [fs, setFs] = useState(localStorage.getItem('tp-fs') ?? 'm');
  useEffect(() => {
    document.documentElement.dataset.fs = fs;
    localStorage.setItem('tp-fs', fs);
  }, [fs]);

  useEffect(() => {
    const off = onEvent((ev) => {
      if (ev.kind === 'runtime.slots') setRt(ev.payload as Runtime);
      setOnline(wsState.online);
    });
    const iv = setInterval(() => setOnline(wsState.online), 2000);
    api.runtime().then(setRt).catch(() => {});
    return () => {
      off();
      clearInterval(iv);
    };
  }, []);

  const titleKey = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'app.name';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">
            <SquareKanban size={14} strokeWidth={2.4} />
          </span>{' '}
          {t('app.name')}
        </div>
        <NavLink
          to="/boards"
          className={({ isActive }) => `nav-item ${isActive && !loc.pathname.includes('/boards/') ? 'active' : ''}`}
        >
          <span className="ico">
            <SquareKanban size={15} />
          </span>{' '}
          {t('nav.boards')}
        </NavLink>

        {/* P3：看板列表（侧栏） */}
        <div className="sb-section" data-testid="sb-boards">
          <div className="sb-sec-h">
            <FolderKanban size={12} /> {t('sb.boards')}
            <button
              className="btn ghost mini"
              data-testid="btn-sb-newboard"
              onClick={() => {
                setNewBoard('');
                setShowSbBoard(true);
                setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid=input-sb-board]')?.focus());
              }}
            >
              <Plus size={12} />
            </button>
          </div>
          {boards.map((b) => (
            <div
              key={b.id}
              className={`sb-item ${loc.pathname === `/boards/${b.id}` ? 'active' : ''}`}
              data-testid={`sb-board-${b.id.slice(2)}`}
              onClick={() => nav(`/boards/${b.id}`)}
            >
              <span className="t2">{b.name}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{b.total}</span>
              <button
                className="x"
                title={t('boards.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBoard(b);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {showSbBoard && (
            <div className="sb-new">
              <input
                className="inp"
                data-testid="input-sb-board"
                placeholder={t('boards.newPh')}
                autoFocus
                value={newBoard}
                onChange={(e) => setNewBoard(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createBoard();
                  if (e.key === 'Escape') setShowSbBoard(false);
                }}
              />
              <button className="btn primary mini" data-testid="btn-sb-createboard" onClick={createBoard}>
                {t('boards.create')}
              </button>
            </div>
          )}
        </div>

        <NavLink to="/history" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico">
            <HistIcon size={15} />
          </span>{' '}
          {t('nav.history')}
        </NavLink>
        <NavLink to="/skills" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico">
            <Wrench size={15} />
          </span>{' '}
          {t('nav.skills')}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico">
            <Settings2 size={15} />
          </span>{' '}
          {t('nav.settings')}
        </NavLink>

        <div className="runtime-card">
          <div className="rc-title">
            <span>RUNTIME</span>
            <span className={`ws-dot ${online ? '' : 'off'}`} title={online ? t('ws.on') : t('ws.off')} />
          </div>
          <div className="slots">
            {Array.from({ length: rt?.total ?? 2 }).map((_, i) => (
              <span key={i} className={`slot ${i < (rt?.used ?? 0) ? 'on' : ''}`} />
            ))}
          </div>
          <div className="rc-line">
            <span>
              <b>
                {rt?.used ?? 0}/{rt?.total ?? 2}
              </b>{' '}
              {t('runtime.exec')}
            </span>
            <span>
              {t('runtime.queued')} <b>{rt?.queue ?? 0}</b>
            </span>
            <span>
              {t('runtime.waiting')} <b>{rt?.waiting ?? 0}</b>
            </span>
            <span style={{ color: (rt?.blocked ?? 0) > 0 ? 'var(--st-blocked)' : undefined }}>
              {t('runtime.blocked')} <b>{rt?.blocked ?? 0}</b>
            </span>
            <span>
              {t('runtime.awaiting')} <b>{rt?.awaiting ?? 0}</b>
            </span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="title">{t(titleKey)}</span>
          <span className="crumb">{loc.pathname}</span>
          <span className="spacer" />
          <span className="ver-tag">P2 · {t('topbar.executor')}</span>
          <button
            className="btn ghost sm"
            data-testid="btn-lang"
            title="English / 简体中文"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            <Globe size={13} />
            <span className="lang-label">{locale === 'zh' ? 'EN' : '中文'}</span>
          </button>
          <button
            className="btn ghost sm"
            data-testid="btn-fontsize"
            title={t('topbar.fontsize')}
            onClick={() => setFs(fs === 'm' ? 'l' : fs === 'l' ? 's' : 'm')}
          >
            <Type size={13} />
            <span className="lang-label">{fs.toUpperCase()}</span>
          </button>
          <button
            className="btn ghost sm"
            data-testid="btn-theme"
            title={theme === 'dark' ? 'Switch to light' : '切换到暗色'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
