# 06 · 实施路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 骨架** | 仓库工程化（server/web workspaces）；DB schema + 迁移；REST 基础（boards/tasks CRUD）；WS 事件总线（seq + 补拉）；UI 框架：侧栏/顶栏/令牌 CSS（双主题）/组件最小集；看板列表 + 看板六(七)列渲染（mock 数据可点） | 双主题下页面可跑，状态/角标联动 |
| **P1 核心闭环** | pi RPC 执行器（spawn/事件投影/留言板实时流）；规划阶段（grade me → plan.json + 分支问答两模式 + 超时自动）；执行阶段（plan 驱动）；blocked 机制（block.json 侦测 + 决策卡 + 回答恢复）；测试验收（test 命令 + Judge 评审 + 重试 ≤3 + 人工确认）；工作区管理（独立/共享 + 冲突等待）；Skills & 扩展页（扫描 + 任务级安装） | 一条真实任务从创建到 done 全程无人工干预（除分支回答/确认） |
| **P2 抢占与体验** | 抢占/恢复（abort + checkpoint + session resume 全量重放）；命令面板 ⌘K；日志流筛选/导出；资产预览/zip 导出；服务重启恢复；设置页全量项 | 抢占演练通过；重启后活跃任务正确转 interrupted 并可恢复 |

**git 纪律**
- 分支：`main` 直推（单机单人）；每个可运行里程碑一个 commit 批次，信息 `feat/fix: <范围> — <内容>`
- 里程碑提交点：P0 骨架 / P1 执行器 / P1 规划+问答 / P1 验收闭环 / P1 Skills 页 / P2 抢占 / P2 体验
- 提交前必过：`tsc --noEmit`（两包）+ 手动冒烟
