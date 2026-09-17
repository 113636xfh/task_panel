async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  return r.json();
}

export const api = {
  boards: () => req<any[]>('/api/boards'),
  createBoard: (name: string) => req('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteBoard: (id: string) => req(`/api/boards/${id}`, { method: 'DELETE' }),
  projects: () => req<any[]>('/api/projects'),

  tasks: (boardId: string) => req<any[]>(`/api/boards/${boardId}/tasks`),
  tasksAll: () => req<any[]>('/api/tasks/all'),
  task: (id: string) => req<any>(`/api/tasks/${id}`),
  createTask: (boardId: string, body: any) => req(`/api/boards/${boardId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  createTaskLoose: (body: any) => req<{ id: string; num: number }>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  pause: (id: string) => req(`/api/tasks/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => req(`/api/tasks/${id}/resume`, { method: 'POST' }),
  patchTask: (id: string, body: any) => req(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  events: (id: string, since = 0) => req<any[]>(`/api/tasks/${id}/events?since=${since}`),
  assets: (id: string) => req<any[]>(`/api/tasks/${id}/assets`),
  blocks: (id: string) => req<any[]>(`/api/tasks/${id}/blocks`),
  answer: (id: string, answers: Record<string, string>) => req(`/api/tasks/${id}/answer`, { method: 'POST', body: JSON.stringify({ answers }) }),
  blockAnswer: (id: string, answer: string) => req(`/api/tasks/${id}/block-answer`, { method: 'POST', body: JSON.stringify({ answer }) }),
  confirm: (id: string) => req(`/api/tasks/${id}/confirm`, { method: 'POST' }),
  start: (id: string) => req(`/api/tasks/${id}/start`, { method: 'POST' }),
  rework: (id: string, body: { text: string; images?: number[] }) =>
    req(`/api/tasks/${id}/rework`, { method: 'POST', body: JSON.stringify(body) }),
  // 原生目录选择器（选已有项目目录；取消 → {cancelled:true}）
  pickDirectory: (cwd = '') => req<{ path?: string; cancelled?: boolean } | { error: string }>('/api/fs/pick-directory', { method: 'POST', body: JSON.stringify({ cwd }) }),
  cancel: (id: string) => req(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  message: (id: string, text: string, images?: number[]) => req(`/api/tasks/${id}/message`, { method: 'POST', body: JSON.stringify({ text, images }) }),
  // task images（长提示词附图）
  uploadImages: (id: string, files: { name: string; data: string }[]) =>
    req<{ images: { num: number; name: string; path: string }[]; added: { num: number; name: string; path: string }[] }>(`/api/tasks/${id}/images`, { method: 'POST', body: JSON.stringify({ files }) }),
  listImages: (id: string) => req<{ images: { num: number; name: string; path: string }[] }>(`/api/tasks/${id}/images`),
  fileUrl: (id: string, p: string) => `/api/tasks/${id}/file?p=${encodeURIComponent(p)}`,

  skills: () => req<any>('/api/skills'),
  installSkill: (taskId: string, name: string, kind: string, source: string) =>
    req('/api/skills/install', { method: 'POST', body: JSON.stringify({ taskId, name, kind, source }) }),
  removeSkill: (taskId: string, id: number) => req(`/api/skills/task/${taskId}/${id}`, { method: 'DELETE' }),

  settings: () => req<any>('/api/settings'),
  saveSettings: (b: any) => req('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
  sp: () => req<any>('/api/settings/system-prompt'),
  saveSp: (text: string) => req('/api/settings/system-prompt', { method: 'PUT', body: JSON.stringify({ text }) }),
  restoreSp: (id: number) => req('/api/settings/system-prompt/restore', { method: 'POST', body: JSON.stringify({ id }) }),

  runtime: () => req<any>('/api/runtime'),
};
