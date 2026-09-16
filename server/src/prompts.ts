// P3：阶段提示词模板（设置页可编辑；runner 渲染 {{占位符}}）。
// 设计约束（前缀缓存友好）：模板只影响注入到 user 消息的内容（append-only 会话），
// 全局系统提示词仍走 <workspace>/.pi/APPEND_SYSTEM.md（system 消息，稳定）。

export type PromptKey = 'plan' | 'exec' | 'judge' | 'rework';

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  // 打磨（规划）：占位符 title/description/acceptance/test_cmd/extra_prompt/skills/rework
  plan: `# 任务
{{title}}

# 需求描述（其中附图映射说明图片位置，可用 read 工具查看 work/images/ 下的图片）
{{description}}

# 验收标准（逐条）
{{acceptance}}

# 测试命令
{{test_cmd}}

# 本任务附加说明
{{extra_prompt}}

# 已安装到本工作目录的技能（可参考 .pi/ 下内容）
{{skills}}

{{rework}}
# 你的职责（规划阶段，只做规划，不要开始实现）
1. 批判性审视任务：边界条件、缺失约束、风险、隐含假设；
2. 拆分为 3-7 个可执行步骤，每步有具体 goal 与可操作 actions；
3. 找出真正需要用户决策的分歧点（0-3 个），每个给出 2-4 个选项、推荐项与超时默认值；
4. 把计划【只】写入 work/plan.json（UTF-8），schema 严格为：
{
  "summary": "一句话总览（含主要风险）",
  "steps": [{"id":"s1","title":"…","goal":"…","actions":["…"],"done":false}],
  "branch_questions": [{"id":"q1","q":"…","options":[{"label":"…","recommended":true},{"label":"…"}],"default":"默认选项的 label"}],
  "acceptance": ["逐条、可验证"],
  "test_cmd": "…或空字符串"
}
5. 写完 work/plan.json 立即停止。不要修改任何业务代码，不要写其他文件。`,

  // 执行：静态执行要求（动态的计划/分支/留言/额外块由 runner 拼接在此模板之前/之后）
  exec: `# 执行要求
1. 按步骤顺序执行未完成步骤；每完成一步，把该步 done 置 true 并写回 work/plan.json；
2. 在本目录自由使用工具（read/edit/write/bash 等）完成实现；
3. 若遇到【无法自行决断且无法自行验证】的取舍：立即停止一切工作，把以下 JSON 写入 work/block.json，然后结束当前回合等待用户决策：
{"question":"…","context":{"current":"…","verified":"…","impact":"…","refs":["…"]},"options":[{"label":"…","pros":"…","cons":"…","estimate":"…"},{"label":"…","pros":"…","cons":"…","estimate":"…"}],"recommended":"A"}
   （options 2-4 个；recommended 为推荐项字母）
4. 全部步骤完成后：写 work/done.json：
{"summary":"交付总结（markdown；可引用文件路径；可贴图，格式 ![[图 N 说明]](相对路径)）","changes":["主要改动"],"images":["work/xx.png（可选）"]}
   并在最终回复中给出同样的交付总结；
5. 除 work/plan.json、work/block.json、work/done.json 外，不要创建其他协议文件；
6. 如需派 sub agent 并行：先确认任务面板有空闲槽位（.pi/tp/slot-info，面板实时写入）；无空位时改为自己串行完成。`,

  // 验收：占位符 test_cmd（已含“无测试命令”兜底文案）/code（已含 N/A 兜底）/items
  judge: `# 验收判定（你现在是独立验收官，与实现者角色分离）
客观测试结果：命令 \`{{test_cmd}}\`，退出码 {{code}}（完整输出见上方 bash 记录）。

请按以下验收标准逐项独立判定（可用工具复核代码/文件），然后把结果写入 work/review.json：
{{items}}
（结构：{"items":[{"criterion":"…","pass":true|false,"evidence":"依据（引用文件路径/测试输出/代码位置）"}],"overall":"pass|fail","note":"…"}）

规则：
- 全部 pass 才能 overall=pass；
- 测试命令非 0 退出且无法合理解释，必须 fail；
- 无测试命令时以验收标准逐项核查为准；
- 若执行中发生过阻塞且用户已拍板，最终状态以用户决策为准（与早期计划中阶段性要求冲突时，用户决策优先）。写完 work/review.json 立即停止，不要改任何业务代码。`,

  // 返工：占位符 msgs（用户打回留言，逐条 > 引用）
  rework: `# 用户返工反馈（最高优先级，必须在重新打磨中落实）
{{msgs}}

请据此【重新打磨】：先更新 work/plan.json（重写步骤，已完成的保留 done=true 并说明），然后按执行要求继续。`,
};

/** 渲染 {{var}} 占位符；未知占位符原样保留 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** 取用户设置里的模板；缺省/非法 → 默认 */
export function getPromptTpl(
  s: Record<string, unknown> | undefined,
  key: PromptKey,
): string {
  const t = s?.promptTemplates;
  const v = t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' && v.trim() ? v : PROMPT_DEFAULTS[key];
}
