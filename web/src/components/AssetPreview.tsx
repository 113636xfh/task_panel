import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { api } from '../lib/api';
import { MD } from '../lib/md';
import { useI18n } from '../i18n';

const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
const TEXT = new Set([
  '.json', '.md', '.markdown', '.txt', '.log', '.csv', '.ts', '.tsx', '.js', '.jsx',
  '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.css',
  '.scss', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.sh', '.bat',
  '.ps1', '.sql', '.vue',
]);

/**
 * 资产预览：点工作产物/事件流里的文件 → 弹窗查看。
 * 图片直接渲染；文本（含 JSON/Markdown/代码）拉全文展示（md 用 MD 渲染，其余 <pre>）；
 * 二进制给出下载。复用 .modal-bg/.modal 结构。
 */
export default function AssetPreview({
  taskId,
  file,
  onClose,
}: {
  taskId: string;
  file: { name: string; path: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  const isImg = IMG.has(ext);
  const isMd = ext === '.md' || ext === '.markdown';
  const isText = TEXT.has(ext) || isMd;
  const url = api.fileUrl(taskId, file.path);

  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(isText);

  useEffect(() => {
    if (!isText) return;
    let dead = false;
    setLoading(true);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => {
        if (!dead) {
          setContent(txt);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!dead) {
          setErr(e.message);
          setLoading(false);
        }
      });
    return () => {
      dead = true;
    };
  }, [url, isText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal pv" data-testid="asset-preview" onMouseDown={(e) => e.stopPropagation()}>
        <div className="m-h">
          <span className="pv-name" title={file.path}>
            {file.name}
          </span>
          <span className="pv-path">{file.path}</span>
          <span style={{ flex: 1 }} />
          <a className="btn ghost sm" href={url} download={file.name} title={t('preview.download')}>
            <Download size={13} />
          </a>
          <button className="m-x" data-testid="asset-preview-close" onClick={onClose} title={t('preview.close')}>
            <X size={14} />
          </button>
        </div>
        <div className="m-b pv-body" data-testid="asset-preview-body">
          {loading && <div className="pv-loading">{t('preview.loading')}</div>}
          {!loading && err && <div className="pv-err">{err}</div>}
          {!loading && !err && isImg && <img className="pv-img" src={url} alt={file.name} />}
          {!loading && !err && isMd && content != null && <MD text={content} />}
          {!loading && !err && isText && !isMd && content != null && <pre className="pv-pre">{content}</pre>}
          {!isImg && !isText && !loading && (
            <div className="pv-bin">
              {t('preview.binary')}{' '}
              <a href={url} download={file.name}>
                {file.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
