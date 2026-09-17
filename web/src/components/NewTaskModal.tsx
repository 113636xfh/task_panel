import { useEffect, useRef, useState } from 'react';
import { X, ImagePlus, FolderOpen, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import { fileToBase64 } from '../lib/img';

const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

function dataUrl(name: string, data: string): string {
  const ext = (name.slice(name.lastIndexOf('.') + 1) || 'png').toLowerCase();
  return `data:${IMG_MIME[ext] ?? 'image/png'};base64,${data}`;
}

export type SkillItem = { name: string; source: string; kind: string; description: string };

// 新建任务弹窗（P3 精简版）：标题+优先级 | 工作目录 | 任务提示词；其余收进「高级设置」
// 项目 = 工作目录末段，后端自动关联/创建同名看板（前端不再暴露看板概念）
export default function NewTaskModal({
  defaultWs,
  skills,
  onClose,
  onCreated,
}: {
  defaultWs?: string;
  skills: SkillItem[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState(2);
  const [wsMode, setWsMode] = useState<'fresh' | 'shared'>(defaultWs ? 'shared' : 'fresh');
  const [wsName, setWsName] = useState('');
  const [wsPath, setWsPath] = useState(defaultWs ?? '');
  const [picking, setPicking] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [branch, setBranch] = useState<'manual' | 'auto'>('manual');
  const [branchMin, setBranchMin] = useState(30);
  const [ctxWin, setCtxWin] = useState(0); // 0 = 跟随全局默认
  const [extra, setExtra] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [imgFiles, setImgFiles] = useState<{ name: string; data: string; url: string }[]>([]);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Esc 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function pickImgs(files: FileList | null) {
    if (!files?.length) return;
    try {
      const items = await Promise.all(
        Array.from(files).map(async (f) => {
          const { name, data } = await fileToBase64(f);
          return { name, data, url: dataUrl(name, data) };
        })
      );
      setImgFiles((prev) => [...prev, ...items]);
    } catch {
      toast(t('img.err'), 'err');
    } finally {
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  }

  // 原生文件管理器选择已有项目目录（Windows 弹窗 / Linux zenity|kdialog / mac Finder）
  async function pickDir() {
    setPicking(true);
    try {
      const r = await api.pickDirectory(wsPath);
      if (r && 'path' in r && r.path) setWsPath(r.path);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setPicking(false);
    }
  }

  async function submit() {
    if (!title.trim() || !desc.trim()) return toast(t('modal.missing'), 'err');
    if (wsMode === 'shared' && !wsPath.trim()) return toast(t('modal.wsPick'), 'err');
    setBusy(true);
    try {
      await api.createTaskLoose({
        title: title.trim(),
        description: desc.trim(),
        priority,
        workspace: wsMode === 'fresh' ? { mode: 'fresh', name: wsName.trim() } : { mode: 'shared', path: wsPath.trim() },
        branch_mode: branch,
        branch_timeout_min: branchMin,
        extra_prompt: extra.trim(),
        skills: picked.join(','),
        images: imgFiles.map(({ name, data }) => ({ name, data })),
        context_window: ctxWin > 0 ? ctxWin : 0,
      });
      toast(t('modal.created'));
      onCreated();
      onClose();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="m-h">
          {t('modal.newTitle')}
          <button className="m-x" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="m-b">
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>{t('modal.title')}</label>
              <input className="inp" data-testid="input-task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('modal.titlePh')} />
            </div>
            <div className="field" style={{ flex: 'none', width: 76 }}>
              <label>{t('modal.priority')}</label>
              <select className="inp" style={{ width: '100%' }} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={0}>P0</option>
                <option value={1}>P1</option>
                <option value={2}>P2</option>
                <option value={3}>P3</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>{t('modal.workspace')}</label>
            <div className="ws-radio">
              <div className={`ws-opt ${wsMode === 'fresh' ? 'on' : ''}`} onClick={() => setWsMode('fresh')}>
                <span className="radio" /> {t('modal.ws.fresh')}
              </div>
              {wsMode === 'fresh' && (
                <input
                  className="inp"
                  data-testid="input-ws-name"
                  style={{ marginLeft: 23 }}
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder={t('modal.ws.freshPh')}
                />
              )}
              <div className={`ws-opt ${wsMode === 'shared' ? 'on' : ''}`} onClick={() => setWsMode('shared')}>
                <span className="radio" /> {t('modal.ws.existing')}
              </div>
              {wsMode === 'shared' && (
                <>
                  <input
                    className="inp mono"
                    data-testid="input-ws-path"
                    style={{ marginLeft: 23, flex: 1, minWidth: 0 }}
                    value={wsPath}
                    onChange={(e) => setWsPath(e.target.value)}
                    placeholder={t('modal.ws.existingPh')}
                  />
                  <button className="btn ghost sm" data-testid="btn-ws-pick" disabled={picking} onClick={pickDir} title={t('modal.ws.browseTip')}>
                    <FolderOpen size={13} /> {picking ? t('loading') : t('modal.ws.browse')}
                  </button>
                </>
              )}
            </div>
            <div className="steer-hint">{t('modal.ws.hint')}</div>
          </div>

          <div className="field">
            <label className="m-img-label">
              {t('modal.prompt')}
              <button type="button" className="btn ghost sm" onClick={() => imgInputRef.current?.click()}>
                <ImagePlus size={13} /> {t('img.attach')}
              </button>
            </label>
            <textarea
              className="inp"
              data-testid="input-task-desc"
              rows={6}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('modal.descPh')}
            />
            <div className="steer-hint">{t('modal.prompt.hint')}</div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickImgs(e.target.files)} />
            {imgFiles.length > 0 && (
              <div className="img-chips">
                {imgFiles.map((im, i) => (
                  <div key={i} className="img-chip" title={im.name}>
                    <img src={im.url} alt={im.name} />
                    <span className="n">{t('img.fig', { n: i + 1 })}</span>
                    <button type="button" className="chip-x" onClick={() => setImgFiles((x) => x.filter((_, j) => j !== i))}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="adv">
            <button type="button" className="adv-h" data-testid="btn-adv-toggle" onClick={() => setAdvOpen(!advOpen)}>
              <ChevronDown size={13} style={{ transform: advOpen ? 'rotate(180deg)' : '', transition: 'transform .15s' }} />
              {t('modal.advanced')}
            </button>
            {advOpen && (
              <div className="adv-b">
                <div className="row" style={{ gap: 16 }}>
                  <div className="field" style={{ flex: 'none' }} title={t('modal.ctxwin.hint')}>
                    <label>{t('modal.ctxwin')}</label>
                    <input
                      className="inp mono"
                      style={{ width: 110, textAlign: 'left', paddingRight: 20 }}
                      type="number"
                      min={0}
                      data-testid="input-task-ctxwin"
                      value={ctxWin}
                      onChange={(e) => setCtxWin(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 0 }}>
                    <label>{t('modal.branch')}</label>
                    <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                      <div className="seg">
                        <button className={branch === 'manual' ? 'on' : ''} onClick={() => setBranch('manual')}>
                          {t('modal.branch.manual')}
                        </button>
                        <button className={branch === 'auto' ? 'on' : ''} onClick={() => setBranch('auto')}>
                          {t('modal.branch.auto')}
                        </button>
                      </div>
                      {branch === 'manual' && (
                        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <input type="range" min={5} max={1440} step={5} value={branchMin} onChange={(e) => setBranchMin(Number(e.target.value))} />
                          <span className="mono" style={{ color: 'var(--text-2)', fontSize: 12 }}>
                            {branchMin}m
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label>{t('modal.extra')}</label>
                  <textarea className="inp mono" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('modal.extraPh')} />
                </div>
                <div className="field">
                  <label>{t('modal.skills')}</label>
                  <div className="skill-list">
                    {skills.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{t('modal.skills.empty')}</span>}
                    {skills.map((s) => (
                      <label key={`${s.source}|${s.kind}|${s.name}`} className="skill-opt">
                        <input
                          type="checkbox"
                          checked={picked.includes(s.name)}
                          onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.name] : p.filter((x) => x !== s.name)))}
                        />
                        <b>{s.name}</b>
                        <span className="kind-tag">{s.kind}</span>
                        <span className="s-desc">{s.source === 'global' ? t('modal.skill.global') : t('modal.skill.project')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="m-f">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('boards.cancel')}
          </button>
          <button className="btn primary" data-testid="btn-create-task" disabled={busy} onClick={submit}>
            {busy ? t('loading') : t('modal.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
