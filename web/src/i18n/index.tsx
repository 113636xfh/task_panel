/**
 * i18n — 可扩展的多语言层。
 *
 * 新增语言：① 在 locales/ 下新建 <code>xx.ts</code>（与 zh/en 同形状的字典）
 *          ② 在 index.tsx 的 LOCALES 注册表里加一行。
 * 回退链：当前语言 → en → key 本身（缺失不崩）。
 * 插值：t('task.answersN', { n: 2 }) → "已吸收 2 条分支回答"。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { zh } from './locales/zh';
import { en } from './locales/en';

const LOCALES = { zh, en } as const;
export type Locale = keyof typeof LOCALES;
const STORAGE_KEY = 'tp.locale';

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOCALES) return saved as Locale;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>(null as unknown as I18nCtx);
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detect);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s: string | undefined = (LOCALES[locale] as Record<string, string>)[key];
      if (s === undefined) s = (LOCALES.en as Record<string, string>)[key];
      if (s === undefined) s = key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
