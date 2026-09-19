import { useEffect, useRef, useState } from 'react';
import { X, ImagePlus, FolderOpen, ChevronDown, FileUp } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useI18n } from '../i18n';
import { fileToBase64 } from '../lib/img';

const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

function dataUrl(name: string, data: string): string {
  const ext = (name.slice(name.lastIndexOf('.') + 1) || 'png').toLowerCase();
  return `data:${IMG_MIME[ext] ?? 'image/png'};base64,${data}`;
}

type ImportFile = { name: string; content: string; kind: 'skill' | 'extension' };

// 新建任务弹窗（P3 精简版）：标题+优先级 | 工作目录 | 任务提示词；其余收进「高级设置」
// 项目 = 工作目录末段，后端自动关联/创建同名看板（前端不再暴露看板概念）
export default function NewTaskModal({
  defaultWs,
  onClose,
  onCreated,
}: {
  defaultWs?: string;
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
  const [skillFiles, setSkillFiles] = useState<ImportFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [imgFiles, setImgFiles] = useState<{ name: string; data: string; url: string }[]>([]);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const skillFileRef = useRef<HTMLInputElement>(null);

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

  // 附加技能/扩展文件（.md=技能，.ts/.js=扩展）：读取内容随任务创建提交，后端写入任务 workspace 的 .pi/
  async function pickSkillFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const items: ImportFile[] = [];
      for (const f of Array.from(files)) {
        const content = await f.text();
        const base = f.name.replace(/\.(md|ts|js)$/i, '');
        items.push({ name: base, content, kind: f.name.toLowerCase().endsWith('.md') ? 'skill' : 'extension' });
      }
      setSkillFiles((prev) => {
        const seen = new Set(prev.map((x) => x.name + x.kind));
        return [...prev, ...items.filter((x) => (seen.has(x.name + x.kind) ? false : (seen.add(x.name + x.kind), true)))];
      });
    } catch {
      toast(t('modal.skills.err'), 'err');
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
        skillFiles,
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
                    <div className="seg seg-block" data-testid="branch-opt">
                      <button type="button" className={branch === 'manual' ? 'on' : ''} onClick={() => setBranch('manual')}>
                        {t('modal.branch.manual')}
                      </button>
                      <button type="button" className={branch === 'auto' ? 'on' : ''} onClick={() => setBranch('auto')}>
                        {t('modal.branch.auto')}
                      </button>
                    </div>
                    {branch === 'manual' && (
                      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('modal.branch.timeout')}</span>
                        <input
                          className="inp mono"
                          data-testid="input-branch-min"
                          style={{ width: 76, padding: '4px 8px' }}
                          type="number" min={5} max={1440} step={5} value={branchMin}
                          onChange={(e) => setBranchMin(Math.max(5, Math.min(1440, Math.round(Number(e.target.value) || 5))))}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('modal.branch.timeout.unit')}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label>{t('modal.extra')}</label>
                  <textarea className="inp mono" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('modal.extraPh')} />
                </div>
                <div className="field">
                  <label>{t('modal.skills')}</label>
                  <div className="hint" style={{ marginTop: 0, marginBottom: 6 }}>{t('modal.skills.hint')}</div>
                  <div className="file-pick" onClick={() => skillFileRef.current?.click()}>
                    <FileUp size={14} /> {t('modal.skills.pick')}
                  </div>
                  <input
                    ref={skillFileRef}
                    type="file"
                    multiple
                    accept=".md,.ts,.js"
                    style={{ display: 'none' }}
                    onChange={(e) => { pickSkillFiles(e.target.files); e.target.value = ''; }}
                  />
                  {skillFiles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {skillFiles.map((f) => (
                        <span key={f.name + f.kind} className="file-chip">
                          <b>{f.name}</b>
                          <span className="kind-tag">{f.kind === 'skill' ? t('modal.skills.kind.skill') : t('modal.skills.kind.ext')}</span>
                          <button className="chip-x" onClick={() => setSkillFiles((p) => p.filter((x) => !(x.name === f.name && x.kind === f.kind)))}>
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
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
