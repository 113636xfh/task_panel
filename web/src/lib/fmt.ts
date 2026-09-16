/** 状态/格式化工具。状态标签走 i18n：t('status.' + key)。 */

export function fmtTime(ts: number | string) {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDate(ts: number | string) {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ts)}`;
}

/** 原始时长（无本地化后缀）："3s" / "4m" / "2h" / "1d" */
export function fmtAgo(ts: number | string) {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function shortPath(p: string) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

export const STATUS_TONE: Record<string, string> = {
  queued: 'dim',
  planning: 'info',
  waiting_input: 'warn',
  executing: 'accent',
  blocked: 'err',
  testing: 'accent',
  awaiting_confirm: 'warn',
  done: 'ok',
  failed: 'err',
  interrupted: 'dim',
  cancelled: 'dim',
};

export const STATUS_COL: Record<string, string> = {
  queued: 'queued',
  planning: 'planning',
  waiting_input: 'waiting',
  executing: 'executing',
  blocked: 'blocked',
  testing: 'testing',
  awaiting_confirm: 'awaiting',
  done: 'done',
  failed: 'failed',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
};

export const ACTIVE = ['queued', 'planning', 'executing', 'testing'];
export const TERMINAL = ['done', 'failed', 'cancelled'];
