import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SquareKanban, Wrench, Settings2, Moon, Sun, Globe } from 'lucide-react';
import { onEvent, wsState } from '../lib/ws';
import { api } from '../lib/api';
import type { Runtime } from '../lib/types';
import { useI18n } from '../i18n';

const TITLES: [RegExp, string][] = [
  [/^\/boards\/.+\/tasks/, 'crumb.task'],
  [/^\/boards\/.+/, 'nav.boards'],
  [/^\/skills/, 'nav.skills'],
  [/^\/settings/, 'nav.settings'],
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
  const [rt, setRt] = useState<Runtime | null>(null);
  const [online, setOnline] = useState(wsState.online);
  const [theme, setTheme] = useState(localStorage.getItem('tp-theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tp-theme', theme);
  }, [theme]);

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
          <span className="ver-tag">P1 · {t('topbar.executor')}</span>
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
      <Toasts />
    </div>
  );
}
