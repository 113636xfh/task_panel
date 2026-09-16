export function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ts)}`;
}

export function fmtAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)}m 前`;
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`;
  return `${Math.floor(s / 86400)}d 前`;
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

export const STATUS_LABEL: Record<string, string> = {
  queued: '待打磨',
  planning: '打磨中',
  waiting_input: '待回答',
  executing: '执行中',
  blocked: '阻塞',
  testing: '验收中',
  awaiting_confirm: '待确认',
  interrupted: '可恢复',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
};
