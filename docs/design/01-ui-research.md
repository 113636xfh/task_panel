# 01 · UI 参考调研

> 按需求要求，设计前先联网检索参考案例。以下为检索来源与结论。

## 1. 参考来源

| # | 来源 | 类型 | URL |
|---|---|---|---|
| R1 | Linear 设计令牌全解析（DesignMD） | 设计系统 | https://designmd.cc/benchmarks/linear |
| R2 | Linear.app DESIGN.md（Hagicode） | 设计系统 | https://design.hagicode.com/designs/linear.app/DESIGN.md |
| R3 | Linear 2024 风格指南（Curio） | 风格分析 | https://designbycurio.com/learn/linear-2024 |
| R4 | AI Agent UI 设计模式库（Brainy，8 个产品拆解） | 模式库 | https://brainy.ink/paper/ai-agent-ui-design-patterns |
| R5 | Editor-Manager 表面分离模式（agentpatterns.ai） | 模式分析 | https://agentpatterns.ai/patterns/agent-design/editor-manager-surface-separation/ |
| R6 | Replit Agent 任务系统/任务板文档 | 产品文档 | https://docs.replit.com/features/agent/task-board |
| R7 | Cursor Agents Window 分析 | 产品分析 | https://www.learncursor.dev/learn/cursor-agents/agents-window |
| R8 | Vercel / Raycast（间接经 R1-R3 的通用结论） | 风格 | — |

## 2. 核心结论（直接驱动 Task Panel 设计）

### 2.1 视觉语言：Linear 式"工程克制"
- **近黑画布**（暗色）`#0f1011` 主面板 / `#08090a` 应用壳；深度用**明度台阶 + 1px 边框**表达，不用投影。
- **单一冷调强调色**（靛紫 `#5e6ad2` / `#7170ff`）：只用于交互态、激活项、进度，绝不装饰。
- **高密度排印**：Inter Variable（开 `cv01/ss03`），代码/路径/技术标识用等宽；字号紧凑递减，行距紧。
- **4px 基础网格**：`4/8/12/16/24/32`；圆角三档 `6px`（控件）/`12px`（容器）/`9999px`（徽章）。
- **微交互**：hover 背景微亮、active `scale(0.97)`、focus ring 用强调色柔光 `0 0 0 3px rgba(94,106,210,.3)`。
- 浅色主题按同一纪律推导（白/近白台阶 + 半透明黑边框 + 同一强调色），见 02 文档。

### 2.2 信息架构：Manager Surface 模式（R5）
并发 > 1 的 agent 编排，业界收敛为"**可扫读的任务行**"而非聊天流：
- 每行一任务，一句话说清"在做什么 / 需要什么 / 产出了什么"，不点开就知道状态（Claude Code `claude agents` 行摘要）。
- **原始 transcript 是错误粒度** → 看板只放聚合状态，完整活动流放任务详情页。
- Task Panel 映射：看板 = Manager Surface；任务详情 = 单任务深潜面。

### 2.3 看板：Replit 四列任务板（R6）
- 列 = 状态：`Drafts / Active / Ready / Done`，任务左→右移动。
- 任务卡内联设置（三-dot 菜单）：自动开关、取消、重命名。
- Task Panel 映射为 6 列（含待回答/待确认两个"需要人"的列），见 04 文档。

### 2.4 Agent 专属七模式（R4）→ 全部采纳
| 模式 | 采纳方式 |
|---|---|
| 任务框架 Task framing | 建任务表单：标题 + 描述 + 优先级 + 验收标准 + 分支模式，提交前可编辑（Linear 式"结构化再确认"） |
| 自主权控制 Autonomy controls | 分支问答模式开关（人工/自动+超时），创建时可见可改 |
| 计划面 Plan surface | **计划面与进度流是同一表面的两个状态**（Devin 模式）：打磨完成前计划可看；执行中同处打勾推进 |
| 进度流 Progress stream | 诚实流：每个工具调用、文件编辑、命令输出结构化流式展示；思考压缩为步骤级摘要但可展开（R4：streaming 摘要掩盖工具调用会毁掉信任） |
| 确认门 Confirmation gates | 三级：软（可撤销 banner）/硬（模态）/双步（模态+输入确认）。取消任务、共享工作目录用硬门 |
| 错误恢复 Error recovery | 验收失败：错误内联展示 + 自动重试计数（x/3）+ 超限转 `failed` 并保留完整上下文 |
| 交接 Artifact Handoff | 抢占/重试的 checkpoint = 结构化状态转储（session 文件 + 计划 + 摘要），恢复时 30 秒内可读清 |

## 3. 明确不采用

- Devin 式"完整工作区直播"（浏览器/终端/编辑器全开）——对多数任务太重，用进度流代替。
- 聊天式单一面板当主界面——并发场景下噪音/稀疏两头不讨好（R5）。
- 大面积彩色填充、装饰性投影——违背 Linear 纪律。
