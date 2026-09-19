import { useI18n } from '../i18n';

// 通用确认弹窗（取消/删除等破坏性操作）
export default function ConfirmDialog({
  title,
  message,
  confirmText,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal confirm-modal" role="dialog" data-testid="confirm-dialog">
        <div className="m-h">{title}</div>
        <div className="m-b">
          <p className="confirm-msg">{message}</p>
        </div>
        <div className="m-f">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('boards.cancel')}
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            data-testid="confirm-ok"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
