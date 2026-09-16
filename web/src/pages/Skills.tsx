import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { toast } from '../lib/toast';
import type { SkillsInv } from '../lib/types';

export default function Skills() {
  const [inv, setInv] = useState<SkillsInv | null>(null);
  const [selTask, setSelTask] = useState('');
  const [selName, setSelName] = useState('');
  const [selKind, setSelKind] = useState<'skill' | 'extension'>('skill');
  const [selSource, setSelSource] = useState('global');
  const nav = useNavigate();

  const load = () => api.skills().then(setInv).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => { if (ev.kind === 'skills.changed') load(); });
  }, []);

  if (!inv) return <div className="empty">加载中…</div>;

  const allItems = [
    ...inv.global.skills.map((s) => ({ ...s, from: '全局' })),
    ...inv.global.extensions.map((s) => ({ ...s, from: '全局' })),
    ...inv.projects.flatMap((p) => [...p.skills, ...p.extensions].map((s) => ({ ...s, from: '项目级' }))),
  ];
  const taskEntries = Object.entries(inv.tasks);

  async function install() {
    if (!selTask || !selName) return;
    const item = allItems.find((x) => x.name === selName && x.kind === selKind && x.source === selSource);
    if (!item) return toast('选中的项不存在', 'err');
    try {
      await api.installSkill(selTask, item.name, item.kind, item.source);
      toast('已安装到任务工作目录 .pi/');
    } catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <>
      <div className="page-head">
        <h1>技能</h1>
        <span className="sub">三级生效集：全局继承 → 项目层共享 → 任务级手动</span>
      </div>

      <div className="skill-box">
        <div className="card">
          <div className="card-h">① 全局继承（只读）<span style={{ fontWeight: 400, color: 'var(--text-3)' }}>所有任务自动继承，不可删改 · 来自 ~/.pi/agent 与 ~/.agents/skills</span></div>
          <div className="card-b tight">
            {inv.global.skills.length + inv.global.extensions.length === 0 && (
              <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>全局目录未发现技能/扩展</div>
            )}
            {inv.global.skills.map((s) => (
              <div className="skill-row" key={`g-${s.name}`}>
                <span className="s-name">{s.name}</span><span className="kind-tag">skill</span>
                <span className="s-desc">{s.description}</span>
              </div>
            ))}
            {inv.global.extensions.map((s) => (
              <div className="skill-row" key={`ge-${s.name}`}>
                <span className="s-name">{s.name}</span><span className="kind-tag">extension</span>
                <span className="s-desc">{s.description || '全局扩展（如沙盒/工具路由）'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="skill-box">
        <div className="card">
          <div className="card-h">② 项目层（共享目录）<span style={{ fontWeight: 400, color: 'var(--text-3)' }}>同一目录下的任务自动继承 · 来自各项目目录 .pi/skills 与 .pi/extensions</span></div>
          <div className="card-b tight">
            {inv.projects.length === 0 && (
              <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>还没有任务使用「指定已有项目目录」模式</div>
            )}
            {inv.projects.map((p) => (
              <div key={p.dir}>
                <div className="skill-row" style={{ background: 'var(--bg-panel)', fontWeight: 650 }}>
                  <span className="s-name mono" style={{ minWidth: 0, flex: 1 }}>{p.dir}</span>
                </div>
                {p.skills.concat(p.extensions).map((s, i) => (
                  <div className="skill-row" key={`${p.dir}-${i}`}>
                    <span className="s-name">{s.name}</span><span className="kind-tag">{s.kind}</span>
                    <span className="s-desc">{s.description}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="skill-box">
        <div className="card">
          <div className="card-h">③ 任务级（手动安装）<span style={{ fontWeight: 400, color: 'var(--text-3)' }}>把某技能/扩展复制进该任务工作目录的 .pi/，仅该任务生效</span></div>
          <div className="card-b">
            {taskEntries.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 12.5, marginBottom: 12 }}>还没有任务安装过任务级技能。</div>
            )}
            <div className="row" style={{ alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
              <select className="inp" value={selTask} onChange={(e) => setSelTask(e.target.value)}>
                <option value="">选择任务…</option>
                {Object.entries(inv.tasks).map(([tid, t]) => <option key={tid} value={tid}>{t.title}</option>)}
              </select>
              <select className="inp" value={`${selSource}|${selKind}|${selName}`}
                onChange={(e) => {
                  const [src, kind, name] = e.target.value.split('|');
                  setSelSource(src); setSelKind(kind as 'skill' | 'extension'); setSelName(name);
                }}>
                <option value="global|skill|">选择要安装的项…</option>
                {allItems.map((x) => (
                  <option key={`${x.source}|${x.kind}|${x.name}`} value={`${x.source}|${x.kind}|${x.name}`}>
                    [{x.from}] {x.name} ({x.kind})
                  </option>
                ))}
              </select>
              <button className="btn primary" disabled={!selTask || !selName} onClick={install}>安装到任务</button>
            </div>

            {taskEntries.map(([tid, t]) => (
              <div className="task-skill-row" key={tid}>
                <span className="t-title" style={{ cursor: 'pointer' }} onClick={() => nav(`/boards/${t.boardId}/tasks/${tid}`)}>{t.title}</span>
                {t.items.map((it) => (
                  <span key={it.name + it.kind} className="tsk-chip">
                    {it.name} <span className="kind-tag">{it.kind === 'skill' ? 's' : 'e'}</span>
                    <button title="移除" onClick={() => api.removeSkill(tid, it.id).then(() => toast('已移除')).catch((e) => toast(e.message, 'err'))}>✕</button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
