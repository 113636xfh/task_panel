import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SquareKanban, Wrench, Settings2, History as HistIcon, FolderKanban } from 'lucide-react';
import { onEvent, wsState } from '../lib/ws';
import { api } from '../lib/api';
import type { Project, Runtime } from '../lib/types';
import { useI18n } from '../i18n';
import CommandPalette from './CommandPalette';
import TopControls from './TopControls';

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
  const { t } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const [rt, setRt] = useState<Runtime | null>(null);
  const [online, setOnline] = useState(wsState.online);
  const [projects, setProjects] = useState<Project[]>([]);

  const loadProjects = () => api.projects().then(setProjects).catch(() => {});
  useEffect(() => {
    loadProjects();
    return onEvent((ev) => {
      if (ev.kind === 'boards.changed' || ev.kind === 'task.created' || ev.kind === 'task.status') loadProjects();
    });
  }, []);

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

        {/* 项目（看板与项目合并：每个项目 = 一张看板；列表区单独滚动，底部三项常驻） */}
        <div className="sb-section" data-testid="sb-projects">
          <div className="sb-sec-h">
            <FolderKanban size={12} /> {t('sb.projects')}
          </div>
          <div className="sb-list">
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
        {/* 任务详情页隐藏顶栏（控件并入详情第一行，4 行压 2 行） */}
        {!/^\/p\/.*\/tasks\//.test(loc.pathname) && (
          <header className="topbar">
            <span className="title">{t(titleKey)}</span>
            <span className="crumb">{loc.pathname}</span>
            <span className="spacer" />
            <TopControls />
          </header>
        )}
        <div className="content">
          <Outlet />
        </div>
      </div>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
