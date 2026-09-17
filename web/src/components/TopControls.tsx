import { useEffect, useState } from 'react';
import { Globe, Moon, Sun, Type } from 'lucide-react';
import { useI18n } from '../i18n';

// 全局顶栏控件（版本标签 + 语言/字号/主题）。
// Layout 顶栏与任务详情第一行共用（任务页隐藏顶栏后由详情行渲染，testid 不冲突）。
export default function TopControls() {
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState(
    localStorage.getItem('tp-theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
  const [fs, setFs] = useState(localStorage.getItem('tp-fs') ?? 'm');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tp-theme', theme);
  }, [theme]);

  // P3：字体大小（S/M/L 微调；基础缩放随屏幕自适应，TopControls 计算 --app-zoom）
  useEffect(() => {
    document.documentElement.dataset.fs = fs;
    localStorage.setItem('tp-fs', fs);
    window.dispatchEvent(new Event('tp-fs-apply'));
  }, [fs]);

  // 设置页切换主题时同步（避免两处状态漂移）
  useEffect(() => {
    const h = () => setTheme(localStorage.getItem('tp-theme') ?? 'dark');
    window.addEventListener('tp-theme-apply', h);
    return () => window.removeEventListener('tp-theme-apply', h);
  }, []);

  // 界面缩放：基础值随屏幕自适应（以 1440×900 为基准），S/M/L 为微调档位；
  // #root 高度用 100vh/zoom 补偿（见 app.css）→ 页面恒适配屏幕，不留白/不滚动
  useEffect(() => {
    const apply = () => {
      const lvl = localStorage.getItem('tp-fs') ?? 'm';
      const f = lvl === 's' ? 1.0 : lvl === 'l' ? 1.12 : 1.06;
      const k = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
      const z = Math.min(1.5, Math.max(0.75, k)) * f;
      document.documentElement.style.setProperty('--app-zoom', z.toFixed(3));
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('tp-fs-apply', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('tp-fs-apply', apply);
    };
  }, []);

  return (
    <>
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
      <button className="btn ghost sm" data-testid="btn-fontsize" title={t('topbar.fontsize')} onClick={() => setFs(fs === 'm' ? 'l' : fs === 'l' ? 's' : 'm')}>
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
    </>
  );
}
