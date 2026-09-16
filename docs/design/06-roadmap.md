# 06 · 实施路线

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **P0 骨架** | 仓库工程化（server/web workspaces）；DB schema + 迁移；REST 基础（boards/tasks CRUD）；WS 事件总线（seq + 补拉）；UI 框架：侧栏/顶栏/令牌 CSS（双主题）/组件最小集；看板列表 + 看板六(七)列渲染（mock 数据可点） | 双主题下页面可跑，状态/角标联动 | ✅ 完成（`cab153e`，i18n `31352ad`，长提示词+附图 `82ce5d3`） |
| **P1 核心闭环** | pi RPC 执行器（spawn/事件投影/留言板实时流）；规划阶段（grade me → plan.json + 分支问答两模式 + 超时自动）；执行阶段（plan 驱动）；blocked 机制（block.json 侦测 + 决策卡 + 回答恢复）；测试验收（test 命令 + Judge 评审 + 重试 ≤3 + 人工确认）；工作区管理（独立/共享 + 冲突等待）；Skills & 扩展页（扫描 + 任务级安装） | 一条真实任务从创建到 done 全程无人工干预（除分支回答/确认） | ✅ 完成（`1dd4975` + 阻塞/验收官修复）：实测 3 条真实任务——纯执行→done；分支 3 问→回答+steer 中途干预→done；执行中 block.json→用户拍板→带决策恢复→验收通过→done |
| **P2 抢占与体验** | 抢占/恢复（abort + checkpoint + session resume 全量重放）；命令面板 ⌘K；日志流筛选/导出；资产预览/zip 导出；服务重启恢复；设置页全量项 | 抢占演练通过；重启后活跃任务正确转 interrupted 并可恢复 | ⏳ 待做 |

**P1 实现备注（与最初设计的差异）**
- 每个任务 = 一个 `pi --mode rpc` 子进程（独立会话文件），崩溃/取消即回收；断点恢复 = 新进程 + `switch_session` 全量上下文重放。
- 验收官标准优先级：任务创建时的原始验收标准 > 规划期推导的 plan.acceptance（避免阻塞决策后旧标准过时误判）；阻塞决策会写入恢复提示词，agent 不会重走「写 block.json」步骤。
- 分支/阻塞的「回答后恢复」统一走 queued → resume 路径，用户留言/决策文本合入下一个执行点。
- `extension_ui_request`（用户交互型扩展）由执行器无人值守自动应答：confirm→允许、select→首项、input/editor→取消，并记 system 事件。

**git 纪律**
- 分支：`main` 直推（单机单人）；每个可运行里程碑一个 commit 批次，信息 `feat/fix: <范围> — <内容>`
- 里程碑提交点：P0 骨架 / P1 执行器 / P1 规划+问答 / P1 验收闭环 / P1 Skills 页 / P2 抢占 / P2 体验
- 提交前必过：`tsc --noEmit`（两包）+ 手动冒烟
