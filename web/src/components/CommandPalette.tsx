import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SquareKanban, FileText, Wrench, Settings2, Moon, Sun, Globe, List, Search,
} from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';

/**
 * ⌘K / Ctrl+K 命令面板（Linear 风格）：
 * 搜看板、搜任务（#num 或标题）、页面导航、新建看板/任务、切主题/语言。
 * 全局挂载在 Layout；Esc 关闭，↑↓ 选择，↵ 执行。
 */
type Item = {
  id: string;
  group: 'actions' | 'projects' | 'tasks';
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
  keywords: string;
};

export default function CommandPalette() {
  const { t, locale, setLocale } = useI18n();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme ?? 'dark');

  const on = (b: boolean) => {
    setOpen(b);
    if (b) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  // 全局快捷键：Ctrl/Cmd+K 开/关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!openRef.current) {
          setQ('');
          setActive(0);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时：聚焦输入框 + 全局 Esc 关闭（焦点不在输入框时也能关）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 打开时拉数据（本地数据量小，全量拉取足够快）
  useEffect(() => {
    if (!open) return;
    api.projects().then(setProjects).catch(() => {});
    api.tasksAll().then(setTasks).catch(() => {});
  }, [open]);

  const go = (path: string) => {
    on(false);
    nav(path);
  };

  const baseName = (p: string) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '—';

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'a-boards', group: 'actions', label: t('cmdk.act.goBoards'), icon: <List size={14} />, run: () => go('/boards'), keywords: 'boards list ' + t('cmdk.act.goBoards').toLowerCase() },
      { id: 'a-newtask', group: 'actions', label: t('cmdk.act.newTask'), icon: <FileText size={14} />, run: () => go('/boards?new=1'), keywords: 'new task ' + t('cmdk.act.newTask').toLowerCase() },
      { id: 'a-skills', group: 'actions', label: t('cmdk.act.skills'), icon: <Wrench size={14} />, run: () => go('/skills'), keywords: 'skills ' + t('cmdk.act.skills').toLowerCase() },
      { id: 'a-settings', group: 'actions', label: t('cmdk.act.settings'), icon: <Settings2 size={14} />, run: () => go('/settings'), keywords: 'settings ' + t('cmdk.act.settings').toLowerCase() },
      {
        id: 'a-theme', group: 'actions', label: t('cmdk.act.theme'),
        icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
        run: () => {
          const next = theme === 'dark' ? 'light' : 'dark';
          document.documentElement.dataset.theme = next;
          localStorage.setItem('tp-theme', next);
          setThemeState(next);
        },
        keywords: 'theme dark light ' + t('cmdk.act.theme').toLowerCase(),
      },
      {
        id: 'a-lang', group: 'actions', label: t('cmdk.act.lang'),
        icon: <Globe size={14} />,
        run: () => setLocale(locale === 'zh' ? 'en' : 'zh'),
        keywords: 'language en zh ' + t('cmdk.act.lang').toLowerCase(),
      },
    ];
    const projectItems: Item[] = projects.map((p) => ({
      id: `b-${p.name}`, group: 'projects', label: p.name,
      sub: `${p.tasks} ${t('boards.card.tasks')}`, icon: <SquareKanban size={14} />,
      run: () => go(`/p/${encodeURIComponent(p.name)}`),
      keywords: p.name.toLowerCase(),
    }));
    const taskItems: Item[] = tasks
      .filter((tt) => !['done', 'cancelled'].includes(tt.status))
      .map((tt: any) => ({
        id: `t-${tt.id}`, group: 'tasks',
        label: `#${tt.num} ${tt.title}`,
        sub: t(`status.${tt.status}`),
        icon: <FileText size={14} />,
        run: () => go(`/p/${encodeURIComponent(baseName(tt.workspace_path))}/tasks/${tt.id}`),
        keywords: `${tt.num} ${tt.title.toLowerCase()} ${tt.status}`,
      }));
    const needle = q.trim().toLowerCase();
    const match = (x: Item) => !needle || x.label.toLowerCase().includes(needle) || x.keywords.includes(needle);
    return [...actions, ...projectItems, ...taskItems].filter(match);
  }, [q, projects, tasks, t, locale, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // 结果变化时收敛 active
  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  if (!open) return null;

  const grouped: [string, Item[]][] = [
    ['actions', items.filter((x) => x.group === 'actions')],
    ['projects', items.filter((x) => x.group === 'projects')],
    ['tasks', items.filter((x) => x.group === 'tasks')],
  ].filter(([, xs]) => xs.length) as [string, Item[]][];

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((x) => Math.min(items.length - 1, x + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((x) => Math.max(0, x - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === 'Escape') {
      on(false);
    }
  };

  let flat = -1;
  return (
    <div className="cmdk-mask" onMouseDown={() => on(false)}>
      <div className="cmdk" data-testid="cmdk-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-head">
          <Search size={14} style={{ color: 'var(--text-3)' }} />
          <input
            ref={inputRef}
            className="cmdk-input"
            data-testid="cmdk-input"
            placeholder={t('cmdk.placeholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onListKey}
          />
          <span className="kbd esc">esc</span>
        </div>
        <div className="cmdk-list" ref={listRef} data-testid="cmdk-list">
          {items.length === 0 && <div className="cmdk-empty">{t('cmdk.empty')}</div>}
          {grouped.map(([g, xs]) => (
            <div key={g}>
              <div className="cmdk-group">{t(`cmdk.group.${g}`)}</div>
              {xs.map((it) => {
                flat += 1;
                const idx = flat;
                return (
                  <button
                    key={it.id}
                    className={`cmdk-item ${idx === active ? 'on' : ''}`}
                    data-testid="cmdk-item"
                    onMouseEnter={() => setActive(idx)}
                    onClick={it.run}
                  >
                    <span className="ci-ico">{it.icon}</span>
                    <span className="ci-label">{it.label}</span>
                    {it.sub && <span className="ci-sub">{it.sub}</span>}
                    <span className="kbd cr">↵</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>{t('cmdk.hint')}</span>
          <span className="kbd-nav">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>
            <span className="kbd">↵</span>
          </span>
        </div>
      </div>
    </div>
  );
}
