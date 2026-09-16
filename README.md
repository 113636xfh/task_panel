# Task Panel

本地 Web 端任务编排 / 监控系统：为 Pi coding agent 提供「打磨（规划）→ 执行 → 测试/验收」的自主任务流，外加看板、优先级调度、阻塞决策、实时消息板与三级技能管理。

设计文档见 [docs/design/](docs/design/)（00 总览 → 06 路线图）。

## 快速开始

```bash
npm install
npm run build        # 构建前端 → dist/
npm start            # 单端口 8787：API + WebSocket + 静态文件
```

开发模式（热重载）：`npm run dev`（server tsx watch + vite 5173，代理 /api 与 /ws）。

- 界面：<http://localhost:8787>
- 端口可用 `TP_PORT` 覆盖；数据目录默认 `./data`（`TP_DATA_DIR` 可覆盖）

## 架构速览

- **单 Node 进程、单端口、零原生依赖**：express（API）+ ws（事件流）+ `node:sqlite`（WAL）
- **执行器**：每任务一个 `pi --mode rpc` 子进程（cwd = 任务工作目录）；JSONL 协议、agent_settled 判静止、`extension_ui_request` 无人值守自动应答
- **跨平台**：Ubuntu / Windows 一致（`path.join`、按平台 spawn、沙盒插件非冲突）
- **状态机**：`ready →（手动启动）→ queued → planning → [waiting_input] → executing → [blocked] → testing → awaiting_confirm → done`（另有 interrupted / failed / cancelled；done/awaiting_confirm 可无限返工回到 planning，复用同一会话）
- **事件流**：每任务 seq 单调 + WS 断线按 `since` 重放

## P1 核心闭环

看板列表 / 7+1 列看板 / 任务详情（打磨计划、分支回答、阻塞决策卡、验收、留言板 + 短留言 steer / 长提示词大编辑框 + 附图）/ 技能三级（全局只读 · 项目层继承 · 任务级手动安装）/ 设置（并发、分支策略、模型、全局系统提示词 + 历史）/ 双主题（Linear 风令牌，亮/暗）。

**真实 pi 执行**（P1）：每任务一个 `pi --mode rpc` 子进程，在工作目录内自主完成「规划（work/plan.json + 分支问答）→ 执行（plan 驱动，block.json 即停）→ 测试（test_cmd 走 RPC bash）→ 独立验收官逐项判定（work/review.json，最多 3 次重试，用尽转人工）」；执行中可实时 steer（下次 LLM 调用前生效）；阻塞/分支决策由用户拍板后自动恢复（`switch_session` 全量上下文重放 + 决策注入）；长提示词/附图机制同 P0.5（docs/design/05-architecture.md §9/§10）。

实测三条真实任务全链路通过：纯执行→done；分支 3 问 + 中途 steer 干预→done；执行中 block.json→用户拍板→带决策恢复→验收通过→done。

## P2 抢占与体验

- **优先级抢占**：槽位全满时，排队的 P0/P1 可抢占运行中的 P2/P3（stop runner + checkpoint + 自动断点恢复）；队列按 priority 排序。保守规则避免抖动。
- **⌘K 命令面板**：Ctrl/⌘+K 打开；搜看板/任务（含 #num）/动作（导航、新建看板/任务、切主题/语言）；↑↓ 选择、↵ 执行、Esc 关闭；`?new=1` 让看板/任务页自动展开新建入口。
- **事件流筛选/导出**：分组筛选（全部/消息/计划·执行/验收·阻塞/系统）+ 一键导出 JSON；前端直接消费 WS 事件（seq 去重，零额外请求）。
- **资产预览**：点工作产物/事件流里的文件 → 弹窗查看（图片直渲、JSON/代码/Markdown 全文展示、二进制给下载）。
- **服务重启恢复**：执行中任务转 interrupted + checkpoint，重启后自动断点恢复；优雅退出回收 pi 子进程。
- **前缀缓存安全**：全局系统提示词固定在 `<workspace>/.pi/APPEND_SYSTEM.md`（system 消息位，跨任务共享前缀）；任务交互全部 append-only（switch_session = 字节级重放）。
- **回归测试基建**：`npm test`（后端 15 项，stub 执行器 ~23s）/ `npm run test:ui`（puppeteer 人形 3 项）/ `npm run test:e2e`（真实 pi 冒烟）。

P2 实现细节与提交点见 docs/design/06-roadmap.md。

## P3 总表与完整过程（当前）

- **手动启动 + 无限返工**：新任务默认「待准备」（不占槽位、不排队），在总表点「启动」才入队；done/待确认可带留言无限次打回，复用同一会话（清 plan + work 文件，重新打磨）。
- **完整推理过程（full 模式）**：执行器转储 pi 的完整会话 —— 系统提示词（灰盒，可折叠，含压缩摘要）、各阶段注入（虚线框 + 规划/恢复/执行/验收标签）、用户留言（实线强调框）、助手气泡、思考（灰斜体）、工具调用/结果（代码框）、子代理（独立小框，槽位软约束 + 超限警告）。默认「摘要」模式只看关键事件，一键切换；事件筛选/导出两种模式通用。
- **四阶段总表看板**：首页 = 跨项目总表（打磨/执行/验收三列 + 行按项目分组），高亮随任务左→右移动，返工跳回；历史任务页按项目分组（完成/失败/取消 + 过滤）；侧栏可直接管理看板。
- **任务详情单屏终端式**：100vh 不滚动页面 —— 任务+描述钉顶、中间消息流唯一滚动区、底部 1/4 动作区（状态卡 / 计划·验收·产物 tabs）、状态条（当前动作 + 用时）、composer 永远在底。
- **提示词模板可配**：规划/执行/验收/返工四个阶段注入提示词均可在设置页编辑（`{{占位符}}` 渲染 + 一键恢复默认）。
- **会话长度**：全局默认 = 模型 contextWindow，可全局/逐任务覆盖；超限触发 pi 自动压缩（压缩摘要回写 full 模式）。
- **系统提示词观测**：项目级 pi 扩展（`<workspace>/.pi/extensions/tp-observability/`，零全局足迹）在 `before_agent_start` 转储完整 system prompt，首条消息前作为 `system_prompt` 事件入流。
- **主题**：蓝色默认强调色（可在设置切回 indigo）+ 字体大小缩放；toast 移至右上且不可点击（不遮挡 composer）。
- **回归**：后端 19 项 + UI 人形 3 项（含 full/摘要切换、返工、总表启动）；`npm test && npm run test:ui`。

P3 实现细节与提交点（M1a→M4）见 docs/design/06-roadmap.md。

## 测试

三层测试，由快到慢；日常回归跑前两层（秒级，无需 pi/模型服务）：

| 命令 | 内容 | 依赖 |
| --- | --- | --- |
| `npm test` | 后端 API 套件（node:test）：全生命周期 / 分支(手动+自动) / 阻塞决策 / 验收重试 / steer+留言 / 附图+防穿越 / 取消 / WS 实时+重放 / 重启恢复 / 优雅退出 / 优先级抢占 / P3（ready/rework/全量事件/设置钳制），19 项 | 无（stub 执行器，毫秒级） |
| `npm run test:ui` | UI 人形测试（puppeteer-core 驱动本机 Edge/Chrome）：建看板→建任务→分支逐题回答→确认→卡片入 done 列；steer 短/长留言、主题/语言切换；16 张截图在 `test/ui-artifacts/` | 本机浏览器（可用 `TP_BROWSER` 指定） |
| `npm run test:e2e` | 真实 pi + 真实模型服务的全链路冒烟（hello.txt 任务，验收+交付物落盘检查）；模型服务不可达时自动跳过 | pi 已登录 + vLLM 在线 |

后端测试用 `TP_EXECUTOR=stub` 起服务：`server/src/runner-stub.ts` 是确定性执行器（接口与真实 TaskRunner 一致），任务标题带标记切换剧本：`#branch` 分支问答 / `#block` 阻塞决策 / `#fail` 验收重试 / `#slow` 拉长执行窗口（steer/取消/重启）。改完代码后 `npm test && npm run test:ui` 即可回归。

## 目录

```
server/src/   db(schema) · bus(WS) · api(REST) · scheduler(状态机) · executor(PiSession, pi --mode rpc 封装) · runner(任务执行器: 规划/执行/阻塞/测试/验收/恢复) · runner-stub(测试用确定性执行器) · skills(三级扫描/安装) · index(入口)
web/src/      styles(tokens+app) · lib(api/ws/md/img/fmt) · i18n(zh/en) · components(Layout) · pages(Boards/BoardDetail/TaskDetail/Skills/Settings)
test/         helpers(起服/api/WS 基建) · backend.test(后端套件) · ui.test(UI 人形) · e2e-pi(真实冒烟)
docs/design/  设计文档包（00-06）
```
