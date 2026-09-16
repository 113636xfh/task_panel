import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { onEvent, wsState } from '../lib/ws';
import { api } from '../lib/api';
import type { Runtime } from '../lib/types';

const TITLES: [RegExp, string][] = [
  [/^\/boards\/.+\/tasks/, '任务'],
  [/^\/boards\/.+/, '看板'],
  [/^\/skills/, '技能'],
  [/^\/settings/, '设置'],
  [/^\/boards/, '看板'],
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
      {items.map((i) => <div key={i.id} className={`toast ${i.kind === 'err' ? 'err' : ''}`}>{i.msg}</div>)}
    </div>
  );
}

export default function Layout() {
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
    return () => { off(); clearInterval(iv); };
  }, []);

  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'Task Panel';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="logo">▚</span> Task Panel</div>
        <NavLink to="/boards" className={({ isActive }) => `nav-item ${isActive && !loc.pathname.includes('/boards/') ? 'active' : ''}`}>
          <span className="ico">▦</span> 看板
        </NavLink>
        <NavLink to="/skills" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico">⛏</span> 技能
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico">⚙</span> 设置
        </NavLink>

        <div className="runtime-card">
          <div className="rc-title"><span>RUNTIME</span><span className={`ws-dot ${online ? '' : 'off'}`} title={online ? '事件流已连接' : '事件流断开重连中'} /></div>
          <div className="slots">
            {Array.from({ length: rt?.total ?? 2 }).map((_, i) => (
              <span key={i} className={`slot ${i < (rt?.used ?? 0) ? 'on' : ''}`} />
            ))}
          </div>
          <div className="rc-line">
            <span><b>{rt?.used ?? 0}/{rt?.total ?? 2}</b> 执行</span>
            <span>排队 <b>{rt?.queue ?? 0}</b></span>
            <span>待答 <b>{rt?.waiting ?? 0}</b></span>
            <span style={{ color: (rt?.blocked ?? 0) > 0 ? 'var(--st-blocked)' : undefined }}>阻塞 <b>{rt?.blocked ?? 0}</b></span>
            <span>待确认 <b>{rt?.awaiting ?? 0}</b></span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="title">{title}</span>
          <span className="crumb">{loc.pathname}</span>
          <span className="spacer" />
          <span className="ver-tag">P0 · stub 执行器</span>
          <button
            className="btn ghost sm"
            title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '🌙'}
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
