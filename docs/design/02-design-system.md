# 02 · 设计系统（Design System）

> 来源：01-ui-research.md 的 Linear 式纪律。暗色为默认主题，浅色为第二主题，同一套令牌推导。

## 1. 色板（CSS 变量）

```css
:root, [data-theme="dark"] {
  /* 表面（明度台阶，不用投影） */
  --bg-app:      #08090a;   /* 应用壳 / 侧栏 */
  --bg-main:     #0f1011;   /* 主内容区 */
  --bg-raised:   #16181b;   /* 卡片、输入框、下拉 */
  --bg-hover:    #1d2024;   /* hover 表面 */
  --bg-inset:    #050607;   /* 代码块、日志流（凹陷区） */

  /* 边框（1px，层级用明度） */
  --border:      #23252a;
  --border-soft: rgba(255,255,255,.06);
  --border-faint:rgba(255,255,255,.03);

  /* 文本 */
  --text-1: #f7f8f8;  --text-2: #d0d6e0;
  --text-3: #8a8f98;  --text-4: #62666d;

  /* 强调（全系统唯一彩色） */
  --accent:        #5e6ad2;
  --accent-bright: #7170ff;   /* 链接、激活 */
  --accent-hover:  #828fff;
  --accent-ring:   rgba(94,106,210,.3);

  /* 状态色（仅用于徽章/状态点，克制使用） */
  --st-queued:   #8a8f98;  /* 灰  待打磨 */
  --st-planning: #7170ff;  /* 靛  打磨中 */
  --st-input:    #f5a623;  /* 琥珀 待回答 */
  --st-block:    #ef4444;  /* 亮红 阻塞待决策(需人, 圆点带脉冲动画) */
  --st-running:  #8b5cf6;  /* 紫  执行中 */
  --st-testing:  #22b8cf;  /* 青  测试验收 */
  --st-confirm:  #f5c518;  /* 黄  待确认 */
  --st-done:     #27a644;  /* 绿  完成 */
  --st-failed:   #b3403a;  /* 暗红 失败(终态, 静止无脉冲) */
  --st-hold:     #ff7a45;  /* 橙  被抢占 */
}

[data-theme="light"] {
  --bg-app:      #ffffff;
  --bg-main:     #f7f8fa;
  --bg-raised:   #ffffff;
  --bg-hover:    #f0f1f4;
  --bg-inset:    #f2f3f5;

  --border:      #e4e5e7;
  --border-soft: rgba(0,0,0,.08);
  --border-faint:rgba(0,0,0,.04);

  --text-1: #18181b;  --text-2: #52545c;
  --text-3: #8a8f98;  --text-4: #b0b4bc;

  --accent:        #5e6ad2;
  --accent-bright: #4f5ac8;
  --accent-hover:  #4049a8;
  --accent-ring:   rgba(94,106,210,.18);

  --st-queued:   #8a8f98;
  --st-planning: #5e6ad2;
  --st-input:    #b97708;
  --st-block:    #d92d20;
  --st-running:  #7a4fd6;
  --st-testing:  #0e94a8;
  --st-confirm:  #b08900;
  --st-done:     #1e8a38;
  --st-failed:   #99382f;
  --st-hold:     #e05e2b;
}
```

## 2. 字体

```
--font-ui:   "Inter Variable", Inter, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
              font-feature-settings: "cv01", "ss03";
--font-mono: "Berkeley Mono", ui-monospace, "JetBrains Mono", "Cascadia Mono", "Microsoft YaHei UI", monospace;
```

| 用途 | 规格 |
|---|---|
| 页标题 | 18px / 590 / -0.2px |
| 卡片标题 | 14px / 510 |
| 正文 | 13px / 400 / line-height 1.55 / 色 --text-2 |
| 元数据/时间戳 | 11px / 色 --text-3 |
| 代码/路径/命令/日志 | --font-mono 12px |
| 徽章 | 11px / 510 / 全大写或原样 |

## 3. 几何与层级

- 间距：`4 8 12 16 24 32`（4px 网格）
- 圆角：控件 6px / 卡片容器 12px / 徽章 9999px / 日志块 8px
- **深度只用边框与明度台阶**；弹窗/命令面板可用多层淡阴影
- 焦点：`box-shadow: 0 0 0 3px var(--accent-ring)`；active `scale(0.97)`；过渡 120ms

## 4. 组件规范（最小集）

| 组件 | 规格 |
|---|---|
| 按钮 | h32 / px12 / r6 / 13px 510。主=accent 底白字；次=透明+1px border；幽灵=无框。禁用态 --text-4 |
| 任务卡 | r12 / 1px --border / bg-raised；hover 边框亮一档；左 3px 状态色竖条标识状态；p-12 |
| 状态徽章 | 9999px 胶囊 / 11px / 状态色 12% 透明底 + 状态色文字 + 6px 圆点；`执行中 ● 12m`。`阻塞`徽章的圆点带 1.2s 脉冲动画（区分于静态的终态徽章） |
| 优先级标签 | 方角 4px 小标签：P0 红底 / P1 橙 / P2 灰 / P3 淡灰，等宽字 |
| 日志流条目 | 三类缩进：`思考`（--text-3 斜体摘要，可展开）/ `工具`（mono，`▸ bash: git status` + 折叠参数与输出）/ `回复`（--text-2，引用块左边条）；每条 8px 间距，自动滚动可暂停 |
| 表单输入 | h32 / r6 / 1px --border / focus 环；标签 11px 在上 |
| 看板列 | 列头 = 状态点 + 名称 + 计数；列宽 300px 横向滚动；列内卡间距 8px |
| 侧栏 | w232 / bg-app / 1px 右边框；导航项 h32 r6 13px 510，激活 = bg-raised + 左侧 2px accent 竖条 |
| 顶部栏 | h48 / 无底边框，仅用留白分隔；左=页标题，右=⌘K 搜索、主题切换、运行状态 |
| 空状态 | 居中图标（outline 1.5px 描边）+ 一行说明 + 一个主操作 |

## 5. 动效

- 全局 120ms ease-out；看板列间任务移动用 FLIP 位移（200ms）
- 日志流新条目：淡入 80ms，无位移
- 状态变化：徽章颜色 200ms 过渡 + 卡片竖条同步

## 6. 图标

- 线性 1.5px 描边、圆角端点（Lucide 风格），16/20px 两档
- 不填充、不彩色（状态点除外）
