/**
 * pi 扩展：task_panel 可观测性 —— 把本会话的 system prompt 全量 dump 到
 * <workspace>/.pi/tp/system-prompt.md，供面板「全部模式」展示完整会话。
 *
 * 仅 task_panel 的 pi 子进程启用（环境变量 TP_PANEL=1 守卫）；
 * 安装位置是各工作区的 <workspace>/.pi/extensions/（项目级），
 * 用户自己的 pi（全局 agent 目录里没有此文件）完全不受影响。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export default function tpObservability(pi: any) {
  if (process.env.TP_PANEL !== '1') return;
  const dump = (p: string) => {
    try {
      const dir = path.join(process.cwd(), '.pi', 'tp');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'system-prompt.md'), p, 'utf8');
    } catch {
      /* 观测失败不影响主流程 */
    }
  };
  // 每次推理前触发：e.systemPrompt = 链上各扩展拼接后的完整 system prompt
  pi.on('before_agent_start', (e: any) => {
    dump(String(e?.systemPrompt ?? ''));
  });
  // 压缩完成后的摘要，追加记录（覆盖写，保留最新一次）
  pi.on('session_compact', (e: any) => {
    const s = e?.compactionEntry?.summary;
    if (s) dump(`# 最近一次压缩摘要\n\n${String(s)}`);
  });
}
