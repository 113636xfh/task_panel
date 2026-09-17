import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SquareKanban, Wrench, Settings2, Moon, Sun, Globe, Type, History as HistIcon, FolderKanban } from 'lucide-react';
import { onEvent, wsState } from '../lib/ws';
import { api } from '../lib/api';
import type { Project, Runtime } from '../lib/types';
import { useI18n } from '../i18n';
import CommandPalette from './CommandPalette';

const TITLES: [RegExp, string][] = [
  [/^\/p\/[^/]+\/tasks/, 'crumb.task'],
  [/^\/p\//, 'crumb.project'],
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
  const [projects, setProjects] = useState<Project[]>([]);

  const loadProjects = () => api.projects().then(setProjects).catch(() => {});
  useEffect(() => {
    loadProjects();
    return onEvent((ev) => {
      if (ev.kind === 'boards.changed' || ev.kind === 'task.created' || ev.kind === 'task.status') loadProjects();
    });
  }, []);

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
          className={({ isActive }) => `nav-item ${isActive && loc.pathname === '/boards' ? 'active' : ''}`}
        >
          <span className="ico">
            <SquareKanban size={15} />
          </span>{' '}
          {t('nav.boards')}
        </NavLink>

        {/* 项目（看板与项目合并：每个项目 = 一张看板） */}
        <div className="sb-section" data-testid="sb-projects">
          <div className="sb-sec-h">
            <FolderKanban size={12} /> {t('sb.projects')}
          </div>
          {projects.map((p) => (
            <div
              key={p.name}
              className={`sb-item ${loc.pathname === `/p/${encodeURIComponent(p.name)}` ? 'active' : ''}`}
              data-testid={`sb-project-${p.name.toLowerCase()}`}
              onClick={() => nav(`/p/${encodeURIComponent(p.name)}`)}
            >
              <span className="t2">{p.name}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{p.tasks}</span>
              {p.active > 0 && <span style={{ color: 'var(--st-executing)', fontSize: 11 }} title={t('sb.active')}>●</span>}
            </div>
          ))}
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
            <span style={{ color: (rt?.paused ?? 0) > 0 ? 'var(--st-waiting)' : undefined }}>
              {t('runtime.paused')} <b>{rt?.paused ?? 0}</b>
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
          <span className="ver-tag">P3 · {t('topbar.executor')}</span>
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
