import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/fmt';
import { toast } from '../lib/toast';

export default function Settings() {
  const [s, setS] = useState<any | null>(null);
  const [sp, setSp] = useState('');
  const [spAt, setSpAt] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: number; text: string; at: number }[]>([]);
  const [showHist, setShowHist] = useState(false);

  useEffect(() => {
    api.settings().then((x) => { setS(x); }).catch(() => {});
    api.sp().then((x) => { setSp(x.text); setSpAt(x.at); setHistory(x.history); }).catch(() => {});
  }, []);

  if (!s) return <div className="empty">加载中…</div>;

  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));

  async function saveSettings() {
    try {
      await api.saveSettings({
        concurrency: s.concurrency, branchTimeoutMin: s.branchTimeoutMin, retryMax: s.retryMax,
        endpoint: s.endpoint, provider: s.provider, execModel: s.execModel,
        planMaxTokens: s.planMaxTokens, workspacesBase: s.workspacesBase,
      });
      toast('已保存（并发/分支/验收/工作目录立即生效；模型配置自 P1 起生效）');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function savePrompt() {
    try {
      await api.saveSp(sp);
      setSpAt(Date.now());
      api.sp().then((x) => setHistory(x.history)).catch(() => {});
      toast('全局系统提示词已保存（仅影响新启动/恢复的派 Agent）');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <>
      <div className="page-head">
        <h1>设置</h1>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={saveSettings}>保存运行/模型设置</button>
      </div>

      <div className="settings-grid">
        <div className="card skill-box">
          <div className="card-h">运行</div>
          <div className="card-b">
            <div className="set-row">
              <span className="lab">并发执行数<span className="h">同时运行的任务上限（1–8）</span></span>
              <span className="ctl">
                <input type="range" min={1} max={8} value={s.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} />
                <span className="mono" style={{ width: 22, textAlign: 'center' }}>{s.concurrency}</span>
              </span>
            </div>
            <div className="set-row">
              <span className="lab">分支默认等待<span className="h">「手动」策略下超时自动取推荐默认的时长</span></span>
              <span className="ctl">
                <input type="number" className="inp num-inp" value={s.branchTimeoutMin} min={1} onChange={(e) => set('branchTimeoutMin', Number(e.target.value))} /> m
              </span>
            </div>
            <div className="set-row">
              <span className="lab">独立工作目录根<span className="h">「独立新目录」任务创建在此目录下</span></span>
              <input className="inp mono" value={s.workspacesBase} onChange={(e) => set('workspacesBase', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card skill-box">
          <div className="card-h">模型</div>
          <div className="card-b">
            <div className="set-row">
              <span className="lab">推理端点<span className="h">OpenAI 兼容 API（本地 vllm / Ollama）</span></span>
              <input className="inp mono" value={s.endpoint} onChange={(e) => set('endpoint', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">provider</span>
              <input className="inp mono" style={{ width: 140 }} value={s.provider} onChange={(e) => set('provider', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">执行模型<span className="h">需多模态（text+image）；打磨阶段用同模型短上下文</span></span>
              <input className="inp mono" value={s.execModel} onChange={(e) => set('execModel', e.target.value)} />
            </div>
            <div className="set-row">
              <span className="lab">打磨 maxTokens<span className="h">短上下文规划预算</span></span>
              <input type="number" className="inp num-inp" style={{ width: 90 }} value={s.planMaxTokens} onChange={(e) => set('planMaxTokens', Number(e.target.value))} />
            </div>
            <div className="set-row">
              <span className="lab">验收失败重试<span className="h">超过后转「失败」，可手动恢复</span></span>
              <span className="ctl">
                <input type="number" className="inp num-inp" min={1} value={s.retryMax} onChange={(e) => set('retryMax', Number(e.target.value))} /> 次
              </span>
            </div>
          </div>
        </div>

        <div className="card skill-box" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            全局系统提示词
            <button className="btn ghost sm" onClick={() => setShowHist(!showHist)}>{showHist ? '收起历史' : `历史（${history.length}）`}</button>
          </div>
          <div className="card-b">
            <textarea className="inp mono" rows={7} value={sp} onChange={(e) => setSp(e.target.value)}
              placeholder={'示例：\n你是资深全栈工程师。始终先读相关代码再改；改动最小化；\n遇到无法自行决断的问题时写入 work/block.json 并停止。'} />
            <div className="sp-note">
              仅作用于本面板 <b>新启动 / 恢复</b> 的派 Agent（每次拉起读最新值）；<b>不影响</b> 你全局 pi CLI / 其他工具，也<b>不影响</b> 正在运行的任务。
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button className="btn primary" onClick={savePrompt}>保存全局系统提示词</button>
              {spAt && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>上次更新 {fmtDate(spAt)}</span>}
            </div>
            {showHist && (
              <div style={{ marginTop: 12 }}>
                {history.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>暂无历史</span>}
                {history.map((h) => (
                  <div className="hist-item" key={h.id}>
                    <span className="mono" style={{ color: 'var(--text-3)' }}>{fmtDate(h.at)}</span>
                    <span className="ht">{h.text.slice(0, 60) || '（空）'}</span>
                    <button className="btn ghost sm" onClick={() => api.restoreSp(h.id).then(() => { setSp(h.text); toast('已恢复该版本'); })}>恢复</button>
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
