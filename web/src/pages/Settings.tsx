import { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/fmt';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';

export default function Settings() {
  const { t } = useI18n();
  const [s, setS] = useState<any | null>(null);
  const [sp, setSp] = useState('');
  const [spAt, setSpAt] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: number; text: string; at: number }[]>([]);
  const [showHist, setShowHist] = useState(false);

  useEffect(() => {
    api.settings().then(setS).catch(() => {});
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
      });
      toast(t('set.saved'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

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

        <div className="card skill-box" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            {t('set.prompt')}
            <button className="btn ghost sm" onClick={() => setShowHist(!showHist)}>
              {showHist ? t('set.hist.hide') : t('set.hist.show', { n: history.length })}
            </button>
          </div>
          <div className="card-b">
            <textarea className="inp mono" rows={7} value={sp} onChange={(e) => setSp(e.target.value)} placeholder={t('set.prompt.ph')} />
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
      </div>
    </>
  );
}
