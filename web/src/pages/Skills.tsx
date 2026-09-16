import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Download } from 'lucide-react';
import { api } from '../lib/api';
import { onEvent } from '../lib/ws';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import type { SkillsInv } from '../lib/types';

export default function Skills() {
  const { t } = useI18n();
  const [inv, setInv] = useState<SkillsInv | null>(null);
  const [selTask, setSelTask] = useState('');
  const [selName, setSelName] = useState('');
  const [selKind, setSelKind] = useState<'skill' | 'extension'>('skill');
  const [selSource, setSelSource] = useState('global');
  const nav = useNavigate();

  const load = () => api.skills().then(setInv).catch(() => {});
  useEffect(() => {
    load();
    return onEvent((ev) => {
      if (ev.kind === 'skills.changed') load();
    });
  }, []);

  if (!inv) return <div className="empty">{t('loading')}…</div>;

  const allItems = [
    ...inv.global.skills.map((s) => ({ ...s, from: t('modal.skill.global') })),
    ...inv.global.extensions.map((s) => ({ ...s, from: t('modal.skill.global') })),
    ...inv.projects.flatMap((p) => [...p.skills, ...p.extensions].map((s) => ({ ...s, from: t('modal.skill.project') }))),
  ];
  const taskEntries = Object.entries(inv.tasks);

  async function install() {
    if (!selTask || !selName) return;
    const item = allItems.find((x) => x.name === selName && x.kind === selKind && x.source === selSource);
    if (!item) return toast(t('skills.notFound'), 'err');
    try {
      await api.installSkill(selTask, item.name, item.kind, item.source);
      toast(t('skills.installed2'));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t('skills.title')}</h1>
        <span className="sub">{t('skills.sub')}</span>
      </div>

      <div className="skill-box">
        <div className="card">
          <div className="card-h">
            ① {t('skills.global')}
            <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{t('skills.global.hint')}</span>
          </div>
          <div className="card-b tight">
            {inv.global.skills.length + inv.global.extensions.length === 0 && (
              <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>{t('skills.global.none')}</div>
            )}
            {inv.global.skills.map((s) => (
              <div className="skill-row" key={`g-${s.name}`}>
                <span className="s-name">{s.name}</span>
                <span className="kind-tag">{t('skills.type.skill')}</span>
                <span className="s-desc">{s.description}</span>
              </div>
            ))}
            {inv.global.extensions.map((s) => (
              <div className="skill-row" key={`ge-${s.name}`}>
                <span className="s-name">{s.name}</span>
                <span className="kind-tag">{t('skills.type.extension')}</span>
                <span className="s-desc">{s.description || t('skills.ext.default')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="skill-box">
        <div className="card">
          <div className="card-h">
            ② {t('skills.project')}
            <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{t('skills.project.hint')}</span>
          </div>
          <div className="card-b tight">
            {inv.projects.length === 0 && (
              <div style={{ padding: 13, color: 'var(--text-3)', fontSize: 12.5 }}>{t('skills.project.none')}</div>
            )}
            {inv.projects.map((p) => (
              <div key={p.dir}>
                <div className="skill-row" style={{ background: 'var(--bg-panel)', fontWeight: 650 }}>
                  <span className="s-name mono" style={{ minWidth: 0, flex: 1 }}>
                    {p.dir}
                  </span>
                </div>
                {p.skills.concat(p.extensions).map((s, i) => (
                  <div className="skill-row" key={`${p.dir}-${i}`}>
                    <span className="s-name">{s.name}</span>
                    <span className="kind-tag">{s.kind}</span>
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
          <div className="card-h">
            ③ {t('skills.task')}
            <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{t('skills.task.hint')}</span>
          </div>
          <div className="card-b">
            {taskEntries.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.5, marginBottom: 12 }}>{t('skills.task.none')}</div>}
            <div className="row" style={{ alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
              <select className="inp" value={selTask} onChange={(e) => setSelTask(e.target.value)}>
                <option value="">{t('skills.pickTask')}</option>
                {Object.entries(inv.tasks).map(([tid, tt]) => (
                  <option key={tid} value={tid}>
                    {tt.title}
                  </option>
                ))}
              </select>
              <select
                className="inp"
                value={`${selSource}|${selKind}|${selName}`}
                onChange={(e) => {
                  const [src, kind, name] = e.target.value.split('|');
                  setSelSource(src);
                  setSelKind(kind as 'skill' | 'extension');
                  setSelName(name);
                }}
              >
                <option value="global|skill|">{t('skills.pickItem')}</option>
                {allItems.map((x) => (
                  <option key={`${x.source}|${x.kind}|${x.name}`} value={`${x.source}|${x.kind}|${x.name}`}>
                    [{x.from}] {x.name} ({x.kind})
                  </option>
                ))}
              </select>
              <button className="btn primary" disabled={!selTask || !selName} onClick={install}>
                <Download size={13} /> {t('skills.install')}
              </button>
            </div>

            {taskEntries.map(([tid, tt]) => (
              <div className="task-skill-row" key={tid}>
                <span className="t-title" style={{ cursor: 'pointer' }} onClick={() => nav(`/boards/${tt.boardId}/tasks/${tid}`)}>
                  {tt.title}
                </span>
                {tt.items.map((it) => (
                  <span key={it.name + it.kind} className="tsk-chip">
                    {it.name} <span className="kind-tag">{it.kind === 'skill' ? 's' : 'e'}</span>
                    <button
                      title={t('skills.delete')}
                      onClick={() => api.removeSkill(tid, it.id).then(() => toast(t('skills.removed'))).catch((e) => toast(e.message, 'err'))}
                    >
                      <X size={12} />
                    </button>
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
