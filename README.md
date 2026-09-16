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
- **状态机**：`queued → planning → [waiting_input] → executing → [blocked] → testing → awaiting_confirm → done`（另有 interrupted / failed / cancelled）
- **事件流**：每任务 seq 单调 + WS 断线按 `since` 重放

## P1 核心闭环（当前）

看板列表 / 7+1 列看板 / 任务详情（打磨计划、分支回答、阻塞决策卡、验收、留言板 + 短留言 steer / 长提示词大编辑框 + 附图）/ 技能三级（全局只读 · 项目层继承 · 任务级手动安装）/ 设置（并发、分支策略、模型、全局系统提示词 + 历史）/ 双主题（Linear 风令牌，亮/暗）。

**真实 pi 执行**（P1）：每任务一个 `pi --mode rpc` 子进程，在工作目录内自主完成「规划（work/plan.json + 分支问答）→ 执行（plan 驱动，block.json 即停）→ 测试（test_cmd 走 RPC bash）→ 独立验收官逐项判定（work/review.json，最多 3 次重试，用尽转人工）」；执行中可实时 steer（下次 LLM 调用前生效）；阻塞/分支决策由用户拍板后自动恢复（`switch_session` 全量上下文重放 + 决策注入）；长提示词/附图机制同 P0.5（docs/design/05-architecture.md §9/§10）。

实测三条真实任务全链路通过：纯执行→done；分支 3 问 + 中途 steer 干预→done；执行中阻塞→用户拍板→带决策恢复→验收通过→done。P2 抢占/⌘K/恢复加固见 docs/design/06-roadmap.md。

## 测试

三层测试，由快到慢；日常回归跑前两层（秒级，无需 pi/模型服务）：

| 命令 | 内容 | 依赖 |
| --- | --- | --- |
| `npm test` | 后端 API 套件（node:test）：全生命周期 / 分支(手动+自动) / 阻塞决策 / 验收重试 / steer+留言 / 附图+防穿越 / 取消 / WS 实时+重放 / 重启恢复 / settings 钳制，14 项 | 无（stub 执行器，毫秒级） |
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
