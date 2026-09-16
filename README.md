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
- **执行器**：每任务一个 `pi --mode rpc` 子进程（cwd = 任务工作目录）；P0 用 stub 模拟完整生命周期
- **跨平台**：Ubuntu / Windows 一致（`path.join`、按平台 spawn、沙盒插件非冲突）
- **状态机**：`queued → planning → [waiting_input] → executing → [blocked] → testing → awaiting_confirm → done`（另有 interrupted / failed / cancelled）
- **事件流**：每任务 seq 单调 + WS 断线按 `since` 重放

## P0 范围（当前）

看板列表 / 7+1 列看板 / 任务详情（打磨计划、分支回答、阻塞决策卡、验收、留言板 + steer 输入）/ 技能三级（全局只读 · 项目层继承 · 任务级手动安装）/ 设置（并发、分支策略、模型、全局系统提示词 + 历史）/ 双主题（Linear 风令牌，亮/暗）。

执行器为 **stub**（脚本化定时器模拟），用于联调 UI、调度、事件流、状态机。P1 接入真实 pi RPC 执行、P2 抢占/⌘K/恢复加固（见 docs/design/06-roadmap.md）。

## 目录

```
server/src/   db(schema) · bus(WS) · api(REST) · scheduler(状态机) · runner(stub 执行器, P1 替换) · skills(三级扫描/安装) · index(入口)
web/src/      styles(tokens+app) · lib(api/ws/md/fmt) · components(Layout) · pages(Boards/BoardDetail/TaskDetail/Skills/Settings)
docs/design/  设计文档包（00-06）
```
