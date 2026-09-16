# 05 · 系统架构

## 1. 进程拓扑

```
task-panel (Node/TS 单进程)
├─ HTTP 服务        Express: REST API + 静态文件(dist)
├─ WebSocket 服务    ws: 事件推送（断线补拉）
├─ 调度器 Scheduler  状态机 + 并发池 + 优先级队列 + 抢占
├─ 执行器池 ExecutorPool
│   ├─ pi 子进程 #1  (pi --mode rpc, cwd=workspace/t-1, JSONL over stdin/stdout)
│   └─ pi 子进程 #2  (...)
├─ 评审器 Judge      验收阶段的短上下文 pi 子进程（复用执行器协议）
└─ SQLite            data/taskpanel.db (better-sqlite3, WAL)
```

## 2. 目录结构

```
task_panel/
├─ package.json            (workspaces: server / web)
├─ server/
│   ├─ src/
│   │   ├─ api/            REST 路由 (boards/tasks/skills/settings/runtime)
│   │   ├─ ws/             WebSocket 事件总线（seq 序号 + 补拉）
│   │   ├─ scheduler/      状态机、优先级队列、并发池、抢占逻辑
│   │   ├─ executor/       PiExecutor（rpc 子进程封装）、事件→DB/WS 投影
│   │   ├─ judge/          验收评审器
│   │   ├─ skills/         全局/项目 skill+extension 扫描器
│   │   ├─ db/             schema.sql + 迁移
│   │   └─ index.ts
├─ web/                    Vite + React + TS
│   ├─ src/
│   │   ├─ app/            路由 (boards / task / skills / settings)
│   │   ├─ components/     按 02 文档的组件最小集
│   │   ├─ styles/         tokens.css（02 文档令牌）
│   │   └─ ws/             事件客户端（重连 + seq 补拉）
├─ workspaces/             每任务工作区（gitignore）
├─ data/                   SQLite（gitignore）
└─ docs/design/            本设计稿包
```

## 3. 任务状态机

```
                 ┌───────────(超时自动/已答)──────────┐
                 v                                    │
queued → planning → waiting_input ─────────────────────┤
   ▲      │           (仅人工模式)                      │
   │      ▼                                            │
   │  (规划完成: plan.json + questions)                  │
   │      executing ────────────────────────────────────┘
   │      ▲  │        抢占: SIGTERM pi 进程 → 落 checkpoint
   │      │  ▼
   │  interrupted ◄────────────────────────────────────┘
   │      │   (释放槽位; 高优先级任务进入; 本任务保留优先级重新排队)
   │      └──→ executing (新进程, 全量重放 session)
   │      │
   │      └── agent 写入 work/block.json → blocked(阻塞待决策)
   │          不占槽; 默认无限等待(必须用户亲自拍板); 回答后 resume → executing
   │      │
   └──────┴── executing 完成 → testing
                              testing: ① 跑任务 test 命令  ② Judge 逐项评审验收清单
                              通过 → awaiting_confirm（用户点"确认完成"）→ done
                              不通过 → 重试(≤3): 把失败反馈写入任务上下文 → 回 executing
                              超限 / 进程异常 → failed
任意非终态 → cancelled（用户, 硬确认, 不可恢复）
```

**槽位规则**
- 一个任务从 `planning` 起占用 1 个并发槽，直到 `awaiting_confirm`/`failed`/`cancelled` 释放
- `waiting_input` 与 `blocked` **不占槽**（等待用户，不能卡住队列）；用户回答/决策后重新排队等槽
- 阶段间（planning→executing）进程各自独立：规划进程完成后即退出释放 KV cache；执行进程全新起（长上下文 180K）

## 4. pi 执行协议（核心）

每个任务阶段 = 一个 pi 子进程，`pi --mode rpc`：

```
spawn("pi", ["--mode","rpc",
             "--provider","local-vllm",
             "--model","local-vllm/Qwen3.8-27B-W4A16-AWQ",
             ...(finalPrompt ? ["--system-prompt", finalPrompt] : [])],
      { cwd: taskWorkspace })
```

- **输入**（stdin, JSONL）：`{"type":"prompt","message":<阶段提示词>}`
- **跨平台**：`spawn("pi", args, { shell: process.platform === "win32" })`（Windows 下 npm 全局 pi 是 `pi.cmd` shim）；Linux 直接 spawn；`--session-dir` 用绝对路径（Windows 盘符无碍）；测试命令：Linux `sh -c <cmd>` / Windows `cmd /d /s /c <cmd>`，超时 kill
- **输出**（stdout, JSONL 事件流）：`message_start/update/end`、`tool_execution_start/update/end`、`turn_start/end`、`agent_start/end` 等
- **首行** `{"type":"session",...}` 含 session id；pi 将 session 持久化为 JSONL 文件（`--session-dir <workspaces/t-X/.pi-sessions>`）
- **终止**：`{"type":"abort"}` 后 SIGTERM；进程退出码与 stderr 落库
- **恢复（全量重放）**：重新 spawn 时指向同一 session 文件（resume），pi 载入完整历史，再 `prompt` 发送"继续执行"指令。留言板 = 该 session 事件流的持久化投影（`task_events` 表），前端渲染即留言板。

**沙盒插件非冲突（Gondolin / Docker / OpenShell 等，可选装）**
- 沙盒扩展是全局扩展（`~/.pi/agent/extensions/`，如 gondolin 将内置 read/write/edit/bash/grep/find/ls 路由进 micro-VM，宿主 cwd 挂为 /workspace 写回宿主）；Task Panel spawn 不改 `PI_CODING_AGENT_DIR`、不传禁用/覆盖扩展的参数 → 沙盒扩展自然生效，未装则行为不变
- 项目级 `.pi/extensions`（Task Panel 安装的技能/扩展）与全局沙盒扩展共存，加载顺序由 pi 自身处理
- **验收测试不走宿主机 spawn**：`test_cmd` 通过 pi RPC `bash` 命令或执行 agent 自身 bash 工具运行 → 与沙盒同一策略；P1 实现，P0 stub 不执行真实命令

### 4.0 系统提示词合成与技能生效集

**系统提示词（两组）**
1. **全局**（设置页维护）：settings 表 `agent_system_prompt {text, at}`；历史保留 5 版（`prompt_history`）
2. **任务专属**（创建模态补充框，可选）：`tasks.extra_prompt`

```
final = 有全局 ? (有专属 ? 全局 + "\n\n【任务专属指令】\n" + 专属 : 全局)
            : (有专属 ? "【任务专属指令】\n" + 专属 : (不传 --system-prompt, 用 pi 默认))
```
- **每次进程新起/恢复时读取最新版**：中断恢复的任务也用新的全局提示词（用户明确要求）；已运行中的会话不受影响
- 仅通过子进程参数传入，不碰 `~/.pi/agent/`，全局 pi CLI 不受影响（pi 文档：`--system-prompt` 只替换该会话默认提示词，context files 与 skills 照常附加）

**技能生效集（三层继承）**
1. 全局 `~/.pi/agent/skills|extensions`（+ `~/.agents/skills`）——所有任务默认继承，页面只读
2. 项目层：任务为「共享项目目录」时，该目录 `.pi/skills|extensions` 全目录任务共享（任一任务添加 → 同目录任务自动继承）
3. 任务级：UI 手动添加 → 复制到该任务 workspace `.pi/`，仅该任务生效

**用户留言（steer 通道）**
- 任务活跃且有 pi 进程：流式进行中发 `{"type":"steer","message"}`（当前工具轮结束后、下次 LLM 调用前注入）；非流式发 `prompt`
- 任务非活跃（queued/blocked/waiting_input 等）：写入 `task_user_msgs` 队列，下次启动/恢复时拼入提示词
- 所有留言落 `task_events`（kind=user_message）并广播 `task.user_message`

### 4.1 阶段提示词

**规划（打磨, "grade me" 式）**
```
你是一名严苛的任务评审官。请对下面的任务描述做"grade me"式审视：
1) 逐条指出描述中的模糊点、缺失约束与风险；
2) 将其细化为可执行的分步计划（每步: 目标/动作/完成判据，5-10 步）;
3) 列出必须由人拍板的分支问题（≤5 个，每个给出 2-4 个选项 + 你的推荐默认及理由）;
4) 给出验收标准清单（可客观判定的条目）与测试命令建议。
将结果严格写入 work/plan.json（schema 见下），并在聊天中给出 3 句内的总评。
原始任务: <title + description>
验收标准(用户填): <acceptance>
```
`plan.json`: `{ summary, steps:[{id,title,goal,actions,done_criteria}], branch_questions:[{id,q,options:[{label,recommended?}],default}], acceptance:[{id,criterion,objective?}], test_cmd?, assets? }`

**执行**
```
按 work/plan.json 继续/开始执行任务 <title>。
分支问题已定: <answers>
约束: 工作目录为当前目录; 每完成一步在会话中明确宣告"步骤 N 完成"; 完成后按验收清单自查并运行 <test_cmd>。
【阻塞规则】遇到你无法自行决断的事(歧义、缺信息、影响验收的重要取舍、环境不可行)时:
  1) 立即停止推进; 2) 将决策写入 work/block.json 后在会话中宣告"已阻塞"; 3) 不要猜测、不要绕过。
  block.json 必须包含: question / context{现状, 已验证的事(含失败尝试), 影响(尤其对验收标准), 相关文件节选} /
  options[2-4 个, 每个含 label+pros/cons+工作量估计] / recommended+理由。
（若为恢复执行: 这是被抢占/阻塞后的恢复, 先重读 plan.json 与最近进展, 再从断点继续, 不要重做已完成步骤。）
```

**block.json 侦测（执行器侧）**
- 执行器对 `<workspace>/work/` 做 fs.watch（+1s 轮询兑底）；发现 `block.json`：
  1. 读入并校验 schema，落库（`task_blocks` 表 + 留言板系统条）
  2. 等当前流结束或 5s 后发 `abort`，SIGTERM 进程（此时 session 已含全部上下文）
  3. `status = blocked`，释放槽位，WS 推 `task.blocked`
  4. 用户提交决策 → 新进程 resume session → `prompt`："你的决策: <answer>。从断点继续。"
- 同一任务可多次阻塞；block.json 读后重命名 `block-<n>.json` 存档，历史全部保留

**评审（Judge, 短上下文, 独立进程, 只读）**
```
你是验收评审官。读取 work/plan.json 的验收清单与以下证据(测试输出/关键文件),
逐条判定 通过/不通过 并给出证据与一句话理由; 最后给综合结论。只输出 work/review.json。
```

## 5. 抢占（preemption）

```
新任务 T_hi 进入且 occupied == maxConcurrency:
  victim = 活跃任务中优先级最低者 (严格低于 T_hi)
  1. executor 发 {"type":"abort"} → SIGTERM(宽限 3s) → SIGKILL
  2. 写 checkpoints 表 {task_id, at: executing, session_file, plan.json 摘要, 时间}
  3. victim.status = interrupted（优先级不变, 回排队）
  4. 槽位释放 → 调度器按 优先级→创建时间 拉入
恢复: 调度器选中 interrupted 任务 → 新进程 resume session → "继续执行"
```
- 仅当任务卡设置 `可被抢占=是`（默认是）
- 同一时刻至多 1 次抢占（避免连环抢占风暴）

## 6. WebSocket 事件（服务端 → 前端）

```
{ seq, ts, kind, payload }
kind ∈
  task.created | task.status{to,from} | task.planned{plan} |
  task.question.answered | task.blocked{block} | task.block_answered{answer} |
  task.user_message{text} | task.assets.updated |
  task.event{event: <pi 原始事件, 压缩> }        ← 留言板流（批量 100ms 合帧）
  task.review{review} | task.confirm_requested |
  runtime.slots{used,total,queue,awaiting,blocked}
```
- 每个事件带单调 `seq`；前端断线重连发 `since=lastSeq` 补拉
- REST 负责 CRUD 与初始全量；WS 只做增量

## 7. 数据模型（SQLite 摘要）

```
boards(id, name, created_at, settings_json)
tasks(id, board_id, num, title, description, priority P0..P3,
      status, created_at, started_at, finished_at,
      workspace_path, branch_mode manual|auto, branch_timeout_min,
      acceptance_text, test_cmd, preemptible,
      retry_count, extra_prompt, plan_json, answers_json, review_json, checkpoint_json)
task_events(id, task_id, seq, ts, kind, payload_json)      -- 留言板(不可变, 追加)
task_assets(id, task_id, task_event_id, kind, name, path_or_url, summary)
task_blocks(id, task_id, question, context_json, options_json, recommended,
            answer, mode user|timeout_auto, asked_at, answered_at, status)
task_user_msgs(id, task_id, text, at, delivered_at)   -- 留言队列(任务非活跃时入队, 送达后置 delivered_at)
prompt_history(id, text, at)                          -- 全局系统提示词历史(≤5)
branch_answers(id, task_id, question_id, answer, mode user|timeout_default, at)
checkpoints(id, task_id, at_status, session_file, summary, at)
settings(key, value_json)                                   -- 并发/超时/重试/模型/端点
skills_cache(id, name, kind skill|extension, scope global|project, path, description, scanned_at)
task_skills(id, task_id, name, source, installed_at)        -- 任务级项目层安装记录
```

## 8. 可靠性

- 服务重启：从 `tasks`/`checkpoints` 恢复；`planning/executing/testing` 的孤儿任务按 `interrupted` 处理（session 文件在，可恢复）
- pi 进程崩溃：stderr 尾部 + 退出码写入留言板（系统条），按重试策略处理
- 测试命令超时：默认 10 分钟，超时视为不通过
- 共享工作目录冲突：两个活跃任务同目录时，后启动者等待（调度器检查）并在 UI 显示“目录占用中”

## 9. 长提示词与附图（P0.5）

两类提示词输入：

1. **短留言（steer）**：单行输入，任务运行中时经 pi RPC 实时注入（下一轮 LLM 调用前生效）；非运行时入队，恢复时合并进上下文。
2. **长提示词**：展开大编辑框（多行），支持附图。创建任务与任务详情两处可用。

### 9.1 图片存储与编号

- 图片落到 **任务工作目录** `<workspace>/work/images/<num>.<ext>` —— 对 agent 天然可见（它就在自己的工程里）。
- 编号 = 该目录现有最大编号 + 1；**不用 DB 表**，直接由目录列表推导（`GET /api/tasks/:id/images`）。
- 上传走 base64 JSON（本地工具，不走 multipart）；express body 上限 16MB，单张上限 20MB。

### 9.2 图文映射（核心约定）

用户正文可用「图 N」自然语言引用附图。服务端在存入 description / 留言前，把附件自动追加为映射块：

```
[附图：正文可用“图 N”引用；agent 用 read 工具读取路径即可看到图片（多模态模型可直接看图）]
![图 1](work/images/1.png)
```

- **UI 侧**：内置 MD 渲染器把 `![alt](src)` 渲染为图片（相对路径经 `GET /api/tasks/:id/file?p=` 解析，仅允许工作区内图片、拒绝 `..` 穿越）。
- **agent 侧**：提示词里的映射块告诉它图片路径；多模态模型用 `read` 工具直接看图，纯文本模型也能拿到路径去处理（如 OCR/描述脚本）。
- **agent 回传图片**：agent 把图存到 `work/` 后，在反馈/交付里写 `![[图 N 描述]](work/xxx.png)`，留言板按同一规则渲染（方括号 alt 兼容 markdown-it 风格）。

### 9.3 API

| 路由 | 说明 |
|---|---|
| `POST /api/tasks/:id/images` `{files:[{name,data(base64)}]}` → `{images, added}` | 上传图片，返回全量列表与本次新增项 |
| `GET /api/tasks/:id/images` → `[{num,name,path}]` | 图片列表（目录推导） |
| `GET /api/tasks/:id/file?p=work/images/1.png` | 工作区内图片安全访问（20MB 上限，仅图片 MIME） |

创建任务 `POST /boards/:id/tasks` 与留言 `POST /tasks/:id/message` 均接受 `images`（base64 数组 / 编号数组），服务端自动追加映射块。

### 9.4 与 pi CLI 的无干扰（再次确认）

附图机制完全落在任务工作目录内（`work/images/`），不改任何 pi 全局配置、不动 `PI_CODING_AGENT_DIR`；pi CLI 单独使用与本插件互不影响。

## 10. 真实执行器实现（P1）

每个任务 = 一个 `pi --mode rpc` 子进程（`server/src/executor.ts` 的 `PiSession`）：

- **进程**：`pi --mode rpc --provider <p> --model <m> --name taskpanel-<num>`，cwd=任务工作目录；Windows 用 `shell:true` + `taskkill /t /f` 连子树回收。
- **协议**：严格 JSONL（stdout 按 `\n` 切分、行首剥 `\r`）；`send()` 用自增 id 关联响应，未知 id 忽略；`agent_settled` 判静止。
- **无人值守**：`extension_ui_request`（用户交互型扩展）自动应答——confirm→true、select→首项、input/editor→cancel，并记 system 事件。
- **阶段编排**（`server/src/runner.ts`）：
  1. **planning**：提示词要求产出 `work/plan.json`（steps / branch_questions / acceptance / test_cmd 建议）；缺失时追问一次，仍缺 failed。
  2. **branch**：plan 含 branch_questions 且 `branch_mode=manual` → `waiting_input`（决策卡）；auto 或超时 → 默认答案（recommended/首项）自动合入。
  3. **executing**：提示词 = 计划 + 分支答案 + 排队留言 + 协议文件约定（`block.json` / `done.json` / `plan.json` 状态写回）；block.json 1s 轮询（streaming 中出现即 abort 本轮）→ 落库 `task_blocks` → `blocked` + 释放槽位。
  4. **testing**：`test_cmd` 走 pi RPC `bash`（输出进会话上下文，agent 可见失败原因）→ 独立「验收官」提示词逐项判定写 `work/review.json`（缺失时按测试退出码自动判定）。
  5. **重试**：`overall=fail` 且 `retry_count < retry_max(3)` → 带 review 反馈重新执行；用尽 → 转人工（awaiting_confirm）。
- **恢复**：`resume()` 起新进程，checkpoint 有 session 文件则 `switch_session` 全量重放；清理上轮 `block.json` / `review.json`；排队留言 + 最近一次阻塞决策文本合入提示词（用户决策最高优先级，agent 不重走写 block.json 步骤）。
- **验收标准优先级**：任务创建时的原始验收标准 > plan.acceptance（规划期推导项可能因阻塞决策过时）。
- **steer**：执行中（streaming）走 RPC `steer`（下次 LLM 调用前生效）；空闲时入队，在下一个执行点合入。
- **崩溃兜底**：子进程意外退出 → `failed` + stderr 尾部；启动失败（pi 不在 PATH 等）→ 直接 `failed`。
