import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/fmt';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';

// 提示词输入框：不内部滚动，随内容自动长高（页面滚动）
function AutoArea({
  value,
  onChange,
  placeholder,
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testid?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 110) + 'px';
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="inp mono tpl-area"
      data-testid={testid}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function Settings() {
  const { t } = useI18n();
  const [s, setS] = useState<any | null>(null);
  const [sp, setSp] = useState('');
  const [spAt, setSpAt] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: number; text: string; at: number }[]>([]);
  const [showHist, setShowHist] = useState(false);

  useEffect(() => {
    api.settings().then((x) =>
      setS({
        ...x,
        theme: document.documentElement.dataset.theme ?? 'dark',
        accent: document.documentElement.dataset.accent ?? 'blue',
        fontsize: document.documentElement.dataset.fs ?? 'm',
      })
    ).catch(() => {});
    api.sp().then((x) => {
      setSp(x.text);
      setSpAt(x.at);
      setHistory(x.history);
    }).catch(() => {});
  }, []);

  if (!s) return <div className="empty">{t('loading')}…</div>;

  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));

  async function saveSettings() {
    try {
      await api.saveSettings({
        concurrency: s.concurrency,
        branchTimeoutMin: s.branchTimeoutMin,
        retryMax: s.retryMax,
        endpoint: s.endpoint,
        provider: s.provider,
        execModel: s.execModel,
        planMaxTokens: s.planMaxTokens,
        workspacesBase: s.workspacesBase,
        contextWindow: s.contextWindow ?? 0,
        promptTemplates: s.promptTemplates ?? {},
      });
      toast(t('set.saved'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  // P3：外观（localStorage；documentElement 属性）
  const setAccent = (v: string) => {
    document.documentElement.dataset.accent = v;
    localStorage.setItem('tp-accent', v);
    set('accent', v);
  };
  const setFsUi = (v: string) => {
    document.documentElement.dataset.fs = v;
    localStorage.setItem('tp-fs', v);
    set('fontsize', v);
    window.dispatchEvent(new Event('tp-fs-apply'));
  };
  const setThemeUi = (v: string) => {
    document.documentElement.dataset.theme = v;
    localStorage.setItem('tp-theme', v);
    set('theme', v);
    // 通知顶栏按钮同步（Layout 监听）
    window.dispatchEvent(new CustomEvent('tp-theme-apply'));
  };

  async function savePrompt() {
    try {
      await api.saveSp(sp);
      setSpAt(Date.now());
      api.sp().then((x) => setHistory(x.history)).catch(() => {});
      toast(t('set.prompt.saved'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t('set.title')}</h1>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={saveSettings}>
          <Save size={13} /> {t('set.save')}
        </button>
      </div>

      <div className="settings-grid">
        <div className="card skill-box">
          <div className="card-h">{t('set.appearance')}</div>
          <div className="card-b">
            <div className="set-row">
              <span className="lab">
                {t('set.theme')}
              </span>
              <span className="ctl">
                {(['light', 'dark'] as const).map((v) => (
                  <button
                    key={v}
                    data-testid={`theme-opt-${v}`}
                    className={`btn sm ${s.theme === v ? 'primary' : 'ghost'}`}
                    onClick={() => setThemeUi(v)}
                  >
                    {v === 'light' ? t('set.theme.light') : t('set.theme.dark')}
                  </button>
                ))}
              </span>
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.accent')}
                <span className="h">{t('set.accent.hint')}</span>
              </span>
              <span className="ctl">
                {(['blue', 'indigo'] as const).map((v) => (
                  <button
                    key={v}
                    data-testid={`accent-opt-${v}`}
                    className={`btn sm ${(s.accent ?? 'blue') === v ? 'primary' : 'ghost'}`}
                    onClick={() => setAccent(v)}
                  >
                    {v === 'blue' ? t('set.accent.blue') : t('set.accent.indigo')}
                  </button>
                ))}
              </span>
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.fontsize')}
                <span className="h">{t('set.fontsize.hint')}</span>
              </span>
              <span className="ctl">
                {(['s', 'm', 'l'] as const).map((v) => (
                  <button
                    key={v}
                    data-testid={`fs-opt-${v}`}
                    className={`btn sm ${(s.fontsize ?? 'm') === v ? 'primary' : 'ghost'}`}
                    onClick={() => setFsUi(v)}
                  >
                    {t(`set.fs.${v}`)}
                  </button>
                ))}
              </span>
            </div>
          </div>
        </div>

        <div className="card skill-box">
          <div className="card-h">{t('set.run')}</div>
          <div className="card-b">
            <div className="set-row">
              <span className="lab">
                {t('set.concurrency')}
                <span className="h">{t('set.concurrency.hint')}</span>
              </span>
              <span className="ctl">
                <input type="range" min={1} max={8} value={s.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} />
                <span className="mono" style={{ width: 22, textAlign: 'center' }}>
                  {s.concurrency}
                </span>
              </span>
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.branchWait')}
                <span className="h">{t('set.branchWait.hint')}</span>
              </span>
              <span className="ctl">
                <input type="number" className="inp num-inp" value={s.branchTimeoutMin} min={1} onChange={(e) => set('branchTimeoutMin', Number(e.target.value))} /> m
              </span>
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.wsBase')}
                <span className="h">{t('set.wsBase.hint')}</span>
              </span>
              <input className="inp mono" value={s.workspacesBase} onChange={(e) => set('workspacesBase', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.ctxwin')}
                <span className="h">{t('set.ctxwin.hint')}</span>
              </span>
              <span className="ctl">
                <input
                  className="inp num-inp"
                  style={{ width: 110 }}
                  type="number"
                  min={0}
                  data-testid="input-ctxwin"
                  value={s.contextWindow ?? 0}
                  onChange={(e) => set('contextWindow', Number(e.target.value))}
                /> token
              </span>
            </div>
          </div>
        </div>

        <div className="card skill-box">
          <div className="card-h">{t('set.model')}</div>
          <div className="card-b">
            <div className="set-row">
              <span className="lab">
                {t('set.endpoint')}
                <span className="h">{t('set.model.hint')}</span>
              </span>
              <input className="inp mono" value={s.endpoint} onChange={(e) => set('endpoint', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">{t('set.provider')}</span>
              <input className="inp mono" style={{ width: 140 }} value={s.provider} onChange={(e) => set('provider', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.execModel')}
                <span className="h">{t('set.execModel.hint')}</span>
              </span>
              <input className="inp mono" value={s.execModel} onChange={(e) => set('execModel', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.planMax')}
                <span className="h">{t('set.planMax.hint')}</span>
              </span>
              <input type="number" className="inp num-inp" style={{ width: 90 }} value={s.planMaxTokens} onChange={(e) => set('planMaxTokens', Number(e.target.value))} />
            </div>
            <div className="set-row">
              <span className="lab">
                {t('set.retries')}
                <span className="h">{t('set.retries.hint')}</span>
              </span>
              <span className="ctl">
                <input type="number" className="inp num-inp" min={1} value={s.retryMax} onChange={(e) => set('retryMax', Number(e.target.value))} /> {t('set.times')}
              </span>
            </div>
          </div>
        </div>

        <div className="card skill-box">
          <div className="card-h">
            {t('set.prompt')}
            <button className="btn ghost sm" onClick={() => setShowHist(!showHist)}>
              {showHist ? t('set.hist.hide') : t('set.hist.show', { n: history.length })}
            </button>
          </div>
          <div className="card-b">
            <AutoArea value={sp} onChange={setSp} placeholder={t('set.prompt.ph')} />
            <div className="sp-note">{t('set.prompt.scope')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button className="btn primary" onClick={savePrompt}>
                <Check size={13} /> {t('set.prompt.save')}
              </button>
              {spAt && (
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {t('set.prompt.last', { at: fmtDate(spAt) })}
                </span>
              )}
            </div>
            {showHist && (
              <div style={{ marginTop: 12 }}>
                {history.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{t('set.hist.empty')}</span>}
                {history.map((h) => (
                  <div className="hist-item" key={h.id}>
                    <span className="mono" style={{ color: 'var(--text-3)' }}>
                      {fmtDate(h.at)}
                    </span>
                    <span className="ht">{h.text.slice(0, 60) || t('set.empty')}</span>
                    <button
                      className="btn ghost sm"
                      onClick={() => api.restoreSp(h.id).then(() => {
                        setSp(h.text);
                        toast(t('set.hist.restored'));
                      })}
                    >
                      {t('set.hist.restore')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card skill-box" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            {t('set.tpl')}
            <span style={{ color: 'var(--text-3)', fontSize: 11.5, fontWeight: 400 }}>{t('set.tpl.hint')}</span>
          </div>
          <div className="card-b">
            {(['plan', 'exec', 'judge', 'rework'] as const).map((k) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <b style={{ fontSize: 12.5 }}>{t(`set.tpl.${k}`)}</b>
                  <code style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {k === 'plan' ? '{{title}} {{description}} {{acceptance}} {{test_cmd}} {{extra_prompt}} {{skills}} {{rework}}' : k === 'exec' ? '（静态模板，无占位符）' : k === 'judge' ? '{{test_cmd}} {{code}} {{items}}' : '{{msgs}}'}
                  </code>
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn ghost sm"
                    data-testid={`tpl-reset-${k}`}
                    onClick={() => {
                      const next = { ...(s.promptTemplates ?? {}) };
                      delete next[k];
                      set('promptTemplates', next);
                      toast(t('set.tpl.resetDone'));
                    }}
                  >
                    {t('set.tpl.reset')}
                  </button>
                </div>
                <AutoArea
                  testid={`tpl-${k}`}
                  value={s.promptTemplates?.[k] ?? ''}
                  placeholder={t('set.empty')}
                  onChange={(v) => set('promptTemplates', { ...(s.promptTemplates ?? {}), [k]: v })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
