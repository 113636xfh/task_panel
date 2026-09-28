# 06 · 实施路线

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **P0 骨架** | 仓库工程化（server/web workspaces）；DB schema + 迁移；REST 基础（boards/tasks CRUD）；WS 事件总线（seq + 补拉）；UI 框架：侧栏/顶栏/令牌 CSS（双主题）/组件最小集；看板列表 + 看板六(七)列渲染（mock 数据可点） | 双主题下页面可跑，状态/角标联动 | ✅ 完成（`cab153e`，i18n `31352ad`，长提示词+附图 `82ce5d3`） |
| **P1 核心闭环** | pi RPC 执行器（spawn/事件投影/留言板实时流）；规划阶段（grade me → plan.json + 分支问答两模式 + 超时自动）；执行阶段（plan 驱动）；blocked 机制（block.json 侦测 + 决策卡 + 回答恢复）；测试验收（test 命令 + Judge 评审 + 重试 ≤3 + 人工确认）；工作区管理（独立/共享 + 冲突等待）；Skills & 扩展页（扫描 + 任务级安装） | 一条真实任务从创建到 done 全程无人工干预（除分支回答/确认） | ✅ 完成（`1dd4975` + 阻塞/验收官修复）：实测 3 条真实任务——纯执行→done；分支 3 问→回答+steer 中途干预→done；执行中 block.json→用户拍板→带决策恢复→验收通过→done |
| **P2 抢占与体验** | 抢占/恢复（abort + checkpoint + 自动续跑）；命令面板 ⌘K；事件流筛选/导出；资产预览；服务重启恢复；全量回归测试基建 | 抢占演练通过；重启后活跃任务正确转 interrupted 并可恢复 | ✅ 完成（重启恢复 + 前缀缓存审计 `6e8376f`；测试基建 `be89799`；⌘K + feed 筛选/导出 `9537e19`；资产预览 `b16d245`；优先级抢占 `939b81c`）。资产 zip 导出延后到 P3 |
| **P3 总表与完整过程** | `ready` 手动启动 + 无限返工（复用会话）；完整 message 事件流（注入/思考/工具调用/结果）；full/摘要双模式（不同 box + 小标签）；阶段注入提示词模板可配；全局会话长度（contextWindow）；系统提示词转储（项目级扩展）；子代理独立行 + 槽位软约束；四阶段总表看板（首页=跨项目总表，行按项目分组，高亮左→右移动）；历史任务页 + 侧栏看板管理；任务详情单屏终端式；蓝色默认主题 + 强调色/字体大小；toast 防遮挡 | 后端 19 项 + UI 人形 3 项全绿；真实 pi 全链路冒烟通过 | ✅ 完成（M1a `1f9b543`；M1b `931d0d2`；M2 `f86ab71`；M3 `2b8df29`；M4 `834cb05`；M5 文档/版本标签/回归） |
| **P3.5 会话导入** | 扫描 `~/.pi/agent/sessions`（`TP_SESSIONS_DIR` 可覆盖）；项目看板页「导入会话」弹窗（按项目分组 / 搜索 / 多选 / 默认隐藏 Task Panel 自身会话）；JSONL → 任务事件全量落库（保留原始时间戳；thinking/toolCall/toolResult 映射与 full 模式渲染口径一致，单段 20k 字符截断）；导入为 `done` 任务，workspace = 原会话 cwd（产物/提问/返工都指向原目录）；checkpoint → 原会话文件（返工时 pi `switch_session` 接续原会话）；原目录 `work/*.json` 收录为资产；导入任务自动切「全部」模式 | 后端 28 项全绿（含会话导入 1 项：列表/导入/防穿越/重复导入）；UI 冒烟：导入 → 完整消息流渲染 → 返工入口可用 | ✅ 完成 |

**P1 实现备注（与最初设计的差异）**
- 每个任务 = 一个 `pi --mode rpc` 子进程（独立会话文件），崩溃/取消即回收；断点恢复 = 新进程 + `switch_session` 全量上下文重放。
- 验收官标准优先级：任务创建时的原始验收标准 > 规划期推导的 plan.acceptance（避免阻塞决策后旧标准过时误判）；阻塞决策会写入恢复提示词，agent 不会重走「写 block.json」步骤。
- 分支/阻塞的「回答后恢复」统一走 queued → resume 路径，用户留言/决策文本合入下一个执行点。
- `extension_ui_request`（用户交互型扩展）由执行器无人值守自动应答：confirm→允许、select→首项、input/editor→取消，并记 system 事件。

**P2 实现备注**
- 抢占规则保守：仅 P0/P1 可抢、只抢运行中的 P2/P3、同级不抢 → 无抖动；被抢占任务带 checkpoint（`at_status=preempted`）转 interrupted，tick 自动断点恢复。队列侧按 `priority ASC, created_at ASC` 排序（P0 最高）。
- ⌘K 命令面板：搜看板/任务（含 #num）/动作；`?new=1` 让看板/任务页自动展开新建入口；全局 Esc 关闭（焦点丢失也能关）。
- 事件流：分组筛选（全部/消息/计划·执行/验收·阻塞/系统）+ 一键导出 JSON；TaskDetail 直接消费 WS 携带的事件（seq 去重），消除每条消息一次 HTTP 拉取（历史回放场景 14 次 → 1 次）。
- 资产预览：图片直渲、文本/JSON/代码/Markdown 全文展示（md 用 MD 渲染）、二进制给下载；asset 事件/落库补 `path` 字段。
- 测试基建：`npm test`（15 项后端，stub 执行器 ~23s）/ `npm run test:ui`（3 项 puppeteer 人形）/ `npm run test:e2e`（真实 pi 冒烟）；详见 README「测试」。

**P3.5 实现备注（会话导入）**
- 会话来源：`~/.pi/agent/sessions/<cwd 编码>/*.jsonl`，每行一个事件（session/model_change/message/custom_message…）；`message.content` 的 part 类型（text/thinking/toolCall/toolResult）与 Task Panel 的 `message` 事件 parts 同构，映射后前端 full 模式零改动渲染。
- 导入即「已完成」：不占槽位、不触发调度；标题/描述取首条用户消息（可覆盖）；`sort_order` 落同优先级最下。
- 返工接续：checkpoint_json.session_file 指向原 JSONL（不拷贝、不改动原文件）；返工/提问时 pi `switch_session` 直接读原会话文件。
- 安全：导入路径必须位于会话根目录内且以 `.jsonl` 结尾（防穿越）；自身会话（本项目根/workspaces）默认隐藏，可勾选显示。

**git 纪律**
- 分支：`main` 直推（单机单人）；每个可运行里程碑一个 commit 批次，信息 `feat/fix: <范围> — <内容>`
- 里程碑提交点：P0 骨架 / P1 执行器 / P1 规划+问答 / P1 验收闭环 / P1 Skills 页 / P2 抢占 / P2 体验 / P3 M1（ready/rework/全量事件/模板/会话长度）/ P3 M2（主题字体/设置）/ P3 M3（四阶段总表+历史）/ P3 M4（详情单屏终端式）
- 提交前必过：`tsc --noEmit`（两包）+ 手动冒烟
