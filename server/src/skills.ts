import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, getSettings } from './db.js';

export type SkillItem = { name: string; description: string; path: string; source: string; kind: 'skill' | 'extension' };

function readFrontmatter(p: string): { name?: string; description?: string } {
  try {
    const text = fs.readFileSync(p, 'utf8').slice(0, 6000);
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm: { name?: string; description?: string } = {};
    if (m) {
      const fmText = m[1];
      const nm = fmText.match(/^name:\s*(.+)$/m);
      const ds = fmText.match(/^description:\s*(.+)$/m);
      if (nm) fm.name = nm[1].trim().replace(/^["']|["']$/g, '');
      if (ds) {
        let d = ds[1].trim().replace(/^["']|["']$/g, '');
        // YAML 块标量（>- / |）：取下一非空行
        if (/^[>|][-+]?$/.test(d)) {
          const after = ds[0].replace(/^description:/, '') + '\n' + (fmText.slice(fmText.indexOf(ds[0]) + ds[0].length));
          const line = after.split('\n').slice(1).map((x) => x.trim()).find((x) => x && !x.startsWith('#'));
          d = line ?? '';
        }
        fm.description = d;
      }
    }
    return fm;
  } catch {
    return {};
  }
}

function dirExists(p: string) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** 扫描 skill 目录：子目录含 SKILL.md，或根级 .md（.pi 系目录） */
function scanSkills(dir: string, source: string): SkillItem[] {
  const out: SkillItem[] = [];
  if (!dirExists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const md = path.join(dir, e.name, 'SKILL.md');
      if (fs.existsSync(md)) {
        const fm = readFrontmatter(md);
        out.push({ name: fm.name ?? e.name, description: fm.description ?? '', path: path.join(e.name), source, kind: 'skill' });
      }
    }
  }
  return out;
}

function scanExtensions(dir: string, source: string): SkillItem[] {
  const out: SkillItem[] = [];
  if (!dirExists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.ts')) out.push({ name: e.name.replace(/\.ts$/, ''), description: '', path: e.name, source, kind: 'extension' });
    else if (e.isDirectory() && fs.existsSync(path.join(p, 'index.ts'))) out.push({ name: e.name, description: '', path: e.name, source, kind: 'extension' });
  }
  return out;
}

export function globalItems(): { skills: SkillItem[]; extensions: SkillItem[] } {
  const home = os.homedir();
  const skills = [
    ...scanSkills(path.join(home, '.pi', 'agent', 'skills'), 'global'),
    ...scanSkills(path.join(home, '.agents', 'skills'), 'global'),
  ];
  const extensions = scanExtensions(path.join(home, '.pi', 'agent', 'extensions'), 'global');
  // 去重（同名保第一个）
  const seen = new Set<string>();
  return {
    skills: skills.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true))),
    extensions,
  };
}

export function projectItems(dir: string): { dir: string; skills: SkillItem[]; extensions: SkillItem[] } {
  return {
    dir,
    skills: scanSkills(path.join(dir, '.pi', 'skills'), `project:${dir}`),
    extensions: scanExtensions(path.join(dir, '.pi', 'extensions'), `project:${dir}`),
  };
}

/** 全量清单：全局 / 项目（各共享目录）/ 任务级 */
export function inventory() {
  const g = globalItems();
  const settings = getSettings();
  const base = (settings.workspacesBase as string) ?? '';
  // 项目层：只列非 fresh 工作目录（独立新目录属于任务私有，不算共享项目层）
  const rows = db.prepare('SELECT DISTINCT workspace_path FROM tasks').all() as { workspace_path: string }[];
  const projects = rows
    .map((r) => projectItems(r.workspace_path))
    .filter((p) => !base || !p.dir.replace(/\\/g, '/').toLowerCase().startsWith(base.replace(/\\/g, '/').toLowerCase()));
  // 任务级
  const taskRows = db.prepare(
    'SELECT ts.*, t.title, t.board_id FROM task_skills ts JOIN tasks t ON t.id = ts.task_id ORDER BY ts.installed_at'
  ).all() as (SkillItem & { task_id: string; title: string; board_id: string })[];
  const tasks: Record<string, { title: string; boardId: string; items: SkillItem[] }> = {};
  for (const r of taskRows) {
    if (!tasks[r.task_id]) tasks[r.task_id] = { title: r.title, boardId: r.board_id, items: [] };
    tasks[r.task_id].items.push({ name: r.name, description: '', path: r.path, source: r.source, kind: r.kind as 'skill' | 'extension' });
  }
  return { global: g, projects, tasks };
}

function findItem(name: string, kind: 'skill' | 'extension', source: string): SkillItem | null {
  const inv = inventory();
  if (source === 'global') {
    return (kind === 'skill' ? inv.global.skills : inv.global.extensions).find((x) => x.name === name) ?? null;
  }
  if (source.startsWith('project:')) {
    const dir = source.slice('project:'.length);
    const p = inv.projects.find((x) => x.dir === dir);
    return p ? (kind === 'skill' ? p.skills : p.extensions).find((x) => x.name === name) ?? null : null;
  }
  return null;
}

function copyRecursive(src: string, dst: string) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) copyRecursive(path.join(src, e), path.join(dst, e));
  } else fs.copyFileSync(src, dst);
}

/** 把某技能/扩展安装到任务 workspace 的 .pi/（任务级，仅该任务生效） */
export function installToTask(
  taskId: string,
  taskWorkspace: string,
  name: string,
  kind: 'skill' | 'extension',
  source: string
): { ok: boolean; error?: string } {
  const item = findItem(name, kind, source);
  if (!item) return { ok: false, error: `未找到 ${kind} "${name}" (source=${source})` };
  const baseDir =
    kind === 'skill'
      ? path.join(taskWorkspace, '.pi', 'skills', item.name)
      : path.join(taskWorkspace, '.pi', 'extensions', item.path);
  if (fs.existsSync(baseDir)) return { ok: true }; // 已存在
  const srcAbs =
    source === 'global'
      ? kind === 'skill'
        ? path.join(os.homedir(), '.pi', 'agent', 'skills', item.path)
        : path.join(os.homedir(), '.pi', 'agent', 'extensions', item.path)
      : path.join(source.slice('project:'.length), '.pi', kind === 'skill' ? 'skills' : 'extensions', item.path);
  try {
    copyRecursive(srcAbs, baseDir);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  db.prepare('INSERT INTO task_skills (task_id, name, kind, source, path, installed_at) VALUES (?,?,?,?,?,?)').run(
    taskId, name, kind, source, item.path, Date.now()
  );
  return { ok: true };
}

export function removeTaskSkill(id: number) {
  const row = db.prepare('SELECT * FROM task_skills WHERE id=?').get(id) as
    | { task_id: string; name: string; kind: string; path: string }
    | undefined;
  if (!row) return { ok: false, error: 'not found' };
  const task = db.prepare('SELECT workspace_path FROM tasks WHERE id=?').get(row.task_id) as { workspace_path: string } | undefined;
  if (task) {
    const p =
      row.kind === 'skill'
        ? path.join(task.workspace_path, '.pi', 'skills', row.name)
        : path.join(task.workspace_path, '.pi', 'extensions', row.path);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM task_skills WHERE id=?').run(id);
  return { ok: true };
}
